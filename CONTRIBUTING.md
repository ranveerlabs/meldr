contributing to meldr

thanks for helping. this project stays dead simple:

development setup
- node.js 20+ and npm
- clone the repo and npm install
- run npm test

try your changes:
- npm link the package
- create a demo dir
- meldr init && meldr serve &
- test your changes, then meldr verify

ground rules
- no build step. source is plain ESM javascript
- minimal dependencies. new deps need strong justification
- tests required. bug fixes need regression tests
- deterministic output. no randomness without explicit opt-in
- works on windows/macOS/linux. ci enforces it

pull requests
- fork and branch from main
- keep prs focused, one change each
- ensure npm test passes
- write a clear description: what, why, how you verified
- update readme.md and changelog.md for new user-facing behavior

bug reporting
- open an issue with: what you ran, what you expected, what happened
- smallest contract file that reproduces it

security reports
- do not open public issues. see security.md.