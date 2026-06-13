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

function buildSafeBrandMediaPrompt(brand: any, category = "business_general", index = 1): string {
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
    `Image variation number ${index} for the ${category} category.`,
    "The image should be suitable as a website hero or brand media background.",
    "Style: clean, trustworthy, professional, realistic lighting."
  ].filter(Boolean).join(" ");
}


router.get("/api/brand-profiles/:id/media", requireAuth, async (req: Request, res: Response) => {
  try {
    const brandProfileId = req.params.id;
    const brand = await storage.getBrandProfile(brandProfileId);

    if (!brand) {
      return res.status(404).json({ message: "Brand profile not found" });
    }

    const media = await storage.getBrandMedia(brandProfileId);
    return res.json(media);
  } catch (error: any) {
    console.error("[brand-media/list]", error);
    return res.status(500).json({
      message: error?.message || "Failed to load brand media",
    });
  }
});

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


// ✅ CHANGED: generate a complete categorized brand media set in one request.
// 🔒 UNTOUCHED: storage schema, R2 upload helper, single-image route, and page injection.
router.post("/api/brand-profiles/:id/media/generate-set", requireAuth, async (req: Request, res: Response) => {
  try {
    const brandProfileId = req.params.id;
    const brand = await storage.getBrandProfile(brandProfileId);

    if (!brand) {
      return res.status(404).json({ message: "Brand profile not found" });
    }

    const preset = String(req.body?.preset || "standard").toLowerCase();
    const presets: Record<string, Record<string, number>> = {
      small: { hero: 3, service: 3, team: 3, location: 3, business_general: 2 },
      standard: { hero: 5, service: 5, team: 5, location: 5, business_general: 3 },
      large: { hero: 8, service: 8, team: 8, location: 8, business_general: 4 },
    };

    const counts = presets[preset] || presets.standard;
    const createdMedia: any[] = [];
    const failures: any[] = [];

    for (const [category, count] of Object.entries(counts)) {
      for (let i = 1; i <= count; i++) {
        try {
          const prompt = buildSafeBrandMediaPrompt(brand, category, i);
          const generated = await generateImage(prompt);
          const timestamp = Date.now();
          const filename = `${slugPart(brand.name || "brand")}-${category}-${timestamp}-${i}.png`;

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
            altText: `${brand.name} ${category.replace(/_/g, " ")} image ${i}`,
            active: true,
            sortOrder: i,
          } as any);

          createdMedia.push(media);
        } catch (error: any) {
          console.error("[brand-media/generate-set/item]", { category, index: i, error });
          failures.push({ category, index: i, message: error?.message || "Generation failed" });
        }
      }
    }

    return res.json({
      preset,
      created: createdMedia.length,
      failed: failures.length,
      media: createdMedia,
      failures,
    });
  } catch (error: any) {
    console.error("[brand-media/generate-set]", error);
    return res.status(500).json({
      message: error?.message || "Failed to generate brand media set",
    });
  }
});


// ✅ CHANGED: update existing brand media library metadata.
// 🔒 UNTOUCHED: image generation, R2 upload, and page injection.
router.patch("/api/brand-media/:mediaId", requireAuth, async (req: Request, res: Response) => {
  try {
    const allowed: Record<string, any> = {};
    if ("active" in req.body) allowed.active = Boolean(req.body.active);
    if ("category" in req.body) allowed.category = String(req.body.category || "business_general").trim() || "business_general";
    if ("sortOrder" in req.body) allowed.sortOrder = Number(req.body.sortOrder) || 0;
    if ("altText" in req.body) allowed.altText = String(req.body.altText || "").trim();

    const media = await storage.updateBrandMedia(req.params.mediaId, allowed as any);

    if (!media) {
      return res.status(404).json({ message: "Brand media not found" });
    }

    return res.json(media);
  } catch (error: any) {
    console.error("[brand-media/update]", error);
    return res.status(500).json({
      message: error?.message || "Failed to update brand media",
    });
  }
});

// ✅ CHANGED: delete existing brand media database row.
// 🔒 UNTOUCHED: R2 object deletion; this only removes the library record.
router.delete("/api/brand-media/:mediaId", requireAuth, async (req: Request, res: Response) => {
  try {
    await storage.deleteBrandMedia(req.params.mediaId);
    return res.json({ ok: true });
  } catch (error: any) {
    console.error("[brand-media/delete]", error);
    return res.status(500).json({
      message: error?.message || "Failed to delete brand media",
    });
  }
});


export default router;
