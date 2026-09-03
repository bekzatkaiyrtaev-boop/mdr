const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storage: window.localStorage }
});

let session = null;
let profile = null;
let project = null;
let positions = [];
let disciplines = [];
let disciplineAssignees = [];
let employees = [];
let positionDisciplines = [];
let sheets = [];
let volumes = [];
let allProfiles = [];
let assignments = [];
let currentLang = 'ru';
let activeTab = null;

const STATUS_LABELS = {
  not_started:  { ru:'Не начат',            en:'Not started' },
  in_progress:  { ru:'В работе',             en:'In progress' },
  issued:       { ru:'На согласовании',      en:'Issued for approval' },
  approved:     { ru:'Согласован',           en:'Approved' },
  construction: { ru:'На стройплощадке',     en:'At construction site' },
};
const ASSIGNMENT_STATUS_LABELS = {
  not_started: { ru:'Не начато',  en:'Not started' },
  in_progress: { ru:'В работе',   en:'In progress' },
  done:        { ru:'Выполнено',  en:'Done' },
  cancelled:   { ru:'Отменено',   en:'Cancelled' },
};
const ROLE_LABELS = { gip:'ГИП', gip_assistant:'Помощник ГИПа', engineer:'Инженер' };
// закреплённый администратор — всегда полные права, роль нельзя сменить никому (см. также
// current_user_role()/protect_profile_privileges в схеме БД — там та же проверка на бэкенде)
const ADMIN_EMAIL = 'bekzat.kaiyrtaev@gmail.com';
function isAdminEmail(email){ return (email||'').trim().toLowerCase() === ADMIN_EMAIL; }
// ГИП и помощник ГИПа — полный доступ (наравне с ГИП, кроме явных ограничений в RLS)
function isFullAccess(){ return profile.role === 'gip' || profile.role === 'gip_assistant' || isAdminEmail(profile.email); }
const DEFAULT_VOLUMES = [
  { number:'1', name_ru:'ПАСПОРТ ПРОЕКТА', name_en:'DETAIL DESIGN PASSPORT', is_positions_root:false },
  { number:'2', name_ru:'ЭНЕРГЕТИЧЕСКИЙ ПАСПОРТ ОБЪЕКТА', name_en:'ENERGY PASSPORT OF THE FACILITY', is_positions_root:false },
  { number:'3', name_ru:'ОБЩАЯ ПОЯСНИТЕЛЬНАЯ ЗАПИСКА', name_en:'GENERAL EXPLANATORY NOTE', is_positions_root:false },
  { number:'4', name_ru:'ИНЖЕНЕРНЫЕ ИЗЫСКАНИЯ', name_en:'ENGINEERING SURVEYS', is_positions_root:false },
  { number:'5', name_ru:'ОСНОВНЫЕ КОМПЛЕКТЫ РАБОЧИХ ЧЕРТЕЖЕЙ', name_en:'DRAWINGS AND SPECIFICATIONS', is_positions_root:true },
];

function updateLangButtons(){
  document.querySelectorAll('#langSwitch button').forEach(b => {
    b.classList.toggle('secondary', b.dataset.lang !== currentLang);
  });
  document.body.classList.toggle('hide-lang-en', currentLang === 'ru');
  document.body.classList.toggle('hide-lang-ru', currentLang === 'en');
}
function t(ru, en){
  if (currentLang === 'both'){
    if (ru && en && ru !== en) return `${ru} / ${en}`;
    return ru || en || '';
  }
  return currentLang === 'ru' ? (ru || en || '') : (en || ru || '');
}
async function dbWrite(promise){
  const { error } = await promise;
  if (error){ alert('Ошибка базы данных: ' + error.message); throw error; }
}
function esc(s){ return (s ?? '').toString().replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
// черновой автоперевод (бесплатный эндпоинт Google Translate, без ключа) — результат можно поправить вручную
async function translateRuToEn(text){
  if (!text || !text.trim()) return '';
  try {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=ru&tl=en&dt=t&q=' + encodeURIComponent(text);
    const res = await fetch(url);
    const data = await res.json();
    return (data[0] || []).map(chunk => chunk[0]).join('');
  } catch (e) {
    return '';
  }
}

// ---------------- контекстное меню (правая кнопка мыши на строке таблицы) ----------------
function showContextMenu(x, y, items){
  hideContextMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.id = 'ctxMenu';
  menu.innerHTML = items.map((it, i) => `<button type="button" class="context-menu-item" data-i="${i}">${esc(it.label)}</button>`).join('');
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(x, window.innerWidth - rect.width - 8)) + 'px';
  menu.style.top = Math.max(4, Math.min(y, window.innerHeight - rect.height - 8)) + 'px';
  menu.querySelectorAll('.context-menu-item').forEach(btn => btn.addEventListener('click', () => {
    hideContextMenu();
    items[+btn.dataset.i].onClick();
  }));
}
function hideContextMenu(){
  const existing = document.getElementById('ctxMenu');
  if (existing) existing.remove();
}
document.addEventListener('click', hideContextMenu);
document.addEventListener('contextmenu', (e) => { if (!e.defaultPrevented) hideContextMenu(); });
document.addEventListener('scroll', hideContextMenu, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideContextMenu(); });

// ---------------- init / auth ----------------
async function init(){
  const { data } = await sb.auth.getSession();
  session = data.session;
  if (!session){ window.location.href = 'index.html'; return; }

  const { data: prof } = await sb.from('profiles').select('*').eq('id', session.user.id).single();
  profile = prof;
  document.getElementById('whoAmI').textContent = `${profile.full_name || profile.email} · ${ROLE_LABELS[profile.role]}`;

  document.getElementById('btnLogout').addEventListener('click', async () => {
    await sb.auth.signOut();
    window.location.href = 'index.html';
  });
  document.querySelectorAll('#langSwitch button').forEach(b => b.addEventListener('click', () => {
    currentLang = b.dataset.lang;
    updateLangButtons();
    renderTab(activeTab);
  }));
  updateLangButtons();

  await loadAll();
  buildTabs();
}

async function loadAll(){
  const { data: proj } = await sb.from('projects').select('*').order('updated_at', { ascending:false }).limit(1);
  project = (proj && proj[0]) || null;
  document.getElementById('projName').textContent = project ? (t(project.name_ru, project.name_en) || '—') : 'проект не создан';

  const { data: pos } = await sb.from('positions').select('*').order('sort_order');
  positions = pos || [];

  const { data: discs } = await sb.from('disciplines').select('*').order('created_at');
  disciplines = discs || [];

  const { data: das } = await sb.from('discipline_assignees').select('*').order('created_at');
  disciplineAssignees = das || [];

  const { data: emps } = await sb.from('employees').select('*').order('full_name');
  employees = emps || [];

  const { data: posDiscs } = await sb.from('position_disciplines').select('*');
  positionDisciplines = posDiscs || [];

  const { data: shts } = await sb.from('sheets').select('*').order('sort_order');
  sheets = shts || [];

  const { data: vols } = await sb.from('volumes').select('*').order('created_at');
  volumes = vols || [];

  // при первом заходе (томов ещё нет) — заводим 5 стандартных томов; их можно переименовать/удалить
  if (!volumes.length && project && isFullAccess()){
    await sb.from('volumes').insert(DEFAULT_VOLUMES.map(v => ({ ...v, project_id: project.id, created_by: profile.id })));
    const { data: vols2 } = await sb.from('volumes').select('*').order('created_at');
    volumes = vols2 || [];
  }

  // нужны всем ролям — используется для колонки "Разработал" в MDR, не только во вкладке "Пользователи"
  const { data: profs } = await sb.from('profiles').select('*').order('email');
  allProfiles = profs || [];

  const { data: asgs } = await sb.from('assignments').select('*').order('sort_order');
  assignments = asgs || [];
}

// ---------------- tabs ----------------
function buildTabs(){
  const tabs = [];
  if (isFullAccess()) tabs.push(['project', 'Проект']);
  tabs.push(['posgp', 'Позиции по ГП']);
  tabs.push(['sections', 'Создание разделов']);
  tabs.push(['sheetcomp', 'Состав разделов']);
  tabs.push(['mdr', 'MDR']);
  tabs.push(['assignments', 'Поручения']);
  if (isFullAccess()) tabs.push(['users', 'Пользователи']);

  const tabsEl = document.getElementById('tabs');
  tabsEl.innerHTML = tabs.map(([id,label]) => `<div class="tab" data-tab="${id}">${label}</div>`).join('');
  tabsEl.querySelectorAll('.tab').forEach(el => el.addEventListener('click', () => switchTab(el.dataset.tab)));
  switchTab(tabs[0][0]);
}

function switchTab(id){
  activeTab = id;
  document.querySelectorAll('.tab').forEach(el => el.classList.toggle('active', el.dataset.tab === id));
  renderTab(id);
}

function renderTab(id){
  const c = document.getElementById('tabContent');
  if (id === 'project') c.innerHTML = renderProjectTab();
  else if (id === 'posgp') c.innerHTML = renderPositionsTab();
  else if (id === 'sections') c.innerHTML = renderSectionsTab();
  else if (id === 'sheetcomp') c.innerHTML = renderSheetCompTab();
  else if (id === 'mdr') c.innerHTML = renderMdrTab();
  else if (id === 'assignments') c.innerHTML = renderAssignmentsTab();
  else if (id === 'users') c.innerHTML = renderUsersTab();
  bindTabEvents(id);
}

// ---------------- вкладка "Проект" (ГИП) ----------------
const DISCIPLINE_NAME_SUGGESTIONS = [
  'Архитектурные решения',
  'Конструкции железобетонные',
  'Конструкции металлические',
  'Конструкции деревянные',
  'Генеральный план',
  'Организация рельефа',
  'Наружные сети водоснабжения',
  'Наружные сети канализации',
  'Внутренний водопровод и канализация',
  'Отопление, вентиляция и кондиционирование воздуха',
  'Электроснабжение',
  'Электрооборудование',
  'Слаботочные системы (связь, сигнализация)',
  'Автоматизация и диспетчеризация инженерных систем',
  'Пожарная сигнализация и оповещение',
  'Автоматическое пожаротушение',
  'Технология производства',
  'Инженерные изыскания',
  'Охрана окружающей среды',
  'Организация строительства (ПОС)',
  'Организация работ по сносу (демонтажу)',
  'Сметная документация',
  'Мероприятия по обеспечению доступа инвалидов',
  'Мероприятия по энергоэффективности',
  'Пояснительная записка',
];
// список подсказок для поля названия раздела — сначала уже существующие в проекте разделы
// (чтобы их переиспользовать, а не плодить дубли), затем типовые заготовки, которых ещё нет
function disciplineNameOptionsHtml(){
  const existing = [...new Set(disciplines.map(d => (d.name_ru||'').trim()).filter(Boolean))];
  const existingLower = new Set(existing.map(n => n.toLowerCase()));
  const extras = DISCIPLINE_NAME_SUGGESTIONS.filter(n => !existingLower.has(n.toLowerCase()));
  return [...existing, ...extras].map(n => `<option value="${esc(n)}">`).join('');
}
// надёжный способ привязать альбом к уже существующему разделу — напрямую по коду, а не
// через сопоставление введённого текста с названием (то, что ниже, в .mAlbumNameRu, могло
// создать дубль с новым автосгенерированным кодом, если название набрано не один-в-один).
// Показывается только для ещё не привязанных альбомов — если раздел уже выбран, его название
// и так видно в поле ниже, повторно показывать "код — название" в селекте не нужно
function disciplineSelectHtml(pd){
  const matched = disciplines.find(x => x.code === pd.discipline_code);
  if (matched) return '';
  return `<select class="text-like mAlbumDisciplineSelect" data-pdid="${pd.id}" style="width:100%;margin-bottom:4px;">
    <option value="">— выбрать раздел из списка —</option>
    ${sortedDisciplines().map(d => `<option value="${esc(d.code)}">${esc(d.code||'?')} — ${esc(d.name_ru||'(без названия)')}</option>`).join('')}
  </select>`;
}

// сортировка строк "Разделы и исполнители" по № п.п.
// (напр. "1" < "1.1" < "1.2" < "2" < "3" — сравнение по числовым сегментам, не по алфавиту;
// при равенстве номеров — по первой букве наименования раздела)
function compareVolumes(a, b){
  const pa = (a.volume_number || '').toString().trim();
  const pb = (b.volume_number || '').toString().trim();
  if (!pa && !pb) return compareDisciplineNames(a, b);
  if (!pa) return 1;
  if (!pb) return -1;
  const sa = pa.split('.').map(n => parseFloat(n) || 0);
  const sb = pb.split('.').map(n => parseFloat(n) || 0);
  const len = Math.max(sa.length, sb.length);
  for (let i = 0; i < len; i++){
    const x = sa[i] ?? 0, y = sb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return compareDisciplineNames(a, b);
}
function compareDisciplineNames(a, b){
  return (a.name_ru || '').localeCompare(b.name_ru || '', 'ru');
}
function sortedDisciplines(){
  return [...disciplines].sort(compareVolumes);
}
function assigneesFor(disciplineId){
  return disciplineAssignees.filter(a => a.discipline_id === disciplineId);
}
function employeeName(employeeId){
  const e = employees.find(x => x.id === employeeId);
  return e ? e.full_name : '';
}
function sortedEmployees(){
  return [...employees].sort((a,b) => (a.full_name||'').localeCompare(b.full_name||'', 'ru'));
}
// то же самое значение, что показывает/редактирует responsibleCellHtml, но просто строкой —
// для мест, где нужно только прочитать текущего ответственного (напр. колонка в MDR)
function resolvedResponsibleName(pd, d){
  const assignees = d ? assigneesFor(d.id) : [];
  const names = assignees.map(a => employeeName(a.employee_id).trim()).filter(Boolean);
  return pd.responsible || names[0] || '';
}
// "Ответственный" за конкретный альбом в позиции: по умолчанию — исполнитель №1 из
// "Разделы и исполнители"; если исполнителей 2+ — выпадающий список для выбора среди них
function responsibleCellHtml(pd, d){
  const assignees = d ? assigneesFor(d.id) : [];
  const names = assignees.map(a => employeeName(a.employee_id).trim()).filter(Boolean);
  const current = resolvedResponsibleName(pd, d);
  if (names.length >= 2){
    const matched = names.includes(current);
    const optionsHtml = names.map(n => `<option value="${esc(n)}" ${n===current?'selected':''}>${esc(n)}</option>`).join('')
      + ((!matched && current) ? `<option value="${esc(current)}" selected>${esc(current)} (не из списка)</option>` : '');
    return `<select class="text-like mAlbumResponsible" data-pdid="${pd.id}" style="width:100%;">${optionsHtml}</select>`;
  }
  return `<input type="text" class="text-like mAlbumResponsible" data-pdid="${pd.id}" value="${esc(current)}" placeholder="ФИО не назначен" style="width:100%;">`;
}

function renderProjectTab(){
  return `
  <div class="card">
    <div class="card-header"><span class="title">Шапка проекта</span></div>
    <div class="card-body">
      <div class="field-grid">
        <div class="field"><label>Номер договора</label><input type="text" id="pContract" value="${esc(project?.contract_number)}"></div>
        <div class="field lang-ru"><label>Наименование (RU)</label><input type="text" id="pNameRu" value="${esc(project?.name_ru)}"></div>
        <div class="field lang-en"><label>Наименование (EN)</label><input type="text" id="pNameEn" value="${esc(project?.name_en)}"></div>
      </div>
      <div style="margin-top:14px;"><button class="btn" id="btnSaveProject">Сохранить</button></div>
    </div>
  </div>
  <div class="card">
    <div class="card-header">
      <span class="title">Разделы и исполнители</span>
      <button class="btn small" id="btnAddDiscipline">+ Добавить раздел</button>
    </div>
    <div class="card-body" style="padding:0;">
      <table style="table-layout:fixed;">
        <colgroup>
          <col style="width:70px;"><col style="width:90px;"><col><col style="width:260px;"><col style="width:44px;">
        </colgroup>
        <tr><th>№ п.п.</th><th>Код</th><th>Раздел</th><th>Исполнители</th><th></th></tr>
        ${sortedDisciplines().map(d => {
          const incomplete = !d.code || !d.name_ru;
          const assignees = assigneesFor(d.id);
          return `
          <tr ${incomplete ? 'style="background:rgba(239,68,68,.08);"' : ''}>
            <td><input type="text" class="text-like dVolume" data-id="${d.id}" value="${esc(d.volume_number||'')}" placeholder="№" style="width:100%;"></td>
            <td><input type="text" class="text-like dCode" data-id="${d.id}" value="${esc(d.code||'')}" placeholder="напр. АС" style="font-weight:700;width:100%;${!d.code ? 'color:var(--red);' : ''}"></td>
            <td>
              <input type="text" class="text-like dNameRu lang-ru" data-id="${d.id}" list="disciplineNameSuggestions" value="${esc(d.name_ru||'')}" placeholder="наименование не заполнено" style="display:block;width:100%;${!d.name_ru ? 'color:var(--red);' : ''}">
              <input type="text" class="text-like dNameEn lang-en" data-id="${d.id}" value="${esc(d.name_en||'')}" placeholder="name (en)" style="display:block;width:100%;margin-top:2px;font-size:12px;color:var(--muted);">
            </td>
            <td>
              ${assignees.map(a => `
                <div class="assignee-row" data-aid="${a.id}">
                  <select class="text-like aEmployee" data-id="${a.id}" style="flex:1;min-width:0;">
                    <option value="">— выбрать сотрудника —</option>
                    ${sortedEmployees().map(e => `<option value="${e.id}" ${a.employee_id===e.id?'selected':''}>${esc(e.full_name)}</option>`).join('')}
                  </select>
                  <button class="icon-btn btn-del-assignee" data-id="${a.id}" title="Убрать исполнителя">✕</button>
                </div>`).join('') || `<span class="muted" style="font-size:11px;">не назначены</span>`}
              <button class="btn secondary small btn-add-assignee" data-id="${d.id}" style="margin-top:4px;">+ исполнитель</button>
              ${!employees.length ? `<div class="muted" style="font-size:11px;margin-top:4px;">Сотрудники ещё не заведены — добавьте их во вкладке «Пользователи»</div>` : ''}
            </td>
            <td><button class="icon-btn btn-del-discipline" data-id="${d.id}" title="Удалить раздел">✕</button></td>
          </tr>`;
        }).join('') || `<tr><td colspan="5" class="muted">Разделы пока не добавлены</td></tr>`}
      </table>
      <datalist id="disciplineNameSuggestions">
        ${disciplineNameOptionsHtml()}
      </datalist>
    </div>
  </div>`;
}

// ---------------- позиции (генплан/ГИП) — управляются во вкладках "Позиции по ГП" и MDR ----------------
function positionLabel(p){
  const name = t(p.name_ru, p.name_en);
  return `${p.position_code ? p.position_code+' ' : ''}${name || '(без названия)'}`;
}
function sortedPositions(){
  return [...positions].sort((a,b)=>a.sort_order-b.sort_order);
}

// ---------------- вкладка "Позиции по ГП" ----------------
function renderPositionsTab(){
  const list = sortedPositions();
  return `
  <div class="card">
    <div class="card-header">
      <span class="title">Позиции по ГП</span>
      <button class="btn small" id="btnAddPosition">+ Добавить позицию</button>
    </div>
    <div class="card-body" style="padding:0;">
      <table style="table-layout:fixed;">
        <colgroup><col style="width:110px;"><col><col style="width:70px;"><col style="width:44px;"></colgroup>
        <tr><th>№ по ГП</th><th>Наименование позиции</th><th></th><th></th></tr>
        ${list.map((p, idx) => `
          <tr class="pos-gp-row" data-id="${p.id}">
            <td><input type="text" class="text-like mPosCode" data-id="${p.id}" value="${esc(p.position_code||'')}" placeholder="№" style="width:100%;font-weight:700;"></td>
            <td>
              <input type="text" class="text-like mPosNameRu lang-ru" data-id="${p.id}" value="${esc(p.name_ru||'')}" placeholder="наименование не заполнено" style="display:block;width:100%;">
              <input type="text" class="text-like mPosNameEn lang-en" data-id="${p.id}" value="${esc(p.name_en||'')}" placeholder="name (en)" style="display:block;width:100%;font-size:12px;color:var(--muted);">
            </td>
            <td style="white-space:nowrap;">
              <button class="icon-btn btn-move-position" data-id="${p.id}" data-dir="up" ${idx<=0?'disabled':''}>↑</button>
              <button class="icon-btn btn-move-position" data-id="${p.id}" data-dir="down" ${idx>=list.length-1?'disabled':''}>↓</button>
            </td>
            <td><button class="icon-btn btn-del-position" data-id="${p.id}" title="Удалить позицию">✕</button></td>
          </tr>`).join('') || `<tr><td colspan="4" class="muted">Позиции пока не добавлены — нажмите «+ Добавить позицию»</td></tr>`}
      </table>
    </div>
  </div>`;
}
// выбор тома для управления его разделами напрямую (без позиции) — см. "Создание разделов".
// Сами тома создаются/переименовываются во вкладке "MDR" — здесь только выбор из уже существующих
// (те, что не являются "хозяином" позиций — is_positions_root=false, напр. "Инженерные изыскания")
function renderSectionsVolumePicker(){
  const list = standaloneVolumes();
  if (standaloneVolumeId && !list.some(v => v.id === standaloneVolumeId)) standaloneVolumeId = '';
  return `
  <div class="card">
    <div class="card-body">
      <div class="field-grid" style="grid-template-columns:1fr;max-width:420px;">
        <div class="field"><label>Том</label>
          <select id="secVolume">
            <option value="">— выбрать том —</option>
            ${list.map(v => `<option value="${v.id}" ${standaloneVolumeId===v.id?'selected':''}>${esc(v.number?v.number+' ':'')}${esc(t(v.name_ru,v.name_en)||'(без названия)')}</option>`).join('')}
          </select>
          ${!list.length ? `<span class="muted" style="font-size:11px;">Отдельных томов пока нет — создайте том во вкладке «MDR» («+ Добавить том»)</span>` : ''}
        </div>
      </div>
    </div>
  </div>
  <div id="standaloneVolumeDetail">${renderStandaloneVolumeDetail()}</div>`;
}
function renderStandaloneVolumeDetail(){
  if (!standaloneVolumeId) return '';
  const v = volumes.find(x => x.id === standaloneVolumeId);
  if (!v) return '';
  const discs = disciplinesForVolumeAll(v.id);
  const orderNumbers = sectionOrderNumbersForVolume(v.id);
  return `
  <div class="card">
    <div class="card-header">
      <span class="title">${esc(v.number?v.number+' ':'')}${esc(t(v.name_ru,v.name_en)||'(без названия)')} — разделы</span>
      <div style="display:flex;gap:8px;">
        <button class="btn secondary small" id="btnAddAllStandaloneSections" title="Добавить сразу все разделы из «Разделы и исполнители», которых ещё нет в этом томе — лишние потом можно удалить">+ Добавить все разделы</button>
        <button class="btn small" id="btnAddStandaloneSection">+ Добавить раздел</button>
      </div>
    </div>
    <div class="card-body" style="padding:0;">
      <table style="table-layout:fixed;">
        <colgroup><col style="width:90px;"><col><col style="width:140px;"><col style="width:160px;"><col style="width:120px;"><col style="width:44px;"></colgroup>
        <tr><th>№ п.п.</th><th>Раздел</th><th>Шифр альбома</th><th>Ответственный</th><th></th><th></th></tr>
        ${discs.map(({ pd, d }, idx) => {
          const pinned = !!pd.pinned;
          const sibUpPinned = idx > 0 && discs[idx-1].pd.pinned;
          const sibDownPinned = idx < discs.length-1 && discs[idx+1].pd.pinned;
          return `
          <tr class="sec-disc-row-vol" data-pdid="${pd.id}" data-vol="${v.id}">
            <td style="font-family:var(--mono);font-weight:600;color:#fff;" title="Считается автоматически: номер тома.порядковый номер раздела">${esc(orderNumbers[pd.id] || '')}</td>
            <td>
              ${disciplineSelectHtml(pd)}
              <input type="text" class="text-like mAlbumNameRu lang-ru" data-pdid="${pd.id}" list="disciplineNameSuggestions" value="${esc(d ? (d.name_ru||'') : '')}" placeholder="или введите название нового раздела" style="display:block;width:100%;">
              <input type="text" class="text-like mAlbumNameEn lang-en" data-pdid="${pd.id}" value="${esc(d ? (d.name_en||'') : '')}" placeholder="name (en)" style="display:block;width:100%;font-size:12px;color:var(--muted);">
            </td>
            <td><input type="text" class="text-like mAlbumMarker" data-pdid="${pd.id}" value="${esc(pd.marker || defaultMarkerForVolumeAlbum(v.id, pd.id))}" placeholder="шифр" style="width:100%;font-weight:600;"></td>
            <td>${responsibleCellHtml(pd, d)}</td>
            <td style="white-space:nowrap;">
              <button class="icon-btn btn-move-disc-vol" data-pdid="${pd.id}" data-vol="${v.id}" data-dir="up" ${(idx<=0||pinned||sibUpPinned)?'disabled':''}>↑</button>
              <button class="icon-btn btn-move-disc-vol" data-pdid="${pd.id}" data-vol="${v.id}" data-dir="down" ${(idx>=discs.length-1||pinned||sibDownPinned)?'disabled':''}>↓</button>
              <button class="icon-btn btn-pin-disc ${pinned?'pinned':''}" data-pdid="${pd.id}" title="${pinned?'Открепить строку':'Закрепить строку (запретить сдвиг)'}">⚓</button>
            </td>
            <td><button class="icon-btn btn-del-mdr-disc" data-pdid="${pd.id}" title="Удалить раздел">✕</button></td>
          </tr>`;
        }).join('') || `<tr><td colspan="6" class="muted">Разделы пока не добавлены — нажмите «+ Добавить раздел»</td></tr>`}
      </table>
      <datalist id="disciplineNameSuggestions">${disciplineNameOptionsHtml()}</datalist>
    </div>
  </div>`;
}
// правка позиций (код/наименование/перемещение/удаление) — общая логика для вкладок "Позиции по ГП" и "MDR",
// т.к. обе рисуют строки с одинаковыми классами .mPosCode/.mPosNameRu/.mPosNameEn/.btn-move-position/.btn-del-position
function bindPositionEditEvents(){
  document.querySelectorAll('.mPosCode, .mPosNameRu, .mPosNameEn').forEach(el => el.addEventListener('change', async () => {
    const id2 = el.dataset.id;
    const position_code = document.querySelector(`.mPosCode[data-id="${id2}"]`).value.trim();
    const name_ru = document.querySelector(`.mPosNameRu[data-id="${id2}"]`).value.trim();
    const name_en = document.querySelector(`.mPosNameEn[data-id="${id2}"]`).value.trim();
    await dbWrite(sb.from('positions').update({ position_code: position_code || null, name_ru: name_ru || null, name_en: name_en || null }).eq('id', id2));
    const p = positions.find(x => x.id === id2);
    if (p){ p.position_code = position_code || null; p.name_ru = name_ru || null; p.name_en = name_en || null; }
    if (p && p.name_ru && !p.name_en){
      const translated = await translateRuToEn(p.name_ru);
      if (translated){ await dbWrite(sb.from('positions').update({ name_en: translated }).eq('id', id2)); p.name_en = translated; }
    }
    // номер позиции/имя влияют на нумерацию и порядок отображения — перерисовываем целиком
    renderTab(activeTab);
  }));

  document.querySelectorAll('.btn-move-position').forEach(b => b.addEventListener('click', async () => {
    const list = sortedPositions();
    const idx = list.findIndex(x => x.id === b.dataset.id);
    const swapIdx = b.dataset.dir === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= list.length) return;
    const reordered = [...list];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    await Promise.all(reordered.map((row, i) => dbWrite(sb.from('positions').update({ sort_order: i }).eq('id', row.id))));
    const { data } = await sb.from('positions').select('*').order('sort_order');
    positions = data || [];
    renderTab(activeTab);
  }));

  document.querySelectorAll('.btn-del-position').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Удалить позицию? Вместе с ней безвозвратно удалятся все объявленные для неё разделы и все добавленные листы. Отменить это будет нельзя.')) return;
    await dbWrite(sb.from('positions').delete().eq('id', b.dataset.id));
    positions = positions.filter(x => x.id !== b.dataset.id);
    renderTab(activeTab);
  }));
}
// правка томов (номер/наименование/удаление) — общая логика для вкладок "MDR" и
// "Позиции по ГП" (вид "Отдельные тома"), т.к. обе рисуют строки с одинаковыми классами
// .volNumber/.volNameRu/.volNameEn/.btn-del-volume. rerender — как перерисовать после изменения
// (у каждой вкладки свой способ обновить DOM)
function bindVolumeEditEvents(rerender){
  document.querySelectorAll('.volNumber, .volNameRu, .volNameEn').forEach(el => el.addEventListener('change', async () => {
    const id2 = el.dataset.id;
    const number = document.querySelector(`.volNumber[data-id="${id2}"]`).value.trim();
    const name_ru = document.querySelector(`.volNameRu[data-id="${id2}"]`).value.trim();
    const name_en = document.querySelector(`.volNameEn[data-id="${id2}"]`).value.trim();
    await dbWrite(sb.from('volumes').update({ number: number || null, name_ru: name_ru || null, name_en: name_en || null }).eq('id', id2));
    const v = volumes.find(x => x.id === id2);
    if (v){ v.number = number || null; v.name_ru = name_ru || null; v.name_en = name_en || null; }
    // если EN пустой — сразу подставляем черновой автоперевод; поправить вручную можно в любой момент
    if (v && v.name_ru && !v.name_en){
      const translated = await translateRuToEn(v.name_ru);
      if (translated){ await dbWrite(sb.from('volumes').update({ name_en: translated }).eq('id', id2)); v.name_en = translated; }
    }
    // номер тома влияет на порядок строк — перерисовываем целиком
    rerender();
  }));

  document.querySelectorAll('.btn-del-volume').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Удалить том? Вместе с ним удалятся все его разделы (для отдельных томов) и добавленные в них листы.')) return;
    await dbWrite(sb.from('volumes').delete().eq('id', b.dataset.id));
    volumes = volumes.filter(x => x.id !== b.dataset.id);
    positionDisciplines = positionDisciplines.filter(x => x.volume_id !== b.dataset.id);
    rerender();
  }));
}

// ---------------- вкладка "Создание разделов" (разделы — в позиции ИЛИ прямо в отдельном томе) ----------------
let sectionsPositionId = '';
let standaloneVolumeId = '';
let sectionsMode = 'position'; // 'position' | 'volume'
function renderSectionsTab(){
  return `
  <div class="subtabs">
    <div class="subtab ${sectionsMode==='position'?'active':''}" data-mode="position">В позиции</div>
    <div class="subtab ${sectionsMode==='volume'?'active':''}" data-mode="volume">В отдельном томе</div>
  </div>
  ${sectionsMode === 'volume' ? renderSectionsVolumePicker() : renderSectionsPositionPicker()}`;
}
function renderSectionsPositionPicker(){
  const list = sortedPositions();
  return `
  <div class="card">
    <div class="card-body">
      <div class="field-grid" style="grid-template-columns:1fr;max-width:420px;">
        <div class="field"><label>Позиция</label>
          <select id="secPosition">
            <option value="">— выбрать позицию —</option>
            ${list.map(p => `<option value="${p.id}" ${sectionsPositionId===p.id?'selected':''}>${esc(positionLabel(p))}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>
  </div>
  <div id="sectionsDetail">${renderSectionsDetail()}</div>`;
}
function renderSectionsDetail(){
  if (!sectionsPositionId) return '';
  const p = positions.find(x => x.id === sectionsPositionId);
  if (!p) return '';
  const discs = disciplinesForPositionAll(p.id);
  const orderNumbers = sectionOrderNumbers(p.id);
  return `
  <div class="card">
    <div class="card-header">
      <span class="title">${esc(positionLabel(p))} — разделы</span>
      <div style="display:flex;gap:8px;">
        <button class="btn secondary small" id="btnAddAllSections" title="Добавить сразу все разделы из «Разделы и исполнители», которых ещё нет в этой позиции — лишние потом можно удалить">+ Добавить все разделы</button>
        <button class="btn small" id="btnAddSection">+ Добавить раздел</button>
      </div>
    </div>
    <div class="card-body" style="padding:0;">
      <table style="table-layout:fixed;">
        <colgroup><col style="width:90px;"><col><col style="width:140px;"><col style="width:160px;"><col style="width:120px;"><col style="width:44px;"></colgroup>
        <tr><th>№ п.п.</th><th>Раздел</th><th>Шифр альбома</th><th>Ответственный</th><th></th><th></th></tr>
        ${discs.map(({ pd, d }, idx) => {
          const pinned = !!pd.pinned;
          const sibUpPinned = idx > 0 && discs[idx-1].pd.pinned;
          const sibDownPinned = idx < discs.length-1 && discs[idx+1].pd.pinned;
          return `
          <tr class="sec-disc-row" data-pdid="${pd.id}" data-pos="${p.id}">
            <td style="font-family:var(--mono);font-weight:600;color:#fff;" title="Считается автоматически: номер позиции.порядковый номер раздела">${esc(orderNumbers[pd.id] || '')}</td>
            <td>
              ${disciplineSelectHtml(pd)}
              <input type="text" class="text-like mAlbumNameRu lang-ru" data-pdid="${pd.id}" list="disciplineNameSuggestions" value="${esc(d ? (d.name_ru||'') : '')}" placeholder="или введите название нового раздела" style="display:block;width:100%;">
              <input type="text" class="text-like mAlbumNameEn lang-en" data-pdid="${pd.id}" value="${esc(d ? (d.name_en||'') : '')}" placeholder="name (en)" style="display:block;width:100%;font-size:12px;color:var(--muted);">
            </td>
            <td><input type="text" class="text-like mAlbumMarker" data-pdid="${pd.id}" value="${esc(pd.marker || defaultMarkerForAlbum(p.id, pd.id))}" placeholder="шифр" style="width:100%;font-weight:600;"></td>
            <td>${responsibleCellHtml(pd, d)}</td>
            <td style="white-space:nowrap;">
              <button class="icon-btn btn-move-disc" data-pdid="${pd.id}" data-pos="${p.id}" data-dir="up" ${(idx<=0||pinned||sibUpPinned)?'disabled':''}>↑</button>
              <button class="icon-btn btn-move-disc" data-pdid="${pd.id}" data-pos="${p.id}" data-dir="down" ${(idx>=discs.length-1||pinned||sibDownPinned)?'disabled':''}>↓</button>
              <button class="icon-btn btn-pin-disc ${pinned?'pinned':''}" data-pdid="${pd.id}" title="${pinned?'Открепить строку':'Закрепить строку (запретить сдвиг)'}">⚓</button>
            </td>
            <td><button class="icon-btn btn-del-mdr-disc" data-pdid="${pd.id}" title="Удалить раздел">✕</button></td>
          </tr>`;
        }).join('') || `<tr><td colspan="6" class="muted">Разделы пока не добавлены — нажмите «+ Добавить раздел»</td></tr>`}
      </table>
      <datalist id="disciplineNameSuggestions">${disciplineNameOptionsHtml()}</datalist>
    </div>
  </div>`;
}
// правка разделов/альбомов (название/шифр/примечание/перемещение/удаление) — общая логика для вкладок
// "Создание разделов" и MDR, т.к. обе рисуют строки с одинаковыми классами .mAlbumNameRu/.mAlbumNameEn/
// .mAlbumMarker/.mAlbumNote/.btn-move-disc/.btn-del-mdr-disc
function bindAlbumEditEvents(){
  document.querySelectorAll('.mAlbumDisciplineSelect').forEach(el => el.addEventListener('change', async () => {
    const pdid = el.dataset.pdid;
    const code = el.value;
    if (!code) return;
    await dbWrite(sb.from('position_disciplines').update({ discipline_code: code }).eq('id', pdid));
    const pdLink = positionDisciplines.find(x => x.id === pdid);
    if (pdLink) pdLink.discipline_code = code;
    renderTab(activeTab);
  }));

  document.querySelectorAll('.mAlbumNameRu, .mAlbumNameEn').forEach(el => el.addEventListener('change', async () => {
    const pdid = el.dataset.pdid;
    const pdLink = positionDisciplines.find(x => x.id === pdid);
    if (!pdLink) return;
    const name_ru = document.querySelector(`.mAlbumNameRu[data-pdid="${pdid}"]`).value.trim();
    const name_en = document.querySelector(`.mAlbumNameEn[data-pdid="${pdid}"]`).value.trim();
    const currentD = disciplines.find(x => x.code === pdLink.discipline_code) || null;

    if (currentD){
      // раздел уже привязан — просто переименовываем его (это затронет и другие
      // альбомы этого же раздела, у них общее название, так и задумано)
      await dbWrite(sb.from('disciplines').update({ name_ru: name_ru || null, name_en: name_en || null }).eq('id', currentD.id));
      currentD.name_ru = name_ru || null; currentD.name_en = name_en || null;
    } else if (name_ru){
      // альбом ещё ни к какому разделу не привязан — ищем существующий раздел с таким названием,
      // чтобы не плодить дубли с отдельными исполнителями; если не нашли — создаём новый раздел
      let match = disciplines.find(x => (x.name_ru||'').trim().toLowerCase() === name_ru.toLowerCase());
      if (!match){
        let code = abbreviateName(name_ru) || 'РЗ';
        let n = 0;
        while (disciplines.some(x => x.code === code)) { n++; code = abbreviateName(name_ru) + '_' + n; }
        const { data: inserted } = await sb.from('disciplines').insert({
          project_id: project.id, code, name_ru, name_en: name_en || null, created_by: profile.id,
        }).select().single();
        if (inserted){ disciplines.push(inserted); match = inserted; }
      }
      if (match && match.code !== pdLink.discipline_code){
        await dbWrite(sb.from('position_disciplines').update({ discipline_code: match.code }).eq('id', pdid));
        pdLink.discipline_code = match.code;
      }
    }
    // если EN пустой — сразу подставляем черновой автоперевод
    const finalD = disciplines.find(x => x.code === pdLink.discipline_code);
    if (finalD && finalD.name_ru && !finalD.name_en){
      const translated = await translateRuToEn(finalD.name_ru);
      if (translated){ await dbWrite(sb.from('disciplines').update({ name_en: translated }).eq('id', finalD.id)); finalD.name_en = translated; }
    }
    renderTab(activeTab);
  }));

  document.querySelectorAll('.mAlbumMarker').forEach(el => el.addEventListener('change', async () => {
    const pdid = el.dataset.pdid;
    const marker = el.value.trim() || null;
    await dbWrite(sb.from('position_disciplines').update({ marker }).eq('id', pdid));
    const pdLink = positionDisciplines.find(x => x.id === pdid);
    if (pdLink) pdLink.marker = marker;
  }));

  document.querySelectorAll('.mAlbumResponsible').forEach(el => el.addEventListener('change', async () => {
    const pdid = el.dataset.pdid;
    const responsible = el.value.trim() || null;
    await dbWrite(sb.from('position_disciplines').update({ responsible }).eq('id', pdid));
    const pdLink = positionDisciplines.find(x => x.id === pdid);
    if (pdLink) pdLink.responsible = responsible;
  }));

  document.querySelectorAll('.mAlbumNote').forEach(el => el.addEventListener('change', async () => {
    const pdid = el.dataset.pdid;
    const note = el.value.trim() || null;
    await dbWrite(sb.from('position_disciplines').update({ note }).eq('id', pdid));
    const pdLink = positionDisciplines.find(x => x.id === pdid);
    if (pdLink) pdLink.note = note;
  }));

  document.querySelectorAll('.btn-move-disc').forEach(b => b.addEventListener('click', async () => {
    const sibs = disciplinesForPositionAll(b.dataset.pos).map(x => x.pd);
    const idx = sibs.findIndex(x => x.id === b.dataset.pdid);
    const swapIdx = b.dataset.dir === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= sibs.length) return;
    if (sibs[idx].pinned || sibs[swapIdx].pinned) return; // закреплённая строка не двигается — ни сама, ни через соседей
    const reordered = [...sibs];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    await Promise.all(reordered.map((row, i) => dbWrite(sb.from('position_disciplines').update({ sort_order: i }).eq('id', row.id))));
    const { data } = await sb.from('position_disciplines').select('*');
    positionDisciplines = data || [];
    renderTab(activeTab);
  }));

  document.querySelectorAll('.btn-pin-disc').forEach(b => b.addEventListener('click', async () => {
    const pdid = b.dataset.pdid;
    const pdLink = positionDisciplines.find(x => x.id === pdid);
    if (!pdLink) return;
    const pinned = !pdLink.pinned;
    await dbWrite(sb.from('position_disciplines').update({ pinned }).eq('id', pdid));
    pdLink.pinned = pinned;
    renderTab(activeTab);
  }));

  document.querySelectorAll('.btn-del-mdr-disc').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Удалить этот раздел? Уже добавленные в нём листы удалятся вместе с ним. Сам раздел (с исполнителями) останется — он мог использоваться и другими альбомами.')) return;
    await dbWrite(sb.from('position_disciplines').delete().eq('id', b.dataset.pdid));
    positionDisciplines = positionDisciplines.filter(x => x.id !== b.dataset.pdid);
    sheets = sheets.filter(s => s.position_discipline_id !== b.dataset.pdid);
    renderTab(activeTab);
  }));
}
function bindSectionsDetailEvents(){
  const btnAdd = document.getElementById('btnAddSection');
  if (btnAdd) btnAdd.addEventListener('click', async () => {
    const pos = positions.find(x => x.id === sectionsPositionId);
    if (!pos) return;
    const tempCode = '_new' + Date.now().toString(36) + Math.floor(Math.random()*1000);
    const existing = positionDisciplines.filter(pd => pd.position_id === pos.id);
    const nextOrder = existing.length ? Math.max(...existing.map(pd => pd.sort_order)) + 1 : 0;
    await dbWrite(sb.from('position_disciplines').insert({ position_id: pos.id, discipline_code: tempCode, sort_order: nextOrder, created_by: profile.id }));
    const { data } = await sb.from('position_disciplines').select('*');
    positionDisciplines = data || [];
    document.getElementById('sectionsDetail').innerHTML = renderSectionsDetail();
    bindSectionsDetailEvents();
  });

  const btnAddAll = document.getElementById('btnAddAllSections');
  if (btnAddAll) btnAddAll.addEventListener('click', async () => {
    const pos = positions.find(x => x.id === sectionsPositionId);
    if (!pos) return;
    const existing = positionDisciplines.filter(pd => pd.position_id === pos.id);
    const existingCodes = new Set(existing.map(pd => pd.discipline_code));
    const toAdd = sortedDisciplines().filter(d => d.code && d.name_ru && !existingCodes.has(d.code));
    if (!toAdd.length) return alert('Все разделы из «Разделы и исполнители» уже добавлены в эту позицию.');
    let nextOrder = existing.length ? Math.max(...existing.map(pd => pd.sort_order)) + 1 : 0;
    const rows = toAdd.map(d => ({ position_id: pos.id, discipline_code: d.code, sort_order: nextOrder++, created_by: profile.id }));
    await dbWrite(sb.from('position_disciplines').insert(rows));
    const { data } = await sb.from('position_disciplines').select('*');
    positionDisciplines = data || [];
    document.getElementById('sectionsDetail').innerHTML = renderSectionsDetail();
    bindSectionsDetailEvents();
  });

  bindAlbumEditEvents();

  // правая кнопка мыши — как в Excel: "Добавить строку выше/ниже"
  document.querySelectorAll('tr.sec-disc-row').forEach(tr => tr.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const posId = tr.dataset.pos;
    const pdId = tr.dataset.pdid;
    showContextMenu(e.clientX, e.clientY, [
      { label: '⬆ Добавить раздел выше', onClick: () => insertAlbumAdjacent(posId, pdId, 'above') },
      { label: '⬇ Добавить раздел ниже', onClick: () => insertAlbumAdjacent(posId, pdId, 'below') },
    ]);
  }));
}
// события для "Отдельные тома" (см. "Позиции по ГП") — зеркало bindSectionsDetailEvents,
// только владелец альбома — том (volume_id), а не позиция
function bindStandaloneVolumeDetailEvents(){
  const btnAdd = document.getElementById('btnAddStandaloneSection');
  if (btnAdd) btnAdd.addEventListener('click', async () => {
    const vol = volumes.find(x => x.id === standaloneVolumeId);
    if (!vol) return;
    const tempCode = '_new' + Date.now().toString(36) + Math.floor(Math.random()*1000);
    const existing = positionDisciplines.filter(pd => pd.volume_id === vol.id);
    const nextOrder = existing.length ? Math.max(...existing.map(pd => pd.sort_order)) + 1 : 0;
    await dbWrite(sb.from('position_disciplines').insert({ volume_id: vol.id, discipline_code: tempCode, sort_order: nextOrder, created_by: profile.id }));
    const { data } = await sb.from('position_disciplines').select('*');
    positionDisciplines = data || [];
    document.getElementById('standaloneVolumeDetail').innerHTML = renderStandaloneVolumeDetail();
    bindStandaloneVolumeDetailEvents();
  });

  const btnAddAll = document.getElementById('btnAddAllStandaloneSections');
  if (btnAddAll) btnAddAll.addEventListener('click', async () => {
    const vol = volumes.find(x => x.id === standaloneVolumeId);
    if (!vol) return;
    const existing = positionDisciplines.filter(pd => pd.volume_id === vol.id);
    const existingCodes = new Set(existing.map(pd => pd.discipline_code));
    const toAdd = sortedDisciplines().filter(d => d.code && d.name_ru && !existingCodes.has(d.code));
    if (!toAdd.length) return alert('Все разделы из «Разделы и исполнители» уже добавлены в этот том.');
    let nextOrder = existing.length ? Math.max(...existing.map(pd => pd.sort_order)) + 1 : 0;
    const rows = toAdd.map(d => ({ volume_id: vol.id, discipline_code: d.code, sort_order: nextOrder++, created_by: profile.id }));
    await dbWrite(sb.from('position_disciplines').insert(rows));
    const { data } = await sb.from('position_disciplines').select('*');
    positionDisciplines = data || [];
    document.getElementById('standaloneVolumeDetail').innerHTML = renderStandaloneVolumeDetail();
    bindStandaloneVolumeDetailEvents();
  });

  bindAlbumEditEvents();

  document.querySelectorAll('.btn-move-disc-vol').forEach(b => b.addEventListener('click', async () => {
    const sibs = disciplinesForVolumeAll(b.dataset.vol).map(x => x.pd);
    const idx = sibs.findIndex(x => x.id === b.dataset.pdid);
    const swapIdx = b.dataset.dir === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= sibs.length) return;
    if (sibs[idx].pinned || sibs[swapIdx].pinned) return;
    const reordered = [...sibs];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    await Promise.all(reordered.map((row, i) => dbWrite(sb.from('position_disciplines').update({ sort_order: i }).eq('id', row.id))));
    const { data } = await sb.from('position_disciplines').select('*');
    positionDisciplines = data || [];
    document.getElementById('standaloneVolumeDetail').innerHTML = renderStandaloneVolumeDetail();
    bindStandaloneVolumeDetailEvents();
  }));

  // правая кнопка мыши — как в Excel: "Добавить строку выше/ниже"
  document.querySelectorAll('tr.sec-disc-row-vol').forEach(tr => tr.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const volId = tr.dataset.vol;
    const pdId = tr.dataset.pdid;
    showContextMenu(e.clientX, e.clientY, [
      { label: '⬆ Добавить раздел выше', onClick: () => insertAlbumAdjacentVolume(volId, pdId, 'above') },
      { label: '⬇ Добавить раздел ниже', onClick: () => insertAlbumAdjacentVolume(volId, pdId, 'below') },
    ]);
  }));
}

// ---------------- вкладка "Состав разделов" (листы внутри альбома позиции или тома) ----------------
const SHEET_FORMAT_SUGGESTIONS = [
  'А4','А3','А2','А1','А0',
  'А4х3','А4х4','А4х5','А4х6','А4х7','А4х8','А4х9',
  'А3х3','А3х4','А3х5','А3х6','А3х7',
  'А2х3','А2х4','А2х5',
  'А1х3','А1х4',
];
let sheetCompContainer = ''; // 'pos:<id>' (позиция) | 'vol:<id>' (отдельный том) | ''
let sheetCompAlbumId = '';
function parseSheetCompContainer(){
  if (!sheetCompContainer) return { kind:'', id:'' };
  const i = sheetCompContainer.indexOf(':');
  return { kind: sheetCompContainer.slice(0,i), id: sheetCompContainer.slice(i+1) };
}
// сортировка листов по возрастанию номера, вписанного в начало названия (напр. "2. План котлована" -> 2);
// листы без номера в начале — в конец списка, по порядку добавления
function sortSheetsByNumber(list){
  return [...list].sort((a, b) => {
    const na = parseFloat((a.name_ru||'').trim().match(/^(\d+(?:[.,]\d+)?)/)?.[1]?.replace(',', '.'));
    const nb = parseFloat((b.name_ru||'').trim().match(/^(\d+(?:[.,]\d+)?)/)?.[1]?.replace(',', '.'));
    if (isNaN(na) && isNaN(nb)) return a.sort_order - b.sort_order;
    if (isNaN(na)) return 1;
    if (isNaN(nb)) return -1;
    return na - nb || a.sort_order - b.sort_order;
  });
}

function sheetCompAlbumOptionsHtml(containerValue){
  if (!containerValue) return `<option value="">— сначала выберите позицию или том —</option>`;
  const i = containerValue.indexOf(':');
  const kind = containerValue.slice(0,i), id = containerValue.slice(i+1);
  const albums = (kind === 'vol' ? disciplinesForVolumeAll(id) : disciplinesForPositionAll(id)).filter(x => x.d);
  if (!albums.length) return `<option value="">нет альбомов — добавьте в «Создание разделов»</option>`;
  return `<option value="">— выбрать альбом —</option>` +
    albums.map(({ pd, d }) => {
      const marker = pd.marker || (kind === 'vol' ? defaultMarkerForVolumeAlbum(id, pd.id) : defaultMarkerForAlbum(id, pd.id));
      return `<option value="${pd.id}" ${sheetCompAlbumId===pd.id?'selected':''}>${esc(marker)} — ${esc(t(d.name_ru,d.name_en))}</option>`;
    }).join('');
}

function renderSheetCompTab(){
  const posList = sortedPositions();
  const volList = standaloneVolumes();
  return `
  <div class="card">
    <div class="card-body">
      <div class="field-grid">
        <div class="field"><label>Позиция / том</label>
          <select id="scPosition">
            <option value="">— выбрать —</option>
            ${posList.length ? `<optgroup label="Позиции по ГП">${posList.map(p => `<option value="pos:${p.id}" ${sheetCompContainer==='pos:'+p.id?'selected':''}>${esc(positionLabel(p))}</option>`).join('')}</optgroup>` : ''}
            ${volList.length ? `<optgroup label="Отдельные тома">${volList.map(v => `<option value="vol:${v.id}" ${sheetCompContainer==='vol:'+v.id?'selected':''}>${esc(v.number?v.number+' ':'')}${esc(t(v.name_ru,v.name_en)||'(без названия)')}</option>`).join('')}</optgroup>` : ''}
          </select>
        </div>
        <div class="field"><label>Альбом</label>
          <select id="scAlbum">${sheetCompAlbumOptionsHtml(sheetCompContainer)}</select>
        </div>
      </div>
    </div>
  </div>
  <div id="sheetCompDetail">${renderSheetCompDetail()}</div>`;
}

function renderSheetCompDetail(){
  const { kind, id } = parseSheetCompContainer();
  if (!id || !sheetCompAlbumId) return '';
  const pd = positionDisciplines.find(x => x.id === sheetCompAlbumId);
  const d = pd ? disciplines.find(x => x.code === pd.discipline_code) : null;
  if (!pd || !d) return '';
  let ownerLabel, marker, designation;
  if (kind === 'vol'){
    const v = volumes.find(x => x.id === id);
    if (!v) return '';
    marker = pd.marker || defaultMarkerForVolumeAlbum(v.id, pd.id);
    ownerLabel = `${v.number?v.number+' ':''}${t(v.name_ru,v.name_en)||'(без названия)'}`;
    designation = computeDesignationVolume(marker);
  } else {
    const p = positions.find(x => x.id === id);
    if (!p) return '';
    marker = pd.marker || defaultMarkerForAlbum(p.id, pd.id);
    ownerLabel = positionLabel(p);
    designation = computeDesignation(p.id, marker);
  }
  const canEdit = canEditDiscipline(pd.discipline_code);
  const rows = sortSheetsByNumber(sheets.filter(s => s.position_discipline_id === pd.id));

  return `
  <div class="card">
    <div class="card-header" style="background:var(--accent);">
      <span class="title" style="color:#fff;">${esc(ownerLabel)} — ${esc(marker)} ${esc(t(d.name_ru,d.name_en)||'')}</span>
      ${canEdit ? `<button class="btn small" id="btnAddSheet">+ добавить лист</button>` : ''}
    </div>
    <div class="card-body" style="padding:0;">
      <table style="table-layout:fixed;">
        <colgroup>
          <col><col style="width:90px;"><col style="width:80px;"><col style="width:160px;"><col><col><col style="width:140px;"><col style="width:150px;"><col style="width:44px;">
        </colgroup>
        <tr><th>Наименование листа</th><th>Формат</th><th>Ревизия</th><th>Обозначение</th><th>Комментарии к листу</th><th>Ответы на комментарии</th><th>Проверил</th><th>Статус</th><th></th></tr>
        ${rows.length ? rows.map(s => `
          <tr data-id="${s.id}">
            <td>
              <input type="text" class="text-like sName lang-ru" data-id="${s.id}" value="${esc(s.name_ru||'')}" placeholder="RU" ${canEdit?'':'disabled'} style="display:block;width:100%;">
              <div class="lang-en" style="display:flex;align-items:center;gap:4px;">
                <input type="text" class="text-like sNameEn" data-id="${s.id}" value="${esc(s.name_en||'')}" placeholder="EN" ${canEdit?'':'disabled'} style="flex:1;min-width:0;font-size:12px;color:var(--muted);">
                ${canEdit ? `<button class="icon-btn btn-translate-sheet" data-id="${s.id}" title="Перевести на EN">🌐</button>` : ''}
              </div>
            </td>
            <td><input type="text" class="text-like sFormat" data-id="${s.id}" value="${esc(s.format||'')}" list="sheetFormatSuggestions" ${canEdit?'':'disabled'} style="width:100%;"></td>
            <td><input type="text" class="text-like sRevision" data-id="${s.id}" value="${esc(s.revision||'')}" ${canEdit?'':'disabled'} style="width:100%;"></td>
            <td class="muted" style="font-family:var(--mono);font-size:12px;" title="Считается автоматически: Номер договора-Номер по ГП-Шифр альбома">${esc(designation)}</td>
            <td><input type="text" class="text-like sComment" data-id="${s.id}" value="${esc(s.comment||'')}" ${canEdit?'':'disabled'} style="width:100%;"></td>
            <td><input type="text" class="text-like sReply" data-id="${s.id}" value="${esc(s.reply||'')}" ${canEdit?'':'disabled'} style="width:100%;"></td>
            <td><input type="text" class="text-like sCheckedBy" data-id="${s.id}" value="${esc(s.checked_by_name||'')}" ${canEdit?'':'disabled'} style="width:100%;"></td>
            <td>
              <select class="sStatus" data-id="${s.id}" ${canEdit?'':'disabled'}>
                ${Object.entries(STATUS_LABELS).map(([k,v])=>`<option value="${k}" ${s.status===k?'selected':''}>${v.ru}</option>`).join('')}
              </select>
            </td>
            <td>${canEdit ? `<button class="icon-btn btn-del-sheet" data-id="${s.id}" title="Удалить лист">✕</button>` : ''}</td>
          </tr>`).join('') : `<tr><td colspan="9" class="muted">Листы ещё не добавлены</td></tr>`}
      </table>
      <datalist id="sheetFormatSuggestions">
        ${SHEET_FORMAT_SUGGESTIONS.map(f => `<option value="${f}">`).join('')}
      </datalist>
    </div>
  </div>`;
}

// вставка нового (пустого) листа сразу над/под указанным в пределах текущего альбома
async function insertSheetAdjacent(targetSheetId, dir){
  const pd = positionDisciplines.find(x => x.id === sheetCompAlbumId);
  if (!pd) return;
  const rows = sortSheetsByNumber(sheets.filter(s => s.position_discipline_id === sheetCompAlbumId));
  const idx = rows.findIndex(x => x.id === targetSheetId);
  if (idx < 0) return;
  const insertIdx = dir === 'above' ? idx : idx + 1;
  await Promise.all(rows
    .map((row, i) => ({ row, newOrder: i >= insertIdx ? i + 1 : i }))
    .filter(({ row, newOrder }) => newOrder !== row.sort_order)
    .map(({ row, newOrder }) => dbWrite(sb.from('sheets').update({ sort_order: newOrder }).eq('id', row.id))));
  const { kind, id } = parseSheetCompContainer();
  await dbWrite(sb.from('sheets').insert({
    position_id: kind === 'pos' ? id : null, discipline_code: pd.discipline_code, position_discipline_id: sheetCompAlbumId,
    sort_order: insertIdx, created_by: profile.id,
  }));
  const { data } = await sb.from('sheets').select('*').order('sort_order');
  sheets = data || [];
  document.getElementById('sheetCompDetail').innerHTML = renderSheetCompDetail();
  bindSheetCompDetailEvents();
}
function bindSheetCompDetailEvents(){
  const btnAdd = document.getElementById('btnAddSheet');
  if (btnAdd) btnAdd.addEventListener('click', async () => {
    const pd = positionDisciplines.find(x => x.id === sheetCompAlbumId);
    if (!pd) return;
    const { kind, id } = parseSheetCompContainer();
    const rows = sheets.filter(s => s.position_discipline_id === sheetCompAlbumId);
    const nextOrder = rows.length ? Math.max(...rows.map(s => s.sort_order)) + 1 : 0;
    await dbWrite(sb.from('sheets').insert({
      position_id: kind === 'pos' ? id : null,
      discipline_code: pd.discipline_code,
      position_discipline_id: sheetCompAlbumId,
      sort_order: nextOrder,
      created_by: profile.id,
    }));
    const { data } = await sb.from('sheets').select('*').order('sort_order');
    sheets = data || [];
    document.getElementById('sheetCompDetail').innerHTML = renderSheetCompDetail();
    bindSheetCompDetailEvents();
  });

  document.querySelectorAll('.sName, .sNameEn, .sFormat, .sRevision, .sComment, .sReply, .sCheckedBy').forEach(el => el.addEventListener('change', async () => {
    const id = el.dataset.id;
    const payload = {
      name_ru: document.querySelector(`.sName[data-id="${id}"]`).value.trim() || null,
      name_en: document.querySelector(`.sNameEn[data-id="${id}"]`).value.trim() || null,
      format: document.querySelector(`.sFormat[data-id="${id}"]`).value.trim() || null,
      revision: document.querySelector(`.sRevision[data-id="${id}"]`).value.trim() || null,
      comment: document.querySelector(`.sComment[data-id="${id}"]`).value.trim() || null,
      reply: document.querySelector(`.sReply[data-id="${id}"]`).value.trim() || null,
      checked_by_name: document.querySelector(`.sCheckedBy[data-id="${id}"]`).value.trim() || null,
      updated_at: new Date().toISOString(),
    };
    await dbWrite(sb.from('sheets').update(payload).eq('id', id));
    const s = sheets.find(x => x.id === id);
    if (s) Object.assign(s, payload);
    // если EN пустой — сразу подставляем черновой автоперевод
    if (s && s.name_ru && !s.name_en){
      const translated = await translateRuToEn(s.name_ru);
      if (translated){
        await dbWrite(sb.from('sheets').update({ name_en: translated }).eq('id', id));
        s.name_en = translated;
        document.getElementById('sheetCompDetail').innerHTML = renderSheetCompDetail();
        bindSheetCompDetailEvents();
      }
    }
  }));

  document.querySelectorAll('.sStatus').forEach(el => el.addEventListener('change', async () => {
    const id = el.dataset.id;
    await dbWrite(sb.from('sheets').update({ status: el.value, updated_at: new Date().toISOString() }).eq('id', id));
    const s = sheets.find(x => x.id === id);
    if (s) s.status = el.value;
  }));

  document.querySelectorAll('.btn-translate-sheet').forEach(b => b.addEventListener('click', async () => {
    const s = sheets.find(x => x.id === b.dataset.id);
    if (!s || !s.name_ru) return;
    b.disabled = true; b.textContent = '…';
    const translated = await translateRuToEn(s.name_ru);
    if (translated){
      await dbWrite(sb.from('sheets').update({ name_en: translated }).eq('id', s.id));
      s.name_en = translated;
    }
    document.getElementById('sheetCompDetail').innerHTML = renderSheetCompDetail();
    bindSheetCompDetailEvents();
  }));

  document.querySelectorAll('.btn-del-sheet').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Удалить лист из состава раздела?')) return;
    await dbWrite(sb.from('sheets').delete().eq('id', b.dataset.id));
    sheets = sheets.filter(x => x.id !== b.dataset.id);
    document.getElementById('sheetCompDetail').innerHTML = renderSheetCompDetail();
    bindSheetCompDetailEvents();
  }));

  // правая кнопка мыши — как в Excel: "Добавить строку выше/ниже" (только там, где раздел редактируемый)
  document.querySelectorAll('#sheetCompDetail tr[data-id]').forEach(tr => {
    if (!tr.querySelector('.btn-del-sheet')) return;
    tr.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const sheetId = tr.dataset.id;
      showContextMenu(e.clientX, e.clientY, [
        { label: '⬆ Добавить лист выше', onClick: () => insertSheetAdjacent(sheetId, 'above') },
        { label: '⬇ Добавить лист ниже', onClick: () => insertSheetAdjacent(sheetId, 'below') },
      ]);
    });
  });
}

function myDisciplineCodes(){
  const email = (profile.email || '').toLowerCase();
  const myEmployeeIds = new Set(employees.filter(e => (e.email||'').toLowerCase() === email).map(e => e.id));
  const myDisciplineIds = new Set(disciplineAssignees.filter(a => myEmployeeIds.has(a.employee_id)).map(a => a.discipline_id));
  return disciplines.filter(d => myDisciplineIds.has(d.id)).map(d => d.code);
}
function canEditDiscipline(code){
  if (isFullAccess()) return true;
  return myDisciplineCodes().includes(code);
}

// ---------------- вкладка "MDR" (дерево: позиция → раздел → листы) ----------------
const MDR_STOPWORDS = new Set(['и','в','на','по','с','со','из','для','от','до','при','к','о','об','а','но','или','не']);
function abbreviateName(name){
  if (!name) return '';
  return name.trim().split(/\s+/)
    .filter(w => w.length > 2 && !MDR_STOPWORDS.has(w.toLowerCase()))
    .map(w => w[0].toUpperCase())
    .join('');
}
// альбомы позиции: каждая строка position_disciplines — отдельный альбом (напр. КЖ1, КЖ2),
// но раздел (справочник с исполнителями, public.disciplines) у одноимённых альбомов ОДИН и тот же.
// Порядок — как расставил пользователь стрелками (просто по sort_order, без принудительной
// перегруппировки одинаковых кодов — та мешала свободно двигать строки мимо других групп)
function disciplinesForPositionAll(positionId){
  return positionDisciplines
    .filter(pd => pd.position_id === positionId)
    .sort((a,b) => a.sort_order - b.sort_order)
    .map(pd => ({ pd, d: disciplines.find(x => x.code === pd.discipline_code) || null }));
}
// порядковый номер раздела в позиции = "номер позиции.номер группы" (напр. 1.2); группа —
// это подряд идущие альбомы одного раздела (напр. КЖ1, КЖ2) — тогда добавляется ещё одна
// цифра, номер альбома внутри группы (1.2.1, 1.2.2). Если одинаковый код встречается не
// подряд (пользователь развёл их по разным местам списка) — это уже разные группы/номера
function sectionOrderNumbers(positionId){
  const p = positions.find(x => x.id === positionId);
  const posCode = (p && p.position_code) ? String(p.position_code).trim() : '';
  const list = positionDisciplines
    .filter(pd => pd.position_id === positionId)
    .sort((a,b) => a.sort_order - b.sort_order);
  const result = {};
  let topCounter = 0;
  let i = 0;
  while (i < list.length){
    let j = i;
    while (j < list.length && list[j].discipline_code === list[i].discipline_code) j++;
    topCounter++;
    const runLen = j - i;
    for (let k = i; k < j; k++){
      const sub = runLen > 1 ? `.${k - i + 1}` : '';
      result[list[k].id] = `${posCode ? posCode+'.' : ''}${topCounter}${sub}`;
    }
    i = j;
  }
  return result;
}
// шифр альбома по умолчанию = аббревиатура названия раздела + порядковый номер среди
// альбомов того же раздела в этой же позиции (напр. КЖ1, второй такой же альбом -> КЖ2).
// Пользователь может переписать это вручную (сохраняется в position_disciplines.marker).
function defaultMarkerForAlbum(positionId, albumId){
  const pdSelf = positionDisciplines.find(x => x.id === albumId);
  if (!pdSelf) return '';
  const d = disciplines.find(x => x.code === pdSelf.discipline_code);
  if (!d) return '';
  const sameCode = positionDisciplines
    .filter(pd => pd.position_id === positionId && pd.discipline_code === pdSelf.discipline_code)
    .sort((a,b) => a.sort_order - b.sort_order);
  const idx = sameCode.findIndex(x => x.id === albumId) + 1;
  // шифр строится от кода раздела (задаётся в "Проекте"), а не от аббревиатуры названия —
  // иначе шифр мог не совпадать с кодом, если аббревиатура названия отличается от кода
  return (d.code || abbreviateName(d.name_ru)) + (idx || 1);
}
// обозначение листа = Номер договора-Номер по ГП(или 00, если без позиции)-Шифр альбома
function computeDesignation(positionId, marker){
  const contract = project ? (project.contract_number || '') : '';
  const pos = positions.find(x => x.id === positionId);
  const posPart = (pos && pos.position_code) ? pos.position_code : '00';
  return [contract, posPart, marker].filter(Boolean).join('-');
}
// то же самое, но для листов альбома "Отдельного тома" — у такого альбома нет позиции,
// поэтому вместо номера по ГП подставляется "00" (напр. EMSS-25-AES-200-00-ГП1)
function computeDesignationVolume(marker){
  const contract = project ? (project.contract_number || '') : '';
  return [contract, '00', marker].filter(Boolean).join('-');
}
// альбомы, стоящие прямо в томе (без позиции) — см. "Позиции по ГП" → "Отдельные тома".
// Порядок — просто по sort_order, как расставил пользователь (см. комментарий у
// disciplinesForPositionAll про отказ от принудительной перегруппировки одинаковых кодов)
function disciplinesForVolumeAll(volumeId){
  return positionDisciplines
    .filter(pd => pd.volume_id === volumeId)
    .sort((a,b) => a.sort_order - b.sort_order)
    .map(pd => ({ pd, d: disciplines.find(x => x.code === pd.discipline_code) || null }));
}
// № п.п. раздела в отдельном томе — та же логика, что sectionOrderNumbers (группа = подряд
// идущие альбомы одного раздела), только префикс — номер тома, а не "Позиция по ГП"
function sectionOrderNumbersForVolume(volumeId){
  const v = volumes.find(x => x.id === volumeId);
  const volCode = (v && v.number) ? String(v.number).trim() : '';
  const list = positionDisciplines
    .filter(pd => pd.volume_id === volumeId)
    .sort((a,b) => a.sort_order - b.sort_order);
  const result = {};
  let topCounter = 0;
  let i = 0;
  while (i < list.length){
    let j = i;
    while (j < list.length && list[j].discipline_code === list[i].discipline_code) j++;
    topCounter++;
    const runLen = j - i;
    for (let k = i; k < j; k++){
      const sub = runLen > 1 ? `.${k - i + 1}` : '';
      result[list[k].id] = `${volCode ? volCode+'.' : ''}${topCounter}${sub}`;
    }
    i = j;
  }
  return result;
}
// шифр альбома по умолчанию для альбома в отдельном томе — аналог defaultMarkerForAlbum
function defaultMarkerForVolumeAlbum(volumeId, albumId){
  const pdSelf = positionDisciplines.find(x => x.id === albumId);
  if (!pdSelf) return '';
  const d = disciplines.find(x => x.code === pdSelf.discipline_code);
  if (!d) return '';
  const sameCode = positionDisciplines
    .filter(pd => pd.volume_id === volumeId && pd.discipline_code === pdSelf.discipline_code)
    .sort((a,b) => a.sort_order - b.sort_order);
  const idx = sameCode.findIndex(x => x.id === albumId) + 1;
  // шифр строится от кода раздела (задаётся в "Проекте"), а не от аббревиатуры названия
  return (d.code || abbreviateName(d.name_ru)) + (idx || 1);
}
// тома, в которые НЕ вкладываются позиции по ГП — кандидаты для "Отдельных томов"
// (см. "Позиции по ГП"); обычно это 4 из 5 стандартных томов, кроме "Основные комплекты..."
function standaloneVolumes(){
  return sortedVolumes().filter(v => !v.is_positions_root);
}
function sortedVolumes(){
  return [...volumes].sort((a,b) => {
    const na = parseFloat(a.number), nb = parseFloat(b.number);
    if (isNaN(na) && isNaN(nb)) return 0;
    if (isNaN(na)) return 1;
    if (isNaN(nb)) return -1;
    return na - nb;
  });
}
// вставка новой (пустой) позиции сразу над/под указанной — как "добавить строку" в Excel
async function insertPositionAdjacent(targetId, dir){
  if (!project) return alert('Сначала ГИП должен создать проект');
  const list = sortedPositions();
  const idx = list.findIndex(x => x.id === targetId);
  if (idx < 0) return;
  const insertIdx = dir === 'above' ? idx : idx + 1;
  await Promise.all(list
    .map((row, i) => ({ row, newOrder: i >= insertIdx ? i + 1 : i }))
    .filter(({ row, newOrder }) => newOrder !== row.sort_order)
    .map(({ row, newOrder }) => dbWrite(sb.from('positions').update({ sort_order: newOrder }).eq('id', row.id))));
  await dbWrite(sb.from('positions').insert({
    project_id: project.id, parent_id: null, position_code: null, name_ru: null, name_en: null,
    sort_order: insertIdx, created_by: profile.id,
  }));
  const { data } = await sb.from('positions').select('*').order('sort_order');
  positions = data || [];
  renderTab(activeTab);
}
// вставка нового (пустого, без привязки к разделу) альбома сразу над/под указанным в пределах той же позиции
async function insertAlbumAdjacent(positionId, targetPdId, dir){
  if (!project) return alert('Сначала ГИП должен создать проект');
  const sibs = disciplinesForPositionAll(positionId).map(x => x.pd);
  const idx = sibs.findIndex(x => x.id === targetPdId);
  if (idx < 0) return;
  const insertIdx = dir === 'above' ? idx : idx + 1;
  await Promise.all(sibs
    .map((row, i) => ({ row, newOrder: i >= insertIdx ? i + 1 : i }))
    .filter(({ row, newOrder }) => newOrder !== row.sort_order)
    .map(({ row, newOrder }) => dbWrite(sb.from('position_disciplines').update({ sort_order: newOrder }).eq('id', row.id))));
  const tempCode = '_new' + Date.now().toString(36) + Math.floor(Math.random()*1000);
  await dbWrite(sb.from('position_disciplines').insert({ position_id: positionId, discipline_code: tempCode, sort_order: insertIdx, created_by: profile.id }));
  const { data } = await sb.from('position_disciplines').select('*');
  positionDisciplines = data || [];
  renderTab(activeTab);
}
// вставка нового альбома выше/ниже указанного в пределах отдельного тома (без позиции) — аналог insertAlbumAdjacent
async function insertAlbumAdjacentVolume(volumeId, targetPdId, dir){
  const sibs = disciplinesForVolumeAll(volumeId).map(x => x.pd);
  const idx = sibs.findIndex(x => x.id === targetPdId);
  if (idx < 0) return;
  const insertIdx = dir === 'above' ? idx : idx + 1;
  await Promise.all(sibs
    .map((row, i) => ({ row, newOrder: i >= insertIdx ? i + 1 : i }))
    .filter(({ row, newOrder }) => newOrder !== row.sort_order)
    .map(({ row, newOrder }) => dbWrite(sb.from('position_disciplines').update({ sort_order: newOrder }).eq('id', row.id))));
  const tempCode = '_new' + Date.now().toString(36) + Math.floor(Math.random()*1000);
  await dbWrite(sb.from('position_disciplines').insert({ volume_id: volumeId, discipline_code: tempCode, sort_order: insertIdx, created_by: profile.id }));
  const { data } = await sb.from('position_disciplines').select('*');
  positionDisciplines = data || [];
  renderTab(activeTab);
}
let mdrDetailLevel = 4; // 1=только тома, 2=+позиции, 3=+разделы, 4=+листы
function applyMdrDetailLevel(){
  document.querySelectorAll('tr.mdr-pos-row').forEach(tr => tr.style.display = mdrDetailLevel >= 2 ? '' : 'none');
  document.querySelectorAll('tr.mdr-disc-row').forEach(tr => tr.style.display = mdrDetailLevel >= 3 ? '' : 'none');
  document.querySelectorAll('tr.mdr-doc-row').forEach(tr => tr.style.display = mdrDetailLevel >= 4 ? '' : 'none');
}
// "Редакция" листа — своё отдельное поле (sheets.edition), задаётся прямо в MDR; выпадающий
// список стандартных обозначений. Не путать с "Ревизией" (sheets.revision) — та берётся
// только из вкладки "Состав разделов" и в MDR просто показывается, не редактируется
const MDR_EDITION_OPTIONS = ['R01','R02','A1','A2','A3'];
function mdrEditionSelectHtml(s){
  const current = s.edition || '';
  const matched = MDR_EDITION_OPTIONS.includes(current);
  return `<select class="text-like sMdrEdition" data-id="${s.id}" style="width:100%;">
    <option value=""></option>
    ${MDR_EDITION_OPTIONS.map(r => `<option value="${r}" ${current===r?'selected':''}>${r}</option>`).join('')}
    ${(!matched && current) ? `<option value="${esc(current)}" selected>${esc(current)}</option>` : ''}
  </select>`;
}
// строки альбомов + их листов для MDR — общая логика для альбомов внутри позиции
// (owner = {pos:id}) и альбомов, стоящих прямо в "Отдельном томе" (owner = {vol:id})
function discSheetRowsHtml(discs, owner){
  const rows = [];
  const ownerAttr = owner.pos ? `data-pos="${owner.pos}"` : `data-vol="${owner.vol}"`;
  discs.forEach(({ pd, d }) => {
    const marker = pd.marker || (owner.pos ? defaultMarkerForAlbum(owner.pos, pd.id) : defaultMarkerForVolumeAlbum(owner.vol, pd.id));
    // обозначение и ответственный одинаковы для всех листов альбома — считаем один раз
    // на раздел, а не на каждый лист
    const designation = owner.pos ? computeDesignation(owner.pos, marker) : computeDesignationVolume(marker);
    const responsibleName = resolvedResponsibleName(pd, d);
    const sheetRows = sortSheetsByNumber(sheets.filter(s => s.position_discipline_id === pd.id));
    rows.push(`
      <tr class="mdr-disc-row" ${ownerAttr} data-pdid="${pd.id}">
        <td><input type="text" class="text-like mAlbumManualNum" data-pdid="${pd.id}" value="${esc(pd.manual_number||'')}" placeholder="—" style="width:100%;"></td>
        <td>
          <button class="mdr-toggle btn-toggle-disc" data-pdid="${pd.id}">▼</button>
        </td>
        <td style="padding-left:40px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="Раздел и его шифр задаются во вкладке «Создание разделов»">
          ${(d && (d.name_ru || d.name_en)) ? esc(t(d.name_ru, d.name_en)) : `<span style="opacity:.6;">раздел не выбран</span>`}
        </td>
        <td style="font-family:var(--mono);font-size:11px;">${esc(designation)}</td>
        <td>${esc(pd.note||'')}</td>
        <td title="Ответственный задаётся во вкладке «Создание разделов»">${esc(responsibleName)}</td>
        <td></td>
        <td></td>
      </tr>`);
    sheetRows.forEach((s) => {
      rows.push(`
      <tr class="mdr-doc-row" ${ownerAttr} data-pdid="${pd.id}">
        <td><input type="text" class="text-like sManualNum" data-id="${s.id}" value="${esc(s.manual_number||'')}" placeholder="—" style="width:100%;"></td>
        <td></td>
        <td colspan="2" style="padding-left:80px;">${esc(t(s.name_ru, s.name_en) || '—')}</td>
        <td>${esc(s.comment||'')}</td>
        <td></td>
        <td class="muted" title="Задаётся во вкладке «Состав разделов»">${esc(s.revision||'')}</td>
        <td>${mdrEditionSelectHtml(s)}</td>
      </tr>`);
    });
  });
  return rows;
}
function renderMdrTab(){
  const posList = sortedPositions();
  const groups = posList.map(p => ({ p, discs: disciplinesForPositionAll(p.id) }));

  const positionRows = [];
  groups.forEach(({ p, discs }) => {
    positionRows.push(`
      <tr class="mdr-pos-row" data-pos="${p.id}">
        <td><input type="text" class="text-like mPosManualNum" data-id="${p.id}" value="${esc(p.manual_number||'')}" placeholder="—" style="width:100%;"></td>
        <td>
          <button class="mdr-toggle btn-toggle-pos" data-pos="${p.id}">▼</button>
          ${esc(p.position_code || '—')}
        </td>
        <td colspan="6" style="font-weight:600;" title="Код и наименование позиции задаются во вкладке «Позиции по ГП»">
          ${(p.name_ru || p.name_en) ? esc(t(p.name_ru, p.name_en)) : '<span style="opacity:.6;">не заполнено — см. «Позиции по ГП»</span>'}
        </td>
      </tr>`);
    positionRows.push(...discSheetRowsHtml(discs, { pos: p.id }));
  });

  const bodyRows = [];
  let positionRowsPlaced = false;
  sortedVolumes().forEach(v => {
    const volDiscs = v.is_positions_root ? [] : disciplinesForVolumeAll(v.id);
    bodyRows.push(`
      <tr class="mdr-vol-row">
        <td><input type="text" class="text-like volNumber" data-id="${v.id}" value="${esc(v.number||'')}" placeholder="№" style="width:100%;font-weight:700;"></td>
        <td>${volDiscs.length ? `<button class="mdr-toggle btn-toggle-vol" data-vol="${v.id}">▼</button>` : ''}</td>
        <td colspan="5">
          <input type="text" class="text-like volNameRu lang-ru" data-id="${v.id}" value="${esc(v.name_ru||'')}" placeholder="наименование не заполнено" style="display:block;width:100%;font-weight:700;">
          <input type="text" class="text-like volNameEn lang-en" data-id="${v.id}" value="${esc(v.name_en||'')}" placeholder="name (en)" style="display:block;width:100%;font-size:12px;">
        </td>
        <td><button class="icon-btn btn-del-volume" data-id="${v.id}" title="Удалить том">✕</button></td>
      </tr>`);
    if (v.is_positions_root){
      bodyRows.push(...positionRows);
      positionRowsPlaced = true;
    } else if (volDiscs.length){
      bodyRows.push(...discSheetRowsHtml(volDiscs, { vol: v.id }));
    }
  });
  if (!positionRowsPlaced) bodyRows.push(...positionRows); // нет тома-хозяина позиций — показываем их отдельно, ничего не теряем

  return `
  <div class="card">
    <div class="card-header">
      <span class="title"><span class="lang-ru">СВОДНЫЙ РЕЕСТР ПРОЕКТНОЙ ДОКУМЕНТАЦИИ (СРПД)</span><span class="lang-ru lang-en"> / </span><span class="lang-en">MASTER DOCUMENT REGISTER (MDR)</span></span>
      <div style="display:flex;gap:8px;">
        <button class="btn secondary small" id="btnAddMdrRow">+ Добавить том</button>
        <button class="btn secondary small" id="btnTranslateMdr">🌐 Перевести на EN</button>
        <button class="btn small" id="btnPrintMdr">🖨 Печать</button>
      </div>
    </div>
  </div>
  <div class="card" id="mdrPrintable" style="padding:0;">
    <table style="table-layout:fixed;">
      <colgroup>
        <col style="width:90px;"><col style="width:70px;"><col><col style="width:170px;"><col style="width:200px;"><col style="width:190px;"><col style="width:100px;"><col style="width:110px;">
      </colgroup>
      <thead>
        <tr>
          <th><span class="lang-ru">Номер тома</span><span class="lang-en">Volume No.</span></th>
          <th id="mdrLevelHeader" style="cursor:pointer;user-select:none;" title="Клик — переключить уровень детализации"><span class="lang-ru">№ по ГП</span><span class="lang-en">Position No.</span></th>
          <th><span class="lang-ru">Наименование документа</span><span class="lang-en">Document Name</span></th>
          <th><span class="lang-ru">Обозначение</span><span class="lang-en">Notation</span></th>
          <th><span class="lang-ru">Примечание</span><span class="lang-en">Remarks</span></th>
          <th title="Задаётся во вкладке «Создание разделов»"><span class="lang-ru">Ответственный исполнитель</span><span class="lang-en">Responsible Person</span></th>
          <th title="Задаётся во вкладке «Состав разделов»"><span class="lang-ru">Ревизия</span><span class="lang-en">Revision</span></th>
          <th><span class="lang-ru">Редакция</span><span class="lang-en">Edition</span></th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows.join('') || `<tr><td colspan="8" class="muted">Пока пусто — нажмите «+ Добавить строку»</td></tr>`}
      </tbody>
    </table>
    <datalist id="disciplineNameSuggestions">
      ${disciplineNameOptionsHtml()}
    </datalist>
  </div>`;
}

// ---------------- вкладка "Поручения" ----------------
function sortedAssignments(){
  return [...assignments].sort((a,b) => a.sort_order - b.sort_order);
}
// фильтры по столбцам (см. filter-row в renderAssignmentsTab) — состояние переживает
// перерисовку строк, сбрасывается только явно кнопкой "Сбросить фильтры"
let assignmentFilters = { text:'', basis:'', author:'', assignee:'', issuedFrom:'', deadlineTo:'', status:'', note:'' };
function filteredAssignments(){
  const f = assignmentFilters;
  return sortedAssignments().filter(a => {
    if (f.text && !(a.text||'').toLowerCase().includes(f.text.toLowerCase())) return false;
    if (f.basis && !(a.basis||'').toLowerCase().includes(f.basis.toLowerCase())) return false;
    if (f.author && a.author_id !== f.author) return false;
    if (f.assignee && a.assignee_id !== f.assignee) return false;
    if (f.status && a.status !== f.status) return false;
    if (f.note && !(a.note||'').toLowerCase().includes(f.note.toLowerCase())) return false;
    if (f.issuedFrom && (!a.issued_date || a.issued_date < f.issuedFrom)) return false;
    if (f.deadlineTo && (!a.deadline || a.deadline > f.deadlineTo)) return false;
    return true;
  });
}
// Автор/Исполнитель — выпадающий список из справочника сотрудников; для тех, кому
// нельзя редактировать (не ГИП/помощник ГИПа) — просто имя текстом
function employeeSelectHtml(cls, rowId, selectedId, canEdit, blankLabel){
  if (!canEdit) return esc(employeeName(selectedId));
  return `<select class="text-like ${cls}" data-id="${rowId}" style="width:100%;">
    <option value="">${esc(blankLabel)}</option>
    ${sortedEmployees().map(e => `<option value="${e.id}" ${selectedId===e.id?'selected':''}>${esc(e.full_name)}</option>`).join('')}
  </select>`;
}
// одна ячейка с двумя подписанными полями друг под другом (Автор/Исполнитель, Дата выдачи/Дедлайн)
function stackedFieldHtml(label, fieldHtml){
  return `<div style="margin-bottom:6px;">
    <div class="muted" style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px;">${esc(label)}</div>
    ${fieldHtml}
  </div>`;
}
// большая ячейка на всю высоту строки (Поручение/Основание/Примечание) — td padding:0
// + height:1px нужны, чтобы textarea с height:100% реально дотягивался до верха и низа
// строки (иначе % высота у ячейки таблицы не считается от реальной высоты строки)
function bigTextareaCellHtml(cls, rowId, value, placeholder, canEdit){
  return `<td style="padding:0;height:1px;"><textarea class="text-like ${cls}" data-id="${rowId}" placeholder="${esc(placeholder)}" ${canEdit?'':'disabled'} rows="6" style="display:block;width:100%;height:100%;min-height:110px;box-sizing:border-box;">${esc(value||'')}</textarea></td>`;
}
function assignmentsColgroupHtml(canEdit){
  return `<colgroup>
    <col style="width:40px;"><col><col><col style="width:175px;"><col style="width:145px;">
    <col style="width:100px;"><col>
    ${canEdit ? '<col style="width:60px;">' : ''}
  </colgroup>`;
}
function renderAssignmentsFilterRow(canEdit){
  const f = assignmentFilters;
  return `
  <tr class="filter-row">
    <td></td>
    <td><input type="text" class="filter-input fText" value="${esc(f.text)}" placeholder="поиск..." style="width:100%;"></td>
    <td><input type="text" class="filter-input fBasis" value="${esc(f.basis)}" placeholder="поиск..." style="width:100%;"></td>
    <td>
      <select class="filter-input fAuthor" title="Автор — все" style="width:100%;margin-bottom:4px;">
        <option value="">— автор: все —</option>
        ${sortedEmployees().map(e => `<option value="${e.id}" ${f.author===e.id?'selected':''}>${esc(e.full_name)}</option>`).join('')}
      </select>
      <select class="filter-input fAssignee" title="Исполнитель — все" style="width:100%;">
        <option value="">— исполн.: все —</option>
        ${sortedEmployees().map(e => `<option value="${e.id}" ${f.assignee===e.id?'selected':''}>${esc(e.full_name)}</option>`).join('')}
      </select>
    </td>
    <td>
      <input type="date" class="filter-input fIssuedFrom" value="${esc(f.issuedFrom)}" title="Выдано не раньше" style="width:100%;margin-bottom:4px;">
      <input type="date" class="filter-input fDeadlineTo" value="${esc(f.deadlineTo)}" title="Дедлайн не позже" style="width:100%;">
    </td>
    <td>
      <select class="filter-input fStatus" title="Статус — все" style="width:100%;">
        <option value="">— все —</option>
        ${Object.entries(ASSIGNMENT_STATUS_LABELS).map(([k,v]) => `<option value="${k}" ${f.status===k?'selected':''}>${v.ru}</option>`).join('')}
      </select>
    </td>
    <td><input type="text" class="filter-input fNote" value="${esc(f.note)}" placeholder="поиск..." style="width:100%;"></td>
    ${canEdit ? '<td></td>' : ''}
  </tr>`;
}
function renderAssignmentsRows(){
  const fullList = sortedAssignments();
  const numberById = {};
  fullList.forEach((a, i) => { numberById[a.id] = i+1; });
  const list = filteredAssignments();
  const canEdit = isFullAccess();
  if (!list.length){
    const msg = fullList.length ? 'Ничего не найдено по заданным фильтрам' : `Поручения пока не добавлены${canEdit?' — нажмите «+ Добавить поручение»':''}`;
    return `<tr><td colspan="${canEdit?8:7}" class="muted">${msg}</td></tr>`;
  }
  return list.map(a => {
    const fullIdx = numberById[a.id] - 1;
    return `
    <tr data-id="${a.id}">
      <td class="muted" style="font-family:var(--mono);">${numberById[a.id]}</td>
      ${bigTextareaCellHtml('asgText', a.id, a.text, 'текст поручения', canEdit)}
      ${bigTextareaCellHtml('asgBasis', a.id, a.basis, 'основание', canEdit)}
      <td>
        ${stackedFieldHtml('Автор', employeeSelectHtml('asgAuthor', a.id, a.author_id, canEdit, '— автор —'))}
        ${stackedFieldHtml('Исполнитель', employeeSelectHtml('asgAssignee', a.id, a.assignee_id, canEdit, '— исполнитель —'))}
      </td>
      <td>
        ${stackedFieldHtml('Дата выдачи', `<input type="date" class="text-like asgIssued" data-id="${a.id}" value="${esc(a.issued_date||'')}" ${canEdit?'':'disabled'} style="width:100%;">`)}
        ${stackedFieldHtml('Дедлайн', `<input type="date" class="text-like asgDeadline" data-id="${a.id}" value="${esc(a.deadline||'')}" ${canEdit?'':'disabled'} style="width:100%;">`)}
      </td>
      <td>
        ${canEdit ? `
        <select class="text-like asgStatus" data-id="${a.id}" style="width:100%;">
          ${Object.entries(ASSIGNMENT_STATUS_LABELS).map(([k,v])=>`<option value="${k}" ${a.status===k?'selected':''}>${v.ru}</option>`).join('')}
        </select>` : `<span class="badge ${a.status}">${t(ASSIGNMENT_STATUS_LABELS[a.status].ru, ASSIGNMENT_STATUS_LABELS[a.status].en)}</span>`}
      </td>
      ${bigTextareaCellHtml('asgNote', a.id, a.note, 'примечание', canEdit)}
      ${canEdit ? `
      <td style="white-space:nowrap;">
        <button class="icon-btn btn-move-assignment" data-id="${a.id}" data-dir="up" ${fullIdx<=0?'disabled':''}>↑</button>
        <button class="icon-btn btn-move-assignment" data-id="${a.id}" data-dir="down" ${fullIdx>=fullList.length-1?'disabled':''}>↓</button>
        <button class="icon-btn btn-del-assignment" data-id="${a.id}" title="Удалить поручение">✕</button>
      </td>` : ''}
    </tr>`;
  }).join('');
}
function renderAssignmentsTab(){
  const canEdit = isFullAccess();
  return `
  <div class="card">
    <div class="card-header">
      <span class="title">Поручения</span>
      <div style="display:flex;gap:8px;">
        <button class="btn secondary small" id="btnResetAssignmentFilters">✕ Сбросить фильтры</button>
        ${canEdit ? `<button class="btn small" id="btnAddAssignment">+ Добавить поручение</button>` : ''}
      </div>
    </div>
    <div class="card-body" style="padding:0;">
      <table class="assignments-table" style="table-layout:fixed;">
        ${assignmentsColgroupHtml(canEdit)}
        <thead>
          <tr>
            <th>№</th><th>Поручение</th><th>Основание</th><th>Автор / Исполнитель</th><th>Дата выдачи / Дедлайн</th>
            <th>Статус</th><th>Примечание</th>${canEdit ? '<th></th>' : ''}
          </tr>
          ${renderAssignmentsFilterRow(canEdit)}
        </thead>
        <tbody id="assignmentsBody">${renderAssignmentsRows()}</tbody>
      </table>
    </div>
  </div>`;
}
// перерисовать только строки таблицы (после смены фильтра) — не трогая сами поля фильтров,
// иначе при вводе в текстовый фильтр поле теряло бы фокус на каждый символ
function refreshAssignmentsBody(){
  document.getElementById('assignmentsBody').innerHTML = renderAssignmentsRows();
  bindAssignmentRowEvents();
}
// события самих строк (текст/выбор сотрудника/даты/статус/порядок/удаление) — вызывается
// и при первой отрисовке вкладки, и при каждом обновлении списка после смены фильтра
function bindAssignmentRowEvents(){
  if (!isFullAccess()) return; // у остальных все поля не редактируются — событий вешать не на что

  document.querySelectorAll('.asgText, .asgBasis, .asgNote').forEach(el => el.addEventListener('change', async () => {
    const id2 = el.dataset.id;
    const field = el.classList.contains('asgText') ? 'text' : el.classList.contains('asgBasis') ? 'basis' : 'note';
    const value = el.value.trim() || null;
    await dbWrite(sb.from('assignments').update({ [field]: value }).eq('id', id2));
    const a = assignments.find(x => x.id === id2);
    if (a) a[field] = value;
  }));

  document.querySelectorAll('.asgAuthor, .asgAssignee').forEach(el => el.addEventListener('change', async () => {
    const id2 = el.dataset.id;
    const field = el.classList.contains('asgAuthor') ? 'author_id' : 'assignee_id';
    const value = el.value || null;
    await dbWrite(sb.from('assignments').update({ [field]: value }).eq('id', id2));
    const a = assignments.find(x => x.id === id2);
    if (a) a[field] = value;
  }));

  document.querySelectorAll('.asgIssued, .asgDeadline').forEach(el => el.addEventListener('change', async () => {
    const id2 = el.dataset.id;
    const field = el.classList.contains('asgIssued') ? 'issued_date' : 'deadline';
    const value = el.value || null;
    await dbWrite(sb.from('assignments').update({ [field]: value }).eq('id', id2));
    const a = assignments.find(x => x.id === id2);
    if (a) a[field] = value;
  }));

  document.querySelectorAll('.asgStatus').forEach(el => el.addEventListener('change', async () => {
    const id2 = el.dataset.id;
    const status = el.value;
    await dbWrite(sb.from('assignments').update({ status }).eq('id', id2));
    const a = assignments.find(x => x.id === id2);
    if (a) a.status = status;
  }));

  document.querySelectorAll('.btn-move-assignment').forEach(b => b.addEventListener('click', async () => {
    const list = sortedAssignments();
    const idx = list.findIndex(x => x.id === b.dataset.id);
    const swapIdx = b.dataset.dir === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= list.length) return;
    const reordered = [...list];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    await Promise.all(reordered.map((row, i) => dbWrite(sb.from('assignments').update({ sort_order: i }).eq('id', row.id))));
    const { data } = await sb.from('assignments').select('*').order('sort_order');
    assignments = data || [];
    refreshAssignmentsBody();
  }));

  document.querySelectorAll('.btn-del-assignment').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Удалить поручение?')) return;
    await dbWrite(sb.from('assignments').delete().eq('id', b.dataset.id));
    assignments = assignments.filter(x => x.id !== b.dataset.id);
    refreshAssignmentsBody();
  }));
}

// ---------------- вкладка "Пользователи" (ГИП) ----------------
// справочник всех сотрудников (Имя/Email/Роль) — задаётся здесь, независимо от того,
// зарегистрировался ли человек уже в системе. Исполнители на разделы (вкладка "Проект" →
// "Разделы и исполнители") выбираются по имени из этого же списка. Роль, выбранная здесь —
// та, что сотрудник получит при первой регистрации по этому email (см. handle_new_user в
// схеме БД); если он уже зарегистрирован — роль применяется сразу же (обновляется profiles)
function codesByEmployee(){
  const map = {};
  disciplineAssignees.forEach(a => {
    if (!a.employee_id) return;
    const d = disciplines.find(x => x.id === a.discipline_id);
    const code = d ? (d.code || t(d.name_ru, d.name_en) || '—') : '—';
    if (!map[a.employee_id]) map[a.employee_id] = new Set();
    map[a.employee_id].add(code);
  });
  return map;
}
function renderUsersTab(){
  const list = sortedEmployees();
  const codes = codesByEmployee();
  return `
  <div class="card">
    <div class="card-header">
      <span class="title">Пользователи</span>
      <button class="btn small" id="btnAddEmployee">+ Добавить сотрудника</button>
    </div>
    <div class="card-body" style="padding:0;">
      <table style="table-layout:fixed;">
        <colgroup><col><col style="width:240px;"><col style="width:160px;"><col style="width:180px;"><col style="width:44px;"></colgroup>
        <tr><th>Имя</th><th>Email</th><th>Разделы</th><th>Роль</th><th></th></tr>
        ${list.map(e => {
          const registered = allProfiles.some(p => (p.email||'').toLowerCase() === (e.email||'').toLowerCase());
          const empCodes = [...(codes[e.id] || [])];
          const isAdmin = isAdminEmail(e.email);
          return `
          <tr data-id="${e.id}">
            <td><input type="text" class="text-like eName" data-id="${e.id}" value="${esc(e.full_name||'')}" placeholder="ФИО" style="width:100%;"></td>
            <td><input type="email" class="text-like eEmail" data-id="${e.id}" value="${esc(e.email||'')}" placeholder="email" style="width:100%;"></td>
            <td class="muted" style="font-size:12px;">${empCodes.length ? esc(empCodes.join(', ')) : ''}</td>
            <td>
              ${isAdmin
                ? `<span style="color:var(--accent);font-weight:700;" title="Закреплённый администратор — роль нельзя изменить">Администратор</span>`
                : `<select class="eRole" data-id="${e.id}">
                    ${Object.entries(ROLE_LABELS).map(([k,v]) => `<option value="${k}" ${e.role===k?'selected':''}>${v}</option>`).join('')}
                  </select>`}
              ${!registered ? `<div class="muted" style="font-size:11px;margin-top:2px;">ещё не зарегистрирован</div>` : ''}
            </td>
            <td>${isAdmin ? '' : `<button class="icon-btn btn-del-employee" data-id="${e.id}" title="Удалить сотрудника">✕</button>`}</td>
          </tr>`;
        }).join('') || `<tr><td colspan="5" class="muted">Сотрудники пока не добавлены — нажмите «+ Добавить сотрудника»</td></tr>`}
      </table>
      <p class="muted" style="padding:12px 16px;font-size:12px;">
        Исполнителей на конкретные разделы назначают во вкладке «Проект» — «Разделы и
        исполнители», выбирая имя из этого списка.
      </p>
    </div>
  </div>`;
}

// ---------------- события форм ----------------
function bindTabEvents(id){
  if (id === 'project'){
    document.getElementById('btnSaveProject').addEventListener('click', async () => {
      const payload = {
        contract_number: document.getElementById('pContract').value.trim(),
        name_ru: document.getElementById('pNameRu').value.trim(),
        name_en: document.getElementById('pNameEn').value.trim(),
        updated_by: profile.id,
        updated_at: new Date().toISOString(),
      };
      if (project) await dbWrite(sb.from('projects').update(payload).eq('id', project.id));
      else await dbWrite(sb.from('projects').insert(payload));
      await loadAll(); switchTab('project');
    });

    document.getElementById('btnAddDiscipline').addEventListener('click', async () => {
      if (!project) return alert('Сначала сохраните шапку проекта');
      // по умолчанию — следующий по порядку номер (1, 2, 3...), пользователь может заменить на любое число
      const nums = disciplines.map(d => parseFloat(d.volume_number)).filter(n => !isNaN(n));
      const nextNumber = nums.length ? Math.max(...nums) + 1 : 1;
      await dbWrite(sb.from('disciplines').insert({
        project_id: project.id,
        volume_number: String(nextNumber),
        code: null,
        name_ru: null,
        name_en: null,
        created_by: profile.id,
      }));
      await loadAll(); switchTab('project');
    });

    document.querySelectorAll('.dVolume, .dCode, .dNameRu, .dNameEn').forEach(el => el.addEventListener('change', async () => {
      const id = el.dataset.id;
      const volume_number = document.querySelector(`.dVolume[data-id="${id}"]`).value.trim();
      const code = document.querySelector(`.dCode[data-id="${id}"]`).value.trim() || null;
      const name_ru = document.querySelector(`.dNameRu[data-id="${id}"]`).value.trim();
      const name_en = document.querySelector(`.dNameEn[data-id="${id}"]`).value.trim();
      const d = disciplines.find(x => x.id === id);
      const oldCode = d ? d.code : null;
      await dbWrite(sb.from('disciplines').update({
        volume_number: volume_number || null, code, name_ru: name_ru || null, name_en
      }).eq('id', id));
      // код раздела мог поменяться (напр. временный номер переименовали в "АС") —
      // подтягиваем привязки к позициям на новый код, иначе связь потеряется
      if (oldCode && code && oldCode !== code){
        await dbWrite(sb.from('position_disciplines').update({ discipline_code: code }).eq('discipline_code', oldCode));
        positionDisciplines.forEach(pd => { if (pd.discipline_code === oldCode) pd.discipline_code = code; });
      }
      if (d){ d.volume_number = volume_number || null; d.code = code; d.name_ru = name_ru || null; d.name_en = name_en; }
      // если EN пустой — сразу подставляем черновой автоперевод
      if (d && d.name_ru && !d.name_en){
        const translated = await translateRuToEn(d.name_ru);
        if (translated){ await dbWrite(sb.from('disciplines').update({ name_en: translated }).eq('id', id)); d.name_en = translated; }
      }
      // номер тома влияет на порядок строк — перерисовываем таблицу целиком
      // (безопасно: событие 'change' срабатывает уже после того, как поле потеряло фокус)
      document.getElementById('tabContent').innerHTML = renderProjectTab();
      bindTabEvents('project');
    }));

    document.querySelectorAll('.btn-add-assignee').forEach(b => b.addEventListener('click', async () => {
      await dbWrite(sb.from('discipline_assignees').insert({ discipline_id: b.dataset.id, created_by: profile.id }));
      const { data } = await sb.from('discipline_assignees').select('*').order('created_at');
      disciplineAssignees = data || [];
      document.getElementById('tabContent').innerHTML = renderProjectTab();
      bindTabEvents('project');
    }));

    document.querySelectorAll('.aEmployee').forEach(el => el.addEventListener('change', async () => {
      const id = el.dataset.id;
      const employee_id = el.value || null;
      await dbWrite(sb.from('discipline_assignees').update({ employee_id }).eq('id', id));
      const a = disciplineAssignees.find(x => x.id === id);
      if (a) a.employee_id = employee_id;
    }));

    document.querySelectorAll('.btn-del-assignee').forEach(b => b.addEventListener('click', async () => {
      await dbWrite(sb.from('discipline_assignees').delete().eq('id', b.dataset.id));
      disciplineAssignees = disciplineAssignees.filter(x => x.id !== b.dataset.id);
      document.getElementById('tabContent').innerHTML = renderProjectTab();
      bindTabEvents('project');
    }));

    document.querySelectorAll('.btn-del-discipline').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Удалить раздел? Если он используется в каких-то альбомах в MDR, их названия перестанут отображаться (сами альбомы и листы не удаляются).')) return;
      await dbWrite(sb.from('disciplines').delete().eq('id', b.dataset.id));
      await loadAll(); switchTab('project');
    }));
  }
  else if (id === 'posgp'){
    document.getElementById('btnAddPosition').addEventListener('click', async () => {
      if (!project) return alert('Сначала ГИП должен создать проект');
      const nextOrder = positions.length ? Math.max(...positions.map(p => p.sort_order)) + 1 : 0;
      await dbWrite(sb.from('positions').insert({
        project_id: project.id, parent_id: null, position_code: null, name_ru: null, name_en: null,
        sort_order: nextOrder, created_by: profile.id,
      }));
      const { data } = await sb.from('positions').select('*').order('sort_order');
      positions = data || [];
      renderTab(activeTab);
    });

    bindPositionEditEvents();

    // правая кнопка мыши — как в Excel: "Добавить строку выше/ниже"
    document.querySelectorAll('tr.pos-gp-row').forEach(tr => tr.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const posId = tr.dataset.id;
      showContextMenu(e.clientX, e.clientY, [
        { label: '⬆ Добавить позицию выше', onClick: () => insertPositionAdjacent(posId, 'above') },
        { label: '⬇ Добавить позицию ниже', onClick: () => insertPositionAdjacent(posId, 'below') },
      ]);
    }));
  }
  else if (id === 'sections'){
    document.querySelectorAll('.subtab[data-mode]').forEach(el => el.addEventListener('click', () => {
      sectionsMode = el.dataset.mode;
      renderTab(activeTab);
    }));

    if (sectionsMode === 'volume'){
      const secVolume = document.getElementById('secVolume');
      if (secVolume) secVolume.addEventListener('change', (e) => {
        standaloneVolumeId = e.target.value;
        document.getElementById('standaloneVolumeDetail').innerHTML = renderStandaloneVolumeDetail();
        bindStandaloneVolumeDetailEvents();
      });
      bindStandaloneVolumeDetailEvents();
    } else {
      document.getElementById('secPosition').addEventListener('change', (e) => {
        sectionsPositionId = e.target.value;
        document.getElementById('sectionsDetail').innerHTML = renderSectionsDetail();
        bindSectionsDetailEvents();
      });
      bindSectionsDetailEvents();
    }
  }
  else if (id === 'sheetcomp'){
    document.getElementById('scPosition').addEventListener('change', (e) => {
      sheetCompContainer = e.target.value;
      sheetCompAlbumId = '';
      document.getElementById('scAlbum').innerHTML = sheetCompAlbumOptionsHtml(sheetCompContainer);
      document.getElementById('sheetCompDetail').innerHTML = renderSheetCompDetail();
      bindSheetCompDetailEvents();
    });
    document.getElementById('scAlbum').addEventListener('change', (e) => {
      sheetCompAlbumId = e.target.value;
      document.getElementById('sheetCompDetail').innerHTML = renderSheetCompDetail();
      bindSheetCompDetailEvents();
    });
    bindSheetCompDetailEvents();
  }
  else if (id === 'mdr'){
    const btnPrint = document.getElementById('btnPrintMdr');
    if (btnPrint) btnPrint.addEventListener('click', () => window.print());

    document.getElementById('btnTranslateMdr').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const jobs = [
        ...volumes.filter(v => v.name_ru && !v.name_en).map(v => ({ table:'volumes', row:v })),
        ...positions.filter(p => p.name_ru && !p.name_en).map(p => ({ table:'positions', row:p })),
        ...disciplines.filter(d => d.name_ru && !d.name_en).map(d => ({ table:'disciplines', row:d })),
        ...sheets.filter(s => s.name_ru && !s.name_en).map(s => ({ table:'sheets', row:s })),
      ];
      if (!jobs.length){ alert('Нечего переводить — везде уже заполнено EN (или пусто RU).'); return; }
      if (!confirm(`Перевести ${jobs.length} пустых EN-полей автопереводом? Черновой перевод можно будет поправить вручную в любом поле EN.`)) return;
      btn.disabled = true;
      let done = 0;
      for (const { table, row } of jobs){
        const translated = await translateRuToEn(row.name_ru);
        if (translated){
          await dbWrite(sb.from(table).update({ name_en: translated }).eq('id', row.id));
          row.name_en = translated;
        }
        done++;
        btn.textContent = `🌐 Перевожу... ${done}/${jobs.length}`;
      }
      btn.disabled = false;
      document.getElementById('tabContent').innerHTML = renderMdrTab();
      bindTabEvents('mdr');
    });

    document.getElementById('btnAddMdrRow').addEventListener('click', async () => {
      // позиции и разделы теперь добавляются только во вкладках "Позиции по ГП" и "Разделы
      // в позициях" — здесь остаётся только добавление тома
      if (!project) return alert('Сначала ГИП должен создать проект');
      const num = prompt('Введите номер тома:');
      if (!num) return;
      if (volumes.some(v => v.number === num.trim())) return alert(`Том с номером "${num.trim()}" уже существует.`);
      await dbWrite(sb.from('volumes').insert({ project_id: project.id, number: num.trim(), name_ru: null, name_en: null, created_by: profile.id }));
      const { data } = await sb.from('volumes').select('*').order('created_at');
      volumes = data || [];
      document.getElementById('tabContent').innerHTML = renderMdrTab();
      bindTabEvents('mdr');
    });

    bindVolumeEditEvents(() => { document.getElementById('tabContent').innerHTML = renderMdrTab(); bindTabEvents('mdr'); });

    // код/наименование позиций и разделов больше не редактируются здесь — они подтягиваются
    // из вкладок "Позиции по ГП" и "Создание разделов" (там же добавляются/удаляются);
    // в MDR редактируется только "Номер тома / номер альбома" и сами тома
    document.querySelectorAll('.mPosManualNum').forEach(el => el.addEventListener('change', async () => {
      const id2 = el.dataset.id;
      const manual_number = el.value.trim() || null;
      await dbWrite(sb.from('positions').update({ manual_number }).eq('id', id2));
      const p = positions.find(x => x.id === id2);
      if (p) p.manual_number = manual_number;
    }));

    document.querySelectorAll('.mAlbumManualNum').forEach(el => el.addEventListener('change', async () => {
      const pdid = el.dataset.pdid;
      const manual_number = el.value.trim() || null;
      await dbWrite(sb.from('position_disciplines').update({ manual_number }).eq('id', pdid));
      const pdLink = positionDisciplines.find(x => x.id === pdid);
      if (pdLink) pdLink.manual_number = manual_number;
    }));

    document.querySelectorAll('.sManualNum').forEach(el => el.addEventListener('change', async () => {
      const id2 = el.dataset.id;
      const manual_number = el.value.trim() || null;
      await dbWrite(sb.from('sheets').update({ manual_number }).eq('id', id2));
      const s = sheets.find(x => x.id === id2);
      if (s) s.manual_number = manual_number;
    }));

    document.querySelectorAll('.sMdrEdition').forEach(el => el.addEventListener('change', async () => {
      const id2 = el.dataset.id;
      const edition = el.value || null;
      await dbWrite(sb.from('sheets').update({ edition }).eq('id', id2));
      const s = sheets.find(x => x.id === id2);
      if (s) s.edition = edition;
    }));

    document.querySelectorAll('.btn-toggle-pos').forEach(b => b.addEventListener('click', () => {
      const collapsed = b.textContent === '▼';
      b.textContent = collapsed ? '▶' : '▼';
      document.querySelectorAll(`tr.mdr-disc-row[data-pos="${b.dataset.pos}"], tr.mdr-doc-row[data-pos="${b.dataset.pos}"]`)
        .forEach(tr => tr.style.display = collapsed ? 'none' : '');
    }));

    document.querySelectorAll('.btn-toggle-vol').forEach(b => b.addEventListener('click', () => {
      const collapsed = b.textContent === '▼';
      b.textContent = collapsed ? '▶' : '▼';
      document.querySelectorAll(`tr.mdr-disc-row[data-vol="${b.dataset.vol}"], tr.mdr-doc-row[data-vol="${b.dataset.vol}"]`)
        .forEach(tr => tr.style.display = collapsed ? 'none' : '');
    }));

    document.querySelectorAll('.btn-toggle-disc').forEach(b => b.addEventListener('click', () => {
      const collapsed = b.textContent === '▼';
      b.textContent = collapsed ? '▶' : '▼';
      document.querySelectorAll(`tr.mdr-doc-row[data-pdid="${b.dataset.pdid}"]`)
        .forEach(tr => tr.style.display = collapsed ? 'none' : '');
    }));

    document.getElementById('mdrLevelHeader').addEventListener('click', () => {
      mdrDetailLevel = mdrDetailLevel >= 4 ? 1 : mdrDetailLevel + 1;
      document.querySelectorAll('.mdr-toggle').forEach(b => b.textContent = '▼'); // сбрасываем ручные сворачивания строк
      applyMdrDetailLevel();
    });

    applyMdrDetailLevel();
  }
  else if (id === 'assignments'){
    // фильтры по столбцам — доступны всем, не только ГИП/помощнику
    document.querySelectorAll('.fText, .fBasis, .fNote').forEach(el => el.addEventListener('input', () => {
      const key = el.classList.contains('fText') ? 'text' : el.classList.contains('fBasis') ? 'basis' : 'note';
      assignmentFilters[key] = el.value;
      refreshAssignmentsBody();
    }));
    document.querySelector('.fAuthor').addEventListener('change', (e) => { assignmentFilters.author = e.target.value; refreshAssignmentsBody(); });
    document.querySelector('.fAssignee').addEventListener('change', (e) => { assignmentFilters.assignee = e.target.value; refreshAssignmentsBody(); });
    document.querySelector('.fStatus').addEventListener('change', (e) => { assignmentFilters.status = e.target.value; refreshAssignmentsBody(); });
    document.querySelector('.fIssuedFrom').addEventListener('change', (e) => { assignmentFilters.issuedFrom = e.target.value; refreshAssignmentsBody(); });
    document.querySelector('.fDeadlineTo').addEventListener('change', (e) => { assignmentFilters.deadlineTo = e.target.value; refreshAssignmentsBody(); });

    document.getElementById('btnResetAssignmentFilters').addEventListener('click', () => {
      assignmentFilters = { text:'', basis:'', author:'', assignee:'', issuedFrom:'', deadlineTo:'', status:'', note:'' };
      renderTab(activeTab);
    });

    if (isFullAccess()){
      document.getElementById('btnAddAssignment').addEventListener('click', async () => {
        const nextOrder = assignments.length ? Math.max(...assignments.map(a => a.sort_order)) + 1 : 0;
        await dbWrite(sb.from('assignments').insert({ status: 'not_started', sort_order: nextOrder, created_by: profile.id }));
        const { data } = await sb.from('assignments').select('*').order('sort_order');
        assignments = data || [];
        refreshAssignmentsBody();
      });
    }

    bindAssignmentRowEvents();
  }
  else if (id === 'users'){
    document.getElementById('btnAddEmployee').addEventListener('click', async () => {
      const tempEmail = `new-${Date.now().toString(36)}${Math.floor(Math.random()*1000)}@example.invalid`;
      await dbWrite(sb.from('employees').insert({ full_name: 'Новый сотрудник', email: tempEmail, role: 'engineer', created_by: profile.id }));
      const { data } = await sb.from('employees').select('*').order('full_name');
      employees = data || [];
      renderTab(activeTab);
    });

    document.querySelectorAll('.eName, .eEmail').forEach(el => el.addEventListener('change', async () => {
      const id2 = el.dataset.id;
      const full_name = document.querySelector(`.eName[data-id="${id2}"]`).value.trim();
      const email = document.querySelector(`.eEmail[data-id="${id2}"]`).value.trim().toLowerCase();
      if (!full_name || !email) return alert('Заполните и имя, и email.');
      await dbWrite(sb.from('employees').update({ full_name, email }).eq('id', id2));
      const e = employees.find(x => x.id === id2);
      if (e){ e.full_name = full_name; e.email = email; }
      renderTab(activeTab);
    }));

    document.querySelectorAll('.eRole').forEach(el => el.addEventListener('change', async () => {
      const id2 = el.dataset.id;
      const role = el.value;
      await dbWrite(sb.from('employees').update({ role }).eq('id', id2));
      const e = employees.find(x => x.id === id2);
      if (e) e.role = role;
      // если сотрудник уже зарегистрирован — применяем роль сразу же (RLS смотрит на profiles.role)
      const p = e ? allProfiles.find(x => (x.email||'').toLowerCase() === (e.email||'').toLowerCase()) : null;
      if (p){
        await dbWrite(sb.from('profiles').update({ role }).eq('id', p.id));
        p.role = role;
      }
    }));

    document.querySelectorAll('.btn-del-employee').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Удалить сотрудника? Он перестанет быть указан исполнителем во всех разделах (сами разделы не удаляются).')) return;
      await dbWrite(sb.from('employees').delete().eq('id', b.dataset.id));
      employees = employees.filter(x => x.id !== b.dataset.id);
      disciplineAssignees.forEach(a => { if (a.employee_id === b.dataset.id) a.employee_id = null; });
      renderTab(activeTab);
    }));
  }
}

init();
