import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import { loadConfig } from '../config.js'
import { fetchContract } from '../spec.js'
import { CliError, c } from '../ui.js'

export async function cmdPull(flags, args) {
  if (!args.length) throw new CliError('pull requires a source: meldr pull <file-or-url>', 'example: meldr pull https://example.com/openapi.yaml')

  const src = args[0]
  const { raw, spec } = await fetchContract(src)
  const { file: cfgFile, config } = await loadConfig()

  let dest
  if (flags.contract) {
    dest = path.resolve(flags.contract)
  } else if (cfgFile) {
    const configured = typeof config.contract === 'string' ? config.contract : null
    if (configured) {
      dest = path.resolve(path.dirname(cfgFile), configured)
    } else {
      dest = defaultDest(src, path.dirname(cfgFile))
    }
  } else {
    dest = defaultDest(src, process.cwd())
  }

  await mkdir(path.dirname(dest), { recursive: true })
  await writeFile(dest, raw)

  if (!cfgFile) {
    const name = String(spec.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'meldr-api'
    const cfgPath = path.resolve(process.cwd(), 'meldr.yaml')
    const rel = path.relative(path.dirname(cfgPath), dest).split(path.sep).join('/')
    await writeFile(cfgPath, yaml.dump({ name, contract: rel, port: 3000, cors: false }))
    console.log(`${c.green('✓')} created ${c.bold('meldr.yaml')}`)
  }

  console.log(`${c.green('✓')} pulled ${c.bold(spec.title)} v${spec.version}`)
  console.log(`  → ${dest}`)
  console.log(`  ${spec.operations.length} operations · servers: ${spec.servers.join(', ')}`)
  for (const w of spec.warnings) console.log(`  ${c.yellow('warning:')} ${w}`)
  console.log('')
  console.log(c.dim(`Next:`))
  console.log(c.dim(`  meldr serve     # replacement is live`))
  console.log(c.dim(`  meldr verify    # prove it matches the contract`))
  return 0
}

function defaultDest(src, dir) {
  const ext = /\.json$/i.test(src) ? 'json' : 'yaml'
  return path.resolve(dir, 'contracts', `api.${ext}`)
}
