/**
 * String formatting helpers.
 * @module
 */

/**
 * Trim a value and clamp it to `max` characters, appending an ellipsis when
 * the trimmed text exceeds the limit.
 * @param {*} value - Value to format. Falsy or blank-after-trim returns "".
 * @param {number} [max] - Maximum length before truncation. Defaults to 60.
 * @returns {string} Trimmed text, ellipsized to `max` chars when longer.
 */
export function truncateText(value, max = 60) {
  if (!value) return '';
  const trimmed = String(value).trim();
  if (!trimmed) return '';
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1))}…`;
}
