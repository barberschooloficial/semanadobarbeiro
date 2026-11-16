// Faz as chamadas ao painel (o WhatsApp Web não pode chamar outro domínio direto).
// Só fala com o endereço configurado, e só com as ações da extensão.
const PADRAO = 'https://app.semanadobarbeiro.com.br';
const ACOES = new Set(['wa_sync', 'wa_fila', 'wa_resultado', 'wa_resumo', 'wa_entrou', 'wa_palavra', 'wa_dm_resultado']);
const GET = new Set(['wa_fila', 'wa_resumo']);

chrome.runtime.onMessage.addListener((msg, sender, responder) => {
  if (msg?.tipo !== 'api' || !ACOES.has(msg.acao)) return false;
  if (sender.id !== chrome.runtime.id) return false;
  (async () => {
    const { painel = PADRAO, chave = '' } = await chrome.storage.local.get(['painel', 'chave']);
    if (!chave) return responder({ erro: 'Configure a chave da extensão (clique no ícone da extensão).' });
    try {
      const r = await fetch(`${painel.replace(/\/$/, '')}/api/disparos?acao=${msg.acao}`, {
        method: GET.has(msg.acao) ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ext-key': chave },
        body: GET.has(msg.acao) ? undefined : JSON.stringify(msg.corpo || {}),
      });
      const j = await r.json().catch(() => ({}));
      responder(r.ok ? { ok: j } : { erro: j.erro || `Painel respondeu ${r.status}` });
    } catch (e) { responder({ erro: 'Sem conexão com o painel' }); }
  })();
  return true;
});
