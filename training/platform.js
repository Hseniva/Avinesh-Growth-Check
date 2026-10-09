/* Shared login + API helper for the DMM learning platform.
   Set API_URL to the Apps Script web app URL (ends with /exec). */
(function () {
  var API_URL = window.DMM_API_OVERRIDE || 'PASTE_APPS_SCRIPT_URL_HERE';
  var KEY = 'dmm_session';
  var mem = null;

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return mem; }
  }
  function write(v) {
    mem = v;
    try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch (e) {}
  }

  window.DMM = {
    API_URL: API_URL,
    configured: function () { return /^https?:\/\//.test(API_URL); },
    session: read,
    setSession: write,
    clear: function () { write(null); },
    api: function (action, data) {
      data = data || {};
      data.action = action;
      var s = read();
      if (s && !data.token) data.token = s.token;
      if (!/^https?:\/\//.test(API_URL)) return Promise.resolve({ ok: false, error: 'The platform is not connected yet.' });
      return fetch(API_URL, { method: 'POST', body: JSON.stringify(data) })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res.ok && /^AUTH:/.test(res.error || '')) {
            write(null);
            res.authError = true;
            res.error = res.error.replace(/^AUTH:\s*/, '');
          }
          return res;
        })
        .catch(function () { return { ok: false, error: 'Connection problem. Please check your internet and try again.' }; });
    }
  };
})();
