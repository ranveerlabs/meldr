import { pickSuccess } from './spec.js'
import { pinned } from './config.js'
import { paramValue, requestBodyValue, preferJson } from './mock.js'
import { c, pad } from './ui.js'

export function joinPath(a, b) {
  if (!a || a === '/') return b
  return a.replace(/\/+$/, '') + b
}

// verify and drift both come through here so a probe and a check hit the same url
export function buildRequest(spec, op, base, prefix, opts = {}) {
  const over = opts.params ?? { default: {} }
  const val = (p) => pinned(over, op, p.name) ?? paramValue(p)

  let full = joinPath(prefix, op.path).replace(/\{([^}]+)\}/g, (_, name) => {
    const p = op.params.find((x) => x.in === 'path' && x.name === name)
    if (p) return encodeURIComponent(val(p))
    const fixed = pinned(over, op, name)
    return fixed === undefined ? `{${name}}` : encodeURIComponent(fixed)
  })
  const qs = new URLSearchParams()
  for (const p of op.params) {
    if (p.in === 'query' && (p.required || pinned(over, op, p.name) !== undefined)) qs.set(p.name, val(p))
  }
  const q = qs.toString()
  if (q) full += `?${q}`

  const headers = {
    accept: 'application/json',
    'user-agent': `meldr-verify/${spec.version}`,
  }
  for (const p of op.params) {
    if (p.in === 'header' && p.required) headers[p.name.toLowerCase()] = val(p)
  }
  // yours win, a contract should never be able to overwrite your auth
  for (const [k, v] of Object.entries(opts.headers ?? {})) headers[k] = v

  let body
  if (op.body) {
    const built = requestBodyValue(op.body)
    if (built) {
      headers['content-type'] = built.mediaType
      body = built.text
    }
  }

  return { label: `${op.method.toUpperCase()} ${joinPath(prefix, op.path)}`, url: base + full, method: op.method.toUpperCase(), headers, body }
}

// one at a time is slow across 90 ops, all at once trips rate limits
export async function pool(items, n, fn) {
  const out = new Array(items.length)
  let next = 0
  const run = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, run))
  return out
}

// 429 means slow down, not drift
export async function send(url, init, timeoutMs, tries = 3) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    if (res.status !== 429 || attempt >= tries - 1) return res
    const after = Number(res.headers.get('retry-after'))
    const wait = Number.isFinite(after) && after > 0 ? after * 1000 : 500 * 2 ** attempt
    await new Promise((r) => setTimeout(r, Math.min(wait, 10000)))
  }
}

export async function runVerify(spec, opts = {}) {
  const base = String(opts.base ?? 'http://localhost:3000').replace(/\/+$/, '')
  let parsedBase
  try {
    parsedBase = new URL(base)
  } catch {
    throw new Error(`invalid --base URL: ${base}`)
  }
  if (!/^https?:$/.test(parsedBase.protocol)) throw new Error(`--base must be http(s): ${base}`)
  const prefix = opts.prefix !== undefined ? opts.prefix : (spec.servers[0] ?? '/')
  return pool(spec.operations, opts.concurrency ?? 4, (op) =>
    verifyOperation(spec, op, base, prefix, opts.timeoutMs ?? 10000, opts),
  )
}

async function verifyOperation(spec, op, base, prefix, timeoutMs, opts) {
  const { label, url, method, headers, body } = buildRequest(spec, op, base, prefix, opts)
  const expected = pickSuccess(op)
  const successShaped =
    expected &&
    ((/^\d{3}$/.test(expected.key) && expected.key.startsWith('2')) ||
      expected.key === '2XX' ||
      expected.key === 'default')
  if (!successShaped) {
    return { op: label, status: null, expected: '-', pass: null, warns: [], issues: [], skipped: `declares no success response (has: ${Object.keys(op.responses).join(', ') || 'none'})` }
  }

  let res
  try {
    res = await send(url, { method, headers, body }, timeoutMs)
  } catch (e) {
    return { op: label, status: null, expected: expected.key, pass: false, warns: [], issues: [], skipped: null, detail: `request failed: ${e.message}` }
  }

  const statusOk = acceptsExpected(op, res.status)
  const text = await res.text()
  const warns = []
  const issues = []

  const media = preferJson(expected.content)
  if (media) {
    const ct = String(res.headers.get('content-type') ?? '')
    if (text.trim() === '') {
      issues.push('expected a JSON body, got an empty response')
    } else if (!/json/i.test(ct)) {
      warns.push(`expected JSON content-type, got "${ct || 'none'}"`)
    } else {
      try {
        const parsed = JSON.parse(text)
        validateShape(media.schema, parsed, '$', issues, warns, 0)
      } catch {
        issues.push('body is not valid JSON')
      }
    }
  }

  return {
    op: label,
    status: res.status,
    expected: expected.key,
    pass: statusOk && issues.length === 0,
    warns,
    issues,
    skipped: null,
    detail: statusOk ? issues.join('; ') : `expected status ${describeExpected(op)}, got ${res.status}${issues.length ? `; ${issues.join('; ')}` : ''}`,
  }
}

function describeExpected(op) {
  return pickSuccess(op)?.key ?? 'a success response'
}

function acceptsExpected(op, status) {
  const expected = pickSuccess(op)
  if (!expected) return false
  if (/^\d{3}$/.test(expected.key)) return String(status) === expected.key
  return status >= 200 && status < 400
}

function validateShape(schema, v, at, issues, warns, depth) {
  if (!schema || schema.type === 'any' || schema.type === 'never') return
  if (depth > 12) return

  if (Array.isArray(schema.enum) && schema.enum.length && typeof v !== 'object') {
    if (!schema.enum.some((e) => e === v)) issues.push(`${at}: value ${JSON.stringify(v)} is not in enum [${schema.enum.map((e) => JSON.stringify(e)).join(', ')}]`)
  }

  switch (schema.type) {
    case 'string':
      if (typeof v !== 'string') issues.push(`${at}: expected string, got ${jsonType(v)}`)
      return
    case 'integer':
      if (typeof v !== 'number' || !Number.isInteger(v)) issues.push(`${at}: expected integer, got ${jsonType(v)}`)
      return
    case 'number':
      if (typeof v !== 'number') issues.push(`${at}: expected number, got ${jsonType(v)}`)
      return
    case 'boolean':
      if (typeof v !== 'boolean') issues.push(`${at}: expected boolean, got ${jsonType(v)}`)
      return
    case 'null':
      if (v !== null) issues.push(`${at}: expected null`)
      return
    case 'array': {
      if (!Array.isArray(v)) {
        issues.push(`${at}: expected array, got ${jsonType(v)}`)
        return
      }
      const limit = Math.min(v.length, 5)
      for (let i = 0; i < limit; i++) validateShape(schema.items, v[i], `${at}[${i}]`, issues, warns, depth + 1)
      return
    }
    case 'object': {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) {
        issues.push(`${at}: expected object, got ${jsonType(v)}`)
        return
      }
      for (const req of schema.required) {
        if (!(req in v)) issues.push(`${at === '$' ? '' : at + '.'}${req}: missing required property`)
      }
      for (const prop of Object.values(schema.properties)) {
        if (prop.writeOnly) continue
        if (prop.name in v && v[prop.name] !== undefined) {
          validateShape(prop.schema, v[prop.name], `${at === '$' ? '' : at + '.'}${prop.name}`, issues, warns, depth + 1)
        }
      }
      return
    }
    default:
      return
  }
}

function jsonType(v) {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

export function summarize(rows) {
  let passed = 0
  let failed = 0
  let warned = 0
  let skipped = 0
  for (const r of rows) {
    if (r.skipped) skipped++
    else if (r.pass) {
      passed++
      if (r.warns.length) warned++
    } else failed++
  }
  return { total: rows.length, passed, failed, warned, skipped }
}

export function printReport(rows) {
  const width = Math.min(Math.max(...rows.map((r) => r.op.length), 2), 48)
  for (const r of rows) {
    if (r.skipped) {
      console.log(`${pad(r.op, width)}  ${c.dim('SKIP')}   ${c.dim(r.skipped)}`)
      continue
    }
    const verdict = r.pass ? c.green('PASS') : c.red('FAIL')
    const detail = r.pass ? r.warns.map((w) => `warn: ${w}`).join('; ') : r.detail
    console.log(`${pad(r.op, width)}  ${verdict} ${pad(r.status ?? '-', 4)} ${c.dim(detail)}`)
  }
  const s = summarize(rows)
  const parts = [`${s.passed} passed`, `${s.failed} failed`]
  if (s.warned) parts.push(`${s.warned} warned`)
  if (s.skipped) parts.push(`${s.skipped} skipped`)
  const line = parts.join(' · ')
  console.log('')
  console.log(s.failed ? c.red(line) : c.green(line))
  return s.failed
}
