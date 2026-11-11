// Funções compartilhadas pelo site e pelo app
(function () {
  const C = window.SDB || {};

  async function api(path, { method = 'GET', body, token } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(`/api/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.erro || 'Algo deu errado. Tente de novo.'), { status: r.status });
    return data;
  }

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  // Navegação: no site real muda de página; na demonstração (artefato) troca a tela
  const DEMO = window.SDB_DEMO || null;
  const ir = (url) => { if (DEMO) DEMO.ir(url); else location.href = url; };
  const caminho = () => (DEMO ? DEMO.caminho() : location.pathname);
  const qs = (k) => new URLSearchParams(DEMO ? DEMO.busca() : location.search).get(k);

  // Token: vem pela URL (?t=) ou fica salvo no navegador
  function token() {
    const t = qs('t');
    if (t && /^[a-f0-9]{20,64}$/.test(t)) { store.set('sdb_token', t); return t; }
    return store.get('sdb_token');
  }

  function maskWhats(el) {
    el.addEventListener('input', () => {
      let d = el.value.replace(/\D/g, '').slice(0, 11);
      if (d.length > 6) el.value = `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
      else if (d.length > 2) el.value = `(${d.slice(0, 2)}) ${d.slice(2)}`;
      else el.value = d;
    });
  }
  function maskCpf(el) {
    el.addEventListener('input', () => {
      const d = el.value.replace(/\D/g, '').slice(0, 11);
      el.value = d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    });
  }

  function toast(msg, ms = 3500) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('on');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), ms);
  }

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function quando(iso) {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      .format(new Date(iso)).replace(',', '').replace(/(\d{2}):(\d{2})/, (m, h, mi) => mi === '00' ? `${h}h` : `${h}h${mi}`);
  }

  function brl(v) { return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

  // Meta Pixel opcional
  function pixel(ev, params) {
    if (!C.PIXEL_ID) return;
    if (!window.fbq) {
      !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments) }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s) }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
      fbq('init', C.PIXEL_ID); fbq('track', 'PageView');
    }
    if (ev) fbq('track', ev, params || {});
  }
  pixel();

  function whatsLink(msg) {
    return `https://wa.me/${C.WHATSAPP_NUMERO}?text=${encodeURIComponent(msg || C.WHATSAPP_PALAVRA || 'SEMANA')}`;
  }

  // ---------- Rastreio (api/t): sessão anônima + campanha de origem ----------
  const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];
  UTM.concat('origem').forEach(k => { const v = qs(k); if (v && !store.get('sdb_' + k)) store.set('sdb_' + k, v); }); // primeira campanha que trouxe a pessoa
  const cConvite = qs('c'); if (cConvite && /^[a-f0-9]{16,40}$/.test(cConvite)) store.set('sdb_contato', cConvite); // veio de um convite
  function sessao() {
    let s = store.get('sdb_sid');
    if (!s) { s = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).slice(0, 20); store.set('sdb_sid', s); }
    return s;
  }
  function track(tipo, detalhe) {
    try {
      if (document.getElementById('kpis')) return; // painel admin não entra no rastreio
      const area = document.getElementById('modAulas') || document.getElementById('fLogin') ? 'app' : 'site';
      const corpo = { tipo, sessao: sessao(), pagina: area + caminho(), detalhe: detalhe || null, token: store.get('sdb_token'), ref: document.referrer ? new URL(document.referrer).host : null };
      UTM.forEach(k => { corpo[k] = qs(k) || store.get('sdb_' + k); });
      const json = JSON.stringify(corpo);
      if (!DEMO && navigator.sendBeacon) navigator.sendBeacon('/api/t', new Blob([json], { type: 'application/json' }));
      else fetch('/api/t', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: true }).catch(() => {});
    } catch {}
  }
  // Visita de página (uma por carregamento) e cliques marcados com data-track="tipo"
  setTimeout(() => track('visita'), 0);
  document.addEventListener('click', (e) => { const el = e.target.closest && e.target.closest('[data-track]'); if (el) track(el.dataset.track, el.dataset.trackDetalhe || null); }, true);

  // Turma de quem se cadastra agora (mesma regra do servidor, api/_lib/turma.js): devolve a segunda-feira em UTC 00h
  function turma(ms = Date.now()) {
    const b = new Date(ms - 3 * 3600e3); // horário de Brasília
    const dow = b.getUTCDay(), seg = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) - ((dow + 6) % 7) * 864e5;
    return new Date(dow >= 1 && dow <= 3 ? seg : seg + 7 * 864e5);
  }

  window.sdb = { turma, track, api, store, qs, ir, caminho, DEMO, token, maskWhats, maskCpf, toast, esc, quando, brl, pixel, whatsLink, C };
})();
