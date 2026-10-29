import sharp from 'sharp';
import { TypeSafeClient, box, image, noul } from '@typesafe-ai/sdk';

// All TypeSafe question wording and thresholds live here, so they can be audited and tuned in one place.
// Probe results that shaped them: scripts/probe-visual.js and the README's "Visual QA" section.
export const MODEL = 'jev-1.14.0'; // pinned: thresholds were tuned against this version
export const YES = 0.7;
export const NO = 0.3;

const sceneQuestions = subject => ({
  present: noul(`Is there a ${subject} in \`photo\`?`),
  whole: noul(`Is the whole ${subject} inside \`photo\`?`, {
    true: `Every edge of the ${subject}, including its cap and base, is visible in the frame.`,
    false: `Part of the ${subject} runs off an edge of the photo, such as its cap or base being cut off.`,
  }),
  where: box(`the ${subject} in \`photo\``),
});

// Asked on a close crop of the product: on the full photo the label is too small to read reliably.
// brand_names is in the state because the model cannot know an invented brand name is a real word.
const labelQuestions = {
  garbled: noul('Does the printed text in `label` contain misspelled or made-up words?', {
    true: 'At least one printed word is misspelled or not a real word, or there are letter-like shapes that do not form words.',
    false: 'Every printed word is a correctly spelled real word or one of the names in `brand_names`, or there is no printed text.',
  }),
};

let client;
// shortcut: images are a "dreamer-ready" TypeSafe feature behind an opt-in header; revisit when they reach GA.
const getClient = () => (client ??= new TypeSafeClient({ defaultHeaders: { 'TypeSafe-Danger-Zone-Images': 'true' } }));

export const enabled = () => Boolean(process.env.TYPESAFE_API_KEY);

// Downscale before upload: the judgments are glance-level, and input tokens are what is billed.
const jpeg = buf => sharp(buf).resize(1024, 1024, { fit: 'inside' }).jpeg({ quality: 88 }).toBuffer();

export async function inspect(imageBuffer, subject, brandNames) {
  const scene = await getClient().systemOne({ model: MODEL, state: { photo: image(await jpeg(imageBuffer)) }, questions: sceneQuestions(subject) });
  const a = scene.answers;
  const result = { model: scene.model, present: a.present.noul, whole: a.whole.noul, box: a.where.box, garbled: null };
  if (result.present < NO) return result; // no product, so no label to read and the box is meaningless

  const { width, height } = await sharp(imageBuffer).metadata();
  const crop = await sharp(imageBuffer).extract(labelCrop(width, height, result.box)).toBuffer();
  const label = await getClient().systemOne({ model: MODEL, state: { label: image(await jpeg(crop)), brand_names: brandNames }, questions: labelQuestions });
  return { ...result, garbled: label.answers.garbled.noul };
}

// The decision lives in code. Each judgment maps to fail (act), review (a person looks), or ok.
export function verdict(r) {
  const issues = [];
  const band = (p, failWhenHigh) => (failWhenHigh ? p >= YES : p <= NO) ? 'fail' : (p > NO && p < YES ? 'review' : 'ok');
  const add = (name, level) => level !== 'ok' && issues.push({ check: name, level });
  add('product_missing', band(r.present, false));
  if (r.present >= NO) {
    add('product_cut_off', band(r.whole, false));
    add('garbled_label', band(r.garbled, true));
  }
  return {
    pass: issues.length === 0,
    // A new image can fix a missing or cut-off product. Fake label text is flagged for a person instead.
    retry: issues.some(i => i.level === 'fail' && i.check !== 'garbled_label'),
    issues,
  };
}

// The product box, widened with surrounding pixels to at most 2:1, so that after jpeg() scales the long side
// to 1024 the short side stays >= 512. TypeSafe rejects images whose short side is under ~280 px (400 "Invalid image dimensions").
export function labelCrop(width, height, b) {
  const w = (b.right - b.left) * width, h = (b.bottom - b.top) * height;
  const cw = Math.min(width, Math.max(w, h / 2, 1)), ch = Math.min(height, Math.max(h, w / 2, 1));
  const left = Math.min(Math.max(((b.left + b.right) / 2) * width - cw / 2, 0), width - cw);
  const top = Math.min(Math.max(((b.top + b.bottom) / 2) * height - ch / 2, 0), height - ch);
  return { left: Math.round(left), top: Math.round(top), width: Math.round(cw), height: Math.round(ch) };
}

// Largest crop of the target aspect ratio, centred on the product box and kept inside the image.
export function cropAround(width, height, b, aspect) {
  let cw = width, ch = Math.round(width / aspect);
  if (ch > height) { ch = height; cw = Math.round(height * aspect); }
  const cx = ((b.left + b.right) / 2) * width;
  const cy = ((b.top + b.bottom) / 2) * height;
  const left = Math.round(Math.min(Math.max(cx - cw / 2, 0), width - cw));
  const top = Math.round(Math.min(Math.max(cy - ch / 2, 0), height - ch));
  return { left, top, width: cw, height: ch };
}
