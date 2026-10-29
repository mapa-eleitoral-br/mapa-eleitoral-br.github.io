#!/usr/bin/env node
// Confere data/eleicao.json, município por município, contra a API pública de
// resultados do TSE (resultados.tse.jus.br), que é uma fonte independente dos CSVs.
//
// Uso: npm run validar [-- --eleicao=6258 --ciclo=ele2026 --concorrencia=12]
//
// Gera data/validacao.json, que o site lê para mostrar o selo de conferência.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [k, ...v] = a.slice(2).split('=');
    return [k, v.join('=') || 'true'];
  }),
);
const CICLO = args.ciclo ?? 'ele2026';
const ELEICAO = String(args.eleicao ?? '6258');
const CONCORRENCIA = Number(args.concorrencia ?? 12);
const BASE = `https://resultados.tse.jus.br/oficial/${CICLO}/${ELEICAO}`;
const E = `e${ELEICAO.padStart(6, '0')}`;
const NUM_FLAVIO = '22';
const NUM_LULA = '13';
const CHAVES = ['f', 'l', 'n', 'b', 'o'];

const fmt = (x) => new Intl.NumberFormat('pt-BR').format(x);
const inteiro = (s) => Number.parseInt(String(s ?? '0').replace(/\D/g, ''), 10) || 0;
const zerado = () => ({ f: 0, l: 0, n: 0, b: 0, o: 0 });
const somar = (d, o) => { for (const k of CHAVES) d[k] += o[k] || 0; return d; };

async function buscar(url, tentativas = 4) {
  for (let i = 1; ; i += 1) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= tentativas) throw new Error(`${url}: ${e.message}`);
      await new Promise((ok) => setTimeout(ok, 800 * i));
    }
  }
}

/** Extrai f, l, n, b, o de um arquivo de resultado (-u.json) do TSE. */
function extrair(json) {
  const v = zerado();
  const cargo = json.carg?.find((c) => c.cd === '1') ?? json.carg?.[0];
  for (const agr of cargo?.agr ?? []) {
    for (const par of agr.par ?? []) {
      for (const cand of par.cand ?? []) {
        const votos = inteiro(cand.vap);
        if (cand.n === NUM_FLAVIO) v.f += votos;
        else if (cand.n === NUM_LULA) v.l += votos;
        else v.o += votos;
      }
    }
  }
  v.b = inteiro(json.v?.vb);
  v.n = inteiro(json.v?.tvn);
  return {
    votos: v,
    totalVotos: inteiro(json.v?.tv),
    finalizada: json.tf === 's',
    secoesApuradas: json.s?.pst,
    geradoEm: `${json.dg} ${json.hg}`,
  };
}

async function emParalelo(itens, n, fn) {
  const resultados = new Array(itens.length);
  let proximo = 0;
  let feitos = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (proximo < itens.length) {
      const i = proximo;
      proximo += 1;
      resultados[i] = await fn(itens[i]);
      feitos += 1;
      if (feitos % 250 === 0 || feitos === itens.length) process.stdout.write(`\r  ${fmt(feitos)} de ${fmt(itens.length)}`);
    }
  }));
  process.stdout.write('\n');
  return resultados;
}

async function main() {
  const eleicao = JSON.parse(await readFile(join(raiz, 'data/eleicao.json'), 'utf8'));
  console.log(`Validando data/eleicao.json contra ${BASE}`);

  // Cadastro oficial do TSE: código TSE -> código IBGE (campo "cdi").
  const config = await buscar(`${BASE}/config/mun-${E}-cm.json`);
  const lista = [];
  for (const abr of config.abr) {
    for (const mu of abr.mu) lista.push({ uf: abr.cd, cd: mu.cd, ibge: mu.cdi ? String(mu.cdi) : null, nome: mu.nm });
  }
  const brasil = lista.filter((m) => m.uf !== 'zz');
  const exterior = lista.filter((m) => m.uf === 'zz');
  console.log(`  Cadastro do TSE: ${fmt(brasil.length)} municípios no Brasil, ${fmt(exterior.length)} cidades no exterior.`);

  const baixar = async (m) => {
    try {
      return { ...m, ...extrair(await buscar(`${BASE}/dados/${m.uf}/${m.uf}${m.cd}-c0001-${E}-u.json`)) };
    } catch (e) {
      return { ...m, erro: e.message };
    }
  };
  console.log('  Baixando resultados por município…');
  const resultados = await emParalelo(brasil, CONCORRENCIA, baixar);
  console.log('  Baixando resultados do exterior…');
  const resultadosExterior = await emParalelo(exterior, CONCORRENCIA, baixar);

  const divergencias = [];
  const falhas = [];
  const naoFinalizados = [];
  let identicos = 0;
  const somaApi = zerado();
  const codigosApi = new Set();

  for (const r of resultados) {
    if (r.erro) { falhas.push({ uf: r.uf, codigoTse: r.cd, nome: r.nome, erro: r.erro }); continue; }
    if (!r.finalizada) naoFinalizados.push(`${r.uf.toUpperCase()} ${r.nome}`);
    somar(somaApi, r.votos);
    codigosApi.add(r.ibge);
    const nosso = eleicao.municipios[r.ibge];
    const difs = {};
    for (const k of CHAVES) {
      const a = nosso?.[k] ?? null;
      if (a !== r.votos[k]) difs[k] = { mapa: a, tse: r.votos[k] };
    }
    if (Object.keys(difs).length) {
      divergencias.push({ ibge: r.ibge, uf: r.uf.toUpperCase(), codigoTse: r.cd, nome: r.nome, diferencas: difs });
    } else identicos += 1;
  }

  const sobrando = Object.keys(eleicao.municipios).filter((c) => !codigosApi.has(c));
  const somaExterior = zerado();
  for (const r of resultadosExterior) {
    if (r.erro) falhas.push({ uf: 'ZZ', codigoTse: r.cd, nome: r.nome, erro: r.erro });
    else somar(somaExterior, r.votos);
  }
  const exteriorConfere = CHAVES.every((k) => (eleicao.meta.exterior?.[k] ?? 0) === somaExterior[k]);

  let nacional = null;
  try {
    nacional = extrair(await buscar(`${BASE}/dados/br/br-c0001-${E}-u.json`));
  } catch (e) {
    console.warn(`  Aviso: total nacional indisponível (${e.message}).`);
  }
  const totalMapaMaisExterior = somar(somar(zerado(), somaApi), somaExterior);
  const nacionalConfere = nacional ? CHAVES.every((k) => nacional.votos[k] === totalMapaMaisExterior[k]) : null;

  const ok = divergencias.length === 0 && falhas.length === 0 && sobrando.length === 0 && exteriorConfere && nacionalConfere !== false;
  const relatorio = {
    ok,
    conferidoEm: new Date().toISOString(),
    fonte: `${BASE}/dados/<uf>/<uf><município>-c0001-${E}-u.json`,
    turno: 2,
    municipiosTse: brasil.length,
    municipiosIdenticos: identicos,
    divergencias,
    falhas,
    codigosSemCorrespondencia: sobrando,
    naoFinalizados,
    exterior: { cidades: exterior.length, confere: exteriorConfere, tse: somaExterior },
    nacional: nacional ? { confere: nacionalConfere, tse: nacional.votos, geradoEm: nacional.geradoEm, secoesApuradas: nacional.secoesApuradas } : null,
  };
  await writeFile(join(raiz, 'data/validacao.json'), JSON.stringify(relatorio, null, 1));

  console.log('\nResultado');
  console.log(`  Municípios idênticos ao TSE (f, l, n, b, o): ${fmt(identicos)} de ${fmt(brasil.length)}`);
  console.log(`  Divergências: ${fmt(divergencias.length)}   Falhas de download: ${fmt(falhas.length)}   Códigos sem correspondência: ${fmt(sobrando.length)}`);
  console.log(`  Totalização não finalizada: ${fmt(naoFinalizados.length)}`);
  console.log(`  Exterior (${exterior.length} cidades) confere: ${exteriorConfere ? 'sim' : 'NÃO'}`);
  if (nacional) {
    console.log(`  Nacional TSE: Flávio ${fmt(nacional.votos.f)}, Lula ${fmt(nacional.votos.l)}, nulos ${fmt(nacional.votos.n)}, brancos ${fmt(nacional.votos.b)} (seções apuradas ${nacional.secoesApuradas}%)`);
    console.log(`  Mapa + exterior confere com o nacional: ${nacionalConfere ? 'sim' : 'NÃO'}`);
  }
  for (const d of divergencias.slice(0, 30)) console.log(`  ≠ ${d.uf} ${d.nome} (IBGE ${d.ibge}): ${JSON.stringify(d.diferencas)}`);
  for (const f of falhas.slice(0, 30)) console.log(`  ! ${f.uf} ${f.nome}: ${f.erro}`);
  console.log(`\n${ok ? 'OK: todos os dados conferem com o TSE.' : 'ATENÇÃO: há diferenças (veja acima).'} Relatório: data/validacao.json`);
  process.exitCode = ok ? 0 : 2;
}

main().catch((e) => { console.error(`Erro: ${e.message}`); process.exit(1); });
