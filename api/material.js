// Ақылы материалдар: «Математика формулалары» және НЗМ нұсқаулығы. demo=1 — тегін үзінді.
'use strict'
const C = require('./_lib/core')
const M = require('./_data/materials.json')

const ITEMS = {
  formulas: { grant: 'mat-formulas', full: () => ({ formulas: M.formulas }), demo: () => ({ formulas: M.formulas.slice(0, 8), total: M.formulas.length }) },
  nisguide: {
    grant: 'mat-nis',
    full: () => M.nis,
    demo: () => ({ ...M.nis, tips: M.nis.tips.slice(0, 1).map((t) => ({ ...t, hacks: t.hacks.slice(0, 2) })), totalSubjects: M.nis.tips.length }),
  },
}

module.exports = (req, res) => {
  const it = ITEMS[String(req.query.id || '')]
  if (!it) return C.send(res, 404, { error: 'not_found' })
  const open = C.has(C.readToken(C.bearer(req)), it.grant)
  return C.send(res, 200, { open, ...(open ? it.full() : it.demo()) })
}
