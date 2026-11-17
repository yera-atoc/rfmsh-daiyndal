// Әкімші: қолмен сатылған тапсырыстарға код шығару, төлем нөмірі бойынша кодты қалпына келтіру.
// Құпия сөз тек серверде: Vercel → Environment Variables → ADMIN_PASSWORD.
'use strict'
const crypto = require('crypto')
const C = require('./_lib/core')
const { PRODUCTS, productById } = require('./_lib/catalog')
const pay = require('./_lib/pay')

function passOk(p) {
  const real = process.env.ADMIN_PASSWORD || ''
  if (real.length < 8 || typeof p !== 'string') return false
  const a = crypto.createHash('sha256').update(p).digest()
  const b = crypto.createHash('sha256').update(real).digest()
  return crypto.timingSafeEqual(a, b)
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return C.send(res, 405, { error: 'method' })
  if (C.limited(req, 'adm', 20, 15 * 60_000)) return C.send(res, 429, { error: 'too_many' })
  const b = await C.body(req)
  if (!passOk(b.password)) return C.send(res, 401, { error: 'auth' })

  if (b.a === 'products') return C.send(res, 200, { products: PRODUCTS.map((p) => ({ id: p.id, title: p.title.kk, price: p.price, hidden: !!p.hidden })) })

  if (b.a === 'codes') {
    const p = productById(String(b.product || ''))
    const n = Math.min(Math.max(Number(b.count) || 1, 1), 50)
    if (!p) return C.send(res, 400, { error: 'bad_product' })
    return C.send(res, 200, { product: p.id, codes: Array.from({ length: n }, () => C.makeCode(p.id)) })
  }

  if (b.a === 'invoice') {
    const r = await pay.verify(String(b.invoiceId || '').trim())
    if (!r.ok) return C.send(res, r.status || 400, { error: r.error })
    return C.send(res, 200, { product: r.product.id, code: C.makeCode(r.product.id, `inv:${r.invoiceId}`) })
  }

  if (b.a === 'check') {
    const p = C.readLegacy(b.code) || C.readCode(b.code)
    return C.send(res, 200, { valid: !!p, product: p ? p.id : null })
  }
  return C.send(res, 400, { error: 'bad_action' })
}
