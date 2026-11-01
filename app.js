/* Aeneis — lector con recitación latina (LibriVox, lectura de Malone, dominio público) */
'use strict';

const AUDIO_BASE = 'https://archive.org/download/aeneidis_libri_xii_dm_librivox/';
// Duración (s) de cada parte según el catálogo LibriVox: [pars prima, pars secunda]
const DUR = [[2587,2126],[2690,2128],[2151,2123],[2333,1883],[2588,2171],[2778,2378],
             [2631,1872],[1973,1970],[2119,2165],[2408,2472],[2449,2343],[2530,2444]];
const ROMAN = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
const ORD = ['Primus','Secundus','Tertius','Quartus','Quintus','Sextus','Septimus','Octavus','Nonus','Decimus','Undecimus','Duodecimus'];
const ARG = [
  'Juno desata una tempestad; los troyanos naufragan en África y la reina Dido los acoge en Cartago.',
  'Eneas narra la caída de Troya: el caballo de madera, Laocoonte, la noche del saqueo y la huida con Anquises.',
  'Los viajes por el Mediterráneo: Tracia, Delos, Creta, las Harpías, Andrómaca, el Cíclope; muere Anquises.',
  'El amor de Dido y Eneas; Mercurio le ordena partir hacia Italia y Dido se da muerte.',
  'Juegos fúnebres en Sicilia en honor de Anquises; arden las naves; el piloto Palinuro cae al mar.',
  'Guiado por la Sibila de Cumas, Eneas desciende al Inframundo y contempla el futuro de Roma.',
  'Llegada al Lacio y alianza con el rey Latino; Juno envía a la furia Alecto y estalla la guerra.',
  'Eneas pide ayuda a Evandro en el lugar de la futura Roma; Vulcano forja su escudo.',
  'Turno asalta el campamento troyano; la expedición nocturna de Niso y Euríalo.',
  'Concilio de los dioses; Turno mata a Palante; Eneas da muerte a Lauso y a Mecencio.',
  'Funerales de Palante; tregua y debate entre los latinos; cae la guerrera Camila.',
  'El duelo final entre Eneas y Turno.'
];
const INTRO = 22, OUTRO = 8;      // s aprox. de anuncio LibriVox al inicio/fin de cada archivo
const AUDIO_CACHE = 'aen-audio-v1';
const RATES = [0.75, 1, 1.25, 1.5];

const $ = s => document.querySelector(s);
const audio = $('#audio');
let TEXT = null;                  // [{title, paras:[[...]], nums:[...]}]
let cur = { b: 0, part: 0 };      // libro y parte cargados en el reproductor
let flat = [];                    // elementos .v del libro abierto
let nowIdx = -1, lastUserScroll = 0, menuIdx = -1, objURL = null, wakeLock = null;
let pendingSeek = null, loadedKey = '';

// ---------- preferencias ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('aen.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('aen.' + k, JSON.stringify(v)); } catch {} }
};
const prefs = Object.assign({ fs: 21, night: false, follow: true, rate: 1 }, store.get('prefs', {}));
const savePrefs = () => store.set('prefs', prefs);
function applyPrefs() {
  document.documentElement.style.setProperty('--fs', prefs.fs + 'px');
  document.body.classList.toggle('night', prefs.night);
  $('#followBtn').setAttribute('aria-pressed', prefs.follow);
  $('#rateBtn').textContent = String(prefs.rate).replace('.', ',') + '×';
  audio.playbackRate = prefs.rate;
}

// ---------- utilidades ----------
const fileName = (b, p) => `aeneidis_${String(b * 2 + p + 1).padStart(2, '0')}_maro_64kb.mp3`;
const audioURL = (b, p) => AUDIO_BASE + fileName(b, p);
const fmt = s => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const nLines = b => TEXT[b].nums.length;
const durOf = (b, p) => (cur.b === b && cur.part === p && isFinite(audio.duration) && audio.duration > 0) ? audio.duration : DUR[b][p];
const bookDur = b => durOf(b, 0) + durOf(b, 1);
const status = t => { $('#status').textContent = t || ''; };

// ---------- sincronía aproximada verso <-> tiempo ----------
// Puntos de anclaje [tiempoGlobalDelLibro, índiceDeVerso]; interpolación lineal entre ellos.
function defaultAnchors(b) {
  const d1 = DUR[b][0], d2 = DUR[b][1], N = nLines(b);
  const s1 = d1 - INTRO - OUTRO, s2 = d2 - INTRO - OUTRO;
  const k = Math.round(N * s1 / (s1 + s2));
  return [[INTRO, 0], [d1 - OUTRO, k - 0.01], [d1 + INTRO, k], [d1 + d2 - OUTRO, N - 0.01]];
}
const anchorsOf = b => (store.get('anchors', {})[b]) || defaultAnchors(b);
function addAnchor(b, g, idx) {
  let a = anchorsOf(b).filter(([t, i]) => !((t <= g && i >= idx) || (t >= g && i <= idx)));
  a.push([g, idx]); a.sort((x, y) => x[0] - y[0]);
  const all = store.get('anchors', {}); all[b] = a; store.set('anchors', all);
}
function timeToLine(b, g) {
  const a = anchorsOf(b);
  if (g <= a[0][0]) return 0;
  for (let j = 1; j < a.length; j++) {
    if (g <= a[j][0]) { const [t0, i0] = a[j - 1], [t1, i1] = a[j]; return i0 + (i1 - i0) * (g - t0) / (t1 - t0 || 1); }
  }
  return Math.min(nLines(b) - 1, a[a.length - 1][1]);
}
function lineToTime(b, idx) {
  const a = anchorsOf(b);
  if (idx <= a[0][1]) return Math.max(0, a[0][0] - 1);
  for (let j = 1; j < a.length; j++) {
    const [t0, i0] = a[j - 1], [t1, i1] = a[j];
    if (idx <= i1 && i1 > i0) return t0 + (t1 - t0) * (idx - i0) / (i1 - i0);
  }
  return a[a.length - 1][0];
}
const globalNow = () => (cur.part ? durOf(cur.b, 0) : 0) + (audio.currentTime || 0);

// ---------- pantallas ----------
function show(id, push = true) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  if (push) history.pushState({ s: id }, '', '#' + id);
  if (id === 'index') renderIndex();
  if (id === 'cover') renderResume();
}
window.addEventListener('popstate', e => show((e.state && e.state.s) || 'cover', false));

// ---------- portada ----------
function medallion() {
  const leaves = [];
  for (let side of [-1, 1]) for (let k = 0; k < 9; k++) {
    const ang = (110 + k * 17) * side * Math.PI / 180, r = 71;
    const x = 100 + r * Math.sin(ang), y = 100 + r * Math.cos(ang) ;
    const rot = (-ang * 180 / Math.PI) + (side > 0 ? -35 : 35);
    leaves.push(`<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="3.2" ry="7.5" transform="rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`);
  }
  $('#medallion').innerHTML = `
  <svg viewBox="0 0 200 200" role="img">
    <defs>
      <radialGradient id="gold" cx=".38" cy=".3"><stop offset="0" stop-color="#fff3b0"/><stop offset=".5" stop-color="#d4a53a"/><stop offset="1" stop-color="#7a520f"/></radialGradient>
      <radialGradient id="sky" cx=".5" cy=".35"><stop offset="0" stop-color="#3567ad"/><stop offset="1" stop-color="#0f2a55"/></radialGradient>
      <path id="ring" d="M100,100 m-89,0 a89,89 0 1,1 178,0 a89,89 0 1,1 -178,0"/>
      <clipPath id="disc"><circle cx="100" cy="100" r="78"/></clipPath>
    </defs>
    <circle cx="100" cy="100" r="98" fill="url(#gold)" stroke="#5e3f0c" stroke-width="1.5"/>
    <circle cx="100" cy="100" r="80" fill="#5e3f0c"/>
    <text font-family="Cinzel,serif" font-weight="700" font-size="10.5" letter-spacing="2.4" fill="#4a300a">
      <textPath href="#ring" startOffset="0">ARMA · VIRVMQVE · CANO · TROIAE · QVI · PRIMVS · AB · ORIS ·</textPath>
    </text>
    <g clip-path="url(#disc)">
      <circle cx="100" cy="100" r="78" fill="url(#sky)"/>
      <g fill="#f6e08a">
        <circle cx="62" cy="58" r="1.6"/><circle cx="140" cy="52" r="1.3"/><circle cx="118" cy="38" r="1.1"/>
        <circle cx="80" cy="40" r="1"/><circle cx="152" cy="80" r="1.2"/><circle cx="46" cy="86" r="1"/>
        <path d="M132 64 a10 10 0 1 0 6 -14 a8 8 0 1 1 -6 14z"/>
      </g>
      <!-- nave -->
      <g stroke="#3a220c" stroke-width="1.2" stroke-linejoin="round">
        <line x1="100" y1="58" x2="100" y2="124" stroke="#6b4a1e" stroke-width="2.4"/>
        <line x1="78" y1="68" x2="122" y2="68" stroke="#6b4a1e" stroke-width="2"/>
        <path d="M80 69 Q100 74 120 69 Q124 92 118 110 Q100 104 82 110 Q76 92 80 69z" fill="#b8382b"/>
        <path d="M86 78 Q100 82 114 78 M85 90 Q100 94 115 90" fill="none" stroke="#f6e08a" stroke-width="1.2"/>
        <path d="M100 58 l9 -5 l-9 -3z" fill="#f6e08a"/>
        <path d="M52 124 Q60 138 100 138 Q140 138 150 122 L156 116 L148 124 Q130 128 100 128 Q66 128 52 124z" fill="#7a4a20"/>
        <path d="M52 124 Q46 118 44 110 Q50 116 56 118" fill="#7a4a20"/>
        <path d="M60 129 L148 125" stroke="#f6e08a" stroke-width="1.4"/>
        <g stroke="#e8d6a8" stroke-width="1.1"><line x1="70" y1="134" x2="62" y2="150"/><line x1="84" y1="136" x2="78" y2="152"/><line x1="98" y1="137" x2="94" y2="153"/><line x1="112" y1="137" x2="110" y2="153"/><line x1="126" y1="135" x2="126" y2="151"/></g>
      </g>
      <!-- mar -->
      <path d="M0 146 q12 -8 25 0 t25 0 t25 0 t25 0 t25 0 t25 0 t25 0 t25 0 V200 H0z" fill="#1e5d6e"/>
      <path d="M0 158 q12 -8 25 0 t25 0 t25 0 t25 0 t25 0 t25 0 t25 0 t25 0 V200 H0z" fill="#174a59"/>
      <path d="M0 146 q12 -8 25 0 t25 0 t25 0 t25 0 t25 0 t25 0 t25 0 t25 0" fill="none" stroke="#e8f0e6" stroke-width="1.2"/>
      <path d="M0 158 q12 -8 25 0 t25 0 t25 0 t25 0 t25 0 t25 0 t25 0 t25 0" fill="none" stroke="#a8c8c4" stroke-width="1"/>
      <g fill="#3f7a3a" stroke="#c9e0a0" stroke-width=".5" opacity=".95">${leaves.join('')}</g>
    </g>
    <circle cx="100" cy="100" r="78" fill="none" stroke="#f6e08a" stroke-width="1.5"/>
  </svg>`;
}

function renderResume() {
  const pos = store.get('pos', null), el = $('#coverResume');
  if (!pos || !TEXT) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `Ibas en el Liber ${ROMAN[pos.b]}, verso ${TEXT[pos.b].nums[pos.line || 0] || 1}. <button type="button" id="resumeBtn">Continuar</button>`;
  $('#resumeBtn').onclick = () => openBook(pos.b, { resume: true });
}

$('#openBook').onclick = () => {
  const leaf = document.querySelector('.cover-leaf');
  leaf.classList.add('turn');
  setTimeout(() => { show('index'); leaf.classList.remove('turn'); }, 900);
};
$('#toCover').onclick = () => show('cover');
$('#toIndex').onclick = () => { closeMenu(); show('index'); };

// ---------- índice ----------
async function cachedParts(b) {
  try { const c = await caches.open(AUDIO_CACHE);
    return [!!(await c.match(audioURL(b, 0))), !!(await c.match(audioURL(b, 1)))]; } catch { return [false, false]; }
}
async function renderIndex() {
  if (!TEXT) return;
  const pos = store.get('pos', null), ol = $('#bookList');
  ol.innerHTML = '';
  for (let b = 0; b < 12; b++) {
    const li = document.createElement('li');
    const mins = Math.round((DUR[b][0] + DUR[b][1]) / 60);
    li.innerHTML = `<button class="book" type="button">
      <span class="num${ROMAN[b].length > 3 ? ' long' : ''}">${ROMAN[b]}</span>
      <span class="txt"><div class="lt">LIBER ${ORD[b].toUpperCase()}</div>
      <div class="arg">${ARG[b]}</div>
      <div class="meta"><span>${TEXT[b].nums[nLines(b) - 1]} versos</span><span>${Math.floor(mins / 60)} h ${mins % 60} min</span>
      ${pos && pos.b === b ? `<span>· vas en el verso ${TEXT[b].nums[pos.line || 0]}</span>` : ''}<span class="saved" data-b="${b}"></span></div></span>
    </button>`;
    li.firstElementChild.onclick = () => openBook(b, { resume: pos && pos.b === b });
    ol.appendChild(li);
  }
  for (let b = 0; b < 12; b++) {
    const [a, c] = await cachedParts(b);
    if (a && c) { const s = ol.querySelector(`.saved[data-b="${b}"]`); if (s) s.textContent = '✓ audio sin conexión'; }
  }
  try { if (navigator.storage && navigator.storage.estimate) {
    const e = await navigator.storage.estimate();
    $('#storageInfo').textContent = `Espacio usado en este dispositivo: ${(e.usage / 1048576).toFixed(0)} MB. Cada libro guardado ocupa unos 36 MB.`;
  } } catch {}
}

// ---------- lector ----------
function renderBook(b) {
  const bk = TEXT[b];
  let i = 0, html = `<div class="book-head"><div class="k">P · VERGILI · MARONIS · AENEIDOS</div>
    <h2>Liber ${ORD[b]}</h2><div class="orn">❦ ❦ ❦</div></div><div class="verses">`;
  for (const p of bk.paras) {
    html += '<p class="para">';
    for (const line of p) {
      const n = bk.nums[i];
      const t = i === 0 ? `<span class="ini" aria-hidden="true">${esc(line[0])}</span><span class="sr">${esc(line[0])}</span>${esc(line.slice(1))}` : esc(line);
      html += `<span class="v${i < 2 ? ' ind' : ''}" data-i="${i}"><span class="n">${(n % 5 === 0 || i === 0) ? n : ''}</span><span class="t">${t}</span></span>`;
      i++;
    }
    html += '</p>';
  }
  html += `</div><p class="explicit">EXPLICIT · LIBER · ${ORD[b].toUpperCase()}</p>`;
  if (b < 11) html += `<button class="next-book" type="button" id="nextBook">Liber ${ORD[b + 1]} →</button>`;
  $('#textLeaf').innerHTML = html;
  flat = Array.from(document.querySelectorAll('#textLeaf .v'));
  nowIdx = -1;
  $('#readerTitle').textContent = `AENEIDOS · LIBER ${ROMAN[b]}`;
  const nb = $('#nextBook'); if (nb) nb.onclick = () => openBook(b + 1, {});
}
const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function openBook(b, { resume = false, autoplay = false, line = null } = {}) {
  const pos = store.get('pos', null);
  if (cur.b !== b || !flat.length) renderBook(b);
  show('reader');
  let part = 0, t = 0;
  if (resume && pos && pos.b === b) { part = pos.part || 0; t = pos.t || 0; line = pos.line; }
  if (line != null && !(resume && pos && pos.t)) { const g = lineToTime(b, line); part = g >= DUR[b][0] ? 1 : 0; t = part ? g - DUR[b][0] : g; }
  load(b, part, t, autoplay);
  const target = line != null ? line : Math.floor(timeToLine(b, (part ? DUR[b][0] : 0) + t));
  setNow(target, true, true);
  updateDlBtn();
}

$('#scroller').addEventListener('click', e => {
  const v = e.target.closest('.v'); if (!v) return;
  openMenu(+v.dataset.i);
});
['touchstart', 'wheel', 'pointerdown'].forEach(ev =>
  $('#scroller').addEventListener(ev, () => { lastUserScroll = Date.now(); }, { passive: true }));

function setNow(idx, scroll, force) {
  idx = Math.max(0, Math.min(flat.length - 1, idx));
  if (idx !== nowIdx) {
    if (flat[nowIdx]) flat[nowIdx].classList.remove('now');
    nowIdx = idx;
    if (flat[idx]) flat[idx].classList.add('now');
  }
  if (scroll && flat[idx] && (force || (prefs.follow && Date.now() - lastUserScroll > 6000))) {
    const sc = $('#scroller'), el = flat[idx];
    const y = el.offsetTop + el.closest('.leaf').offsetTop - sc.clientHeight * 0.36;
    sc.scrollTo({ top: Math.max(0, y), behavior: force ? 'auto' : 'smooth' });
  }
}

// ---------- menú de verso ----------
function openMenu(i) {
  closeMenu();
  menuIdx = i; flat[i].classList.add('sel');
  $('#vmNum').textContent = `Liber ${ROMAN[cur.b]} · versus ${TEXT[cur.b].nums[i]}`;
  $('#vmSync').hidden = !(audio.currentTime > 0);
  const m = $('#verseMenu'), r = flat[i].getBoundingClientRect();
  m.classList.toggle('top', r.top > innerHeight * 0.45);
  m.hidden = false;
}
function closeMenu() {
  if (flat[menuIdx]) flat[menuIdx].classList.remove('sel');
  menuIdx = -1; $('#verseMenu').hidden = true;
}
$('#vmClose').onclick = closeMenu;
$('#vmPlay').onclick = () => {
  const i = menuIdx; closeMenu();
  seekGlobal(lineToTime(cur.b, i), true);
  setNow(i, true, true);
};
$('#vmSync').onclick = () => {
  const i = menuIdx; closeMenu();
  addAnchor(cur.b, globalNow(), i);
  setNow(i, false);
  status('Sincronía ajustada: el resaltado seguirá desde este verso.');
};
$('#vmTts').onclick = () => {
  const i = menuIdx; closeMenu();
  if (!('speechSynthesis' in window)) { status('Este dispositivo no tiene voz sintética.'); return; }
  const u = new SpeechSynthesisUtterance(flat[i].querySelector('.t').textContent);
  const vs = speechSynthesis.getVoices();
  const v = vs.find(x => /^la/i.test(x.lang)) || vs.find(x => /^it/i.test(x.lang)) || vs.find(x => /^es/i.test(x.lang));
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'it-IT';
  u.rate = 0.85;
  audio.pause(); speechSynthesis.cancel(); speechSynthesis.speak(u);
  status(v ? `Voz sintética: ${v.name} (pronunciación aproximada)` : 'Voz sintética');
};
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

// ---------- audio ----------
async function srcFor(b, p) {
  try {
    const c = await caches.open(AUDIO_CACHE), r = await c.match(audioURL(b, p));
    if (r) { if (objURL) URL.revokeObjectURL(objURL); objURL = URL.createObjectURL(await r.blob()); return objURL; }
  } catch {}
  return audioURL(b, p);
}
async function load(b, p, t = 0, autoplay = false) {
  const key = b + ':' + p;
  cur = { b, part: p };
  $('#partLbl').textContent = p ? 'Pars II' : 'Pars I';
  if (key !== loadedKey) {
    loadedKey = key;
    pendingSeek = t;
    audio.src = await srcFor(b, p);
    audio.playbackRate = prefs.rate;
    audio.load();
    status(navigator.onLine ? '' : 'Sin conexión: solo se escuchan los libros guardados.');
  } else {
    audio.currentTime = t;
  }
  mediaMeta();
  if (autoplay) play();
  updateTime();
}
function seekGlobal(g, autoplay) {
  const d1 = durOf(cur.b, 0);
  const p = g >= d1 ? 1 : 0;
  load(cur.b, p, p ? g - d1 : g, autoplay || !audio.paused);
}
async function play() {
  if (window.speechSynthesis) speechSynthesis.cancel();
  try { await audio.play(); } catch (e) { if (e.name !== 'AbortError') status('No se pudo reproducir: ' + (navigator.onLine ? e.message : 'sin conexión y libro no guardado.')); }
}
audio.addEventListener('loadedmetadata', () => {
  if (pendingSeek != null) { try { audio.currentTime = pendingSeek; } catch {} pendingSeek = null; }
  audio.playbackRate = prefs.rate; updateTime();
});
audio.addEventListener('play', () => { $('#player').classList.add('playing'); $('#playBtn').setAttribute('aria-label', 'Pausa'); keepAwake(true); });
audio.addEventListener('pause', () => { $('#player').classList.remove('playing'); $('#playBtn').setAttribute('aria-label', 'Reproducir'); savePos(); keepAwake(false); });
audio.addEventListener('waiting', () => status('Cargando recitación…'));
audio.addEventListener('playing', () => status(''));
audio.addEventListener('error', () => { if (audio.src) status(navigator.onLine ? 'Error al cargar el audio.' : 'Sin conexión: guarda el libro para escucharlo sin internet.'); });
audio.addEventListener('ended', () => {
  if (cur.part === 0) load(cur.b, 1, 0, true);
  else if (cur.b < 11) openBook(cur.b + 1, { autoplay: true, line: 0 });
});
let lastSave = 0;
audio.addEventListener('timeupdate', () => {
  updateTime();
  if (!audio.paused) setNow(Math.floor(timeToLine(cur.b, globalNow())), true);
  if (Date.now() - lastSave > 5000) savePos();
});
function updateTime() {
  const g = globalNow(), D = bookDur(cur.b);
  $('#tCur').textContent = fmt(g); $('#tDur').textContent = fmt(D);
  if (!seeking) { const s = $('#seek'); s.value = Math.round(1000 * g / D); s.style.setProperty('--p', (100 * g / D) + '%'); }
}
function savePos() {
  lastSave = Date.now();
  if (!TEXT) return;
  store.set('pos', { b: cur.b, part: cur.part, t: audio.currentTime || 0, line: Math.max(0, nowIdx) });
}
document.addEventListener('visibilitychange', () => { if (document.hidden) savePos(); else if (!audio.paused) keepAwake(true); });

$('#playBtn').onclick = () => audio.paused ? play() : audio.pause();
$('#back15').onclick = () => seekGlobal(Math.max(0, globalNow() - 15));
$('#fwd15').onclick = () => seekGlobal(Math.min(bookDur(cur.b) - 1, globalNow() + 15));
let seeking = false;
$('#seek').addEventListener('input', e => {
  seeking = true; const g = e.target.value / 1000 * bookDur(cur.b);
  e.target.style.setProperty('--p', (e.target.value / 10) + '%');
  $('#tCur').textContent = fmt(g);
  setNow(Math.floor(timeToLine(cur.b, g)), true, true);
});
$('#seek').addEventListener('change', e => { seeking = false; seekGlobal(e.target.value / 1000 * bookDur(cur.b)); });
$('#followBtn').onclick = () => { prefs.follow = !prefs.follow; savePrefs(); applyPrefs(); if (prefs.follow) { lastUserScroll = 0; setNow(nowIdx, true); } };
$('#rateBtn').onclick = () => { prefs.rate = RATES[(RATES.indexOf(prefs.rate) + 1) % RATES.length]; savePrefs(); applyPrefs(); };
$('#fontMinus').onclick = () => { prefs.fs = Math.max(15, prefs.fs - 2); savePrefs(); applyPrefs(); setNow(nowIdx, true, true); };
$('#fontPlus').onclick = () => { prefs.fs = Math.min(36, prefs.fs + 2); savePrefs(); applyPrefs(); setNow(nowIdx, true, true); };
$('#nightBtn').onclick = () => { prefs.night = !prefs.night; savePrefs(); applyPrefs(); };

function mediaMeta() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: `Liber ${ORD[cur.b]} — Pars ${cur.part ? 'II' : 'I'}`, artist: 'P. Vergilius Maro', album: 'Aeneis',
    artwork: [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }]
  });
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', play);
  ms.setActionHandler('pause', () => audio.pause());
  ms.setActionHandler('seekbackward', () => $('#back15').click());
  ms.setActionHandler('seekforward', () => $('#fwd15').click());
  ms.setActionHandler('previoustrack', () => cur.part ? load(cur.b, 0, 0, true) : (cur.b > 0 && openBook(cur.b - 1, { autoplay: true, line: 0 })));
  ms.setActionHandler('nexttrack', () => cur.part ? (cur.b < 11 && openBook(cur.b + 1, { autoplay: true, line: 0 })) : load(cur.b, 1, 0, true));
}
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch {}
}

// ---------- guardar audio sin conexión ----------
let dlBusy = false, delArm = 0;
async function updateDlBtn() {
  const [a, c] = await cachedParts(cur.b), btn = $('#dlBtn');
  btn.classList.toggle('done', a && c);
  btn.textContent = (a && c) ? 'Guardado ✓' : 'Guardar';
}
$('#dlBtn').onclick = async () => {
  if (dlBusy) return;
  const b = cur.b, [a, c] = await cachedParts(b);
  if (a && c) {
    if (Date.now() - delArm < 4000) {
      const ca = await caches.open(AUDIO_CACHE);
      await ca.delete(audioURL(b, 0)); await ca.delete(audioURL(b, 1));
      status(`Audio del Liber ${ROMAN[b]} borrado del dispositivo.`); updateDlBtn(); return;
    }
    delArm = Date.now(); status('Toca de nuevo «Guardado ✓» para borrar el audio de este libro.'); return;
  }
  if (!navigator.onLine) { status('Necesitas conexión para guardar el audio.'); return; }
  dlBusy = true;
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    const ca = await caches.open(AUDIO_CACHE);
    for (let p = 0; p < 2; p++) {
      if (await ca.match(audioURL(b, p))) continue;
      const r = await fetch(audioURL(b, p));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const total = +r.headers.get('content-length') || 0, rd = r.body.getReader(), chunks = []; let got = 0;
      for (;;) {
        const { done, value } = await rd.read(); if (done) break;
        chunks.push(value); got += value.length;
        $('#dlBtn').textContent = total ? `${p ? 'II' : 'I'} ${Math.round(100 * got / total)}%` : `${(got / 1048576).toFixed(0)} MB`;
      }
      await ca.put(audioURL(b, p), new Response(new Blob(chunks, { type: 'audio/mpeg' }), { headers: { 'Content-Type': 'audio/mpeg' } }));
    }
    status(`Liber ${ROMAN[b]} guardado: se puede escuchar sin conexión.`);
  } catch (e) {
    status('No se pudo guardar el audio: ' + e.message);
  } finally { dlBusy = false; updateDlBtn(); }
};

// ---------- inicio ----------
async function init() {
  applyPrefs(); medallion();
  try { TEXT = await (await fetch('data/aeneis.json')).json(); }
  catch { status('No se pudo cargar el texto.'); return; }
  const pos = store.get('pos', null);
  if (pos) { cur = { b: pos.b, part: pos.part || 0 }; }
  renderResume();
  const h = location.hash.slice(1);
  history.replaceState({ s: 'cover' }, '', '#cover');
  if (h === 'index') show('index');
  if (h === 'reader' && pos) openBook(pos.b, { resume: true });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  window.addEventListener('online', () => status(''));
  window.addEventListener('offline', () => status('Sin conexión: solo se escuchan los libros guardados.'));
}
init();
