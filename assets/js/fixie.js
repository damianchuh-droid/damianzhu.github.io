const form = document.querySelector("#fixie-calculator");
const { chainring, cog } = form.elements;
const ratioOutput = document.querySelector("#gear-ratio");
const inchesOutput = document.querySelector("#gear-inches");
const wheelDiameterMm = 672;

function calculate() {
  const frontTeeth = chainring.valueAsNumber;
  const rearTeeth = cog.valueAsNumber;
  const ratio = frontTeeth / rearTeeth;
  ratioOutput.textContent = ratio.toFixed(2);
  inchesOutput.textContent = (ratio * wheelDiameterMm / 25.4).toFixed(1);
}

form.addEventListener("submit", event => {
  event.preventDefault();
  calculate();
});

calculate();
