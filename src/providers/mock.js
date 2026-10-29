import sharp from 'sharp';

// Deterministic placeholder hero: a gradient seeded from the prompt, so runs without an API key are repeatable.
export async function generate(prompt, { width = 2048, height = 2048 } = {}) {
  let h = 0;
  for (const ch of prompt) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  const hue = h % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue},70%,62%)"/>
      <stop offset="1" stop-color="hsl(${(hue + 60) % 360},60%,30%)"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="${width / 2}" cy="${height * 0.45}" r="${width * 0.18}" fill="white" fill-opacity="0.85"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
