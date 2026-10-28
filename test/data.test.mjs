import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchGraph, ApiError } from '../app/data.js';

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
