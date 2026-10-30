"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { BrandSceneHandle } from "./brand-scene-runtime";
import styles from "../landing.module.css";

type DeviceNavigator = Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };

export function BrandSceneClient({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = root.current;
    const mount = surface.current;
    if (!host || !mount) return;
    const desktop = matchMedia("(min-width: 1024px) and (pointer: fine)");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const device = navigator as DeviceNavigator;
    const capable = !(device.connection?.saveData || (device.deviceMemory && device.deviceMemory < 4) || (device.hardwareConcurrency && device.hardwareConcurrency < 4));
    let disposed = false, visible = false, pending = false;
    let idle: number | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    let generation = 0, scene: BrandSceneHandle | undefined;
    const allowed = () => desktop.matches && !reduced.matches && capable;

    function cancelPending() {
      if (idle !== undefined) window.cancelIdleCallback(idle);
      if (timer !== undefined) clearTimeout(timer);
      idle = undefined;
      timer = undefined;
      pending = false;
    }
    function reset() {
      generation++;
      cancelPending();
      scene?.dispose();
      scene = undefined;
      host!.dataset.state = "fallback";
    }
    async function load() {
      pending = false;
      if (disposed || !allowed() || !visible || document.hidden || scene) return;
      const current = ++generation;
      host!.dataset.state = "loading";
      try {
        // No Three.js import is reachable from the workspace or the server render.
        const { createBrandScene } = await import("./brand-scene-runtime");
        if (disposed || current !== generation || !allowed() || !visible || document.hidden) {
          if (!disposed && current === generation) host!.dataset.state = "fallback";
          return;
        }
        scene = createBrandScene(mount!, host!, () => { host!.dataset.state = "unavailable"; });
        host!.dataset.state = "ready";
        scene.setActive(visible && !document.hidden);
      } catch {
        if (!disposed && current === generation) host!.dataset.state = "unavailable";
      }
    }
    function sync() {
      if (disposed) return;
      if (!allowed()) { reset(); return; }
      scene?.setActive(visible && !document.hidden);
      if (!visible || document.hidden) { cancelPending(); return; }
      if (scene || pending || host!.dataset.state === "unavailable" || host!.dataset.state === "loading") return;
      pending = true;
      // Let HTML, typography and the SVG paint before importing the renderer.
      if ("requestIdleCallback" in window) idle = window.requestIdleCallback(() => void load(), { timeout: 1800 });
      else timer = setTimeout(() => void load(), 350);
    }
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }, { threshold: 0.05 });
    observer.observe(host);
    desktop.addEventListener("change", sync);
    reduced.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      disposed = true;
      reset();
      observer.disconnect();
      desktop.removeEventListener("change", sync);
      reduced.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return <div ref={root} className={styles.brandScene} data-brand-scene="" data-state="fallback" aria-hidden="true">
    <div className={styles.sceneFallback}>{children}</div>
    <div ref={surface} className={styles.sceneSurface} />
  </div>;
}
