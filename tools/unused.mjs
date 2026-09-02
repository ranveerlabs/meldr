// dead imports pile up quietly, ci fails on them now
import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'

let found = 0
for (const file of globSync('src/**/*.js')) {
  const src = readFileSync(file, 'utf8')
  const names = []
  for (const line of src.split('\n')) {
    if (!line.startsWith('import ')) continue
    const braced = line.match(/^import \{([^}]+)\}/)
    if (braced) {
      for (const raw of braced[1].split(',')) {
        const n = raw.trim().split(/\s+as\s+/).pop().trim()
        if (n) names.push(n)
      }
      continue
    }
    const def = line.match(/^import ([A-Za-z_$][\w$]*) from/)
    if (def) names.push(def[1])
  }
  const body = src
    .split('\n')
    .filter((l) => !l.startsWith('import '))
    .join('\n')
  for (const n of names) {
    const re = new RegExp('(?<![\\w$.])' + n.replace(/\$/g, '\\$') + '(?![\\w$])')
    if (!re.test(body)) {
      console.log(`${file}: unused -> ${n}`)
      found++
    }
  }
}
console.log(found ? `${found} unused import(s)` : 'no unused imports')
process.exit(found ? 1 : 0)
