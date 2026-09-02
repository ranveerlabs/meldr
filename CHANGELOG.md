changelog
---------

0.1.0, first one
- meldr init, scaffold a project with a starter contract
- meldr pull, ingest an OpenAPI 3.x contract (file or URL)
- meldr serve, run a wire-compatible replacement server
- meldr gen, generate a standalone editable server
- meldr verify, prove your implementation honors the contract
- meldr draft, BYOK: draft a contract from a description via your own AI key
- meldr heal, self-maintain: pull the contract back onto the live api or an
  upstream spec. deterministic patches first (type drift, undeclared fields,
  undeclared statuses, moved success codes), --ai only for the leftovers
- meldr verify --heal, verify, fix the stale contract, re-verify, one command
- meldr heal --check, writes nothing, exits 1 on drift, for CI
- mock bodies vary across array elements and take a hint from the field name,
  duration_ms is 213000 not 1 and available_markets is [US, GB] not [meldr,
  meldr]. same values out of serve and gen, theres a test on that now
