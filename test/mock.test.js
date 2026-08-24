import test from 'node:test'
import assert from 'node:assert/strict'
import { value, paramValue, selectMedia, requestBodyValue } from '../src/mock.js'

const S = (over = {}) => ({ type: 'string', format: '', nullable: false, enum: null, const: undefined, default: undefined, example: undefined, examples: null, properties: {}, required: [], items: null, minItems: -1, maxItems: -1, minimum: null, maximum: null, ...over })

test('synthesis is deterministic', () => {
  const a = value(S({ type: 'object', properties: { id: { ...S(), type: 'integer' }, name: S() } }), '')
  const b = value(S({ type: 'object', properties: { id: { ...S(), type: 'integer' }, name: S() } }), '')
  assert.deepEqual(a, b)
})

test('example beats everything else', () => {
  const s = S({ example: 'chosen', enum: ['x'], default: 'd' })
  assert.equal(value(s, 'field'), 'chosen')
})

test('examples list then default then enum are honored in order', () => {
  assert.equal(value(S({ examples: ['first'], default: 'd' }), ''), 'first')
  assert.equal(value(S({ default: 'd', enum: ['e'] }), ''), 'd')
  assert.equal(value(S({ enum: ['e'] }), ''), 'e')
})

test('formats produce canonical values', () => {
  assert.equal(value(S({ format: 'uuid' }), ''), '123e4567-e89b-12d3-a456-426614174000')
  assert.equal(value(S({ format: 'email' }), ''), 'user@example.com')
  assert.equal(value(S({ format: 'date-time' }), ''), '2024-01-15T10:30:00Z')
})

test('property names influence string values', () => {
  assert.equal(value(S(), 'city'), 'San Francisco')
  assert.equal(value(S(), 'unknown_field'), 'meldr')
})

test('numbers respect minimum and maximum', () => {
  assert.equal(value(S({ type: 'integer', minimum: 5 }), 'n'), 5)
  assert.equal(value(S({ type: 'integer', minimum: 9, maximum: 4 }), 'n'), 4)
  assert.equal(value(S({ type: 'number' }), 'n'), 1.25)
  assert.equal(value(S({ type: 'integer' }), 'n'), 1)
})

test('arrays honor minItems and maxItems bounds', () => {
  const items = S({ type: 'integer' })
  assert.equal(value(S({ type: 'array', items }), '').length, 2)
  assert.equal(value(S({ type: 'array', items, maxItems: 1 }), '').length, 1)
  assert.equal(value(S({ type: 'array', items, minItems: 3, maxItems: 3 }), '').length, 3)
  assert.equal(value(S({ type: 'array', items, maxItems: 0 }), '').length, 0)
  assert.deepEqual(value(S({ type: 'array' }), ''), [])
})

test('objects include properties; readOnly skipped for requests', () => {
  const obj = S({
    type: 'object',
    properties: {
      id: { name: 'id', schema: { ...S(), type: 'integer' }, readOnly: true, writeOnly: false },
      secret: { name: 'secret', schema: S({ default: 'hush' }), readOnly: false, writeOnly: true },
      name: { name: 'name', schema: S(), readOnly: false, writeOnly: false },
    },
    required: [],
  })
  const out = value(obj, '', 'out')
  assert.deepEqual(Object.keys(out).sort(), ['id', 'name'])
  const req = value(obj, '', 'request')
  assert.deepEqual(Object.keys(req).sort(), ['name', 'secret'])
})

test('deeply recursive schemas terminate with leaf fallback', () => {
  let node = S({ type: 'integer' })
  for (let i = 0; i < 10; i++) node = S({ type: 'object', properties: { child: { name: 'child', schema: node, readOnly: false, writeOnly: false } }, required: [] })
  const v = value(node, '')
  assert.ok(typeof v === 'object')
})

test('paramValue coerces to url-safe strings', () => {
  assert.equal(paramValue({ name: 'id', schema: { ...S(), type: 'integer' } }), '1')
  assert.equal(paramValue({ name: 'widget', schema: S() }), 'meldr')
})

test('request bodies prefer json media types', () => {
  const body = {
    required: true,
    content: {
      'text/plain': { mediaType: 'text/plain', schema: S(), example: undefined, examples: null },
      'application/json': { mediaType: 'application/json', schema: S({ type: 'integer' }), example: undefined, examples: null },
    },
  }
  const built = requestBodyValue(body)
  assert.equal(built.mediaType, 'application/json')
  assert.equal(JSON.parse(built.text), 1)
})

test('selectMedia negotiates by accept header', () => {
  const content = {
    'text/plain': { mediaType: 'text/plain' },
    'application/json': { mediaType: 'application/json' },
  }
  assert.equal(selectMedia(content, 'text/plain').mediaType, 'text/plain')
  assert.equal(selectMedia(content, '*/*').mediaType, 'application/json')
  assert.equal(selectMedia(content, 'application/*').mediaType, 'application/json')
  assert.equal(selectMedia(content, '').mediaType, 'application/json')
  assert.equal(selectMedia({}, ''), null)
})
