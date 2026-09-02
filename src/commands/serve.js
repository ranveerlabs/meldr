import { readFile } from 'node:fs/promises'
import { loadConfig, servePort, contractPath } from '../config.js'
import { replayIndex, summarizeRecording } from '../record.js'
import { createStore } from '../state.js'
import { loadSpec } from '../spec.js'
import { createServer, routeList } from '../serve.js'
import { CliError, c, pad } from '../ui.js'

export async function cmdServe(flags, args, ctx) {
  const { config } = await loadConfig(flags.config)
  const spec = await loadSpecOrHint(contractPath(config, flags.contract))

  const port = servePort(config, flags.port)
  const host = flags.host ?? '127.0.0.1'
  const cors = flags.cors ?? config.cors === true

  let replay = null
  const from = flags.from ?? config.from
  if (from) {
    let rec
    try {
      rec = JSON.parse(await readFile(from, 'utf8'))
    } catch (e) {
      throw new CliError(`could not read recording ${from}: ${e.message}`, 'make one with `meldr record --base <url>`')
    }
    try {
      replay = replayIndex(rec)
    } catch (e) {
      throw new CliError(e.message)
    }
    const s = summarizeRecording(rec)
    console.log('')
    console.log(`  ${c.dim(`replaying ${from}, ${replay.size} of ${s.total} operations captured ${rec.recordedAt?.slice(0, 10) ?? ''}`)}`)
  }

  const stateful = flags.stateful ?? config.stateful === true
  const requireAuth = flags['require-auth'] ?? config.requireAuth === true
  const server = createServer(spec, { cors, replay, requireAuth, state: stateful ? createStore() : null })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })

  printBanner(spec, host, port, replay?.size ?? 0, stateful, requireAuth)

  await new Promise((resolve) => {
    const stop = () => {
      server.close(() => resolve())
      setTimeout(() => resolve(), 500).unref()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
  return 0
}

async function loadSpecOrHint(contractPath) {
  try {
    return await loadSpec(contractPath)
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      throw new CliError(`contract not found: ${contractPath}`, 'run `meldr pull <file-or-url>` first, or `meldr init` to start fresh')
    }
    throw e
  }
}

function printBanner(spec, host, port, replayed, stateful, requireAuth) {
  const routes = routeList(spec)
  console.log('')
  console.log(`  ${c.cyan(c.bold('meldr'))} serving ${c.bold(spec.title)} v${spec.version}`)
  console.log(`  ${c.dim('->')} http://${host}:${port}${spec.servers[0] === '/' ? '' : spec.servers[0]}`)
  console.log('')
  for (const r of routes) {
    console.log(`  ${c.green(pad(r.method, 7))}${c.dim(r.path)}${r.summary ? c.dim(`   ${r.summary}`) : ''}`)
  }
  console.log('')
  if (replayed) console.log(c.dim(`  replaying ${replayed} recorded operation(s), the rest fall back to the contract`))
  if (stateful) console.log(c.dim(`  stateful, writes survive until you stop the server`))
  if (requireAuth) console.log(c.dim(`  401 on anything without a credential, any value passes`))
  console.log(c.dim(`  introspection: /__meldr/routes · /__meldr/contract · /__meldr/health`))
  console.log(c.dim(`  curl -H "X-Meldr-Status: <code>" any endpoint forces a declared response`))
  console.log(c.dim(`  ^C to stop`))
  console.log('')
}
