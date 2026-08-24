# Changelog

All notable changes to meldr are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-24

### Added
- `meldr init` — scaffold a project with a starter contract.
- `meldr pull <file|url>` — ingest any OpenAPI 3.x contract into `contracts/`.
- `meldr serve` — instant wire-compatible replacement server driven by the
  contract: example-first responses, schema-faithful synthesis, declared
  status codes, `X-Meldr-Status` override header, optional CORS, and
  `/__meldr/*` introspection endpoints.
- `meldr gen` — emit a standalone, dependency-free `server.mjs` with editable
  handler stubs that fall back to contract-faithful mock behavior.
- `meldr verify` — replay every operation in the contract against a running
  server and assert status codes and response shapes; non-zero exit on drift.

[0.1.0]: https://github.com/ranveerlabs/meldr/releases/tag/v0.1.0
