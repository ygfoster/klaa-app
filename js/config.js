/**
 * config.js — 端末に保存する設定（接続先URL・端末ID）と保存領域のラッパー
 *
 * localStorage   … アプリを閉じても残る：接続先URL・端末ID・入力中の下書き・未送信の操作
 * sessionStorage … アプリを閉じると消える：セッショントークン（閉じたら次回はPIN入力から）
 * 非公開モードなどで保存領域が使えない場合も、例外で止まらないようにしている。
 */

export const APP_VERSION = '0.4.0';

const PREFIX = 'klaa.';

function wrap(area) {
  return {
    get(key, fallback = null) {
      try {
        const raw = area().getItem(PREFIX + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { area().setItem(PREFIX + key, JSON.stringify(value)); } catch (e) { /* 保存できなくても動作は続ける */ }
    },
    remove(key) {
      try { area().removeItem(PREFIX + key); } catch (e) { /* noop */ }
    },
  };
}

export const local = wrap(() => window.localStorage);
export const session = wrap(() => window.sessionStorage);

/** 接続先（GAS の Web アプリ URL）。https の GAS か、開発用の localhost だけを受け付ける */
export function getApiUrl() {
  return local.get('apiUrl', '');
}

export function isValidApiUrl(url) {
  return /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/api$/.test(url);
}

export function setApiUrl(url) {
  const value = String(url || '').trim();
  if (!isValidApiUrl(value)) throw new Error('接続先URLの形式が正しくありません（https://script.google.com/macros/s/…/exec）');
  local.set('apiUrl', value);
}

/** 初回設定用リンク（…/#api=<URL>）から接続先を読み取り、URLからは消す */
export function takeApiUrlFromHash() {
  const m = location.hash.match(/(?:^#|&)api=([^&]+)/);
  if (!m) return null;
  history.replaceState(null, '', location.pathname + location.search);
  return decodeURIComponent(m[1]);
}

export function randomId(prefix) {
  if (crypto.randomUUID) return prefix + crypto.randomUUID().replace(/-/g, '');
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return prefix + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 端末ID（初回起動時に作って保存。Undo の本人確認・PIN入力ミスの端末ロックに使う） */
export function getDeviceId() {
  let id = local.get('deviceId', '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    id = randomId('dev-').slice(0, 40);
    local.set('deviceId', id);
  }
  return id;
}

export function todayYmd() {
  const d = new Date();
  return d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0');
}
