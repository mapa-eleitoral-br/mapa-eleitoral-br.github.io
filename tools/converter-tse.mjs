#!/usr/bin/env node
// Converte os CSVs do TSE (dadosabertos.tse.jus.br) em data/eleicao.json.
//
// Uso:
//   npm run converter -- [opções]
//
// Opções (todas opcionais):
//   --candidatos=ARQ   CSV de votos por candidato (padrão: data/tse/votacao_candidato_munzona_2026_BR.csv)
//   --detalhe=ARQ      CSV de detalhe da votação (padrão: data/tse/detalhe_votacao_munzona_2026_BR.csv)
//   --saida=ARQ        Arquivo de saída (padrão: data/eleicao.json)
//   --turno=N          Turno (padrão: 2)
//   --cargo=NOME       Cargo (padrão: Presidente)
//   --num-flavio=N     Número de Flávio Bolsonaro (padrão: 22)
//   --num-lula=N       Número de Lula (padrão: 13)
//   --aliases=ARQ      JSON com correções de nomes: { "UF|NOME TSE": "código IBGE ou nome IBGE" }
//                      ou { "TSE:<CD_MUNICIPIO>": "código IBGE" }
//   --colunas-nulos=A,B  Colunas somadas como nulos (padrão: QT_TOTAL_VOTOS_NULOS ou QT_VOTOS_NULOS)
//   --encoding=ENC     Codificação dos CSVs (padrão: latin1)
import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

// Referência para conferência no fim (TSE, 100% apurado).
const REFERENCIA_OFICIAL = { l: 64_256_232, f: 59_826_041 };

/* ---------------- Argumentos ---------------- */

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, ...v] = a.slice(2).split('=');
      return [k, v.join('=') || 'true'];
    }),
);

const opc = {
  candidatos: resolve(raiz, args.candidatos ?? 'data/tse/votacao_candidato_munzona_2026_BR.csv'),
  detalhe: resolve(raiz, args.detalhe ?? 'data/tse/detalhe_votacao_munzona_2026_BR.csv'),
  saida: resolve(raiz, args.saida ?? 'data/eleicao.json'),
  turno: String(args.turno ?? '2'),
  cargo: args.cargo ?? 'Presidente',
  numFlavio: String(args['num-flavio'] ?? '22'),
  numLula: String(args['num-lula'] ?? '13'),
  // Usa data/aliases.json automaticamente, se existir.
  aliases: resolve(raiz, args.aliases ?? 'data/aliases.json'),
  colunasNulos: args['colunas-nulos'] ? args['colunas-nulos'].split(',').map((s) => s.trim()) : null,
  encoding: args.encoding ?? 'latin1',
};

/* ---------------- Utilidades ---------------- */

const fmt = (x) => new Intl.NumberFormat('pt-BR').format(x);
const zerado = () => ({ f: 0, l: 0, n: 0, b: 0, o: 0 });
const CHAVES = ['f', 'l', 'n', 'b', 'o'];
const somar = (d, o) => { for (const k of CHAVES) d[k] += o[k] || 0; return d; };
const totalDe = (v) => CHAVES.reduce((s, k) => s + (v[k] || 0), 0);

export function normalizarNome(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    // Remove tudo que não é letra ou número: "D'OESTE", "D OESTE" e "D-OESTE" viram "DOESTE".
    .replace(/[^A-Z0-9]+/g, '');
}

/** Divide uma linha CSV com separador ";" e campos entre aspas. */
export function dividirLinha(linha, sep = ';') {
  const campos = [];
  let atual = '';
  let aspas = false;
  for (let i = 0; i < linha.length; i += 1) {
    const c = linha[i];
    if (aspas) {
      if (c === '"') {
        if (linha[i + 1] === '"') { atual += '"'; i += 1; } else aspas = false;
      } else atual += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { campos.push(atual); atual = ''; }
    else atual += c;
  }
  campos.push(atual);
  return campos;
}

const inteiro = (s) => {
  const n = Number.parseInt(String(s).replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
};

async function existe(arq) {
  try { await access(arq); return true; } catch { return false; }
}

/** Lê o CSV linha a linha e chama `aoLer(registro)` com um objeto por linha. */
async function lerCsv(arquivo, aoLer) {
  if (!(await existe(arquivo))) throw new Error(`Arquivo não encontrado: ${arquivo}`);
  const leitor = createInterface({
    input: createReadStream(arquivo, { encoding: opc.encoding }),
    crlfDelay: Infinity,
  });
  let cabecalho = null;
  let linhas = 0;
  for await (const bruta of leitor) {
    const linha = bruta.replace(/^\uFEFF/, '');
    if (!linha.trim()) continue;
    const campos = dividirLinha(linha);
    if (!cabecalho) { cabecalho = campos.map((c) => c.trim().toUpperCase()); continue; }
    const reg = {};
    for (let i = 0; i < cabecalho.length; i += 1) reg[cabecalho[i]] = campos[i];
    aoLer(reg);
    linhas += 1;
  }
  return { cabecalho: cabecalho ?? [], linhas };
}

function exigirColunas(cabecalho, colunas, arquivo) {
  const faltando = colunas.filter((c) => !cabecalho.includes(c));
  if (faltando.length) throw new Error(`${basename(arquivo)}: colunas ausentes: ${faltando.join(', ')}`);
}

/* ---------------- Localidades do IBGE ---------------- */

async function carregarLocalidades() {
  const locais = {
    municipios: join(raiz, 'data/geo/localidades-municipios.json'),
    estados: join(raiz, 'data/geo/localidades-estados.json'),
  };
  const remotos = {
    municipios: 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios',
    estados: 'https://servicodados.ibge.gov.br/api/v1/localidades/estados',
  };
  const ler = async (k) => {
    if (await existe(locais[k])) return JSON.parse(await readFile(locais[k], 'utf8'));
    console.log(`  ${basename(locais[k])} não encontrado; usando a API do IBGE.`);
    const r = await fetch(remotos[k]);
    if (!r.ok) throw new Error(`HTTP ${r.status} em ${remotos[k]}`);
    return r.json();
  };
  const [municipios, estados] = await Promise.all([ler('municipios'), ler('estados')]);
  const siglaPorCodigo = new Map(estados.map((e) => [String(e.id), e.sigla]));
  const porNome = new Map(); // "SP|SAO PAULO" -> "3550308"
  const codigos = new Map(); // "3550308" -> { nome, uf }
  for (const m of municipios) {
    const cod = String(m.id);
    const uf = siglaPorCodigo.get(cod.slice(0, 2));
    const chave = `${uf}|${normalizarNome(m.nome)}`;
    if (porNome.has(chave)) console.warn(`  Aviso: nome repetido no IBGE: ${chave}`);
    porNome.set(chave, cod);
    codigos.set(cod, { nome: m.nome, uf });
  }
  return { porNome, codigos, ufs: new Set(siglaPorCodigo.values()) };
}

async function carregarAliases(locais) {
  const mapa = new Map();
  if (!(await existe(opc.aliases))) {
    if (args.aliases) throw new Error(`Arquivo de aliases não encontrado: ${opc.aliases}`);
    return mapa;
  }
  const bruto = JSON.parse(await readFile(opc.aliases, 'utf8'));
  for (const [chave, valor] of Object.entries(bruto)) {
    let k = chave.trim();
    if (!k.toUpperCase().startsWith('TSE:')) {
      const [uf, ...nome] = k.split('|');
      k = `${uf.trim().toUpperCase()}|${normalizarNome(nome.join('|'))}`;
    } else k = `TSE:${k.slice(4).trim()}`;

    let cod = String(valor).trim();
    if (!/^\d{7}$/.test(cod)) {
      const uf = k.startsWith('TSE:') ? null : k.split('|')[0];
      cod = uf ? locais.porNome.get(`${uf}|${normalizarNome(valor)}`) : null;
      if (!cod) { console.warn(`  Alias ignorado (destino não encontrado no IBGE): ${chave} -> ${valor}`); continue; }
    }
    if (!locais.codigos.has(cod)) { console.warn(`  Alias ignorado (código IBGE inexistente): ${chave} -> ${cod}`); continue; }
    mapa.set(k, cod);
  }
  console.log(`  ${mapa.size} alias(es) carregado(s) de ${basename(opc.aliases)}.`);
  return mapa;
}

/**
 * Cadastro oficial de municípios do TSE, com o código IBGE de cada um ("cdi").
 * Retorna Map "UF|códigoTSE" -> código IBGE, ou null se não puder ser baixado.
 */
async function carregarCadastroTse(eleicao) {
  if (args['sem-cadastro-tse'] || !eleicao) return null;
  const e = `e${eleicao.cd.padStart(6, '0')}`;
  const url = `https://resultados.tse.jus.br/oficial/ele${eleicao.ano}/${eleicao.cd}/config/mun-${e}-cm.json`;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const json = await r.json();
    const mapa = new Map();
    for (const abr of json.abr) {
      for (const mu of abr.mu) {
        if (mu.cdi) mapa.set(`${abr.cd.toUpperCase()}|${Number.parseInt(mu.cd, 10)}`, String(mu.cdi));
      }
    }
    console.log(`  Cadastro oficial do TSE (TSE -> IBGE): ${fmt(mapa.size)} municípios.`);
    return mapa;
  } catch (err) {
    console.warn(`  Aviso: cadastro do TSE indisponível (${err.message}); associando por nome.`);
    return null;
  }
}

/* ---------------- Conversão ---------------- */

async function main() {
  console.log('Convertendo dados do TSE');
  console.log(`  turno ${opc.turno}, cargo "${opc.cargo}", Flávio = ${opc.numFlavio}, Lula = ${opc.numLula}`);

  const locais = await carregarLocalidades();
  const aliases = await carregarAliases(locais);
  const cargoAlvo = normalizarNome(opc.cargo);
  const filtro = (r) => String(r.NR_TURNO).trim() === opc.turno && normalizarNome(r.DS_CARGO) === cargoAlvo;

  // Acumula por município do TSE (UF + código TSE), somando todas as zonas.
  const tse = new Map();
  const obter = (r) => {
    const uf = String(r.SG_UF).trim().toUpperCase();
    // Um arquivo traz "05010" (texto) e o outro 5010 (número): normaliza sem zeros à esquerda.
    const codigoTse = String(Number.parseInt(String(r.CD_MUNICIPIO).trim(), 10));
    const chave = `${uf}|${codigoTse}`;
    if (!tse.has(chave)) tse.set(chave, { uf, codigoTse, nome: String(r.NM_MUNICIPIO).trim(), votos: zerado() });
    return tse.get(chave);
  };

  // 1) Votos por candidato
  let eleicaoTse = null;
  let colunaVotos = null;
  let linhasCandidatos = 0;
  const infoCand = await lerCsv(opc.candidatos, (r) => {
    if (!colunaVotos) {
      colunaVotos = ['QT_VOTOS_NOMINAIS_VALIDOS', 'QT_VOTOS_NOMINAIS', 'QT_VOTOS'].find((c) => c in r);
      if (!colunaVotos) throw new Error('Coluna de votos não encontrada (QT_VOTOS_NOMINAIS_VALIDOS / QT_VOTOS_NOMINAIS).');
      exigirColunas(Object.keys(r), ['NR_TURNO', 'DS_CARGO', 'SG_UF', 'CD_MUNICIPIO', 'NM_MUNICIPIO', 'NR_CANDIDATO'], opc.candidatos);
    }
    if (!filtro(r)) return;
    linhasCandidatos += 1;
    if (!eleicaoTse && r.CD_ELEICAO) eleicaoTse = { cd: String(r.CD_ELEICAO).trim(), ano: String(r.ANO_ELEICAO).trim() };
    const num = String(r.NR_CANDIDATO).trim();
    const k = num === opc.numFlavio ? 'f' : num === opc.numLula ? 'l' : 'o';
    obter(r).votos[k] += inteiro(r[colunaVotos]);
  });
  console.log(`  ${basename(opc.candidatos)}: ${fmt(infoCand.linhas)} linhas, ${fmt(linhasCandidatos)} do filtro. Coluna de votos: ${colunaVotos}`);
  if (linhasCandidatos === 0) throw new Error('Nenhuma linha de candidato passou no filtro de turno/cargo. Confira --turno e --cargo.');

  // 2) Detalhe: nulos e brancos
  let colunasNulos = opc.colunasNulos;
  let linhasDetalhe = 0;
  let validosDetalhe = 0;
  let temValidos = false;
  const infoDet = await lerCsv(opc.detalhe, (r) => {
    if (!colunasNulos) {
      colunasNulos = 'QT_TOTAL_VOTOS_NULOS' in r ? ['QT_TOTAL_VOTOS_NULOS']
        : ['QT_VOTOS_NULOS', 'QT_VOTOS_NULOS_TECNICOS'].filter((c) => c in r);
    }
    if (linhasDetalhe === 0) {
      exigirColunas(Object.keys(r), ['NR_TURNO', 'DS_CARGO', 'SG_UF', 'CD_MUNICIPIO', 'QT_VOTOS_BRANCOS', ...colunasNulos], opc.detalhe);
      temValidos = 'QT_TOTAL_VOTOS_VALIDOS' in r;
    }
    if (!filtro(r)) return;
    linhasDetalhe += 1;
    const m = obter(r);
    m.votos.b += inteiro(r.QT_VOTOS_BRANCOS);
    for (const c of colunasNulos) m.votos.n += inteiro(r[c]);
    if (temValidos) validosDetalhe += inteiro(r.QT_TOTAL_VOTOS_VALIDOS);
  });
  console.log(`  ${basename(opc.detalhe)}: ${fmt(infoDet.linhas)} linhas, ${fmt(linhasDetalhe)} do filtro. Nulos: ${colunasNulos.join(' + ')}`);
  if (linhasDetalhe === 0) throw new Error('Nenhuma linha de detalhe passou no filtro de turno/cargo.');

  // 3) Associação ao código IBGE.
  // Fonte principal: o cadastro oficial do TSE (campo "cdi" = código IBGE).
  // Se ele não estiver disponível, usa aliases + nome normalizado.
  const cadastroTse = await carregarCadastroTse(eleicaoTse);
  const metodo = { cadastro: 0, alias: 0, nome: 0 };
  const municipios = {};
  const origemPorCodigo = new Map();
  const exterior = zerado();
  const naoMapeados = { quantidade: 0, totalVotos: 0, votos: zerado(), lista: [] };

  for (const m of tse.values()) {
    if (m.uf === 'ZZ') { somar(exterior, m.votos); continue; }
    const porCadastro = cadastroTse?.get(`${m.uf}|${m.codigoTse}`);
    const porAlias = aliases.get(`TSE:${m.codigoTse}`) ?? aliases.get(`${m.uf}|${normalizarNome(m.nome)}`);
    const porNome = locais.porNome.get(`${m.uf}|${normalizarNome(m.nome)}`);
    let cod = porCadastro ?? porAlias ?? porNome;
    if (porCadastro) metodo.cadastro += 1; else if (porAlias) metodo.alias += 1; else if (porNome) metodo.nome += 1;
    if (porCadastro && (porAlias ?? porNome) && (porAlias ?? porNome) !== porCadastro) {
      console.warn(`  Aviso: ${m.uf} ${m.nome}: cadastro do TSE indica ${porCadastro}, nome/alias indicaria ${porAlias ?? porNome}. Usando o cadastro.`);
    }
    if (cod && !locais.codigos.has(cod)) console.warn(`  Aviso: código IBGE ${cod} (${m.uf} ${m.nome}) não existe na lista do IBGE.`);
    let motivo = null;
    if (!cod && !locais.ufs.has(m.uf)) motivo = `UF "${m.uf}" desconhecida`;
    if (!cod) {
      const total = totalDe(m.votos);
      naoMapeados.quantidade += 1;
      naoMapeados.totalVotos += total;
      somar(naoMapeados.votos, m.votos);
      naoMapeados.lista.push({ uf: m.uf, codigoTse: m.codigoTse, nome: m.nome, motivo: motivo ?? 'nome não encontrado no IBGE', votos: { ...m.votos }, total });
      continue;
    }
    if (municipios[cod]) {
      console.warn(`  Aviso: ${m.uf} ${m.nome} (TSE ${m.codigoTse}) e ${origemPorCodigo.get(cod)} apontam para o mesmo código IBGE ${cod}; votos somados.`);
      somar(municipios[cod], m.votos);
    } else {
      municipios[cod] = { ...m.votos };
      origemPorCodigo.set(cod, `${m.uf} ${m.nome} (TSE ${m.codigoTse})`);
    }
  }

  const ordenados = Object.fromEntries(Object.keys(municipios).sort().map((c) => [c, municipios[c]]));
  const semDados = [...locais.codigos.keys()].filter((c) => !municipios[c]);

  const saida = {
    meta: {
      simulado: false,
      fonte: 'TSE – Portal de Dados Abertos (dadosabertos.tse.jus.br)',
      descricao: `Eleição presidencial 2026, ${opc.turno}º turno, votos por município. Arquivos: ${basename(opc.candidatos)} e ${basename(opc.detalhe)}. Nulos: ${colunasNulos.join(' + ')}.`,
      geradoEm: new Date().toISOString(),
      associacao: metodo,
      exterior,
      naoMapeados,
    },
    municipios: ordenados,
  };

  await mkdir(dirname(opc.saida), { recursive: true });
  await writeFile(opc.saida, JSON.stringify(saida));

  // 4) Resumo e conferência
  const brasil = Object.values(municipios).reduce((acc, v) => somar(acc, v), zerado());
  const linha = (rotulo, v) => console.log(`  ${rotulo.padEnd(46)} Flávio ${fmt(v.f).padStart(12)}   Lula ${fmt(v.l).padStart(12)}   nulos ${fmt(v.n).padStart(10)}   brancos ${fmt(v.b).padStart(10)}`);
  const totalGeral = {
    f: brasil.f + exterior.f + naoMapeados.votos.f,
    l: brasil.l + exterior.l + naoMapeados.votos.l,
    n: brasil.n + exterior.n + naoMapeados.votos.n,
    b: brasil.b + exterior.b + naoMapeados.votos.b,
  };

  console.log('\nResumo');
  console.log(`  Municípios associados: ${fmt(Object.keys(municipios).length)} de ${fmt(locais.codigos.size)} do IBGE (${fmt(semDados.length)} sem dados).`);
  console.log(`  Associação: ${fmt(metodo.cadastro)} pelo cadastro oficial do TSE, ${fmt(metodo.alias)} por alias, ${fmt(metodo.nome)} por nome.`);
  linha('Brasil (municípios associados)', brasil);
  linha('Exterior (SG_UF = ZZ)', exterior);
  linha(`Não mapeados (${naoMapeados.quantidade})`, naoMapeados.votos);
  linha('Total geral (Brasil + exterior + não mapeados)', totalGeral);
  console.log(`  Referência oficial (TSE): Flávio ${fmt(REFERENCIA_OFICIAL.f)}, Lula ${fmt(REFERENCIA_OFICIAL.l)}`);
  console.log(`  Diferença para a referência: Flávio ${fmt(totalGeral.f - REFERENCIA_OFICIAL.f)}, Lula ${fmt(totalGeral.l - REFERENCIA_OFICIAL.l)}`);
  if (temValidos) {
    const validosCand = totalGeral.f + totalGeral.l + brasil.o + exterior.o + naoMapeados.votos.o;
    console.log(`  Válidos: candidatos ${fmt(validosCand)} × detalhe ${fmt(validosDetalhe)} (diferença ${fmt(validosCand - validosDetalhe)})`);
  }
  if (naoMapeados.quantidade) {
    console.log('\nMunicípios não associados (use --aliases para corrigir):');
    for (const m of naoMapeados.lista.slice(0, 50)) console.log(`  ${m.uf}|${m.nome}  (TSE ${m.codigoTse}, ${fmt(m.total)} votos, ${m.motivo})`);
    if (naoMapeados.lista.length > 50) console.log(`  … e mais ${naoMapeados.lista.length - 50}.`);
  }
  console.log(`\nArquivo salvo: ${opc.saida}`);
}

main().catch((e) => {
  console.error(`\nErro: ${e.message}`);
  process.exit(1);
});
