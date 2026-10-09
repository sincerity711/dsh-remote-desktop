import { mkdtemp, mkdir, writeFile, symlink, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { synchronizeRemote } from '../../lib/remote-sync.js'

export async function syncFixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sync-test-'))
  const runtime = join(root, 'template'), cli = join(runtime, 'node_modules/@deepseek-ai/dsh')
  const boot = join(runtime, 'node_modules/@deepseek-ai/dsh-app-boot')
  const bin = join(root, 'bin'), home = join(root, 'home')
  await Promise.all([mkdir(join(cli, 'lib'), { recursive: true }), mkdir(boot, { recursive: true }), mkdir(join(runtime, 'node_modules/js-yaml'), { recursive: true }), mkdir(bin), mkdir(home)])
  const anchor = join(cli, 'package.json')
  await writeFile(anchor, JSON.stringify({ name: '@deepseek-ai/dsh', version: '1.2.3', type: 'module' }))
  await writeFile(join(boot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-app-boot', type: 'module', exports: './index.js' }))
  await writeFile(join(boot, 'index.js'), `
import fs from 'node:fs';import path from 'node:path';
export const getDshRuntimeVersion=()=> '1.2.3';
export const PROFILE_TEMPLATES={web:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']}};
export function initProfile(dir,bundles){fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({private:true,dsh:{profile:{bundles}},dependencies:{}}))}
export const composeEntries=layers=>layers.flat();
export function readProfilePatches(_,context){return [context.patchPath,path.join(context.home,'cordis.patch.yml')].flatMap(p=>fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):[])}
export const resolveBundleDir=(_,name,anchor,dir)=>path.join(dir,'node_modules',name);
export const bundlePatchPaths=(dir,bundle)=>[path.join(dir,bundle.patch)];
`)
  await writeFile(join(runtime, 'node_modules/js-yaml/package.json'), JSON.stringify({ main: 'index.cjs' }))
  await writeFile(join(runtime, 'node_modules/js-yaml/index.cjs'), 'exports.load=s=>s.trim()?JSON.parse(s):[];exports.dump=JSON.stringify;')
  const entry = join(cli, 'lib/bin.js')
  await writeFile(entry, `#!${process.execPath}
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';
const args=process.argv.slice(2),home=process.env.DSH_HOME,profile=path.join(home,'profiles/web');
if(args[0]==='--version'){console.log('1.2.3');process.exit(0)}
if(args[0]==='plugin'){
const spec=args.at(-1), match=/^(.*)@([^@]+)$/.exec(spec);if(!match)throw Error('bad spec');
const [,name,version]=match;fs.appendFileSync(path.join(home,'plugin-calls'),spec+'\\n');
const manifestPath=path.join(profile,'package.json'),m=JSON.parse(fs.readFileSync(manifestPath));m.dependencies??={};m.dependencies[name]=version;fs.writeFileSync(manifestPath,JSON.stringify(m));
const dir=path.join(profile,'node_modules',name);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name,version}));process.exit(0)}
const port=Number(args[args.indexOf('--port')+1]);console.log('http://127.0.0.1:'+port+'/?token=test-token');
http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({name:'dsh-ssh-workspace-companion',version:'1.2.3',dshVersion:'1.2.3'}))}).listen(port,'127.0.0.1');
`)
  await fsExecutable(entry)
  await symlink(entry, join(bin, 'dsh'))
  await writeFile(join(bin, 'npm'), `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),args=process.argv.slice(2);
if(args[0]==='--version'){console.log('10.0.0');process.exit(0)}
if(process.env.SYNC_FAIL_INSTALL){console.error('requested exact version unavailable');process.exit(1)}
fs.appendFileSync(path.join(process.env.DSH_HOME,'npm-calls'),args.at(-1)+'\\n');
const dest=args[args.indexOf('--prefix')+1];fs.cpSync(${JSON.stringify(runtime)},dest,{recursive:true});fs.mkdirSync(path.join(dest,'node_modules/.bin'),{recursive:true});fs.symlinkSync('../@deepseek-ai/dsh/lib/bin.js',path.join(dest,'node_modules/.bin/dsh'));
`)
  await fsExecutable(join(bin, 'npm'))
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  const target = { runtimeVersion: '1.2.3', plugins: [{ name: 'dsh-ssh-workspace-companion', version: '1.2.3', enabled: true, activation: [] }, { name: 'example-plugin', version: '2.3.4', enabled: true, activation: [{ id: 'example-row', disabled: true }] }] }
  return { root, home, bin, anchor, port, target,
    async run(value = target, extra = {}) {
      const proc = spawn(process.execPath, ['--input-type=module', '-e', `(${synchronizeRemote.toString()})()`], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, DSH_HOME: home, DSH_REMOTE_DESKTOP_HOST: '127.0.0.1', DSH_REMOTE_DESKTOP_PORT: String(port), ...extra }, stdio: ['pipe', 'pipe', 'pipe'] })
      let stdout = '', stderr = ''
      proc.stdout.on('data', data => { stdout += data }); proc.stderr.on('data', data => { stderr += data })
      proc.stdin.on('error', () => {})
      if (extra.DSH_REMOTE_DESKTOP_FRAMED === '1') proc.stdin.write(`${JSON.stringify(value)}\n`)
      else proc.stdin.end(JSON.stringify(value))
      if (extra.SYNC_CLOSE_INPUT) setTimeout(() => proc.stdin.end(), 100)
      const code = await new Promise(resolve => proc.once('exit', resolve))
      return { code, stdout, stderr }
    },
    async close() {
      try { const record = JSON.parse(await readFile(join(home, `remote-desktop/managed/service-${port}.json`), 'utf8')); process.kill(record.pid, 'SIGTERM') } catch {}
      await rm(`/tmp/dsh-remote-desktop-${port}.pid`, { force: true }); await rm(`/tmp/dsh-remote-desktop-${port}.log`, { force: true })
      await rm(root, { recursive: true, force: true })
    },
  }
}

async function fsExecutable(path) {
  const { chmod } = await import('node:fs/promises')
  await chmod(path, 0o755)
}
