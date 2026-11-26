/* 기계약DB 배정 시스템 - 화면 로직 (prototype.html 을 API 연동으로 옮긴 것) */
(function () {
  'use strict';

  var esc = DB.esc;
  function $(id) { return document.getElementById(id); }
  var STATUS_FLOW = ['접수', '서류확인', '모집인코드확인', '배정대기', '배정완료'];
  var CANCELABLE = ['접수'];   // 서류확인이 시작되면 취소 불가 (서버 CANCELABLE 과 동일)
  var REGIONS = ['서울', '경기', '인천', '강원', '충북', '충남', '대전', '세종', '전북', '전남', '광주', '경북', '경남', '대구', '울산', '부산', '제주'];
  var USERS_ALLOWED = ['사용인번호', '이름', '본부', '사업단', '지점', '역할', '휴대폰번호', '휴대폰해시', '위촉상태', '사용여부', '연락처'];
  var FORBIDDEN_COLS = ['주민', '주소', '계좌', '고객명', '계약번호', '이메일', '생년월일', '급여', '수당'];

  var S = { me: null, boot: null, pendingFile: null, applyFormType: null, fbValidation: null, feed: null, statMonth: '' };

  /* ───────── 공통 ───────── */
  function toast(msg, kind) {
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    $('toasts').appendChild(el);
    setTimeout(function () { el.remove(); }, 4200);
  }
  function pillOf(status) {
    var m = { '배정': 'ok', '배정완료': 'ok', '제출완료': 'ok', '성공': 'ok', '완료': 'ok', '메일 발송 완료': 'ok', '제외완료': 'ok',
      '미배정': 'stop', '반려': 'stop', '보완필요': 'stop', '거부': 'stop', '실패': 'stop', '제외 신청': 'stop',
      '보류': 'wait', '검토중': 'wait', '부분제출': 'wait', '배정대기': 'wait', '처리대기': 'wait', '대기': 'wait', '발송 준비 중': 'wait',
      '등록됨': 'ok', '미제출': 'neutral', '미신청': 'neutral', '준비 중': 'neutral', '접수': 'info', '서류확인': 'info', '모집인코드확인': 'info' };
    return '<span class="pill ' + (m[status] || 'neutral') + '">' + esc(status) + '</span>';
  }
  function monthKo(m) { return m ? m.slice(0, 4) + '년 ' + parseInt(m.slice(5), 10) + '월' : ''; }
  /* ── 접수 기간 (서버 config apply_open·apply_close·feedback_open·feedback_close · public.info.windows / me.bootstrap.config.windows) ── */
  function dateKo(ymd) { var m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) return String(ymd || ''); var d = new Date(+m[1], +m[2] - 1, +m[3]); return parseInt(m[2], 10) + '월 ' + parseInt(m[3], 10) + '일(' + '일월화수목금토'[d.getDay()] + ')'; }
  function qtyNote(n) { n = parseInt(n, 10); return (n > 0 ? '배정수량은 기본 ' + n + '건이며, ' : '') + '지역별 수량이 부족한 경우 기본 수량보다 적게 배정될 수 있습니다.'; }
  function windowOf(kind) { var w = (S.boot && S.boot.config && S.boot.config.windows) || (P.info && P.info.windows) || {}; return w[kind] || { state: 'always', is_open: true }; }
  function windowLabel(w) { if (!w || w.state === 'always') return '상시 접수'; if (w.open && w.close) return dateKo(w.open) + ' ~ ' + dateKo(w.close); if (w.open) return dateKo(w.open) + '부터'; return dateKo(w.close) + '까지'; }
  /** 접수 기간 안내 HTML. 열려 있고 기간이 없으면 빈 문자열. */
  function windowNoteHtml(kind) {
    var w = windowOf(kind), what = kind === 'apply' ? '신청서' : '피드백';
    if (w.state === 'always') return '';
    if (w.is_open) return '<div class="note info"><b>' + what + ' 접수 중</b>접수 기간: ' + esc(windowLabel(w)) + (w.close ? ' · ' + esc(dateKo(w.close)) + ' 23:59 마감' : '') + '</div>';
    if (w.state === 'before') return '<div class="note alert"><b>' + what + ' 접수 기간이 아닙니다</b>' + esc(dateKo(w.open)) + '부터 접수합니다. (접수 기간: ' + esc(windowLabel(w)) + ')</div>';
    return '<div class="note alert"><b>' + what + ' 접수가 마감되었습니다</b>' + esc(dateKo(w.close)) + ' 마감 · 접수 기간: ' + esc(windowLabel(w)) + ' · 문의: RP영업지원팀 안다솜 과장</div>';
  }
  /** 기간 밖이면 컨테이너 안의 버튼들을 비활성화 */
  function gateButtons(root, kind, selector) {
    var w = windowOf(kind); if (w.is_open) return;
    root.querySelectorAll(selector).forEach(function (b) { b.disabled = true; b.title = (kind === 'apply' ? '신청서' : '피드백') + ' 접수 기간이 아닙니다 (' + windowLabel(w) + ')'; });
  }
  function fmtBytes(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB'; }
  function loadingHtml(msg) { return '<div class="loading"><div class="spinner"></div><span>' + esc(msg || '불러오는 중…') + '</span></div>'; }
  function errorHtml(e) { return '<div class="err">' + esc(e && e.message || e) + '</div>'; }
  function cautionHtml(title, items) {
    if (!items || !items.length) return '';
    return '<div class="note alert"><b>' + esc(title) + '</b><ul>' + items.map(function (t) { return '<li>' + esc(t.body || t) + '</li>'; }).join('') + '</ul></div>';
  }
  function isManager() { return S.me && S.me.role !== '사용인'; }
  function isAdmin() { return S.me && S.me.role === '관리자'; }
  function statusLabel(a) { if (a.type !== '제외') return a.status; return { '배정대기': '처리대기', '배정완료': '제외완료' }[a.status] || a.status; }
  async function call(action, payload) {
    try { return await DB.api(action, payload); }
    catch (e) { if (e.auth === false) { toast('세션이 만료되었습니다. 다시 로그인해 주세요.', 'stop'); logout(); } throw e; }
  }

  /* ───────── 로그인 ───────── */
  var IS_ANDROID = /Android/i.test(navigator.userAgent || '');

  /* 카카오톡 인앱 브라우저: 촬영·다운로드가 막히는 경우가 있어 외부 브라우저로 열도록 안내 (세션당 한 번) */
  function warnKakaoInApp() {
    if (!/KAKAOTALK/i.test(navigator.userAgent || '')) return;
    try { if (sessionStorage.getItem('kakaoWarned')) return; sessionStorage.setItem('kakaoWarned', '1'); } catch (e) {}
    if (window.confirm('카카오톡 브라우저에서는 촬영·파일 받기 등 일부 기능이 정상 작동하지 않을 수 있습니다.\n\nChrome·Safari 같은 외부 브라우저로 열어 주세요.\n\n[확인]을 누르면 외부 브라우저로 엽니다.')) {
      location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(location.href);
    }
  }

  var P = { info: null, file: null };   // 로그인 전 화면 상태
  function publicRegionOptions(blank) {
    var list = (P.info && P.info.regions && P.info.regions.length) ? P.info.regions : REGIONS;
    // 1순위도 고정값 없이 '선택하세요' 로 시작 (blank=false 면 선택 필수)
    return '<option value="">' + (blank ? '없음' : '선택하세요') + '</option>' + list.map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('');
  }
  async function init() {
    warnKakaoInApp();
    try {
      var info = await DB.api('public.info');
      P.info = info;
      renderPublicWindow();
      var qn = $('p-qty-note'); if (qn) qn.textContent = qtyNote(info.apply_qty_default);
      $('p-r1').innerHTML = publicRegionOptions(false); $('p-r2').innerHTML = publicRegionOptions(true); $('p-r3').innerHTML = publicRegionOptions(true);
      P.hqs = info.hqs_all || info.hqs || [];
      var fid = (String(info.form_url || '').match(/\/d\/([^\/]+)/) || [])[1] || '';
      $('p-formlink').innerHTML = fid
        ? '<a class="btn-ghost" href="' + esc(info.form_url) + '" target="_blank" rel="noopener" style="text-align:center;text-decoration:none">양식 열기</a>' +
          '<a class="btn-ghost" href="https://drive.google.com/uc?export=download&id=' + esc(fid) + '" target="_blank" rel="noopener" style="text-align:center;text-decoration:none">PDF 다운로드하기</a>'
        : '<span class="helper">양식 파일이 아직 등록되지 않았습니다. RP영업지원팀 안다솜 과장에게 받은 양식을 사용해 주세요.</span>';
      $('l-loading').hidden = true; $('l-form').hidden = false; if (window.diagHide) diagHide();
      // 관리자 입구: 주소 뒤에 ?admin 또는 #admin 을 붙여 열었을 때만 관리자 로그인 표시 (일반 사용자 화면에는 노출 안 함)
      var isAdminEntry = /[?#&]admin(?:=|&|$)/.test(location.href);
      if (isAdminEntry) {
        $('l-admin').hidden = false; $('l-admin-toggle-wrap').hidden = true;
        var guide = $('p-open').closest('.sec'); if (guide) guide.hidden = true;
        $('p-form').hidden = true;
        var sub = document.querySelector('#login-view .subtitle'); if (sub) sub.textContent = '관리자 입구 · RP영업지원팀';
        setTimeout(function () { $('l-apw').focus(); }, 50);
      }
      if (DB.token()) { try { var b = await DB.api('me.bootstrap'); enterMain(b); } catch (e) { DB.setToken(''); } }
    } catch (e) {
      $('l-loading').hidden = true;
      var be = $('l-boot-err'); be.hidden = false;
      be.innerHTML = esc(e.message) + '<div style="margin-top:8px"><button class="btn-ghost btn-sm" type="button" id="l-retry">다시 시도</button></div>';
      $('l-retry').addEventListener('click', function () { be.hidden = true; $('l-loading').hidden = false; init(); });
    }
  }
  $('l-go').addEventListener('click', async function () {
    var err = $('l-err'); err.hidden = true;
    var no = $('l-no').value.trim(), name = $('l-name').value.trim(), phone = $('l-phone').value.trim();
    if (!no || !name || !phone) { err.textContent = '사용인번호, 이름, 휴대폰번호를 모두 입력해 주세요.'; err.hidden = false; return; }
    $('l-go').disabled = true;
    try {
      var r = await DB.api('auth.login', { no: no, name: name, phone: phone });
      DB.setToken(r.token);
      var b = await DB.api('me.bootstrap');
      enterMain(b);
    } catch (e) { err.textContent = e.message; err.hidden = false; }
    finally { $('l-go').disabled = false; }
  });
  $('l-phone').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('l-go').click(); });
  $('l-admin-toggle').addEventListener('click', function () { $('l-admin').hidden = !$('l-admin').hidden; });
  $('l-ago').addEventListener('click', async function () {
    var err = $('l-err'); err.hidden = true;
    try {
      var r = await DB.api('auth.adminLogin', { password: $('l-apw').value, name: $('l-aname').value.trim() || '관리자' });
      DB.setToken(r.token);
      enterMain(await DB.api('me.bootstrap'));
    } catch (e) { err.textContent = e.message; err.hidden = false; }
  });
  $('l-apw').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('l-ago').click(); });

  /* ───────── 신청 유의사항 확인 모달 (신규 신청 제출 직전) ───────── */
  function confirmNotices() {
    return new Promise(function (resolve) {
      var m = $('notice-modal'), ok = $('nm-ok'), boxes = Array.prototype.slice.call(m.querySelectorAll('[data-notice]'));
      boxes.forEach(function (b) { b.checked = false; });
      ok.disabled = true;
      function refresh() { ok.disabled = !boxes.every(function (b) { return b.checked; }); }
      function close(v) { m.hidden = true; boxes.forEach(function (b) { b.removeEventListener('change', refresh); }); ok.onclick = null; $('nm-cancel').onclick = null; m.onclick = null; resolve(v); }
      boxes.forEach(function (b) { b.addEventListener('change', refresh); });
      ok.onclick = function () { close(true); };
      $('nm-cancel').onclick = function () { close(false); };
      m.onclick = function (e) { if (e.target === m) close(false); };
      m.hidden = false;
      boxes[0].focus();
    });
  }

  /* ───────── 로그인 전 신청서 제출 ───────── */
  function renderPublicWindow() {
    var box = $('p-window'); if (!box) return;
    var w = windowOf('apply');
    var html = windowNoteHtml('apply');
    box.innerHTML = html; box.hidden = !html; box.className = '';   // note 클래스는 안쪽 div 가 가짐
    if (!w.is_open) { var b = $('p-open'); b.disabled = true; b.innerHTML = '📝 신청서 제출하기 <small style="font-weight:normal;opacity:.85">· 접수 기간이 아닙니다</small>'; }
  }
  function publicReady() {
    var w = windowOf('apply');
    var ok = ['p-no', 'p-name', 'p-hq', 'p-phone', 'p-r1'].every(function (id) { return $(id).value.trim() !== ''; }) && !!P.file && w.is_open;
    $('p-submit').disabled = !ok;
    var hint = $('p-ready-hint'); if (hint) hint.textContent = !w.is_open ? '신청서 접수 기간이 아닙니다 (' + windowLabel(w) + ').' : ok ? '제출할 준비가 되었습니다.' : '필수 항목과 신청서 파일을 모두 채우면 버튼이 초록색으로 바뀝니다.';
    return ok;
  }
  ['p-no', 'p-name', 'p-hq', 'p-phone', 'p-r1'].forEach(function (id) { $(id).addEventListener('input', publicReady); $(id).addEventListener('change', publicReady); });
  // 본부 콤보박스: ▼ 누르면 전체 목록, 입력하면 포함 검색, 목록에 없으면 직접 입력 허용
  (function () {
    var inp = $('p-hq'), btn = $('hq-btn'), list = $('hq-list'), box = $('hq-combo'), idx = -1;
    function items() { var q = inp.value.trim().toLowerCase(); return (P.hqs || []).filter(function (h) { return !q || h.toLowerCase().indexOf(q) >= 0; }); }
    function render(all) {
      var arr = all ? (P.hqs || []) : items(); idx = -1;
      list.innerHTML = arr.length ? arr.map(function (h) { return '<li data-v="' + esc(h) + '">' + esc(h) + '</li>'; }).join('')
        : '<li class="empty">' + (P.hqs && P.hqs.length ? '일치하는 본부가 없습니다. 입력한 이름 그대로 접수됩니다.' : '등록된 본부가 아직 없습니다. 본부명을 직접 입력하세요.') + '</li>';
      list.hidden = false; inp.setAttribute('aria-expanded', 'true');
    }
    function close() { list.hidden = true; inp.setAttribute('aria-expanded', 'false'); idx = -1; }
    var picking = false;
    function pick(v) { picking = true; inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); picking = false; close(); }
    btn.addEventListener('click', function () { if (list.hidden) { render(true); inp.focus(); } else close(); });
    inp.addEventListener('focus', function () { render(false); });
    inp.addEventListener('input', function () { if (!picking) render(false); });
    inp.addEventListener('keydown', function (e) {
      var lis = list.querySelectorAll('li[data-v]');
      if (e.key === 'ArrowDown' && lis.length) { e.preventDefault(); if (list.hidden) render(false); idx = Math.min(idx + 1, lis.length - 1); lis.forEach(function (l, i) { l.classList.toggle('active', i === idx); }); lis[idx].scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'ArrowUp' && lis.length) { e.preventDefault(); idx = Math.max(idx - 1, 0); lis.forEach(function (l, i) { l.classList.toggle('active', i === idx); }); lis[idx].scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'Enter') { if (!list.hidden && idx >= 0 && lis[idx]) { e.preventDefault(); pick(lis[idx].dataset.v); } else close(); }
      else if (e.key === 'Escape') close();
    });
    list.addEventListener('mousedown', function (e) { var li = e.target.closest('li[data-v]'); if (li) { e.preventDefault(); pick(li.dataset.v); } });
    document.addEventListener('click', function (e) { if (!box.contains(e.target)) close(); });
  })();
  // 본부 TO 안내 (본부 입력이 멈추면 조회)
  P.to = null;
  var toTimer = null;
  function toText(t) { return esc(t.hq) + ' TO ' + t.used + ' / ' + t.limit + '명 사용 중' + (t.waiting ? ' · 접수 대기 ' + t.waiting + '명' : '') + (t.full ? ' · <b style="color:var(--stop)">TO 가 모두 사용 중입니다</b>' : ''); }
  async function refreshPublicTo() {
    var hq = $('p-hq').value.trim(), el = $('p-to');
    P.to = null; el.innerHTML = '';
    if (!hq) return;
    try { var t = await DB.api('public.hqTo', { hq: hq }); if ($('p-hq').value.trim() !== hq) return; P.to = t; el.innerHTML = toText(t); }
    catch (e) { el.textContent = ''; }
  }
  $('p-hq').addEventListener('input', function () { clearTimeout(toTimer); toTimer = setTimeout(refreshPublicTo, 500); });
  $('p-hq').addEventListener('change', function () { clearTimeout(toTimer); refreshPublicTo(); });
  function toAlertText(t) { return '현재 ' + t.hq + ' 본부 TO(' + t.limit + '명)를 모두 사용 중입니다.\n(사용 중 ' + t.used + '명' + (t.waiting ? ' · 접수 대기 ' + t.waiting + '명' : '') + ')\n\n접수는 되지만 자리가 날 때까지 「배정 대기」 상태로 승인될 수 있습니다.\n계속 제출할까요?'; }
  $('p-open').addEventListener('click', function () { $('p-form').hidden = false; $('p-done').hidden = true; $('p-form').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  $('p-close').addEventListener('click', function () { $('p-form').hidden = true; P.file = null; $('p-filechip').innerHTML = ''; publicReady(); });
  $('p-cam').addEventListener('click', function () { $('cam-input').dataset.target = 'public'; $('cam-input').value = ''; $('cam-input').click(); });
  $('p-file').addEventListener('click', function () { $('file-input').dataset.target = 'public'; $('file-input').value = ''; $('file-input').click(); });
  function onPublicFile(e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var okTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (okTypes.indexOf(f.type) < 0) { toast('파일 형식이 맞지 않습니다. PDF 또는 JPG·PNG·WEBP 이미지만 올릴 수 있습니다.', 'stop'); return; }
    var max = ((P.info && P.info.max_upload_mb) || 10) * 1048576;
    if (f.size > max) { toast('파일이 ' + ((P.info && P.info.max_upload_mb) || 10) + 'MB를 넘습니다. 해상도를 낮춰 다시 촬영해 주세요.', 'stop'); return; }
    P.file = f;
    var chip = $('p-filechip'), isImg = f.type.indexOf('image/') === 0;
    chip.innerHTML = '<div class="filechip">' + (isImg ? '<img id="p-thumb" alt="">' : '<span style="font-size:22px">📄</span>') +
      '<div><div class="fn">' + esc(f.name) + '</div><div class="fs">' + fmtBytes(f.size) + ' · ' + esc(f.type) + '</div></div>' +
      '<button class="btn-ghost btn-sm danger" type="button" id="p-rm">제거</button></div>';
    if (isImg) { var r = new FileReader(); r.onload = function () { var t = $('p-thumb'); if (t) t.src = r.result; }; r.readAsDataURL(f); }
    $('p-rm').addEventListener('click', function () { P.file = null; chip.innerHTML = ''; publicReady(); });
    publicReady();
  }
  $('p-submit').addEventListener('click', async function () {
    var err = $('p-err'); err.hidden = true;
    var no = $('p-no').value.trim(), name = $('p-name').value.trim(), hq = $('p-hq').value.trim(), br = $('p-br').value.trim(), phone = $('p-phone').value.trim();
    if (!no || !name || !hq || !phone) { err.textContent = '사용인번호, 이름, 본부, 휴대폰번호를 모두 입력해 주세요.'; err.hidden = false; return; }
    var regions = [$('p-r1').value, $('p-r2').value, $('p-r3').value].map(function (v) { return (v || '').trim(); }).filter(Boolean);
    if (!regions.length) { err.textContent = '희망지역 1순위를 선택해 주세요.'; err.hidden = false; return; }
    var dup = regions.filter(function (r, i) { return regions.indexOf(r) !== i; });
    if (dup.length) { err.textContent = '같은 지역을 두 번 선택했습니다: ' + dup[0]; err.hidden = false; return; }
    if (!P.file) { err.textContent = '작성한 신청서를 촬영하거나 첨부해 주세요.'; err.hidden = false; return; }
    if (!P.to || P.to.hq !== hq) { try { P.to = await DB.api('public.hqTo', { hq: hq }); } catch (e) { P.to = null; } }
    if (P.to && P.to.full && !window.confirm(toAlertText(P.to))) return;
    if (!(await confirmNotices())) return;
    var btn = $('p-submit'); btn.disabled = true; btn.textContent = '업로드 중…';
    try {
      var r = await DB.api('apply.public', { no: no, name: name, hq: hq, br: br, phone: phone, regions: regions,
        file: { name: P.file.name, type: P.file.type, base64: await DB.fileToBase64(P.file) } });
      P.file = null; $('p-filechip').innerHTML = '';
      var done = $('p-done'); done.hidden = false;
      done.innerHTML = '<div class="result-top"><div class="result-who">' + esc(r.name) + ' 님 신청 접수 <span>· ' + esc(monthKo(r.month)) + '</span></div>' + pillOf('접수') + '</div>' +
        '<div class="kv"><div class="kv-row"><dt>접수번호</dt><dd class="mono">' + esc(r.id) + '</dd></div>' + (r.reason ? '<div class="kv-row"><dt>안내</dt><dd style="color:var(--stop)">' + esc(r.reason) + ' — 본부 TO 가 차 있어 자리가 나면 순서대로 배정됩니다.</dd></div>' : '') + '<div class="kv-row"><dt>다음</dt><dd>RP영업지원팀이 신청서를 확인하고 배정을 확정합니다. 확정되면 위 사용인번호 · 이름 · 휴대폰번호로 로그인해 배정 결과를 볼 수 있습니다.</dd></div></div>';
      done.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast('접수되었습니다. 접수번호 ' + r.id, 'ok');
      ['p-no', 'p-name', 'p-hq', 'p-br', 'p-phone'].forEach(function (id) { $(id).value = ''; });
    } catch (e) { err.textContent = e.message; err.hidden = false; }
    finally { btn.textContent = '신청서 제출'; publicReady(); }
  });

  function enterMain(boot) {
    S.boot = boot; S.me = boot.me; S.applyFormType = null; S.pendingFile = null; S.fbValidation = null; S.statMonth = boot.month;
    $('login-view').hidden = true; $('main-view').hidden = false;
    $('w-name').textContent = S.me.name; $('w-role').textContent = S.me.role; $('w-scope').textContent = '열람 범위 · ' + boot.scope;
    $('m-sub').textContent = monthKo(boot.month) + ' 배정분';
    document.querySelectorAll('[data-admin]').forEach(function (t) { t.hidden = !isAdmin(); });
    selectTab('apply');
  }
  function logout() {
    var t = DB.token(); DB.setToken('');
    if (t) DB.api('auth.logout', { token: t }).catch(function () {});
    S.me = null; S.boot = null;
    $('main-view').hidden = true; $('login-view').hidden = false;
  }
  $('w-out').addEventListener('click', logout);

  /* ───────── 탭 ───────── */
  var RENDER = { apply: renderApply, board: renderBoard, feed: renderFeed, sched: renderSched, stats: renderStats, admin: renderAdmin };
  function selectTab(id) {
    document.querySelectorAll('.tab').forEach(function (t) { t.setAttribute('aria-selected', t.dataset.panel === id ? 'true' : 'false'); });
    document.querySelectorAll('.panel').forEach(function (p) { p.classList.toggle('active', p.id === id); });
    RENDER[id]();
  }
  document.querySelectorAll('.tab').forEach(function (t) { t.addEventListener('click', function () { selectTab(t.dataset.panel); }); });

  /* ───────── 1. 신청 ───────── */
  function timelineHtml(a) {
    var idx = STATUS_FLOW.indexOf(a.status), rejected = a.status === '반려';
    var labels = a.type === '제외' ? ['접수', '서류확인', '모집인코드확인', '처리대기', '제외완료'] : STATUS_FLOW;
    var html = '<div class="steps">';
    labels.forEach(function (s, i) {
      var cls = 'step';
      if (rejected) { if (i === 0) cls += ' done'; if (i === 1) cls += ' stop'; }
      else if (i < idx) cls += ' done'; else if (i === idx) cls += ' cur';
      html += '<div class="' + cls + '"><div class="dot">' + (cls.indexOf('done') >= 0 ? '✓' : (i + 1)) + '</div><span>' + esc(rejected && i === 1 ? '반려' : s) + '</span></div>';
    });
    return html + '</div>';
  }
  function canCancel(a) { return CANCELABLE.indexOf(a.status) >= 0; }
  function appCardHtml(a, opts) {
    opts = opts || {};
    var cls = a.status === '반려' ? 'stop' : (a.status === '배정완료' ? 'ok' : '');
    return '<div class="result ' + cls + '"><div class="result-top"><div class="result-who">' + esc(a.name) + ' <span>· ' + esc(a.br || a.hq) + '</span> ' + (a.type === '제외' ? pillOf('제외 신청') : '<span class="pill info">신규 신청</span>') + '</div>' + pillOf(statusLabel(a)) + '</div>' +
      timelineHtml(a) +
      '<dl class="kv"><div class="kv-row"><dt>접수번호</dt><dd class="mono">' + esc(a.id) + '</dd></div>' +
      '<div class="kv-row"><dt>접수일</dt><dd class="mono">' + esc(a.date) + (a.by ? ' <span class="helper">· 대리 신청: ' + esc(a.by) + '</span>' : '') + '</dd></div>' +
      (a.type === '제외' ? '<div class="kv-row"><dt>적용</dt><dd>다음 달부터 배정 중단</dd></div>' : '<div class="kv-row"><dt>희망지역</dt><dd>' + esc(String(a.regions).split(',').map(function (r, i) { return (i + 1) + '순위 ' + r.trim(); }).join(' · ')) + ' · 배정수량 ' + a.qty + '건</dd></div>') +
      '<div class="kv-row"><dt>신청서</dt><dd class="mono">' + esc(a.file) + ' <span class="helper">(Drive 저장됨)</span></dd></div></dl>' +
      (a.reason ? '<div class="reason"><b>' + (a.status === '반려' ? '반려 사유' : '처리 메모') + '</b><br>' + esc(a.reason) + '</div>' : '') +
      (opts.cancel && canCancel(a) ? '<div class="btn-row"><button class="btn-ghost btn-sm danger" type="button" data-cancel="' + esc(a.id) + '">신청 취소</button></div>' : '') +
      '</div>';
  }
  function regionOptions(blank) {
    var list = (S.boot && S.boot.config && S.boot.config.regions && S.boot.config.regions.length) ? S.boot.config.regions : REGIONS;
    return '<option value="">' + (blank ? '없음' : '선택하세요') + '</option>' + list.map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('');
  }
  function applyFormHtml(type, people) {
    var forManager = isManager();
    var month = S.boot.month;
    var formUrl = S.boot.config.form_url;
    var formId = (/\/d\/([^\/?#]+)/.exec(formUrl || '') || [])[1];
    var formDl = formId ? 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(formId) : '';
    return '<div class="sec" id="a-form">' +
      '<h2 class="sec-title">' + monthKo(month) + (type === '제외' ? ' 제외 신청' : ' 신규 신청') + (forManager ? ' <span class="helper">(산하 사용인 대리)</span>' : '') + '</h2>' +
      '<p class="sec-desc">' + (type === '제외' ? '처리되면 다음 달부터 배정에서 빠집니다. 이미 받은 이번 달 배정분 피드백은 제출해야 합니다.' : '신청서 양식을 받아 작성한 뒤 촬영하거나 파일로 올립니다.') + '</p>' +
      (forManager ? '<div class="field"><label for="a-who">대상 사용인 <span class="req">*</span></label><select id="a-who">' + people.map(function (u) { return '<option value="' + esc(u.no) + '">' + esc(u.name + ' · ' + (u.br || u.unit || u.hq)) + '</option>'; }).join('') + '</select></div>' : '') +
      '<div class="stepcard"><div class="sc-head"><div class="sc-no">1</div><div><div class="sc-title">신청서 양식 받기</div></div></div>' +
      '<div class="btn-row">' + (formUrl ? '<a class="btn-ghost" href="' + esc(formUrl) + '" target="_blank" rel="noopener" style="flex:1;text-align:center;text-decoration:none">신청서 양식 열기</a>' +
        (formDl ? '<a class="btn-ghost" href="' + esc(formDl) + '" rel="noopener" style="flex:1;text-align:center;text-decoration:none">⬇ PDF 다운로드</a>' : '') :'<span class="helper">양식 파일이 아직 등록되지 않았습니다. RP영업지원팀 안다솜 과장에게 받은 양식을 사용해 주세요.</span>') + '</div></div>' +
      '<div class="stepcard"><div class="sc-head"><div class="sc-no">2</div><div><div class="sc-title">작성한 신청서 촬영 또는 첨부' + (forManager ? ' <span class="helper">(대리 신청도 필수)</span>' : '') + '</div><div class="sc-desc">글자가 선명하고 신청서 전체가 보이도록 촬영해 주세요. PDF·JPG·PNG, ' + S.boot.config.max_upload_mb + 'MB 이하.</div></div></div>' +
      '<div class="upload-box"><button class="upload-btn" type="button" id="a-cam">📷 휴대폰으로 촬영<small>후면 카메라가 바로 열립니다</small></button>' +
      '<button class="upload-btn" type="button" id="a-file">📎 사진·파일 선택<small>' + (IS_ANDROID ? '사진(이미지)' : 'PDF 또는 이미지') + '</small></button></div><div id="a-filechip"></div></div>' +
      (type === '제외'
        ? '<div class="stepcard"><div class="sc-head"><div class="sc-no">3</div><div><div class="sc-title">제외 사유</div></div></div><div class="field"><textarea id="a-memo" placeholder="예: 다음 달부터 휴직 / 활동 중단"></textarea></div></div>'
        : '<div class="stepcard"><div class="sc-head"><div class="sc-no">3</div><div><div class="sc-title">희망지역 (1~3순위)</div><div class="sc-desc">1순위부터 채워지고 부족하면 2·3순위로 넘어갑니다. ' + esc(qtyNote(S.boot.config.apply_qty_default)) + '</div></div></div>' +
          '<div class="fields"><div class="row3">' +
          '<div class="field"><label for="a-r1">1순위 <span class="req">*</span></label><select id="a-r1">' + regionOptions(false) + '</select></div>' +
          '<div class="field"><label for="a-r2">2순위</label><select id="a-r2">' + regionOptions(true) + '</select></div>' +
          '<div class="field"><label for="a-r3">3순위</label><select id="a-r3">' + regionOptions(true) + '</select></div></div></div></div>') +
      '<input type="hidden" id="a-type" value="' + type + '">' +
      '<div class="btn-row"><button class="btn" type="button" id="a-submit" disabled>' + (type === '제외' ? '제외 신청 제출' : '신청서 제출') + '</button><button class="btn-ghost" type="button" id="a-close" style="flex:0 0 auto">닫기</button></div></div>';
  }

  /* ───────── 관리자 신청 탭 = 신청 접수함 ───────── */
  /** 신청자의 관리자(본부장) 이름·연락처 셀. 같은 사업단·지점의 장이 있으면 아래에 작게 함께 표시. */
  function mgrCell(hq, unit, br) {
    var list = (A.mgrs && A.mgrs[hq]) || [];
    if (!list.length) return '<span class="helper" style="color:var(--warn)">본부장 미등록</span>';
    function one(m) { return esc(m.role) + ' ' + esc(m.name) + (m.contact ? ' · <a class="link mono" href="tel:' + esc(m.contact.replace(/-/g, '')) + '">' + esc(m.contact) + '</a>' : ' <span class="helper">(연락처 없음)</span>'); }
    var heads = list.filter(function (m) { return m.role === '본부장'; });
    var subs = list.filter(function (m) { return m.role !== '본부장' && ((unit && m.unit === unit) || (br && m.br === br)); });
    if (!heads.length) heads = list.slice(0, 1);
    return heads.map(function (m) { return '<div>' + one(m) + '</div>'; }).join('') + subs.map(function (m) { return '<div class="cell-sub">' + one(m) + '</div>'; }).join('');
  }
  function inboxHtml() {
    var h = '<div class="sec"><h2 class="sec-title">신청 접수함</h2><p class="sec-desc">신청서 파일을 열어 확인하고 상태를 바꿉니다. 여러 건을 체크해 한 번에 처리하거나, 파이썬 5번 결과 파일을 올려 일괄 반영할 수 있습니다.</p>' +
      '<div class="bulkbar"><span>선택 <span class="cnt" id="b-cnt">0</span>건</span><select id="b-status"><option value="">상태 선택</option>' + STATUS_FLOW.slice(1).concat(['반려']).map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select>' +
      '<input id="b-reason" placeholder="사유 (선택)" style="flex:1;min-width:140px"><button class="btn-ghost btn-sm" type="button" id="b-reason-to" title="사유 칸에 TO 초과 문구를 넣습니다">TO 초과 사유</button><button class="btn btn-sm" type="button" id="b-apply">선택 건 일괄 변경</button>' +
      '<button class="btn-ghost btn-sm" type="button" data-up="allocations">배정 결과 파일로 일괄 반영</button><button class="btn-ghost btn-sm" type="button" id="b-sample">결과 파일 샘플</button></div>' +
      '<div class="table-wrap"><table><thead><tr><th><input type="checkbox" id="b-all"></th><th>접수번호</th><th>신청자</th><th>관리자 (본부장)</th><th>희망지역</th><th>신청서</th><th>상태</th><th>사유</th></tr></thead><tbody>';
    if (!A.apps.length) h += '<tr><td colspan="8" class="dash">이번 달 신청이 없습니다.</td></tr>';
    A.apps.forEach(function (a, i) {
      h += '<tr><td><input type="checkbox" data-sel="' + i + '"></td><td class="mono">' + esc(a.id.slice(3)) + (a.resend ? '<span class="cell-sub" style="color:var(--warn)">재발송 요청</span>' : '') + '</td><td class="name">' + esc(a.name) + (a.type === '제외' ? ' ' + pillOf('제외 신청') : '') + '<span class="cell-sub">' + esc([a.hq, a.br].filter(Boolean).join(' · ')) + (a.by ? ' · 대리 ' + esc(a.by) : '') + (function () { var t = A.toByHq && A.toByHq[a.hq]; return t ? ' · <span style="color:' + (t.full ? 'var(--stop)' : 'var(--sub)') + '">TO ' + t.used + '/' + t.limit + (t.full ? ' 초과' : '') + '</span>' : ''; })() + '</span></td><td>' + mgrCell(a.hq, a.unit, a.br) + '</td><td>' + (a.type === '제외' ? '<span class="dash">—</span>' : esc(a.regions) + ' · ' + a.qty) + '</td>' +
        '<td><a class="link thumb-hover" data-thumb="' + esc((String(a.file_url || '').match(/\/d\/([^\/]+)/) || [])[1] || '') + '" href="' + esc(a.file_url) + '" target="_blank" rel="noopener">열기</a></td>' +
        '<td><select data-app="' + i + '">' + STATUS_FLOW.concat(['반려']).map(function (s) { return '<option' + (s === a.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></td>' +
        '<td><input data-reason="' + i + '" value="' + esc(a.reason) + '" placeholder="사유 · 메모" style="min-width:160px"></td></tr>';
    });
    h += '</tbody></table></div></div>';
    return h;
  }
  async function renderInbox() {
    var el = $('apply');
    el.innerHTML = loadingHtml('접수함을 불러오는 중…');
    try {
      var r = await Promise.all([call('admin.applications'), call('admin.config')]);
      A.apps = r[0].applications; A.month = r[0].month; A.toByHq = r[0].to_by_hq || {}; A.mgrs = r[0].managers_by_hq || {}; A.cfg = r[1].config;
    } catch (e) { el.innerHTML = errorHtml(e); return; }
    el.innerHTML = inboxHtml() + '<div id="apply-checks"></div>';
    var busy = false;
    bindInbox(el, async function (fn, okMsg) { if (busy) return; busy = true; try { await fn(); if (okMsg) toast(okMsg, 'ok'); await renderInbox(); } catch (e) { toast(e.message, 'stop'); } finally { busy = false; } });
  }

  /* 접수함 바인딩 — 신청 탭(관리자) 에서 사용. run(fn, okMsg) 는 처리 후 화면을 다시 그린다. */
  function bindInbox(el, run) {
    $('b-reason-to').addEventListener('click', function () { $('b-reason').value = '본부 TO(' + (A.cfg.hq_to_default || '10') + '명) 초과'; $('b-status').value = '반려'; });
    function selected() { return Array.prototype.map.call(el.querySelectorAll('input[data-sel]:checked'), function (c) { return A.apps[+c.dataset.sel].id; }); }
    function refreshCnt() { $('b-cnt').textContent = selected().length; }
    el.querySelectorAll('input[data-sel]').forEach(function (c) { c.addEventListener('change', refreshCnt); });
    $('b-all').addEventListener('change', function () { el.querySelectorAll('input[data-sel]').forEach(function (c) { c.checked = $('b-all').checked; }); refreshCnt(); });
    $('b-apply').addEventListener('click', function () {
      var ids = selected(), st = $('b-status').value, rs = $('b-reason').value.trim();
      if (!ids.length) { toast('처리할 신청을 체크해 주세요.', 'stop'); return; }
      if (!st) { toast('바꿀 상태를 선택해 주세요.', 'stop'); return; }
      run(async function () { await call('admin.setStatus', { ids: ids, status: st, reason: rs }); }, ids.length + '건을 ' + st + ' 로 일괄 변경했습니다.');
    });
    el.querySelectorAll('select[data-app]').forEach(function (s) { s.addEventListener('change', function () { var a = A.apps[+s.dataset.app]; var rs = el.querySelector('input[data-reason="' + s.dataset.app + '"]').value.trim(); run(async function () { await call('admin.setStatus', { ids: [a.id], status: s.value, reason: rs }); }, a.id + ' → ' + s.value); }); });
    el.querySelectorAll('input[data-reason]').forEach(function (i) { i.addEventListener('change', function () { var a = A.apps[+i.dataset.reason]; run(async function () { await call('admin.setStatus', { ids: [a.id], status: a.status, reason: i.value.trim() }); }, '사유를 저장했습니다.'); }); });
    $('b-sample').addEventListener('click', function () {
      try {
        var aoa = [['사용인번호', '배정건수', '상태', '미배정사유', '배정월']];
        A.apps.forEach(function (a) { aoa.push([a.no, a.type === '제외' ? 0 : a.qty, a.type === '제외' ? '보류' : '배정', a.type === '제외' ? '제외 처리' : '', A.month]); });
        var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '배정결과');
        XLSX.writeFile(wb, '배정결과요약_' + A.month.replace('-', '') + '_샘플.xlsx');
      } catch (e) { toast('파일 저장에 실패했습니다.', 'stop'); }
    });
    el.querySelectorAll('[data-up]').forEach(function (b) { b.addEventListener('click', function () { $('adm-input').dataset.kind = b.dataset.up; $('adm-input').value = ''; $('adm-input').click(); }); });
  }

  async function renderApply() {
    if (isAdmin()) return renderInbox();
    var el = $('apply');
    el.innerHTML = loadingHtml();
    var data;
    try { data = await call('apply.list'); } catch (e) { el.innerHTML = errorHtml(e); return; }
    var html = cautionHtml('유의사항', S.boot.notices.main) + windowNoteHtml('apply');
    var apps = data.applications;

    if (!isManager()) {
      var mine = apps.filter(function (a) { return a.no === S.me.no; });
      var hasNew = mine.some(function (a) { return a.type !== '제외' && a.status !== '반려'; });
      var hasEx = mine.some(function (a) { return a.type === '제외' && a.status !== '반려'; });
      html += '<div class="sec"><h2 class="sec-title">내 신청 현황 <span class="helper">' + monthKo(data.month) + '</span></h2>';
      if (mine.length) mine.forEach(function (a) { html += appCardHtml(a, { cancel: true }); });
      else html += '<p class="sec-desc">이번 달 신청 내역이 없습니다.</p>';
      html += '<div class="btn-row"><button class="btn" type="button" data-open="신규"' + (hasNew ? ' disabled' : '') + '>신규 신청</button>' +
        '<button class="btn-ghost" type="button" data-open="제외"' + (hasEx ? ' disabled' : '') + '>제외 신청</button></div>' +
        '<span class="helper">' + (hasNew ? '신규 신청은 이번 달 1건만 가능합니다. ' : '') + (hasEx ? '제외 신청이 이미 접수되어 있습니다. ' : '') + '취소는 「접수」 상태(서류확인 시작 전)에서만 할 수 있습니다.</span></div>';
      if (S.applyFormType) html += '<hr class="rule">' + applyFormHtml(S.applyFormType, []);
      el.innerHTML = html;
      bindApplyForm(data);
      gateButtons(el, 'apply', '[data-open], #a-submit');
      return;
    }

    var users = data.users;
    var rows = [];
    users.forEach(function (u) { var as = apps.filter(function (a) { return a.no === u.no; }); if (!as.length) rows.push({ u: u, a: null }); as.forEach(function (a) { rows.push({ u: u, a: a }); }); });
    var cnt = { nw: 0, ex: 0, ing: 0, done: 0 };
    apps.forEach(function (a) { if (a.type === '제외') cnt.ex++; else cnt.nw++; if (a.status === '배정완료') cnt.done++; else if (a.status !== '반려') cnt.ing++; });
    S.hqTo = data.to || null;
    if (data.to) {
      var t = data.to;
      html += '<div class="sec"><h2 class="sec-title">' + esc(t.hq) + ' TO 사용 현황</h2>' +
        '<div class="kpis"><div class="kpi ' + (t.full ? 'warn' : 'accent') + '"><span class="kpi-label">TO 사용</span><span class="kpi-value mono">' + t.used + '<small>/ ' + t.limit + '명</small></span></div>' +
        '<div class="kpi"><span class="kpi-label">남은 자리</span><span class="kpi-value mono">' + Math.max(0, t.limit - t.used) + '<small>명</small></span></div>' +
        '<div class="kpi"><span class="kpi-label">접수 대기</span><span class="kpi-value mono">' + t.waiting + '<small>명</small></span></div></div>' +
        (t.full ? '<div class="note alert"><b>TO 가 모두 사용 중입니다</b>새 신청은 접수되지만 자리가 날 때까지 「배정 대기」로 승인될 수 있습니다. 제외 신청으로 자리를 비우면 순서대로 배정됩니다.</div>' : '') +
        '<details><summary class="helper" style="cursor:pointer">사용 중인 사용인 ' + t.used + '명 보기</summary><div class="chips" style="margin-top:6px">' + (t.used_list || []).map(function (u) { return '<span class="chip">' + esc(u.name) + (u.br ? ' · ' + esc(u.br) : '') + '</span>'; }).join('') + '</div></details></div><hr class="rule">';
    }
    html += '<div class="sec"><h2 class="sec-title">' + esc(S.boot.scope) + ' 신청 진행상황</h2><p class="sec-desc">' + monthKo(data.month) + ' 배정분 · 범위 안의 사용인만 표시됩니다. 산하 사용인 대신 신규·제외 신청을 올리거나, 「접수」 상태(서류확인 전)인 신청을 취소할 수 있습니다.</p>' +
      '<div class="kpis"><div class="kpi accent"><span class="kpi-label">신규 신청</span><span class="kpi-value mono">' + cnt.nw + '<small>건</small></span></div>' +
      '<div class="kpi warn"><span class="kpi-label">제외 신청</span><span class="kpi-value mono">' + cnt.ex + '<small>건</small></span></div>' +
      '<div class="kpi"><span class="kpi-label">진행 중</span><span class="kpi-value mono">' + cnt.ing + '<small>건</small></span></div>' +
      '<div class="kpi"><span class="kpi-label">완료</span><span class="kpi-value mono">' + cnt.done + '<small>건</small></span></div></div>' +
      '<div class="btn-row"><button class="btn" type="button" data-open="신규"' + (users.length ? '' : ' data-empty="1"') + '>산하 사용인 신규 신청</button><button class="btn-ghost" type="button" data-open="제외"' + (users.length ? '' : ' data-empty="1"') + '>산하 사용인 제외 신청</button></div>' +
      (users.length ? '' : '<p class="helper" style="color:var(--warn)">아직 ' + esc(S.boot.scope) + ' 범위에 등록된 사용인이 없습니다. 배정자 마스터(users)에 본부가 같은 「사용인」 역할의 사람이 올라와야 대리 신청할 수 있습니다.</p>') + '</div>';
    if (S.applyFormType) html += applyFormHtml(S.applyFormType, users);
    html += '<div class="table-wrap"><table><thead><tr><th>사용인</th><th>구분</th><th>접수일</th><th>희망지역</th><th>진행상태</th><th>사유 · 메모</th><th></th></tr></thead><tbody>';
    if (!rows.length) html += '<tr><td colspan="7" class="dash">범위 안에 등록된 사용인이 없습니다.</td></tr>';
    rows.forEach(function (r) {
      var u = r.u, a = r.a;
      html += '<tr><td class="name">' + esc(u.name) + '<span class="cell-sub">' + esc([u.unit, u.br].filter(Boolean).join(' · ')) + '</span></td>';
      if (!a) { html += '<td class="dash">—</td><td class="dash">—</td><td class="dash">—</td><td>' + pillOf('미신청') + '</td><td class="dash">—</td><td></td></tr>'; return; }
      html += '<td>' + (a.type === '제외' ? pillOf('제외 신청') : '<span class="pill info">신규</span>') + (a.by ? '<span class="cell-sub">대리 ' + esc(a.by) + '</span>' : '') + '</td><td class="mono">' + esc(a.date.slice(5)) + '</td><td>' + (a.type === '제외' ? '<span class="dash">—</span>' : esc(a.regions)) + '</td><td>' + pillOf(statusLabel(a)) + '</td><td class="why">' + (a.reason ? esc(a.reason) : '<span class="dash">—</span>') + '</td>' +
        '<td>' + (canCancel(a) ? '<button class="btn-ghost btn-sm danger" type="button" data-cancel="' + esc(a.id) + '">취소</button>' : '') + '</td></tr>';
    });
    html += '</tbody></table></div><p class="helper">승인·반려·배정 처리는 실무자(어드민)가 합니다. 관리직은 산하 신청 올리기와 「접수」 상태 취소까지만 할 수 있습니다.</p>';
    el.innerHTML = html;
    bindApplyForm(data);
    gateButtons(el, 'apply', '[data-open], #a-submit');
  }

  function bindApplyForm(data) {
    var el = $('apply');
    el.querySelectorAll('[data-open]').forEach(function (b) { b.addEventListener('click', function () {
      if (b.dataset.empty) { toast('산하에 등록된 사용인이 없어 대리 신청할 수 없습니다. 배정자 마스터에 본부가 같은 사용인을 먼저 등록해 주세요.', 'stop'); return; }
      S.applyFormType = b.dataset.open; S.pendingFile = null; renderApply().then(function () { var f = $('a-form'); if (f) f.scrollIntoView({ behavior: 'smooth', block: 'start' }); }); }); });
    el.querySelectorAll('[data-cancel]').forEach(function (b) { b.addEventListener('click', function () { cancelApplication(b.dataset.cancel); }); });
    var close = $('a-close'); if (close) close.addEventListener('click', function () { S.applyFormType = null; S.pendingFile = null; renderApply(); });
    var cam = $('a-cam'), fl = $('a-file');
    if (cam) cam.addEventListener('click', function () { $('cam-input').value = ''; $('cam-input').click(); });
    if (fl) fl.addEventListener('click', function () { $('file-input').value = ''; $('file-input').click(); });
    var sb = $('a-submit'); if (sb) sb.addEventListener('click', submitApplication);
  }
  // 안드로이드는 허용 형식이 여러 개면 선택창에 캠코더까지 뜬다 → 이미지 한 종류로 좁혀 카메라·폴더만 나오게
  if (IS_ANDROID) $('file-input').setAttribute('accept', 'image/*');
  function onApplyFile(e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var okTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (okTypes.indexOf(f.type) < 0) { toast('파일 형식이 맞지 않습니다. PDF 또는 JPG·PNG·WEBP 이미지만 올릴 수 있습니다.', 'stop'); return; }
    var max = (S.boot.config.max_upload_mb || 10) * 1048576;
    if (f.size > max) { toast('파일이 ' + S.boot.config.max_upload_mb + 'MB를 넘습니다. 해상도를 낮춰 다시 촬영해 주세요.', 'stop'); return; }
    S.pendingFile = f;
    var chip = $('a-filechip'); if (!chip) return;
    var isImg = f.type.indexOf('image/') === 0;
    chip.innerHTML = '<div class="filechip">' + (isImg ? '<img id="a-thumb" alt="">' : '<span style="font-size:22px">📄</span>') +
      '<div><div class="fn">' + esc(f.name) + '</div><div class="fs">' + fmtBytes(f.size) + ' · ' + esc(f.type) + '</div></div>' +
      '<button class="btn-ghost btn-sm danger" type="button" id="a-rm">제거</button></div>';
    if (isImg) { var r = new FileReader(); r.onload = function () { var t = $('a-thumb'); if (t) t.src = r.result; }; r.readAsDataURL(f); }
    $('a-rm').addEventListener('click', function () { S.pendingFile = null; chip.innerHTML = ''; $('a-submit').disabled = true; });
    $('a-submit').disabled = false;
  }
  function onAnyFile(e) {
    var target = e.target.dataset.target || 'apply';
    e.target.dataset.target = '';
    if (target === 'public') return onPublicFile(e);
    return onApplyFile(e);
  }
  $('cam-input').addEventListener('change', onAnyFile);
  $('file-input').addEventListener('change', onAnyFile);

  async function submitApplication() {
    var type = $('a-type').value;
    if (!S.pendingFile) { toast('신청서 파일을 먼저 촬영하거나 첨부해 주세요.', 'stop'); return; }
    var payload = { type: type, memo: (type === '제외' && $('a-memo')) ? $('a-memo').value.trim() : '' };
    if (isManager()) payload.target_no = $('a-who').value;
    if (type !== '제외') {
      var regions = [$('a-r1').value, $('a-r2').value, $('a-r3').value].map(function (v) { return (v || '').trim(); }).filter(Boolean);
      if (!regions.length) { toast('희망지역 1순위를 선택해 주세요.', 'stop'); return; }
      var dup = regions.filter(function (r, i) { return regions.indexOf(r) !== i; });
      if (dup.length) { toast('같은 지역을 두 번 선택했습니다: ' + dup[0], 'stop'); return; }
      payload.regions = regions;
      if (isManager() && S.hqTo && S.hqTo.full) {
        var tgt = $('a-who').value, already = (S.hqTo.used_list || []).some(function (u) { return String(u.no) === String(tgt); });
        if (!already && !window.confirm(toAlertText(S.hqTo))) return;
      }
      if (!(await confirmNotices())) return;
    }
    var btn = $('a-submit'); btn.disabled = true; btn.textContent = '업로드 중…';
    try {
      payload.file = { name: S.pendingFile.name, type: S.pendingFile.type, base64: await DB.fileToBase64(S.pendingFile) };
      var r = await call('apply.submit', payload);
      S.pendingFile = null; S.applyFormType = null;
      toast('접수되었습니다. 접수번호 ' + r.id, 'ok');
      renderApply();
    } catch (e) { toast(e.message, 'stop'); btn.disabled = false; btn.textContent = type === '제외' ? '제외 신청 제출' : '신청서 제출'; }
  }
  async function cancelApplication(id) {
    if (!window.confirm(id + ' 신청을 취소할까요? 첨부한 신청서도 함께 삭제됩니다.')) return;
    try { await call('apply.cancel', { id: id }); toast('신청을 취소했습니다.', 'ok'); renderApply(); }
    catch (e) { toast(e.message, 'stop'); }
  }

  /* ───────── 2. 현황 ───────── */
  async function renderBoard() {
    var el = $('board');
    el.innerHTML = loadingHtml();
    var data;
    try { data = await call('alloc.list'); } catch (e) { el.innerHTML = errorHtml(e); return; }
    var k = { applied: 0, assigned: 0, un: 0, hold: 0, fbTotal: 0, fbFilled: 0 };
    data.rows.forEach(function (r) { if (r.applied) k.applied++; if (r.alloc) { if (r.alloc.status === '배정') k.assigned++; else if (r.alloc.status === '미배정') k.un++; else k.hold++; } if (r.feedback) { k.fbTotal += r.feedback.total; k.fbFilled += r.feedback.filled; } });
    var pct = k.fbTotal ? Math.round(k.fbFilled / k.fbTotal * 100) : 0;
    var h = '<div class="sec"><h2 class="sec-title">' + esc(data.scope) + ' 사용 현황</h2><p class="sec-desc">' + monthKo(data.month) + ' 배정분 기준</p>' +
      '<div class="kpis"><div class="kpi accent"><span class="kpi-label">신청</span><span class="kpi-value mono">' + k.applied + '<small>명</small></span></div>' +
      '<div class="kpi"><span class="kpi-label">배정</span><span class="kpi-value mono">' + k.assigned + '<small>명</small></span></div>' +
      '<div class="kpi warn"><span class="kpi-label">미배정</span><span class="kpi-value mono">' + k.un + '<small>명</small></span></div>' +
      '<div class="kpi"><span class="kpi-label">보류</span><span class="kpi-value mono">' + k.hold + '<small>명</small></span></div></div>' +
      '<div><div class="meter-head"><b>피드백 기재율</b><span class="val"><strong>' + pct + '%</strong> · 배정 ' + k.fbTotal + '건 중 ' + k.fbFilled + '건</span></div><div class="meter"><div class="meter-fill" style="width:' + pct + '%"></div></div></div></div>' +
      '<hr class="rule"><div class="sec"><h2 class="sec-title">' + (isManager() ? '배정 대상자' : '내 배정 현황') + '</h2>' +
      '<div class="table-wrap"><table><thead><tr><th>대상자</th><th>상태</th><th style="text-align:right">배정</th><th style="text-align:right">피드백</th><th>비고</th></tr></thead><tbody>';
    if (!data.rows.length) h += '<tr><td colspan="5" class="dash">표시할 사용인이 없습니다.</td></tr>';
    data.rows.forEach(function (r) {
      var u = r.user, al = r.alloc, fb = r.feedback;
      h += '<tr><td class="name">' + esc(u.name) + '<span class="cell-sub mono">' + esc(u.no) + ' · ' + esc(u.br || u.unit || u.hq) + '</span></td>';
      if (!al) { h += '<td>' + pillOf(r.applied ? '접수' : '미신청') + '</td><td class="num dash">—</td><td class="num dash">—</td><td class="dash">—</td></tr>'; return; }
      h += '<td>' + pillOf(al.status) + '</td><td class="num mono">' + (al.count || '<span class="dash">—</span>') + '</td>' +
        '<td class="num mono">' + (fb ? fb.filled + '/' + fb.total : '<span class="dash">—</span>') + '</td>' +
        '<td class="why">' + (al.reason ? esc(al.reason) : '<span class="dash">—</span>') + '</td></tr>';
    });
    h += '</tbody></table></div><p class="helper">미배정·보류 사유는 배정 담당자가 입력한 내용이 그대로 표시됩니다. 고객 계약정보는 이 사이트에 저장되지 않으며 건수만 보입니다.</p></div>';
    el.innerHTML = h;
  }

  /* ───────── 3. 배정·피드백 ───────── */
  async function renderFeed() {
    var el = $('feed');
    el.innerHTML = loadingHtml();
    var data;
    try { data = await call('feedback.list'); } catch (e) { el.innerHTML = errorHtml(e); return; }
    S.feed = data;
    var month = data.month, cfg = S.boot.config;
    if (isManager()) {
      var h = cautionHtml('배정파일 유의사항', S.boot.notices.file) + '<div class="sec"><h2 class="sec-title">배정목록 발송 현황</h2><p class="sec-desc">배정목록(고객 계약정보)은 메일로 전달됩니다. 이 화면에는 발송 기록만 남습니다.</p>' +
        '<div class="table-wrap"><table><thead><tr><th>발송일시</th><th>단위</th><th>대상</th><th>수신</th><th style="text-align:right">건수</th></tr></thead><tbody>';
      if (!data.mails.length) h += '<tr><td colspan="5" class="dash">발송 기록이 없습니다.</td></tr>';
      data.mails.forEach(function (m) { h += '<tr><td class="mono">' + esc(String(m['발송일시']).slice(5, 16).replace('T', ' ')) + '</td><td>' + esc(m['분리단위']) + '</td><td class="name">' + esc(m['대상']) + '</td><td class="mono">' + esc(m['수신자']) + '</td><td class="num mono">' + esc(m['건수']) + '</td></tr>'; });
      h += '</tbody></table></div></div><hr class="rule"><div class="sec"><h2 class="sec-title">피드백 제출 현황</h2>' +
        '<div class="table-wrap"><table><thead><tr><th>대상자</th><th style="text-align:right">배정</th><th style="text-align:right">기재</th><th>검토상태</th><th>최근 제출</th></tr></thead><tbody>';
      if (!data.rows.length) h += '<tr><td colspan="5" class="dash">이번 달 배정된 사용인이 없습니다.</td></tr>';
      data.rows.forEach(function (r) { h += '<tr><td class="name">' + esc(r.user.name) + '<span class="cell-sub">' + esc(r.user.br || r.user.unit) + '</span></td><td class="num mono">' + r.count + '</td><td class="num mono">' + r.filled + '</td><td>' + pillOf(r.review) + '</td><td class="mono">' + (r.at ? esc(r.at.slice(5, 16).replace('T', ' ')) + ' <span class="cell-sub">v' + r.ver + (r.by ? ' · ' + esc(r.by) : '') + (r.note ? ' · ' + esc(r.note) : '') + '</span>' : '<span class="dash">—</span>') + '</td></tr>'; });
      h += '</tbody></table></div><p class="helper">피드백 파일 자체는 Drive 에만 저장되고 관리자만 엽니다. 여기에는 건수와 검토상태만 표시됩니다.</p></div>';
      // 관리직 대리 제출: 산하 사용인 피드백을 모아서 올림
      var canUploadM = data.rows.some(function (r) { return r.count > 0; });
      h += '<hr class="rule"><div class="sec"><h2 class="sec-title">피드백 모아서 제출 <span class="helper">(산하 사용인 대리)</span></h2>' +
        '<p class="sec-desc">사용인이 직접 내지 못한 피드백을 대신 올립니다. <b>사람별 파일을 하나씩</b> 올려도 되고, <b>한 파일에 사람별 시트</b>로 묶어도 되고, <b>한 시트에 전부 붙여넣은 파일</b>도 됩니다. 행마다 있는 사용인번호로 사람을 나눠 각각 제출로 기록합니다.</p>' +
        '<div class="note"><b>업로드 전에 자동으로 확인하는 것</b><ul>' +
        '<li>파일 형식: <span class="mono">.xlsx</span> · 1행 열 제목이 아래와 순서까지 같은 시트만 읽습니다 (그 외 시트는 무시)</li>' +
        '<li>사용인번호 열이 비어 있는 행이 있으면 받지 않습니다 · 계약번호 열은 수정 금지</li>' +
        '<li>사람마다 행 수 = 그 사람의 배정 건수 · 내 범위 밖이거나 배정이 없는 사람은 제외하고 나머지만 접수</li>' +
        '<li>컨택결과: ' + esc(cfg.feedback_results.join(' / ')) + ' · 컨택일자: 2026-11-05 형식</li></ul>' +
        '<div class="chips" style="margin-top:8px">' + cfg.feedback_headers.map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('') + '</div></div>' +
        '<div class="upload-box"><button class="upload-btn" type="button" id="f-pick"' + (canUploadM ? '' : ' disabled') + '>📊 피드백 엑셀 선택<small>' + (canUploadM ? '검사 통과한 사람 분만 제출됩니다' : '이번 달 배정된 사용인이 없습니다') + '</small></button></div>' +
        '<div id="f-checks"></div><div class="btn-row" id="f-actions" hidden><button class="btn" type="button" id="f-submit">검사 통과 · 제출하기</button></div></div>';
      el.innerHTML = h;
      if (windowNoteHtml('feedback')) el.insertAdjacentHTML('afterbegin', windowNoteHtml('feedback'));
      gateButtons(el, 'feedback', '#f-pick, #f-submit');
      $('f-pick').addEventListener('click', function () { $('fb-input').value = ''; $('fb-input').click(); });
      $('f-submit').addEventListener('click', submitFeedback);
      return;
    }

    var al = data.alloc, hist = data.history, last = hist[0] || null, mail = data.mail;
    var h2 = '<div class="sec"><h2 class="sec-title">내 배정목록</h2>';
    if (al && al.status === '배정') {
      h2 += '<div class="result ' + (mail ? 'ok' : 'warn') + '"><div class="result-top"><div class="result-who">' + monthKo(month) + ' 배정분 <span>· ' + al.count + '건</span></div>' + pillOf(mail ? '메일 발송 완료' : '발송 준비 중') + '</div>' +
        (mail ? '<dl class="kv"><div class="kv-row"><dt>발송일시</dt><dd class="mono">' + esc(String(mail['발송일시']).replace('T', ' ')) + '</dd></div><div class="kv-row"><dt>수신</dt><dd class="mono">' + esc(mail['수신자'] || '-') + '</dd></div></dl>' : '<p class="sec-desc" style="margin:0">배정목록은 메일로 발송됩니다. 발송되면 여기에 기록이 표시됩니다.</p>') +
        '<div class="btn-row"><button class="btn-ghost" type="button" id="f-resend"' + (data.resend_requested ? ' disabled' : '') + '>' + (data.resend_requested ? '재발송 요청됨' : '메일 재발송 요청') + '</button></div></div>';
    } else {
      h2 += '<div class="result"><div class="result-top"><div class="result-who">' + monthKo(month) + ' 배정분</div>' + pillOf(al ? al.status : '미신청') + '</div>' + (al && al.reason ? '<div class="reason">' + esc(al.reason) + '</div>' : '<p class="sec-desc">배정이 확정되면 이 자리에 발송 정보가 표시됩니다.</p>') + '</div>';
    }
    h2 += cautionHtml('배정파일 유의사항', S.boot.notices.file);
    // 사이트 다운로드(본인 확인된 엑셀 직접 내려받기)는 추후 개발. 개발 전에는 사용자에게 어떤 안내도 노출하지 않는다 (config.site_download=Y 가 되어도 기능 구현 후 연결).
    h2 += '</div><hr class="rule"><div class="sec"><h2 class="sec-title">피드백 제출</h2><p class="sec-desc">메일로 받은 배정 엑셀에 <b>컨택일자 · 컨택결과 · 상세내용</b>을 기재한 뒤 <b>그 파일 그대로</b> 올립니다. 사진은 받지 않습니다.</p>';
    if (last) {
      var total = al ? al.count : last.rows, pct = total ? Math.round(last.filled / total * 100) : 0;
      h2 += '<div><div class="meter-head"><b>기재 진행률</b><span class="val"><strong>' + last.filled + '건</strong> / 배정 ' + total + '건 · ' + pillOf(last.state) + '</span></div><div class="meter"><div class="meter-fill" style="width:' + pct + '%"></div></div></div>';
      if (last.state === '보완필요') h2 += '<div class="reason"><b>보완 요청</b><br>' + esc(last.note) + '<br><span class="helper">수정한 파일을 다시 올리면 검토가 다시 시작됩니다.</span></div>';
      else if (last.state === '검토중') h2 += '<div class="note info"><b>관리자 검토 중</b>양식 검사를 통과해 접수되었습니다. 관리자가 내용을 확인하면 「제출완료」로 바뀝니다.</div>';
      else if (last.state === '부분제출') h2 += '<div class="note alert"><b>부분 제출</b>미기재 행이 남아 있습니다. 나머지를 기재해 다시 올려야 관리자 검토 대상이 됩니다.</div>';
      else if (last.state === '제출완료') h2 += '<div class="note"><b>제출완료</b>관리자 확인이 끝났습니다. 수정이 필요하면 다시 올릴 수 있습니다.</div>';
    }
    var canUpload = al && al.status === '배정';
    h2 += '<div class="note"><b>업로드 전에 자동으로 확인하는 것</b><ul>' +
      '<li>파일 형식: <span class="mono">.xlsx</span> 만 가능</li>' +
      '<li>1행 열 제목이 아래와 순서까지 같은 시트를 읽습니다 (보통 <span class="mono">' + esc(cfg.feedback_sheet) + '</span> 시트)</li>' +
      '<li>행 수 = 배정 건수' + (canUpload ? ' (' + al.count + '건)' : '') + ' · 계약번호 열은 수정 금지</li>' +
      '<li>컨택결과: ' + esc(cfg.feedback_results.join(' / ')) + ' · 컨택일자: 2026-11-05 형식</li></ul>' +
      '<div class="chips" style="margin-top:8px">' + cfg.feedback_headers.map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('') + '</div></div>' +
      '<div class="upload-box"><button class="upload-btn" type="button" id="f-pick"' + (canUpload ? '' : ' disabled') + '>📊 피드백 엑셀 선택<small>' + (canUpload ? '검사 통과 후에만 제출됩니다' : '이번 달 배정이 없어 제출할 수 없습니다') + '</small></button></div>' +
      '<div id="f-checks"></div><div class="btn-row" id="f-actions" hidden><button class="btn" type="button" id="f-submit">검사 통과 · 제출하기</button></div></div>';
    h2 += '<hr class="rule"><div class="sec"><h2 class="sec-title">제출 이력</h2>';
    if (hist.length) {
      h2 += '<div class="table-wrap"><table><thead><tr><th>제출일시</th><th>버전</th><th style="text-align:right">행</th><th style="text-align:right">기재</th><th>상태</th></tr></thead><tbody>';
      hist.forEach(function (x) { h2 += '<tr><td class="mono">' + esc(x.at.replace('T', ' ').slice(0, 16)) + '</td><td class="mono">v' + x.ver + '</td><td class="num mono">' + x.rows + '</td><td class="num mono">' + x.filled + '</td><td>' + pillOf(x.state) + (x.note ? '<span class="cell-sub">' + esc(x.note) + '</span>' : '') + '</td></tr>'; });
      h2 += '</tbody></table></div>';
    } else h2 += '<p class="sec-desc">아직 제출한 파일이 없습니다.</p>';
    h2 += '<p class="helper">같은 배정월에 다시 올리면 버전이 올라가고, 마지막 파일이 유효합니다.</p></div>';
    el.innerHTML = h2;
    if (windowNoteHtml('feedback')) el.insertAdjacentHTML('afterbegin', windowNoteHtml('feedback'));
    gateButtons(el, 'feedback', '#f-pick, #f-submit');

    var rs = $('f-resend'); if (rs) rs.addEventListener('click', async function () { try { await call('apply.requestResend'); toast('재발송을 요청했습니다. 실무자에게 전달됩니다.', 'ok'); renderFeed(); } catch (e) { toast(e.message, 'stop'); } });
    $('f-pick').addEventListener('click', function () { $('fb-input').value = ''; $('fb-input').click(); });
    $('f-submit').addEventListener('click', submitFeedback);
  }

  function validateWorkbook(wb, fileName) {
    var cfg = S.boot.config, FB_HEADERS = cfg.feedback_headers, FB_RESULTS = cfg.feedback_results, FB_SHEET = cfg.feedback_sheet;
    var checks = [], fatal = false;
    function add(label, state, msg) { checks.push({ label: label, state: state, msg: msg }); if (state === 'fail') fatal = true; }
    if (!/\.xlsx$/i.test(fileName)) { add('파일 형식', 'fail', '파일 형식이 맞지 않습니다. 배정받은 엑셀(.xlsx) 파일을 올려주세요.'); return { ok: false, checks: checks }; }
    add('파일 형식', 'pass', '.xlsx');
    // 열 제목이 양식과 같은 시트를 전부 읽는다 (개인 파일 '피드백' 시트 · 사람별 시트 · 합본 시트). 나머지 시트(상세·요약 등)는 무시.
    var used = [], orderBad = [], rows = [], header = FB_HEADERS.slice();
    wb.SheetNames.forEach(function (name) {
      var aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
      var hdr = (aoa[0] || []).map(function (c) { return String(c).trim(); });
      if (!FB_HEADERS.every(function (c) { return hdr.indexOf(c) >= 0; })) return;
      if (!FB_HEADERS.every(function (c, i) { return hdr[i] === c; })) { orderBad.push(name); return; }
      used.push(name);
      aoa.slice(1).forEach(function (r, k) { if (r.some(function (c) { return String(c).trim() !== ''; })) rows.push({ r: r.slice(0, FB_HEADERS.length), where: name + ' ' + (k + 2) + '행' }); });
    });
    if (orderBad.length) { add('열 제목', 'fail', '양식이 다릅니다. 열 순서가 바뀐 시트: ' + orderBad.join(', ') + '. 원본 양식의 순서를 유지해 주세요.'); return { ok: false, checks: checks }; }
    if (!used.length) { add('시트', 'fail', "양식 시트를 찾을 수 없습니다. 1행 열 제목이 양식과 같은 시트가 없습니다. (있는 시트: " + wb.SheetNames.join(', ') + ')'); return { ok: false, checks: checks }; }
    add('시트', 'pass', used.length === 1 ? used[0] : used.length + '개 시트 (' + used.slice(0, 4).join(', ') + (used.length > 4 ? ' …' : '') + ')');
    add('열 제목', 'pass', FB_HEADERS.length + '개 열 일치');
    if (!rows.length) { add('행 수', 'fail', '데이터 행이 없습니다.'); return { ok: false, checks: checks }; }
    var iC = FB_HEADERS.indexOf('계약번호'), iE = FB_HEADERS.indexOf('사용인번호'), iD = FB_HEADERS.indexOf('컨택일자'), iR = FB_HEADERS.indexOf('컨택결과'), iM = FB_HEADERS.indexOf('상세내용');
    var badC = [], noE = [], badD = [], badR = [], byNo = {}, order = [];
    rows.forEach(function (x) {
      var r = x.r;
      if (iC >= 0 && !/^\d{4}\*{4,}$/.test(String(r[iC] || '').trim())) badC.push(x.where);
      var no = String(iE >= 0 ? r[iE] : '').trim().replace(/\.0+$/, '');
      if (!no) { noE.push(x.where); return; }
      var d = String(r[iD] || '').trim(), res = String(r[iR] || '').trim(), m = String(r[iM] || '').trim();
      if (!byNo[no]) { byNo[no] = { no: no, rows: [], filled: 0, empty: 0 }; order.push(no); }
      byNo[no].rows.push(r);
      if (!d && !res && !m) { byNo[no].empty++; return; }
      byNo[no].filled++;
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) badD.push(x.where);
      if (res && FB_RESULTS.indexOf(res) < 0) badR.push(x.where);
    });
    function few(a) { return a.slice(0, 4).join(', ') + (a.length > 4 ? ' 외 ' + (a.length - 4) : ''); }
    if (badC.length) add('계약번호', 'fail', '계약번호 열이 수정되었습니다. 원본 그대로 두세요. (' + few(badC) + ')'); else add('계약번호', 'pass', '마스킹 원본 유지');
    if (noE.length) add('사용인번호', 'fail', '사용인번호가 비어 있는 행이 있어 누구의 피드백인지 알 수 없습니다. (' + few(noE) + ')');
    if (badR.length) add('컨택결과', 'fail', '컨택결과는 (' + FB_RESULTS.join(' / ') + ') 중 하나여야 합니다. (' + few(badR) + ')'); else add('컨택결과', 'pass', '허용값 확인');
    if (badD.length) add('컨택일자', 'fail', '컨택일자 형식이 올바르지 않습니다 (예: 2026-11-05). (' + few(badD) + ')'); else add('컨택일자', 'pass', '날짜 형식 확인');
    if (fatal) return { ok: false, checks: checks };
    // 사람별 대조: 본인(사용인) 또는 범위 안 사용인(관리직), 이번 달 배정, 행 수 = 배정 건수
    var expect = {};
    if (isManager()) (S.feed && S.feed.rows || []).forEach(function (x) { expect[String(x.user.no)] = { name: x.user.name, count: x.count }; });
    else if (S.feed && S.feed.alloc && S.feed.alloc.status === '배정') expect[String(S.me.no)] = { name: S.me.name, count: S.feed.alloc.count };
    var people = [], okRows = [], filled = 0, empty = 0, nrows = 0;
    order.forEach(function (no) {
      var g = byNo[no], e = expect[no], item = { no: no, name: e ? e.name : '', rows: g.rows.length, filled: g.filled, empty: g.empty };
      if (!e) { item.skip = isManager() ? '내 범위에 없거나 배정이 없는 사용인' : '본인 사용인번호가 아님'; }
      else if (e.count > 0 && g.rows.length !== e.count) { item.skip = '행 수 불일치 (배정 ' + e.count + '건 · 파일 ' + g.rows.length + '행)'; }
      else { okRows = okRows.concat(g.rows); filled += g.filled; empty += g.empty; nrows += g.rows.length; }
      people.push(item);
    });
    var okPeople = people.filter(function (x) { return !x.skip; }), skipped = people.filter(function (x) { return x.skip; });
    if (!okPeople.length) { add('대상자', 'fail', '접수할 수 있는 사용인이 없습니다. ' + skipped.map(function (x) { return (x.name || x.no) + ': ' + x.skip; }).join(' / ')); return { ok: false, checks: checks, people: people }; }
    add('대상자', skipped.length ? 'warn' : 'pass', okPeople.length + '명 접수 가능' + (skipped.length ? ' · ' + skipped.length + '명 제외 (아래 표 참고)' : '') + (isManager() ? '' : ' · ' + S.me.no));
    if (empty) add('미기재', 'warn', '아직 기재하지 않은 행이 ' + empty + '건 있습니다. 부분 제출로 올릴 수 있고, 나중에 다시 올리면 됩니다.'); else add('미기재', 'pass', '전 건 기재');
    return { ok: true, checks: checks, rows: nrows, filled: filled, empty: empty, people: people, aoa: [header].concat(okRows) };
  }
  function showChecks(v, fileName) {
    var box = $('f-checks');
    var h = '<div class="checks">' + (fileName ? '<div class="helper">검사 파일: <span class="mono">' + esc(fileName) + '</span></div>' : '');
    v.checks.forEach(function (c) { h += '<div class="check ' + c.state + '"><span class="ic">' + (c.state === 'pass' ? '✓' : c.state === 'warn' ? '!' : '✕') + '</span><div><b>' + esc(c.label) + '</b><small>' + esc(c.msg) + '</small></div></div>'; });
    h += '</div>';
    if (v.people && v.people.length) {
      h += '<div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>사용인</th><th style="text-align:right">행</th><th style="text-align:right">기재</th><th>결과</th></tr></thead><tbody>';
      v.people.forEach(function (x) { h += '<tr><td class="name">' + esc(x.name || '(미등록)') + '<span class="cell-sub mono">' + esc(x.no) + '</span></td><td class="num mono">' + x.rows + '</td><td class="num mono">' + x.filled + '</td><td>' + (x.skip ? pillOf('제외') + '<span class="cell-sub">' + esc(x.skip) + '</span>' : pillOf(x.empty ? '부분제출' : '검토중')) + '</td></tr>'; });
      h += '</tbody></table></div>';
    }
    box.innerHTML = h;
    $('f-actions').hidden = !v.ok;
    S.fbValidation = v.ok ? v : null;
    if (!v.ok) toast('업로드할 수 없습니다. 표시된 항목을 고친 뒤 다시 선택해 주세요.', 'stop');
    else toast(v.empty ? '검사 통과 (미기재 ' + v.empty + '건 · 부분 제출 가능)' : '검사 통과', 'ok');
  }
  $('fb-input').addEventListener('change', async function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) { showChecks(validateWorkbook({ Sheets: {}, SheetNames: [] }, f.name), f.name); return; }
    try {
      var wb = XLSX.read(new Uint8Array(await DB.fileToArrayBuffer(f)), { type: 'array' });
      var v = validateWorkbook(wb, f.name);
      v.file = f;
      showChecks(v, f.name);
    } catch (err) { showChecks({ ok: false, checks: [{ label: '파일 읽기', state: 'fail', msg: '엑셀 파일을 열 수 없습니다. 손상되었거나 암호가 걸려 있습니다.' }] }, f.name); }
  });
  async function submitFeedback() {
    var v = S.fbValidation; if (!v || !v.file) return;
    var btn = $('f-submit'); btn.disabled = true; btn.textContent = '업로드 중…';
    try {
      var r = await call('feedback.submit', { rows: v.aoa, file: { name: v.file.name, base64: await DB.fileToBase64(v.file) } });
      S.fbValidation = null;
      var n = (r.people || []).length;
      if (n > 1) toast(n + '명 분 제출되었습니다 (' + r.people.map(function (x) { return x.name + ' ' + x.filled + '/' + x.rows; }).join(', ') + ')' + (r.skipped && r.skipped.length ? ' · ' + r.skipped.length + '명 제외' : ''), 'ok');
      else toast(r.state === '검토중' ? '제출되었습니다. 관리자가 확인하면 「제출완료」로 바뀝니다.' : '부분 제출되었습니다. 나머지를 기재해 다시 올리면 검토 대상이 됩니다.', 'ok');
      renderFeed();
    } catch (e) { toast(e.message, 'stop'); btn.disabled = false; btn.textContent = '검사 통과 · 제출하기'; }
  }

  /* ───────── 4. 일정 ───────── */
  async function renderSched() {
    var el = $('sched');
    el.innerHTML = loadingHtml();
    var data;
    try { data = await call('sched.get'); } catch (e) { el.innerHTML = errorHtml(e); return; }
    var m = parseInt(data.month.slice(5), 10);
    var h = '<div class="sec"><h2 class="sec-title" style="font-size:17px">' + m + '월 기계약DB 일정</h2><div class="sched-list">';
    if (!data.schedule.length) h += '<div class="sched-row"><span class="sl dash">등록된 일정이 없습니다.</span></div>';
    data.schedule.forEach(function (r) { h += '<div class="sched-row"><span class="sl">' + esc(r['항목']) + '</span><span class="sd">' + esc(r['날짜']) + '</span></div>'; });
    h += '</div></div>';
    if (data.notices.notice.length) {
      h += '<hr class="rule"><div class="sec"><h2 class="sec-title">공지</h2>';
      data.notices.notice.forEach(function (n) { h += '<div class="note"><b>' + esc(n.title) + ' <span class="helper mono">' + esc(n.at) + '</span></b>' + esc(n.body) + '</div>'; });
      h += '</div>';
    }
    el.innerHTML = h;
  }

  /* ───────── 5. 효율 (관리자) ───────── */
  function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }
  function meterCell(v) { return '<div style="display:flex;align-items:center;gap:8px"><div class="meter" style="min-width:70px;flex:1"><div class="meter-fill" style="width:' + Math.min(100, v) + '%"></div></div><span class="mono" style="font-size:12px">' + v + '%</span></div>'; }
  async function renderStats() {
    var el = $('stats');
    el.innerHTML = loadingHtml();
    var d;
    try { d = await call('admin.stats', { month: S.statMonth }); } catch (e) { el.innerHTML = errorHtml(e); return; }
    var months = d.months;
    var h = '<div class="sec"><div class="result-top"><h2 class="sec-title">효율 현황 <span class="helper">전사</span></h2><select id="s-month" style="width:auto">' + months.map(function (m) { return '<option' + (m === d.month ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select></div>' +
      '<p class="sec-desc">지역별 수치는 파이썬 결과 요약(stats_region)에서, 사용자·배정 수치는 users·allocations 시트에서 집계합니다. 고객 정보는 포함되지 않습니다.</p>';
    var tot = { extC: 0, extCust: 0, asC: 0, asCust: 0 };
    d.region.forEach(function (r) { tot.extC += r.extC; tot.extCust += r.extCust; tot.asC += r.asC; tot.asCust += r.asCust; });
    h += '<div class="kpis"><div class="kpi"><span class="kpi-label">추출 고아계약</span><span class="kpi-value mono">' + tot.extC.toLocaleString() + '<small>건</small></span></div><div class="kpi"><span class="kpi-label">추출 고객</span><span class="kpi-value mono">' + tot.extCust.toLocaleString() + '<small>명</small></span></div><div class="kpi accent"><span class="kpi-label">배정 계약</span><span class="kpi-value mono">' + tot.asC + '<small>건</small></span></div><div class="kpi accent"><span class="kpi-label">배정 고객</span><span class="kpi-value mono">' + tot.asCust + '<small>명</small></span></div></div>' +
      '<h3 class="sec-title" style="font-size:13.5px">지역별 고아계약 추출 · 배정</h3><div class="table-wrap"><table><thead><tr><th>지역</th><th style="text-align:right">추출 계약</th><th style="text-align:right">추출 고객</th><th style="text-align:right">배정 계약</th><th style="text-align:right">배정 고객</th><th>배정률(고객)</th></tr></thead><tbody>';
    if (!d.region.length) h += '<tr><td colspan="6" class="dash">이 달의 지역별 요약이 아직 업로드되지 않았습니다 (관리 탭 → 파이프라인 → 효율 요약 업로드).</td></tr>';
    d.region.forEach(function (r) { h += '<tr><td class="name">' + esc(r.region) + '</td><td class="num mono">' + r.extC.toLocaleString() + '</td><td class="num mono">' + r.extCust.toLocaleString() + '</td><td class="num mono">' + r.asC + '</td><td class="num mono">' + r.asCust + '</td><td>' + meterCell(pct(r.asCust, r.extCust)) + '</td></tr>'; });
    if (d.region.length) h += '<tr><td class="name">합계</td><td class="num mono">' + tot.extC.toLocaleString() + '</td><td class="num mono">' + tot.extCust.toLocaleString() + '</td><td class="num mono">' + tot.asC + '</td><td class="num mono">' + tot.asCust + '</td><td class="mono" style="font-size:12px">' + pct(tot.asCust, tot.extCust) + '%</td></tr>';
    h += '</tbody></table></div></div><hr class="rule">';
    h += '<div class="sec"><h2 class="sec-title">본부별 사용자 수 <span class="helper">' + esc(d.month) + '</span></h2><div class="table-wrap"><table><thead><tr><th>본부</th><th style="text-align:right">사용인</th><th style="text-align:right">신청</th><th style="text-align:right">배정 인원</th><th style="text-align:right">배정 건수</th><th>사용률</th></tr></thead><tbody>';
    if (!d.byHq.length) h += '<tr><td colspan="6" class="dash">등록된 사용인이 없습니다.</td></tr>';
    d.byHq.forEach(function (g) { h += '<tr><td class="name">' + esc(g.hq) + '</td><td class="num mono">' + g.users + '</td><td class="num mono">' + g.applied + '</td><td class="num mono">' + g.assigned + '</td><td class="num mono">' + g.count + '</td><td>' + meterCell(pct(g.assigned, g.users)) + '</td></tr>'; });
    h += '</tbody></table></div><p class="helper">사용률 = 배정 인원 ÷ 사용인 수. 이 탭은 어드민 관리자에게만 보입니다.</p></div><hr class="rule">';
    h += '<div class="sec"><h2 class="sec-title">월별 배정 건수</h2><div class="table-wrap"><table><thead><tr><th>본부</th>' + months.map(function (m) { return '<th style="text-align:right">' + m.slice(2).replace('-', '.') + '</th>'; }).join('') + '<th style="text-align:right">합계</th></tr></thead><tbody>';
    d.byHq.forEach(function (g) { var tot2 = 0; h += '<tr><td class="name">' + esc(g.hq) + '</td>' + months.map(function (m) { var v = g.months[m] || 0; tot2 += v; return '<td class="num mono">' + (v || '<span class="dash">—</span>') + '</td>'; }).join('') + '<td class="num mono"><b>' + tot2 + '</b></td></tr>'; });
    h += '</tbody></table></div><div class="table-wrap"><table><thead><tr><th>사용자</th>' + months.map(function (m) { return '<th style="text-align:right">' + m.slice(2).replace('-', '.') + '</th>'; }).join('') + '<th style="text-align:right">합계</th></tr></thead><tbody>';
    if (!d.byUser.length) h += '<tr><td colspan="' + (months.length + 2) + '" class="dash">배정 이력이 없습니다.</td></tr>';
    d.byUser.forEach(function (x) { h += '<tr><td class="name">' + esc(x.user.name) + '<span class="cell-sub">' + esc(x.user.hq + ' · ' + (x.user.br || x.user.unit)) + '</span></td>' + months.map(function (m) { var v = x.months[m] || 0; return '<td class="num mono">' + (v || '<span class="dash">—</span>') + '</td>'; }).join('') + '<td class="num mono"><b>' + x.total + '</b></td></tr>'; });
    h += '</tbody></table></div></div>';
    el.innerHTML = h;
    $('s-month').addEventListener('change', function () { S.statMonth = $('s-month').value; renderStats(); });
  }

  /* ───────── 파일 마우스오버 미리보기 (관리자) ───────── */
  var THUMB = { cache: {}, el: null, cur: '' };
  function thumbBox() {
    if (!THUMB.el) { THUMB.el = document.createElement('div'); THUMB.el.className = 'thumb-pop'; THUMB.el.hidden = true; document.body.appendChild(THUMB.el); }
    return THUMB.el;
  }
  function thumbMove(e) { var b = thumbBox(), x = e.clientX + 16, y = e.clientY + 16; if (x + 340 > window.innerWidth) x = e.clientX - 356; if (y + 460 > window.innerHeight) y = Math.max(8, window.innerHeight - 468); b.style.left = x + 'px'; b.style.top = y + 'px'; }
  document.addEventListener('mouseover', async function (e) {
    var a = e.target.closest && e.target.closest('.thumb-hover'); if (!a || !a.dataset.thumb) return;
    var id = a.dataset.thumb, b = thumbBox(); THUMB.cur = id; b.hidden = false; thumbMove(e);
    if (!THUMB.cache[id]) {
      b.innerHTML = '<div class="thumb-msg">미리보기 불러오는 중…</div>';
      try { var r = await call('admin.thumb', { id: id }); THUMB.cache[id] = { src: 'data:' + r.mime + ';base64,' + r.base64, name: r.name }; }
      catch (err) { THUMB.cache[id] = { err: err.message }; }
    }
    if (THUMB.cur !== id) return;
    var t = THUMB.cache[id];
    b.innerHTML = t.err ? '<div class="thumb-msg">' + esc(t.err) + '</div>' : '<img src="' + t.src + '" alt=""><div class="thumb-name">' + esc(t.name) + ' · 클릭하면 원본</div>';
  });
  document.addEventListener('mousemove', function (e) { if (THUMB.el && !THUMB.el.hidden) thumbMove(e); });
  document.addEventListener('mouseout', function (e) { var a = e.target.closest && e.target.closest('.thumb-hover'); if (a && THUMB.el) { THUMB.el.hidden = true; THUMB.cur = ''; } });

  /* ───────── 6. 관리 (관리자) ───────── */
  var A = {};
  async function renderAdmin() {
    var el = $('admin');
    el.innerHTML = loadingHtml('관리 데이터를 불러오는 중…');
    try {
      var r = await Promise.all([call('admin.applications'), call('admin.feedbacks'), call('admin.pipeline'), call('admin.mail'), call('admin.config'), call('admin.logs', { limit: 40 }), call('admin.users')]);
      A = { apps: r[0].applications, month: r[0].month, toByHq: r[0].to_by_hq || {}, mgrs: r[0].managers_by_hq || {}, fbs: r[1].rows, steps: r[2].steps, mails: r[3].mails, cfg: r[4].config, logs: r[5].rows, users: r[6].users || [] };
    } catch (e) { el.innerHTML = errorHtml(e); return; }
    var h = '';

    /* 설정 요약 */
    h += '<div class="sec"><div class="result-top"><h2 class="sec-title">현재 배정월 <span class="month-chip">' + esc(A.month) + '</span></h2><div class="btn-row" style="flex:0 0 auto"><input id="c-month" class="mono" value="' + esc(A.month) + '" style="width:110px"><button class="btn-ghost btn-sm" type="button" id="c-month-save">배정월 변경</button></div></div>' +
      '<p class="sec-desc">등록 사용인 ' + A.cfg.user_count + '명 · Drive 폴더 <a class="link" href="' + esc(A.cfg.folder_url) + '" target="_blank" rel="noopener">열기</a>' + (A.cfg.user_count ? '' : ' · <b style="color:var(--stop)">배정자 마스터를 먼저 업로드하세요 (아래 2번)</b>') + '</p></div><hr class="rule">';


    /* 접수함 → 신청 탭 */
    h += '<div class="sec"><h2 class="sec-title">신청 접수함 <span class="helper">' + A.apps.length + '건</span></h2><p class="sec-desc">신청서 확인·상태 변경은 <a class="link" href="#" data-goto="apply">신청 탭</a>에서 합니다.</p></div><hr class="rule">';

    /* 파이프라인 */
    var PY = { 1: ['db_logic_v3_1_fixed.run_all_steps', true, 'DW 추출 xlsx (a·b 시트)', '1단계_DB필터링 (jis/va/del)'], 2: ['applicant_mapper.py', false, '인사정보 + 신청리스트', '관리리스트 + 배정자 마스터'], 3: ['region_supply.py', false, '1단계 jis 시트', '지역별_DB수량.xlsx'], 4: ['assignment_plan_builder.build_plan', true, '3번 + 관리리스트 + 기준월', '배정표.xlsx'], 5: ['db_assign_v3_1.auto_assignment_logic', true, 'DB 시트 + 배정표', '자동배정 결과 + 배정결과요약 + 효율요약'], 6: ['split_and_mask.py', false, '5번 DB_처리결과 + 배정자 마스터', '배정본_*.xlsx (사용인별 시트)'] };
    h += '<div class="sec"><h2 class="sec-title">' + monthKo(A.month) + ' 작업 파이프라인</h2><p class="sec-desc">파이썬은 실무자 PC 에서 실행합니다. 여기에는 단계별 완료 상태와 요약만 기록하고, 결과 중 허용된 열만 업로드합니다.</p>' +
      '<div class="bulkbar"><button class="btn-ghost btn-sm" type="button" data-up="users">② 배정자 마스터 업로드</button><button class="btn-ghost btn-sm" type="button" data-up="allocations">⑤ 배정 결과 요약 업로드</button><button class="btn-ghost btn-sm" type="button" data-up="stats">⑤ 지역별 효율 요약 업로드</button><button class="btn-ghost btn-sm" type="button" id="u-export">applications 내보내기 (csv)</button></div><div class="pipe">';
    A.steps.forEach(function (p) {
      var py = PY[p.step];
      h += '<div class="pipe-card' + (p.done ? ' done' : '') + '"><div class="ph"><div class="pn"><em>' + p.step + '</em>' + esc(p.name) + '</div>' + pillOf(p.done ? '완료' : '대기') + '</div>' +
        '<div class="py"><span class="tag ' + (py[1] ? 'have' : 'new') + '">' + (py[1] ? '있음' : '신규') + '</span> ' + esc(py[0]) + '</div><div class="io"><b>입력</b> ' + esc(py[2]) + '<br><b>출력</b> ' + esc(py[3]) + '</div>' +
        (p.done ? '<div class="io"><b>완료</b> <span class="mono">' + esc(p.at.replace('T', ' ').slice(0, 16)) + '</span>' + (p.summary ? ' · ' + esc(p.summary) : '') + '</div>' : '') +
        '<div class="btn-row"><input data-sum="' + p.step + '" placeholder="요약 (예: jis 1,284건)" value="' + esc(p.summary) + '" style="flex:1;min-width:100px"><button class="btn-ghost btn-sm" type="button" data-toggle="' + p.step + '" data-done="' + (p.done ? 1 : 0) + '">' + (p.done ? '완료 해제' : '완료 처리') + '</button></div></div>';
    });
    h += '</div><div class="boundary"><div class="bx local"><b>실무자 PC 에만 두는 것</b><ul><li>인사정보 원본 (주민번호 · 주소 · 계좌)</li><li>DW 추출본 · 필터링 결과 · 배정 결과(고객 계약정보)</li><li>배정본 xlsx (메일 발송용)</li></ul></div>' +
      '<div class="bx site"><b>사이트에 올라가는 것</b><ul><li>배정자 마스터: 사용인번호 · 이름 · 본부 · 사업단 · 지점 · 역할 · 휴대폰번호(서버가 즉시 해시로 변환) · 위촉상태 · 보험사코드_* · 연락처(관리직만 원문 보관 · 접수함 표시용)</li><li>배정 결과 요약: 사용인번호 · 배정건수 · 상태 · 미배정사유</li><li>지역별 효율 요약: 지역 · 추출계약수 · 추출고객수 · 배정계약수 · 배정고객수</li></ul></div></div><div id="adm-checks"></div></div><hr class="rule">';

    /* 피드백 검토함 */
    var waiting = A.fbs.filter(function (f) { return f.review === '검토중'; }).length;
    h += '<div class="sec"><h2 class="sec-title">피드백 검토함 <span class="helper">' + monthKo(A.month) + '</span></h2><p class="sec-desc">업로드 때 양식 검사는 끝난 파일입니다. 내용을 열어 확인한 뒤 <b>확인완료</b>를 눌러야 사용자 화면이 「제출완료」로 바뀝니다.</p>' +
      '<div class="bulkbar"><span>검토 대기 <span class="cnt">' + waiting + '</span>건</span><button class="btn btn-sm" type="button" id="fb-all-ok"' + (waiting ? '' : ' disabled') + '>검토중 전건 확인완료</button></div>' +
      '<div class="table-wrap"><table><thead><tr><th>사용인</th><th style="text-align:right">배정</th><th style="text-align:right">기재</th><th>최근 제출</th><th>파일</th><th>상태</th><th>처리</th></tr></thead><tbody>';
    if (!A.fbs.length) h += '<tr><td colspan="7" class="dash">제출된 피드백이 없습니다.</td></tr>';
    A.fbs.forEach(function (f, i) {
      h += '<tr><td class="name">' + esc(f.name) + '<span class="cell-sub">' + esc([f.hq, f.br].filter(Boolean).join(' · ')) + '</span>' + (function () { var m = ((A.mgrs || {})[f.hq] || []).filter(function (x) { return x.role === '본부장'; })[0]; return m ? '<span class="cell-sub">본부장 ' + esc(m.name) + (m.contact ? ' · ' + esc(m.contact) : '') + '</span>' : ''; })() + '</td><td class="num mono">' + f.count + '</td><td class="num mono">' + f.filled + '</td><td class="mono">' + esc(f.at.slice(5, 16).replace('T', ' ')) + '<span class="cell-sub">v' + f.ver + (f.by ? ' · ' + esc(f.by) : '') + '</span></td>' +
        '<td><a class="link thumb-hover" data-thumb="' + esc((String(f.file_url || '').match(/\/d\/([^\/]+)/) || [])[1] || '') + '" href="' + esc(f.file_url) + '" target="_blank" rel="noopener">열기</a></td><td>' + pillOf(f.review) + (f.note ? '<span class="cell-sub">' + esc(f.note) + '</span>' : '') + '</td>' +
        '<td>' + (f.review === '제출완료' ? '<span class="helper">확인 ' + esc(f.confirmed_at.slice(5, 16).replace('T', ' ')) + ' ' + esc(f.confirmed_by) + '</span>' :
          '<div class="btn-row" style="flex-wrap:nowrap"><button class="btn btn-sm" type="button" data-fbok="' + i + '"' + (f.review === '부분제출' ? ' disabled title="부분 제출은 확인 대상이 아닙니다"' : '') + '>확인완료</button><input data-fbnote="' + i + '" placeholder="보완 사유" style="min-width:120px"><button class="btn-ghost btn-sm danger" type="button" data-fbfix="' + i + '">보완요청</button></div>') + '</td></tr>';
    });
    h += '</tbody></table></div></div><hr class="rule">';

    /* 메일 기록 */
    h += '<div class="sec"><h2 class="sec-title">배정목록 메일 발송 기록</h2><div class="fields"><div class="row3">' +
      '<div class="field"><label for="m-unit">분리 단위</label><select id="m-unit"><option>본부</option><option>사업단</option><option>지점</option><option selected>사용인</option></select></div>' +
      '<div class="field"><label for="m-target">대상 (이름 또는 조직명)</label><input id="m-target" placeholder="김민준 / 강남본부"></div>' +
      '<div class="field"><label for="m-count">건수</label><input id="m-count" class="mono" inputmode="numeric" placeholder="12"></div></div>' +
      '<div class="row2"><div class="field"><label for="m-to">수신 메일 (선택)</label><input id="m-to" placeholder="mj****@..."></div><div class="field"><label>&nbsp;</label><button class="btn-ghost" type="button" id="m-add">발송 기록 추가</button></div></div></div>' +
      '<div class="table-wrap"><table><thead><tr><th>발송일시</th><th>단위</th><th>대상</th><th>수신</th><th style="text-align:right">건수</th><th>담당</th></tr></thead><tbody>';
    if (!A.mails.length) h += '<tr><td colspan="6" class="dash">기록이 없습니다.</td></tr>';
    A.mails.forEach(function (m) { h += '<tr><td class="mono">' + esc(String(m['발송일시']).replace('T', ' ').slice(0, 16)) + '</td><td>' + esc(m['분리단위']) + '</td><td class="name">' + esc(m['대상']) + '</td><td class="mono">' + esc(m['수신자']) + '</td><td class="num mono">' + esc(m['건수']) + '</td><td>' + esc(m['담당자']) + '</td></tr>'; });
    h += '</tbody></table></div><p class="helper">사용인 단위 기록은 대상 이름이 일치하는 사용인의 화면에 "메일 발송 완료"로 표시됩니다.</p></div><hr class="rule">';

    /* 일정 · 유의사항 */
    h += '<div class="sec"><h2 class="sec-title">일정 · 유의사항 · 공지</h2><p class="sec-desc">일정은 항목 4줄입니다. 유의사항은 한 줄에 하나씩 적습니다.</p><div class="cfg-grid">' +
      '<div class="fields"><b style="font-size:12.5px">' + parseInt(A.month.slice(5), 10) + '월 일정</b><div id="sch-rows"></div><button class="btn-ghost btn-sm" type="button" id="sch-save">일정 저장</button></div>' +
      '<div class="fields"><div class="field"><label for="n-main">메인 유의사항 (신청 탭 상단)</label><textarea id="n-main" style="min-height:110px"></textarea></div>' +
      '<div class="field"><label for="n-file">배정파일 유의사항 (배정·피드백 탭)</label><textarea id="n-file" style="min-height:110px"></textarea></div>' +
      '<div class="field"><label for="n-notice">공지 (일정 탭 · "제목 | 내용" 형식)</label><textarea id="n-notice" style="min-height:70px"></textarea></div><button class="btn-ghost btn-sm" type="button" id="n-save">유의사항·공지 저장</button></div></div></div><hr class="rule">';

    /* 사용인 관리 (휴대폰 변경) */
    h += '<div class="sec"><h2 class="sec-title">사용인 휴대폰 변경 <span class="helper">' + A.users.length + '명 등록</span></h2>' +
      '<p class="sec-desc">사용인번호나 이름으로 찾아 새 번호를 넣고 <b>변경</b>을 누르면 서버가 해시로 저장합니다. 번호 원문은 어디에도 남지 않으며, 로그에는 뒤 4자리만 기록됩니다.</p>' +
      '<div class="bulkbar"><input id="u-q" placeholder="사용인번호 · 이름 · 본부로 검색" style="flex:1;min-width:200px" autocomplete="off"><span class="helper" id="u-cnt"></span></div>' +
      '<div class="table-wrap"><table><thead><tr><th>사용인번호</th><th>이름</th><th>소속</th><th>역할 · 상태</th><th>휴대폰</th><th>새 번호</th><th></th></tr></thead><tbody id="u-body"><tr><td colspan="7" class="dash">검색어를 입력하면 해당 사용인이 표시됩니다.</td></tr></tbody></table></div></div><hr class="rule">';

    /* 설정 */
    var roles = String(A.cfg.enabled_roles || '').split(',');
    h += '<div class="sec"><h2 class="sec-title">설정</h2><div class="cfg-grid">' +
      '<div class="fields"><b style="font-size:12.5px">로그인 허용 역할 (config.enabled_roles)</b>' + ['본부장', '사업단장', '지점장', '사용인'].map(function (r) { return '<label class="switch"><input type="checkbox" data-role="' + r + '"' + (roles.indexOf(r) >= 0 ? ' checked' : '') + '> ' + r + ' 로그인 허용</label>'; }).join('') +
      '<label class="switch"><input type="checkbox" id="c-sitedl"' + (A.cfg.site_download === 'Y' ? ' checked' : '') + '> 배정목록 사이트 다운로드 (미구현 · 사용자 화면에는 아직 아무것도 표시되지 않음)</label><button class="btn-ghost btn-sm" type="button" id="c-roles-save">권한 저장</button></div>' +
      '<div class="fields"><div class="field"><label for="c-form">신청서 양식 파일</label><div class="btn-row" style="margin:0"><button class="btn-ghost btn-sm" type="button" data-up="form">📎 양식 파일 업로드 (PDF·DOCX·XLSX)</button>' + (A.cfg.form_file_id ? '<a class="btn-ghost btn-sm" href="https://drive.google.com/file/d/' + esc(A.cfg.form_file_id) + '/view" target="_blank" rel="noopener" style="text-decoration:none">현재 양식 열기</a>' : '<span class="helper" style="color:var(--warn)">아직 등록된 양식이 없습니다</span>') + '</div>' +
      '<span class="helper">업로드하면 Drive 「양식」 폴더(<a class="link" href="' + esc(A.cfg.forms_folder_url) + '" target="_blank" rel="noopener">열기</a>)에 저장되고 링크 보기 권한으로 공유돼 사용인 화면의 「신청서 양식 열기」에 바로 연결됩니다. 직접 올린 파일은 아래 ID 칸에 붙여 넣어도 됩니다.</span>' +
      '<input id="c-form" class="mono" value="' + esc(A.cfg.form_file_id || '') + '" placeholder="Drive 파일 ID (링크의 /d/ 와 /view 사이)"></div>' +
      '<div class="row3"><div class="field"><label for="c-regions">희망지역 목록 (쉼표, 표시 순서)</label><input id="c-regions" value="' + esc(A.cfg.regions || REGIONS.join(',')) + '"></div>' +
      '<div class="field"><label for="c-qty">기본 배정수량</label><input id="c-qty" class="mono" inputmode="numeric" value="' + esc(A.cfg.apply_qty_default || '13') + '"></div>' +
      '<div class="field"><label for="c-qtyrules">직책별 수량 (직책=수량, 쉼표)</label><input id="c-qtyrules" class="mono" value="' + esc(A.cfg.apply_qty_rules || '') + '" placeholder="예: SL=20,지점장=0"></div></div>' +
      '<div class="row3"><div class="field"><label for="c-to">본부 TO 기본값 (명)</label><input id="c-to" class="mono" inputmode="numeric" value="' + esc(A.cfg.hq_to_default || '10') + '"></div>' +
      '<div class="field"><label for="c-torules">본부별 TO 예외 (본부명=수, 쉼표)</label><input id="c-torules" value="' + esc(A.cfg.hq_to_rules || '') + '" placeholder="예: 리치본부=12"></div>' +
      '<div class="field"><label for="c-hqlist">본부 드롭다운에 추가할 본부명 (쉼표)</label><input id="c-hqlist" value="' + esc(A.cfg.hq_list || '') + '" placeholder="명단에 없는 본부를 미리 등록"></div></div>' +
      '<b style="font-size:12.5px;display:block;margin-top:6px">접수 기간 <span class="helper">(비우면 상시 접수 · 시작일 00:00 ~ 종료일 23:59 · 기간 밖 제출은 화면·서버에서 모두 막힘 · 종료일을 저장하면 아래 「일정」의 신청서/피드백 마감 줄에 자동 반영)</span></b>' +
      '<div class="row2"><div class="field"><label for="c-aopen">신청서 접수 시작</label><input id="c-aopen" type="date" value="' + esc(A.cfg.apply_open || '') + '"></div><div class="field"><label for="c-aclose">신청서 접수 종료</label><input id="c-aclose" type="date" value="' + esc(A.cfg.apply_close || '') + '"></div></div>' +
      '<div class="row2"><div class="field"><label for="c-fopen">피드백 접수 시작</label><input id="c-fopen" type="date" value="' + esc(A.cfg.feedback_open || '') + '"></div><div class="field"><label for="c-fclose">피드백 접수 종료</label><input id="c-fclose" type="date" value="' + esc(A.cfg.feedback_close || '') + '"></div></div>' +
      '<p class="helper" style="margin:0">지금 상태 — 신청서: ' + esc(windowLabel(((A.cfg.windows || {}).apply) || windowOf('apply'))) + ' · 피드백: ' + esc(windowLabel(((A.cfg.windows || {}).feedback) || windowOf('feedback'))) + '</p>' +
      '<div class="field"><label for="c-pw">관리자 비밀번호 변경 (8자 이상, 비우면 유지)</label><input id="c-pw" type="password" autocomplete="new-password"></div>' +
      '<div class="field"><label for="c-results">컨택결과 허용값 (쉼표 구분)</label><input id="c-results" value="' + esc(A.cfg.feedback_results || '') + '"></div>' +
      '<div class="field"><label for="c-headers">피드백 열 제목 (쉼표 구분 · 순서 포함)</label><input id="c-headers" value="' + esc(A.cfg.feedback_headers || '') + '"></div>' +
      '<button class="btn-ghost btn-sm" type="button" id="c-save">설정 저장</button></div></div></div><hr class="rule">';

    /* 로그 */
    h += '<div class="sec"><h2 class="sec-title">접속 · 업로드 로그 <span class="helper">최근 40건</span></h2><div class="table-wrap"><table><thead><tr><th>일시</th><th>누가</th><th>동작</th><th>결과</th><th>상세</th></tr></thead><tbody>';
    A.logs.forEach(function (l) { h += '<tr><td class="mono">' + esc(String(l['일시']).replace('T', ' ').slice(5, 16)) + '</td><td class="name">' + esc(l['이름'] || l['사용인번호']) + '</td><td>' + esc(l['동작']) + '</td><td>' + pillOf(l['결과']) + '</td><td class="why">' + esc(l['상세']) + '</td></tr>'; });
    h += '</tbody></table></div></div>';

    el.innerHTML = h;
    bindAdmin();
  }

  function bindAdmin() {
    var el = $('admin');
    var busy = false;
    async function run(fn, okMsg) { if (busy) return; busy = true; try { await fn(); if (okMsg) toast(okMsg, 'ok'); await renderAdmin(); } catch (e) { toast(e.message, 'stop'); } finally { busy = false; } }
    $('c-month-save').addEventListener('click', function () { var m = $('c-month').value.trim(); run(async function () { await call('admin.config', { set: { current_month: m } }); S.boot.month = m; $('m-sub').textContent = monthKo(m) + ' 배정분'; }, '배정월을 ' + m + ' 로 바꿨습니다.'); });
    el.querySelectorAll('[data-goto]').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); selectTab(a.dataset.goto); }); });

    $('u-export').addEventListener('click', function () {
      try {
        var aoa = [['접수번호', '배정월', '구분', '사용인번호', '이름', '본부', '사업단', '지점', '희망지역', '희망수량', '메모', '상태', '사유', '접수일시', '대리신청자']];
        A.apps.forEach(function (a) { aoa.push([a.id, a.month, a.type, a.no, a.name, a.hq, a.unit, a.br, a.regions, a.qty, a.memo, a.status, a.reason, a.at, a.by]); });
        var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'applications');
        XLSX.writeFile(wb, 'applications_' + A.month.replace('-', '') + '.csv', { bookType: 'csv' });
      } catch (e) { toast('파일 저장에 실패했습니다.', 'stop'); }
    });
    el.querySelectorAll('[data-up]').forEach(function (b) { b.addEventListener('click', function () { $('adm-input').dataset.kind = b.dataset.up; $('adm-input').value = ''; $('adm-input').click(); }); });

    /* 파이프라인 */
    el.querySelectorAll('[data-toggle]').forEach(function (b) { b.addEventListener('click', function () { var step = +b.dataset.toggle, done = b.dataset.done !== '1', sum = el.querySelector('input[data-sum="' + step + '"]').value.trim(); run(async function () { await call('admin.pipeline', { set: { step: step, done: done, summary: sum } }); }); }); });

    /* 피드백 */
    el.querySelectorAll('[data-fbok]').forEach(function (b) { b.addEventListener('click', function () { var f = A.fbs[+b.dataset.fbok]; run(async function () { await call('admin.reviewFeedback', { ids: [f.id], action: 'ok' }); }, f.name + '님 피드백을 확인완료 처리했습니다.'); }); });
    el.querySelectorAll('[data-fbfix]').forEach(function (b) { b.addEventListener('click', function () { var f = A.fbs[+b.dataset.fbfix], note = el.querySelector('input[data-fbnote="' + b.dataset.fbfix + '"]').value.trim(); if (!note) { toast('보완 사유를 입력해 주세요.', 'stop'); return; } run(async function () { await call('admin.reviewFeedback', { ids: [f.id], action: 'fix', note: note }); }, '보완요청을 보냈습니다.'); }); });
    $('fb-all-ok').addEventListener('click', function () { var ids = A.fbs.filter(function (f) { return f.review === '검토중'; }).map(function (f) { return f.id; }); run(async function () { await call('admin.reviewFeedback', { ids: ids, action: 'ok' }); }, ids.length + '건을 확인완료 처리했습니다.'); });

    /* 메일 */
    $('m-add').addEventListener('click', function () { var t = $('m-target').value.trim(), c = parseInt($('m-count').value, 10); if (!t || !(c >= 0)) { toast('대상과 건수를 입력해 주세요.', 'stop'); return; } run(async function () { await call('admin.mail', { add: { unit: $('m-unit').value, target: t, count: c, to: $('m-to').value.trim() } }); }, '발송 기록을 추가했습니다.'); });

    /* 일정 · 공지 */
    (async function () {
      try {
        var s = await call('admin.schedule'), n = await call('admin.notices');
        var rows = s.schedule.slice(0, 4); while (rows.length < 4) rows.push({ '항목': '', '날짜': '' });
        $('sch-rows').innerHTML = rows.map(function (r, i) { return '<div class="row2"><input data-sch-item="' + i + '" value="' + esc(r['항목']) + '" placeholder="항목"><input data-sch-date="' + i + '" value="' + esc(r['날짜']) + '" placeholder="12월 ○일"></div>'; }).join('');
        $('n-main').value = n.rows.filter(function (x) { return x['구분'] === '메인'; }).map(function (x) { return x['내용']; }).join('\n');
        $('n-file').value = n.rows.filter(function (x) { return x['구분'] === '배정파일'; }).map(function (x) { return x['내용']; }).join('\n');
        $('n-notice').value = n.rows.filter(function (x) { return x['구분'] !== '메인' && x['구분'] !== '배정파일'; }).map(function (x) { return (x['제목'] ? x['제목'] + ' | ' : '') + x['내용']; }).join('\n');
      } catch (e) { toast(e.message, 'stop'); }
    })();
    $('sch-save').addEventListener('click', function () {
      var rows = [0, 1, 2, 3].map(function (i) { return { '항목': el.querySelector('input[data-sch-item="' + i + '"]').value.trim(), '날짜': el.querySelector('input[data-sch-date="' + i + '"]').value.trim() }; });
      run(async function () { await call('admin.schedule', { rows: rows }); }, '일정을 저장했습니다.');
    });
    $('n-save').addEventListener('click', function () {
      var today = new Date().toISOString().slice(0, 10), rows = [];
      $('n-main').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (t) { rows.push({ '구분': '메인', '게시일': today, '제목': '유의사항', '내용': t, '노출여부': 'Y' }); });
      $('n-file').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (t) { rows.push({ '구분': '배정파일', '게시일': today, '제목': '배정파일 유의사항', '내용': t, '노출여부': 'Y' }); });
      $('n-notice').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (t) { var p = t.split('|'); rows.push({ '구분': '공지', '게시일': today, '제목': p.length > 1 ? p[0].trim() : '공지', '내용': (p.length > 1 ? p.slice(1).join('|') : t).trim(), '노출여부': 'Y' }); });
      run(async function () { var r = await call('admin.notices', { rows: rows }); var b = await call('me.bootstrap'); S.boot = b; }, '유의사항·공지를 저장했습니다.');
    });

    /* 사용인 휴대폰 변경 */
    (function () {
      var q = $('u-q'), body = $('u-body'), cnt = $('u-cnt');
      function renderUsers() {
        var kw = q.value.trim().toLowerCase();
        if (!kw) { body.innerHTML = '<tr><td colspan="7" class="dash">검색어를 입력하면 해당 사용인이 표시됩니다.</td></tr>'; cnt.textContent = ''; return; }
        var hit = A.users.filter(function (u) { return [u.no, u.name, u.hq, u.unit, u.br].some(function (v) { return String(v || '').toLowerCase().indexOf(kw) >= 0; }); });
        cnt.textContent = hit.length ? hit.length + '명' + (hit.length > 30 ? ' (30명까지 표시)' : '') : '일치하는 사용인이 없습니다';
        body.innerHTML = hit.slice(0, 30).map(function (u) {
          return '<tr><td class="mono">' + esc(u.no) + '</td><td class="name">' + esc(u.name) + '</td><td>' + esc([u.hq, u.unit, u.br].filter(Boolean).join(' · ')) + '</td>' +
            '<td>' + esc(u.role) + (u.status ? ' · ' + esc(u.status) : '') + (u.active ? '' : ' <span class="helper" style="color:var(--warn)">사용 N</span>') + '</td>' +
            '<td>' + (u.has_phone ? pillOf('등록됨') : '<span class="dash">없음</span>') + (u.contact ? '<span class="cell-sub mono">' + esc(u.contact) + '</span>' : '') + '</td>' +
            '<td><input data-phone="' + esc(u.no) + '" inputmode="tel" placeholder="010-0000-0000" style="min-width:140px" autocomplete="off"></td>' +
            '<td><button class="btn btn-sm" type="button" data-setphone="' + esc(u.no) + '">변경</button></td></tr>';
        }).join('') || '<tr><td colspan="7" class="dash">일치하는 사용인이 없습니다.</td></tr>';
      }
      q.addEventListener('input', renderUsers);
      body.addEventListener('keydown', function (e) { var t = e.target; if (e.key === 'Enter' && t.dataset && t.dataset.phone) { e.preventDefault(); var b = body.querySelector('[data-setphone="' + t.dataset.phone + '"]'); if (b) b.click(); } });
      body.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('[data-setphone]'); if (!b) return;
        var no = b.dataset.setphone, inp = body.querySelector('[data-phone="' + no + '"]'), phone = (inp.value || '').replace(/\D/g, '');
        var u = A.users.filter(function (x) { return x.no === no; })[0] || {};
        if (phone.length < 9) { toast('휴대폰번호를 다시 확인해 주세요. (숫자 9자리 이상)', 'stop'); inp.focus(); return; }
        if (!window.confirm((u.name || no) + ' (' + no + ') 의 휴대폰번호를\n' + inp.value.trim() + ' 로 바꿀까요?\n\n이후 로그인·신청서 제출은 이 번호로만 됩니다.')) return;
        var kw = q.value;
        run(async function () { var r = await call('admin.setPhone', { no: no, phone: phone }); S.admUserQ = kw; if (!r.changed) toast('기존 번호와 같아 바뀐 내용이 없습니다.', 'warn'); }, u.name + ' 휴대폰번호를 바꿨습니다.');
      });
      if (S.admUserQ) { q.value = S.admUserQ; S.admUserQ = ''; renderUsers(); }
    })();

    /* 설정 */
    $('c-roles-save').addEventListener('click', function () {
      var roles = ['관리자'].concat(Array.prototype.filter.call(el.querySelectorAll('input[data-role]'), function (c) { return c.checked; }).map(function (c) { return c.dataset.role; }));
      run(async function () { await call('admin.config', { set: { enabled_roles: roles.join(','), site_download: $('c-sitedl').checked } }); }, '권한 설정을 저장했습니다.');
    });
    $('c-save').addEventListener('click', function () {
      var set = { form_file_id: $('c-form').value.trim(), feedback_results: $('c-results').value.trim(), feedback_headers: $('c-headers').value.trim(),
                  regions: $('c-regions').value.trim(), apply_qty_default: $('c-qty').value.trim(), apply_qty_rules: $('c-qtyrules').value.trim(),
                  hq_to_default: $('c-to').value.trim(), hq_to_rules: $('c-torules').value.trim(), hq_list: $('c-hqlist').value.trim(),
                  apply_open: $('c-aopen').value.trim(), apply_close: $('c-aclose').value.trim(), feedback_open: $('c-fopen').value.trim(), feedback_close: $('c-fclose').value.trim() };
      var pw = $('c-pw').value.trim(); if (pw) set.admin_password = pw;
      run(async function () { await call('admin.config', { set: set }); S.boot = await call('me.bootstrap'); }, '설정을 저장했습니다.');
    });
  }

  /* 관리자 업로드 (xlsx/csv → 객체 배열 → 서버) */
  function activePanel() { var p = document.querySelector('.panel.active'); return p ? p.id : ''; }
  async function rerenderActive() { if (activePanel() === 'apply') await renderInbox(); else await renderAdmin(); }
  function checksBox() { return activePanel() === 'apply' ? $('apply-checks') : $('adm-checks'); }
  $('adm-input').addEventListener('change', async function (e) {
    var f = e.target.files && e.target.files[0], kind = e.target.dataset.kind;
    if (!f) return;
    if (kind === 'form') {   // 신청서 양식: 표가 아니라 파일 자체를 Drive 「양식」 폴더에 저장
      try {
        await call('admin.uploadForm', { file: { name: f.name, type: f.type || 'application/octet-stream', base64: await DB.fileToBase64(f) } });
        S.boot = await call('me.bootstrap');
        toast('신청서 양식을 등록했습니다. 사용인 화면의 「신청서 양식 열기」에 연결됩니다.', 'ok');
        await rerenderActive();
      } catch (err) { toast(err.message, 'stop'); }
      return;
    }
    var box = checksBox();
    function fail(msg) { box.innerHTML = '<div class="checks"><div class="check fail"><span class="ic">✕</span><div><b>업로드 거부</b><small>' + esc(msg) + '</small></div></div></div>'; toast('업로드가 거부되었습니다.', 'stop'); }
    try {
      var wb = XLSX.read(new Uint8Array(await DB.fileToArrayBuffer(f)), { type: 'array' });
      var ws = wb.Sheets[wb.SheetNames[0]];
      var rows = XLSX.utils.sheet_to_json(ws, { raw: false, defval: '' }).map(function (r) { var o = {}; Object.keys(r).forEach(function (k) { var kk = String(k).trim(); if (kk) o[kk] = String(r[k]).trim(); }); return o; }).filter(function (r) { return Object.keys(r).some(function (k) { return r[k] !== ''; }); });
      if (!rows.length) return fail('데이터 행이 없습니다.');
      var header = Object.keys(rows[0]);
      var forbidden = header.filter(function (c) { return FORBIDDEN_COLS.some(function (fc) { return c.indexOf(fc) >= 0; }); });
      if (forbidden.length) return fail('개인정보 열이 포함되어 있습니다: ' + forbidden.join(', ') + '. 파이썬 출력(허용 열만)을 올려 주세요.');
      if (kind === 'users') {
        var extra = header.filter(function (c) { return USERS_ALLOWED.indexOf(c) < 0 && c.indexOf('보험사코드') !== 0; });
        if (extra.length) return fail('허용되지 않은 열: ' + extra.join(', ') + ' (허용: ' + USERS_ALLOWED.join(' · ') + ' · 보험사코드_*)');
        var mode = window.confirm('기존 사용인 목록을 전부 교체할까요?\n[확인] 전체 교체  /  [취소] 사용인번호 기준으로 갱신·추가') ? 'replace' : 'merge';
        box.innerHTML = loadingHtml('업로드 중… (' + rows.length + '명)');
        var r1 = await call('admin.uploadUsers', { rows: rows, mode: mode });
        box.innerHTML = '<div class="checks"><div class="check pass"><span class="ic">✓</span><div><b>배정자 마스터 업로드 완료</b><small>' + r1.count + '명 · ' + (mode === 'replace' ? '전체 교체' : '갱신·추가') + (r1.no_phone ? ' · 휴대폰 없음 ' + r1.no_phone + '명 (로그인 불가)' : '') + '</small></div></div></div>';
        toast('배정자 마스터 ' + r1.count + '명을 올렸습니다.', 'ok');
      } else if (kind === 'allocations') {
        var month = (rows[0]['배정월'] || A.month || S.boot.month);
        box.innerHTML = loadingHtml('일괄 반영 중… (' + rows.length + '명)');
        var r2 = await call('admin.uploadAllocations', { rows: rows, month: month });
        box.innerHTML = '<div class="checks"><div class="check pass"><span class="ic">✓</span><div><b>배정 결과 일괄 반영 완료</b><small>' + r2.month + ' · ' + r2.count + '명 · 신청 상태도 함께 갱신</small></div></div></div>';
        toast(r2.count + '명의 배정 결과를 반영했습니다.', 'ok');
      } else {
        var month2 = (rows[0]['배정월'] || A.month || S.boot.month);
        box.innerHTML = loadingHtml('업로드 중…');
        var r3 = await call('admin.uploadStats', { rows: rows, month: month2 });
        box.innerHTML = '<div class="checks"><div class="check pass"><span class="ic">✓</span><div><b>지역별 효율 요약 업로드 완료</b><small>' + month2 + ' · ' + r3.count + '지역</small></div></div></div>';
        toast('효율 요약을 올렸습니다.', 'ok');
      }
      var keep = box.innerHTML;
      await rerenderActive();
      var nb = checksBox(); if (nb) nb.innerHTML = keep;
    } catch (err) { fail(err.message); }
  });

  init();
})();
