contributing

node 20+, clone it, npm install, npm test. thats the whole setup, theres no
build step and the source is plain ESM

to try a change, npm link the package, make a demo dir somewhere, then
`meldr init && meldr serve &` and poke at it with meldr verify

things the project actually cares about. no build step. few dependencies and a
new one needs a real argument behind it. bug fixes come with a regression test.
output stays deterministic unless you opt into randomness on purpose.
windows/macos/linux all have to work, ci runs all three so dont guess

prs branch off main, one change each, npm test green. say what you did and how
you checked it. readme.md and changelog.md move when user-facing behavior moves

for a bug, open an issue with what you ran, what you expected, what actually
happened, and the smallest contract file that does it

security stuff doesnt go in a public issue, security.md has the details
