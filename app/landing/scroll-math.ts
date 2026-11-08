export const clampProgress = (value: number) => Math.max(0, Math.min(1, value));

// Each boundary blends over 140px BEFORE the incoming copy reaches the reading line.
// This has no time component: reverse scrolling yields exactly the same composition.
export function storyPosition(starts: number[], focus: number, blend = 140) {
  let position = 0;
  for (let i = 1; i < starts.length; i++) {
    position += clampProgress((focus - starts[i] + blend) / blend);
  }
  return position;
}

export function panelWeight(position: number, index: number) {
  return Math.max(0, 1 - Math.abs(position - index));
}
