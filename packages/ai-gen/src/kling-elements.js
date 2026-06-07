import { readFile } from 'node:fs/promises';
import { MODELS } from './models.js';
import { submitAndPoll } from './kling.js';

// Kling v3 reference-subject ("element") creation. An element gives the video model a
// consistent character/object across generations. Create once, then reuse the returned
// element_id via generateVideo({ elementIds }) and reference it in the prompt with
// <<<element_1>>>, <<<element_2>>>, … (positional).
//
// Official async endpoint: POST /v1/general/advanced-custom-elements (create → poll →
// element_id). Contract confirmed against the Kling dev docs (Element ▸ Create Element,
// 2026-06-07):
//   element_name        string  required  ≤ 20 chars
//   element_description string  required  ≤ 100 chars
//   reference_type      string  required  "image_refer" | "video_refer"
//   element_image_list  object  (image_refer) { frontal_image, refer_images:[{image_url}] }
//     — one frontal_image + 0–3 additional refer_images from other angles/close-ups.
//   element_video_list  object  (video_refer) { refer_videos:[{video_url}] }
//   element_voice_id    string  optional
// Images here are passed as base64 (same as image2video `image`); if the API requires a
// hosted URL instead, supply imageUrls.
const CREATE_PATH = '/v1/general/advanced-custom-elements';
const MAX_REFER_IMAGES = 3; // additional (non-frontal) reference images

export async function createElement({
  name,
  description,
  imagePaths = [],
  imageUrls = [],
  type = 'image', // "image" → image_refer · "video" → video_refer
  model = 'kling-pro',
}) {
  const sources = [...imageUrls];
  for (const p of imagePaths) {
    const data = await readFile(p);
    sources.push(data.toString('base64'));
  }
  if (!sources.length) throw new Error('createElement: provide at least one imagePath or imageUrl');
  if (sources.length > MAX_REFER_IMAGES + 1) {
    throw new Error(`createElement: at most ${MAX_REFER_IMAGES + 1} images per element (1 frontal + ${MAX_REFER_IMAGES} refer); got ${sources.length}`);
  }
  if (type !== 'video' && sources.length < 2) {
    throw new Error('createElement: an image element needs a frontal image + 1-3 reference images (≥2 images total)');
  }

  const m = MODELS[model];
  const payload = {
    model_name: m?.id ?? 'kling-v3',
    element_name: (name || 'element').slice(0, 20),       // ≤ 20 chars
    element_description: (description || name || 'reference subject').slice(0, 100), // ≤ 100
    reference_type: type === 'video' ? 'video_refer' : 'image_refer',
  };
  if (payload.reference_type === 'image_refer') {
    payload.element_image_list = { frontal_image: sources[0] };
    if (sources.length > 1) {
      payload.element_image_list.refer_images = sources.slice(1).map((image_url) => ({ image_url }));
    }
  } else {
    payload.element_video_list = { refer_videos: sources.map((video_url) => ({ video_url })) };
  }

  const { taskId, data } = await submitAndPoll(CREATE_PATH, payload, { label: 'kling-element' });
  const elementId =
    data?.task_result?.elements?.[0]?.element_id ?? data?.task_result?.element_id;
  if (!elementId) throw new Error('Kling: no element_id in advanced-custom-elements result');
  return { elementId, taskId, raw: data };
}
