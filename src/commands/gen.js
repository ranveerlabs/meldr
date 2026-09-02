import { loadConfig, contractPath } from '../config.js'
import { loadSpec } from '../spec.js'
import { generateServer } from '../gen.js'
import { CliError, c } from '../ui.js'
import path from 'node:path'

export async function cmdGen(flags) {
  const { config } = await loadConfig(flags.config)
  const spec = await loadSpec(contractPath(config, flags.contract)).catch((e) => {
    if (e && e.code === 'ENOENT') {
      throw new CliError(`contract not found: ${e.message}`, 'run `meldr pull <file-or-url>` first')
    }
    throw e
  })

  const out = path.resolve(flags.out ?? 'server.mjs')
  const written = await generateServer(spec, out, { force: flags.force === true })
  const routes = spec.operations.length * spec.servers.length
  console.log(`${c.green('✓')} wrote ${c.bold(path.relative(process.cwd(), written) || written)}`)
  console.log(`  ${routes} routes · zero dependencies · handlers fall back to contract-faithful mocks`)
  console.log('')
  console.log(c.dim(`next`))
  console.log(c.dim(`  node ${path.basename(written)}          # run it`))
  console.log(c.dim(`  edit the HANDLERS map to take over routes one by one`))
  console.log(c.dim(`  meldr verify --base http://localhost:3000   # prove compatibility either way`))
  return 0
}
