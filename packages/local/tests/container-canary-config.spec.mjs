import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('container canary supplies an isolated dummy Ollama credential everywhere', async () => {
  const helper = await readFile(new URL('../../../scripts/acceptance/container-env.mjs', import.meta.url), 'utf8')

  assert.match(helper, /const ollamaApiKeyEnv = 'DSH_RD_OLLAMA_API_KEY'/)
  assert.match(helper, /const ollamaApiKey = process\.env\[ollamaApiKeyEnv\] \?\? 'ollama-canary-dummy-key'/)
  assert.match(helper, /apiKeyEnv: \$\{ollamaApiKeyEnv\}/)
  assert.match(helper, /nohup env DSH_HOME=.*\$\{ollamaApiKeyEnv\}=\$\{sh\(ollamaApiKey\)\} dsh/)
  assert.match(helper, /\[ollamaApiKeyEnv\]: ollamaApiKey/)
})

test('automated acceptance supplies local Ollama as the routable default everywhere', async () => {
  for (const script of ['e2e-win-wsl.mjs', 'p1-p2-win-wsl.mjs']) {
    const helper = await readFile(new URL(`../../../scripts/acceptance/${script}`, import.meta.url), 'utf8')

    assert.match(helper, /const ollamaModel = process\.env\.DSH_RD_OLLAMA_MODEL \?\? 'minicpm-v4\.6:1b'/)
    assert.match(helper, /apiKeyEnv: \$\{ollamaApiKeyEnv\}/)
    assert.match(helper, /ollamaSettings\(remoteOllamaBaseUrl\)/)
    assert.match(helper, /ollamaSettings\(`\$\{localOllamaBaseUrl\}\/v1`\)/)
    assert.match(helper, /\[ollamaApiKeyEnv\]: ollamaApiKey/)
    assert.match(helper, /assertOllamaDefault\(await remoteRpc/)
    assert.match(helper, /assertOllamaDefault\(await localRpc/)
  }
})
