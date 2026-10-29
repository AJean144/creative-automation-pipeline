// Probe the TypeSafe visual questions on known cases before wiring them into the pipeline.
// Run: node --env-file=.env.local scripts/probe-visual.js [campaign-folder]
import { readFile, access } from 'node:fs/promises';
import sharp from 'sharp';
import { inspect, verdict } from '../src/checks/visual.js';
import * as mock from '../src/providers/mock.js';

// Needs AI heroes from one live run first: npm run start:live
const OUT = `${process.argv[2] ?? 'out/summer-sun-mx'}/solara-aloe-gel`;
try { await access(`${OUT}/hero-9x16.png`); } catch {
  console.error(`No AI heroes in ${OUT}. Run "npm run start:live" first, or pass a campaign folder, e.g. out/summer-sun-jp`);
  process.exit(1);
}
const gel = 'bottle of aloe gel';
const tube = 'tube of sunscreen';
const hero916 = await readFile(`${OUT}/hero-9x16.png`);
const meta = await sharp(hero916).metadata();

const cleanLabel = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <rect width="1024" height="1024" fill="#dfe8dc"/><rect x="392" y="180" width="240" height="90" rx="12" fill="#222"/>
  <rect x="372" y="260" width="280" height="560" rx="40" fill="#7cc36b"/><rect x="402" y="420" width="220" height="200" fill="#fff"/>
  <text x="512" y="500" text-anchor="middle" font-family="Helvetica" font-size="44" font-weight="700" fill="#1E2A44">SOLARA</text>
  <text x="512" y="570" text-anchor="middle" font-family="Helvetica" font-size="30" fill="#1E2A44">ALOE GEL</text></svg>`)).png().toBuffer();

const cases = [
  ['AI hero 1:1 (garbled label)', await readFile(`${OUT}/hero-1x1.png`), gel],
  ['AI hero 16:9 (garbled label)', await readFile(`${OUT}/hero-16x9.png`), gel],
  ['AI hero 9:16 (garbled label)', hero916, gel],
  ['AI hero 9:16, bottom 35% only (product cut off)', await sharp(hero916).extract({ left: 0, top: Math.round(meta.height * 0.5), width: meta.width, height: Math.round(meta.height * 0.35) }).png().toBuffer(), gel],
  ['Reused sunscreen asset (no text)', await readFile('examples/assets/solara-spf50/hero.jpg'), tube],
  ['Drawn bottle, clean label', cleanLabel, gel],
  ['Mock gradient (no product)', await mock.generate('x', { width: 1024, height: 1024 }), gel],
];

const f = n => (n == null ? '  - ' : n.toFixed(2));
for (const [name, buf, subject] of cases) {
  try {
    const r = await inspect(buf, subject, ['SOLARA']);
    const b = r.box;
    console.log(`${name}\n  present ${f(r.present)}  whole ${f(r.whole)}  garbled ${f(r.garbled)}  box l${f(b.left)} t${f(b.top)} r${f(b.right)} b${f(b.bottom)}`
      + `\n  -> ${JSON.stringify(verdict(r).issues)}`);
  } catch (err) {
    console.log(`${name}\n  ERROR ${err.name}: ${err.message}`);
  }
}
