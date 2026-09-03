import { CliError, c, die, setColorMode } from './ui.js'
import { cmdInit } from './commands/init.js'
import { cmdPull } from './commands/pull.js'
import { cmdServe } from './commands/serve.js'
import { cmdGen } from './commands/gen.js'
import { cmdVerify } from './commands/verify.js'
import { cmdDraft } from './commands/draft.js'
import { cmdHeal } from './commands/heal.js'
import { cmdRecord } from './commands/record.js'
import { cmdDemo } from './commands/demo.js'

export const VERSION = '0.1.0'

const COMMANDS = {
  demo: {
    summary: 'red to green on a throwaway petstore, nothing to set up',
    usage: 'meldr demo [dir] [--port N]',
    flags: { port: 'int' },
    run: cmdDemo,
  },
  init: {
    summary: 'scaffold a project with a starter contract',
    usage: 'meldr init [dir] [--force]',
    flags: { force: 'bool', config: 'string' },
    run: cmdInit,
  },
  pull: {
    summary: 'ingest an OpenAPI 3.x contract (file or URL)',
    usage: 'meldr pull <file-or-url> [--contract path]',
    flags: { contract: 'string', config: 'string' },
    run: cmdPull,
  },
  serve: {
    summary: 'run a wire-compatible replacement server',
    usage: 'meldr serve [--stateful] [--state-file f.json] [--require-auth] [--from rec.json] [--strict] [--port N]',
    flags: { stateful: 'bool', 'state-file': 'string', 'require-auth': 'bool', from: 'string', strict: 'bool', port: 'int', host: 'string', cors: 'bool', contract: 'string', config: 'string' },
    run: cmdServe,
  },
  gen: {
    summary: 'generate a standalone, dependency-free editable server',
    usage: 'meldr gen [--out file.mjs] [--force] [--contract path]',
    flags: { out: 'string', force: 'bool', contract: 'string', config: 'string' },
    run: cmdGen,
  },
  verify: {
    summary: 'verify a running implementation against the contract',
    usage: 'meldr verify [--heal] [--all] [--header "K: V"] [--param name=value] [--base url] [--concurrency N] [--timeout s] [--insecure]',
    flags: { heal: 'bool', all: 'bool', header: 'list', param: 'list', base: 'string', prefix: 'string', timeout: 'int', concurrency: 'int', insecure: 'bool', contract: 'string', config: 'string' },
    run: cmdVerify,
  },
  draft: {
    summary: 'BYOK: draft a contract from a description via your own AI key',
    usage: 'meldr draft <file-or-> [--provider openai|anthropic] [--model m] [--out path]',
    flags: { provider: 'string', model: 'string', out: 'string', 'base-url': 'string' },
    run: cmdDraft,
  },
  record: {
    summary: 'capture the real API so you can serve it back offline',
    usage: 'meldr record --base url [--out recording.json] [--header "K: V"] [--param n=v]',
    flags: {
      base: 'string',
      out: 'string',
      header: 'list',
      param: 'list',
      prefix: 'string',
      timeout: 'int',
      concurrency: 'int',
      insecure: 'bool',
      contract: 'string',
      config: 'string',
    },
    run: cmdRecord,
  },
  heal: {
    summary: 'self-maintain: pull the contract back onto the live api',
    usage: 'meldr heal [--check] [--diff] [--base url] [--upstream file-or-url] [--all] [--header "K: V"] [--param n=v]',
    flags: {
      check: 'bool',
      diff: 'bool',
      header: 'list',
      param: 'list',
      concurrency: 'int',
      insecure: 'bool',
      all: 'bool',
      ai: 'bool',
      base: 'string',
      prefix: 'string',
      timeout: 'int',
      upstream: 'string',
      report: 'string',
      provider: 'string',
      model: 'string',
      'base-url': 'string',
      contract: 'string',
      config: 'string',
    },
    run: cmdHeal,
  },
}

export function parseFlags(argv, specs = {}) {
  const flags = {}
  const positionals = []
  const known = Object.keys(specs)
    .map((k) => `--${k}`)
    .join(', ')
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-h' || a === '--help') {
      flags.help = true
      continue
    }
    if (!a.startsWith('--')) {
      if (a.startsWith('-') && a.length > 1) {
        throw new CliError(`unknown option "${a}"`, known ? `known options: ${known}` : undefined)
      }
      positionals.push(a)
      continue
    }
    let name = a.slice(2)
    let val
    const eq = name.indexOf('=')
    if (eq !== -1) {
      val = name.slice(eq + 1)
      name = name.slice(0, eq)
    }
    const kind = specs[name]
    if (!kind) {
      throw new CliError(`unknown option "--${name}"`, known ? `known options: ${known}` : undefined)
    }
    if (kind === 'bool') {
      flags[name] = val === undefined ? true : !(val === 'false' || val === '0')
      continue
    }
    if (val === undefined) {
      val = argv[++i]
      if (val === undefined) throw new CliError(`option "--${name}" requires a value`)
    }
    if (kind === 'list') {
      flags[name] = flags[name] ?? []
      flags[name].push(val)
      continue
    }
    if (kind === 'int') {
      const n = Number.parseInt(val, 10)
      if (!Number.isInteger(n)) throw new CliError(`option "--${name}" expects an integer, got "${val}"`)
      flags[name] = n
    } else {
      flags[name] = val
    }
  }
  return { flags, positionals }
}

function rootHelp() {
  console.log(`  ${c.cyan(c.bold('meldr'))}, wire-compatible API replacements without the rebuild`)
  console.log('')
  console.log('  Usage: meldr <command> [options]')
  console.log('')
  console.log('  Commands:')
  for (const [name, cmd] of Object.entries(COMMANDS)) {
    console.log(`    ${c.green(name.padEnd(9))}${cmd.summary}`)
  }
  console.log(`    ${c.green('version '.padEnd(9))}print the version`)
  console.log('')
  console.log('  Start here:')
  console.log('    meldr demo               # red to green on a throwaway petstore')
  console.log('')
  console.log('  Then:')
  console.log('    meldr init my-api && cd my-api')
  console.log('    meldr serve &')
  console.log('    meldr verify')
  console.log('')
  console.log('  Options:')
  console.log('    --color / --no-color     control colored output')
  console.log('    -h, --help               show help')
  console.log('')
  console.log('  Docs: https://github.com/ranveerlabs/meldr')
}

export async function main(argv) {
  const rest = []
  for (const a of argv ?? []) {
    if (a === '--color') setColorMode(true)
    else if (a === '--no-color') setColorMode(false)
    else rest.push(a)
  }

  if (!rest.length || rest[0] === '-h' || rest[0] === '--help' || rest[0] === 'help') {
    rootHelp()
    return 0
  }
  if (rest[0] === '-v' || rest[0] === '--version' || rest[0] === 'version') {
    console.log(`meldr ${VERSION}`)
    return 0
  }

  const command = COMMANDS[rest[0]]
  if (!command) {
    die(`unknown command "${rest[0]}"`, 'run `meldr --help` to see commands')
    return 1
  }

  try {
    const { flags, positionals } = parseFlags(rest.slice(1), command.flags)
    if (flags.help) {
      console.log(`  Usage: ${command.usage}`)
      return 0
    }
    return await command.run(flags, positionals)
  } catch (e) {
    if (e instanceof CliError) {
      die(e.message, e.hint)
      return 1
    }
    if (e && e.code === 'EADDRINUSE') {
      die('port already in use', 'pick another with --port')
      return 1
    }
    die(e && e.message ? e.message : String(e))
    console.error(c.dim('this looks like a bug, report it: https://github.com/ranveerlabs/meldr/issues'))
    return 1
  }
}
