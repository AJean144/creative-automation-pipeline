// Seedance 2.5 text-to-video smoke test via the official Higgsfield SDK.
// Run: npm run seedance   (loads HF_CREDENTIALS from .env.local; this is a billable request)
import { config, higgsfield } from '@higgsfield/client/v2';

if (!process.env.HF_CREDENTIALS) {
  console.error('HF_CREDENTIALS is not set. Add HF_CREDENTIALS=key-id:key-secret to .env.local.');
  process.exit(1);
}

// Video takes longer than the SDK's 5-minute default poll limit.
// shortcut: SDK 0.2.6 does not treat "canceled" as terminal, so a canceled request surfaces as a timeout.
config({ credentials: process.env.HF_CREDENTIALS, maxPollTime: 15 * 60_000 });

try {
  const result = await higgsfield.subscribe('bytedance/seedance-2.5/text-to-video', {
    input: {
      prompt: 'A cinematic scene at sunset',
      duration: 5,
      resolution: '720p',
      aspect_ratio: '16:9',
    },
    withPolling: true,
  });

  if (result.status !== 'completed' || !result.video?.url) {
    const reason = result.status === 'nsfw' ? 'blocked by moderation' : result.status;
    console.error(`Generation did not succeed (request ${result.request_id}): ${reason}`);
    process.exit(2);
  }
  console.log(`Request ${result.request_id} completed.`);
  console.log(result.video.url);
} catch (err) {
  // SDK errors carry status and detail but never the credentials.
  console.error(`Generation failed: ${err.name}: ${err.message}`);
  process.exit(1);
}
