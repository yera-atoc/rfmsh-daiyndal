// Supabase REST (тәуелділіксіз). Beles-тің базасы: bt_exams (НЗМ/БИЛ), ielts_tests (IELTS/TOEFL).
// Кілт тек серверде: Vercel → Settings → Environment Variables → SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
'use strict'

const URL_ = () => (process.env.SUPABASE_URL || '').replace(/\/$/, '')
const KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const configured = () => !!(URL_() && KEY())

async function rest(path) {
  const r = await fetch(`${URL_()}/rest/v1/${path}`, { headers: { apikey: KEY(), Authorization: `Bearer ${KEY()}` } })
  if (!r.ok) throw new Error(`supabase ${r.status}`)
  return r.json()
}

// 60 секундтық кэш: каталог бетін жиі ашқанда базаға артық сұраныс жібермеу үшін
const cache = new Map()
async function cached(key, fn, ms = 60_000) {
  const c = cache.get(key)
  if (c && Date.now() - c.t < ms) return c.v
  const v = await fn()
  cache.set(key, { t: Date.now(), v })
  return v
}

/** Supabase storage сілтемелеріне уақытша (1 сағ.) қолтаңба. Басқа сілтемелерге тимейді. */
const STORAGE_RE = /^https?:\/\/[^/]+\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/([^?#]+)/
async function signUrls(urls) {
  const out = {}
  const byBucket = {}
  for (const u of urls) {
    const m = u && STORAGE_RE.exec(u)
    if (m) (byBucket[m[1]] = byBucket[m[1]] || []).push([u, decodeURIComponent(m[2])])
  }
  for (const [bucket, list] of Object.entries(byBucket)) {
    const r = await fetch(`${URL_()}/storage/v1/object/sign/${bucket}`, {
      method: 'POST',
      headers: { apikey: KEY(), Authorization: `Bearer ${KEY()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 3600, paths: list.map((x) => x[1]) }),
    })
    if (!r.ok) continue
    const data = await r.json()
    data.forEach((d, i) => { if (d && d.signedURL) out[list[i][0]] = `${URL_()}/storage/v1${d.signedURL}` })
  }
  return out
}

module.exports = { configured, rest, cached, signUrls }
