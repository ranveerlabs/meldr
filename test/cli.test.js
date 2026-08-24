import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { main, parseFlags } from '../src/cli.js'
import { makeTmp } from './helpers.js'

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

test('init scaffolds a working project', async () => {
  const dir = await makeTmp()
  const project = path.join(dir, 'demo')
  assert.equal(await main(['init', project, '--no-color']), 0)
  assert.ok(existsSync(path.join(project, 'meldr.yaml')))
  assert.ok(existsSync(path.join(project, 'contracts', 'api.yaml')))
  assert.ok(existsSync(path.join(project, '.gitignore')))

  const prevCwd = process.cwd()
  process.chdir(project)
  try {
    assert.equal(await main(['init', '.']), 1)
    assert.equal(await main(['init', '.', '--force']), 0)
  } finally {
    process.chdir(prevCwd)
  }
})

test('pull copies a contract and wires up config', async () => {
  const dir = await makeTmp()
  const prevCwd = process.cwd()
  process.chdir(dir)
  try {
    const fixture = path.resolve(prevCwd, 'testdata', 'petstore.yaml')
    assert.equal(await main(['pull', fixture, '--no-color']), 0)
    assert.ok(existsSync(path.join(dir, 'contracts', 'api.yaml')))
    assert.ok(existsSync(path.join(dir, 'meldr.yaml')))

    assert.equal(await main(['pull']), 1)
    assert.equal(await main(['serve', '--contract', path.join(dir, 'does-not-exist.yaml')]), 1)
  } finally {
    process.chdir(prevCwd)
  }
})
