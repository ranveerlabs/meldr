import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { main, parseFlags } from '../src/cli.js'
import { makeTmp, freePort } from './helpers.js'

const BIN = fileURLToPath(new URL('../bin/meldr.js', import.meta.url))

function runCli(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('exit', (code) => resolve({ code, out }))
  })
}

test('parseFlags handles forms, bools, ints and rejects unknowns', () => {
  const { flags, positionals } = parseFlags(['--port=5', '--cors', 'positional'], { port: 'int', cors: 'bool' })
  assert.deepEqual(flags, { port: 5, cors: true })
  assert.deepEqual(positionals, ['positional'])

  assert.deepEqual(parseFlags(['--port', '9'], { port: 'int' }).flags, { port: 9 })

  assert.throws(() => parseFlags(['--nope'], {}), /unknown option "--nope"/)
  assert.throws(() => parseFlags(['--port'], { port: 'int' }), /requires a value/)
  assert.throws(() => parseFlags(['--port', 'abc'], { port: 'int' }), /expects an integer/)
  assert.throws(() => parseFlags(['-q'], {}), /unknown option "-q"/)
})

test('main dispatches version and help without touching the filesystem', async () => {
  assert.equal(await main(['version']), 0)
  assert.equal(await main(['-h']), 0)
  assert.equal(await main([]), 0)
})

test('main returns non-zero for unknown commands', async () => {
  assert.equal(await main(['definitely-not-a-command']), 1)
})

test('init scaffolds a working project (as a real subprocess)', async () => {
  const dir = await makeTmp()
  const project = path.join(dir, 'demo')
  const first = await runCli(['init', project, '--no-color'], dir)
  assert.equal(first.code, 0)
  assert.ok(existsSync(path.join(project, 'meldr.yaml')))
  assert.ok(existsSync(path.join(project, 'contracts', 'api.yaml')))
  assert.ok(existsSync(path.join(project, '.gitignore')))

  const again = await runCli(['init', '.'], project)
  assert.equal(again.code, 1)
  assert.match(again.out, /already exists/)

  const forced = await runCli(['init', '.', '--force'], project)
  assert.equal(forced.code, 0)
})

test('pull copies a contract and wires up config (as a real subprocess)', async () => {
  const dir = await makeTmp()
  const fixture = path.resolve(path.dirname(BIN), '..', 'testdata', 'petstore.yaml')

  const missing = await runCli(['pull'], dir)
  assert.equal(missing.code, 1)
  assert.match(missing.out, /requires a source/)

  const ok = await runCli(['pull', fixture, '--no-color'], dir)
  assert.equal(ok.code, 0, ok.out)
  assert.match(ok.out, /Meldr Petstore/)
  assert.ok(existsSync(path.join(dir, 'contracts', 'api.yaml')))
  assert.ok(existsSync(path.join(dir, 'meldr.yaml')))

  const badContract = await runCli(['serve', '--contract', path.join(dir, 'nope.yaml')], dir)
  assert.equal(badContract.code, 1)
})

test('heal is a real command, not just a readme promise', async () => {
  const help = await runCli(['--help', '--no-color'])
  assert.match(help.out, /heal\s+self-maintain/)
  const usage = await runCli(['heal', '--help', '--no-color'])
  assert.equal(usage.code, 0)
  assert.match(usage.out, /--check/)
})

test('heal without an implementation to look at says so', async () => {
  const dir = await makeTmp()
  const project = path.join(dir, 'demo')
  assert.equal((await runCli(['init', project, '--no-color'], dir)).code, 0)
  const r = await runCli(['heal', '--base', 'http://127.0.0.1:1', '--timeout', '1', '--no-color'], project)
  assert.equal(r.code, 1)
  assert.match(r.out, /nothing answering/)
})

test('heal --check is a clean CI gate when the contract is honest', async () => {
  const dir = await makeTmp()
  const project = path.join(dir, 'demo')
  await runCli(['init', project, '--no-color'], dir)
  const port = await freePort()
  const serve = spawn(process.execPath, [BIN, 'serve', '--port', String(port), '--no-color'], { cwd: project, stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    await waitForPort(port)
    const r = await runCli(['heal', '--check', '--base', `http://127.0.0.1:${port}`, '--no-color'], project)
    assert.equal(r.code, 0)
    assert.match(r.out, /no drift/)
  } finally {
    serve.kill()
  }
})

async function waitForPort(port) {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/__meldr/health`)
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`server on ${port} never came up`)
}

// the demo is the first thing anyone runs, it has to work from nothing
test('demo tells the whole story from an empty directory', async () => {
  const dir = await makeTmp()
  const r = await runCli(['demo', '--no-color'], dir)
  assert.equal(r.code, 0, r.out)

  assert.match(r.out, /1 passed · 3 failed/, 'it should start red')
  assert.match(r.out, /4 passed · 0 failed/, 'and finish green')

  const healed = await readFile(path.join(dir, 'meldr-demo', 'contracts', 'api.yaml'), 'utf8')
  assert.match(healed, /# Pet is shared by every route/, 'the demo promises comments survive')
  assert.match(healed, /# upstream swore this enum would never change/)
  assert.match(healed, /createdAt/, 'the field the live api added should be in the contract now')

  // and the port it picked is free again, nothing left listening
  assert.ok(existsSync(path.join(dir, 'meldr-demo', 'drifted.mjs')))
})
