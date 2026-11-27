const footJoints = ["ankle", "heel", "toe"];
const turn = 2 * Math.PI;
export const crankLengthMm = 170;
const predictionLimitMs = 140;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const wrapAngle = radians => Math.atan2(Math.sin(radians), Math.cos(radians));

const minCadenceSpeed = 70 * turn / 60;
const maxCadenceSpeed = 90 * turn / 60;

function maxPedalTravel(radius, elapsed) {
  const angle = Math.min(Math.PI, maxCadenceSpeed * elapsed);
  return 2 * radius * Math.sin(angle / 2);
}

function leastSquaresCircle(samples) {
  const mean = samples.reduce((center, point) => ({
    x: center.x + point.x / samples.length,
    y: center.y + point.y / samples.length,
  }), { x: 0, y: 0 });
  let xx = 0, xy = 0, yy = 0, xq = 0, yq = 0;
  for (const point of samples) {
    const x = point.x - mean.x;
    const y = point.y - mean.y;
    const q = x * x + y * y;
    xx += x * x;
    xy += x * y;
    yy += y * y;
    xq += x * q;
    yq += y * q;
  }
  const determinant = xx * yy - xy * xy;
  if (determinant <= (xx + yy) ** 2 * .01) return null;
  const center = {
    x: mean.x + (xq * yy - yq * xy) / (2 * determinant),
    y: mean.y + (yq * xx - xq * xy) / (2 * determinant),
  };
  return { ...center, radius: samples.reduce((sum, point) => sum + distance(point, center), 0) / samples.length };
}

export function fitPedalCircle(samples, frameHeight, pixelsPerMm) {
  if (samples.length < 16) return null;
  const initial = leastSquaresCircle(samples);
  if (!initial) return null;
  const inliers = samples.filter(point => Math.abs(distance(point, initial) - initial.radius) < initial.radius * .22);
  if (inliers.length < samples.length * .75) return null;

  const circle = leastSquaresCircle(inliers);
  const minimumRadius = pixelsPerMm ? 105 * pixelsPerMm : frameHeight * .035;
  const maximumRadius = pixelsPerMm ? 235 * pixelsPerMm : frameHeight * .28;
  if (!circle || circle.radius < minimumRadius || circle.radius > maximumRadius) return null;
  const sectors = new Set();
  let meanError = 0;
  for (const point of inliers) {
    const angle = Math.atan2(point.y - circle.y, point.x - circle.x);
    sectors.add(Math.floor((angle + Math.PI) / turn * 8) % 8);
    meanError += Math.abs(distance(point, circle) - circle.radius) / inliers.length;
  }
  if (sectors.size < 7 || meanError > circle.radius * .12) return null;
  return circle;
}

export class CyclingMotion {
  constructor() {
    this.reset();
  }

  reset({ keepCircle = false } = {}) {
    if (!keepCircle) {
      this.samples = [];
      this.circle = null;
      this.lastFit = -Infinity;
      this.direction = null;
    }
    this.lastFoot = null;
    this.footOffsets = {};
    this.angularSpeed = null;
    this.anchors = {};
  }

  next(points, timestamp, frameHeight, { sequential, rejectLeg, pixelsPerMm, crankCenter }) {
    const observed = { ...points };
    const estimated = new Set();
    const fixedCrank = Boolean(crankCenter && pixelsPerMm);
    if (fixedCrank) this.circle = { ...crankCenter, radius: crankLengthMm * pixelsPerMm };
    if (sequential) this.stabilizeAnchors(observed, timestamp, frameHeight);
    if (rejectLeg) {
      delete observed.knee;
      for (const joint of footJoints) delete observed[joint];
    }
    let predicted = sequential ? this.predictPedal(timestamp) : null;
    if (sequential && this.circle && this.lastFoot && observed.toe) {
      const age = (timestamp - this.lastFoot.timestamp) / 1000;
      const radius = this.circle.radius;
      const offPath = Math.abs(distance(observed.toe, this.circle) - radius) > radius * .35;
      const tooFar = age >= 0 && age <= .25 &&
        distance(observed.toe, this.lastFoot.point) > maxPedalTravel(radius, age) + radius * .18;
      const outsidePrediction = predicted && distance(observed.toe, predicted) > radius * (.22 + age * 1.2);
      if (offPath || tooFar || outsidePrediction) {
        if (age > .9 && !fixedCrank) {
          this.reset();
          predicted = null;
        } else {
          delete observed.toe;
        }
      }
    }

    const toe = observed.toe ?? predicted;
    if (sequential && toe && this.circle) {
      for (const joint of ["ankle", "heel"]) {
        const prior = this.footOffsets[joint];
        if (!observed[joint] || !prior) continue;
        const age = (timestamp - prior.timestamp) / 1000;
        if (age < 0 || age > .25) continue;
        const expected = { x: toe.x + prior.x, y: toe.y + prior.y };
        const radius = this.circle.radius;
        const tooFar = distance(observed[joint], prior.point) > maxPedalTravel(radius, age) + radius * .36;
        if (tooFar || distance(observed[joint], expected) > radius * (.27 + age * 1.2)) delete observed[joint];
      }
    }
    if (observed.toe && sequential) this.observePedal(observed.toe, observed, timestamp, frameHeight, pixelsPerMm, crankCenter);

    const display = { ...observed };
    if (fixedCrank && sequential && observed.toe) {
      const measuredPhase = this.phase(observed.toe);
      const phase = predicted
        ? this.phase(predicted) + .7 * wrapAngle(measuredPhase - this.phase(predicted))
        : measuredPhase;
      display.toe = this.pointOnOrbit(phase);
    }
    if (sequential && !display.toe && predicted) {
      display.toe = predicted;
      estimated.add("toe");
    }
    if (sequential && display.toe) {
      for (const joint of ["ankle", "heel"]) {
        const prior = this.footOffsets[joint];
        if (display[joint] || !prior || timestamp - prior.timestamp > predictionLimitMs) continue;
        display[joint] = { x: display.toe.x + prior.x, y: display.toe.y + prior.y };
        estimated.add(joint);
      }
    }
    const phase = this.degreesFromTop(observed.toe);
    const displayPhase = this.degreesFromTop(display.toe);
    return { observed, display, estimated, circle: this.circle, phase, displayPhase };
  }

  stabilizeAnchors(points, timestamp, frameHeight) {
    for (const joint of ["hip", "wrist"]) {
      if (!points[joint]) {
        delete this.anchors[joint];
        continue;
      }
      const prior = this.anchors[joint];
      if (prior && distance(prior.point, points[joint]) < frameHeight * .035) {
        const alpha = 1 - Math.exp(-(timestamp - prior.timestamp) / 180);
        points[joint] = {
          x: prior.point.x + (points[joint].x - prior.point.x) * alpha,
          y: prior.point.y + (points[joint].y - prior.point.y) * alpha,
        };
      }
      this.anchors[joint] = { point: points[joint], timestamp };
    }
  }

  observePedal(point, joints, timestamp, frameHeight, pixelsPerMm, crankCenter) {
    if (!crankCenter) {
      this.samples.push({ ...point, timestamp });
      this.samples = this.samples.filter(sample => timestamp - sample.timestamp <= 6500);
    }
    if (!crankCenter && timestamp - this.lastFit >= 200) {
      this.lastFit = timestamp;
      const fit = fitPedalCircle(this.samples, frameHeight, pixelsPerMm);
      if (fit) {
        this.circle = this.circle ? {
          x: this.circle.x * .8 + fit.x * .2,
          y: this.circle.y * .8 + fit.y * .2,
          radius: this.circle.radius * .8 + fit.radius * .2,
        } : fit;
      }
    }
    if (this.circle && this.lastFoot) {
      const elapsed = (timestamp - this.lastFoot.timestamp) / 1000;
      if (elapsed > 0 && elapsed < .25) {
        const delta = wrapAngle(this.phase(point) - this.phase(this.lastFoot.point));
        const speed = delta / elapsed;
        if (Math.abs(speed) >= minCadenceSpeed * .55 && Math.abs(speed) <= maxCadenceSpeed * 1.35 &&
            (!this.direction || Math.sign(speed) === this.direction)) {
          this.direction = Math.sign(speed);
          const cadenceSpeed = this.direction * Math.max(minCadenceSpeed, Math.min(maxCadenceSpeed, Math.abs(speed)));
          this.angularSpeed = this.angularSpeed == null ? cadenceSpeed : .72 * this.angularSpeed + .28 * cadenceSpeed;
        }
      } else {
        this.angularSpeed = null;
      }
    }
    this.lastFoot = { point, timestamp };
    for (const joint of ["ankle", "heel"]) {
      if (!joints[joint]) continue;
      this.footOffsets[joint] = {
        x: joints[joint].x - point.x,
        y: joints[joint].y - point.y,
        point: joints[joint],
        timestamp,
      };
    }
  }

  phase(point) {
    return Math.atan2(point.y - this.circle.y, point.x - this.circle.x);
  }

  degreesFromTop(toe) {
    if (!toe || !this.circle || !this.direction ||
        Math.abs(distance(toe, this.circle) - this.circle.radius) > this.circle.radius * .35) return null;
    return ((this.direction * (this.phase(toe) + Math.PI / 2) + turn) % turn) * 360 / turn;
  }

  predictPedal(timestamp) {
    if (!this.circle || !this.lastFoot || this.angularSpeed == null) return null;
    const age = timestamp - this.lastFoot.timestamp;
    if (age < 0 || age > predictionLimitMs) return null;
    return this.pointOnOrbit(this.phase(this.lastFoot.point) + this.angularSpeed * age / 1000);
  }

  pointOnOrbit(phase) {
    return {
      x: this.circle.x + this.circle.radius * Math.cos(phase),
      y: this.circle.y + this.circle.radius * Math.sin(phase),
    };
  }
}
