const palette = {
  top: "#e0e0e0",
  side: "#cecece",
  end: "#c0c0c0",
  edge: "#525252",
  highlight: "#3d3d3d",
};

function block(faces, x, y, z, width, depth, height, marked = false) {
  const right = x + width;
  const front = y + depth;
  const top = z + height;
  faces.push(
    { fill: palette.top, marked, points: [[x, y, top], [right, y, top], [right, front, top], [x, front, top]] },
    { fill: palette.side, marked, points: [[x, front, z], [right, front, z], [right, front, top], [x, front, top]] },
    { fill: palette.end, marked, points: [[right, y, z], [right, front, z], [right, front, top], [right, y, top]] },
  );
}

function fixture(exploded) {
  const faces = [];
  block(faces, 0, 0, 0, 144, 106, 10);
  for (let row = 0; row < 5; row++) {
    block(faces, 0, row * 22, 10, 144, 18, 5);
  }
  const rise = exploded ? 31 : 0;
  block(faces, 20, 17, 15 + rise, 22, 69, 35, true);
  block(faces, 101, 17, 15 + rise, 22, 69, 35, true);
  block(faces, 24, 24, 50 + rise, 95, 18, 11);
  block(faces, 24, 62, 50 + rise, 95, 18, 11);
  if (exploded) block(faces, 53, 30, 100, 38, 43, 10, true);
  return faces;
}

function bracket() {
  const faces = [];
  block(faces, 0, 0, 0, 107, 97, 10);
  block(faces, 0, 0, 10, 107, 10, 67);
  for (const x of [12, 47, 82]) {
    const back = 10;
    const front = 86;
    const bottom = 10;
    const top = 68;
    const right = x + 12;
    faces.push(
      { fill: palette.side, marked: true, points: [[right, back, bottom], [right, front, bottom], [right, back, top]] },
      { fill: palette.top, marked: true, points: [[x, front, bottom], [right, front, bottom], [right, back, top], [x, back, top]] },
    );
  }
  return faces;
}

const diagrams = {
  assembly: fixture(true),
  fixture: fixture(false),
  bracket: bracket(),
};

function project([x, y, z]) {
  return [(x - y) * .866, (x + y) * .5 - z];
}

function depth({ points }) {
  return points.reduce((sum, [x, y, z]) => sum + x + y + z, 0) / points.length;
}

function draw(canvas) {
  const { width, height } = canvas.getBoundingClientRect();
  if (!width || !height) return;

  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.scale(ratio, ratio);

  const faces = diagrams[canvas.dataset.diagram];
  const points = faces.flatMap(face => face.points.map(project));
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const scale = Math.min(width * .71 / (right - left), height * .65 / (bottom - top));
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;

  for (const face of [...faces].sort((a, b) => depth(a) - depth(b))) {
    const outline = new Path2D();
    for (const [index, point] of face.points.entries()) {
      const [x, y] = project(point);
      const screenX = width / 2 + (x - centerX) * scale;
      const screenY = height * .45 + (y - centerY) * scale;
      if (index === 0) outline.moveTo(screenX, screenY);
      else outline.lineTo(screenX, screenY);
    }
    outline.closePath();
    context.fillStyle = face.fill;
    context.fill(outline);

    // Clip faint, uneven pencil strokes to the current face.
    context.save();
    context.clip(outline);
    context.strokeStyle = "#494949";
    context.globalAlpha = face.fill === palette.top ? .14 : .25;
    context.lineWidth = .65;
    const spacing = face.fill === palette.end ? 4 : 6;
    const run = height * .45;
    context.beginPath();
    for (let x = -run; x < width; x += spacing) {
      const drift = Math.sin(x * 1.7);
      context.moveTo(x + drift, 0);
      context.lineTo(x + run - drift, height);
    }
    context.stroke();
    context.restore();

    context.strokeStyle = face.marked ? palette.highlight : palette.edge;
    context.lineWidth = 1;
    context.stroke(outline);

    context.save();
    context.lineWidth = 1.8;
    context.globalAlpha = .23;
    context.stroke(outline);
    context.restore();
  }
}

const observer = new ResizeObserver(entries => {
  for (const { target } of entries) draw(target);
});
for (const canvas of document.querySelectorAll("canvas[data-diagram]")) {
  draw(canvas);
  observer.observe(canvas);
}
