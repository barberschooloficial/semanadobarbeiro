// Perguntas do quiz (mesmas da página /quiz). Usado para validar respostas e montar os gráficos do painel.
const PERGUNTAS = [
  { k: 'experiencia', p: 'Você já cortou cabelo?', o: [
    ['nunca_cortei', 'Nunca peguei numa máquina'], ['corto_amigos', 'Já corto amigos e família'],
    ['trabalho_barbearia', 'Trabalho em barbearia'], ['tenho_barbearia', 'Tenho minha barbearia']] },
  { k: 'objetivo', p: 'O que você quer com a barbearia?', o: [
    ['nova_profissao', 'Uma nova profissão'], ['renda_extra', 'Uma renda extra'],
    ['melhorar_tecnica', 'Melhorar minha técnica'], ['abrir_barbearia', 'Abrir minha barbearia']] },
  { k: 'material', p: 'Você já tem material de corte?', o: [
    ['nao_tenho', 'Ainda não tenho'], ['tenho_basico', 'Tenho o básico'], ['tenho_completo', 'Tenho tudo']] },
  { k: 'horario', p: 'Quando vai assistir às aulas?', o: [
    ['manha', 'De manhã'], ['noite', 'À noite'], ['qualquer', 'Quando der, durante o dia']] },
  { k: 'compromisso', p: 'Compromisso de assistir às 10 aulas', o: [
    ['sim', 'Sim, vou assistir todas'], ['talvez', 'Vou tentar']] },
];

const PERFIS = { iniciante: 'Iniciante', ja_corta: 'Já corta', profissional: 'Profissional' };

module.exports = { PERGUNTAS, PERFIS };
