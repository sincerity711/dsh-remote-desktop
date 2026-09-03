#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'

const check = process.argv.includes('--check')
const builds = [
  {
    output: 'packages/local/lib/client.js',
    inputs: [
      'packages/local/src/client/00-loader.part.js',
      'packages/local/src/client/10-official-workspace.part.js',
      'packages/local/src/client/20-store-bridge.part.js',
      'packages/local/src/client/30-workspace-ui.part.js',
      'packages/local/src/client/40-overlay-settings.part.js',
      'packages/local/src/client/50-apply.part.js',
    ],
  },
  {
    output: 'packages/companion/lib/client.js',
    inputs: ['packages/companion/src/client.js'],
  },
]

let stale = false
for (const build of builds) {
  const generated = (await Promise.all(build.inputs.map(path => readFile(path, 'utf8')))).join('')
  if (check) {
    const current = await readFile(build.output, 'utf8').catch(() => '')
    if (current !== generated) {
      console.error(`${build.output} is stale; run npm run build`)
      stale = true
    }
  } else {
    await writeFile(build.output, generated)
    console.log(`generated ${build.output}`)
  }
}
if (stale) process.exitCode = 1
