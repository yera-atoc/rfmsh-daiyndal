// НЗМ / БИЛ / IELTS / TOEFL сынақтары. GET ?cat= — тізім; GET ?cat=&id= — мазмұн; POST — тексеру.
// Толық нұсқа тек сатып алынған токенмен ашылады; demo=1 — кез келгенге қысқа үлгі.
'use strict'
const C = require('./_lib/core')
const supa = require('./_lib/supa')
const X = require('./_lib/exams')

const CATS = ['nzm', 'bil', 'ielts', 'toefl']

module.exports = async (req, res) => {
  const cat = String(req.query.cat || '')
  if (!CATS.includes(cat)) return C.send(res, 404, { error: 'not_found' })
  if (!supa.configured()) return C.send(res, 200, { tests: [], configured: false })
  const bt = cat === 'nzm' || cat === 'bil'
  try {
    const all = bt ? await X.btExams(cat) : await X.englishTests(cat)
    const id = String(req.query.id || '')
    if (!id) return C.send(res, 200, { tests: all.map(bt ? X.btSummary : X.enSummary), configured: true })

    const t = all.find((x) => String(x.id) === id)
    if (!t) return C.send(res, 404, { error: 'not_found' })
    // Демо тек бірінші (ең соңғы) нұсқадан
    const demo = req.query.demo === '1'
    if (demo && t !== all[0]) return C.send(res, 403, { error: 'locked' })
    if (!demo && !C.has(C.readToken(C.bearer(req)), cat)) return C.send(res, 403, { error: 'locked' })

    if (req.method === 'GET') return C.send(res, 200, bt ? await X.btContent(t, demo) : await X.enContent(t, demo))
    if (req.method === 'POST') {
      const b = await C.body(req)
      return C.send(res, 200, bt ? X.btScore(t, b.answers, demo) : X.enScore(t, b.answers, demo))
    }
    return C.send(res, 405, { error: 'method' })
  } catch (e) {
    console.error(e)
    return C.send(res, 502, { error: 'source' })
  }
}
