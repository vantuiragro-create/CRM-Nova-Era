'use strict';

// Rótulos das etapas (usados no seletor do modal; as chaves batem com o servidor)
const STAGE_LABELS = {
  novo: 'Novo lead (SDR)',
  triagem: 'Em triagem (SDR)',
  produtor: 'Qualificado / Recebido (Vendas)',
  negociacao: 'Em negociação (Vendas)',
  proposta: 'Proposta enviada (Vendas)',
  ganho: 'Fechado (ganho)',
  perdido: 'Perdido',
  prestador: 'Prestador / fora do perfil',
};
let STAGES = ['novo', 'triagem', 'produtor', 'negociacao', 'proposta', 'ganho', 'perdido', 'prestador'];

// Dois funis separados: o do SDR (primeiro contato/qualificação) e o de
// Vendas. O mesmo lead nunca aparece nos dois — ao ser qualificado, ele sai
// do funil SDR e entra no de Vendas (coluna "Recebido do SDR").
const FUNIS = {
  sdr: {
    stages: ['novo', 'triagem', 'produtor', 'prestador', 'perdido'],
    labels: {
      novo: 'Novo lead',
      triagem: 'Em triagem',
      produtor: '✅ Qualificado → Vendas',
      prestador: 'Prestador / fora do perfil',
      perdido: 'Perdido na triagem',
    },
    papel: 'sdr',
    campo: 'sdr',
    inclui: (l) => ['novo', 'triagem', 'prestador'].includes(l.status || 'novo') ||
      (l.status === 'perdido' && l.tipo !== 'produtor'),
  },
  vendas: {
    stages: ['produtor', 'negociacao', 'proposta', 'ganho', 'perdido'],
    labels: {
      produtor: '🌾 Recebido do SDR',
      negociacao: 'Em negociação',
      proposta: 'Proposta enviada',
      ganho: 'Fechado (ganho)',
      perdido: 'Perdido (não fechou)',
    },
    papel: 'vendedor',
    campo: 'vendedor',
    inclui: (l) => ['produtor', 'negociacao', 'proposta', 'ganho'].includes(l.status) ||
      (l.status === 'perdido' && l.tipo === 'produtor'),
  },
};

let leadsCache = [];
let members = [];
let campaigns = [];
let settings = {};
let me = null; // usuário logado {nome, papel: admin|gerente|vendedor|sdr}
let currentFilters = { q: '', canal: '', lane: '' };

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
      { n: s.produtores || 0, l: 'Produtores rurais' },
      { n: (s.por_status.ganho || {}).count || 0, l: 'Negócios ganhos' },
      { n: brl(s.valor_pipeline), l: 'Valor no pipeline' },
    ];
    for (const c of cards) {
      const d = el('div', 'stat');
      d.append(el('div', 'n', String(c.n)), el('div', 'l', c.l));
      box.append(d);
    }
  } catch (err) { console.error(err); }
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

function renderMap() {
  if (!map) return;
  markersLayer.clearLayers();
  const bounds = [];
  for (const lead of leadsCache) {
    const loc = leadPosition(lead);
    if (!loc) continue;
    const icon = L.divIcon({
      className: '',
      html: `<div class="lead-pin ${loc.exato ? 'exato' : 'aprox'}"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    const mk = L.marker(loc.pos, { icon, draggable: true });

    const pop = el('div', 'map-popup');
    pop.append(el('div', 'pp-nome', lead.nome || '(sem nome)'));
    if (lead.regiao) pop.append(el('div', 'pp-linha', '📍 ' + lead.regiao + (loc.exato ? ' · fazenda exata' : ' · aproximado')));
    if (lead.produto) pop.append(el('div', 'pp-linha', '📦 ' + lead.produto));
    if (lead.valor > 0) pop.append(el('div', 'pp-linha', '💰 ' + brl(lead.valor)));
    const resp = lead.vendedor || lead.sdr;
    if (resp) pop.append(el('div', 'pp-linha', '👤 ' + resp));
    const acao = el('span', 'pp-acao', 'Abrir lead');
    acao.onclick = () => { map.closePopup(); openModal(lead); };
    pop.append(acao);
    mk.bindPopup(pop);

    mk.on('dragend', () => {
      const p = mk.getLatLng();
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
  $('#tabVendas').classList.toggle('active', view === 'vendas');
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
  board.style.gridTemplateColumns = `var(--lane-w) repeat(${funil.stages.length}, var(--col-w))`;

  const leadsFunil = leadsCache.filter(funil.inclui);
  let lanes = buildLanes(funil, leadsFunil);
  updateLaneFilter(lanes);
  const visibleLanes = currentFilters.lane ? lanes.filter((l) => l.key === currentFilters.lane) : lanes;

  // Cabeçalho: canto + colunas deste funil
  board.append(el('div', 'corner'));
  for (const stage of funil.stages) {
    const h = el('div', `col-h st-${stage}`);
    h.append(el('span', 'dot'), document.createTextNode(funil.labels[stage] || stage));
    board.append(h);
  }

  // Uma linha por raia
  for (const lane of visibleLanes) {
    const laneLeads = leadsFunil.filter((l) => laneKeyForLead(l, funil) === lane.key);
    board.append(renderLaneLabel(lane, funil));
    for (const stage of funil.stages) {
      board.append(renderCell(lane, stage, laneLeads.filter((l) => (l.status || 'novo') === stage), funil));
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

  // Placar da pessoa calculado sobre TODOS os leads dela (mesmo os que já
  // saíram deste funil — ex.: qualificados do SDR que foram para Vendas)
  const todos = leadsCache.filter((l) => laneKeyForLead(l, funil) === lane.key);
  const metrics = el('div', 'lane-metrics');
  const m1 = el('div');
  if (funil.campo === 'sdr') {
    const naFila = todos.filter((l) => ['novo', 'triagem'].includes(l.status || 'novo')).length;
    const qualificados = todos.filter((l) => l.tipo === 'produtor').length;
    const prestadores = todos.filter((l) => l.tipo === 'prestador').length;
    m1.innerHTML = `<b>${naFila}</b> na fila · <b>${qualificados}</b> qualificados`;
    metrics.append(m1, el('div', null, `${prestadores} fora do perfil`));
  } else {
    const ganhos = todos.filter((l) => l.status === 'ganho').length;
    const emAberto = todos
      .filter((l) => ['produtor', 'negociacao', 'proposta'].includes(l.status))
      .reduce((a, l) => a + (Number(l.valor) || 0), 0);
    m1.innerHTML = `<b>${todos.filter(funil.inclui).length}</b> leads · <b>${ganhos}</b> ganhos`;
    metrics.append(m1, el('div', null, brl(emAberto) + ' em aberto'));
  }
  box.append(metrics);
  return box;
}

function renderCell(lane, stage, cellLeads, funil) {
  const cell = el('div', `cell st-${stage}`);
  cell.dataset.stage = stage;
  cell.dataset.lane = lane.key;

  for (const lead of cellLeads) cell.append(renderCard(lead));

  cell.addEventListener('dragover', (e) => { e.preventDefault(); cell.classList.add('drop-hover'); });
  cell.addEventListener('dragleave', () => cell.classList.remove('drop-hover'));
  cell.addEventListener('drop', (e) => {
    e.preventDefault();
    cell.classList.remove('drop-hover');
    const id = e.dataTransfer.getData('text/plain');
    dropLead(id, lane, stage, funil);
  });
  return cell;
}

function renderCard(lead) {
  const card = el('div', 'card');
  card.draggable = true;
  card.dataset.id = lead.id;

  card.append(el('div', 'name', lead.nome || '(sem nome)'));
  if (lead.telefone) { const r = el('div', 'row'); r.append(el('span', 'ic', '📱'), document.createTextNode(lead.telefone)); card.append(r); }
  if (lead.regiao) { const r = el('div', 'row'); r.append(el('span', 'ic', '📍'), document.createTextNode(lead.regiao)); card.append(r); }
  if (lead.area_cultivada) { const r = el('div', 'row'); r.append(el('span', 'ic', '🌾'), document.createTextNode(lead.area_cultivada)); card.append(r); }
  if (lead.produto) { const r = el('div', 'row'); r.append(el('span', 'ic', '📦'), document.createTextNode(lead.produto)); card.append(r); }

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
async function dropLead(id, lane, stage, funil) {
  const lead = leadsCache.find((l) => l.id === id);
  if (!lead) return;

  const patch = { status: stage };
  // no funil SDR a raia define o SDR; no de Vendas, o vendedor
  patch[funil.campo] = lane.isNone ? '' : lane.nome;

  const before = { status: lead.status, sdr: lead.sdr, vendedor: lead.vendedor, tipo: lead.tipo };
  Object.assign(lead, patch);
  // espelha a regra do servidor de tipo automático
  if (stage === 'prestador') lead.tipo = 'prestador';
  else if (['produtor', 'negociacao', 'proposta', 'ganho'].includes(stage)) lead.tipo = 'produtor';
  renderBoard();

  try {
    await api('/api/leads/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(patch) });
    loadStats();
    if (funil.campo === 'sdr' && stage === 'produtor') {
      toast('🌾 Qualificado! O lead foi para o funil de Vendas (Sem responsável)');
    } else {
      const dest = lane.isNone ? 'Sem responsável' : lane.nome;
      toast(`→ ${funil.labels[stage] || stage} · ${dest}`);
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
    'campanha', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'observacoes', 'origem_canal'];
  for (const f of fields) if (form[f]) form[f].value = lead[f] != null ? lead[f] : '';

  const meta = $('#metaLine');
  meta.innerHTML = '';
  if (!isNew) {
    const chips = [];
    if (lead.source === 'chatwoot') chips.push('💬 veio do Chatwoot');
    if (lead.utm_source) chips.push('origem: ' + lead.utm_source);
    for (const c of chips) meta.append(el('span', 'chip', c));
    if (lead.last_message) meta.append(el('div', null, 'Última mensagem: "' + String(lead.last_message).slice(0, 120) + '"'));
    if (lead.created_at) meta.append(el('div', null, 'Entrou em ' + new Date(lead.created_at).toLocaleString('pt-BR')));
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
// Importação em massa
// ---------------------------------------------------------------------------
const IMPORT_HEADER = 'nome;telefone;email;regiao;area_cultivada;produto;valor;sdr;vendedor;canal;campanha;observacoes';
const IMPORT_EXEMPLO = 'João da Silva;+55 62 99999-0000;joao@email.com;Rio Verde - GO;500 ha;T70P;250000;;;;;cliente antigo';
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
});

$('#tabSDR').addEventListener('click', () => setView('sdr'));
$('#tabVendas').addEventListener('click', () => setView('vendas'));
$('#tabMap').addEventListener('click', () => setView('map'));

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
$('#filterLane').addEventListener('change', (e) => { currentFilters.lane = e.target.value; renderBoard(); });

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
  $('#btnCampaigns').hidden = !gestor;
  $('#btnUsers').hidden = me.papel !== 'admin';
  // vendedor não tem nada no funil SDR; entra direto no de Vendas
  if (me.papel === 'vendedor') {
    $('#tabSDR').hidden = true;
    currentView = 'vendas';
    $('#tabSDR').classList.remove('active');
    $('#tabVendas').classList.add('active');
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
