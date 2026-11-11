// Gestão de leads: listas importadas, filtros por região e engajamento, blocos e importação
const { normalizaWhats, normalizaEmail, limpaTexto } = require('./valida');
const { localDe } = require('./regiao');

const ENGAJAMENTO = {
  '': 'Todos',
  nao_convidado: 'Ainda não recebeu convite',
  convidado: 'Recebeu convite',
  nao_abriu: 'Recebeu e não abriu',
  abriu_ou_clicou: 'Abriu ou clicou e não se cadastrou',
  clicou: 'Clicou no link',
  cadastrou: 'Se cadastrou',
  sem_cadastro: 'Não se cadastrou',
};

async function todos(db, table, query) {
  const out = [];
  for (let off = 0; off < 500000; off += 1000) {
    const rows = await db.select(table, `${query}&limit=1000&offset=${off}`);
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

async function carregar(db, lista) {
  const filtroLista = lista ? `&lista=eq.${encodeURIComponent(lista)}` : '';
  const [cs, envios] = await Promise.all([
    todos(db, 'sdb_contatos', `select=id,token,lista,nome,whatsapp,email,cidade,uf,regiao,perfil,bloco,email_optout,wa_optout,manychat_id,lead_id,aberto_em,clicado_em,created_at${filtroLista}&order=created_at.asc`),
    todos(db, 'sdb_contato_envios', 'select=contato_id,status&status=eq.enviado'),
  ]);
  const conv = {};
  envios.forEach(e => { conv[e.contato_id] = (conv[e.contato_id] || 0) + 1; });
  return cs.map(c => ({ ...c, convites: conv[c.id] || 0 }));
}

// f = { lista, regiao, uf, cidade, perfil, bloco ('' todos | '-' sem bloco | nome), eng }
function filtrar(cs, f = {}) {
  const cid = String(f.cidade || '').trim().toLowerCase();
  return cs.filter(c => {
    if (f.lista && c.lista !== f.lista) return false;
    if (f.regiao && c.regiao !== f.regiao) return false;
    if (f.uf && c.uf !== f.uf) return false;
    if (cid && !String(c.cidade || '').toLowerCase().includes(cid)) return false;
    if (f.perfil && c.perfil !== f.perfil) return false;
    if (f.bloco === '-' && c.bloco) return false;
    if (f.bloco && f.bloco !== '-' && c.bloco !== f.bloco) return false;
    switch (f.eng || '') {
      case 'nao_convidado': return !c.convites;
      case 'convidado': return c.convites > 0;
      case 'nao_abriu': return c.convites > 0 && !c.aberto_em && !c.clicado_em;
      case 'abriu_ou_clicou': return (c.aberto_em || c.clicado_em) && !c.lead_id;
      case 'clicou': return !!c.clicado_em;
      case 'cadastrou': return !!c.lead_id;
      case 'sem_cadastro': return !c.lead_id;
      default: return true;
    }
  });
}

const aptos = (cs, canal) => cs.filter(c => canal === 'email' ? (c.email && !c.email_optout) : (c.whatsapp && !c.wa_optout));

function descrever(f = {}) {
  const p = [`Lista ${f.lista || 'todas'}`];
  if (f.bloco) p.push(f.bloco === '-' ? 'sem bloco' : f.bloco);
  if (f.regiao) p.push(f.regiao);
  if (f.uf) p.push(f.uf);
  if (f.cidade) p.push(f.cidade);
  if (f.eng) p.push(ENGAJAMENTO[f.eng]);
  return p.join(' · ');
}

// Colunas aceitas na importação (planilha da base antiga, export da Hotmart, ManyChat etc.)
const COLUNAS = {
  nome: ['nome_completo', 'nome', 'name', 'nome do comprador', 'comprador', 'full name', 'aluno'],
  primeiro_nome: ['primeiro_nome', 'first name', 'first_name'],
  whatsapp: ['whatsapp', 'telefone', 'celular', 'phone', 'telefone final comprador', 'telefone do comprador', 'fone', 'whats'],
  email: ['email', 'e-mail', 'email do comprador', 'e-mail do comprador', 'mail'],
  cidade: ['cidade', 'city', 'cidade do comprador'],
  uf: ['uf_pelo_ddd', 'uf', 'estado', 'state', 'estado do comprador'],
  perfil: ['perfil'],
};
function mapear(cabecalho) {
  const norm = cabecalho.map(h => String(h || '').trim().toLowerCase());
  const m = {};
  for (const [campo, nomes] of Object.entries(COLUNAS)) {
    const i = nomes.map(n => norm.indexOf(n)).find(i => i >= 0);
    if (i != null && i >= 0) m[campo] = i;
    else { const j = norm.findIndex(h => nomes.some(n => h.includes(n))); if (j >= 0 && !Object.values(m).includes(j)) m[campo] = j; }
  }
  return m;
}

// Linha da planilha → contato (ou null se não tem como contatar)
function normalizar(obj, lista) {
  const whatsapp = normalizaWhats(obj.whatsapp) || null;
  const email = normalizaEmail(obj.email) || null;
  if (!whatsapp && !email) return null;
  const nome = limpaTexto(obj.nome || obj.primeiro_nome || '', 80) || null;
  const { uf, regiao } = localDe(whatsapp, obj.uf);
  return {
    lista, nome, whatsapp, email, cidade: limpaTexto(obj.cidade || '', 80) || null, uf, regiao,
    perfil: ['iniciante', 'ja_corta', 'profissional'].includes(obj.perfil) ? obj.perfil : null,
    extra: obj.extra || null,
  };
}

module.exports = { ENGAJAMENTO, carregar, filtrar, aptos, descrever, mapear, normalizar, todos };
