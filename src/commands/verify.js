import { loadConfig, contractPath } from '../config.js'
import { loadSpec } from '../spec.js'
import { runVerify, printReport } from '../verify.js'
import { CliError, c } from '../ui.js'

export async function cmdVerify(flags) {
  const { config } = await loadConfig(flags.config)
  let spec
  try {
    spec = await loadSpec(contractPath(config, flags.contract))
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      throw new CliError(`contract not found`, 'run `meldr pull <file-or-url>` first')
    }
    throw e
  }

  if (flags.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

  const rows = await runVerify(spec, {
    base: flags.base ?? 'http://localhost:3000',
    prefix: flags.prefix,
    timeoutMs: (flags.timeout ?? 10) * 1000,
  })
  console.log(`verifying ${c.bold(spec.title)} against ${flags.base ?? 'http://localhost:3000'}`)
  console.log('')
  const failed = printReport(rows)
  return failed ? 1 : 0
}
