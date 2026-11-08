"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { observeScrollRegion } from "./scroll-region";
import { clampProgress } from "./scroll-math";
import styles from "./landing.module.css";

export function ScrollScene({ kind, children }: { kind: "hero" | "organization"; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = root.current;
    const section = element?.closest("section");
    if (!element || !section) return;
    let top = 0, height = 0;
    const stop = observeScrollRegion(section, "(min-width: 1024px) and (min-height: 700px) and (prefers-reduced-motion: no-preference)", ({ enabled, measure }) => {
      if (measure) {
        const bounds = section.getBoundingClientRect();
        top = bounds.top + scrollY;
        height = bounds.height;
      }
      const progress = !enabled ? (kind === "hero" ? 0 : 1)
        : kind === "hero" ? clampProgress((scrollY - top) / Math.max(1, height * 0.75))
        : clampProgress((scrollY + innerHeight * 0.85 - top) / Math.max(1, height * 0.8));
      element.style.setProperty("--scene-progress", progress.toFixed(4));
    });
    return () => { stop(); element.style.removeProperty("--scene-progress"); };
  }, [kind]);

  return <div ref={root} data-scroll-scene={kind} className={kind === "hero" ? styles.heroScroll : styles.organizationScroll}>{children}</div>;
}
