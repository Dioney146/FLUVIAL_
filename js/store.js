// =====================================================================
//  store.js — persistência: Supabase (produção) ou localStorage (modo local)
// =====================================================================
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { chave } from './core.js';

export const MODO_LOCAL = !SUPABASE_URL || !SUPABASE_ANON_KEY;

let sb = null;
async function cliente() {
  if (sb) return sb;
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.45.4');
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true } });
  return sb;
}

// ---------------------------------------------------------------- auth
export async function sessaoAtual() {
  if (MODO_LOCAL) return { user: { email: 'modo local' } };
  const s = await cliente();
  const { data } = await s.auth.getSession();
  return data.session;
}
export async function entrar(email, senha) {
  const s = await cliente();
  const { data, error } = await s.auth.signInWithPassword({ email, password: senha });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'E-mail ou senha inválidos.' : error.message);
  return data.session;
}
export async function sair() {
  if (MODO_LOCAL) return;
  const s = await cliente();
  await s.auth.signOut();
}
async function usuarioEmail() {
  if (MODO_LOCAL) return 'local';
  const s = await cliente();
  const { data } = await s.auth.getUser();
  return data.user?.email || '';
}

// ---------------------------------------------------------------- helpers
async function buscarTudo(tabela, ordem) {
  const s = await cliente();
  const out = [];
  const passo = 1000;
  for (let de = 0; ; de += passo) {
    let q = s.from(tabela).select('*').range(de, de + passo - 1);
    if (ordem) q = q.order(ordem);
    const { data, error } = await q;
    if (error) throw new Error(`${tabela}: ${error.message}`);
    out.push(...data);
    if (data.length < passo) break;
  }
  return out;
}
async function inserirEmLotes(tabela, linhas, opts = {}) {
  const s = await cliente();
  for (let i = 0; i < linhas.length; i += 500) {
    const lote = linhas.slice(i, i + 500);
    const { error } = opts.upsert
      ? await s.from(tabela).upsert(lote, { onConflict: opts.upsert })
      : await s.from(tabela).insert(lote);
    if (error) throw new Error(`${tabela}: ${error.message}`);
  }
}
const LS = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem('fluvial_' + k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem('fluvial_' + k, JSON.stringify(v)),
};

// ---------------------------------------------------------------- leitura geral
export async function carregarTudo() {
  if (MODO_LOCAL) {
    return {
      pedidos: LS.get('pedidos', []),
      portos: LS.get('portos', []),
      ajustes: LS.get('ajustes', []),
      embarcacoes: LS.get('embarcacoes', []).map((nome) => ({ nome })),
      mapeamento: LS.get('mapeamento', []),
      importacoes: LS.get('importacoes', []),
    };
  }
  const [pedidos, portos, ajustes, embarcacoes, mapeamento, importacoes] = await Promise.all([
    buscarTudo('pedidos', 'numped'),
    buscarTudo('portos', 'id'),
    buscarTudo('ajustes'),
    buscarTudo('embarcacoes', 'nome'),
    buscarTudo('mapeamento_municipios'),
    (async () => {
      const s = await cliente();
      const { data, error } = await s.from('importacoes').select('*').order('criado_em', { ascending: false }).limit(20);
      if (error) throw new Error(error.message);
      return data;
    })(),
  ]);
  return { pedidos, portos, ajustes, embarcacoes, mapeamento, importacoes };
}

// ---------------------------------------------------------------- importações
async function registrarImportacao(tipo, arquivo, linhas) {
  const reg = { tipo, arquivo, linhas, usuario: await usuarioEmail(), criado_em: new Date().toISOString() };
  if (MODO_LOCAL) { LS.set('importacoes', [reg, ...LS.get('importacoes', [])].slice(0, 20)); return; }
  const s = await cliente();
  await s.from('importacoes').insert(reg);
}

export async function substituirPedidos(pedidos, arquivo) {
  if (MODO_LOCAL) {
    LS.set('pedidos', pedidos);
  } else {
    const s = await cliente();
    const { error } = await s.from('pedidos').delete().gte('numped', 0);
    if (error) throw new Error(`Limpando pedidos: ${error.message}`);
    const agora = new Date().toISOString();
    await inserirEmLotes('pedidos', pedidos.map((p) => ({ ...p, importado_em: agora })), { upsert: 'numped' });
  }
  await registrarImportacao('pedidos', arquivo, pedidos.length);
}

export async function substituirPortos(portos, arquivo) {
  if (MODO_LOCAL) {
    LS.set('portos', portos);
  } else {
    const s = await cliente();
    const { error } = await s.from('portos').delete().gte('id', 0);
    if (error) throw new Error(`Limpando portos: ${error.message}`);
    await inserirEmLotes('portos', portos);
  }
  await registrarImportacao('portos', arquivo, portos.length);
}

// ---------------------------------------------------------------- ajustes manuais
export async function salvarAjuste(numped, { embarcacao, data_prevista, observacao }) {
  const reg = {
    numped: Number(numped),
    embarcacao: embarcacao?.trim().toUpperCase() || null,
    data_prevista: data_prevista || null,
    observacao: observacao?.trim() || null,
    atualizado_em: new Date().toISOString(),
    atualizado_por: await usuarioEmail(),
  };
  if (MODO_LOCAL) {
    const l = LS.get('ajustes', []).filter((a) => a.numped !== reg.numped);
    l.push(reg); LS.set('ajustes', l);
  } else {
    const s = await cliente();
    const { error } = await s.from('ajustes').upsert(reg, { onConflict: 'numped' });
    if (error) throw new Error(error.message);
  }
  // aprende a embarcação (só nomes únicos, não listas "A / B")
  if (reg.embarcacao && !reg.embarcacao.includes('/') && reg.embarcacao !== 'BARCO DA VEZ') await adicionarEmbarcacao(reg.embarcacao);
  return reg;
}
export async function salvarAjustesEmLote(lista) {
  for (const a of lista) await salvarAjuste(a.numped, a);
}
export async function removerAjuste(numped) {
  if (MODO_LOCAL) { LS.set('ajustes', LS.get('ajustes', []).filter((a) => a.numped !== Number(numped))); return; }
  const s = await cliente();
  const { error } = await s.from('ajustes').delete().eq('numped', Number(numped));
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------- embarcações
export async function adicionarEmbarcacao(nome) {
  nome = String(nome).trim().toUpperCase();
  if (!nome) return;
  if (MODO_LOCAL) { const l = LS.get('embarcacoes', []); if (!l.includes(nome)) LS.set('embarcacoes', [...l, nome].sort()); return; }
  const s = await cliente();
  await s.from('embarcacoes').upsert({ nome }, { onConflict: 'nome', ignoreDuplicates: true });
}
export async function removerEmbarcacao(nome) {
  if (MODO_LOCAL) { LS.set('embarcacoes', LS.get('embarcacoes', []).filter((n) => n !== nome)); return; }
  const s = await cliente();
  const { error } = await s.from('embarcacoes').delete().eq('nome', nome);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------- mapeamento de municípios
export async function salvarMapeamento(cidadeNome, carga, porto) {
  const reg = { cidade: chave(cidadeNome), cidade_nome: cidadeNome, carga, porto: porto || null, atualizado_em: new Date().toISOString() };
  if (MODO_LOCAL) { const l = LS.get('mapeamento', []).filter((m) => m.cidade !== reg.cidade); l.push(reg); LS.set('mapeamento', l); return; }
  const s = await cliente();
  const { error } = await s.from('mapeamento_municipios').upsert(reg, { onConflict: 'cidade' });
  if (error) throw new Error(error.message);
}
export async function removerMapeamento(cidadeChave) {
  if (MODO_LOCAL) { LS.set('mapeamento', LS.get('mapeamento', []).filter((m) => m.cidade !== cidadeChave)); return; }
  const s = await cliente();
  const { error } = await s.from('mapeamento_municipios').delete().eq('cidade', cidadeChave);
  if (error) throw new Error(error.message);
}
