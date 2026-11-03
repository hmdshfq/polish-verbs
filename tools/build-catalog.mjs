// Builds src/data/catalog.json: the chapters with their drill sets, and the
// counts every page quotes. The drill bank itself lives in src/data/bank/*.json,
// one file per chapter, so a chapter's questions sit next to nothing else.
//
//   node tools/build-catalog.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));

const chapters = json('src/data/chapters.json').chapters;
const bankDir = path.join(ROOT, 'src', 'data', 'bank');

const out = { chapters: [], total: 0 };
for (const c of chapters) {
  const file = path.join(bankDir, `${c.id}.json`);
  if (!fs.existsSync(file)) {
    out.chapters.push({ ...c, sets: [], count: 0 });
    continue;
  }
  const sets = JSON.parse(fs.readFileSync(file, 'utf8'));
  let count = 0;
  const seen = new Set();
  for (const s of sets) {
    if (!s.id) throw new Error(`${c.id}: a set has no id`);
    if (!s.ask) throw new Error(`${c.id}/${s.id}: a set has no instruction ("ask")`);
    if (!s.items || !s.items.length) throw new Error(`${c.id}/${s.id}: empty set`);
    for (const it of s.items) {
      if (!it.id) throw new Error(`${c.id}/${s.id}: an item has no id`);
      if (seen.has(it.id)) throw new Error(`${c.id}/${s.id}: duplicate item id ${it.id}`);
      seen.add(it.id);
      count++;
    }
  }
  out.chapters.push({ ...c, sets, count });
  out.total += count;
}

fs.writeFileSync(path.join(ROOT, 'src', 'data', 'catalog.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`catalog: ${out.chapters.length} chapters, ${out.total} drill items`);
for (const c of out.chapters) {
  console.log(`  ${c.n} ${c.id.padEnd(18)} ${String(c.sets.length).padStart(2)} sets  ${String(c.count).padStart(4)} items`);
}
