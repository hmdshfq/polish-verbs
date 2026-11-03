// Turns src/data/verbfacts.json (scraped from Wiktionary, see fetch-wiktionary.mjs)
// into the tables the site prints, and into src/data/generated.json, which the
// page builder and the drill builder both read.
//
// Nothing here invents a form. A table is a layout of forms that already exist
// in the data: if a cell has no source form, the cell says so.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const facts = JSON.parse(read('src/data/verbfacts.json'));

// The two verbs English Wiktionary has no page of its own for are taken from
// Polish Wiktionary (see fetch-polish-wiktionary.mjs). They arrive in the same
// shape, so everything below treats them alike — and their source link says so.
const fallbackPath = path.join(ROOT, 'src', 'data', 'polish-fallback.json');
if (fs.existsSync(fallbackPath)) {
  const fallback = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
  for (const [lemma, v] of Object.entries(fallback)) {
    if (facts[lemma]) continue;
    // Their partner is the reflexive pair, stated here because the table does
    // not carry it: nauczyć się / uczyć się, cieszyć się / ucieszyć się.
    v.partner = v.partner || ({ 'nauczyć się': 'uczyć się', 'cieszyć się': 'ucieszyć się' }[lemma] || null);
    v.reflexive = true;
    facts[lemma] = v;
  }
}

const PERSONS = ['1.s', '2.s', '3.s', '1.p', '2.p', '3.p'];
const PERSON_LABEL = {
  '1.s': 'ja', '2.s': 'ty', '3.s': 'on / ona / ono',
  '1.p': 'my', '2.p': 'wy', '3.p': 'oni / one',
};

// The present row, with the person as the site prints it.
function presentRow(v) {
  const f = v.forms;
  return PERSONS.map((p) => ({
    person: PERSON_LABEL[p],
    key: p,
    form: f[`present.${p}`] || null,
  }));
}

function pastRows(v) {
  const f = v.forms;
  const pick = (...keys) => keys.map((k) => f[k]).filter(Boolean);
  const join = (arr) => (arr.length ? arr.join(' / ') : null);
  return [
    { label: 'ja (masc.)', form: join(pick('past.1.s.m')) },
    { label: 'ja (fem.)', form: join(pick('past.1.s.f')) },
    { label: 'ty (masc.)', form: join(pick('past.2.s.m')) },
    { label: 'ty (fem.)', form: join(pick('past.2.s.f')) },
    { label: 'on', form: join(pick('past.3.s.m')) },
    { label: 'ona', form: join(pick('past.3.s.f')) },
    { label: 'ono', form: join(pick('past.3.s.n')) },
    { label: 'my (masc. persons)', form: join(pick('past.1.p.vr')) },
    { label: 'my (other)', form: join(pick('past.1.p.nv')) },
    { label: 'wy (masc. persons)', form: join(pick('past.2.p.vr')) },
    { label: 'wy (other)', form: join(pick('past.2.p.nv')) },
    { label: 'oni', form: join(pick('past.3.p.vr')) },
    { label: 'one', form: join(pick('past.3.p.nv')) },
  ].filter((r) => r.form);
}

function conditionalRows(v) {
  const f = v.forms;
  return [
    { label: 'ja (masc.)', form: f['conditional.1.s.m'] },
    { label: 'ja (fem.)', form: f['conditional.1.s.f'] },
    { label: 'ty (masc.)', form: f['conditional.2.s.m'] },
    { label: 'ty (fem.)', form: f['conditional.2.s.f'] },
    { label: 'on', form: f['conditional.3.s.m'] },
    { label: 'ona', form: f['conditional.3.s.f'] },
    { label: 'ono', form: f['conditional.3.s.n'] },
    { label: 'my (masc. persons)', form: f['conditional.1.p.vr'] },
    { label: 'my (other)', form: f['conditional.1.p.nv'] },
    { label: 'wy (masc. persons)', form: f['conditional.2.p.vr'] },
    { label: 'wy (other)', form: f['conditional.2.p.nv'] },
    { label: 'oni', form: f['conditional.3.p.vr'] },
    { label: 'one', form: f['conditional.3.p.nv'] },
  ].filter((r) => r.form);
}

function imperativeRows(v) {
  const f = v.forms;
  return [
    { label: 'ty', form: f['impr.2.s'] },
    { label: 'my', form: f['impr.1.p'] },
    { label: 'wy', form: f['impr.2.p'] },
  ].filter((r) => r.form);
}

// The shape of a verb, said in words a learner can use.
function conjugationClass(v) {
  const f = v.forms;
  const p1 = f['present.1.s'];
  const p2 = f['present.2.s'];
  const p3 = f['present.3.p'];
  if (!p1 || !p2 || !p3) return null;
  const stem = (s) => s.replace(/(ę|esz|e|emy|ecie|ą|isz|ysz|i|y|imy|ycie|ą)$/, '');
  const s1 = stem(p1);
  if (p1.endsWith('ę') && p2.endsWith('esz') && p3.endsWith('ą')) {
    return { label: '‑ę, ‑esz', note: 'the largest family: robić → robię, robisz, robią' };
  }
  if (p1.endsWith('ę') && p2.endsWith('isz') && p3.endsWith('ą')) {
    return { label: '‑ę, ‑isz', note: 'the “i” family: mówić → mówię, mówisz, mówią' };
  }
  if (p1.endsWith('ę') && p2.endsWith('ysz') && p3.endsWith('ą')) {
    return { label: '‑ę, ‑ysz', note: 'after a hard stem: czytać → czytam? no — pisać → piszę, piszesz' };
  }
  if (p1.endsWith('m') && p2.endsWith('sz')) {
    return { label: '‑m, ‑sz', note: 'a closed, very old set: mieć → mam, masz; jeść → jem, jesz' };
  }
  return null;
}

const out = { verbs: {}, order: Object.keys(facts) };
for (const [lemma, v] of Object.entries(facts)) {
  out.verbs[lemma] = {
    lemma,
    gloss: v.gloss,
    note: v.note,
    aspect: v.aspect,
    partner: v.partner,
    partnerNote: v.partnerNote || null,
    nearSynonym: v.nearSynonym || null,
    futureSimple: v.futureSimple,
    conjClass: v.conjClass,
    source: v.source,
    present: presentRow(v),
    presentIsFuture: v.futureSimple,
    past: pastRows(v),
    conditional: conditionalRows(v),
    imperative: imperativeRows(v),
    impersonals: {
      present: v.forms['impersonal.pres'] || null,
      past: v.forms['impersonal.past'] || null,
    },
    participles: {
      act: v.forms['ptcp.act'] || null,
      pass: v.forms['ptcp.pass'] || null,
      adv: v.forms['ptcp.adv.pres'] || null,
      noun: v.forms['noun'] || null,
    },
    infinitive: v.forms.infinitive || lemma,
  };
}

fs.writeFileSync(path.join(ROOT, 'src/data/generated.json'), JSON.stringify(out, null, 1) + '\n');

let n = 0;
for (const v of Object.values(out.verbs)) if (v.present.every((r) => r.form)) n++;
console.log(`generated.json written: ${out.order.length} verbs, ${n} with a complete present/future row`);
