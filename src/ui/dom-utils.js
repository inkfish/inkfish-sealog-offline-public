/**
 * DOM visibility helpers that set both the hidden property and ARIA attributes.
 * @module
 */

/**
 * Hide a DOM element. Sets hidden=true, the hidden attribute, and
 * aria-hidden="true". No-op if el is falsy.
 * @param {HTMLElement|null|undefined} el - Element to hide.
 * @returns {void}
 */
export function hideElement(el) {
  if (!el) return;
  el.hidden = true;
  el.setAttribute('hidden', '');
  el.setAttribute('aria-hidden', 'true');
}

/**
 * Show a DOM element. Sets hidden=false and removes the hidden and
 * aria-hidden attributes. No-op if el is falsy.
 * @param {HTMLElement|null|undefined} el - Element to show.
 * @returns {void}
 */
export function showElement(el) {
  if (!el) return;
  el.hidden = false;
  el.removeAttribute('hidden');
  el.removeAttribute('aria-hidden');
}
