import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { STARTER_CONTRACT } from '../config.js'
import { CliError, c } from '../ui.js'

export async function cmdInit(flags, args) {
  const target = path.resolve(args[0] ?? '.')
  const name = path.basename(target) || 'meldr-api'
  const cfgPath = path.join(target, 'meldr.yaml')
  const contractPath = path.join(target, 'contracts', 'api.yaml')

  const conflicts = [cfgPath, contractPath].filter((f) => existsSync(f))
  if (conflicts.length && !flags.force) {
    throw new CliError(
      `project already exists in ${target} (${conflicts.map((f) => path.basename(f)).join(', ')})`,
      'use --force to overwrite meldr-managed files',
    )
  }

  await mkdir(path.join(target, 'contracts'), { recursive: true })
  await writeFile(cfgPath, YAML.stringify({ name, contract: 'contracts/api.yaml', port: 3000, cors: false }))
  await writeFile(contractPath, STARTER_CONTRACT.split('__NAME__').join(name))

  const gitignore = path.join(target, '.gitignore')
  if (!existsSync(gitignore)) {
    await writeFile(gitignore, 'node_modules/\nserver.mjs\n.env\n')
  }

  console.log(`${c.green('✓')} created ${c.bold('meldr.yaml')}`)
  console.log(`${c.green('✓')} created ${c.bold('contracts/api.yaml')} (starter contract: GET /ping)`)
  console.log('')
  console.log(c.dim('next'))
  console.log(`  meldr serve            # /ping goes live instantly`)
  console.log(`  curl localhost:3000/ping`)
  console.log(`  meldr pull <file|url>  # replace a real API from its OpenAPI contract`)
  return 0
}
