/* ---------------- settings ---------------- */
var PHOTO_URL = '/img/training-session.jpg';
var FALLBACK_COURSES = [{
  id: 'DMM', title: 'Digital Marketing & AI Bootcamp', subtitle: 'DMM & AI · 20-week professional programme',
  description: 'A practical, hands-on programme that takes you from the foundations of the digital ecosystem to paid campaigns, AI tools and a full marketing strategy.',
  image_url: '/img/training-session.jpg', duration: '20 weeks', format: 'In-person, hybrid or online', modules: 20,
  phases: [
    { phase: 1, title: 'Digital Foundations', weeks: 'Weeks 1–4', focus: 'Ecosystem, Analytics, SEO, Content Strategy' },
    { phase: 2, title: 'Core Channels & Paid Media', weeks: 'Weeks 5–10', focus: 'Social Media, Google Ads, Meta Ads, Display, Email' },
    { phase: 3, title: 'Advanced Performance & AI', weeks: 'Weeks 11–16', focus: 'Data Analysis, ROAS Optimization, AI Tools, Automation, E-commerce' },
    { phase: 4, title: 'Strategy & Leadership', weeks: 'Weeks 17–20', focus: 'Digital Strategy, Reporting, Personal Branding, Capstone Project' }
  ]
}];

/* ---------------- helpers ---------------- */
var app = document.getElementById('app');
var D = null, MY = null, CATALOG = null, SEL = null;
var OPEN = {}, OPENED_PPT = {};
try { OPEN = JSON.parse(sessionStorage.getItem('dmm_open') || '{}'); } catch (e) {}
function saveOpen() { try { sessionStorage.setItem('dmm_open', JSON.stringify(OPEN)); } catch (e) {} }
function cacheGet(k) { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch (e) { return null; } }
function cacheSet(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function cacheClear() { try { Object.keys(sessionStorage).forEach(function (k) { if (k.indexOf('dmm_') === 0 && k !== 'dmm_open') sessionStorage.removeItem(k); }); } catch (e) {} }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function linkify(s) { return esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>'); }
function toast(m) { var t = document.getElementById('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove('show'); }, 2600); }
function first(n) { return String(n || '').split(' ')[0]; }
function safeNext() { var n = new URLSearchParams(location.search).get('next') || ''; return /^\/[A-Za-z0-9\-_/]*$/.test(n) ? n : ''; }
function loading(msg) { app.innerHTML = '<div class="loading"><div class="spin"></div><p>' + esc(msg || 'Loading…') + '</p></div>'; }
function bar(p, done) { return '<div class="bar' + (done ? ' done-bar' : '') + '"><i style="width:' + p + '%"></i></div>'; }
function isAdminUser() { var s = DMM.session(); return !!(s && s.admin); }
function modNum(id) { var m = String(id).match(/(\d+)\s*$/); return m ? m[1] : id; }
var ICON_LOCK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
var ICON_CHECK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
var ICON_CHEV = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
var ICON_EXT = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M10 14L20 4M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>';

function setWho() {
  var s = DMM.session();
  document.getElementById('who').classList.toggle('hidden', !s);
  if (s) document.getElementById('whoName').textContent = s.name || s.email;
}
document.getElementById('logoutBtn').onclick = function () {
  DMM.api('logout'); DMM.clear(); cacheClear(); D = null; MY = null;
  history.replaceState(null, '', '/'); setWho(); renderWelcome('You have been logged out.');
};
function handleErr(r, retry) {
  if (r.authError) { D = null; MY = null; history.replaceState(null, '', '/'); renderWelcome(r.error); return; }
  app.innerHTML = '<div class="wrap"><div class="card gate"><h2>Something went wrong</h2><p>' + esc(r.error) + '</p><button class="btn btn-grad" id="retryBtn">Try again</button> <a class="btn btn-ghost" href="#/courses">My courses</a></div></div>';
  document.getElementById('retryBtn').onclick = retry;
}

/* ---------------- router ---------------- */
function route() {
  setWho();
  if (!DMM.configured() || !DMM.session()) return renderWelcome();
  var h = location.hash.replace(/^#\/?/, '').split('/');
  if (h[0] === 'c' && h[1]) return loadCourse(decodeURIComponent(h[1]), h[2] || '');
  return loadMyCourses();
}
window.addEventListener('hashchange', route);

/* ---------------- welcome + login + catalogue ---------------- */
var loginMode = 'login';
function courseCard(c, opts) {
  opts = opts || {};
  var img = c.image_url ? '<img src="' + esc(c.image_url) + '" alt="" loading="lazy">' : '';
  var meta = [];
  if (c.duration) meta.push(c.duration);
  if (c.phases && c.phases.length !== undefined) meta.push((c.phases.length || c.phases) + ' phases');
  else if (c.phases) meta.push(c.phases + ' phases');
  if (c.modules) meta.push(c.modules + ' modules');
  if (c.format) meta.push(c.format);
  var foot = opts.progress !== undefined
    ? '<div class="ft"><div style="flex:1"><div class="row muted" style="font-size:13px;display:flex;justify-content:space-between"><span>' + (c.current ? 'Phase ' + c.current.phase + ': ' + esc(c.current.title) : (c.overall >= 100 ? 'Completed' : (c.preassessment_done ? 'Ready to start' : 'Pre-assessment to do'))) + '</span><strong style="color:var(--ink)">' + c.overall + '%</strong></div>' + bar(c.overall, c.overall >= 100) + '</div></div>'
    : '<div class="ft"><span class="muted" style="font-size:13px">' + esc(opts.cta || 'View course') + '</span><span style="color:var(--b1);font-weight:700">→</span></div>';
  return '<button class="ccard" ' + (opts.onclick ? 'onclick="' + opts.onclick + '"' : '') + '><div class="img">' + img + (c.status && c.status !== 'published' ? '<span class="tag2">' + esc(c.status) + '</span>' : '') + '</div><div class="bd">' +
    (c.subtitle ? '<span class="st">' + esc(c.subtitle) + '</span>' : '') + '<h3>' + esc(c.title) + '</h3>' + (c.description ? '<p>' + esc(c.description) + '</p>' : '') +
    (meta.length ? '<div class="meta2">' + meta.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div>' : '') + foot + '</div></button>';
}
function journeyHTML(c) {
  if (!c || !c.phases || !c.phases.length) return '';
  return '<div class="journey"><h4>' + esc(c.title) + ': learning journey</h4><div class="pgrid">' + c.phases.map(function (p) {
    return '<div class="pcard"><div class="num">' + ('0' + p.phase).slice(-2) + '</div><h4>' + esc(p.title) + '</h4><div class="wk">' + esc(p.weeks) + '</div><p>' + esc(p.focus) + '</p></div>';
  }).join('') + '</div><p class="muted" style="margin-top:14px;font-size:14px">Phases unlock one after the other as you complete them. <a href="#login" onclick="document.getElementById(\'lgEmail\').focus()">Log in to access this course →</a></p></div>';
}
function renderCatalog() {
  var el = document.getElementById('catalog');
  if (!el) return;
  var list = CATALOG || FALLBACK_COURSES;
  if (!SEL) SEL = list[0] && list[0].id;
  var sel = list.filter(function (c) { return c.id === SEL; })[0] || list[0];
  el.innerHTML = '<div class="cgrid">' + list.map(function (c) { return courseCard(c, { onclick: 'pickCourse(\'' + esc(c.id) + '\')', cta: 'See the learning journey' }); }).join('') + '</div>' + journeyHTML(sel);
}
function pickCourse(id) { SEL = id; renderCatalog(); var j = document.querySelector('.journey'); if (j) j.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

function renderWelcome(info) {
  setWho();
  var photo = PHOTO_URL
    ? '<figure class="photo"><img src="' + esc(PHOTO_URL) + '" alt="Avinesh Bundhoo delivering a digital marketing training session to a group of students at Oreegami Mauritius"><figcaption><i></i>Live training session · Oreegami Mauritius</figcaption></figure>'
    : '<div class="photo"><div class="photo-ph"><strong>Training photo goes here</strong></div></div>';
  app.innerHTML =
    '<section class="hero"><div class="wrap hero-grid">' +
      '<div>' +
        '<span class="eyebrow"><i></i>Digital Marketing Training</span>' +
        '<h1>Welcome to the <span>Digital Marketing & AI Bootcamp</span></h1>' +
        '<p class="lead">A practical, hands-on programme that takes you from the foundations of the digital ecosystem to running paid campaigns, using AI and building a real marketing strategy. Each module gives you a presentation, reading notes, exercises and a revision quiz, and you can follow your progress every step of the way.</p>' +
        '<div class="facts"><div class="fact"><strong>20</strong><span>weeks</span></div><div class="fact"><strong>4</strong><span>learning phases</span></div><div class="fact"><strong>20</strong><span>modules</span></div><div class="fact"><strong>1:1</strong><span>trainer feedback</span></div></div>' +
        photo +
      '</div>' +
      '<div id="login"><form class="login" id="loginForm" novalidate>' +
        '<h2 id="lgTitle">Student login</h2>' +
        '<p class="lsub" id="lgSub">Use the email you enrolled with.</p>' +
        (info ? '<div class="msg info">' + esc(info) + '</div>' : '') +
        '<div class="msg err hidden" id="lgErr"></div>' +
        '<div class="field"><label for="lgEmail">Email</label><input id="lgEmail" type="email" autocomplete="username" required placeholder="you@example.com"></div>' +
        '<div class="field"><label for="lgPw" id="lgPwLabel">Password</label><input id="lgPw" type="password" autocomplete="current-password" placeholder="Your password"></div>' +
        '<div class="field hidden" id="lgPw2Wrap"><label for="lgPw2">Confirm password</label><input id="lgPw2" type="password" autocomplete="new-password" placeholder="Type it again"></div>' +
        '<button class="btn btn-grad" id="lgBtn" type="submit">Login to Access Your Training</button>' +
        '<p class="alt">First time here? Enter your email and press the button: you\'ll be asked to create your password.<br>New student? <a href="/pre-assessment">Take the pre-assessment</a>.</p>' +
      '</form></div>' +
    '</div></section>' +
    '<section class="section"><div class="wrap"><h3>Our courses</h3><p class="intro">Every programme follows the same structure: phases, modules, exercises and revision quizzes, with your progress tracked from 0% to 100%.</p><div id="catalog"></div></div></section>';
  loginMode = 'login';
  document.getElementById('loginForm').onsubmit = doLogin;
  renderCatalog();
  if (!DMM.configured()) { showErr('The student platform is being set up. Please check back shortly.'); return; }
  if (!CATALOG) DMM.api('catalog').then(function (r) { if (r.ok && r.courses && r.courses.length) { CATALOG = r.courses; renderCatalog(); } });
}
function showErr(m) { var e = document.getElementById('lgErr'); if (!e) return; e.textContent = m; e.classList.toggle('hidden', !m); }
function setCreateMode(name) {
  loginMode = 'create';
  document.getElementById('lgTitle').textContent = name ? 'Welcome, ' + first(name) + '!' : 'Create your password';
  document.getElementById('lgSub').textContent = 'This is your first login. Choose a password (at least 8 characters) to protect your progress.';
  document.getElementById('lgPwLabel').textContent = 'New password';
  document.getElementById('lgPw').setAttribute('autocomplete', 'new-password');
  document.getElementById('lgPw').placeholder = 'At least 8 characters';
  document.getElementById('lgPw2Wrap').classList.remove('hidden');
  document.getElementById('lgBtn').textContent = 'Create password & continue';
  document.getElementById('lgEmail').readOnly = true;
  document.getElementById('lgPw').focus();
}
function doLogin(ev) {
  ev.preventDefault(); showErr('');
  var email = document.getElementById('lgEmail').value.trim(), pw = document.getElementById('lgPw').value, btn = document.getElementById('lgBtn');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showErr('Please enter a valid email address.');
  if (loginMode === 'create') {
    if (pw.length < 8) return showErr('Please choose a password of at least 8 characters.');
    if (pw !== document.getElementById('lgPw2').value) return showErr('The two passwords don\'t match.');
  }
  var label = btn.textContent; btn.disabled = true; btn.textContent = 'Checking…';
  (loginMode === 'create' ? DMM.api('setPassword', { email: email, password: pw }) : DMM.api('login', { email: email, password: pw })).then(function (r) {
    btn.disabled = false; btn.textContent = label;
    if (!r.ok) return showErr(r.error || 'Something went wrong. Please try again.');
    if (r.needPassword) return setCreateMode(r.name);
    if (!r.token) return showErr('Please enter your password.');
    DMM.setSession({ token: r.token, name: r.name || email, email: email.toLowerCase(), role: r.role || 'student', admin: !!r.admin });
    cacheClear();
    var next = safeNext();
    if (next) { location.href = next; return; }
    history.replaceState(null, '', '/#/courses');
    route();
  });
}

/* ---------------- my courses ---------------- */
function loadMyCourses() {
  var cached = cacheGet('dmm_my');
  if (cached) { MY = cached; renderMyCourses(true); } else loading('Loading your courses…');
  DMM.api('myCourses').then(function (r) {
    if (!r.ok) { if (!cached || r.authError) handleErr(r, loadMyCourses); else toast(r.error); return; }
    MY = r; cacheSet('dmm_my', r);
    var ss = DMM.session(); if (ss && !!ss.admin !== !!r.admin) { ss.admin = !!r.admin; DMM.setSession(ss); }
    if (/^#\/c\//.test(location.hash)) return;   /* user already moved to a course */
    renderMyCourses(false);
  });
}
function renderMyCourses(fromCache) {
  var isTrainer = MY.role === 'trainer';
  if (!isTrainer && MY.courses.length === 1) { location.replace('#/c/' + encodeURIComponent(MY.courses[0].id)); return; }
  var h = '<div class="wrap dash"><div class="page-h"><div><h1>' + (isTrainer ? 'Courses' : 'My courses') + '</h1><p>' + (isTrainer ? 'Open a course to see the learning view or your students\' progress.' : 'Welcome back, ' + esc(first(MY.name)) + '. Choose a course to continue.') + '</p></div>' + (isTrainer ? '<a class="btn btn-grad" href="/admin">' + (isAdminUser() ? 'Admin: add material &amp; students' : 'Trainer area: add material &amp; students') + '</a>' : '') + '</div>';
  if (!MY.courses.length) h += '<div class="card empty">You are not enrolled in a course yet. Please contact your trainer at <a href="mailto:digitalmarketer@hseniva.com">digitalmarketer@hseniva.com</a>.</div>';
  else h += '<div class="cgrid">' + MY.courses.map(function (c) { return courseCard(c, { progress: true, onclick: 'location.hash=\'#/c/' + encodeURIComponent(c.id) + '\'' }); }).join('') + '</div>';
  app.innerHTML = h + '</div>';
}

/* ---------------- course dashboard ---------------- */
var CUR_ID = null, CUR_SUB = '';
function loadCourse(id, sub) {
  CUR_ID = id; CUR_SUB = sub;
  if (sub === 'students') return loadOverview(id);
  var cached = cacheGet('dmm_dash_' + id);
  if (cached) { D = cached; showCourse(); } else loading('Loading your course…');
  DMM.api('dashboard', { course: id }).then(function (r) {
    if (CUR_ID !== id || CUR_SUB !== sub) return;
    if (!r.ok) { if (!cached || r.authError) handleErr(r, function () { loadCourse(id, sub); }); else toast(r.error); return; }
    setData(r.data); showCourse();
  });
}
function setData(d) {
  D = d; cacheSet('dmm_dash_' + d.course.id, d);
  var s = DMM.session();
  if (s && d.student.name && s.name !== d.student.name) { s.name = d.student.name; DMM.setSession(s); setWho(); }
}
function showCourse() { if (!D.student.preassessment_done) return renderGate(); renderDashboard(); }
function crumbs() {
  var multi = (MY && MY.courses && MY.courses.length > 1) || (D && D.student.role === 'trainer');
  return multi ? '<div class="crumbs"><a href="#/courses">' + (D.student.role === 'trainer' ? 'Courses' : 'My courses') + '</a> / ' + esc(D.course.title) + '</div>' : '';
}
function trainerTabs(active) {
  if (!D || D.student.role !== 'trainer') return '';
  var base = '#/c/' + encodeURIComponent(D.course.id);
  return '<div class="tabs"><a href="' + base + '" class="' + (active === 'learn' ? 'on' : '') + '">Learning view</a><a href="' + base + '/students" class="' + (active === 'students' ? 'on' : '') + '">Students\' progress</a><a href="/admin?course=' + encodeURIComponent(D.course.id) + '">' + (isAdminUser() ? 'Admin ⚙' : 'Trainer area ⚙') + '</a></div>';
}
function renderGate() {
  var url = D.course.preassessment_url || '/pre-assessment';
  app.innerHTML = '<div class="wrap">' + '<div style="padding-top:28px">' + crumbs() + '</div><div class="card gate">' +
    '<span class="eyebrow"><i></i>Step 1 of your journey</span>' +
    '<h2>Hi ' + esc(first(D.student.name)) + ', let\'s start with your pre-assessment</h2>' +
    '<p>It takes about 20 minutes and helps your trainer adapt <strong>' + esc(D.course.title) + '</strong> to how you learn best. As soon as you submit it, your learning dashboard and Phase 1 will open.</p>' +
    '<a class="btn btn-grad" href="' + esc(url) + '">Start the pre-assessment</a>' +
    '<p style="margin:18px 0 0;font-size:13px">Already completed it? <a href="#" onclick="cacheClear();route();return false">Refresh</a> or contact your trainer.</p>' +
  '</div></div>';
}
function statusPill(st) {
  var map = { completed: ['done', 'Completed'], in_progress: ['cur', 'In progress'], not_started: ['ns', 'Not started'], locked: ['lk', 'Locked'], open: ['open', 'Available'] };
  var m = map[st] || map.not_started;
  return '<span class="pill ' + m[0] + '">' + m[1] + '</span>';
}
function phaseKind(p) { if (p.status === 'locked') return 'lk'; if (p.status === 'completed') return 'done'; if (p.phase === D.currentPhase) return 'cur'; return 'open'; }
function ring(pct) {
  var r = 50, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
  return '<div class="ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="' + r + '" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="12"/><circle cx="60" cy="60" r="' + r + '" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '"/></svg><div class="v"><strong>' + pct + '%</strong><span>course</span></div></div>';
}
function nextStep() {
  for (var i = 0; i < D.phases.length; i++) {
    var p = D.phases[i];
    if (!p.unlocked) continue;
    for (var j = 0; j < p.modules.length; j++) {
      var m = p.modules[j];
      if (m.pct >= 100) continue;
      var label = 'Module ' + modNum(m.id) + ': ' + m.title;
      if (!m.hasContent) return { m: m, p: p, title: label, text: 'The content for this module is being prepared. Your trainer will open it soon.', cta: '' };
      if (m.ppt && !m.ppt.done) return { m: m, p: p, title: label, text: 'Review the presentation, then mark it as reviewed.', cta: 'Open module' };
      if (m.notes && !m.notes.done) return { m: m, p: p, title: label, text: 'Read the reading notes and mark them as read.', cta: 'Open module' };
      for (var k = 0; k < m.exercises.length; k++) if (!m.exercises[k].done) return { m: m, p: p, title: label, text: 'Submit Exercise ' + m.exercises[k].id + ': ' + m.exercises[k].title + '.', cta: 'Open module' };
      if (m.quiz && !m.quiz.passed) return { m: m, p: p, title: label, text: 'Take the revision quiz (pass mark ' + m.quiz.pass_mark + '%).', cta: 'Open module' };
      return { m: m, p: p, title: label, text: 'Continue this module.', cta: 'Open module' };
    }
  }
  var lockedNext = D.phases.filter(function (p) { return !p.unlocked; })[0];
  if (lockedNext) return { title: 'Phase ' + lockedNext.phase + ' is next', text: lockedNext.lockMsg, cta: '' };
  return { title: 'You have completed every available module', text: 'Brilliant work. Your trainer will be in touch about your next steps.', cta: '' };
}

function renderDashboard() {
  var s = D.student, cur = D.phases.filter(function (p) { return p.phase === D.currentPhase; })[0];
  var h = '<div class="wrap dash">' + crumbs();
  h += '<section class="course"><div><div class="k">' + (s.role === 'trainer' ? 'TRAINER PREVIEW' : 'YOUR COURSE') + '</div><h1>' + esc(D.course.title) + '</h1><p>' + (s.role === 'trainer' ? 'You see every phase unlocked. Students only see what they have unlocked.' : 'Welcome back, ' + esc(first(s.name)) + '. Here is where you are in your learning journey.') + '</p>' +
       '<div class="chips">' + (s.role === 'trainer' ? '' : (D.course.preassessment_url ? '<span class="chip">✓ Pre-assessment completed</span>' : '')) + (cur ? '<span class="chip">Current: Phase ' + cur.phase + ' · ' + esc(cur.title) + ' (' + cur.pct + '%)</span>' : '') + '</div></div>' + ring(D.overall) + '</section>';
  h += trainerTabs('learn');
  h += '<section class="card road" aria-label="Learning roadmap"><div class="road-h"><h2>Your learning roadmap</h2><span>Overall progress: <strong style="color:var(--ink)">' + D.overall + '%</strong></span></div><div class="steps" style="grid-template-columns:repeat(' + Math.max(1, D.phases.length) + ',1fr)">';
  D.phases.forEach(function (p, i) {
    var k = phaseKind(p), prevDone = i > 0 && D.phases[i - 1].status === 'completed';
    var node = k === 'done' ? ICON_CHECK : k === 'lk' ? ICON_LOCK : (k === 'cur' ? p.pct + '%' : p.phase);
    var label = { done: ['done', 'Completed'], cur: ['cur', 'In progress'], open: ['open', 'Available'], lk: ['lk', 'Locked'] }[k];
    h += '<button class="step ' + k + (prevDone ? ' fill' : '') + '" ' + (k === 'lk' ? 'disabled title="' + esc(p.lockMsg) + '"' : 'onclick="goPhase(' + p.phase + ')"') + '>' +
         '<div class="node">' + node + '</div><div><div class="ph">Phase ' + p.phase + '</div><div class="t">' + esc(p.title) + '</div><div class="w">' + esc(p.weeks) + '</div>' +
         '<span class="pill ' + label[0] + '">' + label[1] + '</span>' + (k !== 'lk' ? '<div class="mini' + (k === 'done' ? ' done-bar' : '') + '"><i style="width:' + p.pct + '%"></i></div>' : '') + '</div></button>';
  });
  h += '</div></section>';
  var n = nextStep();
  h += '<section class="card next"><div><div class="k">Your next step</div><h3>' + esc(n.title) + '</h3><p>' + esc(n.text) + '</p></div>' +
       (n.cta ? '<button class="btn btn-grad" onclick="goModule(' + n.p.phase + ',\'' + esc(n.m.id) + '\')">' + n.cta + ' →</button>' : '') + '</section>';
  h += '<section class="phases">';
  D.phases.forEach(function (p) { h += phaseHTML(p); });
  h += '</section></div>';
  app.innerHTML = h;
  if (window.mobileSteps) mobileSteps();
}

function phaseHTML(p) {
  var k = phaseKind(p), key = D.course.id + ':p' + p.phase;
  var isOpen = p.unlocked && (OPEN[key] !== undefined ? OPEN[key] : p.phase === D.currentPhase);
  var h = '<article class="card phase ' + (k === 'lk' ? 'lk' : k === 'done' ? 'done' : '') + (isOpen ? ' open-x' : '') + '" id="phase-' + p.phase + '">';
  h += '<button class="phase-h" onclick="togglePhase(' + p.phase + ')" aria-expanded="' + (isOpen || !!OPEN[key]) + '">' +
       '<span class="num">' + (k === 'done' ? ICON_CHECK : k === 'lk' ? ICON_LOCK : ('0' + p.phase).slice(-2)) + '</span>' +
       '<span class="main"><h3>Phase ' + p.phase + ': ' + esc(p.title) + '</h3><span class="meta">' + esc(p.weeks) + (p.focus ? ' · ' + esc(p.focus) : '') + '</span></span>' +
       '<span class="pr">' + (p.unlocked ? '<strong>' + p.pct + '%</strong> complete' + bar(p.pct, k === 'done') : statusPill('locked')) + '</span>' +
       '<span class="chev">' + ICON_CHEV + '</span></button>';
  if (!p.unlocked) {
    if (OPEN[key]) {
      h += '<div class="phase-b"><div class="lockbox">' + ICON_LOCK + '<div><strong>' + esc(p.lockMsg) + '</strong><br>Modules in this phase:</div></div>';
      p.modules.forEach(function (m) { h += '<div class="mod lk"><div class="mod-h"><span class="ic">' + ICON_LOCK + '</span><span class="main"><span class="wk">' + esc(m.week) + '</span><h4>Module ' + modNum(m.id) + ': ' + esc(m.title) + '</h4></span></div></div>'; });
      h += '</div>';
    }
    return h + '</article>';
  }
  if (isOpen) { h += '<div class="phase-b">'; p.modules.forEach(function (m) { h += moduleHTML(p, m); }); h += '</div>'; }
  return h + '</article>';
}

function moduleHTML(p, m) {
  var key = D.course.id + ':' + m.id, isOpen = !!OPEN[key], num = modNum(m.id);
  var h = '<div class="mod ' + (m.pct >= 100 ? 'done' : '') + (isOpen ? ' open-x' : '') + '" id="mod-' + esc(m.id) + '">';
  h += '<button class="mod-h" onclick="toggleModule(\'' + esc(m.id) + '\')" aria-expanded="' + isOpen + '"><span class="ic">' + (m.pct >= 100 ? ICON_CHECK : 'M' + num) + '</span>' +
       '<span class="main"><span class="wk">' + esc(m.week) + '</span><h4>Module ' + num + ': ' + esc(m.title) + '</h4></span>' +
       '<span class="pr"><span class="row"><span>' + (m.hasContent ? 'Progress' : 'Coming soon') + '</span><strong>' + m.pct + '%</strong></span>' + bar(m.pct, m.pct >= 100) + '</span>' +
       '<span class="chev">' + ICON_CHEV + '</span></button>';
  if (!isOpen) return h + '</div>';
  var w = m.weights || {}, tot = 0;
  Object.keys(w).forEach(function (k) { tot += w[k]; });
  function share(k) { return tot && w[k] ? '<small>counts for ' + Math.round(w[k] / tot * 100) + '% of this module</small>' : ''; }
  var mid = esc(m.id);
  h += '<div class="mod-b">';
  if (m.description) h += '<p class="mod-desc">' + esc(m.description) + '</p>';
  if (!m.hasContent) h += '<div class="ph-box" style="margin-top:14px">The presentation, notes, exercises and quiz for this module are being prepared and will appear here.</div>';
  if (m.ppt) {
    h += '<div class="blk ' + (m.ppt.done ? 'ok' : '') + '"><span class="l">' + (m.ppt.done ? '✓' : 'A') + '</span><div><h5>Presentation ' + share('ppt') + '</h5><p class="d">Go through the slides for this module.</p><div class="acts">' +
         '<a class="btn btn-soft btn-sm" href="' + esc(m.ppt.url) + '" target="_blank" rel="noopener" onclick="pptOpened(\'' + mid + '\')">Open presentation ' + ICON_EXT + '</a>' +
         (m.ppt.done ? '<span class="tag ok">Reviewed</span>' : '<button class="btn btn-grad btn-sm" id="ppt-' + mid + '" ' + (OPENED_PPT[m.id] ? '' : 'disabled title="Open the presentation first"') + ' onclick="markItem(\'' + mid + '\',\'ppt\',this)">I\'ve reviewed the presentation</button>') + '</div></div></div>';
  } else if (m.hasContent) h += '<div class="blk na"><span class="l">A</span><div><h5>Presentation</h5><div class="ph-box">The presentation link will be added here soon.</div></div></div>';
  if (m.notes) {
    h += '<div class="blk ' + (m.notes.done ? 'ok' : '') + '"><span class="l">' + (m.notes.done ? '✓' : 'B') + '</span><div><h5>Reading notes ' + share('notes') + '</h5>' +
         (m.notes.text ? '<p class="d">' + linkify(m.notes.text).replace(/\n/g, '<br>') + '</p>' : '') +
         (m.resources && m.resources.length ? '<ul class="res">' + m.resources.map(function (r) { return '<li>📎 <a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.label) + '</a></li>'; }).join('') + '</ul>' : '') +
         '<div class="acts">' + (m.notes.url ? '<a class="btn btn-soft btn-sm" href="' + esc(m.notes.url) + '" target="_blank" rel="noopener">Open reading notes ' + ICON_EXT + '</a>' : '') +
         (m.notes.done ? '<span class="tag ok">Read</span>' : '<button class="btn btn-grad btn-sm" onclick="markItem(\'' + mid + '\',\'notes\',this)">I\'ve read the notes</button>') + '</div></div></div>';
  } else if (m.hasContent) h += '<div class="blk na"><span class="l">B</span><div><h5>Reading notes</h5><div class="ph-box">Reading notes will be added here soon.</div></div></div>';
  if (m.exercises && m.exercises.length) {
    var doneN = m.exercises.filter(function (e) { return e.done; }).length, all = doneN === m.exercises.length;
    h += '<div class="blk ' + (all ? 'ok' : '') + '"><span class="l">' + (all ? '✓' : 'C') + '</span><div><h5>Exercises & activities ' + share('exercises') + '</h5><p class="d">' + doneN + ' of ' + m.exercises.length + ' submitted. Write your answer or paste a link to your work (Google Doc, Sheet, Drive folder…).</p>';
    m.exercises.forEach(function (e) {
      var k = (m.id + '-' + e.id).replace(/\W/g, '_'), eid = esc(e.id);
      h += '<div class="ex ' + (e.done ? 'ok' : '') + '"><h6><span>Exercise ' + eid + ': ' + esc(e.title) + '</span>' + (e.done ? '<span class="tag ok">Submitted</span>' : '<span class="tag todo">To do</span>') + '</h6><p>' + linkify(e.instructions) + '</p>';
      if (e.done) h += '<div class="sub">' + linkify(e.submission) + '</div><details><summary style="font-size:13px;color:var(--mut);cursor:pointer">Update my submission</summary><div style="margin-top:10px"><textarea id="ta-' + k + '">' + esc(e.submission) + '</textarea><div class="acts" style="margin-top:10px"><button class="btn btn-soft btn-sm" onclick="submitEx(\'' + mid + '\',\'' + eid + '\',\'' + k + '\',this)">Save update</button></div><div class="err-inline" id="er-' + k + '"></div></div></details>';
      else h += '<textarea id="ta-' + k + '" placeholder="Your answer, or a link to your work…"></textarea><div class="acts" style="margin-top:10px"><button class="btn btn-grad btn-sm" onclick="submitEx(\'' + mid + '\',\'' + eid + '\',\'' + k + '\',this)">Submit exercise</button></div><div class="err-inline" id="er-' + k + '"></div>';
      h += '</div>';
    });
    h += '</div></div>';
  } else if (m.hasContent) h += '<div class="blk na"><span class="l">C</span><div><h5>Exercises & activities</h5><div class="ph-box">Exercises will be added here soon.</div></div></div>';
  if (m.quiz) {
    var q = m.quiz, left = q.max_attempts ? Math.max(0, q.max_attempts - q.attempts) : null;
    h += '<div class="blk ' + (q.passed ? 'ok' : '') + '"><span class="l">' + (q.passed ? '✓' : 'D') + '</span><div><h5>Revision quiz ' + share('quiz') + '</h5><p class="d">' + q.questions + ' questions to revise this module. Pass mark: ' + q.pass_mark + '%.</p>' +
         '<div class="qstats"><span class="qstat">Attempts: <strong>' + q.attempts + (q.max_attempts ? ' / ' + q.max_attempts : '') + '</strong></span><span class="qstat">Best score: <strong>' + (q.attempts ? q.best + '%' : '–') + '</strong></span><span class="qstat">Status: <strong>' + (q.passed ? 'Passed ✓' : q.attempts ? 'Not passed yet' : 'Not started') + '</strong></span></div>' +
         '<div class="acts">' + (left === 0 && !q.passed ? '<span class="tag todo">No attempts left: contact your trainer</span>' : '<a class="btn ' + (q.passed ? 'btn-soft' : 'btn-grad') + ' btn-sm" href="' + esc(q.url) + '">' + (q.passed ? 'Retake the quiz' : q.attempts ? 'Try again' : 'Start the quiz') + ' →</a>') + '</div></div></div>';
  } else if (m.hasContent) h += '<div class="blk na"><span class="l">D</span><div><h5>Revision quiz</h5><div class="ph-box">The revision quiz will be added here soon.</div></div></div>';
  return h + '</div></div>';
}

/* ---------------- interactions ---------------- */
function togglePhase(n) {
  var p = D.phases.filter(function (x) { return x.phase === n; })[0], key = D.course.id + ':p' + n;
  var cur = OPEN[key] !== undefined ? OPEN[key] : (p.unlocked && n === D.currentPhase);
  OPEN[key] = !cur; saveOpen(); rerenderPhase(n);
}
function toggleModule(id) { var key = D.course.id + ':' + id; OPEN[key] = !OPEN[key]; saveOpen(); rerenderPhase(phaseOf(id).phase); }
function phaseOf(id) { return D.phases.filter(function (p) { return p.modules.some(function (m) { return m.id === id; }); })[0]; }
function rerenderPhase(n) {
  var p = D.phases.filter(function (x) { return x.phase === n; })[0], el = document.getElementById('phase-' + n);
  var tmp = document.createElement('div'); tmp.innerHTML = phaseHTML(p); el.replaceWith(tmp.firstChild);
}
function goPhase(n) { OPEN[D.course.id + ':p' + n] = true; saveOpen(); rerenderPhase(n); document.getElementById('phase-' + n).scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function goModule(n, id) { OPEN[D.course.id + ':p' + n] = true; OPEN[D.course.id + ':' + id] = true; saveOpen(); rerenderPhase(n); setTimeout(function () { document.getElementById('mod-' + id).scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 30); }
function pptOpened(id) { OPENED_PPT[id] = true; var b = document.getElementById('ppt-' + id); if (b) { b.disabled = false; b.removeAttribute('title'); } }
function afterUpdate(r, okMsg) {
  if (!r.ok) { if (r.authError) { handleErr(r); return false; } toast(r.error); return false; }
  setData(r.data); try { sessionStorage.removeItem('dmm_my'); } catch (e) {} renderDashboard(); toast(okMsg); return true;
}
function markItem(id, item, btn) {
  btn.disabled = true; btn.textContent = 'Saving…';
  DMM.api('complete', { module: id, item: item }).then(function (r) { if (!afterUpdate(r, 'Progress saved ✓')) { btn.disabled = false; btn.textContent = 'Try again'; } });
}
function submitEx(id, exId, key, btn) {
  var t = document.getElementById('ta-' + key).value.trim(), er = document.getElementById('er-' + key);
  er.textContent = '';
  if (t.length < 10) { er.textContent = 'Please write your answer or paste a link to your work (at least 10 characters).'; return; }
  btn.disabled = true; var l = btn.textContent; btn.textContent = 'Submitting…';
  DMM.api('complete', { module: id, item: 'ex:' + exId, text: t }).then(function (r) {
    if (!afterUpdate(r, 'Exercise submitted ✓')) { btn.disabled = false; btn.textContent = l; var e2 = document.getElementById('er-' + key); if (e2 && r.error) e2.textContent = r.error; }
  });
}

/* ---------------- trainer: students' progress ---------------- */
function loadOverview(id) {
  loading('Loading students\' progress…');
  var dash = D && D.course.id === id ? Promise.resolve({ ok: true, data: D }) : DMM.api('dashboard', { course: id });
  dash.then(function (d) {
    if (!d.ok) return handleErr(d, function () { loadOverview(id); });
    setData(d.data);
    return DMM.api('overview', { course: id }).then(function (r) {
      if (CUR_ID !== id || CUR_SUB !== 'students') return;
      if (!r.ok) return handleErr(r, function () { loadOverview(id); });
      renderOverview(r);
    });
  });
}
function fmtDate(iso) { if (!iso) return '–'; var d = new Date(iso); return isNaN(d) ? '–' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
function renderOverview(r) {
  var h = '<div class="wrap dash">' + crumbs() + '<div class="page-h"><div><h1>' + esc(r.course.title) + '</h1><p>' + r.students.length + ' enrolled student' + (r.students.length === 1 ? '' : 's') + '. Exercise answers and quiz answers are in the Google Sheet (Submissions and QuizAttempts tabs).</p></div></div>' + trainerTabs('students');
  if (!r.students.length) h += '<div class="card empty" style="margin-top:20px">No students enrolled yet. Add rows in the Enrolments tab of the Google Sheet.</div>';
  else {
    h += '<div class="card tbl-wrap"><table class="tbl"><thead><tr><th>Student</th><th>Pre-assessment</th><th>Overall</th>' + r.phases.map(function (p) { return '<th>Phase ' + p.phase + '</th>'; }).join('') + '<th>Exercises</th><th>Last active</th><th>Login</th></tr></thead><tbody>';
    r.students.forEach(function (s) {
      h += '<tr><td><strong style="color:var(--ink)">' + esc(s.name) + '</strong><br><span class="muted" style="font-size:12px">' + esc(s.email) + '</span></td>' +
           '<td>' + (s.preassessment_done ? '<span class="tag ok">Done</span>' : '<span class="tag todo">To do</span>') + '</td>' +
           '<td><strong>' + s.overall + '%</strong>' + bar(s.overall, s.overall >= 100) + '</td>' +
           s.phases.map(function (v) { return '<td>' + (v === null ? '<span class="muted">🔒</span>' : v + '%' + bar(v, v >= 100)) + '</td>'; }).join('') +
           '<td>' + s.submissions + '</td><td>' + fmtDate(s.lastActive) + '</td><td>' + (s.hasPassword ? '<span class="tag ok">Active</span>' : '<span class="tag todo">Not yet</span>') + '</td></tr>';
    });
    h += '</tbody></table></div>';
  }
  app.innerHTML = h + '</div>';
}

/* ---------------- start ---------------- */
route();
