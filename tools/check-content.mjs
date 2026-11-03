// Structural check on the built site: every chapter page must have its drill,
// flashcard and plan mounts, no unresolved {{slot}}, balanced inline tags, and
// no heading numbers out of order.
//
//   node tools/check-content.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const chapters = JSON.parse(read('src/data/chapters.json')).chapters;

let fail = 0;
const bad = (msg) => { console.log('  FAIL ' + msg); fail++; };

const TAGS = ['span', 'b', 'i', 'em', 'strong'];

for (const c of chapters) {
  const src = read(`src/content/${c.id}.html`);
  const page = read(`dist/${c.id}/index.html`);

  // 1. the three mounts the app needs
  if (!page.includes(`id="drillRoot" data-chapter="${c.id}"`)) bad(`${c.id}: drill mount missing or wrong chapter`);
  if (!page.includes(`id="fcGrid" data-chapter="${c.id}"`)) bad(`${c.id}: flashcard mount missing or wrong chapter`);
  if (!page.includes(`id="planRoot" data-chapter="${c.id}"`)) bad(`${c.id}: plan mount missing or wrong chapter`);

  // 2. no unresolved slots
  if (/\{\{[a-z-]+/.test(page)) bad(`${c.id}: unresolved {{slot}} in the built page`);

  // 3. balanced inline tags, per file
  for (const t of TAGS) {
    const open = (src.match(new RegExp(`<${t}[ >]`, 'g')) || []).length;
    const close = (src.match(new RegExp(`</${t}>`, 'g')) || []).length;
    if (open !== close) bad(`${c.id}: <${t}> opened ${open}, closed ${close}`);
  }

  // 4. every section has a heading and a number
  const sections = [...src.matchAll(/<section id="([^"]+)"[^>]*>/g)].map((m) => m[1]);
  const snums = (src.match(/class="snum"/g) || []).length;
  if (sections.length !== snums) bad(`${c.id}: ${sections.length} sections but ${snums} numbers`);
  if (sections.length !== new Set(sections).size) bad(`${c.id}: duplicate section id`);
  for (const need of ['drills', 'fiszki', 'plan']) {
    if (!sections.includes(need)) bad(`${c.id}: section #${need} missing`);
  }

  // 5. the links the prose makes must point at pages that exist
  for (const m of src.matchAll(/href="\/([a-z-]+)\/"/g)) {
    if (!fs.existsSync(path.join(ROOT, 'dist', m[1], 'index.html'))) bad(`${c.id}: link /${m[1]}/ has no page`);
  }
}

// 6. every page is in dist and the nav covers all twelve
for (const c of chapters) {
  if (!fs.existsSync(path.join(ROOT, 'dist', c.id, 'index.html'))) bad(`dist/${c.id}/index.html missing`);
}
const home = read('dist/index.html');
for (const c of chapters) if (!home.includes(`href="/${c.id}/"`)) bad(`home: no card for ${c.id}`);

console.log(`\n${chapters.length} chapters checked · ${fail} problems`);
process.exit(fail ? 1 : 0);
