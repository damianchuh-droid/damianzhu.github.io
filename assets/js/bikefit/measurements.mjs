export const landmarksBySide = {
  left: { ear: 7, shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 },
  right: { ear: 8, shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32 },
};

export const segments = [
  ["ear", "shoulder"], ["shoulder", "elbow"], ["elbow", "wrist"],
  ["shoulder", "hip"], ["hip", "knee"], ["knee", "ankle"],
  ["ankle", "toe"],
];

export const jointPoints = {
  hip: ["shoulder", "hip", "knee"],
  knee: ["hip", "knee", "ankle"],
  ankle: ["knee", "ankle", "toe"],
  shoulder: ["hip", "shoulder", "elbow"],
  elbow: ["shoulder", "elbow", "wrist"],
};

export function angleDegrees(a, vertex, c) {
  if (!a || !vertex || !c) return null;
  const ax = a.x - vertex.x;
  const ay = a.y - vertex.y;
  const cx = c.x - vertex.x;
  const cy = c.y - vertex.y;
  const magnitude = Math.hypot(ax, ay) * Math.hypot(cx, cy);
  if (magnitude < 1e-6 || !Number.isFinite(magnitude)) return null;
  const cosine = (ax * cx + ay * cy) / magnitude;
  return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
}

export function trackSide(landmarks, side, width, height, previous, alpha, confidence = .65) {
  const points = {};
  for (const [name, index] of Object.entries(landmarksBySide[side])) {
    const point = landmarks?.[index];
    if (!point || (point.visibility ?? 0) < confidence ||
      (point.presence ?? 1) < confidence ||
      !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
      point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) continue;

    // Correct for the source aspect ratio before calculating the dot product.
    const x = point.x * width;
    const y = point.y * height;
    points[name] = { x, y };
  }
  return smoothSide(points, previous, alpha);
}

export function measureAngles(points) {
  return Object.fromEntries(Object.entries(jointPoints).map(([joint, [a, b, c]]) =>
    [joint, angleDegrees(points[a], points[b], points[c])]));
}

const legPoints = ["knee", "ankle", "heel", "toe"];

export function likelyLegSwap(current, other, previous, previousOther, minSeparation) {
  let directDistance = 0;
  let crossedDistance = 0;
  let comparisons = 0;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  for (const joint of ["knee", "ankle"]) {
    const a = current[joint];
    const b = other[joint];
    const lastA = previous[joint];
    const lastB = previousOther[joint];
    if (!a || !b || !lastA || !lastB || distance(lastA, lastB) < minSeparation) continue;
    directDistance += distance(a, lastA) + distance(b, lastB);
    crossedDistance += distance(a, lastB) + distance(b, lastA);
    comparisons++;
  }
  return comparisons === 2 && crossedDistance < directDistance * .55;
}

export function smoothSide(current, previous, alpha, rejectLeg = false) {
  return Object.fromEntries(Object.entries(current).flatMap(([joint, point]) => {
    if (rejectLeg && legPoints.includes(joint)) return [];
    const prior = previous[joint];
    if (!prior) return [[joint, point]];
    return [[joint, {
      x: prior.x + alpha * (point.x - prior.x),
      y: prior.y + alpha * (point.y - prior.y),
    }]];
  }));
}

export class FootLength {
  constructor() {
    this.reset();
  }

  reset() {
    this.samples = [];
    this.length = null;
  }

  observe(points) {
    if (this.length !== null || !points.ankle || !points.heel || !points.toe) return;
    const ankleHeel = {
      x: (points.ankle.x + points.heel.x) / 2,
      y: (points.ankle.y + points.heel.y) / 2,
    };
    const length = Math.hypot(ankleHeel.x - points.toe.x, ankleHeel.y - points.toe.y);
    if (length < 2) return;
    this.samples.push(length);
    if (this.samples.length === 15) {
      this.length = [...this.samples].sort((a, b) => a - b)[7];
    }
  }

  combine(points) {
    const { ankle, heel, toe, ...others } = points;
    const merged = ankle && heel ? { x: (ankle.x + heel.x) / 2, y: (ankle.y + heel.y) / 2 } : ankle ?? heel;
    if (merged && toe && this.length !== null) {
      const dx = merged.x - toe.x;
      const dy = merged.y - toe.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 1e-6) {
        return { ...others, toe, ankle: { x: toe.x + dx * this.length / distance, y: toe.y + dy * this.length / distance } };
      }
    }
    return { ...others, ...(toe && { toe }), ...(merged && { ankle: merged }) };
  }
}

export function toeOrbitError(toe, orbit) {
  if (!toe) return Infinity;
  return Math.abs(Math.hypot(toe.x - orbit.x, toe.y - orbit.y) - orbit.radius);
}
