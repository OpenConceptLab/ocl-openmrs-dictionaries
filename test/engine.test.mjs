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
  const edges = (options) => expand(graph, scenario.reference, options).tree.children.flatMap((child) => child.edges);
  const left = edges({ ...PRESETS.draft.options, answers: 'leave' });
  assert.ok(left.length === 3 && left.every((edge) => edge.status === 'dangling'));
  assert.ok(edges(PRESETS.draft.options).every((edge) => edge.status === 'repointed'));
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

test('Rule 3 union: a child that is both a set member and an answer on the referenced side keeps both', () => {
  const g = made([sameAs('PIH', concept('PIH', 10), concept('CIEL', 1))]);
  g.concepts[concept('CIEL', 2)] = { url: concept('CIEL', 2), name: 'child' };
  for (const mapType of ['CONCEPT-SET', 'Q-AND-A']) {
    g.mappings.push({ url: `/orgs/CIEL/sources/CIEL/mappings/${mapType}/`, holder: '/orgs/CIEL/sources/CIEL/', mapType, from: concept('CIEL', 1), to: concept('CIEL', 2), retired: false });
  }
  const tree = expand(g, { concept: concept('CIEL', 1), cascade: true }, { ...PRESETS.draft.options, cascade: 'union' }).tree;
  assert.equal(shortLabel(tree.url), 'PIH:10');
  assert.deepEqual(tree.children[0].edges.map((edge) => edge.mapping.mapType), ['CONCEPT-SET', 'Q-AND-A']);
});

test('Rule 3 union: two referenced children with one replacement both keep their descendants', () => {
  const g = made([sameAs('PIH', concept('PIH', 10), concept('CIEL', 1))]);
  for (const code of [2, 3, 4]) g.concepts[concept('CIEL', code)] = { url: concept('CIEL', code), name: `CIEL ${code}` };
  g.concepts[concept('PIH', 20)] = { url: concept('PIH', 20), name: 'PIH 20' };
  const link = (mapType, from, to) => ({ url: `${from}${mapType}-${to.split('/')[6]}/`, holder: from.slice(0, from.indexOf('concepts/')), mapType, from, to, retired: false });
  g.mappings.push(
    sameAs('PIH', concept('PIH', 20), concept('CIEL', 2)), sameAs('PIH', concept('PIH', 20), concept('CIEL', 3)),
    link('CONCEPT-SET', concept('CIEL', 1), concept('CIEL', 2)), link('CONCEPT-SET', concept('CIEL', 1), concept('CIEL', 3)),
    link('Q-AND-A', concept('CIEL', 3), concept('CIEL', 4)),
  );
  const result = expand(g, { concept: concept('CIEL', 1), cascade: true }, { ...PRESETS.draft.options, cascade: 'union', tie: 'lowest' });
  assert.deepEqual(result.members.map((m) => shortLabel(m.url)), ['PIH:10', 'PIH:20', 'CIEL:4']);
});

test('Rules 5 and 6 still see the equivalent when the expansion leaves such concepts out', () => {
  const scenario = SCENARIOS.find((s) => s.id === '5');
  const omit = { ...PRESETS.draft.options, substitution: 'omit' };
  const rewritten = expand(graph, scenario.reference, { ...omit, reference: 'rewrite' });
  assert.equal(shortLabel(rewritten.reference.stored), 'PIH:1065');
  assert.deepEqual(rewritten.members.map((m) => shortLabel(m.url)), ['PIH:1065']);
  assert.equal(expand(graph, scenario.reference, { ...omit, adding: 'block' }).adding.kind, 'block');
  assert.equal(expand(graph, scenario.reference, omit).members.length, 0);
});

test('Rule 1: a retired original has no equivalents unless retired concepts are counted', () => {
  const g = made([sameAs('PIH', concept('PIH', 10), concept('CIEL', 1))]);
  g.concepts[concept('CIEL', 1)].retired = true;
  assert.equal(shortLabel(resultFor(g, { retired: 'ignore' }).members[0].url), 'CIEL:1');
  assert.equal(shortLabel(resultFor(g, { retired: 'count' }).members[0].url), 'PIH:10');
});

test('Ranked list swapped: CIEL ranks first, so a CIEL reference expands as pure CIEL', () => {
  const scenario = SCENARIOS.find((s) => s.id === '3');
  const result = expand(graph, scenario.reference, { ...PRESETS.draft.options, ranked: 'CIEL>PIH' });
  assert.ok(result.members.every((m) => m.url.startsWith('/orgs/CIEL/')));
});
