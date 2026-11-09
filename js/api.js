/* 기계약DB 배정 시스템 - 공통 API 클라이언트 */
window.DB = window.DB || {};
DB.TIMEOUT_MS = 25000;
DB.API_URL = 'https://script.google.com/macros/s/AKfycbwNJ-cgrYkMLgF9Mj3M5EMGUFzcwz2BPa5X7Gbrrg4g5yrfcbIEIGHrKqT87Wh_w3od/exec';

DB.token = function () { try { return sessionStorage.getItem('db_token') || ''; } catch (e) { return ''; } };
DB.setToken = function (t) { try { if (t) sessionStorage.setItem('db_token', t); else sessionStorage.removeItem('db_token'); } catch (e) {} };

/** Apps Script 웹앱 호출. text/plain 으로 보내 CORS preflight 를 피한다. */
DB.api = async function (action, payload) {
  var body = JSON.stringify(Object.assign({ action: action, token: DB.token() }, payload || {}));
  var res;
  var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, DB.TIMEOUT_MS) : null;
  if (window.diag) diag('요청 시작: ' + action);
  try {
    res = await fetch(DB.API_URL, { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', signal: ctrl ? ctrl.signal : undefined });
  } catch (e) {
    if (window.diagShow) diagShow('요청 실패: ' + (e && (e.name + ' ' + e.message)));
    if (e && e.name === 'AbortError') throw new Error('서버 응답이 ' + Math.round(DB.TIMEOUT_MS / 1000) + '초 안에 오지 않았습니다. 네트워크(회사망 차단·광고 차단기)를 확인하고 다시 시도해 주세요.');
    throw new Error('서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요. (' + (e && e.message ? e.message : 'fetch 실패') + ')');
  } finally { if (timer) clearTimeout(timer); }
  if (window.diag) diag('응답 수신: HTTP ' + res.status + ' (' + action + ')');
  var text = await res.text();
  var json;
  try { json = JSON.parse(text); }
  catch (e) {
    if (/Authorization|권한|승인|Google|Script function not found/i.test(text)) throw new Error('서버가 아직 승인되지 않았습니다. 담당자가 Apps Script 편집기에서 setup()을 실행해 권한을 승인해야 합니다.');
    throw new Error('서버 응답을 해석할 수 없습니다 (HTTP ' + res.status + ').');
  }
  if (!json.ok) {
    var err = new Error(json.error || '알 수 없는 오류');
    if (json.auth === false) err.auth = false;
    throw err;
  }
  return json;
};

DB.esc = function (s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
DB.fileToBase64 = function (file) {
  return new Promise(function (resolve, reject) {
    var r = new FileReader();
    r.onload = function () { var s = String(r.result || ''); var i = s.indexOf(','); if (i < 0) reject(new Error('파일을 읽을 수 없습니다.')); else resolve(s.slice(i + 1)); };
    r.onerror = function () { reject(new Error('파일을 읽을 수 없습니다.')); };
    r.readAsDataURL(file);
  });
};
DB.fileToArrayBuffer = function (file) {
  return new Promise(function (resolve, reject) {
    var r = new FileReader();
    r.onload = function () { resolve(r.result); };
    r.onerror = function () { reject(new Error('파일을 읽을 수 없습니다.')); };
    r.readAsArrayBuffer(file);
  });
};
