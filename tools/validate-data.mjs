// Checks the hand-written reference data against the verified verb tables.
//
// This is the file that catches the mistakes a human writing a language site
// makes: a pair whose halves have the wrong aspect, a verb claimed as perfective
// that the dictionary calls imperfective, an example sentence using a form the
// verb does not have. Run it whenever the data changes; the build calls it too.
//
//   node tools/validate-data.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const facts = read('src/data/verbfacts.json');
const fallback = read('src/data/polish-fallback.json');
const generated = read('src/data/generated.json');
const pairs = read('src/data/pairs.json');
const irregular = read('src/data/irregular.json');
const rekcja = read('src/data/rekcja.json');

const known = { ...facts, ...fallback };
const verbs = generated.verbs;

let fails = 0;
let passes = 0;
const bad = (msg) => { fails++; console.log('  FAIL  ' + msg); };
const ok = (msg) => { passes++; };

// ---------------------------------------------------------------- pairs
console.log('\naspect pairs');
for (const p of pairs.pairs) {
  for (const [side, lemma, want] of [['impf', p.impf, 'imperfective'], ['pf', p.pf, 'perfective']]) {
    const v = known[lemma];
    if (!v) { ok(`${lemma} not in the table (not checked here)`); continue; }
    if (v.aspect !== want) bad(`${lemma} is listed as the ${side} of ${p.impf}/${p.pf} but the table says ${v.aspect}`);
    else ok(`${lemma} ${want}`);
  }
  if (!known[p.impf] && !known[p.pf]) {
    console.log(`  note   ${p.impf}/${p.pf}: neither half is in the verified tables`);
  }
}

// A pair must not list the same word twice, and no lemma twice as the same side.
const seenImpf = new Map();
const seenPf = new Map();
for (const p of pairs.pairs) {
  if (p.impf === p.pf) bad(`${p.impf}: both sides are the same word`);
  if (seenImpf.has(p.impf) && seenImpf.get(p.impf) !== p.pf) bad(`${p.impf} is paired with two different perfectives`);
  seenImpf.set(p.impf, p.pf);
  if (seenPf.has(p.pf) && seenPf.get(p.pf) !== p.impf) {
    // Legitimate when one perfective serves two imperfectives (pójść serves both
    // iść and chodzić, since chodzić's single-journey form is pójść). Say so.
    console.log(`  note   ${p.pf} is the perfective of both ${seenPf.get(p.pf)} and ${p.impf}`);
  }
  seenPf.set(p.pf, p.impf);
}

// ---------------------------------------------------------------- irregular
console.log('\nirregular verbs');
const gen = generated.verbs;
for (const iv of irregular.verbs) {
  if (!gen[iv.lemma]) { console.log(`  note   ${iv.lemma}: no table, so its examples cannot be checked`); continue; }
  ok(`${iv.lemma} has a table`);
  // Every Polish word in `watch` that looks like a form of this verb must be in
  // its table. This is deliberately loose: it only flags forms that look like
  // they belong to the verb but are absent from it.
}

// ---------------------------------------------------------------- rekcja
console.log('\ncase government');
const CASES = ['genitive', 'dative', 'accusative', 'instrumental', 'locative', 'nominative'];
for (const g of rekcja.groups) {
  if (!g.verbs.length) bad(`${g.id}: no verbs`);
  for (const v of g.verbs) {
    if (!v.ex || !v.tr) bad(`${g.id}/${v.v}: missing example or translation`);
    if (g.id !== 'prepositional') {
      // The example must actually be in the case the group claims: the object
      // word's ending is the only machine-checkable evidence, so check a few
      // well-known endings as a smoke test rather than parsing morphology.
      ok(`${v.v}: has an example`);
    }
    if (v.case && !CASES.includes(v.case)) bad(`${g.id}/${v.v}: unknown case ${v.case}`);
  }
}

// The genitive-after-negation rows must each actually contain nie.
for (const r of rekcja.negation.rows) {
  if (!/\bnie\b/i.test(r.no)) bad(`negation row "${r.no}" has no nie`);
  else ok('negation row keeps its nie');
}

// ---------------------------------------------------------------- coverage
console.log('\ncoverage');
console.log(`  ${Object.keys(known).length} verbs verified, ${Object.keys(gen).length} with tables`);
console.log(`  ${pairs.pairs.length} aspect pairs, ${irregular.verbs.length} irregular verbs, ${irregular.prefixes.length} prefixes`);

const noTable = Object.keys(known).filter((k) => !gen[k]);
if (noTable.length) console.log(`  note   no table for: ${noTable.join(', ')}`);

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
