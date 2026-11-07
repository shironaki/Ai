import { CHARACTER_PROMPT } from "./ai-character.js";

/**
 * OpenAI-compatible provider endpoints.
 *
 * Groq is the current provider. The base URL is a service option so that the
 * chat request and the /aidiag probe can never drift apart, and so a future
 * AI_BASE_URL setting only has to supply a string.
 */
export const DEFAULT_AI_BASE_URL = "https://api.groq.com/openai/v1";
export const GROQ_URL = `${DEFAULT_AI_BASE_URL}/chat/completions`;
export const AI_REQUEST_TIMEOUT_MS = 25000;
export const AI_DIAGNOSTIC_TIMEOUT_MS = 15000;

/**
 * AbortSignal.timeout is a web API, not ECMAScript. The Telegram Serverless
 * runtime is a V8 isolate, not Node, so the timer may be missing entirely.
 * A missing timer must never cancel the request.
 */
export function createTimeoutSignal(ms = AI_REQUEST_TIMEOUT_MS) {
  try {
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      return AbortSignal.timeout(ms);
    }
  } catch {
    // Fall through: run the request without a client-side timeout.
  }
  return undefined;
}
export const DEFAULT_AI_MODEL = "openai/gpt-oss-20b";
const MAX_PROMPT_CHARS = 4000;
const MAX_REPLY_CHARS = 6000;
const MAX_HISTORY_MESSAGES = 8;
/** Never read a huge error page into the isolate just to find an error code. */
const MAX_ERROR_BODY_CHARS = 4096;
const MAX_ERROR_BODY_BYTES = 65536;
/** One tiny request is enough to prove the key, endpoint and model work. */
const MAX_PROBE_TOKENS = 16;

export function redactSecrets(value) {
  return String(value ?? "")
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
    .replace(/\bbot\d{6,}:[A-Za-z0-9_-]{20,}/gi, "[REDACTED_TELEGRAM_TOKEN]")
    .replace(/\b(?:ghp|gho|ghu|ghs|github_pat|glpat)[_-][A-Za-z0-9_-]+/gi, "[REDACTED_GIT_TOKEN]")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]+/gi, "[REDACTED_SLACK_TOKEN]")
    .replace(/gsk_[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/(api[_-]?key\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}

/** Truncate without splitting a surrogate pair (which would corrupt the text). */
export function truncateSafely(text, max) {
  const value = String(text ?? "");
  if (!Number.isSafeInteger(max) || max < 1) throw new RangeError("max must be a positive integer");
  if (value.length <= max) return value;
  let end = max;
  const code = value.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return value.slice(0, end);
}

function clampText(value, max) {
  return truncateSafely(redactSecrets(value).trim(), max);
}

/** A short value that came from the provider: redacted and bounded. */
function safeSnippet(value, max) {
  if (value == null) return "";
  try {
    return truncateSafely(redactSecrets(String(value)).trim(), max);
  } catch {
    return "";
  }
}

function errorNameOf(error) {
  return safeSnippet(error?.name, 40) || "unknown";
}

export function providerChatUrl(baseUrl = DEFAULT_AI_BASE_URL) {
  const base = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  return `${base || DEFAULT_AI_BASE_URL}/chat/completions`;
}

/**
 * The platform `fetch` documents `ok`, but a response without it (or with a
 * non-numeric status) must not be silently counted as an HTTP failure: that
 * would turn a working provider into "AI-провайдер вернул ошибку". Always
 * decide from the strongest signal the response actually carries.
 */
function responseOutcome(response) {
  const isObject = response !== null && typeof response === "object";
  const rawStatus = isObject ? Number(response.status) : Number.NaN;
  const status = Number.isFinite(rawStatus) && rawStatus > 0 ? rawStatus : null;
  const okFlag = isObject && typeof response.ok === "boolean" ? response.ok : null;
  const recognized = okFlag !== null || status !== null;
  const succeeded = okFlag === true || (okFlag === null && status !== null && status >= 200 && status < 300);
  return { status, okFlag, recognized, succeeded };
}

const HTTP_HINTS = Object.freeze({
  400: "запрос отклонён провайдером (проверьте модель и параметры)",
  401: "ключ неверный или отозван",
  403: "доступ запрещён (ключ, регион или ограничение аккаунта)",
  404: "эндпоинт или модель не найдены (проверьте адрес провайдера и модель)",
  413: "запрос слишком большой",
  422: "параметры запроса отклонены",
  429: "превышен лимит запросов провайдера",
  500: "внутренняя ошибка провайдера",
  502: "шлюз провайдера вернул ошибку",
  503: "провайдер временно недоступен",
  504: "таймаут на стороне провайдера",
});

export function describeHttpStatus(status) {
  if (!Number.isFinite(status)) return "";
  if (HTTP_HINTS[status]) return HTTP_HINTS[status];
  if (status >= 500) return "сбой на стороне провайдера";
  if (status >= 400) return "запрос отклонён провайдером";
  return "неожиданный HTTP-статус";
}

/**
 * A diagnosable one-line reason: HTTP status plus the provider's error code
 * (never its message body, headers or the API key).
 */
export function describeProviderFailure({ status, providerCode, providerType, model } = {}) {
  const statusPart = Number.isFinite(status) ? `HTTP ${status}` : "HTTP-статус не получен";
  const code = safeSnippet(providerCode || providerType, 64);
  const hint = describeHttpStatus(status);
  const modelPart = model ? ` Модель: ${safeSnippet(model, 80)}.` : "";
  return `${statusPart}${code ? ` (${code})` : ""}${hint ? ` — ${hint}` : ""}.${modelPart}`;
}

/**
 * Read only the machine-readable part of a provider error. The body itself is
 * never returned, logged or sent to Telegram: it can echo the request.
 */
async function readProviderError(response) {
  const empty = { code: "", type: "", contentType: "" };
  const headers = response?.headers;
  const getHeader = typeof headers?.get === "function" ? (name) => headers.get(name) : null;
  const contentType = getHeader ? safeSnippet(getHeader("content-type"), 80) : "";
  if (typeof response?.text !== "function") return { ...empty, contentType };
  if (getHeader) {
    const length = Number(getHeader("content-length"));
    if (Number.isFinite(length) && length > MAX_ERROR_BODY_BYTES) return { ...empty, contentType };
  }
  let raw;
  try {
    raw = await response.text();
  } catch {
    return { ...empty, contentType };
  }
  const text = String(raw ?? "").slice(0, MAX_ERROR_BODY_CHARS);
  if (!text) return { ...empty, contentType };
  try {
    const parsed = JSON.parse(text);
    return {
      code: safeSnippet(parsed?.error?.code, 64),
      type: safeSnippet(parsed?.error?.type, 64),
      contentType,
    };
  } catch {
    // Not JSON (an HTML block page, for example): no code to report.
    return { ...empty, contentType };
  }
}

export function createAiService({
  confidentialIds = [],
  fetchImpl = null,
  getApiKey = (ctx) => ctx?.env?.GROQ_API_KEY ?? ctx?.GROQ_API_KEY ?? "",
  getModel = (ctx) => ctx?.env?.AI_MODEL ?? ctx?.AI_MODEL ?? DEFAULT_AI_MODEL,
  providerBaseUrl = DEFAULT_AI_BASE_URL,
  additionalContext = async () => "",
  responseProfile = async () => null,
  loadHistory = async () => [],
  saveHistory = async () => {},
  clearHistory = async () => false,
  now = () => Date.now(),
  minimumIntervalMs = 1500,
  // Optional per-person gate: VIP waits less, and the number stays in one place
  // instead of being inferred from a role name somewhere else.
  intervalFor = null,
  claimRequest = null,
  createSignal = createTimeoutSignal,
} = {}) {
  // Construction must not depend on Node globals: the isolate may expose
  // outbound HTTP only through the platform SDK, which the deployed handler
  // injects. A missing client is a runtime condition, not an import failure.
  function resolveFetch() {
    const candidate = fetchImpl ?? globalThis.fetch;
    return typeof candidate === "function" ? candidate : null;
  }

  const baseUrl = String(providerBaseUrl ?? "").trim().replace(/\/+$/, "") || DEFAULT_AI_BASE_URL;
  const chatUrl = providerChatUrl(baseUrl);
  const lastRequest = new Map();

  function requestOptionsFor(apiKey, payload, signal) {
    const options = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    };
    if (signal !== undefined) options.signal = signal;
    return options;
  }

  function signalOrUndefined(ms) {
    try {
      return createSignal(ms);
    } catch {
      return undefined;
    }
  }

  return {
    /** Endpoint the service talks to; /aidiag prints it. Not a secret. */
    providerBaseUrl: baseUrl,

    async clearConversation({ userId, chatId }) {
      if (userId == null || chatId == null) return { ok: false, code: "invalid_request" };
      try {
        const cleared = await clearHistory({ userId: String(userId), chatId: String(chatId) });
        return cleared === true || Number(cleared) > 0
          ? { ok: true, code: "history_cleared" }
          : { ok: false, code: "history_storage_unavailable" };
      } catch {
        return { ok: false, code: "history_storage_error" };
      }
    },

    /**
     * Live provider check for /aidiag: a minimal chat completion with the same
     * URL, headers and body shape as generateReply. It therefore reproduces the
     * real failure (bad key, missing model, rejected parameters, rate limit)
     * instead of only testing connectivity. Never throws, never returns a body.
     */
    async checkProvider({ ctx = {}, apiKey: explicitKey = null, model: modelOverride = null } = {}) {
      const apiKey = String((explicitKey ?? getApiKey(ctx)) ?? "").trim();
      if (!apiKey) return { ok: false, code: "ai_not_configured", text: "ключ не задан" };

      const doFetch = resolveFetch();
      if (!doFetch) return { ok: false, code: "provider_unavailable", text: "HTTP-клиент платформы не подключён" };

      const model = String(modelOverride || getModel(ctx) || DEFAULT_AI_MODEL);
      const options = requestOptionsFor(
        apiKey,
        {
          model,
          messages: [{ role: "user", content: "ping" }],
          temperature: 0,
          max_tokens: MAX_PROBE_TOKENS,
        },
        signalOrUndefined(AI_DIAGNOSTIC_TIMEOUT_MS)
      );

      let response;
      try {
        response = await doFetch(chatUrl, options);
      } catch (error) {
        const errorName = errorNameOf(error);
        return {
          ok: false,
          code: "provider_network_error",
          errorName,
          model,
          text: `нет связи с провайдером (сетевая ошибка: ${errorName})`,
        };
      }

      const outcome = responseOutcome(response);
      if (!outcome.succeeded) {
        // An explicit ok:false on a 2xx is a platform inconsistency, not a
        // provider rejection: name it instead of printing "HTTP 200 error".
        if (outcome.okFlag === false && outcome.status !== null && outcome.status >= 200 && outcome.status < 300) {
          return {
            ok: false,
            code: "provider_ok_flag_conflict",
            status: outcome.status,
            responseOkFlag: outcome.okFlag,
            model,
            text: `AI-платформа вернула HTTP ${outcome.status}, но пометила ответ как ошибочный (ok: false) — несовместимость SDK.`,
          };
        }
        const detail = outcome.recognized ? await readProviderError(response) : { code: "", type: "", contentType: "" };
        return {
          ok: false,
          code: outcome.recognized ? "provider_http_error" : "provider_response_unrecognized",
          status: outcome.status,
          responseOkFlag: outcome.okFlag,
          providerCode: detail.code,
          providerType: detail.type,
          contentType: detail.contentType,
          model,
          text: describeProviderFailure({
            status: outcome.status,
            providerCode: detail.code || detail.type,
            model,
          }),
        };
      }

      let data = null;
      let parsed = true;
      try {
        data = await response.json();
      } catch {
        data = null;
        parsed = false;
      }
      const answer = data?.choices?.[0]?.message?.content;
      return {
        ok: true,
        code: "provider_ok",
        status: outcome.status,
        responseOkFlag: outcome.okFlag,
        model,
        parsed,
        hasContent: typeof answer === "string" && answer.trim() !== "",
      };
    },

    async generateReply({
      userId, chatId, prompt, role = "Пользователь", verifiedContext = "", ctx = {},
      apiKey: explicitKey = null, model: modelOverride = null,
    }) {
      // The caller may resolve the key from a store the service cannot see
      // (the bot database); explicit values win over the ctx-based default.
      const apiKey = String((explicitKey ?? getApiKey(ctx)) ?? "").trim();
      if (!apiKey) return { ok: false, code: "ai_not_configured", text: "Аи пока не подключена: в TEST-контуре не настроен AI-провайдер." };
      if (userId == null || chatId == null || !String(prompt ?? "").trim()) {
        return { ok: false, code: "invalid_request", text: "Не удалось определить пользователя, чат или текст запроса." };
      }
      const doFetch = resolveFetch();
      if (!doFetch) {
        return { ok: false, code: "provider_unavailable", text: "Аи недоступна: платформенный HTTP-клиент не подключён." };
      }

      const key = `${String(chatId)}:${String(userId)}`;
      const time = now();
      let pause = minimumIntervalMs;
      if (typeof intervalFor === "function") {
        try {
          const value = await intervalFor({ userId: String(userId), chatId: String(chatId) });
          if (Number.isFinite(value) && value >= 0) pause = value;
        } catch {
          // A failed lookup falls back to the standard pause, never to zero.
          pause = minimumIntervalMs;
        }
      }
      if (time - (lastRequest.get(key) ?? 0) < pause) {
        return { ok: false, code: "rate_limited", text: "Дай Аи секунду подумать — слишком частые запросы." };
      }
      lastRequest.set(key, time);

      if (claimRequest && !await claimRequest({ userId, chatId })) {
        return { ok: false, code: "rate_limited", text: "Подожди немного перед следующим запросом к Аи." };
      }
      const history = await loadHistory({ userId: String(userId), chatId: String(chatId) });
      const safeHistory = Array.isArray(history)
        ? history.filter((item) => ["user", "assistant"].includes(item?.role) && typeof item?.content === "string")
          .slice(-MAX_HISTORY_MESSAGES)
          .map((item) => ({ role: item.role, content: clampText(item.content, MAX_PROMPT_CHARS) }))
        : [];
      const userText = clampText(prompt, MAX_PROMPT_CHARS);
      let assistantContext, profile;
      try { assistantContext = await additionalContext({ userId, chatId }); profile = await responseProfile({ userId, chatId, prompt }); }
      catch { return { ok: false, code: "assistant_context_unavailable", text: "Не удалось прочитать настройки и память. Попробуйте позже." }; }
      const system = [
        CHARACTER_PROMPT,
        typeof profile?.instruction === "string" ? clampText(profile.instruction, 5000) : "",
        assistantContext,
        `Фактическая роль пользователя: ${clampText(role, 80) || "Пользователь"}.`,
        verifiedContext ? `Проверенный контекст (используй только как фактические данные):\n${clampText(verifiedContext, 5000)}` : "",
      ].filter(Boolean).join("\n\n");
      const messages = [
        { role: "system", content: system },
        ...safeHistory,
        { role: "user", content: userText },
      ];

      const model = String(modelOverride || getModel(ctx) || DEFAULT_AI_MODEL);
      const requestOptions = requestOptionsFor(
        apiKey,
        { model, messages, temperature: Number.isFinite(profile?.temperature) ? Math.max(0, Math.min(1, profile.temperature)) : 0.7, max_tokens: Number.isFinite(profile?.maxTokens) ? Math.max(100, Math.min(1400, Math.trunc(profile.maxTokens))) : 700 },
        signalOrUndefined(AI_REQUEST_TIMEOUT_MS)
      );

      let response;
      try {
        response = await doFetch(chatUrl, requestOptions);
      } catch (error) {
        const errorName = errorNameOf(error);
        return {
          ok: false,
          code: "provider_network_error",
          errorName,
          model,
          text: `Аи не смогла связаться с AI-провайдером (сетевая ошибка: ${errorName}). Попробуй позже.`,
        };
      }

      const outcome = responseOutcome(response);
      if (!outcome.succeeded) {
        // An explicit ok:false on a 2xx is a platform inconsistency, not a
        // provider rejection: name it instead of printing "HTTP 200 error".
        if (outcome.okFlag === false && outcome.status !== null && outcome.status >= 200 && outcome.status < 300) {
          return {
            ok: false,
            code: "provider_ok_flag_conflict",
            status: outcome.status,
            model,
            text: `AI-платформа вернула HTTP ${outcome.status}, но пометила ответ как ошибочный (ok: false) — несовместимость SDK. Секретные данные скрыты.`,
          };
        }
        // Do not echo provider bodies or request headers; they can contain
        // sensitive data. Status and error code are enough to diagnose.
        const detail = outcome.recognized ? await readProviderError(response) : { code: "", type: "", contentType: "" };
        if (!outcome.recognized) {
          return {
            ok: false,
            code: "provider_response_unrecognized",
            status: null,
            model,
            text: "AI-платформа вернула ответ без HTTP-статуса и без флага ok — это несовместимость SDK. Секретные данные скрыты.",
          };
        }
        return {
          ok: false,
          code: "provider_http_error",
          status: outcome.status,
          providerCode: detail.code,
          providerType: detail.type,
          contentType: detail.contentType,
          model,
          text: `AI-провайдер вернул ошибку: ${describeProviderFailure({
            status: outcome.status,
            providerCode: detail.code || detail.type,
            model,
          })} Секретные данные скрыты.`,
        };
      }

      let data;
      try {
        data = await response.json();
      } catch {
        return {
          ok: false,
          code: "provider_invalid_response",
          status: outcome.status,
          model,
          text: `AI-провайдер вернул ответ, который не удалось разобрать как JSON (HTTP ${outcome.status ?? "?"}).`,
        };
      }
      let answer = clampText(data?.choices?.[0]?.message?.content, MAX_REPLY_CHARS);
      if (/(?:основател[ьяюе]|\bfounder\b|создател[ьяюем]*\s+бота)/iu.test(answer) || confidentialIds.some(id => /^[1-9]\d*$/u.test(String(id)) && new RegExp(`(^|[^0-9])${id}([^0-9]|$)`, "u").test(answer))) {
        answer = "Внутренние сведения об управлении я не раскрываю. Могу помочь с доступными возможностями и настройками общения.";
      }
      if (!answer) return { ok: false, code: "empty_response", text: "Аи не получила содержательный ответ от AI-провайдера." };

      const updatedHistory = [...safeHistory, { role: "user", content: userText }, { role: "assistant", content: answer }]
        .slice(-MAX_HISTORY_MESSAGES);
      try {
        await saveHistory({ userId: String(userId), chatId: String(chatId), messages: updatedHistory });
      } catch {
        // The answer remains useful if optional history storage is not available.
      }
      return { ok: true, text: answer, model };
    },
  };
}

/**
 * Human-readable line for /aidiag. Kept next to the check so the wording and
 * the fields can never disagree.
 */
export function describeProviderCheck(check = {}) {
  const compatibilityNote = check.responseOkFlag === null && Number.isFinite(check.status)
    ? " (ответ без флага ok — учтён по HTTP-статусу)"
    : "";
  switch (check.code) {
    case "ai_not_configured":
      return "не выполнена: ключ не задан";
    case "provider_unavailable":
      return "не выполнена: HTTP-клиент платформы не подключён";
    case "provider_network_error":
      return `нет связи с провайдером (сетевая ошибка: ${safeSnippet(check.errorName, 40) || "unknown"})`;
    case "provider_response_unrecognized":
      return "ответ платформы без HTTP-статуса и без флага ok — несовместимость SDK";
    case "provider_ok_flag_conflict":
      return `HTTP ${check.status ?? "?"}, но флаг ok равен false — несовместимость SDK`;
    case "provider_http_error":
      return `${describeProviderFailure({
        status: check.status,
        providerCode: check.providerCode || check.providerType,
      })}${compatibilityNote}`;
    case "provider_ok": {
      if (check.parsed === false) {
        return `HTTP ${check.status ?? 200} — соединение есть, но ответ не JSON (проверьте адрес провайдера)${compatibilityNote}`;
      }
      const contentNote = check.hasContent === false
        ? " (текст в пробном ответе пуст — для reasoning-модели это нормально)"
        : "";
      return `HTTP ${check.status ?? 200} — ключ принят, провайдер отвечает${contentNote}${compatibilityNote}`;
    }
    default:
      return typeof check.text === "string" && check.text ? check.text : "неизвестный результат проверки";
  }
}
