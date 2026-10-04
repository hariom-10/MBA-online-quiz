import { GoogleGenAI } from "@google/genai";

export type AiProvider = "gemini" | "openrouter" | "custom";

export type ApiKeyConfig = {
  id: string;
  rank: number; // 1 = Primary, 2+ = Backup
  provider: AiProvider;
  providerName: string;
  model: string;
  secretKey: string;
  status: "active" | "quota_exceeded" | "disabled" | "invalid";
  lastUsed?: string;
  createdAt: string;
  lastError?: string;
};

export const PROVIDER_PRESETS: Record<AiProvider, { name: string; keyUrl: string; defaultModel: string; models: string[] }> = {
  gemini: {
    name: "Google Gemini",
    keyUrl: "https://aistudio.google.com/app/apikey",
    defaultModel: "gemini-3.6-flash",
    models: [
      "gemini-3.6-flash",
      "gemini-1.5-flash",
      "gemini-1.5-pro",
    ],
  },
  openrouter: {
    name: "OpenRouter",
    keyUrl: "https://openrouter.ai/keys",
    defaultModel: "google/gemini-3.6-flash",
    models: [
      "google/gemini-3.6-flash",
      "google/gemini-2.0-flash-exp:free",
      "openai/gpt-4o-mini",
      "anthropic/claude-3.5-haiku",
      "meta-llama/llama-3.3-70b-instruct",
      "deepseek/deepseek-chat",
    ],
  },
  custom: {
    name: "Custom / OpenAI Compatible",
    keyUrl: "https://openrouter.ai/keys",
    defaultModel: "custom-model",
    models: ["custom-model"],
  },
};

const API_KEYS_STORAGE_KEY = "mba-ranked-api-keys";
const ENCRYPTION_PREFIX = "enc:v1:";
const ENCRYPTION_SALT = "mba-prep-aes256-key-salt";

export function encryptSecret(plainText: string): string {
  if (!plainText || plainText.startsWith(ENCRYPTION_PREFIX)) return plainText;
  try {
    const chars = Array.from(plainText);
    const encrypted = chars.map((char, index) => {
      const code = char.charCodeAt(0);
      const saltCode = ENCRYPTION_SALT.charCodeAt(index % ENCRYPTION_SALT.length);
      return (code ^ saltCode).toString(16).padStart(4, "0");
    }).join("");
    return `${ENCRYPTION_PREFIX}${btoa(encrypted)}`;
  } catch {
    return plainText;
  }
}

export function decryptSecret(cipherText: string): string {
  if (!cipherText || !cipherText.startsWith(ENCRYPTION_PREFIX)) return cipherText;
  try {
    const raw = atob(cipherText.replace(ENCRYPTION_PREFIX, ""));
    const hexParts = raw.match(/.{1,4}/g) ?? [];
    return hexParts.map((hex, index) => {
      const code = parseInt(hex, 16);
      const saltCode = ENCRYPTION_SALT.charCodeAt(index % ENCRYPTION_SALT.length);
      return String.fromCharCode(code ^ saltCode);
    }).join("");
  } catch {
    return cipherText;
  }
}

export function getRankedApiKeys(): ApiKeyConfig[] {
  try {
    const raw = localStorage.getItem(API_KEYS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ApiKeyConfig[];
    if (!Array.isArray(parsed)) return [];
    
    return parsed.map((k) => ({
      ...k,
      secretKey: decryptSecret(k.secretKey),
    })).sort((a, b) => a.rank - b.rank);
  } catch {
    return [];
  }
}

export function saveRankedApiKeys(keys: ApiKeyConfig[]): void {
  const sorted = [...keys].sort((a, b) => a.rank - b.rank);
  const encryptedKeys = sorted.map((k) => ({
    ...k,
    secretKey: encryptSecret(k.secretKey),
  }));
  localStorage.setItem(API_KEYS_STORAGE_KEY, JSON.stringify(encryptedKeys));
}

export function addOrUpdateApiKey(config: Omit<ApiKeyConfig, "id" | "createdAt"> & { id?: string }): ApiKeyConfig[] {
  const existing = getRankedApiKeys();
  const id = config.id || `key-${crypto.randomUUID()}`;
  const createdAt = existing.find((k) => k.id === id)?.createdAt || new Date().toISOString();

  const newKey: ApiKeyConfig = {
    ...config,
    id,
    createdAt,
  };

  const filtered = existing.filter((k) => k.id !== id);
  const adjusted = filtered.map((k) => {
    if (k.rank >= newKey.rank) return { ...k, rank: k.rank + 1 };
    return k;
  });

  const updated = [...adjusted, newKey].sort((a, b) => a.rank - b.rank);
  const normalized = updated.map((k, idx) => ({ ...k, rank: idx + 1 }));
  saveRankedApiKeys(normalized);
  return normalized;
}

export function deleteApiKey(id: string): ApiKeyConfig[] {
  const existing = getRankedApiKeys();
  const filtered = existing.filter((k) => k.id !== id);
  const normalized = filtered.map((k, idx) => ({ ...k, rank: idx + 1 }));
  saveRankedApiKeys(normalized);
  return normalized;
}

export function setApiKeyStatus(id: string, status: ApiKeyConfig["status"], lastError?: string): ApiKeyConfig[] {
  const existing = getRankedApiKeys();
  const updated = existing.map((k) => {
    if (k.id === id) {
      return { ...k, status, lastError: lastError !== undefined ? lastError : k.lastError };
    }
    return k;
  });
  saveRankedApiKeys(updated);
  return updated;
}

export function moveApiKeyRank(id: string, direction: "up" | "down"): ApiKeyConfig[] {
  const keys = getRankedApiKeys();
  const index = keys.findIndex((k) => k.id === id);
  if (index === -1) return keys;
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= keys.length) return keys;

  const tempRank = keys[index].rank;
  keys[index].rank = keys[targetIndex].rank;
  keys[targetIndex].rank = tempRank;

  return saveAndNormalize(keys);
}

function saveAndNormalize(keys: ApiKeyConfig[]): ApiKeyConfig[] {
  const sorted = keys.sort((a, b) => a.rank - b.rank);
  const normalized = sorted.map((k, idx) => ({ ...k, rank: idx + 1 }));
  saveRankedApiKeys(normalized);
  return normalized;
}

// ---------------------------------------------------------------------------
// Test / Validate an API Key
// ---------------------------------------------------------------------------
export async function validateApiKey(provider: AiProvider, secretKey: string, modelName: string): Promise<{ success: boolean; message: string }> {
  if (!secretKey.trim()) {
    return { success: false, message: "API key cannot be empty." };
  }

  const targetModel = modelName || "gemini-3.6-flash";

  try {
    if (provider === "gemini") {
      const ai = new GoogleGenAI({ apiKey: secretKey.trim() });
      const response = await ai.models.generateContent({
        model: targetModel,
        contents: "Respond with: OK",
      });
      if (response.text) return { success: true, message: `Gemini API Key verified with model ${targetModel}!` };
      throw new Error("Empty response received from Gemini.");
    } else {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${secretKey.trim()}`,
          "Content-Type": "application/json",
          "HTTP-Referer": window.location.origin,
          "X-Title": "MBA Quiz App",
        },
        body: JSON.stringify({
          model: targetModel,
          messages: [{ role: "user", content: "Respond with: OK" }],
          max_tokens: 10,
        }),
      });

      if (response.ok) {
        return { success: true, message: `${provider === "openrouter" ? "OpenRouter" : "Custom"} API Key verified with model ${targetModel}!` };
      }
      const data = await response.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(data.error?.message || `HTTP ${response.status} response from API provider.`);
    }
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Validation failed. Please check key & model.",
    };
  }
}

// ---------------------------------------------------------------------------
// Low-level call to Gemini or OpenRouter with prompt & json schema
// ---------------------------------------------------------------------------
export async function callAiApi(
  keyConfig: { provider: AiProvider; secretKey: string; model: string },
  systemInstruction: string,
  userPrompt: string,
  responseSchema?: object,
): Promise<string> {
  const { provider, secretKey, model } = keyConfig;
  const targetModel = model || "gemini-3.6-flash";

  if (provider === "gemini") {
    const ai = new GoogleGenAI({ apiKey: secretKey });
    const response = await ai.models.generateContent({
      model: targetModel,
      contents: userPrompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseJsonSchema: responseSchema,
        maxOutputTokens: 8192,
      },
    });
    if (!response.text) throw new Error("Empty response received from Gemini API.");
    return response.text;
  } else {
    const messages = [
      { role: "system", content: `${systemInstruction}\n\nIMPORTANT: Output strictly valid JSON matching the requested structure without any markdown formatting or commentary.` },
      { role: "user", content: userPrompt },
    ];

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${secretKey.trim()}`,
        "Content-Type": "application/json",
        "HTTP-Referer": window.location.origin,
        "X-Title": "MBA Exam Prep",
      },
      body: JSON.stringify({
        model: targetModel,
        messages,
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 8192,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({})) as { error?: { message?: string; code?: number } };
      const status = response.status;
      const msg = errData.error?.message || `API request failed with HTTP ${status}`;
      const err = new Error(msg);
      (err as unknown as Record<string, unknown>).status = status;
      throw err;
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty completion returned from OpenRouter API.");
    return content;
  }
}

// ---------------------------------------------------------------------------
// Unified Runner with Automatic Failover through Ranked Key Pool
// ---------------------------------------------------------------------------
export async function runAiWithFailover<T>(
  systemInstruction: string,
  userPrompt: string,
  responseSchema: object,
  parseResult: (rawJson: string) => T,
): Promise<T> {
  const rankedKeys = getRankedApiKeys().filter((k) => k.status !== "disabled");

  const candidates: Array<{ id?: string; provider: AiProvider; secretKey: string; model: string; rankLabel: string }> = [];

  for (const k of rankedKeys) {
    candidates.push({
      id: k.id,
      provider: k.provider,
      secretKey: k.secretKey,
      model: k.model,
      rankLabel: `Rank #${k.rank} (${k.providerName} - ${k.model})`,
    });
  }

  const envKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
  if (envKey && !candidates.some((c) => c.secretKey === envKey)) {
    const envModel = (import.meta.env.VITE_GEMINI_MODEL as string | undefined) || "gemini-3.6-flash";
    candidates.push({
      provider: "gemini",
      secretKey: envKey,
      model: envModel,
      rankLabel: `Environment Key (Google Gemini - ${envModel})`,
    });
  }

  if (candidates.length === 0) {
    throw new Error(
      "No API Keys configured. Please connect an API key in Admin Workspace -> API Keys or AI PDF Import."
    );
  }

  let lastError: Error | null = null;

  for (const candidate of candidates) {
    try {
      console.info(`[AI Runner] Attempting AI generation with ${candidate.rankLabel}...`);
      const rawJson = await callAiApi(
        { provider: candidate.provider, secretKey: candidate.secretKey, model: candidate.model },
        systemInstruction,
        userPrompt,
        responseSchema,
      );

      const parsed = parseResult(rawJson);

      if (candidate.id) {
        setApiKeyStatus(candidate.id, "active");
      }
      return parsed;
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      const rawStatus = error && typeof error === "object" ? (error as { status?: number }).status : undefined;
      console.warn(`[AI Runner] ${candidate.rankLabel} failed:`, errMessage);

      lastError = error instanceof Error ? error : new Error(errMessage);

      const isQuotaOrAuthOrNotFound =
        rawStatus === 429 ||
        rawStatus === 401 ||
        rawStatus === 403 ||
        rawStatus === 404 ||
        /quota|rate limit|exhausted|429|unauthorized|invalid key|not_found|no longer available/i.test(errMessage);

      if (candidate.id && isQuotaOrAuthOrNotFound) {
        setApiKeyStatus(candidate.id, "quota_exceeded", errMessage);
      }
    }
  }

  throw lastError || new Error("All configured API Keys failed or encountered model errors.");
}
