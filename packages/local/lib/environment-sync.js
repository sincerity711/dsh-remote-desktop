import { readFile, mkdtemp, rm, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const CONTROLLER = 'dsh-ssh-workspace'
const COMPANION = 'dsh-ssh-workspace-companion'
const LEGACY = new Set(['dsh-remote-desktop', 'dsh-remote-desktop-companion'])

export function validateIdentity(name, version) {
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(name)
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid package identity: ${name}@${version}`)
  }
}

async function pack(directory, signal) {
  const target = await mkdtemp(join(tmpdir(), 'dsh-workspace-pack-'))
  try {
    signal?.throwIfAborted()
    const proc = spawn('npm', ['pack', directory, '--ignore-scripts', '--json', '--pack-destination', target], { signal, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', error = ''
    proc.stdout.on('data', chunk => { output += chunk })
    proc.stderr.on('data', chunk => { error = `${error}${chunk}`.slice(-2000) })
    await new Promise((resolve, reject) => {
      proc.once('error', reject)
      proc.once('exit', code => code === 0 ? resolve() : reject(new Error(`Cannot package local plugin ${directory}: ${error}`)))
    })
    const [entry] = JSON.parse(output)
    const bytes = await readFile(join(target, entry.filename))
    if (bytes.length > 32 * 1024 * 1024) throw new Error(`Plugin archive too large: ${entry.name}`)
    return { archive: bytes.toString('base64'), integrity: createHash('sha256').update(bytes).digest('hex') }
  } finally {
    await rm(target, { recursive: true, force: true })
  }
}

/** Resolve through the running launcher's anchor, never a second CLI on PATH. */
export async function snapshotEnvironment(profileContext, signal) {
  if (!profileContext?.dir || !profileContext?.installAnchor) throw new Error('Running DSH does not expose its active profile; update DSH before synchronizing')
  const require = createRequire(profileContext.installAnchor)
  const boot = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href)
  const yaml = require('js-yaml')
  const runtimeVersion = boot.getDshRuntimeVersion()
  validateIdentity('@deepseek-ai/dsh', runtimeVersion)
  const manifest = JSON.parse(await readFile(join(profileContext.dir, 'package.json'), 'utf8'))
  const active = manifest.dsh?.profile?.bundles ?? []
  const defaults = new Set(boot.PROFILE_TEMPLATES?.[profileContext.name ?? basename(profileContext.dir)]?.bundles ?? [])
  const effective = boot.composeEntries([boot.readProfilePatches('dsh', profileContext)])
  const rows = new Map(effective.map(row => [row.id, row]))
  const plugins = []
  for (const name of new Set([...Object.keys(manifest.dependencies ?? {}), ...active])) {
    signal?.throwIfAborted()
    if (LEGACY.has(name) || name === COMPANION) continue
    const directory = await realpath(boot.resolveBundleDir('dsh', name, profileContext.installAnchor, profileContext.dir))
    const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    if (!metadata.dsh?.bundle) continue
    // Installation-owned bundles are supplied by the exact remote runtime.
    let installDir
    try { installDir = await realpath(boot.resolveBundleDir('dsh', name, profileContext.installAnchor, dirname(profileContext.installAnchor))) } catch {}
    if (directory === installDir && defaults.has(name)) continue
    const remoteName = name === CONTROLLER ? COMPANION : name
    validateIdentity(remoteName, metadata.version)
    const platform = metadata.dsh?.client?.platform
    if (name !== CONTROLLER && platform && !(Array.isArray(platform) ? platform.includes('web') : platform === 'web')) {
      throw new Error(`${name}@${metadata.version} does not support remote Web`)
    }
    const activation = []
    if (name !== CONTROLLER) {
      for (const path of boot.bundlePatchPaths(directory, metadata.dsh.bundle)) {
        const patches = yaml.load(await readFile(path, 'utf8')) ?? []
        for (const patch of patches) for (const row of patch.insert ?? []) {
          if (row.id) activation.push({ id: row.id, disabled: rows.get(row.id)?.disabled === true })
        }
      }
    }
    const plugin = { name: remoteName, version: metadata.version, enabled: name === CONTROLLER || active.includes(name), activation }
    if (name === CONTROLLER) {
      // Source checkouts carry the matching companion beside the controller.
      const companion = join(directory, '..', 'companion')
      try {
        const info = JSON.parse(await readFile(join(companion, 'package.json'), 'utf8'))
        if (info.name === COMPANION && info.version === metadata.version) Object.assign(plugin, await pack(companion, signal))
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    } else if (/^(?:file:|link:|workspace:|\.|\/|git\+|github:)/.test(manifest.dependencies?.[name] ?? '') || metadata.private) {
      Object.assign(plugin, await pack(directory, signal))
    }
    plugins.push(plugin)
  }
  if (!plugins.some(plugin => plugin.name === COMPANION)) throw new Error('Active profile is missing dsh-ssh-workspace')
  return { runtimeVersion, plugins }
}
