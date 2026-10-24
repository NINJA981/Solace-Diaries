/**
 * Chrome's pointer light: while the Chrome world is active and the device has a fine, hovering
 * pointer (a mouse or pen, never touch), writes the pointer's viewport position to two custom
 * properties on <html>. glass.css paints the specular sheen from them. One passive listener, one
 * style write per animation frame; nothing runs under reduced motion or in other worlds.
 */
let installed = false;

export function installPointerLight(): void {
  if (installed || typeof window === 'undefined' || typeof matchMedia !== 'function') return;
  installed = true;
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.documentElement;
  let x = 0;
  let y = 0;
  let queued = false;

  const flush = () => {
    queued = false;
    root.style.setProperty('--chrome-px', `${x}px`);
    root.style.setProperty('--chrome-py', `${y}px`);
  };
  const clear = () => {
    root.style.removeProperty('--chrome-px');
    root.style.removeProperty('--chrome-py');
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || !fine.matches || calm.matches || root.dataset.world !== 'chrome') return;
    x = e.clientX;
    y = e.clientY;
    if (!queued) {
      queued = true;
      requestAnimationFrame(flush);
    }
  };
  window.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerleave', clear);
}
