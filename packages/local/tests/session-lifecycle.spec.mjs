import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

async function companionCommands() {
  const source = await readFile(new URL('../../companion/src/client.js', import.meta.url), 'utf8')
  let commands
  vm.runInNewContext(source.replace('return module.exports', 'return { invoke }'), {
    window: { __ModuleLoader__: { load({ factory }) { commands = factory() } } },
    AbortSignal,
  })
  return commands
}

function controllerFixture() {
  let selected
  let references = 0
  let renamed
  const ctx = {
    uiWorkspace: { openSession(id) { selected = id } },
    sessions: {
      retainInfo(id) { return { getSnapshot: () => ({ retainedBy: selected === id ? { mainView: 1 } : {} }) } },
      async using(id, options, operation) {
        references++
        try {
          options.signal?.throwIfAborted()
          return await operation({ ready: Promise.resolve({ session: {
            async rename(title) { renamed = { id, title }; return { ok: true, value: {} } },
          } }) })
        } finally { references-- }
      },
    },
  }
  return { ctx, references: () => references, selected: () => selected, renamed: () => renamed }
}

test('companion opens through view ownership and releases its temporary Controller reference', async () => {
  const { invoke } = await companionCommands()
  const fixture = controllerFixture()
  await invoke(fixture.ctx, 'session/open', { sessionId: 'remote-a-session' }, new AbortController().signal)
  assert.equal(fixture.selected(), 'remote-a-session')
  assert.equal(fixture.references(), 0)
})

test('companion renames an unselected session without changing navigation or leaking a reference', async () => {
  const { invoke } = await companionCommands()
  const fixture = controllerFixture()
  await invoke(fixture.ctx, 'session/rename', { sessionId: 'unselected', title: 'Renamed' }, new AbortController().signal)
  assert.deepEqual(fixture.renamed(), { id: 'unselected', title: 'Renamed' })
  assert.equal(fixture.selected(), undefined)
  assert.equal(fixture.references(), 0)
})

test('cancelled remote open cannot change the selected session', async () => {
  const { invoke } = await companionCommands()
  const fixture = controllerFixture()
  const abort = new AbortController()
  abort.abort(new Error('superseded'))
  await assert.rejects(invoke(fixture.ctx, 'session/open', { sessionId: 'stale' }, abort.signal), /superseded/)
  assert.equal(fixture.selected(), undefined)
  assert.equal(fixture.references(), 0)
})
