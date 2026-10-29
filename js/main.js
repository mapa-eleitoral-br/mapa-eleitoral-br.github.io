// Estado da aplicação e ligação entre dados, escalas, mapa e interface.
import { carregarMalhas, carregarEleicao, carregarValidacao, validarEleicao } from './data.js';
import { resumir, agregar, ufDoMunicipio } from './stats.js';
import { criarEscala, criarEscalaBivariada, criarEscalaDivergente, valorDe } from './scales.js';
import { criarMapa, ZOOM_INICIAL } from './map.js';
import {
  htmlResumo, mostrarTooltip, esconderTooltip, renderizarLegenda,
  atualizarBadges, atualizarFaixaFonte, fmtVotos, escaparHtml,
} from './ui.js';
import { criarBusca } from './search.js';

const $ = (id) => document.getElementById(id);

const CHAVE_CATEGORIA = { flavio: 'f', lula: 'l', nulos: 'n' };
// Resultado oficial nacional (TSE, 100% apurado), usado só para conferência.
const OFICIAL_NACIONAL = { f: 59_826_041, l: 64_256_232 };
const K_ESTADO = 1.4; // abaixo: país
const K_MUNICIPIO = 3.5; // a partir daqui: município
const K_FOCO_ESTADO = 3.6; // zoom mínimo ao clicar num estado (mostra municípios)
const K_MAX_BUSCA = 24; // zoom máximo ao buscar um município (mantém os vizinhos visíveis)

const estado = {
  categoria: 'comparar',
  metrica: 'percentual',
  nivelEscolhido: 'auto',
  nivel: 'estado',
  k: ZOOM_INICIAL,
  selecao: null, // { nivel, cod }
};

let geo = null;
let mapa = null;
let eleicao = null; // { dados, tipo, mensagem }
let resumos = null; // { municipio: Map, estado: Map, pais: Map }
let agregado = null;
let validacao = null; // relatório de tools/validar-tse.mjs
let divergentes = new Set();
let cacheEscalas = new Map();

/** Vantagem de Flávio sobre Lula: em votos (absoluto) ou em pontos percentuais. */
const vantagemDe = (r, metrica) => (r ? (metrica === 'percentual' ? r.diferencaPP : r.diferenca) : null);

const dataBr = (iso) => new Date(iso).toLocaleDateString('pt-BR');

export function nivelPorZoom(k) {
  if (k < K_ESTADO) return 'pais';
  if (k < K_MUNICIPIO) return 'estado';
  return 'municipio';
}

/* ---------------- Dados ---------------- */

function aplicarDados(resultado) {
  eleicao = resultado;
  const { municipios } = resultado.dados;
  agregado = agregar(municipios);

  resumos = { municipio: new Map(), estado: new Map(), pais: new Map() };
  for (const [cod, v] of Object.entries(municipios)) resumos.municipio.set(cod, resumir(v));
  for (const [uf, v] of Object.entries(agregado.estados)) resumos.estado.set(uf, resumir(v));
  const resumoPais = resumir(agregado.pais);
  for (const f of geo.pais.features) resumos.pais.set(String(f.properties.codarea), resumoPais);

  if (agregado.conferencia.ok) {
    console.info('[mapa] Conferência OK: soma dos estados = total nacional.', agregado.conferencia.pais);
  } else {
    console.error('[mapa] Conferência FALHOU: soma dos estados ≠ total nacional.', agregado.conferencia);
  }

  // Cobertura: municípios do mapa sem dados e códigos dos dados fora do mapa.
  const codigosMapa = new Set(geo.municipio.features.map((f) => String(f.properties.codarea)));
  const semDados = [...codigosMapa].filter((c) => !resumos.municipio.has(c)).length;
  const foraDoMapa = Object.keys(municipios).filter((c) => !codigosMapa.has(c));
  const avisos = [];
  if (semDados) avisos.push(`${semDados} município(s) do mapa sem dados.`);
  if (foraDoMapa.length) {
    const nomes = foraDoMapa.slice(0, 5).map((c) => {
      const uf = geo.ufs.get(ufDoMunicipio(c));
      return `${geo.nomesMunicipios.get(c) ?? c}${uf ? ` (${uf.sigla})` : ''}`;
    });
    avisos.push(`Sem desenho na malha do IBGE: ${nomes.join(', ')}${foraDoMapa.length > 5 ? '…' : ''}. `
      + 'Os votos entram no total do estado e do país.');
  }

  // A validação só vale para o data/eleicao.json que foi conferido.
  validacao = resultado.validacao ?? null;
  divergentes = new Set((validacao?.divergencias ?? []).map((d) => String(d.ibge)));

  atualizarFaixaFonte($('faixa-fonte'), $('marca-simulacao'), {
    tipo: resultado.tipo,
    meta: resultado.dados.meta,
    mensagem: [resultado.mensagem, ...avisos].filter(Boolean).join(' '),
    validacao,
  });

  cacheEscalas = new Map();
  colorirTudo();
  atualizarPainel();
}

/* ---------------- Escalas e cores ---------------- */

function escalaPara(nivel) {
  const chaveCache = `${estado.categoria}|${estado.metrica}|${nivel}`;
  if (cacheEscalas.has(chaveCache)) return cacheEscalas.get(chaveCache);

  const features = geo[nivel].features;
  const resumoDe = (f) => resumos[nivel].get(String(f.properties.codarea));
  const totalPais = resumir(agregado.pais).total;
  let escala;
  if (estado.categoria === 'comparar') {
    escala = criarEscalaDivergente({
      metrica: estado.metrica,
      nivel,
      valores: features.map((f) => vantagemDe(resumoDe(f), estado.metrica)),
      totalPais,
    });
  } else if (estado.categoria === 'bivariado') {
    escala = criarEscalaBivariada({
      metrica: estado.metrica,
      nivel,
      valoresF: features.map((f) => valorDe(resumoDe(f), 'f', estado.metrica)),
      valoresL: features.map((f) => valorDe(resumoDe(f), 'l', estado.metrica)),
      totalPais,
    });
  } else {
    const chave = CHAVE_CATEGORIA[estado.categoria];
    escala = criarEscala({
      chave,
      metrica: estado.metrica,
      nivel,
      valores: features.map((f) => valorDe(resumoDe(f), chave, estado.metrica)),
      totalPais,
    });
  }
  cacheEscalas.set(chaveCache, escala);
  return escala;
}

function colorirTudo() {
  for (const nivel of ['municipio', 'estado', 'pais']) {
    const escala = escalaPara(nivel);
    mapa.colorir(nivel, (cod) => {
      const r = resumos[nivel].get(cod);
      if (estado.categoria === 'comparar') return escala.cor(vantagemDe(r, estado.metrica));
      if (estado.categoria === 'bivariado') {
        return escala.cor(valorDe(r, 'f', estado.metrica), valorDe(r, 'l', estado.metrica));
      }
      return escala.cor(valorDe(r, escala.chave, estado.metrica));
    });
  }
  atualizarVisao();
}

function atualizarVisao() {
  const automatico = estado.nivelEscolhido === 'auto';
  estado.nivel = automatico ? nivelPorZoom(estado.k) : estado.nivelEscolhido;
  mapa.ativarNivel(estado.nivel);
  renderizarLegenda($('legenda'), escalaPara(estado.nivel));
  atualizarBadges(
    { elNivel: $('badge-nivel'), elModo: $('badge-modo') },
    { nivel: estado.nivel, automatico, categoria: estado.categoria, metrica: estado.metrica },
  );
}

/* ---------------- Textos de regiões ---------------- */

function descrever(nivel, cod) {
  if (nivel === 'municipio') {
    const uf = geo.ufs.get(ufDoMunicipio(cod));
    const nome = geo.nomesMunicipios.get(cod) ?? `Município ${cod}`;
    const notas = [];
    if (validacao && resumos.municipio.has(cod)) {
      notas.push(divergentes.has(cod)
        ? '✗ Diverge do site de resultados do TSE (veja data/validacao.json).'
        : `✓ Igual ao site de resultados do TSE (conferido em ${dataBr(validacao.conferidoEm)}).`);
    }
    return {
      titulo: `${nome}${uf ? ` (${uf.sigla})` : ''}`,
      subtitulo: `Município · ${uf ? uf.nome : 'UF desconhecida'} · código IBGE ${cod}`,
      notas,
    };
  }
  if (nivel === 'estado') {
    const uf = geo.ufs.get(cod);
    const qtd = Object.keys(eleicao.dados.municipios).filter((c) => ufDoMunicipio(c) === cod).length;
    return {
      titulo: uf ? `${uf.nome} (${uf.sigla})` : `UF ${cod}`,
      subtitulo: `Estado · soma dos votos de ${qtd} municípios`,
      notas: [],
    };
  }
  const notas = [];
  const { conferencia } = agregado;
  notas.push(conferencia.ok
    ? 'Conferência: a soma dos estados é igual ao total nacional.'
    : 'ATENÇÃO: a soma dos estados difere do total nacional (veja o console).');
  const { exterior, naoMapeados } = eleicao.dados.meta;
  if (exterior) {
    notas.push(`Exterior (fora do mapa e deste total): Flávio ${fmtVotos(exterior.f || 0)}, Lula ${fmtVotos(exterior.l || 0)}, nulos ${fmtVotos(exterior.n || 0)}, brancos ${fmtVotos(exterior.b || 0)}.`);
  }
  if (naoMapeados?.quantidade) {
    notas.push(`${naoMapeados.quantidade} município(s) do TSE sem código IBGE (${fmtVotos(naoMapeados.totalVotos || 0)} votos) ficaram fora do mapa e deste total.`);
  }
  if (eleicao.tipo === 'oficial') {
    const fora = (k) => (exterior?.[k] || 0) + (naoMapeados?.votos?.[k] || 0);
    const f = agregado.pais.f + fora('f');
    const l = agregado.pais.l + fora('l');
    const bate = f === OFICIAL_NACIONAL.f && l === OFICIAL_NACIONAL.l;
    notas.push(`Validação: Brasil + exterior = Flávio ${fmtVotos(f)}, Lula ${fmtVotos(l)}. `
      + `Resultado oficial do TSE: Flávio ${fmtVotos(OFICIAL_NACIONAL.f)}, Lula ${fmtVotos(OFICIAL_NACIONAL.l)}. `
      + (bate ? 'Os números batem exatamente.' : `Diferença: Flávio ${fmtVotos(f - OFICIAL_NACIONAL.f)}, Lula ${fmtVotos(l - OFICIAL_NACIONAL.l)}.`));
  }
  if (validacao) {
    notas.push(`Conferência município a município com o site de resultados do TSE em ${dataBr(validacao.conferidoEm)}: `
      + `${fmtVotos(validacao.municipiosIdenticos)} de ${fmtVotos(validacao.municipiosTse)} municípios idênticos `
      + `(Flávio, Lula, nulos, brancos e outros); ${fmtVotos(validacao.divergencias.length)} divergência(s).`);
  }
  return {
    titulo: 'Brasil',
    subtitulo: `País · soma de ${resumos.estado.size} unidades da federação`,
    notas,
  };
}

function htmlRegiao(nivel, cod) {
  const d = descrever(nivel, cod);
  return htmlResumo({ ...d, r: resumos[nivel].get(cod) });
}

function atualizarPainel() {
  const painel = $('painel');
  const sel = estado.selecao;
  if (sel) {
    painel.innerHTML = htmlRegiao(sel.nivel, sel.cod);
  } else {
    const codPais = String(geo.pais.features[0].properties.codarea);
    painel.innerHTML = htmlRegiao('pais', codPais)
      + '<p class="dica">Clique em uma região para ver os detalhes dela aqui.</p>';
  }
}

/** Resultado da busca: aproxima o município, seleciona e mostra no painel. */
function irParaMunicipio(cod) {
  if (estado.nivelEscolhido !== 'auto') {
    estado.nivelEscolhido = 'auto';
    $('nivel').value = 'auto';
  }
  selecionar('municipio', cod);
  // Município sem desenho na malha (ex.: Boa Esperança do Norte): aproxima o estado.
  if (!mapa.focar('municipio', cod, K_FOCO_ESTADO, K_MAX_BUSCA)) mapa.focar('estado', ufDoMunicipio(cod), K_FOCO_ESTADO);
  // Em telas estreitas o painel fica abaixo do mapa.
  if (window.matchMedia('(max-width: 900px)').matches) {
    setTimeout(() => $('painel').scrollIntoView({ behavior: 'smooth', block: 'start' }), 800);
  }
}

function selecionar(nivel, cod) {
  estado.selecao = nivel ? { nivel, cod } : null;
  mapa.selecionar(nivel, cod);
  atualizarPainel();
}

/* ---------------- Inicialização ---------------- */

function ligarControles() {
  // O navegador pode restaurar o estado do formulário ao recarregar; o estado da aplicação manda.
  document.querySelector(`input[name="categoria"][value="${estado.categoria}"]`).checked = true;
  document.querySelector(`input[name="metrica"][value="${estado.metrica}"]`).checked = true;
  $('nivel').value = estado.nivelEscolhido;
  document.querySelectorAll('input[name="categoria"]').forEach((el) => {
    el.addEventListener('change', () => {
      estado.categoria = el.value;
      colorirTudo();
    });
  });
  document.querySelectorAll('input[name="metrica"]').forEach((el) => {
    el.addEventListener('change', () => {
      estado.metrica = el.value;
      colorirTudo();
    });
  });
  $('nivel').addEventListener('change', (ev) => {
    estado.nivelEscolhido = ev.target.value;
    atualizarVisao();
  });
  $('zoom-mais').addEventListener('click', () => mapa.aproximar());
  $('zoom-menos').addEventListener('click', () => mapa.afastar());
  $('zoom-reset').addEventListener('click', () => {
    selecionar(null);
    mapa.restaurar();
  });

  $('arquivo').addEventListener('change', async (ev) => {
    const arquivo = ev.target.files?.[0];
    const status = $('arquivo-status');
    if (!arquivo) return;
    try {
      const v = validarEleicao(JSON.parse(await arquivo.text()));
      if (!v.ok) throw new Error(v.erros.join(' '));
      selecionar(null);
      aplicarDados({
        dados: v.dados,
        tipo: v.dados.meta.simulado ? 'simulado' : 'oficial',
        mensagem: `Arquivo: ${arquivo.name}.`,
      });
      status.textContent = `"${arquivo.name}" carregado (${Object.keys(v.dados.municipios).length} municípios).`
        + (v.avisos.length ? ` Avisos: ${v.avisos.join(' ')}` : '');
    } catch (e) {
      status.innerHTML = `<strong>Não foi possível usar "${escaparHtml(arquivo.name)}":</strong> ${escaparHtml(e.message)} Os dados atuais foram mantidos.`;
    } finally {
      ev.target.value = '';
    }
  });
}

async function iniciar() {
  const telaCarregando = $('carregando');
  const textoCarregando = $('carregando-texto');
  try {
    const malhas = await carregarMalhas((feitos, total) => {
      textoCarregando.textContent = `Carregando malhas do IBGE… (${feitos}/${total})`;
    });
    geo = {
      municipio: malhas.municipios,
      estado: malhas.estados,
      pais: malhas.pais,
      ufs: malhas.ufs,
      nomesMunicipios: malhas.nomesMunicipios,
    };
    console.info(`[mapa] Malhas carregadas (${malhas.origem}): ${geo.municipio.features.length} municípios, ${geo.estado.features.length} UFs.`);

    textoCarregando.textContent = 'Desenhando o mapa…';
    const container = document.querySelector('.area-mapa');
    const tooltip = $('tooltip');
    mapa = criarMapa($('mapa'), geo, {
      aoPassar(nivel, cod, ev) {
        if (resumos) mostrarTooltip(tooltip, htmlRegiao(nivel, cod), ev, container);
      },
      aoSair() { esconderTooltip(tooltip); },
      aoClicar(nivel, cod) {
        selecionar(nivel, cod);
        if (nivel === 'estado') mapa.focar('estado', cod, K_FOCO_ESTADO);
        if (nivel === 'pais') mapa.restaurar();
      },
      aoClicarFundo() {
        selecionar(null);
        $('busca').value = '';
        mapa.restaurar();
      },
      aoZoom(k) {
        estado.k = k;
        esconderTooltip(tooltip);
        if (mapa && resumos && estado.nivelEscolhido === 'auto' && nivelPorZoom(k) !== estado.nivel) {
          atualizarVisao();
        }
      },
    });
    console.info('[mapa] Polígonos com anéis invertidos (RFC 7946 → D3):', mapa.correcoes);

    textoCarregando.textContent = 'Carregando dados eleitorais…';
    const codigos = geo.municipio.features.map((f) => String(f.properties.codarea));
    const resultado = await carregarEleicao(codigos);
    if (resultado.tipo === 'oficial') resultado.validacao = await carregarValidacao();
    aplicarDados(resultado);
    ligarControles();
    criarBusca({
      input: $('busca'),
      lista: $('busca-lista'),
      itens: [...geo.nomesMunicipios].map(([cod, nome]) => {
        const uf = geo.ufs.get(ufDoMunicipio(cod));
        return { cod, nome, uf: uf?.sigla ?? '', ufNome: uf?.nome ?? '' };
      }),
      aoEscolher: irParaMunicipio,
    });

    telaCarregando.classList.add('oculto');
    window.mapaEleitoral = { estado, get resumos() { return resumos; }, get agregado() { return agregado; }, mapa };
  } catch (e) {
    console.error(e);
    telaCarregando.classList.add('erro');
    telaCarregando.querySelector('.spinner')?.remove();
    textoCarregando.innerHTML = `Não foi possível carregar o mapa: ${escaparHtml(e.message)}<br>`
      + 'Se a API do IBGE estiver bloqueada (CORS ou sem internet), rode <code>npm run baixar-malhas</code> e recarregue a página.';
  }
}

iniciar();
