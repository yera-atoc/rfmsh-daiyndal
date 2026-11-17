// Карта арқылы төлем: CloudPayments (Қазақстан). Карта деректері біздің серверге келмейді —
// оларды CloudPayments-тің виджеті қабылдайды. Біз төлемді тек серверден, API арқылы тексереміз.
// Баптау (Vercel → Environment Variables): CP_PUBLIC_ID, CP_API_SECRET, қажет болса CP_API_BASE.
'use strict'
const crypto = require('crypto')
const { productById } = require('./catalog')

const enabled = () => !!(process.env.CP_PUBLIC_ID && process.env.CP_API_SECRET)
const publicConfig = () => ({ card: enabled(), provider: 'cloudpayments', publicId: process.env.CP_PUBLIC_ID || '' })

/** Төлем нөмірі: <өнім>-<кездейсоқ>. Сомасы серверде өнімнің бағасымен тексеріледі. */
const newInvoice = (productId) => `${productId}-${crypto.randomBytes(8).toString('hex')}`
const INVOICE_RE = /^([a-z0-9]{2,20})-([0-9a-f]{16})$/

async function find(invoiceId) {
  const base = (process.env.CP_API_BASE || 'https://api.cloudpayments.ru').replace(/\/$/, '')
  const auth = 'Basic ' + Buffer.from(`${process.env.CP_PUBLIC_ID}:${process.env.CP_API_SECRET}`).toString('base64')
  for (const path of ['/v2/payments/find', '/payments/find']) {
    const r = await fetch(base + path, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ InvoiceId: invoiceId }) })
    if (r.status === 404) continue
    const j = await r.json().catch(() => null)
    if (j) return j
  }
  return null
}

async function verify(invoiceId) {
  if (!enabled()) return { ok: false, status: 503, error: 'card_disabled' }
  const m = INVOICE_RE.exec(invoiceId)
  const product = m && productById(m[1])
  if (!product) return { ok: false, status: 400, error: 'bad_invoice' }
  const j = await find(invoiceId)
  const t = j && j.Model
  if (!j || !j.Success || !t) return { ok: false, status: 402, error: 'not_paid' }
  const paid = ['Completed', 'Authorized'].includes(t.Status)
  if (!paid || String(t.InvoiceId) !== invoiceId || Number(t.Amount) !== product.price || (t.Currency && t.Currency !== 'KZT')) {
    return { ok: false, status: 402, error: 'not_paid' }
  }
  return { ok: true, product, invoiceId }
}

module.exports = { enabled, publicConfig, newInvoice, verify }
