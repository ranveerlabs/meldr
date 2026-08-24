<div align="center">

```
  ╔╦╗╔═╗╔╗ ╔═╗╦╔═
   ║ ║╣ ╠╩╗╠═╝╠╩╗
   ╩ ╚═╝╚═╝╩  ╩ ╩
```

**Wire-compatible API replacements without the rebuild.**

Point meldr at any OpenAPI contract and get a faithful replacement server
instantly — then customize only what you care about, and *prove* compatibility
before you ship.

[![CI](https://github.com/ranveerlabs/meldr/actions/workflows/ci.yml/badge.svg)](https://github.com/ranveerlabs/meldr/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-20%2B-green.svg)](package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

Replacing an existing API today means rebuilding everything from scratch — or
hand-rolling a half-trusted fake and hoping it matches. **meldr** collapses
that into three commands:

| Command   | What it does                                                        |
| --------- | ------------------------------------------------------------------- |
| `pull`    | Ingest any OpenAPI 3.x contract into your project                   |
| `serve`   | Instantly run a wire-compatible replacement of that API             |
| `gen`     | Emit a standalone server you own, with editable handler stubs       |
| `verify`  | Prove your implementation still honors the contract                 |
| `draft`   | BYOK: bootstrap a contract from a description using your own AI key |

The contract does all the heavy lifting: routes, status codes, required
inputs, response shapes, and examples become working behavior on day zero.
You rebuild nothing — unless you want to.

## Quickstart

```bash
# 1. create a project (starter contract included)
mkdir shop && cd shop
meldr init

# 2. serve it — /ping is already live
meldr serve &
curl localhost:3000/ping
# {"status":"ok"}

# 3. replace a real API from its published contract
meldr pull https://raw.githubusercontent.com/ranveerlabs/meldr/main/testdata/petstore.yaml
meldr serve &
curl localhost:3000/v1/pets/42

# 4. prove it
meldr verify
# GET    /v1/pets        200  PASS
# POST   /v1/pets        201  PASS
# GET    /v1/pets/{id}   200  PASS
# DELETE /v1/pets/{id}   204  PASS
#
# 4 passed · 0 failed · 0 warnings

# 5. own it — generate a standalone server and edit handlers at your pace
meldr gen
node server.mjs
```

## Install

Requires Node.js 20+.

```bash
npm install -g github:ranveerlabs/meldr
meldr --version
```

Or from source:

```bash
git clone https://github.com/ranveerlabs/meldr && cd meldr
npm link
```

## How compatibility works

1. **Contract in.** `meldr pull` accepts a local file or URL, validates it,
   and normalizes it into `contracts/api.yaml`.
2. **Replacement out.** `meldr serve` mounts every declared server prefix,
   matches templated paths (`/pets/{id}`), enforces required inputs with real
   `400`s, returns exactly the status codes the contract declares, and fills
   responses example-first, falling back to deterministic schema synthesis —
   so output is stable across restarts and CI runs.
3. **Escape hatch.** `meldr gen` writes a single dependency-free `server.mjs`
   that already behaves like the API. Every route has an async handler stub;
   return a value to take over a route, return nothing to keep the faithful
   fallback. Rebuild everything, or just one endpoint. Your call.
4. **Proof.** `meldr verify` replays every operation against any running
   server (yours, the generated one, the real upstream) and asserts statuses
   and response shapes against the contract. Exit code non-zero on drift —
   drop it into CI as a compatibility gate.

### Power details developers thank you for

```bash
curl localhost:3000/v1/pets -H "X-Meldr-Status: 404"   # force a declared response
curl localhost:3000/__meldr/routes                      # introspect mounted routes
curl localhost:3000/__meldr/contract                    # served contract
meldr serve --cors                                      # permissive CORS for local frontends
meldr verify --base http://localhost:8080               # verify against ANY implementation
```

## The CLI

```
meldr init [dir]          scaffold a project with a starter contract
meldr pull <file|url>     ingest and validate an OpenAPI 3.x contract
meldr serve [--port N] [--cors]   run the compatible replacement
meldr gen [--out f.mjs] [--force] generate a standalone editable server
meldr verify [--base url] [--prefix p] [--insecure]  contract conformance check
meldr version | help
```

Project settings live in `meldr.yaml` (created by `init`):

```yaml
name: shop
contract: contracts/api.yaml
port: 3000
cors: false
```

## Privacy & keys (BYOK)

meldr is local-first and session-only by design:

- **No accounts, no telemetry, no phone-home.** Everything runs on your machine.
- **Bring your own keys.** The optional `meldr draft` command uses *your* AI
  provider key, read from your environment (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
  or `MELDR_*_KEY`). meldr never asks you to paste a key into a file.
- **Session-only secrets.** Keys live in process memory for the lifetime of the
  single command that uses them. They are never written to disk, never cached,
  never logged — and they are scrubbed (`[redacted]`) from every error message.
- **One outbound call, to whom you choose.** `draft` talks only to the provider
  base URL you configure (`--base-url` to point at a gateway or self-hosted
  endpoint). Nothing else in meldr makes network requests except `pull`/`verify`
  against URLs *you* pass.

```bash
export OPENAI_API_KEY=sk-...        # or ANTHROPIC_API_KEY / MELDR_OPENAI_KEY
cat curls.txt | meldr draft -       # description + curl samples → OpenAPI draft
meldr serve                         # draft is instantly runnable
```

AI drafts are marked `x-meldr.draft: true` and are starting points — review,
then prove with `verify`.

## Design principles

- **Dead simple.** Four verbs. One config file. No plugins, no daemons.
- **Zero build step.** Plain ESM JavaScript; the generated servers have
  literally zero dependencies.
- **Deterministic by default.** Same contract in, same bytes out.
- **Boring where it counts.** Minimal dependencies, exhaustive tests,
  cross-platform CI (Linux, macOS, Windows).

## Roadmap

- [ ] `meldr diff` — breaking-change detection between two contract versions
- [ ] `meldr record` — capture live traffic to sharpen response fidelity
- [ ] `meldr shadow` — mirror production traffic and diff your replacement
- [ ] More `gen` targets (Go, Python SDK-compatible servers)
- [ ] Contract coverage report: which endpoints/branches your impl exercises

## FAQ

**Is this just another mock server?**
Mock servers stop at "looks right." meldr is built for *replacement*: strict
input enforcement, exact declared status codes, verifiable conformance, and a
gradual ownership path via generated handlers.

**Does it proxy my traffic?**
No. meldr never touches your data plane. It reads contracts you point it at.

**Can I use it against APIs without an OpenAPI spec?**
Today meldr needs OpenAPI 3.x. Traffic capture (`record`) is on the roadmap
to bootstrap contracts where none exist.

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Keep it
simple; that's the whole trick.

## License

[Apache License 2.0](LICENSE) © meldr contributors
