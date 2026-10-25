/**
 * offline.js — 入力中データの端末保存（通信の瞬断対策）
 *
 *   drafts  … 会員ごとの入力途中の内容（点数・ステータス・入力種別・日付）。入力のたびに保存し、
 *              画面を開き直しても続きから入力できる。保存に成功したら消す。
 *   pending … 送信に失敗した操作（requestId 付き）。同じ requestId で再送するので、二重登録にならない。
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
  get() {
    return local.get('pending', null);
  },
  set(item) {
    local.set('pending', Object.assign({}, item, { at: Date.now() }));
  },
  clear() {
    local.remove('pending');
  },
};
