/**
 * Find the event-summary button containing a browser click target.
 * @param {EventTarget|null} target - Browser click target.
 * @returns {HTMLButtonElement|null} Containing summary button.
 */
export function findSummaryButtonFromTarget(target) {
  return target instanceof Element ? target.closest('button.event-summary') : null;
}

/**
 * Toggle an event card and keep its detail visibility and ARIA state aligned.
 * @param {HTMLButtonElement} summaryButton - Clicked event-summary button.
 * @returns {boolean} Whether the card is now expanded.
 */
export function toggleEventCardExpanded(summaryButton) {
  const card = summaryButton.closest('.event-card');
  const expanded = card.dataset.expanded !== 'true';
  card.dataset.expanded = String(expanded);
  summaryButton.setAttribute('aria-expanded', String(expanded));
  card.querySelector('.event-detail').hidden = !expanded;
  return expanded;
}
