import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

test('workspace view ignores an incompatible official sidebar snapshot', async () => {
  const source = await readFile(new URL('../src/client/10-official-workspace.part.js', import.meta.url), 'utf8')
  const start = source.indexOf('function createWorkspaceViewStore()')
  const end = source.indexOf('//#endregion', start)
  const persisted = new Map([['dsh.workspace.view.v5', { groupBy: 'workspace', groupExpansion: {} }]])
  let spec
  const context = vm.createContext({
    _deepseek_ai_dsh_client_store: { defineStore: value => { spec = value; return value } },
  })
  vm.runInContext(`${source.slice(start, end)}; createWorkspaceViewStore()`, context)
  assert.notEqual(spec.persist, 'dsh.workspace.view.v5')
  const state = persisted.get(spec.persist) ?? spec.init()
  spec.actions.pinSessionOrder(state, 's1', ['workspace1'])
  spec.actions.syncSessionOrderAccount(state, 'workspace1', ['s1'], { s1: 100 })
  spec.actions.retainAccountKeys(state, ['workspace1'])
  assert.deepEqual(Array.from(state.sessionOrderByAccount.workspace1), ['s1'])
  assert.equal(state.sessionUpdatedAtByAccount.workspace1.s1, 100)
  assert.equal(persisted.get('dsh.workspace.view.v5').groupBy, 'workspace')
})
