// Reads concepts and mappings from the OCL API into the graph the engine works on.
// The snapshot script (scripts/snapshot.mjs) and the page's "Any concept" mode both use fetchGraph.

import { STRUCTURAL_MAP_TYPES, EQUIVALENCY_MAP_TYPES, sourceOf, sourceName, codeOf } from './engine.js';

export const DEFAULT_API = 'https://api.openconceptlab.org';
const KEPT_MAP_TYPES = [...STRUCTURAL_MAP_TYPES, ...EQUIVALENCY_MAP_TYPES];
const PAGE_SIZE = 500;

function toConcept(raw, url) {
  return {
    url,
    code: raw.id,
    name: raw.display_name,
    class: raw.concept_class,
    datatype: raw.datatype,
    retired: Boolean(raw.retired),
  };
}

function toMapping(raw) {
  return {
    url: raw.url,
    holder: sourceOf(raw.url),
    mapType: raw.map_type,
    from: raw.from_concept_url,
    to: raw.to_concept_url || null,
    toCode: raw.to_concept_code,
    toSource: raw.to_source_url,
    retired: Boolean(raw.retired),
    sortWeight: raw.sort_weight ?? null,
  };
}

export class ApiError extends Error {
  constructor(status, url, detail) {
    super(`OCL API ${status} for ${url}${detail ? `: ${detail}` : ''}`);
    this.status = status;
  }
}

// roots: concept URLs to start from. sources: the ranked source URLs.
// Collects every concept the rules could reach under any option: the cascade in each concept's own
// source, and the SAME-AS equivalents in the other ranked sources, with their cascades in turn.
export async function fetchGraph({
  roots, sources, token, api = DEFAULT_API, cascade = true, onProgress = () => {},
  concurrency = 6, maxConcepts = 600, fetchImpl = globalThis.fetch,
}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Token ${token}`;

  async function get(path) {
    const response = await fetchImpl(`${api}${path}`, { headers });
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json()).detail || ''; } catch { /* not JSON */ }
      throw new ApiError(response.status, path, detail);
    }
    return response.json();
  }

  async function getAll(path) {
    const results = [];
    for (let page = 1; ; page += 1) {
      const batch = await get(`${path}&limit=${PAGE_SIZE}&page=${page}`);
      results.push(...batch);
      if (batch.length < PAGE_SIZE) return results;
    }
  }

  const concepts = {};
  const mappings = new Map();
  const queued = new Set();
  const queue = [];
  let done = 0;

  const enqueue = (url) => {
    if (!url || queued.has(url) || !sources.includes(sourceOf(url))) return;
    if (queued.size >= maxConcepts) throw new Error(`Stopped after ${maxConcepts} concepts; this cascade is too large for the prototype.`);
    queued.add(url);
    queue.push(url);
  };
  const keep = (raw) => {
    if (!KEPT_MAP_TYPES.includes(raw.map_type)) return null;
    const mapping = toMapping(raw);
    mappings.set(mapping.url, mapping);
    return mapping;
  };

  async function visit(url) {
    try {
      concepts[url] = toConcept(await get(url), url);
    } catch (error) {
      if (error.status === 404) {
        concepts[url] = { url, code: codeOf(url), name: '(not found)', missing: true };
        return;
      }
      throw error;
    }
    const own = sourceOf(url);
    for (const raw of await getAll(`${url}mappings/?includeRetired=true`)) {
      const mapping = keep(raw);
      if (!mapping || !mapping.to) continue;
      if (EQUIVALENCY_MAP_TYPES.includes(mapping.mapType)) enqueue(mapping.to);
      else if (cascade && !mapping.retired) enqueue(mapping.to);
    }
    for (const other of sources) {
      if (other === own) continue;
      const query = new URLSearchParams({
        mapType: EQUIVALENCY_MAP_TYPES.join(','), toConceptSource: sourceName(own), toConcept: codeOf(url),
        includeRetired: 'true', verbose: 'true',
      });
      for (const raw of await getAll(`${other}mappings/?${query}`)) {
        // The search index can return mappings that no longer point here; keep exact matches only.
        if (raw.to_concept_url !== url) continue;
        const mapping = keep(raw);
        if (mapping) enqueue(mapping.from);
      }
    }
  }

  roots.forEach(enqueue);
  let failed = false;
  while (queue.length) {
    const batch = queue.splice(0, concurrency);
    await Promise.all(batch.map(async (url) => {
      await visit(url).catch((error) => { failed = true; throw error; });
      if (failed) return; // a sibling failed while this one was in flight: report no more progress
      done += 1;
      onProgress({ done, total: queued.size });
    }));
  }

  return {
    concepts,
    mappings: [...mappings.values()].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0)),
  };
}
