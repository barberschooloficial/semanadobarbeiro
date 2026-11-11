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

function normalizaEmail(s) {
  const e = String(s || '').trim().toLowerCase().slice(0, 160);
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e) ? e : null;
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
