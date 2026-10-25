/**
 * ui.js — 画面部品（ダイアログ・トースト・読み込み表示・保存後のポップアップ演出）
 */

const root = () => document.getElementById('overlay-root');

export function esc(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/* ------------------------------------------------------------------ *
 * ダイアログ
 * ------------------------------------------------------------------ */

/**
 * @param {{title?: string, message?: string, html?: string, buttons: Array<{label: string, value: *, style?: string}>, tone?: string}} opts
 * @return {Promise<*>} 押されたボタンの value
 */
export function dialog(opts) {
  return new Promise((resolve) => {
    const el = h(`
      <div class="scrim" role="presentation">
        <div class="dialog ${esc(opts.tone || '')}" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title">
          ${opts.title ? `<h2 id="dlg-title">${esc(opts.title)}</h2>` : ''}
          ${opts.message ? `<p class="dialog-message">${esc(opts.message)}</p>` : ''}
          ${opts.html || ''}
          <div class="dialog-actions">
            ${opts.buttons.map((b, i) => `<button type="button" class="btn ${esc(b.style || '')}" data-i="${i}">${esc(b.label)}</button>`).join('')}
          </div>
        </div>
      </div>`);
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-i]');
      if (!btn) return;
      el.classList.add('closing');
      setTimeout(() => el.remove(), 150);
      resolve(opts.buttons[Number(btn.dataset.i)].value);
    });
    root().appendChild(el);
    const primary = el.querySelector('.btn.primary, .btn.danger') || el.querySelector('.btn');
    if (primary) primary.focus({ preventScroll: true });
  });
}

export function alertDialog(title, message, tone) {
  return dialog({ title, message, tone, buttons: [{ label: 'OK', value: true, style: 'primary' }] });
}

export function confirmDialog(title, message, okLabel = 'OK', danger = false) {
  return dialog({
    title, message,
    buttons: [
      { label: 'キャンセル', value: false },
      { label: okLabel, value: true, style: danger ? 'danger' : 'primary' },
    ],
  });
}

/* ------------------------------------------------------------------ *
 * トースト（画面下の短いお知らせ。取り消しボタン付きにもできる）
 * ------------------------------------------------------------------ */

let toastEl = null;
let toastTimer = null;

export function toast(message, opts = {}) {
  hideToast();
  toastEl = h(`
    <div class="toast ${esc(opts.tone || '')}" role="status">
      <span>${esc(message)}</span>
      ${opts.actionLabel ? `<button type="button" class="toast-action">${esc(opts.actionLabel)}</button>` : ''}
    </div>`);
  if (opts.actionLabel) {
    toastEl.querySelector('.toast-action').addEventListener('click', () => {
      hideToast();
      opts.onAction();
    });
  }
  root().appendChild(toastEl);
  toastTimer = setTimeout(hideToast, opts.duration || 3500);
}

export function hideToast() {
  clearTimeout(toastTimer);
  if (toastEl) toastEl.remove();
  toastEl = null;
}

/* ------------------------------------------------------------------ *
 * 読み込み中
 * ------------------------------------------------------------------ */

let busyCount = 0;
let busyEl = null;

export async function withBusy(label, fn) {
  busyCount++;
  if (!busyEl) {
    busyEl = h(`<div class="busy" role="status" aria-live="assertive"><div class="busy-card"><div class="spinner"></div><span></span></div></div>`);
    root().appendChild(busyEl);
  }
  busyEl.querySelector('span').textContent = label;
  try {
    return await fn();
  } finally {
    busyCount--;
    if (busyCount === 0 && busyEl) { busyEl.remove(); busyEl = null; }
  }
}

/* ------------------------------------------------------------------ *
 * 保存後のポップアップ（自己ベスト・進級・記録会の案内・降格の警告）
 * ------------------------------------------------------------------ */

const EVENT_ICONS = {
  pb: '🏆', pbTie: '🎯', promotion: '🎉', distance: '🏹', centerRod: '🔧',
  needsMeet: '💡', demotion: '⚠️', equipmentRevert: '⚠️', info: 'ℹ️',
};

/**
 * サーバーから届いた events を、お祝い → お知らせ → 警告 の順に1枚のカードで見せる。
 * 警告（降格・装備を戻す）があるときは「確認しました」を押すまで閉じない。
 */
export function showEvents(events, memberName) {
  if (!events || !events.length) return Promise.resolve();
  const celebrate = events.filter((e) => e.level === 'celebrate');
  const warnings = events.filter((e) => e.level === 'warning');
  const infos = events.filter((e) => e.level === 'info');
  const ordered = celebrate.concat(infos, warnings);

  const html = `
    <ul class="event-list">
      ${ordered.map((e) => `
        <li class="event ${esc(e.level)} ${esc(e.kind)}">
          <span class="event-icon" aria-hidden="true">${EVENT_ICONS[e.kind] || '•'}</span>
          <span class="event-text">${esc(e.message.replace(/^[⚠️💡]️?\s*/u, ''))}</span>
        </li>`).join('')}
    </ul>`;

  if (celebrate.length) confetti();
  return dialog({
    title: memberName,
    html,
    tone: warnings.length ? 'warning' : celebrate.length ? 'celebrate' : '',
    buttons: [{ label: warnings.length ? '確認しました' : 'OK', value: true, style: 'primary' }],
  });
}

/** 紙吹雪（動きを減らす設定の端末では表示しない） */
export function confetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#facc28', '#de3834', '#2884d6', '#f5f5f0', '#34c759'];
  const layer = h('<div class="confetti" aria-hidden="true"></div>');
  for (let i = 0; i < 60; i++) {
    const p = document.createElement('i');
    p.style.left = Math.random() * 100 + 'vw';
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = Math.random() * 0.4 + 's';
    p.style.animationDuration = 1.6 + Math.random() * 1.2 + 's';
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 3500);
}

/* ------------------------------------------------------------------ *
 * ボトムシート（会員の入力画面。iPad では中央のパネル）
 * ------------------------------------------------------------------ */

export function openSheet(contentEl, { onClose } = {}) {
  const el = h(`<div class="scrim sheet-scrim"><section class="sheet" role="dialog" aria-modal="true"></section></div>`);
  el.querySelector('.sheet').appendChild(contentEl);
  const close = () => {
    el.classList.add('closing');
    setTimeout(() => el.remove(), 180);
    if (onClose) onClose();
  };
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
  root().appendChild(el);
  return { el, close };
}
