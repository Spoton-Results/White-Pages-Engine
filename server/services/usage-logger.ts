import { pool } from "../db";

export interface ApiUsageRecord {
  accountId?: string | null;
  websiteId?: string | null;
  generationType: string;
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
}

export async function logApiUsage(rec: ApiUsageRecord): Promise<void> {
  const totalTokens = rec.inputTokens + rec.outputTokens;
  const estimatedCostCents = Math.round((rec.inputTokens * 3 + rec.outputTokens * 15) / 10_000);

  await pool.query(
    `INSERT INTO api_usage_log
       (account_id, website_id, generation_type, model_used, input_tokens, output_tokens, total_tokens, estimated_cost_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      rec.accountId ?? null,
      rec.websiteId ?? null,
      rec.generationType,
      rec.modelUsed,
      rec.inputTokens,
      rec.outputTokens,
      totalTokens,
      estimatedCostCents,
    ],
  );
}
