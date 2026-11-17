// Жергілікті сервер: статикалық файлдар + /api функциялары (Vercel-сіз тексеру үшін).
// Іске қосу: SHOP_SECRET=dev node scripts/dev.js  →  http://localhost:3000
'use strict'
const http = require('http')
const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.mp3': 'audio/mpeg', '.json': 'application/json' }

function handler(req, res) {
  const u = new URL(req.url, 'http://x')
  if (u.pathname.startsWith('/api/')) {
    const name = u.pathname.slice(5).replace(/[^a-z]/g, '')
    const file = path.join(ROOT, 'api', name + '.js')
    if (!name || !fs.existsSync(file)) { res.statusCode = 404; return res.end() }
    req.query = Object.fromEntries(u.searchParams)
    return Promise.resolve(require(file)(req, res)).catch((e) => { console.error(e); res.statusCode = 500; res.end() })
  }
  let p = decodeURIComponent(u.pathname)
  if (p.endsWith('/')) p += 'index.html'
  const f = path.join(ROOT, path.normalize(p))
  if (!f.startsWith(ROOT) || f.includes(`${path.sep}api${path.sep}`) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end('not found') }
  res.setHeader('Content-Type', TYPES[path.extname(f)] || 'application/octet-stream')
  fs.createReadStream(f).pipe(res)
}

if (require.main === module) http.createServer(handler).listen(process.env.PORT || 3000, () => console.log('http://localhost:' + (process.env.PORT || 3000)))
module.exports = { handler }
