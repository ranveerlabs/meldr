import { buildRequest } from './verify.js'
import { lookupResponse, pickSuccess } from './spec.js'

// patches point at the raw doc, not the normalized spec, and resolve through $ref
// on the way down so a fix to Pet.tag lands in components/schemas/Pet once
const MAX_DEPTH = 10
const MAX_PER_OP = 40

export function isMap(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function jsonTypeOf(v) {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number'
  return typeof v
}

function leafOk(declared, v) {
  const obs = jsonTypeOf(v)
  if (declared === 'number') return obs === 'number' || obs === 'integer'
  return declared === obs
}

export function inferSchema(v, depth = 0) {
  const t = jsonTypeOf(v)
  if (depth > MAX_DEPTH) return {}
  if (t === 'null') return { type: 'string', nullable: true }
  if (t === 'array') return { type: 'array', items: v.length ? inferSchema(v[0], depth + 1) : {} }
  if (t === 'object') {
    const properties = {}
    for (const [k, val] of Object.entries(v)) properties[k] = inferSchema(val, depth + 1)
    const required = Object.keys(v).filter((k) => v[k] !== null && v[k] !== undefined)
    const out = { type: 'object', properties }
    if (required.length) out.required = required
    return out
  }
  return { type: t }
}

function pointerToPath(ref) {
  return ref
    .slice(2)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
}

export function getAt(doc, path) {
  let node = doc
  for (const k of path) {
    if (!isMap(node) && !Array.isArray(node)) return undefined
    node = node[k]
  }
  return node
}

// walks $refs until the cursor sits on a real node. bails on external refs
function follow(doc, cursor, hops = 0) {
  if (hops > 16 || !isMap(cursor.node)) return cursor
  const ref = typeof cursor.node.$ref === 'string' ? cursor.node.$ref : null
  if (!ref || !ref.startsWith('#/')) return cursor
  const path = pointerToPath(ref)
  const node = getAt(doc, path)
  if (node === undefined) return cursor
  return follow(doc, { node, path }, hops + 1)
}

function step(doc, cursor, ...keys) {
  let cur = follow(doc, cursor)
  for (const k of keys) {
    if (!isMap(cur.node) && !Array.isArray(cur.node)) return null
    if (cur.node[k] === undefined) return null
    cur = follow(doc, { node: cur.node[k], path: [...cur.path, k] })
  }
  return cur
}

function finding(kind, op, at, detail, safety, patch) {
  return { kind, op, at, detail, safety, patch: patch ?? null }
}

export async function probeDrift(spec, doc, opts = {}) {
  const base = String(opts.base ?? 'http://localhost:3000').replace(/\/+$/, '')
  const parsed = new URL(base)
  if (!/^https?:$/.test(parsed.protocol)) throw new Error(`--base must be http(s): ${base}`)
  const prefix = opts.prefix !== undefined ? opts.prefix : (spec.servers[0] ?? '/')
  const timeoutMs = opts.timeoutMs ?? 10000
  const findings = []
  const unreachable = []
  const covered = []

  for (const op of spec.operations) {
    const req = buildRequest(spec, op, base, prefix)
    let res
    try {
      res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body, signal: AbortSignal.timeout(timeoutMs) })
    } catch (e) {
      unreachable.push(`${req.label}: ${e.message}`)
      continue
    }
    const text = await res.text()
    let body
    try {
      body = text.trim() === '' ? undefined : JSON.parse(text)
    } catch {
      body = undefined
    }
    findings.push(...compareOperation(doc, op, req.label, res.status, body, covered))
  }
  return { findings: dedupe(findings), unreachable, covered, source: `live ${base}` }
}

function compareOperation(doc, op, label, status, body, covered = []) {
  const out = []
  const opCursor = step(doc, { node: doc, path: [] }, 'paths', op.path, op.method)
  if (!opCursor) return out

  const declared = lookupResponse(op, status)
  const exact = Object.prototype.hasOwnProperty.call(op.responses, String(status))

  // the success code itself moved. adding 202 next to 201 leaves verify red forever,
  // so the real fix is to move the response node over. destructive, so it waits for --all
  const success = pickSuccess(op)
  if (!exact && success && status >= 200 && status < 300 && /^2\d\d$/.test(success.key) && String(status) !== success.key) {
    const from = [...opCursor.path, 'responses', success.key]
    const node = getAt(doc, from)
    if (node !== undefined) {
      out.push(
        finding('status-moved', label, `responses.${success.key} -> ${status}`, `contract's success is ${success.key}, live answers ${status}`, 'review', {
          set: [...opCursor.path, 'responses', String(status)],
          value: node,
          unset: [from],
        }),
      )
      return out
    }
  }

  if (!declared) {
    const schema = body === undefined ? null : inferSchema(body)
    const value = { description: `Observed live on ${label}.` }
    if (schema) value.content = { 'application/json': { schema } }
    out.push(
      finding('status-undeclared', label, `responses.${status}`, `live returns ${status}, contract declares ${Object.keys(op.responses).join(', ') || 'nothing'}`, status < 400 ? 'safe' : 'review', {
        set: [...opCursor.path, 'responses', String(status)],
        value,
      }),
    )
    return out
  }

  if (!exact) {
    // a 500 that lands on a default response is the implementation falling over,
    // never something to write into the contract
    if (status >= 400) covered.push({ op: label, status })
    return out
  }
  if (body === undefined) return out

  const schemaCursor = step(doc, opCursor, 'responses', String(status), 'content', 'application/json', 'schema')
  if (!schemaCursor) return out

  const ctx = { out, count: 0, label, seen: new Set() }
  compareValue(doc, schemaCursor, body, '$', ctx, 0)
  return out
}

function compareValue(doc, cursor, val, at, ctx, depth) {
  if (depth > MAX_DEPTH || ctx.count >= MAX_PER_OP) return
  const node = cursor.node
  if (!isMap(node)) return
  // composed schemas get reported by verify but never auto-patched, too easy to wreck
  if (node.allOf || node.oneOf || node.anyOf || node.not) return
  if (val === null && node.nullable === true) return

  const t = typeof node.type === 'string' ? node.type : isMap(node.properties) ? 'object' : node.items !== undefined ? 'array' : null
  if (!t) return

  if (t === 'object') {
    if (jsonTypeOf(val) !== 'object') {
      push(ctx, finding('type-drift', ctx.label, at, `contract says object, live sends ${jsonTypeOf(val)}`, 'review', null))
      return
    }
    const req = Array.isArray(node.required) ? node.required : []
    for (const r of req) {
      if (!(r in val)) {
        push(
          ctx,
          finding('required-missing', ctx.label, `${at === '$' ? '' : at + '.'}${r}`, `contract requires "${r}", live never sends it`, 'review', {
            pull: [...cursor.path, 'required'],
            value: r,
          }),
        )
      }
    }
    const props = isMap(node.properties) ? node.properties : {}
    for (const [k, v] of Object.entries(val)) {
      const child = at === '$' ? k : `${at}.${k}`
      if (props[k] === undefined) {
        if (node.additionalProperties !== undefined) continue
        push(
          ctx,
          finding('prop-undeclared', ctx.label, child, `live sends "${k}" (${jsonTypeOf(v)}), contract does not declare it`, 'safe', {
            set: [...cursor.path, 'properties', k],
            value: inferSchema(v),
          }),
        )
        continue
      }
      const pc = step(doc, cursor, 'properties', k)
      if (pc) compareValue(doc, pc, v, child, ctx, depth + 1)
    }
    return
  }

  if (t === 'array') {
    if (!Array.isArray(val)) {
      push(ctx, finding('type-drift', ctx.label, at, `contract says array, live sends ${jsonTypeOf(val)}`, 'review', null))
      return
    }
    const ic = step(doc, cursor, 'items')
    if (!ic) return
    for (let i = 0; i < Math.min(val.length, 3); i++) compareValue(doc, ic, val[i], `${at}[${i}]`, ctx, depth + 1)
    return
  }

  if (!leafOk(t, val)) {
    const obs = jsonTypeOf(val)
    // format and example were written for the old type, they go stale the moment it moves
    const unset = []
    for (const k of ['format', 'example', 'enum']) {
      if (node[k] !== undefined) unset.push([...cursor.path, k])
    }
    push(
      ctx,
      finding('type-drift', ctx.label, at, `contract says ${t}, live sends ${obs}`, 'safe', {
        set: [...cursor.path, 'type'],
        value: obs,
        unset,
      }),
    )
  }
}

// shared $refs mean two operations can land on the same node, keep the first
function dedupe(findings) {
  const seen = new Set()
  const out = []
  for (const f of findings) {
    const key = f.patch ? `${f.kind}:${(f.patch.set ?? f.patch.pull).join('/')}` : `${f.kind}:${f.op}:${f.at}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(f)
  }
  return out
}

function push(ctx, f) {
  const key = f.patch ? `${f.kind}:${(f.patch.set ?? f.patch.pull).join('/')}` : `${f.kind}:${f.op}:${f.at}`
  if (ctx.seen.has(key)) return
  ctx.seen.add(key)
  ctx.out.push(f)
  ctx.count++
}

// values spliced in come from the dereferenced upstream so nothing points at
// components the local contract has never seen
export function upstreamDrift(spec, upstream) {
  const up = upstream.doc
  const findings = []
  const mine = new Map(spec.operations.map((o) => [`${o.method} ${o.path}`, o]))
  const theirs = new Map(upstream.operations.map((o) => [`${o.method} ${o.path}`, o]))

  for (const [key, op] of theirs) {
    const label = `${op.method.toUpperCase()} ${op.path}`
    if (!mine.has(key)) {
      const node = getAt(up, ['paths', op.path, op.method])
      findings.push(
        finding('op-added', label, op.path, 'upstream added this operation', 'safe', {
          set: ['paths', op.path, op.method],
          value: strip(node),
        }),
      )
      continue
    }
    const local = mine.get(key)
    for (const status of Object.keys(op.responses)) {
      if (local.responses[status]) continue
      findings.push(
        finding('resp-added', label, `responses.${status}`, `upstream declares ${status}, contract does not`, 'safe', {
          set: ['paths', op.path, op.method, 'responses', status],
          value: strip(getAt(up, ['paths', op.path, op.method, 'responses', status])),
        }),
      )
    }
    const a = signature(pickSuccess(local))
    const b = signature(pickSuccess(op))
    if (a && b && a !== b) {
      findings.push(
        finding('resp-changed', label, `responses.${pickSuccess(op).key}`, 'upstream changed the success response shape', 'review', {
          set: ['paths', op.path, op.method, 'responses', pickSuccess(op).key],
          value: strip(getAt(up, ['paths', op.path, op.method, 'responses', pickSuccess(op).key])),
        }),
      )
    }
  }

  for (const [key, op] of mine) {
    if (theirs.has(key)) continue
    const label = `${op.method.toUpperCase()} ${op.path}`
    if (op.deprecated) continue
    findings.push(
      finding('op-gone', label, op.path, 'upstream dropped this operation, marking deprecated instead of deleting', 'review', {
        set: ['paths', op.path, op.method, 'deprecated'],
        value: true,
      }),
    )
  }

  return { findings, unreachable: [], covered: [], source: `upstream ${upstream.title} v${upstream.version}` }
}

// structural fingerprint of a response, enough to notice a real shape change
function signature(resp) {
  if (!resp) return null
  const media = resp.content?.['application/json']
  if (!media) return `${resp.key}:empty`
  return `${resp.key}:${schemaSig(media.schema, 0)}`
}

function schemaSig(s, depth) {
  if (!s || depth > 8) return '?'
  if (s.type === 'object') {
    const keys = Object.keys(s.properties).sort()
    return `{${keys.map((k) => `${k}${s.required.includes(k) ? '!' : ''}:${schemaSig(s.properties[k].schema, depth + 1)}`).join(',')}}`
  }
  if (s.type === 'array') return `[${schemaSig(s.items, depth + 1)}]`
  return s.type + (s.format ? `/${s.format}` : '')
}

function strip(v, depth = 0) {
  if (depth > 64) return v
  if (Array.isArray(v)) return v.map((x) => strip(x, depth + 1))
  if (!isMap(v)) return v
  const out = {}
  for (const [k, val] of Object.entries(v)) {
    if (k === '__meldrCycle') continue
    out[k] = strip(val, depth + 1)
  }
  return out
}

export function applyFindings(doc, findings) {
  const applied = []
  const skipped = []
  for (const f of findings) {
    if (!f.patch) {
      skipped.push(f)
      continue
    }
    try {
      if (f.patch.set) setAt(doc, f.patch.set, f.patch.value)
      else if (f.patch.pull) pullAt(doc, f.patch.pull, f.patch.value)
      for (const u of f.patch.unset ?? []) {
        const parent = getAt(doc, u.slice(0, -1))
        if (isMap(parent)) delete parent[u[u.length - 1]]
      }
      applied.push(f)
    } catch {
      skipped.push(f)
    }
  }
  return { applied, skipped }
}

function setAt(doc, path, value) {
  let node = doc
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i]
    if (!isMap(node[k]) && !Array.isArray(node[k])) node[k] = {}
    node = node[k]
  }
  node[path[path.length - 1]] = value
}

function pullAt(doc, path, value) {
  const arr = getAt(doc, path)
  if (!Array.isArray(arr)) throw new Error('not an array')
  const i = arr.indexOf(value)
  if (i !== -1) arr.splice(i, 1)
  if (!arr.length) {
    const parent = getAt(doc, path.slice(0, -1))
    if (isMap(parent)) delete parent[path[path.length - 1]]
  }
}

export function summarizeDrift(findings) {
  return {
    total: findings.length,
    safe: findings.filter((f) => f.safety === 'safe' && f.patch).length,
    review: findings.filter((f) => f.safety === 'review' && f.patch).length,
    manual: findings.filter((f) => !f.patch).length,
  }
}
