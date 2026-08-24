# Contributing to meldr

Thanks for helping make meldr better. This project aims to stay dead simple:
few dependencies, zero build steps, boring-but-excellent code.

## Development setup

Prerequisites: Node.js 20+ and npm.

```bash
git clone https://github.com/ranveerlabs/meldr && cd meldr
npm install
npm test          # node:test suite
node bin/meldr.js --help
```

Try your changes end-to-end:

```bash
npm link
mkdir /tmp/demo && cd /tmp/demo
meldr init && meldr serve &
meldr verify
```

## Ground rules

- **No build step.** Source ships as plain ESM JavaScript. If a feature needs
  a compiler, rethink the feature.
- **Minimal dependencies.** New runtime dependencies need strong justification
  in the PR description.
- **Tests required.** Bug fixes need a regression test; features need coverage
  of both happy paths and contract-drift cases.
- **Deterministic output.** Never introduce nondeterminism (time, randomness,
  map ordering) into served responses without an explicit opt-in flag.
- **Windows/macOS/Linux.** Everything must work on all three; CI enforces it.

## Pull requests

1. Fork and create a branch from `main`.
2. Keep PRs focused; one logical change per PR.
3. Ensure `npm test` passes locally.
4. Write a clear description: what, why, and how you verified it.
5. New user-facing behavior? Update `README.md` and `CHANGELOG.md`.

By submitting a PR you agree your contribution is licensed under the Apache
License 2.0, same as the rest of the project.

## Reporting bugs

Open an issue with the bug template: what you ran, what you expected, what
happened, and the smallest contract file that reproduces it.

## Reporting vulnerabilities

Do not open public issues for security reports — see [SECURITY.md](SECURITY.md).
