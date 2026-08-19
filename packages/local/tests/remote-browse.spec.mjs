import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRemoteBrowseSshArgs, parseBrowseHidden, shellQuote } from '../lib/index.js'

test('remote browse SSH command keeps user paths out of shell command', () => {
  const source = { id: 'dev', sshAlias: 'dev', sshPort: 22 }
  const args = buildRemoteBrowseSshArgs(source)
  const command = args.at(-1)

  assert.equal(args[0], '-o')
  assert.equal(args[1], 'BatchMode=yes')
  assert.equal(args[2], 'dev')
  assert.match(command, /^node -e '/)
  assert.doesNotMatch(command, /SAPDevelop|path-to-project|; rm -rf/)
  assert.match(command, /process\.stdin/)
})

test('remote browse shell quoting preserves embedded single quotes', () => {
  assert.equal(shellQuote("a'b"), "'a'\\''b'")
})

test('remote browse hidden flag parser accepts explicit true values only', () => {
  assert.equal(parseBrowseHidden('1'), true)
  assert.equal(parseBrowseHidden('true'), true)
  assert.equal(parseBrowseHidden('0'), false)
  assert.equal(parseBrowseHidden(''), false)
})
