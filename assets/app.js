// App de aulas da Semana do Barbeiro
(() => {
  const { api, store, qs, ir, caminho, token, maskWhats, maskCpf, toast, esc, quando, brl, pixel, C } = sdb;
  const $ = (id) => document.getElementById(id);
  let T = token();
  let estado = null;
  let desvio = 0; // diferença entre o relógio do servidor e o do celular
  const agora = () => Date.now() + desvio;
    const posHotmart = caminho().startsWith('/barberhub') || qs('pos') === 'hotmart';

  // ---------- Login ----------
  $('lnkCadastro').href = C.SITE_URL;
  maskWhats($('lw'));
  $('fLogin').addEventListener('submit', async (e) => {
    e.preventDefault(); $('lErro').textContent = '';
    try {
      const r = await api('entrar', { method: 'POST', body: { whatsapp: $('lw').value, email: $('le').value } });
      T = r.token; store.set('sdb_token', T); carregar();
    } catch (err) { $('lErro').textContent = err.message; }
  });

  function mostrarLogin() { $('main').hidden = true; $('login').hidden = false; }

  // ---------- Carregar estado ----------
  async function carregar() {
    if (!T) return mostrarLogin();
    try {
      estado = await api('me', { token: T });
      desvio = Date.parse(estado.agora) - Date.now();
    } catch (err) {
      if (err.status === 401) { store.del('sdb_token'); T = null; return mostrarLogin(); }
      toast(err.message); return;
    }
    $('login').hidden = true; $('main').hidden = false;
    render();
  }

  // ---------- Render ----------
  let modSel = null;      // módulo aberto nas abas
  let aulaSel = null;     // aula aberta no player
  let playerChave = null; // evita recarregar o vídeo a cada atualização
  const ticks = {};       // contadores ativos (topo e oferta)

  // Painel do topo: pode ser minimizado (fica só o progresso e um contador menor)
  function aplicarMini(mini) {
    $('painel').classList.toggle('mini', mini);
    $('btnMini').textContent = mini ? 'Expandir' : 'Minimizar';
    $('btnMini').setAttribute('aria-expanded', String(!mini));
  }
  aplicarMini(store.get('sdb_painel_mini') === '1');
  $('btnMini').onclick = () => { const mini = !$('painel').classList.contains('mini'); store.set('sdb_painel_mini', mini ? '1' : '0'); aplicarMini(mini); };

  function render() {
    const s = estado;
    $('ola').innerHTML = `Olá,<b>${esc(s.aluno.primeiro_nome)}</b>`;
    $('progTxt').textContent = `${s.progresso.assistidas} de ${s.progresso.total} aulas`;
    $('progBar').style.width = `${s.progresso.total ? (s.progresso.assistidas / s.progresso.total) * 100 : 0}%`;
    $('liveHora').textContent = (s.live.horario || 'segunda e sexta, das 19h às 20h').replace(/^./, c => c.toUpperCase());
    const lp = s.live.proxima;
    $('liveProx').innerHTML = lp ? (lp.ao_vivo ? '<b style="color:var(--vermelho)">● Ao vivo agora</b>' : `Próxima: <b>${esc(quando(lp.inicio))}</b>`) : '';
    $('liveLink').href = s.live.url || `https://www.instagram.com/${C.INSTAGRAM}/`;
    $('liveLink').dataset.track = 'live_clique';
    if (s.grupo_whatsapp_url) { $('grupoBox').hidden = false; $('grupoLink').href = s.grupo_whatsapp_url; }

    renderModulos(s);
    renderProxima(s);
    renderOferta(s);
    renderSaibaMais(s);
    renderCert(s);
    renderBarberhub(s);
    renderPremios(s);
  }

  // Agrupa as aulas em módulos (um por dia)
  function modulos(s) {
    const m = {};
    s.aulas.forEach(a => { (m[a.dia] = m[a.dia] || { dia: a.dia, aulas: [] }).aulas.push(a); });
    return Object.values(m).sort((x, y) => x.dia - y.dia).map(mod => {
      mod.abre = mod.aulas.map(a => a.libera_em).sort()[0];
      mod.liberado = mod.aulas.some(a => a.liberada);
      mod.feito = mod.aulas.every(a => a.assistida);
      mod.vistas = mod.aulas.filter(a => a.assistida).length;
      return mod;
    });
  }

  const dataCurta = (iso) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit' })
    .format(new Date(iso)).replace('.', '').replace(',', '');

  function renderModulos(s) {
    const mods = modulos(s);
    const liberados = mods.filter(m => m.liberado);
    if (modSel == null || !mods.find(m => m.dia === modSel)) modSel = (liberados[liberados.length - 1] || mods[0])?.dia;

    $('abas').innerHTML = mods.map(m => {
      const estadoAba = m.feito ? 'feito' : m.liberado ? '' : 'trancado';
      const sub = m.feito ? 'Feito ✓' : m.liberado ? 'Aberto' : dataCurta(m.abre);
      return `<button class="aba ${estadoAba}" role="tab" aria-selected="${m.dia === modSel}" data-mod="${m.dia}">
        <b>${String(m.dia).padStart(2, '0')}</b><span>${esc(sub)}</span></button>`;
    }).join('');
    $('abas').querySelectorAll('[data-mod]').forEach(b => b.onclick = () => { modSel = Number(b.dataset.mod); aulaSel = null; renderModulos(estado); });

    const m = mods.find(x => x.dia === modSel);
    let cab = '';
    if (s.expirou && s.curso.status !== 'pago') {
      // Semana encerrada: nada de módulo "abre em" no passado; só o encerramento e o caminho para o curso
      $('abas').innerHTML = '';
      $('modCab').innerHTML = `<div class="trancado-box"><h3>A Semana do Barbeiro terminou</h3><p class="muted small" style="margin:6px 0 0">As aulas grátis da sua turma saíram do ar em ${esc(quando(s.turma.fim))}. Você assistiu ${s.progresso.assistidas} de ${s.progresso.total} aulas. Obrigado por participar!</p>
        <p class="small muted" style="margin:10px 0 0">Quer continuar aprendendo? O curso completo da Barber School tem mais de 40h de aulas, do básico ao avançado, com certificado.</p></div>`;
      $('modAulas').innerHTML = ''; renderPlayer(null); return;
    }
    if (!m) { $('modCab').innerHTML = cab; $('modAulas').innerHTML = ''; renderPlayer(null); return; }
    cab += `<div class="modulo-cab"><div><span class="rotulo">Módulo ${m.dia} · ${esc(dataCurta(m.abre))}</span><h3>${esc(m.aulas[0].titulo)}</h3></div>
      ${m.liberado ? `<span class="pill ${m.feito ? 'ok' : ''}">${m.vistas} de ${m.aulas.length} concluídas</span>` : ''}</div>`;
    $('modCab').innerHTML = cab;

    if (!m.liberado) {
      renderPlayer(null);
      $('modAulas').innerHTML = `<div class="trancado-box"><div class="cadeado">🔒</div><b>Este módulo abre ${esc(quando(m.abre))}</b>
        <p class="small muted" style="margin:6px 0 0">Você recebe o aviso no WhatsApp assim que ele for liberado.</p>
        <ul>${m.aulas.map(a => `<li>Aula ${a.ordem} · ${esc(a.titulo)}</li>`).join('')}</ul></div>`;
      return;
    }
    // Antes da primeira aula do módulo: girar a roleta do dia
    if (!s.roleta[m.dia]) {
      renderPlayer(null);
      if (!$('roletaBox') || $('roletaBox').dataset.dia !== String(m.dia)) renderRoleta(m);
      return;
    }
    // aula aberta: a escolhida, senão a primeira não assistida do módulo
    if (!m.aulas.some(a => a.id === aulaSel)) aulaSel = (m.aulas.find(a => !a.assistida && a.liberada) || m.aulas[0]).id;
    renderPlayer(m.aulas.find(a => a.id === aulaSel));

    $('modAulas').innerHTML = '<div class="aulas">' + m.aulas.map(a => `
      <button class="aula-item ${a.assistida ? 'ok' : ''} ${a.id === aulaSel ? 'atual' : ''}" data-aula="${a.id}" type="button">
        <span class="thumb" style="background-image:${capa(a)}"><span class="play"></span></span>
        <span class="corpo">
          <span class="rotulo">${a.id === aulaSel ? 'Assistindo agora' : `Aula ${a.ordem}`}</span>
          <b>${esc(a.titulo)}</b>
          <span class="meta">${a.duracao_min ? a.duracao_min + ' min' : ''}${a.assistida ? ' · ✓ concluída' : ''}</span>
        </span>
      </button>`).join('') + '</div>';
    $('modAulas').querySelectorAll('[data-aula]').forEach(b => b.onclick = () => abrirAula(Number(b.dataset.aula)));
  }

  // ---------- Roleta do dia ----------
  // Mesma ordem de fatias do servidor (api/_lib/premios.js). Desenhada em SVG, sem biblioteca.
  const FATIAS = [
    { codigo: 'barbeearia', l1: '30 dias', l2: 'Barbeearia', cor: '#15120e', tx: '#f3e6c8' },
    { codigo: 'nada', l1: 'Tente', l2: 'amanhã', cor: '#efe6d4', tx: '#3b342b' },
    { codigo: 'clube', l1: 'Clube do', l2: 'Barbeiro', cor: '#8a6730', tx: '#fff7e6' },
    { codigo: 'vitalicio', l1: 'Vitalício', l2: 'cupom', cor: '#15120e', tx: '#f3e6c8' },
    { codigo: 'curso', l1: 'Desconto', l2: 'no curso', cor: '#b3261e', tx: '#fff7e6' },
    { codigo: 'nada', l1: 'Tente', l2: 'amanhã', cor: '#efe6d4', tx: '#3b342b' },
  ];
  const N = FATIAS.length, PASSO = 360 / N;
  let giro = 0;

  function rodaSvg() {
    const C = 200, R = 168, ponto = (r, ang) => { const t = (ang - 90) * Math.PI / 180; return [C + r * Math.cos(t), C + r * Math.sin(t)]; };
    let fatias = '', textos = '', defs = '';
    FATIAS.forEach((f, i) => {
      const a0 = i * PASSO - PASSO / 2, a1 = a0 + PASSO;
      const [x0, y0] = ponto(R, a0), [x1, y1] = ponto(R, a1);
      fatias += `<path class="fatia" data-i="${i}" d="M${C} ${C}L${x0.toFixed(1)} ${y0.toFixed(1)}A${R} ${R} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}Z" fill="${f.cor}"/>`;
      // texto em arco perto da borda: lê certo quando a fatia para embaixo do ponteiro
      [[128, 'l1', 'g1'], [104, 'l2', 'g2']].forEach(([r, k, cls]) => {
        const [ax, ay] = ponto(r, a0 + 4), [bx, by] = ponto(r, a1 - 4);
        defs += `<path id="arc${i}${k}" d="M${ax.toFixed(1)} ${ay.toFixed(1)}A${r} ${r} 0 0 1 ${bx.toFixed(1)} ${by.toFixed(1)}"/>`;
        textos += `<text class="${cls}" fill="${f.tx}"><textPath href="#arc${i}${k}" startOffset="50%" text-anchor="middle">${esc(f[k])}</textPath></text>`;
      });
    });
    let divisores = '';
    for (let i = 0; i < N; i++) { const [x, y] = ponto(R, i * PASSO - PASSO / 2); divisores += `<line x1="${C}" y1="${C}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`; }
    let luzes = '';
    for (let i = 0; i < 24; i++) { const [x, y] = ponto(184, i * 15); luzes += `<circle class="luz${i % 2 ? ' b' : ''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.2"/>`; }
    return `<svg class="roda-svg" viewBox="0 0 400 400" role="img" aria-label="Roleta de prêmios">
      <defs>${defs}<radialGradient id="brilho" cx="50%" cy="38%" r="62%"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></radialGradient></defs>
      <circle cx="200" cy="200" r="198" fill="#15120e"/><circle cx="200" cy="200" r="194" fill="none" stroke="#8a6730" stroke-width="2"/>
      <circle cx="200" cy="200" r="171" fill="none" stroke="#8a6730" stroke-width="3"/>
      <g class="luzes">${luzes}</g>
      <g class="gira" id="giraRoda">${fatias}<g class="divisores">${divisores}</g>${textos}</g>
      <circle cx="200" cy="200" r="168" fill="url(#brilho)" pointer-events="none"/>
      <circle cx="200" cy="200" r="50" fill="#15120e"/><circle cx="200" cy="200" r="45" fill="none" stroke="#8a6730" stroke-width="2"/>
      <circle cx="200" cy="200" r="41" fill="#fffdf8"/>
      <image href="/assets/img/logo.png" x="163" y="163" width="74" height="74"/>
    </svg>`;
  }

  function renderRoleta(m) {
    giro = 0;
    $('modAulas').innerHTML = `<div class="roleta" id="roletaBox" data-dia="${m.dia}">
      <div class="roleta-cab">
        <span class="rotulo-linha">Roleta · Módulo ${String(m.dia).padStart(2, '0')}</span>
        <h3>Gire e libere<span class="script">as aulas de hoje</span></h3>
        <p>Um giro por módulo. Cada dia tem um prêmio diferente.</p>
      </div>
      <div class="roda-area">
        <svg class="ponteiro" viewBox="0 0 40 52" aria-hidden="true"><path d="M20 50 4 14A17 17 0 1 1 36 14Z" fill="#b3261e" stroke="#15120e" stroke-width="3"/><circle cx="20" cy="17" r="6" fill="#f3e6c8" stroke="#15120e" stroke-width="2"/></svg>
        ${rodaSvg()}
      </div>
      <div id="roletaResultado" aria-live="polite"></div>
      <button class="btn btn-girar" id="btnGirar" type="button"><span>Girar a roleta</span></button>
      <p class="roleta-rodape">${m.aulas.length} aulas esperando por você neste módulo</p>
    </div>`;
    sdb.track('roleta_vista', `modulo ${m.dia}`);
    $('btnGirar').onclick = () => girar(m.dia);
  }

  async function girar(dia) {
    const btn = $('btnGirar'), box = $('roletaBox');
    btn.disabled = true; btn.innerHTML = '<span>Girando...</span>';
    let r;
    try { r = await api('roleta', { method: 'POST', token: T, body: { dia } }); }
    catch (e) { toast(e.message); btn.disabled = false; btn.innerHTML = '<span>Girar a roleta</span>'; return; }
    const g = $('giraRoda');
    const reduzido = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // a fatia sorteada para no topo, com uma folga aleatória dentro dela
    const folga = (Math.random() - .5) * PASSO * .5;
    giro = 360 * (reduzido ? 0 : 6) - r.fatia * PASSO - folga;
    box.classList.add('girando');
    if (navigator.vibrate) navigator.vibrate(20);
    g.style.transition = reduzido ? 'none' : 'transform 5.2s cubic-bezier(.12,.66,.08,1)';
    g.style.transform = `rotate(${giro}deg)`;
    const fim = () => {
      box.classList.remove('girando'); box.classList.add('parou');
      g.querySelectorAll('.fatia').forEach(f => f.classList.toggle('apaga', Number(f.dataset.i) !== r.fatia));
      if (navigator.vibrate) navigator.vibrate([30, 40, 60]);
      if (r.premio?.codigo !== 'nada') confete(box);
      mostrarPremio(r);
    };
    if (reduzido) fim(); else setTimeout(fim, 5300);
  }

  function confete(box) {
    const cores = ['#b3261e', '#1f4e8c', '#8a6730', '#f3e6c8', '#15120e'];
    const camada = document.createElement('div'); camada.className = 'confete';
    for (let i = 0; i < 42; i++) {
      const s = document.createElement('i');
      s.style.cssText = `left:${50 + (Math.random() - .5) * 30}%;background:${cores[i % cores.length]};--x:${(Math.random() - .5) * 340}px;--y:${-120 - Math.random() * 220}px;--r:${Math.random() * 720}deg;animation-delay:${Math.random() * .15}s`;
      camada.appendChild(s);
    }
    box.querySelector('.roda-area').appendChild(camada);
    setTimeout(() => camada.remove(), 1800);
  }

  function mostrarPremio(r) {
    const p = r.premio || {};
    const ganhou = p.codigo !== 'nada';
    $('btnGirar').hidden = true;
    $('roletaResultado').innerHTML = `<div class="bilhete ${ganhou ? 'ganhou' : ''}">
      <span class="script">${ganhou ? 'Você ganhou!' : 'Não foi dessa vez'}</span>
      <h3>${esc(ganhou ? p.titulo || '' : 'Amanhã tem nova chance')}</h3>
      <p>${esc(p.descricao || '')}</p>
      ${p.cupom ? cupomHtml(p.cupom) : ''}
      <button class="btn" id="btnLiberar" type="button">Assistir às aulas de hoje</button>
    </div>`;
    ligarCupom();
    $('btnLiberar').onclick = () => carregar();
    $('roletaResultado').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  const cupomHtml = (c) => `<div class="cupom"><code id="cupomTxt">${esc(c)}</code><button class="btn sm ghost" type="button" data-copiar="${esc(c)}">Copiar</button></div>`;
  function ligarCupom() {
    document.querySelectorAll('[data-copiar]').forEach(b => b.onclick = async () => {
      try { await navigator.clipboard.writeText(b.dataset.copiar); toast('Cupom copiado'); }
      catch { const t = b.previousElementSibling; const r = document.createRange(); r.selectNodeContents(t); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast('Cupom selecionado: copie com o celular'); }
    });
  }

  // Lateral: prêmios já ganhos
  function renderPremios(s) {
    const box = $('premiosBox');
    const lista = Object.entries(s.roleta || {}).map(([dia, g]) => ({ dia: Number(dia), ...g.premio })).filter(p => p.codigo !== 'nada');
    if (!lista.length) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<span class="rotulo">Roleta</span><h3 style="margin-top:6px">Meus prêmios</h3>
      <div class="premios-lista">${lista.map(p => `<div class="premio-item">
        <b>${esc(p.titulo)}</b><span class="small muted">Módulo ${p.dia}</span>
        ${p.cupom ? cupomHtml(p.cupom) : ''}
        ${p.url ? `<a class="btn sm" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.acao || 'Abrir')}</a>` : ''}
        ${p.ancora === 'oferta' && s.oferta.aberta ? `<a class="btn sm green" href="#ofertaBox" data-rolar="ofertaBox">${esc(p.acao)}</a>` : ''}
      </div>`).join('')}</div>`;
    ligarCupom();
    box.querySelectorAll('[data-rolar]').forEach(a => a.onclick = (e) => { e.preventDefault(); $(a.dataset.rolar).scrollIntoView({ behavior: 'smooth' }); });
  }

  // Player na própria página (sem pop-up): carrega o vídeo só quando a pessoa toca no play
  function renderPlayer(a) {
    const box = $('player');
    if (!a) { box.innerHTML = ''; playerChave = null; return; }
    const proxima = proximaAula(a);
    const acoes = `
      ${a.assistida ? '<span class="pill ok">✓ Aula concluída</span>' : '<button class="btn green" id="btnConcluir" type="button">✓ Concluí esta aula</button>'}
      ${proxima ? `<button class="btn ${a.assistida ? '' : 'ghost'}" id="btnProxima" type="button">Próxima aula →</button>` : ''}`;
    if (playerChave === a.id) { // mesmo vídeo: só atualiza os botões, sem reiniciar
      $('playerAcoes').innerHTML = acoes; ligarAcoes(a, proxima); return;
    }
    playerChave = a.id;
    box.innerHTML = `<div class="player">
      <div class="video" id="video">
        <button class="vposter" id="poster" type="button" style="background-image:${capa(a)}" aria-label="Assistir à aula ${a.ordem}">
          <span class="play grande"></span><span class="poster-txt">Toque para assistir</span>
        </button>
      </div>
      <div class="player-info">
        <span class="rotulo">Aula ${a.ordem} · ${a.duracao_min ? a.duracao_min + ' min' : ''}</span>
        <h3>${esc(a.titulo)}</h3>
        <p class="small muted" style="margin:0">${esc(a.descricao || '')}</p>
        <div class="player-acoes" id="playerAcoes">${acoes}</div>
      </div>
    </div>`;
    $('poster').onclick = () => { sdb.track('aula_play', `aula ${a.ordem}`); tocar(a); };
    ligarAcoes(a, proxima);
  }

  function tocar(a) {
    const v = $('video');
    if (sdb.DEMO) {
      v.innerHTML = `<div class="video-aviso">Aqui toca o vídeo da aula no site publicado.<br>Na demonstração, marque como concluída para seguir.</div>`;
      return;
    }
    if (!a.youtube_id) { toast('O vídeo desta aula está sendo publicado. Volte em alguns minutos.'); return; }
    v.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(a.youtube_id)}?rel=0&modestbranding=1&playsinline=1&autoplay=1" title="${esc(a.titulo)}" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
  }

  function proximaAula(a) {
    const lista = estado.aulas.filter(x => x.liberada);
    const i = lista.findIndex(x => x.id === a.id);
    return i >= 0 ? lista[i + 1] || null : null;
  }

  function ligarAcoes(a, proxima) {
    const ok = $('btnConcluir');
    if (ok) ok.onclick = async () => {
      ok.disabled = true;
      try { await api('progresso', { method: 'POST', token: T, body: { aula_id: a.id } }); toast('Aula concluída! 💈'); await carregar(); }
      catch (e) { toast(e.message); } finally { if ($('btnConcluir')) $('btnConcluir').disabled = false; }
    };
    const px = $('btnProxima');
    if (px && proxima) px.onclick = () => abrirAula(proxima.id);
  }

  function abrirAula(id) {
    const a = estado.aulas.find(x => x.id === id);
    if (!a || !a.liberada) return;
    aulaSel = id; modSel = a.dia;
    renderModulos(estado);
    $('player').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  function renderProxima(s) {
    const mods = modulos(s);
    const prox = mods.find(m => !m.liberado);
    pararContagem('topo');
    $('cd').innerHTML = ''; $('proxInfo').textContent = '';
    if (prox && !s.expirou) {
      const comecou = mods.some(m => m.liberado);
      $('proxLabel').textContent = comecou ? 'Próximo módulo' : 'A Semana do Barbeiro começa';
      $('proxTitulo').textContent = `Módulo ${prox.dia}`;
      $('proxInfo').textContent = `Abre ${quando(prox.abre)}`;
      // Contador só nas últimas 24h antes do módulo abrir (nada de "dias" antes do 5º dia)
      if (Date.parse(prox.abre) - agora() <= 864e5) contagem('topo', prox.abre, $('cd'), false, () => carregar());
      else setTimeout(() => carregar(), Math.min(Date.parse(prox.abre) - agora() - 864e5 + 1000, 2147483647));
    } else if (!s.expirou || s.curso.status === 'pago') {
      $('proxLabel').textContent = 'Todos os módulos liberados';
      $('proxTitulo').textContent = s.expirou ? 'Suas aulas continuam abertas' : 'Assista até domingo';
      $('proxInfo').textContent = s.expirou ? 'Como aluno da Barber School, você segue com acesso às 10 aulas.' : `As aulas ficam no ar até ${quando(s.turma.fim)}.`;
    } else {
      $('proxLabel').textContent = 'Semana encerrada';
      $('proxTitulo').textContent = 'Obrigado por participar';
      $('proxInfo').textContent = `Sua turma terminou ${quando(s.turma.fim)}.`;
    }
  }

  function pararContagem(chave) { clearInterval(ticks[chave]); delete ticks[chave]; }

  function contagem(chave, alvoIso, el, comDias, aoZerar) {
    const alvo = Date.parse(alvoIso);
    const pinta = () => {
      let ms = alvo - agora();
      if (ms <= 0) { pararContagem(chave); el.innerHTML = ''; aoZerar && aoZerar(); return; }
      const d = comDias ? Math.floor(ms / 864e5) : 0; ms -= d * 864e5;
      const h = Math.floor(ms / 36e5); ms -= h * 36e5;
      const m = Math.floor(ms / 6e4); const sec = Math.floor((ms - m * 6e4) / 1e3);
      const p = (n) => String(n).padStart(2, '0');
      el.innerHTML = (comDias ? `<div><b>${d}</b><span>${d === 1 ? 'dia' : 'dias'}</span></div>` : '') + `<div><b>${p(h)}</b><span>horas</span></div><div><b>${p(m)}</b><span>min</span></div><div><b>${p(sec)}</b><span>seg</span></div>`;
    };
    pararContagem(chave);
    pinta(); ticks[chave] = setInterval(pinta, 1000);
  }

  // Oferta do curso: só no 5º dia (quando abre) e com destaque no topo
  function renderOferta(s) {
    const o = s.oferta, box = $('ofertaBox');
    pararContagem('oferta');
    if (s.curso.status === 'pago' || posHotmart) {
      box.innerHTML = s.curso.status === 'pago'
        ? `<div class="card gold" style="margin-bottom:18px"><span class="tag">✓ Matrícula confirmada</span><h3>Você agora é aluno da Barber School!</h3><p class="muted small" style="margin:0">O acesso ao curso completo chega no seu e-mail pela Hotmart.</p></div>`
        : `<div class="card gold" style="margin-bottom:18px"><span class="tag">Pedido recebido</span><h3>Obrigado pela sua matrícula!</h3><p class="muted small" style="margin:0">Assim que a Hotmart confirmar o pagamento, o acesso ao curso completo chega no seu e-mail.</p></div>`;
      return;
    }
    if (!(o.aberta && o.checkout)) { box.innerHTML = ''; return; }
    if (!window.__ofertaVista) { window.__ofertaVista = 1; sdb.track('oferta_vista'); }
    const itens = (C.CURSO_ITENS || []).map(i => `<li>${esc(i)}</li>`).join('');
    box.innerHTML = `<section class="oferta">
      <div class="foto-fundo" style="background-image:url('/assets/img/bancada.jpg')"></div>
      <div class="oferta-grid">
        <div>
          <span class="tag cheia">Condição de encerramento · só para quem participou</span>
          <h2>Curso completo<span class="script">Barber School</span></h2>
          <p style="color:#d9ccb2">Gostou das aulas da semana? No curso completo você aprende o resto, do básico ao avançado, no seu ritmo.</p>
          <ul class="list-ok">${itens}</ul>
        </div>
        <div>
          <span class="rotulo" style="color:#c9b994">Termina em</span>
          <div class="countdown" id="cdOferta" style="margin:8px 0 18px"></div>
          <div class="price"><s>${brl(o.preco_de)}</s>${brl(o.preco_por)}</div>
          <p class="small" style="color:#c9b994">${esc(o.parcelas || '')}</p>
          <a class="btn green" id="btnCurso" data-track="checkout_clique" href="${esc(o.checkout)}">Quero o curso por ${brl(o.preco_por)}</a>
          <p class="small" style="color:#a8997f;margin:10px 0 0">Até ${esc(quando(o.fecha_em))}. Depois volta para ${brl(o.preco_de)}.</p>
        </div>
      </div>
    </section>`;
    contagem('oferta', o.fecha_em, $('cdOferta'), true, () => carregar());
    $('btnCurso').onclick = () => pixel('InitiateCheckout', { value: Number(o.preco_por), currency: 'BRL', content_name: 'Curso Barber School' });
  }

  // Nos outros dias: só um convite discreto no fim da página
  function renderSaibaMais(s) {
    const box = $('saibaMais');
    if (s.curso.status === 'pago' || posHotmart || (s.oferta.aberta && s.oferta.checkout)) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="saiba-mais">
      <img src="/assets/img/logo.png" alt="" width="72" height="72">
      <div><span class="rotulo">Barber School</span><h3 style="margin:4px 0 2px">Quer ir além das 10 aulas?</h3>
        <p class="small muted" style="margin:0">Conheça o curso completo de barbeiro do professor Cris Aita.</p></div>
      <a class="btn sm" data-track="saiba_mais_clique" data-track-detalhe="app" href="https://www.barberschool.com.br" target="_blank" rel="noopener">Saiba mais</a>
    </div>`;
  }

  // Capa da aula: miniatura do próprio vídeo no YouTube (cai na imagem padrão se não houver)
  const capa = (a) => a && /^[\w-]{6,20}$/.test(a.youtube_id || '') ? `url('https://i.ytimg.com/vi/${a.youtube_id}/hqdefault.jpg'), url('/assets/img/aula.jpg')` : `url('/assets/img/aula.jpg')`;
  let querCert = qs('comprar') === 'certificado';
  function renderCert(s) {
    const c = s.certificado, box = $('certBox');
    box.hidden = false;
    if (c.liberado) {
      box.innerHTML = `<span class="rotulo">Certificado</span><h3 style="margin-top:6px">Seu certificado está pronto</h3><p class="small muted">Parabéns por concluir as 10 aulas!</p><a class="btn" href="/certificado?t=${T}">Ver e baixar certificado</a>`;
    } else if (c.status === 'pago') {
      box.innerHTML = `<span class="rotulo">Certificado</span><h3 style="margin-top:6px">Pago ✓</h3><p class="small muted">Ele libera aqui quando você concluir as 10 aulas (${s.progresso.assistidas}/${s.progresso.total}). Ao terminar cada aula, toque em "Concluí esta aula".</p>`;
    } else if (c.status === 'pendente' && c.invoice_url) {
      box.innerHTML = `<span class="rotulo">Certificado</span><h3 style="margin-top:6px">Pagamento em aberto</h3><p class="small muted">Assim que o pagamento cair, ele fica marcado como pago aqui.</p><button class="btn green" id="btnPagarCert">Pagar ${brl(c.preco)} com Pix</button><button class="btn ghost" style="margin-top:8px" id="btnRecarregar">Já paguei, atualizar</button>`;
      $('btnRecarregar').onclick = () => carregar();
      $('btnPagarCert').onclick = () => { abrirCpf('certificado'); cobrarCert({ token: T, origem: 'app' }); };
    } else if (s.expirou && s.curso.status !== 'pago') {
      box.innerHTML = ''; box.hidden = true; // semana encerrada sem as aulas: não dá mais para concluir as 10 aulas
    } else {
      box.innerHTML = `<span class="rotulo">Opcional</span><h3 style="margin-top:6px">Certificado de Participação</h3><p class="small muted">Comprove que você fez a Semana do Barbeiro. Certificado digital com seu nome, liberado ao concluir as 10 aulas.</p><div class="price" style="font-size:2.4rem">${brl(c.preco || 19.7)}</div><button class="btn green" id="btnCert" style="margin-top:10px">Quero meu certificado</button>`;
      $('btnCert').onclick = () => abrirCpf('certificado');
    }
    // Link direto de compra (?comprar=certificado, usado no catálogo do WhatsApp): depois do login já abre o pagamento
    if (querCert) {
      querCert = false;
      if ($('btnCert')) abrirCpf('certificado');
      else if (!box.hidden) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function renderBarberhub(s) {
    const b = s.barberhub, box = $('barberhubBox');
    const mostrar = s.curso.status === 'pago' || posHotmart;
    if (!mostrar || !b.preco) { box.innerHTML = ''; return; }
    if (b.status === 'pago') {
      box.innerHTML = `<div class="card" style="margin-bottom:16px"><h3>Barbeearia ✓ ativada</h3><p class="small muted">Você vai receber os dados de acesso da Barbeearia no seu WhatsApp.</p></div>`;
      return;
    }
    const ciclo = b.ciclo === 'UNICO' ? '' : '/mês';
    const recursos = (C.BARBERHUB_RECURSOS || []).map(i => `<li>${esc(i)}</li>`).join('');
    const pendente = b.status === 'pendente' && b.invoice_url;
    box.innerHTML = `<div class="card gold" style="margin-bottom:18px">
      <span class="tag">${posHotmart ? 'Parabéns pela matrícula! · ' : ''}Oferta só para alunos</span>
      <h2 style="margin-bottom:6px">Barbeearia<span class="script">o sistema da sua barbearia</span></h2>
      <p class="muted">Agora que você vai cortar de verdade, organize seus clientes e sua agenda desde o primeiro dia.</p>
      <ul class="list-ok">${recursos}</ul>
      <div class="price" style="font-size:2.6rem">${brl(b.preco)}<span style="font-size:1.2rem" class="muted">${ciclo}</span></div>
      ${pendente ? `<a class="btn green" href="${esc(b.invoice_url)}" style="margin-top:10px">Concluir pagamento</a>` : `<button class="btn green" id="btnHub" style="margin-top:10px">Quero a Barbeearia</button>`}
      ${posHotmart && !pendente ? `<a class="btn ghost" href="/" style="margin-top:8px">Agora não, voltar às aulas</a>` : ''}
    </div>`;
    if (!window.__hubVisto) { window.__hubVisto = 1; sdb.track('barberhub_vista'); }
    if (!pendente) $('btnHub').onclick = () => { sdb.track('barberhub_clique'); abrirCpf('barberhub'); };
  }

  // ---------- CPF / pagamentos Asaas ----------
  let produtoCpf = null;
  maskCpf($('cpf'));
  function abrirCpf(produto) {
    produtoCpf = produto; $('cpfErro').textContent = '';
    const s = estado;
    if (produto === 'certificado') {
      $('cpfTitulo').textContent = `Certificado — ${brl(s.certificado.preco || 19.7)}`;
      $('cpfTexto').textContent = 'Informe seu CPF para emitir a cobrança. Você paga com Pix, cartão ou boleto.';
    } else {
      $('cpfTitulo').textContent = `Barbeearia — ${brl(s.barberhub.preco)}${s.barberhub.ciclo === 'UNICO' ? '' : '/mês'}`;
      $('cpfTexto').textContent = 'Informe seu CPF para emitir a cobrança. Você paga com Pix, cartão ou boleto.';
    }
    $('cpfForm').hidden = false; $('pixBox').hidden = true;
    $('mCpf').classList.add('on');
  }
  // ---------- Pix do certificado dentro do app ----------
  let pixTimer = null;
  const pararPix = () => { if (pixTimer) clearInterval(pixTimer); pixTimer = null; };
  function mostrarPix(r) {
    $('cpfForm').hidden = true; $('pixBox').hidden = false;
    $('cpfTexto').textContent = 'Abra o app do seu banco e pague com Pix. Assim que o pagamento cair, o certificado fica marcado como pago aqui.';
    $('pixValor').textContent = `Pague ${brl(estado?.certificado?.preco || 19.7)} pelo app do seu banco`;
    $('pixQr').src = 'data:image/png;base64,' + r.pix.qr;
    $('pixCopia').textContent = r.pix.copia;
    $('pixOutro').href = r.invoiceUrl;
    $('pixCopiar').onclick = async () => {
      try { await navigator.clipboard.writeText(r.pix.copia); toast('Código Pix copiado. Cole no app do seu banco.'); }
      catch { const rg = document.createRange(); rg.selectNodeContents($('pixCopia')); const se = getSelection(); se.removeAllRanges(); se.addRange(rg); toast('Código selecionado: copie e cole no banco.'); }
    };
    sdb.track('cert_pix', 'app');
    pararPix();
    pixTimer = setInterval(async () => {
      if (document.hidden) return;
      try {
        const s = await api('certificado?t=' + T);
        if (s.status === 'pago') { pararPix(); $('mCpf').classList.remove('on'); toast('Pagamento recebido! Certificado pago ✓', 6000); carregar(); }
      } catch {}
    }, 5000);
  }
  async function cobrarCert(body) {
    $('cpfErro').textContent = ''; $('cpfBtn').disabled = true;
    try {
      const r = await api('certificado', { method: 'POST', body });
      if (r.pago) { $('mCpf').classList.remove('on'); carregar(); return; }
      if (r.pix && r.pix.qr) { mostrarPix(r); carregar(); return; }
      ir(r.invoiceUrl); // conta sem chave Pix: paga na página do Asaas
    } catch (e) { $('cpfErro').textContent = e.message; } finally { $('cpfBtn').disabled = false; }
  }
  $('cpfFechar').onclick = () => { pararPix(); $('mCpf').classList.remove('on'); };
  $('cpfBtn').onclick = async () => {
    if (produtoCpf === 'certificado') { pixel('InitiateCheckout', { content_name: 'certificado' }); return cobrarCert({ token: T, cpf: $('cpf').value, origem: 'app' }); }
    $('cpfErro').textContent = ''; $('cpfBtn').disabled = true;
    try {
      const r = await api(produtoCpf, { method: 'POST', body: { token: T, cpf: $('cpf').value, origem: 'app' } });
      pixel('InitiateCheckout', { content_name: produtoCpf });
      if (r.pago) { $('mCpf').classList.remove('on'); carregar(); return; }
      ir(r.invoiceUrl);
    } catch (e) { if ($('cpfErro')) $('cpfErro').textContent = e.message; } finally { if ($('cpfBtn')) $('cpfBtn').disabled = false; }
  };

  // ---------- Início ----------
  const pago = qs('pago');
  if (pago === 'certificado') toast('Recebemos seu pagamento do certificado. A confirmação pode levar alguns minutos.', 6000);
  if (pago === 'barberhub') toast('Recebemos seu pedido da Barbeearia. Você recebe o acesso no WhatsApp.', 6000);
  if (qs('t') && !sdb.DEMO) history.replaceState(null, '', location.pathname); // tira o token da barra de endereço
  carregar();
  setInterval(() => { if (!document.hidden && T) carregar(); }, 120000);
})();
