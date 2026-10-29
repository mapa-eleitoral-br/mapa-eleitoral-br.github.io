// Carregamento das malhas do IBGE e dos dados eleitorais.

const IBGE = 'https://servicodados.ibge.gov.br/api';
const MALHA = `${IBGE}/v3/malhas/paises/BR?formato=application/vnd.geo+json&qualidade=minima`;

export const FONTES_GEO = {
  municipios: { local: 'data/geo/municipios.json', remoto: `${MALHA}&intrarregiao=municipio` },
  estados: { local: 'data/geo/estados.json', remoto: `${MALHA}&intrarregiao=UF` },
  pais: { local: 'data/geo/pais.json', remoto: MALHA },
  localidadesMunicipios: { local: 'data/geo/localidades-municipios.json', remoto: `${IBGE}/v1/localidades/municipios` },
  localidadesEstados: { local: 'data/geo/localidades-estados.json', remoto: `${IBGE}/v1/localidades/estados` },
};

async function buscarJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  return r.json();
}

/** Tenta o arquivo local (data/geo/); se não existir, usa a API do IBGE. */
async function buscarComFallback(fonte) {
  try {
    return { dados: await buscarJson(fonte.local), origem: 'local' };
  } catch {
    return { dados: await buscarJson(fonte.remoto), origem: 'api' };
  }
}

export async function carregarMalhas(aoProgredir = () => {}) {
  const chaves = Object.keys(FONTES_GEO);
  let feitos = 0;
  const resultados = await Promise.all(
    chaves.map(async (k) => {
      const r = await buscarComFallback(FONTES_GEO[k]);
      feitos += 1;
      aoProgredir(feitos, chaves.length);
      return [k, r];
    }),
  );
  const m = Object.fromEntries(resultados);

  const ufs = new Map(); // "35" -> { sigla, nome }
  for (const e of m.localidadesEstados.dados) {
    ufs.set(String(e.id), { sigla: e.sigla, nome: e.nome });
  }
  const nomesMunicipios = new Map(); // "3550308" -> "São Paulo"
  for (const mun of m.localidadesMunicipios.dados) {
    nomesMunicipios.set(String(mun.id), mun.nome);
  }

  return {
    municipios: m.municipios.dados,
    estados: m.estados.dados,
    pais: m.pais.dados,
    ufs,
    nomesMunicipios,
    origem: [...new Set(Object.values(m).map((r) => r.origem))].join(' + '),
  };
}

/* ------------------------------------------------------------------ */
/* Validação do arquivo de eleição                                     */
/* ------------------------------------------------------------------ */

const CHAVES = ['f', 'l', 'n', 'b', 'o'];

function inteiroNaoNegativo(x) {
  return Number.isInteger(x) && x >= 0;
}

/**
 * Valida o JSON no formato:
 * { meta: {...}, municipios: { "<cód. IBGE 7 dígitos>": { f, l, n, b, o } } }
 * Retorna { ok, erros, avisos, dados } – `dados` é uma cópia normalizada.
 */
export function validarEleicao(json) {
  const erros = [];
  const avisos = [];

  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { ok: false, erros: ['O arquivo não contém um objeto JSON.'], avisos, dados: null };
  }
  if (!json.municipios || typeof json.municipios !== 'object' || Array.isArray(json.municipios)) {
    return { ok: false, erros: ['Falta o objeto "municipios".'], avisos, dados: null };
  }
  const meta = json.meta && typeof json.meta === 'object' ? json.meta : {};
  if (!json.meta) avisos.push('Falta o objeto "meta"; usando valores padrão.');

  const municipios = {};
  for (const [cod, v] of Object.entries(json.municipios)) {
    if (!/^\d{7}$/.test(cod)) {
      erros.push(`Código inválido "${cod}" (esperado: código IBGE de 7 dígitos).`);
      continue;
    }
    if (!v || typeof v !== 'object') {
      erros.push(`Município ${cod}: valor não é um objeto.`);
      continue;
    }
    const linha = {};
    for (const k of CHAVES) {
      const x = v[k] ?? 0;
      if (!inteiroNaoNegativo(x)) {
        erros.push(`Município ${cod}: "${k}" deve ser inteiro ≥ 0 (recebido ${JSON.stringify(v[k])}).`);
      }
      linha[k] = x;
    }
    if (v.o === undefined || v.b === undefined) {
      avisos.push(`Município ${cod}: "b" ou "o" ausente, considerado 0.`);
    }
    municipios[cod] = linha;
  }

  if (Object.keys(municipios).length === 0) erros.push('Nenhum município válido no arquivo.');

  // Limita a quantidade de mensagens repetidas.
  const resumirLista = (l) => (l.length > 20 ? [...l.slice(0, 20), `… e mais ${l.length - 20}.`] : l);

  return {
    ok: erros.length === 0,
    erros: resumirLista(erros),
    avisos: resumirLista(avisos),
    dados: {
      meta: {
        simulado: meta.simulado === true,
        fonte: String(meta.fonte ?? 'não informada'),
        descricao: String(meta.descricao ?? ''),
        exterior: meta.exterior ?? null,
        naoMapeados: meta.naoMapeados ?? null,
      },
      municipios,
    },
  };
}

/**
 * Tenta carregar data/eleicao.json. Se não existir, gera a simulação.
 * Retorna { dados, tipo: 'oficial' | 'simulado' | 'erro', mensagem }.
 */
export async function carregarEleicao(codigosMunicipios) {
  let resposta;
  try {
    resposta = await fetch('data/eleicao.json', { cache: 'no-store' });
  } catch {
    resposta = null;
  }
  if (!resposta || !resposta.ok) {
    return {
      dados: simularEleicao(codigosMunicipios),
      tipo: 'simulado',
      mensagem: 'Arquivo data/eleicao.json não encontrado.',
    };
  }
  try {
    const v = validarEleicao(await resposta.json());
    if (!v.ok) throw new Error(v.erros.join(' '));
    return { dados: v.dados, tipo: v.dados.meta.simulado ? 'simulado' : 'oficial', mensagem: '', avisos: v.avisos };
  } catch (e) {
    return {
      dados: simularEleicao(codigosMunicipios),
      tipo: 'erro',
      mensagem: `data/eleicao.json é inválido: ${e.message}`,
    };
  }
}

/** Relatório gerado por tools/validar-tse.mjs (ou null se não existir). */
export async function carregarValidacao() {
  try {
    const r = await fetch('data/validacao.json', { cache: 'no-store' });
    if (!r.ok) return null;
    const v = await r.json();
    return typeof v === 'object' && v && 'municipiosIdenticos' in v ? v : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Simulação determinística                                            */
/* ------------------------------------------------------------------ */

export const SEMENTE_SIMULACAO = 20261025;

/** PRNG mulberry32: mesma semente, mesma sequência. */
export function mulberry32(semente) {
  let a = semente >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rand) {
  // Box-Muller
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const limitar = (x, min, max) => Math.min(max, Math.max(min, x));

// Inclinação regional fictícia (parcela de Lula entre os dois candidatos).
const TENDENCIA_REGIAO = { 1: 0.47, 2: 0.69, 3: 0.46, 4: 0.39, 5: 0.38 };

// Capitais recebem eleitorado maior para a simulação ficar plausível.
const CAPITAIS = new Set([
  '1100205', '1200401', '1302603', '1400100', '1501402', '1600303', '1721000',
  '2111300', '2211001', '2304400', '2408102', '2507507', '2611606', '2704302',
  '2800308', '2927408', '3106200', '3205309', '3304557', '3550308', '4106902',
  '4205407', '4314902', '5002704', '5103403', '5208707', '5300108',
]);

/**
 * Gera votos FICTÍCIOS por município. Determinística: os códigos são
 * ordenados e a semente é fixa, então o resultado é sempre o mesmo.
 */
export function simularEleicao(codigosMunicipios) {
  const rand = mulberry32(SEMENTE_SIMULACAO);
  const codigos = [...codigosMunicipios].map(String).sort();

  const ufs = [...new Set(codigos.map((c) => c.slice(0, 2)))].sort();
  const desvioUF = {};
  for (const uf of ufs) desvioUF[uf] = normal(rand) * 0.04;

  const municipios = {};
  for (const cod of codigos) {
    const uf = cod.slice(0, 2);
    let eleitores;
    if (cod === '3550308') eleitores = 9_300_000;
    else if (cod === '3304557') eleitores = 5_000_000;
    else if (CAPITAIS.has(cod)) eleitores = Math.round(400_000 + rand() * 1_800_000);
    else eleitores = Math.round(limitar(Math.exp(Math.log(9000) + normal(rand) * 1.0), 1000, 1_500_000));

    const comparecimento = limitar(0.8 + normal(rand) * 0.04, 0.65, 0.92);
    const votos = Math.round(eleitores * comparecimento);
    const pNulos = limitar(0.035 + normal(rand) * 0.01, 0.01, 0.08);
    const pBrancos = limitar(0.018 + normal(rand) * 0.006, 0.005, 0.05);
    const n = Math.round(votos * pNulos);
    const b = Math.round(votos * pBrancos);
    const validos = votos - n - b;

    const parteLula = limitar(TENDENCIA_REGIAO[cod[0]] + desvioUF[uf] + normal(rand) * 0.08, 0.08, 0.92);
    const l = Math.round(validos * parteLula);
    const f = validos - l;
    municipios[cod] = { f, l, n, b, o: 0 }; // 2º turno: só dois candidatos
  }

  return {
    meta: {
      simulado: true,
      fonte: `Simulação determinística (mulberry32, semente ${SEMENTE_SIMULACAO})`,
      descricao: 'Dados FICTÍCIOS gerados no navegador. Não representam o resultado da eleição.',
      exterior: null,
      naoMapeados: null,
    },
    municipios,
  };
}
