/* Colour math, ported from brand_gate/color.js (pure functions only; the
   canvas pixel intake was browser-only and is replaced by sharp in brand.js). */

/* ------------------------------------------------------- sRGB to linear

   Inverse sRGB companding.
   http://www.brucelindbloom.com/Eqn_RGB_to_XYZ.html

   The threshold is 0.04045 on the encoded value. WCAG 2.2 uses the same
   function with the same threshold, which is why one implementation serves
   both the colour chain and the contrast ratio. */
export function srgbToLinear(v) {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/* ----------------------------------------------------------- sRGB to XYZ

   sRGB primaries at D65.
   http://www.brucelindbloom.com/Eqn_RGB_XYZ_Matrix.html

   Rows are X, Y, Z. Columns are R, G, B, so column one is the XYZ of full red,
   which is the property that catches a transposed matrix. */
export const SRGB_TO_XYZ = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.0721750],
  [0.0193339, 0.1191920, 0.9503041],
];

/* The D65 white point is the row sums of the matrix above rather than a value
   from a fourth source. That is not a shortcut, it is the reason white lands on
   L* = 100 exactly: Lab normalises XYZ by the white point, and the white point
   that matters is the one this matrix actually produces for (1,1,1). Taking a
   rounded D65 from elsewhere would leave white a hair off 100 and every
   lightness in the project fractionally wrong. */
export const D65 = SRGB_TO_XYZ.map(row => row[0] + row[1] + row[2]);

// rgb is 0..255, which is what ImageData gives.
export function rgbToXyz(rgb) {
  const r = srgbToLinear(rgb[0] / 255);
  const g = srgbToLinear(rgb[1] / 255);
  const b = srgbToLinear(rgb[2] / 255);
  return SRGB_TO_XYZ.map(m => m[0] * r + m[1] * g + m[2] * b);
}

/* ------------------------------------------------------------ XYZ to Lab

   http://www.brucelindbloom.com/Eqn_XYZ_to_Lab.html

   EPS and KAPPA are the exact rationals, not the rounded 0.008856 and 903.3
   that most implementations copy. Only the rationals make the two branches of
   f() meet at the knee. With the rounded pair there is a small discontinuity
   right where dark colours live, and tests.js asserts the knee lands on L* = 8
   exactly for that reason. */
const EPS = 216 / 24389;
const KAPPA = 24389 / 27;

const f = t => t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116;

export function xyzToLab(xyz) {
  const fx = f(xyz[0] / D65[0]);
  const fy = f(xyz[1] / D65[1]);
  const fz = f(xyz[2] / D65[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export const rgbToLab = rgb => xyzToLab(rgbToXyz(rgb));

/* ------------------------------------------------------------- CIEDE2000

   G. Sharma, W. Wu, E. N. Dalal, "The CIEDE2000 Color-Difference Formula:
   Implementation Notes, Supplementary Test Data, and Mathematical
   Observations", Color Research and Application, 30(1), 21-30, 2005.
   https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/

   Why this rather than plain Euclidean distance in Lab: Lab is only roughly
   perceptually uniform, and it is worst in exactly the region a brand palette
   cares about. Two blues 10 units apart look far closer than two yellows 10
   units apart. CIEDE2000 corrects for that with weighting functions on
   lightness, chroma, and hue, plus a rotation term that handles the blue region
   specifically. A palette tolerance measured in Euclidean Lab would be a
   different tolerance for every hue, which makes the number meaningless.

   The two places an implementation goes wrong, both handled below:

   1. Hue angles are circular. The mean of 350 degrees and 10 degrees is 0, not
      180. Every hue quantity here is computed with an explicit wrap.
   2. When either chroma is zero the hue is undefined, not zero. Feeding a
      neutral grey through the ordinary path produces a hue difference out of
      nothing. Guarded by the C1C2 checks.

   kL, kC and kH are the parametric factors. All 1 here, which is the reference
   condition the test data assumes. */

const RAD = Math.PI / 180;
const POW25_7 = Math.pow(25, 7);

export function ciede2000(lab1, lab2) {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;

  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;

  // G expands a* in low-chroma regions so that near-neutral colours, where the
  // eye is most sensitive to a small cast, are not compressed into nothing.
  const Cbar7 = Math.pow(Cbar, 7);
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + POW25_7)));

  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);

  // atan2 returns (-180, 180]. Hue is conventionally [0, 360). atan2(0, 0) is 0
  // in JavaScript, which matches the convention that an achromatic colour has
  // hue 0, and the C1p * C2p guards below stop that 0 being treated as a real
  // angle.
  const hue = (b, ap) => { const h = Math.atan2(b, ap) / RAD; return h < 0 ? h + 360 : h; };
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let dhp;
  if (C1p * C2p === 0) {
    dhp = 0;                                   // one colour is neutral: no hue difference exists
  } else if (Math.abs(h2p - h1p) <= 180) {
    dhp = h2p - h1p;
  } else if (h2p - h1p > 180) {
    dhp = h2p - h1p - 360;                     // the short way round, westward
  } else {
    dhp = h2p - h1p + 360;                     // the short way round, eastward
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * RAD);

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;

  let hbarp;
  if (C1p * C2p === 0) {
    hbarp = h1p + h2p;                         // one term is 0, so this is the other angle
  } else if (Math.abs(h1p - h2p) <= 180) {
    hbarp = (h1p + h2p) / 2;
  } else if (h1p + h2p < 360) {
    hbarp = (h1p + h2p + 360) / 2;
  } else {
    hbarp = (h1p + h2p - 360) / 2;
  }

  // T weights the hue term by where on the wheel the pair sits. The eye
  // tolerates more hue drift in some regions than others, and the four cosine
  // terms are the empirical fit to that.
  const T = 1
    - 0.17 * Math.cos((hbarp - 30) * RAD)
    + 0.24 * Math.cos((2 * hbarp) * RAD)
    + 0.32 * Math.cos((3 * hbarp + 6) * RAD)
    - 0.20 * Math.cos((4 * hbarp - 63) * RAD);

  const SL = 1 + (0.015 * Math.pow(Lbarp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;

  /* The rotation term. This is the part SPEC forbids skipping, and the part an
     implementation can drop while still looking correct on most colours.

     It exists because chroma and hue errors are not independent in the blue
     region around 275 degrees. Without RT, two saturated blues that differ in
     both come out far closer than they look. dTheta is a Gaussian centred on
     that region, so RT is essentially zero everywhere else, which is exactly
     why dropping it passes casual testing and fails Sharma's set. */
  const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const Cbarp7 = Math.pow(Cbarp, 7);
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + POW25_7));
  const RT = -Math.sin((2 * dTheta) * RAD) * RC;

  const tL = dLp / SL, tC = dCp / SC, tH = dHp / SH;
  return Math.sqrt(tL * tL + tC * tC + tH * tH + RT * tC * tH);
}

/* ------------------------------------------------------------------ WCAG

   WCAG 2.2, W3C Recommendation. https://www.w3.org/TR/WCAG22/

   The coefficients are WCAG's own, which are the middle row of SRGB_TO_XYZ
   rounded to four places. Using the unrounded row would be more accurate and
   less useful: a contrast ratio is only worth reporting if it matches the
   number every other accessibility tool gives for the same pair. Being more
   precise than the standard is being wrong about the standard. */
export function relativeLuminance(rgb) {
  return 0.2126 * srgbToLinear(rgb[0] / 255)
       + 0.7152 * srgbToLinear(rgb[1] / 255)
       + 0.0722 * srgbToLinear(rgb[2] / 255);
}

/* (L1 + 0.05) / (L2 + 0.05), lighter over darker. The 0.05 models ambient
   light reflecting off the screen, which is why pure black on pure white is
   21:1 and not infinite. Ordering is handled here so no caller has to. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

