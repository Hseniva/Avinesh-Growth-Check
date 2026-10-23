

/* ================= Admin backend (Sharmila only) + participant tracking ================= */
function ss_() { return SpreadsheetApp.openById(CODES_SHEET); }
function codesTab_() { return ss_().getSheets()[0]; }
function tab_(name, header) {
  var s = ss_(), sh = s.getSheetByName(name);
  if (!sh) { sh = s.insertSheet(name); sh.appendRow(header); sh.setFrozenRows(1); sh.getRange(1, 1, 1, header.length).setFontWeight('bold'); }
  return sh;
}
var P_HEAD_ = ['client', 'name', 'cohort', 'max day', 'first seen', 'last seen'];
var S_HEAD_ = ['client', 'name', 'module', 'best score', 'total', 'attempts', 'last attempt'];
var C_HEAD_ = ['cohort', 'start date', 'notes', 'created'];
function clean_(s, n) { return String(s == null ? '' : s).replace(/[<>]/g, '').trim().slice(0, n || 80); }
function withLock_(fn) { var l = LockService.getScriptLock(); l.waitLock(15000); try { return fn(); } finally { l.releaseLock(); } }
function fmt_(d) { return d instanceof Date ? Utilities.formatDate(d, 'Indian/Mauritius', 'yyyy-MM-dd HH:mm') : String(d || ''); }

function logVisit_(req, u) {
  var name = clean_(req.name, 80), client = clean_(req.client, 60);
  if (!name || !client) return;
  var cohort = '', rows = codeRows_();
  (u.valid || []).forEach(function (c) { rows.forEach(function (r) { if (!cohort && String(r[0]).trim().toUpperCase() === c) cohort = String(r[2] || ''); }); });
  withLock_(function () {
    var sh = tab_('Participants', P_HEAD_), data = sh.getDataRange().getValues(), now = new Date();
    for (var i = 1; i < data.length; i++) if (String(data[i][0]) === client) {
      sh.getRange(i + 1, 2, 1, 5).setValues([[name, cohort || data[i][2], Math.max(Number(data[i][3]) || 0, u.maxDay), data[i][4], now]]);
      return;
    }
    sh.appendRow([client, name, cohort, u.maxDay, now, now]);
  });
}

function score_(req) {
  var client = clean_(req.client, 60), name = clean_(req.name, 80), n = Number(req.n), sc = Number(req.score), tot = Number(req.total);
  if (!client || !(n >= 1 && n <= 10) || !(tot > 0 && tot <= 20) || !(sc >= 0 && sc <= tot)) return { ok: false, error: 'Bad score.' };
  return withLock_(function () {
    var sh = tab_('Scores', S_HEAD_), data = sh.getDataRange().getValues(), now = new Date();
    for (var i = 1; i < data.length; i++) if (String(data[i][0]) === client && Number(data[i][2]) === n) {
      sh.getRange(i + 1, 2, 1, 6).setValues([[name || data[i][1], n, Math.max(Number(data[i][3]) || 0, sc), tot, (Number(data[i][5]) || 0) + 1, now]]);
      return { ok: true };
    }
    sh.appendRow([client, name, n, sc, tot, 1, now]);
    return { ok: true };
  });
}

/* ---- admin auth ---- */
function hash_(s) { return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); }
function auth_(req) { if (!req.token || !CacheService.getScriptCache().get('adm_' + req.token)) throw new Error('AUTH'); }
function newToken_() { var t = Utilities.getUuid() + Utilities.getUuid(); CacheService.getScriptCache().put('adm_' + t, '1', 21600); return t; }
function makeSetupKey() {
  if (props_().getProperty('ADMIN_HASH')) { Logger.log('Admin password already set.'); return; }
  var a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', k = '';
  for (var i = 0; i < 10; i++) k += a.charAt(Math.floor(Math.random() * a.length));
  props_().setProperty('SETUP_KEY', k);
  Logger.log('SETUP KEY: ' + k);
}
function adminStatus_() { return { ok: true, setup: !props_().getProperty('ADMIN_HASH') }; }
function adminSetup_(req) {
  var p = props_();
  if (p.getProperty('ADMIN_HASH')) return { ok: false, error: 'The admin password is already set. Please log in.' };
  if (!p.getProperty('SETUP_KEY') || String(req.key || '').trim().toUpperCase() !== p.getProperty('SETUP_KEY')) return { ok: false, error: 'That setup key is not valid.' };
  var pw = String(req.password || '');
  if (pw.length < 8) return { ok: false, error: 'Please choose a password of at least 8 characters.' };
  var salt = Utilities.getUuid();
  p.setProperty('ADMIN_SALT', salt); p.setProperty('ADMIN_HASH', hash_(salt + pw)); p.deleteProperty('SETUP_KEY');
  return { ok: true, token: newToken_() };
}
function adminLogin_(req) {
  var c = CacheService.getScriptCache(), fails = Number(c.get('adm_fail') || 0);
  if (fails >= 8) return { ok: false, error: 'Too many attempts. Please wait 15 minutes.' };
  var p = props_();
  if (!p.getProperty('ADMIN_HASH')) return { ok: false, setup: true, error: 'The admin password has not been set yet.' };
  if (hash_(p.getProperty('ADMIN_SALT') + String(req.password || '')) !== p.getProperty('ADMIN_HASH')) { c.put('adm_fail', String(fails + 1), 900); return { ok: false, error: 'Wrong password.' }; }
  return { ok: true, token: newToken_() };
}
function adminPassword_(req) {
  var p = props_();
  if (hash_(p.getProperty('ADMIN_SALT') + String(req.old || '')) !== p.getProperty('ADMIN_HASH')) return { ok: false, error: 'Your current password is not correct.' };
  if (String(req.password || '').length < 8) return { ok: false, error: 'Please choose a password of at least 8 characters.' };
  var salt = Utilities.getUuid();
  p.setProperty('ADMIN_SALT', salt); p.setProperty('ADMIN_HASH', hash_(salt + String(req.password)));
  return { ok: true };
}
function adminLogout_(req) { CacheService.getScriptCache().remove('adm_' + req.token); return { ok: true }; }

/* ---- admin data ---- */
function rowsOf_(name, head) {
  var v = tab_(name, head).getDataRange().getValues();
  return v.slice(1).filter(function (r) { return String(r[0]).trim(); }).map(function (r) { return r.map(fmt_); });
}
function adminState_() {
  var codes = codesTab_().getDataRange().getValues().slice(1).filter(function (r) { return String(r[0]).trim(); })
    .map(function (r) { return { code: String(r[0]), day: Number(r[1]), cohort: String(r[2] || ''), active: String(r[3] || 'TRUE').toUpperCase() !== 'FALSE', expires: fmt_(r[4]).slice(0, 10), note: String(r[5] || '') }; });
  var B = BRANDED_();
  return {
    ok: true, program: PROGRAM, codes: codes,
    cohorts: rowsOf_('Cohorts', C_HEAD_), participants: rowsOf_('Participants', P_HEAD_), scores: rowsOf_('Scores', S_HEAD_),
    modules: MODULES.map(function (m) { var d = B[m.n] || m.deck; return { n: m.n, day: m.day, title: m.title, deck: d, open: 'https://drive.google.com/file/d/' + d + '/view', quiz: quiz_(m.n) }; }),
    guide: guideId_() ? 'https://drive.google.com/file/d/' + guideId_() + '/view' : ''
  };
}
function newCode_(day, taken) {
  var a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', c;
  do { c = 'SK' + day + '-'; for (var i = 0; i < 5; i++) c += a.charAt(Math.floor(Math.random() * a.length)); } while (taken[c]);
  taken[c] = 1; return c;
}
function adminCreateCohort_(req) {
  var name = clean_(req.name, 60), start = clean_(req.start, 10), notes = clean_(req.notes, 200);
  if (!name) return { ok: false, error: 'Please give the cohort a name.' };
  return withLock_(function () {
    var cs = tab_('Cohorts', C_HEAD_);
    if (cs.getDataRange().getValues().some(function (r) { return String(r[0]).toLowerCase() === name.toLowerCase(); })) return { ok: false, error: 'A cohort with that name already exists.' };
    cs.appendRow([name, start, notes, new Date()]);
    var sh = codesTab_(), taken = {};
    sh.getDataRange().getValues().forEach(function (r) { taken[String(r[0]).toUpperCase()] = 1; });
    var out = [1, 2, 3].map(function (d) { return [newCode_(d, taken), d, name, 'TRUE', '', 'Created in admin']; });
    sh.getRange(sh.getLastRow() + 1, 1, 3, 6).setValues(out);
    return { ok: true, codes: out.map(function (r) { return r[0]; }) };
  });
}
function adminAddCode_(req) {
  var day = Number(req.day), cohort = clean_(req.cohort, 60);
  if (!(day >= 1 && day <= 3)) return { ok: false, error: 'Day must be 1, 2 or 3.' };
  return withLock_(function () {
    var sh = codesTab_(), taken = {};
    sh.getDataRange().getValues().forEach(function (r) { taken[String(r[0]).toUpperCase()] = 1; });
    var c = newCode_(day, taken);
    sh.appendRow([c, day, cohort, 'TRUE', '', 'Created in admin']);
    return { ok: true, code: c };
  });
}
function adminSetCode_(req) {
  var code = clean_(req.code, 20).toUpperCase();
  return withLock_(function () {
    var sh = codesTab_(), v = sh.getDataRange().getValues();
    for (var i = 1; i < v.length; i++) if (String(v[i][0]).trim().toUpperCase() === code) { sh.getRange(i + 1, 4).setValue(req.active ? 'TRUE' : 'FALSE'); return { ok: true }; }
    return { ok: false, error: 'Code not found.' };
  });
}
function adminSaveQuiz_(req) {
  var n = Number(req.n), q = req.quiz;
  if (!(n >= 1 && n <= 10) || !Array.isArray(q)) return { ok: false, error: 'Bad quiz.' };
  var out = [];
  for (var i = 0; i < q.length; i++) {
    var it = q[i] || {}, opts = (it.o || []).map(function (o) { return clean_(o, 300); }).filter(String), a = Number(it.a);
    if (!clean_(it.q, 400)) return { ok: false, error: 'Question ' + (i + 1) + ' is empty.' };
    if (opts.length < 2 || opts.length > 6) return { ok: false, error: 'Question ' + (i + 1) + ' needs 2 to 6 options.' };
    if (!(a >= 0 && a < opts.length)) return { ok: false, error: 'Pick the correct answer for question ' + (i + 1) + '.' };
    out.push({ q: clean_(it.q, 400), o: opts, a: a });
  }
  var s = JSON.stringify(out);
  if (s.length > 8800) return { ok: false, error: 'This quiz is too long. Please shorten some questions or options.' };
  props_().setProperty('QUIZ_' + n, s);
  return { ok: true, quiz: out };
}
function shareView_(id) { DriveApp.getFileById(id).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
function setContent_(kind, n, id) {
  if (kind === 'guide') { props_().setProperty('GUIDE_PDF', id); return; }
  n = Number(n); if (!(n >= 1 && n <= 10)) throw new Error('Bad module');
  var B = BRANDED_(); B[n] = id; props_().setProperty('BRANDED', JSON.stringify(B));
}
function adminUpload_(req) {
  var mime = String(req.mime || ''), name = clean_(req.filename, 120) || 'upload';
  var okType = req.kind === 'guide' ? /pdf/.test(mime) : /pdf|presentation|powerpoint/.test(mime);
  if (!okType) return { ok: false, error: req.kind === 'guide' ? 'Please upload a PDF.' : 'Please upload a PowerPoint (.pptx) or PDF file.' };
  var bytes = Utilities.base64Decode(String(req.data || ''));
  if (!bytes.length || bytes.length > 40 * 1024 * 1024) return { ok: false, error: 'The file is empty or too large (max 40 MB).' };
  var f = folder_().createFile(Utilities.newBlob(bytes, mime, name));
  shareView_(f.getId());
  setContent_(req.kind, req.n, f.getId());
  return { ok: true, id: f.getId() };
}
function adminSetLink_(req) {
  var m = String(req.url || '').match(/[-\w]{25,}/);
  if (!m) return { ok: false, error: 'Please paste a Google Drive link to the file.' };
  try { DriveApp.getFileById(m[0]).getName(); shareView_(m[0]); } catch (e) { return { ok: false, error: 'That file could not be opened. Check the link and that it is shared with digitalmarketer@hseniva.com.' }; }
  setContent_(req.kind, req.n, m[0]);
  return { ok: true, id: m[0] };
}

function adminRoute_(req) {
  var a = req.action;
  if (a === 'score') return score_(req);
  if (a === 'adminStatus') return adminStatus_();
  if (a === 'adminSetup') return adminSetup_(req);
  if (a === 'adminLogin') return adminLogin_(req);
  var R = { adminState: adminState_, adminCreateCohort: adminCreateCohort_, adminAddCode: adminAddCode_, adminSetCode: adminSetCode_,
    adminSaveQuiz: adminSaveQuiz_, adminUpload: adminUpload_, adminSetLink: adminSetLink_, adminPassword: adminPassword_, adminLogout: adminLogout_ };
  if (!R[a]) return { ok: false, error: 'Unknown action.' };
  try { auth_(req); } catch (e) { return { ok: false, auth: true, error: 'Please log in again.' }; }
  return R[a](req);
}

function testAdminBackend() {
  var s = adminState_();
  Logger.log('codes ' + s.codes.length + ', cohorts ' + s.cohorts.length + ', participants ' + s.participants.length + ', scores ' + s.scores.length + ', modules ' + s.modules.length + ', quiz M1 ' + s.modules[0].quiz.length);
  logVisit_({ name: 'Test Participant', client: 'test-client' }, { valid: ['SK1-EPT32'], maxDay: 1 });
  Logger.log(JSON.stringify(score_({ client: 'test-client', name: 'Test Participant', n: 1, score: 4, total: 6 })));
  Logger.log(JSON.stringify(adminRoute_({ action: 'adminState' })));
}
