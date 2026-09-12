/**
 * HTML string builders shared across renderers.
 * @module
 */

/**
 * Escape a value for safe interpolation into an HTML string.
 * @param {*} value - Value to escape. Null/undefined returns "".
 * @returns {string} HTML-escaped string.
 */
export function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Phosphor icon name to sprite href map.
 */
export const PHOSPHOR_ICON_HREFS = Object.freeze({
  'check-circle': 'icons/phosphor-sprite.svg?v=2b75f3ad12b4#ph-check-circle',
  'arrows-clockwise': 'icons/phosphor-sprite.svg?v=2b75f3ad12b4#ph-arrows-clockwise',
  'pencil-simple': 'icons/phosphor-sprite.svg?v=2b75f3ad12b4#ph-pencil-simple',
  'hourglass-high': 'icons/phosphor-sprite.svg?v=2b75f3ad12b4#ph-hourglass-high',
  'warning-circle': 'icons/phosphor-sprite.svg?v=2b75f3ad12b4#ph-warning-circle',
  'caret-down': 'icons/phosphor-sprite.svg?v=2b75f3ad12b4#ph-caret-down'
});

/**
 * Build an inline SVG that references a Phosphor sprite icon via `<use>`.
 * @param {string} iconName - Key in {@link PHOSPHOR_ICON_HREFS}. Unknown names return "".
 * @param {string} [className] - Extra space-separated classes to add. Defaults to "ui-icon".
 * @returns {string} SVG markup, or "" if the icon name is unknown.
 */
export function renderPhosphorIcon(iconName, className = 'ui-icon') {
  const href = PHOSPHOR_ICON_HREFS[iconName];
  if (!href) return '';
  const safeClassName = String(className || '').trim();
  const classList = [`ph`, `ph-${iconName}`];
  if (safeClassName) classList.push(...safeClassName.split(/\s+/));
  return `<svg class="${classList.join(' ')}" aria-hidden="true" focusable="false" width="1em" height="1em"><use href="${href}"></use></svg>`;
}
