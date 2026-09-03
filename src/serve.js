import http from 'node:http'
import { selectMedia, value, mediaExample, preferJson } from './mock.js'
import { lookupResponse, pickSuccess, declaredStatusKeys } from './spec.js'
import { handle as handleState } from './state.js'
import { pickEntry } from './record.js'
import { c } from './ui.js'

const MAX_BODY_BYTES = 2 * 1024 * 1024

export function createServer(spec, opts = {}) {
  return http.createServer((req, res) => {
    handleRequest(req, res, spec, opts).catch((e) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      }
      res.end(JSON.stringify({ error: 'internal_error', message: String(e && e.message ? e.message : e) }))
    })
  })
}

export function routeList(spec) {
  const rows = []
  for (const prefix of spec.servers) {
    for (const op of spec.operations) {
      rows.push({
        method: op.method.toUpperCase(),
        path: joinPath(prefix, op.path),
        id: op.id,
        summary: op.summary,
      })
    }
  }
  return rows.sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method))
}

function compileRoutes(spec) {
  const routes = []
  for (const prefix of spec.servers) {
    for (const op of spec.operations) {
      routes.push({ segments: splitPath(joinPath(prefix, op.path)), op })
    }
  }
  return routes
}

function splitPath(p) {
  return p.split('/').filter((s) => s.length > 0)
}

function joinPath(a, b) {
  if (!a || a === '/') return b
  return a.replace(/\/+$/, '') + b
}

async function handleRequest(req, res, spec, opts) {
  const startedAt = process.hrtime.bigint()
  const routes = opts.routes ?? (opts.routes = compileRoutes(spec))

  res.on('finish', () => {
    const ms = (Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(1)
    console.error(`[meldr] ${req.method} ${req.url} ${statusColor(res.statusCode)} ${c.dim(`${ms}ms`)}`)
  })

  let url
  try {
    url = new URL(req.url, 'http://meldr.local')
  } catch {
    return respond(res, 400, { error: 'bad_request', message: 'malformed request target' })
  }

  if (url.pathname.startsWith('/__meldr/')) {
    return introspect(req, res, url.pathname, spec)
  }
  if (opts.cors && req.method === 'OPTIONS') {
    applyCors(res)
    res.writeHead(204)
    return res.end()
  }

  const matchResult = matchRoute(routes, req.method, url.pathname)
  if (matchResult.type === 'nomatch') {
    return respond(res, 404, { error: 'not_found', message: `no route matches ${req.method} ${url.pathname}` })
  }
  if (matchResult.type === 'method_mismatch') {
    res.setHeader('allow', [...matchResult.allowed].sort().join(', '))
    return respond(res, 405, {
      error: 'method_not_allowed',
      message: `${req.method} is not allowed on ${url.pathname}`,
    })
  }

  const { op } = matchResult.route
  if (opts.requireAuth && !credentialled(spec, req, url)) {
    const declared = lookupResponse(op, 401)
    const media = declared ? preferJson(declared.content) : null
    return respond(res, 401, media ? value(media.schema, '', 'out') : { error: 'unauthorized', message: 'no credential on the request' })
  }
  const vars = matchResult.vars ?? {}
  const violations = []

  for (const p of op.params) {
    if (!p.required) continue
    if (p.in === 'query' && !url.searchParams.has(p.name)) violations.push({ in: 'query', name: p.name, reason: 'required' })
    if (p.in === 'header' && !(p.name.toLowerCase() in req.headers)) violations.push({ in: 'header', name: p.name, reason: 'required' })
  }

  let rawBody = ''
  if (op.body) {
    try {
      rawBody = await readBody(req)
    } catch (e) {
      if (e && e.code === 'body_too_large') {
        return respond(res, 413, { error: 'body_too_large', limit: MAX_BODY_BYTES })
      }
      throw e
    }
    if (op.body.required && rawBody.trim() === '') {
      violations.push({ in: 'body', name: 'requestBody', reason: 'required' })
    } else if (rawBody.trim() !== '' && preferJson(op.body.content)) {
      try {
        JSON.parse(rawBody)
      } catch {
        violations.push({ in: 'body', name: 'requestBody', reason: 'invalid_json' })
      }
    }
  }

  if (violations.length) {
    return respond(res, 400, { error: 'validation_failed', violations })
  }

  let response = null
  let status = null
  const forced = req.headers['x-meldr-status']
  if (forced !== undefined) {
    const forcedStatus = Number.parseInt(String(forced), 10)
    response = Number.isInteger(forcedStatus) ? lookupResponse(op, forcedStatus) : null
    if (!response) {
      return respond(res, 400, {
        error: 'unknown_status',
        message: `X-Meldr-Status ${forced} is not declared for ${op.method.toUpperCase()} ${op.path}`,
        declared: declaredStatusKeys(op),
      })
    }
    status = forcedStatus
  } else {
    response = pickSuccess(op)
    if (!response) return respond(res, 200, {})
    status = /^\d{3}$/.test(response.key) ? Number(response.key) : 200
  }

  const media = selectMedia(response.content, req.headers.accept)
  const headers = {}
  if (media) headers['content-type'] = /json/i.test(media.mediaType) ? `${media.mediaType}; charset=utf-8` : media.mediaType

  for (const [name, h] of Object.entries(response.headers ?? {})) {
    const v = value(h.schema, name.toLowerCase(), 'out')
    if (v !== undefined && v !== null) headers[name.toLowerCase()] = String(v)
  }

  // writes have to survive a read or you cant build anything past a list view
  if (opts.state && forced === undefined) {
    const out = handleState(opts.state, spec, op, vars, rawBody)
    if (out) {
      if (opts.cors) applyCors(res)
      const h = out.body === null ? {} : { 'content-type': 'application/json; charset=utf-8' }
      res.writeHead(out.status, h)
      return res.end(out.body === null ? '' : JSON.stringify(out.body))
    }
  }

  // a recording of the real thing beats anything synthesised from the schema
  const taped = pickEntry(opts.replay?.get(`${op.method} ${op.path}`), vars, url.searchParams)
  if (taped && forced === undefined) {
    const headers2 = taped.contentType ? { 'content-type': taped.contentType } : {}
    if (opts.cors) applyCors(res)
    res.writeHead(taped.status, headers2)
    return res.end(typeof taped.body === 'string' ? taped.body : JSON.stringify(taped.body))
  }

  let payloadText = ''
  if (media) {
    const example = mediaExample(media)
    payloadText = JSON.stringify(example !== undefined ? example : value(media.schema, '', 'out'))
  }

  if (opts.cors) applyCors(res)
  res.writeHead(status, headers)
  res.end(payloadText)
}

function statusColor(code) {
  if (code >= 500) return c.red(String(code))
  if (code >= 400) return c.yellow(String(code))
  return c.green(String(code))
}

// any non empty credential passes. this is here so you can build the auth
// plumbing, it is not checking anything
function credentialled(spec, req, url) {
  const schemes = spec.security ?? []
  if (!schemes.length) return Boolean(req.headers.authorization)
  return schemes.some((s) => {
    if (s.type === 'apiKey' && s.in === 'header') return Boolean(req.headers[s.paramName.toLowerCase()])
    if (s.type === 'apiKey' && s.in === 'query') return Boolean(url.searchParams.get(s.paramName))
    if (s.type === 'apiKey' && s.in === 'cookie') return String(req.headers.cookie ?? '').includes(`${s.paramName}=`)
    return Boolean(req.headers.authorization)
  })
}

function applyCors(res) {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type, accept, x-meldr-status, authorization')
  res.setHeader('access-control-max-age', '600')
}

function matchRoute(routes, method, pathname) {
  const target = splitPath(decodeSafe(pathname))
  let allowed = null
  for (const route of routes) {
    const vars = matchSegments(route.segments, target)
    if (vars === null) continue
    if (route.op.method === method.toLowerCase()) return { type: 'ok', route, vars }
    allowed = allowed ?? new Set(['OPTIONS'])
    allowed.add(route.op.method.toUpperCase())
  }
  if (allowed) return { type: 'method_mismatch', allowed }
  return { type: 'nomatch' }
}

function decodeSafe(s) {
  try {
    return decodeURI(s)
  } catch {
    return s
  }
}

function matchSegments(template, actual) {
  if (template.length !== actual.length) return null
  const vars = {}
  for (let i = 0; i < template.length; i++) {
    const t = template[i]
    if (t.startsWith('{') && t.endsWith('}')) {
      const name = t.slice(1, -1)
      try {
        vars[name] = decodeURIComponent(actual[i])
      } catch {
        vars[name] = actual[i]
      }
    } else if (t !== actual[i]) {
      return null
    }
  }
  return vars
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let over = false
    // keep draining but stop buffering. pausing here fills the socket and the
    // client blocks writing and never reads the 413 we are trying to send it
    req.on('data', (chunk) => {
      size += chunk.length
      if (over) return
      if (size > MAX_BODY_BYTES) {
        over = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (over) {
        const e = new Error('body_too_large')
        e.code = 'body_too_large'
        return reject(e)
      }
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
  })
}

function respond(res, status, bodyObj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(bodyObj))
}

function introspect(req, res, pathname, spec) {
  if (pathname === '/__meldr/health') {
    return respond(res, 200, { status: 'ok', api: spec.title, version: spec.version })
  }
  if (pathname === '/__meldr/routes') {
    return respond(res, 200, { routes: routeList(spec) })
  }
  if (pathname === '/__meldr/contract') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    return res.end(JSON.stringify(spec.doc))
  }
  return respond(res, 404, { error: 'not_found', message: `unknown introspection path ${pathname}` })
}
