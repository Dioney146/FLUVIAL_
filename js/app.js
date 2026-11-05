// =====================================================================
//  app.js — interface do Controle Fluvial
// =====================================================================
import * as XLSX from 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';
import {
  analisar, lerBasePedidos, lerPlanilhaPortos, criarResolvedorCidade, pontuaMunicipio,
  STATUS, STATUS_PENDENTES, CARGA_RDW, CARGA_DP, SEM_CARGA, EMBARCACOES_SEED,
  chave, norm, fmtData, fromISO,
} from './core.js';
import * as store from './store.js';

// ------------------------------------------------------------------ estado
const E = {
  dados: { pedidos: [], portos: [], ajustes: [], embarcacoes: [], mapeamento: [], importacoes: [] },
  linhas: [],
  naoMapeadas: [],
  selecionados: new Set(),
  editando: null,
  msgVendedor: null,
};

// ------------------------------------------------------------------ utilidades
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (v) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const int = (v) => (v || 0).toLocaleString('pt-BR');
const soma = (arr, f) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
const unicos = (arr) => [...new Set(arr)];
const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const ehPendente = (l) => STATUS_PENDENTES.includes(l.status);

function toast(msg, erro = false, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast on' + (erro ? ' erro' : '');
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.className = 'toast'), ms);
}
async function ocupado(txt, fn) {
  $('#carregando-txt').textContent = txt;
  $('#carregando').hidden = false;
  try { return await fn(); }
  catch (e) { console.error(e); toast(e.message || String(e), true, 6000); }
  finally { $('#carregando').hidden = true; }
}
function cargaBadge(c) {
  const cls = c === CARGA_RDW ? 'rdw' : c === CARGA_DP ? 'dp' : 'sem';
  return `<span class="badge ${cls}">${esc(c)}</span>`;
}
function statusBadge(s) {
  const cls = s === STATUS.COMPLETO ? 'completo' : s === STATUS.CONFERIR ? 'conferir' : 'pendente';
  const txt = s === STATUS.CONFERIR ? 'A CONFERIR' : s;
  return `<span class="st ${cls}">${esc(txt)}</span>`;
}
function preencherSelect(sel, valores, primeiro, rotulo = (v) => v) {
  const atual = sel.value;
  sel.innerHTML = `<option value="">${esc(primeiro)}</option>` + valores.map((v) => `<option value="${esc(v)}">${esc(rotulo(v))}</option>`).join('');
  if (valores.includes(atual)) sel.value = atual;
}

// ------------------------------------------------------------------ dados
async function recarregar() {
  E.dados = await store.carregarTudo();
  reanalisar();
}
function reanalisar() {
  const d = E.dados;
  const ajustes = new Map(d.ajustes.map((a) => [Number(a.numped), a]));
  const mapeamento = new Map(d.mapeamento.map((m) => [m.cidade, m]));
  const r = analisar(d.pedidos, d.portos, { ajustes, embarcacoes: d.embarcacoes.map((e) => e.nome), mapeamento });
  E.linhas = r.linhas;
  E.naoMapeadas = r.naoMapeadas;
  // remove da seleção pedidos que sumiram
  const nums = new Set(E.linhas.map((l) => l.numped));
  E.selecionados = new Set([...E.selecionados].filter((n) => nums.has(n)));
  renderTudo();
}

// ------------------------------------------------------------------ abas
function irPara(aba) {
  $$('#abas button').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === aba));
  $$('.aba').forEach((s) => (s.hidden = s.id !== `aba-${aba}`));
  history.replaceState(null, '', `#${aba}`);
}

function renderTudo() {
  const pend = E.linhas.filter(ehPendente).length;
  $('#cont-pend').textContent = pend;
  $('#cont-pend').hidden = !pend;
  $('#cont-mun').textContent = E.naoMapeadas.length;
  $('#cont-mun').hidden = !E.naoMapeadas.length;
  const nomesEmb = unicos([...EMBARCACOES_SEED, ...E.dados.embarcacoes.map((e) => e.nome)].map((n) => n.toUpperCase())).sort();
  $('#lista-embarcacoes').innerHTML = nomesEmb.map((n) => `<option value="${esc(n)}">`).join('');
  renderPainel();
  renderFiltrosPend();
  renderPendencias();
  renderFiltrosMont();
  renderMontagem();
  renderMunicipios();
  renderImportar();
}

// ================================================================== PAINEL
function renderPainel() {
  const L = E.linhas;
  const semBase = !E.dados.pedidos.length || !E.dados.portos.length;
  $('#painel-vazio').hidden = !semBase;
  $('#painel-conteudo').hidden = semBase;
  if (semBase) {
    $('#painel-vazio p').textContent = !E.dados.pedidos.length && !E.dados.portos.length
      ? 'Importe a base de pedidos e a planilha de municípios e portos para começar.'
      : !E.dados.pedidos.length ? 'Falta importar a base de pedidos.' : 'Falta importar a planilha de municípios e portos.';
    return;
  }
  const ult = (t) => E.dados.importacoes.find((i) => i.tipo === t);
  const up = ult('pedidos'), uo = ult('portos');
  $('#info-base').innerHTML = `
    <span>Base de pedidos: <b>${int(E.dados.pedidos.length)} pedidos</b>${up ? ` · ${esc(up.arquivo || '')} · ${dataHora(up.criado_em)}` : ''}</span>
    <span>Portos: <b>${int(E.dados.portos.length)} municípios</b>${uo ? ` · ${dataHora(uo.criado_em)}` : ''}</span>`;

  const pend = L.filter(ehPendente), conf = L.filter((l) => l.status === STATUS.CONFERIR), ok = L.filter((l) => l.status === STATUS.COMPLETO);
  const vendPend = unicos(pend.map((l) => l.vendedor));
  $('#kpis').innerHTML = [
    ['Pedidos fluviais', int(L.length), `${unicos(L.map((l) => chave(l.cidade))).length} municípios`, '', ''],
    ['Pendentes', int(pend.length), 'sem embarcação e/ou data', 'erro', 'pendentes'],
    ['A conferir', int(conf.length), 'informação deduzida', 'atencao', STATUS.CONFERIR],
    ['Completos', int(ok.length), `${L.length ? Math.round((ok.length / L.length) * 100) : 0}% do total`, 'ok', STATUS.COMPLETO],
    ['Vendedores a acionar', int(vendPend.length), 'com pedido pendente', vendPend.length ? 'erro' : 'ok', ''],
    ['Valor fluvial', brl(soma(L, (l) => l.valor)), `${int(soma(L, (l) => l.qtd_itens))} itens`, '', ''],
  ].map(([t, v, s, cls, f]) => `<div class="kpi ${cls}" ${f ? `data-filtro="${esc(f)}"` : ''}><span>${t}</span><strong>${v}</strong><small>${s}</small></div>`).join('');

  const cargas = [CARGA_RDW, CARGA_DP, ...(L.some((l) => l.carga === SEM_CARGA) ? [SEM_CARGA] : [])];
  $('#cartoes-carga').innerHTML = `<div class="cartao-topo"><h3>Por carga</h3></div><div class="cargas">` + cargas.map((c) => {
    const x = L.filter((l) => l.carga === c);
    const cls = c === CARGA_RDW ? 'rdw' : c === CARGA_DP ? 'dp' : 'sem';
    return `<div class="carga-box ${cls}"><h4>${esc(c)}</h4><dl>
      <dt>Pedidos</dt><dd>${int(x.length)}</dd>
      <dt>Municípios</dt><dd>${unicos(x.map((l) => chave(l.cidade))).length}</dd>
      <dt>Embarcações</dt><dd>${unicos(x.filter((l) => l.embarcacao).map((l) => l.embarcacao)).length}</dd>
      <dt>Valor</dt><dd>${brl(soma(x, (l) => l.valor))}</dd>
      <dt>Pendentes</dt><dd style="color:var(--erro)">${x.filter(ehPendente).length}</dd>
      <dt>A conferir</dt><dd style="color:var(--atencao)">${x.filter((l) => l.status === STATUS.CONFERIR).length}</dd>
    </dl></div>`;
  }).join('') + '</div>';

  // vendedores
  const porVend = new Map();
  for (const l of L) {
    if (l.status === STATUS.COMPLETO) continue;
    const v = porVend.get(l.vendedor) || { vendedor: l.vendedor, p: 0, c: 0 };
    ehPendente(l) ? v.p++ : v.c++;
    porVend.set(l.vendedor, v);
  }
  const vs = [...porVend.values()].sort((a, b) => b.p - a.p || b.c - a.c);
  const max = Math.max(1, ...vs.map((v) => v.p + v.c));
  $('#tabela-vendedores').innerHTML = vs.length ? `<div class="barra-lista">` + vs.map((v) => `
    <div class="barra-item">
      <span class="nome" title="${esc(v.vendedor)}">${esc(v.vendedor)}</span>
      <div class="barra"><i class="erro" style="width:${(v.p / max) * 100}%"></i><i class="atencao" style="width:${(v.c / max) * 100}%"></i></div>
      <span><span class="num" style="color:var(--erro)">${v.p}</span> · <span class="num" style="color:var(--atencao)">${v.c}</span>
        <button class="btn mini" data-msg-vend="${esc(v.vendedor)}">Mensagem</button></span>
    </div>`).join('') + `</div><p class="sub" style="margin:12px 0 0"><span style="color:var(--erro)">■</span> pendentes · <span style="color:#e2a72e">■</span> a conferir</p>`
    : '<p class="sub">Nenhum vendedor a acionar. Tudo preenchido.</p>';

  // próximas saídas
  const comData = L.filter((l) => l.data_prevista && l.embarcacao);
  const grupos = new Map();
  for (const l of comData) {
    const k = `${l.data_prevista}|${l.embarcacao}|${l.carga}`;
    const g = grupos.get(k) || { data: l.data_prevista, emb: l.embarcacao, carga: l.carga, cidades: new Set(), n: 0, v: 0, conf: 0 };
    g.cidades.add(l.cidade); g.n++; g.v += l.valor || 0; if (l.status === STATUS.CONFERIR) g.conf++;
    grupos.set(k, g);
  }
  const gs = [...grupos.values()].sort((a, b) => a.data.localeCompare(b.data) || a.emb.localeCompare(b.emb));
  $('#proximas-saidas').innerHTML = gs.length ? `<div class="tabela-wrap"><table class="tabela compacta"><thead><tr>
      <th>Data</th><th>Embarcação</th><th>Carga</th><th>Municípios</th><th class="dir">Pedidos</th><th class="dir">Valor</th></tr></thead><tbody>` +
    gs.map((g) => `<tr><td class="num">${fmtData(g.data)}</td><td>${esc(g.emb)}${g.conf ? ` <span class="motivo" style="display:inline">· ${g.conf} a conferir</span>` : ''}</td>
      <td>${cargaBadge(g.carga)}</td><td>${esc([...g.cidades].join(', '))}</td><td class="dir num">${g.n}</td><td class="dir num">${brl(g.v)}</td></tr>`).join('') +
    `</tbody></table></div>` : '<p class="sub">Nenhum pedido com embarcação e data ainda.</p>';
}

// ================================================================== PENDÊNCIAS
function renderFiltrosPend() {
  const L = E.linhas;
  preencherSelect($('#f-vendedor'), unicos(L.map((l) => l.vendedor)).sort(), 'Todos os vendedores');
  preencherSelect($('#f-municipio'), unicos(L.map((l) => l.cidade)).sort(), 'Todos os municípios');
  preencherSelect($('#f-carga'), unicos(L.map((l) => l.carga)).sort(), 'Todas as cargas');
  const st = $('#f-status');
  if (!st.dataset.pronto) {
    st.insertAdjacentHTML('beforeend', Object.values(STATUS).map((s) => `<option value="${esc(s)}">Só: ${s === STATUS.CONFERIR ? 'A CONFERIR' : s}</option>`).join(''));
    st.dataset.pronto = 1;
  }
}
function filtrarPend() {
  const busca = norm($('#f-busca').value);
  const v = $('#f-vendedor').value, m = $('#f-municipio').value, c = $('#f-carga').value, s = $('#f-status').value;
  return E.linhas.filter((l) => {
    if (v && l.vendedor !== v) return false;
    if (m && l.cidade !== m) return false;
    if (c && l.carga !== c) return false;
    if (s === 'pendentes' && !ehPendente(l)) return false;
    if (s === 'atencao' && l.status === STATUS.COMPLETO) return false;
    if (s && !['pendentes', 'atencao'].includes(s) && l.status !== s) return false;
    if (busca && !norm(`${l.numped} ${l.cliente} ${l.obs_texto} ${l.embarcacao}`).includes(busca)) return false;
    return true;
  });
}
function renderPendencias() {
  const L = E.linhas;
  const cont = (f) => L.filter(f).length;
  const s = $('#f-status').value;
  $('#chips-status').innerHTML = [
    ['pendentes', 'Pendentes', cont(ehPendente)],
    [STATUS.SEM_AMBOS, 'Sem embarcação e data', cont((l) => l.status === STATUS.SEM_AMBOS)],
    [STATUS.SEM_EMB, 'Sem embarcação', cont((l) => l.status === STATUS.SEM_EMB)],
    [STATUS.SEM_DATA, 'Sem data', cont((l) => l.status === STATUS.SEM_DATA)],
    [STATUS.CONFERIR, 'A conferir', cont((l) => l.status === STATUS.CONFERIR)],
    [STATUS.COMPLETO, 'Completos', cont((l) => l.status === STATUS.COMPLETO)],
    ['', 'Todos', L.length],
  ].map(([v, t, n]) => `<button class="chip ${s === v ? 'ativo' : ''}" data-chip="${esc(v)}">${t} <b>${n}</b></button>`).join('');

  const rows = filtrarPend();
  const todosSel = rows.length && rows.every((l) => E.selecionados.has(l.numped));
  const tab = $('#tabela-pend');
  if (!rows.length) {
    tab.innerHTML = `<tbody><tr><td class="vazio-tab">${L.length ? 'Nenhum pedido com esses filtros. 🎉' : 'Importe as bases para ver os pedidos.'}</td></tr></tbody>`;
  } else {
    tab.innerHTML = `<thead><tr>
      <th><input type="checkbox" id="sel-todos" ${todosSel ? 'checked' : ''} /></th>
      <th>Pedido</th><th>Cliente</th><th>Município / carga</th><th>Vendedor</th><th>Embarcação</th><th>Data</th><th>Status</th><th>OBS do vendedor</th><th></th>
    </tr></thead><tbody>` + rows.map((l) => {
      const cls = ehPendente(l) ? 'l-pendente' : l.status === STATUS.CONFERIR ? 'l-conferir' : '';
      const man = l.origem === 'manual' ? '<span class="manual" title="Ajustado manualmente">MANUAL</span>' : '';
      return `<tr class="${cls} ${E.selecionados.has(l.numped) ? 'sel' : ''}" data-num="${l.numped}">
        <td><input type="checkbox" data-sel="${l.numped}" ${E.selecionados.has(l.numped) ? 'checked' : ''} /></td>
        <td class="num">${l.numped}<div class="menor">${fmtData(l.data_pedido)} · ${brl(l.valor)}</div></td>
        <td><span class="cli">${esc(l.cliente)}</span><div class="menor">cód. ${esc(l.codcli ?? '')}</div></td>
        <td>${esc(l.cidade)}<div style="margin-top:3px">${cargaBadge(l.carga)}</div></td>
        <td class="menor" style="color:var(--tinta-2)">${esc(l.vendedor)}</td>
        <td>${l.embarcacao ? esc(l.embarcacao) + man : '<span class="falta">não informada</span>'}</td>
        <td class="num">${l.data_prevista ? fmtData(l.data_prevista) : '<span class="falta">não informada</span>'}</td>
        <td>${statusBadge(l.status)}${l.motivos.map((m) => `<span class="motivo">${esc(m)}</span>`).join('')}</td>
        <td class="obs">${esc(l.obs_texto) || '<span class="menor">— sem observação —</span>'}${l.ajuste_obs ? `<div class="menor">📝 ${esc(l.ajuste_obs)}</div>` : ''}</td>
        <td class="acoes">${l.status === STATUS.CONFERIR ? `<button class="btn mini" data-confirmar="${l.numped}" title="Aceitar embarcação e data como estão">✓</button> ` : ''}<button class="btn mini" data-editar="${l.numped}">Editar</button></td>
      </tr>`;
    }).join('') + '</tbody>';
  }
  renderLote();
}
function renderLote() {
  const n = E.selecionados.size;
  $('#lote').hidden = !n;
  $('#lote-qtd').textContent = `${n} selecionado${n > 1 ? 's' : ''}`;
}

// ------------------------------------------------------------------ edição
function linhaPorNum(n) { return E.linhas.find((l) => l.numped === Number(n)); }
function irmaosDe(l) { return E.linhas.filter((x) => x !== l && x.codcli === l.codcli && chave(x.cidade) === chave(l.cidade)); }

function realcarObs(texto, l) {
  let h = esc(texto || '— sem observação —');
  const termos = [...(l.embarcacao || '').split(' / '), l.data_origem].filter((t) => t && t.length > 2 && t !== 'BARCO DA VEZ');
  for (const t of termos) {
    const padrao = [...t].map((c) => {
      const b = norm(c);
      if (c === ' ' || c === ',') return '[\\s,]*';
      if (!b) return c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = { A: 'aáàâãAÁÀÂÃ', E: 'eéêEÉÊ', I: 'iíIÍ', O: 'oóôõOÓÔÕ', U: 'uúüUÚÜ', C: 'cçCÇ' }[b];
      return m ? `[${m}]` : /[A-Z]/.test(b) ? `[${b}${b.toLowerCase()}]` : b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    try { h = h.replace(new RegExp(padrao.replace(/\//g, '\\s*\\/\\s*'), 'g'), (m) => `<mark>${m}</mark>`); } catch { /* ignora */ }
  }
  return h;
}

function abrirEdicao(numped) {
  const l = linhaPorNum(numped);
  if (!l) return;
  E.editando = l;
  const f = $('#form-editar');
  $('#ed-titulo').textContent = `Pedido ${l.numped}`;
  $('#ed-info').innerHTML = `<span><b>${esc(l.cliente)}</b></span><span>${esc(l.cidade)} · ${cargaBadge(l.carga)}</span><span>Vendedor: <b>${esc(l.vendedor)}</b></span><span>${brl(l.valor)} · ${l.qtd_itens} itens</span>`;
  $('#ed-obs').innerHTML = realcarObs(l.obs_texto, l);
  const multipla = (l.embarcacao || '').includes(' / ');
  f.embarcacao.value = multipla || l.embarcacao === 'BARCO DA VEZ' ? '' : l.embarcacao;
  f.embarcacao.placeholder = multipla ? `Escolha: ${l.embarcacao}` : 'Ex.: DONA SULA';
  f.data_prevista.value = l.data_prevista || '';
  f.observacao.value = l.ajuste_obs || '';
  const irm = irmaosDe(l);
  f.cliente_todo.closest('label').hidden = !irm.length;
  f.cliente_todo.checked = true;
  f.cliente_todo.nextSibling.textContent = ` Aplicar também aos outros ${irm.length} pedido(s) deste cliente na mesma cidade`;
  $('#ed-remover').hidden = l.origem !== 'manual';
  $('#modal-editar').showModal();
  setTimeout(() => f.embarcacao.focus(), 50);
}

async function salvarEdicao(e) {
  e.preventDefault();
  if (e.submitter?.value === 'cancel') return $('#modal-editar').close();
  const f = $('#form-editar');
  const l = E.editando;
  const dados = { embarcacao: f.embarcacao.value, data_prevista: f.data_prevista.value, observacao: f.observacao.value };
  if (!dados.embarcacao && !dados.data_prevista && !dados.observacao) return toast('Informe a embarcação e/ou a data.', true);
  // campo vazio mantém o valor lido da OBS (se houver)
  if (!dados.embarcacao && l.embarcacao && !l.embarcacao.includes(' / ') && l.embarcacao !== 'BARCO DA VEZ') dados.embarcacao = l.embarcacao;
  if (!dados.data_prevista && l.data_prevista) dados.data_prevista = l.data_prevista;
  const alvos = [l, ...(f.cliente_todo.checked && !f.cliente_todo.closest('label').hidden ? irmaosDe(l) : [])];
  $('#modal-editar').close();
  await ocupado('Salvando…', async () => {
    for (const a of alvos) await store.salvarAjuste(a.numped, dados);
    await recarregar();
    toast(`${alvos.length} pedido(s) atualizado(s).`);
  });
}

async function confirmar(nums) {
  const alvos = nums.map(linhaPorNum).filter(Boolean);
  const multiplas = alvos.filter((l) => (l.embarcacao || '').includes(' / '));
  if (multiplas.length === 1 && alvos.length === 1) return abrirEdicao(multiplas[0].numped);
  const validos = alvos.filter((l) => l.embarcacao && l.data_prevista && !l.embarcacao.includes(' / '));
  if (!validos.length) return toast('Nada para confirmar: os pedidos precisam ter uma única embarcação e uma data.', true);
  await ocupado('Confirmando…', async () => {
    for (const l of validos) await store.salvarAjuste(l.numped, { embarcacao: l.embarcacao, data_prevista: l.data_prevista, observacao: l.ajuste_obs });
    await recarregar();
    const pulados = alvos.length - validos.length;
    toast(`${validos.length} confirmado(s).${pulados ? `\n${pulados} ignorado(s): sem data, sem embarcação ou com mais de uma embarcação.` : ''}`);
  });
}

async function aplicarLote() {
  const emb = $('#lote-emb').value.trim(), data = $('#lote-data').value;
  if (!emb && !data) return toast('Informe a embarcação e/ou a data para aplicar.', true);
  const alvos = [...E.selecionados].map(linhaPorNum).filter(Boolean);
  await ocupado('Aplicando…', async () => {
    for (const l of alvos) {
      await store.salvarAjuste(l.numped, {
        embarcacao: emb || (l.embarcacao && !l.embarcacao.includes(' / ') ? l.embarcacao : ''),
        data_prevista: data || l.data_prevista || '',
        observacao: l.ajuste_obs,
      });
    }
    E.selecionados.clear();
    $('#lote-emb').value = ''; $('#lote-data').value = '';
    await recarregar();
    toast(`${alvos.length} pedido(s) atualizado(s).`);
  });
}

// ------------------------------------------------------------------ mensagens
function abrirMensagens(vendedor = null) {
  E.msgVendedor = vendedor;
  renderMensagens();
  $('#modal-msg').showModal();
}
function renderMensagens() {
  const incluiConf = $('#msg-conferir').checked;
  const rows = E.linhas.filter((l) => (ehPendente(l) || (incluiConf && l.status === STATUS.CONFERIR)) && (!E.msgVendedor || l.vendedor === E.msgVendedor));
  const porVend = new Map();
  for (const l of rows) { if (!porVend.has(l.vendedor)) porVend.set(l.vendedor, []); porVend.get(l.vendedor).push(l); }
  const falta = (l) => {
    if (l.status === STATUS.SEM_AMBOS) return 'falta embarcação e data de embarque';
    if (l.status === STATUS.SEM_EMB) return `falta embarcação${l.data_prevista ? ` (data: ${fmtData(l.data_prevista)})` : ''}`;
    if (l.status === STATUS.SEM_DATA) return `falta data de embarque${l.embarcacao ? ` (embarcação: ${l.embarcacao})` : ''}`;
    return `confirmar: ${l.embarcacao} em ${fmtData(l.data_prevista)} — ${l.motivos.join('; ')}`;
  };
  const blocos = [...porVend.entries()].sort((a, b) => b[1].length - a[1].length).map(([v, ls]) => {
    const txt = `Olá! Pedidos para o interior (transporte fluvial) que precisam de informação para a roteirização:\n\n` +
      ls.map((l) => `• Ped. ${l.numped} — ${l.cliente} (${l.cidade}): ${falta(l)}`).join('\n') +
      `\n\nPor favor, informe o *nome da embarcação* e a *data de embarque* de cada pedido. Obrigado!`;
    return `<div class="msg-bloco"><header><strong>${esc(v)}</strong><span class="sub">${ls.length} pedido(s)</span><button class="btn mini" data-copiar>Copiar</button></header><pre>${esc(txt)}</pre></div>`;
  });
  $('#msg-lista').innerHTML = blocos.join('') || '<p class="sub" style="margin-top:14px">Nenhuma pendência para enviar.</p>';
}

// ================================================================== MONTAGEM
function renderFiltrosMont() {
  const L = E.linhas;
  preencherSelect($('#m-carga'), unicos(L.map((l) => l.carga)).sort(), 'RDW e DP');
  const datas = unicos(L.map((l) => l.data_prevista || '__sem')).sort();
  preencherSelect($('#m-data'), datas, 'Todas as datas', (d) => (d === '__sem' ? 'Sem data' : fmtData(d)));
}
function filtrarMont() {
  const c = $('#m-carga').value, d = $('#m-data').value, s = $('#m-status').value, b = norm($('#m-busca').value);
  return E.linhas.filter((l) => {
    if (c && l.carga !== c) return false;
    if (d && (l.data_prevista || '__sem') !== d) return false;
    if (s === 'prontos' && ehPendente(l)) return false;
    if (s === 'pendentes' && !ehPendente(l)) return false;
    if (b && !norm(`${l.numped} ${l.cliente} ${l.cidade} ${l.embarcacao} ${l.vendedor}`).includes(b)) return false;
    return true;
  });
}
const ROTULO = {
  cidade: (v) => v,
  embarcacao: (v) => (v ? `⛴ ${v}` : '⚠ Sem embarcação'),
  data_prevista: (v) => (v ? `📅 ${fmtData(v)}` : '⚠ Sem data'),
};
function ordenarChave(campo, a, b) {
  if (campo === 'data_prevista') return (a || '9999').localeCompare(b || '9999');
  if (!a) return 1; if (!b) return -1;
  return a.localeCompare(b);
}
function renderGrupo(rows, niveis, abrir) {
  if (!niveis.length) {
    return `<div class="pedidos-lista">` + rows.sort((a, b) => a.cliente.localeCompare(b.cliente)).map((l) => `
      <div class="ped"><span class="num">${l.numped}</span>
        <span>${esc(l.cliente)} <span class="vend">· ${esc(l.vendedor)}</span></span>
        <span class="num">${brl(l.valor)}</span>${statusBadge(l.status)}</div>`).join('') + `</div>`;
  }
  const [campo, ...resto] = niveis;
  const grupos = new Map();
  for (const l of rows) { const k = l[campo] || ''; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(l); }
  return [...grupos.keys()].sort((a, b) => ordenarChave(campo, a, b)).map((k) => {
    const g = grupos.get(k);
    const pend = g.filter(ehPendente).length;
    const extra = campo === 'embarcacao' && k.includes(' / ') ? ' <span class="alerta-mini">· escolher uma</span>' : '';
    return `<details class="grupo" ${abrir ? 'open' : ''}><summary>${esc(ROTULO[campo](k))}${extra}
      <span class="totais"><span><b>${g.length}</b> ped.</span><span><b>${brl(soma(g, (l) => l.valor))}</b></span>${pend ? `<span class="alerta-mini">${pend} pendente(s)</span>` : ''}</span></summary>
      ${renderGrupo(g, resto, false)}</details>`;
  }).join('');
}
function renderMontagem() {
  const rows = filtrarMont();
  const niveis = $('#m-agrupar').value.split(',');
  const cargas = [CARGA_RDW, CARGA_DP, SEM_CARGA].filter((c) => rows.some((l) => l.carga === c));
  const el = $('#montagem');
  el.classList.toggle('uma', cargas.length === 1);
  if (!rows.length) { el.innerHTML = `<div class="vazio" style="grid-column:1/-1"><p>Nenhum pedido para mostrar.</p></div>`; return; }
  el.innerHTML = cargas.map((c) => {
    const x = rows.filter((l) => l.carga === c);
    const cls = c === CARGA_RDW ? 'rdw' : c === CARGA_DP ? 'dp' : 'sem';
    return `<section class="col-carga ${cls}"><header><h3>${esc(c)}</h3>
      <span class="totais"><span><b>${unicos(x.map((l) => chave(l.cidade))).length}</b> municípios</span><span><b>${x.length}</b> pedidos</span><span><b>${brl(soma(x, (l) => l.valor))}</b></span><span><b>${int(soma(x, (l) => l.qtd_itens))}</b> itens</span></span></header>
      ${renderGrupo(x, niveis, true)}</section>`;
  }).join('');
}

// ================================================================== MUNICÍPIOS
function renderMunicipios() {
  const { portos, pedidos, mapeamento } = E.dados;
  // não mapeadas
  $('#nao-mapeadas-wrap').hidden = !E.naoMapeadas.length;
  $('#nao-mapeadas').innerHTML = E.naoMapeadas.map((n) => `
    <div class="nm-linha" data-cidade="${esc(n.cidade)}">
      <span><b>${esc(n.cidade)}</b> <span class="sub">· ${n.pedidos} pedido(s) · ${brl(n.valor)}</span></span>
      <select data-nm-carga><option value="${CARGA_RDW}">${CARGA_RDW}</option><option value="${CARGA_DP}">${CARGA_DP}</option><option value="IGNORAR">Não é fluvial (ignorar)</option></select>
      <input data-nm-porto placeholder="Porto (opcional)" />
      <button class="btn primario mini" data-nm-salvar>Salvar</button>
    </div>`).join('');

  // tabela de portos
  const contPorMun = new Map();
  for (const l of E.linhas) contPorMun.set(chave(l.municipio_planilha), (contPorMun.get(chave(l.municipio_planilha)) || 0) + 1);
  $('#portos-resumo').textContent = portos.length ? `${portos.filter((p) => p.carga === CARGA_RDW).length} RDW · ${portos.filter((p) => p.carga === CARGA_DP).length} DP` : '';
  $('#tabela-portos').innerHTML = portos.length ? `<thead><tr><th>Município</th><th>Porto</th><th>Carga</th><th class="dir">Pedidos</th></tr></thead><tbody>` +
    [...portos].sort((a, b) => a.carga.localeCompare(b.carga) || a.municipio.localeCompare(b.municipio)).map((p) => `
      <tr><td>${esc(p.municipio)}</td><td class="menor" style="color:var(--tinta-2)">${esc(p.porto)}</td><td>${cargaBadge(p.carga)}</td><td class="dir num">${contPorMun.get(chave(p.municipio)) || ''}</td></tr>`).join('') + '</tbody>'
    : `<tbody><tr><td class="vazio-tab">Importe a planilha de municípios e portos.</td></tr></tbody>`;

  // casamentos
  const res = criarResolvedorCidade(portos, new Map(mapeamento.map((m) => [m.cidade, m])));
  const cidades = unicos(pedidos.map((p) => p.cidade)).filter(Boolean);
  const casados = cidades.map((c) => ({ c, r: res(c) })).filter((x) => x.r && (x.r.carga || x.r.ignorado)).sort((a, b) => a.c.localeCompare(b.c));
  $('#casamentos').innerHTML = casados.length ? casados.map(({ c, r }) => {
    const aprox = r.manual ? '<span class="aprox" style="color:var(--rio);background:var(--rio-claro)">manual</span>'
      : r.score < 1 ? '<span class="aprox" title="Nomes parecidos (possível erro de digitação)">aproximado</span>'
      : r.score < 3 ? '<span class="aprox" style="color:var(--tinta-2);background:var(--linha-2)">abreviação</span>' : '';
    const desfazer = r.manual ? ` <button class="btn mini fantasma" data-desmapear="${esc(chave(c))}">desfazer</button>` : '';
    return `<div class="casa"><span>${esc(c)}</span><span class="seta">→</span><span>${r.ignorado ? '<span class="sub">ignorado</span>' : `${esc(r.municipio)} ${cargaBadge(r.carga)}`}</span><span>${aprox}${desfazer}</span></div>`;
  }).join('') : '<p class="sub">Importe as bases para ver os casamentos.</p>';

  // embarcações
  const doBanco = E.dados.embarcacoes.map((e) => e.nome.toUpperCase());
  const seedSo = EMBARCACOES_SEED.filter((s) => !doBanco.includes(s));
  $('#embarcacoes').innerHTML = [...doBanco.map((n) => `<span class="tag">${esc(n)}<button title="Remover" data-rm-emb="${esc(n)}">×</button></span>`),
    ...seedSo.map((n) => `<span class="tag seed" title="Embarcação padrão do sistema">${esc(n)}</span>`)].join('');
}

// ================================================================== IMPORTAR
function renderImportar() {
  const imp = E.dados.importacoes;
  const u = (t) => imp.find((i) => i.tipo === t);
  for (const t of ['pedidos', 'portos']) {
    const x = u(t);
    $(`#info-${t}`).textContent = x ? `Última: ${x.arquivo || ''} · ${x.linhas} linhas · ${dataHora(x.criado_em)}` : '';
  }
  $('#historico').innerHTML = imp.length ? `<div class="tabela-wrap"><table class="tabela compacta"><thead><tr><th>Quando</th><th>Tipo</th><th>Arquivo</th><th class="dir">Linhas</th><th>Usuário</th></tr></thead><tbody>` +
    imp.map((i) => `<tr><td class="num">${dataHora(i.criado_em)}</td><td>${i.tipo === 'pedidos' ? 'Base de pedidos' : 'Municípios e portos'}</td><td>${esc(i.arquivo || '')}</td><td class="dir num">${i.linhas}</td><td class="menor">${esc(i.usuario || '')}</td></tr>`).join('') +
    '</tbody></table></div>' : '<p class="sub">Nenhuma importação ainda.</p>';
}

async function lerArquivo(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true });
  return wb.SheetNames.map((n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }));
}

async function importar(tipo, file) {
  await ocupado(`Lendo ${file.name}…`, async () => {
    const abas = await lerArquivo(file);
    let resultado, erro;
    for (const linhas of abas) {
      try { resultado = tipo === 'pedidos' ? lerBasePedidos(linhas) : lerPlanilhaPortos(linhas); break; }
      catch (e) { erro = e; }
    }
    if (!resultado) throw erro || new Error('Arquivo sem dados.');
    $('#carregando-txt').textContent = 'Gravando…';
    if (tipo === 'pedidos') await store.substituirPedidos(resultado.pedidos, file.name);
    else await store.substituirPortos(resultado.portos, file.name);
    await recarregar();
    const qtd = tipo === 'pedidos' ? `${resultado.pedidos.length} pedidos importados — ${E.linhas.length} fluviais.` : `${resultado.portos.length} municípios importados.`;
    toast(qtd + (resultado.avisos.length ? `\n⚠ ${resultado.avisos.join('\n⚠ ')}` : ''), false, resultado.avisos.length ? 8000 : 4000);
    if (E.dados.pedidos.length && E.dados.portos.length) irPara(tipo === 'pedidos' ? 'pendencias' : 'municipios');
  });
}

// ================================================================== EXPORTAR
function exportar(rows, nome) {
  if (!rows.length) return toast('Nada para exportar.', true);
  const dados = rows.map((l) => ({
    'Carga': l.carga, 'Município': l.cidade, 'Porto': l.porto, 'Embarcação': l.embarcacao,
    'Data embarque': fromISO(l.data_prevista) || '', 'Pedido': l.numped, 'Cód. cliente': l.codcli, 'Cliente': l.cliente,
    'Vendedor': l.vendedor, 'Supervisor': l.supervisor, 'Valor': l.valor, 'Itens': l.qtd_itens, 'Status': l.status,
    'Motivo': l.motivos.join('; '), 'Origem': l.origem === 'manual' ? 'Ajuste manual' : 'OBS do vendedor', 'OBS do vendedor': l.obs_texto,
  }));
  const ws = XLSX.utils.json_to_sheet(dados, { cellDates: true, dateNF: 'dd/mm/yyyy' });
  ws['!cols'] = [12, 22, 18, 26, 12, 12, 10, 36, 30, 26, 11, 6, 22, 40, 14, 60].map((w) => ({ wch: w }));
  ws['!autofilter'] = { ref: ws['!ref'] };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pedidos');
  const hoje = new Date().toLocaleDateString('pt-BR').replace(/\//g, '-');
  XLSX.writeFile(wb, `${nome}_${hoje}.xlsx`);
}

// ================================================================== EVENTOS
function ligarEventos() {
  $('#abas').addEventListener('click', (e) => { const b = e.target.closest('button[data-aba]'); if (b) irPara(b.dataset.aba); });
  document.addEventListener('click', (e) => {
    const t = e.target;
    const ir = t.closest('[data-ir]'); if (ir) irPara(ir.dataset.ir);
    const kpi = t.closest('.kpi[data-filtro]');
    if (kpi) { $('#f-status').value = kpi.dataset.filtro; renderPendencias(); irPara('pendencias'); }
    if (t.closest('[data-msg-todos]')) abrirMensagens();
    const mv = t.closest('[data-msg-vend]'); if (mv) abrirMensagens(mv.dataset.msgVend);
  });
  $('#btn-recarregar').onclick = () => ocupado('Atualizando…', recarregar);
  $('#btn-sair').onclick = async () => { await store.sair(); location.reload(); };

  // pendências
  ['#f-busca', '#f-vendedor', '#f-municipio', '#f-carga', '#f-status'].forEach((s) => $(s).addEventListener('input', renderPendencias));
  $('#chips-status').addEventListener('click', (e) => { const c = e.target.closest('[data-chip]'); if (c) { $('#f-status').value = c.dataset.chip; renderPendencias(); } });
  $('#tabela-pend').addEventListener('click', (e) => {
    const t = e.target;
    if (t.id === 'sel-todos') { const rows = filtrarPend(); rows.forEach((l) => (t.checked ? E.selecionados.add(l.numped) : E.selecionados.delete(l.numped))); return renderPendencias(); }
    if (t.dataset.sel) { const n = Number(t.dataset.sel); t.checked ? E.selecionados.add(n) : E.selecionados.delete(n); t.closest('tr').classList.toggle('sel', t.checked); return renderLote(); }
    const ed = t.closest('[data-editar]'); if (ed) return abrirEdicao(ed.dataset.editar);
    const cf = t.closest('[data-confirmar]'); if (cf) return confirmar([Number(cf.dataset.confirmar)]);
  });
  $('#tabela-pend').addEventListener('dblclick', (e) => { const tr = e.target.closest('tr[data-num]'); if (tr && !e.target.closest('input,button')) abrirEdicao(tr.dataset.num); });
  $('#lote-aplicar').onclick = aplicarLote;
  $('#lote-confirmar').onclick = () => confirmar([...E.selecionados]).then(() => { E.selecionados.clear(); renderPendencias(); });
  $('#lote-limpar').onclick = () => { E.selecionados.clear(); renderPendencias(); };
  $('#btn-msg').onclick = () => abrirMensagens($('#f-vendedor').value || null);
  $('#btn-exp-pend').onclick = () => exportar(filtrarPend(), 'pendencias_fluvial');

  // modal edição
  $('#form-editar').addEventListener('submit', salvarEdicao);
  $('#ed-cancelar').onclick = () => $('#modal-editar').close();
  $('#ed-remover').onclick = async () => {
    const l = E.editando; $('#modal-editar').close();
    await ocupado('Desfazendo…', async () => { await store.removerAjuste(l.numped); await recarregar(); toast('Ajuste removido — voltou a valer o que está na OBS.'); });
  };

  // modal mensagens
  $('#msg-conferir').onchange = renderMensagens;
  $('#msg-fechar').onclick = () => $('#modal-msg').close();
  $('#msg-lista').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copiar]'); if (!b) return;
    await navigator.clipboard.writeText(b.closest('.msg-bloco').querySelector('pre').textContent);
    b.textContent = 'Copiado ✓'; setTimeout(() => (b.textContent = 'Copiar'), 1500);
  });

  // montagem
  ['#m-carga', '#m-data', '#m-status', '#m-agrupar', '#m-busca'].forEach((s) => $(s).addEventListener('input', renderMontagem));
  $('#m-expandir').onclick = () => {
    const abrir = $('#m-expandir').textContent === 'Expandir tudo';
    $$('#montagem details').forEach((d) => (d.open = abrir));
    $('#m-expandir').textContent = abrir ? 'Recolher tudo' : 'Expandir tudo';
  };
  $('#btn-exp-mont').onclick = () => {
    const niveis = $('#m-agrupar').value.split(',');
    const rows = [...filtrarMont()].sort((a, b) => a.carga.localeCompare(b.carga) || niveis.reduce((r, c) => r || ordenarChave(c, a[c], b[c]), 0) || a.cliente.localeCompare(b.cliente));
    exportar(rows, 'montagem_fluvial');
  };

  // municípios
  $('#nao-mapeadas').addEventListener('click', async (e) => {
    if (!e.target.closest('[data-nm-salvar]')) return;
    const linha = e.target.closest('.nm-linha');
    await ocupado('Salvando…', async () => {
      await store.salvarMapeamento(linha.dataset.cidade, $('[data-nm-carga]', linha).value, $('[data-nm-porto]', linha).value);
      await recarregar(); toast('Município mapeado.');
    });
  });
  $('#casamentos').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-desmapear]'); if (!b) return;
    await ocupado('Removendo…', async () => { await store.removerMapeamento(b.dataset.desmapear); await recarregar(); });
  });
  $('#form-emb').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = e.target.nome.value.trim(); if (!nome) return;
    await ocupado('Salvando…', async () => { await store.adicionarEmbarcacao(nome); e.target.reset(); await recarregar(); toast(`${nome.toUpperCase()} adicionada — a leitura das OBS já considera ela.`); });
  });
  $('#embarcacoes').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-rm-emb]'); if (!b) return;
    await ocupado('Removendo…', async () => { await store.removerEmbarcacao(b.dataset.rmEmb); await recarregar(); });
  });

  // importar (clique + arrastar)
  $$('.drop').forEach((d) => {
    const input = $('input', d);
    input.onchange = () => { if (input.files[0]) importar(d.dataset.tipo, input.files[0]); input.value = ''; };
    d.addEventListener('dragover', (e) => { e.preventDefault(); d.classList.add('sobre'); });
    d.addEventListener('dragleave', () => d.classList.remove('sobre'));
    d.addEventListener('drop', (e) => { e.preventDefault(); d.classList.remove('sobre'); const f = e.dataTransfer.files[0]; if (f) importar(d.dataset.tipo, f); });
  });
}

// ================================================================== INÍCIO
async function iniciarApp(sessao) {
  $('#tela-login').hidden = true;
  $('#app').hidden = false;
  const modo = $('#modo');
  if (store.MODO_LOCAL) { modo.textContent = 'MODO LOCAL — dados só neste navegador'; modo.classList.add('local'); $('#btn-sair').hidden = true; }
  else modo.textContent = sessao?.user?.email || '';
  ligarEventos();
  const aba = location.hash.slice(1);
  irPara(['painel', 'pendencias', 'montagem', 'municipios', 'importar'].includes(aba) ? aba : 'painel');
  await ocupado('Carregando dados…', recarregar);
}

(async function main() {
  try {
    const sessao = await store.sessaoAtual();
    if (sessao) return iniciarApp(sessao);
  } catch (e) { console.error(e); }
  $('#tela-login').hidden = false;
  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#login-erro').textContent = '';
    try {
      const s = await store.entrar(e.target.email.value, e.target.senha.value);
      iniciarApp(s);
    } catch (err) { $('#login-erro').textContent = err.message; }
  });
})();
