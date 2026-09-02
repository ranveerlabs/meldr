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