import { spawn } from 'node:child_process'
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { parseSpec } from '../spec.js'
import { runVerify, printReport } from '../verify.js'
import { probeDrift, applyToYaml } from '../drift.js'
import { configTemplate } from '../config.js'
import { c, pad } from '../ui.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DATA = path.resolve(HERE, '..', '..', 'testdata')

export async function cmdDemo(flags, args) {
  const dir = path.resolve(args[0] ?? 'meldr-demo')
  const port = flags.port ?? (await freePort())

  await mkdir(path.join(dir, 'contracts'), { recursive: true })
  const contract = path.join(dir, 'contracts', 'api.yaml')
  await writeFile(contract, annotate(await readFile(path.join(DATA, 'petstore.yaml'), 'utf8')))
  await copyFile(path.join(DATA, 'drifted.mjs'), path.join(dir, 'drifted.mjs'))
  await writeFile(path.join(dir, 'meldr.yaml'), configTemplate('meldr-demo', 'contracts/api.yaml', port))

  step(1, 'a contract, and an api that quietly moved on without it')
  console.log(c.dim(`  ${path.relative(process.cwd(), dir) || dir}/contracts/api.yaml   the petstore contract`))
  console.log(c.dim(`  ${path.relative(process.cwd(), dir) || dir}/drifted.mjs          the api, ids went to strings and a field appeared`))
  console.log('')

  const server = spawn(process.execPath, [path.join(dir, 'drifted.mjs'), String(port)], { stdio: 'ignore' })
  const base = `http://127.0.0.1:${port}`
  try {
    await waitFor(`${base}/v1/pets`)

    step(2, 'meldr verify')
    const raw = await readFile(contract, 'utf8')
    const spec = parseSpec(raw)
    const before = await runVerify(spec, { base })
    printReport(before)
    console.log('')

    step(3, 'meldr verify --heal --all')
    const report = await probeDrift(spec, YAML.parse(raw), { base })
    const width = Math.min(Math.max(...report.findings.map((f) => f.op.length), 2), 42)
    for (const f of report.findings) {
      const tag = f.safety === 'safe' ? c.green('FIX ') : c.yellow('RISK')
      console.log(`${pad(f.op, width)}  ${tag} ${pad(f.at, 24)} ${c.dim(f.detail)}`)
    }
    const ydoc = YAML.parseDocument(raw)
    const { applied } = applyToYaml(ydoc, report.findings.filter((f) => f.patch))
    await writeFile(contract, ydoc.toString({ lineWidth: 0, flowCollectionPadding: false, singleQuote: true }))
    console.log('')
    console.log(`${c.green('✓')} ${applied.length} fix(es) written into the contract`)
    console.log('')

    step(4, 'meldr verify, again')
    const after = await runVerify(parseSpec(await readFile(contract, 'utf8')), { base })
    printReport(after)
  } finally {
    server.kill()
  }

  const rel = path.relative(process.cwd(), dir) || dir
  console.log('')
  console.log(`  nobody edited that contract by hand. meldr sent one real request per`)
  console.log(`  operation, compared it to what the contract claimed, and wrote back the`)
  console.log(`  difference. the fix went in through the $ref so it landed in`)
  console.log(`  components/schemas/Pet once, not four times`)
  console.log('')
  console.log(c.dim('poke at it'))
  console.log(c.dim(`  cd ${rel}`))
  console.log(c.dim(`  git diff contracts/           # or just read it, the comments survived`))
  console.log(c.dim(`  node drifted.mjs ${port} &`))
  console.log(c.dim(`  meldr serve --stateful        # POST something and read it back`))
  console.log('')
  return 0
}

// the demo contract carries comments on purpose, surviving them is the whole
// reason anyone lets this near a file they maintain
function annotate(src) {
  const head = '# the petstore contract. these comments are here so you can watch them\n'
  const head2 = '# survive a heal, meldr patches the document instead of reprinting it\n'
  return (
    head +
    head2 +
    src
      .replace('    Pet:\n', '    # Pet is shared by every route below, one fix moves all of them\n    Pet:\n')
      .replace('        status:\n', '        # upstream swore this enum would never change\n        status:\n')
  )
}

function step(n, title) {
  console.log(`${c.cyan(c.bold(`${n}.`))} ${c.bold(title)}`)
}

async function freePort() {
  const net = await import('node:net')
  return new Promise((resolve) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
}

async function waitFor(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`the demo api never came up at ${url}`)
}
