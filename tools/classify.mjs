// Prints every verified verb sorted into its infinitive ending and its
// present-tense pattern, so the prose in the chapters can name the real groups.
//
//   node tools/classify.mjs
import fs from 'node:fs';

const g = JSON.parse(fs.readFileSync(new URL('../src/data/generated.json', import.meta.url), 'utf8')).verbs;
const bare = (s) => (s || '').replace(/ się$/, '');

const groups = {};
for (const [lemma, v] of Object.entries(g)) {
  if (v.presentIsFuture) continue;
  const [ja, ty] = v.present.map((r) => bare(r.form));
  // The ty form carries the pattern: which ending follows its stem.
  const SUFFIXES = ['jesz', 'iesz', 'esz', 'isz', 'ysz', 'asz'];
  const suf = SUFFIXES.find((s) => ty.endsWith(s));
  let pat;
  if (suf === 'asz') pat = '-am / -asz';
  else if (suf === 'esz' || suf === 'jesz' || suf === 'iesz') pat = /-em$/.test(ja) ? '-em / -esz' : '-ę / -esz';
  else if (suf === 'isz' || suf === 'ysz') pat = '-ę / -isz';
  else pat = 'UNMATCHED ' + ja + ' / ' + ty;

  const inf = bare(lemma);
  const ends = ['ować', 'ywać', 'awać', 'ieć', 'eć', 'ić', 'yć', 'uć', 'ąć', 'ąść', 'ść', 'ać', 'ec'];
  const end = ends.find((e) => inf.endsWith(e)) || '?';
  const k = '-' + end + '  ' + pat;
  (groups[k] = groups[k] || []).push(`${lemma} (${ja}/${ty})`);
}

for (const k of Object.keys(groups).sort()) {
  console.log('\n## ' + k + '  [' + groups[k].length + ']');
  console.log('   ' + groups[k].join(', '));
}
