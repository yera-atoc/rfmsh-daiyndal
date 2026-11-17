// Ортақ серверлік көмекшілер: HMAC, токен, кодтар, JSON жауап, қарапайым rate limit.
// Тәуелділік жоқ — тек Node.js crypto.
'use strict'
const crypto = require('crypto')
const { PRODUCTS, productById } = require('./catalog')

const DEV_SECRET = 'dev-only-secret-change-me'
function secret() {
  const s = process.env.SHOP_SECRET
  if (!s && process.env.VERCEL_ENV === 'production') throw new Error('SHOP_SECRET is not set')
  return s || DEV_SECRET
}

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')
const hmac = (purpose, data) => crypto.createHmac('sha256', `${purpose}:${secret()}`).update(data).digest()
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b)

// ── Қолжетімділік токені ─────────────────────────────────
// payload: { g: [грант], c: РФМШ нұсқа кредиті, u: [ашылған РФМШ нұсқалары], iat }
function signToken(p) {
  const body = b64u(JSON.stringify({ g: [...new Set(p.g || [])].sort(), c: p.c | 0, u: [...new Set(p.u || [])].sort((a, b) => a - b), iat: Date.now() }))
  return `${body}.${b64u(hmac('token', body))}`
}
function readToken(t) {
  const empty = { g: [], c: 0, u: [] }
  if (!t || typeof t !== 'string' || t.length > 4000) return empty
  const [body, sig] = t.split('.')
  if (!body || !sig || !safeEq(unb64u(sig), hmac('token', body))) return empty
  try {
    const p = JSON.parse(unb64u(body).toString('utf8'))
    return { g: Array.isArray(p.g) ? p.g : [], c: p.c | 0, u: Array.isArray(p.u) ? p.u : [] }
  } catch {
    return empty
  }
}
const has = (tok, grant) => tok.g.includes(grant) || tok.g.includes('all')
function rfOpen(tok, id) {
  return id === 16 || has(tok, 'rf') || tok.u.includes(id)
}
/** Өнімнің гранттарын токенге қосу */
function grantProduct(tok, product) {
  const g = [...tok.g, ...(product.grants || [])]
  return { g, c: tok.c + (product.credits || 0), u: tok.u }
}

// ── Активация кодтары ────────────────────────────────────
// 16 таңба (Crockford base32): 1 байт өнім + 5 байт кездейсоқ + 4 байт қолтаңба.
const ALPH = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
function b32(buf) {
  let bits = 0, val = 0, out = ''
  for (const b of buf) {
    val = (val << 8) | b; bits += 8
    while (bits >= 5) { out += ALPH[(val >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits) out += ALPH[(val << (5 - bits)) & 31]
  return out
}
function unb32(s) {
  let bits = 0, val = 0
  const out = []
  for (const ch of s) {
    const i = ALPH.indexOf(ch)
    if (i < 0) return null
    val = (val << 5) | i; bits += 5
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(out)
}
const normCode = (x) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V')

/** nonce берілмесе — кездейсоқ; берілсе (мысалы, төлем нөмірінен) — сол бойынша тұрақты код */
function makeCode(productId, nonceSeed) {
  const idx = PRODUCTS.findIndex((p) => p.id === productId)
  if (idx < 0) throw new Error('unknown product')
  const nonce = nonceSeed ? crypto.createHash('sha256').update(`nonce:${secret()}:${nonceSeed}`).digest().subarray(0, 5) : crypto.randomBytes(5)
  const head = Buffer.concat([Buffer.from([idx]), nonce])
  const raw = b32(Buffer.concat([head, hmac('code', head).subarray(0, 4)]))
  return raw.match(/.{4}/g).join('-')
}
function readCode(input) {
  const s = normCode(input)
  if (s.length !== 16) return null
  const buf = unb32(s)
  if (!buf || buf.length !== 10) return null
  const head = buf.subarray(0, 6)
  if (!safeEq(buf.subarray(6), hmac('code', head).subarray(0, 4))) return null
  return PRODUCTS[head[0]] || null
}

// Бұрынғы РФМШ кодтары (сайттың алғашқы нұсқасынан): h53 хэші → нұсқа саны
const LEGACY = require('../_data/rfmsh-keys.json').codes
function h53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}
function readLegacy(input) {
  const n = LEGACY[h53(String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '')).toString(36)]
  if (!n) return null
  return n >= 15 ? productById('rf15') : { id: `rf-legacy-${n}`, grants: [], credits: n }
}

// ── HTTP ─────────────────────────────────────────────────
function send(res, status, data, headers = {}) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  res.end(JSON.stringify(data))
}
async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') { try { return JSON.parse(req.body) } catch { return {} } }
  const chunks = []
  let size = 0
  for await (const c of req) { size += c.length; if (size > 200_000) return {}; chunks.push(c) }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { return {} }
}
const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || ''

// Бір инстанс ішіндегі шектеу (толық қорғаныс емес, бірақ код теруді баяулатады)
const hits = new Map()
function limited(req, key, max, windowMs) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'ip'
  const k = `${key}:${ip}`
  const now = Date.now()
  const arr = (hits.get(k) || []).filter((t) => now - t < windowMs)
  arr.push(now)
  hits.set(k, arr)
  if (hits.size > 5000) hits.clear()
  return arr.length > max
}

module.exports = { signToken, readToken, has, rfOpen, grantProduct, makeCode, readCode, readLegacy, normCode, send, body, bearer, limited, safeEq, hmac, b64u }
