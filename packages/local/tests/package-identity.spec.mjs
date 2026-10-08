import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

for (const part of ['local', 'companion']) {
  test(`${part} registers its published package name for host and client loading`, async () => {
    const root = new URL(`../../${part}/`, import.meta.url)
    const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
    const host = await import(new URL('lib/index.js', root))
    const client = await readFile(new URL('lib/client.js', root), 'utf8')
    const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
    assert.equal(host.name, pkg.name)
    assert.equal(client.match(/__ModuleLoader__\.load\(\{\s*id: '([^']+)'/)[1], pkg.name)
    assert.match(patch, new RegExp(`name: ${pkg.name}(?:\\n|$)`))
  })
}
