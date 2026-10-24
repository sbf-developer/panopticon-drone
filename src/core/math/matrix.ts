/** Small dense matrix helpers used by the navigation and target Kalman filters. */
export type Matrix = number[][];

export const zeros = (rows: number, cols: number): Matrix =>
  Array.from({ length: rows }, () => Array<number>(cols).fill(0));

export const identity = (n: number): Matrix => {
  const m = zeros(n, n);
  for (let i = 0; i < n; i += 1) m[i]![i] = 1;
  return m;
};

export const diagonal = (values: readonly number[]): Matrix => {
  const m = zeros(values.length, values.length);
  values.forEach((value, i) => {
    m[i]![i] = value;
  });
  return m;
};

export const add = (a: Matrix, b: Matrix): Matrix =>
  a.map((row, i) => row.map((value, j) => value + b[i]![j]!));

export const subtract = (a: Matrix, b: Matrix): Matrix =>
  a.map((row, i) => row.map((value, j) => value - b[i]![j]!));

export const scale = (a: Matrix, s: number): Matrix =>
  a.map((row) => row.map((value) => value * s));

export const multiply = (a: Matrix, b: Matrix): Matrix => {
  const rows = a.length;
  const inner = b.length;
  const cols = b[0]?.length ?? 0;
  const out = zeros(rows, cols);
  for (let i = 0; i < rows; i += 1) {
    const aRow = a[i]!;
    const outRow = out[i]!;
    for (let k = 0; k < inner; k += 1) {
      const aik = aRow[k]!;
      if (aik === 0) continue;
      const bRow = b[k]!;
      for (let j = 0; j < cols; j += 1) {
        outRow[j] = outRow[j]! + aik * bRow[j]!;
      }
    }
  }
  return out;
};

export const transpose = (a: Matrix): Matrix => {
  const rows = a.length;
  const cols = a[0]?.length ?? 0;
  const out = zeros(cols, rows);
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) out[j]![i] = a[i]![j]!;
  }
  return out;
};

/** Gauss-Jordan inverse with partial pivoting. Throws on singular input. */
export const invert = (a: Matrix): Matrix => {
  const n = a.length;
  const aug = a.map((row, i) => [...row, ...identity(n)[i]!]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    let pivotAbs = Math.abs(aug[col]![col]!);
    for (let row = col + 1; row < n; row += 1) {
      const candidate = Math.abs(aug[row]![col]!);
      if (candidate > pivotAbs) {
        pivot = row;
        pivotAbs = candidate;
      }
    }
    if (pivotAbs < 1e-12) throw new Error('Singular matrix');
    if (pivot !== col) {
      const tmp = aug[col]!;
      aug[col] = aug[pivot]!;
      aug[pivot] = tmp;
    }
    const divisor = aug[col]![col]!;
    for (let j = 0; j < n * 2; j += 1) aug[col]![j] = aug[col]![j]! / divisor;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = aug[row]![col]!;
      if (factor === 0) continue;
      for (let j = 0; j < n * 2; j += 1) {
        aug[row]![j] = aug[row]![j]! - factor * aug[col]![j]!;
      }
    }
  }
  return aug.map((row) => row.slice(n));
};

export const symmetrize = (a: Matrix): Matrix => {
  const n = a.length;
  const out = a.map((row) => [...row]);
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const value = (out[i]![j]! + out[j]![i]!) / 2;
      out[i]![j] = value;
      out[j]![i] = value;
    }
  }
  return out;
};
