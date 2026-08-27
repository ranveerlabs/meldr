import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import { loadConfig } from '../config.js'
import { fetchContract } from '../spec.js'
import { resolveSession } from '../session.js'
import { CliError, c } from '../ui.js'

const HEAL_PROMPT = `you are a self-healing api engine. compare the current openapi spec with drift reports or upstream changes.
output ONLY valid minified JSON representing the healed openapi spec (version 3.0.3) with all fixes merged.
format: {"openapi":"3.0.3","info":{...},"paths":{...},"servers":[{...}]}`

export async function cmdHeal(flags, args) {
  const { cfg, file: cfgFile } = await loadConfig(flags.config)
  const cPath = flags.contract ?? cfg?.contract ?? 'contracts/api.yaml'
  const abs = path.resolve(cfgFile ? path.dirname(cfgFile) : process.cwd(), cPath)

  let curRaw
  try {
    curRaw = await readFile(abs, 'utf8')
  } catch {
    throw new CliError(`meld contract not found at ${abs}`, 'run meldr init or meldr pull first')
  }

  const cur = yaml.load(curRaw)
  if (!cur || typeof cur !== 'object') throw new CliError('contract invalid')

  const upstream = flags.upstream ?? args[0]
  let diffCtx = ''

  if (upstream) {
    console.error(c.dim(`fetching upstream from ${upstream}`))
    const { raw: upRaw } = await fetchContract(upstream)
    diffCtx = `current spec:\n${curRaw}\n\nupstream spec:\n${upRaw}`
  } else if (flags.logs) {
    const l = await readFile(flags.logs, 'utf8')
    diffCtx = `current spec:\n${curRaw}\n\nruntime error logs / drift:\n${l}`
  } else {
    diffCtx = `current spec:\n${curRaw}\n\nauto-inspect: check for deprecated types, missing 2xx returns, or invalid schema shapes and heal them.`
  }

  const s = resolveSession({ provider: flags.provider ?? 'openai', baseUrl: flags['base-url'] })
  console.error(c.dim(`healing meld via ${s.provider} (${s.baseUrl})`))

  const raw = await s.chat({ system: HEAL_PROMPT, user: diffCtx.slice(0, 60000), model: flags.model })
  const clean = raw.replace(/^```(?:json|yaml)?/m, '').replace(/```\s*$/m, '').trim()
  const start = clean.indexOf('{')
  const end = clean.lastIndexOf('}')
  if (start === -1 || end === -1) throw new CliError('healer failed to output json')

  let healed
  try {
    healed = JSON.parse(clean.slice(start, end + 1))
  } catch (e) {
    throw new CliError(`parse error in healed spec: ${e.message}`)
  }

  healed['x-meldr-healed-at'] = new Date().toISOString()
  await writeFile(abs, yaml.dump(healed))

  const ops = healed.paths ? Object.keys(healed.paths).length : 0
  console.log(`${c.green('✓')} healed meld ${c.bold(healed.info?.title ?? 'api')} — ${ops} paths synced`)
  console.log(c.dim(`  meld is self-maintained & ready for verify`))
  return 0
}