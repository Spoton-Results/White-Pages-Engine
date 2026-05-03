ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "content_hash" text;
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "rendered_at" timestamp with time zone;
