// Robust ridge fit from the two labeled BikeFit clips.
const coefficients = [
  [0.03127984751108902, 0.024188339883279376],
  [-0.013451780579522642, 0.01647047119940014],
  [-0.005302509432219603, 0.03698043820542683],
  [0.002235402903656485, 0.004401504386788402],
  [0.014086656886880954, -0.03041387529338807],
];
const torsoOffsetLimit = .35;

function unit(x, y) {
  const length = Math.hypot(x, y);
  return length >= 3 ? [x / length, y / length] : null;
}

export function correctKnee({ knee, hip, shoulder, heel, toe }, bottomBracket) {
  const inputs = [knee, hip, shoulder, heel, toe, bottomBracket];
  if (!inputs.every(point => Number.isFinite(point?.x) && Number.isFinite(point?.y))) return knee;

  const dx = shoulder.x - hip.x;
  const dy = shoulder.y - hip.y;
  const torso = Math.hypot(dx, dy);
  if (torso < 5 || Math.abs(dx) < .15 * torso) return knee;
  const phase = unit(toe.x - bottomBracket.x, toe.y - bottomBracket.y);
  const shoe = unit(toe.x - heel.x, toe.y - heel.y);
  if (!phase || !shoe) return knee;

  const facing = Math.sign(dx);
  const features = [1, phase[0] * facing, phase[1], shoe[0] * facing, shoe[1]];
  const offset = [0, 1].map(axis => {
    const value = coefficients.reduce((sum, row, index) => sum + row[axis] * features[index], 0);
    return torso * Math.max(-torsoOffsetLimit, Math.min(torsoOffsetLimit, value));
  });
  return { x: knee.x + offset[0] * facing, y: knee.y + offset[1] };
}
