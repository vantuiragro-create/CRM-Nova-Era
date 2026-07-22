'use strict';

// Rótulos das etapas (usados no seletor do modal; as chaves batem com o servidor)
const STAGE_LABELS = {
  novo: 'Novo lead (SDR)',
  triagem: 'Em triagem (SDR)',
  qualificado: 'Qualificado / Recebido (Vendas)',
  decidindo: 'Decidindo se vai comprar (Vendas)',
  negociacao: 'Em negociação (Vendas)',
  proposta: 'Proposta enviada (Vendas)',
  financiamento: 'Aguardando financiamento (Vendas)',
  ganho: 'Fechado (ganho)',
  desistiu: 'Desistiu da compra',
  perdido: 'Perdido p/ concorrente',
  curioso: 'Só curioso — sem perspectiva (SDR)',
};
let STAGES = ['novo', 'triagem', 'qualificado', 'decidindo', 'negociacao', 'proposta',
  'financiamento', 'ganho', 'desistiu', 'perdido', 'curioso'];

// Cada coluna carrega o "patch" que o arraste aplica e um "match" que decide
// quais leads ficam nela. Colunas de qualificação (q_prod/q_prest) não guardam
// leads: ao soltar, o lead muda de tipo/etapa e migra para a aba do tipo.
const COL = {
  novo: { key: 'novo', label: 'Novo lead', patch: { status: 'novo' }, match: (l) => (l.status || 'novo') === 'novo' },
  triagem: { key: 'triagem', label: 'Em triagem', patch: { status: 'triagem' }, match: (l) => l.status === 'triagem' },
  q_prod: { key: 'q_prod', label: '🌾 → Produtores', patch: { status: 'qualificado', tipo: 'produtor' }, match: () => false, envia: 'Produtores' },
  q_pec: { key: 'q_pec', label: '🐄 → Pecuaristas', patch: { status: 'qualificado', tipo: 'pecuarista' }, match: () => false, envia: 'Pecuaristas' },
  q_prest: { key: 'q_prest', label: '🔧 → Prestadores', patch: { status: 'qualificado', tipo: 'prestador' }, match: () => false, envia: 'Prestadores' },
  curioso: { key: 'curioso', label: '🧐 Só curioso', patch: { status: 'curioso', tipo: '' }, match: (l) => l.status === 'curioso' },
  perd_sdr: { key: 'perd_sdr', label: 'Perdido na triagem', patch: { status: 'perdido' }, match: (l) => l.status === 'perdido' && !l.tipo },
  recebido: { key: 'recebido', label: '📥 Recebido do SDR', patch: { status: 'qualificado' }, match: (l) => l.status === 'qualificado' },
  decidindo: { key: 'decidindo', label: '🤔 Decidindo', patch: { status: 'decidindo' }, match: (l) => l.status === 'decidindo' },
  negociacao: { key: 'negociacao', label: 'Em negociação', patch: { status: 'negociacao' }, match: (l) => l.status === 'negociacao' },
  proposta: { key: 'proposta', label: 'Proposta enviada', patch: { status: 'proposta' }, match: (l) => l.status === 'proposta' },
  financiamento: { key: 'financiamento', label: '⏳ Aguardando financiamento', patch: { status: 'financiamento' }, match: (l) => l.status === 'financiamento' },
  ganho: { key: 'ganho', label: '🏆 Ganho', patch: { status: 'ganho' }, match: (l) => l.status === 'ganho' },
  desistiu: { key: 'desistiu', label: '🚫 Desistiu', patch: { status: 'desistiu' }, match: (l) => l.status === 'desistiu' },
  perdido: { key: 'perdido', label: '🚩 Perdido p/ concorrente', patch: { status: 'perdido' }, match: (l) => l.status === 'perdido' },
};

// Funis de venda, cada um numa aba. Produtores/Pecuaristas/Prestadores são
// iguais em etapas, mas separados pelo "tipo".
const FUNIS = {
  sdr: {
    papel: 'sdr', campo: 'sdr',
    colunas: [COL.novo, COL.triagem, COL.q_prod, COL.q_pec, COL.q_prest, COL.curioso, COL.perd_sdr],
    inclui: (l) => ['novo', 'triagem'].includes(l.status || 'novo') || l.status === 'curioso' || (l.status === 'perdido' && !l.tipo),
  },
  produtor: {
    papel: 'vendedor', campo: 'vendedor', tipo: 'produtor',
    colunas: [COL.recebido, COL.decidindo, COL.negociacao, COL.proposta, COL.financiamento, COL.ganho, COL.desistiu, COL.perdido],
    inclui: (l) => l.tipo === 'produtor' && (SALES.includes(l.status) || l.status === 'desistiu' || l.status === 'perdido'),
  },
  pecuarista: {
    papel: 'vendedor', campo: 'vendedor', tipo: 'pecuarista',
    colunas: [COL.recebido, COL.decidindo, COL.negociacao, COL.proposta, COL.financiamento, COL.ganho, COL.desistiu, COL.perdido],
    inclui: (l) => l.tipo === 'pecuarista' && (SALES.includes(l.status) || l.status === 'desistiu' || l.status === 'perdido'),
  },
  prestador: {
    papel: 'vendedor', campo: 'vendedor', tipo: 'prestador',
    colunas: [COL.recebido, COL.decidindo, COL.negociacao, COL.proposta, COL.financiamento, COL.ganho, COL.desistiu, COL.perdido],
    inclui: (l) => l.tipo === 'prestador' && (SALES.includes(l.status) || l.status === 'desistiu' || l.status === 'perdido'),
  },
};
const SALES = ['qualificado', 'decidindo', 'negociacao', 'proposta', 'financiamento', 'ganho'];

// Painel de SERVIÇOS (pós-venda): o cliente que comprou o drone entra aqui em
// paralelo. As colunas usam `status_servico` (não `status`).
const SCOL = {
  recebido_serv: { key: 'recebido_serv', label: '🔧 Cliente com drone', patch: { status_servico: 'recebido_serv' }, match: (l) => l.status_servico === 'recebido_serv' },
  ofertado: { key: 'ofertado', label: '📞 Ofereci o serviço', patch: { status_servico: 'ofertado' }, match: (l) => l.status_servico === 'ofertado' },
  negociando_serv: { key: 'negociando_serv', label: '💬 Negociando', patch: { status_servico: 'negociando_serv' }, match: (l) => l.status_servico === 'negociando_serv' },
  proposta_serv: { key: 'proposta_serv', label: '📄 Proposta enviada', patch: { status_servico: 'proposta_serv' }, match: (l) => l.status_servico === 'proposta_serv' },
  vendido_serv: { key: 'vendido_serv', label: '🏆 Serviço vendido', patch: { status_servico: 'vendido_serv' }, match: (l) => l.status_servico === 'vendido_serv' },
  recusado_serv: { key: 'recusado_serv', label: '❌ Não quis', patch: { status_servico: 'recusado_serv' }, match: (l) => l.status_servico === 'recusado_serv' },
};
FUNIS.servicos = {
  papel: 'vendedor', campo: 'vendedor', servico: true,
  colunas: [SCOL.recebido_serv, SCOL.ofertado, SCOL.negociando_serv, SCOL.proposta_serv, SCOL.vendido_serv, SCOL.recusado_serv],
  inclui: (l) => !!l.em_servicos,
};
const SERVICO_LABEL = {
  recebido_serv: '🔧 Cliente com drone', ofertado: '📞 Ofereci o serviço',
  negociando_serv: '💬 Negociando', proposta_serv: '📄 Proposta enviada',
  vendido_serv: '🏆 Serviço vendido', recusado_serv: '❌ Não quis',
};

let leadsCache = [];
let primeiroLoadFeito = false; // só avisa "nada encontrado" depois do 1º carregamento
let members = [];
let campaigns = [];
let settings = {};
let me = null; // usuário logado {nome, papel: admin|gerente|vendedor|sdr}
let currentFilters = { q: '', canal: '', lane: '', pagamento: '', produto: '', cidade: '', mesorregiao: '', hectare: '', vendedor: '', sdr: '' };
let escopo = 'atuais'; // 'atuais' (funil dos leads novos) | 'recuperacao' (clientes antigos)

// Faixas de hectare (min/max em ha; max null = sem teto)
const HECTARE_RANGES = {
  '0-500': { min: 0, max: 500 },
  '500-1000': { min: 500, max: 1000 },
  '1000-2000': { min: 1000, max: 2000 },
  '2000-5000': { min: 2000, max: 5000 },
  '5000+': { min: 5000, max: null },
};

// Formas de pagamento (batem com o servidor). Ordem = ordem no formulário.
const PAGAMENTOS = ['À vista', 'Financiamento', 'Cartão BNDES', 'Cartão de crédito',
  'Permuta / Troca', 'Consórcio', 'CPR', 'Boleto / Parcelado', 'Outro'];
// Formas que aceitam entrada + parcelamento
const PARCELAVEIS = new Set(['Financiamento', 'Cartão BNDES', 'Cartão de crédito',
  'Consórcio', 'CPR', 'Boleto / Parcelado']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, txt) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
};
const brl = (n) =>
  (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

// Link para abrir a conversa do cliente no WhatsApp (wa.me exige só os dígitos
// com o código do país). Se veio sem o 55 do Brasil (DDD + número), adiciona.
function waHref(telefone) {
  let d = String(telefone || '').replace(/\D/g, '');
  if (d.length < 8) return '';
  if (d.length <= 11) d = '55' + d; // 10-11 dígitos = DDD + número, sem o país
  return 'https://wa.me/' + d;
}

// Data/hora curta (18/07 14:32) e completa
function dataHora(iso, completa) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  const opt = completa
    ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' };
  return d.toLocaleString('pt-BR', opt);
}
// Duração legível a partir de milissegundos (2h 15min, 3 dias, 40min)
function duracao(ms) {
  if (ms == null || ms < 0) return '—';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'menos de 1min';
  if (min < 60) return min + 'min';
  const h = Math.floor(min / 60);
  if (h < 24) return h + 'h' + (min % 60 ? ' ' + (min % 60) + 'min' : '');
  const dias = Math.floor(h / 24);
  return dias + (dias === 1 ? ' dia' : ' dias') + (h % 24 ? ' ' + (h % 24) + 'h' : '');
}
function msEntre(aIso, bIso) {
  if (!aIso || !bIso) return null;
  const a = new Date(aIso), b = new Date(bIso);
  if (isNaN(a) || isNaN(b)) return null;
  return b - a;
}
// Tempo que o vendedor levou para atender (da qualificação até assumir),
// ou o tempo que o lead está esperando atendimento (se ainda sem vendedor).
function tempoAtendimento(lead) {
  const ref = lead.qualificado_em || lead.created_at;
  if (lead.atendido_em) return { atendido: true, ms: msEntre(ref, lead.atendido_em) };
  if (SALES.includes(lead.status) && !lead.vendedor) return { atendido: false, ms: Date.now() - new Date(ref) };
  return null;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2400);
}

async function api(path, opts) {
  const metodo = ((opts && opts.method) || 'GET').toUpperCase();
  let res;
  try {
    res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  } catch (_) {
    // fetch falhou = sem rede / servidor inacessível. Só uma ESCRITA nos diz isso
    // com certeza (GET pode vir do cache do service worker mesmo offline).
    if (metodo !== 'GET') marcaOffline(true);
    const e = new Error('Sem conexão com o servidor'); e.offline = true; throw e;
  }
  if (metodo !== 'GET') marcaOffline(false); // uma escrita que passou = estamos online
  if (res.status === 401) {
    window.location.href = 'login.html'; // sessão expirou: volta pro login
    throw new Error('Sessão expirada');
  }
  if (!res.ok) {
    let msg = 'Erro na requisição';
    try { msg = (await res.json()).error || msg; } catch (_) {}
    const e = new Error(msg); e.status = res.status; throw e; // status p/ a fila decidir
  }
  return res.status === 204 ? null : res.json();
}

// ===========================================================================
// OFFLINE — o vendedor no campo (sem sinal) abre o CRM (service worker), vê os
// leads carregados antes e registra VISITA/NOTA; tudo fica guardado no aparelho
// (IndexedDB) e é enviado sozinho quando o sinal volta. As escritas levam um
// op_id: se uma foi enviada mas a resposta se perdeu, o servidor ignora a 2ª.
// ===========================================================================
let estaOffline = !navigator.onLine;
let flushando = false;

function gerarOpId() {
  return 'op_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// --- fila persistente (IndexedDB) ---
function abreDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('sem indexedDB'));
    const r = indexedDB.open('nova-era-offline', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('fila')) db.createObjectStore('fila', { keyPath: 'op_id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function filaAdd(item) {
  const db = await abreDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('fila', 'readwrite');
    tx.objectStore('fila').put(item);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function filaTodos() {
  const db = await abreDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('fila', 'readonly');
    const q = tx.objectStore('fila').getAll();
    q.onsuccess = () => res(q.result || []);
    q.onerror = () => rej(q.error);
  });
}
async function filaDel(opId) {
  const db = await abreDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('fila', 'readwrite');
    tx.objectStore('fila').delete(opId);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function filaCount() { try { return (await filaTodos()).length; } catch (_) { return 0; } }

// apaga do cache do service worker as respostas de /api/* (dados do usuário) —
// chamado no logout para o próximo login não herdar leads/fotos de quem saiu.
async function limpaCacheApi() {
  if (!('caches' in window)) return;
  try {
    for (const nome of await caches.keys()) {
      const c = await caches.open(nome);
      for (const req of await c.keys()) {
        if (new URL(req.url).pathname.startsWith('/api/')) await c.delete(req);
      }
    }
  } catch (_) { /* cache indisponível: ignora */ }
}

// --- estado/UI ---
function marcaOffline(off) {
  if (estaOffline === off) return;
  estaOffline = off;
  atualizaOfflineBar();
}
async function atualizaOfflineBar() {
  const bar = $('#offlineBar');
  if (!bar) return;
  const n = await filaCount();
  if (estaOffline) {
    bar.hidden = false;
    bar.classList.remove('enviando');
    bar.textContent = n
      ? `📴 Sem internet — ${n} registro(s) salvo(s) no aparelho; envio sozinho quando o sinal voltar.`
      : '📴 Sem internet — você pode registrar visitas e notas; envio sozinho quando o sinal voltar.';
  } else if (n) {
    bar.hidden = false;
    bar.classList.add('enviando');
    bar.textContent = `⏳ Enviando ${n} registro(s) salvo(s) no aparelho…`;
  } else {
    bar.hidden = true;
    bar.classList.remove('enviando');
  }
}

// monta a "visita" local (otimista) a partir do corpo enviado
function visitaLocalDoBody(body, opId) {
  return {
    id: opId, op_id: opId, data: body.criado_em || new Date().toISOString(),
    visitante: (me && me.nome) || 'Você', resultado: body.resultado || '',
    obs: body.obs || '', foto: body.foto || '', lat: body.lat, lng: body.lng,
    _pendente: true,
  };
}

// aplica no cache local (para aparecer na hora, mesmo offline)
function aplicaVisitaLocal(id, visita, pendente) {
  const lead = leadsCache.find((l) => l.id === id);
  if (!lead) return;
  lead.visitas = lead.visitas || [];
  if (!lead.visitas.some((v) => v.op_id && v.op_id === visita.op_id)) lead.visitas.push(visita);
  lead.historico = lead.historico || [];
  lead.historico.push({
    data: visita.data, autor: visita.visitante, papel: me && me.papel,
    itens: ['🚗 Visita registrada' + (visita.resultado ? ': ' + visita.resultado : '')],
    op_id: visita.op_id, _pendente: !!pendente,
  });
  lead.updated_at = visita.data;
  renderVisitas(lead); renderHistorico(lead); renderBoard();
}

// junta os registros ainda pendentes (IndexedDB) aos leads recém-carregados,
// para que continuem visíveis mesmo se o app for reaberto offline
async function mesclaFilaPendente() {
  let itens;
  try { itens = await filaTodos(); } catch (_) { return; }
  if (!itens.length) return;
  for (const it of itens) {
    const lead = leadsCache.find((l) => l.id === it.lead_id);
    if (!lead) continue;
    lead.historico = lead.historico || [];
    if (lead.historico.some((h) => h.op_id === it.op_id)) continue;
    if (it.tipo === 'visita') {
      lead.visitas = lead.visitas || [];
      if (!lead.visitas.some((v) => v.op_id === it.op_id)) lead.visitas.push(visitaLocalDoBody(it.body, it.op_id));
      lead.historico.push({
        data: it.criado_em, autor: (me && me.nome) || 'Você', papel: me && me.papel,
        itens: ['🚗 Visita registrada' + (it.body.resultado ? ': ' + it.body.resultado : '')],
        op_id: it.op_id, _pendente: true,
      });
    } else if (it.tipo === 'nota') {
      lead.historico.push({
        data: it.criado_em, autor: (me && me.nome) || 'Você', papel: me && me.papel,
        itens: ['💬 ' + it.body.texto], tipo: 'nota', op_id: it.op_id, _pendente: true,
      });
    }
  }
}

// envia a fila quando há sinal. Chamado no boot, no evento 'online' e a cada
// ciclo de atualização. NUNCA descarta silenciosamente um registro do campo:
// - sem sinal / sessão expirada (401) / servidor fora (5xx): PARA e mantém tudo
//   para tentar de novo depois (a idempotência por op_id evita duplicar);
// - registro recusado por validação (400/422): descarta, mas AVISA na tela;
// - outros erros por lead (403/404): mantém e segue, sem travar os demais.
async function flushFila() {
  if (flushando) return;
  flushando = true; // trava síncrona (antes de qualquer await): sem corrida entre gatilhos
  try {
    let itens;
    try { itens = await filaTodos(); } catch (_) { return; }
    if (!itens.length) { atualizaOfflineBar(); return; }
    itens.sort((a, b) => (a.criado_em < b.criado_em ? -1 : 1));
    let enviados = 0;
    atualizaOfflineBar();
    for (const it of itens) {
      try {
        await api(it.url, { method: 'POST', body: JSON.stringify(it.body) });
        await filaDel(it.op_id);
        enviados++;
      } catch (err) {
        const st = err.status || 0;
        if (err.offline || st === 401 || st >= 500) break; // sistêmico: para e mantém TUDO
        if (st === 400 || st === 422) {                    // inválido: nunca entra — descarta com aviso
          await filaDel(it.op_id);
          toast('⚠️ Um registro do campo foi recusado pelo servidor e não pôde ser enviado.');
          continue;
        }
        console.warn('Registro offline mantido p/ tentar depois:', it.tipo, st, err.message);
        // 403/404 e afins: mantém na fila (não perde) e segue para os próximos
      }
    }
    if (enviados) {
      toast(`✅ ${enviados} registro(s) do campo enviado(s)`);
      try { await loadLeads(); } catch (_) {} // reconcilia com a verdade do servidor
    }
    atualizaOfflineBar();
  } finally { flushando = false; }
}

window.addEventListener('offline', () => marcaOffline(true));
window.addEventListener('online', () => { marcaOffline(false); flushFila(); });

// Dono do lead DENTRO de um funil (SDR no funil SDR, vendedor no de Vendas)
function laneKeyForLead(lead, funil) {
  return String(lead[funil.campo] || '').trim() || '__none__';
}

// ---------------------------------------------------------------------------
// Carregar dados
// ---------------------------------------------------------------------------
async function loadStats() {
  try {
    const s = await api('/api/stats?escopo=' + escopo);
    STAGES = s.stages || STAGES;
    // prazos dos alertas chegam a TODOS os papéis por aqui (settings via campanhas
    // pode ser só do gestor); mantém os badges corretos para os vendedores também
    if (s.cadencia_dias) settings.cadencia_dias = s.cadencia_dias;
    if (s.resposta_horas) settings.resposta_horas = s.resposta_horas;
    atualizaEscopoSwitch(s.atuais_total, s.recuperacao_total, s.servicos_total);
    const box = $('#stats');
    box.innerHTML = '';
    const cards = [
      { n: s.total, l: 'Leads' },
      { n: s.produtores || 0, l: '🌾 Produtores' },
      { n: s.pecuaristas || 0, l: '🐄 Pecuaristas' },
      { n: s.prestadores || 0, l: '🔧 Prestadores' },
      { n: (s.por_status.ganho || {}).count || 0, l: '🏆 Ganhos' },
      { n: brl(s.valor_pipeline), l: '💰 Pipeline' },
    ];
    // só aparece quando há alertas (mantém a barra enxuta); clica p/ abrir a
    // central. No painel de Serviços não faz sentido (evita beco sem saída).
    if (s.alertas && escopo !== 'servicos') {
      cards.push({ n: s.alertas, l: '🔔 Alertas', cls: 'wait', acao: abrirAlertas });
    }
    for (const c of cards) {
      const d = el('div', 'stat' + (c.cls ? ' ' + c.cls : ''));
      d.append(el('div', 'n', String(c.n)), el('div', 'l', c.l));
      if (c.acao) { d.classList.add('clicavel'); d.title = 'Ver só os que aguardam registro'; d.onclick = c.acao; }
      box.append(d);
    }
    preencheFiltroCidades(s.cidades || []);
    mesorregioesDisp = s.mesorregioes || mesorregioesDisp;
    refreshChipOptions('mesorregiao');
  } catch (err) { console.error(err); }
}

// cidades que existem nos leads (para as opções do filtro de cidade)
function preencheFiltroCidades(lista) {
  cidadesDisponiveis = lista;
  refreshChipOptions('cidade');
}

// Filtro ativo = qualquer chip COM valor ou a busca preenchida. A busca conta:
// sem isso o botão "Limpar tudo" ficava escondido e o usuário não tinha como
// desfazer uma busca que estava escondendo todos os leads (só o F5 resolvia).
function filtroAtivo() {
  return !!currentFilters.q || Object.keys(FILTER_DEFS).some((k) => currentFilters[k]);
}

function atualizaBotaoLimpar() {
  $('#btnLimparFiltros').hidden = chipsAtivos.length === 0 && !currentFilters.q;
}

// Quantos leads a ABA ATUAL mostraria. O quadro exibe só a fatia do funil, então
// contar o cache inteiro daria "tudo certo" com a tela vazia.
function leadsDaVisao() {
  if (currentView === 'perdidos') return leadsCache.filter((l) => l.status === 'perdido');
  if (currentView === 'desistiu') return leadsCache.filter((l) => l.status === 'desistiu');
  if (currentView === 'alertas') return leadsCache.filter((l) => !!l.aguardando_resposta || !!precisaRetorno(l));
  if (currentView === 'map') return leadsCache.slice();
  return leadsCache.filter((FUNIS[currentView] || FUNIS.sdr).inclui);
}
function leadsNaVisao() { return leadsDaVisao().length; }
const VIEW_LABEL = {
  sdr: 'Funil SDR', produtor: 'Produtores', pecuarista: 'Pecuaristas', prestador: 'Prestadores',
  perdidos: 'Perdido p/ concorrente', desistiu: 'Desistiu', map: 'Mapa', servicos: 'Serviços',
};
// resultados terminais que a ação em massa nunca deve alterar
const STATUS_ENCERRADOS = ['ganho', 'perdido', 'desistiu', 'curioso'];
function alvosMassa() {
  return leadsDaVisao().filter((l) => !STATUS_ENCERRADOS.includes(l.status));
}

// Se a busca/filtro escondeu os leads DESTA aba, avisa em vez de deixar um quadro
// mudo (que parecia "sumiu tudo / bugou") e oferece o botão para limpar.
function atualizaEstadoVazio() {
  const box = $('#emptyFiltro');
  if (!box) return;
  if (currentView === 'alertas') { box.hidden = true; return; } // tem estado-vazio próprio
  if (!primeiroLoadFeito) { box.hidden = true; return; } // evita piscar no boot
  const vazio = leadsNaVisao() === 0 && filtroAtivo();
  const mudou = box.hidden === vazio;
  box.hidden = !vazio;
  if (vazio) {
    const noutrasAbas = leadsCache.length;
    const alvo = currentFilters.q
      ? `à busca "${currentFilters.q}" e aos filtros atuais`
      : 'aos filtros atuais';
    $('#emptyFiltroTexto').textContent = noutrasAbas > 0
      ? `Nenhum lead desta aba corresponde ${alvo} — há ${noutrasAbas} em outras abas. Seus leads continuam salvos.`
      : `Nenhum lead corresponde ${alvo} — seus leads continuam salvos.`;
  }
  // o aviso entra/sai do fluxo e muda a altura do mapa; o Leaflet só se remede
  // sozinho quando a janela muda de tamanho
  if (mudou && currentView === 'map' && map) setTimeout(() => map.invalidateSize(), 60);
}

async function loadMembers() {
  const data = await api('/api/members');
  members = data.members || [];
}

async function loadCampaigns() {
  const data = await api('/api/campaigns');
  campaigns = data.campaigns || [];
  settings = data.settings || {};
}

// ---------------------------------------------------------------------------
// Cidades (IBGE) — autocompletar do campo Região
// ---------------------------------------------------------------------------
let cidades = [];
let cidadesSet = new Set();

async function loadCidades() {
  try {
    const res = await fetch('cidades.json');
    cidades = await res.json();
    cidadesSet = new Set(cidades.map((c) => c.toLowerCase()));
  } catch (err) { console.error('Falha ao carregar cidades:', err); }
}

// Dropdown próprio (o datalist nativo falha no Safari): lista as 12 melhores
// sob o campo; clique ou ↑/↓ + Enter escolhem.
function buscarCidades(q) {
  q = (q || '').toLowerCase().trim();
  if (q.length < 2 || !cidades.length) return [];
  const comeca = [];
  const contem = [];
  for (const c of cidades) {
    const lc = c.toLowerCase();
    if (lc.startsWith(q)) comeca.push(c);
    else if (lc.includes(q)) contem.push(c);
    if (comeca.length >= 12) break;
  }
  return [...comeca, ...contem].slice(0, 12);
}

let acSel = -1; // índice destacado no dropdown

function renderCidadeBox(q) {
  const box = $('#cidadesBox');
  const matches = buscarCidades(q);
  acSel = -1;
  box.innerHTML = '';
  if (!matches.length) {
    if ((q || '').trim().length >= 2 && cidades.length) {
      box.append(el('div', 'ac-empty', 'Nenhuma cidade encontrada — confira a grafia'));
      box.hidden = false;
    } else {
      box.hidden = true;
    }
    return;
  }
  for (const c of matches) {
    const item = el('div', 'ac-item', c);
    // mousedown (não click): dispara antes do blur do input esconder a caixa
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      escolherCidade(c);
    });
    box.append(item);
  }
  box.hidden = false;
}

function escolherCidade(c) {
  form.regiao.value = c;
  $('#cidadesBox').hidden = true;
}

function cidadeKeydown(e) {
  const box = $('#cidadesBox');
  if (box.hidden) return;
  const items = [...box.querySelectorAll('.ac-item')];
  if (!items.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    acSel = e.key === 'ArrowDown'
      ? (acSel + 1) % items.length
      : (acSel - 1 + items.length) % items.length;
    items.forEach((it, i) => it.classList.toggle('sel', i === acSel));
    items[acSel].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    escolherCidade(items[acSel >= 0 ? acSel : 0].textContent);
  } else if (e.key === 'Escape') {
    e.stopPropagation(); // não deixa o Esc fechar o modal junto
    box.hidden = true;
  }
}

function cidadeValida(valor) {
  if (!valor || !cidadesSet.size) return true; // vazio ou lista indisponível: deixa passar
  return cidadesSet.has(valor.toLowerCase().trim());
}

// ---------------------------------------------------------------------------
// Mapa de clientes
// ---------------------------------------------------------------------------
let cidadesGeo = {};   // "Nome - UF" -> [lat, lng] (centro do município, IBGE)
let map = null;        // instância Leaflet (criada no 1º acesso à aba)
let markersLayer = null;
let currentView = 'sdr'; // 'sdr' | 'vendas' | 'map'

async function loadCidadesGeo() {
  try {
    const res = await fetch('cidades_geo.json');
    cidadesGeo = await res.json();
  } catch (err) { console.error('Falha ao carregar coordenadas das cidades:', err); }
}

// Espalha pinos aproximados da mesma cidade (determinístico por id) para não
// ficarem todos empilhados no mesmo ponto.
function jitter(id, amp) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const ang = (h % 360) * Math.PI / 180;
  const raio = amp * (0.35 + ((h >>> 9) % 650) / 1000);
  return [raio * Math.cos(ang), raio * Math.sin(ang)];
}

function leadPosition(lead) {
  if (lead.lat != null && lead.lng != null) return { pos: [lead.lat, lead.lng], exato: true };
  const c = cidadesGeo[lead.regiao];
  if (!c) return null; // sem cidade reconhecida: fica fora do mapa
  const [dx, dy] = jitter(lead.id, 0.01); // ~1 km em volta do centro
  return { pos: [c[0] + dx, c[1] + dy], exato: false };
}

function ensureMap() {
  if (map) return;
  map = L.map('map').setView([-15.8, -52.5], 5); // Brasil central

  // Satélite (Esri World Imagery) + nomes de cidades/divisas por cima
  const satelite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: 'Imagens © Esri, Maxar, Earthstar Geographics' }
  );
  const nomes = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19 }
  );
  const sateliteComNomes = L.layerGroup([satelite, nomes]);

  // Alternativa: mapa de ruas (OpenStreetMap)
  const ruas = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  });

  sateliteComNomes.addTo(map); // satélite é o padrão
  L.control.layers(
    { '🛰️ Satélite': sateliteComNomes, '🗺️ Ruas': ruas },
    null,
    { position: 'topright' }
  ).addTo(map);

  markersLayer = L.layerGroup().addTo(map);

  // No modo "ajustar local", um clique no mapa marca a fazenda do lead.
  map.on('click', (e) => {
    if (!ajustandoId) return;
    const lead = leadsCache.find((l) => l.id === ajustandoId);
    ajustandoId = null;
    if (lead) salvarLocalizacao(lead, Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6)));
  });
}

async function salvarLocalizacao(lead, lat, lng) {
  try {
    await api('/api/leads/' + encodeURIComponent(lead.id), {
      method: 'PATCH', body: JSON.stringify({ lat, lng }),
    });
    lead.lat = lat; lead.lng = lng;
    toast('📍 Localização exata salva' + (lead.nome ? ' — ' + lead.nome : ''));
  } catch (err) {
    toast('Erro ao salvar localização: ' + err.message);
  }
  renderMap();
}

let ajustandoId = null; // id do lead em modo "ajustar local" (clicar no mapa)

// ---- Atividade recente / "lead quente" -----------------------------------
// Conta quantas atualizações o lead teve nos últimos HEAT_DIAS dias (qualquer
// entrada do histórico: nota escrita, visita, mudança de etapa, retorno do
// cliente…). Pouca atividade recente = 👍 contato recente; muita = 🔥 quente.
const HEAT_DIAS = 7;      // janela do "recente"
const HEAT_QUENTE = 3;    // nº de atualizações recentes p/ virar 🔥
function atividadeRecente(lead) {
  const hist = (lead && lead.historico) || [];
  if (!hist.length) return 0;
  const limite = Date.now() - HEAT_DIAS * 86400000;
  let n = 0;
  for (const h of hist) {
    if (h.tipo === 'novo') continue; // criar o lead não é engajamento (não esquenta)
    const t = new Date(h.data).getTime();
    if (!isNaN(t) && t >= limite) n++;
  }
  return n;
}
function heatLevel(lead) {
  const n = atividadeRecente(lead);
  if (n >= HEAT_QUENTE) return 'quente';
  if (n >= 1) return 'recente';
  return '';
}
function heatEmoji(lead) {
  const lv = heatLevel(lead);
  return lv === 'quente' ? '🔥' : lv === 'recente' ? '👍' : '';
}
// Prazos configuráveis (painel ⏰ Alertas), com padrões e limites de segurança.
function respostaHoras() { const v = parseInt(settings.resposta_horas, 10); return (v >= 1 && v <= 168) ? v : 3; }
function cadenciaDias() { const v = parseInt(settings.cadencia_dias, 10); return (v >= 1 && v <= 30) ? v : 2; }

// "Aguardando o vendedor registrar a resposta" (setado ao clicar no WhatsApp).
// Fica amarelo e, passadas respostaHoras() horas sem registro, vira vermelho.
function aguardaResposta(lead) {
  const t = lead && lead.aguardando_resposta ? new Date(lead.aguardando_resposta).getTime() : NaN;
  if (isNaN(t)) return null;
  const ms = Date.now() - t;
  return { ms, urgente: ms >= respostaHoras() * 3600000 };
}

// Alerta de RETORNO: lead ativo parado há X dias sem contato. Quentes 🔥 são
// cobrados na metade do prazo. Não aparece se já está aguardando resposta.
// nivel: 'quente' (vermelho) | 'morno' (laranja) | 'frio' (amarelo).
function precisaRetorno(lead) {
  if (!lead) return null;
  if (STATUS_ENCERRADOS.includes(lead.status)) return null;
  if (lead.aguardando_resposta) return null;
  const heat = heatLevel(lead); // '' | 'recente' | 'quente'
  const base = cadenciaDias();
  const limiteDias = heat === 'quente' ? Math.max(1, Math.ceil(base / 2)) : base;
  const t = new Date(lead.updated_at || lead.created_at).getTime();
  if (isNaN(t)) return null;
  const ms = Date.now() - t;
  if (ms < limiteDias * 86400000) return null;
  return { ms, nivel: heat === 'quente' ? 'quente' : heat === 'recente' ? 'morno' : 'frio' };
}
// Clicar no WhatsApp = "contatei o cliente": marca a pendência de registrar a
// resposta e anota no histórico. Roda em segundo plano; nunca atrapalha o link.
async function registrarContatoWhatsapp(id) {
  if (!id) return;
  try {
    const res = await api('/api/leads/' + encodeURIComponent(id) + '/contato-whatsapp', { method: 'POST' });
    const lead = leadsCache.find((l) => l.id === id);
    if (lead && res && res.lead) {
      Object.assign(lead, res.lead);
      renderBoard();
      if (form.id.value === id) renderHistorico(lead); // ficha aberta: atualiza o histórico
      loadStats();
    }
  } catch (_) { /* silencioso: abrir a conversa é o que importa */ }
}
// papelLabel usa o PAPEL_LABEL definido mais abaixo (seção de Usuários);
// é chamado só em tempo de execução (renderHistorico), então não há TDZ.
const papelLabel = (p) => PAPEL_LABEL[p] || p || '';

function pinClass(lead, exato) {
  if (lead.status === 'ganho') return 'won';
  if (lead.status === 'perdido') return 'lost';
  if (lead.status === 'desistiu') return 'gaveup';
  if (lead.status === 'curioso') return 'curioso';
  return exato ? 'exato' : 'aprox';
}
function pinFlag(lead) {
  if (lead.status === 'curioso') return '<span class="pin-flag">🧐</span>';
  if (lead.status === 'desistiu') return '<span class="pin-flag">🚫</span>';
  if (lead.status === 'ganho') return '<span class="pin-flag">🟢</span>';
  if (lead.status === 'perdido') return '<span class="pin-flag">🔴</span>';
  return '';
}
function pinHeat(lead) {
  const lv = heatLevel(lead);
  if (!lv) return '';
  return `<span class="pin-heat ${lv}">${lv === 'quente' ? '🔥' : '👍'}</span>`;
}
// Cliente com a proposta aceita, esperando o banco liberar o recurso: ampulheta
// girando em volta do pino ("carregando" = dinheiro a caminho).
function pinFin(lead) {
  return lead.status === 'financiamento' ? '<span class="pin-fin">⏳</span>' : '';
}

function renderMap() {
  if (!map) return;
  markersLayer.clearLayers();
  const bounds = [];
  for (const lead of leadsCache) {
    const loc = leadPosition(lead);
    if (!loc) continue;
    const ajustando = ajustandoId === lead.id;
    const icon = L.divIcon({
      className: '',
      html: `<div class="lead-pin ${pinClass(lead, loc.exato)} heat-${heatLevel(lead) || 'none'}${lead.status === 'financiamento' ? ' aguardando' : ''}${ajustando ? ' movendo' : ''}"></div>${pinFlag(lead)}${pinHeat(lead)}${pinFin(lead)}`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    // só arrasta quando o usuário pediu para ajustar (evita mover sem querer)
    const mk = L.marker(loc.pos, { icon, draggable: ajustando });

    const pop = el('div', 'map-popup');
    const nome = el('div', 'pp-nome');
    if (lead.status === 'ganho') nome.append(el('span', 'flag', '🟢 '));
    else if (lead.status === 'perdido') nome.append(el('span', 'flag', '🔴 '));
    else if (lead.status === 'desistiu') nome.append(el('span', 'flag', '🚫 '));
    else if (lead.status === 'curioso') nome.append(el('span', 'flag', '🧐 '));
    nome.append(document.createTextNode(lead.nome || '(sem nome)'));
    pop.append(nome);
    if (lead.regiao) pop.append(el('div', 'pp-linha', '📍 ' + lead.regiao + (loc.exato ? ' · fazenda exata' : ' · local aproximado')));
    const pedidoPop = resumoItens(lead);
    if (pedidoPop) pop.append(el('div', 'pp-linha', '📦 ' + pedidoPop));
    if (lead.valor > 0) pop.append(el('div', 'pp-linha', '💰 ' + brl(lead.valor)));
    const resp = lead.vendedor || lead.sdr;
    if (resp) pop.append(el('div', 'pp-linha', '👤 ' + resp));
    if (lead.status === 'financiamento') {
      pop.append(el('div', 'pp-linha pp-fin', '⏳ Aguardando liberação do financiamento'));
    }
    const hlv = heatLevel(lead);
    if (hlv) {
      const nAt = atividadeRecente(lead);
      pop.append(el('div', 'pp-linha pp-heat', (hlv === 'quente' ? '🔥 Lead quente' : '👍 Contato recente')
        + ` · ${nAt} ${nAt > 1 ? 'atualizações' : 'atualização'} em ${HEAT_DIAS} dias`));
    }

    const acoes = el('div', 'pp-acoes');
    const waH = waHref(lead.telefone);
    if (waH) {
      const wa = document.createElement('a');
      wa.className = 'pp-btn wa'; wa.href = waH; wa.target = '_blank'; wa.rel = 'noopener';
      wa.textContent = '💬 WhatsApp';
      wa.addEventListener('click', () => registrarContatoWhatsapp(lead.id));
      acoes.append(wa);
    }
    const bEdit = el('button', 'pp-btn', '✏️ Editar lead');
    bEdit.type = 'button';
    bEdit.onclick = () => { map.closePopup(); openModal(lead); };
    acoes.append(bEdit);
    if (ajustando) {
      const bOk = el('button', 'pp-btn primary', '👆 Clique no mapa p/ marcar');
      bOk.type = 'button';
      bOk.onclick = () => { ajustandoId = null; renderMap(); };
      acoes.append(bOk);
    } else {
      const bLoc = el('button', 'pp-btn', '📍 Ajustar local');
      bLoc.type = 'button';
      bLoc.onclick = () => { ajustandoId = lead.id; map.closePopup(); renderMap();
        toast('Clique no mapa onde fica a fazenda (ou arraste o pino)'); };
      acoes.append(bLoc);
    }
    pop.append(acoes);
    mk.bindPopup(pop);

    mk.on('dragend', () => {
      const p = mk.getLatLng();
      ajustandoId = null;
      salvarLocalizacao(lead, Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6)));
    });
    mk.addTo(markersLayer);
    bounds.push(loc.pos);
  }
  // enquadra os pinos na primeira renderização com dados
  if (bounds.length && !renderMap._fitted) {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 11 });
    renderMap._fitted = true;
  }
}

function setView(view) {
  currentView = view;
  $('#tabSDR').classList.toggle('active', view === 'sdr');
  $('#tabProdutor').classList.toggle('active', view === 'produtor');
  $('#tabPecuarista').classList.toggle('active', view === 'pecuarista');
  $('#tabPrestador').classList.toggle('active', view === 'prestador');
  $('#tabPerdidos').classList.toggle('active', view === 'perdidos');
  $('#tabDesistiu').classList.toggle('active', view === 'desistiu');
  $('#tabMap').classList.toggle('active', view === 'map');
  $('#boardWrap').hidden = (view === 'map' || view === 'perdidos' || view === 'desistiu' || view === 'alertas');
  $('#mapWrap').hidden = view !== 'map';
  $('#lostWrap').hidden = view !== 'perdidos';
  $('#desistiuWrap').hidden = view !== 'desistiu';
  $('#alertasWrap').hidden = view !== 'alertas';
  if (view === 'map') {
    ensureMap();
    // o container acabou de ficar visível; o Leaflet precisa remedir
    setTimeout(() => { map.invalidateSize(); renderMap(); }, 60);
  } else if (view === 'perdidos') {
    renderLost();
  } else if (view === 'desistiu') {
    renderDesistiu();
  } else if (view === 'alertas') {
    renderAlertas();
  } else {
    renderBoard();
  }
}

// Escopo: "Atuais" (funil de drones dos leads novos) x "Recuperação" (clientes
// antigos) x "Serviços" (pós-venda). Um botão troca o app inteiro entre os lotes.
function atualizaEscopoSwitch(nAtuais, nRecup, nServ) {
  $('#escAtuais').classList.toggle('active', escopo === 'atuais');
  $('#escRecup').classList.toggle('active', escopo === 'recuperacao');
  $('#escServ').classList.toggle('active', escopo === 'servicos');
  document.body.classList.toggle('modo-recuperacao', escopo === 'recuperacao');
  document.body.classList.toggle('modo-servicos', escopo === 'servicos');
  // no painel de Serviços as abas de funil de drone não se aplicam
  $('#viewTabs').hidden = (escopo === 'servicos');
  const badge = (id, n) => { const b = $(id); if (b && n != null) { if (n > 0) { b.hidden = false; b.textContent = n; } else b.hidden = true; } };
  badge('#escRecupBadge', nRecup);
  badge('#escServBadge', nServ);
}
async function setEscopo(novo) {
  if (novo === escopo) return;
  const saindoServicos = (escopo === 'servicos');
  escopo = novo;
  atualizaEscopoSwitch();      // troca visual imediata (esconde abas de drone em Serviços)
  // Serviços tem funil próprio; ao entrar/sair, ajusta a visão (mostra o board certo)
  if (novo === 'servicos') setView('servicos');
  else if (saindoServicos) setView('produtor');
  await refreshAll();          // recarrega leads + stats no novo lote (atualiza os badges)
}

// Lista de casos encerrados (perdido / desistiu) para resgate. Uma função só
// para as duas abas nunca divergirem.
function renderResgate(cfg) {
  const leads = leadsCache.filter((l) => l.status === cfg.status);
  const head = $(cfg.head);
  const valor = leads.reduce((a, l) => a + (Number(l.valor) || 0), 0);
  head.innerHTML = '';
  head.append(el('div', 'lost-count', `${cfg.emoji} ${leads.length} ${leads.length === 1 ? cfg.singular : cfg.plural}`));
  if (valor > 0) head.append(el('div', 'lost-sub', 'Valor que escapou: ' + brl(valor)));
  head.append(el('div', 'lost-sub', 'Abra um card para reativar (mudar a etapa) e resgatar o cliente.'));

  const grid = $(cfg.grid);
  grid.innerHTML = '';
  if (!leads.length) {
    grid.append(el('div', 'lost-empty', filtroAtivo() ? cfg.vazioFiltro : cfg.vazio));
    return;
  }
  leads.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  for (const lead of leads) {
    const card = renderCard(lead);
    card.draggable = false; // aqui não se arrasta; abre para reativar
    grid.append(card);
  }
}

function renderLost() {
  renderResgate({
    status: 'perdido', head: '#lostHead', grid: '#lostGrid', emoji: '🚩',
    singular: 'cliente perdido p/ concorrente', plural: 'clientes perdidos p/ concorrente',
    vazio: 'Nenhum cliente perdido para concorrente. 🎉',
    vazioFiltro: 'Nenhum perdido p/ concorrente corresponde à busca/filtros atuais.',
  });
}

function renderDesistiu() {
  renderResgate({
    status: 'desistiu', head: '#desistiuHead', grid: '#desistiuGrid', emoji: '🚫',
    singular: 'cliente que desistiu', plural: 'clientes que desistiram',
    vazio: 'Ninguém desistiu da compra. 🎉',
    vazioFiltro: 'Nenhuma desistência corresponde à busca/filtros atuais.',
  });
}

// Prioridade do alerta p/ ordenar a central (menor = mais urgente/topo):
// 0 vermelho (resposta urgente ou lead quente), 1 laranja (morno),
// 2 amarelo resposta pendente, 3 amarelo frio. Empate: mais antigo primeiro.
function alertaOrdem(l) {
  const ar = aguardaResposta(l);
  if (ar) return [ar.urgente ? 0 : 2, -ar.ms];
  const rt = precisaRetorno(l);
  if (rt) return [rt.nivel === 'quente' ? 0 : rt.nivel === 'morno' ? 1 : 3, -rt.ms];
  return [9, 0];
}

// Central de Alertas: junta "respostas a registrar" + "retornos a fazer" de TODOS
// os funis num lugar só (o card de stats e o contador são globais). Urgentes no topo.
function renderAlertas() {
  const leads = leadsCache.filter((l) => !!l.aguardando_resposta || !!precisaRetorno(l));
  const head = $('#alertasHead');
  head.innerHTML = '';
  head.append(el('div', 'lost-count', `🔔 ${leads.length} ${leads.length === 1 ? 'lead precisa de você' : 'leads precisam de você'}`));
  head.append(el('div', 'lost-sub', 'Vermelho = urgente. Abra o card, fale com o cliente e registre no histórico — o alerta some.'));

  const grid = $('#alertasGrid');
  grid.innerHTML = '';
  if (!leads.length) {
    grid.append(el('div', 'lost-empty', filtroAtivo()
      ? 'Nenhum alerta corresponde à busca/filtros — limpe os filtros para ver todos.'
      : 'Nenhum alerta agora — tudo em dia. 🎉'));
    return;
  }
  leads.sort((a, b) => {
    const oa = alertaOrdem(a); const ob = alertaOrdem(b);
    return oa[0] !== ob[0] ? oa[0] - ob[0] : oa[1] - ob[1];
  });
  for (const lead of leads) {
    const card = renderCard(lead);
    card.draggable = false; // aqui não se arrasta; abre para agir e registrar
    grid.append(card);
  }
}

async function loadLeads() {
  const params = new URLSearchParams();
  params.set('escopo', escopo); // atuais x recuperação
  if (currentFilters.q) params.set('q', currentFilters.q);
  if (currentFilters.canal) params.set('canal', currentFilters.canal);
  if (currentFilters.pagamento) params.set('pagamento', currentFilters.pagamento);
  if (currentFilters.produto) params.set('produto', currentFilters.produto);
  if (currentFilters.cidade) params.set('cidade', currentFilters.cidade);
  if (currentFilters.mesorregiao) params.set('mesorregiao', currentFilters.mesorregiao);
  if (currentFilters.vendedor) params.set('vendedor', currentFilters.vendedor);
  if (currentFilters.sdr) params.set('sdr', currentFilters.sdr);
  if (currentFilters.hectare && HECTARE_RANGES[currentFilters.hectare]) {
    const r = HECTARE_RANGES[currentFilters.hectare];
    params.set('ha_min', r.min);
    if (r.max != null) params.set('ha_max', r.max);
  }
  atualizaBotaoLimpar();
  const data = await api('/api/leads?' + params.toString());
  STAGES = data.stages || STAGES;
  leadsCache = data.leads || [];
  await mesclaFilaPendente(); // mantém visitas/notas offline visíveis até sincronizar
  primeiroLoadFeito = true;
  if (currentView === 'perdidos') renderLost();
  else if (currentView === 'desistiu') renderDesistiu();
  else if (currentView === 'alertas') renderAlertas();
  else { renderBoard(); if (currentView === 'map') renderMap(); }
  atualizaEstadoVazio();
}

async function refreshAll() {
  // uma falha transitória não pode impedir o load dos leads nem virar
  // unhandled rejection no setInterval
  try {
    await Promise.all([loadStats(), loadMembers(), loadCampaigns()]);
    await loadLeads();
    return true;
  } catch (err) {
    console.error('Falha ao atualizar:', err);
    try { await loadLeads(); } catch (_) { /* servidor fora */ }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Raias (swimlanes)
// ---------------------------------------------------------------------------
function buildLanes(funil, leadsFunil) {
  // Raias = pessoas do papel deste funil (SDRs no funil SDR, vendedores no de Vendas)
  let pessoas = members.filter((m) => m.ativo !== false && m.papel === funil.papel);
  // SDR/vendedor enxergam apenas a própria raia (o servidor já filtra os
  // leads; aqui escondemos as raias vazias dos colegas)
  if (me && me.papel === funil.papel) pessoas = pessoas.filter((m) => m.nome === me.nome);
  const lanes = pessoas.map((m) => ({ key: m.nome, nome: m.nome, papel: m.papel }));
  const seen = new Set(lanes.map((l) => l.key));
  // Donos que aparecem nos leads mas não são membros ativos (ex.: desativados)
  for (const l of leadsFunil) {
    const dono = String(l[funil.campo] || '').trim();
    if (dono && !seen.has(dono)) {
      seen.add(dono);
      lanes.push({ key: dono, nome: dono, papel: 'outro' });
    }
  }
  // Raia coringa para leads sem responsável neste funil
  const hasOrphan = leadsFunil.some((l) => !String(l[funil.campo] || '').trim());
  if (hasOrphan || lanes.length === 0) {
    lanes.push({ key: '__none__', nome: 'Sem responsável', papel: 'outro', isNone: true });
  }
  return lanes;
}

function updateLaneFilter(lanes) {
  // (o filtro por pessoa agora é feito pelos chips Vendedor/SDR — server-side)
}

function renderBoard() {
  if (currentView === 'map') return;
  const funil = FUNIS[currentView] || FUNIS.sdr;
  const board = $('#swimboard');
  board.innerHTML = '';
  board.style.gridTemplateColumns = `var(--lane-w) repeat(${funil.colunas.length}, var(--col-w))`;

  const leadsFunil = leadsCache.filter(funil.inclui);
  let lanes = buildLanes(funil, leadsFunil);
  updateLaneFilter(lanes);
  const visibleLanes = currentFilters.lane ? lanes.filter((l) => l.key === currentFilters.lane) : lanes;

  // Cabeçalho: canto + colunas deste funil
  board.append(el('div', 'corner'));
  for (const col of funil.colunas) {
    const h = el('div', `col-h st-${col.key}`);
    h.append(el('span', 'dot'), document.createTextNode(col.label));
    board.append(h);
  }

  // Uma linha por raia
  for (const lane of visibleLanes) {
    const laneLeads = leadsFunil.filter((l) => laneKeyForLead(l, funil) === lane.key);
    board.append(renderLaneLabel(lane, funil));
    for (const col of funil.colunas) {
      board.append(renderCell(lane, col, laneLeads.filter(col.match), funil));
    }
  }

  if (members.length === 0 && me && me.papel === 'admin') {
    toastOnce('Crie os usuários da equipe em 👥 Usuários para ativar o rodízio de leads.');
  }
  atualizaEstadoVazio();
}

function renderLaneLabel(lane, funil) {
  const box = el('div', 'lane-label');
  const name = el('div', 'lane-name');
  name.append(document.createTextNode(lane.nome));
  const badge = el('span', `role-badge ${lane.papel}`,
    lane.papel === 'sdr' ? 'SDR' : lane.papel === 'vendedor' ? 'Vendedor' : '—');
  name.append(badge);
  box.append(name);

  const todos = leadsCache.filter((l) => laneKeyForLead(l, funil) === lane.key);
  const metrics = el('div', 'lane-metrics');
  const m1 = el('div');
  if (funil.papel === 'sdr') {
    const naFila = todos.filter((l) => ['novo', 'triagem'].includes(l.status || 'novo')).length;
    const qualificados = todos.filter((l) => l.tipo).length;
    m1.innerHTML = `<b>${naFila}</b> na fila · <b>${qualificados}</b> qualificados`;
    metrics.append(m1);
  } else {
    const doFunil = todos.filter(funil.inclui);
    const ganhos = doFunil.filter((l) => l.status === 'ganho').length;
    const emAberto = doFunil
      .filter((l) => SALES.includes(l.status) && l.status !== 'ganho')
      .reduce((a, l) => a + (Number(l.valor) || 0), 0);
    m1.innerHTML = `<b>${doFunil.length}</b> leads · <b>${ganhos}</b> ganhos`;
    metrics.append(m1, el('div', null, brl(emAberto) + ' em aberto'));
    // total de visitas de campo feitas pelo vendedor desta raia
    const visitas = todos.reduce((a, l) => a + (l.visitas || []).length, 0);
    if (visitas) metrics.append(el('div', null, `🚗 ${visitas} visita${visitas > 1 ? 's' : ''}`));
    // tempo médio que este vendedor levou para atender (qualificação → assumir)
    const tempos = doFunil.map((l) => msEntre(l.qualificado_em || l.created_at, l.atendido_em)).filter((v) => v != null && v >= 0);
    if (tempos.length) {
      const media = tempos.reduce((a, b) => a + b, 0) / tempos.length;
      metrics.append(el('div', null, '⏱ atende em ~' + duracao(media)));
    }
    // quantos estão esperando atendimento nesta raia
    const esperando = doFunil.filter((l) => !l.atendido_em && SALES.includes(l.status)).length;
    if (esperando) metrics.append(el('div', 'esperando', `⏳ ${esperando} aguardando`));
  }
  box.append(metrics);
  return box;
}

function renderCell(lane, col, cellLeads, funil) {
  const cell = el('div', `cell st-${col.key}`);
  cell.dataset.lane = lane.key;

  for (const lead of cellLeads) cell.append(renderCard(lead));

  cell.addEventListener('dragover', (e) => { e.preventDefault(); cell.classList.add('drop-hover'); });
  cell.addEventListener('dragleave', () => cell.classList.remove('drop-hover'));
  cell.addEventListener('drop', (e) => {
    e.preventDefault();
    cell.classList.remove('drop-hover');
    const id = e.dataTransfer.getData('text/plain');
    dropLead(id, lane, col, funil);
  });
  return cell;
}

function renderCard(lead) {
  const card = el('div', 'card' + (lead.status === 'ganho' ? ' won' : lead.status === 'perdido' ? ' lost' : lead.status === 'desistiu' ? ' gaveup' : lead.status === 'curioso' ? ' curioso' : ''));
  card.draggable = true;
  card.dataset.id = lead.id;

  const nome = el('div', 'name');
  if (lead.status === 'ganho') nome.append(el('span', 'flag', '🟢'));
  else if (lead.status === 'curioso') nome.append(el('span', 'flag', '🧐'));
  else if (lead.status === 'perdido') nome.append(el('span', 'flag', '🔴'));
  else if (lead.status === 'desistiu') nome.append(el('span', 'flag', '🚫'));
  nome.append(document.createTextNode(lead.nome || '(sem nome)'));
  const hz = heatEmoji(lead);
  if (hz) {
    const b = el('span', 'card-heat ' + heatLevel(lead), hz);
    b.title = heatLevel(lead) === 'quente' ? 'Lead quente — várias atualizações recentes' : 'Atualização recente';
    nome.append(b);
  }
  card.append(nome);
  const ar = aguardaResposta(lead);
  if (ar) {
    const w = el('div', 'wait-reply ' + (ar.urgente ? 'urgente' : 'pendente'));
    w.append(el('span', 'ic', ar.urgente ? '⏰' : '📱'), document.createTextNode(
      ar.urgente ? `Resposta pendente há ${duracao(ar.ms)} — registre!`
                 : `Registre o que o cliente respondeu · há ${duracao(ar.ms)}`));
    card.append(w);
  } else {
    const rt = precisaRetorno(lead);
    if (rt) {
      const cls = rt.nivel === 'quente' ? 'urgente' : rt.nivel === 'morno' ? 'morno' : 'pendente';
      const w = el('div', 'wait-reply ' + cls);
      w.append(el('span', 'ic', rt.nivel === 'quente' ? '🔥' : '📨'), document.createTextNode(
        rt.nivel === 'quente' ? `Cliente quente parado há ${duracao(rt.ms)} — mande mensagem!`
                              : `Hora de dar um retorno · há ${duracao(rt.ms)} sem contato`));
      card.append(w);
    }
  }
  if (lead.telefone) {
    const r = el('div', 'row');
    const href = waHref(lead.telefone);
    if (href) {
      const a = document.createElement('a');
      a.className = 'wa-link'; a.href = href; a.target = '_blank'; a.rel = 'noopener';
      a.title = 'Abrir conversa no WhatsApp';
      a.append(el('span', 'ic', '💬'), document.createTextNode(lead.telefone));
      a.addEventListener('click', (e) => { e.stopPropagation(); registrarContatoWhatsapp(lead.id); }); // não abre a ficha; marca "aguardando resposta"
      r.append(a);
    } else {
      r.append(el('span', 'ic', '📱'), document.createTextNode(lead.telefone));
    }
    card.append(r);
  }
  if (lead.regiao) { const r = el('div', 'row'); r.append(el('span', 'ic', '📍'), document.createTextNode(lead.regiao)); card.append(r); }
  if (lead.area_cultivada) { const r = el('div', 'row'); r.append(el('span', 'ic', '🌾'), document.createTextNode(lead.area_cultivada)); card.append(r); }
  const pedido = resumoItens(lead);
  if (pedido) {
    const r = el('div', 'row pedido');
    r.append(el('span', 'ic', '📦'), document.createTextNode(pedido));
    const nD = totalDrones(lead);
    if (nD > 1) r.append(el('span', 'pedido-qtd', nD + ' drones'));
    card.append(r);
  }
  // responsáveis: vendedor (destaque) e SDR
  if (lead.vendedor) {
    const r = el('div', 'row resp-vend');
    r.append(el('span', 'ic', '👤'), document.createTextNode('Vendedor: ' + lead.vendedor));
    card.append(r);
  }
  if (lead.sdr) {
    const r = el('div', 'row resp-sdr');
    r.append(el('span', 'ic', '📞'), document.createTextNode('SDR: ' + lead.sdr));
    card.append(r);
  }
  if (lead.cargo) { const r = el('div', 'row'); r.append(el('span', 'ic', '🧑‍💼'), document.createTextNode('Contato: ' + lead.cargo)); card.append(r); }
  if (lead.decisor) {
    const r = el('div', 'row decisor');
    r.append(el('span', 'ic', '💳'), document.createTextNode('Decide: ' + lead.decisor + (lead.decisor_cargo ? ' (' + lead.decisor_cargo + ')' : '')));
    card.append(r);
  }
  const fps = lead.formas_pagamento || [];
  if (fps.length) {
    const efet = valoresEfetivos(lead.valor, fps);
    fps.forEach((f, i) => {
      const r = el('div', 'row pgto');
      r.append(el('span', 'ic', '💰'), document.createTextNode(formaDetalhe(f, efet[i], true)));
      card.append(r);
    });
  }
  const nVis = (lead.visitas || []).length;
  if (nVis) {
    const ult = lead.visitas[lead.visitas.length - 1];
    const r = el('div', 'row visita');
    r.append(el('span', 'ic', '🚗'), document.createTextNode(
      `${nVis} visita${nVis > 1 ? 's' : ''} · última ${dataHora(ult.data)}`));
    card.append(r);
  }

  // entrada (data/hora) e tempo de atendimento do vendedor
  const rEnt = el('div', 'row'); rEnt.append(el('span', 'ic', '🕐'), document.createTextNode('Entrou: ' + dataHora(lead.created_at)));
  card.append(rEnt);
  const ta = tempoAtendimento(lead);
  if (ta) {
    const r = el('div', 'row ' + (ta.atendido ? 'atendido' : 'esperando'));
    r.append(el('span', 'ic', ta.atendido ? '⏱' : '⏳'),
      document.createTextNode(ta.atendido ? 'Atendido em ' + duracao(ta.ms) : 'Aguardando há ' + duracao(ta.ms)));
    card.append(r);
  }

  const tags = el('div', 'tags');
  if (lead.origem_canal) tags.append(el('span', `tag canal ${lead.origem_canal}`, lead.origem_canal));
  if (lead.campanha) tags.append(el('span', 'tag campanha', '📣 ' + lead.campanha));
  if (escopo === 'servicos') {
    // no painel de Serviços o valor relevante é o do serviço (não o do drone)
    if (lead.valor_servico > 0) tags.append(el('span', 'tag valor serv', '🔧 ' + brl(lead.valor_servico)));
  } else if (lead.valor > 0) {
    tags.append(el('span', 'tag valor', brl(lead.valor)));
  }
  if (tags.children.length) card.append(tags);

  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', lead.id);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
  card.addEventListener('click', () => openModal(lead));
  return card;
}

// Arrastar um card para outra raia/etapa (dentro do funil ativo)
async function dropLead(id, lane, col, funil) {
  const lead = leadsCache.find((l) => l.id === id);
  if (!lead) return;

  const patch = { ...col.patch };
  // a raia define quem é o dono neste funil (SDR ou vendedor)
  patch[funil.campo] = lane.isNone ? '' : lane.nome;

  const before = { status: lead.status, sdr: lead.sdr, vendedor: lead.vendedor, tipo: lead.tipo, aguardando_resposta: lead.aguardando_resposta, status_servico: lead.status_servico };
  Object.assign(lead, patch);
  // encerrar o lead tira o alerta na hora (o servidor faz o mesmo no PATCH)
  if (['ganho', 'perdido', 'desistiu', 'curioso'].includes(lead.status)) lead.aguardando_resposta = null;
  renderBoard();

  try {
    await api('/api/leads/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(patch) });
  } catch (err) {
    // só o PATCH desfaz o movimento; uma falha depois dele NÃO pode reverter
    // uma mudança que o servidor já gravou
    Object.assign(lead, before);
    renderBoard();
    toast('Erro ao mover: ' + err.message);
    return;
  }
  loadStats();
  // Com filtro/busca ativos o lead movido pode não casar mais com o filtro.
  // Recarrega já: antes ele sumia sozinho 15s depois, sem explicação.
  if (filtroAtivo()) loadLeads();
  if (col.envia) {
    toast(`✅ Qualificado! Enviado para a aba ${col.envia}`);
  } else {
    const dest = lane.isNone ? 'Sem responsável' : lane.nome;
    toast(`→ ${col.label} · ${dest}`);
  }
}

// ---------------------------------------------------------------------------
// Modal do lead
// ---------------------------------------------------------------------------
const form = $('#leadForm');

function fillSelect(sel, items, current, placeholder) {
  sel.innerHTML = '';
  sel.append(new Option(placeholder, ''));
  for (const it of items) sel.append(new Option(it, it));
  // mantém valor atual mesmo que a pessoa não esteja mais ativa
  if (current && !items.includes(current)) sel.append(new Option(current + ' (inativo)', current));
  sel.value = current || '';
}

function openModal(lead) {
  const isNew = !lead;
  lead = lead || { id: '', status: 'novo', tipo: '', sdr: '', vendedor: '' };
  $('#modalTitle').textContent = isNew ? 'Novo lead' : (lead.nome || 'Lead');
  $('#btnDelete').style.display = isNew ? 'none' : '';

  // selects de responsáveis e etapa
  const sdrNames = members.filter((m) => m.ativo !== false && m.papel === 'sdr').map((m) => m.nome);
  const vendNames = members.filter((m) => m.ativo !== false && m.papel === 'vendedor').map((m) => m.nome);
  fillSelect($('#sdrSelect'), sdrNames, lead.sdr, '—');
  fillSelect($('#vendedorSelect'), vendNames, lead.vendedor, '—');
  const st = $('#statusSelect');
  st.innerHTML = '';
  for (const s of STAGES) st.append(new Option(STAGE_LABELS[s] || s, s));
  st.value = lead.status || 'novo';

  // select de campanha cadastrada (se o vínculo apontar para campanha que não
  // está na lista, injeta a opção para o valor não se perder num Salvar)
  const cs = $('#campanhaSelect');
  cs.innerHTML = '';
  cs.append(new Option('—', ''));
  for (const c of campaigns) cs.append(new Option(`${c.nome} (#${c.codigo})`, c.id));
  if (lead.campanha_id && !campaigns.some((c) => c.id === lead.campanha_id)) {
    cs.append(new Option((lead.campanha || 'Campanha') + ' (removida)', lead.campanha_id));
  }
  cs.value = lead.campanha_id || '';

  // tipo (radio)
  for (const r of form.querySelectorAll('[name=tipo]')) r.checked = (r.value === (lead.tipo || ''));
  // lead de recuperação (checkbox) — lead novo herda o escopo em que você está
  if (form.recuperacao) form.recuperacao.checked = isNew ? (escopo === 'recuperacao') : !!lead.recuperacao;
  // painel de serviços (pós-venda) — lead novo criado nesse painel já entra nele
  if (form.em_servicos) form.em_servicos.checked = isNew ? (escopo === 'servicos') : !!lead.em_servicos;

  form.id.value = lead.id || '';
  // canal fora da lista fixa (ex.: utm_source cru vindo do webhook): injeta a
  // opção — senão o select fica vazio e o Salvar apagaria o canal
  if (lead.origem_canal && ![...form.origem_canal.options].some((o) => o.value === lead.origem_canal)) {
    form.origem_canal.append(new Option(lead.origem_canal, lead.origem_canal));
  }
  const fields = ['nome', 'telefone', 'email', 'regiao', 'area_cultivada', 'valor',
    'cargo', 'decisor', 'decisor_cargo', 'status_servico', 'valor_servico',
    'campanha', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'observacoes', 'origem_canal'];
  for (const f of fields) if (form[f]) form[f].value = lead[f] != null ? lead[f] : '';
  atualizaWaLead();

  // drones do pedido (lead antigo: cai no produto único; lead sem nada: 1 linha vazia)
  const itensIni = (lead.itens && lead.itens.length)
    ? lead.itens
    : (PRODUTOS.includes(lead.produto) ? [{ produto: lead.produto, qtd: 1 }] : []);
  renderItens(itensIni);
  modalItensInitial = JSON.stringify(canonItens(itensIni));

  renderPagamentos(lead.formas_pagamento || []);
  modalPagInitial = JSON.stringify(canonPagamentos(lead.formas_pagamento || []));
  renderVisitas(isNew ? null : lead);
  $('#btnRegistrarVisita').disabled = isNew;
  $('#histNota').value = ''; // rascunho de nota é por-lead: limpa ao abrir outro
  renderHistorico(isNew ? null : lead);

  const meta = $('#metaLine');
  meta.innerHTML = '';
  if (!isNew) {
    const chips = [];
    if (lead.source === 'chatwoot') chips.push('💬 veio do Chatwoot');
    if (lead.utm_source) chips.push('origem: ' + lead.utm_source);
    for (const c of chips) meta.append(el('span', 'chip', c));
    if (lead.last_message) meta.append(el('div', null, 'Última mensagem: "' + String(lead.last_message).slice(0, 120) + '"'));

    // Linha do tempo: entrada → qualificação → atendimento
    const tl = el('div', 'timeline');
    tl.append(el('div', null, '🕐 Entrada: ' + dataHora(lead.created_at, true)));
    if (lead.qualificado_em) {
      tl.append(el('div', null, `✅ Qualificado: ${dataHora(lead.qualificado_em, true)} (${duracao(msEntre(lead.created_at, lead.qualificado_em))} após entrar)`));
    }
    if (lead.atendido_em) {
      const ref = lead.qualificado_em || lead.created_at;
      tl.append(el('div', null, `⏱ Vendedor atendeu: ${dataHora(lead.atendido_em, true)} (${duracao(msEntre(ref, lead.atendido_em))} após qualificar)`));
    } else if (SALES.includes(lead.status) && !lead.vendedor) {
      tl.append(el('div', 'esperando', '⏳ Aguardando atendimento há ' + duracao(Date.now() - new Date(lead.qualificado_em || lead.created_at))));
    }
    meta.append(tl);
  }
  modalInitial = collectFormValues();
  $('#cidadesBox').hidden = true;
  $('#modalBackdrop').hidden = false;
}

function closeModal() {
  $('#modalBackdrop').hidden = true;
  refreshAll(); // recupera o que o webhook trouxe enquanto o modal pausava o refresh
}

function collectFormValues() {
  const vals = {};
  for (const field of form.elements) {
    if (!field.name || field.name === 'id') continue;
    if (field.type === 'radio') { if (field.checked) vals[field.name] = field.value; }
    else if (field.type === 'checkbox') vals[field.name] = field.checked;
    else vals[field.name] = field.value;
  }
  return vals;
}
let modalInitial = {};
let modalPagInitial = '[]';
let modalItensInitial = '[]';

// ---- Forma de pagamento (multi + valor + parcelamento) ----
// ---- Drones do pedido (o cliente pode querer mais de um) ----
// Texto do pedido para o card/popup: "2× T25P · T70P". Cai no produto legado
// quando ainda não há itens (lead antigo do webhook com produto solto).
function resumoItens(lead) {
  const itens = (lead && lead.itens) || [];
  if (itens.length) return itens.map((it) => (it.qtd > 1 ? it.qtd + '× ' : '') + it.produto).join(' · ');
  return (lead && lead.produto) || '';
}
function totalDrones(lead) {
  return ((lead && lead.itens) || []).reduce((a, it) => a + (Number(it.qtd) || 0), 0);
}

function criaItemRow(produto, qtd) {
  const row = el('div', 'item-row');
  const sel = document.createElement('select');
  sel.className = 'item-prod';
  sel.append(new Option('— escolher drone —', ''));
  for (const p of PRODUTOS) sel.append(new Option(p, p));
  sel.value = PRODUTOS.includes(produto) ? produto : '';
  const q = document.createElement('input');
  q.type = 'number'; q.min = '1'; q.max = '99'; q.step = '1';
  q.className = 'item-qtd'; q.value = qtd > 0 ? qtd : 1;
  q.setAttribute('aria-label', 'quantidade');
  const x = el('button', 'item-x', '✕');
  x.type = 'button'; x.title = 'Remover drone';
  x.onclick = () => {
    row.remove();
    // nunca deixa o pedido sem nenhuma linha (mantém uma vazia para adicionar)
    if (!$('#itensBox').querySelector('.item-row')) $('#itensBox').append(criaItemRow('', 1));
  };
  row.append(sel, el('span', 'item-vezes', '×'), q, x);
  return row;
}
function renderItens(itens) {
  const box = $('#itensBox');
  box.innerHTML = '';
  const lista = (itens && itens.length) ? itens : [{ produto: '', qtd: 1 }];
  for (const it of lista) box.append(criaItemRow(it.produto, it.qtd));
}
function collectItens() {
  const out = [];
  for (const row of $('#itensBox').querySelectorAll('.item-row')) {
    const prod = row.querySelector('.item-prod').value;
    if (!prod) continue;
    const qtd = Math.max(1, Math.min(99, parseInt(row.querySelector('.item-qtd').value, 10) || 1));
    out.push({ produto: prod, qtd });
  }
  return out;
}
// forma canônica (soma repetidos + ordena) só para detectar "mudou ou não"
function canonItens(lista) {
  const somas = {};
  for (const it of (lista || [])) {
    if (!it.produto) continue;
    somas[it.produto] = Math.min(99, (somas[it.produto] || 0) + (Number(it.qtd) || 1));
  }
  return Object.keys(somas).sort().map((p) => ({ produto: p, qtd: somas[p] }));
}

function renderPagamentos(lista) {
  const box = $('#payBox');
  box.innerHTML = '';
  const porTipo = {};
  for (const f of lista) porTipo[f.tipo] = f;
  for (const tipo of PAGAMENTOS) {
    const m = porTipo[tipo];
    const parcelavel = PARCELAVEIS.has(tipo);
    const row = el('div', 'pay-row' + (m ? ' on' : ''));

    const head = el('label', 'pay-head');
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = !!m;
    const nome = el('span', 'pay-nome', tipo);
    const val = document.createElement('input');
    val.type = 'number'; val.min = '0'; val.step = '100';
    val.className = 'pay-val';
    val.placeholder = 'R$ total';
    val.value = m && m.valor ? m.valor : '';
    val.disabled = !m;
    head.append(chk, nome, val);
    row.append(head);

    // linha de parcelamento (só para formas parceláveis)
    let ent = null, par = null, hint = null;
    if (parcelavel) {
      const pl = el('div', 'pay-parc');
      ent = document.createElement('input');
      ent.type = 'number'; ent.min = '0'; ent.step = '100';
      ent.className = 'pay-ent'; ent.placeholder = 'entrada R$';
      ent.value = m && m.entrada ? m.entrada : '';
      ent.disabled = !m;
      par = document.createElement('input');
      par.type = 'number'; par.min = '0'; par.max = '360'; par.step = '1';
      par.className = 'pay-parcelas'; par.placeholder = 'nº parcelas';
      par.value = m && m.parcelas ? m.parcelas : '';
      par.disabled = !m;
      pl.append(el('span', 'pay-plus', 'entrada +'), ent, par, el('span', 'pay-x', 'x'));
      row.append(pl);
      hint = el('div', 'pay-hint');
      row.append(hint);
      ent.addEventListener('input', updatePayTotal);
      par.addEventListener('input', updatePayTotal);
    }

    chk.addEventListener('change', () => {
      row.classList.toggle('on', chk.checked);
      for (const inp of [val, ent, par]) if (inp) { inp.disabled = !chk.checked; if (!chk.checked) inp.value = ''; }
      updatePayTotal();
    });
    val.addEventListener('input', updatePayTotal);
    box.append(row);
  }
  updatePayTotal();
}

// Reparte o valor total do lead entre as formas: quem tem valor informado
// mantém; a ÚNICA forma sem valor fica com o que sobrar. Assim, marcar só
// "Boleto 10x" num lead de R$200 mil já vira 10x de R$20 mil.
function valoresEfetivos(total, formas) {
  total = Number(total) || 0;
  const somaInformada = formas.reduce((a, f) => a + (f.valor > 0 ? f.valor : 0), 0);
  const vazias = formas.filter((f) => !(f.valor > 0)).length;
  const resto = Math.max(total - somaInformada, 0);
  return formas.map((f) => (f.valor > 0 ? f.valor : (vazias === 1 ? resto : 0)));
}

// Texto de uma forma com o parcelamento calculado (ex.: "Boleto: 10x de R$20.000")
function formaDetalhe(f, valorEfetivo, curto) {
  if (f.parcelas > 0) {
    const base = Math.max(valorEfetivo - (f.entrada || 0), 0);
    const parc = base > 0 ? base / f.parcelas : 0;
    const ent = f.entrada > 0 ? 'entrada ' + brl(f.entrada) + ' + ' : '';
    return `${curto ? f.tipo : f.tipo + ':'} ${ent}${f.parcelas}x${parc > 0 ? ' de ' + brl(parc) : ''}`;
  }
  return f.tipo + (valorEfetivo > 0 ? ': ' + brl(valorEfetivo) : '');
}

function collectPagamentos() {
  const out = [];
  for (const row of $('#payBox').querySelectorAll('.pay-row')) {
    const chk = row.querySelector('input[type=checkbox]');
    if (!chk.checked) continue;
    out.push({
      tipo: row.querySelector('.pay-nome').textContent,
      valor: parseFloat(row.querySelector('.pay-val').value) || 0,
      entrada: parseFloat(row.querySelector('.pay-ent')?.value) || 0,
      parcelas: parseInt(row.querySelector('.pay-parcelas')?.value, 10) || 0,
    });
  }
  return out;
}

// Forma canônica (ordem fixa + 4 chaves) para comparar "mudou ou não" sem
// falso positivo por ordem/formato do que veio do servidor.
function canonPagamentos(lista) {
  const porTipo = {};
  for (const f of (lista || [])) porTipo[f.tipo] = f;
  const parcelavel = new Set(PARCELAVEIS);
  return PAGAMENTOS.filter((t) => porTipo[t]).map((t) => {
    const f = porTipo[t];
    return {
      tipo: t,
      valor: Number(f.valor) || 0,
      entrada: parcelavel.has(t) ? (Number(f.entrada) || 0) : 0,
      parcelas: parcelavel.has(t) ? (parseInt(f.parcelas, 10) || 0) : 0,
    };
  });
}

function updatePayTotal() {
  const rows = [...$('#payBox').querySelectorAll('.pay-row')].filter(
    (r) => r.querySelector('input[type=checkbox]').checked);
  const formas = rows.map((r) => ({
    tipo: r.querySelector('.pay-nome').textContent,
    valor: parseFloat(r.querySelector('.pay-val').value) || 0,
    entrada: parseFloat(r.querySelector('.pay-ent')?.value) || 0,
    parcelas: parseInt(r.querySelector('.pay-parcelas')?.value, 10) || 0,
  }));
  const total = parseFloat(form.valor.value) || 0;
  const efet = valoresEfetivos(total, formas);
  // atualiza o cálculo de parcela de cada forma
  rows.forEach((r, i) => {
    const hint = r.querySelector('.pay-hint');
    if (!hint) return;
    hint.textContent = formas[i].parcelas > 0 ? formaDetalhe(formas[i], efet[i]) : '';
  });
  const box = $('#payTotal');
  if (!formas.length) { box.textContent = ''; return; }
  const soma = efet.reduce((a, v) => a + v, 0);
  let txt = 'Negociação: ' + formas.map((f, i) => formaDetalhe(f, efet[i])).join('  +  ');
  if (soma > 0 && total > 0 && Math.round(soma) !== Math.round(total)) {
    txt += ` · ⚠️ soma ${brl(soma)} difere do valor (${brl(total)})`;
  }
  box.textContent = txt;
}

async function saveLead() {
  const all = collectFormValues();
  const id = form.id.value;
  // regras de preenchimento (o servidor valida de novo, mas avisamos já aqui)
  if (!id && (!all.telefone.trim() || !all.email.trim())) {
    toast('Telefone e e-mail são obrigatórios para cadastrar um lead');
    return;
  }
  if (all.regiao && !cidadeValida(all.regiao)) {
    toast('Cidade não reconhecida — digite e escolha uma da lista');
    return;
  }
  // Envia SÓ o que o usuário alterou: mandar o formulário inteiro reverteria
  // campos que o webhook atualizou enquanto o modal estava aberto.
  const data = {};
  for (const [k, v] of Object.entries(all)) {
    if (!id || v !== (modalInitial[k] !== undefined ? modalInitial[k] : '')) data[k] = v;
  }
  // drones do pedido (não é campo simples do form) — só reenvia se mudou
  const its = collectItens();
  if (!id || JSON.stringify(canonItens(its)) !== modalItensInitial) data.itens = its;
  // formas de pagamento (não é campo simples do form) — compara canônico para
  // não reenviar (e evitar reverter mudança concorrente) quando nada mudou
  const pg = collectPagamentos();
  if (!id || JSON.stringify(canonPagamentos(pg)) !== modalPagInitial) data.formas_pagamento = pg;
  try {
    if (id) {
      if (Object.keys(data).length === 0) { closeModal(); return; }
      await api('/api/leads/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(data) });
      toast('Lead atualizado');
    } else {
      await api('/api/leads', { method: 'POST', body: JSON.stringify(data) });
      toast('Lead criado');
    }
    closeModal();
  } catch (err) { toast('Erro ao salvar: ' + err.message); }
}

async function deleteLead() {
  const id = form.id.value;
  if (!id) return;
  if (!confirm('Excluir este lead? Essa ação não pode ser desfeita.')) return;
  try {
    await api('/api/leads/' + encodeURIComponent(id), { method: 'DELETE' });
    closeModal();
    toast('Lead excluído');
  } catch (err) { toast('Erro ao excluir: ' + err.message); }
}

// ---------------------------------------------------------------------------
// Visitas de campo (foto pela câmera do celular)
// ---------------------------------------------------------------------------
let visitFotoData = null; // base64 da foto redimensionada

// Reduz a foto (câmera dá arquivos enormes) para caber no envio
function resizeImagem(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      const maior = Math.max(width, height);
      if (maior > maxDim) { const s = maxDim / maior; width = Math.round(width * s); height = Math.round(height * s); }
      const c = document.createElement('canvas');
      c.width = width; c.height = height;
      c.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não consegui ler a imagem')); };
    img.src = url;
  });
}

// Painel lateral: linha do tempo de atualizações do lead (mais recente no topo)
function renderHistorico(lead) {
  const panel = $('#histPanel');
  const tl = $('#histTimeline');
  tl.innerHTML = '';
  if (!lead) { panel.hidden = true; return; }
  panel.hidden = false;
  const hist = (lead.historico || []).slice().reverse();
  if (!hist.length) {
    tl.append(el('div', 'hist-empty', 'Sem atualizações registradas ainda.'));
    return;
  }
  for (const h of hist) {
    const e = el('div', 'hist-entry' + (h.tipo === 'nota' ? ' nota' : ''));
    const quando = el('div', 'hist-when');
    quando.append(document.createTextNode(dataHora(h.data, true)));
    if (h._pendente) quando.append(el('span', 'pendente-envio', '📴 aguardando enviar'));
    e.append(quando);
    const autor = h.autor || 'Sistema';
    const cargo = h.papel ? papelLabel(h.papel) : '';
    const quem = '👤 ' + autor + (cargo && cargo !== autor ? ' · ' + cargo : '');
    e.append(el('div', 'hist-who', quem));
    for (const it of (h.itens || [])) e.append(el('div', 'hist-item', it));
    tl.append(e);
  }
}

let salvandoNota = false; // trava de reentrância (clique + atalho de teclado)
async function adicionarNota() {
  const ta = $('#histNota');
  const texto = (ta.value || '').trim();
  const id = form.id.value;
  if (!id || salvandoNota) return; // lead não salvo, ou já tem um envio em voo
  if (!texto) { toast('Escreva a atualização antes de adicionar'); ta.focus(); return; }
  salvandoNota = true;
  const btn = $('#histNotaBtn');
  // desabilita botão E textarea: bloqueia duplo-envio e evita perder rascunho novo
  btn.disabled = true; ta.disabled = true; btn.textContent = 'Salvando…';
  const opId = gerarOpId();
  const url = '/api/leads/' + encodeURIComponent(id) + '/notas';
  const lead = leadsCache.find((l) => l.id === id);
  try {
    const res = await api(url, { method: 'POST', body: JSON.stringify({ op_id: opId, texto }) });
    ta.value = ''; // texto enviado com sucesso: limpa o campo
    if (lead) {
      lead.historico = lead.historico || [];
      lead.historico.push(res.entrada);
      lead.updated_at = res.entrada.data;
      // registrar a atualização tira o alerta de "resposta pendente"
      if ('aguardando_resposta' in res) lead.aguardando_resposta = res.aguardando_resposta;
      renderHistorico(lead);
      renderBoard();
      loadStats();
    }
    toast('✅ Atualização adicionada');
  } catch (err) {
    if (!err.offline) { toast('Erro ao adicionar: ' + err.message); return; }
    // sem sinal: guarda no aparelho e envia depois (criado_em = hora real da nota)
    const criadoEm = new Date().toISOString();
    await filaAdd({ op_id: opId, tipo: 'nota', lead_id: id, lead_nome: form.nome.value || 'Lead', url, body: { op_id: opId, texto, criado_em: criadoEm }, criado_em: criadoEm });
    ta.value = '';
    if (lead) {
      lead.historico = lead.historico || [];
      lead.historico.push({ data: criadoEm, autor: (me && me.nome) || 'Você', papel: me && me.papel, itens: ['💬 ' + texto], tipo: 'nota', op_id: opId, _pendente: true });
      lead.aguardando_resposta = null; // registrou a resposta (será confirmado no envio)
      renderHistorico(lead);
      renderBoard();
    }
    toast('📴 Sem internet — anotação salva no aparelho; envio quando o sinal voltar');
    atualizaOfflineBar();
  } finally {
    salvandoNota = false;
    btn.disabled = false; ta.disabled = false; btn.textContent = 'Adicionar';
  }
}

function renderVisitas(lead) {
  const visitas = (lead && lead.visitas) || [];
  $('#visitCount').textContent = visitas.length ? `(${visitas.length})` : '';
  const list = $('#visitList');
  list.innerHTML = '';
  if (!visitas.length) {
    list.append(el('div', 'visit-empty', 'Nenhuma visita registrada ainda.'));
    return;
  }
  for (const v of [...visitas].reverse()) {
    const item = el('div', 'visit-item');
    if (v.foto) {
      // visita pendente guarda a foto como data:base64; a sincronizada, o nome do arquivo
      const fotoSrc = v.foto.startsWith('data:') ? v.foto : 'api/foto/' + encodeURIComponent(v.foto);
      const a = document.createElement('a');
      a.href = fotoSrc;
      a.target = '_blank';
      const img = document.createElement('img');
      img.className = 'visit-thumb';
      img.src = fotoSrc;
      img.alt = 'Foto da fazenda';
      a.append(img);
      item.append(a);
    }
    const info = el('div', 'visit-info');
    const res = el('div', 'visit-res');
    res.append(document.createTextNode(v.resultado || '(sem resultado)'));
    if (v._pendente) res.append(el('span', 'pendente-envio', '📴 aguardando enviar'));
    info.append(res);
    const meta = el('div', 'visit-meta');
    meta.textContent = `👤 ${v.visitante || '—'} · ${dataHora(v.data, true)}`;
    info.append(meta);
    if (v.obs) info.append(el('div', 'visit-obs', v.obs));
    item.append(info);
    // visita ainda não enviada não pode ser excluída pelo id do servidor
    const podeExcluir = !v._pendente && me && (me.papel === 'admin' || me.papel === 'gerente' || v.visitante === me.nome);
    if (podeExcluir) {
      const del = el('button', 'icon-btn', '🗑️');
      del.type = 'button';
      del.title = 'Excluir visita';
      del.onclick = () => excluirVisita(lead, v.id);
      item.append(del);
    }
    list.append(item);
  }
}

function openVisitModal() {
  const id = form.id.value;
  if (!id) { toast('Salve o lead primeiro para registrar uma visita'); return; }
  visitFotoData = null;
  $('#visitFoto').value = '';
  $('#visitResultado').value = '';
  $('#visitObs').value = '';
  $('#visitPreview').hidden = true;
  $('#visitPreview').innerHTML = '';
  $('#visitLeadNome').textContent = form.nome.value || 'Lead';
  $('#visitBackdrop').hidden = false;
}

$('#visitFoto').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) { visitFotoData = null; $('#visitPreview').hidden = true; return; }
  try {
    visitFotoData = await resizeImagem(file, 1280, 0.72);
    const prev = $('#visitPreview');
    prev.innerHTML = '';
    const img = document.createElement('img');
    img.src = visitFotoData;
    prev.append(img);
    prev.hidden = false;
  } catch (err) { toast('Erro na foto: ' + err.message); }
});

function pegarLocalizacao() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  });
}

async function salvarVisita() {
  const id = form.id.value;
  if (!id) return;
  const nome = form.nome.value || 'Lead';
  const btn = $('#visitSalvar');
  btn.disabled = true; btn.textContent = 'Obtendo localização…';
  try {
    // GPS é obrigatório: sem localização, a visita não é registrada.
    // (O GPS funciona SEM internet — é o chip do aparelho.)
    const loc = await pegarLocalizacao();
    if (!loc) {
      toast('📍 Ative/permita a localização (GPS) para registrar a visita');
      btn.disabled = false; btn.textContent = 'Salvar visita';
      return;
    }
    btn.textContent = 'Salvando…';
    const opId = gerarOpId();
    const body = {
      op_id: opId,
      resultado: $('#visitResultado').value,
      obs: $('#visitObs').value,
      foto: visitFotoData || '',
      lat: loc.lat, lng: loc.lng, acc: loc.acc,
    };
    const url = '/api/leads/' + encodeURIComponent(id) + '/visitas';
    try {
      const res = await api(url, { method: 'POST', body: JSON.stringify(body) });
      const v = res.visita; v.op_id = v.op_id || opId;
      aplicaVisitaLocal(id, v, false);
      $('#visitBackdrop').hidden = true;
      toast('✅ Visita registrada');
    } catch (err) {
      if (!err.offline) throw err; // erro real do servidor: mostra
      // sem sinal: guarda no aparelho e envia depois. criado_em no corpo faz o
      // servidor registrar o HORÁRIO DA VISITA (não o da sincronização).
      const criadoEm = new Date().toISOString();
      body.criado_em = criadoEm;
      await filaAdd({ op_id: opId, tipo: 'visita', lead_id: id, lead_nome: nome, url, body, criado_em: criadoEm });
      aplicaVisitaLocal(id, visitaLocalDoBody(body, opId), true);
      $('#visitBackdrop').hidden = true;
      toast('📴 Sem internet — visita salva no aparelho; envio quando o sinal voltar');
      atualizaOfflineBar();
    }
  } catch (err) {
    toast('Erro ao salvar visita: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Salvar visita';
  }
}

async function excluirVisita(lead, visitaId) {
  if (!confirm('Excluir esta visita?')) return;
  try {
    await api('/api/leads/' + encodeURIComponent(lead.id) + '/visitas/' + encodeURIComponent(visitaId), { method: 'DELETE' });
    lead.visitas = (lead.visitas || []).filter((v) => v.id !== visitaId);
    renderVisitas(lead);
    renderBoard();
    toast('Visita excluída');
  } catch (err) { toast('Erro: ' + err.message); }
}

$('#btnRegistrarVisita').addEventListener('click', openVisitModal);
$('#visitClose').addEventListener('click', () => { $('#visitBackdrop').hidden = true; });
$('#visitCancel').addEventListener('click', () => { $('#visitBackdrop').hidden = true; });
$('#visitSalvar').addEventListener('click', salvarVisita);

// Nota manual no painel de histórico
$('#histNotaBtn').addEventListener('click', adicionarNota);
$('#histNota').addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); adicionarNota(); }
});

// ---------------------------------------------------------------------------
// Campanhas
// ---------------------------------------------------------------------------
function waLink(camp) {
  const num = String(settings.whatsapp_number || '').replace(/\D/g, '');
  if (!num) return '';
  const msg = `Olá! Vi o anúncio "${camp.nome}" e quero mais informações. #${camp.codigo}`;
  return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
}

function utmSuffix(camp) {
  const srcPorCanal = { Meta: 'facebook', Google: 'google', TikTok: 'tiktok', WhatsApp: 'whatsapp' };
  const src = srcPorCanal[camp.canal] || 'outro';
  return `?utm_source=${src}&utm_medium=cpc&utm_campaign=${encodeURIComponent(camp.codigo)}`;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copiado! Cole no seu anúncio.'); }
  catch (e) { prompt('Copie manualmente (Ctrl/Cmd+C):', text); }
}

function linkRow(label, value) {
  const row = el('div', 'camp-link');
  row.append(el('span', 'lbl', label));
  const inp = document.createElement('input');
  inp.readOnly = true;
  inp.value = value;
  inp.addEventListener('focus', () => inp.select());
  const btn = el('button', 'btn ghost small', 'Copiar');
  btn.style.background = 'var(--green-100)';
  btn.style.color = 'var(--green-700)';
  btn.type = 'button';
  btn.onclick = () => copyText(value);
  row.append(inp, btn);
  return row;
}

function renderCampaigns() {
  $('#waNumber').value = settings.whatsapp_number || '';
  const list = $('#campList');
  list.innerHTML = '';
  if (campaigns.length === 0) {
    list.append(el('div', 'team-empty', 'Nenhuma campanha cadastrada ainda. Adicione a primeira acima. 👆'));
    return;
  }
  for (const c of campaigns) {
    const item = el('div', 'camp-item' + (c.ativo === false ? ' inactive' : ''));
    const head = el('div', 'camp-head');
    head.append(el('span', 'cname', c.nome));
    head.append(el('span', 'camp-code', '#' + c.codigo));
    head.append(el('span', `tag canal ${c.canal}`, c.canal));
    if (c.keyword) head.append(el('span', 'tag', '🔑 ' + c.keyword));
    head.append(el('span', 'spacer'));
    const toggle = el('button', 'icon-btn', c.ativo === false ? '☑️' : '✅');
    toggle.title = c.ativo === false ? 'Reativar' : 'Pausar (para de atribuir leads novos)';
    toggle.type = 'button';
    toggle.onclick = async () => {
      await api('/api/campaigns/' + c.id, { method: 'PATCH', body: JSON.stringify({ ativo: c.ativo === false }) });
      await loadCampaigns(); renderCampaigns();
    };
    const del = el('button', 'icon-btn', '🗑️');
    del.title = 'Excluir campanha (os leads dela não são apagados)';
    del.type = 'button';
    del.onclick = async () => {
      if (!confirm(`Excluir a campanha "${c.nome}"? Os leads continuam no quadro, só perdem o vínculo.`)) return;
      await api('/api/campaigns/' + c.id, { method: 'DELETE' });
      await loadCampaigns(); renderCampaigns(); renderCampReport();
    };
    head.append(toggle, del);
    item.append(head);

    const wl = waLink(c);
    if (wl) {
      item.append(linkRow('Link p/ anúncio', wl));
    } else {
      item.append(el('div', 'camp-warn', '⚠️ Salve seu número de WhatsApp acima para gerar o link do anúncio.'));
    }
    item.append(linkRow('Landing (UTM)', 'https://SEU-SITE' + utmSuffix(c)));
    list.append(item);
  }
}

async function renderCampReport() {
  const box = $('#campReport');
  // token de sequência: duas chamadas em voo não podem empilhar duas tabelas
  const seq = (renderCampReport._seq = (renderCampReport._seq || 0) + 1);
  try {
    const data = await api('/api/report/campanhas');
    if (seq !== renderCampReport._seq) return; // há chamada mais recente
    box.innerHTML = '';
    const rows = data.report || [];
    if (!rows.length) { box.append(el('div', 'team-empty', 'Sem dados ainda.')); return; }
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>Campanha</th><th>Canal</th>' +
      '<th class="num">Leads</th><th class="num">Produtores</th><th class="num">Ganhos</th>' +
      '<th class="num">R$ ganho</th><th class="num">R$ em aberto</th></tr></thead>';
    const tbody = document.createElement('tbody');
    let bestMarked = false;
    for (const r of rows) {
      const tr = document.createElement('tr');
      if (!bestMarked && r.id && r.leads > 0) { tr.className = 'best'; bestMarked = true; }
      const cells = [
        r.nome + (r.codigo ? ` (#${r.codigo})` : ''), r.canal || '—',
        r.leads, r.produtores, r.ganhos, brl(r.valor_ganho), brl(r.valor_aberto),
      ];
      cells.forEach((v, i) => {
        const td = document.createElement('td');
        if (i >= 2) td.className = 'num';
        td.textContent = String(v);
        tr.append(td);
      });
      tbody.append(tr);
    }
    table.append(tbody);
    box.append(table);
  } catch (err) {
    if (seq !== renderCampReport._seq) return;
    box.innerHTML = '';
    box.append(el('div', 'team-empty', 'Erro ao carregar o relatório.'));
  }
}

$('#campForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nome = e.target.nome.value.trim();
  if (!nome) return;
  try {
    const res = await api('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({ nome, canal: e.target.canal.value, keyword: e.target.keyword.value.trim() }),
    });
    e.target.nome.value = ''; e.target.keyword.value = '';
    await loadCampaigns(); renderCampaigns(); renderCampReport();
    toast(`Campanha criada — código #${res.campaign.codigo}`);
  } catch (err) { toast('Erro: ' + err.message); }
});

$('#btnSaveWa').addEventListener('click', async () => {
  try {
    await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ whatsapp_number: $('#waNumber').value }) });
    await loadCampaigns(); renderCampaigns();
    toast('Número salvo — links dos anúncios atualizados');
  } catch (err) { toast('Erro: ' + err.message); }
});

// ---- Painel de Alertas (prazos configuráveis) ----
function abrirCfgAlertas() {
  $('#cfgCadencia').value = cadenciaDias();
  $('#cfgRespostaHoras').value = respostaHoras();
  $('#manageMenu').hidden = true;
  $('#alertasCfgBackdrop').hidden = false;
}
function fecharCfgAlertas() { $('#alertasCfgBackdrop').hidden = true; }
$('#btnAlertas').addEventListener('click', abrirCfgAlertas);
$('#alertasCfgClose').addEventListener('click', fecharCfgAlertas);
$('#alertasCfgBackdrop').addEventListener('click', (e) => {
  if (e.target === $('#alertasCfgBackdrop')) fecharCfgAlertas();
});
$('#btnSaveAlertas').addEventListener('click', async () => {
  const cad = parseInt($('#cfgCadencia').value, 10);
  const hor = parseInt($('#cfgRespostaHoras').value, 10);
  if (!(cad >= 1 && cad <= 30)) { toast('Prazo de retorno: use 1 a 30 dias'); return; }
  if (!(hor >= 1 && hor <= 168)) { toast('Prazo da resposta: use 1 a 168 horas'); return; }
  try {
    await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ cadencia_dias: cad, resposta_horas: hor }) });
    settings.cadencia_dias = cad; settings.resposta_horas = hor;
    fecharCfgAlertas();
    await loadStats();       // atualiza contagem + badges com o novo prazo
    if (currentView === 'alertas') renderAlertas(); else renderBoard();
    toast('✅ Prazos dos alertas salvos');
  } catch (err) { toast('Erro: ' + err.message); }
});

// ---------------------------------------------------------------------------
// Relatório diário (leads recebidos × qualificados)
// ---------------------------------------------------------------------------
let reportCache = [];

function fmtDia(iso) {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

async function renderReport() {
  const body = $('#reportBody');
  const totals = $('#reportTotals');
  body.innerHTML = '';
  totals.innerHTML = '';
  totals.append(el('div', 'team-empty', 'Carregando…'));
  try {
    const dias = $('#reportDias').value;
    const data = await api('/api/report/diario?dias=' + dias);
    reportCache = data.report || [];
    const t = data.totais || {};
    totals.innerHTML = '';
    const cards = [
      { n: t.recebidos || 0, l: 'Leads recebidos' },
      { n: t.recebidos_chatwoot || 0, l: 'Via Chatwoot' },
      { n: t.qualificados || 0, l: 'Qualificados' },
      { n: t.ganhos || 0, l: 'Ganhos' },
    ];
    for (const c of cards) {
      const box = el('div', 'rt-card');
      box.append(el('div', 'rt-n', String(c.n)), el('div', 'rt-l', c.l));
      totals.append(box);
    }
    if (!reportCache.length) { body.append(el('div', 'team-empty', 'Sem movimento no período.')); return; }
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>Dia</th>' +
      '<th class="num">Recebidos</th><th class="num">Chatwoot</th>' +
      '<th class="num">Qualificados</th><th class="num">🌾 Prod.</th><th class="num">🐄 Pec.</th><th class="num">🔧 Prest.</th>' +
      '<th class="num">Ganhos</th><th class="num">Concorrente</th><th class="num">Desistiu</th></tr></thead>';
    const tb = document.createElement('tbody');
    for (const r of reportCache) {
      const tr = document.createElement('tr');
      const cells = [fmtDia(r.dia), r.recebidos, r.recebidos_chatwoot, r.qualificados,
        r.produtores, r.pecuaristas || 0, r.prestadores, r.ganhos, r.perdidos, r.desistidos || 0];
      cells.forEach((v, i) => {
        const td = document.createElement('td');
        if (i >= 1) td.className = 'num';
        td.textContent = String(v);
        tr.append(td);
      });
      tb.append(tr);
    }
    table.append(tb);
    body.append(table);
  } catch (err) {
    totals.innerHTML = '';
    body.innerHTML = '';
    body.append(el('div', 'team-empty', err.message));
  }
}

function baixarReportCsv() {
  if (!reportCache.length) { toast('Nada para exportar'); return; }
  const head = 'dia;recebidos;recebidos_chatwoot;qualificados;produtores;pecuaristas;prestadores;ganhos;perdidos;desistidos';
  const linhas = reportCache.map((r) => [r.dia, r.recebidos, r.recebidos_chatwoot,
    r.qualificados, r.produtores, r.pecuaristas || 0, r.prestadores, r.ganhos, r.perdidos, r.desistidos || 0].join(';'));
  const csv = '﻿' + head + '\n' + linhas.join('\n') + '\n';
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'relatorio-diario.csv';
  a.click();
}

$('#btnReport').addEventListener('click', () => { $('#reportBackdrop').hidden = false; renderReport(); });
$('#reportClose').addEventListener('click', () => { $('#reportBackdrop').hidden = true; });
$('#reportBackdrop').addEventListener('click', (e) => { if (e.target === $('#reportBackdrop')) $('#reportBackdrop').hidden = true; });
$('#reportDias').addEventListener('change', renderReport);
$('#btnReportCsv').addEventListener('click', baixarReportCsv);

// ---------------------------------------------------------------------------
// Importação em massa
// ---------------------------------------------------------------------------
const IMPORT_HEADER = 'nome;telefone;email;regiao;area_cultivada;produto;valor;cargo;decisor;pagamento;sdr;vendedor;canal;campanha;observacoes';
const IMPORT_EXEMPLO = 'João da Silva;+55 62 99999-0000;joao@email.com;Rio Verde - GO;500 ha;T70P;250000;Agrônomo;Proprietário (pai);Financiamento + Permuta;;;;;cliente antigo';
$('#importTemplate').href = 'data:text/csv;charset=utf-8,' +
  encodeURIComponent('﻿' + IMPORT_HEADER + '\n' + IMPORT_EXEMPLO + '\n');

// ---------------------------------------------------------------------------
// Ação em massa (gestor): aplica a mesma mudança a TODOS os clientes listados
// agora (respeita busca e filtros, para o usuário ver antes o que vai mudar).
// ---------------------------------------------------------------------------
function abrirBulk() {
  if (currentView === 'map') {
    toast('Abra uma aba de funil (Produtores, Prestadores…) para usar a ação em massa');
    return;
  }
  const vendNames = members.filter((m) => m.ativo !== false && m.papel === 'vendedor').map((m) => m.nome);
  fillSelect($('#bulkVendedor'), vendNames, '', '— manter como está —');
  $('#bulkTipo').value = '';
  $('#bulkQualificar').checked = false;
  $('#bulkResult').innerHTML = '';
  const alvos = alvosMassa();        // só os não-encerrados desta aba
  const n = alvos.length;
  const encerrados = leadsDaVisao().length - n;
  const aba = VIEW_LABEL[currentView] || currentView;
  $('#bulkResumo').textContent = n
    ? `${n} cliente${n > 1 ? 's' : ''} da aba “${aba}” ${n > 1 ? 'serão alterados' : 'será alterado'}.`
      + (encerrados ? ` (${encerrados} já encerrado(s) não conta(m).)` : '')
    : `Nenhum cliente alterável na aba “${aba}” — troque de aba ou ajuste a busca/filtros.`;
  $('#btnBulkRun').disabled = !n;
  $('#bulkBackdrop').hidden = false;
}

async function rodarBulk() {
  const ids = alvosMassa().map((l) => l.id);   // exclui Ganho/Perdido/Desistiu
  const vendedor = $('#bulkVendedor').value;
  const tipo = $('#bulkTipo').value;
  const qualificar = $('#bulkQualificar').checked;
  if (!ids.length) return;
  if (!vendedor && !tipo && !qualificar) { toast('Escolha o vendedor e/ou a classificação'); return; }
  const oque = [vendedor && `vendedor: ${vendedor}`, tipo && `classificação: ${tipo}`,
    qualificar && 'mover para o funil de vendas'].filter(Boolean).join(' · ');
  const aba = VIEW_LABEL[currentView] || currentView;
  if (!confirm(`Aplicar a ${ids.length} cliente(s) da aba "${aba}"?\n\n${oque}\n\n`
    + 'Negócios já encerrados (Ganhos, Perdidos ou Desistidos) não serão alterados.')) return;
  const btn = $('#btnBulkRun');
  btn.disabled = true; btn.textContent = 'Aplicando…';
  try {
    const res = await api('/api/leads/bulk', {
      method: 'POST', body: JSON.stringify({ ids, vendedor, tipo, qualificar }),
    });
    const box = $('#bulkResult');
    box.innerHTML = '';
    box.append(el('div', null, `✅ ${res.atualizados} cliente(s) atualizado(s).`));
    if (res.sem_alteracao) box.append(el('div', null, `• ${res.sem_alteracao} já estava(m) assim (nada mudou).`));
    if (res.fechados_ignorados) box.append(el('div', null, `• ${res.fechados_ignorados} negócio(s) já encerrado(s) não foram tocados.`));
    for (const f of (res.falhas || []).slice(0, 20)) {
      box.append(el('div', 'import-erro', `⚠️ ${f.nome}: ${f.motivo}`));
    }
    if ((res.falhas || []).length > 20) box.append(el('div', 'import-erro', `… e mais ${res.falhas.length - 20}.`));
    await refreshAll();
    toast(`✅ ${res.atualizados} cliente(s) atualizado(s)`);
  } catch (err) {
    toast('Erro: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Aplicar';
  }
}

$('#btnBulk').addEventListener('click', abrirBulk);
$('#bulkClose').addEventListener('click', () => { $('#bulkBackdrop').hidden = true; });
$('#bulkBackdrop').addEventListener('click', (e) => {
  if (e.target === $('#bulkBackdrop')) $('#bulkBackdrop').hidden = true;
});
$('#btnBulkRun').addEventListener('click', rodarBulk);

$('#btnImport').addEventListener('click', () => {
  $('#importResult').innerHTML = '';
  $('#importFile').value = '';
  $('#importBackdrop').hidden = false;
});
$('#importClose').addEventListener('click', () => { $('#importBackdrop').hidden = true; });
$('#importBackdrop').addEventListener('click', (e) => {
  if (e.target === $('#importBackdrop')) $('#importBackdrop').hidden = true;
});

$('#btnImportRun').addEventListener('click', async () => {
  const f = $('#importFile').files[0];
  if (!f) { toast('Escolha o arquivo CSV primeiro'); return; }
  const buf = await f.arrayBuffer();
  let texto;
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (_) {
    texto = new TextDecoder('windows-1252').decode(buf); // Excel antigo (pt-BR)
  }
  const btn = $('#btnImportRun');
  btn.disabled = true;
  btn.textContent = 'Importando…';
  try {
    const res = await api('/api/leads/import', { method: 'POST', body: JSON.stringify({ csv: texto }) });
    const box = $('#importResult');
    box.innerHTML = '';
    box.append(el('div', 'import-ok', `✅ ${res.criados} lead(s) importado(s) com sucesso`));
    if (res.rejeitados && res.rejeitados.length) {
      box.append(el('div', 'import-bad', `⚠️ ${res.rejeitados.length} linha(s) puladas:`));
      const ul = el('ul', 'import-list');
      for (const r of res.rejeitados) ul.append(el('li', null, `Linha ${r.linha}: ${r.motivo}`));
      box.append(ul);
    }
    refreshAll();
  } catch (err) {
    toast('Erro na importação: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Importar';
  }
});

// ---------------------------------------------------------------------------
// Usuários e níveis de acesso (só administrador)
// ---------------------------------------------------------------------------
const PAPEL_LABEL = { admin: 'Admin', gerente: 'Gerente', vendedor: 'Vendedor', sdr: 'SDR' };

async function renderTeam() {
  const list = $('#teamList');
  list.innerHTML = '';
  let users = [];
  try {
    users = (await api('/api/users')).users || [];
  } catch (err) {
    list.append(el('div', 'team-empty', err.message));
    return;
  }
  const order = { admin: 0, gerente: 1, vendedor: 2, sdr: 3 };
  users.sort((a, b) => (order[a.papel] - order[b.papel]) || a.nome.localeCompare(b.nome));
  for (const u of users) {
    const row = el('div', 'team-row' + (u.ativo === false ? ' inactive' : ''));
    const info = el('span', 'tname');
    info.append(document.createTextNode(u.nome + ' '));
    info.append(el('small', 'tlogin', '@' + u.login + (u.senha_definida ? '' : ' · SEM SENHA')));
    row.append(info);
    row.append(el('span', `role-badge ${u.papel === 'sdr' || u.papel === 'vendedor' ? u.papel : 'outro'}`, PAPEL_LABEL[u.papel] || u.papel));

    const nivel = document.createElement('select');
    for (const p of ['sdr', 'vendedor', 'gerente', 'admin']) nivel.append(new Option(PAPEL_LABEL[p], p));
    nivel.value = u.papel;
    nivel.title = 'Nível de acesso';
    nivel.onchange = async () => {
      try {
        await api('/api/users/' + u.id, { method: 'PATCH', body: JSON.stringify({ papel: nivel.value }) });
        toast('Nível de ' + u.nome + ' → ' + PAPEL_LABEL[nivel.value]);
      } catch (err) { toast('Erro: ' + err.message); }
      await loadMembers(); renderTeam(); renderBoard();
    };
    row.append(nivel);

    // acesso ao painel de Recuperação (só faz sentido p/ SDR e vendedor —
    // admin/gerente sempre têm)
    if (u.papel === 'sdr' || u.papel === 'vendedor') {
      const rec = el('button', 'recup-btn' + (u.acesso_recuperacao ? ' on' : ''),
        u.acesso_recuperacao ? '🔄 Recuperação: liberado' : '🔄 Recuperação: bloqueado');
      rec.type = 'button';
      rec.title = u.acesso_recuperacao
        ? 'Tem acesso à Recuperação — clique para bloquear'
        : 'Sem acesso à Recuperação — clique para liberar';
      rec.onclick = async () => {
        try {
          await api('/api/users/' + u.id, { method: 'PATCH', body: JSON.stringify({ acesso_recuperacao: !u.acesso_recuperacao }) });
          toast('Recuperação de ' + u.nome + (u.acesso_recuperacao ? ' → bloqueado' : ' → liberado'));
          renderTeam();
        } catch (err) { toast('Erro: ' + err.message); }
      };
      row.append(rec);
    }

    const senha = el('button', 'icon-btn', '🔑');
    senha.title = 'Definir nova senha';
    senha.type = 'button';
    senha.onclick = async () => {
      const nova = prompt('Nova senha para ' + u.nome + ' (mínimo 6 caracteres):');
      if (!nova) return;
      try {
        await api('/api/users/' + u.id, { method: 'PATCH', body: JSON.stringify({ senha: nova }) });
        toast('Senha de ' + u.nome + ' atualizada');
        renderTeam();
      } catch (err) { toast('Erro: ' + err.message); }
    };
    const toggle = el('button', 'icon-btn', u.ativo === false ? '☑️' : '✅');
    toggle.title = u.ativo === false ? 'Reativar' : 'Desativar (bloqueia o login)';
    toggle.type = 'button';
    toggle.onclick = async () => {
      try {
        await api('/api/users/' + u.id, { method: 'PATCH', body: JSON.stringify({ ativo: u.ativo === false }) });
      } catch (err) { toast('Erro: ' + err.message); }
      await loadMembers(); renderTeam(); renderBoard();
    };
    const del = el('button', 'icon-btn', '🗑️');
    del.title = 'Excluir usuário';
    del.type = 'button';
    del.onclick = async () => {
      if (!confirm(`Excluir o usuário ${u.nome}? Os leads dele continuam no quadro.`)) return;
      try {
        await api('/api/users/' + u.id, { method: 'DELETE' });
      } catch (err) { toast('Erro: ' + err.message); }
      await loadMembers(); renderTeam(); renderBoard();
    };
    row.append(senha, toggle, del);
    list.append(row);
  }
}

$('#teamForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('/api/users', {
      method: 'POST',
      body: JSON.stringify({
        nome: f.nome.value.trim(),
        login: f.login.value.trim(),
        senha: f.senha.value,
        papel: f.papel.value,
      }),
    });
    f.nome.value = ''; f.login.value = ''; f.senha.value = '';
    await loadMembers(); renderTeam(); renderBoard();
    toast('Usuário criado');
  } catch (err) { toast('Erro: ' + err.message); }
});

// ---------------------------------------------------------------------------
// Eventos globais
// ---------------------------------------------------------------------------
$('#btnNew').addEventListener('click', () => openModal(null));
$('#btnRefresh').addEventListener('click', async () => {
  toast((await refreshAll()) ? 'Atualizado' : 'Erro ao atualizar — o servidor está no ar?');
});
$('#btnCampaigns').addEventListener('click', () => {
  renderCampaigns(); renderCampReport();
  $('#campBackdrop').hidden = false;
});
$('#campClose').addEventListener('click', () => { $('#campBackdrop').hidden = true; refreshAll(); });
$('#campBackdrop').addEventListener('click', (e) => {
  if (e.target === $('#campBackdrop')) { $('#campBackdrop').hidden = true; refreshAll(); }
});
$('#btnUsers').addEventListener('click', () => { renderTeam(); $('#teamBackdrop').hidden = false; });
$('#btnLogout').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch (_) {}
  await limpaCacheApi(); // não deixar dados deste usuário no cache p/ o próximo login
  window.location.href = 'login.html';
});
$('#teamClose').addEventListener('click', () => { $('#teamBackdrop').hidden = true; });
$('#teamBackdrop').addEventListener('click', (e) => { if (e.target === $('#teamBackdrop')) $('#teamBackdrop').hidden = true; });
$('#modalClose').addEventListener('click', closeModal);
$('#btnCancel').addEventListener('click', closeModal);
$('#btnSave').addEventListener('click', saveLead);
$('#btnDelete').addEventListener('click', deleteLead);
$('#modalBackdrop').addEventListener('click', (e) => { if (e.target === $('#modalBackdrop')) closeModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#modalBackdrop').hidden) closeModal();
  if (!$('#teamBackdrop').hidden) { $('#teamBackdrop').hidden = true; refreshAll(); }
  if (!$('#campBackdrop').hidden) { $('#campBackdrop').hidden = true; refreshAll(); }
  if (!$('#importBackdrop').hidden) $('#importBackdrop').hidden = true;
  if (!$('#bulkBackdrop').hidden) $('#bulkBackdrop').hidden = true;
  if (!$('#reportBackdrop').hidden) $('#reportBackdrop').hidden = true;
  if (!$('#visitBackdrop').hidden) $('#visitBackdrop').hidden = true;
  if (!$('#teamActBackdrop').hidden) $('#teamActBackdrop').hidden = true;
  if (!$('#alertasCfgBackdrop').hidden) $('#alertasCfgBackdrop').hidden = true;
});

$('#tabSDR').addEventListener('click', () => setView('sdr'));
$('#tabProdutor').addEventListener('click', () => setView('produtor'));
$('#tabPecuarista').addEventListener('click', () => setView('pecuarista'));
$('#tabPrestador').addEventListener('click', () => setView('prestador'));
$('#tabPerdidos').addEventListener('click', () => setView('perdidos'));
$('#tabDesistiu').addEventListener('click', () => setView('desistiu'));
$('#tabMap').addEventListener('click', () => setView('map'));
$('#escAtuais').addEventListener('click', () => setEscopo('atuais'));
$('#escRecup').addEventListener('click', () => setEscopo('recuperacao'));
$('#escServ').addEventListener('click', () => setEscopo('servicos'));

// mudar o valor do lead recalcula as parcelas das formas de pagamento
form.valor.addEventListener('input', updatePayTotal);
// adiciona mais um drone ao pedido
const btnAddItem = $('#btnAddItem');
if (btnAddItem) btnAddItem.addEventListener('click', () => $('#itensBox').append(criaItemRow('', 1)));
// link "Abrir no WhatsApp" ao lado do telefone (atualiza ao digitar)
function atualizaWaLead() {
  const a = $('#waLead');
  if (!a) return;
  const href = waHref(form.telefone.value);
  a.hidden = !href;
  if (href) a.href = href;
}
form.telefone.addEventListener('input', atualizaWaLead);
// abrir o WhatsApp pela ficha aberta também marca "aguardando registrar a resposta"
const waLeadEl = $('#waLead');
if (waLeadEl) waLeadEl.addEventListener('click', () => registrarContatoWhatsapp(form.id.value));
form.regiao.addEventListener('input', (e) => renderCidadeBox(e.target.value));
form.regiao.addEventListener('focus', (e) => renderCidadeBox(e.target.value));
form.regiao.addEventListener('blur', () => setTimeout(() => { $('#cidadesBox').hidden = true; }, 150));
form.regiao.addEventListener('keydown', cidadeKeydown);

let searchTimer = null;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { currentFilters.q = e.target.value; loadLeads(); }, 250);
});
// ---------------------------------------------------------------------------
// Filtros em "chips" (estilo Aegro): só a busca fica visível; o resto é
// adicionado sob demanda pelo botão "+ Adicionar filtro".
// ---------------------------------------------------------------------------
let cidadesDisponiveis = [];   // preenchido pelo /api/stats
let mesorregioesDisp = [];     // mesorregiões do IBGE (GO), do /api/stats
let laneOptionsDisp = [];      // preenchido pelo renderBoard
let chipsAtivos = [];          // ordem das chaves de filtro adicionadas

const FILTER_DEFS = {
  produto: { label: 'Drone', client: false, opts: () => PRODUTOS.map((p) => ({ v: p, t: p })) },
  pagamento: { label: 'Forma de pagamento', client: false, opts: () => PAGAMENTOS.map((p) => ({ v: p, t: p })) },
  cidade: { label: 'Cidade', client: false, opts: () => cidadesDisponiveis.map((c) => ({ v: c, t: c })) },
  mesorregiao: { label: 'Mesorregião (GO)', client: false, opts: () => mesorregioesDisp.map((m) => ({ v: m, t: m })) },
  hectare: {
    label: 'Faixa de hectare', client: false, opts: () => [
      { v: '0-500', t: 'Até 500 ha' }, { v: '500-1000', t: '500 – 1.000 ha' },
      { v: '1000-2000', t: '1.000 – 2.000 ha' }, { v: '2000-5000', t: '2.000 – 5.000 ha' },
      { v: '5000+', t: 'Acima de 5.000 ha' }],
  },
  vendedor: {
    label: 'Vendedor', client: false, opts: () => [
      ...members.filter((m) => m.ativo !== false && m.papel === 'vendedor').map((m) => ({ v: m.nome, t: m.nome })),
      { v: '__none__', t: '(sem vendedor)' }],
  },
  sdr: {
    label: 'SDR', client: false, opts: () => [
      ...members.filter((m) => m.ativo !== false && m.papel === 'sdr').map((m) => ({ v: m.nome, t: m.nome })),
      { v: '__none__', t: '(sem SDR)' }],
  },
  canal: {
    label: 'Canal', client: false, opts: () =>
      ['Meta', 'Google', 'WhatsApp', 'TikTok', 'Indicação', 'Outro'].map((c) => ({ v: c, t: c })),
  },
};
const PRODUTOS = ['T25P', 'T70P', 'T55', 'T100', 'Peças e Serviços'];

function aplicaFiltro(key) {
  if (FILTER_DEFS[key].client) renderBoard(); else loadLeads();
  atualizaBotaoLimpar();
}

// Atalho do card de stats: abre a central de Alertas (respostas a registrar +
// retornos a fazer) juntando TODOS os funis num lugar só — o contador é global.
function abrirAlertas() {
  setView('alertas');
  // o contador do card é global; a central lê o leadsCache (que pode estar
  // filtrado). Limpa os filtros para a lista bater com o número do card.
  if (filtroAtivo()) limparFiltros();
}

function renderChips() {
  const box = $('#filterChips');
  box.innerHTML = '';
  for (const key of chipsAtivos) {
    const def = FILTER_DEFS[key];
    const chip = el('div', 'chip-filter');
    chip.append(el('span', 'chip-label', def.label + ':'));
    const sel = document.createElement('select');
    sel.dataset.key = key;
    montaOpcoes(sel, def, currentFilters[key]);
    sel.addEventListener('change', () => { currentFilters[key] = sel.value; aplicaFiltro(key); });
    chip.append(sel);
    const x = el('button', 'chip-x', '✕');
    x.type = 'button';
    x.title = 'Remover filtro';
    x.onclick = () => removeChip(key);
    chip.append(x);
    box.append(chip);
  }
  atualizaBotaoLimpar();
}

function montaOpcoes(sel, def, valorAtual) {
  sel.innerHTML = '';
  sel.append(new Option('todos', ''));
  const opts = def.opts();
  for (const o of opts) sel.append(new Option(o.t, o.v));
  if (valorAtual && !opts.some((o) => o.v === valorAtual)) sel.append(new Option(valorAtual, valorAtual));
  sel.value = valorAtual || '';
}

// atualiza as opções de um chip já aberto quando os dados chegam (cidades/raias)
function refreshChipOptions(key) {
  if (!chipsAtivos.includes(key)) return;
  const sel = $(`#filterChips select[data-key="${key}"]`);
  if (sel) montaOpcoes(sel, FILTER_DEFS[key], currentFilters[key]);
}

function addChip(key) {
  if (chipsAtivos.includes(key)) return;
  chipsAtivos.push(key);
  renderChips();
  // abre o seletor recém-criado para o usuário escolher o valor
  const sel = $(`#filterChips select[data-key="${key}"]`);
  if (sel) sel.focus();
}

function removeChip(key) {
  chipsAtivos = chipsAtivos.filter((k) => k !== key);
  const tinha = !!currentFilters[key];
  currentFilters[key] = '';
  renderChips();
  if (tinha) aplicaFiltro(key);
}

function toggleFilterMenu() {
  const menu = $('#filterMenu');
  if (!menu.hidden) { menu.hidden = true; return; }
  menu.innerHTML = '';
  const disponiveis = Object.keys(FILTER_DEFS).filter((k) => !chipsAtivos.includes(k));
  if (!disponiveis.length) {
    menu.append(el('div', 'filter-menu-empty', 'Todos os filtros já foram adicionados'));
  } else {
    for (const key of disponiveis) {
      const item = el('button', 'filter-menu-item', FILTER_DEFS[key].label);
      item.type = 'button';
      item.onclick = () => { menu.hidden = true; addChip(key); };
      menu.append(item);
    }
  }
  menu.hidden = false;
}

$('#btnAddFilter').addEventListener('click', (e) => { e.stopPropagation(); toggleFilterMenu(); });
// menu "Gerenciar" (agrupa as ferramentas de gestão para o topo ficar enxuto)
$('#btnManage').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#manageMenu').hidden = !$('#manageMenu').hidden;
});
$('#manageMenu').addEventListener('click', () => { $('#manageMenu').hidden = true; });
document.addEventListener('click', (e) => {
  if (!$('#filterMenu').hidden && !e.target.closest('.filter-add-wrap')) $('#filterMenu').hidden = true;
  if (!$('#manageMenu').hidden && !e.target.closest('.manage-wrap')) $('#manageMenu').hidden = true;
});
function limparFiltros() {
  // qualquer filtro server-side ativo exige recarregar a lista (a busca também)
  const recarrega = filtroAtivo();
  chipsAtivos = [];
  for (const k of Object.keys(FILTER_DEFS)) currentFilters[k] = '';
  currentFilters.q = '';
  $('#search').value = '';   // o campo e o estado não podem divergir
  renderChips();
  if (recarrega) loadLeads();           // loadLeads já re-renderiza a aba atual (inclui Perdidos)
  else if (currentView === 'perdidos') renderLost();
  else if (currentView === 'desistiu') renderDesistiu();
  else if (currentView === 'alertas') renderAlertas();
  else renderBoard();
}
$('#btnLimparFiltros').addEventListener('click', limparFiltros);
$('#btnLimparVazio').addEventListener('click', limparFiltros);
renderChips(); // estado inicial (só a busca + botão "Adicionar filtro")

loadCidades();
loadCidadesGeo();

// mostra uma dica só uma vez por carregamento
let _toastedOnce = false;
function toastOnce(msg) { if (_toastedOnce) return; _toastedOnce = true; toast(msg); }

// Atualização automática a cada 15s (pega leads novos do webhook).
// Só pausa durante a edição de um lead; com o painel de Campanhas aberto o
// quadro e o relatório continuam vivos (o formulário do painel não é tocado).
// ---------------------------------------------------------------------------
// Painel do gestor: quem está online + últimas movimentações da equipe
// ---------------------------------------------------------------------------
function openTeamActivity() {
  $('#onlineList').innerHTML = '';
  $('#atividadeList').innerHTML = el('div', 'ta-empty', 'Carregando…').outerHTML;
  $('#teamActBackdrop').hidden = false;
  carregarTeamActivity();
}

async function carregarTeamActivity() {
  try {
    const [on, at] = await Promise.all([api('/api/online'), api('/api/atividades?limite=80')]);
    renderOnline(on.usuarios || []);
    renderAtividades(at.atividades || []);
  } catch (err) { /* transitório: mantém o que já está na tela */ }
}

function renderOnline(usuarios) {
  const box = $('#onlineList');
  box.innerHTML = '';
  if (!usuarios.length) { box.append(el('div', 'ta-empty', 'Nenhum membro cadastrado.')); return; }
  const nOn = usuarios.filter((u) => u.online).length;
  if (!nOn) box.append(el('div', 'ta-empty', 'Ninguém online agora.'));
  for (const u of usuarios) {
    const c = el('div', 'online-chip' + (u.online ? ' on' : ''));
    c.append(el('span', 'dot'));
    c.append(el('span', 'nome', u.nome));
    c.append(el('span', 'papel', papelLabel(u.papel)));
    const quando = u.online ? 'online' : (u.segundos == null ? 'nunca entrou' : 'visto há ' + duracao(u.segundos * 1000));
    c.append(el('span', 'quando', quando));
    box.append(c);
  }
}

function renderAtividades(lista) {
  const box = $('#atividadeList');
  const st = box.scrollTop; // preserva a rolagem no refresh automático
  box.innerHTML = '';
  if (!lista.length) { box.append(el('div', 'ta-empty', 'Sem movimentações ainda.')); return; }
  for (const a of lista) {
    const row = el('div', 'atv' + (a.tipo === 'nota' ? ' nota' : ''));
    const top = el('div', 'atv-top');
    const cargo = a.papel ? papelLabel(a.papel) : '';
    top.append(el('span', 'atv-who', '👤 ' + (a.autor || 'Sistema') + (cargo && cargo !== a.autor ? ' · ' + cargo : '')));
    top.append(el('span', 'atv-when', dataHora(a.data, true)));
    row.append(top);
    for (const it of (a.itens || [])) row.append(el('div', 'atv-item', it));
    const lk = el('button', 'atv-lead', '📇 ' + (a.lead_nome || 'cliente'));
    lk.type = 'button';
    lk.onclick = () => {
      const lead = leadsCache.find((l) => l.id === a.lead_id);
      if (lead) { $('#teamActBackdrop').hidden = true; openModal(lead); }
      else toast('Abra o cliente pelo funil — ele não está na lista carregada agora.');
    };
    row.append(lk);
    box.append(row);
  }
  box.scrollTop = st; // restaura a rolagem
}

$('#btnTeamActivity').addEventListener('click', openTeamActivity);
$('#teamActClose').addEventListener('click', () => { $('#teamActBackdrop').hidden = true; });
$('#teamActBackdrop').addEventListener('click', (e) => {
  if (e.target === $('#teamActBackdrop')) $('#teamActBackdrop').hidden = true;
});

setInterval(async () => {
  if (!me) return; // ainda sem login
  // heartbeat: mantém a presença "online" viva mesmo com um modal aberto
  api('/api/heartbeat').catch(() => {});
  // painel de equipe aberto → atualiza online + atividade ao vivo
  if (!$('#teamActBackdrop').hidden) { carregarTeamActivity(); return; }
  if (!$('#modalBackdrop').hidden) return;
  // com a janela de ação em massa aberta, a lista não pode mudar embaixo do
  // usuário: o que ele confirmou tem que ser o que será alterado
  if (!$('#bulkBackdrop').hidden) return;
  await refreshAll();
  flushFila(); // tenta enviar o que foi registrado offline (se voltou o sinal)
  if (!$('#campBackdrop').hidden) renderCampReport();
}, 15000);

// ---------------------------------------------------------------------------
// Início: exige login e adapta a interface ao nível de acesso
// ---------------------------------------------------------------------------
function applyRoleUI() {
  const gestor = me.papel === 'admin' || me.papel === 'gerente';
  $('#userChip').textContent = `👤 ${me.nome} · ${PAPEL_LABEL[me.papel] || me.papel}`;
  $('#btnManage').hidden = !gestor;   // menu "Gerenciar" só para gestor/admin
  $('#btnTeamActivity').hidden = !gestor;
  $('#btnBulk').hidden = !gestor;
  $('#btnImport').hidden = !gestor;
  $('#btnReport').hidden = !gestor;
  $('#btnCampaigns').hidden = !gestor;
  $('#btnAlertas').hidden = !gestor;
  $('#btnUsers').hidden = me.papel !== 'admin';
  // botão "Recuperação" só para quem tem acesso liberado (admin/gerente sempre)
  $('#escRecup').hidden = !me.pode_recuperacao;
  // aviso de senha padrão (só para o admin que ainda não trocou)
  if (me.senha_padrao) {
    const aviso = $('#senhaPadraoAviso');
    aviso.hidden = false;
    aviso.onclick = () => { renderTeam(); $('#teamBackdrop').hidden = false; };
  }
  // vendedor não tem nada no funil SDR; entra direto na aba de Produtores
  if (me.papel === 'vendedor') {
    $('#tabSDR').hidden = true;
    setView('produtor');
  }
}

(async () => {
  try {
    me = (await api('/api/me')).user;
  } catch (_) {
    return; // api() já redirecionou para o login
  }
  // O navegador restaura o texto do campo de busca ao recarregar (F5). Sem
  // sincronizar, o campo mostrava um termo enquanto o filtro estava vazio — e
  // bastava digitar mais uma letra para "sumir tudo" de novo.
  currentFilters.q = $('#search').value || '';
  atualizaBotaoLimpar();
  applyRoleUI();
  await refreshAll();
  atualizaOfflineBar();   // reflete estado inicial + registros pendentes de sessões anteriores
  flushFila();            // envia o que ficou da última vez offline
})();
