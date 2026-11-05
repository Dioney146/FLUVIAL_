// =====================================================================
//  core.js — motor de análise do Controle Fluvial (sem dependências)
//  - leitura das planilhas (linhas já convertidas pelo SheetJS)
//  - casamento de municípios (base x planilha de portos)
//  - extração de EMBARCAÇÃO e DATA a partir das observações do vendedor
//  - classificação da carga (FLUVIAL-RDW / FLUVIAL-DP) e status
// =====================================================================

export const CARGA_RDW = 'FLUVIAL-RDW';
export const CARGA_DP = 'FLUVIAL-DP';
export const SEM_CARGA = 'SEM CARGA';

export const STATUS = {
  SEM_OBS: 'SEM OBS',                          // vendedor não escreveu nada
  OBS_SEM: 'OBS SEM EMBARCAÇÃO E DATA',        // escreveu algo, mas sem barco nem data
  SEM_EMB: 'SEM EMBARCAÇÃO',
  SEM_DATA: 'SEM DATA',
  VEZ: 'BARCO DA VEZ',                         // "barco da vez" / "barco para município X"
  CONFERIR: 'CONFERIR',
  COMPLETO: 'COMPLETO',
};
export const STATUS_PENDENTES = [STATUS.SEM_OBS, STATUS.OBS_SEM, STATUS.SEM_EMB, STATUS.SEM_DATA];

// Embarcações conhecidas de partida (o sistema aprende novas a cada ajuste manual)
export const EMBARCACOES_SEED = [
  'VOVÓ JOVEM', 'RAINHA ESTER', 'LEÃO DE JUDÁ X', 'LEÃO DE JUDÁ','MADAME CRYS 1', 'PRÍNCIPE JOSÉ',
  'BALSA VERMELHA', 'M GOMES', 'TITO NOGUEIRA', 'L TORRES', 'INGRID BEATRIZ',
  'IRMÃO TORRES', 'DONA SULA', 'MAYTE SAFIRA', 'GM OLIVEIRA', 'EMBAIXADOR',
  'ESMERALDA', 'DEUS DE ALIANÇA', 'OLIVEIRA',
];

const GENERICA = 'BARCO DA VEZ';

// ---------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------
export function norm(s) {
  return String(s ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}
export const chave = (s) => norm(s).replace(/ /g, '');

const STOP = new Set(['DO', 'DA', 'DE', 'DOS', 'DAS', 'E']);

// ---------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------
export function toISO(d) {
  if (!d || isNaN(d)) return null;
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
export function fromISO(s) {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
export function fmtData(iso) {
  const d = fromISO(iso);
  if (!d) return '';
  const dias = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${dias[d.getDay()]}`;
}
// Converte qualquer valor de célula em Date (Date, serial Excel, "dd/mm/aaaa", ISO)
export function parseCelulaData(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v) ? null : new Date(v.getFullYear(), v.getMonth(), v.getDate());
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?/);
  if (m) {
    let y = m[3] ? +m[3] : new Date().getFullYear();
    if (y < 100) y += 2000;
    return new Date(y, +m[2] - 1, +m[1]);
  }
  return null;
}

// ---------------------------------------------------------------------
// Planilha de MUNICÍPIOS x PORTOS
// ---------------------------------------------------------------------
export function cargaDoPorto(cabecalho) {
  const n = norm(cabecalho);
  if (/RODWAY|ROADWAY|RODOWAY|\bRDW\b/.test(n)) return CARGA_RDW;
  if (/DEMETRIO|ESCADARIA|SAO RAIMUNDO/.test(n)) return CARGA_DP;
  return null;
}

/** linhas = array de arrays (header:1). Retorna { portos:[{municipio,porto,carga}], avisos:[] } */
export function lerPlanilhaPortos(linhas) {
  const avisos = [];
  let hi = linhas.findIndex((r) => (r || []).some((c) => /PORTO|RODWAY|DEMETRIO|ESCADARIA/.test(norm(c))));
  if (hi < 0) throw new Error('Não encontrei o cabeçalho com os portos (ex.: PORTO RODWAY, PORTO DEMETRIO...).');
  const header = linhas[hi];
  const colunas = [];
  header.forEach((h, i) => {
    if (h == null || String(h).trim() === '') return;
    const carga = cargaDoPorto(h);
    if (!carga) avisos.push(`Coluna "${h}" não corresponde a nenhuma regra de carga e foi ignorada.`);
    else colunas.push({ i, porto: String(h).trim(), carga });
  });
  const portos = [];
  const vistos = new Map();
  for (const r of linhas.slice(hi + 1)) {
    for (const c of colunas) {
      const v = r?.[c.i];
      if (v == null || String(v).trim() === '') continue;
      const municipio = String(v).trim();
      const k = chave(municipio);
      if (vistos.has(k) && vistos.get(k) !== c.carga) avisos.push(`"${municipio}" aparece em portos de cargas diferentes — mantida a primeira ocorrência.`);
      if (vistos.has(k)) continue;
      vistos.set(k, c.carga);
      portos.push({ municipio, porto: c.porto, carga: c.carga });
    }
  }
  if (!portos.length) throw new Error('Nenhum município encontrado nas colunas de porto.');
  return { portos, avisos };
}

// --- casamento de nomes de município (abreviações: "S.A. do Içá", "B. Constant", "Sta Isabel") ---
const EXPANDE = {
  S: ['SAO', 'SANTO', 'SANTA'], STA: ['SANTA'], STO: ['SANTO'], N: ['NOVO', 'NOVA', 'NOSSA'],
  NSA: ['NOSSA'], PRES: ['PRESIDENTE'], GAL: ['GENERAL'],
};
function tokensPlanilha(nome) {
  const raw = String(nome).normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
  return (raw.match(/[A-Z0-9]+\.?/g) || [])
    .map((p) => ({ t: p.replace('.', ''), abrev: p.endsWith('.') || p.length === 1 }))
    .filter((x) => !STOP.has(x.t));
}
function tokOk(p, b) {
  if (p.t === b) return true;
  if (EXPANDE[p.t]?.includes(b)) return true;
  if (p.abrev && b.startsWith(p.t)) return true;
  return false;
}
/** pontuação 0 = não casa; 3 = exato; 2 = abreviação completa; 1 = prefixo (ex.: "São Gabriel" x "SAO GABRIEL DA CACHOEIRA") */
export function pontuaMunicipio(nomePlanilha, cidadeBase) {
  const ka = chave(nomePlanilha), kb = chave(cidadeBase);
  if (ka === kb) return 3;
  const P = tokensPlanilha(nomePlanilha);
  const B = norm(cidadeBase).split(' ').filter((t) => t && !STOP.has(t));
  if (P.length && P.length <= B.length && P.every((p, i) => tokOk(p, B[i]))) return P.length === B.length ? 2 : 1;
  // tolerância a erro de digitação ("Uricurituba" x "URUCURITUBA")
  if (ka.length >= 6 && Math.abs(ka.length - kb.length) <= 2 && levenshtein(ka, kb) <= (ka.length >= 9 ? 2 : 1)) return 0.5;
  return 0;
}
function levenshtein(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Cria a função que diz a carga de uma cidade da base. mapeamento manual tem prioridade. */
export function criarResolvedorCidade(portos, mapeamento = new Map()) {
  const cache = new Map();
  return (cidade) => {
    const k = chave(cidade);
    if (cache.has(k)) return cache.get(k);
    let res = null;
    const man = mapeamento.get(k);
    if (man) {
      res = man.carga === 'IGNORAR' ? { carga: null, ignorado: true, manual: true }
        : { carga: man.carga, porto: man.porto || 'Mapeamento manual', municipio: cidade, manual: true };
    } else {
      let best = null, bestScore = 0;
      for (const p of portos) {
        const s = pontuaMunicipio(p.municipio, cidade);
        if (s > bestScore) { best = p; bestScore = s; }
      }
      if (best) res = { carga: best.carga, porto: best.porto, municipio: best.municipio, score: bestScore };
    }
    cache.set(k, res);
    return res;
  };
}

// ---------------------------------------------------------------------
// Base de PEDIDOS
// ---------------------------------------------------------------------
const ALIAS = {
  numped: ['NUMPED', 'PEDIDO', 'NUM PED', 'N PEDIDO', 'NUMERO PEDIDO'],
  codcli: ['CODCLI', 'COD CLIENTE', 'CODIGO CLIENTE'],
  cliente: ['NOMECLIENTE', 'CLIENTE', 'NOME CLIENTE', 'RAZAO SOCIAL'],
  vendedor: ['NOMERCA', 'VENDEDOR', 'RCA', 'NOME RCA'],
  supervisor: ['NOMESUP', 'SUPERVISOR'],
  cidade: ['CIDADE', 'MUNICIPIO', 'CIDADE ENTREGA'],
  data_pedido: ['DATA', 'DATA PEDIDO', 'DTPEDIDO', 'DT PEDIDO'],
  rota: ['ROTA', 'PRACA', 'NOME ROTA'],
  valor: ['VLTOTAL', 'VALOR', 'VL TOTAL', 'VALOR TOTAL'],
  qtd_itens: ['QTD ITENS', 'QTDITENS', 'ITENS'],
  peso: ['PESOBRUTOTOT', 'PESO TOTAL', 'PESO BRUTO TOTAL', 'PESO', 'PESO KG'],
  peso_unit: ['PESOBRUTO', 'PESO BRUTO', 'PESO UNIT'],
  embarcacao_base: ['EMBARCACAO', 'BARCO', 'NOME EMBARCACAO'],
  data_base: ['DATA EMBARQUE', 'DATA PREVISTA', 'PREVISAO EMBARQUE', 'DATA ENTREGA PREVISTA', 'DT EMBARQUE'],
};

function num(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim().replace(/\s/g, '');
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return isNaN(n) ? null : n;
}
const txt = (v) => (v == null ? '' : String(v).trim());

/** linhas = array de arrays (header:1). Retorna { pedidos, avisos } */
export function lerBasePedidos(linhas) {
  const hi = linhas.findIndex((r) => (r || []).some((c) => ['NUMPED', 'PEDIDO'].includes(norm(c))));
  if (hi < 0) throw new Error('Não encontrei a coluna NUMPED na base de pedidos.');
  const header = linhas[hi].map((h) => norm(h));
  const idx = {};
  for (const [campo, nomes] of Object.entries(ALIAS)) {
    const i = header.findIndex((h) => nomes.includes(h));
    if (i >= 0) idx[campo] = i;
  }
  const obsCols = header.map((h, i) => (h.startsWith('OBS') ? i : -1)).filter((i) => i >= 0);
  const avisos = [];
  for (const req of ['cidade', 'vendedor', 'cliente']) if (idx[req] == null) avisos.push(`Coluna de ${req} não encontrada.`);
  if (!obsCols.length && idx.embarcacao_base == null) avisos.push('Nenhuma coluna OBS/EMBARCAÇÃO encontrada — não será possível ler embarcação e data.');

  const pedidos = [];
  const vistos = new Set();
  for (const r of linhas.slice(hi + 1)) {
    if (!r) continue;
    const numped = num(r[idx.numped]);
    if (!numped) continue;
    if (vistos.has(numped)) continue; // base vem por pedido; ignora repetidos
    vistos.add(numped);
    const g = (c) => (idx[c] != null ? r[idx[c]] : null);
    pedidos.push({
      numped,
      codcli: num(g('codcli')),
      cliente: txt(g('cliente')),
      vendedor: txt(g('vendedor')),
      supervisor: txt(g('supervisor')),
      cidade: txt(g('cidade')),
      data_pedido: toISO(parseCelulaData(g('data_pedido'))),
      rota: txt(g('rota')),
      valor: num(g('valor')) ?? 0,
      qtd_itens: num(g('qtd_itens')) ?? 0,
      peso: num(g('peso')) || num(g('peso_unit')) || 0,
      obs: obsCols.map((i) => txt(r[i])).filter(Boolean),
      embarcacao_base: txt(g('embarcacao_base')) || null,
      data_base: toISO(parseCelulaData(g('data_base'))),
    });
  }
  if (!pedidos.length) throw new Error('A base não tem pedidos.');
  if (idx.peso == null && idx.peso_unit == null) avisos.push('Coluna de peso não encontrada (PESOBRUTOTOT).');
  else if (pedidos.every((p) => !p.peso)) avisos.push('A coluna de peso (PESOBRUTOTOT) veio zerada na base — o peso vai aparecer como 0 kg.');
  return { pedidos, avisos };
}

// ---------------------------------------------------------------------
// Extração de EMBARCAÇÃO e DATA das observações
// ---------------------------------------------------------------------
const OBS_IGNORAR = /^(HORARIO COMERCIAL|\d+|SEM OBS|NAO TEM|-+)$/;

/** junta as OBS, remove códigos, repetições e versões truncadas */
export function textoObs(obs) {
  const segs = [];
  for (const o of obs || []) {
    const s = String(o).replace(/\s+/g, ' ').trim();
    if (!s || OBS_IGNORAR.test(norm(s))) continue;
    segs.push(s);
  }
  const uniq = [];
  const chaves = segs.map(chave);
  segs.forEach((s, i) => {
    const k = chaves[i];
    // descarta se outro segmento maior já contém este (OBS truncada) ou se é repetido
    const contido = chaves.some((k2, j) => j !== i && (k2.length > k.length ? k2.includes(k) : (k2 === k && j < i)));
    if (!contido) uniq.push(s);
  });
  return uniq.join(' | ');
}

const PARADAS = new Set([
  'PORTO', 'DIA', 'DIAS', 'SAI', 'SAIDA', 'SAINDO', 'SAIR', 'CHEGA', 'CHEGO', 'CHEGOU', 'CHEGANDO', 'VAI', 'OU', 'NO', 'NA',
  'E', 'EM', 'PARA', 'PREVISAO', 'PREVISTO', 'SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO', 'DOMINGO',
  'FEIRA', 'HOJE', 'AMANHA', 'NAO', 'MANDAR', 'FAVOR', 'ENTREGAR', 'EMBARCAR', 'ATE', 'AS', 'HRS', 'HORAS', 'COM',
  'PELO', 'PELA', 'AMBOS', 'RODWAY', 'ROADWAY', 'RDW', 'DEMETRIO', 'ESCADARIA', 'MANAUS', 'DATA', 'ENTREGA', 'URGENTE',
]);
const TIPOS = String.raw`barco|balsa|b\s?\/\s?m|n\s?\/\s?m|f\s?\/\s?b|f\.?\s?b\.?|lancha|ferry|navio|embarca[cç][aã]o|n\.\s?m\.`;
const RE_TIPO = new RegExp(String.raw`(?<![A-Za-zÀ-ÿ])(${TIPOS})\s+([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9 .']{0,45})`, 'gi');

function limpaNomeBarco(cap) {
  const toks = cap.trim().split(/\s+/);
  const out = [];
  for (const t of toks) {
    const n = norm(t);
    if (!n) break;
    if (PARADAS.has(n)) break;
    if (/\d/.test(n) && out.length === 0) break;            // "BALSA 06/11"
    if (/[\/:]/.test(t) || /\d/.test(n) && !/^(\d|[IVX]+)$/.test(n)) break; // datas, "4A", "10HRS" (aceita "1", "X")
    out.push(t.replace(/[.']+$/, ''));
    if (out.length >= 4) break;
  }
  return out.join(' ').trim();
}

// palavras que nunca fazem parte de nome de barco (usado para deduzir nomes sem "BARCO X")
const NAO_NOME = new Set([...PARADAS, 'BARCO', 'BARCOS', 'BALSA', 'LANCHA', 'NAVIO', 'FERRY', 'CLIENTE', 'PAO', 'PAES',
  'VALIDADE', 'LONGA', 'BEM', 'AVARIADO', 'AVARIA', 'BNF', 'BONIFICACAO', 'PEDIDO', 'PEDIDOS', 'NOTA', 'NF', 'BOLETO', 'PAGAMENTO',
  'PIX', 'DINHEIRO', 'FRETE', 'PAGO', 'CARGA', 'JUNTO', 'SEPARADO', 'COMERCIAL', 'HORARIO', 'ABRE', 'FECHA', 'LIGAR', 'CONTATO',
  'TELEFONE', 'PRODUTO', 'PRODUTOS', 'CAIXA', 'CAIXAS', 'FRIOS', 'CONGELADO', 'CONGELADA', 'CONGELADOS', 'BATATA', 'MERCADORIA',
  'VEZ', 'PROXIMO', 'PRIMEIRO', 'DISPONIVEL', 'QUALQUER', 'ENVIAR', 'LEVAR', 'COLOCAR', 'POR', 'PODE', 'DEIXAR', 'AGUARDAR',
  'AGUARDANDO', 'ESPERAR', 'OBS', 'ATENCAO', 'CUIDADO', 'FRAGIL', 'O', 'A', 'OS', 'UM', 'UMA', 'SEM', 'MAIS', 'MENOS', 'SO',
  'APENAS', 'TAMBEM', 'JA', 'AINDA', 'TODO', 'TODOS', 'TUDO', 'QUE', 'QUAL', 'QUANDO', 'SE', 'ENTRE', 'SOBRE', 'APOS', 'ANTES',
  'DEPOIS', 'SEMANA', 'MES', 'MANHA', 'TARDE', 'NOITE', 'H', 'HS', 'HR', 'PRA', 'P', 'VENDEDOR', 'RECEBER', 'RECEBE', 'ENTREGUE',
  'PEDIR', 'CONFIRMAR', 'VERIFICAR', 'VER', 'INTERIOR', 'FLUVIAL', 'CIDADE', 'MUNICIPIO', 'ENDERECO', 'RUA', 'AV', 'LOJA',
  'MERCADO', 'MERCADINHO', 'COMERCIO', 'LTDA', 'ME', 'DEPOSITO', 'TRANSPORTADORA', 'BARQUEIRO', 'DONO',
  'ITENS', 'ITEM', 'KG', 'UND', 'UN', 'FARDO', 'FARDOS', 'SACO', 'SACOS']);
const RE_PORTO = /^(PORTO )?(DEMETRIO|ESCADARIA|RODWAY|ROADWAY|RDW|SAO RAIMUNDO|BALSA BRANCA|MANAUS MODERNA|PANAIR)( PORTO)?$/;

/** "barco para Tapauá", "mandar no barco p/ Maués", "próximo barco pra Coari" -> nome da cidade (ou null) */
function barcoParaCidade(texto, municipios) {
  const t = String(texto).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9\/]+/g, ' ');
  const m = t.match(/\b(?:BARCO|BARCOS|BALSA|BALSAS|LANCHA|EMBARCACAO)\b(?:\s+(?:QUE\s+)?(?:VAI|VAO|SAI|SAEM|SEGUE|FOR|ESTIVER|TIVER))?\s+(?:PARA|PRA|P\s?\/|P)\s+(?:O\s+|A\s+)?(?:MUNICIPIO\s+(?:DE\s+)?|CIDADE\s+(?:DE\s+)?)?([A-Z][A-Z ]{2,40})/);
  if (!m) return null;
  const palavras = m[1].trim().split(' ');
  const cand = [];
  for (const p of palavras) { if (PARADAS.has(p) && !['DO', 'DA', 'DE'].includes(p)) break; cand.push(p); if (cand.length >= 5) break; }
  // tenta casar com um município conhecido (do maior trecho para o menor)
  for (let n = cand.length; n >= 1; n--) {
    const trecho = cand.slice(0, n).join(' ');
    let best = null, bs = 0;
    for (const mun of municipios || []) { const s = pontuaMunicipio(mun, trecho); if (s > bs) { bs = s; best = mun; } }
    if (best && bs >= 1) return norm(best);
  }
  return cand.length ? cand.slice(0, 3).join(' ') : null;
}

/** nome de barco escrito sem "BARCO" antes: "MANOEL FONSECA/ DEMÉTRIO" -> "MANOEL FONSECA" */
function deduzirNome(texto, municipiosChaves) {
  const pedacos = String(texto).split(/[\/|,;()\-]+|\s(?:ou|OU|Ou|e|E)\s/);
  for (const p of pedacos) {
    const n = norm(p);
    if (!n || RE_PORTO.test(n)) continue;
    const sig = n.split(' ').filter((w) => !['DO', 'DA', 'DE', 'DOS', 'DAS', 'E'].includes(w));
    if (sig.length < 2 || sig.length > 4) continue;
    if (sig.some((w) => NAO_NOME.has(w) || PARADAS.has(w))) continue;
    if (sig.some((w) => /\d/.test(w) && !/^\d$/.test(w))) continue;
    if (sig.filter((w) => w.length >= 3).length < 2) continue;
    if (municipiosChaves?.has(chave(n))) continue;
    if ([...(municipiosChaves || [])].some((k) => k.length >= 5 && chave(n).includes(k))) continue;
    return n;
  }
  return null;
}

/**
 * Retorna { nomes: [..], generica: bool, rotulo: 'BARCO DA VEZ' | 'BARCO P/ X' | '', deduzida: bool }
 * @param municipios lista de nomes de municípios (para "barco para X" e para não confundir cidade com barco)
 */
export function extrairEmbarcacoes(texto, conhecidas = EMBARCACOES_SEED, municipios = []) {
  if (!texto) return { nomes: [], generica: false, rotulo: '', deduzida: false };
  const n = norm(texto);
  const semEsp = n.replace(/ /g, '');
  const achados = []; // {nome, ini, fim, k}

  // 1) embarcações conhecidas (comparação sem espaços: "LTorres" = "L TORRES")
  const lista = [...new Set(conhecidas.map((x) => String(x).trim()).filter(Boolean))]
    .map((nome) => ({ nome, k: chave(nome) }))
    .filter((x) => x.k.length >= 4)
    .sort((a, b) => b.k.length - a.k.length);
  for (const { nome, k } of lista) {
    let from = 0, i;
    while ((i = semEsp.indexOf(k, from)) >= 0) {
      const fim = i + k.length;
      if (!achados.some((a) => i < a.fim && fim > a.ini)) achados.push({ nome: nome.toUpperCase(), ini: i, fim, k });
      from = fim;
    }
  }

  // 2) padrão "BARCO X", "BALSA X", "F B X", "N/M X"...
  let generica = false;
  RE_TIPO.lastIndex = 0;
  let m;
  while ((m = RE_TIPO.exec(texto))) {
    const antes = norm(texto.slice(Math.max(0, m.index - 8), m.index));
    if (/PORTO$/.test(antes)) continue; // "PORTO BALSA BRANCA" é porto, não barco
    const capN = norm(m[2]);
    if (/^(DA |DE )?VEZ\b/.test(capN)) { generica = true; continue; }
    if (/^(PARA|PRA|P)\b/.test(capN) || /^(QUE )?(VAI|SAI|SEGUE|FOR) (PARA|PRA|P)\b/.test(capN)) continue; // "barco para X" é genérico
    const nome = limpaNomeBarco(m[2]);
    const k = chave(nome);
    if (k.length < 3) continue;
    if (achados.some((a) => a.k.includes(k) || k.includes(a.k))) continue;
    const tipo = norm(m[1]);
    const nomeFinal = tipo === 'BALSA' && nome.split(' ').length === 1 ? `BALSA ${nome}` : nome; // "BALSA VERMELHA"
    achados.push({ nome: nomeFinal.toUpperCase(), ini: semEsp.indexOf(k), fim: semEsp.indexOf(k) + k.length, k: chave(nomeFinal) });
  }
  if (/\b(BARCO|BALSA|EMBARCACAO) (DA |DE )?VEZ\b|PRIMEIRO BARCO|PROXIMO BARCO|QUALQUER BARCO|BARCO DISPONIVEL/.test(n)) generica = true;

  achados.sort((a, b) => a.ini - b.ini);
  let nomes = [...new Set(achados.map((a) => a.nome))];

  // 3) "barco para município X"
  let rotulo = '';
  const cidade = barcoParaCidade(texto, municipios);
  if (cidade && !nomes.length) { generica = true; rotulo = `BARCO P/ ${cidade}`; }
  else if (generica) rotulo = GENERICA;

  // 4) nome sem a palavra "barco" ("MANOEL FONSECA/ DEMÉTRIO")
  let deduzida = false;
  if (!nomes.length && !generica) {
    const chaves = new Set((municipios || []).map(chave));
    const nome = deduzirNome(texto, chaves);
    if (nome) { nomes = [nome]; deduzida = true; }
  }
  return { nomes, generica: generica && !nomes.length, rotulo: !nomes.length ? rotulo : '', deduzida };
}

const DIAS_SEMANA = { DOMINGO: 0, SEGUNDA: 1, TERCA: 2, QUARTA: 3, QUINTA: 4, SEXTA: 5, SABADO: 6 };
const RE_CTX_SAIDA = /(SAI|SAIDA|SAINDO|SAIR|EMBARC|PREVIS|ENTREGA|SEGUE|PARTIDA|ZARPA|MANDAR|ENVIAR)\w*\W*(\w+\W*){0,3}$/;
const RE_CTX_CHEGADA = /(CHEG|ATRACA|ESTA EM MANAUS)\w*\W*(\w+\W*){0,3}$/;

function contexto(nText, idx) {
  const antes = nText.slice(Math.max(0, idx - 30), idx).trim();
  if (RE_CTX_CHEGADA.test(antes)) return 0;
  if (RE_CTX_SAIDA.test(antes)) return 2;
  return 1;
}

/** Retorna { data: 'aaaa-mm-dd' | null, inferida: bool, origem: string } */
export function extrairData(texto, dataRefISO) {
  if (!texto) return { data: null, inferida: false, origem: '' };
  const ref = fromISO(dataRefISO) || new Date();
  // normaliza mantendo a barra das datas: "09-11" / "09.11" / "09 / 11" -> "09/11"
  const n = String(texto).replace(/(\d)\s*[.\-\/]\s*(\d)/g, '$1/$2')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/[^A-Z0-9\/]+/g, ' ').replace(/(?<!\d)\/|\/(?!\d)/g, ' ').replace(/\s+/g, ' ').trim();
  const cand = [];

  // dd/mm(/aaaa)
  const reDM = /(?<!\d)(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?!\d)/g;
  let m;
  while ((m = reDM.exec(n))) {
    const d = +m[1], mo = +m[2];
    if (d < 1 || d > 31 || mo < 1 || mo > 12) continue;
    let y = m[3] ? +m[3] : ref.getFullYear();
    if (y < 100) y += 2000;
    let dt = new Date(y, mo - 1, d);
    if (!m[3] && dt - ref < -120 * 86400000) dt = new Date(y + 1, mo - 1, d); // virada de ano
    cand.push({ dt, pri: contexto(n, m.index), inferida: false, origem: m[0] });
  }
  // "dia 10" (sem mês)
  const reDia = /\bDIA (\d{1,2})\b(?!\/)/g;
  while ((m = reDia.exec(n))) {
    const d = +m[1];
    if (d < 1 || d > 31) continue;
    let dt = new Date(ref.getFullYear(), ref.getMonth(), d);
    if (d < ref.getDate()) dt = new Date(ref.getFullYear(), ref.getMonth() + 1, d);
    cand.push({ dt, pri: contexto(n, m.index), inferida: true, origem: m[0] });
  }
  const explicitas = cand.filter((c) => !c.inferida);
  const escolhe = (lista) => {
    const maxPri = Math.max(...lista.map((c) => c.pri));
    const top = lista.filter((c) => c.pri === maxPri).sort((a, b) => a.dt - b.dt);
    const futuras = top.filter((c) => c.dt >= ref);
    return futuras[0] || top[top.length - 1];
  };
  if (explicitas.length) { const c = escolhe(explicitas); return { data: toISO(c.dt), inferida: false, origem: c.origem }; }
  if (cand.length) { const c = escolhe(cand); return { data: toISO(c.dt), inferida: true, origem: c.origem }; }

  // dia da semana ("sai terça", "3a feira", "segunda-feira")
  const reSem = /\b(DOMINGO|SEGUNDA|TERCA|QUARTA|QUINTA|SEXTA|SABADO)\b|\b([2-6]) ?(?:A|O)\b(?: ?FEIRA)?/g;
  const sems = [];
  while ((m = reSem.exec(n))) {
    const dow = m[1] ? DIAS_SEMANA[m[1]] : (+m[2] - 1);
    let delta = (dow - ref.getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    const dt = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + delta);
    sems.push({ dt, pri: contexto(n, m.index), origem: m[0] });
  }
  if (sems.length) {
    sems.sort((a, b) => a.dt - b.dt);
    return { data: toISO(sems[0].dt), inferida: true, origem: sems.map((s) => s.origem).join(', ') };
  }
  return { data: null, inferida: false, origem: '' };
}

// ---------------------------------------------------------------------
// Análise completa
// ---------------------------------------------------------------------
/**
 * @param pedidos  base importada
 * @param portos   [{municipio, porto, carga}]
 * @param opts     { ajustes: Map(numped -> {embarcacao, data_prevista, observacao}),
 *                   embarcacoes: [nomes], mapeamento: Map(chave(cidade) -> {carga, porto}) }
 * @returns { linhas, naoMapeadas }
 */
export function analisar(pedidos, portos, opts = {}) {
  const ajustes = opts.ajustes || new Map();
  const conhecidas = [...EMBARCACOES_SEED, ...(opts.embarcacoes || [])];
  const resolver = criarResolvedorCidade(portos || [], opts.mapeamento || new Map());
  const municipios = [...new Set([...(portos || []).map((p) => p.municipio), ...pedidos.map((p) => p.cidade), 'MANAUS'].filter(Boolean))];

  const linhas = [];
  const naoMapeadas = new Map();
  for (const p of pedidos) {
    const r = resolver(p.cidade);
    const rotaFluvial = /FLUVIAL/.test(norm(p.rota));
    if (r?.ignorado) continue;
    if (!r?.carga) {
      if (rotaFluvial) {
        const k = chave(p.cidade);
        const it = naoMapeadas.get(k) || { cidade: p.cidade, pedidos: 0, valor: 0 };
        it.pedidos++; it.valor += p.valor || 0;
        naoMapeadas.set(k, it);
      } else continue;
    }

    const texto = textoObs(p.obs);
    const emb = p.embarcacao_base ? { nomes: [p.embarcacao_base.toUpperCase()], generica: false, rotulo: '', deduzida: false } : extrairEmbarcacoes(texto, conhecidas, municipios);
    const dat = p.data_base ? { data: p.data_base, inferida: false, origem: 'coluna da base' } : extrairData(texto, p.data_pedido);

    linhas.push({
      ...p,
      carga: r?.carga || SEM_CARGA,
      porto: r?.porto || '',
      municipio_planilha: r?.municipio || '',
      cidade_manual: !!r?.manual,
      obs_texto: texto,
      emb_auto: emb.nomes.join(' / ') || (emb.generica ? emb.rotulo || GENERICA : ''),
      emb_opcoes: emb.nomes.length,
      emb_generica: emb.generica,
      emb_deduzida: emb.deduzida,
      tem_obs: !!texto,
      data_auto: dat.data,
      data_inferida: dat.inferida,
      data_origem: dat.origem,
    });
  }

  // Herança entre pedidos do mesmo cliente/cidade (pedido desmembrado sem OBS)
  const grupos = new Map();
  for (const l of linhas) {
    const k = `${l.codcli}|${chave(l.cidade)}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(l);
  }

  for (const l of linhas) {
    const aj = ajustes.get(Number(l.numped));
    const motivos = [];
    let emb = l.emb_auto, data = l.data_auto, herdado = null;

    if (!emb || !data) {
      const irmaos = grupos.get(`${l.codcli}|${chave(l.cidade)}`).filter((x) => x !== l);
      for (const i of irmaos) {
        const ai = ajustes.get(Number(i.numped));
        const iEmb = ai?.embarcacao || i.emb_auto;
        const iData = ai?.data_prevista || i.data_auto;
        if ((!emb && iEmb) || (!data && iData)) {
          if (!emb && iEmb) emb = iEmb;
          if (!data && iData) data = iData;
          herdado = i.numped;
          break;
        }
      }
    }
    let origem = 'obs';
    if (aj && (aj.embarcacao || aj.data_prevista)) {
      if (aj.embarcacao) emb = aj.embarcacao;
      if (aj.data_prevista) data = aj.data_prevista;
      origem = 'manual';
    }

    if (origem !== 'manual' || !aj.embarcacao) {
      if (herdado && emb && !l.emb_auto && !aj?.embarcacao) motivos.push(`embarcação herdada do pedido ${herdado}`);
      else if (l.emb_generica && emb === l.emb_auto) motivos.push(emb === GENERICA ? 'vendedor pediu "barco da vez"' : `vendedor pediu "barco para ${emb.replace('BARCO P/ ', '')}"`);
      else if (l.emb_opcoes > 1 && !aj?.embarcacao) motivos.push('mais de uma embarcação citada');
      else if (l.emb_deduzida && emb === l.emb_auto) motivos.push('nome da embarcação deduzido (escrito sem "barco")');
    }
    if (origem !== 'manual' || !aj.data_prevista) {
      if (herdado && data && !l.data_auto && !aj?.data_prevista) motivos.push(`data herdada do pedido ${herdado}`);
      else if (l.data_inferida && data === l.data_auto) motivos.push(`data deduzida de "${l.data_origem}"`);
    }
    if (l.carga === SEM_CARGA) motivos.push('município sem carga definida');

    const generica = l.emb_generica && emb === l.emb_auto && !aj?.embarcacao;
    let status;
    if (!emb && !data) status = l.tem_obs ? STATUS.OBS_SEM : STATUS.SEM_OBS;
    else if (generica) status = STATUS.VEZ;   // data não é exigida: vai no próximo barco
    else if (!emb) status = STATUS.SEM_EMB;
    else if (!data) status = STATUS.SEM_DATA;
    else if (motivos.length) status = STATUS.CONFERIR;
    else status = STATUS.COMPLETO;

    l.embarcacao = emb || '';
    l.data_prevista = data || null;
    l.origem = origem;
    l.herdado_de = herdado;
    l.motivos = motivos;
    l.status = status;
    l.ajuste_obs = aj?.observacao || '';
  }

  linhas.sort((a, b) => a.carga.localeCompare(b.carga) || a.cidade.localeCompare(b.cidade) || a.numped - b.numped);
  return { linhas, naoMapeadas: [...naoMapeadas.values()] };
}
