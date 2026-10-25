/**
 * session.js — 15分ルール（画面側）
 *
 *   ・最後の操作から14分で「まもなくロックされます」を表示、15分でロック（PIN入力画面へ）
 *   ・タップ・キー入力・文字入力（入力欄にフォーカス中の入力を含む）を「操作」とみなして延長する
 *   ・画面だけの操作が続いてもサーバー側のセッションが切れないよう、2分に1回まで session.ping を送る
 *   ・アプリを閉じた・タスクキルした場合：トークンは sessionStorage にあるため消え、次回はPIN入力から
 *     （閉じる瞬間に sendBeacon でサーバー側のセッションも破棄する）
 *   ・バックグラウンドから戻ったときは、経過時間を確認してすぐにロック判定する
 */
import { session } from './config.js';
import { call, beaconLogout } from './api.js';

let ttlMs = 15 * 60 * 1000;
let warnMs = 14 * 60 * 1000;
let lastActivity = Date.now();
let lastPing = 0;
let timer = null;
let handlers = { onWarn() {}, onClearWarn() {}, onExpire() {} };
let warned = false;

export function getToken() {
  return session.get('token', null);
}

export function isLoggedIn() {
  return !!getToken();
}

/** サーバーから届いたセッション情報で時間を合わせる */
export function applyServerSession(info) {
  if (!info) return;
  if (info.ttlSec) ttlMs = info.ttlSec * 1000;
  if (info.warnAtSec) warnMs = info.warnAtSec * 1000;
}

export function begin(token, info, h) {
  session.set('token', token);
  applyServerSession(info);
  handlers = Object.assign(handlers, h);
  lastActivity = Date.now();
  lastPing = Date.now();
  warned = false;
  clearInterval(timer);
  timer = setInterval(check, 1000);
}

export function end() {
  clearInterval(timer);
  timer = null;
  session.remove('token');
  if (warned) { warned = false; handlers.onClearWarn(); }
}

/** 操作があったときに呼ぶ */
export function touch() {
  if (!timer) return;
  lastActivity = Date.now();
  if (warned) { warned = false; handlers.onClearWarn(); }
  if (Date.now() - lastPing > 2 * 60 * 1000) {
    lastPing = Date.now();
    call('session.ping').catch(() => { /* 通信失敗時は次の操作で再試行 */ });
  }
}

/** API 呼び出しが成功した（サーバー側で延長された） */
export function markServerActivity() {
  lastPing = Date.now();
}

function check() {
  const idle = Date.now() - lastActivity;
  if (idle >= ttlMs) {
    expire();
  } else if (idle >= warnMs) {
    warned = true;
    handlers.onWarn(Math.ceil((ttlMs - idle) / 1000));
  }
}

function expire() {
  beaconLogout();
  end();
  handlers.onExpire();
}

['pointerdown', 'keydown', 'input', 'focusin'].forEach((type) => {
  document.addEventListener(type, touch, { capture: true, passive: true });
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && timer) check();
});

// アプリを閉じる・再読み込みする：サーバー側のセッションを破棄し、端末のトークンも消す（次回はPIN入力から）
window.addEventListener('pagehide', (event) => {
  if (event.persisted || !timer) return;
  beaconLogout();
  session.remove('token');
});
