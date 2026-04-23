/**
 * dragPanel.js — shared helper for making a floating panel draggable by its header.
 *
 * Usage:
 *   makeDraggable(panel, { ignoreSelector: '.fx-close' });
 *
 * Looks up the first `.fx-header` inside `panel` and treats mousedown on it
 * (except on elements matching `ignoreSelector`) as a drag gesture.
 */

export function makeDraggable(el, { headerSelector = '.fx-header', ignoreSelector = null } = {}) {
  const header = el.querySelector(headerSelector);
  if (!header) return;
  header.style.cursor = 'move';

  header.addEventListener('mousedown', (e) => {
    if (ignoreSelector && e.target.closest(ignoreSelector)) return;
    e.preventDefault();

    const startX = e.clientX;
    const startY = e.clientY;
    const startL = el.offsetLeft;
    const startT = el.offsetTop;

    const onMove = (e2) => {
      el.style.left = `${startL + e2.clientX - startX}px`;
      el.style.top  = `${startT + e2.clientY - startY}px`;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
}
