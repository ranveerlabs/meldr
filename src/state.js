import { value } from './mock.js'
import { pickSuccess } from './spec.js'

// the bucket is the last named segment, so POST /users/{id}/playlists and
// GET /playlists/{id} land in the same place. keying on the whole path meant a
// write under a parent was invisible to the read at top level
export function bucketOf(op) {
  const segs = op.path.split('/').filter(Boolean)
  if (!segs.length) return null
  const isParam = (s) => s.startsWith('{') && s.endsWith('}')
  const last = segs[segs.length - 1]
  const named = [...segs].reverse().find((s) => !isParam(s))
  if (!named) return null
  return { key: named, idName: isParam(last) ? last.slice(1, -1) : null, isItem: isParam(last) }
}

export function createStore() {
  return { rows: new Map(), seeded: new Set(), next: 1000 }
}

function rowsFor(store, key) {
  if (!store.rows.has(key)) store.rows.set(key, new Map())
  return store.rows.get(key)
}

function arrayResponse(op) {
  const media = pickSuccess(op)?.content?.['application/json']
  return media && media.schema?.type === 'array' ? media : null
}

// first touch fills from the contract so a fresh client isnt staring at nothing
function seed(store, key, listOp, idName) {
  if (store.seeded.has(key)) return
  store.seeded.add(key)
  const media = listOp ? arrayResponse(listOp) : null
  if (!media) return
  const rows = rowsFor(store, key)
  const made = value(media.schema, '', 'out')
  for (const [i, item] of (Array.isArray(made) ? made : []).entries()) {
    if (!item || typeof item !== 'object') continue
    rows.set(String(item[idName] ?? item.id ?? i + 1), item)
  }
}

function parse(text) {
  if (!text || !text.trim()) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// returns {status, body} to send, or null to let the normal mock answer
export function handle(store, spec, op, pathParams, bodyText) {
  const b = bucketOf(op)
  if (!b) return null

  const siblings = spec.operations.filter((o) => bucketOf(o)?.key === b.key)
  const itemGet = siblings.find((o) => o.method === 'get' && bucketOf(o).isItem)
  const listGet = siblings.find((o) => o.method === 'get' && !bucketOf(o).isItem && arrayResponse(o))
  const idName = (itemGet && bucketOf(itemGet).idName) || b.idName || 'id'
  seed(store, b.key, listGet, idName)

  const rows = rowsFor(store, b.key)
  const success = pickSuccess(op)
  const ok = success && /^\d{3}$/.test(success.key) ? Number(success.key) : 200
  const body = parse(bodyText)

  if (!b.isItem) {
    // only a path the contract lists as an array is a collection. /me is not
    if (op.method === 'get') return arrayResponse(op) ? { status: ok, body: [...rows.values()] } : null
    // and only create where something can actually read it back
    if (op.method === 'post' && itemGet) {
      const id = String(body?.[idName] ?? body?.id ?? store.next++)
      const saved = { ...(body ?? {}) }
      if (saved[idName] === undefined && saved.id === undefined) saved[idName] = id
      rows.set(id, saved)
      return { status: ok, body: saved }
    }
    return null
  }

  const id = String(pathParams?.[b.idName] ?? '')
  const missing = { status: 404, body: { error: 'not_found', id } }
  if (op.method === 'get') {
    const hit = rows.get(id)
    return hit ? { status: ok, body: hit } : missing
  }
  if (op.method === 'delete') {
    if (!rows.has(id)) return missing
    rows.delete(id)
    return { status: ok, body: null }
  }
  if (op.method === 'put' || op.method === 'patch') {
    const prev = rows.get(id)
    if (!prev && op.method === 'patch') return missing
    const saved = op.method === 'put' ? { ...(body ?? {}) } : { ...prev, ...(body ?? {}) }
    if (saved[b.idName] === undefined) saved[b.idName] = id
    rows.set(id, saved)
    return { status: ok, body: saved }
  }
  return null
}
