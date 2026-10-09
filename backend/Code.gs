/**
 * Digital Marketing Training - learning platform backend (Google Apps Script web app)
 * ---------------------------------------------------------------------------------
 * Paste this whole file into Extensions > Apps Script of the
 * "DMM Learning Platform" Google Sheet, then Deploy > New deployment >
 * Web app (Execute as: Me, Who has access: Anyone).
 *
 * The Sheet is the database AND the content manager. Supports several courses:
 *   Students      people who can log in (role = student or trainer)
 *   Courses       one row per course (catalogue)
 *   Enrolments    which student is in which course, pre-assessment status, manual unlock
 *   Phases        phases of each course (course_id + phase number)
 *   Modules       modules of each course: PowerPoint, notes, exercises, quiz, weights
 *   Quizzes       questions for the built-in quiz engine (one row per question)
 *   Progress      completed items (one row per student x module x item, no duplicates)
 *   Submissions   exercise answers
 *   QuizAttempts  every quiz attempt
 *   Sessions      login tokens (do not edit)
 *
 * Every access rule (login, enrolment, pre-assessment, phase locks, retries,
 * quiz scoring for built-in quizzes) is checked here, on the server.
 */

var SESSION_DAYS = 14;
var MAX_LOGIN_FAILS = 6;
var TABS = {
  Students:     ['email', 'name', 'password_hash', 'salt', 'role', 'active', 'created_at', 'last_login'],
  Courses:      ['course_id', 'title', 'subtitle', 'description', 'image_url', 'duration', 'format', 'preassessment_url', 'status', 'order'],
  Enrolments:   ['email', 'course_id', 'preassessment_done', 'unlocked_phase', 'active', 'enrolled_at'],
  Phases:       ['course_id', 'phase', 'title', 'weeks', 'focus', 'unlock_threshold'],
  Modules:      ['course_id', 'module_id', 'phase', 'order', 'week', 'title', 'description', 'ppt_url', 'notes_url', 'notes_text', 'resources', 'exercises', 'quiz_url', 'pass_mark', 'max_attempts', 'w_ppt', 'w_notes', 'w_exercises', 'w_quiz'],
  Quizzes:      ['module_id', 'q_no', 'type', 'question', 'image_url', 'options', 'answer', 'explanation', 'model_answer'],
  Progress:     ['email', 'module_id', 'item', 'value', 'updated_at'],
  Submissions:  ['email', 'module_id', 'exercise_id', 'text', 'submitted_at'],
  QuizAttempts: ['email', 'module_id', 'score', 'total', 'pct', 'passed', 'answers', 'attempted_at'],
  Sessions:     ['token', 'email', 'expires_at']
};

/* ================= HTTP ================= */

function doGet() { return out_({ ok: true, service: 'Digital Marketing Training API' }); }

function doPost(e) {
  var req;
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return out_({ ok: false, error: 'Bad request.' }); }
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    _cache = {};
    return out_(route_(req));
  } catch (err) {
    return out_({ ok: false, error: String((err && err.message) || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function route_(req) {
  switch (req.action) {
    case 'catalog':           return { ok: true, courses: catalog_() };
    case 'login':             return login_(req);
    case 'setPassword':       return setPassword_(req);
    case 'logout':            return logout_(req);
    case 'myCourses':         return myCourses_(auth_(req));
    case 'dashboard':         return { ok: true, data: dashboard_(auth_(req), req.course) };
    case 'preassessmentDone': return preassessmentDone_(auth_(req), req.course);
    case 'complete':          return complete_(auth_(req), req);
    case 'quiz':              return quizLegacy_(auth_(req), req);
    case 'quizQuestions':     return quizQuestions_(auth_(req), req);
    case 'quizSubmit':        return quizSubmit_(auth_(req), req);
    case 'overview':          return overview_(auth_(req), req.course);
    case 'adminData':         return adminData_(req);
    case 'adminSave':         return adminSave_(req);
    case 'adminDelete':       return adminDelete_(req);
    case 'adminSaveQuiz':     return adminSaveQuiz_(req);
    case 'adminResetPassword':return adminResetPassword_(req);
    default: throw new Error('Unknown action.');
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ================= Sheet helpers ================= */

var _cache = {};

function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(TABS[name]); }
  return sh;
}

function table_(name) {
  if (_cache[name]) return _cache[name];
  var values = sheet_(name).getDataRange().getValues();
  var headers = (values[0] || []).map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var o = { _row: r + 1 }, empty = true;
    for (var c = 0; c < headers.length; c++) {
      o[headers[c]] = values[r][c];
      if (values[r][c] !== '' && values[r][c] !== null) empty = false;
    }
    if (!empty) rows.push(o);
  }
  _cache[name] = { headers: headers, rows: rows };
  return _cache[name];
}

function append_(name, obj) {
  var headers = table_(name).headers;
  sheet_(name).appendRow(headers.map(function (h) { return obj[h] === undefined ? '' : obj[h]; }));
  delete _cache[name];
}

function update_(name, row, obj) {
  var t = table_(name), sh = sheet_(name);
  var current = sh.getRange(row, 1, 1, t.headers.length).getValues()[0];
  var next = t.headers.map(function (h, i) { return obj.hasOwnProperty(h) ? obj[h] : current[i]; });
  sh.getRange(row, 1, 1, t.headers.length).setValues([next]);
  delete _cache[name];
}

function truthy_(v) {
  var s = String(v).trim().toLowerCase();
  return v === true || s === 'true' || s === 'yes' || s === 'y' || s === '1' || s === 'x';
}
function blankOrTrue_(v) { return String(v).trim() === '' ? true : truthy_(v); }
function num_(v, d) { var n = parseFloat(v); return isNaN(n) ? d : n; }
function now_() { return new Date(); }
function norm_(e) { return String(e || '').trim().toLowerCase(); }
function str_(v) { return String(v == null ? '' : v).trim(); }

/* ================= Auth ================= */

function hash_(pw, salt) {
  var v = salt + '|' + pw;
  for (var i = 0; i < 200; i++) {
    v = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, v, Utilities.Charset.UTF_8));
  }
  return v;
}

function findStudent_(email) {
  email = norm_(email);
  var rows = table_('Students').rows;
  for (var i = 0; i < rows.length; i++) if (norm_(rows[i].email) === email) return rows[i];
  return null;
}

function isTrainer_(s) { return str_(s.role).toLowerCase() === 'trainer'; }

function newSession_(email) {
  var token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  append_('Sessions', { token: token, email: norm_(email), expires_at: new Date(now_().getTime() + SESSION_DAYS * 864e5) });
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
      if (!s || !blankOrTrue_(s.active)) throw new Error('AUTH: Your access is not active. Please contact your trainer.');
      return s;
    }
  }
  throw new Error('AUTH: Please log in.');
}

function login_(req) {
  var email = norm_(req.email);
  if (!email) return { ok: false, error: 'Please enter your email.' };
  var cache = CacheService.getScriptCache(), key = 'fail_' + email;
  var fails = num_(cache.get(key), 0);
  if (fails >= MAX_LOGIN_FAILS) return { ok: false, error: 'Too many attempts. Please wait 15 minutes and try again.' };
  var s = findStudent_(email);
  if (!s || !blankOrTrue_(s.active)) return { ok: false, error: 'This email is not enrolled. Please use the email you registered with, or contact your trainer.' };
  if (!str_(s.password_hash)) return { ok: true, needPassword: true, name: str_(s.name) };
  if (hash_(String(req.password || ''), String(s.salt)) !== String(s.password_hash)) {
    cache.put(key, String(fails + 1), 900);
    return { ok: false, error: 'Incorrect password. Please try again.' };
  }
  cache.remove(key);
  update_('Students', s._row, { last_login: now_() });
  return { ok: true, token: newSession_(email), name: str_(s.name), role: isTrainer_(s) ? 'trainer' : 'student' };
}

function setPassword_(req) {
  var email = norm_(req.email), s = findStudent_(email);
  if (!s || !blankOrTrue_(s.active)) return { ok: false, error: 'This email is not enrolled.' };
  if (str_(s.password_hash)) return { ok: false, error: 'A password already exists for this email. Log in, or ask your trainer to reset it.' };
  var pw = String(req.password || '');
  if (pw.length < 8) return { ok: false, error: 'Please choose a password of at least 8 characters.' };
  var salt = Utilities.getUuid();
  var patch = { password_hash: hash_(pw, salt), salt: salt, last_login: now_() };
  if (!str_(s.created_at)) patch.created_at = now_();
  update_('Students', s._row, patch);
  return { ok: true, token: newSession_(email), name: str_(s.name), role: isTrainer_(s) ? 'trainer' : 'student' };
}

function logout_(req) {
  table_('Sessions').rows.forEach(function (r) { if (r.token === req.token) update_('Sessions', r._row, { expires_at: new Date(0) }); });
  return { ok: true };
}

/* ================= Content ================= */

function lines_(t) { return String(t || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(String); }

function courses_() {
  return table_('Courses').rows.map(function (c) {
    return {
      id: str_(c.course_id), title: str_(c.title), subtitle: str_(c.subtitle), description: str_(c.description),
      image_url: str_(c.image_url), duration: str_(c.duration), format: str_(c.format),
      preassessment_url: str_(c.preassessment_url), status: str_(c.status).toLowerCase() || 'published', order: num_(c.order, 99)
    };
  }).filter(function (c) { return c.id; }).sort(function (a, b) { return a.order - b.order; });
}

function course_(id) {
  var list = courses_();
  for (var i = 0; i < list.length; i++) if (list[i].id === str_(id)) return list[i];
  return null;
}

function quizRows_(moduleId) {
  return table_('Quizzes').rows.filter(function (q) { return str_(q.module_id) === moduleId && str_(q.question); })
    .sort(function (a, b) { return num_(a.q_no, 0) - num_(b.q_no, 0); });
}

function loadCourse_(courseId) {
  courseId = str_(courseId);
  var phases = table_('Phases').rows.filter(function (p) { return str_(p.course_id) === courseId; }).map(function (p) {
    return { phase: num_(p.phase, 0), title: str_(p.title), weeks: str_(p.weeks), focus: str_(p.focus), threshold: num_(p.unlock_threshold, 100) };
  }).sort(function (a, b) { return a.phase - b.phase; });

  var modules = table_('Modules').rows.filter(function (m) { return str_(m.course_id) === courseId && str_(m.module_id); }).map(function (m) {
    var id = str_(m.module_id);
    var exercises = lines_(m.exercises).map(function (l) {
      var p = l.split('|');
      return { id: str_(p[0]), title: str_(p[1]), instructions: p.slice(2).join('|').trim() };
    }).filter(function (x) { return x.id; });
    var built = quizRows_(id).length;
    var quizUrl = str_(m.quiz_url) || (built ? '/quiz?m=' + encodeURIComponent(id) : '');
    var comps = {};
    if (str_(m.ppt_url)) comps.ppt = num_(m.w_ppt, 20);
    if (str_(m.notes_url) || str_(m.notes_text)) comps.notes = num_(m.w_notes, 20);
    if (exercises.length) comps.exercises = num_(m.w_exercises, 30);
    if (quizUrl) comps.quiz = num_(m.w_quiz, 30);
    return {
      id: id, course: courseId, phase: num_(m.phase, 0), order: num_(m.order, 0), week: str_(m.week),
      title: str_(m.title), description: str_(m.description), ppt_url: str_(m.ppt_url), notes_url: str_(m.notes_url),
      notes_text: String(m.notes_text || ''), exercises: exercises, quiz_url: quizUrl, builtQuiz: built,
      resources: lines_(m.resources).map(function (l) { var p = l.split('|'); return { label: str_(p[0]), url: str_(p[1] || p[0]) }; }),
      pass_mark: num_(m.pass_mark, 70), max_attempts: num_(m.max_attempts, 0), comps: comps
    };
  }).sort(function (a, b) { return a.phase - b.phase || a.order - b.order; });
  return { phases: phases, modules: modules };
}

function findModule_(moduleId) {
  var r = table_('Modules').rows;
  for (var i = 0; i < r.length; i++) if (str_(r[i].module_id) === str_(moduleId)) {
    var c = loadCourse_(r[i].course_id);
    for (var j = 0; j < c.modules.length; j++) if (c.modules[j].id === str_(moduleId)) return { m: c.modules[j], course: c };
  }
  return null;
}

function catalog_() {
  return courses_().filter(function (c) { return c.status === 'published'; }).map(function (c) {
    var lc = loadCourse_(c.id);
    return {
      id: c.id, title: c.title, subtitle: c.subtitle, description: c.description, image_url: c.image_url,
      duration: c.duration, format: c.format, modules: lc.modules.length,
      phases: lc.phases.map(function (p) { return { phase: p.phase, title: p.title, weeks: p.weeks, focus: p.focus }; })
    };
  });
}

/* ================= Enrolment & progress ================= */

function enrolment_(student, courseId) {
  if (isTrainer_(student)) return { trainer: true, preassessment_done: true, unlocked_phase: 99 };
  var e = norm_(student.email), rows = table_('Enrolments').rows;
  for (var i = 0; i < rows.length; i++) {
    if (norm_(rows[i].email) === e && str_(rows[i].course_id) === str_(courseId) && blankOrTrue_(rows[i].active)) return rows[i];
  }
  return null;
}

function state_(email) {
  email = norm_(email);
  var done = {}, subs = {}, attempts = {}, last = null;
  function seen(d) { d = d ? new Date(d) : null; if (d && (!last || d > last)) last = d; }
  table_('Progress').rows.forEach(function (r) { if (norm_(r.email) === email && truthy_(r.value)) { done[r.module_id + '::' + r.item] = true; seen(r.updated_at); } });
  table_('Submissions').rows.forEach(function (r) { if (norm_(r.email) === email) { subs[r.module_id + '::' + r.exercise_id] = String(r.text); seen(r.submitted_at); } });
  table_('QuizAttempts').rows.forEach(function (r) {
    if (norm_(r.email) !== email) return;
    var a = attempts[r.module_id] || (attempts[r.module_id] = { count: 0, best: 0, passed: false });
    a.count++; a.best = Math.max(a.best, num_(r.pct, 0)); if (truthy_(r.passed)) a.passed = true; seen(r.attempted_at);
  });
  return { done: done, subs: subs, attempts: attempts, last: last };
}

function modulePct_(m, st) {
  var total = 0, got = 0;
  Object.keys(m.comps).forEach(function (k) { total += m.comps[k]; });
  if (!total) return 0;
  if (m.comps.ppt && st.done[m.id + '::ppt']) got += m.comps.ppt;
  if (m.comps.notes && st.done[m.id + '::notes']) got += m.comps.notes;
  if (m.comps.exercises) {
    var k = 0;
    m.exercises.forEach(function (ex) { if (st.done[m.id + '::ex:' + ex.id]) k++; });
    got += m.comps.exercises * k / m.exercises.length;
  }
  if (m.comps.quiz && st.attempts[m.id] && st.attempts[m.id].passed) got += m.comps.quiz;
  return Math.round(got / total * 100);
}

function access_(enrol, course, lc, st) {
  var pre = enrol.trainer || !course.preassessment_url || truthy_(enrol.preassessment_done);
  var manual = num_(enrol.unlocked_phase, 0), pct = {}, open = {};
  lc.phases.forEach(function (p) {
    var mods = lc.modules.filter(function (m) { return m.phase === p.phase; }), sum = 0;
    mods.forEach(function (m) { sum += modulePct_(m, st); });
    pct[p.phase] = mods.length ? Math.round(sum / mods.length) : 0;
  });
  lc.phases.forEach(function (p, i) {
    if (!pre) { open[p.phase] = false; return; }
    if (i === 0 || manual >= p.phase) { open[p.phase] = true; return; }
    var prev = lc.phases[i - 1];
    open[p.phase] = open[prev.phase] && pct[prev.phase] >= p.threshold;
  });
  var all = 0;
  lc.modules.forEach(function (m) { all += modulePct_(m, st); });
  return { pre: pre, pct: pct, open: open, overall: lc.modules.length ? Math.round(all / lc.modules.length) : 0 };
}

function myCourses_(student) {
  var st = state_(student.email), list = [];
  courses_().forEach(function (c) {
    var enrol = enrolment_(student, c.id);
    if (!enrol) return;
    if (c.status !== 'published' && !enrol.trainer) return;
    var lc = loadCourse_(c.id), acc = access_(enrol, c, lc, st), cur = null;
    lc.phases.forEach(function (p) { if (cur === null && acc.open[p.phase] && acc.pct[p.phase] < 100) cur = p; });
    list.push({ id: c.id, title: c.title, subtitle: c.subtitle, image_url: c.image_url, duration: c.duration, status: c.status,
      overall: acc.overall, preassessment_done: acc.pre, current: cur ? { phase: cur.phase, title: cur.title } : null, phases: lc.phases.length });
  });
  return { ok: true, role: isTrainer_(student) ? 'trainer' : 'student', name: str_(student.name), courses: list };
}

function dashboard_(student, courseId) {
  var c = course_(courseId);
  if (!c) throw new Error('Course not found.');
  var enrol = enrolment_(student, c.id);
  if (!enrol) throw new Error('You are not enrolled in this course. Please contact your trainer.');
  var lc = loadCourse_(c.id), st = state_(student.email), acc = access_(enrol, c, lc, st), current = null;

  var phases = lc.phases.map(function (p, i) {
    var open = acc.open[p.phase], pct = acc.pct[p.phase], prev = lc.phases[i - 1];
    if (open && pct < 100 && current === null) current = p.phase;
    var lockMsg = !acc.pre ? 'Complete your pre-assessment to start the course.'
      : prev ? 'Complete Phase ' + prev.phase + (p.threshold < 100 ? ' to ' + p.threshold + '%' : '') + ' to unlock Phase ' + p.phase + '. You are at ' + acc.pct[prev.phase] + '%.' : '';
    var modules = lc.modules.filter(function (m) { return m.phase === p.phase; }).map(function (m) {
      var mp = modulePct_(m, st);
      var b = { id: m.id, week: m.week, title: m.title, pct: mp, hasContent: Object.keys(m.comps).length > 0 };
      if (!open) return b;   // locked: titles only
      var a = st.attempts[m.id] || { count: 0, best: 0, passed: false };
      b.description = m.description;
      b.ppt = m.ppt_url ? { url: m.ppt_url, done: !!st.done[m.id + '::ppt'] } : null;
      b.notes = (m.notes_url || str_(m.notes_text)) ? { url: m.notes_url, text: m.notes_text, done: !!st.done[m.id + '::notes'] } : null;
      b.resources = m.resources;
      b.exercises = m.exercises.map(function (ex) {
        return { id: ex.id, title: ex.title, instructions: ex.instructions, done: !!st.done[m.id + '::ex:' + ex.id], submission: st.subs[m.id + '::' + ex.id] || '' };
      });
      b.quiz = m.quiz_url ? { url: m.quiz_url, pass_mark: m.pass_mark, max_attempts: m.max_attempts, attempts: a.count, best: a.best, passed: a.passed, questions: m.builtQuiz || 20 } : null;
      b.weights = m.comps;
      return b;
    });
    return { phase: p.phase, title: p.title, weeks: p.weeks, focus: p.focus, pct: pct, status: !open ? 'locked' : pct >= 100 ? 'completed' : 'in_progress', unlocked: open, lockMsg: open ? '' : lockMsg, modules: modules };
  });

  return {
    student: { name: str_(student.name), email: norm_(student.email), role: enrol.trainer ? 'trainer' : 'student', preassessment_done: acc.pre },
    course: { id: c.id, title: c.title, subtitle: c.subtitle, preassessment_url: c.preassessment_url },
    overall: acc.overall, currentPhase: current, phases: phases
  };
}

function moduleFor_(student, moduleId) {
  var f = findModule_(moduleId);
  if (!f) throw new Error('Module not found.');
  var c = course_(f.m.course), enrol = enrolment_(student, f.m.course);
  if (!enrol) throw new Error('You are not enrolled in this course.');
  var acc = access_(enrol, c, f.course, state_(student.email));
  if (!acc.pre) throw new Error('Please complete your pre-assessment first.');
  if (!acc.open[f.m.phase]) throw new Error('This phase is locked.');
  return f.m;
}

function upsert_(email, moduleId, item) {
  email = norm_(email);
  var rows = table_('Progress').rows;
  for (var i = 0; i < rows.length; i++) {
    if (norm_(rows[i].email) === email && str_(rows[i].module_id) === moduleId && str_(rows[i].item) === item) {
      update_('Progress', rows[i]._row, { value: 1, updated_at: now_() });
      return;
    }
  }
  append_('Progress', { email: email, module_id: moduleId, item: item, value: 1, updated_at: now_() });
}

function complete_(student, req) {
  var m = moduleFor_(student, req.module), item = str_(req.item);
  if (item === 'ppt') { if (!m.ppt_url) throw new Error('No presentation for this module yet.'); }
  else if (item === 'notes') { if (!m.notes_url && !str_(m.notes_text)) throw new Error('No reading notes for this module yet.'); }
  else if (item.indexOf('ex:') === 0) {
    var exId = item.slice(3);
    if (!m.exercises.some(function (x) { return x.id === exId; })) throw new Error('Exercise not found.');
    var text = str_(req.text);
    if (text.length < 10) throw new Error('Please write your answer or paste a link to your work (at least 10 characters).');
    append_('Submissions', { email: norm_(student.email), module_id: m.id, exercise_id: exId, text: text.slice(0, 5000), submitted_at: now_() });
  } else throw new Error('Unknown item.');
  upsert_(student.email, m.id, item);
  return { ok: true, data: dashboard_(findStudent_(student.email), m.course) };
}

function checkAttempts_(student, m) {
  var a = state_(student.email).attempts[m.id] || { count: 0, passed: false };
  if (m.max_attempts && a.count >= m.max_attempts && !a.passed) throw new Error('You have used all ' + m.max_attempts + ' attempts. Please contact your trainer.');
  return a;
}

function recordAttempt_(student, m, score, total, answers) {
  var pct = total ? Math.round(score / total * 100) : 100, passed = pct >= m.pass_mark;
  append_('QuizAttempts', { email: norm_(student.email), module_id: m.id, score: score, total: total, pct: pct, passed: passed, answers: String(answers || '').slice(0, 45000), attempted_at: now_() });
  return { pct: pct, passed: passed, pass_mark: m.pass_mark };
}

/* Custom quiz pages (e.g. Module 1's illustrated quiz) score in the browser and send the score. */
function quizLegacy_(student, req) {
  var m = moduleFor_(student, req.module);
  if (!m.quiz_url) throw new Error('This module has no quiz yet.');
  checkAttempts_(student, m);
  var score = Math.max(0, Math.floor(num_(req.score, 0))), total = Math.max(1, Math.floor(num_(req.total, 1)));
  if (score > total) throw new Error('Invalid score.');
  var result = recordAttempt_(student, m, score, total, req.answers);
  return { ok: true, result: result, data: dashboard_(findStudent_(student.email), m.course) };
}

/* Built-in quiz engine: questions come from the Quizzes tab, answers never leave the server before submission. */
function parseQuiz_(m) {
  return quizRows_(m.id).map(function (q, i) {
    var type = str_(q.type).toLowerCase() === 'open' ? 'open' : 'mcq';
    var options = lines_(q.options);
    var ans = str_(q.answer).toUpperCase(), idx = -1;
    if (/^[A-H]$/.test(ans)) idx = ans.charCodeAt(0) - 65; else if (/^\d+$/.test(ans)) idx = parseInt(ans, 10) - 1;
    return { n: i + 1, type: type, question: str_(q.question), image_url: str_(q.image_url), options: type === 'mcq' ? options : [], answer: idx, explanation: str_(q.explanation), model_answer: str_(q.model_answer) };
  });
}

function quizQuestions_(student, req) {
  var m = moduleFor_(student, req.module), qs = parseQuiz_(m);
  if (!qs.length) throw new Error('This quiz has no questions yet.');
  var a = state_(student.email).attempts[m.id] || { count: 0, best: 0, passed: false };
  return {
    ok: true, module: { id: m.id, title: m.title, week: m.week, course: m.course, pass_mark: m.pass_mark, max_attempts: m.max_attempts },
    attempts: a, questions: qs.map(function (q) { return { n: q.n, type: q.type, question: q.question, image_url: q.image_url, options: q.options }; })
  };
}

function quizSubmit_(student, req) {
  var m = moduleFor_(student, req.module), qs = parseQuiz_(m);
  if (!qs.length) throw new Error('This quiz has no questions yet.');
  checkAttempts_(student, m);
  var given = req.answers || {}, score = 0, total = 0, review = [], lines = [];
  qs.forEach(function (q) {
    var g = given[q.n];
    if (q.type === 'mcq') {
      total++;
      var pick = (g === null || g === undefined || g === '') ? -1 : parseInt(g, 10), ok = pick === q.answer;
      if (ok) score++;
      review.push({ n: q.n, type: 'mcq', picked: pick, correct: q.answer, ok: ok, explanation: q.explanation });
      lines.push('Q' + q.n + ' [MCQ] ' + (pick >= 0 ? String.fromCharCode(65 + pick) : '-') + (ok ? ' (correct)' : ' (correct: ' + String.fromCharCode(65 + q.answer) + ')'));
    } else {
      var text = str_(g).slice(0, 3000);
      review.push({ n: q.n, type: 'open', text: text, model_answer: q.model_answer, explanation: q.explanation });
      lines.push('Q' + q.n + ' [OPEN] ' + text);
    }
  });
  var result = recordAttempt_(student, m, score, total, lines.join('\n'));
  result.score = score; result.total = total;
  return { ok: true, result: result, review: review };
}

function preassessmentDone_(student, courseId) {
  courseId = str_(courseId);
  if (!courseId) { var mine = myCourses_(student).courses; courseId = mine.length ? mine[0].id : ''; }
  var enrol = enrolment_(student, courseId);
  if (!enrol) throw new Error('You are not enrolled in this course.');
  if (!enrol.trainer && !truthy_(enrol.preassessment_done)) update_('Enrolments', enrol._row, { preassessment_done: true });
  return { ok: true, data: dashboard_(findStudent_(student.email), courseId) };
}

/* Trainer only: progress of every enrolled student in a course. */
function overview_(student, courseId) {
  if (!isTrainer_(student)) throw new Error('Trainer access only.');
  var c = course_(courseId);
  if (!c) throw new Error('Course not found.');
  var lc = loadCourse_(c.id), rows = [];
  table_('Enrolments').rows.forEach(function (e) {
    if (str_(e.course_id) !== c.id || !blankOrTrue_(e.active)) return;
    var s = findStudent_(e.email);
    if (!s) return;
    var st = state_(e.email), acc = access_(e, c, lc, st), cur = null, subs = 0;
    lc.phases.forEach(function (p) { if (cur === null && acc.open[p.phase] && acc.pct[p.phase] < 100) cur = p.phase; });
    Object.keys(st.subs).forEach(function (k) { if (lc.modules.some(function (m) { return k.indexOf(m.id + '::') === 0; })) subs++; });
    rows.push({
      name: str_(s.name), email: norm_(e.email), preassessment_done: acc.pre, overall: acc.overall, currentPhase: cur,
      phases: lc.phases.map(function (p) { return acc.open[p.phase] ? acc.pct[p.phase] : null; }),
      modules: lc.modules.filter(function (m) { return Object.keys(m.comps).length; }).map(function (m) {
        var a = st.attempts[m.id];
        return { id: m.id, pct: modulePct_(m, st), quizBest: a ? a.best : null };
      }),
      submissions: subs, lastActive: st.last ? st.last.toISOString() : '', hasPassword: !!str_(s.password_hash)
    });
  });
  return { ok: true, course: { id: c.id, title: c.title }, phases: lc.phases.map(function (p) { return { phase: p.phase, title: p.title }; }), students: rows };
}

/* ================= Admin (trainer only) ================= */

var ADMIN_TABS = {
  Courses:    { key: ['course_id'] },
  Phases:     { key: ['course_id', 'phase'] },
  Modules:    { key: ['module_id'] },
  Students:   { key: ['email'], deny: ['password_hash', 'salt', 'created_at', 'last_login'] },
  Enrolments: { key: ['email', 'course_id'] }
};

function requireTrainer_(req) {
  var s = auth_(req);
  if (!isTrainer_(s)) throw new Error('Trainer access only.');
  return s;
}

function plain_(v) { return v instanceof Date ? (isNaN(v) ? '' : v.toISOString()) : v; }

function rowsOut_(name, hide) {
  return table_(name).rows.map(function (r) {
    var o = {};
    TABS[name].forEach(function (h) { if (!hide || hide.indexOf(h) < 0) o[h] = plain_(r[h] === undefined ? '' : r[h]); });
    return o;
  });
}

function adminData_(req) {
  requireTrainer_(req);
  var students = table_('Students').rows.map(function (s) {
    return { email: norm_(s.email), name: str_(s.name), role: str_(s.role) || 'student', active: s.active === '' ? true : truthy_(s.active),
             has_password: !!str_(s.password_hash), created_at: plain_(s.created_at), last_login: plain_(s.last_login) };
  });
  return {
    ok: true, courses: rowsOut_('Courses'), phases: rowsOut_('Phases'), modules: rowsOut_('Modules'),
    quizzes: rowsOut_('Quizzes'), enrolments: rowsOut_('Enrolments'), students: students
  };
}

function cleanAdminRow_(tab, row) {
  var spec = ADMIN_TABS[tab], deny = spec.deny || [], o = {};
  TABS[tab].forEach(function (h) {
    if (deny.indexOf(h) >= 0 || !row.hasOwnProperty(h)) return;
    var v = row[h];
    if (typeof v === 'boolean' || typeof v === 'number') o[h] = v;
    else o[h] = String(v == null ? '' : v).replace(/\r\n/g, '\n').trim();
  });
  if (o.hasOwnProperty('email')) o.email = norm_(o.email);
  spec.key.forEach(function (k) { if (!str_(o[k])) throw new Error('Please fill in "' + k + '".'); });
  if (o.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.email)) throw new Error('That email address does not look right.');
  if (o.course_id && tab !== 'Courses' && !course_(o.course_id)) throw new Error('Unknown course "' + o.course_id + '".');
  if (tab === 'Enrolments' && !findStudent_(o.email)) throw new Error('Add ' + o.email + ' as a student first.');
  ['ppt_url', 'notes_url', 'image_url', 'quiz_url', 'preassessment_url'].forEach(function (k) {
    if (o[k] && !/^(https?:\/\/|\/)/.test(o[k])) throw new Error('"' + k + '" must start with https:// (or / for a page on this site).');
  });
  return o;
}

function findByKey_(tab, keyObj) {
  var keys = ADMIN_TABS[tab].key, rows = table_(tab).rows;
  for (var i = 0; i < rows.length; i++) {
    var ok = keys.every(function (k) {
      return k === 'email' ? norm_(rows[i][k]) === norm_(keyObj[k]) : str_(rows[i][k]) === str_(keyObj[k]);
    });
    if (ok) return rows[i];
  }
  return null;
}

function adminSave_(req) {
  requireTrainer_(req);
  var tab = String(req.tab || '');
  if (!ADMIN_TABS[tab]) throw new Error('Unknown table.');
  var row = cleanAdminRow_(tab, req.row || {});
  var original = req.original ? req.original : row;           /* lets you rename a key */
  var existing = findByKey_(tab, original);
  if (req.original && findByKey_(tab, row) && (!existing || findByKey_(tab, row)._row !== existing._row)) throw new Error('That one already exists.');
  if (existing) update_(tab, existing._row, row);
  else {
    if (tab === 'Students') { row.created_at = now_(); if (!row.role) row.role = 'student'; if (!row.hasOwnProperty('active')) row.active = true; }
    if (tab === 'Enrolments') { row.enrolled_at = row.enrolled_at || now_(); if (!row.hasOwnProperty('active')) row.active = true; }
    append_(tab, row);
  }
  if (tab === 'Modules' && req.original && str_(req.original.module_id) && str_(req.original.module_id) !== row.module_id) {
    table_('Quizzes').rows.forEach(function (q) { if (str_(q.module_id) === str_(req.original.module_id)) update_('Quizzes', q._row, { module_id: row.module_id }); });
  }
  return { ok: true, created: !existing };
}

function deleteRows_(tab, pred) {
  var sh = sheet_(tab), rows = table_(tab).rows.filter(pred).map(function (r) { return r._row; }).sort(function (a, b) { return b - a; });
  rows.forEach(function (r) { sh.deleteRow(r); });
  delete _cache[tab];
  return rows.length;
}

function adminDelete_(req) {
  requireTrainer_(req);
  var tab = String(req.tab || '');
  if (!ADMIN_TABS[tab]) throw new Error('Unknown table.');
  if (tab === 'Students') throw new Error('Students are not deleted: switch them to inactive instead, so their history is kept.');
  var target = findByKey_(tab, req.key || {});
  if (!target) throw new Error('Nothing to delete.');
  if (tab === 'Courses' && table_('Enrolments').rows.some(function (e) { return str_(e.course_id) === str_(target.course_id); })) {
    throw new Error('This course has students enrolled. Set its status to "draft" instead.');
  }
  deleteRows_(tab, function (r) { return r._row === target._row; });
  if (tab === 'Modules') deleteRows_('Quizzes', function (q) { return str_(q.module_id) === str_(target.module_id); });
  return { ok: true };
}

/* Replaces every question of one module in a single save. */
function adminSaveQuiz_(req) {
  requireTrainer_(req);
  var id = str_(req.module_id);
  if (!id || !findByKey_('Modules', { module_id: id })) throw new Error('Unknown module.');
  var qs = (req.questions || []).filter(function (q) { return str_(q.question); });
  if (qs.length > 60) throw new Error('A quiz can have up to 60 questions.');
  qs.forEach(function (q, i) {
    var t = str_(q.type).toLowerCase() === 'open' ? 'open' : 'mcq';
    if (t === 'mcq') {
      var opts = lines_(q.options);
      if (opts.length < 2) throw new Error('Question ' + (i + 1) + ': add at least 2 options (one per line).');
      var a = str_(q.answer).toUpperCase();
      if (opts.length > 8) throw new Error('Question ' + (i + 1) + ': up to 8 options.');
      if (!/^[A-H]$/.test(a) || a.charCodeAt(0) - 65 >= opts.length) throw new Error('Question ' + (i + 1) + ': choose which option is correct.');
    }
  });
  deleteRows_('Quizzes', function (q) { return str_(q.module_id) === id; });
  var sh = sheet_('Quizzes'), headers = table_('Quizzes').headers;
  var values = qs.map(function (q, i) {
    var t = str_(q.type).toLowerCase() === 'open' ? 'open' : 'mcq';
    var o = { module_id: id, q_no: i + 1, type: t, question: str_(q.question), image_url: str_(q.image_url),
              options: t === 'mcq' ? lines_(q.options).join('\n') : '', answer: t === 'mcq' ? str_(q.answer).toUpperCase() : '',
              explanation: str_(q.explanation), model_answer: str_(q.model_answer) };
    return headers.map(function (h) { return o[h] === undefined ? '' : o[h]; });
  });
  if (values.length) sh.getRange(sh.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
  delete _cache.Quizzes;
  return { ok: true, saved: values.length };
}

function adminResetPassword_(req) {
  var me = requireTrainer_(req);
  var s = findStudent_(req.email);
  if (!s) throw new Error('No student with that email.');
  if (norm_(s.email) === norm_(me.email)) throw new Error('You cannot reset your own password here.');
  update_('Students', s._row, { password_hash: '', salt: '' });
  table_('Sessions').rows.forEach(function (r) { if (norm_(r.email) === norm_(s.email)) update_('Sessions', r._row, { expires_at: new Date(0) }); });
  return { ok: true };
}

/* ================= Helpers to run from the editor ================= */

/** Creates any missing tab with the right headers. */
function setup() { Object.keys(TABS).forEach(function (n) { sheet_(n); }); }

/** Reset a password: type the email, then Run. The person chooses a new one at next login. */
function resetPassword() {
  var email = 'student@example.com';
  var s = findStudent_(email);
  if (!s) throw new Error('No student with email ' + email);
  update_('Students', s._row, { password_hash: '', salt: '' });
}
