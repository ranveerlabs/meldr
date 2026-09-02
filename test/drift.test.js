import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import yaml from 'js-yaml'
import { parseSpec } from '../src/spec.js'
import { probeDrift, upstreamDrift, applyFindings, inferSchema, getAt, summarizeDrift } from '../src/drift.js'
import { runVerify, summarize } from '../src/verify.js'

async function petstore() {
  const raw = await readFile(path.resolve('testdata', 'petstore.yaml'), 'utf8')
  return { raw, spec: parseSpec(raw), doc: yaml.load(raw) }
}

async function serve(handler) {
  const server = http.createServer(handler)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  }
}

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

// a petstore that has moved on: ids went to strings, a field appeared, create is async now
function driftedPetstore() {
  const pet = (id) => ({ id: String(id), name: 'Rex', tag: 'friendly', status: 'available', createdAt: '2026-01-02T00:00:00Z' })
  return (req, res) => {
    const u = new URL(req.url, 'http://x')
    if (u.pathname === '/v1/pets' && req.method === 'GET') return json(res, 200, [pet(1), pet(2)])
    if (u.pathname === '/v1/pets' && req.method === 'POST') return json(res, 202, { id: '9', name: 'New', status: 'available' })
    if (/^\/v1\/pets\/\d+$/.test(u.pathname) && req.method === 'GET') return json(res, 200, pet(1))
    if (/^\/v1\/pets\/\d+$/.test(u.pathname) && req.method === 'DELETE') {
      res.writeHead(204)
      return res.end()
    }
    json(res, 404, { code: 'nope', message: 'nope' })
  }
}

test('a contract that already matches drifts by nothing', async () => {
  const { spec, doc } = await petstore()
  const { createServer } = await import('../src/serve.js')
  const server = createServer(spec)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    const report = await probeDrift(spec, doc, { base: `http://127.0.0.1:${server.address().port}` })
    assert.deepEqual(report.unreachable, [])
    assert.deepEqual(report.findings, [])
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('type drift is patched through the $ref, in components, once', async () => {
  const { spec, doc } = await petstore()
  const { url, close } = await serve(driftedPetstore())
  try {
    const report = await probeDrift(spec, doc, { base: url })
    const typed = report.findings.filter((f) => f.kind === 'type-drift')
    // Pet.id is shared by three operations, one finding is enough
    assert.equal(typed.length, 1)
    assert.deepEqual(typed[0].patch.set, ['components', 'schemas', 'Pet', 'properties', 'id', 'type'])
    assert.equal(typed[0].patch.value, 'string')

    applyFindings(doc, typed)
    assert.equal(getAt(doc, ['components', 'schemas', 'Pet', 'properties', 'id', 'type']), 'string')
    // format: int64 was written for the integer, it does not survive the move
    assert.equal(getAt(doc, ['components', 'schemas', 'Pet', 'properties', 'id', 'format']), undefined)
  } finally {
    await close()
  }
})

test('a field the live api added shows up in the contract', async () => {
  const { spec, doc } = await petstore()
  const { url, close } = await serve(driftedPetstore())
  try {
    const report = await probeDrift(spec, doc, { base: url })
    const added = report.findings.find((f) => f.kind === 'prop-undeclared')
    assert.ok(added, 'createdAt should be noticed')
    assert.match(added.at, /createdAt$/)
    assert.equal(added.safety, 'safe')
    applyFindings(doc, [added])
    assert.deepEqual(getAt(doc, ['components', 'schemas', 'Pet', 'properties', 'createdAt']), { type: 'string' })
  } finally {
    await close()
  }
})

test('a moved success status is held back until you ask for it', async () => {
  const { spec, doc } = await petstore()
  const { url, close } = await serve(driftedPetstore())
  try {
    const report = await probeDrift(spec, doc, { base: url })
    const moved = report.findings.find((f) => f.kind === 'status-moved')
    assert.ok(moved)
    assert.equal(moved.safety, 'review')
    const s = summarizeDrift(report.findings)
    assert.equal(s.review, 1)

    const safeOnly = report.findings.filter((f) => f.safety === 'safe')
    applyFindings(doc, safeOnly)
    assert.ok(getAt(doc, ['paths', '/pets', 'post', 'responses', '201']), '201 survives a safe pass')

    applyFindings(doc, [moved])
    assert.equal(getAt(doc, ['paths', '/pets', 'post', 'responses', '201']), undefined)
    assert.ok(getAt(doc, ['paths', '/pets', 'post', 'responses', '202']))
  } finally {
    await close()
  }
})

test('healing a drifted contract makes verify green', async () => {
  const { spec, doc } = await petstore()
  const { url, close } = await serve(driftedPetstore())
  try {
    const report = await probeDrift(spec, doc, { base: url })
    applyFindings(doc, report.findings.filter((f) => f.patch))
    const healed = parseSpec(yaml.dump(doc, { noRefs: true }))
    const rows = await runVerify(healed, { base: url })
    const s = summarize(rows)
    assert.equal(s.failed, 0, rows.filter((r) => !r.pass && !r.skipped).map((r) => `${r.op}: ${r.detail}`).join(' | '))
  } finally {
    await close()
  }
})

test('an undeclared status is recorded with the shape it actually returned', async () => {
  const raw = `openapi: 3.0.3
info: {title: t, version: "1"}
servers: [{url: /}]
paths:
  /thing:
    get:
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: {type: object, properties: {a: {type: string}}}
`
  const spec = parseSpec(raw)
  const doc = yaml.load(raw)
  const { url, close } = await serve((req, res) => json(res, 418, { reason: 'teapot', retryIn: 5 }))
  try {
    const report = await probeDrift(spec, doc, { base: url })
    const f = report.findings.find((x) => x.kind === 'status-undeclared')
    assert.ok(f)
    assert.equal(f.safety, 'review') // 4xx is never a safe auto-add
    applyFindings(doc, [f])
    const added = getAt(doc, ['paths', '/thing', 'get', 'responses', '418'])
    assert.deepEqual(added.content['application/json'].schema, {
      type: 'object',
      properties: { reason: { type: 'string' }, retryIn: { type: 'integer' } },
      required: ['reason', 'retryIn'],
    })
  } finally {
    await close()
  }
})

test('a required field the api stopped sending is reported, not silently dropped', async () => {
  const raw = `openapi: 3.0.3
info: {title: t, version: "1"}
servers: [{url: /}]
paths:
  /thing:
    get:
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: object
                required: [a, b]
                properties: {a: {type: string}, b: {type: string}}
`
  const spec = parseSpec(raw)
  const doc = yaml.load(raw)
  const { url, close } = await serve((req, res) => json(res, 200, { a: 'still here' }))
  try {
    const report = await probeDrift(spec, doc, { base: url })
    const f = report.findings.find((x) => x.kind === 'required-missing')
    assert.ok(f)
    assert.equal(f.safety, 'review')
    applyFindings(doc, [f])
    assert.deepEqual(getAt(doc, ['paths', '/thing', 'get', 'responses', '200', 'content', 'application/json', 'schema', 'required']), ['a'])
  } finally {
    await close()
  }
})

test('composed schemas are left alone', async () => {
  const raw = `openapi: 3.0.3
info: {title: t, version: "1"}
servers: [{url: /}]
paths:
  /thing:
    get:
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                oneOf:
                  - {type: object, properties: {a: {type: string}}}
                  - {type: object, properties: {b: {type: integer}}}
`
  const spec = parseSpec(raw)
  const doc = yaml.load(raw)
  const { url, close } = await serve((req, res) => json(res, 200, { z: true }))
  try {
    const report = await probeDrift(spec, doc, { base: url })
    assert.deepEqual(report.findings, [])
  } finally {
    await close()
  }
})

test('a dead implementation is unreachable, not drift', async () => {
  const { spec, doc } = await petstore()
  const report = await probeDrift(spec, doc, { base: 'http://127.0.0.1:1', timeoutMs: 500 })
  assert.equal(report.findings.length, 0)
  assert.equal(report.unreachable.length, spec.operations.length)
})

test('upstream additions splice in, upstream removals only get deprecated', async () => {
  const { spec, doc } = await petstore()
  const up = parseSpec(`openapi: 3.0.3
info: {title: Meldr Petstore, version: "2.0.0"}
servers: [{url: /v1}]
paths:
  /pets:
    get:
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: {type: array, items: {type: object, properties: {id: {type: integer}, name: {type: string}}}}
  /owners:
    get:
      operationId: listOwners
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: {type: array, items: {type: object, properties: {id: {type: integer}}}}
`)
  const report = upstreamDrift(spec, up)
  const added = report.findings.find((f) => f.kind === 'op-added')
  assert.ok(added)
  assert.equal(added.safety, 'safe')

  const gone = report.findings.filter((f) => f.kind === 'op-gone')
  assert.ok(gone.length >= 3, 'upstream dropped the /pets/{id} operations and POST /pets')
  for (const g of gone) assert.equal(g.safety, 'review')

  applyFindings(doc, report.findings.filter((f) => f.patch))
  assert.ok(getAt(doc, ['paths', '/owners', 'get']), '/owners was spliced in')
  assert.equal(getAt(doc, ['paths', '/pets/{id}', 'get', 'deprecated']), true)
  assert.ok(getAt(doc, ['paths', '/pets/{id}', 'get', 'responses']), 'nothing was deleted, only flagged')
})

test('inferSchema reads the json it was given', () => {
  assert.deepEqual(inferSchema(1), { type: 'integer' })
  assert.deepEqual(inferSchema(1.5), { type: 'number' })
  assert.deepEqual(inferSchema(null), { type: 'string', nullable: true })
  assert.deepEqual(inferSchema([]), { type: 'array', items: {} })
  assert.deepEqual(inferSchema({ a: null }), { type: 'object', properties: { a: { type: 'string', nullable: true } } })
})

test('a server erroring under a default response is not drift, but it is not silence either', async () => {
  const raw = `openapi: 3.0.3
info: {title: t, version: "1"}
servers: [{url: /}]
paths:
  /thing:
    get:
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: {type: object, properties: {a: {type: string}}}
        default:
          description: boom
          content:
            application/json:
              schema: {type: object, properties: {code: {type: string}}}
`
  const spec = parseSpec(raw)
  const doc = yaml.load(raw)
  const { url, close } = await serve((req, res) => json(res, 500, { code: 'boom' }))
  try {
    const report = await probeDrift(spec, doc, { base: url })
    // never bless a 500 into the contract
    assert.deepEqual(report.findings, [])
    // but do not claim the contract matches either
    assert.equal(report.covered.length, 1)
    assert.equal(report.covered[0].status, 500)
  } finally {
    await close()
  }
})

// two apply paths, one for the plain doc the findings were computed against and
// one for the yaml Document that keeps comments. they have to agree
test('patching yaml and patching the plain object land in the same place', async () => {
  const { applyToYaml } = await import('../src/drift.js')
  const YAML = (await import('yaml')).default
  const raw = await readFile(path.resolve('testdata', 'petstore.yaml'), 'utf8')
  const spec = parseSpec(raw)
  const plain = yaml.load(raw)
  const ydoc = YAML.parseDocument(raw)

  const { url, close } = await serve(driftedPetstore())
  try {
    const report = await probeDrift(spec, yaml.load(raw), { base: url })
    const patchable = report.findings.filter((f) => f.patch)
    assert.ok(patchable.length >= 3)
    applyFindings(plain, patchable)
    applyToYaml(ydoc, patchable)
    assert.deepEqual(ydoc.toJSON(), plain)
  } finally {
    await close()
  }
})

test('healing keeps the comments you wrote', async () => {
  const { applyToYaml } = await import('../src/drift.js')
  const YAML = (await import('yaml')).default
  const raw = `# the whole contract matters
openapi: 3.0.3
info: {title: t, version: "1"}
servers: [{url: /}]
paths:
  /thing:
    get:
      responses:
        '200':
          description: ok
          content:
            application/json:
              # this schema is load bearing
              schema: {type: object, properties: {a: {type: integer}}}
`
  const spec = parseSpec(raw)
  const doc = yaml.load(raw)
  const ydoc = YAML.parseDocument(raw)
  const { url, close } = await serve((req, res) => json(res, 200, { a: 'now a string' }))
  try {
    const report = await probeDrift(spec, doc, { base: url })
    applyToYaml(ydoc, report.findings.filter((f) => f.patch))
    const out = ydoc.toString({ flowCollectionPadding: false })
    assert.match(out, /# the whole contract matters/)
    assert.match(out, /# this schema is load bearing/)
    assert.match(out, /type: string/)
  } finally {
    await close()
  }
})
