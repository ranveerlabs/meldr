```
███    ███  ████████  ██       ████████   ███████
████  ████  ██        ██       ██     ██  ██    ██
██ ████ ██  ██████    ██       ██     ██  ███████
██  ██  ██  ██        ██       ██     ██  ██   ██ 
██      ██  ████████  ████████ ████████   ██    ██ 
```

meldr — wire-compatible API replacements without the rebuild

quickstart:
  npm install -g github:ranveerlabs/meldr
  mkdir demo && cd demo
  meldr init
  meldr serve &
  curl localhost:3000/ping
  # {"status":"ok"}

  meldr pull https://raw.githubusercontent.com/ranveerlabs/meldr/main/testdata/petstore.yaml
  meldr serve &
  curl localhost:3000/v1/pets/42
  # {"id":42,"name":"Rex","tag":"friendly","status":"available"}

  meldr verify
  # 4 passed · 0 failed

  meldr gen
  node server.mjs

commands:
  init     scaffold a project with a starter contract
  pull     ingest an OpenAPI 3.x contract (file or URL)
  serve    run a wire-compatible replacement server
  gen      generate a standalone, dependency-free editable server
  verify   verify a running implementation against the contract
  draft    BYOK: draft a contract from a description via your own AI key
  heal     self-maintain: auto-heal a meld from upstream drift or logs

config:
  meldr.yaml auto-generated on init:
    name: demo
    contract: contracts/api.yaml
    port: 3000
    cors: false

byok & zero leaks:
  keys from env only (OPENAI_API_KEY, ANTHROPIC_API_KEY, MELDR_*_KEY)
  in-memory only for the single command, never written to disk, never cached, never logged
  output auto-scrubs key material with [redacted]
  no telemetry, no tracking, pure local execution

license: apache-2.0