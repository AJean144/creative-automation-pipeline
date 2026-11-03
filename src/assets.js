import { readdir } from 'node:fs/promises';
import path from 'node:path';

const IMAGE = /\.(png|jpe?g|webp)$/i;

// Returns the first image in <briefDir>/assets/<productId>/, or null when the product has no existing asset.
export async function findHero(briefDir, productId) {
  const dir = path.join(briefDir, 'assets', productId);
  let files;
  try {
    files = await readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  // Dotfiles include macOS ._hero.jpg metadata, which matches IMAGE and sorts ahead of the real photo.
  const first = files.filter(f => !f.startsWith('.') && IMAGE.test(f)).sort()[0];
  return first ? path.join(dir, first) : null;
}
