/**
 * api.js — GAS（Main.gs の doPost）との通信
 *
 * ・Content-Type を text/plain にして、別ドメインの GAS を事前確認（CORSプリフライト）なしで呼ぶ。
 * ・通信できなかった・応答が壊れていた場合は code: 'NETWORK' のエラーにする（画面は入力内容を保持して再試行を案内）。
 * ・サーバーが AUTH_REQUIRED を返したら hooks.onAuthRequired（PIN入力画面へ）。
 */
import { getApiUrl, session } from './config.js';

export class ApiError extends Error {
  constructor(code, message, response) {
    super(message);
    this.code = code;
    this.response = response || null;
  }
}

export const NETWORK_MESSAGE = '通信に失敗しました。再試行してください。';

export const hooks = {
  onSession() {},
  onAuthRequired() {},
};

/**
 * @param {string} action
 * @param {Object=} payload
 * @param {{passive?: boolean, requestId?: string, timeoutMs?: number}=} options
 */
export async function call(action, payload = {}, options = {}) {
  const url = getApiUrl();
  if (!url) throw new ApiError('NO_API', '接続先が設定されていません。');

  const body = JSON.stringify({
    action,
    payload,
    token: session.get('token', null),
    passive: options.passive === true,
    requestId: options.requestId,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 60000);
  let json;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    json = await res.json();
  } catch (e) {
    throw new ApiError('NETWORK', NETWORK_MESSAGE);
  } finally {
    clearTimeout(timer);
  }

  if (json.session) hooks.onSession(json.session);
  if (!json.ok) {
    if (json.code === 'AUTH_REQUIRED') hooks.onAuthRequired(json.message);
    throw new ApiError(json.code || 'UNKNOWN', json.message || NETWORK_MESSAGE, json);
  }
  return json.data;
}

/** アプリを閉じるときのログアウト（応答を待たずに送る） */
export function beaconLogout() {
  const url = getApiUrl();
  const token = session.get('token', null);
  if (!url || !token || !navigator.sendBeacon) return;
  try {
    navigator.sendBeacon(url, JSON.stringify({ action: 'auth.logout', payload: {}, token }));
  } catch (e) { /* noop */ }
}
