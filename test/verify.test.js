import test from 'node:test'
import assert from 'node:assert/strict'
import { runVerify, summarize } from '../src/verify.js'
import { petstoreSpec, specFromYaml, startServer } from './helpers.js'
import http from 'node:http'

test('the contract-faithful mock passes its own conformance suite', async () => {
  const spec = await petstoreSpec()
  const { url, close } = await startServer(spec)
  try {
    const rows = await runVerify(spec, { base: url })
    const s = summarize(rows)
    assert.equal(s.total, 4)
    assert.equal(s.failed, 0)
    assert.equal(s.skipped, 0)
    for (const r of rows) assert.equal(r.pass, true, `${r.op} should pass: ${r.detail}`)
  } finally {
    await close()
  }
})

test('a broken server fails verification', async () => {
  const spec = await petstoreSpec()
  const server = http.createServer((req, res) => {
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end('{"error":"boom"}')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    const rows = await runVerify(spec, { base: `http://127.0.0.1:${port}` })
    const s = summarize(rows)
    assert.ok(s.failed >= 3)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

const THING_SPEC = `openapi: 3.0.3
info: {title: t, version: "1"}
servers: [{url: /}]
paths:
  /thing:
    get:
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema:
                type: object
                required: [id]
                properties:
                  id: {type: integer}
                  kind:
                    type: string
                    enum: [a, b]
`

test('response shape drift is detected precisely', async () => {
  const spec = specFromYaml(THING_SPEC)

  const cases = [
    ['{"id": 7, "kind": "a"}', true, ''],
    ['{"kind": "a"}', false, 'missing required property'],
    ['{"id": "7"}', false, 'expected integer'],
    ['{"id": 7, "kind": "z"}', false, 'not in enum'],
    ['not json at all', false, 'valid JSON'],
  ]

  for (const [payload, shouldPass, needle] of cases) {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(payload)
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const rows = await runVerify(spec, { base: `http://127.0.0.1:${server.address().port}` })
      assert.equal(rows.length, 1)
      if (shouldPass) {
        assert.equal(rows[0].pass, true, `"${payload}" should pass`)
      } else {
        assert.equal(rows[0].pass, false, `"${payload}" should fail`)
        assert.match(rows[0].detail, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      }
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  }
})

test('operations without a declared success response are skipped', async () => {
  const spec = specFromYaml(`openapi: 3.0.3
info: {title: t, version: "1"}
servers: [{url: /}]
paths:
  /gone:
    get:
      responses:
        "404": {description: always missing}
`)
  const server = http.createServer((req, res) => {
    res.writeHead(404)
    res.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const rows = await runVerify(spec, { base: `http://127.0.0.1:${server.address().port}` })
    assert.equal(rows[0].skipped !== null && typeof rows[0].skipped === 'string', true)
    assert.equal(summarize(rows).skipped, 1)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('unreachable servers produce failing rows, not crashes', async () => {
  const spec = await petstoreSpec()
  const rows = await runVerify(spec, { base: 'http://127.0.0.1:9', timeoutMs: 1500 })
  const s = summarize(rows)
  assert.equal(s.failed, 4)
})

test('your headers and pinned params reach the server', async () => {
  const spec = await petstoreSpec()
  const seen = []
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('[]')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    await runVerify(spec, {
      base: `http://127.0.0.1:${server.address().port}`,
      headers: { authorization: 'Bearer tok_123' },
      params: { default: { id: '11dFghVXANMlKmJXsNCbNl' } },
      concurrency: 1,
    })
    assert.ok(seen.length >= 4)
    for (const r of seen) assert.equal(r.auth, 'Bearer tok_123')
    assert.ok(
      seen.some((r) => r.url.includes('11dFghVXANMlKmJXsNCbNl')),
      `a pinned id should show up in a url, got ${seen.map((r) => r.url).join(' ')}`,
    )
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('a 429 is backed off, not reported as drift', async () => {
  const spec = await petstoreSpec()
  let hits = 0
  const server = http.createServer((req, res) => {
    hits++
    if (hits === 1) {
      res.writeHead(429, { 'retry-after': '0' })
      return res.end('slow down')
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('[]')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const rows = await runVerify(spec, { base: `http://127.0.0.1:${server.address().port}`, concurrency: 1 })
    assert.ok(hits > 4, 'the 429 should have been retried, not counted as an answer')
    assert.ok(rows.length === 4)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
