import test from 'node:test'
import assert from 'node:assert/strict'
import { petstoreSpec, specFromYaml, startServer } from './helpers.js'

test('serves example-faithful responses on templated paths', async () => {
  const spec = await petstoreSpec()
  const { url, close } = await startServer(spec)
  try {
    const res = await fetch(`${url}/v1/pets/8`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /application\/json/)
    const body = await res.json()
    assert.deepEqual(body, { id: 42, name: 'Rex', tag: 'friendly', status: 'available' })
  } finally {
    await close()
  }
})

test('synthesizes arrays and honors declared status codes', async () => {
  const spec = await petstoreSpec()
  const { url, close } = await startServer(spec)
  try {
    const res = await fetch(`${url}/v1/pets`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.ok(Array.isArray(body))
    assert.ok(body.length >= 1)
    for (const pet of body) {
      assert.ok(Number.isInteger(pet.id))
      assert.equal(typeof pet.name, 'string')
    }
  } finally {
    await close()
  }
})

test('X-Meldr-Status forces declared responses', async () => {
  const spec = await petstoreSpec()
  const { url, close } = await startServer(spec)
  try {
    const res = await fetch(`${url}/v1/pets/8`, { headers: { 'x-meldr-status': '404' } })
    assert.equal(res.status, 404)
    const body = await res.json()
    assert.equal(body.code, 'not_found')
  } finally {
    await close()
  }
})

test('X-Meldr-Status with undeclared code is rejected', async () => {
  const spec = await petstoreSpec()
  const { url, close } = await startServer(spec)
  try {
    const res = await fetch(`${url}/v1/pets/8`, { headers: { 'x-meldr-status': '418' } })
    assert.equal(res.status, 400)
    const body = await res.json()
    assert.equal(body.error, 'unknown_status')
    assert.deepEqual(body.declared, ['200', '404'])
  } finally {
    await close()
  }
})

test('required request bodies are enforced', async () => {
  const spec = await petstoreSpec()
  const { url, close } = await startServer(spec)
  try {
    const missing = await fetch(`${url}/v1/pets`, { method: 'POST' })
    assert.equal(missing.status, 400)
    const missBody = await missing.json()
    assert.equal(missBody.error, 'validation_failed')

    const bad = await fetch(`${url}/v1/pets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' })
    assert.equal(bad.status, 400)

    const ok = await fetch(`${url}/v1/pets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal(ok.status, 201)
    const created = await ok.json()
    assert.equal(created.name, 'Rex')
  } finally {
    await close()
  }
})

test('204 responses carry no body; unknown routes 404; wrong verbs 405', async () => {
  const spec = await petstoreSpec()
  const { url, close } = await startServer(spec)
  try {
    const del = await fetch(`${url}/v1/pets/3`, { method: 'DELETE' })
    assert.equal(del.status, 204)
    assert.equal(await del.text(), '')

    const missing = await fetch(`${url}/v1/nope`)
    assert.equal(missing.status, 404)

    const wrong = await fetch(`${url}/v1/pets/3`, { method: 'PATCH' })
    assert.equal(wrong.status, 405)
    assert.match(wrong.headers.get('allow') ?? '', /GET/)
    assert.match(wrong.headers.get('allow') ?? '', /DELETE/)
  } finally {
    await close()
  }
})

test('required query and header params are enforced', async () => {
  const spec = specFromYaml(`openapi: 3.0.3
info: {title: t, version: "1"}
servers: [{url: /}]
paths:
  /things:
    get:
      parameters:
        - {name: key, in: query, required: true, schema: {type: string}}
        - {name: token, in: header, required: true, schema: {type: string}}
      responses:
        "200": {description: ok}
`)
  const { url, close } = await startServer(spec)
  try {
    const none = await fetch(`${url}/things`)
    assert.equal(none.status, 400)
    const partial = await fetch(`${url}/things?key=k`, { headers: { token: 't' } })
    assert.equal(partial.status, 200)
    assert.equal(pickStatus(partial), 200)
  } finally {
    await close()
  }
})

test('introspection endpoints work', async () => {
  const spec = await petstoreSpec()
  const { url, close } = await startServer(spec)
  try {
    const health = await fetch(`${url}/__meldr/health`)
    assert.equal(health.status, 200)
    assert.equal((await health.json()).status, 'ok')

    const routes = await (await fetch(`${url}/__meldr/routes`)).json()
    assert.equal(routes.routes.length, 4)

    const contract = await fetch(`${url}/__meldr/contract`)
    assert.match(contract.headers.get('content-type') ?? '', /json/)
    const doc = await contract.json()
    assert.equal(doc.info.title, 'Meldr Petstore')
  } finally {
    await close()
  }
})

test('optional CORS mode answers preflights', async () => {
  const spec = await petstoreSpec()
  const { url, close } = await startServer(spec, { cors: true })
  try {
    const pre = await fetch(`${url}/v1/pets`, { method: 'OPTIONS' })
    assert.equal(pre.status, 204)
    assert.equal(pre.headers.get('access-control-allow-origin'), '*')
  } finally {
    await close()
  }
})

function pickStatus(res) {
  return res.status
}
