import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSpec, pickSuccess, lookupResponse, acceptsStatus, declaredStatusKeys } from '../src/spec.js'
import { petstoreSpec } from './helpers.js'

test('parses the petstore fixture', async () => {
  const spec = await petstoreSpec()
  assert.equal(spec.title, 'Meldr Petstore')
  assert.equal(spec.version, '1.0.0')
  assert.deepEqual(spec.servers, ['/v1'])
  assert.equal(spec.operations.length, 4)
  assert.deepEqual(
    spec.operations.map((o) => `${o.method.toUpperCase()} ${o.path}`).sort(),
    ['DELETE /pets/{id}', 'GET /pets', 'GET /pets/{id}', 'POST /pets'],
  )
})

test('resolves $ref into schemas and responses', async () => {
  const spec = await petstoreSpec()
  const show = spec.operations.find((o) => o.id === 'showPetById')
  const media = show.responses['200'].content['application/json']
  assert.equal(media.schema.type, 'object')
  assert.deepEqual(media.schema.required, ['id', 'name'])
  assert.ok(media.schema.properties.id)
  assert.equal(media.schema.properties.id.schema.type, 'integer')
  assert.equal(media.schema.properties.status.schema.enum[0], 'available')

  const create = spec.operations.find((o) => o.id === 'createPet')
  const badRequest = create.responses['400']
  assert.equal(badRequest.content['application/json'].schema.properties.code.schema.type, 'string')
  assert.equal(badRequest.description, 'Invalid input.')
})

test('merges path-level parameters with operation parameters', async () => {
  const spec = await petstoreSpec()
  const show = spec.operations.find((o) => o.id === 'showPetById')
  const idParam = show.params.find((p) => p.name === 'id')
  assert.equal(idParam.in, 'path')
  assert.equal(idParam.required, true)

  const list = spec.operations.find((o) => o.id === 'listPets')
  assert.equal(list.params.length, 1)
  assert.equal(list.params[0].required, false)
})

test('pickSuccess prefers 200 then lowest 2xx then ranges', async () => {
  const spec = await petstoreSpec()
  const show = spec.operations.find((o) => o.id === 'showPetById')
  assert.equal(pickSuccess(show).key, '200')
  const del = spec.operations.find((o) => o.id === 'deletePet')
  assert.equal(pickSuccess(del).key, '204')

  const op = { responses: { '201': { key: '201', content: {}, headers: {} }, default: { key: 'default', content: {}, headers: {} } } }
  assert.equal(pickSuccess(op).key, '201')
  assert.equal(pickSuccess({ responses: { '2XX': { key: '2XX', content: {}, headers: {} } } }).key, '2XX')
  assert.equal(pickSuccess({ responses: { default: { key: 'default', content: {}, headers: {} } } }).key, 'default')
  assert.equal(pickSuccess({ responses: {} }), null)
})

test('lookupResponse falls back through exact, range, default', async () => {
  const spec = await petstoreSpec()
  const show = spec.operations.find((o) => o.id === 'showPetById')
  assert.equal(lookupResponse(show, 200).key, '200')
  assert.equal(lookupResponse(show, 404).key, '404')
  assert.equal(lookupResponse(show, 500), null)
  assert.deepEqual(declaredStatusKeys(show), ['200', '404'])
})

test('acceptsStatus handles concrete, range and default expectations', () => {
  const mk = (responses) => ({ responses })
  const exact = mk({ '200': { key: '200' } })
  assert.ok(acceptsStatus(exact, 200))
  assert.ok(!acceptsStatus(exact, 204))
  const range = mk({ '2XX': { key: '2XX' } })
  assert.ok(acceptsStatus(range, 201))
  assert.ok(!acceptsStatus(range, 400))
  const def = mk({ default: { key: 'default' } })
  assert.ok(acceptsStatus(def, 202))
  assert.ok(!acceptsStatus(def, 500))
})

test('rejects non-3.x documents', () => {
  assert.throws(() => parseSpec('swagger: "2.0"\ninfo: {title: x, version: "1"}'), /OpenAPI 3/)
  assert.throws(() => parseSpec('info: {title: x}'), /unsupported OpenAPI version/)
  assert.throws(() => parseSpec('- just\n- a list'), /root must be a mapping/)
  assert.throws(() => parseSpec('openapi: 3.0.0\npaths: [unclosed'), /not valid YAML/)
})

test('warns about unresolved refs and rejects external ones', () => {
  const warnDoc = 'openapi: 3.0.0\ninfo: {title: t, version: "1"}\npaths:\n  /a:\n    get:\n      responses:\n        "200":\n          description: d\n          content:\n            application/json:\n              schema:\n                $ref: "#/components/schemas/Missing"\n'
  const spec = parseSpec(warnDoc)
  assert.equal(spec.warnings.length, 1)
  assert.match(spec.warnings[0], /unresolved \$ref/)

  const extDoc = 'openapi: 3.0.0\ninfo: {title: t, version: "1"}\ncomponents: {schemas: {A: {$ref: "other.yaml#/B"}}}\npaths: {}\n'
  assert.throws(() => parseSpec(extDoc), /external \$ref/)
})

test('normalizes server URLs', () => {
  const doc = (servers) => `openapi: 3.0.0\ninfo: {title: t, version: "1"}\nservers: ${servers}\npaths: {}\n`
  assert.deepEqual(parseSpec(doc('[{url: "https://api.example.com/v2"}]')).servers, ['/v2'])
  assert.deepEqual(parseSpec(doc('[{url: "/api/v1/"}]')).servers, ['/api/v1'])
  assert.deepEqual(parseSpec(doc('[{url: "https://x.example.com/{tenant}/api"}]')).servers, ['/'])
  assert.deepEqual(parseSpec(doc('[]')).servers, ['/'])
})

test('handles cyclic schemas without hanging', () => {
  const cyc = 'openapi: 3.0.0\ninfo: {title: t, version: "1"}\npaths: {}\ncomponents:\n  schemas:\n    Node:\n      type: object\n      properties:\n        child: {$ref: "#/components/schemas/Node"}\n'
  const spec = parseSpec(cyc)
  assert.equal(spec.warnings.length, 0)
})

test('a bad contract url is the users problem, not a meldr crash', async () => {
  const { fetchContract } = await import('../src/spec.js')
  await assert.rejects(() => fetchContract('https://raw.githubusercontent.com/ranveerlabs/meldr/main/nope-does-not-exist.yaml'), (e) => {
    assert.equal(e.name, 'CliError')
    assert.match(e.message, /HTTP 404/)
    return true
  })
})
