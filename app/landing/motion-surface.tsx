"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./landing.module.css";

type MotionKind = "organization" | "dashboard" | "companies" | "campaigns" | "followups" | "resources";

// Children remain server-rendered. This boundary observes visibility, not scroll progress.
export function MotionSurface({ children, kind }: { children: ReactNode; kind: MotionKind }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const compact = matchMedia("(max-width: 800px)");
    let visible = false, seen = false;
    let animations: Animation[] = [];
    function stop() { animations.forEach(animation => animation.cancel()); animations = []; }
    function sync() {
      element!.dataset.ambient = visible && !document.hidden && !reduced.matches && !compact.matches ? "running" : "paused";
      if (reduced.matches) stop();
      else if (document.hidden || !visible) animations.forEach(animation => animation.pause());
      else animations.forEach(animation => animation.play());
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !seen) {
        seen = true;
        if (!reduced.matches && typeof element.animate === "function") {
          const transforms: Record<MotionKind, string> = {
            organization: "translateY(16px)", dashboard: "perspective(1400px) translateY(24px) rotateX(3deg)",
            companies: "translateY(12px) scale(.98)", campaigns: "translateX(-20px)",
            followups: "translateY(20px)", resources: "translateY(14px)",
          };
          // Never hide content while waiting for JS or an observer callback.
          animations.push(element.animate([{ opacity: 0.7, transform: compact.matches ? "translateY(10px)" : transforms[kind] }, { opacity: 1, transform: "none" }], { duration: 850, easing: "cubic-bezier(.2,.7,.2,1)" }));
          if (kind === "followups" || kind === "resources") {
            const items = element.querySelectorAll(kind === "followups" ? "li" : "article");
            items.forEach((item, i) => animations.push(item.animate([{ opacity: 0.65, translate: "0 8px" }, { opacity: 1, translate: "0 0" }], { duration: 600, delay: i * 75, easing: "ease-out" })));
          }
        }
      }
      sync();
    }, { threshold: 0.12 });
    observer.observe(element);
    reduced.addEventListener("change", sync);
    compact.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      stop();
      observer.disconnect();
      reduced.removeEventListener("change", sync);
      compact.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      delete element.dataset.ambient;
    };
  }, [kind]);
  return <div ref={root} className={styles.motionSurface} data-motion={kind} data-ambient="paused">{children}</div>;
}
