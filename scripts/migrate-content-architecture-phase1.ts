import { pool } from "../server/db";

const DEFAULT_SECTIONS = [
  ["hero", "Hero", 1, true],
  ["intro", "Introduction", 2, true],
  ["why_choose_us", "Why Choose Us", 3, false],
  ["service_details", "Service Details", 4, true],
  ["process", "Process", 5, false],
  ["service_area", "Service Area", 6, false],
  ["faq", "FAQ", 7, true],
  ["cta", "CTA", 8, true],
  ["comparison", "Comparison", 9, false],
  ["pricing", "Pricing", 10, false],
  ["integrations", "Integrations", 11, false],
  ["local_stats", "Local Stats", 12, false],
  ["use_cases", "Use Cases", 13, false],
  ["industry_risks", "Industry Risks", 14, false],
  ["compliance", "Compliance", 15, false],
  ["buyer_questions", "Buyer Questions", 16, false],
  ["objections", "Objections", 17, false],
];

async function tableExists(tableName: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = $1
     LIMIT 1`,
    [tableName],
  );

  return result.rowCount > 0;
}

async function createTableIfMissing(name: string, sql: string) {
  const exists = await tableExists(name);

  if (exists) {
    console.log(`[content-arch] ${name} already exists`);
    return;
  }

  console.log(`[content-arch] creating ${name}`);
  await pool.query(sql);
}

async function seedSections() {
  for (const [key, label, order, requiredDefault] of DEFAULT_SECTIONS) {
    await pool.query(
      `INSERT INTO section_registry (
        id,
        key,
        label,
        default_order,
        required_default,
        section_type,
        supports_localization,
        supports_schema,
        metadata,
        is_active,
        created_at,
        updated_at
      )
      VALUES (
        gen_random_uuid(),
        $1,
        $2,
        $3,
        $4,
        'content',
        true,
        true,
        '{}'::jsonb,
        true,
        NOW(),
        NOW()
      )
      ON CONFLICT (key) DO NOTHING`,
      [key, label, order, requiredDefault],
    );
  }

  console.log(`[content-arch] seeded ${DEFAULT_SECTIONS.length} canonical sections`);
}

async function main() {
  console.log("[content-arch] Starting Phase 1 migration...");

  await createTableIfMissing(
    "section_registry",
    `CREATE TABLE section_registry (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      key VARCHAR(100) NOT NULL UNIQUE,
      label TEXT NOT NULL,
      description TEXT,
      default_order INTEGER NOT NULL DEFAULT 0,
      section_type VARCHAR(50) NOT NULL DEFAULT 'content',
      required_default BOOLEAN NOT NULL DEFAULT false,
      supports_localization BOOLEAN NOT NULL DEFAULT false,
      supports_schema BOOLEAN NOT NULL DEFAULT false,
      min_words INTEGER,
      max_words INTEGER,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  );

  await createTableIfMissing(
    "blueprint_sections",
    `CREATE TABLE blueprint_sections (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      blueprint_id VARCHAR NOT NULL REFERENCES blueprints(id) ON DELETE CASCADE,
      section_id VARCHAR NOT NULL REFERENCES section_registry(id) ON DELETE RESTRICT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      required BOOLEAN NOT NULL DEFAULT true,
      min_variations INTEGER NOT NULL DEFAULT 1,
      prompt_template TEXT,
      render_template TEXT,
      schema_type VARCHAR(100),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  );

  await createTableIfMissing(
    "variation_generations",
    `CREATE TABLE variation_generations (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id VARCHAR NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      website_id VARCHAR REFERENCES websites(id) ON DELETE CASCADE,
      service_id VARCHAR REFERENCES services(id) ON DELETE SET NULL,
      location_id VARCHAR REFERENCES locations(id) ON DELETE SET NULL,
      blueprint_id VARCHAR REFERENCES blueprints(id) ON DELETE SET NULL,
      section_id VARCHAR REFERENCES section_registry(id) ON DELETE SET NULL,
      generation_job_id VARCHAR REFERENCES generation_jobs(id) ON DELETE SET NULL,
      batch_id VARCHAR(120),
      provider VARCHAR(80) NOT NULL DEFAULT 'anthropic',
      model VARCHAR(120) NOT NULL,
      prompt TEXT NOT NULL,
      system_prompt TEXT,
      prompt_hash VARCHAR(128),
      temperature NUMERIC(4,2),
      max_tokens INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      total_tokens INTEGER,
      latency_ms INTEGER,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      error_message TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  );

  await createTableIfMissing(
    "variation_versions",
    `CREATE TABLE variation_versions (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      generation_id VARCHAR REFERENCES variation_generations(id) ON DELETE SET NULL,
      account_id VARCHAR NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      website_id VARCHAR REFERENCES websites(id) ON DELETE CASCADE,
      service_id VARCHAR REFERENCES services(id) ON DELETE SET NULL,
      location_id VARCHAR REFERENCES locations(id) ON DELETE SET NULL,
      section_id VARCHAR NOT NULL REFERENCES section_registry(id) ON DELETE RESTRICT,
      content TEXT NOT NULL,
      content_hash VARCHAR(128),
      active BOOLEAN NOT NULL DEFAULT true,
      version_number INTEGER NOT NULL DEFAULT 1,
      seo_score INTEGER,
      freshness_score INTEGER,
      uniqueness_score INTEGER,
      word_count INTEGER,
      last_used_at TIMESTAMP,
      usage_count INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  );

  await createTableIfMissing(
    "published_page_sections",
    `CREATE TABLE published_page_sections (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      page_id VARCHAR NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      section_id VARCHAR NOT NULL REFERENCES section_registry(id) ON DELETE RESTRICT,
      variation_version_id VARCHAR REFERENCES variation_versions(id) ON DELETE SET NULL,
      content_snapshot TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      render_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  );

  await seedSections();

  console.log("[content-arch] Phase 1 migration complete.");
}

main()
  .catch((err) => {
    console.error("[content-arch] Fatal:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
