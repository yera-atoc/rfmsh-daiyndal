/* Daiyndal — ортақ скрипт: тіл (қаз/рус), қолжетімділік токені, төлем, активация, модаль. */
(function () {
  'use strict'
  var LS = {
    get: function (k) { try { return localStorage.getItem(k) } catch (e) { return null } },
    set: function (k, v) { try { localStorage.setItem(k, v) } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k) } catch (e) {} },
  }
  var $ = function (s, r) { return (r || document).querySelector(s) }
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] }) }
  var fmt = function (n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') }

  // ── Тіл ──
  var lang = LS.get('dy_lang') === 'ru' ? 'ru' : 'kk'
  function t(kk, ru) { return lang === 'ru' ? ru : kk }
  function applyLang() {
    document.documentElement.lang = lang
    document.querySelectorAll('[data-ru]').forEach(function (el) {
      if (el.dataset.kk == null) el.dataset.kk = el.innerHTML
      el.innerHTML = lang === 'ru' ? el.dataset.ru : el.dataset.kk
    })
    document.querySelectorAll('[data-ru-ph]').forEach(function (el) {
      if (el.dataset.kkPh == null) el.dataset.kkPh = el.placeholder
      el.placeholder = lang === 'ru' ? el.dataset.ruPh : el.dataset.kkPh
    })
    document.querySelectorAll('[data-ru-title]').forEach(function (el) {
      if (el.dataset.kkTitle == null) el.dataset.kkTitle = document.title
      document.title = lang === 'ru' ? el.dataset.ruTitle : el.dataset.kkTitle
    })
    document.querySelectorAll('.lang button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.lang === lang)) })
    document.dispatchEvent(new CustomEvent('langchange', { detail: lang }))
  }
  function setLang(l) { lang = l === 'ru' ? 'ru' : 'kk'; LS.set('dy_lang', lang); applyLang() }

  // ── Токен (қолжетімділік) ──
  function token() { return LS.get('dy_token') || '' }
  function setToken(v) { if (v) LS.set('dy_token', v); document.dispatchEvent(new Event('access')) }
  function access() {
    var tk = token()
    if (!tk) return { g: [], c: 0, u: [] }
    try {
      var b = tk.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')
      var p = JSON.parse(decodeURIComponent(escape(atob(b))))
      return { g: p.g || [], c: p.c | 0, u: p.u || [] }
    } catch (e) { return { g: [], c: 0, u: [] } }
  }
  function has(grant) { var a = access(); return a.g.indexOf(grant) > -1 || a.g.indexOf('all') > -1 }

  function api(path, opt) {
    opt = opt || {}
    var h = { 'Content-Type': 'application/json' }
    if (token()) h.Authorization = 'Bearer ' + token()
    return fetch(path, { method: opt.method || (opt.body ? 'POST' : 'GET'), headers: h, body: opt.body ? JSON.stringify(opt.body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {} }).then(function (j) { j._status = r.status; return j }) })
  }

  // ── Модаль, хабарлама ──
  var md, mc, lastFocus
  function ensureModal() {
    if (md) return
    md = document.createElement('div'); md.className = 'mod'; md.setAttribute('role', 'dialog'); md.setAttribute('aria-modal', 'true')
    mc = document.createElement('div'); mc.className = 'box'; md.appendChild(mc); document.body.appendChild(md)
    md.addEventListener('click', function (e) { if (e.target === md) closeM() })
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && md.classList.contains('on')) closeM() })
  }
  function modal(html) {
    ensureModal(); lastFocus = document.activeElement
    mc.innerHTML = html; md.classList.add('on')
    var f = mc.querySelector('input,button'); if (f) setTimeout(function () { f.focus() }, 30)
  }
  function closeM() { if (md) md.classList.remove('on'); if (lastFocus && lastFocus.focus) lastFocus.focus() }
  var toastEl, toastT
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl) }
    toastEl.textContent = msg; toastEl.classList.add('on'); clearTimeout(toastT)
    toastT = setTimeout(function () { toastEl.classList.remove('on') }, 3200)
  }

  // ── Каталог ──
  var catP = null
  function catalog() { return catP || (catP = api('/api/shop?a=catalog').then(function (j) { if (!j.products) { catP = null } return j })) }
  function product(id) { return catalog().then(function (c) { return (c.products || []).filter(function (p) { return p.id === id })[0] }) }

  // ── Сатып алу: батырманы басқанда бірден карта төлемі ашылады ──
  var paying = false
  function buy(id) {
    if (paying) return
    catalog().then(function (c) {
      var p = (c.products || []).filter(function (x) { return x.id === id })[0]
      if (!p) return toast(t('Өнім табылмады', 'Товар не найден'))
      if (c.pay && c.pay.card) return payCard(p)
      // Карта әлі қосылмаған (CloudPayments кілттері жоқ) — уақытша WhatsApp арқылы
      var wa = 'https://wa.me/' + (c.whatsapp || '') + '?text=' + encodeURIComponent(t('Сәлеметсіз бе! Мен сатып алғым келеді: ', 'Здравствуйте! Хочу купить: ') + p.title[lang] + ' (' + fmt(p.price) + ' ₸)')
      modal('<h3>' + esc(p.title[lang]) + '</h3><p>' + t('Картамен онлайн төлем жақында қосылады. Әзірге WhatsApp арқылы сатып алыңыз.', 'Онлайн-оплата картой скоро заработает. Пока купите через WhatsApp.') + '</p><div class="sum"><span>' + t('Сомасы', 'Сумма') + '</span><b>' + fmt(p.price) + ' ₸</b></div><div class="bt"><a class="btn" href="' + wa + '" target="_blank" rel="noopener">' + t('WhatsApp арқылы сатып алу', 'Купить через WhatsApp') + '</a><button class="btn g" data-act="code">' + t('Менде код бар', 'У меня есть код') + '</button><button class="btn l" data-act="close">' + t('Жабу', 'Закрыть') + '</button></div>')
    })
  }

  function loadWidget() {
    return new Promise(function (ok, fail) {
      if (window.cp && window.cp.CloudPayments) return ok()
      var s = document.createElement('script'); s.src = 'https://widget.cloudpayments.ru/bundles/cloudpayments.js'
      s.onload = function () { ok() }; s.onerror = fail; document.head.appendChild(s)
    })
  }

  function payCard(p) {
    paying = true
    var fail = function (m) { paying = false; toast(m || t('Төлемді бастау мүмкін болмады. Кейінірек көріңіз.', 'Не удалось начать оплату. Попробуйте позже.')) }
    Promise.all([api('/api/shop?a=checkout', { body: { product: p.id, lang: lang } }), loadWidget()]).then(function (r) {
      var o = r[0]
      if (!o.invoiceId) return fail()
      var pend = JSON.parse(LS.get('dy_pending') || '[]'); pend.push(o.invoiceId); LS.set('dy_pending', JSON.stringify(pend.slice(-5)))
      var w = new window.cp.CloudPayments({ language: lang === 'ru' ? 'ru-RU' : 'kk' })
      w.pay('charge', { publicId: o.publicId, description: o.description, amount: o.amount, currency: o.currency, invoiceId: o.invoiceId, skin: 'modern' }, {
        onSuccess: function () { claim(o.invoiceId, 0, p) },
        onFail: function (reason) { paying = false; if (reason !== 'User has cancelled') toast(t('Төлем өтпеді. Қайта көріңіз.', 'Платёж не прошёл. Попробуйте ещё раз.')) },
        onComplete: function () { paying = false },
      })
    }).catch(function () { fail(t('Желі қатесі. Қайта көріңіз.', 'Ошибка сети. Попробуйте снова.')) })
  }

  // Төлемнен кейін қай бетке бару керек
  function dest(p) {
    if (!p) return '/my.html'
    if (p.cat === 'rfmsh') return '/rfmsh/#practice'
    if (p.id === 'formulas' || p.id === 'nisguide') return '/material.html?id=' + p.id
    if (p.cat === 'bundle') return '/my.html'
    return '/my.html?cat=' + p.cat
  }

  /** Төлемді серверден тексеріп, қолжетімділікті бірден ашу. Статус кешігуі мүмкін — бірнеше рет қайталаймыз. */
  function claim(inv, tries, p) {
    if (!tries) modal('<h3>' + t('Төлем тексерілуде…', 'Проверяем платёж…') + '</h3><p>' + t('Бірнеше секунд күтіңіз.', 'Подождите несколько секунд.') + '</p>')
    return api('/api/shop?a=claim', { body: { invoiceId: inv, token: token() } }).then(function (j) {
      if (j.token) {
        setToken(j.token)
        var pend = JSON.parse(LS.get('dy_pending') || '[]').filter(function (x) { return x !== inv }); LS.set('dy_pending', JSON.stringify(pend))
        // Код «Менің тесттерім» бетінде сақталады — басқа құрылғыда ашу үшін
        var codes = JSON.parse(LS.get('dy_codes') || '[]'); if (codes.indexOf(j.code) < 0) codes.push(j.code); LS.set('dy_codes', JSON.stringify(codes))
        var to = dest(p)
        modal('<h3>' + t('Төлем қабылданды ✓', 'Оплата прошла ✓') + '</h3><p>' + t('Қолжетімділік ашылды. Қазір бастай аласыз.', 'Доступ открыт. Можно начинать.') + '</p><div class="bt"><a class="btn" href="' + to + '">' + t('Бастау', 'Начать') + '</a></div>')
        setTimeout(function () { if (location.pathname + location.search + location.hash !== to) location.href = to; else { closeM(); document.dispatchEvent(new Event('access')) } }, 1800)
        return true
      }
      if (j._status === 402 && tries < 8) return new Promise(function (r) { setTimeout(r, 2500) }).then(function () { return claim(inv, tries + 1, p) })
      modal('<h3>' + t('Төлем әлі расталмады', 'Платёж ещё не подтверждён') + '</h3><p>' + t('Егер ақша шешілсе, бетті бірнеше минуттан кейін жаңартыңыз — тексеру автоматты түрде қайталанады. Болмаса, WhatsApp-қа жазыңыз, төлем нөмірі:', 'Если деньги списались, обновите страницу через пару минут — проверка повторится автоматически. Или напишите в WhatsApp, номер платежа:') + '</p><div class="code" style="font-size:14px">' + esc(inv) + '</div><div class="bt"><button class="btn g" data-act="close">' + t('Жабу', 'Закрыть') + '</button></div>')
      return false
    })
  }
  function retryPending() {
    var pend = JSON.parse(LS.get('dy_pending') || '[]')
    pend.forEach(function (inv) {
      api('/api/shop?a=claim', { body: { invoiceId: inv, token: token() } }).then(function (j) {
        if (!j.token) return
        setToken(j.token)
        var rest = JSON.parse(LS.get('dy_pending') || '[]').filter(function (x) { return x !== inv }); LS.set('dy_pending', JSON.stringify(rest))
        var codes = JSON.parse(LS.get('dy_codes') || '[]'); if (codes.indexOf(j.code) < 0) codes.push(j.code); LS.set('dy_codes', JSON.stringify(codes))
        toast(t('Төлем расталды, қолжетімділік ашылды', 'Оплата подтверждена, доступ открыт'))
      })
    })
  }

  // ── Активация коды ──
  function openCode() {
    modal('<h3>' + t('Активация коды', 'Код активации') + '</h3><p>' + t('Төлемнен кейін алған кодты енгізіңіз.', 'Введите код, полученный после оплаты.') + '</p><input id="ci" placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters" spellcheck="false"><p class="err" id="cm"></p><div class="bt"><button class="btn" id="cb">' + t('Белсендіру', 'Активировать') + '</button><button class="btn g" data-act="close">' + t('Жабу', 'Закрыть') + '</button></div>')
    var go = function () {
      var v = $('#ci').value.trim(); if (!v) return
      $('#cb').disabled = true
      api('/api/shop?a=activate', { body: { code: v, token: token() } }).then(function (j) {
        $('#cb').disabled = false
        if (j.token) {
          setToken(j.token)
          var codes = JSON.parse(LS.get('dy_codes') || '[]'); if (codes.indexOf(v) < 0) codes.push(v); LS.set('dy_codes', JSON.stringify(codes))
          closeM(); toast(t('Код қабылданды ✓', 'Код принят ✓'))
        } else $('#cm').textContent = j._status === 429 ? t('Тым көп әрекет. 10 минуттан кейін көріңіз.', 'Слишком много попыток. Попробуйте через 10 минут.') : t('Код дұрыс емес. Тексеріп, қайта көріңіз.', 'Неверный код. Проверьте и попробуйте снова.')
      }).catch(function () { $('#cb').disabled = false; $('#cm').textContent = t('Желі қатесі.', 'Ошибка сети.') })
    }
    $('#cb').onclick = go; $('#ci').onkeydown = function (e) { if (e.key === 'Enter') go() }
  }

  // ── Оқиғалар ──
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-buy],[data-act],[data-lang]')
    if (!b) return
    if (b.dataset.lang) return setLang(b.dataset.lang)
    if (b.dataset.buy) { e.preventDefault(); return buy(b.dataset.buy) }
    var a = b.dataset.act
    if (a === 'close') closeM()
    else if (a === 'code') { e.preventDefault(); openCode() }
    else if (a === 'copy') { (navigator.clipboard ? navigator.clipboard.writeText(b.dataset.v) : Promise.reject()).then(function () { toast(t('Көшірілді', 'Скопировано')) }, function () { toast(b.dataset.v) }) }
  })

  function reveal() {
    var els = document.querySelectorAll('.rv:not(.in)')
    if (!('IntersectionObserver' in window)) { els.forEach(function (el) { el.classList.add('in') }); return }
    var io = new IntersectionObserver(function (es) { es.forEach(function (x) { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target) } }) }, { rootMargin: '0px 0px -8% 0px' })
    els.forEach(function (el) { io.observe(el) })
  }

  document.addEventListener('DOMContentLoaded', function () { applyLang(); reveal(); retryPending() })

  window.DY = { t: t, lang: function () { return lang }, setLang: setLang, token: token, setToken: setToken, access: access, has: has, api: api, modal: modal, closeM: closeM, toast: toast, catalog: catalog, product: product, buy: buy, openCode: openCode, esc: esc, fmt: fmt, reveal: reveal, LS: LS }
})()
