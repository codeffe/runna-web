import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDuration, formatPace, formatPaceShort, formatDistance,
  formatDistanceWithUnit, formatRaceDistance, UNIT_DEFS, paceFromSpeed,
} from '../js/domain/format.js';

test('duration matches the iOS Fmt.duration', () => {
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(3725), '1:02:05');
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(-1), '--:--');
});

test('pace converts km -> miles', () => {
  assert.equal(formatPaceShort(300, 'kilometers'), '5:00');
  assert.equal(formatPaceShort(300, 'miles'), '8:03');
  assert.equal(formatPace(300, 'kilometers'), '5:00 /km');
  assert.equal(formatPace(300, 'miles'), '8:03 /mi');
});

test('pace rounds 59.6s up into the minute rather than printing :60', () => {
  assert.equal(formatPaceShort(299.6, 'kilometers'), '5:00');
});

test('distance formatting', () => {
  assert.equal(formatDistance(9400, 'kilometers'), '9.40');
  assert.equal(formatDistanceWithUnit(9400, 'kilometers'), '9.40 km');
  assert.equal(formatDistance(1609.344, 'miles'), '1.00');
  assert.equal(formatDistance(150000, 'kilometers'), '150');
});

test('race distance labels', () => {
  assert.equal(formatRaceDistance(5000), '5K');
  assert.equal(formatRaceDistance(21097.5), 'Half Marathon');
  assert.equal(formatRaceDistance(42195), 'Marathon');
});

test('speed -> pace', () => {
  assert.equal(Math.round(paceFromSpeed(1000 / 300)), 300);
  assert.equal(paceFromSpeed(0), 0);
});

test('unit defs', () => {
  assert.equal(UNIT_DEFS.kilometers.suffix, 'km');
  assert.equal(UNIT_DEFS.miles.metersPerUnit, 1609.344);
});
