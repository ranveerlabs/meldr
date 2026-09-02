import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import { resolveSession } from '../session.js'
import { CliError, c } from '../ui.js'

const SYSTEM_PROMPT = `You are a precise API-contract compiler. The user gives a description and/or curl examples of an HTTP API.
Respond with ONLY minified JSON, no markdown fences, matching:
{"name":string,"description":string,"operations":[{"method":"get"|"post"|"put"|"patch"|"delete","path":"/x/{id}","summary":string,"query":{"name":{"type":"string","required":false}},"pathParams":{"id":"integer"},"request":{"type":"object","properties":{...},"required":[...]},"responses":[{"status":200,"body":{"type":"object","properties":{...},"required":[...]}}]}]}
Rules: paths start with "/"; use {braces} for path params; statuses are integers; bodies are plain JSON Schema subsets (types: string/integer/number/boolean/array/object); omit unknown fields instead of inventing them.`

export async function cmdDraft(flags, args) {
  if (!args.length) throw new CliError('draft needs an input: meldr draft <file-or->', 'pass "-" to read stdin (e.g. cat curls.txt | meldr draft -)')
  const session = resolveSession({ provider: flags.provider ?? 'openai', baseUrl: flags['base-url'] })

  let input
  if (args[0] === '-') {
    input = await readStdin()
  } else {
    input = await readFile(args[0], 'utf8')
  }
  if (!input.trim()) throw new CliError('input is empty')

  console.error(c.dim(`  drafting contract via ${session.provider} (${session.baseUrl}), key stays in memory for this command only`))

  const raw = await session.chat({ system: SYSTEM_PROMPT, user: input.slice(0, 60000), model: flags.model })
  const parsed = extractJson(raw)

  const doc = toOpenApi(parsed)
  const out = path.resolve(flags.out ?? 'contracts/api.yaml')
  await mkdir(path.dirname(out), { recursive: true })
  await writeFile(out, yaml.dump(doc))

  const ops = doc.paths ? Object.keys(doc.paths).length : 0
  console.log(`${c.green('✓')} drafted ${c.bold(doc.info.title)}, ${ops} path(s) -> ${path.relative(process.cwd(), out) || out}`)
  console.log(c.yellow(`  drafts are a starting point, read every operation before you lean on it`))
  console.log(c.dim(`next`))
  console.log(c.dim(`  meldr serve      # see the draft running`))
  console.log(c.dim(`  meldr verify     # then prove it against the real thing`))
  return 0
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = []
    process.stdin.on('data', (d) => chunks.push(d))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    process.stdin.on('error', reject)
  })
}

function extractJson(text) {
  const cleaned = String(text).replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) throw new CliError('model did not return JSON', 'try again or switch providers with --provider')
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1))
    if (!Array.isArray(obj.operations)) throw new Error('missing operations[]')
    return obj
  } catch (e) {
    throw new CliError(`could not parse model output: ${e.message}`, 'retry, or tighten the input description')
  }
}

function toOpenApi(parsed) {
  const paths = {}
  for (const op of parsed.operations ?? []) {
    const method = String(op.method ?? 'get').toLowerCase()
    const p = String(op.path ?? '/')
    paths[p] = paths[p] ?? {}
    const parameters = []
    for (const [name, def] of Object.entries(op.pathParams ?? {})) {
      parameters.push({ name, in: 'path', required: true, schema: { type: def?.type ?? 'string' } })
    }
    for (const [name, def] of Object.entries(op.query ?? {})) {
      parameters.push({ name, in: 'query', required: def?.required === true, schema: { type: def?.type ?? 'string' } })
    }
    const responses = {}
    for (const r of op.responses ?? []) {
      const code = String(Number(r.status) || 200)
      responses[code] = r.body
        ? { description: r.description ?? 'Response.', content: { 'application/json': { schema: r.body } } }
        : { description: r.description ?? 'Response.' }
    }
    if (!Object.keys(responses).length) responses['200'] = { description: 'Response.' }
    const entry = { summary: op.summary ?? '', parameters, responses }
    if (op.request && method !== 'get' && method !== 'delete') {
      entry.requestBody = { required: true, content: { 'application/json': { schema: op.request } } }
    }
    paths[p][method] = entry
  }
  return {
    openapi: '3.0.3',
    info: {
      title: String(parsed.name ?? 'Drafted API'),
      version: '0.1.0-draft',
      description: String(parsed.description ?? ''),
      'x-meldr': { draft: true, generatedBy: 'meldr draft', provider: null },
    },
    servers: [{ url: '/' }],
    paths,
  }
}
