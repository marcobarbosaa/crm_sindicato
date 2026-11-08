"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { observeScrollRegion } from "./scroll-region";
import { clampProgress, panelWeight, storyPosition } from "./scroll-math";
import styles from "./landing.module.css";

export function ProductStoryMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const candidate = root.current;
    if (!candidate) return;
    const element: HTMLDivElement = candidate;
    const copies = [...element.querySelectorAll<HTMLElement>("[data-story-copy]")];
    const panels = [...element.querySelectorAll<HTMLElement>("[data-story-panel]")];
    const links = [...element.querySelectorAll<HTMLAnchorElement>("[data-story-link]")];
    let starts: number[] = [], heights: number[] = [], active = -1, previousMode = "";
    function resetPanels() {
      panels.forEach(panel => {
        panel.inert = false;
        panel.removeAttribute("aria-hidden");
        panel.removeAttribute("data-visible");
        panel.removeAttribute("style");
      });
      links.forEach(link => link.removeAttribute("aria-current"));
      copies.forEach(copy => copy.removeAttribute("data-active"));
      element.style.removeProperty("--campaign-atmosphere");
      delete element.dataset.activeChapter;
      active = -1;
    }
    const stop = observeScrollRegion(element, "(min-width: 1200px) and (min-height: 800px) and (prefers-reduced-motion: no-preference)", ({ enabled, measure, initial }) => {
      // A read phase precedes every write. Copies keep identical row sizes with or
      // without enhancement, so making panels sticky never moves the anchors.
      if (measure || !starts.length) {
        const bounds = copies.map(copy => copy.getBoundingClientRect());
        starts = bounds.map(bound => bound.top + scrollY);
        heights = bounds.map(bound => bound.height);
      }
      if (!enabled) {
        if (previousMode !== "static") {
          resetPanels();
          element.dataset.storyMode = "static";
          previousMode = "static";
        }
        return;
      }
      const focus = scrollY + 220;
      let position = storyPosition(starts, focus);
      const hashIndex = copies.findIndex(copy => "#" + copy.id === location.hash);
      // Native fragment scrolling can happen just after hydration. Do not flash
      // Dashboard when the URL already requests another chapter.
      if (initial && hashIndex >= 0) position = hashIndex;
      const next = Math.min(3, Math.round(position));
      panels.forEach((panel, i) => {
        const weight = panelWeight(position, i);
        const distance = Math.max(-1, Math.min(1, i - position));
        const local = clampProgress((focus - starts[i]) / Math.max(1, heights[i] * 0.55));
        panel.style.setProperty("--panel-weight", weight.toFixed(4));
        // Opaque reveal avoids superimposed, unreadable text if the user stops
        // midway. The previous panel recedes underneath the incoming surface.
        panel.style.setProperty("--panel-reveal", (distance > 0 ? (1 - weight) * 100 : 0).toFixed(3) + "%");
        panel.style.setProperty("--panel-x", (distance * 24).toFixed(2) + "px");
        panel.style.setProperty("--panel-y", (Math.abs(distance) * 16).toFixed(2) + "px");
        panel.style.setProperty("--panel-scale", (0.96 + weight * 0.04).toFixed(4));
        panel.style.setProperty("--chapter-progress", local.toFixed(4));
        panel.dataset.visible = String(weight > 0.001);
        // Visual crossfades can show two panels; assistive technology gets one.
        if (next !== active || previousMode !== "sticky") {
          panel.inert = i !== next;
          panel.setAttribute("aria-hidden", String(i !== next));
        }
      });
      if (next !== active || previousMode !== "sticky") {
        links.forEach((link, i) => {
          if (i === next) link.setAttribute("aria-current", "step");
          else link.removeAttribute("aria-current");
        });
        copies.forEach((copy, i) => { copy.dataset.active = String(i === next); });
        element.dataset.activeChapter = copies[next].id;
        active = next;
      }
      element.style.setProperty("--campaign-atmosphere", panelWeight(position, 2).toFixed(4));
      // Last write: all panel states are ready before the CSS stacks them.
      element.dataset.storyMode = "sticky";
      previousMode = "sticky";
    });
    return () => { stop(); resetPanels(); delete element.dataset.storyMode; };
  }, []);
  return <div ref={root} className={styles.productStory} data-product-story="" role="region" aria-label="Demonstração dos recursos da Conecta Core">{children}</div>;
}
