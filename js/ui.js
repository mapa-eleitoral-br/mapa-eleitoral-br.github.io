// Tooltip, painel, legenda, badges e faixa de fonte dos dados.
import { NOMES } from './stats.js';
import { MATRIZ_BIVARIADA } from './scales.js';

const ENTIDADES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escaparHtml(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ENTIDADES[c]);
}

const fmtInteiro = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const fmtDecimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDecimal1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const fmtVotos = (x) => fmtInteiro.format(Math.round(x));
export const fmtPct = (x) => `${fmtDecimal.format(x)}%`;
const comSinal = (x, fmt) => (x > 0 ? `+${fmt(x)}` : x < 0 ? `−${fmt(-x)}` : fmt(0));

export const NOMES_NIVEL = { pais: 'País', estado: 'Estado', municipio: 'Município' };
export const NOMES_CATEGORIA = {
  flavio: 'Flávio Bolsonaro',
  lula: 'Lula',
  nulos: 'Nulos',
  comparar: 'Vantagem Flávio × Lula',
  bivariado: 'Bivariado Flávio × Lula',
};
export const NOMES_METRICA = { absoluto: 'votos absolutos', percentual: 'percentual do total' };

function textoVencedor(r) {
  if (r.vencedor === 'f') return `<span class="cor-f">Flávio Bolsonaro</span>`;
  if (r.vencedor === 'l') return `<span class="cor-l">Lula</span>`;
  if (r.vencedor === 'empate') return 'Empate entre Flávio e Lula';
  return 'Sem votos registrados';
}

/**
 * HTML com o resumo completo de uma região (usado no tooltip e no painel).
 * `r` vem de stats.resumir().
 */
export function htmlResumo({ titulo, subtitulo, r, notas = [] }) {
  if (!r) {
    return `<h3>${escaparHtml(titulo)}</h3>
      <div class="sub">${escaparHtml(subtitulo)}</div>
      <p>Sem dados para esta região.</p>`;
  }
  const linha = (k, cls = '') => `
    <tr class="${cls}">
      <td class="cor-${k}">${escaparHtml(NOMES[k])}</td>
      <td class="num">${fmtVotos(r.votos[k])}</td>
      <td class="num">${fmtPct(r.pct[k])}</td>
    </tr>`;

  return `
    <h3>${escaparHtml(titulo)}</h3>
    <div class="sub">${escaparHtml(subtitulo)}</div>
    <table class="tabela">
      <tr><th>Categoria</th><th class="num">Votos</th><th class="num">% do total</th></tr>
      ${linha('f')}${linha('l')}${linha('n')}${linha('b')}${linha('o')}
      <tr class="destaque"><td>Total considerado</td><td class="num">${fmtVotos(r.total)}</td><td class="num">100,00%</td></tr>
      <tr class="extra"><td>% dos válidos</td><td class="num" colspan="2">Flávio ${fmtPct(r.pctValidos.f)} · Lula ${fmtPct(r.pctValidos.l)}${r.votos.o ? ` · Outros ${fmtPct(r.pctValidos.o)}` : ''}</td></tr>
      <tr><td>Diferença Flávio − Lula</td><td class="num">${comSinal(r.diferenca, fmtVotos)}</td><td class="num">${comSinal(r.diferencaPP, fmtDecimal.format)} p.p.</td></tr>
    </table>
    <div class="vencedor">Mais votado: ${textoVencedor(r)}</div>
    ${notas.map((n) => `<p class="dica">${escaparHtml(n)}</p>`).join('')}`;
}

/* ---------------- Tooltip ---------------- */

export function mostrarTooltip(el, html, ev, container) {
  el.innerHTML = html;
  el.hidden = false;
  const caixa = container.getBoundingClientRect();
  const largura = el.offsetWidth;
  const altura = el.offsetHeight;
  let x = ev.clientX - caixa.left + 14;
  let y = ev.clientY - caixa.top + 14;
  if (x + largura > caixa.width - 4) x = ev.clientX - caixa.left - largura - 14;
  if (y + altura > caixa.height - 4) y = Math.max(4, caixa.height - altura - 4);
  el.style.left = `${Math.max(4, x)}px`;
  el.style.top = `${y}px`;
}

export function esconderTooltip(el) {
  el.hidden = true;
}

/* ---------------- Legenda ---------------- */

function fmtLimite(x, metrica) {
  return metrica === 'percentual' ? `${fmtDecimal1.format(x)}%` : fmtVotos(x);
}

export function renderizarLegenda(el, escala) {
  if (!escala) {
    el.innerHTML = '<p class="dica">Sem dados.</p>';
    return;
  }
  const { metrica, nivel } = escala;
  const base = nivel === 'pais'
    ? `Escala fixa de 0 a ${metrica === 'percentual' ? '100%' : 'total de votos do país'}`
    : `Quantis por ${NOMES_NIVEL[nivel].toLowerCase()}`;

  if (escala.tipo === 'classes') {
    const linhas = escala.classes.map((c, i) => {
      const ultimo = i === escala.classes.length - 1;
      const de = fmtLimite(c.de, metrica);
      const ate = fmtLimite(c.ate, metrica);
      const intervalo = ultimo ? `${de} a ${ate}` : `${de} a menos de ${ate}`;
      return `<div class="legenda-linha"><span class="legenda-cor" style="background:${c.cor}"></span>${escaparHtml(intervalo)}</div>`;
    }).join('');
    el.innerHTML = `
      <div class="legenda-titulo">${escaparHtml(NOMES[escala.chave])} · ${escaparHtml(NOMES_METRICA[metrica])}</div>
      ${linhas}
      <div class="legenda-linha"><span class="legenda-cor" style="background:#e4e6ea"></span>Sem dados</div>
      <p class="dica">${escaparHtml(base)}.</p>`;
    return;
  }

  if (escala.tipo === 'divergente') {
    // Os limites são iguais dos dois lados: uma linha por faixa de vantagem.
    const azuis = escala.classes.filter((c) => c.lider === 'f').reverse();
    const vermelhos = escala.classes.filter((c) => c.lider === 'l');
    const unidade = metrica === 'percentual' ? ' p.p.' : ' votos';
    const num = (x) => (metrica === 'percentual' ? fmtDecimal1.format(x).replace(',0', '') : fmtVotos(x));
    const linhas = azuis.map((c, i) => {
      const faixa = c.ate == null ? `${num(c.de)}${unidade} ou mais` : `${num(c.de)} a ${num(c.ate)}${unidade}`;
      return `<tr><td><span class="legenda-cor" style="background:${c.cor}"></span></td>
        <td class="faixa">${escaparHtml(faixa)}</td>
        <td><span class="legenda-cor" style="background:${vermelhos[i].cor}"></span></td></tr>`;
    }).join('');
    const explica = metrica === 'percentual'
      ? 'Vantagem em pontos percentuais sobre o total considerado. Limites fixos.'
      : `Vantagem em votos (Flávio − Lula). ${nivel === 'pais' ? 'Limites proporcionais ao total do país' : `Limites por quantis por ${NOMES_NIVEL[nivel].toLowerCase()}`}.`;
    el.innerHTML = `
      <div class="legenda-titulo">Quem ficou à frente e por quanto · ${escaparHtml(NOMES_METRICA[metrica])}</div>
      <table class="legenda-divergente">
        <tr><th class="cor-f">Flávio</th><th>vantagem</th><th class="cor-l">Lula</th></tr>
        ${linhas}
      </table>
      <div class="legenda-linha"><span class="legenda-cor" style="background:#e4e6ea"></span>Sem dados</div>
      <p class="dica">${escaparHtml(explica)}</p>`;
    return;
  }

  // Bivariada: linha de cima = Lula alto.
  const celulas = [];
  for (let j = 2; j >= 0; j -= 1) {
    for (let i = 0; i <= 2; i += 1) {
      celulas.push(`<span style="background:${MATRIZ_BIVARIADA[j][i]}" title="Flávio ${['baixo', 'médio', 'alto'][i]}, Lula ${['baixo', 'médio', 'alto'][j]}"></span>`);
    }
  }
  const limites = (l) => `baixo &lt; ${fmtLimite(l[0], metrica)} ≤ médio &lt; ${fmtLimite(l[1], metrica)} ≤ alto`;
  el.innerHTML = `
    <div class="legenda-titulo">Flávio × Lula · ${escaparHtml(NOMES_METRICA[metrica])}</div>
    <div class="bivariada">
      <div class="bivariada-eixo-y">Lula →</div>
      <div class="bivariada-grade">${celulas.join('')}</div>
      <div class="bivariada-eixo-x">Flávio →</div>
    </div>
    <div class="bivariada-limites">
      <div><span class="cor-f">Flávio</span>: ${limites(escala.limitesF)}</div>
      <div><span class="cor-l">Lula</span>: ${limites(escala.limitesL)}</div>
    </div>
    <p class="dica">Tercis independentes. ${escaparHtml(base)}.</p>`;
}

/* ---------------- Badges e faixa de fonte ---------------- */

export function atualizarBadges({ elNivel, elModo }, { nivel, automatico, categoria, metrica }) {
  elNivel.textContent = `Nível: ${NOMES_NIVEL[nivel]}${automatico ? ' (automático)' : ''}`;
  elModo.textContent = `Modo: ${NOMES_CATEGORIA[categoria]} · ${NOMES_METRICA[metrica]}`;
}

function htmlSelo(v) {
  const data = new Date(v.conferidoEm).toLocaleDateString('pt-BR');
  const ok = v.ok && v.divergencias.length === 0;
  return `<div class="selo ${ok ? 'ok' : 'falha'}">${ok ? '✓' : '✗'} <strong>Conferido com o TSE</strong> em ${escaparHtml(data)}: `
    + `${fmtVotos(v.municipiosIdenticos)} de ${fmtVotos(v.municipiosTse)} municípios idênticos ao `
    + '<a href="https://resultados.tse.jus.br/" target="_blank" rel="noopener">site de resultados do TSE</a>. '
    + '<a href="data/validacao.json" target="_blank" rel="noopener">Ver relatório</a>.</div>';
}

export function atualizarFaixaFonte(el, marcaSimulacao, { tipo, meta, mensagem, validacao }) {
  el.className = `faixa-fonte ${tipo}`;
  const partes = [];
  if (tipo === 'oficial' && validacao) partes.push(htmlSelo(validacao));
  if (tipo === 'simulado') {
    partes.push('<strong>SIMULAÇÃO.</strong> Os votos por município são fictícios e não representam o resultado da eleição.');
  } else if (tipo === 'oficial') {
    partes.push(`<strong>Dados carregados.</strong> Fonte: ${escaparHtml(meta?.fonte)}.`);
    if (meta?.descricao) partes.push(escaparHtml(meta.descricao));
  } else {
    partes.push('<strong>Erro nos dados.</strong> Exibindo SIMULAÇÃO com votos fictícios.');
  }
  if (mensagem) partes.push(escaparHtml(mensagem));
  if (tipo === 'simulado' && meta?.fonte) partes.push(`<span class="dica">${escaparHtml(meta.fonte)}</span>`);
  el.innerHTML = partes.join(' ');
  marcaSimulacao.hidden = tipo === 'oficial';
}
