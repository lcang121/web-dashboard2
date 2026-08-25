/**
 * System-wide monetary rounding utility, ported from the mobile app
 * (utakmobileBIR/src/HelperFunctions/roundMoney.js).
 *
 * Ensures all monetary values are consistently rounded to 2 decimal places
 * (cents). Values are stored as cents internally (PHP 100.50 = 10050 cents).
 */

/** Money precision constant: 100 (1 PHP = 100 cents). */
export const MONEY_PRECISION = 100;

/**
 * Round a monetary value to the nearest cent, preserving sign.
 * Works with both cent-based values and PHP-based values.
 */
export function roundMoney(value: number | string | null | undefined): number {
  const numValue = parseFloat(String(value)) || 0;
  const rounded = Math.round(Math.abs(numValue));
  return numValue < 0 ? -1 * rounded : rounded;
}

/** Round a value in cents and convert to PHP units. */
export function roundMoneyToPHP(valueInCents: number | string): number {
  return roundMoney(valueInCents) / MONEY_PRECISION;
}

/** Convert a PHP amount to rounded cents. */
export function phpToCents(phpValue: number | string): number {
  return roundMoney((parseFloat(String(phpValue)) || 0) * MONEY_PRECISION);
}

/** Sum an array of monetary values and round the result (avoids float drift). */
export function sumAndRound(values: (number | string)[]): number {
  if (!Array.isArray(values)) return roundMoney(0);
  const sum = values.reduce((acc: number, val) => acc + (parseFloat(String(val)) || 0), 0);
  return roundMoney(sum);
}

/** Multiply a base by a rate and round (discount / tax calculations). */
export function multiplyAndRound(base: number | string, rate: number | string): number {
  const baseNum = parseFloat(String(base)) || 0;
  const rateNum = parseFloat(String(rate)) || 0;
  return roundMoney(baseNum * rateNum);
}

/** Divide and round (VAT-exclusive calculations, e.g. divisor 1.12). */
export function divideAndRound(value: number | string, divisor: number | string): number {
  const valueNum = parseFloat(String(value)) || 0;
  const divisorNum = parseFloat(String(divisor)) || 1;
  if (divisorNum === 0) return roundMoney(0);
  return roundMoney(valueNum / divisorNum);
}

/** True when the value carries more than 2 decimal places. */
export function needsRounding(value: number | string): boolean {
  const numValue = parseFloat(String(value)) || 0;
  const rounded = roundMoney(numValue);
  return Math.abs(numValue - rounded) > 0.001;
}

export default {
  roundMoney,
  roundMoneyToPHP,
  phpToCents,
  sumAndRound,
  multiplyAndRound,
  divideAndRound,
  needsRounding,
  MONEY_PRECISION,
};
