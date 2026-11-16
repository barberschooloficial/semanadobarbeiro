// Ponte entre o WhatsApp Web (pagina.js) e o painel (background.js).
// A cada minuto: confere se o WhatsApp está pronto, busca a fila e posta um destino por vez,
// com intervalo aleatório entre um e outro. Mostra um quadrinho no canto da tela com o andamento.
(() => {
  const VERSAO = chrome.runtime.getManifest().version;
  const espera = (ms) => new Promise(r => setTimeout(r, ms));
  let n = 0, ocupado = false, ultimoSync = 0, numero = '';

  // ---- conversa com a página ----
  const pendentes = new Map();
  document.addEventListener('sdb-avisos-resposta', (ev) => {
    let d; try { d = JSON.parse(ev.detail); } catch { return; }
    const p = pendentes.get(d.n); if (!p) return;
    pendentes.delete(d.n); d.erro ? p.rej(new Error(d.erro)) : p.res(d.ok);
  });
  function pagina(cmd, args, ms = 90000) {
    const id = ++n;
    return new Promise((res, rej) => {
      pendentes.set(id, { res, rej });
      document.dispatchEvent(new CustomEvent('sdb-avisos-pedido', { detail: JSON.stringify({ n: id, cmd, args }) }));
      setTimeout(() => { if (pendentes.delete(id)) rej(new Error('A página não respondeu')); }, ms);
    });
  }
  // ---- conversa com o painel ----
  async function api(acao, corpo) {
    const r = await chrome.runtime.sendMessage({ tipo: 'api', acao, corpo });
    if (!r || r.erro) throw new Error(r?.erro || 'Extensão sem resposta');
    return r.ok;
  }

  // ---- alguém entrou num grupo: o painel põe a boas-vindas no privado na fila ----
  document.addEventListener('sdb-avisos-evento', async (ev) => {
    let d; try { d = JSON.parse(ev.detail); } catch { return; }
    if (d.tipo === 'palavra') {
      // pediu as aulas no privado: a resposta da Bia entra na fila e sai no próximo ciclo (em até 1 min)
      try { const r = await api('wa_palavra', { de: d.de, pn: d.pn, nome: d.nome, texto: d.texto }); if (r?.na_fila) setTimeout(ciclo, 15000); } catch {}
      return;
    }
    if (d.tipo !== 'entrou') return;
    try { await api('wa_entrou', { grupo_id: d.grupo_id, participantes: d.participantes }); } catch {}
  });

  // ---- quadrinho na tela ----
  const caixa = document.createElement('div');
  caixa.id = 'sdb-avisos';
  caixa.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:99999;font:12px/1.4 Arial,sans-serif;background:#15120e;color:#ede7dc;border:1px solid #8a6730;border-radius:10px;padding:8px 10px;max-width:300px;box-shadow:0 6px 18px rgba(0,0,0,.35)';
  caixa.innerHTML = '<b style="color:#e8d9b8">Avisos SDB</b> <span data-x="st">iniciando...</span><div data-x="det" style="opacity:.8"></div><button data-x="pausa" style="margin-top:6px;background:none;border:1px solid #8a6730;color:#e8d9b8;border-radius:999px;padding:2px 10px;cursor:pointer;font-size:11px">Pausar</button>';
  document.documentElement.appendChild(caixa);
  const el = (x) => caixa.querySelector(`[data-x="${x}"]`);
  const status = (st, det = '') => { el('st').textContent = st; el('det').textContent = det; chrome.storage.local.set({ ultimo: { st, det, em: Date.now(), numero } }); };
  let pausado = false;
  chrome.storage.local.get(['pausado']).then(v => { pausado = !!v.pausado; el('pausa').textContent = pausado ? 'Retomar' : 'Pausar'; });
  chrome.storage.onChanged.addListener((c) => {
    if (c.pausado) { pausado = !!c.pausado.newValue; el('pausa').textContent = pausado ? 'Retomar' : 'Pausar'; if (pausado) status('pausado'); }
    if (c.syncAgora?.newValue) { ultimoSync = 0; ciclo(); }
  });
  el('pausa').onclick = () => chrome.storage.local.set({ pausado: !pausado });

  // ---- ciclo ----
  async function sincronizar() {
    const destinos = await pagina('listar', {}, 120000);
    await api('wa_sync', { numero, versao: VERSAO, destinos });
    ultimoSync = Date.now();
    return destinos.length;
  }

  async function ciclo() {
    if (ocupado) return;
    ocupado = true;
    try {
      const e = await pagina('estado', {}, 15000).catch(() => ({ pronto: false, motivo: 'Carregando' }));
      if (!e.pronto) return status('aguardando', e.motivo);
      numero = e.numero || numero;
      if (Date.now() - ultimoSync > 30 * 60e3) status('online', `Grupos e canais sincronizados: ${await sincronizar()}`);
      if (pausado) return status('pausado', 'Nenhum aviso sai enquanto estiver pausado');
      for (let i = 0; i < 500 && !pausado; i++) {
        const f = await api('wa_fila');
        if (!f.aviso && f.dm) {
          // Boas-vindas no privado (Bia do suporte): uma por vez, com intervalo maior que o dos grupos
          status('enviando', 'Mensagem da Bia no privado');
          let ok = true, erro = null, msg_id = null;
          try { ({ msg_id } = await pagina('enviar', { para: f.dm.para, texto: f.dm.texto })); }
          catch (x) { ok = false; erro = x.message; if (/não respondeu|not ready|Carregando/i.test(erro)) return status('aguardando', 'WhatsApp Web não respondeu; tento de novo em 1 min'); }
          await api('wa_dm_resultado', { id: f.dm.id, ok, erro, msg_id });
          const [min, max] = f.intervalo || [45, 120];
          const s = Math.round(min + Math.random() * (max - min));
          status('online', `${ok ? 'Mensagem da Bia enviada' : 'Mensagem da Bia falhou'}. Próxima em ${s}s`);
          await espera(s * 1000);
          continue;
        }
        if (!f.aviso) { status('online', `Número ${numero}. Sem avisos na fila.`); return; }
        const d = f.destinos[0];
        status('enviando', `"${f.aviso.titulo}" → ${d.nome} (faltam ${f.destinos.length})`);
        let ok = true, erro = null, msg_id = null;
        try { ({ msg_id } = await pagina('enviar', { para: d.envio_id || d.id, texto: f.aviso.texto })); }
        catch (x) {
          ok = false; erro = x.message;
          // WhatsApp Web travado ou recarregando: não marca falha, tenta de novo no próximo minuto
          if (/não respondeu|not ready|Carregando/i.test(erro)) return status('aguardando', `WhatsApp Web não respondeu; tento de novo em 1 min (${d.nome})`);
        }
        await api('wa_resultado', { aviso_id: f.aviso.id, destino_id: d.id, ok, erro, msg_id });
        const [min, max] = f.intervalo || [20, 90];
        const s = Math.round(min + Math.random() * (max - min));
        status('enviando', `${ok ? 'Enviado' : 'Falhou'}: ${d.nome}. Próximo em ${s}s`);
        await espera(s * 1000);
      }
    } catch (x) {
      status('erro', x.message);
    } finally { ocupado = false; }
  }

  setTimeout(ciclo, 8000);
  setInterval(ciclo, 60000);
})();
