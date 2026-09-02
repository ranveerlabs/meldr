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

// checked in order after the exact table, first match wins. index makes array
// elements differ from each other instead of repeating the same value
const NAME_RULES = [
  [/(^|_)ids?$|Ids?$/, (i) => `id_${i + 1}`],
  [/(url|uri|href)$/i, (i) => `https://example.com/resource/${i + 1}`],
  [/(_at|_on)$|timestamp/i, () => '2024-01-15T10:30:00Z'],
  [/email/i, (i) => `user${i + 1}@example.com`],
  [/(market|country|region)s?$/i, (i) => ['US', 'GB', 'DE'][i % 3]],
  [/(locale|language|lang)$/i, () => 'en_US'],
  [/(name|title|label)$/i, (i) => `meldr-demo-${i + 1}`],
  [/(type|kind)$/i, () => 'standard'],
]

const INT_RULES = [
  [/_ms$|duration/i, 213000],
  [/(popularity|score|rating)$/i, 62],
  [/(total|count)$/i, 25],
  [/(height|width|size)$/i, 640],
  [/limit$/i, 20],
  [/offset$/i, 0],
  [/year$/i, 2024],
]

function stringFor(table, name, i) {
  const nm = String(name ?? '').toLowerCase()
  const exact = table[nm]
  if (exact !== undefined) return i === 0 ? exact : `${exact}-${i + 1}`
  for (const [re, fn] of NAME_RULES) if (re.test(String(name ?? ''))) return fn(i)
  return i === 0 ? 'meldr' : `meldr-${i + 1}`
}

function numFor(schema, name, i, fallback) {
  let base = fallback
  for (const [re, v] of INT_RULES) {
    if (re.test(String(name ?? ''))) {
      base = v
      break
    }
  }
  let n = base + i
  const lo = schema.minimum
  const hi = schema.maximum
  if (lo !== null && lo !== undefined && n < lo) n = lo
  if (hi !== null && hi !== undefined && n > hi) n = hi
  return n
}

const MAX_DEPTH = 6

export function value(schema, name = '', dir = 'out', depth = 0, i = 0) {
  if (!schema || schema.type === 'any') return null
  if (schema.type === 'never') return undefined

  if (depth >= MAX_DEPTH) return synthLeaf(schema, name, i)

  if (schema.example !== undefined) return clone(schema.example)
  if (schema.examples && schema.examples.length) return clone(schema.examples[0])
  if (schema.default !== undefined) return clone(schema.default)
  if (schema.enum && schema.enum.length) return clone(schema.enum[0])
  if (schema.const !== undefined) return clone(schema.const)
  if (FORMAT_VALUES[schema.format] !== undefined) return FORMAT_VALUES[schema.format]

  switch (schema.type) {
    case 'object':
      return synthObject(schema, name, dir, depth, i)
    case 'array':
      return synthArray(schema, name, dir, depth, i)
    default:
      return synthLeaf(schema, name, i)
  }
}

function synthObject(schema, name, dir, depth, i = 0) {
  const obj = {}
  for (const prop of Object.values(schema.properties)) {
    if (dir === 'request' && prop.readOnly) continue
    if (dir === 'out' && prop.writeOnly) continue
    obj[prop.name] = value(prop.schema, prop.name, dir, depth + 1, i)
  }
  return obj
}

function synthArray(schema, name, dir, depth) {
  let n = Math.max(schema.minItems, 2)
  n = Math.min(n, 3)
  if (schema.maxItems >= 0) n = Math.min(n, schema.maxItems)
  if (n < 0) n = 0
  if (!schema.items) return []
  return Array.from({ length: n }, (_, k) => value(schema.items, name, dir, depth + 1, k))
}

function synthLeaf(schema, name, i = 0) {
  switch (schema.type) {
    case 'string':
      return stringFor(NAME_VALUES, name, i)
    case 'integer':
      return Math.trunc(numFor(schema, name, i, 1))
    case 'number':
      return numFor(schema, name, i, 1.25)
    case 'boolean':
      return true
    case 'null':
      return null
    default:
      return NAME_VALUES[String(name ?? '').toLowerCase()] ?? null
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
