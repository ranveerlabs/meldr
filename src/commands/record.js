import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { loadConfig, contractPath, headersFor, paramsFor } from '../config.js'
import { loadSpec } from '../spec.js'
import { runRecord, summarizeRecording } from '../record.js'
import { CliError, c, pad } from '../ui.js'

export async function cmdRecord(flags) {
  const { config } = await loadConfig(flags.config)
  const base = flags.base ?? config.record?.base
  if (!base) throw new CliError('record needs a --base to point at', 'meldr record --base https://api.example.com')

  let spec
  try {
    spec = await loadSpec(contractPath(config, flags.contract))
  } catch (e) {
    if (e && e.code === 'ENOENT') throw new CliError('contract not found', 'run `meldr pull <file-or-url>` first')
    throw e
  }

  if (flags.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

  console.log(`recording ${c.bold(spec.title)} from ${base}`)
  console.log('')

  const rec = await runRecord(spec, {
    base,
    prefix: flags.prefix,
    timeoutMs: (flags.timeout ?? 15) * 1000,
    concurrency: flags.concurrency ?? config.concurrency ?? 4,
    headers: headersFor(config, flags.header),
    params: paramsFor(config, flags.param),
    cases: config.record?.cases ?? {},
  })

  const width = Math.min(Math.max(...rec.entries.map((e) => e.label.length), 2), 44)
  for (const e of rec.entries) {
    const pinned = e.params ? c.dim(` ${JSON.stringify(e.params)}`) : ''
    if (e.error) {
      console.log(`${pad(e.label, width)}  ${c.red('DEAD')}      ${c.dim(e.error)}${pinned}`)
      continue
    }
    const tag = e.status >= 400 ? c.yellow(String(e.status)) : c.green(String(e.status))
    const size = typeof e.body === 'string' ? e.body.length : JSON.stringify(e.body ?? null).length
    console.log(`${pad(e.label, width)}  ${pad(tag, 4)} ${c.dim(`${size} bytes`)}${pinned}`)
  }

  const out = path.resolve(flags.out ?? 'recording.json')
  await writeFile(out, JSON.stringify(rec, null, 2) + '\n')

  const s = summarizeRecording(rec)
  console.log('')
  console.log(`${c.green('✓')} ${path.relative(process.cwd(), out) || out}, ${s.ok} ok · ${s.failed} error · ${s.dead} unreachable`)
  if (rec.scrubbed) console.log(c.yellow(`  ${rec.scrubbed} credential field(s) replaced with [scrubbed]`))
  console.log(c.dim('  read it before committing, a response body can hold more than you think'))
  console.log('')
  console.log(c.dim('next'))
  console.log(c.dim(`  meldr serve --from ${path.basename(out)}   # the real answers, no live dependency`))
  return s.ok ? 0 : 1
}
