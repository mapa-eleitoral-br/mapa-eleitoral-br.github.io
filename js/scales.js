// Escalas de cor. Depende do d3 global (CDN).
/* global d3 */

export const SEM_DADOS = '#e4e6ea';
export const CLASSES = 9; // máximo dos esquemas sequenciais do d3

const PALETAS = { f: 'Blues', l: 'Reds', n: 'Greys' };

/** k cores de um esquema sequencial do d3 (schemeBlues etc. existem para 3..9). */
function paleta(nome, k) {
  const esquema = d3[`scheme${nome}`];
  if (k >= 3) return esquema[Math.min(k, 9)].slice(0, k);
  return esquema[3].slice(3 - k); // 1 ou 2 classes: tons mais escuros
}

/** Valor de uma região para a categoria e a métrica escolhidas. */
export function valorDe(resumo, chave, metrica) {
  if (!resumo) return null;
  return metrica === 'percentual' ? resumo.pct[chave] : resumo.votos[chave];
}

function limitesQuantis(valores, partes) {
  const ordenados = valores.filter((v) => v != null && Number.isFinite(v)).sort(d3.ascending);
  if (ordenados.length === 0) return { min: 0, max: 0, limites: [] };
  const min = ordenados[0];
  const max = ordenados[ordenados.length - 1];
  const brutos = d3.range(1, partes).map((i) => d3.quantileSorted(ordenados, i / partes));
  // Remove limites repetidos ou iguais ao mínimo (classes vazias).
  const limites = [...new Set(brutos)].filter((t) => t > min);
  return { min, max, limites };
}

function limitesFixos(maximo, partes) {
  return { min: 0, max: maximo, limites: d3.range(1, partes).map((i) => (maximo * i) / partes) };
}

/**
 * Escala por classes para uma categoria (f, l ou n).
 * - nível município/estado: quantis (9 classes) sobre os valores daquele nível;
 * - nível país: escala fixa de 0 ao total (ou de 0 a 100%).
 */
export function criarEscala({ chave, metrica, nivel, valores, totalPais }) {
  const { min, max, limites } =
    nivel === 'pais'
      ? limitesFixos(metrica === 'percentual' ? 100 : totalPais, CLASSES)
      : limitesQuantis(valores, CLASSES);

  const cores = paleta(PALETAS[chave], limites.length + 1);
  const bordas = [min, ...limites, max];
  const classes = cores.map((cor, i) => ({ cor, de: bordas[i], ate: bordas[i + 1] }));

  return {
    tipo: 'classes',
    chave,
    metrica,
    nivel,
    classes,
    cor(v) {
      if (v == null || !Number.isFinite(v)) return SEM_DADOS;
      return cores[d3.bisectRight(limites, v)];
    },
  };
}

/* ------------------------------------------------------------------ */
/* Escala divergente da vantagem (Flávio − Lula)                       */
/* ------------------------------------------------------------------ */

export const COR_EMPATE = '#f2f0f7';
// Limites fixos, em pontos percentuais, de cada lado (vantagem sobre o total considerado).
const LIMITES_PP = [5, 10, 20, 30, 40, 50, 60];
const CLASSES_LADO = LIMITES_PP.length + 1; // 8 tons por candidato

/** Arredonda para 2 algarismos significativos (legenda legível). */
function arredondar(x) {
  if (x <= 0) return 0;
  return Number(x.toPrecision(2));
}

function tons(interpolador, n) {
  // Do claro (vantagem pequena) ao escuro (vantagem grande), sem o branco do início.
  return d3.range(n).map((i) => interpolador(0.22 + (0.78 * i) / (n - 1)));
}

/**
 * Cor = quem está à frente (azul Flávio, vermelho Lula); intensidade = tamanho da vantagem.
 * - percentual: vantagem em pontos percentuais, limites fixos (5, 10, 20 … 60 p.p.);
 * - absoluto: vantagem em votos, limites por quantis de |Flávio − Lula| no nível;
 * - nível país (absoluto): limites proporcionais ao total de votos.
 */
export function criarEscalaDivergente({ metrica, nivel, valores, totalPais }) {
  let lado;
  if (metrica === 'percentual') {
    lado = LIMITES_PP;
  } else if (nivel === 'pais') {
    lado = [0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.4].map((p) => arredondar(p * totalPais));
  } else {
    const absolutos = valores.filter((v) => v != null && Number.isFinite(v)).map(Math.abs).sort(d3.ascending);
    const brutos = d3.range(1, CLASSES_LADO).map((i) => arredondar(d3.quantileSorted(absolutos, i / CLASSES_LADO) ?? 0));
    lado = [...new Set(brutos)].filter((t) => t > 0);
  }
  const n = lado.length + 1;
  const azuis = tons(d3.interpolateBlues, n);
  const vermelhos = tons(d3.interpolateReds, n);

  const classes = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    classes.push({ cor: azuis[i], lider: 'f', de: i === 0 ? 0 : lado[i - 1], ate: i === n - 1 ? null : lado[i] });
  }
  for (let i = 0; i < n; i += 1) {
    classes.push({ cor: vermelhos[i], lider: 'l', de: i === 0 ? 0 : lado[i - 1], ate: i === n - 1 ? null : lado[i] });
  }

  return {
    tipo: 'divergente',
    metrica,
    nivel,
    classes,
    cor(v) {
      if (v == null || !Number.isFinite(v)) return SEM_DADOS;
      if (v === 0) return COR_EMPATE;
      // Mesmos limites dos dois lados, aplicados ao tamanho da vantagem.
      const i = d3.bisectRight(lado, Math.abs(v));
      return v > 0 ? azuis[i] : vermelhos[i];
    },
  };
}

// Paleta bivariada 3x3 (Joshua Stevens). Linhas: Lula (0 = baixo);
// colunas: Flávio (0 = baixo).
export const MATRIZ_BIVARIADA = [
  ['#e8e8e8', '#b0d5df', '#64acbe'],
  ['#e4acac', '#ad9ea5', '#627f8c'],
  ['#c85a5a', '#985356', '#574249'],
];

function tercis(valores, nivel, maximoFixo) {
  if (nivel === 'pais') return limitesFixos(maximoFixo, 3).limites;
  const ordenados = valores.filter((v) => v != null && Number.isFinite(v)).sort(d3.ascending);
  if (ordenados.length === 0) return [0, 0];
  return [d3.quantileSorted(ordenados, 1 / 3), d3.quantileSorted(ordenados, 2 / 3)];
}

/** Escala bivariada com tercis independentes para Flávio e Lula. */
export function criarEscalaBivariada({ metrica, nivel, valoresF, valoresL, totalPais }) {
  const maximo = metrica === 'percentual' ? 100 : totalPais;
  const limitesF = tercis(valoresF, nivel, maximo);
  const limitesL = tercis(valoresL, nivel, maximo);
  return {
    tipo: 'bivariada',
    metrica,
    nivel,
    limitesF,
    limitesL,
    classe(vf, vl) {
      return [d3.bisectRight(limitesF, vf), d3.bisectRight(limitesL, vl)];
    },
    cor(vf, vl) {
      if (vf == null || vl == null) return SEM_DADOS;
      const [i, j] = this.classe(vf, vl);
      return MATRIZ_BIVARIADA[j][i];
    },
  };
}
