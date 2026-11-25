// The prototype page: a guided start (two steps), more scenarios, the live "Try another concept" mode,
// and every rule option in a side drawer.
// State lives in the URL hash, so a link opens the same scenario with the same options.

import { RULES, PRESETS, DEFAULT_OPTIONS, SOURCES, expand, indexGraph, sourceOf, sourceName, codeOf, shortLabel } from './engine.js';
import { SCENARIOS } from './scenarios.js';
import { fetchGraph, ApiError, parseConcept } from './data.js';

const TBV3 = 'https://app.v3.openconceptlab.org/#';
// An earlier version could keep the token in localStorage, which every site on openconceptlab.github.io can
// read. The token now lives only in page memory; this key is cleared on load.
const OLD_TOKEN_KEY = 'ocl-openmrs-dictionaries.token';
const ANY = 'any';
const WIKI = 'https://github.com/OpenConceptLab/ocl-openmrs-dictionaries/wiki';

const state = {
  scenario: SCENARIOS[0].id,
  options: { ...DEFAULT_OPTIONS },
  compare: '',
  // The token stays in page memory only, and is gone when the page is reloaded or closed.
  live: { concept: '', cascade: true, token: '', graph: null, root: null, fetchedCascade: true, error: '', progress: '' },
};
let snapshot = null;

// --- plain wording for the page; the engine keeps the rule keys and values the URL uses ---
const SHORT = { 1: 'Partner HIV tested', 2: 'Problem severity', 3: 'Tobacco use status', 4: 'Visit diagnoses', '4b': 'Stool test', 5: 'Adding CIEL Yes' };
const STEPS = { 1: 'Step 1', 3: 'Step 2' };

const GROUPS = [
  { rule: null, title: 'Which source the dictionary prefers',
    meaning: 'References are always added while PIH ranks first. Swapping the order afterwards shows where Rule 5 matters.', keys: ['ranked'] },
  { rule: 1, title: 'Which concepts count as the same?',
    meaning: 'Two concepts are the same when a SAME-AS mapping links them. A shared ID number means nothing on its own.', keys: ['lookIn', 'direction', 'retired'] },
  { rule: 2, title: 'When PIH has the same concept, which one goes in?',
    meaning: "The dictionary should never hold both PIH's Yes and CIEL's Yes. Round 1: the squad agreed PIH's replaces CIEL's (Step 1).",
    proposal: "Round 1 proposal, to check with the group: a concept someone chose on purpose stays as chosen.", keys: ['substitution', 'root', 'tie'] },
  { rule: 3, title: 'When PIH has the same question, whose answers come with it?',
    meaning: "Matters when PIH's and CIEL's versions have different answers or set members (Step 2).",
    proposal: "Round 1 proposal, to check with the group: the concept someone added brings its own answers, each swapped for PIH's where PIH has one.", keys: ['cascade'] },
  { rule: 4, title: 'Do answers follow the swap?',
    meaning: "A CIEL question's answers are stored as links to CIEL concepts. When those concepts are swapped for PIH's, the links have to move too, or OpenMRS loses the answers.", keys: ['answers'] },
  { rule: 5, title: 'What does the collection keep as the reference you added?',
    meaning: 'The collection can keep what you added, or rewrite it to the preferred version.', keys: ['reference'] },
  { rule: 6, title: 'What does someone see when they add it?',
    meaning: "When someone adds a CIEL concept that PIH also has. Round 1: the squad decided OCL tells them loudly and makes them choose which one to add.", keys: ['adding', 'pick'] },
];

const FIELD = {
  ranked: 'Order', lookIn: 'Look for matches in', direction: 'Count SAME-AS mappings stored in', retired: 'Retired mappings and concepts',
  substitution: 'Which one goes in', root: 'The concept someone adds', pick: 'Which one they choose', tie: 'If PIH has two matches', cascade: 'Answers and set members', answers: 'Answer links',
  reference: 'The reference', adding: 'When someone adds it',
};

const OPTION = {
  ranked: { 'PIH>CIEL': 'PIH, then CIEL', 'CIEL>PIH': 'Swapped later to CIEL, then PIH' },
  lookIn: { sources: 'PIH and CIEL themselves', collection: 'Only what the collection already has' },
  direction: { either: 'Either source', higher: 'The preferred source only', lower: 'The other source only' },
  retired: { ignore: "Don't count", count: 'Count' },
  substitution: { replace: "PIH's replaces CIEL's", omit: "CIEL's is left out (OCL today)", off: "CIEL's stays (no equivalency)" },
  tie: { keep: "Keep CIEL's and flag it", lowest: 'Use the lowest code' },
  root: { stays: 'Stays as they chose it', swap: 'Is swapped like any other' },
  pick: { own: 'The concept they added (CIEL:…)', equivalent: "PIH's version" },
  cascade: { replacement: "The preferred version's own", referenced: "The added concept's, swapped where PIH has them", union: 'Both', stepwise: "CIEL's at the first level, then PIH's" },
  answers: { repoint: "Point to PIH's version", leave: "Stay pointed at CIEL's" },
  reference: { keep: 'What you added (CIEL:…)', rewrite: "Rewritten to PIH's version" },
  adding: { inform: 'Allow it and tell them', offer: "Offer PIH's version", block: 'Block it', silent: 'Allow it silently', choose: 'Tell them and make them choose' },
};

const PRESET_LABEL = {
  round1: 'Round 1', round1pih: "Round 1, choosing PIH's version", draft: 'Draft before round 1', today: 'OCL today',
  referenced: "Draft, with CIEL's answers swapped where PIH has them", union: 'Draft, with both sets of answers',
  stepwise: 'Draft, step by step', off: 'No swapping (no equivalency)',
};
const presetLabel = (key) => PRESET_LABEL[key] || PRESETS[key].label;
const optionLabel = (rule, value) => (OPTION[rule.key] && OPTION[rule.key][value]) || rule.options.find((o) => o.value === value).label;
const changedRules = () => RULES.filter((rule) => state.options[rule.key] !== DEFAULT_OPTIONS[rule.key]);

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


// --- URL state ---
function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const scenario = params.get('s');
  if (scenario === ANY || SCENARIOS.some((s) => s.id === scenario)) state.scenario = scenario;
  state.options = { ...DEFAULT_OPTIONS };
  for (const rule of RULES) {
    const value = params.get(rule.key);
    if (rule.options.some((option) => option.value === value)) state.options[rule.key] = value;
  }
  state.compare = Object.hasOwn(PRESETS, params.get('cmp') || '') ? params.get('cmp') : '';
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

// --- controls: the rules drawer and the scenario tabs ---
function setDrawer(open) {
  document.getElementById('drawer').hidden = !open;
  document.body.classList.toggle('drawer-open', open);
  document.getElementById('toggle-rules').setAttribute('aria-expanded', String(open));
}

function renderControls() {
  const presetSelect = document.getElementById('preset');
  const current = presetMatching(state.options);
  presetSelect.replaceChildren(
    ...Object.keys(PRESETS).map((key) => h('option', { value: key, selected: key === current }, presetLabel(key))),
    h('option', { value: '', selected: !current, disabled: true }, 'Custom'),
  );
  presetSelect.onchange = () => {
    state.options = { ...PRESETS[presetSelect.value].options };
    update();
  };

  const compareSelect = document.getElementById('compare');
  compareSelect.replaceChildren(
    h('option', { value: '' }, 'Nothing'),
    ...Object.keys(PRESETS).map((key) => h('option', { value: key, selected: key === state.compare }, presetLabel(key))),
  );
  compareSelect.onchange = () => {
    state.compare = compareSelect.value;
    update();
  };

  document.getElementById('reset-rules').onclick = () => {
    state.options = { ...DEFAULT_OPTIONS };
    state.compare = '';
    update();
  };

  const byKey = Object.fromEntries(RULES.map((rule) => [rule.key, rule]));
  document.getElementById('rules').replaceChildren(...GROUPS.map((group) => h('section', { class: 'rule-group' },
    h('h3', {}, group.rule ? h('span', { class: 'rule-number' }, `Rule ${group.rule} · `) : null, group.title),
    h('p', { class: 'rule-meaning' }, group.meaning),
    group.proposal ? h('p', { class: 'rule-proposal' }, group.proposal) : null,
    ...group.keys.map((key) => {
      const rule = byKey[key];
      const select = h('select', { id: `rule-${key}`, onchange: (event) => { state.options[key] = event.target.value; update(); } },
        ...rule.options.map((option) => h('option', { value: option.value, selected: option.value === state.options[key] },
          `${optionLabel(rule, option.value)}${option.value === DEFAULT_OPTIONS[key] ? ' (round 1)' : ''}`)));
      const changed = state.options[key] !== DEFAULT_OPTIONS[key];
      return h('label', { class: `field${changed ? ' field--changed' : ''}`, for: `rule-${key}`, title: rule.help },
        h('span', {}, FIELD[key] || rule.label), select);
    }))));

  const changed = changedRules().length;
  const toggle = document.getElementById('toggle-rules');
  toggle.textContent = `Rules and settings · ${changed ? `${changed} changed` : 'all at round 1'}`;
  toggle.classList.toggle('button--changed', Boolean(changed));
  toggle.onclick = () => setDrawer(document.getElementById('drawer').hidden);
  document.getElementById('close-rules').onclick = () => setDrawer(false);
}

function renderTabs() {
  const tab = (id, label) => h('a', {
    href: `#s=${id}`,
    class: STEPS[id] ? 'tab--step' : null,
    'aria-current': state.scenario === id ? 'page' : null,
    onclick: (event) => { event.preventDefault(); state.scenario = id; update(); window.scrollTo(0, 0); },
  }, label);
  document.getElementById('tabs').replaceChildren(
    ...SCENARIOS.filter((s) => STEPS[s.id]).map((s) => tab(s.id, `${STEPS[s.id]} · ${SHORT[s.id]}`)),
    h('span', { class: 'tabs__divider' }, 'More scenarios'),
    ...SCENARIOS.filter((s) => !STEPS[s.id]).map((s) => tab(s.id, `${s.id} · ${SHORT[s.id]}`)),
    tab(ANY, 'Try another concept'));
}

// --- results ---

function sourceChip(url) {
  const name = sourceName(sourceOf(url));
  const known = Object.keys(SOURCES).includes(name);
  return h('span', { class: `chip ${known ? `chip--${name}` : 'chip--other'}` }, name);
}

function conceptLabel(graph, url) {
  const concept = graph.concepts[url];
  return [
    sourceChip(url),
    h('a', { class: 'code', href: `${TBV3}${url}`, target: '_blank', rel: 'noopener' }, codeOf(url)),
    h('span', { class: 'name' }, concept ? concept.name : '(not in the data)'),
    concept && concept.class ? h('span', { class: 'class' }, concept.class) : null,
  ];
}

const EDGE_LABEL = { 'Q-AND-A': 'answer', 'CONCEPT-SET': 'member' };

function renderNode(graph, node, onlyHere) {
  const edges = node.edges;
  const edgeLabel = [...new Set(edges.map((e) => EDGE_LABEL[e.mapping.mapType] || e.mapping.mapType))].join(', ');
  const stored = (status) => [...new Set(edges.filter((e) => e.status === status).map((e) => `${shortLabel(e.mapping.from)} → ${shortLabel(e.mapping.to)}`))].join('; ');
  const here = node.url ? sourceName(sourceOf(node.url)) : '';
  const badges = [];
  if (node.status === 'replaced') badges.push(h('span', { class: 'badge badge--replaced', title: `Swapped in for ${shortLabel(node.original)}. The SAME-AS mapping is stored in ${sourceName(node.resolution.via.holder)} (Rule 2).` }, `${here}'s version of ${shortLabel(node.original)}`));
  if (node.status === 'omitted') badges.push(h('span', { class: 'badge' }, `left out: ${shortLabel(node.resolution.equivalent)} is preferred`));
  for (const flag of (node.resolution.flags || [])) {
    if (flag.kind === 'tie') badges.push(h('span', { class: 'badge badge--tie' }, `two matches: ${flag.candidates.map(shortLabel).join(', ')}`));
  }
  if (stored('repointed')) {
    const repointed = edges.filter((e) => e.status === 'repointed');
    const what = [...new Set(repointed.map((e) => EDGE_LABEL[e.mapping.mapType] || 'link'))].join(' and ');
    // Either this end was swapped (the link moves to it), or only the question's end was (the link is carried over).
    const text = repointed.some((e) => e.mapping.to !== node.url)
      ? `${what} link moved to ${here}'s`
      : `${what} link carried over from ${sourceName(sourceOf(repointed[0].mapping.from))}'s question`;
    badges.push(h('span', { class: 'badge badge--repointed', title: `Stored as ${stored('repointed')}. The dictionary uses it as pointing here (Rule 4).` }, text));
  }
  if (stored('dangling')) badges.push(h('span', { class: 'badge badge--missing', title: `Stored as ${stored('dangling')}, which isn't in the dictionary (Rule 4).` }, 'OpenMRS loses this link'));
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

function resultCard(graph, reference, result, heading, onlyHere) {
  const members = result.members;
  const bySource = Object.keys(SOURCES).map((name) => [name, members.filter((m) => sourceName(sourceOf(m.url)) === name).length]);
  const replaced = members.filter((m) => m.replaced).length;
  const written = h('span', { class: 'inline-concept' }, ...conceptLabel(graph, reference.concept), reference.cascade ? 'with its answers and members' : null);
  const stored = result.reference.stored && result.reference.stored !== reference.concept
    ? h('span', { class: 'inline-concept' }, ...conceptLabel(graph, result.reference.stored), reference.cascade ? 'with its answers and members' : null)
    : null;

  return h('article', { class: 'card' },
    h('h3', {}, heading),
    h('dl', { class: 'card__meta' },
      h('div', {}, h('dt', {}, 'You added'), h('dd', {}, written)),
      stored ? h('div', {}, h('dt', {}, 'The collection keeps it as (Rule 5)'), h('dd', {}, stored)) : null,
      h('div', {}, h('dt', {}, 'What they see when adding it (Rule 6)'), h('dd', {}, h('div', { class: `message message--${result.adding.kind}` }, result.adding.text)))),
    h('p', { class: 'counts' }, members.length
      ? `What the dictionary contains: ${members.length} concepts · ${bySource.map(([name, n]) => `${n} ${name}`).join(' · ')}`
        + (replaced ? ` · ${replaced} swapped for the preferred version` : '')
      : 'The dictionary gets nothing'),
    result.tree ? h('ul', { class: 'tree' }, renderNode(graph, result.tree, onlyHere)) : null,
    h('details', { class: 'trace' },
      h('summary', {}, `Why, step by step (${result.trace.length})`),
      h('ol', {}, ...result.trace.map((line) => h('li', {}, line)))));
}

function renderResults(graph, reference, compare = state.compare) {
  const matching = presetMatching(state.options);
  const sides = [[state.options, matching ? presetLabel(matching) : 'Your settings']];
  if (compare) sides.push([PRESETS[compare].options, presetLabel(compare)]);
  const results = sides.map(([options]) => expand(graph, reference, options));
  const urls = results.map((result) => new Set(result.members.map((m) => m.url)));
  // In a comparison, mark the concepts only one side contains.
  const onlyHere = (i) => (compare ? new Set([...urls[i]].filter((url) => !urls[1 - i].has(url))) : null);
  return h('div', { class: `results${compare ? ' results--compare' : ''}` },
    ...sides.map(([, heading], i) => resultCard(graph, reference, results[i], heading, onlyHere(i))));
}

// --- the guided steps ---

function legend() {
  return h('div', { class: 'legend' },
    h('span', {}, h('span', { class: 'chip chip--PIH' }, 'PIH'), ' ', h('span', { class: 'chip chip--CIEL' }, 'CIEL'), ' where the concept comes from'),
    h('span', {}, h('span', { class: 'badge badge--replaced' }, "PIH's version of CIEL:1066"), ' PIH has the same concept, so PIH\'s goes in instead of CIEL\'s'),
    h('span', {}, h('span', { class: 'badge badge--repointed' }, "answer link moved to PIH's"), ' the question now points to PIH\'s answer'),
    h('span', {}, h('span', { class: 'badge badge--only' }, 'only on this side'), ' in a side-by-side, what one result has and the other doesn\'t'));
}

function changedNote() {
  const changed = changedRules();
  if (!changed.length) return null;
  return h('p', { class: 'changed-note' },
    'Settings changed from round 1: ',
    changed.flatMap((rule, i) => [i ? '; ' : '', h('strong', {}, FIELD[rule.key] || rule.label), ` → ${optionLabel(rule, state.options[rule.key])}`]),
    '. ',
    h('button', { type: 'button', class: 'button button--text', onclick: () => { state.options = { ...DEFAULT_OPTIONS }; update(); } }, 'Reset'));
}

function stepOne(scenario) {
  return [
    h('div', { class: 'scenario-head' },
      h('p', { class: 'step-label' }, 'Step 1 · How to read a result'),
      h('h2', {}, 'Partner HIV tested'),
      h('p', {}, 'You add the CIEL question Partner HIV tested, with its answers. PIH doesn\'t have this question, but it does have Yes, No and Unknown.'),
      h('p', {}, 'So the dictionary keeps CIEL\'s question and uses PIH\'s Yes, No and Unknown as its answers.'),
      legend()),
    changedNote(),
    renderResults(snapshot, scenario.reference),
    h('div', { class: 'question' },
      h('p', { class: 'question__label' }, 'Round 1 · 25 Nov'),
      h('p', { class: 'question__text' }, 'Agreed: this is the right result. CIEL\'s question, with PIH\'s Yes, No and Unknown as its answers.'),
      h('p', {}, h('strong', {}, 'Still open: '), 'how OCL stores the answer links that move to PIH\'s concepts. It could work them out from the SAME-AS mappings each time, or create new PIH-owned mappings. Leaning: bring CIEL\'s own mappings into the collection, marked with the equivalency.'),
      h('p', { class: 'question__more' }, 'To compare: ',
        h('a', { href: '#s=1&cmp=off' }, 'without swapping (CIEL\'s Yes, No and Unknown)'), ' · ',
        h('a', { href: '#s=3' }, 'next: Step 2, a decision →'))),
  ];
}

const STEP_TWO_VIEWS = [
  { compare: 'round1pih', label: 'The two choices', detail: 'Keep CIEL:163731, or choose PIH:2545' },
  { compare: 'draft', label: 'Round 1 against the earlier draft', detail: 'The draft put PIH:2545 in either way, with PIH\'s answers' },
];

function stepTwo(scenario) {
  const atRoundOne = changedRules().length === 0;
  const view = state.compare || (atRoundOne ? 'round1pih' : '');
  return [
    h('div', { class: 'scenario-head' },
      h('p', { class: 'step-label' }, 'Step 2 · A decision'),
      h('h2', {}, 'Tobacco use status'),
      h('p', {}, 'You add the CIEL question Tobacco use status. PIH has the same question, History of tobacco use.'),
      h('p', {}, 'Three answers match. CIEL also has Recently quit; PIH also has Unknown.')),
    h('div', { class: 'question' },
      h('p', { class: 'question__label' }, 'Round 1 · 25 Nov'),
      h('p', { class: 'question__text' }, 'Decided: OCL tells the person loudly that PIH:2545 is the same question, and makes them choose which one to add.'),
      h('p', {}, h('strong', {}, 'Proposal, to check with the group: '), 'whichever they choose stays as chosen and brings its own answers, each swapped for PIH\'s where PIH has one. Choosing CIEL:163731 keeps Recently quit; choosing PIH:2545 brings Unknown.'),
      h('p', {}, h('strong', {}, 'Still open: '), 'with CIEL\'s question, how would someone add PIH\'s Unknown or remove an answer they don\'t want? With PIH\'s, how would they add CIEL\'s Recently quit?'),
      atRoundOne ? h('div', { class: 'choices', role: 'group', 'aria-label': 'What to show side by side' },
        ...STEP_TWO_VIEWS.map((choice) => h('button', {
          type: 'button',
          class: `choice${view === choice.compare ? ' choice--on' : ''}`,
          'aria-pressed': String(view === choice.compare),
          onclick: () => { state.compare = choice.compare; update(); },
        }, h('span', { class: 'choice__label' }, choice.label), h('span', { class: 'choice__detail' }, choice.detail)))) : null),
    changedNote(),
    renderResults(snapshot, scenario.reference, view),
  ];
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
  if (scenario.id === '1') { section.replaceChildren(...stepOne(scenario).filter(Boolean)); return; }
  if (scenario.id === '3') { section.replaceChildren(...stepTwo(scenario).filter(Boolean)); return; }
  section.replaceChildren(...[
    h('div', { class: 'scenario-head' },
      h('p', { class: 'step-label' }, `Scenario ${scenario.id}`),
      h('h2', {}, scenario.title),
      h('p', {}, scenario.summary),
      h('p', {}, h('a', { href: `${WIKI}/Scenarios#scenario-${scenario.id}` }, 'This scenario on the wiki'))),
    changedNote(),
    renderResults(snapshot, scenario.reference),
  ].filter(Boolean));
}

// --- Try another concept (live) ---

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
  // Read with the settings as they are now; the checkbox can change while the requests run.
  const cascade = live.cascade;
  Object.assign(live, { error: '', progress: 'Starting…', graph: null, root: null });
  renderScenario();
  try {
    const graph = await fetchGraph({
      roots: [root], sources: Object.values(SOURCES), token, cascade,
      onProgress: ({ done, total }) => {
        live.progress = `Read ${done} of ${total} concepts so far…`;
        const progress = document.getElementById('live-progress');
        if (progress) progress.textContent = live.progress;
      },
    });
    Object.assign(live, { graph: indexGraph(graph), root, fetchedCascade: cascade, progress: '' });
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
  const conceptInput = h('input', { type: 'text', id: 'live-concept', value: live.concept, placeholder: 'CIEL:163731', oninput: (event) => { live.concept = event.target.value; } });
  const cascade = h('input', { type: 'checkbox', id: 'live-cascade', checked: live.cascade, onchange: (event) => { live.cascade = event.target.checked; } });

  const parts = [
    h('div', { class: 'scenario-head' },
      h('h2', {}, 'Try another concept'),
      h('p', {}, 'Expand any CIEL or PIH concept under the current rules, reading live from OCL. PIH and CIEL HEAD, as in the scenarios.')),
    h('p', { class: 'notice' }, 'Uses your own OCL API token (from your OCL account settings). The token stays in this page’s memory, goes only to api.openconceptlab.org, and is gone when you reload or close the page.'),
    h('form', { class: 'live-form', onsubmit: (event) => { event.preventDefault(); runLive(); } },
      h('label', { class: 'field', for: 'live-token' }, h('span', {}, 'OCL API token'), tokenInput),
      h('label', { class: 'field', for: 'live-concept' }, h('span', {}, 'Concept'), conceptInput),
      h('div', { class: 'actions' },
        h('label', { class: 'check', for: 'live-cascade' }, cascade, 'With its answers and members'),
        h('button', { type: 'submit', class: 'button', disabled: Boolean(live.progress) }, 'Expand'))),
  ];
  if (live.progress) parts.push(h('p', { class: 'notice', id: 'live-progress' }, live.progress));
  if (live.error) parts.push(h('p', { class: 'notice notice--error', role: 'alert' }, live.error));
  if (live.graph && live.root) {
    // Render with the cascade setting the data was read with; a changed checkbox needs a new read.
    if (live.cascade !== live.fetchedCascade) parts.push(h('p', { class: 'notice' }, 'Changed: press Expand to read the concept again.'));
    parts.push(renderResults(live.graph, { concept: live.root, cascade: live.fetchedCascade }));
  }
  return parts;
}

function renderFooter() {
  document.getElementById('footer').replaceChildren(
    snapshot ? `Scenario data: a stored copy of ${Object.keys(snapshot.concepts).length} concepts read from OCL (${snapshot.repoVersions} of PIH and CIEL) on ${snapshot.generated}. ` : '',
    h('a', { href: 'data/snapshot.json' }, 'The data'), ' · ',
    h('a', { href: `${WIKI}/Prototype` }, 'How the prototype works'));
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
  try { localStorage.removeItem(OLD_TOKEN_KEY); } catch { /* storage unavailable */ }
  update();
  try {
    const response = await fetch('data/snapshot.json');
    snapshot = indexGraph(await response.json());
  } catch (error) {
    document.getElementById('scenario').replaceChildren(h('p', { class: 'notice notice--error' }, `Couldn't load the scenario data: ${error.message}`));
    return;
  }
  update();
}

window.addEventListener('hashchange', () => { readHash(); update(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setDrawer(false); });
start();
