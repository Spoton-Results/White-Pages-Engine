// Brand Profiles - AI Picture Library Phase 1B Step 1
// Isolated image-generation helper. No R2 upload, DB insert, route, or UI logic here.

export interface GeneratedImage {
  bytes: Buffer;
  mimeType: string;
  provider: "openai";
}

const OPENAI_IMAGE_MODEL = "gpt-image-1";

export async function generateImage(prompt: string): Promise<GeneratedImage> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  const trimmedPrompt = prompt.trim();

  if (!trimmedPrompt) {
    throw new Error("Image prompt is required");
  }

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_IMAGE_MODEL,
      prompt: trimmedPrompt,
      size: "1024x1024",
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data?.error?.message || `OpenAI image generation failed with HTTP ${res.status}`);
  }

  const b64 = data?.data?.[0]?.b64_json;

  if (!b64) {
    throw new Error("OpenAI image response did not include b64_json");
  }

  return {
    bytes: Buffer.from(b64, "base64"),
    mimeType: "image/png",
    provider: "openai",
  };
}
