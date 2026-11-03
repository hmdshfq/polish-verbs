// Builds the static site into dist/.
//
// Each chapter page keeps its prose in src/content/<id>.html. The build puts that
// prose inside the shared shell (header, chapter switcher, section nav, theme),
// fills in the generated verb tables, and writes the hub pages.
//
//   node tools/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const write = (p, s) => {
  const full = path.join(ROOT, p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, s);
};
const json = (p) => JSON.parse(read(p));

const chapters = json('src/data/chapters.json').chapters;
const generated = json('src/data/generated.json');
const pairs = json('src/data/pairs.json');
const rekcja = json('src/data/rekcja.json');
const irregular = json('src/data/irregular.json');
const verbsInput = json('src/data/verbs-input.json');
const catalog = json('src/data/catalog.json');
const extras = json('src/data/extras.json');
const css = read('src/styles/site.css');
const appJs = read('src/app.js');

const stamp = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 8);
const cssV = stamp(css);
const appV = stamp(appJs);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------------------------------------------------------- shared bits

function chapterMenu(activeId) {
  const rows = chapters.map(({ id, pl, n }) => {
    const on = id === activeId ? ' class="on"' : '';
    return `<a href="/${id}/"${on}><span>${esc(pl)}</span><span class="num">${n}</span></a>`;
  }).join('\n        ');
  return rows;
}

function header(activeId) {
  const active = chapters.find((c) => c.id === activeId);
  const label = active ? `${active.n} · ${esc(active.en)}` : 'All chapters';
  return `<header class="top">
  <div class="top-in">
    <div class="brand"><a href="/">polski <b>·</b> czasowniki</a></div>
    <div class="chapswitch" data-chapswitch>
      <button type="button" aria-haspopup="true" aria-expanded="false">${label} ▾</button>
      <div class="menu" role="menu">
        <a href="/"${activeId ? '' : ' class="on"'}><span>All twelve chapters</span><span class="num">⌂</span></a>
        ${chapterMenu(activeId)}
        <div class="sep"></div>
        <a href="/verb-finder/"><span>Verb finder</span><span class="num">71</span></a>
        <a href="/drill/"><span>Mixed drill</span><span class="num">▶</span></a>
        <a href="/today/"><span>Today's twelve</span><span class="num">☀</span></a>
        <a href="/progress/"><span>My progress</span><span class="num">◔</span></a>
      </div>
    </div>
    <nav class="sections" id="nav"></nav>
    <button class="theme" id="themeBtn" aria-label="Switch light or dark theme" title="Light / dark">◐</button>
  </div>
</header>`;
}

function pager(activeId) {
  const i = chapters.findIndex((c) => c.id === activeId);
  const prev = i > 0 ? chapters[i - 1] : null;
  const next = i < chapters.length - 1 ? chapters[i + 1] : null;
  const bits = [
    prev
      ? `<a href="/${prev.id}/"><span class="lab">← chapter ${prev.n}</span><span class="nm">${esc(prev.en)}</span></a>`
      : `<a href="/"><span class="lab">← start</span><span class="nm">All twelve chapters</span></a>`,
  ];
  if (next) {
    bits.push(`<a class="right" href="/${next.id}/"><span class="lab">chapter ${next.n} →</span><span class="nm">${esc(next.en)}</span></a>`);
  } else {
    bits.push(`<a class="right" href="/drill/"><span class="lab">next →</span><span class="nm">Mixed drill</span></a>`);
  }
  return `<div class="pager">${bits.join('')}</div>`;
}

function shell({ title, description, activeId, body, v = {} }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/site.css?v=${v.css || 0}">
<script>
  try {
    var t = localStorage.getItem("polski.theme");
    if (t) document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
</script>
</head>
<body>
<div id="scrollbar"></div>
${header(activeId)}
${body}
<footer>
  <div class="sitefoot">
    <span>Polski czasowniki · twelve chapters, one site · <a href="/">all chapters</a></span>
    <span><a href="/verb-finder/">Verb finder</a> · <a href="/progress/">My progress</a></span>
  </div>
</footer>
<script src="/verbdata.js?v=${v.data || 0}"></script>
<script src="/catalog.js?v=${v.cat || 0}"></script>
<script src="/app.js?v=${v.app || 0}" defer></script>
</body>
</html>`;
}

// ------------------------------------------------------------ generated tables

const PERSONS = ['1.s', '2.s', '3.s', '1.p', '2.p', '3.p'];

function conjTable(lemma, opts) {
  const v = generated.verbs[lemma];
  if (!v) return '';
  const o = opts || {};
  const presentHead = v.presentIsFuture ? 'Future' : 'Present';
  const present = `<tr><th colspan="2">${presentHead}</th></tr>` +
    v.present.map((r) => `<tr><td>${esc(r.person)}</td><td>${esc(r.form || '—')}</td></tr>`).join('');
  const past = v.past.length
    ? `<tr><th colspan="2">Past</th></tr>` +
      v.past.map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(r.form)}</td></tr>`).join('')
    : '';
  const imper = v.imperative.length
    ? `<tr><th colspan="2">Imperative</th></tr>` +
      v.imperative.map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(r.form)}</td></tr>`).join('')
    : '';
  const cond = v.conditional.length
    ? `<tr><th colspan="2">Conditional</th></tr>` +
      v.conditional.map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(r.form)}</td></tr>`).join('')
    : '';

  const blocks = [present, past, o.imperative !== false ? imper : '', o.conditional ? cond : ''].filter(Boolean);

  return `<div class="tw conj">
  <table>
    <thead><tr><th colspan="2"><span class="pl">${esc(lemma)}</span> — ${esc(v.gloss)} <span class="tag ${v.aspect === 'perfective' ? 'a' : 'g'}">${v.aspect === 'perfective' ? 'pf' : 'impf'}</span></th></tr></thead>
    <tbody>${blocks.join('')}</tbody>
  </table>
</div>
<p class="small">Every form from <a href="${v.source}" rel="noopener" target="_blank">Wiktionary</a>.${v.presentIsFuture ? ' A perfective verb has no present tense — these are its future forms.' : ''}</p>`;
}

// A wide table: the six persons as columns, for comparing verbs side by side.
function compareTable(lemmas, label) {
  const rows = PERSONS.map((p, i) => {
    const cells = lemmas.map((l) => {
      const v = generated.verbs[l];
      if (!v) return '<td class="empty">—</td>';
      const r = v.present[i];
      return `<td>${esc(r && r.form ? r.form : '—')}</td>`;
    }).join('');
    return `<tr><td>${esc(generated.verbs[lemmas[0]].present[i].person)}</td>${cells}</tr>`;
  }).join('');
  const head = lemmas.map((l) => {
    const v = generated.verbs[l];
    return `<th class="pl">${esc(l)}${v ? `<br><span class="small">${v.aspect === 'perfective' ? 'pf · future' : 'impf'}</span>` : ''}</th>`;
  }).join('');
  return `<div class="tw conj">
  <table>
    <thead><tr><th>${esc(label || 'person')}</th>${head}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

// --------------------------------------------------------------- content slots

// Placeholders in the prose: {{conj:robić}}, {{compare:być,iść,jeść}},
// {{pairs}}, {{pairs:prefix}}, {{rekcja}}, {{negation}}, {{irregular}},
// {{prefixes}}, {{verbs:all}}.
function fillSlots(html) {
  return html.replace(/\{\{([a-z-]+)(?::([^}]+))?\}\}/g, (m, kind, arg) => {
    if (kind === 'conj') return conjTable(arg.trim(), { conditional: true });
    if (kind === 'compare') {
      const lemmas = arg.split(',').map((s) => s.trim());
      return compareTable(lemmas, 'person');
    }
    if (kind === 'pairs') return pairsBlock(arg ? arg.trim() : null);
    if (kind === 'rekcja') return rekcjaBlock();
    if (kind === 'negation') return negationBlock();
    if (kind === 'irregular') return irregularBlock();
    if (kind === 'prefixes') return prefixesBlock();
    return m;
  });
}

function pairsBlock(typeId) {
  const type = typeId ? pairs.types.find((t) => t.id === typeId) : null;
  let list = pairs.pairs;
  if (typeId) list = list.filter((p) => p.type === typeId);
  const head = type
    ? `<h3>${esc(type.label)}: <span class="pl">${esc(type.form)}</span></h3><p>${type.rule}</p><div class="note"><span class="lab">Note</span><p>${type.note}</p></div>`
    : '';
  const rows = list.map((p) => `<div class="pair">
      <span class="ipf">${esc(p.impf)} <span class="tag">impf</span></span>
      <span class="arrow">→</span>
      <span class="pf">${esc(p.pf)} <span class="tag a">pf</span></span>
      <span class="mean">${esc(p.en)}<br><span class="small">${esc(p.note)}</span></span>
    </div>`).join('');
  return head + `<div class="pairs">${rows}</div>`;
}

function rekcjaBlock() {
  return rekcja.groups.map((g) => `<h3>${esc(g.case)} <span class="small">· ${esc(g.pl)}</span></h3>
  <p>${g.rule}</p>
  <div class="tw"><table>
    <thead><tr><th>Verb</th><th>Meaning</th><th>Example</th>${g.id === 'prepositional' ? '<th>Case</th>' : ''}</tr></thead>
    <tbody>${g.verbs.map((v) => `<tr>
      <td class="pl">${esc(v.v)}</td>
      <td class="small">${esc(v.en)}</td>
      <td><span class="pl">${esc(v.ex)}</span> <span class="tr">— ${esc(v.tr)}</span></td>
      ${g.id === 'prepositional' ? `<td class="small"><span class="tag">${esc(v.case || '')}</span></td>` : ''}
    </tr>`).join('')}</tbody>
  </table></div>`).join('\n');
}

function negationBlock() {
  const rows = rekcja.negation.rows.map((r) => `<tr>
      <td class="pl">${esc(r.yes)}</td>
      <td class="pl">${esc(r.no)}</td>
      <td class="small">${esc(r.tr)}</td>
    </tr>`).join('');
  const q = rekcja.quantity.rows.map((r) => `<tr>
      <td class="pl">${esc(r.v)}</td>
      <td class="pl">${esc(r.q)}</td>
      <td class="small">${esc(r.tr)}</td>
    </tr>`).join('');
  return `<h3>The genitive after <i>nie</i></h3>
  <p>${rekcja.negation.rule}</p>
  <div class="tw"><table>
    <thead><tr><th>Affirmative — accusative</th><th>Negated — genitive</th><th>Meaning</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
  <div class="note"><span class="lab">Remember</span><p>${rekcja.negation.note}</p></div>
  <h3>Quantities take the genitive too</h3>
  <p>${rekcja.quantity.rule}</p>
  <div class="tw"><table>
    <thead><tr><th>A whole thing</th><th>A quantity of it</th><th>Meaning</th></tr></thead>
    <tbody>${q}</tbody>
  </table></div>`;
}

function irregularBlock() {
  return irregular.verbs.map((v) => `<h3><span class="pl">${esc(v.lemma)}</span> — ${esc(v.en)}</h3>
  <p>${v.why}</p>
  <ul>${v.watch.map((w) => `<li>${w}</li>`).join('')}</ul>
  ${generated.verbs[v.lemma] ? conjTable(v.lemma, { conditional: true }) : ''}`).join('\n');
}

function prefixesBlock() {
  const rows = irregular.prefixes.map((p) => `<tr>
      <td class="pl">${esc(p.prefix)}</td>
      <td class="pl">${esc(p.core)}</td>
      <td class="pl">${esc(p.result)}</td>
      <td class="small">${esc(p.en)}</td>
      <td class="small">${esc(p.sense)}</td>
    </tr>
    <tr><td colspan="5" class="small"><span class="tr">Also:</span> ${p.others.map((o) => `<span class="pl">${esc(o)}</span>`).join(' · ')}</td></tr>`).join('');
  return `<div class="tw"><table>
    <thead><tr><th>Prefix</th><th>From</th><th>To</th><th>Meaning</th><th>Its own sense</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

// ---------------------------------------------------------------- chapter pages

for (const c of chapters) {
  const contentPath = `src/content/${c.id}.html`;
  if (!fs.existsSync(path.join(ROOT, contentPath))) {
    console.log(`  (no content yet for ${c.id})`);
    continue;
  }
  const content = fillSlots(read(contentPath));
  const body = `<main class="wrap" data-chapter="${c.id}">
${content}

${pager(c.id)}
</main>`;
  write(
    `dist/${c.id}/index.html`,
    shell({
      title: `${c.en} — Polish verbs, chapter ${c.n}`,
      description: `${c.en}: ${c.short}`,
      activeId: c.id,
      body,
      v: { css: cssV, app: appV, cat: stamp(JSON.stringify(catalog)), data: stamp(read('src/data/generated.json')) },
    })
  );
  console.log(`built ${c.id}`);
}

// ------------------------------------------------------------------- hub

function home() {
  const cards = chapters.map((c) => `<a class="ccard" href="/${c.id}/" data-chapter-card="${c.id}">
    <div class="top"><span class="num">${c.n} of 12</span><span class="num">${esc(c.pl)}</span></div>
    <div class="nm">${esc(c.en)}</div>
    <p class="q">${esc(c.short)}</p>
    <div class="meter">
      <div class="bar"><i data-chapter-bar="${c.id}"></i></div>
      <span class="lbl" data-chapter-lbl="${c.id}">not started</span>
    </div>
  </a>`).join('\n');

  const content = fillSlots(read('src/content/home.html')).replace('<!--CHAPTERS-->', cards);
  const body = `<main class="wrap">
${content}
</main>`;
  write(
    'dist/index.html',
    shell({
      title: 'Polski czasowniki — the Polish verb, in twelve chapters',
      description:
        'Every part of the Polish verb: aspect, the present, past and future, imperative, conditional, irregulars, case government and prefixes, with verified conjugation tables and drills that explain every answer.',
      activeId: null,
      body,
      v: { css: cssV, app: appV, cat: stamp(JSON.stringify(catalog)), data: stamp(read('src/data/generated.json')) },
    })
  );
  console.log('built home');
}
home();

// ------------------------------------------------------------ simple pages

function simplePage({ id, title, description, inner }) {
  const body = `<main class="wrap" data-page="${id}">
${inner}
</main>`;
  write(
    `dist/${id}/index.html`,
    shell({ title, description, activeId: null, body, v: { css: cssV, app: appV, cat: stamp(JSON.stringify(catalog)), data: stamp(read('src/data/generated.json')) } })
  );
  console.log(`built ${id}`);
}

// A partner is shown in the partner column only when it is a real partner
// verb. The state verbs that have none store "—" in verbs-input.json, so the
// data says so directly instead of this having to guess from a sentence.
function shortPartner(p) {
  if (!p || p === '—') return '—';
  return p;
}

function partnerNote(v) {
  return v.partnerNote || '';
}

// The verb finder: every verb with a table, searchable, filterable, expandable.
function verbFinder() {
  const count = Object.keys(generated.verbs).length;
  const rows = Object.keys(generated.verbs).sort((a, b) => a.localeCompare(b, 'pl'))
    .map((lemma) => {
      const v = generated.verbs[lemma];
      return `<tr class="verbrow" data-lemma="${esc(lemma)}">
        <td>${esc(lemma)}</td>
        <td class="small">${esc(v.gloss)}</td>
        <td class="small">${v.aspect === 'perfective' ? 'pf' : 'impf'}</td>
        <td class="pl">${esc(shortPartner(v.partner))}</td>
        <td class="small">▸</td>
      </tr>`;
    }).join('');

  return `<div class="hero">
  <p class="kicker">The verb finder</p>
  <h1>Every verb<br><em>${count} tables</em></h1>
  <p class="lede">Search by the Polish word, the English meaning or an aspect pair. Open a row to see its present or
  future, its past with every gender, its participles and its source. Every form was taken from the verb's
  inflection table, not reconstructed.</p>
</div>
<section>
  <div class="shead"><div class="snum">01</div><h2>Find a verb</h2></div>
  <div class="filter">
    <input id="verbSearch" type="search" placeholder="Search: robić, to make, pisać…" aria-label="Search the verbs" autocomplete="off">
    <label class="small filterpair">
      <input type="checkbox" id="verbPairsOnly"> only verbs with a partner
    </label>
    <span class="n" id="verbCount"></span>
  </div>
  <div class="chips" id="verbChips">
    <button class="chip on" data-vf="all">All</button>
    <button class="chip" data-vf="imperfective">Imperfective</button>
    <button class="chip" data-vf="perfective">Perfective</button>
  </div>
  <div class="tw tall">
    <table>
      <thead><tr><th>Verb</th><th>Meaning</th><th>Aspect</th><th>Partner</th><th></th></tr></thead>
      <tbody id="verbBody">${rows}</tbody>
    </table>
  </div>
  <div class="note info"><span class="lab">How the partner column works</span>
    <p>A dash means the verb has no true perfective partner, and the card behind it says why.
    <span class="pl">być</span>, <span class="pl">mieć</span> and <span class="pl">znać</span> are states, not acts
    that finish; <span class="pl">musieć</span> is imperfective only. Where a near-synonym is the usual way to say
    "the finished version", the column names it and the card says what it means —
    <span class="pl">wiedzieć</span> / <span class="pl">dowiedzieć się</span> is that case.</p>
  </div>
</section>`;
}

simplePage({
  id: 'verb-finder',
  title: 'Verb finder — 71 Polish verbs with verified tables',
  description: 'Every Polish verb on the site, with its present or future, past by gender, participles and its Wiktionary source.',
  inner: verbFinder(),
});

simplePage({
  id: 'drill',
  title: 'Mixed drill — Polish verbs, all twelve chapters',
  description: 'One run across all twelve chapters, starting with what the schedule says is due.',
  inner: `<div class="hero">
  <p class="kicker">All twelve chapters</p>
  <h1>Mixed drill<br><em>everything at once</em></h1>
  <p class="lede">One run across aspect, tense, person, the imperative, the conditional, case government and the
  irregular verbs. It starts with what the schedule says is due, then fills up with random items — the only way to
  find out which chapter you actually know.</p>
</div>
<section>
  <div class="shead"><div class="snum">01</div><h2>The run</h2></div>
  <div class="drills">
    <div id="mixedRoot">
      <div class="cta"><button class="btn primary" id="mixedStart">Start a run of 20</button></div>
    </div>
  </div>
</section>`,
});

simplePage({
  id: 'today',
  title: "Today's twelve — Polski czasowniki",
  description: 'Twelve items drawn from all twelve chapters, review first, on a spaced schedule.',
  inner: `<div class="hero">
  <p class="kicker">Short daily revision</p>
  <h1>Today<br><em>twelve items</em></h1>
  <p class="lede">Twelve items, about six minutes: what the schedule says is due comes first, then new material from
  the chapter you are on. Right answers wait longer each time; misses come straight back.</p>
</div>
<section>
  <div class="shead"><div class="snum">01</div><h2>Your lesson</h2></div>
  <div class="drills"><div id="todayRoot"><p class="small">Building today's lesson…</p></div></div>
</section>`,
});

simplePage({
  id: 'progress',
  title: 'My progress — Polski czasowniki',
  description: 'What you know per chapter, what is due for review, and every answer recorded.',
  inner: `<div class="hero">
  <p class="kicker">Progress</p>
  <h1>Progress<br><em>what you know</em></h1>
  <p class="lede">Every answer is recorded: which item, whether it was right, and when it comes back.
  “Known” counts items you have answered correctly at least twice in a row.</p>
</div>
<section>
  <div class="shead"><div class="snum">01</div><h2>By chapter</h2></div>
  <div id="progressRoot"><p class="small">Reading your progress…</p></div>
</section>
<section>
  <div class="shead"><div class="snum">02</div><h2>What is due</h2></div>
  <div id="dueRoot"></div>
  <div class="cta" style="margin-top:20px">
    <a class="btn primary" href="/today/">Start today's twelve</a>
    <button class="btn ghost" id="resetProgress">Clear all progress</button>
  </div>
</section>
<section>
  <div class="shead"><div class="snum">03</div><h2>Progress between devices</h2></div>
  <div id="syncRoot"><p class="small">Reading your progress…</p></div>
</section>`,
});

// ------------------------------------------------------------------ assets

write('dist/site.css', css);
write('dist/app.js', appJs);
write('dist/catalog.js', `window.POLSKI_VERBS = ${JSON.stringify(catalog)};\n`);
write('dist/_headers', read('src/_headers'));

// The verb data the site needs at run time: the tables, and the one-line note
// per verb that the input list carries.
const verbMeta = {};
for (const v of verbsInput) verbMeta[v.lemma] = { gloss: v.gloss, note: v.note || null };
// The verbs with no true partner say why in the detail card; the reason is
// stored next to the verb in verbs-input.json rather than composed here.
for (const [lemma, v] of Object.entries(generated.verbs)) {
  if (!v.partnerNote) continue;
  verbMeta[lemma] = verbMeta[lemma] || {};
  verbMeta[lemma].partnerNote = v.partnerNote;
}
write(
  'dist/verbdata.js',
  `window.POLSKI_VERB_EXTRAS = ${JSON.stringify({
    verbs: generated.verbs,
    verbMeta,
    order: generated.order,
    ...extras,
  })};\n`
);

write(
  'dist/favicon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#a4361f"/>
  <text x="32" y="45" font-family="Georgia, 'Times New Roman', serif" font-size="34" fill="#f7f3ea"
        text-anchor="middle">cz</text>
</svg>
`
);

console.log('\nsite built into dist/');
