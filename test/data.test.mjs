import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchGraph, ApiError, parseConcept, safePath } from '../app/data.js';

const CIEL = '/orgs/CIEL/sources/CIEL/';
const PIH = '/orgs/PIH/sources/PIH/';
const ok = (body, delay = 0) => new Promise((resolve) => setTimeout(() => resolve({ ok: true, status: 200, json: async () => body }), delay));
const fail = (status) => Promise.resolve({ ok: false, status, json: async () => ({ detail: 'unavailable' }) });

// A root concept with two answers: reading the first answer fails at once, the second succeeds later.
function stubFetch(url) {
  const path = url.replace('https://api.test', '');
  if (path === `${CIEL}concepts/1/`) return ok({ id: '1', display_name: 'Question' });
  if (path.startsWith(`${CIEL}concepts/1/mappings/`)) {
    return ok(['2', '3'].map((code) => ({
      url: `${CIEL}mappings/${code}/`, map_type: 'Q-AND-A', from_concept_url: `${CIEL}concepts/1/`, to_concept_url: `${CIEL}concepts/${code}/`,
    })));
  }
  if (path === `${CIEL}concepts/2/`) return fail(503);
  if (path === `${CIEL}concepts/3/`) return ok({ id: '3', display_name: 'Answer' }, 30);
  return ok([], 30);
}

test('fetchGraph reports no progress after a request fails', async () => {
  let failedAt = null;
  const late = [];
  const onProgress = (progress) => { if (failedAt) late.push(progress); };
  await assert.rejects(
    fetchGraph({ roots: [`${CIEL}concepts/1/`], sources: [PIH, CIEL], api: 'https://api.test', fetchImpl: stubFetch, onProgress })
      .catch((error) => { failedAt = Date.now(); throw error; }),
    (error) => error instanceof ApiError && error.status === 503,
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(late, []);
});

test('parseConcept accepts CIEL and PIH concepts and refuses anything that could reach another API path', () => {
  assert.equal(parseConcept('CIEL:163731'), `${CIEL}concepts/163731/`);
  assert.equal(parseConcept('pih:2545'), `${PIH}concepts/2545/`);
  assert.equal(parseConcept('https://app.v3.openconceptlab.org/#/orgs/PIH/sources/PIH/concepts/2545/'), `${PIH}concepts/2545/`);
  for (const input of ['CIEL:163731\\..\\..\\HEAD\\resources-checksums', 'CIEL:..', 'CIEL:%2e%2e', 'CIEL:1?x=1', `${CIEL}concepts/../../HEAD/`, 'SNOMED:123']) {
    assert.equal(parseConcept(input), null, input);
  }
});

test('fetchGraph never requests a path a browser would rewrite, even when OCL content contains one', async () => {
  assert.equal(safePath(`${CIEL}concepts/%2e%2e/%2e%2e/HEAD/`), false);
  const requested = [];
  const fetchImpl = (url) => {
    requested.push(url.replace('https://api.test', ''));
    if (url.endsWith(`${CIEL}concepts/1/`)) return ok({ id: '1', display_name: 'Question' });
    if (url.includes(`${CIEL}concepts/1/mappings/`)) {
      return ok([{ url: `${CIEL}mappings/9/`, map_type: 'Q-AND-A', from_concept_url: `${CIEL}concepts/1/`, to_concept_url: `${CIEL}concepts/..\\..\\HEAD/` }]);
    }
    return ok([]);
  };
  await fetchGraph({ roots: [`${CIEL}concepts/1/`], sources: [PIH, CIEL], api: 'https://api.test', fetchImpl });
  assert.ok(requested.every((path) => safePath(path, 'https://api.test')), requested.join(' '));
  assert.ok(!requested.some((path) => path.includes('HEAD')));
});
