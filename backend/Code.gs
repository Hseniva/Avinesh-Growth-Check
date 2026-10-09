/**
 * DMM Learning Platform - backend (Google Apps Script web app)
 * -------------------------------------------------------------
 * Paste this whole file into Extensions > Apps Script of the
 * "DMM Learning Platform" Google Sheet, then Deploy > New deployment >
 * Web app (Execute as: Me, Who has access: Anyone).
 *
 * The Sheet is the database AND the content manager:
 *   Students      who can log in, pre-assessment status, manual phase unlock
 *   Phases        phase titles, weeks, focus, unlock rule
 *   Modules       every module's PowerPoint link, notes, exercises, quiz, weights
 *   Progress      one row per student x module x completed item (no duplicates)
 *   Submissions   exercise answers students submit
 *   QuizAttempts  every quiz attempt with score
 *   Sessions      login tokens (do not edit)
 *
 * All access rules (login, pre-assessment, phase locks, retry limits) are
 * checked here on the server, not in the browser.
 */

var SESSION_DAYS = 14;
var MAX_LOGIN_FAILS = 6;           // per email, then 15 min cool-down
var TABS = {
  Students:     ['email', 'name', 'password_hash', 'salt', 'preassessment_done', 'unlocked_phase', 'active', 'created_at', 'last_login'],
  Sessions:     ['token', 'email', 'expires_at'],
  Phases:       ['phase', 'title', 'weeks', 'focus', 'unlock_threshold'],
  Modules:      ['module_id', 'phase', 'order', 'week', 'title', 'description', 'ppt_url', 'notes_url', 'notes_text', 'resources', 'exercises', 'quiz_url', 'pass_mark', 'max_attempts', 'w_ppt', 'w_notes', 'w_exercises', 'w_quiz'],
  Progress:     ['email', 'module_id', 'item', 'value', 'updated_at'],
  Submissions:  ['email', 'module_id', 'exercise_id', 'text', 'submitted_at'],
  QuizAttempts: ['email', 'module_id', 'score', 'total', 'pct', 'passed', 'answers', 'attempted_at']
};

/* ============ HTTP entry points ============ */

function doGet() {
  return out_({ ok: true, service: 'DMM Learning Platform API' });
}

function doPost(e) {
  var req;
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return out_({ ok: false, error: 'Bad request.' }); }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    return out_(route_(req));
  } catch (err) {
    return out_({ ok: false, error: String((err && err.message) || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function route_(req) {
  switch (req.action) {
    case 'login':             return login_(req);
    case 'setPassword':       return setPassword_(req);
    case 'dashboard':         return { ok: true, data: dashboard_(auth_(req)) };
    case 'preassessmentDone': return preassessmentDone_(auth_(req));
    case 'complete':          return complete_(auth_(req), req);
    case 'quiz':              return quiz_(auth_(req), req);
    case 'logout':            return logout_(req);
    default: throw new Error('Unknown action.');
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ============ Sheet helpers ============ */

function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(TABS[name]);
  }
  return sh;
}

function table_(name) {
  var values = sheet_(name).getDataRange().getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var o = { _row: r + 1 };
    var empty = true;
    for (var c = 0; c < headers.length; c++) {
      o[headers[c]] = values[r][c];
      if (values[r][c] !== '' && values[r][c] !== null) empty = false;
    }
    if (!empty) rows.push(o);
  }
  return { headers: headers, rows: rows };
}

function append_(name, obj) {
  var headers = table_(name).headers;
  sheet_(name).appendRow(headers.map(function (h) { return obj[h] === undefined ? '' : obj[h]; }));
}

function update_(name, row, obj) {
  var t = table_(name);
  var sh = sheet_(name);
  var current = sh.getRange(row, 1, 1, t.headers.length).getValues()[0];
  var next = t.headers.map(function (h, i) { return obj.hasOwnProperty(h) ? obj[h] : current[i]; });
  sh.getRange(row, 1, 1, t.headers.length).setValues([next]);
}

function truthy_(v) {
  var s = String(v).trim().toLowerCase();
  return v === true || s === 'true' || s === 'yes' || s === 'y' || s === '1' || s === 'x';
}

function num_(v, dflt) {
  var n = parseFloat(v);
  return isNaN(n) ? dflt : n;
}

function now_() { return new Date(); }
function norm_(email) { return String(email || '').trim().toLowerCase(); }

/* ============ Auth ============ */

function hash_(password, salt) {
  var v = salt + '|' + password;
  for (var i = 0; i < 200; i++) {
    v = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, v, Utilities.Charset.UTF_8));
  }
  return v;
}

function findStudent_(email) {
  email = norm_(email);
  var rows = table_('Students').rows;
  for (var i = 0; i < rows.length; i++) {
    if (norm_(rows[i].email) === email) return rows[i];
  }
  return null;
}

function isActive_(s) {
  return s && String(s.active).trim() === '' ? true : truthy_(s.active);
}

function newSession_(email) {
  var token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  var exp = new Date(now_().getTime() + SESSION_DAYS * 864e5);
  append_('Sessions', { token: token, email: norm_(email), expires_at: exp });
  return token;
}

function auth_(req) {
  var token = String(req.token || '');
  if (token.length < 30) throw new Error('AUTH: Please log in.');
  var rows = table_('Sessions').rows;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].token === token) {
      if (new Date(rows[i].expires_at) < now_()) throw new Error('AUTH: Your session has expired. Please log in again.');
      var s = findStudent_(rows[i].email);
      if (!s || !isActive_(s)) throw new Error('AUTH: Your access is not active. Please contact your trainer.');
      return s;
    }
  }
  throw new Error('AUTH: Please log in.');
}

function failKey_(email) { return 'fail_' + norm_(email); }

function login_(req) {
  var email = norm_(req.email);
  if (!email) return { ok: false, error: 'Please enter your email.' };
  var cache = CacheService.getScriptCache();
  var fails = num_(cache.get(failKey_(email)), 0);
  if (fails >= MAX_LOGIN_FAILS) return { ok: false, error: 'Too many attempts. Please wait 15 minutes and try again.' };

  var s = findStudent_(email);
  if (!s || !isActive_(s)) return { ok: false, error: 'This email is not enrolled. Please use the email you registered with, or contact your trainer.' };

  if (!String(s.password_hash).trim()) return { ok: true, needPassword: true, name: String(s.name || '') };

  if (hash_(String(req.password || ''), String(s.salt)) !== String(s.password_hash)) {
    cache.put(failKey_(email), String(fails + 1), 900);
    return { ok: false, error: 'Incorrect password. Please try again.' };
  }
  cache.remove(failKey_(email));
  update_('Students', s._row, { last_login: now_() });
  return { ok: true, token: newSession_(email), name: String(s.name || '') };
}

function setPassword_(req) {
  var email = norm_(req.email);
  var s = findStudent_(email);
  if (!s || !isActive_(s)) return { ok: false, error: 'This email is not enrolled.' };
  if (String(s.password_hash).trim()) return { ok: false, error: 'A password already exists for this email. Log in, or ask your trainer to reset it.' };
  var pw = String(req.password || '');
  if (pw.length < 8) return { ok: false, error: 'Please choose a password of at least 8 characters.' };
  var salt = Utilities.getUuid();
  var patch = { password_hash: hash_(pw, salt), salt: salt, last_login: now_() };
  if (req.name && !String(s.name).trim()) patch.name = String(req.name).slice(0, 80);
  if (!String(s.created_at).trim()) patch.created_at = now_();
  update_('Students', s._row, patch);
  return { ok: true, token: newSession_(email), name: String(patch.name || s.name || '') };
}

function logout_(req) {
  var rows = table_('Sessions').rows;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].token === req.token) update_('Sessions', rows[i]._row, { expires_at: new Date(0) });
  }
  return { ok: true };
}

/* ============ Course structure & progress ============ */

function parseLines_(text) {
  return String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(String);
}

function parseResources_(text) {
  return parseLines_(text).map(function (l) {
    var p = l.split('|');
    return { label: p[0].trim(), url: (p[1] || p[0]).trim() };
  });
}

function parseExercises_(text) {
  return parseLines_(text).map(function (l) {
    var p = l.split('|');
    return { id: String(p[0] || '').trim(), title: String(p[1] || '').trim(), instructions: p.slice(2).join('|').trim() };
  }).filter(function (x) { return x.id; });
}

function loadCourse_() {
  var phases = table_('Phases').rows.map(function (p) {
    return { phase: num_(p.phase, 0), title: String(p.title), weeks: String(p.weeks), focus: String(p.focus), threshold: num_(p.unlock_threshold, 100) };
  }).sort(function (a, b) { return a.phase - b.phase; });

  var modules = table_('Modules').rows.map(function (m) {
    var exercises = parseExercises_(m.exercises);
    var comps = {};
    if (String(m.ppt_url).trim()) comps.ppt = num_(m.w_ppt, 20);
    if (String(m.notes_url).trim() || String(m.notes_text).trim()) comps.notes = num_(m.w_notes, 20);
    if (exercises.length) comps.exercises = num_(m.w_exercises, 30);
    if (String(m.quiz_url).trim()) comps.quiz = num_(m.w_quiz, 30);
    return {
      id: String(m.module_id).trim(), phase: num_(m.phase, 0), order: num_(m.order, 0), week: String(m.week),
      title: String(m.title), description: String(m.description),
      ppt_url: String(m.ppt_url).trim(), notes_url: String(m.notes_url).trim(), notes_text: String(m.notes_text),
      resources: parseResources_(m.resources), exercises: exercises,
      quiz_url: String(m.quiz_url).trim(), pass_mark: num_(m.pass_mark, 70), max_attempts: num_(m.max_attempts, 0),
      comps: comps
    };
  }).filter(function (m) { return m.id; }).sort(function (a, b) { return a.phase - b.phase || a.order - b.order; });

  return { phases: phases, modules: modules };
}

function studentState_(email) {
  email = norm_(email);
  var done = {}, subs = {}, attempts = {};
  table_('Progress').rows.forEach(function (r) {
    if (norm_(r.email) === email && truthy_(r.value)) done[r.module_id + '::' + r.item] = true;
  });
  table_('Submissions').rows.forEach(function (r) {
    if (norm_(r.email) === email) subs[r.module_id + '::' + r.exercise_id] = { text: String(r.text), at: r.submitted_at };
  });
  table_('QuizAttempts').rows.forEach(function (r) {
    if (norm_(r.email) !== email) return;
    var a = attempts[r.module_id] || (attempts[r.module_id] = { count: 0, best: 0, passed: false, last: null });
    a.count++;
    a.best = Math.max(a.best, num_(r.pct, 0));
    if (truthy_(r.passed)) a.passed = true;
    a.last = num_(r.pct, 0);
  });
  return { done: done, subs: subs, attempts: attempts };
}

function modulePct_(m, st) {
  var total = 0, got = 0;
  Object.keys(m.comps).forEach(function (k) { total += m.comps[k]; });
  if (!total) return 0;   // no content configured yet = 0%, so it can't unlock the next phase by accident
  if (m.comps.ppt && st.done[m.id + '::ppt']) got += m.comps.ppt;
  if (m.comps.notes && st.done[m.id + '::notes']) got += m.comps.notes;
  if (m.comps.exercises) {
    var n = m.exercises.length, k = 0;
    m.exercises.forEach(function (ex) { if (st.done[m.id + '::ex:' + ex.id]) k++; });
    got += m.comps.exercises * (k / n);
  }
  if (m.comps.quiz && st.attempts[m.id] && st.attempts[m.id].passed) got += m.comps.quiz;
  return Math.round(got / total * 100);
}

function computeAccess_(student, course, st) {
  var pre = truthy_(student.preassessment_done);
  var manual = num_(student.unlocked_phase, 0);
  var phasePct = {}, unlocked = {};
  course.phases.forEach(function (p) {
    var mods = course.modules.filter(function (m) { return m.phase === p.phase; });
    var sum = 0;
    mods.forEach(function (m) { sum += modulePct_(m, st); });
    phasePct[p.phase] = mods.length ? Math.round(sum / mods.length) : 0;
  });
  course.phases.forEach(function (p, i) {
    if (!pre) { unlocked[p.phase] = false; return; }
    if (i === 0 || manual >= p.phase) { unlocked[p.phase] = true; return; }
    var prev = course.phases[i - 1];
    unlocked[p.phase] = unlocked[prev.phase] && phasePct[prev.phase] >= p.threshold;
  });
  return { pre: pre, phasePct: phasePct, unlocked: unlocked };
}

function dashboard_(student) {
  var course = loadCourse_();
  var st = studentState_(student.email);
  var acc = computeAccess_(student, course, st);
  var allPct = 0, current = null;

  var phases = course.phases.map(function (p, i) {
    var open = acc.unlocked[p.phase];
    var pct = acc.phasePct[p.phase];
    var status = !open ? 'locked' : pct >= 100 ? 'completed' : 'in_progress';
    if (open && pct < 100 && current === null) current = p.phase;
    var prev = course.phases[i - 1];
    var lockMsg = !acc.pre ? 'Complete your pre-assessment to start the course.'
      : prev ? 'Complete Phase ' + prev.phase + (p.threshold < 100 ? ' to ' + p.threshold + '%' : '') + ' to unlock Phase ' + p.phase + '. You are at ' + acc.phasePct[prev.phase] + '%.'
      : '';

    var modules = course.modules.filter(function (m) { return m.phase === p.phase; }).map(function (m) {
      var pctM = modulePct_(m, st);
      var base = { id: m.id, week: m.week, title: m.title, pct: pctM, hasContent: Object.keys(m.comps).length > 0 };
      if (!open) return base;   // locked: titles only, no content leaves the server
      var a = st.attempts[m.id] || { count: 0, best: 0, passed: false };
      base.description = m.description;
      base.status = pctM >= 100 ? 'completed' : pctM > 0 ? 'in_progress' : 'not_started';
      base.ppt = m.ppt_url ? { url: m.ppt_url, done: !!st.done[m.id + '::ppt'] } : null;
      base.notes = (m.notes_url || m.notes_text.trim()) ? { url: m.notes_url, text: m.notes_text, done: !!st.done[m.id + '::notes'] } : null;
      base.resources = m.resources;
      base.exercises = m.exercises.map(function (ex) {
        var sub = st.subs[m.id + '::' + ex.id];
        return { id: ex.id, title: ex.title, instructions: ex.instructions, done: !!st.done[m.id + '::ex:' + ex.id], submission: sub ? sub.text : '' };
      });
      base.quiz = m.quiz_url ? { url: m.quiz_url, pass_mark: m.pass_mark, max_attempts: m.max_attempts, attempts: a.count, best: a.best, passed: a.passed } : null;
      base.weights = m.comps;
      return base;
    });
    return { phase: p.phase, title: p.title, weeks: p.weeks, focus: p.focus, pct: pct, status: status, unlocked: open, lockMsg: open ? '' : lockMsg, modules: modules };
  });

  var n = course.modules.length;
  course.modules.forEach(function (m) { allPct += modulePct_(m, st); });

  return {
    student: { name: String(student.name || ''), email: norm_(student.email), preassessment_done: acc.pre },
    course: { title: 'Digital Marketing & AI Bootcamp' },
    overall: n ? Math.round(allPct / n) : 0,
    currentPhase: current,
    phases: phases
  };
}

/* ============ Actions that change progress ============ */

function moduleFor_(student, moduleId) {
  var course = loadCourse_();
  var m = null;
  course.modules.forEach(function (x) { if (x.id === String(moduleId)) m = x; });
  if (!m) throw new Error('Module not found.');
  var acc = computeAccess_(student, course, studentState_(student.email));
  if (!acc.pre) throw new Error('Please complete your pre-assessment first.');
  if (!acc.unlocked[m.phase]) throw new Error('This phase is locked.');
  return m;
}

function upsertProgress_(email, moduleId, item) {
  email = norm_(email);
  var rows = table_('Progress').rows;
  for (var i = 0; i < rows.length; i++) {
    if (norm_(rows[i].email) === email && String(rows[i].module_id) === moduleId && String(rows[i].item) === item) {
      update_('Progress', rows[i]._row, { value: 1, updated_at: now_() });
      return;
    }
  }
  append_('Progress', { email: email, module_id: moduleId, item: item, value: 1, updated_at: now_() });
}

function complete_(student, req) {
  var m = moduleFor_(student, req.module);
  var item = String(req.item || '');
  if (item === 'ppt') {
    if (!m.ppt_url) throw new Error('No presentation for this module yet.');
  } else if (item === 'notes') {
    if (!m.notes_url && !m.notes_text.trim()) throw new Error('No reading notes for this module yet.');
  } else if (item.indexOf('ex:') === 0) {
    var exId = item.slice(3), ex = null;
    m.exercises.forEach(function (x) { if (x.id === exId) ex = x; });
    if (!ex) throw new Error('Exercise not found.');
    var text = String(req.text || '').trim();
    if (text.length < 10) throw new Error('Please write your answer or paste a link to your work (at least 10 characters).');
    append_('Submissions', { email: norm_(student.email), module_id: m.id, exercise_id: exId, text: text.slice(0, 5000), submitted_at: now_() });
  } else {
    throw new Error('Unknown item.');
  }
  upsertProgress_(student.email, m.id, item);
  return { ok: true, data: dashboard_(findStudent_(student.email)) };
}

function quiz_(student, req) {
  var m = moduleFor_(student, req.module);
  if (!m.quiz_url) throw new Error('This module has no quiz yet.');
  var a = studentState_(student.email).attempts[m.id] || { count: 0, passed: false };
  if (m.max_attempts && a.count >= m.max_attempts && !a.passed) throw new Error('You have used all ' + m.max_attempts + ' attempts. Please contact your trainer.');
  var score = Math.max(0, Math.floor(num_(req.score, 0)));
  var total = Math.max(1, Math.floor(num_(req.total, 1)));
  if (score > total) throw new Error('Invalid score.');
  var pct = Math.round(score / total * 100);
  var passed = pct >= m.pass_mark;
  append_('QuizAttempts', {
    email: norm_(student.email), module_id: m.id, score: score, total: total, pct: pct, passed: passed,
    answers: String(req.answers || '').slice(0, 45000), attempted_at: now_()
  });
  return { ok: true, result: { pct: pct, passed: passed, pass_mark: m.pass_mark }, data: dashboard_(findStudent_(student.email)) };
}

function preassessmentDone_(student) {
  if (!truthy_(student.preassessment_done)) update_('Students', student._row, { preassessment_done: true });
  return { ok: true, data: dashboard_(findStudent_(student.email)) };
}

/* ============ One-off helpers you can run from the editor ============ */

/** Run once if any tab is missing: creates tabs with the right headers. */
function setup() {
  Object.keys(TABS).forEach(function (name) { sheet_(name); });
}

/** Reset a student's password: type their email below, then Run. They choose a new one at next login. */
function resetPassword() {
  var email = 'student@example.com';
  var s = findStudent_(email);
  if (!s) throw new Error('No student with email ' + email);
  update_('Students', s._row, { password_hash: '', salt: '' });
}
