# Mapa eleitoral do Brasil – 2º turno presidencial 2026

Mapa interativo por município com os votos de **Flávio Bolsonaro (PL, 22)**, **Lula (PT, 13)**, nulos e
brancos no 2º turno de 25/10/2026. Os dados são **oficiais do TSE** e foram conferidos município a município.

**Site:** <https://mapa-eleitoral-br.github.io/>

Feito com HTML, CSS e JavaScript puro, D3.js v7 (via CDN) e as malhas do IBGE.

## Resultado nacional (TSE, 100% das seções apuradas)

| | Votos | % dos válidos |
|---|---:|---:|
| Lula (PT) | 64.256.232 | 51,79% |
| Flávio Bolsonaro (PL) | 59.826.041 | 48,21% |
| Nulos | 2.723.305 | |
| Brancos | 1.430.496 | |

Diferença: 4.430.191 votos para Lula. Esses totais incluem o exterior (186 cidades), que não aparece no mapa.

## De onde vêm os dados

| Dado | Fonte |
|---|---|
| Votos por município | Portal de Dados Abertos do TSE, conjunto [Resultados – 2026](https://dadosabertos.tse.jus.br/dataset/resultados-2026): `votacao_candidato_munzona_2026_BR.csv` (votos por candidato) e `detalhe_votacao_munzona_2026_BR.csv` (nulos e brancos), filtrados por 2º turno e cargo Presidente |
| Código IBGE de cada município do TSE | Cadastro oficial do TSE (`resultados.tse.jus.br/oficial/ele2026/6258/config/mun-e006258-cm.json`, campo `cdi`) |
| Conferência independente | Site de resultados do TSE, um arquivo por município (`resultados.tse.jus.br/oficial/ele2026/6258/dados/<uf>/<uf><código>-c0001-e006258-u.json`) |
| Desenho dos municípios e estados | API de malhas do IBGE (`servicodados.ibge.gov.br`), salva em `data/geo/` |

## Como os dados foram validados

O comando `npm run validar` baixa o resultado de **cada um dos 5.571 municípios** e das 186 cidades do
exterior direto do site de resultados do TSE. Essa é uma fonte diferente dos CSVs usados para montar o mapa.
Depois, compara os cinco números de cada município: Flávio, Lula, nulos, brancos e outros.

Última conferência (29/10/2026):

- 5.571 de 5.571 municípios idênticos ao TSE, com 0 divergências e 0 falhas de download;
- totalização finalizada em todos os municípios;
- exterior idêntico ao TSE;
- mapa + exterior = total nacional do TSE (Flávio 59.826.041, Lula 64.256.232, nulos 2.723.305, brancos 1.430.496);
- os votos válidos dos dois CSVs batem entre si (124.082.273).

Para achar uma cidade, use a busca (lupa) no topo do mapa. Ela ignora acentos e aceita a sigla do
estado no fim, como "sao jose sc".

O relatório fica em [`data/validacao.json`](data/validacao.json). No site, o resultado aparece de três formas:

- um selo verde na barra lateral, com link para o relatório;
- a linha "✓ Igual ao site de resultados do TSE" no tooltip de cada município;
- o resumo no painel do Brasil (clique no fundo do mapa para ver).

Para conferir uma cidade você mesmo, compare o tooltip do mapa com o
[site](https://resultados.tse.jus.br/) ou o aplicativo Resultados do TSE.

### Limitações conhecidas

- **Boa Esperança do Norte (MT)**, criado em 2023, ainda não tem desenho na malha da API do IBGE.
  Os votos dele (3.331) entram no total de Mato Grosso e do Brasil, mas o município não aparece no mapa.
- O painel do Brasil mostra só os votos dados no país. Por isso o % dos válidos de Lula aparece como
  51,78%. Com o exterior, fica nos 51,79% oficiais.

## Regras de cálculo

- Total considerado = Flávio + Lula + outros + nulos + brancos. É o denominador dos percentuais.
- % dos válidos (sem nulos e brancos) aparece como informação extra.
- Estados e país: soma dos votos absolutos dos municípios e só depois o percentual. Nunca média de percentuais.
- A soma dos estados é conferida contra o total nacional a cada carregamento.
- Nulos = `QT_TOTAL_VOTOS_NULOS` do TSE (nulos + nulos técnicos).
- Cores: azul = Flávio, vermelho = Lula, cinza = nulos.
- **Vantagem** (visão inicial): a cor mostra quem ficou à frente e a intensidade mostra por quanto, com
  8 tons para cada candidato. No modo percentual, a vantagem é em pontos percentuais sobre o total
  considerado, com limites fixos (5, 10, 20, 30, 40, 50 e 60 p.p.). No modo absoluto, é em votos
  (Flávio − Lula), com limites por quantis do nível e arredondados.
- Flávio, Lula e Nulos: 9 classes por quantis, por categoria e por nível. No nível país, escala fixa de
  0 ao total (ou de 0 a 100%).
- **Bivariado**: escala 3×3 por tercis independentes de Flávio e Lula. Em votos absolutos, cidades grandes
  ficam escuras para os dois candidatos; por isso a visão de vantagem é a padrão.
- Nível automático pelo zoom: abaixo de 1,4× = país; abaixo de 3,5× = estado; acima = município.

## Como rodar localmente

Requer Node.js 18 ou mais recente.

```powershell
cd mapa-eleitoral
npm start            # http://localhost:8080
```

Sem `data/eleicao.json`, o mapa mostra uma **SIMULAÇÃO** com votos fictícios, com faixa amarela e
marca d'água na tela.

## Como atualizar os dados

1. No conjunto [Resultados – 2026](https://dadosabertos.tse.jus.br/dataset/resultados-2026), baixe:
   - **Votação nominal por município e zona** (`votacao_candidato_munzona_2026.zip`, cerca de 450 MB);
   - **Detalhe da apuração por município e zona** (`detalhe_votacao_munzona_2026.zip`).
2. De cada ZIP, extraia só o arquivo com sufixo `_BR.csv` para `data/tse/`. Essa pasta não vai para o git.
3. Gere os dados e confira com o TSE:

   ```powershell
   npm run converter
   npm run validar
   ```

4. O `validar` termina com "OK: todos os dados conferem com o TSE." Se aparecer alguma divergência, ela é
   listada na tela e em `data/validacao.json`.

Para baixar de novo as malhas do IBGE: `npm run baixar-malhas`.

### Opções do conversor

```powershell
npm run converter -- --turno=2 --cargo=Presidente
npm run converter -- --candidatos=C:\caminho\arquivo1.csv --detalhe=C:\caminho\arquivo2.csv
npm run converter -- --colunas-nulos=QT_VOTOS_NULOS,QT_VOTOS_NULOS_TECNICOS
npm run converter -- --sem-cadastro-tse     # associa só por nome + aliases
```

O conversor associa cada município do TSE ao código IBGE usando o cadastro oficial do TSE. Se o cadastro
não puder ser baixado, ele usa UF + nome normalizado (sem acentos, espaços e pontuação), com as correções
de `data/aliases.json` para os 13 municípios cujo nome difere entre TSE e IBGE (por exemplo, "Boa Saúde"
no TSE é Januário Cicco no IBGE). Nesta base, os dois métodos chegaram ao mesmo resultado nos 5.571 municípios.
Linhas com `SG_UF = ZZ` (exterior) vão para `meta.exterior`.

## Formato de `data/eleicao.json`

```json
{
  "meta": {
    "simulado": false,
    "fonte": "...",
    "descricao": "...",
    "exterior": { "f": 0, "l": 0, "n": 0, "b": 0, "o": 0 },
    "naoMapeados": { "quantidade": 0, "totalVotos": 0, "votos": { "f": 0, "l": 0, "n": 0, "b": 0, "o": 0 }, "lista": [] }
  },
  "municipios": {
    "3550308": { "f": 0, "l": 0, "n": 0, "b": 0, "o": 0 }
  }
}
```

`f` = Flávio, `l` = Lula, `n` = nulos, `b` = brancos, `o` = outros. A chave é o código IBGE de 7 dígitos.
Também é possível carregar um arquivo nesse formato pelo botão **Carregar arquivo .json**. Nesse caso,
o selo de conferência não aparece, porque ele vale só para o `data/eleicao.json` publicado.

## Estrutura

```
index.html                interface
css/styles.css            layout responsivo
js/data.js                malhas do IBGE, validação do arquivo e simulação
js/stats.js               cálculos (resumo, agregação)
js/scales.js              escalas de cor
js/map.js                 projeção, camadas e zoom (D3)
js/ui.js                  tooltip, painel, legenda, selo de conferência
js/main.js                estado da aplicação
js/search.js              busca de municípios
data/eleicao.json         votos por município (gerado)
data/validacao.json       relatório da conferência com o TSE (gerado)
data/aliases.json         correções de nomes TSE -> IBGE
data/geo/                 malhas e listas de municípios do IBGE
tools/baixar-malhas.mjs   salva as malhas em data/geo/
tools/converter-tse.mjs   CSVs do TSE -> data/eleicao.json
tools/validar-tse.mjs     confere data/eleicao.json com o site de resultados do TSE
```
