import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveSession } from '../src/session.js'
import { cmdDraft } from '../src/commands/draft.js'
import { main } from '../src/cli.js'
import { makeTmp } from './helpers.js'

test('session resolves keys from env only and never exposes them', async () => {
  process.env.OPENAI_API_KEY = 'sk-test-abcdef0123456789'
  const s = resolveSession({ provider: 'openai' })
  assert.equal(s.provider, 'openai')
  assert.equal(s.keySource, 'memory-only')
  assert.equal(s.baseUrl, 'https://api.openai.com/v1')
  for (const prop of ['key', 'apiKey']) {
    assert.ok(!(prop in s), `session must not expose ${prop}`)
  }
  delete process.env.OPENAI_API_KEY
})

test('session refuses to start without a key', () => {
  const saved = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY
  delete process.env.MELDR_OPENAI_KEY
  assert.throws(() => resolveSession({ provider: 'openai' }), /no API key found/)
  if (saved) process.env.OPENAI_API_KEY = saved
})

test('redaction scrubs key material from any string', () => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-supersecret99887766'
  const s = resolveSession({ provider: 'anthropic' })
  delete process.env.ANTHROPIC_API_KEY
  assert.ok(!s.redact('failed with key sk-ant-supersecret99887766').includes('supersecret'))
  assert.match(s.redact('token sk-live-abcd1234567890abcd'), /\[redacted\]/)
  assert.equal(s.redact('clean text'), 'clean text')
})

test('chat sends the key only to the configured base url', async () => {
  process.env.OPENAI_API_KEY = 'sk-test-abcdef0123456789'
  const s = resolveSession({ provider: 'openai' })
  delete process.env.OPENAI_API_KEY

  let calledUrl = null
  let authHeader = null
  const fakeFetch = async (url, opts) => {
    calledUrl = url
    authHeader = opts.headers.authorization
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"name":"X","operations":[]}' } }] }),
    }
  }
  const out = await s.chat({ system: 'sys', user: 'usr', fetchImpl: fakeFetch })
  assert.equal(out, '{"name":"X","operations":[]}')
  assert.ok(calledUrl.startsWith('https://api.openai.com/v1/'), `unexpected host: ${calledUrl}`)
  assert.match(authHeader, /^Bearer sk-test/)
})

test('draft converts model output into a valid contract file (no network)', async () => {
  const dir = await makeTmp()
  process.env.OPENAI_API_KEY = 'sk-test-abcdef0123456789'
  try {
    const fake = async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              name: 'Widgets API',
              description: 'demo',
              operations: [
                {
                  method: 'get',
                  path: '/widgets/{id}',
                  summary: 'Get widget',
                  pathParams: { id: 'integer' },
                  responses: [{ status: 200, body: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } }, required: ['id'] } }],
                },
                {
                  method: 'post',
                  path: '/widgets',
                  summary: 'Create widget',
                  request: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
                  responses: [{ status: 201, body: { type: 'object', properties: { id: { type: 'integer' } } } }],
                },
              ],
            }),
          },
        }],
      }),
    })

    const realFetch = globalThis.fetch
    globalThis.fetch = fake
    try {
      const code = await cmdDraft({ out: path.join(dir, 'contracts', 'api.yaml') }, [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'testdata', 'petstore.yaml')])
      assert.equal(code, 0)
    } finally {
      globalThis.fetch = realFetch
    }

    const written = await readFile(path.join(dir, 'contracts', 'api.yaml'), 'utf8')
    assert.match(written, /Widgets API/)
    assert.match(written, /\/widgets\/\{id\}/)
    assert.match(written, /x-meldr/)
  } finally {
    delete process.env.OPENAI_API_KEY
  }
})

test('draft without a key exits cleanly with guidance', async () => {
  const saved = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY
  try {
    assert.equal(await main(['draft', '-']), 1)
  } finally {
    if (saved) process.env.OPENAI_API_KEY = saved
  }
})

test('any provider name works as long as you give it a base url', async () => {
  const { resolveSession } = await import('../src/session.js')
  process.env.MELDR_OPENROUTER_KEY = 'sk-or-v1-abcdefghijklmnop'
  try {
    const s = resolveSession({ provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' })
    assert.equal(s.provider, 'openrouter')
    assert.equal(s.baseUrl, 'https://openrouter.ai/api/v1')
    assert.equal(s.redact('key is sk-or-v1-abcdefghijklmnop'), 'key is [redacted]')
    assert.throws(() => resolveSession({ provider: 'openrouter' }), /no base url/)
  } finally {
    delete process.env.MELDR_OPENROUTER_KEY
  }
})
