// node --test tests/  — серверлік логиканың тесттері (желісіз, Supabase пен CloudPayments жалған).
'use strict'
process.env.SHOP_SECRET = 'test-secret-1234567890'
const test = require('node:test')
const assert = require('node:assert')
const http = require('http')
const { handler } = require('../scripts/dev')
const C = require('../api/_lib/core')
const { PRODUCTS } = require('../api/_lib/catalog')
const KEYS = require('../api/_data/rfmsh-keys.json').keys

// ── жалған сыртқы сервистер ──
const BT = [{
  id: '2026-10', title: 'НЗМ қазан', group_id: 'nzm', month: '2026-10', practice: true,
  subjects: [{ id: 'math', name: 'Математика', max: 400, questions: 40, options: 4 }, { id: 'quant', name: 'Сандық', max: 300, questions: 60, options: 4 }],
  questions: { math: Array.from({ length: 40 }, (_, i) => ({ text: 'Q' + i, options: ['1', '2', '3', '4'] })), quant: [] },
  answer_key: { math: Array.from({ length: 40 }, () => 'B'), quant: Array.from({ length: 60 }, () => 'A') },
}]
const EN = [{
  id: 'u1', title: 'Beles Academic Mock 1', exam: 'ielts', variant: 'academic', mode: 'exam',
  content: {
    listening: { audio: '/ielts-media/beles-mock1-listening.mp3', minutes: 32, parts: [{ title: 'Part 1', groups: [{ type: 'gap', instructions: 'ONE WORD', items: [{ n: 1, prompt: 'Name ___', answer: 'Smith | smyth' }] }] }] },
    reading: { minutes: 60, passages: [{ title: 'P1', text: 'Text', groups: [{ type: 'tfng', instructions: '', items: [{ n: 1, prompt: 'S', answer: 'TRUE' }, { n: 2, prompt: 'S2', answer: 'NOT GIVEN' }] }] }] },
    writing: { minutes: 60, task1: { prompt: 'Describe', image: '/ielts-media/beles-mock1-task1.png', minWords: 150 }, task2: { prompt: 'Essay', minWords: 250 } },
  },
}]
let cpReply = null
const realFetch = global.fetch
global.fetch = async (url, opt) => {
  url = String(url)
  if (url.includes('/rest/v1/bt_exams')) return new Response(JSON.stringify(BT))
  if (url.includes('/rest/v1/ielts_tests')) return new Response(JSON.stringify(EN))
  if (url.includes('/storage/v1/object/sign')) return new Response('[]')
  if (url.includes('cloudpayments')) return new Response(JSON.stringify(cpReply(JSON.parse(opt.body))))
  return realFetch(url, opt)
}
process.env.SUPABASE_URL = 'https://x.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'

let base
test.before(() => new Promise((ok) => { const s = http.createServer(handler).listen(0, () => { base = 'http://127.0.0.1:' + s.address().port; s.unref(); ok() }) }))
const call = (p, { body, token } = {}) => realFetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => ({ status: r.status, json: r.headers.get('content-type')?.includes('json') ? await r.json() : null, type: r.headers.get('content-type') }))

test('token: signed, tamper-proof', () => {
  const t = C.signToken({ g: ['nzm'], c: 2, u: [3] })
  assert.deepStrictEqual(C.readToken(t), { g: ['nzm'], c: 2, u: [3] })
  const [b, s] = t.split('.')
  const forged = Buffer.from(JSON.stringify({ g: ['all'], c: 0, u: [] })).toString('base64url')
  assert.deepStrictEqual(C.readToken(forged + '.' + s).g, [])
  assert.deepStrictEqual(C.readToken(b + '.xx').g, [])
})

test('codes: every product round-trips, typos and forgeries rejected', () => {
  for (const p of PRODUCTS) {
    const code = C.makeCode(p.id)
    assert.match(code, /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/)
    assert.strictEqual(C.readCode(code).id, p.id)
    assert.strictEqual(C.readCode(code.toLowerCase().replace(/-/g, ' ')).id, p.id)
  }
  const c = C.makeCode('nzm')
  const flip = c.slice(0, -1) + (c.endsWith('0') ? '1' : '0')
  assert.strictEqual(C.readCode(flip), null)
  assert.strictEqual(C.makeCode('ielts', 'inv:a'), C.makeCode('ielts', 'inv:a'))
  assert.strictEqual(C.readLegacy('RF3-AAAA-BBBB'), null)
})

test('activate → token grants; unlock spends credits', async () => {
  const r = await call('/api/shop?a=activate', { body: { code: C.makeCode('rf3') } })
  assert.strictEqual(r.status, 200)
  let tok = r.json.token
  assert.strictEqual(C.readToken(tok).c, 3)
  const u = await call('/api/shop?a=unlock', { body: { token: tok, id: 5 } })
  tok = u.json.token
  assert.deepStrictEqual(C.readToken(tok), { g: [], c: 2, u: [5] })
  const bad = await call('/api/shop?a=activate', { body: { code: 'ABCD-EFGH-JKMN-PQRS' } })
  assert.strictEqual(bad.status, 400)
})

test('rfmsh: locked without access, demo is free, scoring matches original rules', async () => {
  assert.strictEqual((await call('/api/rfmsh?v=3')).status, 403)
  const img = await call('/api/rfmsh?v=16&p=0')
  assert.strictEqual(img.type, 'image/jpeg')
  const s = await call('/api/rfmsh?v=16', { body: { a: KEYS[16].map(String) } })
  assert.strictEqual(s.json.score, 10)
  const tok = C.signToken({ g: ['rf'] })
  const full = await call('/api/rfmsh?v=1', { body: { a: KEYS[1].map(String) }, token: tok })
  assert.strictEqual(full.json.score, 150)
  assert.deepStrictEqual(full.json.levels, [[10, 30], [10, 50], [10, 70]])
})

test('nzm: list public, content hides answers, demo limited, scoring by points', async () => {
  const l = await call('/api/exam?cat=nzm')
  assert.strictEqual(l.json.tests.length, 1)
  assert.deepStrictEqual(l.json.tests[0].subjects.map((s) => s.id), ['math'])
  assert.strictEqual((await call('/api/exam?cat=nzm&id=2026-10')).status, 403)
  const d = await call('/api/exam?cat=nzm&id=2026-10&demo=1')
  assert.strictEqual(d.json.subjects[0].questions.length, 5)
  assert.ok(!JSON.stringify(d.json).includes('answer_key'))
  const tok = C.signToken({ g: ['nzm'] })
  const full = await call('/api/exam?cat=nzm&id=2026-10', { token: tok })
  assert.strictEqual(full.json.subjects[0].questions.length, 40)
  const sc = await call('/api/exam?cat=nzm&id=2026-10', { token: tok, body: { answers: { math: Array(40).fill('B') } } })
  assert.strictEqual(sc.json.total, 400)
  assert.strictEqual(sc.json.max, 400)
})

test('ielts: answers stripped, media remapped, auto band', async () => {
  const tok = C.signToken({ g: ['ielts'] })
  const c = await call('/api/exam?cat=ielts&id=u1', { token: tok })
  assert.ok(!JSON.stringify(c.json).includes('Smith'))
  assert.strictEqual(c.json.listening.audio, '/media/beles-mock1-listening.mp3')
  assert.strictEqual(c.json.writing.task1.image, '/media/beles-mock1-task1.png')
  const sc = await call('/api/exam?cat=ielts&id=u1', { token: tok, body: { answers: { listening: { 1: 'smyth' }, reading: { 1: 't', 2: 'ng' } } } })
  assert.strictEqual(sc.json.sections.listening.raw, 1)
  assert.strictEqual(sc.json.sections.reading.raw, 2)
  assert.strictEqual(sc.json.sections.reading.band, 9)
  assert.strictEqual((await call('/api/exam?cat=toefl&id=u1', { token: tok })).status, 403)
})

test('payment: disabled without keys; verifies amount and status', async () => {
  assert.strictEqual((await call('/api/shop?a=checkout', { body: { product: 'nzm' } })).status, 503)
  process.env.CP_PUBLIC_ID = 'pk_test'; process.env.CP_API_SECRET = 'sec'
  const co = await call('/api/shop?a=checkout', { body: { product: 'nzm' } })
  assert.strictEqual(co.json.amount, 15000)
  const inv = co.json.invoiceId
  cpReply = (b) => ({ Success: true, Model: { InvoiceId: b.InvoiceId, Amount: 100, Currency: 'KZT', Status: 'Completed' } })
  assert.strictEqual((await call('/api/shop?a=claim', { body: { invoiceId: inv } })).status, 402)
  cpReply = (b) => ({ Success: true, Model: { InvoiceId: b.InvoiceId, Amount: 15000, Currency: 'KZT', Status: 'Declined' } })
  assert.strictEqual((await call('/api/shop?a=claim', { body: { invoiceId: inv } })).status, 402)
  cpReply = (b) => ({ Success: true, Model: { InvoiceId: b.InvoiceId, Amount: 15000, Currency: 'KZT', Status: 'Completed' } })
  const ok = await call('/api/shop?a=claim', { body: { invoiceId: inv } })
  assert.strictEqual(ok.status, 200)
  assert.ok(C.readToken(ok.json.token).g.includes('nzm'))
  assert.strictEqual(C.readCode(ok.json.code).id, 'nzm')
  const again = await call('/api/shop?a=claim', { body: { invoiceId: inv } })
  assert.strictEqual(again.json.code, ok.json.code)
  delete process.env.CP_PUBLIC_ID; delete process.env.CP_API_SECRET
})

test('materials: excerpt without grant, full with grant', async () => {
  const a = await call('/api/material?id=formulas')
  assert.strictEqual(a.json.open, false)
  assert.strictEqual(a.json.formulas.length, 8)
  const b = await call('/api/material?id=formulas', { token: C.signToken({ g: ['mat-formulas'] }) })
  assert.strictEqual(b.json.formulas.length, 67)
})

test('catalog: public, no secrets', async () => {
  const r = await call('/api/shop?a=catalog')
  assert.ok(r.json.products.length >= 10)
  assert.strictEqual(r.json.counts.nzm, 1)
  assert.ok(!JSON.stringify(r.json).includes('test-secret'))
})
