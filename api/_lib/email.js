// E-mail pelo Resend (API de lote, até 100 por chamada) com o visual da Barber School.
// Sem RESEND_API_KEY no modo local/demonstração o envio é simulado.
const BASE = process.env.RESEND_BASE_URL || 'https://api.resend.com';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Troca {{nome}}, {{app_link}} etc. pelos dados do aluno
function preencher(txt, vars) {
  return String(txt || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

// Corpo simples → HTML: parágrafos por linha em branco, **negrito**, links, e
// uma linha só com [Texto](url) vira botão.
function corpoHtml(texto) {
  const inline = (t) => esc(t)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" style="color:#8a6730">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" style="color:#8a6730">$2</a>');
  return String(texto || '').trim().split(/\n\s*\n/).map(bloco => {
    const b = bloco.trim();
    const botao = b.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (botao) {
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0"><tr><td style="border-radius:999px;background:#15120e;border:2px solid #e8d9b8">
        <a href="${esc(botao[2])}" style="display:inline-block;padding:15px 30px;font:800 14px Arial,sans-serif;letter-spacing:2px;text-transform:uppercase;color:#f6f2ea;text-decoration:none">${esc(botao[1])}</a></td></tr></table>`;
    }
    return `<p style="margin:0 0 16px">${b.split('\n').map(inline).join('<br>')}</p>`;
  }).join('\n');
}

function layout({ corpo, descadastro, preheader, pixel }) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#ede7dc">
<span style="display:none;max-height:0;overflow:hidden">${esc(preheader || '')}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ede7dc"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffdf8;border:1px solid #d9cfbe;border-radius:12px;overflow:hidden">
<tr><td style="height:6px;background:repeating-linear-gradient(-45deg,#b3261e 0 12px,#f6f2ea 12px 24px,#1f4e8c 24px 36px,#f6f2ea 36px 48px);background-color:#b3261e"></td></tr>
<tr><td style="background:#15120e;padding:18px 26px;font:400 22px Impact,'Arial Narrow',sans-serif;letter-spacing:1px;text-transform:uppercase;color:#fff">Semana do Barbeiro <span style="font:700 11px Arial,sans-serif;letter-spacing:3px;color:#e8d9b8">· BARBER SCHOOL</span></td></tr>
<tr><td style="padding:28px 26px 10px;font:16px/1.6 Arial,Helvetica,sans-serif;color:#2a241d">${corpo}</td></tr>
<tr><td style="padding:0 26px 26px;font:15px/1.5 Arial,sans-serif;color:#3b342b;border-top:0">
<p style="margin:8px 0 0"><b>Cris Aita e Luciano Leal</b><br><span style="color:#6f6556">Barber School</span><br><a href="https://www.barberschool.com.br" style="color:#8a6730">www.barberschool.com.br</a></p></td></tr>
<tr><td style="background:#f6f2ea;padding:16px 26px;font:12px/1.5 Arial,sans-serif;color:#6f6556;border-top:1px solid #d9cfbe">
Você recebe este e-mail porque se cadastrou na Semana do Barbeiro. <a href="${esc(descadastro)}" style="color:#6f6556">Não quero mais receber e-mails</a>.</td></tr>
</table></td></tr></table>${pixel ? `<img src="${esc(pixel)}" width="1" height="1" alt="" style="display:block;border:0">` : ''}</body></html>`;
}

function textoPuro(texto, descadastro) {
  return String(texto || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1: $2')
    + `\n\nCris Aita e Luciano Leal\nBarber School\nwww.barberschool.com.br\n\nPara não receber mais e-mails: ${descadastro}`;
}

const simulado = () => !process.env.RESEND_API_KEY && process.env.SDB_LOCAL === '1';

// msgs: [{ para, assunto, texto, descadastro, ref }] → { ok: [ref], falhas: [{ref, erro}], simulado }
async function enviarLote(msgs) {
  if (!msgs.length) return { ok: [], falhas: [] };
  if (simulado()) return { ok: msgs.map(m => m.ref), falhas: [], simulado: true };
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: [], falhas: msgs.map(m => ({ ref: m.ref, erro: 'RESEND_API_KEY não configurada' })) };
  const from = process.env.EMAIL_FROM || 'Cris Aita | Barber School <aulas@semanadobarbeiro.com.br>';
  const body = msgs.map(m => ({
    from: m.from || from, to: [m.para], subject: m.assunto,
    html: layout({ corpo: corpoHtml(m.texto), descadastro: m.descadastro, preheader: m.preheader, pixel: m.pixel }),
    text: textoPuro(m.texto, m.descadastro),
    reply_to: process.env.EMAIL_REPLY_TO || undefined,
    headers: { 'List-Unsubscribe': `<${m.descadastro}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  }));
  const r = await fetch(`${BASE}/emails/batch`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: [], falhas: msgs.map(m => ({ ref: m.ref, erro: d.message || `Resend ${r.status}` })), parar: r.status === 429 || r.status === 401 || r.status === 403 };
  // o Resend devolve os ids na mesma ordem: usados para saber depois se o e-mail foi entregue (webhook)
  const ids = {}; (d.data || []).forEach((x, i) => { if (x?.id && msgs[i]) ids[msgs[i].ref] = x.id; });
  return { ok: msgs.map(m => m.ref), falhas: [], ids };
}

module.exports = { enviarLote, preencher, corpoHtml, layout, textoPuro };
