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

type ProviderName = "anthropic" | "openai" | "perplexity";

function getProviderKey(name: ProviderName): string | undefined {
  switch (name) {
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY;
    case "openai":
      return process.env.OPENAI_API_KEY;
    case "perplexity":
      return process.env.PERPLEXITY_API_KEY;
  }
}

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

let _anthropic: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  if (!_anthropic) _anthropic = new Anthropic({ apiKey });
  return _anthropic;
}

async function callAnthropic(req: AIRequest): Promise<AIResponse> {
  const anthropic = getAnthropicClient();
  let lastErr: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const msg = await anthropic.messages.create({
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

let _activeProvider: ProviderName = "anthropic";

export function getActiveProvider() {
  return _activeProvider;
}

export async function callAI(req: AIRequest): Promise<AIResponse> {
  const providerFns: Record<ProviderName, () => Promise<AIResponse>> = {
    anthropic: () => callAnthropic(req),
    openai: () => callOpenAI(req),
    perplexity: () => callPerplexity(req),
  };

  const providers: ProviderName[] = ["anthropic", "openai", "perplexity"];
  const configuredProviders = providers.filter((name) => Boolean(getProviderKey(name)));

  if (configuredProviders.length === 0) {
    throw new Error("No AI providers configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or PERPLEXITY_API_KEY.");
  }

  let lastErr: any;

  for (const name of configuredProviders) {
    try {
      const result = await providerFns[name]();
      if (_activeProvider !== name) {
        console.log(`[ai-provider] Switched to ${name} (was ${_activeProvider})`);
        _activeProvider = name;
      }
      return result;
    } catch (err: any) {
      lastErr = err;
      if (isCreditError(err)) {
        console.warn(`[ai-provider] ${name} out of credits — trying next configured provider`);
        continue;
      }
      const msg = (err?.message || "").toLowerCase();
      if (msg.includes("not configured") || msg.includes("api_key")) {
        console.warn(`[ai-provider] ${name} unavailable — trying next configured provider`);
        continue;
      }
      throw err;
    }
  }

  throw lastErr ?? new Error("All configured AI providers exhausted");
}
