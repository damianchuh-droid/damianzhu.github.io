export const wheelDiameterMm = 678;

const patchRadius = 5;
const searchRadius = 7;
const patchSize = (patchRadius * 2 + 1) ** 2;

function patch(frame, x, y) {
  if (x < patchRadius || y < patchRadius ||
      x + patchRadius >= frame.width || y + patchRadius >= frame.height) return null;
  const values = [];
  let sum = 0;
  for (let row = y - patchRadius; row <= y + patchRadius; row++) {
    for (let col = x - patchRadius; col <= x + patchRadius; col++) {
      const color = (row * frame.width + col) * 4;
      const value = (frame.data[color] * 2 + frame.data[color + 1] * 5 + frame.data[color + 2]) / 8;
      values.push(value);
      sum += value;
    }
  }
  const mean = sum / patchSize;
  const centered = values.map(value => value - mean);
  const norm = Math.hypot(...centered);
  if (norm < 40) return null;
  return { centered, norm };
}

export function matchHub(frame, template, center) {
  let best = { score: -Infinity };
  for (let dy = -searchRadius; dy <= searchRadius; dy++) {
    for (let dx = -searchRadius; dx <= searchRadius; dx++) {
      const x = Math.round(center.x) + dx;
      const y = Math.round(center.y) + dy;
      const candidate = patch(frame, x, y);
      if (!candidate) continue;
      let product = 0;
      for (let i = 0; i < patchSize; i++) product += candidate.centered[i] * template.centered[i];
      const correlation = product / (candidate.norm * template.norm);
      const score = correlation - .002 * Math.hypot(dx, dy);
      if (score > best.score) best = { x, y, score, correlation };
    }
  }
  return best.correlation >= .82 ? best : null;
}

export function wheelTransform(original, matches) {
  if (matches.some(match => !match)) return null;
  const [left, right] = original;
  const [a, b] = matches;
  const dx = right.x - left.x, dy = right.y - left.y;
  const nextX = b.x - a.x, nextY = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return null;
  const u = (dx * nextX + dy * nextY) / lengthSquared;
  const v = (dx * nextY - dy * nextX) / lengthSquared;
  const scale = Math.hypot(u, v);
  if (scale < .88 || scale > 1.12 || Math.abs(Math.atan2(v, u)) > .14) return null;
  return { u, v, scale, x: a.x - u * left.x + v * left.y, y: a.y - v * left.x - u * left.y };
}

export class WheelReference {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.context = this.canvas.getContext("2d", { willReadFrequently: true });
    this.reset();
  }

  reset() {
    this.hubs = null;
    this.radius = 0;
    this.transform = { u: 1, v: 0, scale: 1, x: 0, y: 0 };
    this.crank = null;
    this.crankLocked = false;
    this.locked = false;
  }

  capture(video) {
    const width = Math.min(320, video.videoWidth);
    const height = Math.round(video.videoHeight * width / video.videoWidth);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.context.drawImage(video, 0, 0, width, height);
    return this.context.getImageData(0, 0, width, height);
  }

  calibrate(video, [crank, rear, front, edge]) {
    const radius = Math.hypot(edge.x - rear.x, edge.y - rear.y);
    if (radius < video.videoHeight * .05 || Math.hypot(front.x - rear.x, front.y - rear.y) < 2 * radius) return false;
    const frame = this.capture(video);
    const scale = frame.width / video.videoWidth;
    const hubs = [rear, front].map(point => {
      const x = Math.round(point.x * scale), y = Math.round(point.y * scale);
      return { x, y, point, template: patch(frame, x, y) };
    });
    if (hubs.some(hub => !hub.template)) return false;
    const crankTemplate = patch(frame, Math.round(crank.x * scale), Math.round(crank.y * scale));
    this.hubs = hubs;
    this.radius = radius;
    this.transform = { u: 1, v: 0, scale: 1, x: 0, y: 0 };
    this.crank = { point: crank, template: crankTemplate };
    this.crankLocked = Boolean(crankTemplate);
    this.locked = true;
    return true;
  }

  toImage(point, transform = this.transform) {
    const { u, v, x, y } = transform;
    return { x: u * point.x - v * point.y + x, y: v * point.x + u * point.y + y };
  }

  toBike(point) {
    const { u, v, x, y, scale } = this.transform;
    const dx = point.x - x, dy = point.y - y;
    return { x: (u * dx + v * dy) / scale ** 2, y: (-v * dx + u * dy) / scale ** 2 };
  }

  update(video) {
    if (!this.hubs) return;
    const frame = this.capture(video);
    const scale = frame.width / video.videoWidth;
    const matches = this.hubs.map(hub => {
      const expected = this.toImage(hub.point);
      const match = matchHub(frame, hub.template, { x: expected.x * scale, y: expected.y * scale });
      return match && {
        x: hub.point.x + (match.x - hub.x) / scale,
        y: hub.point.y + (match.y - hub.y) / scale,
      };
    });
    const transform = wheelTransform(this.hubs.map(hub => hub.point), matches);
    this.locked = Boolean(transform);
    this.crankLocked = false;
    if (!transform) return;
    if (this.crank?.template) {
      const expected = this.toImage(this.crank.point, transform);
      const match = matchHub(frame, this.crank.template, { x: expected.x * scale, y: expected.y * scale });
      if (match) {
        const dx = match.x / scale - expected.x, dy = match.y / scale - expected.y;
        const tolerance = Math.max(2 / scale, this.radius * .045);
        if (Math.hypot(dx, dy) <= tolerance) {
          transform.x += dx * .25;
          transform.y += dy * .25;
          this.crankLocked = true;
        }
      }
    }
    this.transform = transform;
  }

  get pixelsPerMm() {
    return this.hubs ? 2 * this.radius / wheelDiameterMm : null;
  }
}
