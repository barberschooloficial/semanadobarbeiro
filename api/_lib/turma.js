// Turmas semanais automáticas (horário de Brasília, UTC-3 fixo desde 2019).
// Toda segunda-feira começa uma turma: módulos de segunda a sexta às 8h, lives na segunda e na sexta,
// oferta do curso na sexta (depois da roleta do módulo 5) e encerramento no domingo 23h59.
// Quem se cadastra de segunda a quarta entra na turma da semana; de quinta a domingo, na da próxima segunda.
const OFFSET = -3 * 3600e3;
const DIA = 86400e3;

const ymd = (ms) => new Date(ms + OFFSET).toISOString().slice(0, 10);
const dow = (ms) => new Date(ms + OFFSET).getUTCDay(); // 0 = domingo
const em = (dataYmd, dias, hora = '00:00') => Date.parse(`${dataYmd}T${hora}:00-03:00`) + dias * DIA;

function segundaDa(ms) {
  const d = dow(ms);
  return ymd(ms - ((d + 6) % 7) * DIA);
}

// ate = último dia da semana que ainda entra na turma atual (1 = segunda ... 6 = sábado). Padrão: quarta.
function turmaParaCadastro(ms, ate = 3) {
  const d = dow(ms);
  const limite = Math.min(6, Math.max(1, Number(ate) || 3));
  if (d >= 1 && d <= limite) return segundaDa(ms);
  return ymd(Date.parse(`${segundaDa(ms)}T12:00:00-03:00`) + 7 * DIA);
}

// Turma de um aluno: a gravada no cadastro; para cadastros antigos, a semana de semana_inicio
function turmaDo(lead, cfg = {}) {
  if (lead?.turma_inicio) return String(lead.turma_inicio).slice(0, 10);
  if (cfg.semana_inicio) return segundaDa(Date.parse(cfg.semana_inicio));
  return turmaParaCadastro(Date.parse(lead?.created_at || Date.now()));
}

function janela(turma, cfg = {}) {
  const horaAula = cfg.aula_hora || '08:00';
  const liveDias = String(cfg.live_dias || '1,5').split(',').map(Number).filter(n => n >= 1 && n <= 7);
  const liveIni = cfg.live_inicio || '19:00', liveFim = cfg.live_fim || '20:00';
  return {
    turma,
    inicio: em(turma, 0),
    libera: (dia) => em(turma, Number(dia) - 1, horaAula),
    ofertaAbre: em(turma, 4, cfg.oferta_hora || horaAula),
    fim: em(turma, 6, '23:59') + 59e3,
    lives: liveDias.map(d => ({ dia: d, inicio: em(turma, d - 1, liveIni), fim: em(turma, d - 1, liveFim) })),
  };
}

const NOMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
function textoLives(cfg = {}) {
  const dias = String(cfg.live_dias || '1,5').split(',').map(Number).map(d => NOMES[d % 7]);
  const ini = (cfg.live_inicio || '19:00').replace(':00', 'h'), fim = (cfg.live_fim || '20:00').replace(':00', 'h');
  return `${dias.join(' e ')}, das ${ini} às ${fim}`;
}

const rotulo = (turma) => { const [, m, d] = turma.split('-'); return `${d}/${m}`; };

module.exports = { ymd, dow, em, segundaDa, turmaParaCadastro, turmaDo, janela, textoLives, rotulo, DIA };
