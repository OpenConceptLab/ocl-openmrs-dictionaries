// Equivalency-aware expansion: the rules on the wiki's Rules page, as code.
// Pure functions over a graph of concepts and mappings (see data.js). No I/O.

export const STRUCTURAL_MAP_TYPES = ['CONCEPT-SET', 'Q-AND-A'];
export const EQUIVALENCY_MAP_TYPES = ['SAME-AS'];

// The prototype works with two ranked sources. The ranked list option orders them.
export const SOURCES = {
  PIH: '/orgs/PIH/sources/PIH/',
  CIEL: '/orgs/CIEL/sources/CIEL/',
};

// One entry per choice the wiki's rules leave open. `rule` is the rule number on the Rules page.
export const RULES = [
  {
    key: 'ranked', rule: null, label: 'Ranked list',
    help: 'References are always added while PIH ranks first. The second option swaps the order afterwards, which is where Rule 5 makes a difference.',
    options: [
      { value: 'PIH>CIEL', label: 'PIH, then CIEL' },
      { value: 'CIEL>PIH', label: 'Swapped later to CIEL, then PIH' },
    ],
  },
  {
    key: 'lookIn', rule: 1, label: 'Look for equivalents in',
    options: [
      { value: 'sources', label: 'The ranked sources' },
      { value: 'collection', label: 'The collection only' },
    ],
  },
  {
    key: 'direction', rule: 1, label: 'Count SAME-AS mappings stored in',
    options: [
      { value: 'either', label: 'Either source' },
      { value: 'higher', label: 'The higher-ranked source only' },
      { value: 'lower', label: 'The lower-ranked source only' },
    ],
  },
  {
    key: 'retired', rule: 1, label: 'Retired mappings and concepts',
    options: [
      { value: 'ignore', label: "Don't count" },
      { value: 'count', label: 'Count' },
    ],
  },
  {
    key: 'substitution', rule: 2, label: 'A concept with a higher-ranked equivalent',
    options: [
      { value: 'replace', label: 'Is replaced by it' },
      { value: 'omit', label: 'Is left out' },
      { value: 'off', label: 'Stays (no equivalency)' },
    ],
  },
  {
    key: 'tie', rule: 2, label: 'Two equivalents in one source',
    options: [
      { value: 'keep', label: 'Keep the original and flag it' },
      { value: 'lowest', label: 'Use the lowest code' },
    ],
  },
  {
    key: 'cascade', rule: 3, label: "A replaced concept's answers and set members",
    options: [
      { value: 'replacement', label: "The replacement's own" },
      { value: 'referenced', label: "The referenced concept's" },
      { value: 'union', label: 'Both (union)' },
      { value: 'stepwise', label: "Referenced at the first level, then the replacement's" },
    ],
  },
  {
    key: 'answers', rule: 4, label: 'Mappings that point to a replaced concept',
    options: [
      { value: 'repoint', label: 'Point to the replacement' },
      { value: 'leave', label: 'Stay as stored' },
    ],
  },
  {
    key: 'reference', rule: 5, label: 'The reference',
    options: [
      { value: 'keep', label: 'Stays as written' },
      { value: 'rewrite', label: 'Is rewritten to the replacement' },
    ],
  },
  {
    key: 'adding', rule: 6, label: 'When someone adds it',
    options: [
      { value: 'inform', label: 'Allow it and tell them' },
      { value: 'offer', label: 'Offer the replacement' },
      { value: 'block', label: 'Block it' },
      { value: 'silent', label: 'Allow it silently' },
    ],
  },
];

export const DEFAULT_OPTIONS = {
  ranked: 'PIH>CIEL', lookIn: 'sources', direction: 'either', retired: 'ignore', substitution: 'replace',
  tie: 'keep', cascade: 'replacement', answers: 'repoint', reference: 'keep', adding: 'inform',
};

export const PRESETS = {
  draft: { label: 'Draft defaults', options: DEFAULT_OPTIONS },
  // $cascade with omitIfExistsIn pointed at the collection: it checks only what the collection already
  // contains, and leaves concepts out rather than replacing them.
  today: { label: 'OCL today', options: { ...DEFAULT_OPTIONS, lookIn: 'collection', substitution: 'omit', adding: 'silent' } },
  referenced: { label: 'Follow the referenced concept', options: { ...DEFAULT_OPTIONS, cascade: 'referenced' } },
  union: { label: 'Union of answers', options: { ...DEFAULT_OPTIONS, cascade: 'union' } },
  stepwise: { label: 'Step by step', options: { ...DEFAULT_OPTIONS, cascade: 'stepwise' } },
  off: { label: 'No equivalency', options: { ...DEFAULT_OPTIONS, substitution: 'off', adding: 'silent' } },
};

const SOURCE_PATTERN = /^\/(?:orgs|users)\/[^/]+\/(?:sources|collections)\/[^/]+\//;

export function sourceOf(url) {
  const match = SOURCE_PATTERN.exec(url || '');
  return match ? match[0] : null;
}

export function sourceName(sourceUrl) {
  return (sourceUrl || '').split('/').filter(Boolean)[3] || sourceUrl;
}

export function codeOf(url) {
  const parts = (url || '').split('/').filter(Boolean);
  return parts[parts.length - 1];
}

export function shortLabel(url) {
  return `${sourceName(sourceOf(url))}:${codeOf(url)}`;
}

function compareCodes(a, b) {
  const [x, y] = [codeOf(a), codeOf(b)];
  const [nx, ny] = [Number(x), Number(y)];
  if (Number.isFinite(nx) && Number.isFinite(ny) && nx !== ny) return nx - ny;
  return x < y ? -1 : x > y ? 1 : 0;
}

export function indexGraph(graph) {
  if (graph.from && graph.to) return graph;
  const from = new Map();
  const to = new Map();
  const push = (map, key, value) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  };
  for (const mapping of graph.mappings) {
    push(from, mapping.from, mapping);
    if (mapping.to) push(to, mapping.to, mapping);
  }
  return { ...graph, from, to };
}

// reference: { concept: url, cascade: boolean, rankedWhenAdded?: 'PIH>CIEL' }
export function expand(graph, reference, options = {}) {
  const g = indexGraph(graph);
  const o = { ...DEFAULT_OPTIONS, ...options };
  const trace = [];
  const isRetired = (url) => Boolean(g.concepts[url] && g.concepts[url].retired);
  const countRetired = o.retired === 'count';

  // Returns resolve(url) for one ranked list ('PIH>CIEL') and one Rule 2 substitution mode.
  function makeResolver(order, substitution) {
    const ranked = order.split('>').map((name) => SOURCES[name]);
    const rank = (url) => {
      const index = ranked.indexOf(sourceOf(url));
      return index === -1 ? Infinity : index;
    };
    const memo = new Map();

    // Rule 1: the concepts a direct SAME-AS mapping links to this one, in another ranked source.
    function equivalents(url) {
      const own = sourceOf(url);
      const found = [];
      const consider = (other, mapping) => {
        const otherSource = sourceOf(other);
        if (otherSource === own || rank(other) === Infinity) return;
        if (!countRetired && (mapping.retired || isRetired(other) || isRetired(url))) return;
        const higher = rank(other) < rank(url) ? otherSource : own;
        if (o.direction === 'higher' && mapping.holder !== higher) return;
        if (o.direction === 'lower' && mapping.holder === higher) return;
        found.push({ url: other, mapping });
      };
      for (const m of g.from.get(url) || []) {
        if (EQUIVALENCY_MAP_TYPES.includes(m.mapType)) consider(m.to, m);
      }
      for (const m of g.to.get(url) || []) {
        if (EQUIVALENCY_MAP_TYPES.includes(m.mapType)) consider(m.from, m);
      }
      return found;
    }

    // Rule 2: which concept the expansion contains in place of `url`.
    function resolve(url) {
      if (memo.has(url)) return memo.get(url);
      let result = { url, replaced: false };
      if (substitution !== 'off') {
        let candidates = equivalents(url).filter((c) => rank(c.url) < rank(url));
        if (o.lookIn === 'collection') candidates = []; // the prototype's collection starts empty
        if (candidates.length) {
          const best = Math.min(...candidates.map((c) => rank(c.url)));
          const top = candidates.filter((c) => rank(c.url) === best);
          const distinct = [...new Set(top.map((c) => c.url))].sort(compareCodes);
          let chosen = top.find((c) => c.url === distinct[0]);
          const flags = [];
          if (distinct.length > 1) {
            flags.push({ kind: 'tie', candidates: distinct });
            if (o.tie === 'keep') chosen = null;
          }
          if (!chosen) {
            result = { url, replaced: false, flags };
          } else if (substitution === 'omit') {
            result = { url: null, via: chosen.mapping, equivalent: chosen.url, flags };
          } else {
            result = { url: chosen.url, replaced: true, original: url, via: chosen.mapping, flags };
          }
        }
      }
      memo.set(url, result);
      return result;
    }

    return resolve;
  }

  const now = makeResolver(o.ranked, o.substitution);
  // Rules 5 and 6 act when the reference is added, so they need the equivalent itself even when the
  // expansion leaves such concepts out.
  const whenAdded = makeResolver(reference.rankedWhenAdded || 'PIH>CIEL', o.substitution === 'off' ? 'off' : 'replace');

  // Rule 6: what someone sees when they add the reference (always under the ranked list at that time).
  const atAdd = whenAdded(reference.concept);
  const adding = describeAdding(reference.concept, atAdd, o.adding);
  if (adding.blocked) {
    trace.push(`Rule 6: adding ${shortLabel(reference.concept)} is blocked, so the collection gets nothing.`);
    return { reference: { ...reference, stored: null }, adding, members: [], tree: null, trace };
  }

  // Rule 5: the reference stays as written, or is rewritten when it's added.
  let stored = reference.concept;
  if ((o.reference === 'rewrite' || o.adding === 'offer') && atAdd.replaced) {
    stored = atAdd.url;
    trace.push(`Rule ${o.reference === 'rewrite' ? 5 : 6}: the reference was saved as ${shortLabel(stored)} instead of ${shortLabel(reference.concept)}.`);
  } else {
    trace.push(`Rule 5: the reference stays ${shortLabel(reference.concept)}${reference.cascade ? ' with cascade' : ''}.`);
  }

  const structural = (url) => (g.from.get(url) || [])
    .filter((m) => STRUCTURAL_MAP_TYPES.includes(m.mapType) && m.to && !m.retired && !isRetired(m.to)
      && m.holder === sourceOf(url))
    .sort((a, b) => STRUCTURAL_MAP_TYPES.indexOf(a.mapType) - STRUCTURAL_MAP_TYPES.indexOf(b.mapType)
      || (a.sortWeight ?? Infinity) - (b.sortWeight ?? Infinity) || compareCodes(a.to, b.to));

  // Rule 3: whose answers and set members a concept brings. Each entry is a mapping to follow, plus (for
  // the union) the referenced side's concepts that resolve to the same child, so the union continues below it.
  function childPlan(original, member, depth, alsoFrom) {
    const own = () => structural(member).map((mapping) => ({ mapping, alsoFrom: [] }));
    const referenced = () => structural(original).map((mapping) => ({ mapping, alsoFrom: [] }));
    if (o.cascade === 'referenced' && original !== member) return referenced();
    if (o.cascade === 'stepwise' && original !== member && depth === 0) return referenced();
    if (o.cascade !== 'union') return own();
    const plan = own();
    const covered = new Map(plan.map((step) => [now(step.mapping.to).url, step]));
    const added = new Set();
    for (const extra of [original, ...alsoFrom].filter((url) => url !== member)) {
      for (const mapping of structural(extra)) {
        const target = now(mapping.to).url;
        const step = target && covered.get(target);
        if (step) {
          if (mapping.to !== step.mapping.to) step.alsoFrom.push(mapping.to);
          continue;
        }
        // Keep each relationship the referenced side adds: a child can be both a set member and an answer.
        const key = `${target || mapping.to} ${mapping.mapType}`;
        if (added.has(key)) continue;
        added.add(key);
        plan.push({ mapping, alsoFrom: [] });
      }
    }
    return plan;
  }

  const members = new Map();
  const expanded = new Set();

  function addMember(url, resolution) {
    if (!members.has(url)) {
      members.set(url, { url, replaced: resolution.replaced ? resolution.original : null, flags: resolution.flags || [] });
      if (resolution.replaced) {
        trace.push(`Rule 2: ${shortLabel(resolution.original)} → ${shortLabel(url)}, via the SAME-AS mapping stored in ${sourceName(resolution.via.holder)}.`);
      }
      for (const flag of resolution.flags || []) {
        if (flag.kind === 'tie') {
          trace.push(`Rule 2: ${shortLabel(resolution.original || url)} has ${flag.candidates.length} equivalents in one source (${flag.candidates.map(shortLabel).join(', ')}); ${o.tie === 'keep' ? 'kept the original' : `used ${shortLabel(url)}`}.`);
        }
      }
    }
  }

  function visit(original, depth, alsoFrom = []) {
    const resolution = now(original);
    const node = { original, url: resolution.url, resolution, edges: [], children: [] };
    if (!resolution.url) {
      node.status = 'omitted';
      trace.push(`Rule 2: ${shortLabel(original)} is left out (its equivalent ${shortLabel(resolution.equivalent)} ranks higher), and nothing under it is cascaded.`);
      return node;
    }
    addMember(resolution.url, resolution);
    node.status = resolution.replaced ? 'replaced' : 'kept';
    if (expanded.has(resolution.url)) {
      node.repeat = true;
      return node;
    }
    expanded.add(resolution.url);
    if (!reference.cascade) return node;
    const plan = childPlan(original, resolution.url, depth, alsoFrom);
    if ((resolution.replaced || alsoFrom.length) && plan.length) {
      const owners = new Set(plan.map((step) => step.mapping.from));
      const whose = owners.size > 1 ? 'both sides' : owners.has(resolution.url) ? 'the replacement' : 'the referenced concept';
      trace.push(`Rule 3: ${shortLabel(resolution.url)} gets the answers and set members of ${whose}.`);
    }
    // A concept can be both an answer and a set member of its parent: one child, several edges.
    const childByTarget = new Map();
    for (const { mapping, alsoFrom: childAlso } of plan) {
      let child = childByTarget.get(mapping.to);
      if (!child) {
        child = visit(mapping.to, depth + 1, childAlso);
        childByTarget.set(mapping.to, child);
        node.children.push(child);
      }
      const target = child.url;
      let status = 'stored';
      if (!target) status = 'omitted';
      else if (mapping.from !== resolution.url || mapping.to !== target) {
        status = o.answers === 'repoint' ? 'repointed' : 'dangling';
      }
      child.edges.push({ mapping, status });
      if (status === 'dangling') {
        trace.push(`Rule 4: ${mapping.mapType} ${shortLabel(mapping.from)} → ${shortLabel(mapping.to)} stays as stored, so in OpenMRS ${shortLabel(resolution.url)} doesn't get ${shortLabel(target)}.`);
      }
    }
    return node;
  }

  const tree = visit(stored, 0);
  return {
    reference: { ...reference, stored },
    adding,
    members: [...members.values()],
    tree,
    trace,
  };
}

function describeAdding(url, resolution, mode) {
  if (!resolution.replaced) {
    return { kind: 'plain', text: `${shortLabel(url)} has no equivalent in a higher-ranked source, so it's added as written.` };
  }
  const original = shortLabel(url);
  const replacement = shortLabel(resolution.url);
  switch (mode) {
    case 'block':
      return { kind: 'block', blocked: true, text: `Not added: ${replacement}, its equivalent in a higher-ranked source, is used instead. Add ${replacement} directly.` };
    case 'offer':
      return { kind: 'offer', text: `${replacement} is the equivalent in a higher-ranked source. Use it instead? (Shown here as if they accept.)` };
    case 'silent':
      return { kind: 'silent', text: `Added. Nothing tells the user that ${original} resolves to ${replacement}.` };
    default:
      return { kind: 'inform', text: `Added. In this dictionary, ${original} resolves to ${replacement}.` };
  }
}
