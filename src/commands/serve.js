import { loadConfig, servePort, contractPath } from '../config.js'
import { loadSpec } from '../spec.js'
import { createServer, routeList } from '../serve.js'
import { CliError, c, pad } from '../ui.js'

export async function cmdServe(flags, args, ctx) {
  const { config } = await loadConfig(flags.config)
  const spec = await loadSpecOrHint(contractPath(config, flags.contract))

  const port = servePort(config, flags.port)
  const host = flags.host ?? '127.0.0.1'
  const cors = flags.cors ?? config.cors === true

  const server = createServer(spec, { cors })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })

  printBanner(spec, host, port)

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

function printBanner(spec, host, port) {
  const routes = routeList(spec)
  console.log('')
  console.log(`  ${c.cyan(c.bold('meldr'))} serving ${c.bold(spec.title)} v${spec.version}`)
  console.log(`  ${c.dim('->')} http://${host}:${port}${spec.servers[0] === '/' ? '' : spec.servers[0]}`)
  console.log('')
  for (const r of routes) {
    console.log(`  ${c.green(pad(r.method, 7))}${c.dim(r.path)}${r.summary ? c.dim(`   ${r.summary}`) : ''}`)
  }
  console.log('')
  console.log(c.dim(`  introspection: /__meldr/routes · /__meldr/contract · /__meldr/health`))
  console.log(c.dim(`  curl -H "X-Meldr-Status: <code>" any endpoint forces a declared response`))
  console.log(c.dim(`  ^C to stop`))
  console.log('')
}
