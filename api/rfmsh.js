// РФМШ нұсқалары: тапсырма беттері (тек ашылған нұсқаға) және жауапты серверде тексеру.
// Бұрын беттер мен дұрыс жауаптар HTML ішінде ашық тұрған — енді тек осы жерден беріледі.
'use strict'
const C = require('./_lib/core')
const KEYS = require('./_data/rfmsh-keys.json').keys
let PAGES = null
const pages = () => PAGES || (PAGES = require('./_data/rfmsh-pages.json'))

const pt = (v, i) => (v === 16 ? 1 : i < 10 ? 3 : i < 20 ? 5 : 7)

module.exports = async (req, res) => {
  const v = Number(req.query.v)
  if (!KEYS[v]) return C.send(res, 404, { error: 'not_found' })
  const tok = C.readToken(C.bearer(req))
  if (!C.rfOpen(tok, v)) return C.send(res, 403, { error: 'locked' })

  if (req.method === 'GET') {
    const list = pages()[v] || []
    const p = Number(req.query.p)
    if (!(p >= 0 && p < list.length)) return C.send(res, 200, { pages: list.length })
    res.statusCode = 200
    res.setHeader('Content-Type', 'image/jpeg')
    res.setHeader('Cache-Control', 'private, max-age=3600')
    return res.end(Buffer.from(list[p], 'base64'))
  }

  if (req.method === 'POST') {
    const b = await C.body(req)
    const ans = Array.isArray(b.a) ? b.a : []
    const key = KEYS[v]
    const lv = [[0, 0], [0, 0], [0, 0]]
    let sc = 0, ok = 0
    const rows = key.map((k, i) => {
      const a = ans[i] == null ? '' : String(ans[i]).slice(0, 12)
      const g = a !== '' && parseInt(a, 10) === k
      const p = g ? pt(v, i) : 0
      if (g) { ok++; sc += p; lv[Math.floor(i / 10) % 3][0]++; lv[Math.floor(i / 10) % 3][1] += p }
      return { a, k, p, ok: g }
    })
    return C.send(res, 200, { score: sc, max: v === 16 ? 10 : 150, ok, n: key.length, levels: lv, rows })
  }
  return C.send(res, 405, { error: 'method' })
}
