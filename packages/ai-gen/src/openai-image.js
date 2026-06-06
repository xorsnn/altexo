import { requireEnv } from './env.js';

// OpenAI image generation (gpt-image-1, the DALL·E successor). Dependency-free —
// raw fetch against the Images API. Mirrors the nano-banana.js shape so the same
// saveImages() / out-dir plumbing works. Returns base64 PNG buffers.

const ENDPOINT = 'https://api.openai.com/v1/images/generations';

// gpt-image-1 only accepts a fixed set of sizes — map our reel aspect to the
// closest. There is no true 9:16 from gpt-image-1; 1024x1536 (2:3 portrait) is
// the nearest vertical (noted in the manifest so the A/B is honest).
function sizeForAspect(aspect) {
  switch (aspect) {
    case '16:9': return '1536x1024';
    case '1:1': return '1024x1024';
    case '9:16':
    case '4:5':
    case '2:3':
    default: return '1024x1536';
  }
}

export async function generateImage({
  prompt,
  aspect = '9:16',
  model = 'gpt-image-1',
  quality = 'high',
  numberOfImages = 1,
}) {
  const apiKey = requireEnv('OPENAI_API_KEY');
  const size = sizeForAspect(aspect);

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, prompt, size, quality, n: numberOfImages }),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(`OpenAI image API ${res.status}: ${json?.error?.message || text}`);
  }

  const images = (json.data ?? [])
    .filter(d => d.b64_json)
    .map(d => ({ mimeType: 'image/png', data: Buffer.from(d.b64_json, 'base64') }));
  if (!images.length) throw new Error('OpenAI image API returned no image data');
  return { images, size, raw: json };
}
