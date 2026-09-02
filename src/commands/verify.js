import { loadConfig, contractPath, servePort } from '../config.js'
import { loadSpec } from '../spec.js'
import { runVerify, printReport } from '../verify.js'
import { cmdHeal } from './heal.js'
import { CliError, c } from '../ui.js'

export async function cmdVerify(flags) {
  const { config } = await loadConfig(flags.config)
  const file = contractPath(config, flags.contract)
  const base = flags.base ?? `http://localhost:${servePort(config)}`
  const opts = { base, prefix: flags.prefix, timeoutMs: (flags.timeout ?? 10) * 1000 }

  if (flags.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

  let spec = await load(file)
  console.log(`verifying ${c.bold(spec.title)} against ${base}`)
  console.log('')
  let rows = await runVerify(spec, opts)
  let failed = printReport(rows)
  if (!failed) return 0

  if (!flags.heal) {
    console.log('')
    console.log(c.dim('  if the implementation is right and the contract is stale, `meldr verify --heal` fixes it'))
    return 1
  }

  console.log('')
  const healed = await cmdHeal({ ...flags, base, heal: undefined, nested: true }, [])
  if (healed !== 0) return 1

  spec = await load(file)
  console.log('')
  console.log(`re-verifying ${c.bold(spec.title)} against ${base}`)
  console.log('')
  rows = await runVerify(spec, opts)
  failed = printReport(rows)
  if (failed && !flags.all) console.log(c.dim('  still red · `meldr verify --heal --all` takes the destructive fixes too'))
  else if (failed) console.log(c.dim('  what is left is a real difference, not a stale contract'))
  return failed ? 1 : 0
}

async function load(file) {
  try {
    return await loadSpec(file)
  } catch (e) {
    if (e && e.code === 'ENOENT') throw new CliError('contract not found', 'run `meldr pull <file-or-url>` first')
    throw e
  }
}
