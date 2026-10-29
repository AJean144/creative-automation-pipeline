import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, cp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import YAML from 'yaml';
import { loadBrief } from '../src/brief.js';
import { findProhibited } from '../src/checks/legal.js';
import { textContrast, logoVisible } from '../src/checks/brand.js';
import { wrapText } from '../src/render.js';
import { runPipeline } from '../src/pipeline.js';
import { LocalStorage } from '../src/storage.js';
import * as mock from '../src/providers/mock.js';
import { ciede2000, contrastRatio } from '../src/color.js';

const solid = (w, h, hex) => sharp({ create: { width: w, height: h, channels: 3, background: hex } }).png().toBuffer();
const EXAMPLES = path.resolve('examples');

test('color math matches published reference values', () => {
  // Sharma et al. 2005, pair 1.
  assert.equal(ciede2000([50, 2.6772, -79.7751], [50, 0, -82.7485]).toFixed(4), '2.0425');
  assert.equal(contrastRatio([0, 0, 0], [255, 255, 255]).toFixed(1), '21.0');
});

test('legal check matches whole words, any case, accented text', () => {
  assert.deepEqual(findProhibited('A Miracle in a bottle', ['miracle']), ['miracle']);
  assert.deepEqual(findProhibited('Miraculous results', ['miracle']), []);
  assert.deepEqual(findProhibited('Es 100% safe para todos', ['100% safe']), ['100% safe']);
  assert.deepEqual(findProhibited('くすみが治る', ['治る']), ['治る']);
});

test('wrapText breaks CJK between characters without inserting spaces', () => {
  const lines = wrapText('長い一日も、軽やかにUVケア。', 70, 840);
  assert.ok(lines.length > 1);
  assert.equal(lines.join(''), '長い一日も、軽やかにUVケア。');
  assert.ok(lines.every(l => !/^[、。]/.test(l)), `punctuation started a line: ${JSON.stringify(lines)}`);
});

test('contrast check fails white text on a light background', async () => {
  const box = { left: 0, top: 0, width: 100, height: 100 };
  assert.equal((await textContrast(await solid(100, 100, '#F0F0F0'), box, '#FFFFFF')).pass, false);
  assert.equal((await textContrast(await solid(100, 100, '#202020'), box, '#FFFFFF')).pass, true);
});

test('logo check fails a white logo on a white background', async () => {
  const logo = await solid(50, 20, '#FFFFFF');
  const bg = await solid(200, 200, '#FFFFFF');
  const box = { left: 10, top: 10, width: 50, height: 20 };
  const after = await sharp(bg).composite([{ input: logo, left: 10, top: 10 }]).png().toBuffer();
  assert.equal((await logoVisible(bg, after, logo, box)).pass, false);
});

test('brief validation rejects a single product and a missing locale message', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'brief-'));
  const brief = YAML.parse(await readFile(path.join(EXAMPLES, 'brief.yaml'), 'utf8'));
  brief.products = brief.products.slice(0, 1);
  delete brief.campaign.message['es-MX'];
  const file = path.join(dir, 'bad.yaml');
  await writeFile(file, YAML.stringify(brief));
  await assert.rejects(loadBrief(file), /at least two products[\s\S]*no message for locale es-MX|no message for locale es-MX[\s\S]*at least two products/);
});

test('pipeline reuses assets, generates missing ones, blocks prohibited copy', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'run-'));
  await cp(EXAMPLES, dir, { recursive: true });
  const raw = YAML.parse(await readFile(path.join(dir, 'brief.yaml'), 'utf8'));
  raw.campaign.message['es-MX'] = 'Protección garantizada, un miracle.';
  await writeFile(path.join(dir, 'brief.yaml'), YAML.stringify(raw));

  const report = await runPipeline(await loadBrief(path.join(dir, 'brief.yaml')), {
    provider: { name: 'mock', ...mock },
    storage: new LocalStorage(path.join(dir, 'out')),
    log: () => {},
  });

  const bySource = Object.fromEntries(report.products.map(p => [p.product, p.heroSource]));
  assert.deepEqual(bySource, { 'solara-spf50': 'reused', 'solara-aloe-gel': 'generated' });
  assert.equal(report.summary.blocked, 2);          // es-MX blocked for both products
  assert.equal(report.summary.pass + report.summary.warn, 6); // 2 products x 3 ratios x en-US

  const sample = path.join(dir, 'out', 'summer-sun-mx', 'solara-spf50', '9x16', 'en-US.png');
  const { width, height } = await sharp(sample).metadata();
  assert.deepEqual([width, height], [1080, 1920]);
});

test('visual verdict: decisions follow the thresholds, garbled labels never trigger a retry', async () => {
  const { verdict } = await import('../src/checks/visual.js');
  const ok = { present: 0.95, whole: 0.95, garbled: 0.1 };
  assert.deepEqual(verdict(ok), { pass: true, retry: false, issues: [] });
  assert.equal(verdict({ ...ok, present: 0.1 }).retry, true);
  assert.deepEqual(verdict({ ...ok, present: 0.1, garbled: null }).issues, [{ check: 'product_missing', level: 'fail' }]);
  assert.equal(verdict({ ...ok, whole: 0.05 }).retry, true);
  const fake = verdict({ ...ok, garbled: 0.97 });
  assert.equal(fake.pass, false);
  assert.equal(fake.retry, false);
  assert.deepEqual(verdict({ ...ok, garbled: 0.5 }).issues, [{ check: 'garbled_label', level: 'review' }]);
});

test('cropAround keeps the target ratio, centres on the box, stays inside the image', async () => {
  const { cropAround } = await import('../src/checks/visual.js');
  const c = cropAround(2000, 1000, { left: 0.05, right: 0.15, top: 0.4, bottom: 0.6 }, 9 / 16);
  assert.equal(c.height, 1000);
  assert.equal(c.width, Math.round(1000 * 9 / 16));
  assert.equal(c.left, 0); // box near the left edge: clamped, not negative
  const mid = cropAround(2000, 2000, { left: 0.4, right: 0.6, top: 0.4, bottom: 0.6 }, 16 / 9);
  assert.equal(mid.left, 0);
  assert.equal(mid.top, Math.round(1000 - mid.height / 2));
});

test('labelCrop widens a thin product box to at most 2:1, inside the image', async () => {
  const { labelCrop } = await import('../src/checks/visual.js');
  const c = labelCrop(2048, 2048, { left: 0.49, right: 0.51, top: 0.1, bottom: 0.9 }); // 41 x 1638 px
  assert.ok(c.height / c.width <= 2.01, JSON.stringify(c));
  assert.ok(c.left >= 0 && c.left + c.width <= 2048);
  const edge = labelCrop(1000, 1000, { left: 0, right: 0.02, top: 0, bottom: 1 });
  assert.deepEqual([edge.left, edge.width], [0, 500]);
});
