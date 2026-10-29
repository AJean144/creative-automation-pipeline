import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { findHero } from './assets.js';
import { RATIOS, renderBase, addLogo } from './render.js';
import { findProhibited } from './checks/legal.js';
import { textContrast, logoVisible, paletteShare } from './checks/brand.js';
import * as visual from './checks/visual.js';
import sharp from 'sharp';

const heroPrompt = (brief, product) => product.heroPrompt ?? [
  `Premium studio product photograph of ${product.name}: ${product.description}.`,
  `For ${brief.campaign.audience} in ${brief.campaign.market}.`,
  `Product centered, generous empty space in the lower third, soft natural light.`,
  `No text, no words, no logos.`,
].join(' ');

const SKIPPED = { skipped: true, reason: 'TYPESAFE_API_KEY not set' };

// Visual QA result for one image, shaped like the other checks. A failed API call is reported as an error, never as a pass.
async function checkVisual(buffer, brief, product) {
  if (!visual.enabled()) return { result: null, check: SKIPPED };
  try {
    const result = await visual.inspect(buffer, product.subject ?? product.name, [brief.brand.name]);
    const v = visual.verdict(result);
    const r2 = n => (n == null ? null : +n.toFixed(2));
    return { result, check: { ...v, present: r2(result.present), whole: r2(result.whole), garbled: r2(result.garbled), box: result.box, model: result.model } };
  } catch (err) {
    return { result: null, check: { pass: false, error: `${err.name}: ${err.message}` } };
  }
}

// Returns one hero per ratio, each with its visual QA check.
// Reused: one file, cropped per ratio around the product box when visual QA found it (else sharp's attention crop).
// Generated: requested natively in each ratio, since cropping one square cut the product out of 16:9 and 9:16,
// and regenerated once when visual QA says the product is missing or cut off.
async function getHeroes(brief, product, provider, storage, log) {
  const ratios = Object.keys(RATIOS);
  const existing = await findHero(brief.dir, product.id);
  if (existing) {
    log(`  ${product.id}: reusing ${path.relative(process.cwd(), existing)}`);
    const buffer = await readFile(existing);
    const { result, check } = await checkVisual(buffer, brief, product);
    const { width, height } = await sharp(buffer).metadata();
    const crop = async r => {
      if (!result || result.present < visual.YES) return buffer;
      const [w, h] = RATIOS[r];
      return sharp(buffer).extract(visual.cropAround(width, height, result.box, w / h)).toBuffer();
    };
    const byRatio = Object.fromEntries(await Promise.all(ratios.map(async r => [r, await crop(r)])));
    return { byRatio, visual: Object.fromEntries(ratios.map(r => [r, check])), source: 'reused', paths: [existing] };
  }

  const prompt = heroPrompt(brief, product);
  log(`  ${product.id}: no asset found, generating ${ratios.length} heroes with ${provider.name}`);
  const one = async r => {
    let buffer = await provider.generate(prompt, { aspectRatio: r.replace('x', ':') });
    let { check } = await checkVisual(buffer, brief, product);
    if (check.retry) {
      log(`  ${product.id}/${r}: ${check.issues.map(i => i.check).join(', ')}, regenerating once`);
      buffer = await provider.generate(prompt, { aspectRatio: r.replace('x', ':') });
      ({ check } = await checkVisual(buffer, brief, product));
      check = { ...check, regenerated: true };
    }
    // Saved next to the outputs so a reviewer can see exactly what the model returned before any edits.
    const saved = await storage.save(path.join(brief.campaign.id, product.id, `hero-${r}.png`), buffer);
    return [r, buffer, check, saved];
  };
  const results = await Promise.all(ratios.map(one));
  return {
    byRatio: Object.fromEntries(results.map(([r, b]) => [r, b])),
    visual: Object.fromEntries(results.map(([r, , c]) => [r, c])),
    source: 'generated',
    paths: results.map(([, , , p]) => p),
    prompt,
  };
}

async function renderProduct(brief, product, provider, storage, log) {
  const started = Date.now();
  const hero = await getHeroes(brief, product, provider, storage, log);
  const creatives = [];

  for (const locale of brief.campaign.locales) {
    const message = brief.campaign.message[locale];
    const flagged = findProhibited(`${product.name} ${message}`, brief.brand.prohibitedWords);
    if (flagged.length) {
      // Fail closed: copy with a prohibited word never becomes a finished asset.
      log(`  ${product.id}/${locale}: BLOCKED, prohibited words: ${flagged.join(', ')}`);
      creatives.push({ locale, status: 'blocked', legal: { pass: false, flagged } });
      continue;
    }

    for (const ratio of Object.keys(RATIOS)) {
      const base = await renderBase(hero.byRatio[ratio], ratio, { message, productName: product.name, accent: brief.brand.colors[0] });
      const { image, logo, logoBox } = await addLogo(base.image, ratio, brief.logoPath);
      const checks = {
        legal: { pass: true, flagged: [] },
        contrast: await textContrast(base.background, base.textBox, base.textColor),
        logo: await logoVisible(base.image, image, logo, logoBox),
        palette: await paletteShare(image, brief.brand.colors),
        visual: hero.visual[ratio],
      };
      const file = path.join(brief.campaign.id, product.id, ratio, `${locale}.png`);
      await storage.save(file, image);
      const failed = Object.keys(checks).filter(k => !checks[k].skipped && !checks[k].pass);
      const status = failed.length ? 'warn' : 'pass';
      log(`  ${product.id}/${ratio}/${locale}: ${status}${failed.length ? ` (${failed.join(', ')})` : ''}`);
      creatives.push({ locale, ratio, status, file, checks });
    }
  }

  return { product: product.id, heroSource: hero.source, heroPaths: hero.paths, heroPrompt: hero.prompt, ms: Date.now() - started, creatives };
}

export async function runPipeline(brief, { provider, storage, log = console.log }) {
  const started = Date.now();
  log(`Campaign ${brief.campaign.id} · ${brief.campaign.market} · ${brief.products.length} products · ${brief.campaign.locales.join(', ')}`);

  // Products are independent, so they run in parallel; a failure in one does not lose the others' work.
  const settled = await Promise.allSettled(brief.products.map(p => renderProduct(brief, p, provider, storage, log)));
  const products = settled.map((r, i) => r.status === 'fulfilled'
    ? r.value
    : { product: brief.products[i].id, error: r.reason.message, creatives: [] });
  for (const p of products) if (p.error) log(`  ${p.product}: FAILED, ${p.error}`);

  const all = products.flatMap(p => p.creatives);
  const count = s => all.filter(c => c.status === s).length;
  const report = {
    campaign: brief.campaign.id,
    market: brief.campaign.market,
    provider: provider.name,
    generatedAt: new Date().toISOString(),
    ms: Date.now() - started,
    summary: { creatives: all.length, pass: count('pass'), warn: count('warn'), blocked: count('blocked'), failedProducts: products.filter(p => p.error).length },
    products,
  };
  const reportPath = await storage.save(path.join(brief.campaign.id, 'report.json'), JSON.stringify(report, null, 2));
  log(`Done in ${(report.ms / 1000).toFixed(1)}s: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.blocked} blocked. Report: ${path.relative(process.cwd(), reportPath)}`);
  return report;
}
