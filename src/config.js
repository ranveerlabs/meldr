import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { CliError } from './ui.js'

export const CONFIG_NAME = 'meldr.yaml'

export async function loadConfig(explicit, cwd = process.cwd()) {
  if (explicit) {
    const file = path.resolve(explicit)
    if (!existsSync(file)) throw new Error(`config file not found: ${file}`)
    return { file, config: readConfigFile(file) }
  }
  let dir = cwd
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, CONFIG_NAME)
    if (existsSync(candidate)) return { file: candidate, config: readConfigFile(candidate) }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return { file: null, config: {} }
}

function readConfigFile(file) {
  try {
    const parsed = YAML.parse(readFileSync(file, 'utf8'))
    if (parsed === null || parsed === undefined) return {}
    if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('must be a mapping')
    return parsed
  } catch (e) {
    throw new Error(`could not read ${CONFIG_NAME}: ${e.message}`)
  }
}

export function contractPath(config, flagValue, cwd = process.cwd()) {
  const p = flagValue ?? (typeof config.contract === 'string' && config.contract ? config.contract : path.join('contracts', 'api.yaml'))
  return path.resolve(cwd, p)
}

export function servePort(config, flagValue) {
  const v = flagValue ?? Number(config.port ?? 3000)
  if (!Number.isInteger(v) || v < 0 || v > 65535) throw new Error(`invalid port: ${config.port}`)
  return v
}

// written as text not stringify, the commented blocks are how anyone finds out
// these knobs exist
export function configTemplate(name, contract, port = 3000) {
  return `name: ${name}
contract: ${contract}
port: ${port}
cors: false

# talking to a real api
# headers:
#   Authorization: Bearer \${API_TOKEN}
# params:
#   default: {limit: 5}
#   getThing: {id: real-id-here}

# meldr record captures one response per operation, list ids for more
# record:
#   base: https://api.example.com
#   cases:
#     getThing:
#       - {id: real-id-here}

# serve knobs, same as the flags
# stateful: true
# requireAuth: true
# from: recording.json
`
}

export const STARTER_CONTRACT = `openapi: 3.0.3
info:
  title: __NAME__ API
  version: 0.1.0
servers:
  - url: /
paths:
  /ping:
    get:
      operationId: ping
      summary: Health check
      responses:
        '200':
          description: Service is healthy.
          content:
            application/json:
              schema:
                type: object
                required: [status]
                properties:
                  status:
                    type: string
                    example: ok
              example:
                status: ok
`

// ${TOKEN} gets pulled from the env at run time so meldr.yaml stays commitable
function expand(v) {
  return String(v).replace(/\$\{(\w+)\}/g, (_, n) => {
    const got = process.env[n]
    if (!got) throw new CliError(`${n} is not set`, 'meldr.yaml wants it in your environment')
    return got
  })
}

export function headersFor(config, flagged = []) {
  const out = {}
  for (const [k, v] of Object.entries(config.headers ?? {})) out[k.toLowerCase()] = expand(v)
  for (const h of flagged) {
    const i = h.indexOf(':')
    if (i === -1) throw new CliError(`--header wants "Name: value", got "${h}"`)
    out[h.slice(0, i).trim().toLowerCase()] = expand(h.slice(i + 1).trim())
  }
  return out
}

// by operationId, or default for any param of that name
export function paramsFor(config, flagged = []) {
  const out = { default: {} }
  for (const [k, v] of Object.entries(config.params ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = { ...v }
  }
  for (const p of flagged) {
    const i = p.indexOf('=')
    if (i === -1) throw new CliError(`--param wants name=value, got "${p}"`)
    out.default[p.slice(0, i).trim()] = p.slice(i + 1)
  }
  return out
}

export function pinned(overrides, op, name) {
  const byId = overrides[op.id]
  if (byId && byId[name] !== undefined) return String(byId[name])
  const d = overrides.default
  if (d && d[name] !== undefined) return String(d[name])
  return undefined
}
