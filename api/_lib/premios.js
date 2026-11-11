// Roleta da Semana do Barbeiro: um prêmio por módulo (dia). O resultado é decidido aqui no servidor.
// A ordem das fatias é a mesma desenhada na tela (assets/app.js → FATIAS).
const FATIAS = ['barbeearia', 'nada', 'clube', 'vitalicio', 'curso', 'nada'];

// Prêmio de cada dia da semana
const PREMIO_DO_DIA = { 1: 'barbeearia', 2: 'nada', 3: 'clube', 4: 'vitalicio', 5: 'curso' };

function premio(codigo, cfg) {
  const p = {
    barbeearia: {
      titulo: '30 dias grátis na Barbeearia',
      descricao: 'O sistema de gestão para barbearia: agenda online, clientes e caixa. Use por 30 dias sem pagar.',
      acao: 'Ativar meus 30 dias', url: cfg.premio_barbeearia_url || 'https://barbeearia.com.br',
    },
    nada: {
      titulo: 'Não foi dessa vez',
      descricao: 'Amanhã tem nova chance na roleta, antes do próximo módulo.',
    },
    clube: {
      titulo: 'Acesso ao Clube do Barbeiro',
      descricao: 'Você ganhou acesso ao Clube do Barbeiro da Barber School.',
      acao: 'Acessar o Clube', url: cfg.premio_clube_url || 'https://clube.barberschool.com.br',
    },
    vitalicio: {
      titulo: 'Cupom: Barber School vitalícia',
      descricao: 'Use este cupom na compra do curso completo e o seu acesso fica vitalício.',
      cupom: cfg.premio_vitalicio_cupom || 'VITALICIO',
    },
    curso: {
      titulo: 'Desconto no curso Barber School',
      descricao: `O curso completo sai de R$ ${cfg.curso_preco_de || '297'} por R$ ${cfg.curso_preco_por || '147'}, só até domingo.`,
      acao: 'Ver meu desconto', ancora: 'oferta',
    },
  }[codigo];
  return p ? { codigo, ...p } : null;
}

function sortear(dia) {
  const codigo = PREMIO_DO_DIA[dia] || 'nada';
  // escolhe uma das fatias com esse prêmio (para "nada" há duas)
  const indices = FATIAS.map((c, i) => (c === codigo ? i : -1)).filter(i => i >= 0);
  return { codigo, fatia: indices[Math.floor(Math.random() * indices.length)] };
}

module.exports = { FATIAS, PREMIO_DO_DIA, premio, sortear };
