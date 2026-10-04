"use strict";

/**
 * Iranian mobile number normalization, shared by the OTP flow and the
 * Customer/User lookup that follows it.
 *
 * Everything is stored and compared in one canonical form (09XXXXXXXXX)
 * so "+989121234567", "00989121234567", "۰۹۱۲۱۲۳۴۵۶۷" and
 * "0912 123 4567" can never create four different accounts for one
 * person.
 */

const PERSIAN_DIGITS = /[\u06F0-\u06F9]/g; // ۰-۹
const ARABIC_DIGITS = /[\u0660-\u0669]/g; // ٠-٩
const CANONICAL_RE = /^09\d{9}$/;

function toLatinDigits(value) {
  return String(value)
    .replace(PERSIAN_DIGITS, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660));
}

/**
 * @returns {string|null} canonical 09XXXXXXXXX, or null when the input
 * is not a valid Iranian mobile number.
 */
function normalizePhone(input) {
  if (input === null || input === undefined) return null;

  let digits = toLatinDigits(input).replace(/[^\d+]/g, "");

  if (digits.startsWith("+98")) digits = `0${digits.slice(3)}`;
  else if (digits.startsWith("0098")) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith("98") && digits.length === 12) digits = `0${digits.slice(2)}`;
  else if (digits.startsWith("9") && digits.length === 10) digits = `0${digits}`;

  digits = digits.replace(/\+/g, "");

  return CANONICAL_RE.test(digits) ? digits : null;
}

function isValidPhone(input) {
  return normalizePhone(input) !== null;
}

module.exports = { normalizePhone, isValidPhone, CANONICAL_RE };
