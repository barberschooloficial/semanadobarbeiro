// Garante que integrações externas não travem a resposta ao lead
function comTimeout(promise, ms) {
  return Promise.race([promise.catch(() => null), new Promise(r => setTimeout(() => r(null), ms))]);
}

// Horário de Brasília em texto (ex.: "seg, 02/11 às 08h")
function quando(iso) {
  const d = new Date(iso);
  const f = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return f.format(d);
}

// Relógio do sistema. Em produção é o horário real; no modo local o painel de testes pode simular outro momento.
function agora() {
  return Date.now() + (process.env.SDB_LOCAL === '1' ? Number(process.env.SDB_OFFSET_MS || 0) : 0);
}

module.exports = { comTimeout, quando, agora };
