'use strict';

// Rótulos das etapas (usados no seletor do modal; as chaves batem com o servidor)
const STAGE_LABELS = {
  novo: 'Novo lead (SDR)',
  triagem: 'Em triagem (SDR)',
  qualificado: 'Qualificado / Recebido (Vendas)',
  negociacao: 'Em negociação (Vendas)',
  proposta: 'Proposta enviada (Vendas)',
  ganho: 'Fechado (ganho)',
  perdido: 'Perdido',
};
let STAGES = ['novo', 'triagem', 'qualificado', 'negociacao', 'proposta', 'ganho', 'perdido'];

// Cada coluna carrega o "patch" que o arraste aplica e um "match" que decide
// quais leads ficam nela. Colunas de qualificação (q_prod/q_prest) não guardam
// leads: ao soltar, o lead muda de tipo/etapa e migra para a aba do tipo.
const COL = {
  novo: { key: 'novo', label: 'Novo lead', patch: { status: 'novo' }, match: (l) => (l.status || 'novo') === 'novo' },
  triagem: { key: 'triagem', label: 'Em triagem', patch: { status: 'triagem' }, match: (l) => l.status === 'triagem' },
  q_prod: { key: 'q_prod', label: '🌾 → Produtores', patch: { status: 'qualificado', tipo: 'produtor' }, match: () => false, envia: 'Produtores' },
  q_prest: { key: 'q_prest', label: '🔧 → Prestadores', patch: { status: 'qualificado', tipo: 'prestador' }, match: () => false, envia: 'Prestadores' },
  perd_sdr: { key: 'perd_sdr', label: 'Perdido na triagem', patch: { status: 'perdido' }, match: (l) => l.status === 'perdido' && !l.tipo },
  recebido: { key: 'recebido', label: '📥 Recebido do SDR', patch: { status: 'qualificado' }, match: (l) => l.status === 'qualificado' },
  negociacao: { key: 'negociacao', label: 'Em negociação', patch: { status: 'negociacao' }, match: (l) => l.status === 'negociacao' },
  proposta: { key: 'proposta', label: 'Proposta enviada', patch: { status: 'proposta' }, match: (l) => l.status === 'proposta' },
  ganho: { key: 'ganho', label: '🏆 Ganho', patch: { status: 'ganho' }, match: (l) => l.status === 'ganho' },
  perdido: { key: 'perdido', label: '🚩 Perdido', patch: { status: 'perdido' }, match: (l) => l.status === 'perdido' },
};

// Três funis, cada um numa aba. Produtores e Prestadores são iguais em etapas,
// mas separados pelo "tipo".
const FUNIS = {
  sdr: {
    papel: 'sdr', campo: 'sdr',
    colunas: [COL.novo, COL.triagem, COL.q_prod, COL.q_prest, COL.perd_sdr],
    inclui: (l) => ['novo', 'triagem'].includes(l.status || 'novo') || (l.status === 'perdido' && !l.tipo),
  },
  produtor: {
    papel: 'vendedor', campo: 'vendedor', tipo: 'produtor',
    colunas: [COL.recebido, COL.negociacao, COL.proposta, COL.ganho, COL.perdido],
    inclui: (l) => l.tipo === 'produtor' && (SALES.includes(l.status) || l.status === 'perdido'),
  },
  prestador: {
    papel: 'vendedor', campo: 'vendedor', tipo: 'prestador',
    colunas: [COL.recebido, COL.negociacao, COL.proposta, COL.ganho, COL.perdido],
    inclui: (l) => l.tipo === 'prestador' && (SALES.includes(l.status) || l.status === 'perdido'),
  },
};
const SALES = ['qualificado', 'negociacao', 'proposta', 'ganho'];

let leadsCache = [];
let members = [];
let campaigns = [];
let settings = {};
let me = null; // usuário logado {nome, papel: admin|gerente|vendedor|sdr}
let currentFilters = { q: '', canal: '', lane: '', pagamento: '', produto: '', cidade: '', hectare: '' };

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
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (res.status === 401) {
    window.location.href = 'login.html'; // sessão expirou: volta pro login
    throw new Error('Sessão expirada');
  }
  if (!res.ok) {
    let msg = 'Erro na requisição';
    try { msg = (await res.json()).error || msg; } catch (_) {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

// Dono do lead DENTRO de um funil (SDR no funil SDR, vendedor no de Vendas)
function laneKeyForLead(lead, funil) {
  return String(lead[funil.campo] || '').trim() || '__none__';
}

// ---------------------------------------------------------------------------
// Carregar dados
// ---------------------------------------------------------------------------
async function loadStats() {
  try {
    const s = await api('/api/stats');
    STAGES = s.stages || STAGES;
    const box = $('#stats');
    box.innerHTML = '';
    const cards = [
      { n: s.total, l: 'Leads no total' },
      { n: s.produtores || 0, l: '🌾 Produtores rurais' },
      { n: s.prestadores || 0, l: '🔧 Prestadores de serviço' },
      { n: (s.por_status.ganho || {}).count || 0, l: 'Negócios ganhos' },
      { n: brl(s.valor_pipeline), l: 'Valor no pipeline' },
    ];
    for (const c of cards) {
      const d = el('div', 'stat');
      d.append(el('div', 'n', String(c.n)), el('div', 'l', c.l));
      box.append(d);
    }
    preencheFiltroCidades(s.cidades || []);
  } catch (err) { console.error(err); }
}

// popula o filtro de cidade com as cidades que existem nos leads (preserva escolha)
function preencheFiltroCidades(lista) {
  const sel = $('#filterCidade');
  const atual = currentFilters.cidade;
  sel.innerHTML = '';
  sel.append(new Option('Todas as cidades', ''));
  for (const c of lista) sel.append(new Option(c, c));
  if (atual && !lista.includes(atual)) sel.append(new Option(atual, atual)); // mantém filtro ativo
  sel.value = atual || '';
}

function atualizaBotaoLimpar() {
  const ativo = !!(currentFilters.q || currentFilters.canal || currentFilters.pagamento ||
    currentFilters.produto || currentFilters.cidade || currentFilters.hectare || currentFilters.lane);
  $('#btnLimparFiltros').hidden = !ativo;
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

function pinClass(lead, exato) {
  if (lead.status === 'ganho') return 'won';
  if (lead.status === 'perdido') return 'lost';
  return exato ? 'exato' : 'aprox';
}
function pinFlag(lead) {
  if (lead.status === 'ganho') return '<span class="pin-flag">🟢</span>';
  if (lead.status === 'perdido') return '<span class="pin-flag">🔴</span>';
  return '';
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
      html: `<div class="lead-pin ${pinClass(lead, loc.exato)}${ajustando ? ' movendo' : ''}"></div>${pinFlag(lead)}`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    // só arrasta quando o usuário pediu para ajustar (evita mover sem querer)
    const mk = L.marker(loc.pos, { icon, draggable: ajustando });

    const pop = el('div', 'map-popup');
    const nome = el('div', 'pp-nome');
    if (lead.status === 'ganho') nome.append(el('span', 'flag', '🟢 '));
    else if (lead.status === 'perdido') nome.append(el('span', 'flag', '🔴 '));
    nome.append(document.createTextNode(lead.nome || '(sem nome)'));
    pop.append(nome);
    if (lead.regiao) pop.append(el('div', 'pp-linha', '📍 ' + lead.regiao + (loc.exato ? ' · fazenda exata' : ' · local aproximado')));
    if (lead.produto) pop.append(el('div', 'pp-linha', '📦 ' + lead.produto));
    if (lead.valor > 0) pop.append(el('div', 'pp-linha', '💰 ' + brl(lead.valor)));
    const resp = lead.vendedor || lead.sdr;
    if (resp) pop.append(el('div', 'pp-linha', '👤 ' + resp));

    const acoes = el('div', 'pp-acoes');
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
  $('#tabPrestador').classList.toggle('active', view === 'prestador');
  $('#tabMap').classList.toggle('active', view === 'map');
  $('#boardWrap').hidden = view === 'map';
  $('#mapWrap').hidden = view !== 'map';
  if (view === 'map') {
    ensureMap();
    // o container acabou de ficar visível; o Leaflet precisa remedir
    setTimeout(() => { map.invalidateSize(); renderMap(); }, 60);
  } else {
    renderBoard();
  }
}

async function loadLeads() {
  const params = new URLSearchParams();
  if (currentFilters.q) params.set('q', currentFilters.q);
  if (currentFilters.canal) params.set('canal', currentFilters.canal);
  if (currentFilters.pagamento) params.set('pagamento', currentFilters.pagamento);
  if (currentFilters.produto) params.set('produto', currentFilters.produto);
  if (currentFilters.cidade) params.set('cidade', currentFilters.cidade);
  if (currentFilters.hectare && HECTARE_RANGES[currentFilters.hectare]) {
    const r = HECTARE_RANGES[currentFilters.hectare];
    params.set('ha_min', r.min);
    if (r.max != null) params.set('ha_max', r.max);
  }
  atualizaBotaoLimpar();
  const data = await api('/api/leads?' + params.toString());
  STAGES = data.stages || STAGES;
  leadsCache = data.leads || [];
  renderBoard();
  if (currentView === 'map') renderMap();
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
  const sel = $('#filterLane');
  const prev = currentFilters.lane;
  sel.innerHTML = '';
  sel.append(new Option('Todas as raias', ''));
  for (const ln of lanes) sel.append(new Option(ln.nome, ln.key));
  sel.value = lanes.some((l) => l.key === prev) ? prev : '';
  currentFilters.lane = sel.value;
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
  const card = el('div', 'card' + (lead.status === 'ganho' ? ' won' : lead.status === 'perdido' ? ' lost' : ''));
  card.draggable = true;
  card.dataset.id = lead.id;

  const nome = el('div', 'name');
  if (lead.status === 'ganho') nome.append(el('span', 'flag', '🟢'));
  else if (lead.status === 'perdido') nome.append(el('span', 'flag', '🔴'));
  nome.append(document.createTextNode(lead.nome || '(sem nome)'));
  card.append(nome);
  if (lead.telefone) { const r = el('div', 'row'); r.append(el('span', 'ic', '📱'), document.createTextNode(lead.telefone)); card.append(r); }
  if (lead.regiao) { const r = el('div', 'row'); r.append(el('span', 'ic', '📍'), document.createTextNode(lead.regiao)); card.append(r); }
  if (lead.area_cultivada) { const r = el('div', 'row'); r.append(el('span', 'ic', '🌾'), document.createTextNode(lead.area_cultivada)); card.append(r); }
  if (lead.produto) { const r = el('div', 'row'); r.append(el('span', 'ic', '📦'), document.createTextNode(lead.produto)); card.append(r); }
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
  if (lead.valor > 0) tags.append(el('span', 'tag valor', brl(lead.valor)));
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

  const before = { status: lead.status, sdr: lead.sdr, vendedor: lead.vendedor, tipo: lead.tipo };
  Object.assign(lead, patch);
  renderBoard();

  try {
    await api('/api/leads/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(patch) });
    loadStats();
    if (col.envia) {
      toast(`✅ Qualificado! Enviado para a aba ${col.envia}`);
    } else {
      const dest = lane.isNone ? 'Sem responsável' : lane.nome;
      toast(`→ ${col.label} · ${dest}`);
    }
  } catch (err) {
    Object.assign(lead, before);
    renderBoard();
    toast('Erro ao mover: ' + err.message);
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

  form.id.value = lead.id || '';
  // canal fora da lista fixa (ex.: utm_source cru vindo do webhook): injeta a
  // opção — senão o select fica vazio e o Salvar apagaria o canal
  if (lead.origem_canal && ![...form.origem_canal.options].some((o) => o.value === lead.origem_canal)) {
    form.origem_canal.append(new Option(lead.origem_canal, lead.origem_canal));
  }
  // mesmo tratamento para produto vindo do webhook fora da linha padrão
  if (lead.produto && ![...form.produto.options].some((o) => o.value === lead.produto)) {
    form.produto.append(new Option(lead.produto, lead.produto));
  }
  const fields = ['nome', 'telefone', 'email', 'regiao', 'area_cultivada', 'produto', 'valor',
    'cargo', 'decisor', 'decisor_cargo',
    'campanha', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'observacoes', 'origem_canal'];
  for (const f of fields) if (form[f]) form[f].value = lead[f] != null ? lead[f] : '';

  renderPagamentos(lead.formas_pagamento || []);
  modalPagInitial = JSON.stringify(canonPagamentos(lead.formas_pagamento || []));
  renderVisitas(isNew ? null : lead);
  $('#btnRegistrarVisita').disabled = isNew;

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
    else vals[field.name] = field.value;
  }
  return vals;
}
let modalInitial = {};
let modalPagInitial = '[]';

// ---- Forma de pagamento (multi + valor + parcelamento) ----
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
      const a = document.createElement('a');
      a.href = 'api/foto/' + encodeURIComponent(v.foto);
      a.target = '_blank';
      const img = document.createElement('img');
      img.className = 'visit-thumb';
      img.src = 'api/foto/' + encodeURIComponent(v.foto);
      img.alt = 'Foto da fazenda';
      a.append(img);
      item.append(a);
    }
    const info = el('div', 'visit-info');
    info.append(el('div', 'visit-res', v.resultado || '(sem resultado)'));
    const meta = el('div', 'visit-meta');
    meta.textContent = `👤 ${v.visitante || '—'} · ${dataHora(v.data, true)}`;
    info.append(meta);
    if (v.obs) info.append(el('div', 'visit-obs', v.obs));
    item.append(info);
    const podeExcluir = me && (me.papel === 'admin' || me.papel === 'gerente' || v.visitante === me.nome);
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
  $('#visitGeo').checked = false;
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
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000 });
  });
}

async function salvarVisita() {
  const id = form.id.value;
  if (!id) return;
  const btn = $('#visitSalvar');
  btn.disabled = true; btn.textContent = 'Salvando…';
  try {
    const body = {
      resultado: $('#visitResultado').value,
      obs: $('#visitObs').value,
      foto: visitFotoData || '',
    };
    if ($('#visitGeo').checked) {
      const loc = await pegarLocalizacao();
      if (loc) { body.lat = loc.lat; body.lng = loc.lng; }
      else toast('Não consegui pegar o GPS — visita salva sem localização');
    }
    const res = await api('/api/leads/' + encodeURIComponent(id) + '/visitas', {
      method: 'POST', body: JSON.stringify(body),
    });
    // atualiza o lead em memória e as telas
    const lead = leadsCache.find((l) => l.id === id);
    if (lead) {
      lead.visitas = lead.visitas || [];
      lead.visitas.push(res.visita);
      if (body.lat != null) { lead.lat = res.visita.lat; lead.lng = res.visita.lng; }
      renderVisitas(lead);
      renderBoard();
    }
    $('#visitBackdrop').hidden = true;
    toast('✅ Visita registrada');
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
      '<th class="num">Qualificados</th><th class="num">🌾 Prod.</th><th class="num">🔧 Prest.</th>' +
      '<th class="num">Ganhos</th><th class="num">Perdidos</th></tr></thead>';
    const tb = document.createElement('tbody');
    for (const r of reportCache) {
      const tr = document.createElement('tr');
      const cells = [fmtDia(r.dia), r.recebidos, r.recebidos_chatwoot, r.qualificados,
        r.produtores, r.prestadores, r.ganhos, r.perdidos];
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
  const head = 'dia;recebidos;recebidos_chatwoot;qualificados;produtores;prestadores;ganhos;perdidos';
  const linhas = reportCache.map((r) => [r.dia, r.recebidos, r.recebidos_chatwoot,
    r.qualificados, r.produtores, r.prestadores, r.ganhos, r.perdidos].join(';'));
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
  if (!$('#reportBackdrop').hidden) $('#reportBackdrop').hidden = true;
  if (!$('#visitBackdrop').hidden) $('#visitBackdrop').hidden = true;
});

$('#tabSDR').addEventListener('click', () => setView('sdr'));
$('#tabProdutor').addEventListener('click', () => setView('produtor'));
$('#tabPrestador').addEventListener('click', () => setView('prestador'));
$('#tabMap').addEventListener('click', () => setView('map'));

// mudar o valor do lead recalcula as parcelas das formas de pagamento
form.valor.addEventListener('input', updatePayTotal);
form.regiao.addEventListener('input', (e) => renderCidadeBox(e.target.value));
form.regiao.addEventListener('focus', (e) => renderCidadeBox(e.target.value));
form.regiao.addEventListener('blur', () => setTimeout(() => { $('#cidadesBox').hidden = true; }, 150));
form.regiao.addEventListener('keydown', cidadeKeydown);

let searchTimer = null;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { currentFilters.q = e.target.value; loadLeads(); }, 250);
});
$('#filterCanal').addEventListener('change', (e) => { currentFilters.canal = e.target.value; loadLeads(); });
$('#filterPagamento').addEventListener('change', (e) => { currentFilters.pagamento = e.target.value; loadLeads(); });
$('#filterProduto').addEventListener('change', (e) => { currentFilters.produto = e.target.value; loadLeads(); });
$('#filterCidade').addEventListener('change', (e) => { currentFilters.cidade = e.target.value; loadLeads(); });
$('#filterHectare').addEventListener('change', (e) => { currentFilters.hectare = e.target.value; loadLeads(); });
$('#filterLane').addEventListener('change', (e) => { currentFilters.lane = e.target.value; renderBoard(); atualizaBotaoLimpar(); });
$('#btnLimparFiltros').addEventListener('click', () => {
  currentFilters = { q: '', canal: '', lane: '', pagamento: '', produto: '', cidade: '', hectare: '' };
  $('#search').value = '';
  for (const id of ['filterCanal', 'filterPagamento', 'filterProduto', 'filterCidade', 'filterHectare', 'filterLane']) $('#' + id).value = '';
  loadLeads();
});

loadCidades();
loadCidadesGeo();

// mostra uma dica só uma vez por carregamento
let _toastedOnce = false;
function toastOnce(msg) { if (_toastedOnce) return; _toastedOnce = true; toast(msg); }

// Atualização automática a cada 15s (pega leads novos do webhook).
// Só pausa durante a edição de um lead; com o painel de Campanhas aberto o
// quadro e o relatório continuam vivos (o formulário do painel não é tocado).
setInterval(async () => {
  if (!me) return; // ainda sem login
  if (!$('#modalBackdrop').hidden) return;
  await refreshAll();
  if (!$('#campBackdrop').hidden) renderCampReport();
}, 15000);

// ---------------------------------------------------------------------------
// Início: exige login e adapta a interface ao nível de acesso
// ---------------------------------------------------------------------------
function applyRoleUI() {
  const gestor = me.papel === 'admin' || me.papel === 'gerente';
  $('#userChip').textContent = `👤 ${me.nome} · ${PAPEL_LABEL[me.papel] || me.papel}`;
  $('#btnImport').hidden = !gestor;
  $('#btnReport').hidden = !gestor;
  $('#btnCampaigns').hidden = !gestor;
  $('#btnUsers').hidden = me.papel !== 'admin';
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
  applyRoleUI();
  refreshAll();
})();
