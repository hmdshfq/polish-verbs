# Polski czasowniki

The Polish verb in twelve chapters, in the style of the seven-cases site: reference pages,
verified conjugation tables, and drills that explain every answer.

**Nothing on this site is an unverified form.** Every conjugation table is generated from the
inflection table on Wiktionary, and the prose was cross-checked against those tables by script.

## Run it

```sh
npm run build     # data -> dist/
npm run check     # data, structure and prose checks
npm run serve     # http://localhost:4399
npm run verify    # build + check + syntax, the gate before a commit
```

Node is at `/usr/local/bin/node`; if `node` is not found, put it on the PATH first:

```sh
export PATH=/usr/local/bin:$PATH
```

## How the data flows

```
src/data/verbs-input.json      the 71 verbs to document
        |
tools/fetch-wiktionary.mjs     scrape {{pl-conj}} rows  -> .cache/wiktionary/
tools/fetch-polish-wiktionary.mjs  the two verbs English Wiktionary lacks -> polish-fallback.json
tools/gen-tables.mjs           forms -> generated.json   (present, past, imperative,
        |                                                conditional, participles, source)
src/data/chapters.json         the twelve chapters and their metadata
src/data/pairs.json            38 aspect pairs, four pair types
src/data/rekcja.json           case government: 5 groups, 45 verbs, negation, quantity
src/data/irregular.json        15 irregular verbs, 12 prefixes
src/data/extras.json           flashcards and the 7-day plan for each chapter
src/data/bank/*.json           the drill bank: 272 items, every answer explained
tools/build-catalog.mjs        bank -> catalog.json (what the app runs on)
tools/build.mjs                content + shell + generated tables -> dist/
```

Content lives in `src/content/<chapter-id>.html` as a fragment. The builder puts it inside the
shared shell, fills `{{conj:verb}}`, `{{compare:a,b}}`, `{{pairs}}`, `{{rekcja}}`, `{{negation}}`,
`{{irregular}}` and `{{prefixes}}` from the verified data, and writes a page per chapter.

### What is committed, and what is not

`verbfacts.json`, `polish-fallback.json` and `generated.json` are all committed. The scrape is not
re-run by a normal build, so a fresh clone builds offline from data that is already in the repo, and
the forms a reader sees are the forms that were reviewed.

```sh
npm run refresh   # re-scrape Wiktionary and regenerate generated.json — needs the network
npm run build     # offline: reads the committed generated.json
```

`generated.json` is reproducible from the two committed fact files without the network
(`node tools/gen-tables.mjs`), and the output is byte-identical, so a refresh that changes nothing
leaves the working tree clean. `.cache/` (the raw wiki pages, ~10 MB) and `dist/` are ignored.

A chapter fragment must contain these three mounts, because the app binds to them:

```html
<div class="chips" id="drillProgress" data-chapter="ID"></div>
<div id="drillRoot" data-chapter="ID"></div>
<div class="fcgrid" id="fcGrid" data-chapter="ID"></div>
<div class="plan" id="planRoot" data-chapter="ID"></div>
```

## The checks

| script | what it proves |
| --- | --- |
| `tools/validate-data.mjs` | every aspect pair agrees with the scraped tables (135 assertions) |
| `tools/check-content.mjs` | every page has its drill/flashcard/plan mounts, no unresolved slot, balanced tags, unique section numbers, no dead internal link |
| `tools/check-forms.mjs` | every Polish word in the prose is either a verified form of one of the 71 verbs or known vocabulary; a word one edit from a verified form (what a mistyped conjugation looks like) fails the check unless it is explained in `ALLOWED` |
| `tools/classify.mjs` | prints the verbs sorted into their conjugation I–IV patterns, used to write chapter 3 from the data rather than from memory |

`check-forms.mjs` does two things. It lists the words it could not match against the paradigms —
endings (`-esz`), vocabulary outside the 71 verbs, and deliberate counter-examples (`kupowam`,
`robł`, `pisł`) — so a human can read them. And it fails the build on any *near miss*: a prose word
one insertion, deletion or substitution away from a verified form. That is exactly the shape of a
mistyped conjugation, so each one must be either fixed or explained in `ALLOWED` at the top of the
script, with the reason. Plant `pizał` in `past.html` and `npm run check` stops.

## Sources

Every verb table on the site links to its own source. In practice that is
[English Wiktionary](https://en.wiktionary.org)'s Polish inflection templates, which are
machine-readable and carry the `{{pl-conj}}` row markers this project parses; the two verbs with no
English page (`nauczyć się`, `cieszyć się`) come from
[Polish Wiktionary](https://pl.wiktionary.org).

Two imperative forms are quoted exactly as Wiktionary gives them and are tagged as such in the
source: `widzieć → widź`, `musieć → muś`. They are grammatical but not used in speech, so the
imperative chapter does not teach them.

## Conventions

- Polish text is wrapped in `<span class="pl">…</span>`.
- The drill engine escapes HTML, so drill question text may only use `<span class="pl">`, `<i>` and
  `<b>`; `renderInline()` in `src/app.js` re-enables exactly those three.
- Progress lives in `localStorage` under `polski.verbs.progress.v1`, with a JSON export/import on
  the progress page for carrying it between devices.

## Storage: no database, and why

The site is static. `dist/` is plain files, there is no `functions/` directory and no `wrangler.toml`,
and nothing on any page talks to a server. That is a deliberate decision, not an omission.

A learner's progress is a small object — per drill item how often it was seen, when it is next due,
and which box it is in — and it belongs to one person on one device. `localStorage` holds it, and the
progress page exports it to a file (`polski.verbs.progress`, version 1) and loads such a file back,
which is how it moves to a phone. Nothing is uploaded, so there is nothing to secure and no personal
data to keep.

**Cloudflare D1 is therefore not needed.** It would not cost much — Workers Free includes D1 with
5M rows read and 100K rows written a day and 5 GB of storage, which this workload would not trouble —
so the argument against it is not price. It is that a database buys you a *shared* progress record,
and a shared record needs a way to know whose it is:

| | With D1 | What it costs you |
| --- | --- | --- |
| identity | sync code, or an account | a 32-character code is a bearer secret: anyone who sees it reads and overwrites that progress. An account means auth, a reset flow and a privacy note. |
| ops | a Worker, a D1 binding, a migration | another moving part to keep working, and migrations to apply by hand on every change |
| data | the learner's own drilling history | a stored copy now needs a deletion path and a backup story |

The cases site does run D1, because it was built to sync across devices by code. That is a product
decision, not a requirement of the content: it could have shipped the same file export. If sync ever
is wanted here, the honest minimum is an account or a signed per-person link, not a shared code.

What would change this: more than one person using the same device, real cross-device progress
without files, or a teacher seeing a class's results. None of those is true today.
