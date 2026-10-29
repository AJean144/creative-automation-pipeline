import { config, higgsfield } from '@higgsfield/client/v2';

const MODEL = process.env.HF_IMAGE_MODEL ?? 'higgsfield-ai/soul/v2/standard';

let configured = false;
function ensureConfigured() {
  if (configured) return;
  if (!process.env.HF_CREDENTIALS) {
    throw new Error('HF_CREDENTIALS is not set. Add HF_CREDENTIALS=key-id:key-secret to .env.local, or run with --provider mock');
  }
  config({ credentials: process.env.HF_CREDENTIALS });
  configured = true;
}

// The official SDK submits, polls and retries server errors; we only check the outcome and download the file.
export async function generate(prompt, { aspectRatio = '1:1' } = {}) {
  ensureConfigured();
  let result;
  try {
    result = await higgsfield.subscribe(MODEL, {
      input: { prompt, aspect_ratio: aspectRatio, resolution: '1080p', enhance_prompt: false },
      withPolling: true,
    });
  } catch (err) {
    throw new Error(`Higgsfield ${err.name}: ${err.message}`);
  }
  if (result.status !== 'completed' || !result.images?.[0]?.url) {
    const reason = result.status === 'nsfw' ? 'blocked by moderation' : result.status;
    throw new Error(`Higgsfield request ${result.request_id} did not complete: ${reason}`);
  }

  const img = await fetch(result.images[0].url);
  if (!img.ok) throw new Error(`Could not download generated image: ${img.status}`);
  return Buffer.from(await img.arrayBuffer());
}
