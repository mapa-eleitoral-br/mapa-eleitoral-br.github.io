#!/usr/bin/env node
// Baixa as malhas e as listas de localidades do IBGE para data/geo/.
// Uso: npm run baixar-malhas
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const destino = join(raiz, 'data', 'geo');

const IBGE = 'https://servicodados.ibge.gov.br/api';
const MALHA = `${IBGE}/v3/malhas/paises/BR?formato=application/vnd.geo+json&qualidade=minima`;

const ARQUIVOS = {
  'municipios.json': `${MALHA}&intrarregiao=municipio`,
  'estados.json': `${MALHA}&intrarregiao=UF`,
  'pais.json': MALHA,
  'localidades-municipios.json': `${IBGE}/v1/localidades/municipios`,
  'localidades-estados.json': `${IBGE}/v1/localidades/estados`,
};

async function baixar(url, tentativas = 3) {
  for (let i = 1; i <= tentativas; i += 1) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === tentativas) throw new Error(`${url}: ${e.message}`);
      console.warn(`  tentativa ${i} falhou (${e.message}); tentando de novo…`);
      await new Promise((ok) => setTimeout(ok, 1500 * i));
    }
  }
  return null;
}

await mkdir(destino, { recursive: true });
for (const [nome, url] of Object.entries(ARQUIVOS)) {
  process.stdout.write(`Baixando ${nome}… `);
  const json = await baixar(url);
  const texto = JSON.stringify(json);
  await writeFile(join(destino, nome), texto);
  const qtd = Array.isArray(json) ? json.length : json.features?.length;
  console.log(`ok (${qtd} itens, ${(texto.length / 1e6).toFixed(1)} MB)`);
}
console.log(`\nArquivos salvos em ${destino}`);
