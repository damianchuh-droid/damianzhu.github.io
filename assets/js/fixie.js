const form = document.querySelector("#fixie-calculator");
const { chainring, cog } = form.elements;
const ratioOutput = document.querySelector("#gear-ratio");
const inchesOutput = document.querySelector("#gear-inches");
const skidOutput = document.querySelector("#skid-patches");
const skidMarks = document.querySelector("#fixie-skid-marks");
const wheelDiameterInches = 27;
const wheel = document.querySelector(".fixie-wheel");
const rearCogShape = document.querySelector("#rear-cog-shape");
const chainringIcon = document.querySelector(".fixie-chainring");
const chainringShape = document.querySelector("#front-chainring-shape");
const gearDisplay = document.querySelector(".fixie-gear-display");
const rearCogIcon = document.querySelector(".fixie-cog");
const chainLayer = document.querySelector(".fixie-chain-overlay");
const chainPaths = chainLayer.querySelectorAll("path");
const cogColors = {
  12: "#ff3399",
  13: "#ffeb00",
  14: "#18375f",
  15: "#ee1616",
  16: "#86c64c",
  17: "#111111",
  18: "#ffffff",
};

function gearOutline(teeth) {
  const rootRadius = 48 - Math.min(8, 140 / teeth);
  const vertices = [];
  for (let tooth = 0; tooth < teeth; tooth++) {
    for (const [offset, radius] of [[0, rootRadius], [.25, 48], [.65, 48], [.9, rootRadius]]) {
      const angle = 2 * Math.PI * (tooth + offset) / teeth;
      vertices.push(`${50 + radius * Math.cos(angle)},${50 + radius * Math.sin(angle)}`);
    }
  }
  return `M${vertices.join("L")}Z`;
}

function drawRearCog(teeth) {
  wheel.style.setProperty("--gear-scale", teeth * .0165);
  rearCogShape.setAttribute("d", gearOutline(teeth));
  rearCogShape.setAttribute("fill", cogColors[teeth] ?? "#888888");
}

function drawChain() {
  const frame = gearDisplay.getBoundingClientRect();
  if (!frame.width || !frame.height) return;

  const rear = rearCogIcon.getBoundingClientRect();
  const front = chainringIcon.getBoundingClientRect();
  const rearX = rear.left - frame.left + rear.width / 2;
  const frontX = front.left - frame.left + front.width / 2;
  const axleY = rear.top - frame.top + rear.height / 2;
  // The SVG gear outlines reach 48 units from the center of a 100-unit viewBox.
  const rearRadius = rear.width * .48;
  const frontRadius = front.width * .48;
  const tangentX = (rearRadius - frontRadius) / (frontX - rearX);
  const tangentY = Math.sqrt(1 - tangentX ** 2);
  const point = (x, radius, side) => `${x + radius * tangentX},${axleY + side * radius * tangentY}`;
  const path = [
    `M${point(rearX, rearRadius, -1)} L${point(frontX, frontRadius, -1)}`,
    `A${frontRadius},${frontRadius} 0 ${Number(frontRadius > rearRadius)} 1 ${point(frontX, frontRadius, 1)}`,
    `L${point(rearX, rearRadius, 1)}`,
    `A${rearRadius},${rearRadius} 0 ${Number(rearRadius > frontRadius)} 1 ${point(rearX, rearRadius, -1)} Z`,
  ].join(" ");

  chainLayer.setAttribute("viewBox", `0 0 ${frame.width} ${frame.height}`);
  for (const segment of chainPaths) segment.setAttribute("d", path);
}

function greatestCommonDivisor(a, b) {
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

function drawSkidPatches(count, rearTeeth) {
  skidOutput.textContent = count;
  wheel.setAttribute("aria-label", `Spoked bicycle wheel with a ${rearTeeth}-tooth rear cog and ${count} skid patches`);
  const marks = Array.from({ length: count }, (_, index) => {
    const mark = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    mark.setAttribute("x", 47.5);
    mark.setAttribute("y", .35);
    mark.setAttribute("width", 5);
    mark.setAttribute("height", 3.2);
    mark.setAttribute("transform", `rotate(${index * 360 / count} 50 50)`);
    return mark;
  });
  skidMarks.replaceChildren(...marks);
}

function calculate() {
  const frontTeeth = Number(chainring.value);
  const rearTeeth = Number(cog.value);
  const ratio = frontTeeth / rearTeeth;
  ratioOutput.textContent = ratio.toFixed(2);
  const gearInchHundredths = Math.round(frontTeeth * wheelDiameterInches * 100 / rearTeeth);
  inchesOutput.textContent = (gearInchHundredths / 100).toFixed(2);
  drawRearCog(rearTeeth);
  drawSkidPatches(rearTeeth / greatestCommonDivisor(frontTeeth, rearTeeth), rearTeeth);
  chainringIcon.style.setProperty("--gear-scale", frontTeeth * .0165);
  chainringIcon.setAttribute("aria-label", `${frontTeeth}-tooth front chainring`);
  chainringShape.setAttribute("d", gearOutline(frontTeeth));
  drawChain();
}

form.addEventListener("change", calculate);

calculate();
new ResizeObserver(drawChain).observe(gearDisplay);
