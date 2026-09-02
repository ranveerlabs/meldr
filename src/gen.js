import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CliError } from './ui.js'

const TEMPLATE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'runtime', 'server.template.mjs')

function splitPath(p) {
  return p.split('/').filter((s) => s.length > 0)
}

function joinPath(a, b) {
  if (!a || a === '/') return b
  return a.replace(/\/+$/, '') + b
}

export function buildEmbed(spec) {
  const routes = []
  for (const prefix of spec.servers) {
    for (const op of spec.operations) {
      const fullPath = joinPath(prefix, op.path)
      routes.push({
        method: op.method,
        path: op.path,
        fullPath,
        segments: splitPath(fullPath),
        id: op.id,
        summary: op.summary,
        params: op.params.map((p) => ({ name: p.name, in: p.in, required: p.required })),
        body: op.body,
        responses: op.responses,
      })
    }
  }
  routes.sort((a, b) => (a.fullPath + a.method).localeCompare(b.fullPath + b.method))
  return {
    title: spec.title,
    version: spec.version,
    contract: spec.doc,
    basePath: spec.servers[0] ?? '/',
    routes,
  }
}

export function buildHandlers(embed) {
  const lines = []
  for (const r of embed.routes) {
    const label = r.summary ? `${r.id}, ${r.summary}` : r.id
    lines.push(`  '${r.method.toUpperCase()} ${r.fullPath}': async (ctx) => {`)
    lines.push(`    // ${label}`)
    lines.push(`    return undefined`)
    lines.push(`  },`)
  }
  return lines.join('\n')
}

export async function generateServer(spec, outFile, { force = false } = {}) {
  const target = path.resolve(outFile)
  if (!force && existsSync(target)) {
    throw new CliError(`refusing to overwrite ${target}`, 'pass --force to overwrite (keep the file in git first)')
  }
  const template = readFileSync(TEMPLATE_PATH, 'utf8')
  const embed = buildEmbed(spec)
  let code = template.split('__MELDR_CONTRACT__').join(JSON.stringify(embed))
  code = code.split('__MELDR_HANDLERS__').join(buildHandlers(embed))
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, code)
  return target
}
