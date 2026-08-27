import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { main, parseFlags } from '../src/cli.js'
import { makeTmp } from './helpers.js'

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
