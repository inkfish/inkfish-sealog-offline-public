import { describe, it, expect } from 'vitest';
import {
  findSummaryButtonFromTarget,
  toggleEventCardExpanded
} from '../../src/runtime/event-accordion.js';

function buildEventCardDom() {
  const list = document.createElement('ol');
  list.className = 'event-list';
  list.innerHTML = `
    <li class="event-card" data-expanded="false">
      <button type="button" class="event-summary" aria-expanded="false">
        <div class="event-summary-main">
          <span class="event-title">Observation</span>
        </div>
        <span class="event-chevron" aria-hidden="true">
          <svg class="ph ph-caret-down ui-icon event-chevron-icon" aria-hidden="true" focusable="false" width="1em" height="1em">
            <use href="icons/phosphor-sprite.svg#ph-caret-down"></use>
          </svg>
        </span>
      </button>
      <div class="event-detail" hidden>
        <p>detail</p>
      </div>
    </li>
  `;
  document.body.appendChild(list);
  const card = list.querySelector('.event-card');
  const summary = list.querySelector('.event-summary');
  const detail = list.querySelector('.event-detail');
  const svg = list.querySelector('svg');
  const use = list.querySelector('use');
  return { list, card, summary, detail, svg, use };
}

describe('event accordion runtime helpers', () => {
  it('finds summary button for svg targets', () => {
    const { summary, svg, use } = buildEventCardDom();
    expect(findSummaryButtonFromTarget(svg)).toBe(summary);
    expect(findSummaryButtonFromTarget(use)).toBe(summary);
  });

  it('toggles expanded state through helper', () => {
    const { card, summary, detail } = buildEventCardDom();
    expect(card.dataset.expanded).toBe('false');
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(detail.hidden).toBe(true);

    const opened = toggleEventCardExpanded(summary);
    expect(opened).toBe(true);
    expect(card.dataset.expanded).toBe('true');
    expect(summary.getAttribute('aria-expanded')).toBe('true');
    expect(detail.hidden).toBe(false);

    const closed = toggleEventCardExpanded(summary);
    expect(closed).toBe(false);
    expect(card.dataset.expanded).toBe('false');
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(detail.hidden).toBe(true);
  });

});
