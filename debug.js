/**
 * Диагностический оверлей. Включается только параметром ?debug в адресе —
 * в обычной игре его нет, поэтому сборка одна и отправлять её безопасно.
 *
 * Нужен, потому что в черновике консоли игра ведёт себя иначе, чем на localhost,
 * а открыть F12 внутри превью не всегда возможно. Оверлей показывает состояние
 * прямо на экране, чтобы можно было снять скриншот.
 *
 * Ключевая деталь: текст обновляется по setInterval, а кадры считаются в
 * requestAnimationFrame. Если rAF заморожен (скрытый iframe, троттлинг),
 * панель продолжит обновляться и покажет FPS 0 — то есть отличит
 * «игра встала» от «страница мертва целиком».
 */

const ENABLED = /[?&]debug\b/.test(location.search);

// eslint-disable-next-line no-empty-function
function noop() {}

export const dbg = ENABLED ? realDbg : noop;

const box = document.createElement('div');
box.style.cssText = [
  'position:fixed', 'left:0', 'top:0', 'z-index:99999',
  'background:rgba(0,0,0,.82)', 'color:#8f8', 'padding:6px 8px',
  'font:11px/1.35 monospace', 'white-space:pre', 'pointer-events:none',
  'max-width:100%', 'text-align:left',
].join(';');
const events = [];
function realDbg(msg) {
  events.push(msg);
  if (events.length > 5) events.shift();
}

let frames = 0;
let fps = -1;
let last = performance.now();

if (ENABLED) {
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(box));

  window.addEventListener('error', (e) => realDbg('ERR ' + (e.message || e.type)));
  window.addEventListener('unhandledrejection',
    (e) => realDbg('REJ ' + ((e.reason && e.reason.message) || e.reason)));

  (function count() {
    frames++;
    requestAnimationFrame(count);
  })();

  setInterval(() => {
    const now = performance.now();
    if (now - last >= 500) {
      fps = Math.round((frames * 1000) / (now - last));
      frames = 0;
      last = now;
    }
    const s = window.__state || {};
    box.textContent = [
      `fps:${fps} hidden:${document.hidden} iframe:${window.top !== window.self}`,
      `phase:${s.phase} paused:${s.paused} score:${s.score}`,
      `sdk:${window.__sdkStatus || '?'}`,
      ...events,
    ].join('\n');
  }, 300);
}
