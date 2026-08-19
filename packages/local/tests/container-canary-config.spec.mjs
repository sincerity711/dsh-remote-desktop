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
