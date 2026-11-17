// Дүкен API: каталог, активация, РФМШ нұсқасын ашу, карта арқылы төлем (CloudPayments).
'use strict'
const { PRODUCTS, productById } = require('./_lib/catalog')
const C = require('./_lib/core')
const supa = require('./_lib/supa')
const ex = require('./_lib/exams')
const pay = require('./_lib/pay')
const LEGACY = require('./_data/rfmsh-keys.json').codes

module.exports = async (req, res) => {
  const a = String(req.query.a || '')
  try {
    if (req.method === 'GET' && a === 'catalog') return C.send(res, 200, await catalog(), { 'Cache-Control': 'public, max-age=60' })
    if (req.method !== 'POST') return C.send(res, 405, { error: 'method' })
    const b = await C.body(req)
    if (a === 'activate') return activate(req, res, b)
    if (a === 'unlock') return unlock(res, b)
    if (a === 'checkout') return checkout(req, res, b)
    if (a === 'claim') return claim(req, res, b)
    if (a === 'migrate') return migrate(req, res, b)
    return C.send(res, 404, { error: 'not_found' })
  } catch (e) {
    console.error(e)
    return C.send(res, 500, { error: 'server' })
  }
}

async function catalog() {
  const counts = {}
  if (supa.configured()) {
    const safe = async (k, fn) => { try { counts[k] = (await fn()).length } catch { counts[k] = 0 } }
    await Promise.all([safe('nzm', () => ex.btExams('nzm')), safe('bil', () => ex.btExams('bil')), safe('ielts', () => ex.englishTests('ielts')), safe('toefl', () => ex.englishTests('toefl'))])
  }
  counts.rfmsh = 15
  return {
    products: PRODUCTS.filter((p) => !p.hidden).map(({ id, cat, price, title, items, best }) => ({ id, cat, price, title, items, best: !!best })),
    counts,
    pay: pay.publicConfig(),
    whatsapp: process.env.WHATSAPP || '77773845920',
    // Онлайн карта төлемі қосылмаса — осы картаға аударым (Kaspi). Vercel-де TRANSFER_CARD арқылы ауыстыруға болады.
    transferCard: (process.env.TRANSFER_CARD || '4400430370817261').replace(/\D/g, ''),
  }
}

function activate(req, res, b) {
  if (C.limited(req, 'act', 10, 10 * 60_000)) return C.send(res, 429, { error: 'too_many' })
  const product = C.readLegacy(b.code) || C.readCode(b.code)
  if (!product) return C.send(res, 400, { error: 'bad_code' })
  const tok = C.grantProduct(C.readToken(b.token), product)
  return C.send(res, 200, { token: C.signToken(tok), product: product.id })
}

function unlock(res, b) {
  const tok = C.readToken(b.token)
  const id = Number(b.id)
  if (!(id >= 1 && id <= 15)) return C.send(res, 400, { error: 'bad_id' })
  if (C.rfOpen(tok, id)) return C.send(res, 200, { token: C.signToken(tok) })
  if (tok.c < 1) return C.send(res, 402, { error: 'no_credits' })
  return C.send(res, 200, { token: C.signToken({ g: tok.g, c: tok.c - 1, u: [...tok.u, id] }) })
}

function checkout(req, res, b) {
  if (!pay.enabled()) return C.send(res, 503, { error: 'card_disabled' })
  if (C.limited(req, 'co', 30, 10 * 60_000)) return C.send(res, 429, { error: 'too_many' })
  const p = productById(String(b.product || ''))
  if (!p || p.hidden) return C.send(res, 400, { error: 'bad_product' })
  const lang = b.lang === 'ru' ? 'ru' : 'kk'
  return C.send(res, 200, {
    invoiceId: pay.newInvoice(p.id),
    amount: p.price,
    currency: 'KZT',
    description: `Daiyndal: ${p.title[lang]}`,
    publicId: pay.publicConfig().publicId,
  })
}

async function claim(req, res, b) {
  if (C.limited(req, 'claim', 30, 10 * 60_000)) return C.send(res, 429, { error: 'too_many' })
  const r = await pay.verify(String(b.invoiceId || ''))
  if (!r.ok) return C.send(res, r.status || 402, { error: r.error })
  const tok = C.grantProduct(C.readToken(b.token), r.product)
  return C.send(res, 200, { code: C.makeCode(r.product.id, `inv:${r.invoiceId}`), token: C.signToken(tok), product: r.product.id })
}

// Бұрынғы сайтта (кодты браузер тексерген) белсендірілген кодтарды жаңа токенге көшіру.
// Браузерде сақталған код хэштері қабылданады, тек MIGRATE_UNTIL күніне дейін.
function migrate(req, res, b) {
  if (Date.now() > Date.parse(process.env.MIGRATE_UNTIL || '2027-06-30')) return C.send(res, 410, { error: 'expired' })
  if (C.limited(req, 'mig', 10, 10 * 60_000)) return C.send(res, 429, { error: 'too_many' })
  const hs = Array.isArray(b.hashes) ? [...new Set(b.hashes.map(String))].slice(0, 20) : []
  let tok = C.readToken(b.token)
  let n = 0
  for (const h of hs) {
    const c = LEGACY[h]
    if (!c) continue
    n++
    tok = c >= 15 ? C.grantProduct(tok, productById('rf15')) : C.grantProduct(tok, { grants: [], credits: c })
  }
  if (!n) return C.send(res, 400, { error: 'nothing' })
  return C.send(res, 200, { token: C.signToken(tok) })
}
