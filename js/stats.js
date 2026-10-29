// Funções puras de cálculo. Sem acesso ao DOM.
// Chaves: f = Flávio, l = Lula, n = nulos, b = brancos, o = outros.

export const CHAVES = ['f', 'l', 'n', 'b', 'o'];

export const NOMES = {
  f: 'Flávio Bolsonaro (PL)',
  l: 'Lula (PT)',
  n: 'Nulos',
  b: 'Brancos',
  o: 'Outros',
};

export function zerado() {
  return { f: 0, l: 0, n: 0, b: 0, o: 0 };
}

/** Soma os votos absolutos de `origem` em `destino` (modifica `destino`). */
export function acumular(destino, origem) {
  for (const k of CHAVES) destino[k] += origem[k] || 0;
  return destino;
}

/**
 * Resumo de uma região a partir dos votos ABSOLUTOS.
 * Denominador dos percentuais = f + l + o + n + b ("total considerado").
 */
export function resumir(v) {
  const votos = {};
  for (const k of CHAVES) votos[k] = v?.[k] || 0;
  const total = votos.f + votos.l + votos.o + votos.n + votos.b;
  const validos = votos.f + votos.l + votos.o;

  const pct = {};
  const pctValidos = {};
  for (const k of CHAVES) pct[k] = total > 0 ? (votos[k] / total) * 100 : 0;
  for (const k of ['f', 'l', 'o']) pctValidos[k] = validos > 0 ? (votos[k] / validos) * 100 : 0;

  const diferenca = votos.f - votos.l;
  let vencedor = 'empate';
  if (total === 0) vencedor = 'sem votos';
  else if (diferenca > 0) vencedor = 'f';
  else if (diferenca < 0) vencedor = 'l';

  return {
    votos,
    total,
    validos,
    pct,
    pctValidos,
    diferenca,
    diferencaPP: pct.f - pct.l, // pontos percentuais sobre o total considerado
    vencedor,
  };
}

/** Código da UF (2 primeiros dígitos do código IBGE do município). */
export function ufDoMunicipio(cod) {
  return String(cod).slice(0, 2);
}

/**
 * Agrega os votos absolutos dos municípios por UF e por país.
 * O total nacional é calculado de forma independente (direto dos municípios)
 * e comparado com a soma dos estados.
 */
export function agregar(municipios) {
  const estados = {};
  const pais = zerado();

  for (const [cod, v] of Object.entries(municipios)) {
    const uf = ufDoMunicipio(cod);
    if (!estados[uf]) estados[uf] = zerado();
    acumular(estados[uf], v);
  }
  for (const v of Object.values(municipios)) acumular(pais, v);

  const somaEstados = zerado();
  for (const v of Object.values(estados)) acumular(somaEstados, v);

  const diferencas = {};
  let ok = true;
  for (const k of CHAVES) {
    diferencas[k] = somaEstados[k] - pais[k];
    if (diferencas[k] !== 0) ok = false;
  }

  return {
    estados,
    pais,
    conferencia: { ok, somaEstados, pais: { ...pais }, diferencas },
  };
}
