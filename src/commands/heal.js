import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import YAML from 'yaml'
import { loadConfig, contractPath, servePort, headersFor, paramsFor } from '../config.js'
import { fetchContract, parseSpec } from '../spec.js'
import { probeDrift, upstreamDrift, applyToYaml, summarizeDrift } from '../drift.js'
import { resolveSession } from '../session.js'
import { CliError, c, pad } from '../ui.js'

const HEAL_PROMPT = `you are a self-healing api engine. compare the current openapi spec with drift reports or upstream changes.
output ONLY valid minified JSON representing the healed openapi spec (version 3.0.3) with all fixes merged.
format: {"openapi":"3.0.3","info":{...},"paths":{...},"servers":[{...}]}`

export async function cmdHeal(flags, args) {
  const { config, file: cfgFile } = await loadConfig(flags.config)
  const abs = contractPath(config, flags.contract, cfgFile ? path.dirname(cfgFile) : process.cwd())

  let raw
  try {
    raw = await readFile(abs, 'utf8')
  } catch {
    throw new CliError(`contract not found: ${abs}`, 'run `meldr init` or `meldr pull <file-or-url>` first')
  }

  const spec = parseSpec(raw)
  const doc = YAML.parse(raw) // pristine, $refs intact. patches land here

  const upstream = flags.upstream ?? args[0]
  let report
  if (upstream) {
    const up = await fetchContract(upstream)
    report = upstreamDrift(spec, up.spec)
  } else {
    const base = flags.base ?? `http://localhost:${servePort(config)}`
    if (flags.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    report = await probeDrift(spec, doc, {
      base,
      prefix: flags.prefix,
      timeoutMs: (flags.timeout ?? 10) * 1000,
      concurrency: flags.concurrency ?? config.concurrency ?? 4,
      headers: headersFor(config, flags.header),
      params: paramsFor(config, flags.param),
    })
    if (report.unreachable.length === spec.operations.length && spec.operations.length) {
      throw new CliError(`nothing answering at ${base}`, 'start the implementation first, or diff a contract with --upstream <file-or-url>')
    }
  }

  console.log(`healing ${c.bold(spec.title)} v${spec.version} against ${report.source}`)
  console.log('')

  const s = summarizeDrift(report.findings)
  const covered = report.covered ?? []
  if (!report.findings.length) {
    for (const u of report.unreachable) console.log(`  ${c.yellow('unreachable')} ${c.dim(u)}`)
    if (covered.length) {
      // "already matches" would be a lie, its just nothing heal can touch
      console.log(c.yellow(`nothing to patch · ${covered.length} operation(s) answered an error a default response already covers`))
      for (const x of covered.slice(0, 5)) console.log(c.dim(`  ${x.op} -> ${x.status}`))
      if (covered.length > 5) console.log(c.dim(`  and ${covered.length - 5} more`))
      console.log(c.dim('  thats the implementation failing, not the contract drifting. meldr verify shows it'))
    } else {
      console.log(c.green('no drift · contract already matches'))
    }
    if (flags.report) await writeReport(flags.report, abs, report, [], s)
    return 0
  }

  printFindings(report.findings)
  for (const u of report.unreachable) console.log(`  ${c.yellow('unreachable')} ${c.dim(u)}`)
  console.log('')

  if (flags.check) {
    console.log(c.red(`${s.total} drifted · ${s.safe} auto-fixable · ${s.review} need --all · ${s.manual} manual`))
    if (flags.report) await writeReport(flags.report, abs, report, [], s)
    return 1
  }

  const chosen = report.findings.filter((f) => f.patch && (f.safety === 'safe' || flags.all))
  const ydoc = YAML.parseDocument(raw)
  const { applied, skipped } = applyToYaml(ydoc, chosen)

  if (flags.ai) {
    await aiPass(doc, raw, report, flags)
  }

  const held = report.findings.length - applied.length
  if (!applied.length && !flags.ai) {
    console.log(c.yellow(`nothing applied · ${held} finding(s) need --all or a hand`))
    if (flags.report) await writeReport(flags.report, abs, report, applied, s)
    return 1
  }

  ydoc.setIn(
    ['info', 'x-meldr'],
    ydoc.createNode({ healedAt: new Date().toISOString(), source: report.source, applied: applied.length }),
  )
  // match the file or every flow collection and $ref reflows
  const singleQuote = (raw.match(/: '/g) ?? []).length >= (raw.match(/: "/g) ?? []).length
  const next = ydoc.toString({ lineWidth: 0, flowCollectionPadding: false, singleQuote })

  if (flags.diff) {
    printDiff(raw, next)
    console.log(c.dim(`  ${applied.length} fix(es), nothing written. drop --diff to apply`))
    return 0
  }
  await writeFile(abs, next)

  console.log(`${c.green('✓')} healed ${c.bold(path.relative(process.cwd(), abs) || abs)}, ${applied.length} fix(es) applied`)
  if (skipped.length) console.log(c.dim(`  ${skipped.length} patch(es) would not apply cleanly`))
  if (held) console.log(c.dim(`  ${held} held back · rerun with --all to take the risky ones too`))
  if (!flags.nested) {
    console.log('')
    console.log(c.dim('next'))
    console.log(c.dim('  git diff contracts/    # read what it changed before you trust it'))
    console.log(c.dim('  meldr verify           # should be green now'))
  }
  if (flags.report) await writeReport(flags.report, abs, report, applied, s)
  return 0
}

function printDiff(before, after) {
  const a = before.split(/\r?\n/)
  const b = after.split(/\r?\n/)
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  console.log('')
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      console.log(c.red(`- ${a[i++]}`))
    } else {
      console.log(c.green(`+ ${b[j++]}`))
    }
  }
  while (i < a.length) console.log(c.red(`- ${a[i++]}`))
  while (j < b.length) console.log(c.green(`+ ${b[j++]}`))
}

function printFindings(findings) {
  const width = Math.min(Math.max(...findings.map((f) => f.op.length), 2), 42)
  for (const f of findings) {
    const tag = f.patch ? (f.safety === 'safe' ? c.green('FIX ') : c.yellow('RISK')) : c.red('HAND')
    console.log(`${pad(f.op, width)}  ${tag} ${pad(f.at, 24)} ${c.dim(f.detail)}`)
  }
}

async function writeReport(file, contract, report, applied, summary) {
  const out = {
    contract,
    source: report.source,
    checkedAt: new Date().toISOString(),
    summary,
    applied: applied.length,
    unreachable: report.unreachable,
    covered: report.covered ?? [],
    findings: report.findings.map((f) => ({ kind: f.kind, op: f.op, at: f.at, detail: f.detail, safety: f.safety, patchable: Boolean(f.patch) })),
  }
  await writeFile(path.resolve(file), JSON.stringify(out, null, 2) + '\n')
  console.log(c.dim(`  drift report -> ${file}`))
}

// mutates doc in place
async function aiPass(doc, raw, report, flags) {
  const manual = report.findings.filter((f) => !f.patch)
  if (!manual.length) return
  const session = resolveSession({ provider: flags.provider ?? 'openai', baseUrl: flags['base-url'] })
  console.error(c.dim(`  ${manual.length} finding(s) left, asking ${session.provider} (${session.baseUrl}), key stays in memory`))

  const ctx = `current spec:\n${raw}\n\ndrift meldr could not patch deterministically:\n${manual.map((f) => `${f.op} ${f.at}: ${f.detail}`).join('\n')}`
  const out = await session.chat({ system: HEAL_PROMPT, user: ctx.slice(0, 60000), model: flags.model })
  const clean = String(out).replace(/^```(?:json|yaml)?/m, '').replace(/```\s*$/m, '').trim()
  const start = clean.indexOf('{')
  const end = clean.lastIndexOf('}')
  if (start === -1 || end === -1) throw new CliError('healer did not return JSON')

  let healed
  try {
    healed = JSON.parse(clean.slice(start, end + 1))
  } catch (e) {
    throw new CliError(`could not parse healed spec: ${e.message}`)
  }
  if (!healed.paths || typeof healed.paths !== 'object') throw new CliError('healed spec has no paths')
  // only paths get taken from the model, info/servers/components stay ours
  doc.paths = healed.paths
  console.log(c.yellow('  those paths came from a model, read every one before shipping'))
}
