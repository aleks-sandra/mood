/* Настроение — daily mood log. Supabase sync + local cache. */
(() => {
'use strict';

const SUPA_URL = 'https://gbsscmtemzdelecierpj.supabase.co';
const SUPA_KEY = 'sb_publishable_lfxkLoQjz_pix7gTNSj2Yw_iaQ_8xAf';
const TABLE = 'mood_entries';
const BUCKET = 'photos';

const MOOD_NAMES = ['', 'отлично', 'хорошо', 'нормально', 'плохо', 'ужасно'];
const MOOD_VARS = ['', 'var(--m1)', 'var(--m2)', 'var(--m3)', 'var(--m4)', 'var(--m5)'];
const THEMES = { ghosts: 'Призраки', cats: 'Котики' };
const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const MONTHS_N = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const DOWS = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayIso = () => iso(new Date());
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();

// ---------- state ----------
let entries = {};          // day -> {mood, note, photo_url, updated_at}
let pending = {};          // day -> entry awaiting upload
let sel = todayIso();      // selected day on Today
let monthCur = fromIso(sel); monthCur.setDate(1);
let yearCur = monthCur.getFullYear();
let theme = 'ghosts';
let tab = 'today';
let supa = null, session = null;

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
entries = store.get('entries', {});
pending = store.get('pending', {});
theme = store.get('theme', 'ghosts');
if (!THEMES[theme]) theme = 'ghosts';

// ---------- icons ----------
const ICONS = window.MOOD_ICONS || { ghosts: [], twemoji: [], cats: [] };
const faceHtml = (mood, th = theme) => (ICONS[th] && ICONS[th][mood - 1]) || '';

// ---------- rendering ----------
function renderAll() { renderToday(); renderMonth(); renderYear(); renderNav(); }

function renderToday() {
  const d = fromIso(sel), e = entries[sel] || {};
  $('dowLabel').textContent = DOWS[d.getDay()];
  $('dateLabel').textContent = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  $('datePick').value = sel;
  $('nextDay').disabled = sel >= todayIso();
  $('askTitle').textContent = sel === todayIso() ? 'Как прошёл день?' : 'Как прошёл тот день?';

  const f = $('faces'); f.innerHTML = '';
  for (let m = 1; m <= 5; m++) {
    const b = document.createElement('button');
    b.className = 'face-btn' + (e.mood === m ? ' on' : '');
    b.setAttribute('aria-label', MOOD_NAMES[m] + (e.mood === m ? ' (выбрано)' : ''));
    b.innerHTML = `<span class="face">${faceHtml(m)}</span><span>${MOOD_NAMES[m]}</span>`;
    b.addEventListener('click', () => setMood(sel, m));
    f.appendChild(b);
  }
  const note = e.note || '';
  $('noteChip').classList.toggle('has', !!note);
  $('noteChip').querySelector('span').textContent = note ? 'Заметка ✓' : 'Заметка';
  if ($('noteText').value !== note && document.activeElement !== $('noteText')) $('noteText').value = note;
  $('noteBox').hidden = !note && $('noteBox').hidden;

  const pb = $('photoBox');
  if (e.photo_url) {
    $('photoChip').classList.add('has'); $('photoChip').querySelector('span').textContent = 'Фото ✓';
    pb.hidden = false;
    pb.innerHTML = `<span class="photo-wrap"><img src="${e.photo_url}" alt="Фото дня"><button class="remove" aria-label="Убрать фото">×</button></span>`;
    pb.querySelector('.remove').addEventListener('click', () => save(sel, { photo_url: null }));
  } else {
    $('photoChip').classList.remove('has'); $('photoChip').querySelector('span').textContent = 'Фото';
    pb.hidden = true; pb.innerHTML = '';
  }
  renderStreak();
}

function renderStreak() {
  let n = 0; const d = new Date();
  if (!entries[iso(d)]?.mood) d.setDate(d.getDate() - 1);
  while (entries[iso(d)]?.mood) { n++; d.setDate(d.getDate() - 1); }
  const t = new Date(), y = t.getFullYear(), m = t.getMonth();
  let logged = 0; for (let i = 1; i <= t.getDate(); i++) if (entries[`${y}-${pad(m + 1)}-${pad(i)}`]?.mood) logged++;
  const pct = Math.round(100 * logged / t.getDate());
  $('streak').textContent = n ? `${n} ${plural(n, 'день', 'дня', 'дней')} подряд · ${MONTHS_N[m].toLowerCase()} заполнен на ${pct}%` : `${MONTHS_N[m]} заполнен на ${pct}%`;
}
const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; if (m10 === 1 && m100 !== 11) return a; if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return b; return c; };

function renderMonth() {
  const y = monthCur.getFullYear(), m = monthCur.getMonth();
  $('monthTitle').textContent = `${MONTHS_N[m]} ${y}`;
  const t = new Date(); $('nextMonth').disabled = y > t.getFullYear() || (y === t.getFullYear() && m >= t.getMonth());
  const counts = [0, 0, 0, 0, 0, 0];
  const g = $('monthGrid'); g.innerHTML = '';
  const first = (new Date(y, m, 1).getDay() + 6) % 7;
  for (let i = 0; i < first; i++) { const c = document.createElement('div'); c.className = 'cell'; g.appendChild(c); }
  const td = todayIso();
  for (let d = 1; d <= daysIn(y, m); d++) {
    const key = `${y}-${pad(m + 1)}-${pad(d)}`, e = entries[key] || {};
    if (e.mood) counts[e.mood]++;
    const c = document.createElement('div'); c.className = 'cell' + (key === td ? ' today' : '');
    const b = document.createElement('button');
    const future = key > td;
    b.className = 'day-btn' + (e.mood ? '' : future ? ' future' : ' empty');
    b.setAttribute('aria-label', `${d} ${MONTHS[m]} — ${e.mood ? MOOD_NAMES[e.mood] : 'без записи'}`);
    if (e.mood) b.innerHTML = `<span class="face">${faceHtml(e.mood)}</span>`;
    const extra = (e.note ? 1 : 0) + (e.photo_url ? 1 : 0);
    if (extra) b.insertAdjacentHTML('beforeend', `<span class="badge">${extra}</span>`);
    if (future) b.disabled = true; else b.addEventListener('click', () => { sel = key; showTab('today'); });
    c.appendChild(b);
    const n = document.createElement('span'); n.className = 'd'; n.textContent = d; c.appendChild(n);
    g.appendChild(c);
  }
  $('monthCounts').innerHTML = [1, 2, 3, 4, 5].map(i => `<span><i style="background:${MOOD_VARS[i]}"></i>${counts[i]}</span>`).join('');
}

function renderYear() {
  $('yearTitle').textContent = `${yearCur} в пикселях`;
  $('nextYear').disabled = yearCur >= new Date().getFullYear();
  const counts = [0, 0, 0, 0, 0, 0]; let total = 0;
  const rows = $('yearRows'); rows.innerHTML = '';
  for (let d = 1; d <= 31; d++) {
    const r = document.createElement('div'); r.className = 'row';
    r.innerHTML = `<span class="rl">${d}</span>`;
    for (let m = 0; m < 12; m++) {
      const b = document.createElement('b');
      const exists = d <= daysIn(yearCur, m);
      const e = exists ? entries[`${yearCur}-${pad(m + 1)}-${pad(d)}`] : null;
      if (e?.mood) { counts[e.mood]++; total++; }
      b.innerHTML = `<span class="px ${exists ? (e?.mood ? 'm' + e.mood : '') : 'none'}" title="${d}.${pad(m + 1)}"></span>`;
      r.appendChild(b);
    }
    rows.appendChild(r);
  }
  $('yearSub').textContent = `${total} ${plural(total, 'день', 'дня', 'дней')} записано`;
  $('yearLegend').innerHTML = [1, 2, 3, 4, 5].map(i => `<div><b>${counts[i]}</b><span class="face" role="img" aria-label="${MOOD_NAMES[i]}">${faceHtml(i)}</span></div>`).join('');
}

function renderNav() {
  document.querySelectorAll('nav [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const e = entries[todayIso()];
  $('navFace').innerHTML = faceHtml(e?.mood || 2);
  $('navFace').style.opacity = e?.mood ? 1 : .45;
}

function showTab(t) {
  tab = t;
  ['today', 'month', 'year'].forEach(id => { $(id).hidden = id !== t; });
  if (t === 'today') renderToday();
  renderNav();
}

function toast(text, ms = 1600) {
  $('toastText').textContent = text; const el = $('toast'); el.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------- data ----------
function setMood(day, mood) { save(day, { mood }); toast('Сохранено'); }

function save(day, patch) {
  const cur = entries[day] || {};
  const next = { ...cur, ...patch, updated_at: new Date().toISOString() };
  if (!next.mood) { delete entries[day]; } else entries[day] = next;
  store.set('entries', entries);
  renderAll();
  push(day, next);
}

async function push(day, row) {
  pending[day] = row; store.set('pending', pending);
  await flush();
}

let flushing = false;
async function flush() {
  if (flushing || !supa || !session || !navigator.onLine) return;
  flushing = true;
  try {
    for (const day of Object.keys(pending)) {
      const r = pending[day];
      const { error } = r.mood
        ? await supa.from(TABLE).upsert({ day, mood: r.mood, note: r.note || null, photo_url: r.photo_url || null, updated_at: r.updated_at })
        : await supa.from(TABLE).delete().eq('day', day);
      if (error) { console.warn('sync', error); setSync('Не удалось отправить: ' + error.message, true); break; }
      delete pending[day]; store.set('pending', pending);
    }
    if (!Object.keys(pending).length) setSync('Всё синхронизировано ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
  } finally { flushing = false; }
}

async function pull() {
  if (!supa || !session) return;
  setSync('Загружаю…');
  let from = 0, all = [];
  while (true) {
    const { data, error } = await supa.from(TABLE).select('day,mood,note,photo_url,updated_at').order('day').range(from, from + 999);
    if (error) { setSync('Ошибка загрузки: ' + error.message, true); return; }
    all = all.concat(data); if (data.length < 1000) break; from += 1000;
  }
  for (const r of all) {
    const local = entries[r.day];
    if (pending[r.day]) continue;                    // local change not yet sent wins
    if (!local || (r.updated_at || '') >= (local.updated_at || '')) entries[r.day] = { mood: r.mood, note: r.note, photo_url: r.photo_url, updated_at: r.updated_at };
  }
  store.set('entries', entries);
  renderAll();
  setSync(`${all.length} записей · обновлено ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`);
  await flush();
}

function setSync(t, err) { const s = $('syncStatus'); s.textContent = t; s.classList.toggle('err', !!err); }

async function uploadPhoto(file) {
  if (!supa || !session) { toast('Войди, чтобы сохранять фото'); return; }
  toast('Загружаю фото…', 4000);
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${session.user.id}/${sel}.${ext}`;
  const { error } = await supa.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type });
  if (error) { toast('Не удалось: ' + error.message, 3000); return; }
  const { data } = supa.storage.from(BUCKET).getPublicUrl(path);
  save(sel, { photo_url: data.publicUrl + '?v=' + Date.now(), mood: entries[sel]?.mood || 3 });
  toast('Фото добавлено');
}

// ---------- auth ----------
async function initSupabase() {
  if (!window.supabase) return;
  supa = window.supabase.createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  const { data } = await supa.auth.getSession();
  session = data.session; renderAuth();
  supa.auth.onAuthStateChange((_e, s) => { session = s; renderAuth(); if (s) pull(); });
  if (session) pull();
}
function renderAuth() {
  $('authOut').hidden = !!session; $('authIn').hidden = !session;
  if (session) $('whoami').textContent = 'Вошла как ' + session.user.email;
}
async function signIn(create) {
  const email = $('email').value.trim(), password = $('password').value;
  if (!email || password.length < 6) { $('authStatus').textContent = 'Нужны почта и пароль от 6 символов'; return; }
  $('authStatus').textContent = create ? 'Создаю аккаунт…' : 'Вхожу…';
  const { error } = create
    ? await supa.auth.signUp({ email, password })
    : await supa.auth.signInWithPassword({ email, password });
  if (error) { $('authStatus').textContent = 'Не получилось: ' + error.message; return; }
  $('authStatus').textContent = ''; $('password').value = '';
}

// ---------- wiring ----------
function shiftDay(n) { const d = fromIso(sel); d.setDate(d.getDate() + n); const k = iso(d); if (k <= todayIso()) { sel = k; renderToday(); } }
$('prevDay').addEventListener('click', () => shiftDay(-1));
$('nextDay').addEventListener('click', () => shiftDay(1));
$('datePick').max = todayIso();
$('datePick').addEventListener('change', (e) => { if (e.target.value && e.target.value <= todayIso()) { sel = e.target.value; renderToday(); } });
$('prevMonth').addEventListener('click', () => { monthCur.setMonth(monthCur.getMonth() - 1); renderMonth(); });
$('nextMonth').addEventListener('click', () => { monthCur.setMonth(monthCur.getMonth() + 1); renderMonth(); });
$('prevYear').addEventListener('click', () => { yearCur--; renderYear(); });
$('nextYear').addEventListener('click', () => { yearCur++; renderYear(); });
document.querySelectorAll('nav [data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

$('noteChip').addEventListener('click', () => { const box = $('noteBox'); box.hidden = !box.hidden; if (!box.hidden) $('noteText').focus(); });
let noteTimer;
$('noteText').addEventListener('input', () => {
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    const v = $('noteText').value.trim();
    if ((entries[sel]?.note || '') !== v) save(sel, { note: v || null, mood: entries[sel]?.mood || 3 });
  }, 700);
});
$('noteText').addEventListener('blur', () => { clearTimeout(noteTimer); const v = $('noteText').value.trim(); if ((entries[sel]?.note || '') !== v) { save(sel, { note: v || null, mood: entries[sel]?.mood || 3 }); toast('Заметка сохранена'); } });
$('photoChip').addEventListener('click', () => $('photoInput').click());
$('photoInput').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) uploadPhoto(f); e.target.value = ''; });

$('openSettings').addEventListener('click', () => { renderThemes(); $('sheetBg').hidden = false; });
$('closeSheet').addEventListener('click', () => { $('sheetBg').hidden = true; });
$('sheetBg').addEventListener('click', (e) => { if (e.target === $('sheetBg')) $('sheetBg').hidden = true; });
$('signIn').addEventListener('click', () => signIn(false));
$('signUp').addEventListener('click', () => signIn(true));
$('password').addEventListener('keydown', (e) => { if (e.key === 'Enter') signIn(false); });
$('logout').addEventListener('click', async () => { await supa.auth.signOut(); });
$('syncNow').addEventListener('click', pull);
$('siriUrl').textContent = location.origin + location.pathname + '?mood=1';

function renderThemes() {
  const t = $('themes'); t.innerHTML = '';
  for (const k of Object.keys(THEMES)) {
    const b = document.createElement('button'); b.className = 'theme-opt' + (k === theme ? ' on' : '');
    b.innerHTML = `<span class="row3">${[1, 3, 5].map(m => `<span class="face">${faceHtml(m, k)}</span>`).join('')}</span><span>${THEMES[k]}</span>`;
    b.addEventListener('click', () => { theme = k; store.set('theme', k); renderThemes(); renderAll(); });
    t.appendChild(b);
  }
}

window.addEventListener('online', flush);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (sel !== todayIso() && tab === 'today') {} renderNav(); flush(); } });

// deep link: ?mood=1..5 [&date=YYYY-MM-DD]
(function deepLink() {
  const q = new URLSearchParams(location.search);
  const m = Number(q.get('mood'));
  if (m >= 1 && m <= 5) {
    const d = q.get('date'); if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= todayIso()) sel = d;
    setMood(sel, m);
    history.replaceState(null, '', location.pathname);
  }
})();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
renderAll();
initSupabase();
})();
