# Plan — Creative Automation Pipeline (PoC)

Status: built. The README covers how to run it, the design and the limits. This file records what was planned, what changed while building, and why.

## Decisions
- **Stack:** Node CLI, `sharp` for crop and composite, `zod` for the brief. Colour math (CIEDE2000, WCAG contrast) ported from `~/projects/brand_gate/color.js`.
- **Image model:** Higgsfield Soul 2 (`higgsfield-ai/soul/v2/standard`) through the official SDK, `@higgsfield/client`. Credentials: `HF_CREDENTIALS=key-id:key-secret` in `.env.local`, loaded with `node --env-file`.
- **Visual QA:** TypeSafe (`@typesafe-ai/sdk`, model `jev-1.14.0`, pinned). Key: `TYPESAFE_API_KEY`. Optional: without it the check is `skipped`, never passed.
- **Provider interface:** `generate(prompt, { aspectRatio }) → Buffer`. Two providers: `higgsfield` and `mock`. Mock is the default, so the repo runs with no key.
- **Localization:** messages are written per locale in the brief, not machine-translated. Deterministic and reviewable.

## Pipeline
```
brief.yaml ─► validate ─► per product (in parallel):
                           ├─ hero: reuse assets/<product>/* if present, else generate each ratio natively
                           ├─ visual QA: present / whole / garbled label; regenerate once if missing or cut off
                           ├─ per locale: prohibited-word check (fail closed)
                           ├─ per ratio: crop, gradient, message + product name, logo
                           └─ checks: contrast, logo visibility, palette share, visual
                         ─► out/<campaign>/<product>/<ratio>/<locale>.png + report.json
```

## What changed from the first plan, and why
| First plan | Now | Why |
|---|---|---|
| Call the Higgsfield REST API by hand (submit, poll, idempotency key) | Official SDK | It already does submit, poll and retry. Less code to own. |
| `HF_API_KEY_ID` + `HF_API_KEY_SECRET` | One `HF_CREDENTIALS` value | The SDK's format. |
| One hero per product, cropped three ways | Generated heroes: one per ratio. Reused photos: one, cropped around the product box | Cropping a square to 9:16 and 16:9 cut the product out. |
| A model "only judges taste" | A model judges three yes/no facts: product present, whole, label real | Pixel math can't see a cut-off product or fake label text, and those were the real failures. |
| — | Label read on a crop of the product, with the brand name passed in, thin crops widened | Each found by probing (`scripts/probe-visual.js`): small text was missed, "Solara" read as a fake word, thin crops were rejected. |

## Out of scope (README → next steps)
Web UI, approval workflow, LLM claims check, text-over-product check, labelled threshold set, cloud storage and queue, performance analytics, video.

## Answered
- **Higgsfield billing:** a separate prepaid API account at console.higgsfield.ai. Soul 2 1080p costs about $0.006 per image, so a run is under 2 cents. Seedance 2.5 720p video costs about $0.46 per second.
- **Localization:** strings in the brief (see Decisions).
