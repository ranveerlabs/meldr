import yaml from 'js-yaml'
import { CliError } from './ui.js'

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']

export async function loadSpec(src) {
  return (await fetchContract(src)).spec
}

export async function fetchContract(src) {
  let raw
  if (/^https?:\/\//i.test(src)) {
    let res
    try {
      res = await fetch(src, { headers: { 'user-agent': 'meldr/0.1' }, redirect: 'follow' })
    } catch (e) {
      throw new CliError(`could not fetch ${src}: ${e.cause ? e.cause.message : e.message}`, 'check the url, or pass a local file instead')
    }
    if (!res.ok) throw new CliError(`could not fetch ${src}: HTTP ${res.status}`, 'check the url, or pass a local file instead')
    raw = await res.text()
  } else {
    const { readFile } = await import('node:fs/promises')
    raw = await readFile(src, 'utf8')
  }
  return { raw, spec: parseSpec(raw) }
}

export function parseSpec(text) {
  let doc
  try {
    doc = yaml.load(text)
  } catch (e) {
    throw new Error(`contract is not valid YAML/JSON: ${e.message.split('\n')[0]}`)
  }
  if (!isMap(doc)) throw new Error('contract root must be a mapping')
  const version = String(doc.openapi ?? '')
  if (!version.startsWith('3.')) {
    throw new Error(`unsupported OpenAPI version "${version || '(missing)'}", meldr wants OpenAPI 3.x`)
  }
  const warnings = []
  const dereferenced = deref(doc, doc, [], 0, warnings)
  const spec = convert(dereferenced, warnings)
  return spec
}

function isMap(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function str(v) {
  return typeof v === 'string' ? v : ''
}

function boolOr(v, fallback) {
  return typeof v === 'boolean' ? v : fallback
}

function intOr(v, fallback) {
  return Number.isFinite(v) ? Math.trunc(v) : fallback
}

function numOrNull(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function resolvePointer(root, ref) {
  if (ref === '#') return root
  if (!ref.startsWith('#/')) throw new Error(`external $ref "${ref}" is not supported yet, inline the referenced document`)
  let node = root
  for (const rawSeg of ref.slice(2).split('/')) {
    const seg = rawSeg.replace(/~1/g, '/').replace(/~0/g, '~')
    if (Array.isArray(node)) {
      const i = Number(seg)
      if (!Number.isInteger(i) || i < 0 || i >= node.length) return undefined
      node = node[i]
    } else if (isMap(node)) {
      if (!(seg in node)) return undefined
      node = node[seg]
    } else {
      return undefined
    }
  }
  return node
}

function deepCopy(v, depth = 0) {
  if (depth > 64) return v
  if (Array.isArray(v)) return v.map((x) => deepCopy(x, depth + 1))
  if (isMap(v)) {
    const out = {}
    for (const [k, val] of Object.entries(v)) out[k] = deepCopy(val, depth + 1)
    return out
  }
  return v
}

function deref(root, node, seen, depth, warnings) {
  if (depth > 128) return node
  if (Array.isArray(node)) return node.map((x) => deref(root, x, seen, depth + 1, warnings))
  if (!isMap(node)) return node

  const ref = typeof node.$ref === 'string' ? node.$ref : null
  if (ref) {
    const target = resolvePointer(root, ref)
    if (target === undefined) {
      warnings.push(`unresolved $ref "${ref}", replaced with an empty object`)
      return { __meldrCycle: true }
    }
    if (seen.includes(ref)) return { __meldrCycle: true }
    const resolved = deref(root, target, [...seen, ref], depth + 1, warnings)
    const out = isMap(resolved) ? deepCopy(resolved) : resolved
    if (isMap(out)) {
      for (const [k, v] of Object.entries(node)) {
        if (k !== '$ref') out[k] = deref(root, v, seen, depth + 1, warnings)
      }
    }
    return out
  }

  for (const [k, v] of Object.entries(node)) node[k] = deref(root, v, seen, depth + 1, warnings)
  return node
}

function convert(doc, warnings) {
  const info = isMap(doc.info) ? doc.info : {}
  const spec = {
    openapi: String(doc.openapi),
    title: str(info.title) || 'Untitled API',
    description: str(info.description),
    version: str(info.version) || '0.0.0',
    servers: extractServers(doc.servers),
    operations: [],
    security: securitySchemes(doc),
    warnings,
    doc,
  }
  const paths = isMap(doc.paths) ? doc.paths : {}
  for (const [p, item] of Object.entries(paths)) {
    if (!isMap(item)) continue
    const baseParams = toArray(item.parameters).map((x) => convertParam(x)).filter(Boolean)
    for (const method of HTTP_METHODS) {
      const opNode = item[method]
      if (!isMap(opNode)) continue
      spec.operations.push(convertOperation(p, method, opNode, baseParams))
    }
  }
  spec.operations.sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`))
  return spec
}

function toArray(v) {
  return Array.isArray(v) ? v : []
}

function securitySchemes(doc) {
  const node = isMap(doc.components) && isMap(doc.components.securitySchemes) ? doc.components.securitySchemes : {}
  const out = []
  for (const [name, v] of Object.entries(node)) {
    if (!isMap(v)) continue
    out.push({ name, type: str(v.type), in: str(v.in), paramName: str(v.name), scheme: str(v.scheme) })
  }
  return out
}

function extractServers(servers) {
  const out = []
  for (const s of toArray(servers)) {
    if (!isMap(s) || typeof s.url !== 'string' || !s.url.trim()) continue
    let u = s.url.trim().split('{')[0]
    try {
      if (/^https?:\/\//i.test(u)) u = new URL(u).pathname
    } catch {
      /* keep raw */
    }
    if (!u.startsWith('/')) u = `/${u}`
    while (u.length > 1 && u.endsWith('/')) u = u.slice(0, -1)
    if (!out.includes(u)) out.push(u)
  }
  return out.length ? out : ['/']
}

function convertParam(node) {
  if (!isMap(node) || typeof node.name !== 'string' || !node.name) return null
  const loc = ['query', 'header', 'path', 'cookie'].includes(node.in) ? node.in : 'query'
  return {
    name: node.name,
    in: loc,
    required: loc === 'path' ? true : boolOr(node.required, false),
    schema: node.schema !== undefined ? convSchema(node.schema) : emptySchema(),
  }
}

function mergeParams(base, extra) {
  const out = []
  const index = new Map()
  for (const p of [...base, ...extra]) {
    if (!p) continue
    const key = `${p.in}:${p.name}`
    if (index.has(key)) out[index.get(key)] = p
    else {
      index.set(key, out.length)
      out.push(p)
    }
  }
  return out
}

function convertOperation(path, method, node, baseParams) {
  const responses = {}
  const respMap = isMap(node.responses) ? node.responses : {}
  for (const [rawKey, r] of Object.entries(respMap)) {
    if (!isMap(r)) continue
    const key = String(rawKey)
    responses[key] = {
      key,
      description: str(r.description),
      content: convertContent(r.content),
      headers: convertHeaders(r.headers),
    }
  }
  let body = null
  if (isMap(node.requestBody) && isMap(node.requestBody.content) && Object.keys(node.requestBody.content).length) {
    body = {
      required: boolOr(node.requestBody.required, false),
      content: convertContent(node.requestBody.content),
    }
  }
  return {
    id: str(node.operationId) || `${method.toUpperCase()} ${path}`,
    summary: str(node.summary),
    description: str(node.description),
    path,
    method,
    tags: toArray(node.tags).filter((t) => typeof t === 'string'),
    deprecated: node.deprecated === true,
    params: mergeParams(baseParams, toArray(node.parameters).map((x) => convertParam(x)).filter(Boolean)),
    body,
    responses,
  }
}

function convertContent(content) {
  const out = {}
  if (!isMap(content)) return out
  for (const [mediaType, mv] of Object.entries(content)) {
    if (!isMap(mv)) continue
    const entry = {
      mediaType,
      schema: mv.schema !== undefined ? convSchema(mv.schema) : emptySchema(),
      example: mv.example,
      examples: null,
    }
    if (isMap(mv.examples)) {
      const ex = {}
      for (const [n, ev] of Object.entries(mv.examples)) {
        if (isMap(ev) && 'value' in ev) ex[n] = ev.value
        else if (!isMap(ev)) ex[n] = ev
      }
      entry.examples = ex
    }
    out[mediaType.toLowerCase()] = entry
  }
  return out
}

function convertHeaders(headers) {
  const out = {}
  if (!isMap(headers)) return out
  for (const [name, h] of Object.entries(headers)) {
    if (!isMap(h)) continue
    out[name] = { schema: h.schema !== undefined ? convSchema(h.schema) : emptySchema() }
  }
  return out
}

function emptySchema() {
  return {
    type: 'any',
    format: '',
    nullable: false,
    enum: null,
    const: undefined,
    default: undefined,
    example: undefined,
    examples: null,
    properties: {},
    required: [],
    items: null,
    minItems: -1,
    maxItems: -1,
    minimum: null,
    maximum: null,
    description: '',
  }
}

function convSchema(node, depth = 0) {
  if (depth > 32) return emptySchema()
  if (node === true || node === undefined) return emptySchema()
  if (node === false || node === null) {
    const s = emptySchema()
    s.type = 'never'
    return s
  }
  if (!isMap(node)) return emptySchema()
  if (node.__meldrCycle) {
    const s = emptySchema()
    s.type = 'object'
    return s
  }

  const eff = mergeAllOf(node)
  const s = emptySchema()
  const t = eff.type
  if (typeof t === 'string') {
    s.type = t
  } else if (Array.isArray(t)) {
    const nonNull = t.find((x) => x !== 'null')
    s.type = nonNull ?? 'null'
  } else if (isMap(eff.properties)) {
    s.type = 'object'
  } else if (eff.items !== undefined) {
    s.type = 'array'
  }
  s.format = str(eff.format)
  s.nullable = eff.nullable === true || (Array.isArray(t) && t.includes('null'))
  s.enum = Array.isArray(eff.enum) ? eff.enum : null
  s.const = 'const' in eff ? eff.const : undefined
  s.default = 'default' in eff ? eff.default : undefined
  s.example = 'example' in eff ? eff.example : undefined
  if (Array.isArray(eff.examples)) s.examples = eff.examples.filter((x) => x !== undefined)
  s.minItems = intOr(eff.minItems, -1)
  s.maxItems = intOr(eff.maxItems, -1)
  s.minimum = numOrNull(eff.minimum)
  s.maximum = numOrNull(eff.maximum)
  s.description = str(eff.description)

  if (isMap(eff.properties)) {
    for (const [k, v] of Object.entries(eff.properties)) {
      const child = convSchema(isMap(v) ? v : {}, depth + 1)
      s.properties[k] = {
        name: k,
        schema: child,
        readOnly: isMap(v) && v.readOnly === true,
        writeOnly: isMap(v) && v.writeOnly === true,
      }
    }
  }
  s.required = Array.isArray(eff.required) ? eff.required.filter((x) => typeof x === 'string') : []
  if (eff.items !== undefined && eff.items !== null) s.items = convSchema(isMap(eff.items) ? eff.items : {}, depth + 1)

  return s
}

function mergeAllOf(node) {
  if (!Array.isArray(node.allOf) || !node.allOf.length) return node
  const eff = { ...node }
  delete eff.allOf
  delete eff.__meldrCycle
  for (const part of node.allOf) {
    if (!isMap(part)) continue
    const src = part.__meldrCycle ? {} : part
    for (const [k, v] of Object.entries(src)) {
      if (k === '$ref' || k === '__meldrCycle') continue
      if (k === 'properties' && isMap(eff.properties)) {
        eff.properties = { ...eff.properties, ...v }
      } else if (k === 'required' && Array.isArray(eff.required)) {
        eff.required = [...new Set([...eff.required, ...toArray(v)])]
      } else if (!(k in eff)) {
        eff[k] = v
      }
    }
  }
  return eff
}

export function successEntries(op) {
  return Object.values(op.responses)
    .filter((r) => /^2\d\d$/.test(r.key))
    .sort((a, b) => a.key.localeCompare(b.key))
}

export function pickSuccess(op) {
  const succ = successEntries(op)
  if (succ.length) return succ.find((r) => r.key === '200') ?? succ[0]
  if (op.responses['2XX']) return op.responses['2XX']
  return op.responses.default ?? null
}

export function lookupResponse(op, status) {
  const k = String(status)
  if (op.responses[k]) return op.responses[k]
  const range = `${String(k)[0]}XX`
  if (op.responses[range]) return op.responses[range]
  return op.responses.default ?? null
}

export function declaredStatusKeys(op) {
  return Object.keys(op.responses).sort()
}

export function acceptsStatus(op, status) {
  const expected = pickSuccess(op)
  if (!expected) return false
  if (/^\d{3}$/.test(expected.key)) return String(status) === expected.key
  if (/^[1-5]XX$/.test(expected.key)) {
    const lo = Number(expected.key[0]) * 100
    return status >= lo && status <= lo + 99
  }
  return status >= 200 && status < 400
}
