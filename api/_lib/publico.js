// Público de um disparo: carrega os alunos e aplica o mesmo filtro do painel
const { PERFIS } = require('./quiz-def');
const { turmaDo, rotulo } = require('./turma');

const SITUACOES = {
  '': 'Todos os cadastros',
  quiz: 'Respondeu a enquete', sem_quiz: 'Não respondeu a enquete',
  assistiu: 'Assistiu alguma aula', nao_assistiu: 'Não assistiu nenhuma aula', todas: 'Assistiu às 10 aulas',
  cert_pago: 'Certificado pago', cert_pendente: 'Certificado pendente',
  curso: 'Comprou o curso', sem_curso: 'Não comprou o curso', barbeearia: 'Assinou a Barbeearia',
};

async function todos(db, table, query) {
  const out = [];
  for (let off = 0; off < 200000; off += 1000) {
    const rows = await db.select(table, `${query}&limit=1000&offset=${off}`);
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

async function carregar(db, cfg = {}) {
  const [leads, prog, aulas] = await Promise.all([
    todos(db, 'sdb_leads', 'select=id,nome,email,whatsapp,token,manychat_id,email_optout,perfil,quiz,quiz_at,cert_status,curso_status,barberhub_status,turma_inicio,utm_source,utm_campaign,created_at&order=created_at.asc'),
    todos(db, 'sdb_progresso', 'select=lead_id,aula_id'),
    db.select('sdb_aulas', 'select=id,dia'),
  ]);
  const diaDa = Object.fromEntries(aulas.map(a => [a.id, a.dia]));
  const por = {};
  prog.forEach(p => { (por[p.lead_id] = por[p.lead_id] || { n: 0, dias: new Set() }).n++; por[p.lead_id].dias.add(diaDa[p.aula_id]); });
  return leads.map(l => ({ ...l, turma: turmaDo(l, cfg), aulas: por[l.id]?.n || 0, dias: por[l.id]?.dias || new Set() }));
}

// f = { turma: 'AAAA-MM-DD', perfil, sit, resp: {k, v}, sem_curso: bool, dia_sem_aula: 1..5 }
function filtrar(leads, f = {}) {
  return leads.filter(a => {
    if (f.turma && a.turma !== f.turma) return false;
    if (f.perfil && a.perfil !== f.perfil) return false;
    if (f.resp?.k && a.quiz?.[f.resp.k] !== f.resp.v) return false;
    if (f.sem_curso && a.curso_status === 'pago') return false;
    if (f.dia_sem_aula && a.dias.has(Number(f.dia_sem_aula))) return false;
    switch (f.sit || '') {
      case 'quiz': return !!a.quiz_at;
      case 'sem_quiz': return !a.quiz_at;
      case 'assistiu': return a.aulas > 0;
      case 'nao_assistiu': return a.aulas === 0;
      case 'todas': return a.aulas >= 10;
      case 'cert_pago': return a.cert_status === 'pago';
      case 'cert_pendente': return a.cert_status === 'pendente';
      case 'curso': return a.curso_status === 'pago';
      case 'sem_curso': return a.curso_status !== 'pago';
      case 'barbeearia': return a.barberhub_status === 'pago';
      default: return true;
    }
  });
}

// Quem pode receber por cada canal
const aptos = (leads, canal) => leads.filter(l => canal === 'email' ? (l.email && !l.email_optout) : !!l.manychat_id);

function descrever(f = {}) {
  const p = [f.turma ? `Turma ${rotulo(f.turma)}` : null, SITUACOES[f.sit || ''] || 'Todos'].filter(Boolean);
  if (f.perfil) p.push(`perfil ${PERFIS[f.perfil] || f.perfil}`);
  if (f.resp?.t) p.push(`respondeu "${f.resp.t}"`);
  if (f.dia_sem_aula) p.push(`sem aula do módulo ${f.dia_sem_aula}`);
  if (f.sem_curso && f.sit !== 'sem_curso') p.push('sem quem já comprou o curso');
  return p.join(' · ');
}

module.exports = { carregar, filtrar, aptos, descrever, SITUACOES };
