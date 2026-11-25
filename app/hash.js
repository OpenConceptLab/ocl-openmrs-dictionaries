// The options part of the page address. Links made before round 1 carry no `r`: their rule settings are
// read against the earlier draft and their comparison is kept, so an old link still opens the view it saved.
import { RULES, PRESETS, DEFAULT_OPTIONS } from './engine.js';

export const ROUND = '1';

// compare: a preset key, 'none' when someone chose no comparison, or null when nobody chose.
export function decodeOptions(params) {
  const legacy = params.has('s') && params.get('r') !== ROUND;
  const options = { ...(legacy ? PRESETS.draft.options : DEFAULT_OPTIONS) };
  for (const rule of RULES) {
    const value = params.get(rule.key);
    if (rule.options.some((option) => option.value === value)) options[rule.key] = value;
  }
  const cmp = params.get('cmp') || '';
  const compare = cmp === 'none' || Object.hasOwn(PRESETS, cmp) ? cmp : legacy ? 'none' : null;
  return { options, compare };
}

// "Try another concept" reads with or without answers and members: `lc=0`, or `cascade=0` in links made
// before it had its own parameter (`cascade` is also Rule 3's key, whose values are words).
export function decodeLiveCascade(params, current) {
  if (params.has('lc')) return params.get('lc') !== '0';
  if (['0', '1'].includes(params.get('cascade'))) return params.get('cascade') !== '0';
  return current;
}

export function encodeOptions(params, options, compare) {
  params.set('r', ROUND);
  for (const rule of RULES) {
    if (options[rule.key] !== DEFAULT_OPTIONS[rule.key]) params.set(rule.key, options[rule.key]);
  }
  if (compare) params.set('cmp', compare);
}
