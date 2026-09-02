import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { runRecord, replayIndex, summarizeRecording, FORMAT } from '../src/record.js'
import { createServer } from '../src/serve.js'
import { petstoreSpec, startServer } from './helpers.js'

async function serve(handler) {
  const server = http.createServer(handler)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  }
}

function upstream() {
  const pet = (id) => ({ id: String(id), name: 'Ziggy', tag: 'loud', createdAt: '2026-01-02T00:00:00Z' })
  return (req, res) => {
    const u = new URL(req.url, 'http://x')
    const send = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (u.pathname === '/v1/pets' && req.method === 'GET') return send(200, [pet(7), pet(8)])
    if (u.pathname === '/v1/pets' && req.method === 'POST') return send(201, pet(9))
    if (/^\/v1\/pets\/\d+$/.test(u.pathname) && req.method === 'GET') return send(200, pet(7))
    res.writeHead(204)
    res.end()
  }
}

test('what the real api said is what gets served back', async () => {
  const spec = await petstoreSpec()
  const live = await serve(upstream())
  let rec
  try {
    rec = await runRecord(spec, { base: live.url })
  } finally {
    await live.close()
  }
  assert.equal(rec.meldr, FORMAT)
  const s = summarizeRecording(rec)
  assert.equal(s.dead, 0)
  assert.equal(s.ok, 4)

  // the upstream is gone now, everything below comes off the tape
  const replay = replayIndex(rec)
  const server = createServer(spec, { replay })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const one = await (await fetch(`${base}/v1/pets/1`)).json()
    assert.equal(one.name, 'Ziggy')
    assert.equal(one.id, '7', 'the recorded string id, not the contract integer')
    assert.equal(one.createdAt, '2026-01-02T00:00:00Z', 'a field the contract never declared')

    const list = await (await fetch(`${base}/v1/pets`)).json()
    assert.equal(list.length, 2)
    assert.equal(list[1].id, '8')
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('a recorded operation still yields to X-Meldr-Status', async () => {
  const spec = await petstoreSpec()
  const live = await serve(upstream())
  let rec
  try {
    rec = await runRecord(spec, { base: live.url })
  } finally {
    await live.close()
  }
  const server = createServer(spec, { replay: replayIndex(rec) })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const forced = await fetch(`${base}/v1/pets/1`, { headers: { 'x-meldr-status': '404' } })
    assert.equal(forced.status, 404)
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('credentials in a response body do not reach the file', async () => {
  const spec = await petstoreSpec()
  const live = await serve((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ access_token: 'super-secret', nested: { refresh_token: 'also-secret', name: 'fine' } }))
  })
  let rec
  try {
    rec = await runRecord(spec, { base: live.url })
  } finally {
    await live.close()
  }
  const text = JSON.stringify(rec)
  assert.ok(!text.includes('super-secret'), 'access_token leaked')
  assert.ok(!text.includes('also-secret'), 'nested refresh_token leaked')
  assert.ok(text.includes('fine'), 'ordinary fields should survive')
  assert.ok(rec.scrubbed >= 2)
})

test('an unreachable upstream is recorded as dead, not as an empty answer', async () => {
  const spec = await petstoreSpec()
  const rec = await runRecord(spec, { base: 'http://127.0.0.1:1', timeoutMs: 500 })
  const s = summarizeRecording(rec)
  assert.equal(s.ok, 0)
  assert.equal(s.dead, spec.operations.length)
  assert.equal(replayIndex(rec).size, 0, 'a dead operation must not be replayed')
})

test('replay refuses a file that is not a recording', () => {
  assert.throws(() => replayIndex({ hello: 'world' }), /not a meldr recording/)
  assert.throws(() => replayIndex({ meldr: 999, entries: [] }), /not a meldr recording/)
})

test('serve without a recording is unchanged', async () => {
  const spec = await petstoreSpec()
  const { url, close } = await startServer(spec)
  try {
    const pet = await (await fetch(`${url}/v1/pets/1`)).json()
    assert.equal(pet.name, 'Rex')
  } finally {
    await close()
  }
})

test('a case per id records each one and replays the right one back', async () => {
  const spec = await petstoreSpec()
  const db = { 7: 'Ziggy', 8: 'Bowie', 9: 'Nina' }
  const live = await serve((req, res) => {
    const m = new URL(req.url, 'http://x').pathname.match(/\/v1\/pets\/(\d+)$/)
    res.writeHead(200, { 'content-type': 'application/json' })
    if (m) return res.end(JSON.stringify({ id: Number(m[1]), name: db[m[1]] ?? 'unknown' }))
    res.end(JSON.stringify(Object.entries(db).map(([id, name]) => ({ id: Number(id), name }))))
  })
  let rec
  try {
    rec = await runRecord(spec, { base: live.url, cases: { showPetById: [{ id: 7 }, { id: 8 }, { id: 9 }] } })
  } finally {
    await live.close()
  }
  const byPath = rec.entries.filter((e) => e.path === '/pets/{id}' && e.method === 'get')
  assert.equal(byPath.length, 3)

  const server = createServer(spec, { replay: replayIndex(rec) })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    assert.equal((await (await fetch(`${base}/v1/pets/7`)).json()).name, 'Ziggy')
    assert.equal((await (await fetch(`${base}/v1/pets/8`)).json()).name, 'Bowie')
    assert.equal((await (await fetch(`${base}/v1/pets/9`)).json()).name, 'Nina')
    // nothing was taped for 99, it falls back rather than 404ing
    assert.equal((await fetch(`${base}/v1/pets/99`)).status, 200)
  } finally {
    await new Promise((r) => server.close(r))
  }
})
