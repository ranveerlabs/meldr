import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'

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
    const parsed = yaml.load(readFileSync(file, 'utf8'))
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
