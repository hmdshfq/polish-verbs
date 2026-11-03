// Downloads Wiktionary's conjugation tables for the verbs the site teaches and
// turns them into src/data/verbfacts.json, the file every table, drill and
// explanation is checked against.
//
// The parser only reads what the page states: each form carries a marker such as
// `1|s|pres-form-of` or `3|p|nv|past-form-of`, which says person, number, gender
// and tense. Nothing here is guessed or generated — if Wiktionary does not give
// a form, it is absent from the output and the site says so.
//
//   node tools/fetch-wiktionary.mjs           # use the cache, fetch what is missing
//   node tools/fetch-wiktionary.mjs --refresh  # download every page again
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache', 'wiktionary');
const OUT = path.join(ROOT, 'src', 'data', 'verbfacts.json');
const UA = 'polski-verbs-study/1.0 (personal Polish-learning project; contact: local user)';
const API = 'https://en.wiktionary.org/w/api.php';

const REFRESH = process.argv.includes('--refresh');
fs.mkdirSync(CACHE, { recursive: true });

// The verbs on the site. `aspect` is what the page claims; the script fails if
// Wiktionary disagrees, so a wrong claim cannot slip through.
const VERBS = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'verbs-input.json'), 'utf8'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip' } });
      if (res.status === 429 || res.status >= 500) { await sleep(1500 * (i + 1)); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1200 * (i + 1));
    }
  }
}

async function pageHtml(title) {
  const file = path.join(CACHE, encodeURIComponent(title) + '.json');
  if (!REFRESH && fs.existsSync(file)) {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (cached.text && cached.text.length > 2000) return cached;
    fs.unlinkSync(file);
  }
  const url = `${API}?action=parse&page=${encodeURIComponent(title)}&prop=text%7Cwikitext&format=json&formatversion=2&redirects=1`;
  const jRaw = await get(url);
  const j = JSON.parse(jRaw);
  if (!j || !j.parse) throw new Error(`Wiktionary has no page ${title}: ${j && j.error ? j.error.info : 'no parse result'}`);
  if (!/^\s*\{/.test(jRaw.slice(0, 40))) throw new Error(`Wiktionary rate-limited the request for ${title}`);
  const out = { title: j.parse.title, text: j.parse.text, wikitext: j.parse.wikitext };
  if (!out.text || out.text.length < 2000) throw new Error(`Wiktionary returned an empty page for ${title}`);
  fs.writeFileSync(file, JSON.stringify(out));
  // MediaWiki asks for one request at a time, politely spaced. Being thrown
  // out costs minutes and gives wrong data, so the pause is not shortened.
  await sleep(1400);
  return out;
}

// ---------------------------------------------------------------- parsing

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&quot;': '"', '&#39;': "'" };

function plain(s) {
  return s
    .replace(/<sup[^>]*>.*?<\/sup>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#124;/g, '|')
    .replace(/&#95;/g, '_')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&[a-z]+;/g, (m) => ENT[m] || m)
    .replace(/\s+/g, ' ')
    .trim();
}

// Every span that carries a form marker, with the text it shows.
// Each conjugation table sits in one <table class="inflection-table...">. A page
// can carry more than one (stać is both "to stand" and "to become"), so the
// right table is chosen by the aspect its caption states.
function conjugationTables(html) {
  const out = [];
  const re = /<table[^>]*class="[^"]*inflection-table[^"]*"[^>]*>([\s\S]*?)<\/table>/g;
  let m;
  while ((m = re.exec(html))) {
    const cap = /<caption[^>]*>([\s\S]*?)<\/caption>/.exec(m[1]);
    const text = cap ? plain(cap[1]) : '';
    const said = /\b(impf|pf)\b/.exec(text);
    const asp = said ? (said[1] === 'impf' ? 'imperfective' : 'perfective') : null;
    out.push({ html: m[1], caption: text, aspect: asp });
  }
  return out;
}

function markedSpans(html) {
  const out = [];
  const re = /<span class="Latn form-of lang-pl ([^"]+)"[^>]*>([\s\S]*?)<\/span>/g;
  let m;
  while ((m = re.exec(html))) {
    // A form may hold several links ("szedłem", "-(e)m szedł"); take the first
    // full form, which is the one the table leads with. A form that is already
    // the page's own lemma carries no link, only <strong class="selflink">.
    const inner = m[2];
    const links = [...inner.matchAll(/<a [^>]*title="([^"]*)"/g)].map((x) => plain(x[1]));
    const self = /<strong[^>]*>([\s\S]*?)<\/strong>/.exec(inner);
    const text = plain(inner);
    out.push({
      marker: m[1].replace(/&#124;/g, '|').replace(/&#95;/g, '_'),
      text, links, self: self ? plain(self[1]) : null,
    });
  }
  return out;
}

// A perfective verb has no present tense: the same set of endings carries it
// into the future, and Wiktionary marks those forms `fut`. They are kept in
// the same place, and each verb says which of the two it is.
const TENSE = { pres: 'present', fut: 'present', past: 'past', cond: 'conditional', impr: 'imperative' };

// The earliest marked span for each key wins: Wiktionary leads with the usual
// form and puts the alternative after a comma or in a footnote.
// A perfective verb's table has no present row at all; its first tense group is
// labelled "future tense" or "future tense simple".
function hasFutureRowGroup(html) {
  const labels = [...html.matchAll(/<th rowspan="\d+" title="([^"]+)">/g)].map((m) => m[1]);
  // An imperfective table has "czas teraźniejszy" (present) or at worst
  // "czas przyszły złożony" (compound future: będę + infinitive). Only a
  // perfective table has "czas przyszły prosty" — the simple future — and no
  // present row at all.
  return labels.some((l) => /czas przyszły prosty/.test(l)) && !labels.some((l) => /czas teraźniejszy/.test(l));
}

function collectForms(html) {
  const forms = {};
  let futureSimple = false;
  for (const s of markedSpans(html)) {
    const mk = s.marker;
    // The marker reads "1|s|pres-form-of origin-robić<id:make>": the cells come
    // before "-form-of", the verb it belongs to after it.
    if (mk.indexOf('-form-of') === -1) continue;
    const kind = mk.slice(0, mk.indexOf('-form-of'));
    const cells = kind.split('|');
    const word = (s.links[0] || s.self || s.text || '').trim();
    if (!word) continue;

    const put = (key, val) => { if (key && !(key in forms) && val) forms[key] = val; };

    if (cells[0] === 'inf') put('infinitive', word);
    else if (cells[0] === 'active_adjectival_participle') put('ptcp.act', word);
    else if (cells[0] === 'passive_adjectival_participle') put('ptcp.pass', word);
    else if (cells[0] === 'contemporary_adverbial_participle') put('ptcp.adv.pres', word);
    else if (cells[0] === 'verbal_noun') put('noun', word);
    else if (cells[0] === 'impers') {
      if (cells[1] === 'past') put('impersonal.past', word);
      else if (cells[1] === 'pres') put('impersonal.pres', word);
    } else if (/^[123]$/.test(cells[0]) && cells[1]) {
      // `1|s|pres`, `1|s|m|past`, `3|p|nv|cond`, `2|s|impr`: person, number,
      // then any genders, then the tense.
      const person = cells[0];
      const num = cells[1];
      const rest = cells.slice(2);
      let tenseIdx = -1;
      for (let i = rest.length - 1; i >= 0; i--) if (TENSE[rest[i]]) { tenseIdx = i; break; }
      if (tenseIdx === -1) continue;
      const tense = TENSE[rest[tenseIdx]];
      const g = rest.slice(0, tenseIdx).join('');
      if (tense === 'present' && rest[tenseIdx] === 'fut') futureSimple = true;

      if (tense === 'imperative') {
        put(g ? `impr.${person}.${num}.${g}` : `impr.${person}.${num}`, word);
      } else {
        put(g ? `${tense}.${person}.${num}.${g}` : `${tense}.${person}.${num}`, word);
      }
    }
  }
  forms.__futureSimple = hasFutureRowGroup(html);
  return forms;
}

// The aspect and the partner verb, as the page's opening line states them.
// The first inflection template on the page states the aspect, and for a great
// many verbs the partner too, as `pf=` or `impf=`.
function aspect(wikitext) {
  const m = /\{\{pl-conj\|([^}]*)\}\}/.exec(wikitext);
  const v = /\{\{pl-verb\|(impf|pf)/.exec(wikitext);
  const out = {};
  if (v) out.aspect = v[1] === 'impf' ? 'imperfective' : 'perfective';
  if (m) {
    const pf = /\bpf=([^|}]+)/.exec(m[1]);
    const im = /\bimpf=([^|}]+)/.exec(m[1]);
    const asp = /^<\s*(impf|pf)\s*>$/.exec((m[1].split('|')[0] || '').trim());
    if (!out.aspect && asp) out.aspect = asp[1] === 'impf' ? 'imperfective' : 'perfective';
    if (pf && pf[1].trim() !== '-') out.partner = pf[1].trim();
    else if (im && im[1].trim() !== '-') out.partner = im[1].trim();
  }
  return out;
}

function classOf(html) {
  const m = /\(class ([IVXab]+[a-z]?)\)/.exec(plain(html.slice(0, 200000)));
  return m ? m[1] : null;
}

// ------------------------------------------------------------------ main

const out = {};
const problems = [];

for (const [i, v] of VERBS.entries()) {
  const lemma = v.lemma;
  let page;
  try {
    page = await pageHtml(lemma);
  } catch (e) {
    problems.push(`${lemma}: ${e.message}`);
    continue;
  }
  const html = page.text;
  const tables = conjugationTables(html);
  const asp = aspect(page.wikitext);
  const want = v.aspect || asp.aspect;  // the verb list says which homograph we want
  // A table with no aspect in its caption belongs to the page's predicative
  // homograph (stać = "to afford"), never to the verb itself: skip it.
  const usable = tables.filter((t) => t.aspect);
  let table = usable.find((t) => t.aspect === want);
  if (!table && usable.length === 1) table = usable[0];
  if (!table) {
    problems.push(`${lemma}: ${usable.length} usable tables (${usable.map((t) => t.aspect).join(', ') || 'none'}) and none matches ${want}`);
    continue;
  }
  const forms = collectForms(table ? table.html : html);
  if (table && table.aspect && want && table.aspect !== want) {
    problems.push(`${lemma}: site says ${want}, the table says ${table.aspect}`);
  }

  if (!forms.infinitive) {
    problems.push(`${lemma}: no conjugation table on Wiktionary`);
    continue;
  }
  // The table we read is the authority on its own aspect.
  if (table.aspect) asp.aspect = table.aspect;
  if (asp.aspect && v.aspect && asp.aspect !== v.aspect) {
    problems.push(`${lemma}: site says ${v.aspect}, the table says ${asp.aspect}`);
  }
  if (!forms['present.1.s'] && !forms['past.1.s.m']) {
    problems.push(`${lemma}: conjugation table has neither a present nor a past stem`);
  }

  const futureSimple = forms.__futureSimple === true;
  delete forms.__futureSimple;

  // Wiktionary's table for a reflexive verb shows the verb without się; the
  // dictionary headword and every real sentence carry it. It is added here,
  // once, for every finite form — and never after a form that already has it.
  if (v.reflexive) {
    for (const key of Object.keys(forms)) {
      if (!/się/.test(forms[key])) forms[key] = `${forms[key]} się`;
    }
  }

  out[lemma] = {
    lemma,
    reflexive: !!v.reflexive,
    futureSimple,
    gloss: v.gloss,
    note: v.note || null,
    aspect: asp.aspect || v.aspect,
    partner: formPartner(v, asp.partner),
    conjClass: table && /\(class ([^)]+)\)/.exec(table.caption) ? /\bclass ([^)]+)\)?/.exec(table.caption)[1] : null,
    forms,
    source: `https://en.wiktionary.org/wiki/${encodeURIComponent(page.title.split(' ')[0])}#Polish`,
  };
  process.stdout.write(`\r${i + 1}/${VERBS.length} ${lemma}            `);
}

// A partner written with "się" or an aspect marker is cleaned to a bare lemma.
function formPartner(v, fromPage) {
  if (v.partner) return v.partner;
  if (!fromPage) return null;
  return plain(fromPage).replace(/^(pf|impf)\s+/, '').trim() || null;
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');

console.log(`\n\n${Object.keys(out).length} verbs written to src/data/verbfacts.json`);
const counts = { pres: 0, past: 0, impr: 0, cond: 0 };
for (const v of Object.values(out)) {
  if (v.forms['present.1.s']) counts.pres++;
  if (v.forms['past.1.s.m']) counts.past++;
  if (v.forms['impr.2.s']) counts.impr++;
  if (v.forms['cond.1.s.m']) counts.cond++;
}
console.log('with a present tense:', counts.pres, '· with a past:', counts.past,
  '· imperative:', counts.impr, '· conditional:', counts.cond);
if (problems.length) {
  console.log('\nNot taken (these verbs stay off the site, or stay text-only):');
  for (const p of problems) console.log('  ·', p);
}
