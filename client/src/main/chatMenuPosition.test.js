import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatMenuHeightFor, chatMenuPositionFor, MENU_POPUP_WIDTH } from './chatMenuPosition.js';

test('chatMenuHeightFor grows with each enabled section, plus the always-present Exit row', () => {
  const exitOnly = chatMenuHeightFor({});
  const withPin = chatMenuHeightFor({ pin: true });
  assert.ok(withPin > exitOnly);
});

test('chatMenuHeightFor accounts for the opacity slider taking more room than a plain row', () => {
  const withPin = chatMenuHeightFor({ pin: true });
  const withOpacity = chatMenuHeightFor({ opacity: true });
  assert.ok(withOpacity > withPin);
});

test('chatMenuHeightFor grows when the autoWidth section is enabled', () => {
  const exitOnly = chatMenuHeightFor({});
  const withAutoWidth = chatMenuHeightFor({ autoWidth: true });
  assert.ok(withAutoWidth > exitOnly);
});

test('chatMenuPositionFor opens downward and right-aligns to the anchor when there is room', () => {
  const anchor = { x: 700, y: 500, width: 24, height: 24 };
  const size = { width: MENU_POPUP_WIDTH, height: 300 };
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
  const result = chatMenuPositionFor(anchor, size, workArea);
  assert.equal(result.opensBelow, true);
  assert.equal(result.y, 524); // anchor bottom
  assert.equal(result.x, 700 + 24 - MENU_POPUP_WIDTH);
});

test('chatMenuPositionFor opens upward when there is no room below', () => {
  const anchor = { x: 700, y: 1000, width: 24, height: 24 };
  const size = { width: MENU_POPUP_WIDTH, height: 300 };
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
  const result = chatMenuPositionFor(anchor, size, workArea);
  assert.equal(result.opensBelow, false);
  assert.equal(result.y, 700); // anchor top (1000) minus popup height (300)
});

test('chatMenuPositionFor clamps x within the work area on both sides', () => {
  const size = { width: MENU_POPUP_WIDTH, height: 300 };
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 };

  const nearRightEdge = chatMenuPositionFor({ x: 1900, y: 500, width: 24, height: 24 }, size, workArea);
  assert.equal(nearRightEdge.x, 1920 - MENU_POPUP_WIDTH);

  const nearLeftEdge = chatMenuPositionFor({ x: -20, y: 500, width: 24, height: 24 }, size, workArea);
  assert.equal(nearLeftEdge.x, 0);
});
