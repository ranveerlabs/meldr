import { value } from './mock.js'
import { pickSuccess } from './spec.js'

// a rest shaped guess: /pets is the collection, /pets/{id} is one of them.
// enough to build a client against, not a database
export function collectionOf(op) {
  const segs = op.path.split('/').filter(Boolean)
  if (!segs.length) return null
  const last = segs[segs.length - 1]
  const isItem = last.startsWith('{') && last.endsWith('}')
  return {
    key: '/' + (isItem ? segs.slice(0, -1) : segs).join('/'),
    idName: isItem ? last.slice(1, -1) : null,
    isItem,
  }
}

export function createStore() {
  return { rows: new Map(), seeded: new Set(), next: 1000 }
}

function bucket(store, key) {
  if (!store.rows.has(key)) store.rows.set(key, new Map())
  return store.rows.get(key)
}

// first touch fills from the mock so a fresh client isnt staring at an empty list
function seed(store, key, op, listOp) {
  if (store.seeded.has(key)) return
  store.seeded.add(key)
  const rows = bucket(store, key)
  const src = listOp ?? op
  const resp = pickSuccess(src)
  const media = resp?.content?.['application/json']
  if (!media) return
  const made = value(media.schema, '', 'out')
  const items = Array.isArray(made) ? made : made && typeof made === 'object' ? [made] : []
  const idName = collectionOf(src)?.idName ?? 'id'
  for (const [i, item] of items.entries()) {
    if (!item || typeof item !== 'object') continue
    const id = String(item[idName] ?? item.id ?? i + 1)
    rows.set(id, item)
  }
}

function idFrom(body, idName, store) {
  const given = body && typeof body === 'object' ? body[idName] ?? body.id : undefined
  if (given !== undefined && given !== null && given !== '') return String(given)
  return String(store.next++)
}

// returns {status, body} to send, or null to let the normal mock answer
export function handle(store, spec, op, pathParams, bodyText) {
  const c = collectionOf(op)
  if (!c) return null
  const listOp = spec.operations.find((o) => o.method === 'get' && o.path === c.key)
  seed(store, c.key, op, listOp)
  const rows = bucket(store, c.key)
  const success = pickSuccess(op)
  const ok = success && /^\d{3}$/.test(success.key) ? Number(success.key) : 200

  let body
  if (bodyText && bodyText.trim()) {
    try {
      body = JSON.parse(bodyText)
    } catch {
      return null
    }
  }

  if (!c.isItem) {
    if (op.method === 'get') return { status: ok, body: [...rows.values()] }
    if (op.method === 'post') {
      const idName = collectionOf(listOp ?? op)?.idName ?? 'id'
      const itemId = idFrom(body, idName, store)
      const saved = { ...(body ?? {}) }
      if (saved[idName] === undefined && saved.id === undefined) saved[idName] = itemId
      rows.set(itemId, saved)
      return { status: ok, body: saved }
    }
    return null
  }

  const id = String(pathParams?.[c.idName] ?? '')
  if (op.method === 'get') {
    const hit = rows.get(id)
    return hit ? { status: ok, body: hit } : { status: 404, body: { error: 'not_found', id } }
  }
  if (op.method === 'delete') {
    if (!rows.has(id)) return { status: 404, body: { error: 'not_found', id } }
    rows.delete(id)
    return { status: ok, body: null }
  }
  if (op.method === 'put' || op.method === 'patch') {
    const prev = rows.get(id)
    if (!prev && op.method === 'patch') return { status: 404, body: { error: 'not_found', id } }
    const saved = op.method === 'put' ? { ...(body ?? {}) } : { ...prev, ...(body ?? {}) }
    if (saved[c.idName] === undefined) saved[c.idName] = id
    rows.set(id, saved)
    return { status: ok, body: saved }
  }
  return null
}
