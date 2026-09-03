import { buildRequest, pool, send } from './verify.js'

export const FORMAT = 1

// recordings get committed
const SECRETS = /^(access_token|refresh_token|id_token|client_secret|password|api_key|apikey|authorization)$/i
const PLACEHOLDER = '[scrubbed]'

export async function runRecord(spec, opts = {}) {
  const base = String(opts.base ?? '').replace(/\/+$/, '')
  const parsed = new URL(base)
  if (!/^https?:$/.test(parsed.protocol)) throw new Error(`--base must be http(s): ${base}`)
  const prefix = opts.prefix !== undefined ? opts.prefix : (spec.servers[0] ?? '/')
  const timeoutMs = opts.timeoutMs ?? 15000
  let scrubbed = 0

  // one job per case so /tracks/{id} captures more than one track
  const cases = opts.cases ?? {}
  const jobs = []
  for (const op of spec.operations) {
    const mine = Array.isArray(cases[op.id]) ? cases[op.id] : []
    if (!mine.length) jobs.push({ op, pins: null })
    else for (const pins of mine) jobs.push({ op, pins })
  }

  const entries = await pool(jobs, opts.concurrency ?? 4, async ({ op, pins }) => {
    const params = pins ? { ...opts.params, [op.id]: { ...(opts.params?.[op.id] ?? {}), ...pins } } : opts.params
    const req = buildRequest(spec, op, base, prefix, { ...opts, params })
    let res
    try {
      res = await send(req.url, { method: req.method, headers: req.headers, body: req.body }, timeoutMs)
    } catch (e) {
      return { method: op.method, path: op.path, label: req.label, params: pins, error: e.message }
    }
    const text = await res.text()
    const type = String(res.headers.get('content-type') ?? '')
    let body = text
    if (/json/i.test(type) && text.trim() !== '') {
      try {
        const seen = { n: 0 }
        body = scrub(JSON.parse(text), seen, 0)
        scrubbed += seen.n
      } catch {
        body = text
      }
    }
    return {
      method: op.method,
      path: op.path,
      label: req.label,
      params: pins,
      url: req.url.slice(base.length),
      status: res.status,
      contentType: type || null,
      body,
    }
  })

  return {
    meldr: FORMAT,
    recordedAt: new Date().toISOString(),
    source: base,
    title: spec.title,
    version: spec.version,
    scrubbed,
    entries,
  }
}

function scrub(v, seen, depth) {
  if (depth > 32) return v
  if (Array.isArray(v)) return v.map((x) => scrub(x, seen, depth + 1))
  if (v === null || typeof v !== 'object') return v
  const out = {}
  for (const [k, val] of Object.entries(v)) {
    if (SECRETS.test(k) && typeof val === 'string') {
      out[k] = PLACEHOLDER
      seen.n++
    } else {
      out[k] = scrub(val, seen, depth + 1)
    }
  }
  return out
}

export function replayIndex(recording) {
  if (!recording || recording.meldr !== FORMAT) {
    throw new Error(`not a meldr recording (expected meldr: ${FORMAT})`)
  }
  const map = new Map()
  for (const e of recording.entries ?? []) {
    if (e.error) continue
    const k = `${e.method} ${e.path}`
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(e)
  }
  return map
}

// a pinned id wins, otherwise the first one taped. strict refuses instead
export function pickEntry(entries, vars, searchParams, strict = false) {
  if (!entries || !entries.length) return null
  for (const e of entries) {
    if (!e.params) continue
    const hit = Object.entries(e.params).every(([k, v]) => {
      const actual = vars?.[k] ?? searchParams?.get(k)
      return actual !== undefined && actual !== null && String(actual) === String(v)
    })
    if (hit) return e
  }
  const loose = entries.find((e) => !e.params)
  if (loose) return loose
  return strict ? null : entries[0]
}

export function summarizeRecording(recording) {
  let ok = 0
  let failed = 0
  let dead = 0
  for (const e of recording.entries ?? []) {
    if (e.error) dead++
    else if (e.status >= 400) failed++
    else ok++
  }
  return { total: recording.entries?.length ?? 0, ok, failed, dead }
}
