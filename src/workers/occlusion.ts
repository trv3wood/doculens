import type { Corners, Point } from "./protocol";
import { isConvex, orderCorners } from "./geometry";

interface Line {
  nx: number;
  ny: number;
  rho: number;
  votes: number;
}

// In a smoothed colour plane, separated pieces of the same material boundary
// vote for the same normal and distance even when a cable crosses the page.
function visibleLines(plane: Uint8Array, w: number, h: number): Line[] {
  const angles = 90;
  const radius = Math.ceil(Math.hypot(w, h));
  const stride = 2 * radius + 1;
  const votes = new Uint32Array(angles * stride);
  const normals = Array.from({ length: angles }, (_, i) => ({
    nx: Math.cos(i * Math.PI / angles), ny: Math.sin(i * Math.PI / angles),
  }));
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      const dx = plane[i + 2] - plane[i - 2];
      const dy = plane[i + 2 * w] - plane[i - 2 * w];
      if (dx * dx + dy * dy < 36) continue;
      const normal = Math.round(Math.atan2(dy, dx) * angles / Math.PI);
      for (let k = -5; k <= 5; k++) {
        const a = (normal + k + 2 * angles) % angles;
        const { nx, ny } = normals[a];
        votes[a * stride + radius + Math.round(nx * x + ny * y)]++;
      }
    }
  }
  const peaks: Line[] = [];
  for (let a = 0; a < angles; a++) {
    for (let r = 1; r < stride - 1; r++) {
      const i = a * stride + r;
      if (votes[i] >= 12 && votes[i] >= votes[i - 1] && votes[i] > votes[i + 1]) {
        peaks.push({ ...normals[a], rho: r - radius, votes: votes[i] });
      }
    }
  }
  peaks.sort((a, b) => b.votes - a.votes);
  const lines: Line[] = [];
  for (const p of peaks) {
    if (lines.some(q => {
      const dot = p.nx * q.nx + p.ny * q.ny;
      return Math.abs(dot) > 0.994 && Math.abs(p.rho - Math.sign(dot) * q.rho
        - (p.nx - Math.sign(dot) * q.nx) * w / 2 - (p.ny - Math.sign(dot) * q.ny) * h / 2) < 5;
    })) continue;
    lines.push(p);
    if (lines.length === 60) break;
  }
  return lines;
}

function intersection(a: Line, b: Line): Point {
  const det = a.nx * b.ny - a.ny * b.nx;
  return { x: (a.rho * b.ny - a.ny * b.rho) / det, y: (a.nx * b.rho - a.rho * b.nx) / det };
}

// Require the colour step to persist on separated portions of every side.
// An isolated pen, a line of print, or one visible corner is insufficient.
function supportedSide(a: Point, b: Point, plane: Uint8Array, w: number, sign: number) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len, ny = dx / len;
  let hits = 0, first = 24, last = -1;
  for (let i = 0; i < 24; i++) {
    const t = (i + 0.5) / 24;
    const x = a.x + dx * t, y = a.y + dy * t;
    const read = (d: number) => plane[Math.round(y + d * ny) * w + Math.round(x + d * nx)];
    if (sign * (read(3) - read(-3)) < 7 || sign * (read(8) - read(-8)) < 14) continue;
    hits++;
    first = Math.min(first, i);
    last = i;
  }
  return last - first >= 14 && hits >= 12 ? hits : 0;
}

// Verify that the edge segments surround one light paper surface. In a busy
// scene the cover of another object can have four equally strong boundaries.
function paperInterior(q: Corners, luminance: Uint8Array, w: number) {
  const values: number[] = [];
  for (let row = 1; row <= 7; row++) {
    const v = row / 8;
    for (let col = 1; col <= 7; col++) {
      const u = col / 8;
      const weights = [(1 - u) * (1 - v), u * (1 - v), u * v, (1 - u) * v];
      const x = Math.round(q.reduce((s, p, i) => s + p.x * weights[i], 0));
      const y = Math.round(q.reduce((s, p, i) => s + p.y * weights[i], 0));
      values.push(luminance[y * w + x]);
    }
  }
  values.sort((a, b) => a - b);
  return values[24] >= 115 && values[36] - values[12] < 52;
}

export function recoverOccluded(plane: Uint8Array, luminance: Uint8Array, w: number, h: number): Corners | undefined {
  if (Math.min(w, h) < 40) return;
  const lines = visibleLines(plane, w, h);
  const pairs: [Line, Line][] = [];
  for (const [i, a] of lines.entries()) {
    for (const b of lines.slice(i + 1)) {
      const dot = a.nx * b.nx + a.ny * b.ny;
      if (Math.abs(dot) < 0.90) continue;
      const gap = Math.abs((a.rho - a.nx * w / 2 - a.ny * h / 2) - Math.sign(dot) * (b.rho - b.nx * w / 2 - b.ny * h / 2));
      if (gap > 0.14 * Math.min(w, h) && gap < 0.85 * Math.max(w, h)) pairs.push([a, b]);
    }
  }
  const candidates: { q: Corners; score: number }[] = [];
  for (let i = 0; i < pairs.length; i++) {
    const [a, b] = pairs[i];
    for (let j = i + 1; j < pairs.length; j++) {
      const [c, d] = pairs[j];
      if (Math.abs(a.nx * c.nx + a.ny * c.ny) > 0.42) continue;
      const vertices: Corners = [intersection(a, c), intersection(a, d), intersection(b, d), intersection(b, c)];
      if (vertices.some(p => p.x < 9 || p.x > w - 10 || p.y < 9 || p.y > h - 10)) continue;
      const area = Math.abs(vertices.reduce((sum, p, k) => {
        const next = vertices[(k + 1) % 4];
        return sum + p.x * next.y - p.y * next.x;
      }, 0)) / 2;
      const e0 = Math.hypot(vertices[1].x - vertices[0].x, vertices[1].y - vertices[0].y);
      const e1 = Math.hypot(vertices[2].x - vertices[1].x, vertices[2].y - vertices[1].y);
      if (Math.max(e0 / e1, e1 / e0) > 2.4) continue;
      if (area < 0.05 * w * h || area > 0.85 * w * h) continue;
      const q = orderCorners(vertices);
      if (!isConvex(q)) continue;
      for (const sign of [-1, 1]) {
        let score = 0;
        for (let k = 0; k < 4; k++) {
          const hits = supportedSide(q[k], q[(k + 1) % 4], plane, w, sign);
          if (!hits) {
            score = 0;
            break;
          }
          score += hits;
        }
        if (score >= 76 && paperInterior(q, luminance, w)) candidates.push({ q, score });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return;
  if (candidates.some(({ q, score }) => score >= best.score - 4 &&
    !q.some((_, offset) => q.every((p, i) => {
      const other = best.q[(i + offset) % 4];
      return Math.hypot(p.x - other.x, p.y - other.y) <= 0.05 * Math.min(w, h);
    })))) return;
  return best.q.map(p => ({ x: p.x / (w - 1), y: p.y / (h - 1) })) as Corners;
}
