let mode

export function setColorMode(m) {
  mode = m
}

export function colorEnabled(stream = process.stdout) {
  if (mode === true) return true
  if (mode === false) return false
  if (process.env.NO_COLOR) return false
  if (process.env.FORCE_COLOR) return true
  return Boolean(stream.isTTY) && process.env.TERM !== 'dumb'
}

function paint(code, s) {
  return colorEnabled() ? `\x1b[${code}m${s}\x1b[0m` : String(s)
}

export const c = {
  red: (s) => paint(31, s),
  green: (s) => paint(32, s),
  yellow: (s) => paint(33, s),
  cyan: (s) => paint(36, s),
  bold: (s) => paint(1, s),
  dim: (s) => paint(2, s),
}

export class CliError extends Error {
  constructor(message, hint) {
    super(message)
    this.name = 'CliError'
    this.hint = hint
  }
}

export function die(message, hint) {
  console.error(`${c.red('meldr:')} ${message}`)
  if (hint) console.error(`${c.dim('hint:')} ${hint}`)
}

export function pad(s, width) {
  s = String(s)
  return s.length >= width ? s : s + ' '.repeat(width - s.length)
}
