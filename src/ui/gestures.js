// Pointer gestures on the canvas, the same for mouse, pen and touch: drag (one finger or the mouse),
// pinch (two fingers), tap and double tap (a single tap waits a moment to be sure it isn't the first of two),
// and the wheel. Whoever owns the view at the moment decides what each one means.
export function gestures(el, h) {
  const pts = new Map();
  let drag = null, pinch = 0, lastTap = null, tapTimer = 0;
  const spread = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  const begin = (id, x, y, fresh) => { drag = { id, x, y, x0: x, y0: y, t0: performance.now(), moved: fresh ? 0 : 99 }; };

  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    try { el.setPointerCapture(e.pointerId); } catch { /* (a pointer already gone) */ }
    el.focus({ preventScroll: true });
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) begin(e.pointerId, e.clientX, e.clientY, true);
    else if (pts.size === 2) { pinch = spread(); drag = null; }
    h.down?.();
  });
  el.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (pts.size === 2 && pinch) {
      const s = spread();
      if (s > 0) h.pinch?.(s / pinch);
      pinch = s;
    } else if (drag && drag.id === e.pointerId) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      h.drag?.(dx, dy);
    }
  });
  const up = (e, cancel) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (drag && drag.id === e.pointerId) {
      if (!cancel && drag.moved < 8 && performance.now() - drag.t0 < 400) tap(e.clientX, e.clientY);
      drag = null;
    }
    if (pts.size < 2) pinch = 0;
    // one finger left down after a pinch carries on as a drag (not a tap)
    if (pts.size === 1) { const [[id, p]] = [...pts.entries()]; begin(id, p.x, p.y, false); }
    if (!pts.size) h.up?.();
  };
  el.addEventListener('pointerup', (e) => up(e, false));
  el.addEventListener('pointercancel', (e) => up(e, true));
  function tap(x, y) {
    const now = performance.now();
    if (lastTap && now - lastTap.t < 360 && Math.hypot(x - lastTap.x, y - lastTap.y) < 36) {
      clearTimeout(tapTimer);
      lastTap = null;
      h.doubleTap?.(x, y);
      return;
    }
    lastTap = { t: now, x, y };
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { lastTap = null; h.tap?.(x, y); }, 300);
  }
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    // a trackpad pinch arrives as a wheel with ctrl held
    h.wheel?.(dy, e.ctrlKey || e.metaKey);
  }, { passive: false });
  el.addEventListener('dblclick', (e) => e.preventDefault());
}
