/** Self-contained worker: sent to the remote Node process, with data on stdin. */
export async function synchronizeRemote() {
  const fs = await import('node:fs/promises')
  const { spawn } = await import('node:child_process')
  const { createRequire } = await import('node:module')
  const { join, dirname, resolve } = await import('node:path')
  const { homedir } = await import('node:os')
  const { pathToFileURL } = await import('node:url')
  const { createHash } = await import('node:crypto')
  const { setTimeout: delay } = await import('node:timers/promises')
  let stage = 'Checking environment', child, lock, backup
  const progress = value => { stage = value; console.log(`DSH_SETUP_STAGE:${value}`) }
  const stopChild = () => {
    if (!child?.pid) return
    try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
  }
  const abort = () => { stopChild(); process.exit(130) }
  process.on('SIGHUP', abort)
  process.on('SIGTERM', abort)
  const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'))
  const optional = async file => {
    try { return await readJson(file) } catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
  }
  const run = async (command, args, options = {}) => {
    let output = ''
    child = spawn(command, args, { detached: true, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], ...options })
    child.stdout.on('data', bytes => { output = `${output}${bytes}`.slice(-8000) })
    child.stderr.on('data', bytes => { output = `${output}${bytes}`.slice(-8000) })
    await new Promise((accept, reject) => {
      const timer = setTimeout(() => { stopChild(); reject(new Error(`${command} timed out`)) }, 300000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', (code, signal) => { clearTimeout(timer); code === 0 ? accept() : reject(new Error(`${command} failed (${code ?? signal ?? 'unknown'}): ${output}`)) })
    })
    child = undefined
    return output.trim()
  }
  const writeAtomic = async (file, value) => {
    const temporary = `${file}.${process.pid}.tmp`
    await fs.writeFile(temporary, value, { mode: 0o600 })
    await fs.rename(temporary, file)
  }
  try {
    progress(stage)
    let input = ''
    if (process.env.DSH_REMOTE_DESKTOP_FRAMED === '1') {
      // Keep stdin open as a cancellation channel after the first JSON line.
      await new Promise((accept, reject) => {
        const onEnd = () => reject(new Error('SSH disconnected before the synchronization payload arrived'))
        const onData = chunk => {
          input += chunk
          if (input.length > 64 * 1024 * 1024) { reject(new Error('Synchronization payload exceeds 64 MB')); return }
          if (input.includes('\n')) {
            input = input.slice(0, input.indexOf('\n'))
            process.stdin.off('data', onData)
            process.stdin.off('end', onEnd)
            process.stdin.once('end', abort)
            accept()
          }
        }
        process.stdin.once('end', onEnd)
        process.stdin.on('data', onData)
      })
    } else {
      for await (const chunk of process.stdin) {
        input += chunk
        if (input.length > 64 * 1024 * 1024) throw new Error('Synchronization payload exceeds 64 MB')
      }
    }
    const target = JSON.parse(input)
    const identity = (name, version) => {
      if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(name) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid package identity')
    }
    identity('@deepseek-ai/dsh', target.runtimeVersion)
    for (const plugin of target.plugins) identity(plugin.name, plugin.version)
    if (!target.plugins.some(p => p.name === 'dsh-ssh-workspace-companion' && p.enabled)) throw new Error('Enabled companion is required')
    if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required; install compatible Node/npm and retry')
    await run('npm', ['--version'])
    const home = resolve(process.env.DSH_HOME || join(homedir(), '.dsh'))
    process.env.DSH_HOME = home
    const port = Number(process.env.DSH_REMOTE_DESKTOP_PORT)
    const host = process.env.DSH_REMOTE_DESKTOP_HOST
    if (!Number.isInteger(port) || port < 1 || port > 65535 || host !== '127.0.0.1') throw new Error('Automatic setup requires a loopback host and valid port')
    const stateDir = join(home, 'remote-desktop', 'managed')
    await fs.mkdir(stateDir, { recursive: true })
    const lockPath = join(stateDir, 'setup.lock')
    // A disconnected SSH session can leave a lock; recover only a dead local PID.
    try { await fs.mkdir(lockPath); lock = lockPath } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const owner = await optional(join(lockPath, 'owner.json'))
      let alive = true
      if (Number.isInteger(owner?.pid)) {
        try { process.kill(owner.pid, 0) } catch (failure) { if (failure.code === 'ESRCH') alive = false }
      }
      if (alive) throw new Error('Another remote setup is in progress; retry after it finishes')
      await fs.rm(lockPath, { recursive: true })
      await fs.mkdir(lockPath); lock = lockPath
    }
    await fs.writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid }))
    const profile = join(home, 'profiles', 'web')
    const manifestPath = join(profile, 'package.json')
    const log = `/tmp/dsh-remote-desktop-${port}.log`
    const pidfile = `/tmp/dsh-remote-desktop-${port}.pid`
    const servicePath = join(stateDir, `service-${port}.json`)
    const fetchReady = async () => {
      try { await fetch(`http://${host}:${port}/`, { signal: AbortSignal.timeout(1500) }); return true } catch { return false }
    }
    const ownedPid = async () => {
      let pid
      try { pid = Number((await fs.readFile(pidfile, 'utf8')).trim()) } catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
      if (!Number.isInteger(pid) || pid < 1) return undefined
      let command
      try { command = await run('ps', ['-p', String(pid), '-o', 'args=']) } catch { return undefined }
      if (!/(?:^|\/)dsh(?:\s|\/lib\/bin\.js\s)/.test(command) || !command.includes('--profile web') || !new RegExp(`--port ${port}(?:\\s|$)`).test(command)) return undefined
      // Linux remotes provide exact process environment; refuse ambiguous ownership elsewhere.
      try {
        const environment = (await fs.readFile(`/proc/${pid}/environ`, 'utf8')).split('\0')
        if (!environment.includes(`DSH_HOME=${home}`)) return undefined
      } catch {
        const record = await optional(servicePath)
        if (!record || record.pid !== pid || record.home !== home || record.command !== command) return undefined
      }
      return pid
    }
    const listening = await fetchReady()
    const pid = await ownedPid()
    if (listening && !pid) throw new Error(`Port ${port} is occupied by a service not owned by SSH Workspace for ${home}; stop it explicitly`)
    // Check a non-HTTP listener too before mutating packages.
    if (!listening && !pid) {
      const { createServer } = await import('node:net')
      await new Promise((accept, reject) => {
        const server = createServer()
        server.once('error', () => reject(new Error(`Port ${port} is occupied by an unrelated process`)))
        server.listen(port, host, () => server.close(accept))
      })
    }
    const before = await optional(manifestPath)
    backup = join(stateDir, 'backups', `${Date.now()}-${process.pid}`)
    let backedUp = false
    const saveBackup = async () => {
      if (backedUp) return
      await fs.mkdir(backup, { recursive: true })
      for (const filename of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml']) {
        try { await fs.copyFile(join(profile, filename), join(backup, filename)) } catch (error) { if (error.code !== 'ENOENT') throw error }
      }
      try { await fs.copyFile(join(home, 'cordis.patch.yml'), join(backup, 'home-cordis.patch.yml')) } catch (error) { if (error.code !== 'ENOENT') throw error }
      backedUp = true
    }
    let executable, changed = false
    const runtimeDir = join(stateDir, 'runtime', target.runtimeVersion)
    const managedBin = join(runtimeDir, 'node_modules', '.bin', 'dsh')
    try { if (await run(managedBin, ['--version']) === target.runtimeVersion) executable = managedBin } catch {}
    if (!executable) {
      try {
        if (await run('dsh', ['--version']) === target.runtimeVersion) {
          const candidate = await fs.realpath(await run('sh', ['-c', 'command -v dsh']))
          const info = await optional(join(dirname(candidate), '..', 'package.json'))
          if (info?.name === '@deepseek-ai/dsh' && info.version === target.runtimeVersion) executable = candidate
          else {
            // Some SSH environments expose a shell shim rather than the npm bin.
            const globalRoot = await run('npm', ['root', '--global'])
            const metadata = await optional(join(globalRoot, '@deepseek-ai/dsh/package.json'))
            if (metadata?.version === target.runtimeVersion) executable = join(globalRoot, '@deepseek-ai/dsh', metadata.bin.dsh)
          }
        }
      } catch {}
    }
    if (!executable) {
      progress('Installing DSH')
      await saveBackup()
      const staging = `${runtimeDir}.install-${process.pid}`
      await fs.mkdir(staging, { recursive: true })
      await run('npm', ['install', '--prefix', staging, '--engine-strict', '--no-audit', '--no-fund', `@deepseek-ai/dsh@${target.runtimeVersion}`])
      if (await run(join(staging, 'node_modules/.bin/dsh'), ['--version']) !== target.runtimeVersion) throw new Error('Installed DSH version does not match local runtime')
      try { await fs.rename(runtimeDir, `${runtimeDir}.previous-${process.pid}`) } catch (error) { if (error.code !== 'ENOENT') throw error }
      await fs.rename(staging, runtimeDir)
      executable = managedBin
      if (await run(executable, ['--version']) !== target.runtimeVersion) throw new Error('Installed DSH version does not match local runtime')
      changed = true
    }
    // Resolve APIs from the exact CLI being launched, including installations on PATH.
    const resolvedBin = executable
    const realBin = await fs.realpath(resolvedBin)
    const require = createRequire(join(dirname(realBin), '..', 'package.json'))
    const boot = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href)
    const yaml = require('js-yaml')
    const defaults = boot.PROFILE_TEMPLATES.web.bundles
    if (!before) { await saveBackup(); await fs.mkdir(profile, { recursive: true }); boot.initProfile(profile, defaults); changed = true }
    let manifest = await readJson(manifestPath)
    const previousBundles = manifest.dsh?.profile?.bundles ?? []
    const desiredBundles = [...defaults, ...target.plugins.filter(p => p.enabled && !defaults.includes(p.name)).map(p => p.name)]
    const pending = []
    for (const plugin of target.plugins) {
      const installed = await optional(join(profile, 'node_modules', plugin.name, 'package.json'))
      if (installed?.version !== plugin.version || !Object.hasOwn(manifest.dependencies ?? {}, plugin.name)) pending.push(plugin)
    }
    const patchPath = join(home, 'cordis.patch.yml')
    let patchText = ''
    try { patchText = await fs.readFile(patchPath, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
    const patches = yaml.load(patchText) ?? []
    if (!Array.isArray(patches)) throw new Error('Remote home patch must be a patch list')
    const effective = boot.composeEntries([boot.readProfilePatches('dsh', { name: 'web', dir: profile, installAnchor: join(dirname(realBin), '..', 'package.json'), home, patchPath: join(profile, 'cordis.patch.yml'), overlays: [] })])
    const rowMap = new Map(effective.map(row => [row.id, row]))
    const activation = target.plugins.filter(p => p.enabled).flatMap(p => p.activation)
    const activationChanged = activation.some(row => (rowMap.get(row.id)?.disabled === true) !== row.disabled)
    if (pending.length || JSON.stringify(previousBundles) !== JSON.stringify(desiredBundles) || activationChanged) changed = true
    const record = await optional(servicePath)
    // A legacy managed listener must be restarted once to verify its actual version.
    const fingerprint = createHash('sha256').update(JSON.stringify({ version: target.runtimeVersion, plugins: target.plugins.map(({ archive, integrity, ...p }) => p) })).digest('hex')
    const restart = changed || !listening || !record || record.pid !== pid || record.fingerprint !== fingerprint
    if (restart && pid) {
      progress('Stopping managed DSH')
      process.kill(pid, 'SIGTERM')
      for (let attempt = 0; attempt < 100; attempt++) {
        try { process.kill(pid, 0) } catch (error) { if (error.code === 'ESRCH') break; throw error }
        if (attempt === 99) throw new Error('Managed DSH did not stop; retry after stopping it explicitly')
        await delay(100)
      }
    }
    if (changed) await saveBackup()
    progress('Synchronizing plugins')
    for (const plugin of pending) {
      let spec = `${plugin.name}@${plugin.version}`
      if (plugin.archive) {
        const bytes = Buffer.from(plugin.archive, 'base64')
        if (createHash('sha256').update(bytes).digest('hex') !== plugin.integrity) throw new Error(`Invalid archive integrity for ${plugin.name}`)
        const archivePath = join(stateDir, `${plugin.name.replace(/[^a-z0-9.-]/g, '_')}-${plugin.version}.tgz`)
        await fs.writeFile(archivePath, bytes, { mode: 0o600 })
        spec = archivePath
      }
      await run(executable, ['plugin', '--profile', 'web', 'add', spec])
      const installed = await readJson(join(profile, 'node_modules', plugin.name, 'package.json'))
      if (installed.name !== plugin.name || installed.version !== plugin.version) throw new Error(`Installed plugin mismatch: ${plugin.name}@${plugin.version}`)
    }
    manifest = await readJson(manifestPath)
    if (JSON.stringify(manifest.dsh?.profile?.bundles) !== JSON.stringify(desiredBundles)) {
      manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: desiredBundles } }
      await writeAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    }
    if (activationChanged || pending.length) {
      // Append only activation flags. Existing remote configuration fields stay intact.
      for (const row of activation) patches.push({ id: row.id, disabled: row.disabled })
      await writeAtomic(patchPath, yaml.dump(patches))
    }
    for (const plugin of target.plugins) {
      const installed = await readJson(join(profile, 'node_modules', plugin.name, 'package.json'))
      if (installed.version !== plugin.version) throw new Error(`Plugin verification failed: ${plugin.name}`)
    }
    if (boot.loadProfileDirectory) {
      const loaded = boot.loadProfileDirectory('dsh', profile, join(dirname(realBin), '..', 'package.json'), { userLayer: false })
      const skipped = loaded.skippedBundles.filter(entry => target.plugins.some(p => p.enabled && p.name === entry.packageName))
      if (skipped.length) throw new Error(`Remote plugin cannot load: ${skipped.map(entry => `${entry.packageName}: ${entry.reason}`).join('; ')}`)
    }
    if (restart) {
      progress('Starting DSH')
      const handle = await fs.open(log, 'w', 0o600)
      const daemon = spawn(executable, ['--profile', 'web', '--host', host, '--port', String(port), '--trusted-host', `${host}:${port}`], { detached: true, env: process.env, stdio: ['ignore', handle.fd, handle.fd] })
      await new Promise((accept, reject) => { daemon.once('spawn', accept); daemon.once('error', reject) })
      daemon.unref()
      await handle.close()
      await fs.writeFile(pidfile, String(daemon.pid), { mode: 0o600 })
      const command = await run('ps', ['-p', String(daemon.pid), '-o', 'args='])
      await writeAtomic(servicePath, JSON.stringify({ pid: daemon.pid, command, home, executable: resolvedBin, version: target.runtimeVersion, fingerprint }))
    }
    progress('Verifying remote DSH')
    const current = await readJson(servicePath)
    if (!await ownedPid() || current.version !== target.runtimeVersion) throw new Error('Running DSH ownership/version verification failed')
    let token
    for (let attempt = 0; attempt < 150; attempt++) {
      const text = await fs.readFile(log, 'utf8').catch(() => '')
      token = text.match(/http:\/\/[^\s]+[?]token=[^\s]+/g)?.at(-1)
      try {
        const health = await fetch(`http://${host}:${port}/remote-desktop-companion/api/health`, { signal: AbortSignal.timeout(1000) })
        if (health.ok) {
          const data = await health.json()
          const companion = target.plugins.find(p => p.name === 'dsh-ssh-workspace-companion')
          if (data.name === companion.name && data.version === companion.version && data.dshVersion === target.runtimeVersion && token) break
        }
      } catch {}
      if (attempt === 149) throw new Error(`Remote DSH did not become ready; inspect ${log}`)
      await delay(200)
    }
    console.log(token)
  } catch (error) {
    // Auth URLs and npm credentials must not appear in API errors.
    const message = String(error.message).replace(/([?&]token=)[^\s&]+/g, '$1[redacted]').replace(/(https?:\/\/)[^/\s@]+:[^/\s@]+@/g, '$1[redacted]@')
    console.error(`${stage}: ${message}${backup ? `; profile backups: ${backup}` : ''}`)
    process.exitCode = 1
  } finally {
    if (lock) await fs.rm(lock, { recursive: true, force: true })
    process.stdin.off('end', abort)
    if (process.env.DSH_REMOTE_DESKTOP_FRAMED === '1') process.stdin.destroy()
  }
}
