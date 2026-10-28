import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expand, indexGraph, PRESETS, shortLabel } from '../app/engine.js';
import { SCENARIOS } from '../app/scenarios.js';

const graph = indexGraph(JSON.parse(readFileSync(new URL('../data/snapshot.json', import.meta.url))));
const labels = (urls) => urls.map(shortLabel).sort();
const membersOf = (scenario, options) => labels(expand(graph, scenario.reference, options).members.map((m) => m.url));

for (const scenario of SCENARIOS) {
  for (const [preset, expected] of Object.entries(scenario.expected)) {
    test(`scenario ${scenario.id}, ${PRESETS[preset].label}: matches the wiki`, () => {
      assert.deepEqual(membersOf(scenario, PRESETS[preset].options), labels(expected));
    });
  }

  test(`scenario ${scenario.id}, OCL today: nothing in the collection, so the expansion is pure CIEL`, () => {
    const members = expand(graph, scenario.reference, PRESETS.today.options).members;
    assert.ok(members.length > 0);
    assert.ok(members.every((m) => m.url.startsWith('/orgs/CIEL/')), members.map((m) => shortLabel(m.url)).join(' '));
  });

  test(`scenario ${scenario.id}, draft defaults: no concept appears with its equivalent`, () => {
    const result = expand(graph, scenario.reference, PRESETS.draft.options);
    const urls = new Set(result.members.map((m) => m.url));
    for (const member of result.members) {
      if (member.replaced) assert.ok(!urls.has(member.replaced), `${shortLabel(member.replaced)} and ${shortLabel(member.url)}`);
    }
  });
}

test("Rule 1: none of its clauses changes the five scenarios' results", () => {
  for (const scenario of SCENARIOS) {
    const draft = membersOf(scenario, PRESETS.draft.options);
    for (const change of [{ retired: 'count' }, { direction: 'higher' }]) {
      assert.deepEqual(membersOf(scenario, { ...PRESETS.draft.options, ...change }), draft, `${scenario.id} ${JSON.stringify(change)}`);
    }
  }
});

// A made-up graph for the cases the real data doesn't have: ties, one-way mappings, retired mappings.
const concept = (source, code) => `/orgs/${source}/sources/${source}/concepts/${code}/`;
const sameAs = (holder, from, to, retired = false) => ({
  url: `/orgs/${holder}/sources/${holder}/mappings/${from.split('/')[6]}-${to.split('/')[6]}/`,
  holder: `/orgs/${holder}/sources/${holder}/`, mapType: 'SAME-AS', from, to, retired,
});
const made = (mappings) => ({
  concepts: Object.fromEntries([concept('CIEL', 1), concept('PIH', 10), concept('PIH', 11)].map((url) => [url, { url, name: url }])),
  mappings,
});
const resultFor = (g, options) => expand(g, { concept: concept('CIEL', 1), cascade: false }, { ...PRESETS.draft.options, ...options });

test('Rule 2: two equivalents in one source are a tie', () => {
  const g = made([sameAs('PIH', concept('PIH', 11), concept('CIEL', 1)), sameAs('PIH', concept('PIH', 10), concept('CIEL', 1))]);
  const kept = resultFor(g, { tie: 'keep' }).members[0];
  assert.equal(shortLabel(kept.url), 'CIEL:1');
  assert.equal(kept.flags[0].kind, 'tie');
  assert.equal(shortLabel(resultFor(g, { tie: 'lowest' }).members[0].url), 'PIH:10');
});

test('Rule 1: a mapping stored only in the lower-ranked source counts unless direction is "higher"', () => {
  const g = made([sameAs('CIEL', concept('CIEL', 1), concept('PIH', 10))]);
  assert.equal(shortLabel(resultFor(g, { direction: 'either' }).members[0].url), 'PIH:10');
  assert.equal(shortLabel(resultFor(g, { direction: 'lower' }).members[0].url), 'PIH:10');
  assert.equal(shortLabel(resultFor(g, { direction: 'higher' }).members[0].url), 'CIEL:1');
});

test('Rule 1: a retired mapping counts only when retired mappings are counted', () => {
  const g = made([sameAs('PIH', concept('PIH', 10), concept('CIEL', 1), true)]);
  assert.equal(shortLabel(resultFor(g, { retired: 'ignore' }).members[0].url), 'CIEL:1');
  assert.equal(shortLabel(resultFor(g, { retired: 'count' }).members[0].url), 'PIH:10');
});

test('Rule 4: leaving mappings as stored drops the answers of a question that was not replaced', () => {
  const scenario = SCENARIOS.find((s) => s.id === '1');
  const result = expand(graph, scenario.reference, { ...PRESETS.draft.options, answers: 'leave' });
  assert.ok(result.mappings.length === 3 && result.mappings.every((m) => m.status === 'dangling'));
  const repointed = expand(graph, scenario.reference, PRESETS.draft.options);
  assert.ok(repointed.mappings.every((m) => m.status === 'repointed'));
});

test('Rule 5: a rewritten reference is saved as the replacement', () => {
  const scenario = SCENARIOS.find((s) => s.id === '3');
  const result = expand(graph, scenario.reference, { ...PRESETS.draft.options, reference: 'rewrite' });
  assert.equal(shortLabel(result.reference.stored), 'PIH:2545');
  assert.equal(shortLabel(expand(graph, scenario.reference, PRESETS.draft.options).reference.stored), 'CIEL:163731');
});

test('Rule 6: blocking the reference adds nothing', () => {
  const scenario = SCENARIOS.find((s) => s.id === '5');
  const result = expand(graph, scenario.reference, { ...PRESETS.draft.options, adding: 'block' });
  assert.equal(result.members.length, 0);
  assert.equal(result.adding.kind, 'block');
});

test('Ranked list swapped: CIEL ranks first, so a CIEL reference expands as pure CIEL', () => {
  const scenario = SCENARIOS.find((s) => s.id === '3');
  const result = expand(graph, scenario.reference, { ...PRESETS.draft.options, ranked: 'CIEL>PIH' });
  assert.ok(result.members.every((m) => m.url.startsWith('/orgs/CIEL/')));
});
