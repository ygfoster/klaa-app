/**
 * offline.js — 入力中データの端末保存（通信の瞬断対策）
 *
 *   drafts  … 会員ごとの入力途中の内容（点数・ステータス・入力種別・日付）。入力のたびに保存し、
 *              画面を開き直しても続きから入力できる。保存に成功したら消す。
 *   pending … 送信に失敗した操作（requestId 付き）の一覧。同じ requestId で再送するので、二重登録にならない。
 *              電波が悪いときに続けて失敗しても、すべて残す（以前は最後の1件だけだった）。
 */
import { local } from './config.js';

export const drafts = {
  get(memberId) {
    return (local.get('drafts', {}) || {})[memberId] || null;
  },
  save(memberId, data) {
    const all = local.get('drafts', {}) || {};
    all[memberId] = Object.assign({}, data, { savedAt: Date.now() });
    local.set('drafts', all);
  },
  clear(memberId) {
    const all = local.get('drafts', {}) || {};
    delete all[memberId];
    local.set('drafts', all);
  },
};

export const pending = {
  list() {
    const v = local.get('pending', null);
    if (Array.isArray(v)) return v;
    return v && v.requestId ? [v] : []; // 以前の形式（1件だけ）
  },
  add(item) {
    const rest = this.list().filter((p) => p.requestId !== item.requestId);
    local.set('pending', rest.concat([Object.assign({}, item, { at: Date.now() })]));
  },
  remove(requestId) {
    const rest = this.list().filter((p) => p.requestId !== requestId);
    if (rest.length) local.set('pending', rest); else local.remove('pending');
  },
  clearAll() {
    local.remove('pending');
  },
};
