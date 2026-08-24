import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseSpec } from '../src/spec.js'
import { createServer } from '../src/serve.js'

export async function petstoreSpec() {
  const raw = await readFile(path.resolve('testdata', 'petstore.yaml'), 'utf8')
  return parseSpec(raw)
}

export function specFromYaml(text) {
  return parseSpec(text)
}

export async function startServer(spec, opts = {}) {
  const server = createServer(spec, opts)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

export async function makeTmp() {
  const { mkdtemp } = await import('node:fs/promises')
  return mkdtemp(path.join(tmpdir(), 'meldr-test-'))
}

export async function freePort() {
  const net = await import('node:net')
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => resolve(port))
    })
  })
}
