const FORMAT_VALUES = {
  'date-time': '2024-01-15T10:30:00Z',
  date: '2024-01-15',
  time: '10:30:00Z',
  uuid: '123e4567-e89b-12d3-a456-426614174000',
  email: 'user@example.com',
  uri: 'https://example.com/resource',
  url: 'https://example.com/resource',
  hostname: 'example.com',
  ipv4: '127.0.0.1',
  ipv6: '::1',
  byte: 'bWVsZHI=',
  password: 'meldr-secret-1',
}

const NAME_VALUES = {
  id: 'id_1',
  name: 'meldr-demo',
  title: 'Meldr Demo',
  description: 'A wonderful resource.',
  message: 'ok',
  code: 'OK',
  status: 'active',
  city: 'San Francisco',
  country: 'US',
  currency: 'USD',
  phone: '+15551234567',
  address: '123 Market St',
  tag: 'core',
  tags: 'core',
  category: 'general',
  token: 'c15e6b9a2f8d47c0b3a19e7d5c4f2861',
  slug: 'meldr-demo',
  kind: 'standard',
  label: 'core',
}

const MAX_DEPTH = 6

export function value(schema, name = '', dir = 'out', depth = 0) {
  if (!schema || schema.type === 'any') return null
  if (schema.type === 'never') return undefined

  if (depth >= MAX_DEPTH) return synthLeaf(schema, name)

  if (schema.example !== undefined) return clone(schema.example)
  if (schema.examples && schema.examples.length) return clone(schema.examples[0])
  if (schema.default !== undefined) return clone(schema.default)
  if (schema.enum && schema.enum.length) return clone(schema.enum[0])
  if (schema.const !== undefined) return clone(schema.const)
  if (FORMAT_VALUES[schema.format] !== undefined) return FORMAT_VALUES[schema.format]

  switch (schema.type) {
    case 'object':
      return synthObject(schema, name, dir, depth)
    case 'array':
      return synthArray(schema, name, dir, depth)
    default:
      return synthLeaf(schema, name)
  }
}

function synthObject(schema, name, dir, depth) {
  const obj = {}
  for (const prop of Object.values(schema.properties)) {
    if (dir === 'request' && prop.readOnly) continue
    if (dir === 'out' && prop.writeOnly) continue
    obj[prop.name] = value(prop.schema, prop.name, dir, depth + 1)
  }
  return obj
}

function synthArray(schema, name, dir, depth) {
  let n = Math.max(schema.minItems, 2)
  n = Math.min(n, 3)
  if (schema.maxItems >= 0) n = Math.min(n, schema.maxItems)
  if (n < 0) n = 0
  if (!schema.items) return []
  return Array.from({ length: n }, () => value(schema.items, name, dir, depth + 1))
}

function synthLeaf(schema, name) {
  switch (schema.type) {
    case 'string':
      return NAME_VALUES[name.toLowerCase()] ?? 'meldr'
    case 'integer': {
      const lo = schema.minimum ?? 1
      const hi = schema.maximum
      const n = hi !== null && lo > hi ? hi : lo
      return Math.trunc(n)
    }
    case 'number': {
      const lo = schema.minimum ?? 1.25
      const hi = schema.maximum
      return hi !== null && lo > hi ? hi : lo
    }
    case 'boolean':
      return true
    case 'null':
      return null
    default:
      return NAME_VALUES[name.toLowerCase()] ?? null
  }
}

export function paramValue(param) {
  const v = value(param.schema, param.name, 'request')
  if (v === null || v === undefined) return param.schema.type === 'integer' || param.schema.type === 'number' ? '1' : 'meldr'
  return String(v)
}

export function requestBodyValue(body) {
  const media = preferJson(body.content) ?? Object.values(body.content)[0]
  if (!media) return null
  return { mediaType: media.mediaType, text: JSON.stringify(value(media.schema, '', 'request')) }
}

export function clone(v) {
  try {
    return structuredClone(v)
  } catch {
    return JSON.parse(JSON.stringify(v ?? null))
  }
}

export function preferJson(content) {
  const entries = Object.values(content)
  return entries.find((m) => /json/i.test(m.mediaType)) ?? null
}

export function mediaExample(media) {
  if (media.example !== undefined) return clone(media.example)
  const keys = media.examples ? Object.keys(media.examples) : []
  if (keys.length) return clone(media.examples[keys[0]])
  return undefined
}

export function selectMedia(content, acceptHeader) {
  const entries = Object.values(content)
  if (!entries.length) return null
  const accepts = String(acceptHeader ?? '')
    .split(',')
    .map((s) => s.split(';')[0].trim().toLowerCase())
    .filter(Boolean)
  for (const a of accepts) {
    const exact = entries.find((m) => m.mediaType.toLowerCase() === a)
    if (exact) return exact
  }
  for (const a of accepts) {
    if (a.endsWith('/*')) {
      const prefix = a.slice(0, a.indexOf('/') + 1)
      const partial = entries.find((m) => m.mediaType.toLowerCase().startsWith(prefix))
      if (partial) return partial
    }
  }
  if (accepts.includes('*/*')) return entries.find((m) => /json/i.test(m.mediaType)) ?? entries[0]
  return entries.find((m) => /json/i.test(m.mediaType)) ?? entries[0]
}
