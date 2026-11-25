import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeOptions, encodeOptions, decodeLiveCascade } from '../app/hash.js';
import { PRESETS, DEFAULT_OPTIONS } from '../app/engine.js';

const decode = (hash) => decodeOptions(new URLSearchParams(hash));

test('a link made before round 1 opens the view it saved', () => {
  assert.deepEqual(decode('s=3&cmp=referenced'), { options: PRESETS.draft.options, compare: 'referenced' });
  assert.deepEqual(decode('s=3'), { options: PRESETS.draft.options, compare: 'none' });
  assert.equal(decode('s=3&cascade=referenced&cmp=draft').options.cascade, 'referenced');
  assert.equal(decode('s=3&cascade=referenced&cmp=draft').options.root, 'swap');
});

test('a new visit, and a link made now, start from round 1', () => {
  assert.deepEqual(decode(''), { options: DEFAULT_OPTIONS, compare: null });
  assert.deepEqual(decode('s=3&r=1'), { options: DEFAULT_OPTIONS, compare: null });
});

test('options and an explicit "no comparison" survive a round trip', () => {
  const options = { ...DEFAULT_OPTIONS, pick: 'equivalent', adding: 'inform' };
  for (const compare of [null, 'none', 'draft']) {
    const params = new URLSearchParams({ s: '3' });
    encodeOptions(params, options, compare);
    assert.deepEqual(decodeOptions(params), { options, compare });
  }
});

test("an old live link's cascade=0 reads as the live setting, and keeps the draft's Rule 3", () => {
  const params = new URLSearchParams('s=any&c=CIEL%3A163731&cascade=0');
  assert.equal(decodeLiveCascade(params, true), false);
  assert.equal(decodeOptions(params).options.cascade, PRESETS.draft.options.cascade);
  const again = new URLSearchParams({ s: 'any' });
  encodeOptions(again, decodeOptions(params).options, null);
  again.set('lc', '0');
  assert.equal(decodeOptions(again).options.cascade, PRESETS.draft.options.cascade);
  assert.equal(decodeLiveCascade(again, true), false);
});

test('a saved live view starts with answers and members unless the link turns them off', () => {
  assert.equal(decodeLiveCascade(new URLSearchParams('s=any&r=1&c=CIEL%3A163731&cascade=union'), false), true);
  assert.equal(decodeLiveCascade(new URLSearchParams('s=any&r=1&c=CIEL%3A163731&lc=0'), true), false);
  assert.equal(decodeLiveCascade(new URLSearchParams('s=3&r=1'), false), false);
});
