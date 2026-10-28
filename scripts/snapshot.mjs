// Rebuilds data/snapshot.json, the stored copy of every concept and mapping the five scenarios can reach.
// Usage: OCL_API_TOKEN=<your token> node scripts/snapshot.mjs [--api https://api.openconceptlab.org]

import { writeFile } from 'node:fs/promises';
import { fetchGraph, DEFAULT_API } from '../app/data.js';
import { SCENARIOS } from '../app/scenarios.js';
import { SOURCES, EQUIVALENCY_MAP_TYPES, sourceOf } from '../app/engine.js';

const apiFlag = process.argv.indexOf('--api');
const api = apiFlag > -1 ? process.argv[apiFlag + 1] : DEFAULT_API;
const token = process.env.OCL_API_TOKEN;
if (!token) {
  console.error('Set OCL_API_TOKEN to your OCL API token (from your OCL account settings).');
  process.exit(1);
}

const graph = await fetchGraph({
  roots: SCENARIOS.map((scenario) => scenario.reference.concept),
  sources: Object.values(SOURCES),
  token,
  api,
  onProgress: ({ done, total }) => process.stderr.write(`\r${done}/${total} concepts`),
});
process.stderr.write('\n');

const sorted = Object.fromEntries(Object.keys(graph.concepts).sort().map((url) => [url, graph.concepts[url]]));
// Only SAME-AS mappings between two different ranked sources can make concepts equivalent (Rule 1).
const ranked = Object.values(SOURCES);
const usable = graph.mappings.filter((m) => !EQUIVALENCY_MAP_TYPES.includes(m.mapType)
  || (ranked.includes(sourceOf(m.from)) && ranked.includes(sourceOf(m.to)) && sourceOf(m.from) !== sourceOf(m.to)));
const snapshot = {
  generated: new Date().toISOString().slice(0, 10),
  api,
  repoVersions: 'HEAD',
  sources: Object.values(SOURCES),
  concepts: sorted,
  mappings: usable,
};
await writeFile(new URL('../data/snapshot.json', import.meta.url), `${JSON.stringify(snapshot, null, 1)}\n`);
console.log(`Wrote ${Object.keys(sorted).length} concepts and ${usable.length} mappings to data/snapshot.json`);
