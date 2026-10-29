import { readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected a #RRGGBB color');

const Brief = z.object({
  campaign: z.object({
    id: z.string().regex(/^[a-z0-9-]+$/, 'use lowercase letters, numbers and dashes (it becomes a folder name)'),
    market: z.string().min(1),
    audience: z.string().min(1),
    locales: z.array(z.string().min(2)).min(1),
    // Keyed by locale, so every locale's copy is reviewed by a human before it ships.
    message: z.record(z.string(), z.string().min(1)),
  }),
  brand: z.object({
    name: z.string().min(1),
    logo: z.string().min(1),
    colors: z.array(hexColor).min(1),
    prohibitedWords: z.array(z.string().min(1)).default([]),
  }),
  products: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]+$/, 'use lowercase letters, numbers and dashes (it becomes a folder name)'),
    name: z.string().min(1),
    description: z.string().min(1),
    // Short noun for the visual checks ("tube of sunscreen"). Falls back to the product name.
    subject: z.string().min(1).optional(),
    heroPrompt: z.string().optional(),
  })).min(2, 'the brief needs at least two products'),
}).superRefine((b, ctx) => {
  for (const locale of b.campaign.locales) {
    if (!b.campaign.message[locale]) {
      ctx.addIssue({ code: 'custom', path: ['campaign', 'message', locale], message: `no message for locale ${locale}` });
    }
  }
  const ids = b.products.map(p => p.id);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: 'custom', path: ['products'], message: 'product ids must be unique' });
  }
});

// Parses YAML or JSON (JSON is valid YAML), validates it, and resolves file paths against the brief's folder.
export async function loadBrief(file) {
  const raw = YAML.parse(await readFile(file, 'utf8'));
  const result = Brief.safeParse(raw);
  if (!result.success) throw new Error(`Invalid brief ${file}:\n${z.prettifyError(result.error)}`);
  const dir = path.dirname(path.resolve(file));
  return { ...result.data, dir, logoPath: path.resolve(dir, result.data.brand.logo) };
}

export { Brief };
