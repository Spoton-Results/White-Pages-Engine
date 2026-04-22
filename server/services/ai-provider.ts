import Anthropic from "@anthropic-ai/sdk";

// ─── Provider chain: Anthropic → OpenAI → Perplexity ─────────────────────────
// Each provider is only tried if its API key is configured.
// Credit / quota exhaustion errors cause an immediate switch to the next provider.
// Transient errors (rate limit, server overload) are retried within the same provider.

export interface AIRequest {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AIResponse {
  text: string;
  provider: "anthropic" | "openai" | "perplexity";
  promptTokens: number;
  completionTokens: number;
}

const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const OPENAI_MODEL = "gpt-4o-mini";
const PERPLEXITY_MODEL = "llama-3.1-sonar-small-128k-chat";

const RETRY_DELAYS = [3000, 6000, 12000];

/** True if the error means this provider is out of credits / quota — not retryable */
function isCreditError(err: any): boolean {
  const msg = (err?.message || "").toLowerCase();
  const errType = (err?.error?.type || err?.type || "").toLowerCase();
  return (
    err?.status === 402 ||
    errType.includes("credit") ||
    errType.includes("balance") ||
    errType.includes("insufficient_quota") ||
    msg.includes("credit") ||
    msg.includes("insufficient_quota") ||
    msg.includes("out of credits") ||
    msg.includes("quota exceeded") ||
    (err?.status === 429 && (errType.includes("quota") || msg.includes("quota")))
  );
}

/** True if the error is transient and worth retrying */
function isRetryable(err: any): boolean {
  if (isCreditError(err)) return false;
  return (
    err?.status === 429 ||
    err?.status === 529 ||
    err?.status >= 500 ||
    (err?.message || "").includes("overloaded") ||
    (err?.message || "").includes("rate_limit")
  );
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Anthropic ────────────────────────────────────────────────────────────────

const _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function callAnthropic(req: AIRequest): Promise<AIResponse> {
  let lastErr: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const msg = await _anthropic.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: req.maxTokens ?? 4096,
        messages: [{ role: "user", content: req.prompt }],
      });
      const text = msg.content[0].type === "text" ? msg.content[0].text : "";
      return {
        text,
        provider: "anthropic",
        promptTokens: msg.usage.input_tokens,
        completionTokens: msg.usage.output_tokens,
      };
    } catch (err: any) {
      lastErr = err;
      if (isCreditError(err)) throw err;
      if (!isRetryable(err) || attempt === 2) throw err;
      await sleep(RETRY_DELAYS[attempt] + Math.random() * 1000);
    }
  }
  throw lastErr;
}

// ─── OpenAI (OpenAI-compatible REST) ─────────────────────────────────────────

async function callOpenAI(req: AIRequest): Promise<AIResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  let lastErr: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          max_tokens: req.maxTokens ?? 4096,
          temperature: req.temperature ?? 0.7,
          messages: [{ role: "user", content: req.prompt }],
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const err: any = new Error(body?.error?.message || `OpenAI HTTP ${res.status}`);
        err.status = res.status;
        err.error = body?.error;
        throw err;
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content ?? "";
      return {
        text,
        provider: "openai",
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
      };
    } catch (err: any) {
      lastErr = err;
      if (isCreditError(err)) throw err;
      if (!isRetryable(err) || attempt === 2) throw err;
      await sleep(RETRY_DELAYS[attempt] + Math.random() * 1000);
    }
  }
  throw lastErr;
}

// ─── Perplexity (OpenAI-compatible REST) ─────────────────────────────────────

async function callPerplexity(req: AIRequest): Promise<AIResponse> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("PERPLEXITY_API_KEY not configured");

  let lastErr: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: PERPLEXITY_MODEL,
          max_tokens: req.maxTokens ?? 4096,
          temperature: req.temperature ?? 0.7,
          messages: [{ role: "user", content: req.prompt }],
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const err: any = new Error(body?.error?.message || `Perplexity HTTP ${res.status}`);
        err.status = res.status;
        err.error = body?.error;
        throw err;
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content ?? "";
      return {
        text,
        provider: "perplexity",
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
      };
    } catch (err: any) {
      lastErr = err;
      if (isCreditError(err)) throw err;
      if (!isRetryable(err) || attempt === 2) throw err;
      await sleep(RETRY_DELAYS[attempt] + Math.random() * 1000);
    }
  }
  throw lastErr;
}

// ─── Public: unified call with automatic provider fallback ───────────────────

let _activeProvider: "anthropic" | "openai" | "perplexity" = "anthropic";

export function getActiveProvider() {
  return _activeProvider;
}

export async function callAI(req: AIRequest): Promise<AIResponse> {
  const providers: Array<{ name: "anthropic" | "openai" | "perplexity"; fn: () => Promise<AIResponse> }> = [
    { name: "anthropic", fn: () => callAnthropic(req) },
    { name: "openai",    fn: () => callOpenAI(req)    },
    { name: "perplexity",fn: () => callPerplexity(req)},
  ];

  let lastErr: any;

  for (const { name, fn } of providers) {
    try {
      const result = await fn();
      if (_activeProvider !== name) {
        console.log(`[ai-provider] Switched to ${name} (was ${_activeProvider})`);
        _activeProvider = name;
      }
      return result;
    } catch (err: any) {
      lastErr = err;
      if (isCreditError(err)) {
        console.warn(`[ai-provider] ${name} out of credits — trying next provider`);
        continue;
      }
      // For non-credit errors from Anthropic, try next only if key is the issue
      const msg = (err?.message || "").toLowerCase();
      if (msg.includes("not configured") || msg.includes("api_key")) {
        continue;
      }
      // Non-retryable non-credit error — throw immediately
      throw err;
    }
  }

  throw lastErr ?? new Error("All AI providers exhausted");
}
