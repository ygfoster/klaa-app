/**
 * ui.js — 画面部品（ダイアログ・トースト・読み込み表示・保存後のポップアップ演出）
 */

const root = () => document.getElementById('overlay-root');

/* ------------------------------------------------------------------ *
 * アイコン（線画のSVG。文字色に合わせて色が変わる）
 * ------------------------------------------------------------------ */

const ICON_PATHS = {
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3.5V8h4.5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20.5V16h-4.5"/>',
  upload: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 18v-6M9.5 14.5L12 12l2.5 2.5"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  swap: '<path d="M7 4L4 7l3 3"/><path d="M4 7h12"/><path d="M17 20l3-3-3-3"/><path d="M20 17H8"/>',
  chevronLeft: '<path d="M15 5l-7 7 7 7"/>',
  chevronRight: '<path d="M9 5l7 7-7 7"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  trash: '<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 13h9l1-13"/>',
  backspace: '<path d="M8.5 5H20a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H8.5L3 12z"/><path d="M11.5 9.5l5 5M16.5 9.5l-5 5"/>',
  trophy: '<path d="M8 4h8v6a4 4 0 0 1-8 0z"/><path d="M8 6H5v1.5A3 3 0 0 0 8 10.5M16 6h3v1.5a3 3 0 0 1-3 3"/><path d="M12 14v3.5M8.5 20.5h7M9.5 20.5c0-1.7 1.1-3 2.5-3s2.5 1.3 2.5 3"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  award: '<circle cx="12" cy="9" r="5.5"/><path d="M8.6 13.4L7 21l5-2.6 5 2.6-1.6-7.6"/>',
  arrow: '<path d="M4 12h15"/><path d="M14 7l5 5-5 5"/>',
  rod: '<path d="M3 12h13"/><circle cx="18.5" cy="12" r="2.5"/><path d="M6 9v6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><path d="M12 7.6v.2"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5"/><path d="M12 17.3v.2"/>',
  cap: '<path d="M2.5 9.5L12 5l9.5 4.5L12 14z"/><path d="M6.5 11.6V16c0 1.4 2.5 3 5.5 3s5.5-1.6 5.5-3v-4.4"/><path d="M21.5 9.5v5"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
};

/** @param {string} name ICON_PATHS のキー */
export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name] || ''}</svg>`;
}

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
  pb: 'trophy', pbTie: 'target', promotion: 'award', distance: 'arrow', centerRod: 'rod',
  needsMeet: 'info', demotion: 'alert', equipmentRevert: 'alert', info: 'info',
};

/**
 * サーバーから届いた events を1枚のカードで見せる。
 *   自己ベスト … 点数をスコアボードのように大きく表示（前回との差も）
 *   進級       … 「3級 → 4級」
 *   お知らせ・警告 … 左に細い色の線を付けた行
 * 警告（降格・装備を戻す）があるときは「確認しました」を押すまで閉じない。
 */
export function showEvents(events, memberName) {
  if (!events || !events.length) return Promise.resolve();
  const pb = events.find((e) => e.kind === 'pb' || e.kind === 'pbTie');
  const promotion = events.find((e) => e.kind === 'promotion');
  const notes = events.filter((e) => e !== pb && e !== promotion);
  const warnings = events.filter((e) => e.level === 'warning');
  // 警告を最後に
  notes.sort((a, b) => (a.level === 'warning') - (b.level === 'warning'));

  const hero = pb && typeof pb.score === 'number' ? `
    <div class="pb-hero">
      <p class="pb-hero-label">${pb.kind === 'pbTie' ? '自己ベスト タイ' : '自己ベスト更新'}${pb.target ? `<span>${esc(pb.target)}</span>` : ''}</p>
      <p class="pb-hero-score"><span data-count="${esc(pb.score)}" data-from="${esc(pb.before === null || pb.before === undefined ? pb.score : pb.before)}">${esc(pb.score)}</span><small>点</small></p>
      <p class="pb-hero-diff">${pb.kind === 'pbTie' || pb.before === null || pb.before === undefined
        ? '前回の自己ベストと同点'
        : `これまで ${esc(pb.before)}点<strong>+${esc(pb.score - pb.before)}</strong>`}</p>
    </div>` : pb ? `<p class="pb-hero-label solo">${esc(pb.message)}</p>` : '';

  const promo = promotion ? `
    <div class="promo-row">
      <span class="promo-label">進級</span>
      <span class="promo-value">${promotion.from ? `<span class="promo-from">${esc(promotion.from)}</span>${icon('arrow', 'promo-arrow')}` : ''}<strong>${esc(promotion.to || promotion.message)}</strong></span>
      ${/飛び級/.test(promotion.message) ? `<small class="promo-note">${esc(promotion.message.replace(/^.*?（/, '（'))}</small>` : ''}
    </div>` : '';

  const list = notes.length ? `
    <ul class="note-list">
      ${notes.map((e) => `<li class="note ${esc(e.level)}">${icon(EVENT_ICONS[e.kind] || 'info')}<span>${esc(e.message)}</span></li>`).join('')}
    </ul>` : '';

  const celebrate = !!(pb || promotion);
  if (celebrate) confetti();
  const done = dialog({
    title: memberName,
    html: `<div class="event-card">${hero}${promo}${list}</div>`,
    tone: warnings.length ? 'warning' : celebrate ? 'celebrate' : '',
    buttons: [{ label: warnings.length ? '確認しました' : 'OK', value: true, style: 'primary' }],
  });
  countUp(root().querySelector('.dialog:last-of-type [data-count]') || document.querySelector('[data-count]'));
  return done;
}

/** 点数を前回の自己ベストから数え上げる（動きを減らす設定では何もしない） */
function countUp(el) {
  if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const to = Number(el.dataset.count);
  const from = Number(el.dataset.from);
  if (!(to > from)) return;
  const start = performance.now();
  const ms = 700;
  const step = (t) => {
    const k = Math.min(1, (t - start) / ms);
    el.textContent = String(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** 紙吹雪（動きを減らす設定の端末では表示しない） */
export function confetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#e60013', '#102a43', '#e8b500', '#c9d6e3'];
  const layer = h('<div class="confetti" aria-hidden="true"></div>');
  for (let i = 0; i < 40; i++) {
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

export function openSheet(contentEl, { onClose, cls = '' } = {}) {
  const el = h(`<div class="scrim sheet-scrim ${esc(cls)}"><section class="sheet" role="dialog" aria-modal="true"></section></div>`);
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

/* ------------------------------------------------------------------ *
 * 右上のメニュー（右から出るパネル。各項目に説明文を付ける）
 * ------------------------------------------------------------------ */

/**
 * @param {{title: string, sub?: string, footer?: string, items: Array<{id: string, icon: string, label: string, desc: string, tone?: string, file?: string}>}} opts
 *   file を指定した項目はファイル選択（accept）になる
 * @param {function(string, Event=): void} onSelect
 */
export function openDrawer(opts, onSelect) {
  const el = h(`
    <div class="scrim drawer-scrim" role="presentation">
      <aside class="drawer" role="dialog" aria-modal="true" aria-label="メニュー">
        <div class="drawer-head">
          <div><strong>${esc(opts.title)}</strong>${opts.sub ? `<small>${esc(opts.sub)}</small>` : ''}</div>
          <button type="button" class="close-btn" data-close aria-label="メニューを閉じる">${icon('close')}</button>
        </div>
        <ul class="drawer-list">
          ${opts.items.map((it) => `<li>
            ${it.file !== undefined
              ? `<label class="drawer-item ${esc(it.tone || '')}" data-id="${esc(it.id)}">`
              : `<button type="button" class="drawer-item ${esc(it.tone || '')}" data-id="${esc(it.id)}">`}
              <span class="drawer-icon">${icon(it.icon)}</span>
              <span class="drawer-text"><strong>${esc(it.label)}</strong><small>${esc(it.desc)}</small></span>
              ${it.file !== undefined ? `<input type="file" accept="${esc(it.file)}" multiple hidden></label>` : '</button>'}
          </li>`).join('')}
        </ul>
        ${opts.footer ? `<p class="drawer-foot">${esc(opts.footer)}</p>` : ''}
      </aside>
    </div>`);
  const close = () => {
    el.classList.add('closing');
    setTimeout(() => el.remove(), 200);
  };
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.closest('[data-close]')) return close();
    const b = e.target.closest('button[data-id]');
    if (b) { close(); onSelect(b.dataset.id); }
  });
  el.querySelectorAll('input[type="file"]').forEach((input) => {
    input.addEventListener('change', (e) => {
      const id = input.closest('[data-id]').dataset.id;
      close();
      onSelect(id, e);
    });
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  root().appendChild(el);
  el.querySelector('[data-close]').focus({ preventScroll: true });
  return { close };
}

/* ------------------------------------------------------------------ *
 * 選択リスト（端末標準のプルダウンの代わり。見出しごとにまとめて表示）
 * ------------------------------------------------------------------ */

/**
 * @param {{title: string, value: string, groups: Array<{label?: string, options: Array<{value: string, label: string, sub?: string}>}>}} opts
 * @return {Promise<string|null>} 選んだ value（閉じただけなら null）
 */
export function pickOption(opts) {
  return new Promise((resolve) => {
    const el = h(`
      <div class="scrim sheet-scrim picker-scrim" role="presentation">
        <section class="sheet picker" role="dialog" aria-modal="true" aria-label="${esc(opts.title)}">
          <div class="picker-head">
            <strong>${esc(opts.title)}</strong>
            <button type="button" class="close-btn" data-close aria-label="閉じる">${icon('close')}</button>
          </div>
          <div class="picker-body">
            ${opts.groups.map((g) => `
              ${g.label ? `<p class="picker-group">${esc(g.label)}</p>` : ''}
              <ul class="picker-list">
                ${g.options.map((o) => `<li><button type="button" class="picker-item" data-value="${esc(o.value)}" aria-pressed="${o.value === opts.value}">
                  <span class="picker-text">${esc(o.label)}${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</span>
                  <span class="picker-check">${o.value === opts.value ? icon('check') : ''}</span>
                </button></li>`).join('')}
              </ul>`).join('')}
          </div>
        </section>
      </div>`);
    const finish = (value) => {
      el.classList.add('closing');
      setTimeout(() => el.remove(), 180);
      resolve(value);
    };
    el.addEventListener('click', (e) => {
      if (e.target === el || e.target.closest('[data-close]')) return finish(null);
      const b = e.target.closest('[data-value]');
      if (b) finish(b.dataset.value);
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') finish(null); });
    root().appendChild(el);
    const selected = el.querySelector('[aria-pressed="true"]');
    (selected || el.querySelector('[data-close]')).focus({ preventScroll: true });
    if (selected) selected.scrollIntoView({ block: 'center' });
  });
}
