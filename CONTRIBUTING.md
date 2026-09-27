contributing

You need Node 20 or newer. Clone the repo, run `npm install`, then `npm test`.
There is no build step, the source is plain ESM.

To try a change locally, run `npm link`, make a demo directory, then start it
with `meldr init && meldr serve &`. `meldr verify` exercises the mock against
the contract.

Please keep dependencies light. A new one needs a concrete reason, and bug fixes
should come with a regression test. Output stays deterministic unless a user opts
into randomness. Windows, macOS and Linux all need to work; CI runs on all three.

Branch pull requests from `main` and keep each one to a single change. Make sure
`npm test` passes, then say what changed and how you checked it. Update the README
and changelog when user-facing behavior changes.

For a bug report, include what you ran, what you expected, what happened instead,
and the smallest contract file that reproduces it.

Please dont report security bugs in public issues. See [SECURITY.md](SECURITY.md)
for the private reporting link.
