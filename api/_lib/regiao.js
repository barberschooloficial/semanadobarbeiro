// UF e região a partir da UF informada ou do DDD do WhatsApp (base antiga tem UF errada ou vazia)
const DDD_UF = {
  SP: [11, 12, 13, 14, 15, 16, 17, 18, 19], RJ: [21, 22, 24], ES: [27, 28], MG: [31, 32, 33, 34, 35, 37, 38],
  PR: [41, 42, 43, 44, 45, 46], SC: [47, 48, 49], RS: [51, 53, 54, 55], DF: [61], GO: [62, 64], TO: [63],
  MT: [65, 66], MS: [67], AC: [68], RO: [69], BA: [71, 73, 74, 75, 77], SE: [79], PE: [81, 87], AL: [82],
  PB: [83], RN: [84], CE: [85, 88], PI: [86, 89], PA: [91, 93, 94], AM: [92, 97], RR: [95], AP: [96], MA: [98, 99],
};
const POR_DDD = Object.fromEntries(Object.entries(DDD_UF).flatMap(([uf, ds]) => ds.map(d => [d, uf])));
const REGIOES = {
  Sudeste: ['SP', 'RJ', 'MG', 'ES'], Sul: ['PR', 'SC', 'RS'], Nordeste: ['BA', 'PE', 'CE', 'MA', 'PB', 'RN', 'AL', 'SE', 'PI'],
  'Centro-Oeste': ['DF', 'GO', 'MT', 'MS'], Norte: ['AM', 'PA', 'RO', 'RR', 'AP', 'AC', 'TO'],
};
const REGIAO_DA = Object.fromEntries(Object.entries(REGIOES).flatMap(([r, ufs]) => ufs.map(u => [u, r])));
const NOMES_UF = { 'SAO PAULO': 'SP', 'RIO DE JANEIRO': 'RJ', 'MINAS GERAIS': 'MG', 'ESPIRITO SANTO': 'ES', PARANA: 'PR', 'SANTA CATARINA': 'SC', 'RIO GRANDE DO SUL': 'RS', 'DISTRITO FEDERAL': 'DF', GOIAS: 'GO', 'MATO GROSSO': 'MT', 'MATO GROSSO DO SUL': 'MS', BAHIA: 'BA', PERNAMBUCO: 'PE', CEARA: 'CE', MARANHAO: 'MA', PARAIBA: 'PB', 'RIO GRANDE DO NORTE': 'RN', ALAGOAS: 'AL', SERGIPE: 'SE', PIAUI: 'PI', AMAZONAS: 'AM', PARA: 'PA', RONDONIA: 'RO', RORAIMA: 'RR', AMAPA: 'AP', ACRE: 'AC', TOCANTINS: 'TO' };

function ufDe(texto) {
  const t = String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
  if (REGIAO_DA[t]) return t;
  return NOMES_UF[t] || null;
}

// whatsapp normalizado (55 + DDD + número): o DDD manda; sem DDD válido, usa a UF informada
function localDe(whatsapp, ufInformada) {
  const d = String(whatsapp || '').replace(/^55/, '').slice(0, 2);
  const uf = POR_DDD[Number(d)] || ufDe(ufInformada);
  return { uf: uf || null, regiao: uf ? REGIAO_DA[uf] : null };
}

module.exports = { localDe, ufDe, REGIOES, REGIAO_DA };
