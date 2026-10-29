// Desenho do mapa com D3 (projeção, camadas, zoom). Depende do d3 global.
/* global d3 */

export const LARGURA = 1000;
export const ALTURA = 1000;
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 80;
export const ZOOM_INICIAL = 1.6;
export const NIVEIS = ['municipio', 'estado', 'pais'];

/**
 * O GeoJSON do IBGE segue a RFC 7946 (anel externo anti-horário). O D3 usa
 * geometria esférica e espera o contrário: um anel "invertido" vira o
 * complemento do polígono (o globo inteiro menos o município). Se a área
 * esférica de um polígono passar de 2π (meia esfera), invertemos os anéis.
 */
export function corrigirOrientacao(colecao) {
  let invertidos = 0;
  const corrigirPoligono = (aneis) => {
    if (d3.geoArea({ type: 'Polygon', coordinates: aneis }) > 2 * Math.PI) {
      invertidos += 1;
      return aneis.map((anel) => anel.slice().reverse());
    }
    return aneis;
  };
  for (const f of colecao.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'Polygon') g.coordinates = corrigirPoligono(g.coordinates);
    else if (g.type === 'MultiPolygon') g.coordinates = g.coordinates.map(corrigirPoligono);
  }
  return invertidos;
}

export function criarMapa(svgEl, geo, eventos) {
  const svg = d3.select(svgEl);
  svg.selectAll('*').remove();

  const correcoes = {};
  for (const nivel of NIVEIS) correcoes[nivel] = corrigirOrientacao(geo[nivel]);

  const projecao = d3.geoMercator().fitExtent([[200, 200], [800, 800]], geo.pais);
  const caminho = d3.geoPath(projecao);

  const fundo = svg.append('rect')
    .attr('class', 'fundo')
    .attr('width', LARGURA)
    .attr('height', ALTURA);
  const raiz = svg.append('g').attr('class', 'raiz');

  const camadas = {};
  const indices = {};

  function desenharCamada(nivel) {
    const g = raiz.append('g').attr('class', `camada camada-${nivel}`);
    const indice = new Map();
    g.selectAll('path')
      .data(geo[nivel].features)
      .join('path')
      .attr('d', caminho) // calculado uma única vez
      .attr('data-cod', (d) => d.properties.codarea)
      .each(function (d) { indice.set(String(d.properties.codarea), { el: this, feature: d }); });

    // Eventos delegados: um ouvinte por camada, não por caminho.
    const codDe = (ev) => ev.target?.getAttribute?.('data-cod');
    g.on('mousemove', (ev) => {
      const cod = codDe(ev);
      if (cod) eventos.aoPassar?.(nivel, cod, ev);
    });
    g.on('mouseleave', () => eventos.aoSair?.());
    g.on('click', (ev) => {
      const cod = codDe(ev);
      if (!cod) return;
      ev.stopPropagation();
      eventos.aoClicar?.(nivel, cod, ev);
    });

    camadas[nivel] = g;
    indices[nivel] = indice;
  }

  desenharCamada('municipio');
  // Divisas estaduais por cima dos municípios.
  const contornos = raiz.append('g').attr('class', 'contornos');
  contornos.selectAll('path').data(geo.estado.features).join('path').attr('d', caminho);
  desenharCamada('estado');
  desenharCamada('pais');

  // Cliques em regiões param a propagação; o que chega ao SVG é fundo
  // (inclusive as faixas laterais fora da viewBox).
  svg.on('click', () => eventos.aoClicarFundo?.());

  const zoom = d3.zoom()
    .scaleExtent([ZOOM_MIN, ZOOM_MAX])
    .translateExtent([[0, 0], [LARGURA, ALTURA]])
    .on('zoom', (ev) => {
      raiz.attr('transform', ev.transform);
      eventos.aoZoom?.(ev.transform.k);
    });
  svg.call(zoom);

  const centro = (k, cx = LARGURA / 2, cy = ALTURA / 2) =>
    d3.zoomIdentity.translate(LARGURA / 2, ALTURA / 2).scale(k).translate(-cx, -cy);
  const transformInicial = centro(ZOOM_INICIAL);
  svg.call(zoom.transform, transformInicial);

  return {
    correcoes,
    indices,
    ativarNivel(nivel) {
      for (const n of NIVEIS) camadas[n].classed('ativa', n === nivel);
      contornos.classed('ativa', nivel === 'municipio');
    },
    colorir(nivel, corDe) {
      camadas[nivel].selectAll('path').attr('fill', (d) => corDe(String(d.properties.codarea)));
    },
    selecionar(nivel, cod) {
      raiz.selectAll('path.selecionado').classed('selecionado', false);
      const item = nivel && cod != null ? indices[nivel]?.get(String(cod)) : null;
      if (item) d3.select(item.el).classed('selecionado', true).raise();
    },
    /** Aproxima até a região. kMin garante um zoom mínimo (ex.: ver municípios). */
    focar(nivel, cod, kMin = ZOOM_MIN, kMax = ZOOM_MAX) {
      const item = indices[nivel]?.get(String(cod));
      if (!item) return false;
      const [[x0, y0], [x1, y1]] = caminho.bounds(item.feature);
      const ajuste = 0.85 / Math.max((x1 - x0) / LARGURA, (y1 - y0) / ALTURA);
      const k = Math.min(kMax, Math.max(kMin, ajuste));
      svg.transition().duration(750).call(zoom.transform, centro(k, (x0 + x1) / 2, (y0 + y1) / 2));
      return true;
    },
    aproximar() { svg.transition().duration(350).call(zoom.scaleBy, 1.6); },
    afastar() { svg.transition().duration(350).call(zoom.scaleBy, 1 / 1.6); },
    restaurar() { svg.transition().duration(750).call(zoom.transform, transformInicial); },
    zoomAtual() { return d3.zoomTransform(svgEl).k; },
  };
}
