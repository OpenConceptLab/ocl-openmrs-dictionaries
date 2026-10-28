// The prototype page: rule options, scenario tabs, results, and the live "Any concept" mode.
// State lives in the URL hash, so a link opens the same scenario with the same options.

import { RULES, PRESETS, DEFAULT_OPTIONS, SOURCES, expand, indexGraph, sourceOf, sourceName, codeOf, shortLabel } from './engine.js';
import { SCENARIOS } from './scenarios.js';
import { fetchGraph, ApiError } from './data.js';

const TBV3 = 'https://app.v3.openconceptlab.org/#';
const TOKEN_KEY = 'ocl-openmrs-dictionaries.token';
const ANY = 'any';

const state = {
  scenario: SCENARIOS[0].id,
  options: { ...DEFAULT_OPTIONS },
  compare: '',
  // The token stays in page memory between renders; it's written to localStorage only while "Remember" is ticked.
  live: { concept: '', cascade: true, token: '', remember: false, graph: null, root: null, fetchedCascade: true, error: '', progress: '' },
};
let snapshot = null;
let snapshotInfo = null;

// --- small DOM helper: text only, never HTML ---
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const storage = {
  get(key) { try { return localStorage.getItem(key) || ''; } catch { return ''; } },
  set(key, value) { try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch { /* unavailable */ } },
};

// --- URL state ---
function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const scenario = params.get('s');
  if (scenario === ANY || SCENARIOS.some((s) => s.id === scenario)) state.scenario = scenario;
  const preset = params.get('preset');
  state.options = { ...(PRESETS[preset] ? PRESETS[preset].options : DEFAULT_OPTIONS) };
  for (const rule of RULES) {
    const value = params.get(rule.key);
    if (rule.options.some((option) => option.value === value)) state.options[rule.key] = value;
  }
  state.compare = PRESETS[params.get('cmp')] ? params.get('cmp') : '';
  if (params.has('c')) state.live.concept = params.get('c');
  if (params.has('cascade')) state.live.cascade = params.get('cascade') !== '0';
}

function writeHash() {
  const params = new URLSearchParams({ s: state.scenario });
  for (const rule of RULES) {
    if (state.options[rule.key] !== DEFAULT_OPTIONS[rule.key]) params.set(rule.key, state.options[rule.key]);
  }
  if (state.compare) params.set('cmp', state.compare);
  if (state.scenario === ANY && state.live.concept) {
    params.set('c', state.live.concept);
    if (!state.live.cascade) params.set('cascade', '0');
  }
  history.replaceState(null, '', `#${params}`);
}

function presetMatching(options) {
  return Object.keys(PRESETS).find((key) => RULES.every((rule) => PRESETS[key].options[rule.key] === options[rule.key])) || '';
}

// --- controls ---
function renderControls() {
  const presetSelect = document.getElementById('preset');
  const current = presetMatching(state.options);
  presetSelect.replaceChildren(
    ...Object.entries(PRESETS).map(([key, preset]) => h('option', { value: key, selected: key === current }, preset.label)),
    h('option', { value: '', selected: !current, disabled: true }, 'Custom'),
  );
  presetSelect.onchange = () => {
    state.options = { ...PRESETS[presetSelect.value].options };
    update();
  };

  const compareSelect = document.getElementById('compare');
  compareSelect.replaceChildren(
    h('option', { value: '' }, 'Nothing'),
    ...Object.entries(PRESETS).map(([key, preset]) => h('option', { value: key, selected: key === state.compare }, preset.label)),
  );
  compareSelect.onchange = () => {
    state.compare = compareSelect.value;
    update();
  };

  const rules = document.getElementById('rules');
  rules.replaceChildren(...RULES.map((rule) => {
    const select = h('select', { id: `rule-${rule.key}`, onchange: (event) => { state.options[rule.key] = event.target.value; update(); } },
      ...rule.options.map((option) => h('option', { value: option.value, selected: option.value === state.options[rule.key] }, option.label)));
    const changed = state.options[rule.key] !== DEFAULT_OPTIONS[rule.key];
    return h('label', { class: `field${changed ? ' field--changed' : ''}`, for: `rule-${rule.key}`, title: rule.help },
      h('span', {}, rule.rule ? h('span', { class: 'rule-number' }, `Rule ${rule.rule} · `) : null, rule.label),
      select);
  }));

  const toggle = document.getElementById('toggle-rules');
  const changedCount = RULES.filter((rule) => state.options[rule.key] !== DEFAULT_OPTIONS[rule.key]).length;
  toggle.textContent = rules.hidden ? `Show rules${changedCount ? ` (${changedCount} changed)` : ''}` : 'Hide rules';
  toggle.onclick = () => {
    rules.hidden = !rules.hidden;
    toggle.setAttribute('aria-expanded', String(!rules.hidden));
    renderControls();
  };
}

function renderTabs() {
  const tabs = document.getElementById('tabs');
  const entries = [...SCENARIOS.map((s) => [s.id, `Scenario ${s.id}`]), [ANY, 'Any concept']];
  tabs.replaceChildren(...entries.map(([id, label]) => h('a', {
    href: `#s=${id}`,
    'aria-current': state.scenario === id ? 'page' : null,
    onclick: (event) => { event.preventDefault(); state.scenario = id; update(); },
  }, label)));
}

// --- results ---
const conceptLink = (url) => `${TBV3}${url}`;

function sourceChip(url) {
  const name = sourceName(sourceOf(url));
  const known = Object.keys(SOURCES).includes(name);
  return h('span', { class: `chip ${known ? `chip--${name}` : 'chip--other'}` }, name);
}

function conceptLabel(graph, url) {
  const concept = graph.concepts[url];
  return [
    sourceChip(url),
    h('a', { class: 'code', href: conceptLink(url), target: '_blank', rel: 'noopener' }, codeOf(url)),
    h('span', { class: 'name' }, concept ? concept.name : '(not in the data)'),
    concept && concept.class ? h('span', { class: 'class' }, concept.class) : null,
  ];
}

const EDGE_LABEL = { 'Q-AND-A': 'answer', 'CONCEPT-SET': 'member' };

function renderNode(graph, node, onlyHere) {
  const edges = node.edges;
  const edgeLabel = [...new Set(edges.map((e) => EDGE_LABEL[e.mapping.mapType] || e.mapping.mapType))].join(', ');
  const stored = (status) => [...new Set(edges.filter((e) => e.status === status).map((e) => `${shortLabel(e.mapping.from)} → ${shortLabel(e.mapping.to)}`))].join('; ');
  const badges = [];
  if (node.status === 'replaced') badges.push(h('span', { class: 'badge badge--replaced', title: `SAME-AS mapping stored in ${sourceName(node.resolution.via.holder)}` }, `replaces ${shortLabel(node.original)}`));
  if (node.status === 'omitted') badges.push(h('span', { class: 'badge' }, `left out: ${shortLabel(node.resolution.equivalent)} ranks higher`));
  for (const flag of (node.resolution.flags || [])) {
    if (flag.kind === 'tie') badges.push(h('span', { class: 'badge badge--tie' }, `tie: ${flag.candidates.map(shortLabel).join(', ')}`));
  }
  if (stored('repointed')) badges.push(h('span', { class: 'badge badge--repointed', title: 'Rule 4' }, `re-pointed from ${stored('repointed')}`));
  if (stored('dangling')) badges.push(h('span', { class: 'badge badge--missing', title: 'Rule 4' }, `not linked in OpenMRS: stored as ${stored('dangling')}`));
  if (node.repeat) badges.push(h('span', { class: 'badge' }, 'listed above'));
  const only = node.url && onlyHere && onlyHere.has(node.url) && !node.repeat;
  if (only) badges.push(h('span', { class: 'badge badge--only' }, 'only on this side'));

  const shown = node.url || node.original;
  const classes = ['node', `node--${node.status}`, node.repeat ? 'node--repeat' : '', only ? 'node--only' : ''].filter(Boolean).join(' ');
  return h('li', { class: classes },
    h('div', { class: 'row' },
      edgeLabel ? h('span', { class: 'edge' }, edgeLabel) : null,
      ...conceptLabel(graph, shown),
      ...badges),
    node.children.length ? h('ul', {}, ...node.children.map((child) => renderNode(graph, child, onlyHere))) : null);
}

function resultCard(graph, reference, options, heading, onlyHere) {
  const result = expand(graph, reference, options);
  const members = result.members;
  const bySource = Object.keys(SOURCES).map((name) => [name, members.filter((m) => sourceName(sourceOf(m.url)) === name).length]);
  const replaced = members.filter((m) => m.replaced).length;
  const written = h('span', { class: 'inline-concept' }, ...conceptLabel(graph, reference.concept), reference.cascade ? 'with cascade' : null);
  const stored = result.reference.stored && result.reference.stored !== reference.concept
    ? h('span', { class: 'inline-concept' }, ...conceptLabel(graph, result.reference.stored), reference.cascade ? 'with cascade' : null)
    : null;

  return { result, card: h('article', { class: 'card' },
    h('h3', {}, heading),
    h('dl', { class: 'card__meta' },
      h('div', {}, h('dt', {}, 'Reference as written'), h('dd', {}, written)),
      stored ? h('div', {}, h('dt', {}, 'Saved in the collection as (Rule 5)'), h('dd', {}, stored)) : null,
      h('div', {}, h('dt', {}, 'When someone adds it (Rule 6)'), h('dd', {}, h('div', { class: `message message--${result.adding.kind}` }, result.adding.text)))),
    h('p', { class: 'counts' }, members.length
      ? `${members.length} concepts in the expansion · ${bySource.map(([name, n]) => `${n} ${name}`).join(' · ')} · ${replaced} replaced`
      : 'Nothing in the expansion'),
    result.tree ? h('ul', { class: 'tree' }, renderNode(graph, result.tree, onlyHere)) : null,
    h('details', { class: 'trace' },
      h('summary', {}, `Why: ${result.trace.length} decisions`),
      h('ol', {}, ...result.trace.map((line) => h('li', {}, line))))) };
}

function renderResults(graph, reference) {
  const container = h('div', { class: `results${state.compare ? ' results--compare' : ''}` });
  const mineLabel = presetMatching(state.options) ? PRESETS[presetMatching(state.options)].label : 'Your options';
  if (!state.compare) {
    container.append(resultCard(graph, reference, state.options, mineLabel).card);
    return container;
  }
  const other = PRESETS[state.compare];
  const urls = (options) => new Set(expand(graph, reference, options).members.map((m) => m.url));
  const mine = urls(state.options);
  const theirs = urls(other.options);
  const onlyMine = new Set([...mine].filter((url) => !theirs.has(url)));
  const onlyTheirs = new Set([...theirs].filter((url) => !mine.has(url)));
  container.append(
    resultCard(graph, reference, state.options, mineLabel, onlyMine).card,
    resultCard(graph, reference, other.options, other.label, onlyTheirs).card,
  );
  return container;
}

function renderScenario() {
  const section = document.getElementById('scenario');
  if (state.scenario === ANY) {
    section.replaceChildren(...renderLive());
    return;
  }
  const scenario = SCENARIOS.find((s) => s.id === state.scenario);
  if (!snapshot) {
    section.replaceChildren(h('p', { class: 'notice' }, 'Loading the scenario data…'));
    return;
  }
  section.replaceChildren(
    h('div', { class: 'scenario-head' },
      h('h2', {}, `${scenario.id}. ${scenario.title}`),
      h('p', {}, scenario.summary),
      h('p', {}, h('a', { href: `https://github.com/OpenConceptLab/ocl-openmrs-dictionaries/wiki/Scenarios#scenario-${scenario.id}` }, 'This scenario on the wiki'))),
    renderResults(snapshot, scenario.reference));
}

// --- Any concept (live) ---
function parseConcept(input) {
  const text = input.trim().replace(/^.*#/, '');
  const short = /^([A-Za-z0-9_-]+):([^/\s]+)$/.exec(text);
  if (short) {
    const name = Object.keys(SOURCES).find((key) => key.toLowerCase() === short[1].toLowerCase());
    return name ? `${SOURCES[name]}concepts/${short[2]}/` : null;
  }
  const path = /^\/?(orgs|users)\/([^/]+)\/sources\/([^/]+)\/concepts\/([^/?#]+)/.exec(text.replace(/^https?:\/\/[^/]+/, ''));
  return path ? `/${path[1]}/${path[2]}/sources/${path[3]}/concepts/${path[4]}/` : null;
}

async function runLive() {
  const live = state.live;
  const root = parseConcept(live.concept);
  if (!root || !Object.values(SOURCES).includes(sourceOf(root))) {
    live.error = 'Enter a CIEL or PIH concept, e.g. CIEL:163731 or /orgs/CIEL/sources/CIEL/concepts/163731/.';
    renderScenario();
    return;
  }
  const token = live.token.trim();
  if (!token) {
    live.error = 'Paste your OCL API token first. The OCL API needs one for every request.';
    renderScenario();
    return;
  }
  storage.set(TOKEN_KEY, live.remember ? token : '');
  Object.assign(live, { error: '', progress: 'Starting…', graph: null, root: null });
  renderScenario();
  try {
    const graph = await fetchGraph({
      roots: [root], sources: Object.values(SOURCES), token, cascade: live.cascade,
      onProgress: ({ done, total }) => {
        live.progress = `Read ${done} of ${total} concepts so far…`;
        const progress = document.getElementById('live-progress');
        if (progress) progress.textContent = live.progress;
      },
    });
    Object.assign(live, { graph: indexGraph(graph), root, fetchedCascade: live.cascade, progress: '' });
  } catch (error) {
    live.progress = '';
    live.error = error instanceof ApiError && (error.status === 401 || error.status === 403)
      ? 'The OCL API refused the request. Check that the token is right and still active.'
      : `Couldn't read from the OCL API: ${error.message}`;
  }
  writeHash();
  renderScenario();
}

function renderLive() {
  const live = state.live;
  const tokenInput = h('input', { type: 'password', id: 'live-token', autocomplete: 'off', value: live.token, placeholder: 'Your OCL API token', oninput: (event) => { live.token = event.target.value; } });
  const remember = h('input', { type: 'checkbox', id: 'live-remember', checked: live.remember, onchange: (event) => {
    live.remember = event.target.checked;
    storage.set(TOKEN_KEY, live.remember ? live.token.trim() : '');
  } });
  const conceptInput = h('input', { type: 'text', id: 'live-concept', value: live.concept, placeholder: 'CIEL:163731', oninput: (event) => { live.concept = event.target.value; } });
  const cascade = h('input', { type: 'checkbox', id: 'live-cascade', checked: live.cascade, onchange: (event) => { live.cascade = event.target.checked; } });
  const go = () => runLive();

  const parts = [
    h('div', { class: 'scenario-head' },
      h('h2', {}, 'Any concept'),
      h('p', {}, 'Expand any CIEL or PIH concept under the options above, reading live from OCL. PIH and CIEL HEAD, as in the scenarios.')),
    h('p', { class: 'notice' }, 'Uses your own OCL API token (from your OCL account settings). It goes only to api.openconceptlab.org; tick “Remember” to keep it in this browser.'),
    h('form', { class: 'live-form', onsubmit: (event) => { event.preventDefault(); go(); } },
      h('label', { class: 'field', for: 'live-token' }, h('span', {}, 'OCL API token'), tokenInput),
      h('label', { class: 'field', for: 'live-concept' }, h('span', {}, 'Concept'), conceptInput),
      h('div', { class: 'actions' },
        h('label', { class: 'check', for: 'live-cascade' }, cascade, 'Cascade'),
        h('label', { class: 'check', for: 'live-remember' }, remember, 'Remember token'),
        h('button', { type: 'submit', class: 'button', disabled: Boolean(live.progress) }, 'Expand'))),
  ];
  if (live.progress) parts.push(h('p', { class: 'notice', id: 'live-progress' }, live.progress));
  if (live.error) parts.push(h('p', { class: 'notice notice--error', role: 'alert' }, live.error));
  if (live.graph && live.root) {
    // Render with the cascade setting the data was read with; a changed checkbox needs a new read.
    if (live.cascade !== live.fetchedCascade) parts.push(h('p', { class: 'notice' }, 'Cascade changed: press Expand to read the concept again.'));
    parts.push(renderResults(live.graph, { concept: live.root, cascade: live.fetchedCascade }));
  }
  return parts;
}

function renderFooter() {
  document.getElementById('footer').replaceChildren(
    snapshotInfo ? `Scenario data: a stored copy of ${snapshotInfo.concepts} concepts read from OCL (${snapshotInfo.repoVersions} of PIH and CIEL) on ${snapshotInfo.generated}. ` : '',
    h('a', { href: 'data/snapshot.json' }, 'The data'), ' · ',
    h('a', { href: 'https://github.com/OpenConceptLab/ocl-openmrs-dictionaries/wiki/Prototype' }, 'How the prototype works'));
}

function update() {
  writeHash();
  renderControls();
  renderTabs();
  renderScenario();
  renderFooter();
}

async function start() {
  readHash();
  state.live.token = storage.get(TOKEN_KEY);
  state.live.remember = Boolean(state.live.token);
  if (window.matchMedia('(max-width: 600px)').matches) document.getElementById('rules').hidden = true;
  update();
  try {
    const response = await fetch('data/snapshot.json');
    const raw = await response.json();
    snapshotInfo = { generated: raw.generated, repoVersions: raw.repoVersions, concepts: Object.keys(raw.concepts).length };
    snapshot = indexGraph(raw);
  } catch (error) {
    document.getElementById('scenario').replaceChildren(h('p', { class: 'notice notice--error' }, `Couldn't load the scenario data: ${error.message}`));
    return;
  }
  update();
}

window.addEventListener('hashchange', () => { readHash(); update(); });
start();
