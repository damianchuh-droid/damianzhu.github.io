const series = { knee: "#ac4b18", hip: "#87700e", ankle: "#7050a2" };
const binCount = 24;
const binDegrees = 360 / binCount;

function crankBasis(degrees) {
  const phase = degrees * Math.PI / 180;
  return [1, Math.cos(phase), Math.sin(phase), Math.cos(2 * phase), Math.sin(2 * phase)];
}

export function fitCrankTrend(samples) {
  if (samples.length < 6) return null;
  const phases = samples.map(([phase]) => phase).sort((a, b) => a - b);
  const gaps = phases.map((phase, index) => (phases[index + 1] ?? phases[0] + 360) - phase);
  if (Math.max(...gaps) > 120) return null;

  // Harmonic least squares keeps the fitted curve continuous at the 0°/360° seam.
  const size = 5;
  const matrix = Array.from({ length: size }, () => Array(size + 1).fill(0));
  for (const [degrees, angle] of samples) {
    const basis = crankBasis(degrees);
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) matrix[row][col] += basis[row] * basis[col];
      matrix[row][size] += basis[row] * angle;
    }
  }
  // Light regularization keeps the curve stable with uneven phase coverage.
  for (let i = 1; i < size; i++) matrix[i][i] += .015;

  for (let col = 0; col < size; col++) {
    let pivot = col;
    for (let row = col + 1; row < size; row++) {
      if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
    }
    if (Math.abs(matrix[pivot][col]) < 1e-8) return null;
    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
    const divisor = matrix[col][col];
    matrix[col] = matrix[col].map(value => value / divisor);
    for (let row = 0; row < size; row++) {
      if (row === col) continue;
      const factor = matrix[row][col];
      matrix[row] = matrix[row].map((value, index) => value - factor * matrix[col][index]);
    }
  }
  const coefficients = matrix.map(row => row[size]);
  return phase => crankBasis(phase).reduce((angle, term, index) => angle + term * coefficients[index], 0);
}

export class CrankChart {
  constructor(canvas, caption) {
    this.canvas = canvas;
    this.caption = caption;
    this.context = canvas.getContext("2d");
    this.reset();
  }

  reset() {
    this.bins = Array.from({ length: binCount }, () => ({}));
    this.revolutions = 0;
    this.trends = {};
    this.previewBins = Array.from({ length: binCount }, () => ({}));
    this.previewTrends = {};
    this.previewDirty = false;
    this.resetTurn();
    this.caption.textContent = "Fits appear once enough positions are sampled. 0° is the top of the toe’s path.";
    this.draw();
  }

  resetTurn() {
    this.turnBins = null;
    this.previousPhase = null;
    this.previousTime = null;
    this.live = null;
    this.liveBins = new Map();
    this.lastLiveDraw = -Infinity;
  }

  observe(phase, angles) {
    if (!Number.isFinite(phase)) return;
    const bin = this.previewBins[Math.round(phase / binDegrees) % binCount];
    for (const joint of Object.keys(series)) {
      const value = angles[joint];
      if (this.trends[joint] || !Number.isFinite(value) || bin[joint]?.mean === value) continue;
      bin[joint] = { mean: value };
      this.previewDirty = true;
    }
  }

  trendFor(bins, joint) {
    return fitCrankTrend(bins.flatMap((bin, index) =>
      bin[joint] ? [[index * binDegrees, bin[joint].mean]] : []));
  }

  add(phase, angles, timestamp) {
    if (!Number.isFinite(phase)) return;
    if (this.previousTime != null && timestamp - this.previousTime > 260) this.resetTurn();
    if (this.previousPhase != null) {
      const delta = (phase - this.previousPhase + 540) % 360 - 180;
      if (delta < -20 || delta > 135) this.resetTurn();
      else if (delta < 0) return;
      else if (phase < this.previousPhase) {
        this.commitTurn();
        this.turnBins = Array.from({ length: binCount }, () => ({}));
      }
    }
    this.previousPhase = phase;
    this.previousTime = timestamp;
    if (!this.turnBins) return;
    const bin = this.turnBins[Math.round(phase / binDegrees) % binCount];
    for (const joint of Object.keys(series)) {
      const value = angles[joint];
      if (!Number.isFinite(value)) continue;
      const entry = bin[joint] ??= { count: 0, mean: 0 };
      entry.count++;
      entry.mean += (value - entry.mean) / entry.count;
    }
  }

  commitTurn() {
    if (!this.turnBins || this.turnBins.filter(bin => Object.keys(bin).length).length < binCount / 2) return;
    this.revolutions++;
    for (const [index, turnBin] of this.turnBins.entries()) {
      for (const [joint, sample] of Object.entries(turnBin)) {
        const entry = this.bins[index][joint] ??= { count: 0, mean: 0 };
        entry.count++;
        entry.mean += (sample.mean - entry.mean) / entry.count;
      }
    }
    for (const joint of Object.keys(series)) {
      const trend = this.trendFor(this.bins, joint);
      if (trend) this.trends[joint] = trend;
    }
    this.draw();
    const coverage = this.bins.filter(bin => Object.keys(bin).length).length;
    this.caption.textContent = `${this.revolutions} completed ${this.revolutions === 1 ? "revolution" : "revolutions"} averaged · ${coverage}/${binCount} positions sampled. 0° is the top of the toe’s path.`;
  }

  showLive(phase, angles, timestamp, playing) {
    const valid = Number.isFinite(phase);
    if (valid) {
      if (playing) {
        if (this.live && phase < this.live.phase - 180) this.liveBins.clear();
        this.liveBins.set(Math.round(phase / binDegrees), angles);
      }
      this.live = { phase, angles };
    } else if (this.live) {
      this.live = null;
    } else {
      return;
    }
    if (!playing || timestamp - this.lastLiveDraw >= 55) {
      this.lastLiveDraw = timestamp;
      this.draw();
    }
  }

  draw() {
    if (this.previewDirty) {
      for (const joint of Object.keys(series)) {
        if (this.trends[joint]) continue;
        const trend = this.trendFor(this.previewBins, joint);
        if (trend) this.previewTrends[joint] = trend;
      }
      this.previewDirty = false;
    }
    const ctx = this.context;
    const { width, height } = this.canvas;
    const left = 74, right = width - 39, top = 23, bottom = height - 66;
    const xAt = phase => left + phase / 360 * (right - left);
    const yAt = angle => bottom - angle / 180 * (bottom - top);
    ctx.clearRect(0, 0, width, height);
    ctx.font = "23px monospace";
    ctx.strokeStyle = "#c4c4c4";
    ctx.fillStyle = "#414141";
    ctx.lineWidth = 1;
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    for (let angle = 0; angle <= 180; angle += 45) {
      const y = yAt(angle);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.fillText(`${angle}°`, left - 8, y);
    }
    ctx.textAlign = "center";
    for (let phase = 0; phase <= 360; phase += 90) {
      ctx.fillText(`${phase}°`, xAt(phase), bottom + 20);
    }
    ctx.fillText("Crank rotation", (left + right) / 2, bottom + 50);

    for (const [joint, color] of Object.entries(series)) {
      ctx.strokeStyle = ctx.fillStyle = color;
      const trend = this.trends[joint] ?? this.previewTrends[joint];
      const displayedBins = this.trends[joint] ? this.bins : this.previewBins;
      if (trend) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, right - left, bottom - top);
        ctx.clip();
        ctx.lineWidth = 3;
        ctx.globalAlpha = .43;
        ctx.beginPath();
        ctx.moveTo(left, yAt(trend(0)));
        for (let phase = 3; phase <= 360; phase += 3) ctx.lineTo(xAt(phase), yAt(trend(phase)));
        ctx.stroke();
        ctx.restore();
      }
      for (let index = 0; index <= binCount; index++) {
        const value = displayedBins[index % binCount][joint]?.mean;
        if (value == null) continue;
        ctx.beginPath();
        ctx.arc(xAt(index * binDegrees), yAt(value), 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = .55;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      let previousIndex = -2;
      for (const [index, angles] of [...this.liveBins].sort(([a], [b]) => a - b)) {
        const value = angles[joint];
        if (!Number.isFinite(value)) continue;
        const x = xAt(index * binDegrees), y = yAt(value);
        if (index === previousIndex + 1) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        previousIndex = index;
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      const value = this.live?.angles[joint];
      if (Number.isFinite(value)) {
        ctx.beginPath();
        ctx.arc(xAt(this.live.phase), yAt(value), 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
