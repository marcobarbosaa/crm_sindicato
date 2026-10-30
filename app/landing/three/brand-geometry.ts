import { ExtrudeGeometry, Shape, Vector2 } from "three";

// Exact centerline coordinates from public/branding/conecta-core-simbolo.svg,
// viewBox 0 0 200 200, stroke-width 30, round caps and round joins.
// Keep these in sync with the official SVG; the geometry test verifies them.
export const BRAND_PATHS = [
  [[112, 29], [70, 53], [42, 80], [42, 128], [70, 154], [101, 135]],
  [[88, 98], [121, 77], [155, 104], [155, 153], [112, 180]],
] as const;

function leftContour(points: Vector2[], radius: number) {
  const result: Vector2[] = [];
  const directions = points.slice(1).map((p, i) => p.clone().sub(points[i]).normalize());
  const normals = directions.map(d => new Vector2(-d.y, d.x));
  result.push(points[0].clone().addScaledVector(normals[0], radius));
  for (let i = 1; i < points.length - 1; i++) {
    const previous = normals[i - 1], next = normals[i];
    const turn = directions[i - 1].cross(directions[i]);
    if (turn < 0) {
      // Outer round join, sampled at <= 7.5 degrees.
      const angle = Math.atan2(previous.y, previous.x);
      const sweep = Math.atan2(previous.cross(next), previous.dot(next));
      const segments = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 24)));
      for (let n = 0; n <= segments; n++) {
        const a = angle + sweep * n / segments;
        result.push(points[i].clone().add(new Vector2(Math.cos(a), Math.sin(a)).multiplyScalar(radius)));
      }
    } else {
      // Intersect the inner offsets instead of overlapping cylinders/boxes.
      result.push(points[i].clone().add(previous.clone().add(next).multiplyScalar(radius / (1 + previous.dot(next)))));
    }
  }
  result.push(points.at(-1)!.clone().addScaledVector(normals.at(-1)!, radius));
  return result;
}

export function createBrandGeometry(coordinates: readonly (readonly [number, number])[]) {
  // 14 + 1 bevel = the official 15-unit stroke radius.
  const radius = 14;
  const points = coordinates.map(([x, y]) => new Vector2(x, y));
  const left = leftContour(points, radius);
  const right = leftContour([...points].reverse(), radius);
  const contour = [...left];
  function cap(center: Vector2, start: Vector2) {
    const angle = Math.atan2(start.y - center.y, start.x - center.x);
    for (let i = 1; i <= 24; i++) {
      const a = angle - Math.PI * i / 24;
      contour.push(center.clone().add(new Vector2(Math.cos(a), Math.sin(a)).multiplyScalar(radius)));
    }
  }
  cap(points.at(-1)!, left.at(-1)!);
  contour.push(...right);
  cap(points[0], right.at(-1)!);
  // SVG y increases downwards; the model is centered on the original viewBox.
  const shape = new Shape(contour.map(p => new Vector2(p.x - 100, 100 - p.y)));
  const geometry = new ExtrudeGeometry(shape, { depth: 19, steps: 1, bevelEnabled: true, bevelSize: 1, bevelThickness: 1.8, bevelSegments: 3, curveSegments: 8 });
  geometry.translate(0, 0, -9.5);
  geometry.computeBoundingBox();
  return geometry;
}
