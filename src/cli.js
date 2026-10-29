#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { loadBrief } from './brief.js';
import { getProvider } from './providers/index.js';
import { LocalStorage } from './storage.js';
import { runPipeline } from './pipeline.js';

const USAGE = `Usage: creative-pipeline --brief <file.yaml|json> [--out ./out] [--provider mock|higgsfield]

  --brief     Campaign brief (YAML or JSON). Required.
  --out       Output folder. Default: ./out
  --provider  Image model for missing heroes. Default: mock (no key, no cost).`;

const { values } = parseArgs({
  options: {
    brief: { type: 'string' },
    out: { type: 'string', default: 'out' },
    provider: { type: 'string', default: 'mock' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help || !values.brief) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 1);
}

try {
  const brief = await loadBrief(values.brief);
  const provider = { name: values.provider, ...getProvider(values.provider) };
  const report = await runPipeline(brief, { provider, storage: new LocalStorage(values.out) });
  // Non-zero exit lets CI or a scheduler notice blocked copy or a failed product.
  process.exit(report.summary.blocked || report.summary.failedProducts ? 2 : 0);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
