// Fetches the conjugation table from Polish Wiktionary for the few verbs English
// Wiktionary does not carry as their own page (nauczyć się, cieszyć się), and
// stores it in src/data/polish-fallback.json in the same shape as verbfacts.json.
//
// Polish Wiktionary's table (the "odmiana" wikitable) has no per-form markers.
// It is a small grid whose rows are labelled in words, so this reads it by row
// label and column position, then checks the result against what the site will
// claim: six present/future forms, six past forms per gender, an imperative.
// A verb whose table does not give a complete set is refued, not half-taken.
//
//   node tools/fetch-polish-wiktionary.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache', 'wiktionary-pl');
const OUT = path.join(ROOT, 'src', 'data', 'polish-fallback.json');
const UA = 'polski-verbs-study/1.0 (personal Polish-learning project)';
const API = 'https://pl.wiktionary.org/w/api.php';
fs.mkdirSync(CACHE, { recursive: true });

const WANTED = [
  { lemma: 'nauczyć się', page: 'nauczyć', gloss: 'to learn (and know it now) — the perfective of uczyć się', aspect: 'perfective', futureSimple: true },
  { lemma: 'cieszyć się', page: 'cieszyć', gloss: 'to be glad, to enjoy — cieszyć się z czegoś', aspect: 'imperfective', futureSimple: false },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function page(pageName) {
  const file = path.join(CACHE, encodeURIComponent(pageName) + '.json');
  if (fs.existsSync(file)) {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (c.text && c.text.length > 2000) return c;
    fs.unlinkSync(file);
  }
  const url = `${API}?action=parse&page=${encodeURIComponent(pageName)}&prop=text&format=json&formatversion=2&redirects=1`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const raw = await res.text();
  if (!/^\s*\{/.test(raw.slice(0, 20))) throw new Error('rate-limited');
  const j = JSON.parse(raw);
  if (!j.parse) throw new Error(`no page ${pageName}`);
  const out = { title: j.parse.title, text: j.parse.text };
  fs.writeFileSync(file, JSON.stringify(out));
  await sleep(1400);
  return out;
}

function plain(s) {
  return s
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<sup[^>]*>.*?<\/sup>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#160;|&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// Rows of the odmiana table, each as its cells' text.
function rowsOf(html) {
  const t = /<table class="wikitable odmiana[^"]*"[\s\S]*?<\/table>/.exec(html);
  if (!t) return [];
  const rows = [];
  for (const r of t[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [];
    for (const c of r[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)) {
      const span = /^(<t[hd][^>]*>)/.exec(c[0]);
      const colspan = /colspan="(\d+)"/.exec(span ? span[1] : '');
      const rowspan = /rowspan="(\d+)"/.exec(span ? span[1] : '');
      cells.push({ text: plain(c[1]), colspan: colspan ? Number(colspan[1]) : 1, rowspan: rowspan ? Number(rowspan[1]) : 1 });
    }
    rows.push(cells);
  }
  return rows;
}

const PERSONS = ['1.s', '2.s', '3.s', '1.p', '2.p', '3.p'];

// The six cells of a row, in person order, skipping a leading row label.
function six(cells, labelCount) {
  const vals = cells.slice(labelCount).map((c) => c.text).filter((s) => s && s !== '—' && s !== '-');
  return vals.length >= 6 ? vals.slice(0, 6) : null;
}

const out = {};
for (const w of WANTED) {
  let p;
  try { p = await page(w.page); } catch (e) { console.log(`${w.lemma}: ${e.message}`); continue; }
  const rows = rowsOf(p.text);
  const forms = {};
  const problems = [];
  let inCondBlock = false;

  for (const cells of rows) {
    const texts = cells.map((c) => c.text);
    // "pozostałe formy" opens the pluperfect, the conditional and the
    // participles. The conditional is wanted; the pluperfect is not tabled and
    // the participles come from the present and past rows, so a row that keeps
    // a gender letter in its first cells (the pluperfect) is skipped below.
    const label = texts.join(' ');
    const first = texts[0] || '';

    if (/^bezokolicznik/.test(first)) forms.infinitive = texts[1];

    // Present (cieszyć) or simple future (nauczyć): a label cell, then six.
    if (/^czas (teraźniejszy|przyszły prosty)/.test(first)) {
      const v = six(cells, 1);
      if (v) PERSONS.forEach((person, i) => { if (!forms[`present.${person}`]) forms[`present.${person}`] = v[i]; });
    }

    // Past: the gender letter is a cell of its own, after the row label on the
    // masculine row, or under a rowspan of three on the feminine and neuter ones.
    if (/^(czas przeszły|[mżn]$)/.test(first)) {
      const g = { m: 'm', 'ż': 'f', n: 'n' }[texts[0] === 'czas przeszły' ? texts[1] : texts[0]];
      if (g) {
        const vals = texts.slice(first === 'czas przeszły' ? 2 : 1).filter((t) => t && t !== '—' && t !== '-');
        if (vals.length >= 6) PERSONS.forEach((person, i) => { if (!forms[`past.${person}.${g}`]) forms[`past.${person}.${g}`] = vals[i]; });
        else if (vals.length >= 3 && g === 'n') {
          ['1.s', '2.s', '3.s'].forEach((person, i) => { if (!forms[`past.${person}.n`]) forms[`past.${person}.n`] = vals[i]; });
        }
      }
    }

    // Imperative: niech nauczę · naucz · niech nauczy · nauczmy · nauczcie · niech nauczą
    if (/^tryb rozkazujący/.test(first)) {
      const v = six(cells, 1);
      if (v) {
        forms['impr.1.p'] = v[3];
        forms['impr.2.s'] = v[1];
        forms['impr.2.p'] = v[4];
      }
    }

    // Conditional, inside the "pozostałe formy" block. The label takes a
    // rowspan of three, so it appears only on the masculine row; the feminine
    // and neuter rows start with their gender letter. The table also gives a
    // second order ("byłbym nauczył"), so only the first is taken.
    const isPluperfect = /czas zaprzeszły/.test(label);
    if (!isPluperfect) {
      const ci = texts.findIndex((t) => /tryb przypuszczający/.test(t));
      const g = ci >= 0
        ? { m: 'm', 'ż': 'f', n: 'n' }[texts[ci + 1]]
        : { m: 'm', 'ż': 'f', n: 'n' }[texts[0]];
      const start = ci >= 0 ? ci + 2 : 1;
      if (g && (ci >= 0 || inCondBlock)) {
        const vals = texts.slice(start)
          .map((t) => t.split(',')[0].trim())
          .filter((t) => t && t !== '—' && t !== '-');
        // gen-tables.mjs reads conditional.<person>.<gender>, with the plural
        // kept apart as vr (masculine persons) and nv (the rest).
        // person is "1.s" or "1.p" — the number is the second part.
        const key = (person) => {
          const isPlural = person.endsWith('.p');
          const gg = isPlural ? (g === 'm' ? 'vr' : 'nv') : g;
          return `conditional.${person}.${gg}`;
        };
        if (vals.length >= 6) PERSONS.forEach((person, i) => {
          if (!forms[key(person)]) forms[key(person)] = vals[i];
          if (person.includes('.p.')) {
            const alt = `conditional.${person}.${g}`;
            if (!forms[alt]) forms[alt] = vals[i];
          }
        });
        else if (vals.length >= 3 && g === 'n') {
          ['1.s', '2.s', '3.s'].forEach((person, i) => { if (!forms[`conditional.${person}.n`]) forms[`conditional.${person}.n`] = vals[i]; });
        }
      }
    }
    if (/tryb przypuszczający/.test(label)) inCondBlock = true;
    if (/^imiesłów|^rzeczownik/.test(label)) inCondBlock = false;
  }

  // Checks: what the verb will claim must be there, and in the right shape.
  for (const person of PERSONS) if (!forms[`present.${person}`]) problems.push(`no present/future ${person}`);
  for (const g of ['m', 'f']) for (const person of PERSONS) {
    if (!forms[`past.${person}.${g}`]) problems.push(`no past ${person} ${g}`);
  }
  for (const person of ['1.s', '2.s', '3.s']) {
    if (!forms[`past.${person}.n`]) problems.push(`no past ${person} n`);
  }
  if (!forms['impr.2.s']) problems.push('no imperative');
  if (!forms.infinitive) problems.push('no infinitive');

  // Sanity on the shape: the 1st person plural must end in -my, 2nd plural in -cie/-ście.
  if (forms['present.1.p'] && !/my$/.test(forms['present.1.p'])) problems.push(`present 1.p looks wrong: ${forms['present.1.p']}`);
  if (forms['present.2.p'] && !/(cie|ecie)$/.test(forms['present.2.p'])) problems.push(`present 2.p looks wrong: ${forms['present.2.p']}`);
  if (forms['past.1.p.m'] && !/śmy$/.test(forms['past.1.p.m'])) problems.push(`past 1.p looks wrong: ${forms['past.1.p.m']}`);

  // The Polish Wiktionary table writes the reflexive tabla without się. Every
  // real sentence carries it, and the English-scraper verbs get it added there,
  // so it is added here once, for every form that does not already have it.
  for (const key of Object.keys(forms)) {
    if (forms[key] && !/się/.test(forms[key])) forms[key] = `${forms[key]} się`;
  }

  if (problems.length) {
    console.log(`${w.lemma}: not taken — ${problems.slice(0, 4).join('; ')}`);
    continue;
  }

  out[w.lemma] = {
    lemma: w.lemma,
    gloss: w.gloss,
    note: 'Taken from Polish Wiktionary; English Wiktionary has no page of its own for this verb.',
    aspect: w.aspect,
    partner: null,
    futureSimple: w.futureSimple,
    conjClass: null,
    forms,
    source: `https://pl.wiktionary.org/wiki/${encodeURIComponent(w.page)}`,
    fromPolishWiktionary: true,
  };
  console.log(`${w.lemma}: ${Object.keys(forms).length} forms — ${forms['present.1.s']}, ${forms['present.3.p']}, ${forms['past.3.s.f']}`);
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`\n${Object.keys(out).length} verbs written to src/data/polish-fallback.json`);
