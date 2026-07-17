'use strict';

// Etapas do funil (as chaves batem com o servidor)
const STAGE_LABELS = {
  novo: 'Novo (SDR)',
  triagem: 'Em triagem (SDR)',
  produtor: 'Produtor rural',
  negociacao: 'Em negociação',
  proposta: 'Proposta enviada',
  ganho: 'Fechado (ganho)',
  perdido: 'Perdido',
  prestador: 'Prestador / fora do perfil',
};
let STAGES = ['novo', 'triagem', 'produtor', 'negociacao', 'proposta', 'ganho', 'perdido', 'prestador'];

let leadsCache = [];
let members = [];
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
  if (!res.ok) {
    let msg = 'Erro na requisição';
    try { msg = (await res.json()).error || msg; } catch (_) {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

// Dono atual do lead: vendedor tem prioridade; senão o SDR.
function ownerOf(lead) {
  return (lead.vendedor && lead.vendedor.trim()) || (lead.sdr && lead.sdr.trim()) || '';
}
function laneKeyForLead(lead) {
  return ownerOf(lead) || '__none__';
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

async function loadLeads() {
  const params = new URLSearchParams();
  if (currentFilters.q) params.set('q', currentFilters.q);
  if (currentFilters.canal) params.set('canal', currentFilters.canal);
  const data = await api('/api/leads?' + params.toString());
  STAGES = data.stages || STAGES;
  leadsCache = data.leads || [];
  renderBoard();
}

async function refreshAll() {
  await Promise.all([loadStats(), loadMembers()]);
  await loadLeads();
}

// ---------------------------------------------------------------------------
// Raias (swimlanes)
// ---------------------------------------------------------------------------
function buildLanes() {
  const sdrs = members.filter((m) => m.ativo !== false && m.papel === 'sdr');
  const vends = members.filter((m) => m.ativo !== false && m.papel === 'vendedor');
  const lanes = [];
  const seen = new Set();
  for (const m of [...sdrs, ...vends]) {
    lanes.push({ key: m.nome, nome: m.nome, papel: m.papel });
    seen.add(m.nome);
  }
  // Donos que aparecem nos leads mas não são membros ativos (ex.: desativados)
  const extra = new Set();
  for (const l of leadsCache) {
    const o = ownerOf(l);
    if (o && !seen.has(o)) extra.add(o);
  }
  for (const o of extra) lanes.push({ key: o, nome: o, papel: 'outro' });
  // Raia coringa para leads sem responsável
  const hasOrphan = leadsCache.some((l) => !ownerOf(l));
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
  const board = $('#swimboard');
  board.innerHTML = '';

  let lanes = buildLanes();
  updateLaneFilter(lanes);
  const visibleLanes = currentFilters.lane ? lanes.filter((l) => l.key === currentFilters.lane) : lanes;

  // Cabeçalho: canto + colunas
  board.append(el('div', 'corner'));
  for (const stage of STAGES) {
    const h = el('div', `col-h st-${stage}`);
    h.append(el('span', 'dot'), document.createTextNode(STAGE_LABELS[stage] || stage));
    board.append(h);
  }

  // Uma linha por raia
  for (const lane of visibleLanes) {
    const laneLeads = leadsCache.filter((l) => laneKeyForLead(l) === lane.key);
    board.append(renderLaneLabel(lane, laneLeads));
    for (const stage of STAGES) {
      board.append(renderCell(lane, stage, laneLeads.filter((l) => (l.status || 'novo') === stage)));
    }
  }

  if (members.length === 0) {
    toastOnce('Cadastre seus SDRs e vendedores em 👥 Equipe para ativar o rodízio de leads.');
  }
}

function renderLaneLabel(lane, laneLeads) {
  const box = el('div', 'lane-label');
  const name = el('div', 'lane-name');
  name.append(document.createTextNode(lane.nome));
  const badge = el('span', `role-badge ${lane.papel}`,
    lane.papel === 'sdr' ? 'SDR' : lane.papel === 'vendedor' ? 'Vendedor' : '—');
  name.append(badge);
  box.append(name);

  const ganhos = laneLeads.filter((l) => l.status === 'ganho').length;
  const emAberto = laneLeads
    .filter((l) => !['perdido', 'prestador', 'ganho'].includes(l.status))
    .reduce((a, l) => a + (Number(l.valor) || 0), 0);

  const metrics = el('div', 'lane-metrics');
  const m1 = el('div');
  m1.innerHTML = `<b>${laneLeads.length}</b> leads · <b>${ganhos}</b> ganhos`;
  const m2 = el('div', null, brl(emAberto) + ' em aberto');
  metrics.append(m1, m2);
  box.append(metrics);
  return box;
}

function renderCell(lane, stage, cellLeads) {
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
    dropLead(id, lane, stage);
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

// Arrastar um card para outra raia/etapa
async function dropLead(id, lane, stage) {
  const lead = leadsCache.find((l) => l.id === id);
  if (!lead) return;

  const patch = { status: stage };
  if (lane.isNone) { patch.sdr = ''; patch.vendedor = ''; }
  else if (lane.papel === 'vendedor') patch.vendedor = lane.nome;
  else if (lane.papel === 'sdr') { patch.sdr = lane.nome; patch.vendedor = ''; }
  else patch.vendedor = lane.nome;

  const before = { status: lead.status, sdr: lead.sdr, vendedor: lead.vendedor, tipo: lead.tipo };
  Object.assign(lead, patch);
  // espelha a regra do servidor de tipo automático
  if (stage === 'prestador') lead.tipo = 'prestador';
  else if (['produtor', 'negociacao', 'proposta', 'ganho'].includes(stage)) lead.tipo = 'produtor';
  renderBoard();

  try {
    await api('/api/leads/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(patch) });
    loadStats();
    const dest = lane.isNone ? 'Sem responsável' : lane.nome;
    toast(`→ ${STAGE_LABELS[stage]} · ${dest}`);
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

  // tipo (radio)
  for (const r of form.querySelectorAll('[name=tipo]')) r.checked = (r.value === (lead.tipo || ''));

  form.id.value = lead.id || '';
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
  $('#modalBackdrop').hidden = false;
}

function closeModal() { $('#modalBackdrop').hidden = true; }

async function saveLead() {
  const data = {};
  for (const field of form.elements) {
    if (!field.name || field.name === 'id') continue;
    if (field.type === 'radio') { if (field.checked) data[field.name] = field.value; }
    else data[field.name] = field.value;
  }
  const id = form.id.value;
  try {
    if (id) {
      await api('/api/leads/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(data) });
      toast('Lead atualizado');
    } else {
      await api('/api/leads', { method: 'POST', body: JSON.stringify(data) });
      toast('Lead criado');
    }
    closeModal();
    refreshAll();
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
    refreshAll();
  } catch (err) { toast('Erro ao excluir: ' + err.message); }
}

// ---------------------------------------------------------------------------
// Equipe
// ---------------------------------------------------------------------------
function renderTeam() {
  const list = $('#teamList');
  list.innerHTML = '';
  if (members.length === 0) {
    list.append(el('div', 'team-empty', 'Nenhuma pessoa cadastrada ainda.'));
    return;
  }
  const order = { sdr: 0, vendedor: 1 };
  const sorted = [...members].sort((a, b) => (order[a.papel] - order[b.papel]) || a.nome.localeCompare(b.nome));
  for (const m of sorted) {
    const row = el('div', 'team-row' + (m.ativo === false ? ' inactive' : ''));
    row.append(el('span', 'tname', m.nome));
    row.append(el('span', `role-badge ${m.papel}`, m.papel === 'sdr' ? 'SDR' : 'Vendedor'));
    const toggle = el('button', 'icon-btn', m.ativo === false ? '☑️' : '✅');
    toggle.title = m.ativo === false ? 'Reativar' : 'Desativar';
    toggle.onclick = async () => {
      await api('/api/members/' + m.id, { method: 'PATCH', body: JSON.stringify({ ativo: m.ativo === false }) });
      await loadMembers(); renderTeam(); renderBoard();
    };
    const del = el('button', 'icon-btn', '🗑️');
    del.title = 'Remover';
    del.onclick = async () => {
      if (!confirm(`Remover ${m.nome} da equipe?`)) return;
      await api('/api/members/' + m.id, { method: 'DELETE' });
      await loadMembers(); renderTeam(); renderBoard();
    };
    row.append(toggle, del);
    list.append(row);
  }
}

$('#teamForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nome = e.target.nome.value.trim();
  const papel = e.target.papel.value;
  if (!nome) return;
  try {
    await api('/api/members', { method: 'POST', body: JSON.stringify({ nome, papel }) });
    e.target.nome.value = '';
    await loadMembers(); renderTeam(); renderBoard();
    toast('Adicionado à equipe');
  } catch (err) { toast('Erro: ' + err.message); }
});

// ---------------------------------------------------------------------------
// Eventos globais
// ---------------------------------------------------------------------------
$('#btnNew').addEventListener('click', () => openModal(null));
$('#btnRefresh').addEventListener('click', () => { refreshAll(); toast('Atualizado'); });
$('#btnTeam').addEventListener('click', () => { renderTeam(); $('#teamBackdrop').hidden = false; });
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
  if (!$('#teamBackdrop').hidden) $('#teamBackdrop').hidden = true;
});

let searchTimer = null;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { currentFilters.q = e.target.value; loadLeads(); }, 250);
});
$('#filterCanal').addEventListener('change', (e) => { currentFilters.canal = e.target.value; loadLeads(); });
$('#filterLane').addEventListener('change', (e) => { currentFilters.lane = e.target.value; renderBoard(); });

// mostra uma dica só uma vez por carregamento
let _toastedOnce = false;
function toastOnce(msg) { if (_toastedOnce) return; _toastedOnce = true; toast(msg); }

// Atualização automática a cada 15s (pega leads novos do webhook).
setInterval(() => {
  if ($('#modalBackdrop').hidden && $('#teamBackdrop').hidden) refreshAll();
}, 15000);

refreshAll();
