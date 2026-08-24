import { pickSuccess } from './spec.js'
import { paramValue, requestBodyValue, preferJson } from './mock.js'
import { c, pad } from './ui.js'

function joinPath(a, b) {
  if (!a || a === '/') return b
  return a.replace(/\/+$/, '') + b
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
  const rows = []
  for (const op of spec.operations) {
    rows.push(await verifyOperation(spec, op, base, prefix, opts.timeoutMs ?? 10000))
  }
  return rows
}

async function verifyOperation(spec, op, base, prefix, timeoutMs) {
  const label = `${op.method.toUpperCase()} ${joinPath(prefix, op.path)}`
  const expected = pickSuccess(op)
  const successShaped =
    expected &&
    ((/^\d{3}$/.test(expected.key) && expected.key.startsWith('2')) ||
      expected.key === '2XX' ||
      expected.key === 'default')
  if (!successShaped) {
    return { op: label, status: null, expected: '-', pass: null, warns: [], issues: [], skipped: `declares no success response (has: ${Object.keys(op.responses).join(', ') || 'none'})` }
  }

  let full = joinPath(prefix, op.path).replace(/\{([^}]+)\}/g, (_, name) => {
    const p = op.params.find((x) => x.in === 'path' && x.name === name)
    return p ? encodeURIComponent(paramValue(p)) : `{${name}}`
  })
  const qs = new URLSearchParams()
  for (const p of op.params) {
    if (p.in === 'query' && p.required) qs.set(p.name, paramValue(p))
  }
  const q = qs.toString()
  if (q) full += `?${q}`

  const headers = {
    accept: 'application/json',
    'user-agent': `meldr-verify/${spec.version}`,
  }
  for (const p of op.params) {
    if (p.in === 'header' && p.required) headers[p.name.toLowerCase()] = paramValue(p)
  }

  let body
  if (op.body) {
    const built = requestBodyValue(op.body)
    if (built) {
      headers['content-type'] = built.mediaType
      body = built.text
    }
  }

  let res
  try {
    res = await fetch(base + full, {
      method: op.method.toUpperCase(),
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    })
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
