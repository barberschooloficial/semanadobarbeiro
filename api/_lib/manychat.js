// ManyChat: cria/acha o contato e aplica tags e campos. Nunca bloqueia o fluxo do lead.
// Tags usadas (crie no ManyChat): sdb_cadastro, sdb_quiz, sdb_cert_pendente, sdb_cert_pago,
// sdb_comprou_curso, sdb_barberhub_pago, sdb_perfil_iniciante, sdb_perfil_ja_corta, sdb_perfil_profissional,
// sdb_assistiu_d1 ... sdb_assistiu_d5
// Campos personalizados (texto): app_link, perfil, cert_link
const BASE = process.env.MANYCHAT_BASE_URL || 'https://api.manychat.com';

async function mc(path, body) {
  const key = process.env.MANYCHAT_API_KEY;
  if (!key) return null;
  const r = await fetch(`${BASE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.status === 'error') {
    const e = new Error(data?.message || `ManyChat ${r.status}`); e.details = data; throw e;
  }
  return data.data;
}

async function acharOuCriar(lead) {
  if (lead.manychat_id) return lead.manychat_id;
  try {
    const sub = await mc('/fb/subscriber/createSubscriber', {
      first_name: lead.nome.split(' ')[0],
      last_name: lead.nome.split(' ').slice(1).join(' '),
      whatsapp_phone: lead.whatsapp ? `+${lead.whatsapp}` : undefined,
      email: lead.email || undefined,
      has_opt_in_email: true,
      consent_phrase: 'Aceito receber as aulas e avisos da Semana do Barbeiro por WhatsApp e e-mail.',
    });
    return sub?.id ? String(sub.id) : null;
  } catch (e) {
    // Já existe: procura por e-mail
    try {
      const found = lead.email ? await mc(`/fb/subscriber/findBySystemField?email=${encodeURIComponent(lead.email)}`)
        : await mc(`/fb/subscriber/findBySystemField?phone=${encodeURIComponent('+' + lead.whatsapp)}`);
      return found?.id ? String(found.id) : null;
    } catch { console.error('manychat acharOuCriar', e.message); return null; }
  }
}

async function sync(lead, { tags = [], campos = {} } = {}) {
  if (!process.env.MANYCHAT_API_KEY) return lead.manychat_id || null;
  try {
    const id = await acharOuCriar(lead);
    if (!id) return null;
    for (const [field_name, field_value] of Object.entries(campos)) {
      await mc('/fb/subscriber/setCustomFieldByName', { subscriber_id: Number(id), field_name, field_value: String(field_value) })
        .catch(e => console.error('manychat campo', field_name, e.message));
    }
    for (const tag_name of tags) {
      await mc('/fb/subscriber/addTagByName', { subscriber_id: Number(id), tag_name })
        .catch(e => console.error('manychat tag', tag_name, e.message));
    }
    return id;
  } catch (e) {
    console.error('manychat sync', e.message);
    return null;
  }
}

// Disparo: manda um fluxo do ManyChat (com o template aprovado) para um contato
async function enviarFluxo(subscriberId, flowNs) {
  if (!process.env.MANYCHAT_API_KEY) {
    if (process.env.SDB_LOCAL === '1') return { simulado: true };
    throw new Error('MANYCHAT_API_KEY não configurada');
  }
  await mc('/fb/sending/sendFlow', { subscriber_id: Number(subscriberId), flow_ns: flowNs });
  return { ok: true };
}

// Contato de lista importada: cria/acha no ManyChat e grava campos (ex.: convite_link) antes do fluxo
async function garantirContato(c, campos = {}) {
  if (!process.env.MANYCHAT_API_KEY) {
    if (process.env.SDB_LOCAL === '1') return c.manychat_id || `sim_${c.id}`;
    throw new Error('MANYCHAT_API_KEY não configurada');
  }
  const nome = String(c.nome || '').trim();
  const id = await acharOuCriar({ manychat_id: c.manychat_id, nome: nome || 'Barbeiro', whatsapp: c.whatsapp, email: c.email || undefined });
  if (!id) throw new Error('Não consegui criar o contato no ManyChat');
  for (const [field_name, field_value] of Object.entries(campos)) {
    await mc('/fb/subscriber/setCustomFieldByName', { subscriber_id: Number(id), field_name, field_value: String(field_value) });
  }
  return id;
}

module.exports = { sync, enviarFluxo, garantirContato };
