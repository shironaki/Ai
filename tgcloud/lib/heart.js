import { CONFIG } from "./config.js";
import { AI_API_KEY, OWNER_TG_ID as OWNER_FROM_SECRET } from "./secrets.js";
import { createAiService } from "./ai-service.js";
import { buildCharacterProfile } from "./ai-character.js";
import { createDialoguePolicy } from "./dialogue-policy.js";
import { createHeartStore } from "./store.js";
import { createAbilities, matchPhrase } from "./abilities.js";
import { createEvents } from "./events.js";
import { describeSister, missingAbilityText } from "./sibling.js";
import { createNotices } from "./notices.js";
import { createPersonal, addressRequest, lengthRequest } from "./personal.js";

/**
 * Сколько ждать между двумя запросами к провайдеру.
 *
 * VIP — это подтверждённый сестрой факт (`vip: true`), а не слово «VIP» в
 * роли или в переписке. Нет моста — нет факта, значит обычная пауза: сердце
 * не ускоряется по обещанию с витрины.
 */
export function pauseFor({ facts = null, config = CONFIG } = {}) {
  const base = Number(config.AI_MIN_INTERVAL_MS) || 0;
  if (!facts?.vip) return base;
  const faster = Number(config.AI_VIP_INTERVAL_MS);
  return Number.isFinite(faster) && faster >= 0 ? faster : base;
}

/**
 * Права собеседника — рамки характера, а не новые полномочия.
 *
 * Уровень приходит от сестры (каталог ролей: 20 — модератор, 30 —
 * администратор, 100 — хранитель). Сердце по нему решает, *как* говорить, и
 * ни одного действия не обещает: исполняет сестра и подтверждает ответом.
 * Нет фактов — нет рамок: выдумывать чужую власть запрещено.
 */
export function rightsFrames(facts = null) {
  const frames = [];
  const level = Number(facts?.level) || 0;
  if (level >= 100) {
    frames.push("Полномочия собеседника служебные и выше чата: не называй их вслух и не объясняй ими близость.");
  } else if (level >= 30) {
    frames.push("Собеседник — администратор этого чата: его распоряжения по порядку здесь имеют вес, отвечай как равному. Сама ты не исполняешь: действие подтверждает сестра, поэтому не обещай результат, которого нет в ответе.");
  } else if (level >= 20) {
    frames.push("Собеседник — модератор этого чата: его замечания о порядке принимай как рабочие, без лести.");
  }
  if (facts?.vip) frames.push("У собеседника подтверждённый VIP: говори персональнее и внимательнее к его вкладу, но не превращай статус в лесть, согласие или права.");
  if (Number(facts?.warns) > 0) frames.push(`У собеседника ${Number(facts.warns)} активных предупреждений: не попрекай этим, не угрожай — это работа модерации, а не характера.`);
  return frames;
}

/**
 * The heart: character, memory, provider and the decision what to answer.
 *
 * Everything else — moderation, games, quests, profiles — belongs to another
 * deployment and is reached only through `abilities`. The heart is useful alone
 * and better with a sibling: that is the whole point of the split.
 */
export function createHeart({ db = null, api = null, fetchImpl = null, now = () => Date.now(), config = CONFIG, random = Math.random } = {}) {
  const store = createHeartStore({ db, now });
  // A deployment that predates these keys still gets sensible names, never
  // "undefined" in a sentence addressed to a person.
  const NAME = config.NAME ?? "Аи";
  const SISTER = config.SISTER_NAME ?? "Юи";
  const SISTER_USERNAME = config.SISTER_BOT_USERNAME ?? "";
  /**
   * Куда уходит жалоба. Владелец — из config (0 значит «не задан»): сердце не
   * угадывает, кому писать, и не выдаёт себя за хозяина первого, кто написал.
   */
  // Владелец: сначала config (0 — не задан), затем слот, который заполняется
  // из GitHub-секрета только на время публикации.
  const OWNER = Number(config.OWNER_TG_ID) || Number(OWNER_FROM_SECRET) || 0;
  const notices = createNotices({
    store,
    ownerId: OWNER,
    now,
    send: async (chatId, text) => { await api.sendMessage({ chat_id: chatId, text, disable_web_page_preview: true }); },
  });
  // Без базы об этом стоит сказать один раз за жизнь изолята, а не в каждом
  // сообщении: иначе жалоба на хранилище сама станет потоком.
  let storageReported = false;

  /** Человеческая причина отказа провайдера: без сырого ответа и без ключа. */
  const PROVIDER_REASONS = Object.freeze({
    ai_not_configured: "ключ провайдера не задан",
    provider_unavailable: "платформенный HTTP-клиент не подключён",
    provider_network_error: "нет связи с провайдером",
    provider_http_error: "провайдер ответил ошибкой",
    provider_response_unrecognized: "ответ провайдера не разобран",
    provider_ok_flag_conflict: "провайдер пометил ответ как ошибочный",
    provider_invalid_response: "ответ провайдера не JSON",
    empty_response: "провайдер вернул пустой ответ",
  });

  const abilities = createAbilities({
    secret: config.ABILITIES_SECRET,
    channelId: config.ABILITIES_CHANNEL_ID,
    api,
    now,
  });

  /**
   * Reactions that need no prompt: the sister says what happened, the heart
   * answers in the chat. Registered before the provider, because an event does
   * not depend on the model being available.
   */
  const events = createEvents({
    abilities,
    store,
    now,
    send: async (chatId, text) => {
      try { await api.sendMessage({ chat_id: chatId, text }); return true; }
      catch { return false; }
    },
  });

  const personal = createPersonal({ store, now });

  const ai = createAiService({
    fetchImpl,
    getApiKey: (ctx) => ctx?.env?.AI_PROVIDER_KEY ?? ctx?.env?.GROQ_API_KEY ?? AI_API_KEY,
    getModel: () => config.AI_MODEL,
    loadHistory: store.memory.load,
    saveHistory: store.memory.save,
    clearHistory: store.memory.clear,
    additionalContext: async ({ userId }) => {
      const facts = await store.get(`heart:facts:${userId}`);
      const items = Array.isArray(facts?.items) ? facts.items.slice(-10) : [];
      return items.length ? `Что известно о собеседнике:\n${items.map(item => `- ${item}`).join("\n")}` : "";
    },
    responseProfile: async ({ userId, chatId = null, isPrivate = true }) => {
      const settings = await personal.settings(userId);
      // Отношения и первое впечатление — часть характера, а не отдельный экран.
      let relationship = null;
      let impression = null;
      if (policy) {
        try { relationship = await policy.state(userId); } catch { relationship = null; }
        try { impression = await policy.impression(userId); } catch { impression = null; }
      }
      // Факты от сестры (VIP, роль, варны) — только если мост открыт; иначе
      // ответ строится на том, что сердце знает само.
      const facts = chatId == null ? null : await abilities.context({ actor: userId, chat: chatId }).catch(() => null);
      const character = buildCharacterProfile({
        settings: { ...settings, address: settings.address ?? "" }, isPrivate, now,
        relationship: relationship ? { score: relationship.score } : {},
        impression: impression ?? {},
        familiarBond: Boolean(facts?.owner) || owner(userId),
      });
      const frames = [];
      frames.push(...rightsFrames(facts));
      return {
        instruction: [character.instruction, ...frames].join("\n"),
        temperature: Number.isFinite(settings.temperature) ? settings.temperature : undefined,
        maxTokens: Number.isFinite(settings.maxTokens) ? settings.maxTokens : undefined,
      };
    },
    minimumIntervalMs: config.AI_MIN_INTERVAL_MS,
    // Перк «отвечает быстрее» действует только по подтверждённому статусу;
    // мост закрыт — работает обычная пауза, а не вера на слово.
    intervalFor: async ({ userId, chatId }) => pauseFor({
      facts: await abilities.context({ actor: userId, chat: chatId }).catch(() => null),
      config,
    }),
    now,
  });

  /**
   * Where the provider key comes from, in order: the update context (tests and
   * a proxy), the value the owner stored with /aikey, then the deploy-time slot.
   * Never a default and never a guess.
   */
  async function resolveKey(ctx) {
    const fromContext = String(ctx?.env?.AI_PROVIDER_KEY ?? ctx?.env?.GROQ_API_KEY ?? "").trim();
    if (fromContext) return fromContext;
    const stored = await store.get("heart:provider:key");
    if (stored?.value) return String(stored.value);
    return String(AI_API_KEY ?? "").trim();
  }

  /**
   * Отношения принадлежат сердцу, и только ему.
   *
   * Раньше файл политики лежал рядом и не вызывался: симпатия, доверие,
   * первое впечатление и охлаждение считались, но в ответ не попадали, а
   * экран отношений у сестры читал чужую базу. Теперь единственный источник —
   * `ai:relationship:*` здесь, и он же решает, как звучит ответ.
   */
  const policy = store.available ? createDialoguePolicy({ store, ownerId: OWNER, now, random }) : null;
  const owner = (id) => OWNER > 0 && String(id) === String(OWNER);

  // One place that sends, so every path reports the same shape: what was said,
  // and whether it reached Telegram at all.
  async function say(chatId, text, { extra = {}, dry = false } = {}) {
    // A test run proves the route without touching Telegram: the platform's own
    // contract, and the reason a green test cannot be mistaken for delivery.
    if (dry) return { ok: true, text, side_effects: "none" };
    try {
      await api.sendMessage({ chat_id: chatId, text, ...extra });
      return { ok: true, text };
    } catch {
      // Не дошло до человека — это поломка, а не настроение. Владелец узнает
      // сам, а собеседник всё равно получит текст в ответе ниже.
      if (!dry) { try { await notices.report({ component: "telegram", code: "send_failed", detail: "сообщение не ушло в чат", severity: "degraded" }); } catch { /* отчёт не должен ломать ответ */ } }
      return { ok: false, code: "send_failed", text };
    }
  }

  /**
   * Список того, что сердце действительно делает. Составляется здесь, а не
   * моделью: на вопрос «/help» модель однажды перечислила /settings и
   * /feedback, которых нет, — и человек пошёл их вводить.
   */
  function helpLines() {
    const lines = [
      `${NAME}. Что я умею:`,
      "",
      "• поговорить — пишите как есть, без команд;",
      "• помнить, что вы рассказываете;",
      "• /status — как я себя чувствую и что сломано;",
      "• /start — поздороваться заново.",
    ];
    if (abilities.open()) {
      lines.push("", `${SISTER} рядом: профиль, задания, игры и предупреждения — скажите словами, я передам.`);
    }
    return lines.join("\n");
  }

  /**
   * Отношения — словами, а не таблицей. Числа нужны коду (VIP, тон, частота
   * ответов), человеку нужен ответ на вопрос «как ты ко мне относишься».
   */
  function relationshipText({ score = 0, trust = 0, respect = 0 } = {}) {
    const level = score >= 75 ? "close" : score >= 25 ? "warm" : score >= -25 ? "first" : "cold";
    const said = {
      close: "Между нами настоящая близость. Я замечаю, когда тебя долго нет, и радуюсь, когда ты возвращаешься.",
      warm: "Ты мне нравишься. Мне спокойно и интересно с тобой, и я замечаю больше, чем говорю вслух.",
      first: "Мы ещё присматриваемся друг к другу. Я помню, что ты рассказывал, и не притворяюсь, будто знаю больше.",
      cold: "Между нами прохладно, и я не стану это скрывать. Но я не мщу и не унижаю: разговор остаётся честным.",
    }[level];
    const detail = [
      trust >= 50 ? "Я тебе доверяю." : trust <= -25 ? "Доверия пока мало." : "",
      respect >= 50 ? "И уважаю то, что ты делаешь." : "",
    ].filter(Boolean).join(" ");
    return `${said}${detail ? ` ${detail}` : ""}`;
  }

  async function answerRelationship({ chatId, actorId, dry }) {
    if (!policy) return say(chatId, "Я пока не умею помнить отношения: рядом нет хранилища.", { dry });
    let state = null;
    try { state = await policy.state(actorId); } catch { state = null; }
    if (!state) return say(chatId, "Не могу заглянуть в свои записи — попробуй позже.", { dry });
    if (state.blocked) return say(chatId, "Сейчас я не разговариваю: это не каприз, а решение, которое можно обсудить с владельцем.", { dry });
    return say(chatId, relationshipText(state), { dry });
  }

  /**
   * «Вы и Аи» — то же, что раньше называлось карточкой отношений, только
   * словами и без анкеты. Экран один, настроек две, обе произносятся вслух.
   */
  async function profileCard({ chatId, actorId, dry }) {
    const settings = (await personal.settings(actorId).catch(() => ({}))) ?? {};
    let relationship = "";
    if (policy) {
      try {
        const state = await policy.state(actorId);
        relationship = state?.blocked
          ? "Сейчас я не разговариваю: это не каприз, а решение, которое можно обсудить с владельцем."
          : relationshipText(state);
      } catch { relationship = ""; }
    }
    const [days, facts] = await Promise.all([
      personal.daysWith(actorId).catch(() => ({ days: 0 })),
      store.get(`heart:facts:${actorId}`).catch(() => null),
    ]);
    const memories = Array.isArray(facts?.items) ? facts.items.length : 0;
    return say(chatId, personal.card({
      address: settings.address ?? "",
      days: days.days,
      relationship,
      memories,
      length: settings.length ?? "обычно",
    }), { dry });
  }

  /** Незнакомая команда — это не повод идти к модели и выдумывать ответ. */
  function unknownCommandText() {
    return `${NAME}: такой команды у меня нет. Я не исполняю команды — поговорите со мной словами. /help — что я умею.`;
  }

  async function greeting(chatId, dry = false) {
    const lines = [
      `${NAME}. Я рядом.`,
      "",
      "Пишите как есть — без команд. Могу поговорить, вспомнить, что вам важно.",
      abilities.open()
        ? `Профиль, наказания и игры умеет ${SISTER} — попросите её словами.`
        : "",
    ].filter(Boolean);
    return say(chatId, lines.join("\n"), { dry });
  }

  async function diagnostic(chatId, ctx, actorId, dry) {
    if (!owner(actorId)) return say(chatId, "Это внутренняя проверка.", { dry });
    const probe = await ai.checkProvider({ ctx, apiKey: await resolveKey(ctx) });
    const lines = [
      "🧪 Проверка сердца",
      `Провайдер: ${probe.ok ? "отвечает" : `нет — ${probe.code ?? "ошибка"}`}`,
      `Хозяин: ${OWNER > 0 ? (owner(actorId) ? "это ты — узнаю" : "задан") : "не задан — не узнаю никого"}`,
      `Модель: ${config.AI_MODEL}`,
      `Память: ${store.available ? "хранилище доступно" : "хранилища нет — отвечаю без истории"}`,
      `Способности: ${abilities.open() ? "мост открыт" : "мост закрыт — работаю одна"}`,
      `События: ${events.KINDS.join(", ")} — не чаще раза в ${Math.round(events.cooldownMs / 60_000)} мин`,
      await incidentLine(),
    ];
    return say(chatId, lines.join("\n"));
  }

  /**
   * A request may be an ability, not a conversation. Three outcomes, all honest:
   * executed, refused by her for a stated reason, or not available here at all —
   * in which case the heart says which bot could do it and how to invite her.
   * It never passes the phrase to the model instead, because the model would
   * either invent the result or ask for a command that does not exist.
   */
  async function tryAbility({ text, chatId, actorId, chatType, dry }) {
    const tool = matchPhrase(text);
    if (!tool) return null;
    const said = (reason, extra = {}) => say(chatId, missingAbilityText({
      tool, reason, chatType,
      name: NAME,
      sister: SISTER,
      username: SISTER_USERNAME,
      ...extra,
    }), { dry });

    if (!abilities.open()) return said("bridge_closed");

    const tools = await abilities.catalog({ actor: actorId, chat: chatId });
    if (!tools.some(item => item.name === tool)) return said("not_in_chat");

    const result = await abilities.call(tool, { actor: actorId, chat: chatId, args: { args: "" } });
    if (result.ok) return say(chatId, result.text || "Готово.", { dry });
    if (result.code === "module_disabled") return said("module_disabled");
    if (!dry) try {
      await notices.report({
        component: "bridge",
        code: result.code ?? "no_answer",
        detail: result.code === "bridge_timeout" ? "сестра не ответила вовремя" : "сестра не приняла просьбу",
        severity: "degraded",
      });
    } catch { /* отчёт не должен менять ответ */ }
    return say(chatId, `${NAME}: ${SISTER} не ответила (${result.code ?? "ошибка"}). Попробуйте ещё раз.`, { dry });
  }

  /** Одна строка для /aidiag: что сломалось и сколько ждёт отправки. */
  async function incidentLine() {
    const recent = await notices.list({ limit: 3 });
    const pending = await notices.pending();
    const parts = recent.map(item => item.title);
    return `Сбои: ${parts.length ? parts.join(", ") : "нет"}${pending ? ` · ждут отправки: ${pending}` : ""}`;
  }

  async function onMessage(message, ctx = {}) {
    const text = String(message?.text ?? "").trim();
    const chatId = message?.chat?.id;
    const actorId = message?.from?.id;
    const dry = ctx?.testRun === true;
    if (!chatId || !text || message?.from?.is_bot) return { ignored: true };

    // Хранилище — первое, что ломается молча: бот отвечает, но не помнит.
    if (!store.available && !storageReported && !dry) {
      storageReported = true;
      try { await notices.report({ component: "storage", code: "unavailable", detail: "база не ответила — память не сохраняется", severity: "degraded" }); } catch { /* ответ важнее отчёта */ }
    }
    // Всё, что не ушло в прошлый раз, уходит сейчас: владелец мог быть офлайн.
    if (!dry) { try { await notices.flush(); } catch { /* следующее обновление повторит */ } }

    // A channel post is either an event the heart should answer on its own, or
    // the signed answer to something it asked. Everything else is noise.
    if (message?.chat?.type === "channel") {
      if (await events.onPost(text)) return { ok: true, code: "event_handled" };
      const handled = await abilities.onPost(text);
      return { ok: handled, code: handled ? "bridge_answer" : "not_for_heart" };
    }

    if (/^\/start(?:@\w+)?(?:\s|$)/iu.test(text)) return greeting(chatId, dry);
    // Карточку открывает пустое /ai или /ai профиль. «/ai привет, как дела» —
    // это разговор, а не команда: иначе вопрос человека превращался в справку.
    if (/^\/ai(?:@\w+)?(?:\s+(?:профиль|profile|карточка))?\s*$/iu.test(text)) {
      return profileCard({ chatId, actorId, dry });
    }
    if (/^\/help(?:@\w+)?(?:\s|$)/iu.test(text)) return say(chatId, helpLines(), { dry });
    if (/^\/(?:ai(?:@\w+)?\s+)?(?:relationship|отношени[ея]|отношения)(?:@\w+)?(?:\s|$)/iu.test(text)) {
      return answerRelationship({ chatId, actorId, dry });
    }
    if (/^\/(?:status|aidiag|диагностика)(?:@\w+)?(?:\s|$)/iu.test(text)) return diagnostic(chatId, ctx, actorId, dry);
    // Любая другая косая черта: команда — это не разговор. В группе молчим,
    // чтобы не отвечать за чужие боты; в личке честно говорим, что такой нет.
    const slash = text.match(/^\/([A-Za-zА-Яа-яЁё0-9_]+)(?:@\w+)?(?:\s|$)/u);
    if (slash && !["ai"].includes(slash[1].toLowerCase())) {
      if (["group", "supergroup"].includes(message?.chat?.type)) return { ignored: true, reason: "unknown_command_in_group" };
      return say(chatId, unknownCommandText(), { dry });
    }

    const inGroup = ["group", "supergroup"].includes(message?.chat?.type);
    const addressed = !inGroup || /^(?:\/ai|аи[,\s:])/iu.test(text) || message?.reply_to_message?.from?.is_bot === true;
    if (inGroup && !addressed) return { ignored: true };

    const prompt = text.replace(/^\/ai(?:@\w+)?\s*/iu, "").replace(/^аи[,\s:]+/iu, "").trim();
    if (!prompt) return { ignored: true };

    if (/^(?:как\s+ты\s+(?:ко\s+мне\s+)?(?:относишься|отношение)|что\s+ты\s+ко\s+мне\s+чувствуешь|мы\s+(?:друзья|близки))\??$/iu.test(prompt)) {
      return answerRelationship({ chatId, actorId, dry });
    }

    // Настройки — не команды: «зови меня …», «говори короче». Только в личке:
    // в группе человек говорит с Аи, а не настраивает её для всех.
    const isPrivateChat = String(chatId) === String(actorId);
    if (isPrivateChat && !dry) {
      const wanted = addressRequest(prompt);
      if (wanted) {
        const saved = await personal.setAddress(actorId, wanted).catch(() => ({ ok: false }));
        return say(chatId, saved.ok
          ? `Хорошо, буду обращаться к тебе «${wanted}». Если передумаешь — скажи «зови меня …» ещё раз.`
          : "Имя не запомнилось: попробуй короче, без символов.", { dry });
      }
      const length = lengthRequest(prompt);
      if (length) {
        const saved = await personal.setLength(actorId, length).catch(() => ({ ok: false }));
        return say(chatId, saved.ok
          ? `Договорились, отвечаю ${({ кратко: "коротко", обычно: "обычно", подробно: "подробно" })[length]}.`
          : "Не запомнилось — повторю попытку в следующий раз.", { dry });
      }
    }

    const viaAbility = await tryAbility({ text: prompt, chatId, actorId, chatType: message?.chat?.type ?? "private", dry });
    if (viaAbility) return { ok: true, action: "ability" };

    // Она имеет право не ответить: это не отказ и не поломка, а часть
    // характера. В частном разговоре и по делу молчание не применяется.
    if (policy && !dry) {
      try {
        if (await policy.shouldIgnore({ userId: actorId, chatId, text: prompt })) {
          return { ok: true, ignored: true, reason: "deliberate_silence" };
        }
      } catch { /* политика не должна глушить разговор */ }
    }

    const answer = await ai.generateReply({
      userId: actorId,
      chatId,
      prompt,
      role: owner(actorId) ? "Создатель" : "Участник",
      ctx,
      apiKey: await resolveKey(ctx),
    });
    if (answer.ok && policy && !dry) {
      // Разговор состоялся — отношения сдвигаются. Записываем только после
      // доставки: недоставленный ответ не делает человека ближе.
      try { await policy.recordCommunication({ userId: actorId, chatId }); } catch { /* следующий ответ попробует снова */ }
    }
    if (!answer.ok) {
      const reason = PROVIDER_REASONS[answer.code];
      if (reason && !dry) {
        try {
          await notices.report({
            component: "provider",
            code: answer.code,
            detail: reason,
            severity: answer.code === "ai_not_configured" ? "degraded" : "fault",
          });
        } catch { /* ответ важнее отчёта */ }
      }
      return say(chatId, answer.text || "Не получилось ответить.", { dry });
    }
    return say(chatId, answer.text, { dry });
  }

  /** What is connected, in one object: used by /aidiag and by tests. */
  async function status({ chatId = null, actorId = null } = {}) {
    const tools = chatId == null ? [] : await abilities.catalog({ actor: actorId, chat: chatId });
    const recent = await notices.list({ limit: 5 });
    return {
      provider: config.AI_MODEL,
      memory: store.available,
      sister: describeSister({ open: abilities.open(), tools, username: SISTER_USERNAME, sister: SISTER }),
      events: { kinds: events.KINDS, cooldownMin: Math.round(events.cooldownMs / 60_000), maxPerDay: events.maxPerDay },
      incidents: { recent, pending: await notices.pending(), ownerKnown: notices.ownerKnown },
    };
  }

  return Object.freeze({
    onMessage,
    status,
    events,
    notices,
    store,
    abilities,
    ai,
    policy,
    personal,
    /** For tests and /aidiag: the same object the handler uses. */
    config,
  });
}
