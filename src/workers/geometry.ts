import type { Corners, Point } from "./protocol";

export const fullFrame: Corners = [
  { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
];

export function isConvex(points: Corners) {
  return points.every((point, i) => {
    const next = points[(i + 1) % 4];
    const end = points[(i + 2) % 4];
    return (next.x - point.x) * (end.y - next.y) -
      (next.y - point.y) * (end.x - next.x) > 0.0001;
  });
}

export function orderCorners(points: Corners): Corners {
  const center = points.reduce(
    (sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }),
    { x: 0, y: 0 },
  );
  const angle = (point: Point) => Math.atan2(point.y - center.y, point.x - center.x);
  const ordered = points.slice().sort((a, b) => angle(a) - angle(b));
  const first = ordered.reduce((best, point, i) =>
    point.x + point.y < ordered[best].x + ordered[best].y ? i : best, 0);
  return [...ordered.slice(first), ...ordered.slice(0, first)] as Corners;
}
