import { CliError } from './ui.js'

const PROVIDERS = {
  openai: {
    envKeys: ['OPENAI_API_KEY', 'MELDR_OPENAI_KEY'],
    defaultBase: 'https://api.openai.com/v1',
    header: (key) => ({ authorization: `Bearer ${key}` }),
    body: (model, system, user) => ({
      model: model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    extract: (json) => json?.choices?.[0]?.message?.content,
  },
  anthropic: {
    envKeys: ['ANTHROPIC_API_KEY', 'MELDR_ANTHROPIC_KEY'],
    defaultBase: 'https://api.anthropic.com',
    header: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
    body: (model, system, user) => ({
      model: model || 'claude-3-5-haiku-latest',
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: user }],
    }),
    extract: (json) => (Array.isArray(json?.content) ? json.content.filter((b) => b.type === 'text').map((b) => b.text).join('') : undefined),
  },
}

export function resolveSession({ provider = 'openai', baseUrl } = {}) {
  const spec = PROVIDERS[provider]
  if (!spec) throw new CliError(`unknown provider "${provider}"`, 'supported providers: openai, anthropic')
  let key = null
  let usedEnv = null
  for (const envName of spec.envKeys) {
    const v = process.env[envName]
    if (v && v.trim()) {
      key = v.trim()
      usedEnv = envName
      break
    }
  }
  if (!key) throw new CliError(`no API key found for provider "${provider}"`, `meldr is BYOK and session-only: set ${spec.envKeys.join(' or ')} in your environment — it is never written to disk`)
  return makeSession(provider, key, baseUrl || process.env.MELDR_AI_BASE_URL || spec.defaultBase)
}

function makeSession(provider, key, baseUrl) {
  return {
    provider,
    baseUrl: String(baseUrl).replace(/\/+$/, ''),
    keySource: 'memory-only',
    redact(text) {
      let out = String(text ?? '')
      if (key.length >= 8) out = out.split(key).join('[redacted]')
      return out.replace(/(sk|pk)[-_a-zA-Z0-9]{12,}/g, '[redacted]')
    },
    async chat({ system, user, model, fetchImpl = fetch }) {
      const spec = PROVIDERS[provider]
      const path = provider === 'anthropic' ? '/v1/messages' : '/chat/completions'
      let res
      try {
        res = await fetchImpl(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...spec.header(key) },
          body: JSON.stringify(spec.body(model, system, user)),
        })
      } catch (e) {
        throw new Error(this.redact(`request to ${provider} failed: ${e.message}`))
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(this.redact(`${provider} responded HTTP ${res.status}: ${text.slice(0, 300)}`))
      }
      const json = await res.json()
      const content = spec.extract(json)
      if (!content) throw new Error(this.redact(`unexpected response shape from ${provider}`))
      return content
    },
  }
}

export function assertNoKeyPersistence(session) {
  if (!session || typeof session.redact !== 'function') throw new Error('invalid session')
}
