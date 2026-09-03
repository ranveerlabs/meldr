import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { generateServer } from '../src/gen.js'
import { petstoreSpec, makeTmp, freePort, startServer } from './helpers.js'

test('generates a standalone server with handler stubs', async () => {
  const spec = await petstoreSpec()
  const dir = await makeTmp()
  const out = path.join(dir, 'server.mjs')
  const written = await generateServer(spec, out)
  const code = await readFile(written, 'utf8')

  assert.match(code, /'GET \/v1\/pets': async \(ctx\)/)
  assert.match(code, /'DELETE \/v1\/pets\/\{id\}': async \(ctx\)/)
  assert.match(code, /"title":"Meldr Petstore"/)
  assert.equal(/\$ref/.test(JSON.parse(code.match(/const SPEC = (\{.*?\})\n\n/s)[1])), false)

  await assert.rejects(generateServer(spec, out), /refusing to overwrite/)
  const forced = await generateServer(spec, out, { force: true })
  assert.equal(forced, out)
})

test('the generated server actually serves the API', async () => {
  const spec = await petstoreSpec()
  const dir = await makeTmp()
  const out = path.join(dir, 'server.mjs')
  await generateServer(spec, out)
  await nodeCheck(out)

  const port = await freePort()
  const child = spawn(process.execPath, [out, '--port', String(port)], { stdio: 'ignore' })
  try {
    const base = `http://127.0.0.1:${port}`
    await waitFor(base + '/__meldr/health')
    const pet = await (await fetch(`${base}/v1/pets/1`)).json()
    assert.equal(pet.name, 'Rex')
    const list = await (await fetch(`${base}/v1/pets`)).json()
    assert.ok(Array.isArray(list) && list.length >= 1)
    const forced = await fetch(`${base}/v1/pets/1`, { headers: { 'x-meldr-status': '404' } })
    assert.equal(forced.status, 404)
    assert.equal((await forced.json()).code, 'not_found')
  } finally {
    child.kill('SIGKILL')
  }
}, 30000)

async function nodeCheck(file) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--check', file], { stdio: 'pipe' })
    let err = ''
    child.stderr.on('data', (d) => (err += d))
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`node --check failed: ${err}`))))
  })
}

async function waitFor(url, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`server at ${url} never became healthy`)
}

// serve and gen carry separate copies of the synthesis, so they can drift apart
// without anyone noticing. wire compatible has to mean byte identical
test('the generated server answers exactly what serve answers', async () => {
  const spec = await petstoreSpec()
  const dir = await makeTmp()
  const out = path.join(dir, 'server.mjs')
  await generateServer(spec, out)

  const live = await startServer(spec)
  const port = await freePort()
  const child = spawn(process.execPath, [out, '--port', String(port)], { stdio: 'ignore' })
  const genBase = `http://127.0.0.1:${port}`
  try {
    await waitFor(genBase + '/__meldr/health')
    const routes = (await (await fetch(genBase + '/__meldr/routes')).json()).routes
    assert.ok(routes.length >= 4)

    for (const r of routes) {
      const url = r.path.replace(/\{[^}]+\}/g, '1')
      const opts = { method: r.method, headers: { accept: 'application/json' } }
      if (r.method === 'POST' || r.method === 'PUT' || r.method === 'PATCH') {
        opts.headers['content-type'] = 'application/json'
        opts.body = '{}'
      }
      const a = await fetch(live.url + url, opts)
      const b = await fetch(genBase + url, opts)
      assert.equal(b.status, a.status, `${r.method} ${url} status`)
      assert.equal(await b.text(), await a.text(), `${r.method} ${url} body`)
    }
  } finally {
    child.kill('SIGKILL')
    await live.close()
  }
}, 30000)

// the template carries its own copy of readBody, and it had no test at all
test('the generated server also 413s instead of dropping the connection', async () => {
  const spec = await petstoreSpec()
  const dir = await makeTmp()
  const out = path.join(dir, 'server.mjs')
  await generateServer(spec, out)
  const port = await freePort()
  const child = spawn(process.execPath, [out, '--port', String(port)], { stdio: 'ignore' })
  try {
    const base = `http://127.0.0.1:${port}`
    await waitFor(base + '/__meldr/health')
    const res = await fetch(`${base}/v1/pets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 1, name: 'x'.repeat(3 * 1024 * 1024) }),
    })
    assert.equal(res.status, 413)
    assert.equal((await fetch(base + '/__meldr/health')).status, 200)
  } finally {
    child.kill('SIGKILL')
  }
}, 30000)
