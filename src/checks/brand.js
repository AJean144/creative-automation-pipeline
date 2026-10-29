import sharp from 'sharp';
import { rgbToLab, ciede2000, contrastRatio, relativeLuminance } from '../color.js';

// Thresholds live here, in one place, so a brand team can tune them and the report shows which one was applied.
export const LIMITS = {
  minContrast: 4.5,     // WCAG 2.2 AA for normal text
  minLogoDeltaE: 10,    // mean CIEDE2000 shift the logo must cause in its box to count as visible
  paletteDeltaE: 15,    // a pixel within this of a brand color counts as on-palette
  minPaletteShare: 0.02,
};

const hexToRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

async function pixels(image, box, maxEdge = 96) {
  const img = box ? sharp(image).extract(box) : sharp(image);
  const { data, info } = await img
    .resize(maxEdge, maxEdge, { fit: 'inside' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = [];
  for (let i = 0; i < data.length; i += info.channels) out.push([data[i], data[i + 1], data[i + 2]]);
  return out;
}

// Worst case, not average: white text is judged against the brightest 10% of the background behind it.
export async function textContrast(image, textBox, textColor) {
  const lum = (await pixels(image, textBox)).map(p => ({ p, l: relativeLuminance(p) })).sort((a, b) => a.l - b.l);
  const bright = lum[Math.floor(lum.length * 0.9)].p;
  const ratio = contrastRatio(hexToRgb(textColor), bright);
  return { pass: ratio >= LIMITS.minContrast, value: +ratio.toFixed(2), limit: LIMITS.minContrast };
}

// A logo that is placed but blends into the background is not "present". Compare before vs after,
// only where the logo is opaque, so its transparent padding does not dilute the score.
export async function logoVisible(before, after, logo, logoBox) {
  const [a, b, alpha] = await Promise.all([
    pixels(before, logoBox, 64),
    pixels(after, logoBox, 64),
    sharp(logo).resize(64, 64, { fit: 'inside' }).ensureAlpha().extractChannel(3).raw().toBuffer(),
  ]);
  const shifts = a.flatMap((p, i) => (alpha[i] > 128 ? [ciede2000(rgbToLab(p), rgbToLab(b[i]))] : []));
  const mean = shifts.reduce((s, d) => s + d, 0) / (shifts.length || 1);
  return { pass: mean >= LIMITS.minLogoDeltaE, value: +mean.toFixed(1), limit: LIMITS.minLogoDeltaE };
}

// Share of the frame that sits within paletteDeltaE of any brand color.
export async function paletteShare(image, colors) {
  const brand = colors.map(c => rgbToLab(hexToRgb(c)));
  const px = await pixels(image);
  const hits = px.filter(p => {
    const lab = rgbToLab(p);
    return brand.some(c => ciede2000(lab, c) <= LIMITS.paletteDeltaE);
  }).length;
  const share = hits / px.length;
  return { pass: share >= LIMITS.minPaletteShare, value: +share.toFixed(3), limit: LIMITS.minPaletteShare };
}
