type ScrollFrame = { enabled: boolean; measure: boolean; initial: boolean };

// Event-driven, one pending frame per visible region. No continuous animation loop.
// Geometry is measured on resize/layout changes; scrolling only supplies scrollY.
export function observeScrollRegion(
  region: HTMLElement,
  mediaQuery: string,
  update: (frame: ScrollFrame) => void,
) {
  const media = matchMedia(mediaQuery);
  let frame = 0, disposed = false, dirty = true, listening = false;
  const rect = region.getBoundingClientRect();
  let visible = rect.bottom > 0 && rect.top < innerHeight;

  function flush(initial = false) {
    frame = 0;
    if (disposed || document.hidden) return;
    const measure = dirty;
    dirty = false;
    update({ enabled: media.matches, measure, initial });
  }
  function schedule() {
    if (!disposed && !document.hidden && !frame) frame = requestAnimationFrame(() => flush());
  }
  function sync() {
    const next = media.matches && visible && !document.hidden;
    if (next !== listening) {
      listening = next;
      if (next) window.addEventListener("scroll", schedule, { passive: true });
      else {
        window.removeEventListener("scroll", schedule);
        cancelAnimationFrame(frame);
        frame = 0;
      }
    }
    region.dataset.scrollListening = String(next);
    schedule();
  }
  function measure() { dirty = true; sync(); }
  const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
  const resize = new ResizeObserver(measure);
  observer.observe(region);
  resize.observe(region);
  media.addEventListener("change", measure);
  window.addEventListener("resize", measure, { passive: true });
  window.addEventListener("hashchange", measure);
  window.addEventListener("popstate", measure);
  window.addEventListener("pageshow", measure);
  document.addEventListener("visibilitychange", measure);
  void document.fonts.ready.then(() => { if (!disposed) measure(); });
  // Layout effect callers initialize the correct panel before hydration's next paint.
  flush(true);
  sync();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    resize.disconnect();
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", measure);
    window.removeEventListener("hashchange", measure);
    window.removeEventListener("popstate", measure);
    window.removeEventListener("pageshow", measure);
    document.removeEventListener("visibilitychange", measure);
    media.removeEventListener("change", measure);
    delete region.dataset.scrollListening;
  };
}
