// Cross-checks every Polish word written in the chapter prose against the
// verified paradigms, so a typo in a conjugation cannot reach the reader.
//
// Two levels:
//   1. Every word inside <span class="pl"> is checked against the verified
//      forms. Words that are not forms are collected — they are endings,
//      real inflected words outside the 71 verbs, or deliberate wrong forms
//      the chapter is warning about.
//   2. A word that is one edit away from a verified form is a *near miss*.
//      That is exactly what a mistyped conjugation looks like, so every near
//      miss must be explained in ALLOWED below or the check fails.
//
//   node tools/check-forms.mjs        # fails on an unexplained near miss
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const generated = JSON.parse(read('src/data/generated.json')).verbs;

// Every verified form of every verb, lowercased, without się.
const forms = new Set();
const bare = (s) => String(s).replace(/ się$/, '').trim();
for (const [lemma, v] of Object.entries(generated)) {
  forms.add(bare(lemma).toLowerCase());
  for (const key of ['present', 'past', 'imperative', 'conditional'])
    for (const r of v[key]) if (r.form) forms.add(bare(r.form).toLowerCase());
  for (const k of ['act', 'pass', 'adv', 'noun'])
    if (v.participles && v.participles[k]) forms.add(bare(v.participles[k]).toLowerCase());
  if (v.impersonals && v.impersonals.past) forms.add(bare(v.impersonals.past).toLowerCase());
}

// Words the prose uses on purpose that are not forms in the 71 paradigms:
// nouns, adjectives, other verbs, fixed phrases.
const known = new Set(
  `
  się nie tak jak że ale czy to ten ta tego tej tym tych te ci tam tu tutaj teraz
  wczoraj jutro dzisiaj dziś rano wieczorem zawsze często nigdy już jeszcze tylko bardzo dużo mało
  trochę kilka pięć dwa jeden kot koty kotów czas czasu chleb chleba mleko mleka woda wody kawa kawę
  herbata herbatę list listu listy listów książka książkę książki książek gazeta gazetę gazety
  okno okna drzwi klucz klucze kluczy samochód samochody dom domu pracy praca pracę szkoła szkoły
  sklep sklepu sklepie miasto mieście Łódź Łodzi Polska Polski polski polskiego po polsku
  Warszawa Kraków Pakistan Pakistanu muzeum kino restauracja obiad kolacja śniadanie jedzenie picie
  prezent prezenty umowa umowę bilety bilet lekarz lekarka nauczyciel nauczycielowi programista
  programistą mama mamie matka ojciec brat brata siostra dziecko dzieci człowiek człowieka kobieta
  mężczyzna osoba osoby ludzie ludziom Anna Marek Piotr pan pani państwo panie panu
  dzień dnia tydzień miesiąc rok roku lata lat godzina godzinę godzin dwie trzy cztery
  zmęczony zmęczona zmęczeni gotowy gotowi dobra dobry dobrym lepszy lepiej ważne przyjemne
  zdrowe konieczne szczerze ciemność ciemności pomoc pomocy pomocą historią historię muzyki muzykę
  praca firmą firmę dziećmi dzieckiem ręce rąk nogi głowa głowę
  wszystko coś nic nikt gdzie kiedy dlaczego jak ile który która które
  do z na o od po pod nad przed za przez przy bez dla ku w we
  i a oraz lub albo bo więc żeby jeśli jeżeli gdyby gdybyś gdybym gdybyśmy
  niech proszę przepraszam dziękuję dobrze witam cześć tak ocena
  nawet też także może można trzeba warto
  nazywa nazywam nazywasz uczy uczyłem uczyłaś
  pisanie czytanie kupowanie mycie spanie
  dumny proszony zaproszony
  `.split(/\s+/).filter(Boolean).map((w) => w.toLowerCase())
);

// Every near miss in the prose, with why it is right. A word one edit from a
// verified form is what a mistyped conjugation looks like; these are the ones
// that are meant.
const ALLOWED = new Map(Object.entries({
  // Real Polish words that happen to sit one letter from a site form.
  'dwie': 'two (f.) — near wie',
  'gdzie': 'where — near idzie',
  'jeśli': 'if — near jedli',
  'jeżeli': 'if — near leżeli',
  'mało': 'little — near miało/dało',
  'panie': 'sir (voc.) — near danie/spanie',
  'pięć': 'five — near pić',
  'rano': 'morning — near bano/brano',
  'umieć': 'to be able — near mieć',
  'śmieć': 'to dare — near mieć',
  // Participles and gerunds of verbs outside the 71 that the chapter explains.
  'napisan': 'written (short part.) — the chapter contrasts it with napisany',
  'napisana': 'written (f.) — example of the passive participle',
  'napisane': 'written (n.) — example of the passive participle',
  'pisząca': 'writing (f. act. part.) — example of the active participle',
  'piszące': 'writing (n./pl. act. part.) — example of the active participle',
  // Deliberate wrong forms: the chapter names them as mistakes.
  'kupowam': 'WRONG — present.html:150 says this form does not exist',
  'pracowam': 'WRONG — present.html:150 says this form does not exist',
  'kupujenie': 'WRONG — present.html:153 contrasts it with kupowanie',
  'pisł': 'WRONG — past.html:34 says never *pisł',
  'robł': 'WRONG — past.html:34 says never *robł',
}));

// A word is a near miss when one insertion, deletion or substitution turns it
// into a verified form.
const isNearMiss = (a, b) => {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
};

const bareForms = [...forms].filter((f) => /^[a-ząćęłńóśźż]+$/.test(f));
const files = fs.readdirSync(path.join(ROOT, 'src/content')).filter((f) => f.endsWith('.html'));
const tokenRe = /<span class="pl">([^<]{1,80})<\/span>/g;

const unknown = new Map();
const nearMisses = new Map();
const wired = new Set();

for (const f of files) {
  const html = read('src/content/' + f);
  const chapter = f.replace('.html', '');
  let m;
  while ((m = tokenRe.exec(html))) {
    const pieces = m[1].replace(/[—–,.;:!?()„”"'*]/g, ' ').split(/\s+/).filter(Boolean);
    for (const p of pieces) {
      const w = bare(p).toLowerCase();
      if (!w || /^[0-9]+$/.test(w)) continue;
      if (forms.has(w) || known.has(w)) continue;
      if (!unknown.has(w)) unknown.set(w, new Set());
      unknown.get(w).add(chapter);
      if (!/^[a-ząćęłńóśźż]+$/.test(w) || w.length < 4) continue;
      const near = bareForms.filter((x) => Math.abs(x.length - w.length) <= 1 && isNearMiss(w, x));
      if (!near.length) continue;
      if (ALLOWED.has(w)) { wired.add(w); continue; }
      nearMisses.set(w, near.slice(0, 4));
    }
  }
}

const rows = [...unknown.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pl'));
console.log('verified forms in the 71 paradigms:', forms.size);
console.log('Polish words in prose not found as a site form:', rows.length);
console.log('');

let failed = 0;
if (nearMisses.size) {
  failed = 1;
  console.log('FAIL — a word is one edit from a verified form and not explained:');
  for (const [w, near] of nearMisses) {
    console.log('  ' + w.padEnd(16) + ' looks like ' + near.join(', '));
    console.log('  ' + ''.padEnd(16) + ' fix the form, or add it to ALLOWED in tools/check-forms.mjs');
  }
  console.log('');
}

// An ALLOWED entry that no longer appears is an allowlist going stale: a wrong
// form may have been removed, or a chapter edited. Say so, but do not fail.
// Words in `known` never reach the near-miss check, so they are not stale.
const unused = [...ALLOWED.keys()].filter((w) => !wired.has(w) && !forms.has(w) && !known.has(w));
if (unused.length) console.log('note — ALLOWED entries no longer present in the prose:', unused.join(', '));

if (!failed) console.log('every near miss in the prose is explained · 0 unexplained');
process.exit(failed);
