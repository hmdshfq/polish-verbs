# Polski czasowniki

The Polish verb in twelve chapters, in the style of the seven-cases site: reference pages,
verified conjugation tables, and drills that explain every answer.

**Nothing on this site is an unverified form.** Every conjugation table is generated from the
inflection table on Wiktionary, and the prose was cross-checked against those tables by script.

## Run it

```sh
npm run build     # data -> dist/
npm run check     # data, structure and prose checks
npm run dev       # build, then the Worker at http://localhost:8787 (API included)
npm run serve     # dist/ only, no API: http://localhost:4399
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
  the progress page, and — when a sync code exists — a merged copy in D1 that follows the learner
  between devices.

## Deploying

The site runs as a Cloudflare Worker with static assets. `dist/` is uploaded as assets; a request
that matches an asset is served without running any code, and only a path that matches nothing
reaches `worker/index.js`. That is how `/api/progress` is served, and why a page view costs no
invocation.

```sh
git clone … && npm install
npm run deploy        # build dist/, then wrangler deploy
npm run db:migrate    # apply migrations/ to the remote D1 database
```

| what | where |
| --- | --- |
| Worker name, assets directory (`dist/`, binding `ASSETS`), D1 binding | `wrangler.jsonc` |
| the Worker: one endpoint, plus a fall-through to assets | `worker/index.js` |
| the table | `migrations/0001_progress.sql` |
| deploy and migrate commands | `package.json` |

`wrangler.jsonc` holds the D1 `database_id`, so a deploy goes to that one database. Applying a
migration is manual and deliberate: `npm run db:migrate` for the deployed site,
`wrangler d1 migrations apply DB --local` for `npm run dev`.

### Storage, and what it costs

Progress is local-first: `localStorage` holds it, and a sync code adds a D1 row that two devices
merge item by item. The copy on the device is always kept, so a database that cannot be reached
never costs an answer, and the file export still moves progress with no code and no network.

One row per code, `{ rev, data, items, updated_at }`. The document in `data` belongs to the client:
the Worker stores and returns it and never reads inside it, so a change to the progress shape needs
no migration. `rev` is stamped by the Worker, not the device, so a phone with a wrong clock cannot
make an old save win.

A 12-character code — shown as `XXXX XXXX XXXX` — is a bearer secret, not an account: whoever sees it reads and overwrites that
progress, there is no reset flow, and a lost code means a new code and a lost server copy — the
device keeps working either way.
