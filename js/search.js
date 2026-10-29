// Busca de municípios com sugestões (sem acento, sem diferenciar maiúsculas).
import { escaparHtml } from './ui.js';

export function normalizar(texto) {
  return String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const MAX_SUGESTOES = 8;

/**
 * Liga a busca a um <input> e a uma <ul> de sugestões.
 * itens: [{ cod, nome, uf, ufNome }]; aoEscolher(cod) é chamado na escolha.
 */
export function criarBusca({ input, lista, itens, aoEscolher }) {
  const siglas = new Set(itens.map((i) => i.uf.toLowerCase()));
  const indice = itens.map((i) => ({ ...i, chave: normalizar(i.nome) }));
  let sugestoes = [];
  let ativo = -1;

  function buscar(texto) {
    const r = buscarCom(texto, true);
    return r.length ? r : buscarCom(texto, false);
  }

  function buscarCom(texto, usarUf) {
    let q = normalizar(texto);
    if (!q) return [];
    // "jaragua sc" ou "jaraguá - SC": a última palavra pode ser a UF.
    let uf = null;
    const partes = q.split(' ');
    if (usarUf && partes.length > 1 && siglas.has(partes[partes.length - 1])) {
      uf = partes.pop().toUpperCase();
      q = partes.join(' ');
    }
    const resultado = [];
    for (const item of indice) {
      if (uf && item.uf !== uf) continue;
      let nota = -1;
      if (item.chave === q) nota = 0;
      else if (item.chave.startsWith(q)) nota = 1;
      else if (item.chave.includes(` ${q}`)) nota = 2;
      else if (item.chave.includes(q)) nota = 3;
      if (nota >= 0) resultado.push({ item, nota });
    }
    resultado.sort((a, b) => a.nota - b.nota || a.item.chave.localeCompare(b.item.chave) || a.item.uf.localeCompare(b.item.uf));
    return resultado.slice(0, MAX_SUGESTOES).map((r) => r.item);
  }

  function fechar() {
    lista.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    ativo = -1;
  }

  function marcarAtivo(i) {
    ativo = i;
    [...lista.children].forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
    if (i >= 0) input.setAttribute('aria-activedescendant', `busca-op-${i}`);
  }

  function renderizar() {
    sugestoes = buscar(input.value);
    if (!input.value.trim()) { fechar(); return; }
    lista.innerHTML = sugestoes.length
      ? sugestoes.map((s, i) => `<li id="busca-op-${i}" role="option" data-cod="${s.cod}" aria-selected="false">
          <span class="busca-nome">${escaparHtml(s.nome)}</span> <span class="busca-uf">${escaparHtml(s.uf)}</span></li>`).join('')
      : '<li class="busca-vazio" role="option" aria-disabled="true">Nenhum município encontrado</li>';
    lista.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    marcarAtivo(sugestoes.length ? 0 : -1);
  }

  function escolher(i) {
    const s = sugestoes[i];
    if (!s) return;
    input.value = `${s.nome} (${s.uf})`;
    fechar();
    input.blur();
    aoEscolher(s.cod);
  }

  input.addEventListener('input', renderizar);
  input.addEventListener('focus', () => { if (input.value.trim()) renderizar(); });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' && sugestoes.length) {
      ev.preventDefault();
      if (lista.hidden) renderizar();
      marcarAtivo((ativo + 1) % sugestoes.length);
    } else if (ev.key === 'ArrowUp' && sugestoes.length) {
      ev.preventDefault();
      marcarAtivo((ativo - 1 + sugestoes.length) % sugestoes.length);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      if (lista.hidden) renderizar();
      escolher(ativo >= 0 ? ativo : 0);
    } else if (ev.key === 'Escape') {
      fechar();
    }
  });
  // mousedown (e não click) para escolher antes de o input perder o foco.
  lista.addEventListener('mousedown', (ev) => {
    const li = ev.target.closest('li[data-cod]');
    if (!li) return;
    ev.preventDefault();
    escolher([...lista.children].indexOf(li));
  });
  input.addEventListener('blur', () => setTimeout(fechar, 100));

  return { buscar };
}
