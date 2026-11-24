// Validação e normalização de dados do lead
function limpaTexto(s, max = 120) {
  return String(s || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizaWhats(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;        // DDD + número
  if (!/^55\d{10,11}$/.test(d)) return null;
  const ddd = Number(d.slice(2, 4));
  if (ddd < 11 || ddd > 99) return null;
  return d;
}

// Erros de digitação mais comuns nos provedores usados no Brasil (gmial.com, hotmal.com, gmail.con, gmail.com.br...)
const DOMINIOS = {
  gmail: 'gmail.com', gmial: 'gmail.com', gmal: 'gmail.com', gmali: 'gmail.com', gamil: 'gmail.com', gmaill: 'gmail.com', gnail: 'gmail.com', gmai: 'gmail.com', gimail: 'gmail.com', gemail: 'gmail.com', gmsil: 'gmail.com', gmeil: 'gmail.com', gmil: 'gmail.com', gmaio: 'gmail.com', gmailcom: 'gmail.com',
  hotmail: 'hotmail.com', hotmal: 'hotmail.com', hotmil: 'hotmail.com', hotmai: 'hotmail.com', hotmial: 'hotmail.com', hormail: 'hotmail.com', hotamil: 'hotmail.com', hotmaill: 'hotmail.com', hotimail: 'hotmail.com', homail: 'hotmail.com', htmail: 'hotmail.com', hotmsil: 'hotmail.com',
  outlook: 'outlook.com', outlok: 'outlook.com', outllok: 'outlook.com', outloo: 'outlook.com', otlook: 'outlook.com', outlook1: 'outlook.com',
  yahoo: 'yahoo.com', yaho: 'yahoo.com', yahho: 'yahoo.com', yhaoo: 'yahoo.com', yahool: 'yahoo.com',
  icloud: 'icloud.com', iclod: 'icloud.com', icoud: 'icloud.com', icload: 'icloud.com',
  live: 'live.com', bol: 'bol.com.br', uol: 'uol.com.br', terra: 'terra.com.br', ig: 'ig.com.br',
};
// Domínios que existem também com .com.br e não devem ser trocados
const COM_BR_OK = new Set(['hotmail.com.br', 'yahoo.com.br', 'outlook.com.br', 'live.com.br', 'bol.com.br', 'uol.com.br', 'terra.com.br', 'ig.com.br']);
function corrigeDominio(dom) {
  let d = dom.replace(/\.+/g, '.').replace(/^\.|\.$/g, '')
    .replace(/\.(con|cmo|ocm|vom|xom|comm|co|cm|om|coom|cpm|c0m)$/, '.com')
    .replace(/\.com\.(bt|be|vr|b)$/, '.com.br').replace(/\.combr$/, '.com.br').replace(/\.br\.com$/, '.com.br');
  if (COM_BR_OK.has(d)) return d;
  const base = d.split('.')[0];
  const certo = DOMINIOS[base];
  // só troca quando o resto do domínio é .com/.com.br/.co/.con ou nada (gmail.com.br e gmail.co viram gmail.com)
  if (certo && /^[a-z0-9]+(\.com(\.br)?|\.br|\.co)?$/.test(d)) {
    if (certo.endsWith('.com.br') || !d.endsWith('.com.br') || base === 'gmail' || DOMINIOS[base] !== base + '.com') return certo;
  }
  return d;
}

function normalizaEmail(s) {
  let e = String(s || '').trim().toLowerCase().replace(/^mailto:/, '').replace(/[\s,;]+/g, '').slice(0, 160);
  const i = e.lastIndexOf('@');
  if (i > 0) e = e.slice(0, i) + '@' + corrigeDominio(e.slice(i + 1));
  return /^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(e) ? e : null;
}

function cpfValido(s) {
  const c = String(s || '').replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return null;
  const dv = (n) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(c[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]) ? c : null;
}

function primeiroNome(nome) {
  const n = limpaTexto(nome).split(' ')[0] || '';
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
}

module.exports = { limpaTexto, normalizaWhats, normalizaEmail, cpfValido, primeiroNome };
