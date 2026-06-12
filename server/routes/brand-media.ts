import { Router, type Request, type Response } from "express";
import { requireAuth } from "../auth";
import * as storage from "../storage";
import { generateImage } from "../services/image-provider";
import { saveBrandMediaImage } from "../services/r2";

const router = Router();

function slugPart(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function buildSafeBrandMediaPrompt(brand: any): string {
  const brandName = String(brand?.name || "local business").trim();
  const tagline = String(brand?.tagline || "").trim();
  const description = String(brand?.description || "").trim();
  const primaryColor = String(brand?.primaryColor || "").trim();
  const secondaryColor = String(brand?.secondaryColor || "").trim();

  return [
    `Create a professional branded business image for ${brandName}.`,
    tagline ? `Brand tagline context: ${tagline}.` : "",
    description ? `Business context: ${description}.` : "",
    primaryColor || secondaryColor ? `Use brand-inspired visual accents from these colors: ${[primaryColor, secondaryColor].filter(Boolean).join(", ")}.` : "",
    "Use a generic modern business work environment.",
    "Do not include real people, fake staff portraits, fake customer testimonials, fake storefronts, fake awards, fake logos, readable text, or recognizable local landmarks.",
    "The image should be suitable as a website hero or brand media background.",
    "Style: clean, trustworthy, professional, realistic lighting."
  ].filter(Boolean).join(" ");
}

router.post("/api/brand-profiles/:id/media/generate", requireAuth, async (req: Request, res: Response) => {
  try {
    const brandProfileId = req.params.id;
    const brand = await storage.getBrandProfile(brandProfileId);

    if (!brand) {
      return res.status(404).json({ message: "Brand profile not found" });
    }

    const category = "business_general";
    const prompt = buildSafeBrandMediaPrompt(brand);
    const generated = await generateImage(prompt);

    const timestamp = Date.now();
    const filename = `${slugPart(brand.name || "brand")}-${category}-${timestamp}.png`;

    const uploaded = await saveBrandMediaImage(
      brandProfileId,
      filename,
      generated.bytes,
      generated.mimeType,
    );

    const media = await storage.createBrandMedia({
      brandProfileId,
      websiteId: null,
      r2Key: uploaded.key,
      publicUrl: uploaded.publicUrl,
      prompt,
      category,
      altText: `Professional branded business image for ${brand.name}`,
      active: true,
      sortOrder: 0,
    } as any);

    return res.json({
      created: 1,
      failed: 0,
      media: [media],
    });
  } catch (error: any) {
    console.error("[brand-media/generate]", error);
    return res.status(500).json({
      message: error?.message || "Failed to generate brand media",
    });
  }
});

export default router;
