export const RAIN_DROP_COUNT = 640;
export const RAIN_RIPPLE_COUNT = 72;
export const RAIN_FLOOR_Y = -0.055;
export const RAIN_CEILING_Y = 15.5;
export const RAIN_RIPPLE_LIFETIME_SECONDS = 0.74;

const RAIN_MIN_X = -15;
const RAIN_MAX_X = 15;
const RAIN_MIN_Z = -4.35;
const RAIN_MAX_Z = 12.75;
const WARNING_TRACK_FRONT_Z = -1.82;
const WARNING_TRACK_Y = 0.002;

export interface RainField {
  positions: Float32Array;
  speeds: Float32Array;
  widths: Float32Array;
  brightness: Float32Array;
  cycles: Uint32Array;
  ripplePositions: Float32Array;
  rippleAges: Float32Array;
  rippleLifetimes: Float32Array;
  rippleRadii: Float32Array;
  rippleCursor: number;
}

function seededUnit(index: number, salt: number, cycle = 0) {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233 + cycle * 37.719) * 43_758.5453;
  return value - Math.floor(value);
}

export function rainSurfaceY(z: number) {
  return z <= WARNING_TRACK_FRONT_Z ? WARNING_TRACK_Y : RAIN_FLOOR_Y;
}

function resetDrop(field: RainField, index: number, initial: boolean) {
  const positionIndex = index * 6;
  const cycle = field.cycles[index];
  const x = RAIN_MIN_X + seededUnit(index, 1, cycle) * (RAIN_MAX_X - RAIN_MIN_X);
  const z = RAIN_MIN_Z + seededUnit(index, 2, cycle) * (RAIN_MAX_Z - RAIN_MIN_Z);
  const length = 0.24 + seededUnit(index, 3, cycle) * 0.43;
  const surfaceY = rainSurfaceY(z);
  const y = initial
    ? surfaceY + length + seededUnit(index, 4, cycle) * (RAIN_CEILING_Y - surfaceY - length)
    : RAIN_CEILING_Y + seededUnit(index, 5, cycle) * 3.5;
  const slant = length * (0.065 + seededUnit(index, 6, cycle) * 0.055);

  field.positions[positionIndex] = x;
  field.positions[positionIndex + 1] = y;
  field.positions[positionIndex + 2] = z;
  field.positions[positionIndex + 3] = x - slant;
  field.positions[positionIndex + 4] = y - length;
  field.positions[positionIndex + 5] = z;
  field.speeds[index] = 12.5 + seededUnit(index, 7, cycle) * 8.5;
  field.widths[index] = 0.026 + seededUnit(index, 8, cycle) * 0.026;
  field.brightness[index] = 0.58 + seededUnit(index, 9, cycle) * 0.42;
}

function createRipple(field: RainField, dropIndex: number, x: number, y: number, z: number) {
  const rippleIndex = field.rippleCursor;
  const positionIndex = rippleIndex * 3;
  const cycle = field.cycles[dropIndex];

  field.ripplePositions[positionIndex] = x;
  field.ripplePositions[positionIndex + 1] = y + 0.014;
  field.ripplePositions[positionIndex + 2] = z;
  field.rippleAges[rippleIndex] = 0;
  field.rippleLifetimes[rippleIndex] = RAIN_RIPPLE_LIFETIME_SECONDS * (0.8 + seededUnit(dropIndex, 10, cycle) * 0.4);
  field.rippleRadii[rippleIndex] = 0.16 + seededUnit(dropIndex, 11, cycle) * 0.17;
  field.rippleCursor = (rippleIndex + 1) % field.rippleAges.length;
}

export function createRainField(dropCount = RAIN_DROP_COUNT, rippleCount = RAIN_RIPPLE_COUNT): RainField {
  const safeDropCount = Math.max(1, Math.trunc(dropCount));
  const safeRippleCount = Math.max(1, Math.trunc(rippleCount));
  const rippleAges = new Float32Array(safeRippleCount);
  rippleAges.fill(Number.POSITIVE_INFINITY);

  const field: RainField = {
    positions: new Float32Array(safeDropCount * 6),
    speeds: new Float32Array(safeDropCount),
    widths: new Float32Array(safeDropCount),
    brightness: new Float32Array(safeDropCount),
    cycles: new Uint32Array(safeDropCount),
    ripplePositions: new Float32Array(safeRippleCount * 3),
    rippleAges,
    rippleLifetimes: new Float32Array(safeRippleCount),
    rippleRadii: new Float32Array(safeRippleCount),
    rippleCursor: 0,
  };

  for (let index = 0; index < safeDropCount; index += 1) {
    resetDrop(field, index, true);
  }
  return field;
}

export function advanceRainField(field: RainField, deltaSeconds: number) {
  const delta = Math.min(0.08, Math.max(0, deltaSeconds));
  let impactCount = 0;

  for (let index = 0; index < field.rippleAges.length; index += 1) {
    field.rippleAges[index] += delta;
  }

  for (let index = 0; index < field.speeds.length; index += 1) {
    const positionIndex = index * 6;
    const distance = field.speeds[index] * delta;
    const driftX = distance * 0.042;
    const driftZ = distance * 0.006;
    field.positions[positionIndex] += driftX;
    field.positions[positionIndex + 1] -= distance;
    field.positions[positionIndex + 2] += driftZ;
    field.positions[positionIndex + 3] += driftX;
    field.positions[positionIndex + 4] -= distance;
    field.positions[positionIndex + 5] += driftZ;

    const impactZ = field.positions[positionIndex + 5];
    const surfaceY = rainSurfaceY(impactZ);
    if (field.positions[positionIndex + 4] <= surfaceY) {
      createRipple(field, index, field.positions[positionIndex + 3], surfaceY, impactZ);
      field.cycles[index] += 1;
      resetDrop(field, index, false);
      impactCount += 1;
    }
  }

  return impactCount;
}
