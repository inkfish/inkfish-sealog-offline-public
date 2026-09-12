import { describe, it, expect } from 'vitest';
import { hideElement, showElement } from '../../src/ui/dom-utils.js';

describe('dom utils', () => {
  it('hideElement toggles hidden attributes', () => {
    const el = document.createElement('div');
    showElement(el);
    hideElement(el);
    expect(el.hidden).toBe(true);
    expect(el.getAttribute('hidden')).toBe('');
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  it('showElement removes hidden attributes', () => {
    const el = document.createElement('div');
    hideElement(el);
    showElement(el);
    expect(el.hidden).toBe(false);
    expect(el.hasAttribute('hidden')).toBe(false);
    expect(el.getAttribute('aria-hidden')).toBeNull();
  });
});
