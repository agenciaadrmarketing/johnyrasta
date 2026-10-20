/*! JohnyWeb coletor v1 — visitas e cliques. Não lê campos de formulário. ES5 de propósito. */
(function (w, d) {
  if (w.__jw) return;
  var s = d.currentScript || (function () { var x = d.getElementsByTagName('script'); return x[x.length - 1]; })();
  if (!s) return;
  var SITE = s.getAttribute('data-site');
  if (!SITE) return;
  var ORIGEM = s.getAttribute('data-endpoint') || (function () { try { return new URL(s.src).origin; } catch (e) { return ''; } })();
  var CONSENT = s.getAttribute('data-consent') === 'exigido';
  var ENDPOINT = ORIGEM + '/api/collect';
  var SESSAO_MS = 30 * 60 * 1000;
  var fila = [], timer = null, consentOk = !CONSENT, path = null;

  function id() { var r = ''; var a = 'abcdefghijklmnopqrstuvwxyz0123456789'; for (var i = 0; i < 16; i++) r += a.charAt(Math.floor(Math.random() * a.length)); return 'jw' + r; }
  function ler(st, k) { try { return w[st].getItem(k); } catch (e) { return null; } }
  function gravar(st, k, v) { try { w[st].setItem(k, v); } catch (e) {} }
  function sessao() {
    var agora = Date.now(); var raw = ler('sessionStorage', 'jw_s'); var o = null;
    try { o = raw ? JSON.parse(raw) : null; } catch (e) {}
    if (!o || agora - o.t > SESSAO_MS) o = { k: id(), t: agora }; else o.t = agora;
    gravar('sessionStorage', 'jw_s', JSON.stringify(o)); return o.k;
  }
  function visitante() {
    if (!consentOk) return null;
    var v = ler('localStorage', 'jw_v'); if (!v) { v = id(); gravar('localStorage', 'jw_v', v); } return v;
  }
  function testToken() {
    var m = /[?&]jw_test=([A-Za-z0-9_-]{8,64})/.exec(w.location.search);
    if (m) gravar('sessionStorage', 'jw_t', m[1]);
    return ler('sessionStorage', 'jw_t');
  }
  function utm() {
    var o = {}, q = w.location.search.replace(/^\?/, '').split('&');
    for (var i = 0; i < q.length; i++) { var p = q[i].split('='); var k = decodeURIComponent(p[0] || ''); if (k === 'utm_source' || k === 'utm_medium' || k === 'utm_campaign') { try { o[k] = decodeURIComponent((p[1] || '').replace(/\+/g, ' ')); } catch (e) {} } }
    return o;
  }
  function dispositivo() { return (w.innerWidth || 1024) < 768 ? 'celular' : (w.innerWidth || 1024) < 1100 ? 'tablet' : 'desktop'; }
  function enviar() {
    if (!fila.length) return; var lote = fila.splice(0, 20);
    var corpo = JSON.stringify({ site: SITE, events: lote });
    var ok = false;
    try { if (navigator.sendBeacon) ok = navigator.sendBeacon(ENDPOINT, new Blob([corpo], { type: 'text/plain' })); } catch (e) {}
    if (!ok) { try { fetch(ENDPOINT, { method: 'POST', body: corpo, keepalive: true, headers: { 'content-type': 'text/plain' }, mode: 'cors', credentials: 'omit' }); } catch (e) {} }
    if (fila.length) enviar();
  }
  function agendar() { if (timer) return; timer = setTimeout(function () { timer = null; enviar(); }, 800); }
  function evento(e) {
    e.event_id = id(); e.session_key = sessao(); e.visitor_id = visitante(); e.occurred_at = new Date().toISOString();
    e.path = w.location.pathname || '/'; e.referrer = d.referrer || null; e.utm = utm(); e.device = dispositivo(); e.test_token = testToken();
    fila.push(e); if (fila.length >= 10) enviar(); else agendar();
  }
  function acao(href) { var h = (href || '').toLowerCase(); if (/^https?:\/\/(api\.whatsapp\.com|wa\.me|web\.whatsapp\.com)/.test(h) || h.indexOf('whatsapp:') === 0) return 'whatsapp'; if (h.indexOf('tel:') === 0) return 'phone'; if (h.indexOf('mailto:') === 0) return 'email'; return null; }
  function pageView() { var p = w.location.pathname; if (p === path) return; path = p; evento({ type: 'page_view' }); }

  d.addEventListener('click', function (ev) {
    var el = ev.target; var n = 0;
    while (el && el !== d && n++ < 8) {
      var tid = el.getAttribute && el.getAttribute('data-track-id');
      var href = el.getAttribute && el.getAttribute('href');
      var kind = tid ? (el.getAttribute('data-track-kind') || acao(href) || 'outro') : acao(href);
      if (tid || kind) {
        evento({ type: 'click', button_id: tid || ('auto-' + kind), button_pos: el.getAttribute('data-track-pos') || null, button_text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) || null, action_kind: kind, auto_detected: !tid });
        if (href && !tid && !ev.defaultPrevented) enviar();
        return;
      }
      el = el.parentNode;
    }
  }, true);
  d.addEventListener('submit', function (ev) {
    var f = ev.target; if (!f || !f.getAttribute) return;
    if (f.getAttribute('data-track-form') === null) return;
    // Preenche session_key (para atribuição) e submission_id (idempotência) se o formulário os tiver vazios.
    try {
      var sk = f.querySelector('input[name="session_key"]'); if (sk && !sk.value) sk.value = sessao();
      var si = f.querySelector('input[name="submission_id"]'); if (si && !si.value) si.value = 'sub' + id() + Date.now().toString(36);
    } catch (e) {}
    evento({ type: 'form_attempt', button_id: f.getAttribute('data-track-form') || 'form', action_kind: null });
    enviar();
  }, true);
  // Rotas SPA.
  var ps = w.history.pushState, rs = w.history.replaceState;
  if (ps) w.history.pushState = function () { ps.apply(this, arguments); setTimeout(pageView, 0); };
  if (rs) w.history.replaceState = function () { rs.apply(this, arguments); setTimeout(pageView, 0); };
  w.addEventListener('popstate', function () { setTimeout(pageView, 0); });
  w.addEventListener('pagehide', enviar);
  d.addEventListener('visibilitychange', function () { if (d.hidden) enviar(); });

  w.jw = function (cmd, a) {
    if (cmd === 'consent') { consentOk = a !== false; }
    else if (cmd === 'session') { return sessao(); }
    else if (cmd === 'test') { return testToken(); }
    else if (cmd === 'click') { evento({ type: 'click', button_id: String(a || 'custom'), action_kind: 'outro', auto_detected: false }); }
  };
  w.__jw = 'v1';
  pageView();
})(window, document);
