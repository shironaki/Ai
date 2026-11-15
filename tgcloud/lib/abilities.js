import { createBridge } from "./bridge.js";
import { hasTimers, later, cancel } from "./timers.js";

/**
 * The abilities port: how the heart asks another bot to do something.
 *
 * The heart decides *what* is worth doing; the abilities bot (moderation, games,
 * quests, profiles) decides *whether* it may be done, in that chat, for that
 * person. The heart never gets to overrule that, and it never learns the other
 * bot's rights.
 *
 * Wire: one line in a private channel both bots administer.
 *   request  AI-BRIDGE1 {"v":1,"id":"…","tool":"profile",…,"sig":"…"}
 *   answer   AI-BRIDGE1 {"v":1,"id":"…","ok":true,"code":"ok","text":"…","sig":"…"}
 *
 * Without a channel and a secret the port is closed, and the heart answers
 * alone — degraded, not broken.
 */
export const BUS_PREFIX = "AI-BRIDGE1 ";
const CATALOG_TOOL = "__catalog";
const CONTEXT_TOOL = "__context";

/**
 * Конверт можно подписать словами. Канал моста читают люди — владелец прежде
 * всего, — и строка «Аи просит: что известно о человеке» перед машинной
 * строкой не мешает подписи: она вне конверта.
 */
export function encodeEnvelope(value, note = "") {
  const line = BUS_PREFIX + JSON.stringify(value);
  const clean = String(note ?? "").replace(/\s+/gu, " ").trim().slice(0, 160);
  return clean ? `${clean}\n${line}` : line;
}

/**
 * Разбор ищет префикс в любом месте текста, а не только в начале: конверт
 * остаётся неизменным и проверяемым, а пояснительная строка перед ним — нет.
 * Отправитель без пояснения (старая сборка) разбирается как раньше.
 */
export function decodeEnvelope(text) {
  const raw = String(text ?? "");
  const at = raw.indexOf(BUS_PREFIX);
  if (at < 0) return null;
  try {
    const value = JSON.parse(raw.slice(at + BUS_PREFIX.length));
    return value && typeof value === "object" ? value : null;
  } catch { return null; }
}

/** Человеческое имя умения: канал перестаёт быть свалкой JSON. */
export const TOOL_NOTE = Object.freeze({
  __catalog: "список умений",
  __context: "что известно о человеке",
});

/** Где лежит здоровье моста: одно значение на все изоляты. */
export const BRIDGE_HEALTH_KEY = "heart:bridge:health";
/**
 * Ответ сестры приходит отдельным обновлением — постом в канале. Платформа
 * может отдать его другому изоляту, у которого своя память: тот, кто ждёт,
 * ответа не увидит. Поэтому ответ без ожидающего кладётся в базу, а
 * ожидающий туда заглядывает.
 */
export const ANSWER_PREFIX = "heart:bridge:a:";
/** Вопрос, который перестал ждать: опоздавший ответ ещё пригодится. */
export const ASKED_PREFIX = "heart:bridge:q:";
/** Что сестра говорила о человеке: запас на случай её молчания. */
export const FACTS_PREFIX = "heart:bridge:facts:";
/** Сколько вчерашний ответ годится как запас. */
export const STALE_OK_MS = 24 * 3600_000;
/**
 * Допуск на часы. Конверт годен, пока время в нём и часы получателя расходятся
 * не больше срока. Срок был минутой — и 15.11.2026 этого не хватило: часы
 * запуска Аи спешили на три минуты (в конверте 23:07:33, Telegram поставил на
 * сообщение 23:04), сестра ответила «expired», а мост закрылся как «молчащий».
 * Часы платформы у разных запусков разные, поэтому срок вопроса — десять минут
 * (больше конверт не позволяет), и с тем же допуском читаются ответы и события.
 * От повтора защищает не срок, а одноразовый `id`: его помнят сутки.
 */
export const CLOCK_SLACK_MS = 600_000;
/**
 * На платформе таймеров нет: дождаться ответа сестры в том же обращении почти
 * никогда не выйдет — он приходит отдельным обновлением через секунду-другую.
 * Тогда вопрос считается «в пути»: столько ждём опоздавший ответ, прежде чем
 * назвать это молчанием, и столько же не задаём новых вопросов.
 */
export const LATE_OK_MS = 15_000;
/** Сколько раз заглянуть в базу за ответом там, где ждать нечем. */
export const POLLS_WITHOUT_TIMERS = 40;

export function createAbilities({ secret = "", channelId = "", api = null, send = null, now = () => Date.now(), ttl = CLOCK_SLACK_MS, store = null, name = "Аи", sister = "Юи", timeouts = {}, onSilence = null, onClock = null, tidy = true } = {}) {
  const bridge = createBridge({ secret, capabilities: { call: async () => ({ ok: false }) }, now, slack: CLOCK_SLACK_MS });
  const canStore = Boolean(store) && store.available !== false && typeof store.get === "function" && typeof store.set === "function";
  // `quick` — сколько ждать сестру, когда вчерашний ответ уже есть в запасе.
  const wait = { call: 20_000, catalogue: 15_000, context: 12_000, quick: 2_500, ...Object.fromEntries(Object.entries(timeouts ?? {}).filter(([, ms]) => Number.isFinite(ms) && ms > 0)) };

  /**
   * Предохранитель. Сестра может молчать — её бот выключен, не добавлен в
   * канал или упал. Раньше каждое сообщение человека ждало её ответа заново:
   * двенадцать секунд на вопрос о правах и ещё двенадцать на паузу. Теперь
   * первый пропущенный ответ закрывает мост на две минуты, следующий — на
   * четыре, и так до получаса; любой пришедший ответ открывает его сразу.
   * Состояние лежит в базе: изолят может смениться между двумя сообщениями.
   */
  let health = null;
  let healthAt = 0;
  async function readHealth({ fresh = false } = {}) {
    if (!fresh && health && (health.until > now() || now() - healthAt < 60_000)) return health;
    let saved = null;
    try { saved = store && typeof store.get === "function" ? await store.get(BRIDGE_HEALTH_KEY) : null; } catch { saved = null; }
    // Нет записи в базе — остаётся то, что помнит изолят: счёт пропусков не
    // должен обнуляться только потому, что базы нет или она не ответила.
    // `waiting` — час, когда ушёл вопрос, ответа на который ещё ждут (там, где нет таймеров).
    if (saved && typeof saved === "object") health = { until: Number(saved.until) || 0, failures: Number(saved.failures) || 0, since: Number(saved.since) || 0, waiting: Number(saved.waiting) || 0 };
    else health ??= { until: 0, failures: 0, since: 0, waiting: 0 };
    healthAt = now();
    return health;
  }
  async function writeHealth() {
    try { if (store && typeof store.set === "function") await store.set(BRIDGE_HEALTH_KEY, health); } catch { /* останется в памяти изолята */ }
  }
  async function missed() {
    const state = await readHealth();
    state.failures += 1;
    state.waiting = 0;
    if (!state.since) state.since = now();
    state.until = now() + Math.min(30, 2 ** Math.min(state.failures, 5)) * 60_000;
    await writeHealth();
    if (typeof onSilence === "function") {
      try { await onSilence({ failures: state.failures, since: state.since, until: state.until }); } catch { /* отчёт не должен ломать ответ */ }
    }
  }
  async function answered() {
    const state = await readHealth();
    if (!state.failures && !state.until && !state.waiting) return;
    state.failures = 0; state.until = 0; state.since = 0; state.waiting = 0;
    await writeHealth();
  }
  /** Мост настроен, но сестра сейчас не отвечает: спрашивать бессмысленно. */
  async function silent() {
    return (await readHealth()).until > now();
  }
  const open = () => bridge.enabled && String(channelId ?? "") !== "" && String(channelId) !== "0";
  const pending = new Map();
  /** `chatType:actor` → { at, tools }. Bounded below. */
  const catalogCache = new Map();
  const contextCache = new Map();
  /** `chat:actor` → обещание: одновременные вопросы не дублируют конверт. */
  const inflightContext = new Map();

  async function post(line) {
    if (typeof send === "function") return send(line);
    if (!api || typeof api.sendMessage !== "function") throw Error("bridge_not_connected");
    return api.sendMessage({ chat_id: channelId, text: line, disable_web_page_preview: true });
  }

  /**
   * Убрать за собой. Канал моста — провод, а не журнал: вопрос, на который
   * пришёл ответ (или которого не дождались), в нём больше не нужен. Свои посты
   * бот удаляет с правом публикации; чужие — только с правом удалять. Возвращает
   * true, если сообщения больше нет.
   */
  async function clean(messageId) {
    if (!tidy || messageId == null || !api || typeof api.deleteMessage !== "function") return false;
    try { await api.deleteMessage({ chat_id: channelId, message_id: messageId }); return true; }
    catch { return false; }
  }
  /** Часы разошлись сильнее допуска: об этом узнаёт владелец — словами, а не из JSON в канале. */
  async function clockTrouble(seconds, who) {
    if (typeof onClock !== "function") return;
    try { await onClock({ seconds: Math.round(Math.abs(Number(seconds) || 0)), who }); } catch { /* отчёт не должен ломать ответ */ }
  }

  /**
   * Ждать ответа там, где таймеров нет: заглядывать в базу, пока не выйдет срок
   * или число попыток. Каждый запрос к базе — настоящий ввод-вывод, на нём
   * обращение и «стоит»; пустого цикла здесь нет.
   */
  async function pollAnswer(id, timeout, here) {
    const deadline = now() + timeout;
    for (let attempt = 0; attempt < POLLS_WITHOUT_TIMERS && canStore; attempt++) {
      const got = here();
      if (got) return got;
      let saved = null;
      try { saved = await store.get(ANSWER_PREFIX + id); } catch { saved = null; }
      if (saved?.result) {
        try { await store.remove(ANSWER_PREFIX + id); } catch { /* сметёт уборка */ }
        return saved.result;
      }
      if (now() >= deadline) break;
    }
    const got = here();
    if (got) return got;
    throw Object.assign(Error("bridge_timeout"), { code: "bridge_timeout" });
  }

  /** Seal one call, post it, and wait for the signed answer. */
  async function call(tool, { actor = null, chat = null, chatType = null, args = {}, timeout = wait.call, lateKey = "" } = {}) {
    if (!open()) return { ok: false, code: "bridge_not_configured", text: "" };
    if (await silent()) return { ok: false, code: "bridge_silent", text: "" };
    // Таймеров нет (так на платформе): ответ придёт отдельным обновлением, позже.
    // Пока прошлый вопрос «в пути», новых не задаём; не пришёл за срок — это молчание.
    const timed = hasTimers();
    if (!timed) {
      const state = await readHealth({ fresh: true });
      if (state.until > now()) return { ok: false, code: "bridge_silent", text: "" };
      if (state.waiting) {
        if (now() - state.waiting < LATE_OK_MS) return { ok: false, code: "bridge_waiting", text: "" };
        await missed();
        return { ok: false, code: "bridge_silent", text: "" };
      }
    }
    const sealed = await bridge.seal({ tool, args, actor, chat, chatType, ttl });
    if (!sealed.ok) return { ok: false, code: sealed.code, text: "" };
    const id = String(sealed.envelope.id);

    let settled = false;
    let poll = null;
    let timer = null;
    // Ответ, который пришёл в этот же изолят, пока обращение опрашивает базу.
    let arrived = null;
    const answer = new Promise((resolve, reject) => {
      pending.set(id, { resolve: (value) => { if (settled) return; settled = true; cancel(timer); cancel(poll); arrived = value; resolve(value); } });
      if (timed) {
        timer = later(() => {
          settled = true; cancel(poll); pending.delete(id);
          reject(Object.assign(Error("bridge_timeout"), { code: "bridge_timeout" }));
        }, timeout);
      }
    });

    const label = TOOL_NOTE[tool] ?? String(tool ?? "").slice(0, 32);
    const note = `🤍 ${name} → ${sister} · ${label}${chat != null ? ` · чат ${chat}` : ""}`;
    let asked = null;
    try { asked = await post(encodeEnvelope(sealed.envelope, note)); }
    catch {
      // Вопрос не ушёл: ждать нечего, и таймер не должен сработать впустую.
      settled = true; cancel(timer); cancel(poll); pending.delete(id);
      return { ok: false, code: "bridge_send_failed", text: "" };
    }

    // Ответ мог прийти обработчику канала в другом изоляте: он положил его в
    // базу. Заглядываем туда всё реже, пока ждём.
    if (timed && canStore) {
      let delay = 200;
      const look = () => {
        poll = later(async () => {
          if (settled) return;
          let saved = null;
          try { saved = await store.get(ANSWER_PREFIX + id); } catch { saved = null; }
          if (settled) return;
          if (saved?.result) {
            const waiter = pending.get(id);
            pending.delete(id);
            waiter?.resolve(saved.result);
            try { await store.remove(ANSWER_PREFIX + id); } catch { /* сметёт уборка */ }
            return;
          }
          delay = Math.min(Math.round(delay * 1.6), 1500);
          look();
        }, delay);
      };
      look();
    }

    try {
      const result = timed ? await answer : await pollAnswer(id, timeout, () => arrived);
      pending.delete(id);
      await answered();
      // Сестра ответила, но отказом «срок вышел»: её часы и время в вопросе разошлись больше допуска.
      if (result?.ok === false && result.code === "expired") await clockTrouble(((Number(result.ts) || now()) - Number(sealed.envelope.ts)) / 1000, "sister");
      return result;
    } catch (error) {
      pending.delete(id);
      if (timed) {
        // Молчание — это факт о сестре, а не о вопросе: запоминаем его.
        await missed();
      } else {
        // Ждать было нечем: вопрос «в пути». Молчанием это станет, если ответ не придёт и позже.
        const state = await readHealth();
        state.waiting = now();
        await writeHealth();
      }
      if (lateKey && canStore) await adoptLater(id, lateKey);
      return { ok: false, code: error.code ?? "bridge_timeout", text: "" };
    } finally {
      // Дождались или нет — вопрос из канала убирается.
      await clean(asked?.message_id);
    }
  }

  /** Записать, что сестра сказала о человеке: и в память изолята, и в базу. */
  async function keepFacts(cacheKey, value, at = now()) {
    contextCache.set(cacheKey, { at, value });
    if (contextCache.size > 128) for (const [key, item] of contextCache) if (now() - item.at > 600_000) contextCache.delete(key);
    if (canStore) { try { await store.set(FACTS_PREFIX + cacheKey, { value, at }); } catch { /* останется в памяти изолята */ } }
  }

  /**
   * Вопрос перестал ждать, но ответ ещё может прийти. Оставляем записку, чей
   * это был вопрос: опоздавший ответ обновит запись о человеке, и следующая
   * реплика получит факты без ожидания.
   */
  async function adoptLater(id, cacheKey) {
    try {
      await store.set(ASKED_PREFIX + id, { key: cacheKey, at: now() });
      // Ответ мог лечь в базу между последней проверкой и этой записью.
      const landed = await store.get(ANSWER_PREFIX + id);
      if (landed?.result?.ok && landed.result.data && typeof landed.result.data === "object") {
        await keepFacts(cacheKey, landed.result.data);
        await store.remove(ANSWER_PREFIX + id);
        await store.remove(ASKED_PREFIX + id);
      }
    } catch { /* запас не важнее ответа */ }
  }

  /**
   * Feed a channel post. Returns true when it was a signed answer of the
   * sister: for a question waiting here, for a question waiting in another
   * isolate, or for one that has already stopped waiting.
   */
  async function onPost(text) {
    const envelope = decodeEnvelope(text);
    // Ответ отличается от вопроса полем `ok`: вопросы (в том числе свои) — мимо.
    if (!envelope?.sig || typeof envelope.ok !== "boolean") return false;
    const verified = await bridge.verifyResult(envelope);
    if (!verified.ok) {
      // Подпись верна, а время не сходится даже с допуском: это часы, а не подделка.
      if (verified.code === "expired") await clockTrouble(Number(verified.age) / 1000, "self");
      return false;
    }
    const id = String(envelope.id);
    const result = { ...verified.result, data: verified.result.data, ts: Number(envelope.ts) || 0 };
    const waiter = pending.get(id);
    if (waiter) {
      pending.delete(id);
      waiter.resolve(result);
      return true;
    }
    if (!canStore) return false;
    try {
      const asked = await store.get(ASKED_PREFIX + id);
      if (asked?.key) {
        if (result.ok && result.data && typeof result.data === "object") await keepFacts(String(asked.key), result.data);
        await store.remove(ASKED_PREFIX + id);
        await answered();
        return true;
      }
      await store.set(ANSWER_PREFIX + id, { result, at: now() });
      // Подписанный ответ пришёл — сестра жива, даже если спросивший его уже не ждёт.
      await answered();
      return true;
    } catch { return false; }
  }

  /**
   * What the other bot says it can do, scoped to this role. Cached.
   *
   * `ok` is the important half: a refused or unanswered catalogue used to come
   * back as an empty list, and the heart then told the person "этого нет в этом
   * чате". That is a guess dressed as a fact. Now silence is named as silence.
   */
  async function catalogue({ actor = null, chat = null, chatType = null, ttlMs = 600_000 } = {}) {
    if (!open()) return { ok: false, code: "bridge_closed", tools: [] };
    // Кэш по паре «тип чата + человек»: список зависит и от места, и от роли.
    // Общий кэш показывал игроку умения владельца, а владельцу — только личные.
    const key = `${chatType ?? "any"}:${actor ?? "any"}`;
    const cached = catalogCache.get(key);
    if (cached && now() - cached.at < ttlMs && cached.tools.length) return { ok: true, code: "ok", tools: cached.tools };
    const result = await call(CATALOG_TOOL, { actor, chat, chatType, timeout: wait.catalogue });
    if (result.ok && Array.isArray(result.data)) {
      const tools = result.data.filter(tool => tool && tool.name);
      catalogCache.set(key, { at: now(), tools });
      if (catalogCache.size > 64) for (const [k, item] of catalogCache) if (now() - item.at > ttlMs) catalogCache.delete(k);
      return { ok: true, code: "ok", tools };
    }
    return { ok: false, code: result.code ?? "bridge_no_answer", tools: cached?.tools ?? [] };
  }

  /** The list alone, for callers that only need it. */
  async function catalog(options = {}) {
    return (await catalogue(options)).tools;
  }

  /**
   * Что сестра знает о человеке: роль, VIP, варны. Кэш короткий — минута.
   * Права меняются: снятый админ не должен ещё десять минут разговаривать с
   * сердцем как админ. Минуты хватает, чтобы серия сообщений не гоняла запрос
   * по каналу на каждое слово.
   */
  async function context({ actor = null, chat = null, chatType = null, ttlMs = 60_000 } = {}) {
    if (!open()) return null;
    // Тип чата нормализуется: «private» и «не указан» — один и тот же вопрос,
    // а раньше это были две разные записи кэша и два запроса в канал.
    const place = chatType === "private" ? "private" : "group";
    const cacheKey = `${place}:${chat}:${actor}`;
    const cached = contextCache.get(cacheKey);
    if (cached && now() - cached.at < ttlMs) return cached.value;
    // Один вопрос — один конверт, даже если его одновременно спросили два
    // места: профиль ответа и пауза между ответами спрашивают об одном и том же.
    if (inflightContext.has(cacheKey)) return inflightContext.get(cacheKey);
    const task = (async () => {
      // Что сестра говорила раньше. Свежее — готовый ответ (его мог получить
      // другой изолят); вчерашнее — запас: человек не должен ждать сестру.
      let saved = null;
      if (canStore) { try { saved = await store.get(FACTS_PREFIX + cacheKey); } catch { saved = null; } }
      const age = saved?.at ? now() - Number(saved.at) : Infinity;
      if (saved && age < ttlMs && saved.value && typeof saved.value === "object") {
        contextCache.set(cacheKey, { at: Number(saved.at), value: saved.value });
        return saved.value;
      }
      const stale = saved && age < STALE_OK_MS && saved.value && typeof saved.value === "object" ? saved.value : null;
      // Сестра молчит — ответ строится на запасе или без её фактов: ждать нечего.
      if (await silent()) return stale;
      const result = await call(CONTEXT_TOOL, {
        actor, chat, chatType: place, lateKey: cacheKey,
        timeout: stale ? Math.min(wait.context, wait.quick) : wait.context,
      });
      if (!result.ok) return stale;
      const value = result.data && typeof result.data === "object" ? result.data : {};
      await keepFacts(cacheKey, value);
      return value;
    })().finally(() => inflightContext.delete(cacheKey));
    inflightContext.set(cacheKey, task);
    return task;
  }

  /**
   * Живая проба: один настоящий вопрос сестре в обход запасов. Для «статуса»
   * владельца: «мост открыт» — это настройка, «ответила за 400 мс» — факт.
   */
  async function ping({ actor = null, chat = null, chatType = "private", timeout = 4000 } = {}) {
    if (!open()) return { ok: false, code: "bridge_closed", ms: 0 };
    const started = now();
    const sealed = await call(CONTEXT_TOOL, { actor, chat, chatType: chatType === "private" ? "private" : "group", timeout });
    return { ok: sealed.ok === true, code: sealed.code ?? (sealed.ok ? "ok" : "no_answer"), ms: now() - started };
  }

  /** Уборка: ответы и записки, которых никто не дождался. */
  async function sweep() {
    if (!canStore || typeof store.sweep !== "function") return;
    try {
      await store.sweep(ANSWER_PREFIX, 3600_000);
      await store.sweep(ASKED_PREFIX, 3600_000);
      await store.sweep(FACTS_PREFIX, 7 * 24 * 3600_000);
    } catch { /* уборка подождёт */ }
  }

  /** Verification of an incoming envelope, for anything else that listens. */
  async function verify(envelope) {
    try { return await bridge.verify(envelope); }
    catch { return { ok: false, code: "crypto_unavailable" }; }
  }

  /** Здоровье моста одной записью: для /status и для отчёта владельцу. */
  async function healthState() {
    const state = await readHealth();
    return { silent: state.until > now(), until: state.until, since: state.since, failures: state.failures, waiting: state.waiting > 0 && now() - state.waiting < LATE_OK_MS, timers: hasTimers() };
  }

  return Object.freeze({ open, call, onPost, catalog, catalogue, context, verify, silent, ping, sweep, clean, health: healthState, decode: decodeEnvelope, bridge });
}

/**
 * Phrase → tool. Deliberately short and literal: the model words an answer, it
 * never chooses an action. If the abilities bot has not announced the tool, the
 * heart says the feature is not connected instead of pretending.
 */
export const PHRASES = Object.freeze([
  // Одно слово — тоже просьба. «Профиль», набранный без «покажи», раньше
  // уходил к модели, и та придумывала роль и данные; это дороже молчания.
  { tool: "profile", test: /^(?:(?:покажи|открой|мой|посмотреть)\s+)?профил[ья]?$/iu },
  { tool: "info", test: /^(?:(?:покажи|что)\s+)?(?:об|про)\s+(?:этом|нём|нем|участнике)/iu },
  { tool: "quests", test: /^(?:(?:покажи|мои)\s+)?(?:квесты|задания)$/iu },
  { tool: "warns", test: /^(?:(?:мои|покажи)\s+)?(?:варны|предупреждения)$/iu },
  { tool: "report", test: /^(?:пожаловаться|жалоба|обращение)$/iu },
]);

/**
 * Живая речь не совпадает с образцом буква в букву: «покажи мне профиль» и
 * «мой профиль» — та же просьба, что «покажи профиль». Раньше они уходили к
 * модели, а модель на вопрос о профиле придумывала роль, ID и уровень. Одно
 * лишнее слово не должно превращать факт в выдумку.
 */
const FILLER = /(?:^|\s)(?:пожалуйста|плиз|мне|мой|мою|моя|мои|моё|мое)(?=\s|$)/giu;

export function matchPhrase(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  for (const phrase of PHRASES) if (phrase.test.test(raw)) return phrase.tool;
  // Запятые и точки — тоже шум: «покажи, пожалуйста, профиль».
  const value = raw.replace(/[,.!?;:]/gu, " ").replace(FILLER, " ").replace(/\s+/gu, " ").trim();
  if (!value) return null;
  for (const phrase of PHRASES) if (phrase.test.test(value)) return phrase.tool;
  return null;
}
