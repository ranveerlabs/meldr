import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from '../src/serve.js'
import { createStore } from '../src/state.js'
import { petstoreSpec, specFromYaml } from './helpers.js'

async function up(spec, opts) {
  const server = createServer(spec, opts)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  }
}

const json = { 'content-type': 'application/json' }

test('a write survives to a read', async () => {
  const spec = await petstoreSpec()
  const { url, close } = await up(spec, { state: createStore() })
  try {
    const made = await fetch(`${url}/v1/pets`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ id: 777, name: 'Ziggy', status: 'available' }),
    })
    assert.equal((await made.json()).name, 'Ziggy')

    const back = await (await fetch(`${url}/v1/pets/777`)).json()
    assert.equal(back.name, 'Ziggy', 'the canned example came back instead of what was written')

    const list = await (await fetch(`${url}/v1/pets`)).json()
    assert.ok(list.some((p) => String(p.id) === '777'))
  } finally {
    await close()
  }
})

test('delete removes it and the next read is a 404', async () => {
  const spec = await petstoreSpec()
  const { url, close } = await up(spec, { state: createStore() })
  try {
    await fetch(`${url}/v1/pets`, { method: 'POST', headers: json, body: JSON.stringify({ id: 5, name: 'Gone' }) })
    assert.equal((await fetch(`${url}/v1/pets/5`)).status, 200)
    assert.equal((await fetch(`${url}/v1/pets/5`, { method: 'DELETE' })).status, 204)
    assert.equal((await fetch(`${url}/v1/pets/5`)).status, 404)
  } finally {
    await close()
  }
})

test('the collection is seeded so a fresh client is not staring at nothing', async () => {
  const spec = await petstoreSpec()
  const { url, close } = await up(spec, { state: createStore() })
  try {
    const list = await (await fetch(`${url}/v1/pets`)).json()
    assert.ok(Array.isArray(list) && list.length > 0)
  } finally {
    await close()
  }
})

test('state is off unless you ask, the mock stays deterministic', async () => {
  const spec = await petstoreSpec()
  const { url, close } = await up(spec, {})
  try {
    await fetch(`${url}/v1/pets`, { method: 'POST', headers: json, body: JSON.stringify({ id: 777, name: 'Ziggy' }) })
    const back = await (await fetch(`${url}/v1/pets/777`)).json()
    assert.equal(back.name, 'Rex', 'without --stateful the contract example is still the answer')
  } finally {
    await close()
  }
})

test('X-Meldr-Status still wins over the store', async () => {
  const spec = await petstoreSpec()
  const { url, close } = await up(spec, { state: createStore() })
  try {
    const res = await fetch(`${url}/v1/pets/1`, { headers: { 'x-meldr-status': '404' } })
    assert.equal(res.status, 404)
  } finally {
    await close()
  }
})

const SECURED = `openapi: 3.0.3
info: {title: secured, version: "1"}
servers: [{url: /}]
components:
  securitySchemes:
    bearer: {type: http, scheme: bearer}
paths:
  /me:
    get:
      operationId: me
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: {type: object, properties: {id: {type: string}}}
`

test('require-auth 401s without a credential and lets any value through', async () => {
  const spec = specFromYaml(SECURED)
  const { url, close } = await up(spec, { requireAuth: true })
  try {
    assert.equal((await fetch(`${url}/me`)).status, 401)
    assert.equal((await fetch(`${url}/me`, { headers: { authorization: 'Bearer whatever' } })).status, 200)
  } finally {
    await close()
  }
})

test('an apiKey scheme is honoured in the header it names', async () => {
  const spec = specFromYaml(SECURED.replace('bearer: {type: http, scheme: bearer}', 'k: {type: apiKey, in: header, name: X-Api-Key}'))
  const { url, close } = await up(spec, { requireAuth: true })
  try {
    assert.equal((await fetch(`${url}/me`, { headers: { authorization: 'Bearer x' } })).status, 401)
    assert.equal((await fetch(`${url}/me`, { headers: { 'x-api-key': 'x' } })).status, 200)
  } finally {
    await close()
  }
})

test('auth is off unless you ask', async () => {
  const spec = specFromYaml(SECURED)
  const { url, close } = await up(spec, {})
  try {
    assert.equal((await fetch(`${url}/me`)).status, 200)
  } finally {
    await close()
  }
})

// POST /users/{id}/playlists then GET /playlists/{id} is the shape most real
// apis use, and keying the store on the whole path lost the write
const NESTED = `openapi: 3.0.3
info: {title: nested, version: "1"}
servers: [{url: /}]
paths:
  /me:
    get:
      operationId: me
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: {type: object, properties: {id: {type: string}}}
  /me/player/play:
    put:
      operationId: play
      responses:
        '204': {description: playing}
  /users/{user_id}/playlists:
    post:
      operationId: createPlaylist
      requestBody:
        required: true
        content:
          application/json:
            schema: {type: object, properties: {id: {type: string}, name: {type: string}}}
      responses:
        '201':
          description: made
          content:
            application/json:
              schema: {type: object, properties: {id: {type: string}, name: {type: string}}}
  /playlists:
    get:
      operationId: listPlaylists
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: array
                items: {type: object, properties: {id: {type: string}, name: {type: string}}}
  /playlists/{playlist_id}:
    get:
      operationId: getPlaylist
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: {type: object, properties: {id: {type: string}, name: {type: string}}}
`

test('a write under a parent path is readable at the top level', async () => {
  const spec = specFromYaml(NESTED)
  const { url, close } = await up(spec, { state: createStore() })
  try {
    const made = await fetch(`${url}/users/me/playlists`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ id: 'pl1', name: 'My Mix' }),
    })
    assert.equal(made.status, 201)
    const back = await (await fetch(`${url}/playlists/pl1`)).json()
    assert.equal(back.name, 'My Mix', 'the create went into a different bucket than the read')
  } finally {
    await close()
  }
})

test('a singleton stays an object and an rpc call invents nothing', async () => {
  const spec = specFromYaml(NESTED)
  const { url, close } = await up(spec, { state: createStore() })
  try {
    const me = await (await fetch(`${url}/me`)).json()
    assert.ok(!Array.isArray(me), '/me is not a collection just because it has no id')
    assert.equal((await fetch(`${url}/me/player/play`, { method: 'PUT' })).status, 204)
  } finally {
    await close()
  }
})

test('state comes back after a restart', async () => {
  const { serialize, hydrate } = await import('../src/state.js')
  const spec = await petstoreSpec()

  const first = createStore()
  const a = await up(spec, { state: first })
  try {
    await fetch(`${a.url}/v1/pets`, { method: 'POST', headers: json, body: JSON.stringify({ id: 777, name: 'Ziggy' }) })
    await fetch(`${a.url}/v1/pets/42`, { method: 'DELETE' })
  } finally {
    await a.close()
  }

  const onDisk = JSON.parse(JSON.stringify(serialize(first)))
  const b = await up(spec, { state: hydrate(onDisk) })
  try {
    assert.equal((await (await fetch(`${b.url}/v1/pets/777`)).json()).name, 'Ziggy')
    assert.equal((await fetch(`${b.url}/v1/pets/42`)).status, 404, 'a delete has to survive too')
  } finally {
    await b.close()
  }
})

test('hydrating does not let the contract seed over saved rows', async () => {
  const { hydrate } = await import('../src/state.js')
  const spec = await petstoreSpec()
  const { url, close } = await up(spec, { state: hydrate({ meldr: 1, next: 1000, rows: { pets: { 1: { id: 1, name: 'Only' } } } }) })
  try {
    const list = await (await fetch(`${url}/v1/pets`)).json()
    assert.equal(list.length, 1)
    assert.equal(list[0].name, 'Only')
  } finally {
    await close()
  }
})
