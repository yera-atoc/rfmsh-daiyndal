// НЗМ / БИЛ (bt_exams) және IELTS / TOEFL (ielts_tests) сынақтары: тізім, мазмұн (жауапсыз), тексеру.
'use strict'
const { rest, cached, signUrls } = require('./supa')

const DEMO_N = 5 // тегін демо: әр пәннен / бөлімнен алғашқы сұрақтар
const groupsOf = (cat) => {
  const env = cat === 'nzm' ? process.env.STORE_NZM_GROUPS : process.env.STORE_BIL_GROUPS
  return (env || (cat === 'nzm' ? 'nzm' : 'bil-1')).split(',').map((s) => s.trim()).filter(Boolean)
}

// ── НЗМ / БИЛ ────────────────────────────────────────────
function usableSubjects(ex) {
  return (ex.subjects || []).filter((s) => {
    const qs = (ex.questions || {})[s.id] || []
    const key = (ex.answer_key || {})[s.id] || []
    return qs.some((q) => q && (q.text || q.image)) && key.some(Boolean)
  })
}

async function btExams(cat) {
  return cached(`bt:${cat}`, async () => {
    const groups = groupsOf(cat).map((g) => `"${g.replace(/"/g, '')}"`).join(',')
    const rows = await rest(`bt_exams?select=id,title,group_id,month,subjects,questions,answer_key,practice&group_id=in.(${encodeURIComponent(groups)})&practice=eq.true&order=month.desc`)
    return rows.map((ex) => ({ ...ex, usable: usableSubjects(ex) })).filter((ex) => ex.usable.length)
  })
}

function btSummary(ex) {
  return {
    id: ex.id,
    title: ex.title,
    month: ex.month,
    subjects: ex.usable.map((s) => ({ id: s.id, name: s.name, n: s.questions, max: s.max })),
    max: ex.usable.reduce((a, s) => a + s.max, 0),
  }
}

async function btContent(ex, demo) {
  const subjects = []
  const imgs = []
  for (const s of ex.usable) {
    let qs = ((ex.questions || {})[s.id] || []).slice(0, s.questions)
    if (demo) qs = qs.slice(0, DEMO_N)
    qs = qs.map((q) => ({ text: q?.text || '', image: q?.image || '', passage: q?.passage || '', options: q?.options || [] }))
    qs.forEach((q) => q.image && imgs.push(q.image))
    subjects.push({ id: s.id, name: s.name, max: s.max, n: s.questions, options: s.options || 4, questions: qs })
  }
  const signed = await signUrls(imgs)
  subjects.forEach((s) => s.questions.forEach((q) => { if (q.image && signed[q.image]) q.image = signed[q.image] }))
  return { kind: 'bt', id: ex.id, title: ex.title, demo: !!demo, subjects, minutes: demo ? 10 : 240 }
}

function btScore(ex, answers, demo) {
  const out = { kind: 'bt', subjects: [], total: 0, max: 0 }
  for (const s of ex.usable) {
    const key = ((ex.answer_key || {})[s.id] || []).slice(0, demo ? DEMO_N : s.questions)
    const given = Array.isArray(answers?.[s.id]) ? answers[s.id] : []
    const per = s.max / s.questions
    let ok = 0
    const rows = key.map((k, i) => {
      const g = String(given[i] || '').toUpperCase().slice(0, 1)
      const hit = !!k && g === k
      if (hit) ok++
      return { g, k: k || '', ok: hit }
    })
    const pts = Math.round(ok * per)
    const max = demo ? Math.round(key.length * per) : s.max
    out.subjects.push({ id: s.id, name: s.name, ok, n: key.length, pts, max, rows })
    out.total += pts
    out.max += max
  }
  return out
}

// ── IELTS / TOEFL ────────────────────────────────────────
async function englishTests(cat) {
  return cached(`en:${cat}`, async () => {
    const rows = await rest(`ielts_tests?select=id,title,exam,variant,mode,content,created_at&published=eq.true&exam=eq.${cat === 'toefl' ? 'toefl' : 'ielts'}&order=title.asc`)
    return rows.filter((t) => t.content && (t.content.listening || t.content.reading))
  })
}
function enSummary(t) {
  const c = t.content || {}
  const sec = []
  if (c.listening?.parts?.some((p) => p.groups?.length)) sec.push('Listening')
  if (c.reading?.passages?.some((p) => p.groups?.length)) sec.push('Reading')
  if (c.writing?.task1?.prompt || c.writing?.task2?.prompt || c.writing?.build?.length) sec.push('Writing')
  if (c.speaking?.parts?.some((p) => p.questions?.length)) sec.push('Speaking')
  return { id: t.id, title: t.title, exam: t.exam || 'ielts', variant: t.variant, sections: sec }
}

const media = (u) => (typeof u === 'string' ? u.replace(/^\/ielts-media\//, '/media/') : u)
const strip = (gs) => (gs || []).map((g) => ({ ...g, items: (g.items || []).map(({ answer, ...rest }) => rest) }))

async function enContent(t, demo) {
  const c = JSON.parse(JSON.stringify(t.content || {}))
  const out = { kind: 'en', id: t.id, title: t.title, exam: t.exam || 'ielts', variant: t.variant || 'academic', demo: !!demo }
  if (demo) {
    // Демо: Reading-тің бірінші мәтіні ғана
    const p = c.reading?.passages?.find((x) => x.groups?.length)
    out.reading = p ? { minutes: 20, passages: [{ ...p, groups: strip(p.groups) }] } : null
    return out
  }
  if (c.listening) out.listening = { ...c.listening, audio: media(c.listening.audio), parts: (c.listening.parts || []).map((p) => ({ ...p, groups: strip(p.groups) })) }
  if (c.reading) out.reading = { ...c.reading, passages: (c.reading.passages || []).map((p) => ({ ...p, groups: strip(p.groups) })) }
  if (c.writing) {
    out.writing = { ...c.writing, build: c.writing.build ? strip(c.writing.build) : undefined }
    for (const k of ['task1', 'task2']) if (out.writing[k]) out.writing[k] = { ...out.writing[k], image: media(out.writing[k].image) }
  }
  if (c.speaking) out.speaking = { parts: (c.speaking.parts || []).map((p) => ({ ...p, audios: (p.audios || []).map(media), questions: p.hideText ? p.questions.map(() => '') : p.questions })) }
  // Supabase-ке жүктелген медиа болса — уақытша сілтеме
  const urls = [out.listening?.audio, out.writing?.task1?.image, out.writing?.task2?.image, ...(out.speaking?.parts || []).flatMap((p) => p.audios || [])].filter(Boolean)
  const signed = await signUrls(urls)
  if (out.listening?.audio && signed[out.listening.audio]) out.listening.audio = signed[out.listening.audio]
  for (const k of ['task1', 'task2']) if (out.writing?.[k]?.image && signed[out.writing[k].image]) out.writing[k].image = signed[out.writing[k].image]
  out.speaking?.parts?.forEach((p) => { p.audios = (p.audios || []).map((a) => signed[a] || a) })
  return out
}

// Тексеру (Beles lib/ielts.ts-тен көшірілді)
const norm = (s) => String(s).toLowerCase().replace(/[’']/g, "'").replace(/[.,;:!?"]/g, ' ').replace(/\s+/g, ' ').trim()
const TFNG = { t: 'true', true: 'true', f: 'false', false: 'false', ng: 'not given', 'not given': 'not given', y: 'yes', yes: 'yes', n: 'no', no: 'no' }
function isCorrect(type, given, answer) {
  if (!given || !answer) return false
  const alts = String(answer).split(/\s*[|/]\s*/).map(norm).filter(Boolean)
  let g = norm(given)
  if (type === 'tfng' || type === 'ynng') { g = TFNG[g] || g; return alts.map((a) => TFNG[a] || a).includes(g) }
  if (type === 'order') { const flat = (x) => x.replace(/[^a-z0-9' ]/g, '').replace(/\s+/g, ' ').trim(); return alts.map(flat).includes(flat(g)) }
  if (type === 'mcq' || type === 'matching') { const first = (x) => x.split(' ')[0]; return alts.map(first).includes(first(g)) }
  return alts.includes(g)
}
const LISTENING = [[39, 9], [37, 8.5], [35, 8], [32, 7.5], [30, 7], [26, 6.5], [23, 6], [18, 5.5], [16, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5], [2, 2], [1, 1]]
const READING_AC = [[39, 9], [37, 8.5], [35, 8], [33, 7.5], [30, 7], [27, 6.5], [23, 6], [19, 5.5], [15, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5], [2, 2], [1, 1]]
const READING_GT = [[40, 9], [39, 8.5], [37, 8], [36, 7.5], [34, 7], [32, 6.5], [30, 6], [27, 5.5], [23, 5], [19, 4.5], [15, 4], [12, 3.5], [9, 3], [6, 2.5], [3, 2], [1, 1]]
function rawToBand(sec, raw, of, variant) {
  if (!of) return null
  const r40 = Math.round((raw / of) * 40)
  const table = sec === 'listening' ? LISTENING : variant === 'general' ? READING_GT : READING_AC
  for (const [min, band] of table) if (r40 >= min) return band
  return 0
}
const TOEFL_PCT = [[95, 6], [89, 5.5], [82, 5], [74, 4.5], [65, 4], [56, 3.5], [47, 3], [38, 2.5], [28, 2], [18, 1.5]]
function toeflBand(raw, of) {
  if (!of) return null
  const pct = (raw / of) * 100
  for (const [min, b] of TOEFL_PCT) if (pct >= min) return b
  return 1
}
function sectionGroups(c, sec, demo) {
  if (sec === 'build') return c.writing?.build || []
  if (sec === 'listening') return (c.listening?.parts || []).flatMap((p) => p.groups || [])
  let ps = c.reading?.passages || []
  if (demo) ps = ps.filter((x) => x.groups?.length).slice(0, 1)
  return ps.flatMap((p) => p.groups || [])
}
function enScore(t, answers, demo) {
  const c = t.content || {}
  const exam = t.exam || 'ielts'
  const out = { kind: 'en', exam, sections: {} }
  for (const sec of demo ? ['reading'] : ['listening', 'reading', 'build']) {
    const items = sectionGroups(c, sec, demo).flatMap((g) => (g.items || []).map((it) => ({ ...it, type: g.type })))
    if (!items.length) continue
    const given = (answers && answers[sec]) || {}
    const review = {}
    let raw = 0
    for (const it of items) {
      const ok = isCorrect(it.type, given[String(it.n)], it.answer)
      if (ok) raw++
      review[it.n] = { ok, correct: String(it.answer || '').split(/\s*[|/]\s*/)[0] }
    }
    const band = exam === 'toefl' || sec === 'build' ? toeflBand(raw, items.length) : rawToBand(sec, raw, items.length, t.variant || 'academic')
    out.sections[sec] = { raw, of: items.length, band, review }
  }
  return out
}

module.exports = { btExams, btSummary, btContent, btScore, englishTests, enSummary, enContent, enScore, DEMO_N }
