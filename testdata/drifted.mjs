// petstore that moved on without telling the contract. ids went to strings,
// createdAt showed up, create answers 202 now
import http from 'node:http'

const port = Number(process.argv[2] ?? 4123)
const pet = (id) => ({ id: String(id), name: 'Rex', tag: 'friendly', status: 'available', createdAt: '2026-01-02T00:00:00Z' })

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

http
  .createServer((req, res) => {
    const u = new URL(req.url, 'http://x')
    if (u.pathname === '/v1/pets' && req.method === 'GET') return json(res, 200, [pet(1), pet(2)])
    if (u.pathname === '/v1/pets' && req.method === 'POST') return json(res, 202, { id: '9', name: 'New', status: 'available' })
    if (/^\/v1\/pets\/\d+$/.test(u.pathname) && req.method === 'GET') return json(res, 200, pet(1))
    if (/^\/v1\/pets\/\d+$/.test(u.pathname) && req.method === 'DELETE') {
      res.writeHead(204)
      return res.end()
    }
    json(res, 404, { code: 'nope', message: 'no such route' })
  })
  .listen(port, '127.0.0.1', () => console.log(`drifted petstore on ${port}`))
