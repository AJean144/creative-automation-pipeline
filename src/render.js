import sharp from 'sharp';

// Output folder name -> pixel size. Folder names use "x" because ":" is illegal in Windows paths.
export const RATIOS = {
  '1x1': [1080, 1080],
  '9x16': [1080, 1920],
  '16x9': [1920, 1080],
};

const FONT = "'Helvetica Neue', Helvetica, 'Hiragino Sans', 'Noto Sans', Arial, sans-serif";
const TEXT_COLOR = '#FFFFFF';

const xml = s => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

// CJK and other full-width glyphs are about twice as wide as Latin ones and have no spaces to break on.
const isWide = ch => /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-｠]/u.test(ch);
const NO_LINE_START = /^[、。，．！？」』）】ー]$/u;
const glyphWidth = ch => (isWide(ch) ? 1.0 : /\p{Lu}/u.test(ch) ? 0.72 : 0.55);
const textWidth = (s, size) => [...s].reduce((w, ch) => w + glyphWidth(ch) * size, 0);

// shortcut: width is estimated per glyph, not measured from the font; swap in real font metrics (e.g. opentype.js) if lines overflow.
export function wrapText(text, size, maxWidth) {
  // A word too long for a line (always the case for spaceless CJK text) breaks between characters, with no space added.
  const tokens = text.split(/\s+/).flatMap(word => (textWidth(word, size) > maxWidth
    ? [...word].map((t, i) => ({ t, space: i === 0 }))
    : [{ t: word, space: true }]));
  const lines = [];
  let line = '';
  for (const { t, space } of tokens) {
    const next = line + (line && space ? ' ' : '') + t;
    // Japanese line-break rule: closing punctuation never starts a line, so it may overhang slightly.
    if (line && textWidth(next, size) > maxWidth && !NO_LINE_START.test(t)) {
      lines.push(line);
      line = t;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Long copy (translations run long) steps the type down until it fits, stopping at a floor that stays readable.
// Copy still too long at the floor runs high, and the layout check reports it; it is never cut, because legal approved those words.
function fitMessage(message, unit, maxWidth, maxHeight) {
  const floor = Math.round(unit * 0.04);
  let size = Math.round(unit * 0.065);
  let lines = wrapText(message, size, maxWidth);
  while (size > floor && lines.length * size * 1.15 > maxHeight) {
    size -= 1;
    lines = wrapText(message, size, maxWidth);
  }
  return { msgSize: size, lines };
}

// Crop the hero to the ratio, then draw a dark scrim, brand accent bar, product name and message.
// Returns the composed image, plus the background (no text) and text box the contrast check measures.
export async function renderBase(hero, ratio, { message, productName, accent }) {
  const [w, h] = RATIOS[ratio];
  const unit = Math.min(w, h);
  const pad = Math.round(unit * 0.06);
  const nameSize = Math.round(unit * 0.032);
  const maxWidth = w - pad * 2 - Math.round(unit * 0.03);

  const nameLines = wrapText(productName.toUpperCase(), nameSize, maxWidth);
  const nameHeight = nameSize * (0.3 + 1.3 * nameLines.length);
  // Room between the bottom padding and the tallest logo addLogo can place.
  const { msgSize, lines } = fitMessage(message, unit, maxWidth, h - pad * 2 - Math.round(unit * 0.22) - nameHeight);
  const lineHeight = msgSize * 1.15;
  const textHeight = nameHeight + lines.length * lineHeight;
  const textTop = h - pad - textHeight;
  const barX = pad;
  const textX = pad + Math.round(unit * 0.03);

  const scrimTop = textTop - pad * 2;
  // The scrim is already dark by the time it reaches the first line of text (offset matches textTop).
  const scrim = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0"/>
      <stop offset="${((textTop - scrimTop) / (h - scrimTop)).toFixed(3)}" stop-color="#000" stop-opacity="0.6"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.8"/>
    </linearGradient></defs>
    <rect y="${scrimTop}" width="${w}" height="${h - scrimTop}" fill="url(#scrim)"/>
  </svg>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect x="${barX}" y="${textTop}" width="${Math.round(unit * 0.012)}" height="${textHeight}" fill="${accent}"/>
    ${nameLines.map((l, i) => `<text x="${textX}" y="${textTop + nameSize * (1 + 1.3 * i)}" font-family="${FONT}" font-size="${nameSize}" font-weight="600"
      fill="${TEXT_COLOR}" fill-opacity="0.85" letter-spacing="2">${xml(l)}</text>`).join('\n')}
    ${lines.map((l, i) => `<text x="${textX}" y="${textTop + nameHeight + (i + 0.85) * lineHeight}"
      font-family="${FONT}" font-size="${msgSize}" font-weight="700" fill="${TEXT_COLOR}">${xml(l)}</text>`).join('\n')}
  </svg>`;

  const background = await sharp(hero)
    .resize(w, h, { fit: 'cover', position: sharp.strategy.attention })
    .composite([{ input: Buffer.from(scrim) }])
    .png()
    .toBuffer();
  const image = await sharp(background).composite([{ input: Buffer.from(svg) }]).png().toBuffer();

  // Copy too long for the ad runs off the top; the box stays on the image so checks can run and report it.
  const top = Math.max(0, Math.round(textTop));
  const textBox = { left: textX, top, width: Math.min(maxWidth, w - textX), height: Math.min(Math.round(textHeight), h - top) };
  return { image, background, textBox, textColor: TEXT_COLOR };
}

// Logo goes top-left, sized to the short edge. Returns the image and where the logo landed.
export async function addLogo(image, ratio, logoPath) {
  const [w, h] = RATIOS[ratio];
  const unit = Math.min(w, h);
  const pad = Math.round(unit * 0.06);
  const side = Math.round(unit * 0.22);
  const logo = await sharp(logoPath).resize(side, side, { fit: 'inside' }).png().toBuffer();
  const { width, height } = await sharp(logo).metadata();
  const out = await sharp(image).composite([{ input: logo, left: pad, top: pad }]).png().toBuffer();
  return { image: out, logo, logoBox: { left: pad, top: pad, width, height } };
}
