import { DEFAULT_PROVIDER } from "../agents/defaults.js";
import { buildModelAliasIndex, modelKey } from "../agents/model-selection.js";
import type { OpenClawConfig } from "../config/config.js";
import type { ModelProviderConfig } from "../config/types.models.js";
import type { RuntimeEnv } from "../runtime.js";
import { fetchWithTimeout } from "../utils/fetch-timeout.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import { applyPrimaryModel } from "./model-picker.js";
import { normalizeAlias } from "./models/shared.js";

const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_CONTEXT_WINDOW = 4096;
const DEFAULT_MAX_TOKENS = 4096;
const VERIFY_TIMEOUT_MS = 10000;

type OnboardingLocale = "zh-CN" | "en-US";

function resolveOnboardingLocale(): OnboardingLocale {
  const raw = (
    process.env.OPENCLAW_LOCALE ??
    process.env.LC_ALL ??
    process.env.LC_MESSAGES ??
    process.env.LANG ??
    ""
  )
    .trim()
    .toLowerCase();
  if (raw.startsWith("en")) {
    return "en-US";
  }
  return "zh-CN";
}

const ONBOARDING_LOCALE = resolveOnboardingLocale();

function tr(text: { zh: string; en: string }): string {
  return ONBOARDING_LOCALE === "zh-CN" ? text.zh : text.en;
}

/**
 * Detects if a URL is from Azure AI Foundry or Azure OpenAI.
 * Matches both:
 * - https://*.services.ai.azure.com (Azure AI Foundry)
 * - https://*.openai.azure.com (classic Azure OpenAI)
 */
function isAzureUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    const host = url.hostname.toLowerCase();
    return host.endsWith(".services.ai.azure.com") || host.endsWith(".openai.azure.com");
  } catch {
    return false;
  }
}

/**
 * Transforms an Azure AI Foundry/OpenAI URL to include the deployment path.
 * Azure requires: https://host/openai/deployments/<model-id>/chat/completions?api-version=2024-xx-xx-preview
 * But we can't add query params here, so we just add the path prefix.
 * The api-version will be handled by the Azure OpenAI client or as a query param.
 *
 * Example:
 *   https://my-resource.services.ai.azure.com + gpt-5-nano
 *   => https://my-resource.services.ai.azure.com/openai/deployments/gpt-5-nano
 */
function transformAzureUrl(baseUrl: string, modelId: string): string {
  const normalizedUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  // Check if the URL already includes the deployment path
  if (normalizedUrl.includes("/openai/deployments/")) {
    return normalizedUrl;
  }
  return `${normalizedUrl}/openai/deployments/${modelId}`;
}

export type CustomApiCompatibility = "openai" | "anthropic";
type CustomApiCompatibilityChoice = CustomApiCompatibility | "unknown";
export type CustomApiResult = {
  config: OpenClawConfig;
  providerId?: string;
  modelId?: string;
  providerIdRenamedFrom?: string;
};

export type ApplyCustomApiConfigParams = {
  config: OpenClawConfig;
  baseUrl: string;
  modelId: string;
  compatibility: CustomApiCompatibility;
  apiKey?: string;
  providerId?: string;
  alias?: string;
};

export type ParseNonInteractiveCustomApiFlagsParams = {
  baseUrl?: string;
  modelId?: string;
  compatibility?: string;
  apiKey?: string;
  providerId?: string;
};

export type ParsedNonInteractiveCustomApiFlags = {
  baseUrl: string;
  modelId: string;
  compatibility: CustomApiCompatibility;
  apiKey?: string;
  providerId?: string;
};

export type CustomApiErrorCode =
  | "missing_required"
  | "invalid_compatibility"
  | "invalid_base_url"
  | "invalid_model_id"
  | "invalid_provider_id"
  | "invalid_alias";

export class CustomApiError extends Error {
  readonly code: CustomApiErrorCode;

  constructor(code: CustomApiErrorCode, message: string) {
    super(message);
    this.name = "CustomApiError";
    this.code = code;
  }
}

export type ResolveCustomProviderIdParams = {
  config: OpenClawConfig;
  baseUrl: string;
  providerId?: string;
};

export type ResolvedCustomProviderId = {
  providerId: string;
  providerIdRenamedFrom?: string;
};

function getCompatibilityOptions(): Array<{
  value: CustomApiCompatibilityChoice;
  label: string;
  hint: string;
}> {
  return [
    {
      value: "openai",
      label: tr({ zh: "兼容 OpenAI", en: "OpenAI-compatible" }),
      hint: tr({ zh: "使用 /chat/completions", en: "Uses /chat/completions" }),
    },
    {
      value: "anthropic",
      label: tr({ zh: "兼容 Anthropic", en: "Anthropic-compatible" }),
      hint: tr({ zh: "使用 /messages", en: "Uses /messages" }),
    },
    {
      value: "unknown",
      label: tr({ zh: "未知（自动检测）", en: "Unknown (detect automatically)" }),
      hint: tr({
        zh: "依次探测 OpenAI 与 Anthropic 端点",
        en: "Probes OpenAI then Anthropic endpoints",
      }),
    },
  ];
}

function normalizeEndpointId(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  return trimmed.replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}

function buildEndpointIdFromUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    const host = url.hostname.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const port = url.port ? `-${url.port}` : "";
    const candidate = `custom-${host}${port}`;
    return normalizeEndpointId(candidate) || "custom";
  } catch {
    return "custom";
  }
}

function resolveUniqueEndpointId(params: {
  requestedId: string;
  baseUrl: string;
  providers: Record<string, ModelProviderConfig | undefined>;
}) {
  const normalized = normalizeEndpointId(params.requestedId) || "custom";
  const existing = params.providers[normalized];
  if (!existing?.baseUrl || existing.baseUrl === params.baseUrl) {
    return { providerId: normalized, renamed: false };
  }
  let suffix = 2;
  let candidate = `${normalized}-${suffix}`;
  while (params.providers[candidate]) {
    suffix += 1;
    candidate = `${normalized}-${suffix}`;
  }
  return { providerId: candidate, renamed: true };
}

function resolveAliasError(params: {
  raw: string;
  cfg: OpenClawConfig;
  modelRef: string;
}): string | undefined {
  const trimmed = params.raw.trim();
  if (!trimmed) {
    return undefined;
  }
  let normalized: string;
  try {
    normalized = normalizeAlias(trimmed);
  } catch (err) {
    return err instanceof Error ? err.message : tr({ zh: "别名无效。", en: "Alias is invalid." });
  }
  const aliasIndex = buildModelAliasIndex({
    cfg: params.cfg,
    defaultProvider: DEFAULT_PROVIDER,
  });
  const aliasKey = normalized.toLowerCase();
  const existing = aliasIndex.byAlias.get(aliasKey);
  if (!existing) {
    return undefined;
  }
  const existingKey = modelKey(existing.ref.provider, existing.ref.model);
  if (existingKey === params.modelRef) {
    return undefined;
  }
  return tr({
    zh: `别名 ${normalized} 已指向 ${existingKey}。`,
    en: `Alias ${normalized} already points to ${existingKey}.`,
  });
}

function buildOpenAiHeaders(apiKey: string) {
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function buildAnthropicHeaders(apiKey: string) {
  const headers: Record<string, string> = {
    "anthropic-version": "2023-06-01",
  };
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }
  return headers;
}

function formatVerificationError(error: unknown): string {
  if (!error) {
    return tr({ zh: "未知错误", en: "unknown error" });
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return tr({ zh: "未知错误", en: "unknown error" });
  }
}

type VerificationResult = {
  ok: boolean;
  status?: number;
  error?: unknown;
};

function resolveVerificationEndpoint(params: {
  baseUrl: string;
  modelId: string;
  endpointPath: "chat/completions" | "messages";
}) {
  const resolvedUrl = isAzureUrl(params.baseUrl)
    ? transformAzureUrl(params.baseUrl, params.modelId)
    : params.baseUrl;
  const endpointUrl = new URL(
    params.endpointPath,
    resolvedUrl.endsWith("/") ? resolvedUrl : `${resolvedUrl}/`,
  );
  if (isAzureUrl(params.baseUrl)) {
    endpointUrl.searchParams.set("api-version", "2024-10-21");
  }
  return endpointUrl.href;
}

async function requestVerification(params: {
  endpoint: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}): Promise<VerificationResult> {
  try {
    const res = await fetchWithTimeout(
      params.endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...params.headers,
        },
        body: JSON.stringify(params.body),
      },
      VERIFY_TIMEOUT_MS,
    );
    return { ok: res.ok, status: res.status };
  } catch (error) {
    return { ok: false, error };
  }
}

async function requestOpenAiVerification(params: {
  baseUrl: string;
  apiKey: string;
  modelId: string;
}): Promise<VerificationResult> {
  const endpoint = resolveVerificationEndpoint({
    baseUrl: params.baseUrl,
    modelId: params.modelId,
    endpointPath: "chat/completions",
  });
  return await requestVerification({
    endpoint,
    headers: buildOpenAiHeaders(params.apiKey),
    body: {
      model: params.modelId,
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 5,
    },
  });
}

async function requestAnthropicVerification(params: {
  baseUrl: string;
  apiKey: string;
  modelId: string;
}): Promise<VerificationResult> {
  const endpoint = resolveVerificationEndpoint({
    baseUrl: params.baseUrl,
    modelId: params.modelId,
    endpointPath: "messages",
  });
  return await requestVerification({
    endpoint,
    headers: buildAnthropicHeaders(params.apiKey),
    body: {
      model: params.modelId,
      max_tokens: 16,
      messages: [{ role: "user", content: "Hi" }],
    },
  });
}

async function promptBaseUrlAndKey(params: {
  prompter: WizardPrompter;
  initialBaseUrl?: string;
}): Promise<{ baseUrl: string; apiKey: string }> {
  const baseUrlInput = await params.prompter.text({
    message: tr({ zh: "API Base URL", en: "API Base URL" }),
    initialValue: params.initialBaseUrl ?? DEFAULT_OLLAMA_BASE_URL,
    placeholder: "https://api.example.com/v1",
    validate: (val) => {
      try {
        new URL(val);
        return undefined;
      } catch {
        return tr({
          zh: "请输入有效 URL（例如 http://...）",
          en: "Please enter a valid URL (e.g. http://...)",
        });
      }
    },
  });
  const apiKeyInput = await params.prompter.text({
    message: tr({
      zh: "API Key（如不需要可留空）",
      en: "API Key (leave blank if not required)",
    }),
    placeholder: "sk-...",
    initialValue: "",
  });
  return { baseUrl: baseUrlInput.trim(), apiKey: apiKeyInput.trim() };
}

type CustomApiRetryChoice = "baseUrl" | "model" | "both";

async function promptCustomApiRetryChoice(prompter: WizardPrompter): Promise<CustomApiRetryChoice> {
  return await prompter.select({
    message: tr({ zh: "你想修改什么？", en: "What would you like to change?" }),
    options: [
      { value: "baseUrl", label: tr({ zh: "修改 base URL", en: "Change base URL" }) },
      { value: "model", label: tr({ zh: "修改模型", en: "Change model" }) },
      {
        value: "both",
        label: tr({ zh: "同时修改 base URL 和模型", en: "Change base URL and model" }),
      },
    ],
  });
}

async function promptCustomApiModelId(prompter: WizardPrompter): Promise<string> {
  return (
    await prompter.text({
      message: tr({ zh: "模型 ID", en: "Model ID" }),
      placeholder: "e.g. llama3, claude-3-7-sonnet",
      validate: (val) =>
        val.trim() ? undefined : tr({ zh: "模型 ID 必填", en: "Model ID is required" }),
    })
  ).trim();
}

function resolveProviderApi(
  compatibility: CustomApiCompatibility,
): "openai-completions" | "anthropic-messages" {
  return compatibility === "anthropic" ? "anthropic-messages" : "openai-completions";
}

function parseCustomApiCompatibility(raw?: string): CustomApiCompatibility {
  const compatibilityRaw = raw?.trim().toLowerCase();
  if (!compatibilityRaw) {
    return "openai";
  }
  if (compatibilityRaw !== "openai" && compatibilityRaw !== "anthropic") {
    throw new CustomApiError(
      "invalid_compatibility",
      'Invalid --custom-compatibility (use "openai" or "anthropic").',
    );
  }
  return compatibilityRaw;
}

export function resolveCustomProviderId(
  params: ResolveCustomProviderIdParams,
): ResolvedCustomProviderId {
  const providers = params.config.models?.providers ?? {};
  const baseUrl = params.baseUrl.trim();
  const explicitProviderId = params.providerId?.trim();
  if (explicitProviderId && !normalizeEndpointId(explicitProviderId)) {
    throw new CustomApiError(
      "invalid_provider_id",
      "Custom provider ID must include letters, numbers, or hyphens.",
    );
  }
  const requestedProviderId = explicitProviderId || buildEndpointIdFromUrl(baseUrl);
  const providerIdResult = resolveUniqueEndpointId({
    requestedId: requestedProviderId,
    baseUrl,
    providers,
  });

  return {
    providerId: providerIdResult.providerId,
    ...(providerIdResult.renamed
      ? {
          providerIdRenamedFrom: normalizeEndpointId(requestedProviderId) || "custom",
        }
      : {}),
  };
}

export function parseNonInteractiveCustomApiFlags(
  params: ParseNonInteractiveCustomApiFlagsParams,
): ParsedNonInteractiveCustomApiFlags {
  const baseUrl = params.baseUrl?.trim() ?? "";
  const modelId = params.modelId?.trim() ?? "";
  if (!baseUrl || !modelId) {
    throw new CustomApiError(
      "missing_required",
      [
        'Auth choice "custom-api-key" requires a base URL and model ID.',
        "Use --custom-base-url and --custom-model-id.",
      ].join("\n"),
    );
  }

  const apiKey = params.apiKey?.trim();
  const providerId = params.providerId?.trim();
  if (providerId && !normalizeEndpointId(providerId)) {
    throw new CustomApiError(
      "invalid_provider_id",
      "Custom provider ID must include letters, numbers, or hyphens.",
    );
  }
  return {
    baseUrl,
    modelId,
    compatibility: parseCustomApiCompatibility(params.compatibility),
    ...(apiKey ? { apiKey } : {}),
    ...(providerId ? { providerId } : {}),
  };
}

export function applyCustomApiConfig(params: ApplyCustomApiConfigParams): CustomApiResult {
  const baseUrl = params.baseUrl.trim();
  try {
    new URL(baseUrl);
  } catch {
    throw new CustomApiError("invalid_base_url", "Custom provider base URL must be a valid URL.");
  }

  if (params.compatibility !== "openai" && params.compatibility !== "anthropic") {
    throw new CustomApiError(
      "invalid_compatibility",
      'Custom provider compatibility must be "openai" or "anthropic".',
    );
  }

  const modelId = params.modelId.trim();
  if (!modelId) {
    throw new CustomApiError("invalid_model_id", "Custom provider model ID is required.");
  }

  // Transform Azure URLs to include the deployment path for API calls
  const resolvedBaseUrl = isAzureUrl(baseUrl) ? transformAzureUrl(baseUrl, modelId) : baseUrl;

  const providerIdResult = resolveCustomProviderId({
    config: params.config,
    baseUrl: resolvedBaseUrl,
    providerId: params.providerId,
  });
  const providerId = providerIdResult.providerId;
  const providers = params.config.models?.providers ?? {};

  const modelRef = modelKey(providerId, modelId);
  const alias = params.alias?.trim() ?? "";
  const aliasError = resolveAliasError({
    raw: alias,
    cfg: params.config,
    modelRef,
  });
  if (aliasError) {
    throw new CustomApiError("invalid_alias", aliasError);
  }

  const existingProvider = providers[providerId];
  const existingModels = Array.isArray(existingProvider?.models) ? existingProvider.models : [];
  const hasModel = existingModels.some((model) => model.id === modelId);
  const nextModel = {
    id: modelId,
    name: `${modelId} (Custom Provider)`,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
    input: ["text"] as ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: false,
  };
  const mergedModels = hasModel ? existingModels : [...existingModels, nextModel];
  const { apiKey: existingApiKey, ...existingProviderRest } = existingProvider ?? {};
  const normalizedApiKey =
    params.apiKey?.trim() || (existingApiKey ? existingApiKey.trim() : undefined);

  let config: OpenClawConfig = {
    ...params.config,
    models: {
      ...params.config.models,
      mode: params.config.models?.mode ?? "merge",
      providers: {
        ...providers,
        [providerId]: {
          ...existingProviderRest,
          baseUrl: resolvedBaseUrl,
          api: resolveProviderApi(params.compatibility),
          ...(normalizedApiKey ? { apiKey: normalizedApiKey } : {}),
          models: mergedModels.length > 0 ? mergedModels : [nextModel],
        },
      },
    },
  };

  config = applyPrimaryModel(config, modelRef);
  if (alias) {
    config = {
      ...config,
      agents: {
        ...config.agents,
        defaults: {
          ...config.agents?.defaults,
          models: {
            ...config.agents?.defaults?.models,
            [modelRef]: {
              ...config.agents?.defaults?.models?.[modelRef],
              alias,
            },
          },
        },
      },
    };
  }

  return {
    config,
    providerId,
    modelId,
    ...(providerIdResult.providerIdRenamedFrom
      ? { providerIdRenamedFrom: providerIdResult.providerIdRenamedFrom }
      : {}),
  };
}

export async function promptCustomApiConfig(params: {
  prompter: WizardPrompter;
  runtime: RuntimeEnv;
  config: OpenClawConfig;
}): Promise<CustomApiResult> {
  const { prompter, runtime, config } = params;

  const baseInput = await promptBaseUrlAndKey({ prompter });
  let baseUrl = baseInput.baseUrl;
  let apiKey = baseInput.apiKey;

  const compatibilityChoice = await prompter.select({
    message: tr({ zh: "端点兼容类型", en: "Endpoint compatibility" }),
    options: getCompatibilityOptions().map((option) => ({
      value: option.value,
      label: option.label,
      hint: option.hint,
    })),
  });

  let modelId = await promptCustomApiModelId(prompter);

  let compatibility: CustomApiCompatibility | null =
    compatibilityChoice === "unknown" ? null : compatibilityChoice;

  while (true) {
    let verifiedFromProbe = false;
    if (!compatibility) {
      const probeSpinner = prompter.progress(
        tr({ zh: "正在检测端点类型...", en: "Detecting endpoint type..." }),
      );
      const openaiProbe = await requestOpenAiVerification({ baseUrl, apiKey, modelId });
      if (openaiProbe.ok) {
        probeSpinner.stop(
          tr({ zh: "已检测为 OpenAI 兼容端点。", en: "Detected OpenAI-compatible endpoint." }),
        );
        compatibility = "openai";
        verifiedFromProbe = true;
      } else {
        const anthropicProbe = await requestAnthropicVerification({ baseUrl, apiKey, modelId });
        if (anthropicProbe.ok) {
          probeSpinner.stop(
            tr({
              zh: "已检测为 Anthropic 兼容端点。",
              en: "Detected Anthropic-compatible endpoint.",
            }),
          );
          compatibility = "anthropic";
          verifiedFromProbe = true;
        } else {
          probeSpinner.stop(
            tr({ zh: "无法检测端点类型。", en: "Could not detect endpoint type." }),
          );
          await prompter.note(
            tr({
              zh: "该端点未正确响应 OpenAI 或 Anthropic 风格请求。",
              en: "This endpoint did not respond to OpenAI or Anthropic style requests.",
            }),
            tr({ zh: "端点检测", en: "Endpoint detection" }),
          );
          const retryChoice = await promptCustomApiRetryChoice(prompter);
          if (retryChoice === "baseUrl" || retryChoice === "both") {
            const retryInput = await promptBaseUrlAndKey({
              prompter,
              initialBaseUrl: baseUrl,
            });
            baseUrl = retryInput.baseUrl;
            apiKey = retryInput.apiKey;
          }
          if (retryChoice === "model" || retryChoice === "both") {
            modelId = await promptCustomApiModelId(prompter);
          }
          continue;
        }
      }
    }

    if (verifiedFromProbe) {
      break;
    }

    const verifySpinner = prompter.progress(tr({ zh: "正在验证...", en: "Verifying..." }));
    const result =
      compatibility === "anthropic"
        ? await requestAnthropicVerification({ baseUrl, apiKey, modelId })
        : await requestOpenAiVerification({ baseUrl, apiKey, modelId });
    if (result.ok) {
      verifySpinner.stop(tr({ zh: "验证成功。", en: "Verification successful." }));
      break;
    }
    if (result.status !== undefined) {
      verifySpinner.stop(
        tr({
          zh: `验证失败：状态码 ${result.status}`,
          en: `Verification failed: status ${result.status}`,
        }),
      );
    } else {
      verifySpinner.stop(
        tr({
          zh: `验证失败：${formatVerificationError(result.error)}`,
          en: `Verification failed: ${formatVerificationError(result.error)}`,
        }),
      );
    }
    const retryChoice = await promptCustomApiRetryChoice(prompter);
    if (retryChoice === "baseUrl" || retryChoice === "both") {
      const retryInput = await promptBaseUrlAndKey({
        prompter,
        initialBaseUrl: baseUrl,
      });
      baseUrl = retryInput.baseUrl;
      apiKey = retryInput.apiKey;
    }
    if (retryChoice === "model" || retryChoice === "both") {
      modelId = await promptCustomApiModelId(prompter);
    }
    if (compatibilityChoice === "unknown") {
      compatibility = null;
    }
  }

  const providers = config.models?.providers ?? {};
  const suggestedId = buildEndpointIdFromUrl(baseUrl);
  const providerIdInput = await prompter.text({
    message: tr({ zh: "端点 ID", en: "Endpoint ID" }),
    initialValue: suggestedId,
    placeholder: "custom",
    validate: (value) => {
      const normalized = normalizeEndpointId(value);
      if (!normalized) {
        return tr({ zh: "端点 ID 必填。", en: "Endpoint ID is required." });
      }
      return undefined;
    },
  });
  const aliasInput = await prompter.text({
    message: tr({ zh: "模型别名（可选）", en: "Model alias (optional)" }),
    placeholder: "e.g. local, ollama",
    initialValue: "",
    validate: (value) => {
      const requestedId = normalizeEndpointId(providerIdInput) || "custom";
      const providerIdResult = resolveUniqueEndpointId({
        requestedId,
        baseUrl,
        providers,
      });
      const modelRef = modelKey(providerIdResult.providerId, modelId);
      return resolveAliasError({ raw: value, cfg: config, modelRef });
    },
  });
  const resolvedCompatibility = compatibility ?? "openai";
  const result = applyCustomApiConfig({
    config,
    baseUrl,
    modelId,
    compatibility: resolvedCompatibility,
    apiKey,
    providerId: providerIdInput,
    alias: aliasInput,
  });

  if (result.providerIdRenamedFrom && result.providerId) {
    await prompter.note(
      tr({
        zh: `端点 ID "${result.providerIdRenamedFrom}" 已用于其他 base URL，改用 "${result.providerId}"。`,
        en: `Endpoint ID "${result.providerIdRenamedFrom}" already exists for a different base URL. Using "${result.providerId}".`,
      }),
      tr({ zh: "端点 ID", en: "Endpoint ID" }),
    );
  }

  runtime.log(
    tr({
      zh: `已配置自定义提供方：${result.providerId}/${result.modelId}`,
      en: `Configured custom provider: ${result.providerId}/${result.modelId}`,
    }),
  );
  return result;
}
