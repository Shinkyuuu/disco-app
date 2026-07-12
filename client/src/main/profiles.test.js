import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { scopeDir, slotDirName } from './profiles.js';

test('scopeDir joins a numeric friend id under the friends subdirectory', () => {
  assert.equal(
    scopeDir('/root', 'friend', '188817283177644044'),
    path.join('/root', 'friends', '188817283177644044'),
  );
});

test('scopeDir joins a numeric default slot id under the defaults subdirectory', () => {
  assert.equal(scopeDir('/root', 'default', '01'), path.join('/root', 'defaults', '01'));
});

test('scopeDir rejects an id containing path traversal segments', () => {
  assert.throws(() => scopeDir('/root', 'friend', '../../../etc'), /Invalid profile id/);
});

test('scopeDir rejects an id containing path separators', () => {
  assert.throws(() => scopeDir('/root', 'friend', '123/456'), /Invalid profile id/);
});

test('scopeDir rejects a non-numeric id', () => {
  assert.throws(() => scopeDir('/root', 'friend', 'abc'), /Invalid profile id/);
});

test('slotDirName returns a zero-padded two-digit name for valid indices', () => {
  assert.equal(slotDirName(0), '01');
  assert.equal(slotDirName(9), '10');
});

test('slotDirName rejects out-of-range indices', () => {
  assert.throws(() => slotDirName(10), RangeError);
  assert.throws(() => slotDirName(-1), RangeError);
});

test('slotDirName rejects non-integer indices', () => {
  assert.throws(() => slotDirName(2.5), RangeError);
  assert.throws(() => slotDirName('2'), RangeError);
});
