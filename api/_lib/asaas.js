// Integração Asaas: cliente + cobrança (certificado) e cobrança/assinatura (Barbeearia)
const BASE = process.env.ASAAS_BASE_URL || (process.env.ASAAS_ENV === 'producao' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3');

async function asaas(path, { method = 'GET', body } = {}) {
  const key = process.env.ASAAS_API_KEY;
  if (!key) throw Object.assign(new Error('ASAAS_API_KEY não configurada'), { publicMessage: 'Pagamento indisponível no momento.' });
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { access_token: key, 'Content-Type': 'application/json', 'User-Agent': 'semanadobarbeiro' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.errors?.[0]?.description || `Asaas ${r.status}`;
    throw Object.assign(new Error(msg), { httpStatus: 400, publicMessage: msg });
  }
  return data;
}

async function garanteCliente(lead, cpf) {
  const achado = await asaas(`/customers?cpfCnpj=${cpf}&limit=1`);
  if (achado?.data?.[0]?.id) return achado.data[0].id;
  const c = await asaas('/customers', {
    method: 'POST',
    body: {
      name: lead.nome, cpfCnpj: cpf, email: lead.email,
      mobilePhone: lead.whatsapp.replace(/^55/, ''),
      externalReference: lead.id, notificationDisabled: false,
    },
  });
  return c.id;
}

function hojeMais(dias) {
  const d = new Date(Date.now() - 3 * 3600_000 + dias * 86400_000); // horário de Brasília
  return d.toISOString().slice(0, 10);
}

// Cobrança avulsa: Pix, boleto ou cartão (o cliente escolhe na fatura)
async function cobranca({ lead, cpf, valor, descricao, referencia, successUrl }) {
  const customer = await garanteCliente(lead, cpf);
  const corpo = {
    customer, billingType: 'UNDEFINED', value: Number(valor), dueDate: hojeMais(1),
    description: descricao, externalReference: referencia,
    callback: successUrl ? { successUrl, autoRedirect: true } : undefined,
  };
  let p;
  try { p = await asaas('/payments', { method: 'POST', body: corpo }); }
  catch (e) {
    // O Asaas só aceita a volta automática para o site se o domínio estiver cadastrado em Minha Conta → Informações.
    // Sem isso, cobra do mesmo jeito (o webhook confirma o pagamento), só não redireciona sozinho no fim.
    if (!corpo.callback || !/dom[ií]nio/i.test(e.message)) throw e;
    console.warn('asaas: domínio não cadastrado, cobrança sem redirecionamento');
    p = await asaas('/payments', { method: 'POST', body: { ...corpo, callback: undefined } });
  }
  return { id: p.id, invoiceUrl: p.invoiceUrl };
}

// QR Code Pix de uma cobrança (para pagar na própria página). Se a conta não tiver chave Pix, devolve null.
async function pix(paymentId) {
  try {
    const q = await asaas(`/payments/${encodeURIComponent(paymentId)}/pixQrCode`);
    return q?.payload ? { qr: q.encodedImage, copia: q.payload, expira: q.expirationDate || null } : null;
  } catch { return null; }
}

// Assinatura mensal (cartão/Pix/boleto) — retorna a 1ª cobrança para redirecionar
async function assinatura({ lead, cpf, valor, descricao, referencia }) {
  const customer = await garanteCliente(lead, cpf);
  const s = await asaas('/subscriptions', {
    method: 'POST',
    body: {
      customer, billingType: 'UNDEFINED', value: Number(valor), nextDueDate: hojeMais(0),
      cycle: 'MONTHLY', description: descricao, externalReference: referencia,
    },
  });
  const pays = await asaas(`/subscriptions/${s.id}/payments`);
  const first = pays?.data?.[0];
  return { id: s.id, invoiceUrl: first?.invoiceUrl };
}

module.exports = { pix, cobranca, assinatura };
