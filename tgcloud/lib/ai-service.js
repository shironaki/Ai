import { CHARACTER_PROMPT, CORE_PROMPT } from "./ai-character.js";
import { readLimits, DEFAULT_REST_MS } from "./brains.js";

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
/** Запасная модель получает меньше времени: человек уже ждал первую. */
export const AI_FALLBACK_TIMEOUT_MS = 15000;
/** Сколько моделей подряд можно спросить на одно сообщение. */
const MAX_ATTEMPTS = 3;
/** Дольше этого паузу между сообщениями не выжидаем — отвечаем сразу. */
const MAX_WAIT_MS = 3000;
/** «Повторите через секунду» дешевле смены модели. */
const SHORT_RETRY_MS = 2500;
/** Модели, которые рассуждают перед ответом и принимают параметр усилия. */
const REASONING_MODEL = /gpt-oss/iu;

/** Подождать. В изоляте без таймеров ожидание пропускается, а не падает. */
export function sleep(ms) {
  if (typeof setTimeout !== "function" || !(ms > 0)) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

/**
 * История для запроса: последние реплики целиком, старые — началом.
 *
 * Восемь сообщений по четыре тысячи знаков — это до восьми тысяч токенов на
 * каждое «привет». Смысл разговора держат последние реплики; от старых
 * достаточно начала, чтобы нить не терялась.
 */
export function compactHistory(history = []) {
  const items = Array.isArray(history) ? history : [];
  return items.map((item, index) => {
    const recent = index >= items.length - 4;
    const limit = recent ? 700 : 200;
    const content = String(item.content ?? "");
    return { role: item.role, content: content.length > limit ? `${truncateSafely(content, limit).trimEnd()}…` : content };
  });
}

/** Скрытые рассуждения модели — не часть ответа. */
export function stripThinking(value) {
  return String(value ?? "").replace(/<think>[\s\S]*?<\/think>/giu, "").replace(/^[\s\S]*<\/think>/iu, "").trim();
}

/** Оборванный ответ заканчивается на последней целой фразе. */
export function trimToSentence(text) {
  const value = String(text ?? "").trimEnd();
  const cut = Math.max(value.lastIndexOf(". "), value.lastIndexOf("! "), value.lastIndexOf("? "), value.lastIndexOf("…"), value.lastIndexOf(".\n"), value.lastIndexOf("!\n"), value.lastIndexOf("?\n"));
  if (/[.!?…»)]$/u.test(value)) return value;
  // Короткий обрывок честнее оставить с многоточием, чем срезать до нуля.
  if (cut < value.length * 0.5) return `${value}…`;
  return value.slice(0, cut + 1).trimEnd();
}

const BLOCKED_ANSWER = "Внутренние сведения об управлении я не раскрываю. Могу помочь с доступными возможностями и настройками общения.";
/** Ответ называет, КТО создал или ведёт бота: это и есть утечка. */
const OWNER_LEAK = [
  /(?:основател|создател|владел|разработчик|хозя)[а-яё]*\s+(?:этого\s+|данного\s+|нашего\s+)?(?:бота|чат-бота)\s*(?:—|–|-|:|это|является|зовут)/iu,
  /(?:мо(?:й|его|ему|им|ем|ём)|мо[яею]|мою)\s+(?:создател|основател|владел|разработчик|хозя)[а-яё]*\s*(?:—|–|-|:|это|является|зовут)\s*@?[\p{L}\d]/iu,
  /меня\s+(?:создал[аи]?|разработал[аи]?|основал[аи]?|сделал[аи]?)\s+@?[\p{Lu}\d]/u,
  /\bfounder\s+of\s+(?:this|the)\s+bot\b/iu,
];

/**
 * Последняя проверка ответа. Раньше любое слово «основатель» заменяло ответ
 * отказом — и вопрос «кто основал Рим?» получал «внутренние сведения не
 * раскрываю». Теперь отказ вызывает только фраза о том, кто стоит за ботом,
 * и числовой ID из закрытого списка. Владельцу в его личке связь признаётся.
 */
export function guardAnswer(answer, { confidentialIds = [], trusted = false } = {}) {
  const text = String(answer ?? "");
  const leaksId = confidentialIds.some(id => /^[1-9]\d{4,}$/u.test(String(id)) && new RegExp(`(^|[^0-9])${id}([^0-9]|$)`, "u").test(text));
  const leaksOwner = !trusted && OWNER_LEAK.some(pattern => pattern.test(text));
  return leaksId || leaksOwner ? { text: BLOCKED_ANSWER, blocked: true } : { text, blocked: false };
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
  // Цепочка моделей. Без неё сервис думает одной моделью, как раньше.
  brains = null,
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
      // Личка или группа: от этого зависят и характер, и то, какие факты можно
      // произносить. Раньше сюда ничего не передавалось, и группа получала
      // подсказку лички — вместе с личными фактами.
      isPrivate = null,
      // Собеседник — владелец в собственной личке: связь можно признавать.
      trusted = false,
      // Отложенный ответ не ждёт паузы между запросами: человек уже ждал.
      deferred = false,
      // Пометки сердца к этой реплике: что прислали, на что отвечают.
      note = "",
    }) {
      // A rehearsal answers the route, never the network. Without this, a test
      // run still travelled through every hook below — and once the bridge to
      // the sister was configured, that turned into two signed posts into her
      // channel and twenty-four seconds of waiting for an answer nobody sent.
      if (ctx?.testRun === true) {
        return { ok: true, code: "test_run", text: "Пробный запуск: здесь был бы ответ Аи. Провайдер не вызывался.", testRun: true };
      }
      // The caller may resolve the key from a store the service cannot see
      // (the bot database); explicit values win over the ctx-based default.
      const apiKey = String((explicitKey ?? getApiKey(ctx)) ?? "").trim();
      if (!apiKey) return { ok: false, code: "ai_not_configured", text: "Ключ провайдера не задан: думать пока нечем." };
      if (userId == null || chatId == null || !String(prompt ?? "").trim()) {
        return { ok: false, code: "invalid_request", text: "Не удалось определить пользователя, чат или текст запроса." };
      }
      const doFetch = resolveFetch();
      if (!doFetch) {
        return { ok: false, code: "provider_unavailable", text: "Платформенный HTTP-клиент не подключён." };
      }
      const privateChat = isPrivate == null ? String(chatId) === String(userId) : Boolean(isPrivate);

      const key = `${String(chatId)}:${String(userId)}`;
      let pause = minimumIntervalMs;
      if (typeof intervalFor === "function") {
        try {
          const value = await intervalFor({ userId: String(userId), chatId: String(chatId), isPrivate: privateChat });
          if (Number.isFinite(value) && value >= 0) pause = value;
        } catch {
          // A failed lookup falls back to the standard pause, never to zero.
          pause = minimumIntervalMs;
        }
      }
      // Два сообщения подряд — не повод отказать. Раньше второе получало «дай
      // секунду подумать» и пропадало; пауза короткая, её можно просто выждать.
      const since = now() - (lastRequest.get(key) ?? 0);
      if (!deferred && since >= 0 && since < pause) await sleep(Math.min(pause - since, MAX_WAIT_MS));
      lastRequest.set(key, now());
      if (lastRequest.size > 512) for (const [k, at] of lastRequest) if (now() - at > 60_000) lastRequest.delete(k);

      if (claimRequest && !await claimRequest({ userId, chatId })) {
        return { ok: false, code: "rate_limited", text: "Слишком много запросов подряд." };
      }
      const history = await loadHistory({ userId: String(userId), chatId: String(chatId) });
      const fullHistory = Array.isArray(history)
        ? history.filter((item) => ["user", "assistant"].includes(item?.role) && typeof item?.content === "string")
          .slice(-MAX_HISTORY_MESSAGES)
          .map((item) => ({ role: item.role, content: clampText(item.content, MAX_PROMPT_CHARS) }))
        : [];
      const userText = clampText(prompt, MAX_PROMPT_CHARS);
      let assistantContext, profile;
      try {
        assistantContext = await additionalContext({ userId, chatId, isPrivate: privateChat, prompt: userText });
        profile = await responseProfile({ userId, chatId, prompt: userText, isPrivate: privateChat });
      } catch { return { ok: false, code: "assistant_context_unavailable", text: "Не удалось прочитать настройки и память." }; }
      // Короткое ядро — для простой реплики; деликатная тема получает полный текст.
      const tier = profile?.tier === "core" && typeof profile?.core === "string" && profile.core ? "core" : "full";
      const system = [
        tier === "core" ? CORE_PROMPT : CHARACTER_PROMPT,
        tier === "core" ? clampText(profile.core, 2000) : (typeof profile?.instruction === "string" ? clampText(profile.instruction, 5000) : ""),
        assistantContext,
        note ? clampText(note, 3500) : "",
        `Фактическая роль пользователя: ${clampText(role, 80) || "Пользователь"}.`,
        verifiedContext ? `Проверенный контекст (используй только как фактические данные):\n${clampText(verifiedContext, 5000)}` : "",
      ].filter(Boolean).join("\n\n");
      const messages = [
        { role: "system", content: system },
        ...compactHistory(fullHistory),
        { role: "user", content: userText },
      ];
      const temperature = Number.isFinite(profile?.temperature) ? Math.max(0, Math.min(1, profile.temperature)) : 0.7;
      const maxTokens = Number.isFinite(profile?.maxTokens) ? Math.max(100, Math.min(1400, Math.trunc(profile.maxTokens))) : 700;

      const wanted = String(modelOverride || getModel(ctx) || DEFAULT_AI_MODEL);
      const single = [{ id: `main:${wanted}`, provider: "main", model: wanted, baseUrl, key: apiKey, plain: false }];
      let pool = brains ? await brains.available({ apiKey, model: wanted }) : single;
      if (!pool.length && brains) {
        // Знакомые модели отдыхают: спросить у провайдера, чем ещё можно думать.
        const found = await brains.discover({ fetchImpl: doFetch, apiKey, signal: signalOrUndefined(AI_DIAGNOSTIC_TIMEOUT_MS) });
        if (found.added?.length) pool = await brains.available({ apiKey, model: wanted });
      }
      if (!pool.length) {
        // Думать нечем. «Лимит вышел» и «нет связи» — разные причины, и
        // человеку с владельцем называется настоящая.
        const why = brains ? await brains.whyResting({ apiKey, model: wanted }) : "";
        return {
          ok: false, code: "brains_exhausted", transient: true, limited: why !== "fault",
          retryAt: brains ? await brains.nextAt({ apiKey, model: wanted }) : 0, model: wanted,
          text: why === "fault" ? "Модели недоступны: связь или сбой у провайдера." : "Все модели отдыхают: лимит запросов исчерпан.",
        };
      }

      /** Один запрос к одной модели. Сам запоминает, кому пора отдохнуть. */
      const ask = async (brain, { timeout, plain = brain.plain, retried = false }) => {
        const payload = { model: brain.model, messages, temperature, max_tokens: maxTokens };
        // Рассуждающая модель по умолчанию тратит на раздумья сотни токенов до
        // первого слова ответа. Для разговора хватает малого усилия.
        const eased = !plain && REASONING_MODEL.test(brain.model);
        if (eased) payload.reasoning_effort = "low";
        let response;
        try {
          response = await doFetch(providerChatUrl(brain.baseUrl), requestOptionsFor(brain.key, payload, signalOrUndefined(timeout)));
        } catch (error) {
          if (brains) await brains.rest(brain.id, { ms: DEFAULT_REST_MS, why: "network" });
          const errorName = errorNameOf(error);
          return { ok: false, code: "provider_network_error", transient: true, errorName, model: brain.model, text: `Нет связи с провайдером (сетевая ошибка: ${errorName}).` };
        }
        const outcome = responseOutcome(response);
        const limits = readLimits(response?.headers);
        if (!outcome.succeeded) {
          // An explicit ok:false on a 2xx is a platform inconsistency, not a
          // provider rejection: name it instead of printing "HTTP 200 error".
          if (outcome.okFlag === false && outcome.status !== null && outcome.status >= 200 && outcome.status < 300) {
            return { ok: false, code: "provider_ok_flag_conflict", status: outcome.status, model: brain.model, text: `AI-платформа вернула HTTP ${outcome.status}, но пометила ответ как ошибочный (ok: false) — несовместимость SDK.` };
          }
          if (!outcome.recognized) {
            return { ok: false, code: "provider_response_unrecognized", status: null, model: brain.model, text: "AI-платформа вернула ответ без HTTP-статуса и без флага ok — это несовместимость SDK." };
          }
          // Do not echo provider bodies or request headers; they can contain
          // sensitive data. Status and error code are enough to diagnose.
          const detail = await readProviderError(response);
          const status = outcome.status;
          const reason = `${detail.code} ${detail.type}`.toLowerCase();
          const limited = status === 429 || status === 413;
          const gone = status === 404 || (status === 400 && /model|decommission|not_found/u.test(reason));
          // Параметр усилия не принят этой моделью: спросить проще и запомнить.
          if (status === 400 && eased && !gone) {
            if (brains) await brains.simplify(brain.id);
            return ask(brain, { timeout, plain: true, retried });
          }
          if (status === 429 && !retried && limits.retryAfterMs != null && limits.retryAfterMs <= SHORT_RETRY_MS) {
            await sleep(limits.retryAfterMs + 100);
            return ask(brain, { timeout, plain, retried: true });
          }
          if (brains) {
            if (limited) await brains.rest(brain.id, { ms: limits.retryAfterMs ?? DEFAULT_REST_MS, why: "limit" });
            else if (gone) await brains.retire(brain.id, { why: "gone" });
            else if (status >= 500) await brains.rest(brain.id, { ms: DEFAULT_REST_MS, why: "down" });
          }
          return {
            ok: false, code: "provider_http_error", status, limited, gone,
            transient: limited || status >= 500,
            keyRejected: status === 401 || status === 403,
            providerCode: detail.code, providerType: detail.type, contentType: detail.contentType,
            model: brain.model,
            text: `AI-провайдер вернул ошибку: ${describeProviderFailure({ status, providerCode: detail.code || detail.type, model: brain.model })}`,
          };
        }
        let data;
        try { data = await response.json(); }
        catch {
          return { ok: false, code: "provider_invalid_response", status: outcome.status, model: brain.model, text: `AI-провайдер вернул ответ, который не удалось разобрать как JSON (HTTP ${outcome.status ?? "?"}).` };
        }
        if (brains) await brains.note(brain.id, limits);
        return { ok: true, data, limits };
      };

      const tried = [];
      const rejected = new Set();
      let last = null;
      for (const brain of pool) {
        if (tried.length >= MAX_ATTEMPTS) break;
        // Ключ отвергнут — другая модель того же провайдера не поможет.
        if (rejected.has(brain.provider)) continue;
        const result = await ask(brain, { timeout: tried.length ? AI_FALLBACK_TIMEOUT_MS : AI_REQUEST_TIMEOUT_MS });
        tried.push(brain.model);
        if (!result.ok) {
          last = result;
          if (result.keyRejected) rejected.add(brain.provider);
          continue;
        }
        const choice = result.data?.choices?.[0];
        let answer = clampText(stripThinking(choice?.message?.content), MAX_REPLY_CHARS);
        // Ответ оборван лимитом длины: закончить на целой фразе, а не на полуслове.
        if (choice?.finish_reason === "length") answer = trimToSentence(answer);
        answer = guardAnswer(answer, { confidentialIds, trusted }).text;
        if (!answer) {
          last = { ok: false, code: "empty_response", model: brain.model, text: "Провайдер вернул пустой ответ." };
          continue;
        }
        const updatedHistory = [...fullHistory, { role: "user", content: userText }, { role: "assistant", content: answer }]
          .slice(-MAX_HISTORY_MESSAGES);
        try {
          await saveHistory({ userId: String(userId), chatId: String(chatId), messages: updatedHistory });
        } catch {
          // The answer remains useful if optional history storage is not available.
        }
        const usage = result.data?.usage ?? {};
        return {
          ok: true, text: answer, model: brain.model, brain: brain.id, tier,
          // Думала не основной моделью: об этом узнаёт владелец, а не собеседник.
          switched: tried.length > 1 || brain.id !== pool[0].id || brain.model !== wanted,
          tried,
          usage: { prompt: Number(usage.prompt_tokens) || 0, completion: Number(usage.completion_tokens) || 0, total: Number(usage.total_tokens) || 0 },
          remainingRequests: result.limits?.remainingRequests ?? null,
          limitRequests: result.limits?.limitRequests ?? null,
        };
      }
      return { ...(last ?? { ok: false, code: "empty_response", text: "Провайдер вернул пустой ответ." }), tried, retryAt: brains ? await brains.nextAt({ apiKey, model: wanted }) : 0 };
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
