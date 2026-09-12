import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, renderPhosphorIcon, PHOSPHOR_ICON_HREFS } from '../../src/ui/html-utils.js';

test('escapeHtml returns "" for null/undefined', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('escapeHtml escapes all five HTML-sensitive characters', () => {
  assert.equal(
    escapeHtml(`<a href="x" title='y'>&</a>`),
    '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;'
  );
});

test('escapeHtml coerces non-strings', () => {
  assert.equal(escapeHtml(42), '42');
});

test('renderPhosphorIcon returns "" for an unknown icon name', () => {
  assert.equal(renderPhosphorIcon('does-not-exist'), '');
});

test('renderPhosphorIcon builds an SVG referencing the sprite href', () => {
  const svg = renderPhosphorIcon('check-circle');
  assert.match(svg, /^<svg /);
  assert.match(svg, /class="ph ph-check-circle ui-icon"/);
  assert.ok(svg.includes(`<use href="${PHOSPHOR_ICON_HREFS['check-circle']}">`));
  assert.match(svg, /aria-hidden="true"/);
});

test('renderPhosphorIcon merges extra class names and tolerates blank className', () => {
  assert.match(renderPhosphorIcon('caret-down', 'a b'), /class="ph ph-caret-down a b"/);
  assert.match(renderPhosphorIcon('caret-down', ''), /class="ph ph-caret-down"/);
});
