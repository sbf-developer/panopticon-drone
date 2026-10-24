import { invert, multiply, type Matrix } from '../src/core/math/matrix';

/** Checks A * A^-1 = I to a tight tolerance. */
export const inverseCheck = (matrix: Matrix): boolean => {
  const inverse = invert(matrix);
  const product = multiply(matrix, inverse);
  for (let i = 0; i < matrix.length; i += 1) {
    for (let j = 0; j < matrix.length; j += 1) {
      const expected = i === j ? 1 : 0;
      if (Math.abs(product[i]![j]! - expected) > 1e-8) return false;
    }
  }
  return true;
};
