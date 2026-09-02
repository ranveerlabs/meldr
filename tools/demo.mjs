// records a real meldr run and writes assets/demo.svg
// node tools/demo.mjs
//
// spins up the drifted petstore, runs verify --heal --all against it, stamps
// every line with when it actually arrived, then replays it at reading speed.
// nothing here is typed by hand, if the output changes the svg changes
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const PORT = 4123
const OUT = 'assets/demo.svg'
const COMMAND = 'meldr verify --heal --all'

const PALETTE = { fg: '#c9d1d9', bold: '#f0f6fc', dim: '#6e7681', 31: '#ff7b72', 32: '#56d364', 33: '#e3b341', 36: '#39c5cf' }

const dir = mkdtempSync(path.join(tmpdir(), 'meldr-demo-'))
const demo = path.join(dir, 'demo')

await run(process.execPath, ['bin/meldr.js', 'init', demo, '--no-color'])
copyFileSync('testdata/petstore.yaml', path.join(demo, 'contracts', 'api.yaml'))

const server = spawn(process.execPath, ['testdata/drifted.mjs', String(PORT)], { stdio: 'ignore' })
await waitFor(`http://127.0.0.1:${PORT}/v1/pets`)

const lines = await capture(demo, ['../../bin/meldr.js'])
server.kill()

writeSvg(lines)

function run(cmd, args) {
  return new Promise((res, rej) => {
    const c = spawn(cmd, args, { stdio: 'ignore' })
    c.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${args.join(' ')} exited ${code}`))))
  })
}

async function waitFor(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`${url} never came up`)
}

function capture(cwd) {
  const bin = path.resolve('bin/meldr.js')
  return new Promise((resolve) => {
    const t0 = Date.now()
    const out = []
    let buf = ''
    const child = spawn(process.execPath, [bin, 'verify', '--heal', '--all', '--base', `http://localhost:${PORT}`], {
      cwd,
      env: { ...process.env, FORCE_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const onData = (d) => {
      buf += d.toString()
      let i
      while ((i = buf.indexOf('\n')) !== -1) {
        out.push({ t: (Date.now() - t0) / 1000, text: buf.slice(0, i).replace(/\r$/, '') })
        buf = buf.slice(i + 1)
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', () => {
      if (buf.length) out.push({ t: (Date.now() - t0) / 1000, text: buf })
      resolve(out)
    })
  })
}

// only the sgr codes meldr actually emits
function spans(line) {
  const out = []
  let color = null
  let bold = false
  let dim = false
  let i = 0
  const re = /\[(\d+)m/g
  let m
  while ((m = re.exec(line))) {
    if (m.index > i) out.push({ text: line.slice(i, m.index), color, bold, dim })
    const code = Number(m[1])
    if (code === 0) {
      color = null
      bold = false
      dim = false
    } else if (code === 1) bold = true
    else if (code === 2) dim = true
    else if (PALETTE[code]) color = code
    i = m.index + m[0].length
  }
  if (i < line.length) out.push({ text: line.slice(i), color, bold, dim })
  return out.filter((s) => s.text.length)
}

function writeSvg(cast) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const rows = [{ prompt: true, spans: [{ text: COMMAND, bold: true }] }]
  let prev = null
  for (const l of cast) {
    rows.push({ spans: spans(l.text), gap: prev !== null && l.t - prev > 0.03 })
    prev = l.t
  }

  // pacing for reading, not a measurement. the real elapsed is printed below
  const LINE = 0.13
  const PHASE = 0.5
  const HOLD = 3
  let t = 0.5
  const times = rows.map((r) => {
    if (r.gap) t += PHASE
    const at = t
    t += LINE
    return at
  })
  const total = t + HOLD

  const CH = 7.22
  const LH = 19
  const PAD = 18
  const TOP = 40
  const cols = Math.max(...rows.map((r) => r.spans.reduce((n, s) => n + s.text.length, 0)), COMMAND.length + 2)
  const W = Math.ceil(cols * CH + PAD * 2)
  const H = Math.ceil(rows.length * LH + TOP + PAD)

  const css = []
  const body = []
  rows.forEach((r, i) => {
    const on = ((times[i] / total) * 100).toFixed(3)
    css.push(`.r${i}{opacity:0;animation:r${i} ${total.toFixed(2)}s infinite}`)
    css.push(`@keyframes r${i}{0%,${on}%{opacity:0}${(Number(on) + 0.4).toFixed(3)}%,100%{opacity:1}}`)
    let x = PAD
    const parts = []
    if (r.prompt) {
      parts.push(`<tspan x="${PAD}" fill="${PALETTE[32]}">$ </tspan>`)
      x += 2 * CH
    }
    for (const s of r.spans) {
      const fill = s.color ? PALETTE[s.color] : s.dim ? PALETTE.dim : s.bold ? PALETTE.bold : PALETTE.fg
      parts.push(`<tspan x="${x.toFixed(1)}" fill="${fill}"${s.bold ? ' font-weight="600"' : ''}>${esc(s.text)}</tspan>`)
      x += s.text.length * CH
    }
    body.push(`<text y="${TOP + i * LH + 14}" class="r${i}">${parts.join('')}</text>`)
  })

  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(
    OUT,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="13">
<style>
${css.join('\n')}
text{white-space:pre}
</style>
<rect width="${W}" height="${H}" rx="8" fill="#0d1117"/>
<rect width="${W}" height="28" rx="8" fill="#161b22"/>
<rect y="20" width="${W}" height="8" fill="#161b22"/>
<circle cx="18" cy="14" r="5" fill="#ff5f57"/><circle cx="36" cy="14" r="5" fill="#febc2e"/><circle cx="54" cy="14" r="5" fill="#28c840"/>
${body.join('\n')}
</svg>
`,
  )
  console.log(`${OUT}  ${W}x${H}  ${rows.length} rows  loop ${total.toFixed(2)}s  real run ${cast[cast.length - 1].t}s`)
}
