// Roda dentro da página do WhatsApp Web (mundo MAIN), ao lado da WA-JS.
// Só responde a pedidos da ponte da extensão (ponte.js): estado, lista de destinos e envio.
// E avisa a ponte de dois eventos: alguém entrou num grupo e alguém pediu as aulas no privado.
(() => {
  if (window.__sdbAvisos) return;
  window.__sdbAvisos = true;
  const espera = (ms) => new Promise(r => setTimeout(r, ms));
  const idDe = (w) => (w && (w._serialized || (typeof w === 'string' ? w : w.toString?.()))) || '';
  const comTempo = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

  // Alguém entrou num grupo: avisa o painel (que decide se manda a boas-vindas no privado).
  // O WhatsApp pode esconder o número em grupos (id "@lid"): tenta descobrir o número; sem ele, a mensagem vai pelo id.
  let ouvindo = false;
  function ouvirEntradas() {
    const W = window.WPP;
    if (ouvindo || !W?.isReady || typeof W.on !== 'function') return;
    ouvindo = true;
    W.on('group.participant_changed', async (e) => {
      try {
        if (!e || !['add', 'join'].includes(e.action)) return;
        const participantes = [];
        for (const id of (e.participants || []).slice(0, 50)) {
          let pn = '', nome = '';
          if (/@c\.us$/.test(id)) pn = id.split('@')[0];
          else {
            try { const r = await W.contact.getPnLidEntry(id); pn = r?.phoneNumber?.id || ''; } catch {}
            if (!pn) { try { const ps = await W.group.getParticipants(e.groupId); const p = ps.find(x => idDe(x.id) === id); pn = idDe(p?.phoneNumber).split('@')[0] || ''; } catch {} }
          }
          try { const c = await W.contact.get(id); nome = c?.pushname || c?.verifiedName || ''; } catch {}
          participantes.push({ id, pn, nome });
        }
        if (participantes.length) document.dispatchEvent(new CustomEvent('sdb-avisos-evento', { detail: JSON.stringify({ tipo: 'entrou', grupo_id: e.groupId, participantes }) }));
      } catch {}
    });
  }

  // Alguém mandou "SEMANA - quero receber as aulas" no privado (botão da página de obrigado):
  // avisa o painel, que põe a resposta da Bia na fila. Só mensagens novas de pessoas (nada de grupo, canal ou status).
  const PEDIDO = /^\s*\*?semana\b|quero receber as aulas/i;
  let ouvindoMsg = false;
  async function pnDe(id) {
    if (/@c\.us$/.test(id)) return id.split('@')[0];
    try { const r = await window.WPP.contact.getPnLidEntry(id); return String(r?.phoneNumber?.id || r?.phoneNumber?._serialized || '').split('@')[0]; } catch { return ''; }
  }
  function ouvirPedidos() {
    const W = window.WPP;
    if (ouvindoMsg || !W?.isReady || typeof W.on !== 'function') return;
    ouvindoMsg = true;
    W.on('chat.new_message', async (m) => {
      try {
        if (!m || m.id?.fromMe || m.type !== 'chat') return;
        const de = idDe(m.from);
        if (!/@(c\.us|lid)$/.test(de)) return; // grupo, canal, status: ignora
        const texto = String(m.body || '');
        if (texto.length > 300 || !PEDIDO.test(texto)) return;
        if (m.t && Date.now() / 1000 - m.t > 86400) return; // mensagem antiga sincronizada agora
        const pn = await pnDe(de);
        let nome = m.notifyName || '';
        try { if (!nome) { const c = await W.contact.get(de); nome = c?.pushname || c?.verifiedName || ''; } } catch {}
        document.dispatchEvent(new CustomEvent('sdb-avisos-evento', { detail: JSON.stringify({ tipo: 'palavra', de, pn, nome, texto: texto.slice(0, 120) }) }));
      } catch {}
    });
  }

  async function estado() {
    const W = window.WPP;
    if (!W) return { pronto: false, motivo: 'Carregando a biblioteca' };
    if (!W.isReady) return { pronto: false, motivo: 'Aguardando o WhatsApp Web carregar' };
    const logado = W.conn?.isAuthenticated ? W.conn.isAuthenticated() : true;
    if (!logado) return { pronto: false, motivo: 'Leia o QR Code com o número de avisos' };
    let numero = '';
    try { numero = idDe(W.conn.getMyUserId()).split('@')[0].split(':')[0]; } catch {}
    ouvirEntradas();
    ouvirPedidos();
    return { pronto: true, numero };
  }

  async function listar() {
    const W = window.WPP;
    const out = [];
    const grupos = await W.chat.list({ onlyGroups: true });
    const avisosDeComunidade = new Set();
    for (const c of grupos) {
      const meta = c.groupMetadata || {};
      if (!meta.isParentGroup) continue;
      let anuncio = '';
      try { anuncio = idDe(W.community.getAnnouncementGroup(c.id)); } catch {}
      if (anuncio) avisosDeComunidade.add(anuncio);
      let admin = false;
      try { admin = anuncio ? await W.group.iAmAdmin(anuncio) : await W.group.iAmAdmin(c.id); } catch {}
      out.push({ id: idDe(c.id), nome: c.name || c.formattedTitle || meta.subject || '', tipo: 'comunidade', envio_id: anuncio || idDe(c.id), admin, participantes: meta.participants?.length ?? null });
    }
    for (const c of grupos) {
      const meta = c.groupMetadata || {};
      const id = idDe(c.id);
      if (meta.isParentGroup || avisosDeComunidade.has(id)) continue;
      let admin = false;
      try { admin = await W.group.iAmAdmin(c.id); } catch {}
      out.push({ id, nome: c.name || c.formattedTitle || meta.subject || '', tipo: 'grupo', admin, participantes: meta.participants?.length ?? null });
    }
    let canais = [];
    try { canais = await W.chat.list({ onlyNewsletter: true }); } catch {}
    for (const c of canais) {
      const m = c.newsletterMetadata || {};
      const papel = String(m.membershipType || m.role || m.viewerMetadata?.role || '').toLowerCase();
      out.push({ id: idDe(c.id), nome: c.name || m.name || '', tipo: 'canal', admin: papel ? ['owner', 'admin'].includes(papel) : null, participantes: m.subscribersCount ?? m.size ?? null });
    }
    return out;
  }

  async function enviar({ para, texto }) {
    const W = window.WPP;
    const canal = String(para).endsWith('@newsletter');
    // "digitando..." por alguns segundos, como uma pessoa faria
    if (!canal) {
      try { await W.chat.markIsComposing(para, 4000); } catch {}
      await espera(2500 + Math.random() * 2500);
    }
    const r = await W.chat.sendTextMessage(para, texto, { createChat: true, linkPreview: false });
    if (r?.sendMsgResult) {
      const res = await comTempo(Promise.resolve(r.sendMsgResult), 45000, 'O WhatsApp não confirmou o envio');
      const st = res?.messageSendResult ?? res;
      if (st && typeof st === 'string' && !/^ok$/i.test(st)) throw new Error(`WhatsApp respondeu: ${st}`);
    }
    try { if (!canal) await W.chat.markIsPaused(para); } catch {}
    return { msg_id: idDe(r?.id) };
  }

  const CMDS = { estado, listar, enviar };
  document.addEventListener('sdb-avisos-pedido', async (ev) => {
    let d; try { d = JSON.parse(ev.detail); } catch { return; }
    const responder = (x) => document.dispatchEvent(new CustomEvent('sdb-avisos-resposta', { detail: JSON.stringify({ n: d.n, ...x }) }));
    const fn = CMDS[d.cmd];
    if (!fn) return responder({ erro: 'comando desconhecido' });
    try { responder({ ok: await fn(d.args || {}) }); }
    catch (e) { responder({ erro: String(e?.message || e).slice(0, 200) }); }
  });
})();
