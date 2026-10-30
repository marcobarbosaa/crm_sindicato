import { BrandGeometry } from "../brand";
import { BrandSceneClient } from "./brand-scene-client";

// The official SVG is server-rendered; WebGL is only a progressive enhancement.
export function BrandScene() {
  return <BrandSceneClient><BrandGeometry /></BrandSceneClient>;
}
