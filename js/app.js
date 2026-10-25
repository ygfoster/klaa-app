/**
 * app.js — 画面の組み立てと操作
 *
 *   初回設定（接続先URL） → PIN入力 → 会員一覧（クラスで絞り込み） → 会員の入力シート
 *   スタッフ編集モードでは、入力シートの代わりに過去の記録の一覧・修正画面を開く。
 */
import { APP_VERSION, getApiUrl, setApiUrl, isValidApiUrl, takeApiUrlFromHash, getDeviceId, randomId, todayYmd, local } from './config.js';
import { call, hooks, ApiError, NETWORK_MESSAGE } from './api.js';
import * as sessionTimer from './session.js';
import { drafts, pending } from './offline.js';
import { esc, h, icon, dialog, alertDialog, confirmDialog, toast, withBusy, showEvents, openSheet, openDrawer, pickOption } from './ui.js';

const app = () => document.getElementById('app');

const state = {
  members: [],
  classes: [],
  rules: [],
  targets: [],
  locations: [],
  location: '',        // この端末で使う教室（春日井／あま）。端末に記憶する
  suggestedClasses: {},
  basicTarget: '80cm的',
  scoreConfig: null,
  lastSync: null,
  filter: { className: 'all', query: '' },
  editMode: false,
  undo: null,          // { recordId, label, until }
  sheet: null,         // 開いている入力シート
};

/* ================================================================== *
 * 起動
 * ================================================================== */

function init() {
  // オフライン起動用。ローカル確認（http://localhost）では古いファイルが残らないよう使わない
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* なくても動作する */ });
  }

  const fromHash = takeApiUrlFromHash();
  if (fromHash && isValidApiUrl(fromHash)) setApiUrl(fromHash);
  // アプリを開いたまま設定用リンクを開いた場合（ページは読み直されず # 以降だけ変わる）
  window.addEventListener('hashchange', () => {
    const url = takeApiUrlFromHash();
    if (!url || !isValidApiUrl(url)) return;
    setApiUrl(url);
    if (!sessionTimer.isLoggedIn()) renderLock('接続先を設定しました。PINを入力してください。');
  });

  hooks.onSession = (info) => {
    sessionTimer.applyServerSession(info);
    sessionTimer.markServerActivity();
  };
  hooks.onAuthRequired = (message) => lock(message);

  if (!getApiUrl()) renderSetup();
  else if (sessionTimer.isLoggedIn()) resumeSession();
  else renderLock();
}

/** アプリを開き直した（同じタブで再読み込み）場合：トークンが残っていれば続きから */
async function resumeSession() {
  sessionTimer.begin(sessionTimer.getToken(), null, timerHandlers());
  await startMain();
}

/* ================================================================== *
 * 初回設定
 * ================================================================== */

function renderSetup(message) {
  app().innerHTML = `
    <main class="center-screen">
      <div class="card setup-card">
        <img src="icons/icon-192.png" alt="" class="setup-icon">
        <img src="img/klaa-logo.png" alt="KLAA" class="setup-logo">
        <h1>初回設定</h1>
        <p class="muted">管理者から受け取った「接続先URL」を入力してください。<br>（設定用のリンクから開いた場合は自動で入ります）</p>
        <form id="setup-form" class="stack">
          <label class="field">
            <span>接続先URL</span>
            <input name="url" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"
              placeholder="https://script.google.com/macros/s/…/exec" value="${esc(getApiUrl())}" required>
          </label>
          ${message ? `<p class="error">${esc(message)}</p>` : ''}
          <button class="btn primary large" type="submit">保存して次へ</button>
        </form>
      </div>
    </main>`;
  document.getElementById('setup-form').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      setApiUrl(new FormData(e.target).get('url'));
      renderLock();
    } catch (err) {
      renderSetup(err.message);
    }
  });
}

/* ================================================================== *
 * PIN入力
 * ================================================================== */

function renderLock(message) {
  closeSheet();
  let pin = '';
  app().innerHTML = `
    <main class="center-screen lock-screen">
      <div class="lock-card">
        <div class="lock-brand"><img src="img/klaa-logo-white.png" alt="KLAA"></div>
        <h1>進級・スコア管理</h1>
        <p class="muted">スタッフ共通のPINを入力してください<br><small>6桁を入力すると自動でログインします</small></p>
        <div class="pin-dots" aria-label="入力済みの桁数">${'<i></i>'.repeat(6)}</div>
        <p class="error" id="pin-msg" role="alert">${esc(message || '')}</p>
        <div class="keypad" id="pin-pad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-k="${n}">${n}</button>`).join('')}
          <button type="button" data-k="del" aria-label="1文字消す">${icon('backspace')}</button>
          <button type="button" data-k="0">0</button>
          <button type="button" data-k="ok" class="ok" aria-label="ログイン" disabled>OK</button>
        </div>
        <button type="button" class="link small" id="change-api">接続先の設定</button>
      </div>
    </main>`;

  const dots = app().querySelectorAll('.pin-dots i');
  const okBtn = app().querySelector('[data-k="ok"]');
  const msg = document.getElementById('pin-msg');
  const render = () => {
    dots.forEach((d, i) => d.classList.toggle('on', i < pin.length));
    okBtn.disabled = pin.length < 4;
  };
  const press = async (k) => {
    if (k === 'del') pin = pin.slice(0, -1);
    else if (k === 'ok') return submit();
    else if (pin.length < 6) pin += k;
    render();
    if (pin.length === 6) submit(); // 6桁そろったら自動でログイン（4〜5桁のPINは OK で送る）
  };
  let sending = false;
  const submit = async () => {
    if (pin.length < 4 || sending) return;
    sending = true;
    const entered = pin;
    pin = '';
    render();
    msg.textContent = '';
    try {
      const data = await withBusy('確認中…', () => call('auth.login', { pin: entered, deviceId: getDeviceId() }));
      sessionTimer.begin(data.token, data.session, timerHandlers());
      await startMain();
    } catch (err) {
      msg.textContent = err.message;
      const card = app().querySelector('.lock-card');
      card.classList.remove('shake');
      void card.offsetWidth;
      card.classList.add('shake');
    } finally {
      sending = false;
    }
  };

  document.getElementById('pin-pad').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]');
    if (b && !b.disabled) press(b.dataset.k);
  });
  document.getElementById('change-api').addEventListener('click', () => renderSetup());
  const onKey = (e) => {
    if (!document.getElementById('pin-pad')) return document.removeEventListener('keydown', onKey);
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('del');
    else if (e.key === 'Enter') press('ok');
  };
  document.addEventListener('keydown', onKey);
}

function lock(message) {
  sessionTimer.end();
  hideWarn();
  renderLock(message || '一定時間操作がなかったため、ロックしました。PINを入力してください。');
}

async function logout() {
  call('auth.logout').catch(() => {});
  sessionTimer.end();
  hideWarn();
  renderLock('ロックしました。');
}

function timerHandlers() {
  return {
    onWarn: showWarn,
    onClearWarn: hideWarn,
    onExpire: () => lock(),
  };
}

/* ------------------------------ 14分の警告 ------------------------------ */

function showWarn(remainingSec) {
  let el = document.getElementById('lock-warn');
  if (!el) {
    el = h(`<div class="lock-warn" id="lock-warn" role="alert"><strong>まもなくロックされます</strong><span></span></div>`);
    document.body.appendChild(el);
  }
  el.querySelector('span').textContent = `残り ${remainingSec} 秒・画面をタップすると続けて使えます`;
}

function hideWarn() {
  const el = document.getElementById('lock-warn');
  if (el) el.remove();
}

/* ================================================================== *
 * メイン画面
 * ================================================================== */

async function startMain() {
  try {
    const data = await withBusy('読み込み中…', () => call('app.bootstrap'));
    state.members = data.members;
    state.classes = data.classes;
    state.rules = data.rules;
    state.targets = data.targets || [];
    state.basicTarget = data.basicTarget || state.basicTarget;
    state.scoreConfig = data.scoreConfig;
    state.lastSync = data.lastSync;
    state.locations = data.locations || [];
    state.suggestedClasses = data.suggestedClasses || {};
    const saved = local.get('location', '');
    state.location = state.locations.indexOf(saved) >= 0 ? saved : (state.locations[0] || '');
    state.filter.className = state.suggestedClasses[state.location] || data.suggestedClass || 'all';
    renderMain();
    offerPendingResend();
  } catch (err) {
    if (err.code === 'AUTH_REQUIRED') return;
    renderError(err);
  }
}

function renderError(err) {
  app().innerHTML = `
    <main class="center-screen">
      <div class="card stack">
        <h1>読み込めませんでした</h1>
        <p>${esc(err.message)}</p>
        <button class="btn primary large" id="retry">再試行</button>
        <button class="btn" id="relock">PIN入力に戻る</button>
      </div>
    </main>`;
  document.getElementById('retry').addEventListener('click', startMain);
  document.getElementById('relock').addEventListener('click', logout);
}

function renderMain() {
  const multi = state.locations.length > 1;
  app().innerHTML = `
    <div class="sticky-head">
    <header class="topbar ${state.editMode ? 'editing' : ''}">
      <div class="brand"><img src="img/klaa-logo-white.png" alt="KLAA"></div>
      <div class="topbar-title">
        <h1>${state.editMode ? 'スタッフ編集モード' : '進級・スコア管理'}</h1>
        <p class="sync-info">名簿：<span id="last-sync">${esc(state.lastSync ? state.lastSync.display : '未同期')}</span></p>
      </div>
      <div class="topbar-actions">
        ${state.editMode ? `<button type="button" class="pill-btn end-edit" id="btn-end-edit">編集を終了</button>` : ''}
        ${multi ? `<button type="button" class="pill-btn location-pill" id="btn-location" aria-label="教室：${esc(state.location)}（タップで切り替え）">
          ${icon('pin')}<span>${esc(state.location)}</span>${icon('swap', 'ic-sm')}</button>` : ''}
        <button type="button" class="menu-btn" id="btn-menu" aria-label="メニュー" aria-haspopup="dialog">${icon('menu')}</button>
      </div>
    </header>
    <div id="pending-banner"></div>
    <nav class="filters">
      <label class="search">
        ${icon('search')}
        <input id="search" type="search" placeholder="生徒の名前・ふりがなで検索" value="${esc(state.filter.query)}" autocomplete="off" enterkeyhint="search">
        <button type="button" class="search-clear" id="search-clear" aria-label="検索をクリア" ${state.filter.query ? '' : 'hidden'}>${icon('close')}</button>
      </label>
      <div class="chips" id="class-chips" role="tablist" aria-label="クラス">${renderChips()}</div>
    </nav>
    </div>
    <main class="members" id="members">${renderMembers()}</main>
    <div id="undo-bar"></div>
    <footer class="version">v${APP_VERSION}</footer>`;

  const locationBtn = document.getElementById('btn-location');
  if (locationBtn) locationBtn.addEventListener('click', () => switchLocation());
  const endEdit = document.getElementById('btn-end-edit');
  if (endEdit) endEdit.addEventListener('click', toggleEditMode);
  document.getElementById('class-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-class]');
    if (!chip) return;
    state.filter.className = chip.dataset.class;
    refreshList();
  });
  const search = document.getElementById('search');
  const clearBtn = document.getElementById('search-clear');
  search.addEventListener('input', () => {
    state.filter.query = search.value;
    clearBtn.hidden = !search.value;
    refreshList(false);
  });
  clearBtn.addEventListener('click', () => {
    search.value = '';
    state.filter.query = '';
    clearBtn.hidden = true;
    refreshList(false);
    search.focus();
  });
  document.getElementById('members').addEventListener('click', (e) => {
    const card = e.target.closest('[data-member]');
    if (!card) return;
    const member = state.members.find((m) => m.memberId === card.dataset.member);
    if (!member) return;
    state.navIds = visibleMembers().map((m) => m.memberId); // 横スワイプで移動する順番
    state.editMode ? openHistory(member) : openMember(member);
  });
  document.getElementById('btn-menu').addEventListener('click', openMenu);
  renderUndo();
  scrollActiveChip();
}

/** 教室を切り替える（2教室なのでタップのたびに入れ替わる。端末に記憶） */
function switchLocation(to) {
  const next = to || state.locations[(state.locations.indexOf(state.location) + 1) % state.locations.length];
  if (!next || next === state.location) return;
  state.location = next;
  local.set('location', next);
  state.filter.className = state.suggestedClasses[next] || 'all';
  renderMain();
  toast(`${next}教室に切り替えました`);
}

/** 右上のメニュー */
function openMenu() {
  const other = state.locations.filter((l) => l !== state.location)[0];
  const items = [
    { id: 'sync', icon: 'sync', label: '名簿を今すぐ同期',
      desc: '取り込み済みの名簿を会員一覧に反映します。毎晩自動で同期されるため、通常は使う必要はありません。' },
    { id: 'csv', icon: 'upload', label: 'SCOLAの名簿CSVを取り込む', file: '.csv,text/csv,text/plain',
      desc: 'SCOLAからダウンロードしたCSVを選びます。「基本」と「受講」の2つを同時に選ぶと、生年月日とクラスの両方が入ります。' },
    state.editMode
      ? { id: 'edit', icon: 'edit', label: 'スタッフ編集モードを終了', tone: 'edit',
        desc: '通常の点数入力の画面に戻ります。' }
      : { id: 'edit', icon: 'edit', label: 'スタッフ編集モード', tone: 'edit',
        desc: '過去の記録を修正・削除します。修正すると、級・距離・自己ベストを全記録から計算し直します。' },
  ];
  if (other) items.push({ id: 'location', icon: 'swap', label: `${other}教室に切り替え`,
    desc: `この端末で表示する教室を「${state.location}」から「${other}」に切り替えます。選んだ教室は端末に記憶されます。` });
  items.push({ id: 'lock', icon: 'lock', label: 'ロックする', tone: 'danger',
    desc: 'PIN入力画面に戻ります。端末から離れるときは必ずロックしてください。' });
  openDrawer({
    title: 'メニュー',
    sub: `${state.location ? state.location + '教室・' : ''}名簿 ${state.lastSync ? state.lastSync.display : '未同期'}`,
    footer: `KLAA 進級・スコア管理 v${APP_VERSION}`,
    items,
  }, (id, e) => {
    if (id === 'sync') runRosterSync({});
    else if (id === 'csv') onCsvSelected(e);
    else if (id === 'edit') toggleEditMode();
    else if (id === 'location') switchLocation(other);
    else if (id === 'lock') logout();
  });
}

function refreshList(updateChips = true) {
  if (updateChips) document.getElementById('class-chips').innerHTML = renderChips();
  document.getElementById('members').innerHTML = renderMembers();
  if (updateChips) scrollActiveChip();
}

function scrollActiveChip() {
  const active = document.querySelector('.chip.active');
  if (active) active.scrollIntoView({ inline: 'center', block: 'nearest' });
}

function renderChips() {
  const today = new Date().getDay();
  const counts = {};
  state.members.forEach((m) => { const k = m.className || '(none)'; counts[k] = (counts[k] || 0) + 1; });
  const chip = (value, label, sub, extra = '') => `
    <button type="button" role="tab" class="chip ${state.filter.className === value ? 'active' : ''} ${extra}" data-class="${esc(value)}"
      aria-selected="${state.filter.className === value}">
      <span>${esc(label)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}
    </button>`;
  return [
    chip('all', '全生徒', state.members.length + '名'),
    ...state.classes.filter((c) => !state.location || c.location === state.location)
      .map((c) => chip(c.name, `${c.dayLabel} ${c.start}`, (counts[c.name] || 0) + '名' + (c.kind && c.kind !== 'ベーシック' ? '・' + c.kind : ''), c.day === today ? 'today' : '')),
    counts['(none)'] ? chip('(none)', 'クラス未設定', counts['(none)'] + '名') : '',
  ].join('');
}

function visibleMembers() {
  const q = normalizeQuery(state.filter.query);
  return state.members.filter((m) => {
    if (state.filter.className === '(none)' && m.className) return false;
    if (state.filter.className !== 'all' && state.filter.className !== '(none)' && m.className !== state.filter.className) return false;
    if (!q) return true;
    return normalizeQuery(m.name + m.kana).includes(q);
  });
}

function normalizeQuery(s) {
  return String(s || '').normalize('NFKC').replace(/\s+/g, '')
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60)).toLowerCase();
}

function renderMembers() {
  const list = visibleMembers();
  const current = state.classes.find((c) => c.name === state.filter.className);
  const heading = current
    ? `<h2 class="list-heading">${esc(current.label)} <small>${esc(current.start)}〜${esc(current.end)}</small></h2>`
    : state.filter.className === '(none)' ? '<h2 class="list-heading">クラス未設定 <small>会員をタップしてクラスを設定できます</small></h2>' : '';
  if (!list.length) return heading + '<p class="empty">該当する会員がいません</p>';
  return heading + '<div class="grid">' + list.map((m) => `
    <button type="button" class="member-card" data-member="${esc(m.memberId)}">
      <span class="member-name">${esc(m.name)}</span>
      <span class="member-kana">${esc(m.kana)}</span>
      <span class="member-tags">
        ${m.advance ? '<span class="tag advance">アドバンス</span>' : `<span class="tag grade">${esc(m.gradeLabel || m.grade || '—')}</span>`}
        ${m.distance ? `<span class="tag">${esc(m.distance)}</span>` : ''}
        ${m.centerRod === 'あり' ? '<span class="tag rod">ロッド</span>' : ''}
      </span>
      ${pbListHtml(m.personalBests, 'member-pbs')}
      ${state.filter.className === 'all' && m.className ? `<span class="member-class">${esc(classDisplay(m.className))}</span>` : ''}
      ${drafts.get(m.memberId) ? '<span class="draft-dot" title="入力途中のデータがあります"></span>' : ''}
    </button>`).join('') + '</div>';
}

/* ================================================================== *
 * 会員の入力シート
 * ================================================================== */

/** 保存されているクラス名 → 表示名（例：「【あま】水曜日 ベーシック 16:45」） */
function classDisplay(name) {
  const c = state.classes.find((x) => x.name === name);
  return c ? `${c.label} ${c.start}` : name;
}

/** クラスの選択（教室ごと・曜日順に並べた独自の選択リスト） */
async function chooseClass(member) {
  const groups = state.locations.map((loc) => ({
    label: loc + '教室',
    options: state.classes.filter((c) => c.location === loc).map((c) => ({ value: c.name, label: c.label, sub: `${c.start}〜${c.end}` })),
  })).filter((g) => g.options.length);
  groups.push({ label: 'その他', options: [{ value: '(none)', label: '未設定にする' }] });
  // 今の教室を先頭に
  groups.sort((a, b) => (b.label === state.location + '教室') - (a.label === state.location + '教室'));
  const picked = await pickOption({ title: `${member.name} の所属クラス`, value: member.className || '(none)', groups });
  if (picked === null) return null;
  const value = picked === '(none)' ? '' : picked;
  if (value === (member.className || '')) return null;
  return setClass(member, value);
}

function nextGoalText(member) {
  if (member.advance) return '';
  const current = parseInt(member.grade, 10);
  const rule = state.rules.find((r) => r.grade === (isNaN(current) ? 0 : current) + 1);
  if (!rule) return '15級合格 ── アドバンスコース推薦状の対象です';
  if (rule.kind === 'skill') return `次：${rule.label}（実技テスト：${rule.test}）`;
  const where = rule.star ? '校内記録会' : '点取り';
  if (rule.min !== null) return `次：${rule.label}　${where}・${rule.distance}・${rule.min}点以上`;
  const own = member.ageCategory === '子供' ? `（この会員：18歳以下 ${rule.minChild}点）` : member.ageCategory === '大人' ? `（この会員：19歳以上 ${rule.minAdult}点）` : '';
  return `次：${rule.label}　${where}・${rule.distance}・19歳以上 ${rule.minAdult}点／18歳以下 ${rule.minChild}点${own}`;
}

function memberSummaryHtml(member) {
  const goal = nextGoalText(member);
  const nav = neighbors(member);
  return `
    <div class="sheet-head">
      <div>
        <h2>${esc(member.name)}</h2>
        <p class="muted">${esc(member.kana)}　${esc(member.memberId)}</p>
      </div>
      <div class="sheet-nav">
        ${nav.total > 1 ? `
          <button type="button" class="nav-btn" data-nav="-1" aria-label="前の生徒" ${nav.prev ? '' : 'disabled'}>${icon('chevronLeft')}</button>
          <span class="nav-pos">${nav.index + 1}<small>/${nav.total}</small></span>
          <button type="button" class="nav-btn" data-nav="1" aria-label="次の生徒" ${nav.next ? '' : 'disabled'}>${icon('chevronRight')}</button>` : ''}
        <button type="button" class="close-btn" data-close aria-label="閉じる">${icon('close')}</button>
      </div>
    </div>
    <div class="status-row">
      ${member.advance ? '<span class="tag advance">アドバンス</span>' : `<span class="tag grade large">${esc(member.gradeLabel || member.grade)}</span>`}
      ${member.distance ? `<span class="tag">${esc(member.distance)}</span>` : ''}
      ${member.centerRod ? `<span class="tag ${member.centerRod === 'あり' ? 'rod' : ''}">センターロッド${esc(member.centerRod)}</span>` : ''}
    </div>
    <div class="pb-panel">
      <span class="pb-title">自己ベスト</span>
      ${pbListHtml(member.personalBests, 'pb-list', true)}
    </div>
    ${goal ? `<p class="goal">${icon(goal.startsWith('次') ? 'target' : 'cap')}<span>${esc(goal)}</span></p>` : ''}`;
}

/* ------------------------------ 前後の生徒へ移動 ------------------------------ */

/** 一覧に表示中の順番（シートを開いた時点の並び）で前後の生徒を返す */
function neighbors(member) {
  const ids = state.navIds || [];
  const index = ids.indexOf(member.memberId);
  const find = (id) => (id ? state.members.find((m) => m.memberId === id) : null);
  if (index < 0) return { index: 0, total: 1, prev: null, next: null };
  return { index, total: ids.length, prev: find(ids[index - 1]), next: find(ids[index + 1]) };
}

/**
 * シートの前後移動（左右ボタン・横スワイプ）
 * @param {HTMLElement} el シートの中身
 * @param {Object} member
 * @param {function(Object, number): void} open 移動先を開く関数（第2引数は向き：1=次、-1=前）
 */
function attachMemberNav(el, member, open) {
  const nav = neighbors(member);
  const go = (dir) => {
    const target = dir > 0 ? nav.next : nav.prev;
    if (target) open(target, dir);
  };
  el.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.nav))));
  if (nav.total < 2) return;

  let start = null;
  let swiped = false;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || e.target.closest('input, select, textarea')) return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    swiped = false;
  });
  el.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      const blocked = (dx < 0 && !nav.next) || (dx > 0 && !nav.prev);
      el.style.transform = `translateX(${dx * (blocked ? 0.12 : 0.35)}px)`;
    }
  });
  const end = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    el.style.transform = '';
    if (e.type === 'pointerup' && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      swiped = true;
      go(dx < 0 ? 1 : -1);
    }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  // スワイプの指を離したときに、下にあるボタン（テンキーなど）が押されないようにする
  el.addEventListener('click', (e) => {
    if (swiped) { e.stopPropagation(); e.preventDefault(); swiped = false; }
  }, true);
}

/** 的ごとの自己ベスト（カード・シート共通） */
function pbListHtml(list, cls, withDate) {
  if (!list || !list.length) return `<span class="${cls} empty-pb">PB —</span>`;
  return `<span class="${cls}">${list.map((p) => `
    <span class="pb-item"><span class="pb-target">${esc(p.label)}</span><strong>${esc(p.score)}</strong>${withDate && p.date ? `<small>${esc(p.date)}</small>` : ''}</span>`).join('')}</span>`;
}

function targetLabel(key) {
  const t = state.targets.find((x) => x.key === key);
  return t ? t.short : '';
}

function openMember(member, dir = 0) {
  const draft = drafts.get(member.memberId) || {};
  const form = {
    type: draft.type || state.scoreConfig.entryTypes[0],
    date: draft.date || todayYmd(),
    score: draft.score || '',
    status: draft.status || '',
    // ベーシックは常に同じ的。的を使い分けるのはアドバンスだけ
    target: member.advance ? (draft.target || member.lastTarget || '') : state.basicTarget,
  };
  const currentGrade = parseInt(member.grade, 10);
  const nextRule = member.advance ? null : state.rules.find((r) => r.grade === (isNaN(currentGrade) ? 0 : currentGrade) + 1);

  const el = h(`<div class="member-sheet">
    ${memberSummaryHtml(member)}
    ${nextRule && nextRule.kind === 'skill' ? `<button type="button" class="btn success large" data-skill>実技テスト合格 → ${esc(nextRule.label)}</button>` : ''}
    <div class="field inline">
      <span>所属クラス</span>
      <button type="button" class="select-btn" data-class-btn aria-haspopup="dialog">
        <span data-class-label>${esc(member.className ? classDisplay(member.className) : '未設定')}</span>${icon('chevronDown')}
      </button>
    </div>
    <div class="segmented" role="radiogroup" aria-label="入力種別">
      ${state.scoreConfig.entryTypes.map((t) => `<button type="button" role="radio" data-type="${esc(t)}">${esc(t)}</button>`).join('')}
    </div>
    <label class="field inline">
      <span>記録日</span>
      <input type="date" data-date max="${todayYmd().replace(/\//g, '-')}">
    </label>
    <div class="target-row">
      <span class="target-label">的</span>
      ${member.advance ? `<div class="segmented targets" role="radiogroup" aria-label="的の種類">
        ${state.targets.map((t) => `<button type="button" role="radio" data-target="${esc(t.key)}" aria-label="${esc(t.key)}"><span class="t-long">${esc(t.key)}</span><span class="t-short">${esc(t.short)}</span></button>`).join('')}
      </div>` : `<span class="target-fixed">${esc(state.basicTarget)}<small>（ベーシック共通）</small></span>`}
    </div>
    <div class="draft-bar" data-draft-bar hidden>
      <span><strong>下書き</strong><span data-draft-text></span></span>
      <button type="button" class="btn small ghost-danger" data-draft-del>${icon('trash')}下書きを削除</button>
    </div>
    <div class="score-entry">
      <output class="score-display" data-display aria-live="polite"></output>
      <div class="keypad score-pad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-k="${n}">${n}</button>`).join('')}
        <button type="button" data-k="clear">C</button>
        <button type="button" data-k="0">0</button>
        <button type="button" data-k="del" aria-label="1文字消す">${icon('backspace')}</button>
      </div>
      <div class="statuses">
        ${state.scoreConfig.statuses.map((s) => `<button type="button" class="status-btn" data-status="${esc(s)}">${esc(s)}</button>`).join('')}
      </div>
    </div>
    <button type="button" class="btn primary large" data-save disabled>保存</button>
  </div>`);

  const display = el.querySelector('[data-display]');
  const saveBtn = el.querySelector('[data-save]');
  const dateInput = el.querySelector('[data-date]');
  dateInput.value = form.date.replace(/\//g, '-');

  const render = () => {
    el.querySelectorAll('[data-type]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.type === form.type)));
    el.querySelectorAll('[data-status]').forEach((b) => b.classList.toggle('active', b.dataset.status === form.status));
    el.querySelectorAll('[data-target]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.target === form.target)));
    el.querySelector('.target-row').classList.toggle('need', !form.status && !!form.score && !form.target);
    display.innerHTML = form.status
      ? `<span class="status-text">${esc(form.status)}</span>`
      : form.score ? `${esc(form.score)}<small>点${form.target ? '・' + esc(targetLabel(form.target)) : ''}</small>` : '<span class="placeholder">点数を入力</span>';
    const n = Number(form.score);
    const scoreOk = form.score !== '' && n >= state.scoreConfig.min && n <= state.scoreConfig.max;
    const valid = form.status || (scoreOk && form.target);
    saveBtn.disabled = !valid;
    saveBtn.textContent = !form.status && scoreOk && !form.target ? '的を選んでください'
      : form.type === '校内記録会' ? '校内記録会の記録として保存' : '保存';
    if (form.score && n > state.scoreConfig.max) display.classList.add('invalid'); else display.classList.remove('invalid');
    const hasDraft = !!(form.score || form.status);
    if (hasDraft) drafts.save(member.memberId, form); else drafts.clear(member.memberId);
    draftBar.hidden = !hasDraft;
    if (hasDraft) draftText.textContent = `${form.status || form.score + '点'}・${form.type}・${form.date}（この端末に保存中）`;
  };
  const draftBar = el.querySelector('[data-draft-bar]');
  const draftText = el.querySelector('[data-draft-text]');
  el.querySelector('[data-draft-del]').addEventListener('click', () => {
    drafts.clear(member.memberId);
    Object.assign(form, {
      type: state.scoreConfig.entryTypes[0], date: todayYmd(), score: '', status: '',
      target: member.advance ? (member.lastTarget || '') : state.basicTarget,
    });
    dateInput.value = form.date.replace(/\//g, '-');
    render();
    toast(`${member.name}：下書きを削除しました`);
  });

  el.querySelector('.score-pad').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    const k = b.dataset.k;
    form.status = '';
    if (k === 'clear') form.score = '';
    else if (k === 'del') form.score = form.score.slice(0, -1);
    else if (form.score.length < 3) form.score = (form.score + k).replace(/^0+(?=\d)/, '');
    render();
  });
  el.querySelector('.statuses').addEventListener('click', (e) => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    form.status = form.status === b.dataset.status ? '' : b.dataset.status;
    if (form.status) form.score = '';
    render();
  });
  el.querySelector('.segmented').addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]');
    if (b) { form.type = b.dataset.type; render(); }
  });
  const targetButtons = el.querySelector('.targets');
  if (targetButtons) targetButtons.addEventListener('click', (e) => {
    const b = e.target.closest('[data-target]');
    if (b) { form.target = b.dataset.target; render(); }
  });
  dateInput.addEventListener('change', () => {
    form.date = dateInput.value ? dateInput.value.replace(/-/g, '/') : todayYmd();
    render();
  });
  el.querySelector('[data-class-btn]').addEventListener('click', async () => {
    await chooseClass(member);
    el.querySelector('[data-class-label]').textContent = member.className ? classDisplay(member.className) : '未設定';
  });
  el.querySelector('[data-close]').addEventListener('click', () => closeSheet());
  attachMemberNav(el, member, openMember);
  saveBtn.addEventListener('click', () => submitScore(member, form));
  const skillBtn = el.querySelector('[data-skill]');
  if (skillBtn) skillBtn.addEventListener('click', () => submitSkill(member, nextRule, form.date));

  // 物理キーボード（iPadのキーボードなど）での入力
  el.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select')) return;
    if (/^\d$/.test(e.key)) el.querySelector(`.score-pad [data-k="${e.key}"]`).click();
    else if (e.key === 'Backspace') el.querySelector('.score-pad [data-k="del"]').click();
    else if (e.key === 'Enter' && !saveBtn.disabled) saveBtn.click();
  });

  render();
  openSheetFor(el, dir);
}

/**
 * シートを開く。dir（1=次・-1=前）を指定し、すでにシートが開いていれば中身だけを入れ替える（横にスライド）
 */
function openSheetFor(el, dir = 0) {
  el.setAttribute('tabindex', '-1');
  if (dir && state.sheet && state.sheet.el.isConnected) {
    const box = state.sheet.el.querySelector('.sheet');
    box.replaceChildren(el);
    box.scrollTop = 0;
    el.classList.add(dir > 0 ? 'slide-next' : 'slide-prev');
    el.focus({ preventScroll: true });
    return;
  }
  closeSheet();
  state.sheet = openSheet(el, { onClose: () => { state.sheet = null; refreshListSoft(); } });
  el.focus({ preventScroll: true });
}

function closeSheet() {
  if (state.sheet) { state.sheet.close(); state.sheet = null; }
}

function refreshListSoft() {
  if (document.getElementById('members')) refreshList();
}

async function setClass(member, className) {
  try {
    await withBusy('保存中…', () => call('members.setClass', { memberId: member.memberId, className }));
    member.className = className;
    toast(className ? `${member.name}：${classDisplay(className)} に設定しました` : `${member.name}：クラスを未設定にしました`);
  } catch (err) {
    alertDialog('クラスを保存できませんでした', err.message);
  }
}

/* ------------------------------ 保存・Undo ------------------------------ */

function describeEntry(payload) {
  const value = payload.status || payload.score + '点' + (payload.target ? '（' + targetLabel(payload.target) + '）' : '');
  return (payload.type === '校内記録会' ? '記録会 ' : '') + value;
}

async function submitScore(member, form) {
  const payload = { memberId: member.memberId, date: form.date, type: form.type };
  if (form.status) payload.status = form.status; else { payload.score = Number(form.score); payload.target = form.target; }
  await sendMutation({ action: 'score.save', payload, requestId: randomId('s-'), label: `${member.name} ${describeEntry(payload)}`, memberName: member.name });
}

async function submitSkill(member, rule, date) {
  const ok = await confirmDialog('実技テスト合格', `${member.name} さんを ${rule.label} に進級させます。\n（${rule.test}）`, '合格にする');
  if (!ok) return;
  const payload = { memberId: member.memberId, date };
  await sendMutation({ action: 'skill.pass', payload, requestId: randomId('k-'), label: `${member.name} 実技テスト合格`, memberName: member.name });
}

/**
 * 保存系の操作を送る。失敗したら「未送信」として端末に残し、同じ requestId で再送できるようにする。
 */
async function sendMutation(op) {
  pending.set(op);
  try {
    const data = await withBusy('保存中…', () => call(op.action, op.payload, { requestId: op.requestId }));
    pending.clear();
    drafts.clear(op.payload.memberId);
    applyMemberUpdate(data.member);
    closeSheet();
    if (data.record) {
      state.undo = {
        recordId: data.record.recordId,
        label: op.label,
        until: new Date(data.record.undoableUntil).getTime(),
        memberName: op.memberName,
      };
      renderUndo();
    }
    await showEvents(data.events, op.memberName);
    if (!data.events || !data.events.length) toast(`保存しました：${op.label}`);
    return data;
  } catch (err) {
    if (err.code === 'AUTH_REQUIRED') return null;
    if (err.code === 'NETWORK') {
      const retry = await dialog({
        title: '通信に失敗しました',
        message: '再試行してください。入力した内容はこの端末に保存されています。',
        tone: 'warning',
        buttons: [{ label: 'あとで', value: false }, { label: '再試行', value: true, style: 'primary' }],
      });
      if (retry) return sendMutation(op);
      renderPendingBanner();
      return null;
    }
    pending.clear();
    await alertDialog('保存できませんでした', err.message, 'warning');
    return null;
  }
}

function applyMemberUpdate(updated) {
  if (!updated) return;
  const m = state.members.find((x) => x.memberId === updated.memberId);
  if (!m) return;
  Object.assign(m, {
    grade: updated.grade,
    gradeLabel: updated.gradeLabel,
    distance: updated.distance,
    centerRod: updated.centerRod,
    personalBests: updated.personalBests,
    pbDate: updated.pbDate,
    lastTarget: updated.lastTarget,
  });
  refreshListSoft();
}

function renderUndo() {
  const bar = document.getElementById('undo-bar');
  if (!bar) return;
  const u = state.undo;
  if (!u || Date.now() > u.until || state.editMode) { bar.innerHTML = ''; return; }
  bar.innerHTML = `<button type="button" class="undo-btn"><span class="undo-main">${icon('undo')}直前の入力を取り消す</span><small>${esc(u.label)}</small></button>`;
  bar.querySelector('button').addEventListener('click', runUndo);
}

async function runUndo() {
  const u = state.undo;
  if (!u) return;
  const ok = await confirmDialog('直前の入力を取り消しますか？', u.label, '取り消す', true);
  if (!ok) return;
  try {
    const data = await withBusy('取り消し中…', () => call('score.undo', { recordId: u.recordId }, { requestId: randomId('u-') }));
    state.undo = null;
    renderUndo();
    applyMemberUpdate(data.member);
    if (data.events && data.events.length) await showEvents(data.events, u.memberName);
    else toast('取り消しました：' + u.label);
  } catch (err) {
    if (err.code === 'AUTH_REQUIRED') return;
    if (err.code !== 'NETWORK') { state.undo = null; renderUndo(); }
    alertDialog('取り消せませんでした', err.message, 'warning');
  }
}

/* ------------------------------ 未送信の操作 ------------------------------ */

function renderPendingBanner() {
  const box = document.getElementById('pending-banner');
  if (!box) return;
  const p = pending.get();
  if (!p) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <div class="banner warning">
      <span>未送信の入力があります：<strong>${esc(p.label)}</strong></span>
      <span class="banner-actions">
        <button type="button" class="btn small" data-discard>破棄</button>
        <button type="button" class="btn small primary" data-resend>再送信</button>
      </span>
    </div>`;
  box.querySelector('[data-resend]').addEventListener('click', async () => {
    box.innerHTML = '';
    await sendMutation(p);
    renderPendingBanner();
  });
  box.querySelector('[data-discard]').addEventListener('click', async () => {
    if (await confirmDialog('未送信の入力を破棄しますか？', p.label, '破棄する', true)) { pending.clear(); renderPendingBanner(); }
  });
}

function offerPendingResend() {
  renderPendingBanner();
}

/* ================================================================== *
 * スタッフ編集モード
 * ================================================================== */

async function toggleEditMode() {
  if (!state.editMode) {
    const ok = await confirmDialog('スタッフ編集モード', '過去の記録を修正・削除できるモードに切り替えます。\n修正すると、その会員の級・距離・自己ベストを全記録から計算し直します。', '切り替える');
    if (!ok) return;
  }
  state.editMode = !state.editMode;
  renderMain();
}

async function openHistory(member, dir = 0) {
  let data;
  try {
    data = await withBusy('記録を読み込み中…', () => call('history.list', { memberId: member.memberId }));
  } catch (err) {
    if (err.code !== 'AUTH_REQUIRED') alertDialog('記録を読み込めませんでした', err.message);
    return;
  }
  const el = h(`<div class="member-sheet">
    ${memberSummaryHtml(Object.assign({}, member, data.member, { kana: member.kana, advance: member.advance, ageCategory: member.ageCategory }))}
    <h3 class="section-title">記録（新しい順）</h3>
    ${data.records.length ? `<ul class="history">${data.records.map((r) => `
      <li><button type="button" class="history-row" data-record="${esc(r.recordId)}">
        <span class="h-date">${esc(r.date)}</span>
        <span class="h-type">${esc(r.type)}</span>
        <span class="h-value">${r.score !== null ? `<strong>${esc(r.score)}</strong>点` : esc(r.status)}${r.target ? ` <small>${esc(targetLabel(r.target))}</small>` : ''}${r.distance ? ` <small>${esc(r.distance)}</small>` : ''}</span>
        <span class="h-badges">${r.isPb ? '<span class="tag pb-tag">PB</span>' : ''}${r.promotedTo ? `<span class="tag grade">→${esc(r.promotedTo)}</span>` : ''}</span>
      </button></li>`).join('')}</ul>` : '<p class="empty">まだ記録がありません</p>'}
  </div>`);
  el.querySelector('[data-close]').addEventListener('click', () => closeSheet());
  el.querySelectorAll('[data-record]').forEach((btn) => {
    btn.addEventListener('click', () => openRecordEditor(member, data.records.find((r) => r.recordId === btn.dataset.record)));
  });
  attachMemberNav(el, member, openHistory);
  openSheetFor(el, dir);
}

function openRecordEditor(member, record) {
  // 以前のステータス（見学など）の記録は、その値も選べるようにする
  const statuses = state.scoreConfig.statuses.concat(record.status && state.scoreConfig.statuses.indexOf(record.status) < 0 ? [record.status] : []);
  const isSkill = record.type === '実技テスト';
  const el = h(`<div class="member-sheet">
    <div class="sheet-head">
      <div><h2>記録の修正</h2><p class="muted">${esc(member.name)}　${esc(record.date)}</p></div>
      <button type="button" class="close-btn" data-close aria-label="閉じる">${icon('close')}</button>
    </div>
    <form class="stack" data-form>
      <label class="field inline"><span>記録日</span><input type="date" name="date" value="${esc(record.date.replace(/\//g, '-'))}" max="${todayYmd().replace(/\//g, '-')}" required></label>
      ${isSkill ? '<p class="muted">実技テスト「合格」の記録です（日付の修正・削除ができます）</p>' : `
      <label class="field inline"><span>入力種別</span>
        <select name="type">${state.scoreConfig.entryTypes.map((t) => `<option ${t === record.type ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      <label class="field inline"><span>点数</span>
        <input type="number" name="score" inputmode="numeric" min="${state.scoreConfig.min}" max="${state.scoreConfig.max}" value="${record.score !== null ? esc(record.score) : ''}" placeholder="（ステータスの場合は空欄）"></label>
      <label class="field inline"><span>ステータス</span>
        <select name="status"><option value="">（点数を記録）</option>${statuses.map((s) => `<option ${s === record.status ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
      <label class="field inline"><span>距離</span>
        <select name="distance">${['5m', '8m'].map((d) => `<option ${d === record.distance ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
      <label class="field inline"><span>的</span>
        <select name="target"><option value="">（点数のときは必ず選ぶ）</option>${state.targets.map((t) => `<option value="${esc(t.key)}" ${t.key === record.target ? 'selected' : ''}>${esc(t.key)}</option>`).join('')}</select></label>`}
      <label class="field"><span>修正理由（任意）</span><input type="text" name="reason" placeholder="例：入力ミス" autocomplete="off"></label>
      <div class="row-actions">
        <button type="button" class="btn danger" data-delete>この記録を削除</button>
        <button type="submit" class="btn primary">修正を保存</button>
      </div>
    </form>
  </div>`);

  el.querySelector('[data-close]').addEventListener('click', () => openHistory(member));
  el.querySelector('[data-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = { recordId: record.recordId, date: fd.get('date').replace(/-/g, '/'), reason: fd.get('reason'), confirmed: true };
    if (!isSkill) {
      payload.type = fd.get('type');
      payload.distance = fd.get('distance');
      payload.target = fd.get('target');
      if (fd.get('status')) { payload.status = fd.get('status'); payload.score = null; } else { payload.score = fd.get('score'); payload.status = ''; }
    }
    if (!(await confirmDialog('本当に編集してもよろしいですか？', '保存すると、この会員の級・距離・自己ベストを全記録から計算し直します。', '編集する', true))) return;
    await sendEdit('history.update', payload, member);
  });
  el.querySelector('[data-delete]').addEventListener('click', async () => {
    if (!(await confirmDialog('本当に編集してもよろしいですか？', `${record.date} の記録を削除します。級・距離・自己ベストを全記録から計算し直します。`, '削除する', true))) return;
    const reason = el.querySelector('[name="reason"]').value;
    await sendEdit('history.delete', { recordId: record.recordId, reason, confirmed: true }, member);
  });
  openSheetFor(el);
}

async function sendEdit(action, payload, member) {
  try {
    const data = await withBusy('再計算中…', () => call(action, payload, { requestId: randomId('e-') }));
    applyMemberUpdate(data.member);
    await showEvents(data.events, member.name);
    toast('修正しました');
    openHistory(member);
  } catch (err) {
    if (err.code === 'AUTH_REQUIRED') return;
    alertDialog('修正できませんでした', err.code === 'NETWORK' ? NETWORK_MESSAGE : err.message, 'warning');
  }
}

/* ================================================================== *
 * 名簿の同期・CSV取込
 * ================================================================== */

async function runRosterSync(payload) {
  try {
    const result = await withBusy('名簿を同期中…', () => call('roster.sync', payload));
    await afterRosterResult(result);
  } catch (err) {
    await handleRosterError(err, () => runRosterSync({ force: true }));
  }
}

async function onCsvSelected(e) {
  const list = Array.from(e.target.files || []);
  e.target.value = '';
  if (!list.length) return;
  const names = list.map((f) => f.name).join('\n');
  const note = list.length > 1 ? '\n（複数のファイルは生徒番号で1つにまとめて取り込みます）' : '\n（SCOLAの「基本」と「受講」の2つを同時に選ぶと、生年月日とクラスの両方が入ります）';
  if (!(await confirmDialog('名簿を取り込みますか？', `${names}${note}`, '取り込む'))) return;
  try {
    const files = await Promise.all(list.map(async (f) => ({ fileBase64: await readAsBase64(f), fileName: f.name })));
    const result = await withBusy('取り込み中…', () => call('roster.importCsv', { files }, { timeoutMs: 120000 }));
    await afterRosterResult(result);
  } catch (err) {
    await handleRosterError(err, () => runRosterSync({ force: true }));
  }
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new ApiError('BAD_REQUEST', 'ファイルを読み込めませんでした。'));
    reader.readAsDataURL(file);
  });
}

async function afterRosterResult(result) {
  state.lastSync = result.lastSync;
  const members = await call('members.list');
  state.members = members.members;
  renderMain();
  const warnings = (result.warnings || []).map((w) => `<li>${esc(w)}</li>`).join('');
  await dialog({
    title: '名簿を更新しました',
    html: `<p class="dialog-message"><strong>${esc(result.summaryText)}</strong></p>
      ${warnings ? `<ul class="warn-list">${warnings}</ul>` : ''}
      ${result.counts.added ? '<p class="muted">新しく入った会員は「クラス未設定」から所属クラスを設定してください。</p>' : ''}`,
    buttons: [{ label: 'OK', value: true, style: 'primary' }],
  });
}

async function handleRosterError(err, forceFn) {
  if (err.code === 'AUTH_REQUIRED') return;
  if (err.response && err.response.needsConfirmation) {
    const sample = (err.response.details && err.response.details.sample) || [];
    const go = await dialog({
      title: '退会扱いの人数が多すぎます',
      message: err.message,
      html: sample.length ? `<ul class="warn-list">${sample.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : '',
      tone: 'warning',
      buttons: [{ label: '中止する', value: false }, { label: '強制実行', value: true, style: 'danger' }],
    });
    if (go) return forceFn();
    return;
  }
  await alertDialog('名簿を更新できませんでした', err.message, 'warning');
}

/* ================================================================== */

setInterval(renderUndo, 30 * 1000); // Undo の期限切れを反映
init();
