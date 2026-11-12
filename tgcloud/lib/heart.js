import { CONFIG } from "./config.js";
import { AI_API_KEY, OWNER_TG_ID as OWNER_FROM_SECRET, AI_EXTRA_KEYS } from "./secrets.js";
import { createAiService, DEFAULT_AI_BASE_URL, describeProviderFailure } from "./ai-service.js";
import { buildCharacterProfile, promptTier } from "./ai-character.js";
import { createDialoguePolicy } from "./dialogue-policy.js";
import { createHeartStore } from "./store.js";
import { createAbilities, matchPhrase, BUS_PREFIX } from "./abilities.js";
import { createEvents } from "./events.js";
import { describeSister, missingAbilityText, plural } from "./sibling.js";
import { createNotices } from "./notices.js";
import { createPersonal, addressRequest, lengthRequest, formRequest } from "./personal.js";
import { createMemory } from "./memory.js";
import { parseIntent, normalize, ABILITY_OF, SPOKEN_HELP, INTENTS } from "./intents.js";
import { createBrains } from "./brains.js";
import { createLessons } from "./lessons.js";
import { createPulse } from "./pulse.js";
import { createQueue } from "./queue.js";
import { parseCommand, mentions, stripMention, vocative, isReplyToMe, safeName } from "./address.js";
import { calendarDate, localHour, localClock, nowLine, dayLine, localParts, validTimeZone } from "./time.js";
import { createReminders, parseReminder, REPEAT_LABEL } from "./reminders.js";
import { createSources, detectSource, factQuery, parseTarget, knownCity } from "./sources.js";
import { calculate } from "./calc.js";
import { createGames } from "./games.js";
import { parsePicture, moodOf, answerMoods, shelfOf, pickSticker } from "./pictures.js";
import { createFun, parseChatSetting, parseQuiet, parseQuestion } from "./fun.js";
import { createNotes, parseNote } from "./notes.js";
import { createParty, parseParty, PARTY_PREFIX } from "./party.js";
import { parsePoll } from "./polls.js";
import { parseWhois } from "./whois.js";
import { createMedia, parseMedia, captions } from "./media.js";

/**
 * Сколько ждать между двумя запросами к провайдеру.
 *
 * VIP — это подтверждённый сестрой факт (`vip: true`), а не слово «VIP» в
 * роли или в переписке. Нет моста — нет факта, значит обычная пауза: сердце
 * не ускоряется по обещанию с витрины.
 */
/**
 * Вопросы, ответ на которые существует только в базе возможностей: профиль,
 * роль, уровень, ID, VIP, варны. Модель не должна отвечать на них даже при
 * пустом мосте — она не знает и выдумает.
 */
export const FACT_QUESTION = /^(?:(?:покажи|открой|скажи|что|какой|какая|каково|сколько)\s+)*(?:(?:у\s+меня|мне|мой|моя|мою|мои)\s+)*(?:профил[ья]?|карточк[ауи]|роль|уровень|варны|предупреждени[яй]|vip|id|ид)(?:[\s,.!?;:]|$)/iu;

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
/**
 * Сборка сердца. Её видно в /status, потому что «я запушил» и «оно работает» —
 * разные факты: 8–10 ноября код лежал в репозитории, а живой бот отвечал
 * старым. Без этой строки проверить, что именно запущено, было нечем.
 * С 0.21.0 сердце говорит о новой сборке само — первым же сообщением; с 0.22.0
 * — сразу после публикации, не дожидаясь, пока ей кто-нибудь напишет.
 */
export const BUILD = "0.22.0";

/** Что изменилось в этой сборке — словами для владельца, не списком коммитов. */
export const RELEASE_NOTES = Object.freeze([
  "слушаюсь вас: ваши правила принимаю без оговорок, даже о прежних границах; чужие — по-прежнему спрашиваю у вас",
  "напоминаю: «напомни через час …», «напоминай по будням в 8 …», «буди меня в 7» (утро с погодой и делами), «капсула времени на год: …»",
  "узнаю сама, без модели: погода, курс ЦБ, пересчёт валют, точный счёт, время и дни до даты, «вики …»; на «что такое …» отвечаю по справке из Википедии",
  "играю, и судья — код: города, слова, угадай число, быки и коровы, виселица, «5 букв», загадки, анаграммы, фильм по эмодзи, камень-ножницы-бумага, кубик, монетка, «выбери за меня»",
  "показываю: «покажи котика», «как выглядит …», жесты гифкой; на стикер отвечаю стикером из того же набора",
  "слышу канал моста и просыпаюсь без сообщений — от будильника; публикуюсь сама при слиянии в main и сразу пишу, что обновилась",
  "запасные мозги: Experiential Labs и GigaChat подключаются ключом; «проверь мозги» пробует каждую модель; о лимите на исходе говорю заранее",
  "чужое письмо вам — только по просьбе: «передай хозяину: …»; ваш ответ на него отношу автору",
  "длинный ответ шлю частями; у каждого собеседника дневной предел разговора, чтобы мыслей хватало всем",
]);

const DAY = 86_400_000;

/** Только благодарность — на неё отвечают теплом, а не абзацем от модели. */
const THANKS_ONLY = /^(?:спасибо(?:\s+(?:большое|огромное|тебе|вам))?|благодарю|спс|пасиб(?:о|ки)?|мерси|thanks|thx|ты\s+лучшая|умница)[\s!.)]*$/iu;
const THANKS = /(?:^|[\s,])(?:спасибо|благодарю|спс|пасиб|мерси)(?=$|[\s,.!)])/iu;
/** Короткое «принято»: ответом будет реакция, а не запрос к модели. */
const ACK_ONLY = /^(?:ок(?:ей)?|ok|okay|угу|ага|ясно|понятно|понял[аи]?|хорошо|ладно|договорились|принято|супер|отлично|класс|круто|лол|кек|а?(?:ха){2,}х?|а?хах|\)+)[\s!.)]*$/iu;
const LAUGH = /^(?:лол|кек|а?(?:ха){2,}х?|а?хах|\)\)+)[\s!.)]*$/iu;
const RUDE = /(?:^|[\s,])(?:дура|тупица|идиотка|заткнись|завались|отвали|ненавижу\s+тебя|ты\s+(?:тупая|глупая|никч[её]мная|бесполезная)|пош(?:ла|[её]л)\s+(?:ты\s+)?(?:на|в)\s*\S+)(?=$|[\s,.!?])/iu;
const APOLOGY = /(?:^|[\s,])(?:прости|простите|извини|извините|извиняюсь|сорян|сорри|sorry|виновата?)(?=$|[\s,.!])/iu;
/** Человек поправляет её ответ: это сигнал ошибки и повод для урока. */
const CORRECTION = /^(?:нет[,.!\s]|неа[,.!\s]|не\s+так|не\s+то[,.!\s]|неправильно|неверно|ты\s+(?:ошиблась|ошибаешься|не\s+права|путаешь|перепутала)|вы\s+(?:ошиблись|ошибаетесь|не\s+правы)|это\s+(?:не\s+так|неправда|неверно|ошибка)|на\s+самом\s+деле|вообще-то|поправлю)/iu;
/** Она сама призналась, что не знает: вопрос уходит в список «спросить у хозяина». */
const UNSURE = /(?:^|[\s,])(?:не\s+знаю|не\s+уверена|нет\s+данных|не\s+располагаю|мне\s+неизвестно|не\s+могу\s+сказать\s+точно)(?=$|[\s,.!])/iu;
const YES = /^(?:да|ага|принять|прими|принимаю|ок|ok|хорошо|верно|согласен|согласна|\+)[\s!.]*$/iu;
const NO = /^(?:нет|неа|отклонить|отклони|не\s+надо|не\s+нужно|-)[\s!.]*$/iu;

/** Что прислали, если это не текст. Служебные сообщения — «ничего». */
function senseOf(message = {}) {
  if (typeof message.text === "string" && message.text.trim()) return "text";
  const media = message.sticker ? "sticker" : message.animation ? "gif" : message.voice || message.video_note || message.audio ? "voice"
    : message.photo ? "photo" : message.video ? "video" : message.document ? "file" : "";
  if (!media) return "none";
  return typeof message.caption === "string" && message.caption.trim() ? `${media}+caption` : media;
}

const MEDIA_WORD = Object.freeze({ photo: "фото", video: "видео", file: "файл", voice: "голосовое", gif: "гифку", sticker: "стикер" });

export function createHeart({ db = null, api = null, fetchImpl = null, now = () => Date.now(), config = CONFIG, random = Math.random } = {}) {
  const store = createHeartStore({ db, now });
  // A deployment that predates these keys still gets sensible names, never
  // "undefined" in a sentence addressed to a person.
  const NAME = config.NAME ?? "Аи";
  const SISTER = config.SISTER_NAME ?? "Юи";
  const SISTER_USERNAME = config.SISTER_BOT_USERNAME ?? "";
  const TZ = config.TIME_ZONE;
  const dayOf = (at) => calendarDate(at, TZ);
  const clock = (at) => localClock(at, TZ);
  /**
   * Куда уходит жалоба. Владелец — из config (0 значит «не задан»): сердце не
   * угадывает, кому писать, и не выдаёт себя за хозяина первого, кто написал.
   */
  // Владелец: сначала config (0 — не задан), затем слот, который заполняется
  // из GitHub-секрета только на время публикации.
  const OWNER = Number(config.OWNER_TG_ID) || Number(OWNER_FROM_SECRET) || 0;
  const owner = (id) => OWNER > 0 && String(id) === String(OWNER);
  const has = (method) => typeof api?.[method] === "function";

  const notices = createNotices({
    store,
    ownerId: OWNER,
    now,
    // Результат возвращается: по номеру сообщения узнаётся ответ владельца.
    send: async (chatId, text) => api.sendMessage({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  const pulse = createPulse({ store, now, dayOf });
  const lessons = createLessons({ store, now, ownerId: OWNER });
  const queue = createQueue({ store, now });
  const reminders = createReminders({ store, now });
  // То, что она узнаёт не из модели: вики, погода, курс, свои списки.
  const sources = createSources({ fetchImpl, store, now });
  // Игры судит код: загаданное лежит в базе, а не в памяти модели.
  const games = createGames({ store, sources, random, now });
  // Поиск картинок, аниме, музыки и видео: открытые источники, без модели.
  const media = createMedia({ sources });
  // Списки, цели и дневник: строки человека, которые возвращаются дословно.
  const notes = createNotes({ store, now, dayOf });
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
    brains_exhausted: "все модели упёрлись в лимит",
  });

  const bridgeWait = Number(config.ABILITIES_TIMEOUT_MS);
  const abilities = createAbilities({
    secret: config.ABILITIES_SECRET,
    channelId: config.ABILITIES_CHANNEL_ID,
    api,
    now,
    store,
    name: NAME,
    sister: SISTER,
    timeouts: Number.isFinite(bridgeWait) && bridgeWait > 0 ? { call: bridgeWait, catalogue: bridgeWait, context: bridgeWait } : {},
    // Сестра промолчала: владелец узнаёт об этом сам и один раз, а не из
    // того, что каждый ответ стал приходить через полминуты.
    onSilence: async ({ until }) => {
      pulse.bump("bridge_missed");
      await notices.report({
        component: "bridge", code: "silent", severity: "degraded",
        detail: `${SISTER} не ответила на мосту. Отвечаю сама и не жду её до ${clock(until)}`,
      });
    },
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

  const personal = createPersonal({ store, now, dayOf });
  // Факты, которые человек попросил запомнить словами. Модель их не пишет:
  // «запомни …» — это прямое действие, а не тема для разговора.
  const memory = createMemory({ store, now });

  /**
   * Отношения принадлежат сердцу, и только ему.
   *
   * Раньше файл политики лежал рядом и не вызывался: симпатия, доверие,
   * первое впечатление и охлаждение считались, но в ответ не попадали, а
   * экран отношений у сестры читал чужую базу. Теперь единственный источник —
   * `ai:relationship:*` здесь, и он же решает, как звучит ответ.
   */
  const policy = store.available ? createDialoguePolicy({ store, ownerId: OWNER, now, random }) : null;

  const extraKeys = AI_EXTRA_KEYS && typeof AI_EXTRA_KEYS === "object" ? AI_EXTRA_KEYS : {};
  const brains = createBrains({
    store, now,
    primary: config.AI_MODEL,
    fallbacks: Array.isArray(config.AI_MODELS) ? config.AI_MODELS : [],
    baseUrl: DEFAULT_AI_BASE_URL,
    providers: (Array.isArray(config.AI_PROVIDERS) ? config.AI_PROVIDERS : []).map(item => ({ ...item, key: item?.key ?? extraKeys[item?.id] ?? "" })),
  });

  /**
   * Что сердце знает о манере разговора с человеком: «вы» или «ты», насколько
   * близко, что он просил. С хозяином — всегда на «вы»; с остальными «ты»
   * приходит с теплом отношений или по прямой просьбе.
   */
  async function mannerFor(userId, { dry = false } = {}) {
    const settings = (await personal.settings(userId).catch(() => ({}))) ?? {};
    if (owner(userId)) return { formal: true, score: 100, trust: 100, respect: 100, blocked: false, settings };
    let state = { score: 0, trust: 0, respect: 0, blocked: false };
    // Репетиция только читает: якорь остывания в ней не ставится.
    if (policy) { try { state = await policy.state(userId, { initialize: !dry }); } catch { /* без записей — как с незнакомым */ } }
    const formal = settings.form === "вы" ? true : settings.form === "ты" ? false : state.score < 25;
    return { formal, score: state.score, trust: state.trust, respect: state.respect, blocked: Boolean(state.blocked), settings };
  }

  /** То, что уже прочитано для этого сообщения: профиль ответа не читает базу дважды. */
  const inflight = new Map();
  /** Один вопрос сестре на реплику — и для характера, и для паузы. */
  const factsFor = ({ userId, chatId, isPrivate }) => chatId == null
    ? Promise.resolve(null)
    : abilities.context({ actor: userId, chat: chatId, chatType: isPrivate ? "private" : "group" }).catch(() => null);

  const ai = createAiService({
    fetchImpl,
    brains,
    // Числовой ID владельца не должен прозвучать ни в одном ответе.
    confidentialIds: OWNER > 0 ? [OWNER] : [],
    getApiKey: (ctx) => ctx?.env?.AI_PROVIDER_KEY ?? ctx?.env?.GROQ_API_KEY ?? AI_API_KEY,
    getModel: () => config.AI_MODEL,
    loadHistory: store.memory.load,
    saveHistory: store.memory.save,
    clearHistory: store.memory.clear,
    additionalContext: async ({ userId, chatId = null, isPrivate = true }) => {
      // Память знает место: в группе звучит только сказанное при всех.
      const items = (await memory.list(userId, { inGroup: !isPrivate })).slice(-10);
      const shared = inflight.get(`${chatId}:${userId}`);
      if (shared) shared.facts = items.length;
      return items.length ? `Что известно о собеседнике:\n${items.map(item => `- ${item}`).join("\n")}` : "";
    },
    responseProfile: async ({ userId, chatId = null, isPrivate = true, prompt = "" }) => {
      const manner = inflight.get(`${chatId}:${userId}`)?.manner ?? await mannerFor(userId);
      // Отношения и первое впечатление — часть характера, а не отдельный экран.
      let impression = null;
      if (policy) { try { impression = await policy.impression(userId); } catch { impression = null; } }
      // Факты от сестры (VIP, роль, варны) — только если мост открыт; иначе
      // ответ строится на том, что сердце знает само.
      const facts = await factsFor({ userId, chatId, isPrivate });
      const character = buildCharacterProfile({
        settings: { ...manner.settings, address: manner.settings.address ?? "" }, isPrivate, now: now(),
        relationship: { score: manner.score, trust: manner.trust, respect: manner.respect },
        impression: impression ?? {},
        familiarBond: Boolean(facts?.owner) || owner(userId),
        // Хозяину она подчиняется — и только с ним, наедине, может заигрывать:
        // он взрослый и сам так решил. Остальным флирт по-прежнему закрыт.
        obey: owner(userId),
        character: owner(userId) && isPrivate ? { adult: true, flirt: "light" } : {},
        formal: manner.formal,
        userText: prompt,
        chatId: chatId ?? "",
      });
      const frames = rightsFrames(facts);
      return {
        tier: promptTier(prompt),
        instruction: [character.instruction, ...frames].join("\n"),
        core: [character.core, ...frames].join("\n"),
        // Длина и тон приходят из характера: раньше сюда попадали несуществующие
        // поля настроек, и запрос всегда уходил с 700 токенами и 0.7.
        temperature: character.temperature,
        maxTokens: character.maxTokens,
      };
    },
    // Получасовые токены провайдеров с обменом ключа переживают смену изолята.
    tokenStore: store.available ? { get: (key) => store.get(key), set: (key, value) => store.set(key, value) } : null,
    minimumIntervalMs: config.AI_MIN_INTERVAL_MS,
    // Перк «отвечает быстрее» действует только по подтверждённому статусу;
    // мост закрыт — работает обычная пауза, а не вера на слово. Тот же вопрос
    // и тот же тип чата, что в профиле ответа: один конверт, а не два.
    intervalFor: async ({ userId, chatId, isPrivate }) => pauseFor({ facts: await factsFor({ userId, chatId, isPrivate }), config }),
    now,
  });

  /**
   * Забавы: ролевые действия, приветствие новичков, опросы, «мой айди». Всё
   * это делается словом и ничего не стоит — поэтому живёт у неё, а не у сестры.
   */
  const fun = createFun({
    api, store, sources, policy, personal, pulse, random, now, owner, has, name: NAME,
    say: (turn, text, options) => say(turn, text, options),
    react: (turn, emoji) => react(turn, emoji),
    // «Придумай опрос про …»: одна реплика модели, без записи в переписку.
    compose: async (turn, text) => {
      if (await overQuota(turn)) return null;
      const { answer } = await talk(turn, text);
      return answer.ok && !answer.testRun ? answer.text : null;
    },
  });

  /**
   * Игры с кнопками: вдвоём и компанией. В игре только тот, кто нажал сам.
   */
  const party = createParty({
    api, store, random, now, has, pulse,
    isMinor: async (userId) => (await personal.settings(userId))?.minor === true,
  });

  /**
   * Where the provider key comes from, in order: the update context (tests and
   * a proxy), then the deploy-time slot. Never a default and never a guess.
   */
  async function resolveKey(ctx) {
    const fromContext = String(ctx?.env?.AI_PROVIDER_KEY ?? ctx?.env?.GROQ_API_KEY ?? "").trim();
    return fromContext || String(AI_API_KEY ?? "").trim();
  }

  /**
   * Кто она в Telegram: id и @имя. Нужны, чтобы отличить ответ на её сообщение
   * от ответа другому боту и свою команду от чужой. Спрашивается один раз и
   * хранится неделю; репетиция Telegram не трогает.
   */
  let me = null;
  async function whoAmI(dry = false) {
    if (me?.id != null) return me;
    const fallback = { id: null, username: String(config.BOT_USERNAME ?? "").replace(/^@/u, "") };
    const saved = await store.get("heart:me").catch(() => null);
    if (saved?.id != null && now() - Number(saved.at) < 7 * DAY) return (me = saved);
    if (dry || !has("getMe")) return saved?.id != null ? saved : fallback;
    try {
      const got = await api.getMe();
      if (got?.id != null) {
        me = { id: got.id, username: String(got.username ?? fallback.username), at: now() };
        await store.set("heart:me", me);
        return me;
      }
    } catch { /* без getMe остаётся имя из настроек */ }
    return saved?.id != null ? saved : fallback;
  }

  /**
   * Длинный текст — частями. Telegram не принимает сообщение длиннее 4096
   * знаков: раньше такой ответ не уходил вовсе. Режется по абзацу, затем по
   * фразе, затем по слову — никогда посреди слова.
   */
  function partsOf(text, limit = 3900) {
    const out = [];
    let rest = String(text ?? "");
    while (rest.length > limit) {
      const slice = rest.slice(0, limit);
      const floor = limit * 0.4;
      let at = slice.lastIndexOf("\n\n");
      if (at < floor) at = slice.lastIndexOf("\n");
      if (at < floor) at = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "), slice.lastIndexOf("… ")) + 1;
      if (at < floor) at = slice.lastIndexOf(" ");
      if (at < floor) at = limit;
      out.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) out.push(rest);
    return out.length ? out : [""];
  }

  // One place that sends, so every path reports the same shape: what was said,
  // and whether it reached Telegram at all.
  async function say(turn, text, { extra = {} } = {}) {
    // A test run proves the route without touching Telegram: the platform's own
    // contract, and the reason a green test cannot be mistaken for delivery.
    if (turn.dry) return { ok: true, text, side_effects: "none" };
    try {
      const [head, ...tail] = partsOf(text);
      const sent = await api.sendMessage({ chat_id: turn.chatId, text: head, ...turn.extra, ...extra });
      turn.delivered = true;
      // Продолжение идёт следом в ту же тему, но уже не «ответом»: цитата одна.
      const next = turn.extra?.message_thread_id != null ? { message_thread_id: turn.extra.message_thread_id } : {};
      for (const part of tail) await api.sendMessage({ chat_id: turn.chatId, text: part, ...next });
      return { ok: true, text, messageId: sent?.message_id ?? null, parts: 1 + tail.length };
    } catch {
      // Не дошло до человека — это поломка, а не настроение. Владелец узнает
      // сам, а собеседник всё равно получит текст в ответе ниже.
      try { await notices.report({ component: "telegram", code: "send_failed", detail: "сообщение не ушло в чат", severity: "degraded" }); } catch { /* отчёт не должен ломать ответ */ }
      return { ok: false, code: "send_failed", text };
    }
  }

  /** «Вы» или «ты» — одна фраза в двух формах. */
  const you = (turn, formal, familiar) => (turn.manner?.formal === false ? familiar : formal);

  /** Реакция вместо слов: «видела», «спасибо», «принято». Запрещена — значит нет. */
  async function react(turn, emoji) {
    if (turn.dry || turn.message?.message_id == null || !has("setMessageReaction")) return false;
    if (turn.manner?.settings?.reactions === false) return false;
    try {
      await api.setMessageReaction({ chat_id: turn.chatId, message_id: turn.message.message_id, reaction: [{ type: "emoji", emoji }] });
      pulse.bump("reactions");
      return true;
    } catch { return false; }
  }

  /** «Печатает…», пока модель думает: молчание в десять секунд похоже на поломку. */
  async function typing(turn) {
    if (turn.dry || !has("sendChatAction")) return;
    try {
      await api.sendChatAction({ chat_id: turn.chatId, action: "typing", ...(turn.extra.message_thread_id != null ? { message_thread_id: turn.extra.message_thread_id } : {}) });
    } catch { /* индикатор — не ответ */ }
  }

  /**
   * Список того, что сердце действительно делает. Составляется здесь, а не
   * моделью: на вопрос о помощи модель однажды перечислила /settings и
   * /feedback, которых нет, — и человек пошёл их вводить.
   */
  function helpLines(turn) {
    const lines = [
      `${NAME}. Что я умею:`,
      "",
      `• поговорить — ${you(turn, "пишите", "пиши")} как есть, без команд;`,
      turn.inGroup ? "• в группе — позвать по имени, @упоминанием или ответом на моё сообщение;" : "",
      "",
      "Сказать словами — я пойму:",
      ...SPOKEN_HELP,
    ];
    if (owner(turn.actorId) && turn.isPrivate) {
      lines.push("", "Для хозяина: «статус» (он же /status), «покажи уроки», «прими урок 3», «отклони урок 3», «откати уроки за сегодня».");
    }
    if (abilities.open()) {
      lines.push("", `${SISTER} рядом: профиль, задания, предупреждения и её игры — ${you(turn, "скажите", "скажи")} словами, я передам.`);
    }
    return lines.filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\n");
  }

  /**
   * Отношения — словами, а не таблицей. Числа нужны коду (VIP, тон, частота
   * ответов), человеку нужен ответ на вопрос «как ты ко мне относишься».
   */
  function relationshipText({ score = 0, trust = 0, respect = 0 } = {}, formal = true) {
    const level = score >= 75 ? "close" : score >= 25 ? "warm" : score >= -25 ? "first" : "cold";
    const said = formal ? {
      close: "Между нами настоящая близость. Я замечаю, когда вас долго нет, и радуюсь, когда вы возвращаетесь.",
      warm: "Вы мне нравитесь. Мне спокойно и интересно с вами, и я замечаю больше, чем говорю вслух.",
      first: "Мы ещё присматриваемся друг к другу. Я помню то, что вы просили запомнить, и не притворяюсь, будто знаю больше.",
      cold: "Между нами прохладно, и я не стану это скрывать. Но я не мщу и не унижаю: разговор остаётся честным.",
    } : {
      close: "Между нами настоящая близость. Я замечаю, когда тебя долго нет, и радуюсь, когда ты возвращаешься.",
      warm: "Ты мне нравишься. Мне спокойно и интересно с тобой, и я замечаю больше, чем говорю вслух.",
      first: "Мы ещё присматриваемся друг к другу. Я помню то, что обещала помнить, и не притворяюсь, будто знаю больше.",
      cold: "Между нами прохладно, и я не стану это скрывать. Но я не мщу и не унижаю: разговор остаётся честным.",
    };
    const detail = [
      trust >= 50 ? (formal ? "Я вам доверяю." : "Я тебе доверяю.") : trust <= -25 ? "Доверия пока мало." : "",
      respect >= 50 ? (formal ? "И уважаю то, что вы делаете." : "И уважаю то, что ты делаешь.") : "",
    ].filter(Boolean).join(" ");
    return `${said[level]}${detail ? ` ${detail}` : ""}`;
  }

  const BLOCKED_TEXT = "Сейчас я не разговариваю: это не каприз, а решение, которое можно обсудить с владельцем.";

  async function answerRelationship(turn) {
    if (!policy) return say(turn, "Я пока не умею помнить отношения: рядом нет хранилища.");
    let state = null;
    try { state = await policy.state(turn.actorId); } catch { state = null; }
    if (!state) return say(turn, `Не могу заглянуть в свои записи — ${you(turn, "попробуйте", "попробуй")} позже.`);
    if (state.blocked) return say(turn, BLOCKED_TEXT);
    return say(turn, relationshipText(state, turn.manner?.formal !== false));
  }

  /**
   * «Вы и Аи» — то же, что раньше называлось карточкой отношений, только
   * словами и без анкеты. Экран один, настройки произносятся вслух.
   */
  async function profileCard(turn) {
    const settings = turn.manner?.settings ?? {};
    const formal = turn.manner?.formal !== false;
    let relationship = "";
    if (policy) {
      try {
        const state = await policy.state(turn.actorId);
        relationship = state?.blocked ? BLOCKED_TEXT : relationshipText(state, formal);
      } catch { relationship = ""; }
    }
    const [days, memories] = await Promise.all([
      personal.daysWith(turn.actorId).catch(() => ({ days: 0 })),
      // В группе карточка не выдаёт даже число личных записей.
      memory.list(turn.actorId, { inGroup: turn.inGroup }).then(items => items.length).catch(() => 0),
    ]);
    return say(turn, personal.card({
      address: settings.address ?? "",
      days: days.days,
      relationship,
      memories,
      length: settings.length ?? "обычно",
      formal,
    }));
  }

  /** Незнакомая команда — это не повод идти к модели и выдумывать ответ. */
  function unknownCommandText(turn) {
    return `${NAME}: такой команды у меня нет — я понимаю слова, а не команды. ${you(turn, "Спросите", "Спроси")} «что ты умеешь».`;
  }

  async function greeting(turn) {
    const lines = [
      `${NAME}. Я рядом.`,
      "",
      "Пишите как есть — без команд. Могу поговорить, запомнить, что вам важно, и учусь на поправках.",
      abilities.open()
        ? `Профиль, наказания и игры умеет ${SISTER} — попросите её словами.`
        : "",
    ].filter(Boolean);
    return say(turn, lines.join("\n"));
  }

  /**
   * Одна строка про память, в которой нельзя ошибиться. «Доступно» без пробы —
   * это обещание, а не факт: объект базы может быть на месте, а таблиц нет.
   */
  function memoryLine(state) {
    if (state?.read && state?.write) return "чтение и запись работают";
    if (!state?.read && state?.code === "no_database") return "хранилища нет — отвечаю без истории";
    if (state?.read && !state?.write) return "чтение есть, запись не проходит — схема базы не применена";
    return "таблиц нет — схема базы не применена";
  }

  /**
   * Мост одной строкой: закрыт, открыт или открыт, но сестра молчит. С `live`
   * — настоящий вопрос сестре: «открыт» — это настройка, «ответила» — факт.
   */
  async function bridgeLine({ live = null } = {}) {
    if (!abilities.open()) return "мост закрыт — работаю одна";
    const health = await abilities.health().catch(() => ({ silent: false }));
    if (health.silent) return `мост открыт, но ${SISTER} молчит — не жду её до ${clock(health.until)}`;
    if (live) {
      const probe = await abilities.ping({ actor: live.actorId, chat: live.chatId, chatType: "private" }).catch(() => ({ ok: false, code: "error", ms: 0 }));
      return probe.ok ? `мост открыт, ${SISTER} ответила за ${probe.ms} мс` : `мост открыт, но ${SISTER} не ответила на пробу`;
    }
    return "мост открыт";
  }

  /** Источники одной строкой: живая проба, а не «подключены». */
  async function sourcesLine() {
    const got = await sources.probe().catch(() => ({ wiki: false, weather: false, rates: false }));
    const mark = (ok) => (ok ? "отвечает" : "нет связи");
    return `Википедия — ${mark(got.wiki)} · погода — ${mark(got.weather)} · курс — ${mark(got.rates)}`;
  }

  const spanText = (ms) => {
    const minutes = Math.max(1, Math.round(ms / 60_000));
    if (minutes < 90) return `${minutes} мин`;
    const hours = Math.round(minutes / 60);
    return hours < 48 ? `${hours} ч` : `${Math.round(hours / 24)} д`;
  };

  /** «сегодня в 18:30», «завтра в 09:00», «25.12 в 09:00» — срок словами. */
  function whenText(at, zone = TZ) {
    const day = calendarDate(at, zone), today = calendarDate(now(), zone);
    const hour = localClock(at, zone);
    if (day === today) return `сегодня в ${hour}`;
    if (day === calendarDate(now() + DAY, zone)) return `завтра в ${hour}`;
    return `${day.slice(8, 10)}.${day.slice(5, 7)}${day.slice(0, 4) !== today.slice(0, 4) ? `.${day.slice(0, 4)}` : ""} в ${hour}`;
  }

  /**
   * Часы человека. Город он называет сам — когда спрашивает погоду; с тех
   * пор «напомни в 9» значит девять по его времени, а не по времени хозяина.
   */
  const zoneOf = (turn) => (validTimeZone(turn?.manner?.settings?.tz) ? turn.manner.settings.tz : TZ);

  /**
   * Отметка будильника. Платформа будит сердце только обновлением; по двум
   * последним «ударам» она знает, как часто её будят, и не обещает минутной
   * точности, которой нет.
   */
  async function beat(kind) {
    try {
      const saved = await store.get("heart:clock");
      // Два обновления подряд — один удар: иначе «частота» была бы шумом.
      if (saved?.at && now() - saved.at < 20_000) return;
      await store.set("heart:clock", { at: now(), prev: saved?.at ?? null, kind });
    } catch { /* без отметки она просто скажет, что будильника нет */ }
  }

  /** Насколько точно она сейчас умеет «в срок»: minute, hour или none. */
  async function clockPrecision() {
    const saved = await store.get("heart:clock").catch(() => null);
    if (!saved?.at || !saved.prev) return { kind: "none", every: 0, at: saved?.at ?? 0 };
    const every = saved.at - saved.prev;
    if (now() - saved.at > Math.max(3 * every, 5 * 60_000)) return { kind: "none", every: 0, at: saved.at };
    // Часовой будильник из Actions — тоже будильник: с ним
    // напоминание опаздывает, но приходит без единого сообщения от людей.
    return { kind: every <= 150_000 ? "minute" : every <= 6.5 * 3_600_000 ? "hour" : "none", every, at: saved.at };
  }

  async function clockLine() {
    const precision = await clockPrecision();
    if (precision.kind === "minute") return "будят каждую минуту — напоминания и сводка приходят в срок";
    if (precision.kind === "hour") return `будят раз в ${spanText(precision.every)} — напоминания могут опоздать на столько же`;
    return "нет — просыпаюсь только от сообщений";
  }

  /** Цепочка моделей одной строкой: кто думает, кто отдыхает и до какого часа. */
  async function brainsLine(apiKey) {
    const list = await brains.describe({ apiKey }).catch(() => []);
    if (!list.length) return "нет — ключ провайдера не задан";
    return list.map((item, index) => {
      const short = item.model.replace(/^[^/]+\//u, "");
      const why = ({ limit: "лимит", network: "нет связи", down: "сбой", gone: "снята", payment: "ждёт шага в кабинете провайдера" })[item.why] ?? "отдыхает";
      return `${short}${index === 0 ? " (осн.)" : ""}${item.ok ? "" : ` — ${why} до ${clock(item.until)}`}`;
    }).join(" · ");
  }

  /** Имя провайдера для владельца: «основной» или то, как он назван в настройках. */
  const PROVIDER_NAMES = new Map((Array.isArray(config.AI_PROVIDERS) ? config.AI_PROVIDERS : []).filter(item => item?.id && item?.name).map(item => [String(item.id), String(item.name)]));
  const providerName = (id) => (id === "main" ? "основной" : PROVIDER_NAMES.get(String(id)) ?? String(id));

  /** Одна строка о пробе провайдера: отвечает — за сколько, нет — почему. */
  function probeLine(row) {
    const head = `${providerName(row.provider)} (${String(row.model).replace(/^[^/]+\//u, "")})`;
    if (row.ok) return `${head} — отвечает, ${row.ms} мс`;
    if (row.code === "provider_network_error") {
      // Самая частая причина у провайдера со своими сертификатами: платформа им не доверяет.
      return `${head} — нет связи${row.stage === "token" ? " при обмене ключа" : ""} (${row.errorName || "сеть"}); если так каждый раз — платформа не принимает его сертификат`;
    }
    if (row.code === "provider_http_error") {
      const why = describeProviderFailure({ status: row.status, providerCode: row.providerCode, model: row.model }).replace(/[.\s]+$/u, "");
      return `${head} — ${why}${row.gone ? ". Сутки её не трогаю; имя стоит заменить в настройках" : row.unpaid ? ". Сутки её не трогаю" : ""}`;
    }
    return `${head} — нет (${row.code || "ошибка"})`;
  }

  /** «Проверь мозги»: живой запрос к каждому провайдеру, а не список из настроек. */
  async function probeBrains(turn) {
    if (turn.dry) return say(turn, "Пробный запуск: живая проба провайдеров не выполнялась.");
    const rows = await ai.probeBrains({ ctx: turn.ctx, apiKey: await resolveKey(turn.ctx), every: true }).catch(() => []);
    if (!rows.length) return say(turn, "Проверять нечего: ни одного ключа провайдера не задано.");
    return say(turn, ["Проба мозгов — живой запрос каждой модели каждого провайдера:", "", ...rows.map(row => `• ${probeLine(row)}`)].join("\n"));
  }

  async function diagnostic(turn) {
    if (!owner(turn.actorId)) {
      // В группе чужая проверка — шум: молчим. В личке отвечаем честно.
      return turn.inGroup ? { ignored: true, reason: "owner_only" } : say(turn, "Это внутренняя проверка.");
    }
    const apiKey = await resolveKey(turn.ctx);
    // A rehearsal reports state, not a live call: a test run must not spend a
    // provider request to find out whether the provider would answer.
    const probe = turn.dry ? null : await ai.checkProvider({ ctx: turn.ctx, apiKey });
    const [today, study, waiting, unknown] = await Promise.all([
      pulse.day().catch(() => ({})), lessons.stats().catch(() => ({ active: 0, proposed: 0 })),
      queue.size().catch(() => 0), store.get("heart:unknown:v1").catch(() => null),
    ]);
    const asked = Array.isArray(unknown?.items) ? unknown.items.length : 0;
    const lines = [
      "🧪 Проверка сердца",
      // Первая строка — сборка: по ней видно, доехал ли код до живого бота.
      `Сердце: ${BUILD} · словом понимаю ${INTENTS.length} намерений`,
      turn.dry ? "Провайдер: пробный запуск — живая проверка не выполнялась." : `Провайдер: ${probe.ok ? "отвечает" : `нет — ${probe.code ?? "ошибка"}`}`,
      `Хозяин: ${OWNER > 0 ? "это вы — узнаю" : "не задан — не узнаю никого"}`,
      `Модель: ${config.AI_MODEL}`,
      `Мозги: ${await brainsLine(apiKey)}`,
      `Память: ${memoryLine(await store.probe())}`,
      `Способности: ${await bridgeLine({ live: turn.dry ? null : turn })}`,
      turn.dry ? "Источники: пробный запуск — живая проверка не выполнялась." : `Источники: ${await sourcesLine()}`,
      `Будильник: ${await clockLine()}`,
      `События: ${events.KINDS.join(", ")} — не чаще раза в ${Math.round(events.cooldownMs / 60_000)} мин`,
      `Уроки: ${study.active} ${plural(study.active, "активный", "активных", "активных")}${study.proposed ? ` · ждут вашего слова: ${study.proposed}` : ""}${asked ? ` · не знала ответа: ${asked}` : ""}`,
      `Сегодня: ${pulse.lines(today).join("; ")}${waiting ? `; в очереди: ${waiting}` : ""}`,
      await incidentLine(),
    ];
    // A rehearsal must not send the screen either: the caller asked what the
    // answer would be, not to receive it.
    return say(turn, lines.join("\n"));
  }

  /**
   * A request may be an ability, not a conversation. Three outcomes, all honest:
   * executed, refused by her for a stated reason, or not available here at all —
   * in which case the heart says which bot could do it and how to invite her.
   * It never passes the phrase to the model instead, because the model would
   * either invent the result or ask for a command that does not exist.
   */
  async function tryAbility(turn, text) {
    const tool = matchPhrase(text);
    if (!tool) return null;
    return runAbility(turn, { tool });
  }

  /**
   * Попросить сестру выполнить умение. Она сама решает, можно ли это здесь и
   * этому человеку; сердце не подменяет её решение и не обещает результат.
   */
  async function runAbility(turn, { tool, args = { args: "" } }) {
    const { chatId, actorId, chatType, dry } = turn;
    const said = (reason, extra = {}) => say(turn, missingAbilityText({
      tool, reason, chatType,
      name: NAME,
      sister: SISTER,
      username: SISTER_USERNAME,
      ...extra,
    }));

    if (!abilities.open()) return said("bridge_closed");
    // The bridge is a signed post into a real channel: a rehearsal asks for
    // nothing, and says only what it would have asked.
    if (dry) return say(turn, `${NAME}: пробный запуск — это умение я попросила бы у ${SISTER}. Ничего не отправлено.`);
    // Сестра уже промолчала: не заставляем человека ждать ещё полминуты.
    if (await abilities.silent()) {
      const health = await abilities.health();
      return say(turn, `${NAME}: ${SISTER} сейчас не отвечает — это её умение, и без неё я его не выполню. Попробую снова после ${clock(health.until)}.`);
    }

    const listed = await abilities.catalogue({ actor: actorId, chat: chatId, chatType });
    // "Не ответила" and "её здесь нет" are different facts. Saying the second
    // when the first happened sends the owner to look for a bot that is already
    // standing right there.
    if (!listed.ok) return say(turn, `${NAME}: ${SISTER} не ответила на запрос умений (${listed.code}). ${you(turn, "Попробуйте", "Попробуй")} ещё раз.`);
    if (!listed.tools.some(item => item.name === tool)) return said("not_in_chat");

    const result = await abilities.call(tool, { actor: actorId, chat: chatId, chatType, args });
    if (result.ok) return say(turn, result.text || "Готово.");
    if (result.code === "module_disabled") return said("module_disabled");
    try {
      await notices.report({
        component: "bridge",
        code: result.code ?? "no_answer",
        detail: result.code === "bridge_timeout" ? "сестра не ответила вовремя" : "сестра не приняла просьбу",
        severity: "degraded",
      });
    } catch { /* отчёт не должен менять ответ */ }
    return say(turn, `${NAME}: ${SISTER} не ответила (${result.code ?? "ошибка"}). ${you(turn, "Попробуйте", "Попробуй")} ещё раз.`);
  }

  /** Имя автора урока для владельца: без ID, только то, как человек назвался. */
  const authorName = (turn) => turn.manner?.settings?.address || turn.name || "участник";

  /**
   * Спросить владельца о чужой поправке. Не больше пяти вопросов в сутки:
   * остальное он увидит в утренней сводке.
   */
  async function askOwnerAbout(turn, lesson) {
    if (turn.dry || OWNER <= 0) return;
    const counterKey = `heart:asked:${dayOf(now())}`;
    const used = Number(await store.get(counterKey).catch(() => 0)) || 0;
    if (used >= 5) return;
    const told = await notices.tell({
      text: [
        "🤍 Хозяин, меня поправили.",
        `Кто: ${authorName(turn)}${turn.inGroup ? " (в группе)" : ""}`,
        `Урок №${lesson.id}: «${lesson.text}»`,
        "Сейчас он действует только в разговоре с этим человеком.",
        `Сделать общим? Ответьте на это сообщение «да» или «нет» — или скажите «прими урок ${lesson.id}» / «отклони урок ${lesson.id}».`,
      ].join("\n"),
    });
    if (told.sent) {
      await lessons.markAsked(lesson.id, told.messageId);
      await store.set(counterKey, used + 1);
    }
  }

  /** Научить словами: «урок: …», «правило: …», «знай: …». */
  async function teach(turn, { kind, text }) {
    const replied = turn.message?.reply_to_message;
    const added = await lessons.add({
      kind, text, author: turn.actorId,
      // Урок, сказанный ответом на её реплику, привязан к тому случаю.
      when: replied ? String(replied.text ?? replied.caption ?? "") : "",
    });
    if (!added.ok) {
      if (added.code === "forbidden") return say(turn, "Этому я не учусь: правила о тайнах, наказаниях, ролях и деньгах меняет только владелец.");
      if (added.code === "storage_unavailable") return say(turn, "Урок не сохранился: хранилище не приняло запись. Владелец уже знает.");
      return say(turn, `Не поняла, чему учиться. ${you(turn, "Скажите", "Скажи")} одной фразой: «урок: …».`);
    }
    if (added.duplicate) return say(turn, `Это я уже усвоила (№${added.id}): «${added.text}».`);
    pulse.bump("lessons");
    const label = ({ rule: "правило", lesson: "урок", fact: "знание" })[kind];
    if (owner(turn.actorId)) {
      if (added.touchy) {
        // Подчиняется, но не молча: и не обещает того, чего у неё нет.
        const hands = /(?:бан|мут|кик|варн|предупрежд|рол[ьи]|вип|vip|админ|модер|деньг|плат|начисл|спис|перевод)/iu.test(added.text)
          ? ` Рук для банов, ролей и денег у меня нет — их исполняет ${SISTER}; в словах учту.` : "";
        return say(turn, `Ворчу, но слушаюсь${turn.isPrivate ? ", хозяин" : ""}: ${label} №${added.id} — «${added.text}». Действует сразу и для всех.${hands} Отменить — «забудь урок ${added.id}».`);
      }
      return say(turn, `Усвоила, ${label} №${added.id}: «${added.text}». Действует сразу и для всех. Отменить — «забудь урок ${added.id}».`);
    }
    if (policy) { try { await policy.recordDeed({ userId: turn.actorId, kind: "taught" }); } catch { /* отношения подождут */ } }
    await askOwnerAbout(turn, added);
    return say(turn, you(turn,
      `Запомнила поправку №${added.id}: «${added.text}». В разговорах с вами учту сразу; для всех — после слова владельца.`,
      `Запомнила поправку №${added.id}: «${added.text}». В разговорах с тобой учту сразу; для всех — после слова владельца.`));
  }

  async function listLessons(turn) {
    const items = await lessons.list({ viewer: turn.actorId });
    if (!items.length) {
      return say(turn, owner(turn.actorId)
        ? "Уроков пока нет. Научить: «урок: …», «правило: …» или «знай: …»."
        : `От ${you(turn, "вас", "тебя")} у меня уроков пока нет. Поправить меня: «так не надо: …».`);
    }
    const label = { rule: "правило", lesson: "урок", fact: "знание" };
    const lines = items.slice(-25).map(item => {
      const marks = [
        item.scope === "all" ? "" : "личный",
        item.proposed ? "ждёт вашего слова" : "",
        item.doubt ? "под сомнением" : "",
      ].filter(Boolean);
      return `№${item.id} · ${label[item.kind] ?? "урок"}: ${item.text}${owner(turn.actorId) && marks.length ? ` (${marks.join(", ")})` : ""}`;
    });
    return say(turn, [owner(turn.actorId) ? "Чему меня научили:" : `Мои уроки из разговоров с ${you(turn, "вами", "тобой")}:`, "", ...lines].join("\n"));
  }

  /** «Почему ты так ответила»: из записи о прошлом ответе, а не догадкой модели. */
  async function whyAnswer(turn) {
    const trace = await store.get(`heart:trace:${turn.chatId}:${turn.actorId}`).catch(() => null);
    if (!trace?.at) return say(turn, "О прошлом ответе у меня нет записи: либо его не было, либо я отвечала по правилу, без модели.");
    const used = [];
    if (trace.facts) used.push(`${trace.facts} ${plural(trace.facts, "запись", "записи", "записей")} о ${you(turn, "вас", "тебе")}`);
    if (Array.isArray(trace.lessons) && trace.lessons.length) used.push(`уроки №${trace.lessons.join(", №")}`);
    if (trace.thread) used.push("недавний разговор в этом чате");
    if (trace.reply) used.push("сообщение, на которое был ответ");
    if (trace.source) used.push(trace.source);
    const lines = [
      `Отвечала на: «${trace.q}».`,
      used.length ? `Опиралась на: ${used.join("; ")}.` : "Своих записей в ответе не было: только общие знания модели и наш разговор.",
      "Остальное — общие знания модели: они бывают неточны. Если я ошиблась, скажите «так не надо: …» — запомню.",
    ];
    if (owner(turn.actorId)) lines.push(`Модель: ${trace.model ?? "?"} · подсказка: ${trace.tier === "core" ? "короткая" : "полная"}.`);
    return say(turn, lines.join("\n"));
  }

  /** «Почему молчала»: причина из записи, а не три общие фразы. */
  async function whyQuiet(turn) {
    const quiet = await store.get(`heart:quiet:${turn.chatId}:${turn.actorId}`).catch(() => null);
    const recent = quiet?.at && now() - quiet.at < 7 * DAY ? quiet.reason : "";
    const known = {
      silence: "В прошлый раз я промолчала сама: это мой выбор и часть характера, а не поломка.",
      queued: "В прошлый раз мне было нечем думать: лимит модели вышел. Вопрос я записала и отвечаю на такие сама, когда могу.",
      cap: "Вчера или сегодня мы упёрлись в дневной предел разговора: мыслей на день у меня не бесконечно. Это не обида — завтра продолжаем.",
      fault: "В прошлый раз у меня была неполадка, и ответ не получился. Владелец о ней знает.",
    }[recent];
    if (known) return say(turn, known);
    return say(turn, [
      "Я отвечаю не на каждое сообщение: в группе — когда обращаются ко мне, в личке — всегда.",
      "Иногда я молчу намеренно: это часть характера, а не поломка.",
      "Если я не ответила на прямое обращение — это сбой, и о нём я уже сообщила владельцу.",
    ].join("\n"));
  }

  /**
   * Один вход на смысл. Слова разбираются правилами, поэтому действие всегда
   * одно и то же, а понятая наполовину просьба задаёт вопрос, а не угадывает.
   */
  async function handleIntent(turn, text) {
    const parsed = parseIntent(text);
    if (!parsed) return null;
    const { actorId, dry, inGroup } = turn;
    // «Статус» и проба провайдеров — только для хозяина; для остальных это обычные слова.
    if (["status", "brains_check"].includes(parsed.intent) && !owner(actorId)) return null;
    if (parsed.confidence === "maybe") return say(turn, `${NAME}: ${parsed.question}`);
    // Репетиция ничего не записывает: она проверяет маршрут, а не меняет память.
    if (dry) return say(turn, `Разобрала бы это как «${parsed.intent}» — репетиция, ничего не меняю.`);

    const tool = ABILITY_OF[parsed.intent];
    if (tool) return runAbility(turn, { tool });

    const place = { inGroup };
    switch (parsed.intent) {
      case "remember": {
        const added = await memory.add(actorId, parsed.arg, place);
        if (!added.ok) {
          // Не «попробуйте позже», а причина: запись не проходит, когда в базе
          // нет таблиц, и это лечится деплоем, а не ожиданием.
          return say(turn, added.code === "storage_unavailable"
            ? `${NAME}: хранилище не приняло запись — похоже, не применена схема базы. Уже сообщила владельцу.`
            : `${NAME}: не получилось сохранить. ${you(turn, "Попробуйте", "Попробуй")} короче — одна фраза.`);
        }
        if (added.duplicate) return say(turn, `Это я и так помню: «${added.text}».`);
        await react(turn, "✍");
        return say(turn, inGroup
          ? `Запомнила: «${added.text}». Сказано при всех — буду помнить и здесь, и в личке.`
          : `Запомнила: «${added.text}». ${you(turn, "Спросите", "Спроси")} «что ты обо мне помнишь» — перескажу.`);
      }
      case "memories": {
        const items = await memory.list(actorId, place);
        if (!items.length) {
          return say(turn, inGroup
            ? `Из сказанного при всех о ${you(turn, "вас", "тебе")} ничего не записано. Личное я покажу только в личке.`
            : `О ${you(turn, "вас", "тебе")} у меня пока ничего не записано. ${you(turn, "Скажите", "Скажи")} «запомни, …» — и я сохраню это надолго.`);
        }
        return say(turn, [inGroup ? `Помню о ${you(turn, "вас", "тебе")} то, что сказано при всех:` : `Помню о ${you(turn, "вас", "тебе")}:`, "", ...items.map((item, i) => `${i + 1}. ${item}`)].join("\n"));
      }
      case "forget": {
        const mode = parsed.arg?.mode;
        if (mode === "index") {
          const removed = await memory.removeAt(actorId, parsed.arg.index, place);
          if (!removed.ok) {
            return say(turn, `Под номером ${parsed.arg.index} у меня ничего нет. ${you(turn, "Скажите", "Скажи")} «что ты обо мне помнишь» — покажу список.`);
          }
          return say(turn, `Забыла: «${removed.removed}». Осталось ${removed.count}.`);
        }
        if (mode === "last") {
          // «Забудь это» — последнее сказанное, а не вся память разом.
          const removed = await memory.removeLast(actorId, place);
          if (!removed.ok) return say(turn, removed.code === "storage_unavailable" ? "Не получилось забыть: хранилище не отвечает." : "Мне и нечего забывать: записей нет.");
          return say(turn, `Забыла последнее: «${removed.removed}». Осталось ${removed.count}.`);
        }
        if (mode === "everything") {
          await store.set(`heart:wipe:${actorId}`, { at: now() });
          return say(turn, you(turn,
            "Это сотрёт всё, что я о вас знаю: записи, нашу переписку, имя и настройки. Вернуть будет нельзя. Если уверены — скажите «да, удали всё».",
            "Это сотрёт всё, что я о тебе знаю: записи, нашу переписку, имя и настройки. Вернуть будет нельзя. Если точно — скажи «да, удали всё»."));
        }
        if (mode === "confirm") {
          const asked = await store.get(`heart:wipe:${actorId}`).catch(() => null);
          // Подтверждение без вопроса — это «забудь всё»: стираются только записи.
          if (asked?.at && now() - asked.at < 10 * 60_000) return wipePerson(turn);
        }
        const cleared = await memory.clear(actorId, place);
        if (!cleared.ok) return say(turn, "Не получилось забыть: хранилище не отвечает.");
        return say(turn, cleared.removed
          ? `Забыла все записи (${cleared.removed}). Переписку и настройки не трогала — для этого есть «удали всё обо мне».`
          : "Мне и нечего было забывать: записей нет.");
      }
      case "relationship":
        return answerRelationship(turn);
      case "card":
        return profileCard(turn);
      case "no_flirt": {
        const saved = await personal.save(actorId, { flirt: false }).catch(() => ({ ok: false }));
        return say(turn, saved?.ok
          ? "Хорошо. Флирта не будет — буду говорить тепло, но по-человечески."
          : "Не запомнилось: хранилище не отвечает.");
      }
      case "no_reactions": {
        const saved = await personal.save(actorId, { reactions: false }).catch(() => ({ ok: false }));
        return say(turn, saved?.ok
          ? "Хорошо, реакции ставить не буду: отвечу словами или промолчу."
          : "Не запомнилось: хранилище не отвечает.");
      }
      case "no_night": {
        const saved = await personal.save(actorId, { night: false }).catch(() => ({ ok: false }));
        return say(turn, saved?.ok
          ? "Договорились: ночью я первой не пишу. Отложенный ответ придёт утром."
          : "Не запомнилось: хранилище не отвечает.");
      }
      case "whyquiet":
        return whyQuiet(turn);
      case "help":
        return say(turn, helpLines(turn));
      case "whoami":
        return say(turn, you(turn,
          `Я ${NAME}. Разговариваю, помню то, что вы просили запомнить, и учусь на поправках. Я не человек: слова подбирает языковая модель, а память, отношения и решения — мои собственные правила.`,
          `Я ${NAME}. Разговариваю, помню то, что обещала помнить, и учусь на поправках. Я не человек: слова подбирает языковая модель, а память, отношения и решения — мои собственные правила.`));
      case "version":
        return say(turn, `Сердце: ${BUILD}.${owner(actorId) ? " Подробности — «статус»." : ""}`);
      case "news":
        return say(turn, [`Что во мне нового (сборка ${BUILD}):`, "", ...RELEASE_NOTES.map(line => `• ${line};`)].join("\n").replace(/;$/u, "."));
      case "status":
        return diagnostic(turn);
      case "brains_check":
        return probeBrains(turn);
      case "teach":
        return teach(turn, parsed.arg);
      case "lessons":
        return listLessons(turn);
      case "unlearn": {
        if (parsed.arg.mode === "today") {
          const undone = await lessons.rollback({ ms: DAY, by: actorId });
          if (!undone.ok) return say(turn, "Откатывать уроки может только владелец.");
          return say(turn, undone.count ? `Откатила всё, чему научили за сутки: ${undone.count}.` : "За сутки новых уроков не было.");
        }
        const gone = await lessons.retire(parsed.arg.id, { by: actorId });
        if (!gone.ok) return say(turn, gone.code === "forbidden" ? "Этот урок чужой: отменить его может автор или владелец." : `Урока №${parsed.arg.id} у меня нет.`);
        return say(turn, `Отменила №${gone.item.id}: «${gone.item.text}».`);
      }
      case "judge": {
        const done = await lessons.judge(parsed.arg.id, parsed.arg.accept, { by: actorId });
        if (!done.ok) return say(turn, done.code === "forbidden" ? "Решать об уроках может только владелец." : `Урока №${parsed.arg.id} у меня нет.`);
        return say(turn, parsed.arg.accept ? `Принято: урок №${done.item.id} теперь общий.` : `Отклонено: урок №${done.item.id} отменён.`);
      }
      case "learned": {
        const stats = await lessons.stats();
        const mine = await lessons.list({ viewer: actorId });
        if (!stats.active) return say(turn, `Пока меня ничему не учили. Поправить меня можно словами: «так не надо: …».`);
        const recent = mine.slice(-3).map(item => `• ${item.text}`);
        return say(turn, [
          `У меня ${stats.active} ${plural(stats.active, "урок", "урока", "уроков")}, за сутки ${stats.fresh ? `прибавилось ${stats.fresh}` : "новых не было"}.`,
          ...(recent.length ? ["", owner(actorId) ? "Последнее:" : `Из разговоров с ${you(turn, "вами", "тобой")}:`, ...recent] : []),
        ].join("\n"));
      }
      case "why_answer":
        return whyAnswer(turn);
      case "tell_owner": {
        if (owner(actorId)) return say(turn, "Хозяин — это вы: передавать некому.");
        if (OWNER <= 0) return say(turn, "Хозяин у меня не задан: передать некому.");
        const counter = `heart:mail:${dayOf(now())}:${actorId}`;
        const used = Number(await store.get(counter).catch(() => 0)) || 0;
        if (used >= 3) return say(turn, `Сегодня я уже передала три ${you(turn, "ваших", "твоих")} сообщения. Остальное — завтра.`);
        const who = authorName(turn);
        let sent = null;
        try {
          sent = await api.sendMessage({
            chat_id: OWNER,
            text: `✉️ Хозяин, вам пишет ${who}${inGroup ? " (сказано в группе)" : ""}:\n\n${String(parsed.arg).slice(0, 1500)}\n\nОтветить — ответом на это сообщение: передам слово в слово.`,
          });
        } catch { sent = null; }
        if (!sent) return say(turn, `Не получилось передать: хозяин сейчас недоступен. ${you(turn, "Попробуйте", "Попробуй")} позже.`);
        await store.set(counter, used + 1);
        // По номеру сообщения ответ хозяина найдёт адресата; ID человека хозяин не видит.
        if (sent?.message_id != null) await store.set(`heart:mail:msg:${sent.message_id}`, { to: actorId, name: who, at: now() });
        await react(turn, "✍");
        return say(turn, "Передала — слово в слово. Если хозяин ответит, принесу ответ в личку.");
      }
      case "play": {
        if (!parsed.arg) return say(turn, games.menu({ sister: abilities.open() ? SISTER : "", party: party.menu({ inGroup }), inGroup }));
        const started = await games.start(turn.chatId, parsed.arg.game, { formal: turn.manner?.formal !== false, from: parsed.arg.from, to: parsed.arg.to });
        if (!started) return null;
        pulse.bump("games");
        return say(turn, `${started.text}${inGroup ? "\n\nВ группе ходят ответом на моё сообщение или по имени." : ""}`);
      }
      case "roll": {
        const rolled = games.instant(parsed.arg);
        if (!rolled) return null;
        pulse.bump("games");
        // Один обычный кубик бросает сам Telegram: его видно, и его не подделать.
        if (rolled.native && has("sendDice")) {
          try {
            await api.sendDice({ chat_id: turn.chatId, emoji: "🎲", ...turn.extra });
            turn.delivered = true;
            return { ok: true, action: "dice" };
          } catch { /* живой кубик не бросился — скажем числом */ }
        }
        return say(turn, rolled.text);
      }
      case "remind":
        return setReminder(turn, parsed.arg);
      case "reminders": {
        const items = await reminders.list(actorId);
        if (!items.length) return say(turn, `Напоминаний у ${you(turn, "вас", "тебя")} нет. Поставить: «напомни через час …» или «напомни завтра в 9 …».`);
        return say(turn, ["Напоминания:", "", ...items.map((item, i) => `${i + 1}. ${whenText(item.at, zoneOf(turn))}${item.repeat?.kind ? ` (${REPEAT_LABEL[item.repeat.kind]})` : ""}${item.kind === "morning" ? " — побудка" : item.kind === "capsule" ? " — капсула времени" : ""}${item.text && item.kind !== "capsule" ? ` — ${item.text}` : ""}`), "", "Отменить: «отмени напоминание 2»."].join("\n"));
      }
      case "unremind": {
        const gone = await reminders.cancel(actorId, parsed.arg.index);
        if (!gone.ok) return say(turn, gone.code === "storage_unavailable" ? "Не получилось отменить: хранилище не отвечает." : parsed.arg.index == null ? "Отменять нечего: напоминаний нет." : `Напоминания №${parsed.arg.index} нет. «Мои напоминания» покажет список.`);
        return say(turn, gone.removed.length === 1 ? `Отменила: ${whenText(gone.removed[0].at, zoneOf(turn))}${gone.removed[0].text ? ` — ${gone.removed[0].text}` : ""}.` : `Отменила все напоминания (${gone.removed.length}).`);
      }
      case "not_mine": {
        // Наказания, роли и деньги исполняет сестра по своим правилам. Сердце
        // не подменяет её решение даже из лучших побуждений.
        if (owner(actorId)) {
          // Хозяину не отказывают — но и не обещают того, чего нет в руках.
          return say(turn, `${turn.isPrivate ? "Слушаюсь, хозяин, — но" : "Я бы выполнила, но"} рук для этого у меня нет: баны, роли и деньги исполняет ${SISTER}. ${abilities.open() ? "Скажите это ей напрямую." : "Она пока не подключена."}`);
        }
        return say(turn, `${NAME}: это не моё. Наказания, роли и деньги ведёт ${SISTER} — и только по правилам чата. Я не буду ни банить, ни обещать за неё.`);
      }
      default:
        return null;
    }
  }

  /** Поставить напоминание. Время разбирает код; половину понятого — спрашивает. */
  async function setReminder(turn, phrase) {
    const zone = zoneOf(turn);
    const parsed = parseReminder(phrase, { now: now(), timeZone: zone });
    if (!parsed) return say(turn, `Не поняла, о чём напомнить. ${you(turn, "Скажите", "Скажи")}: «напомни через час …» или «напомни завтра в 9 …».`);
    // «Напомни через час» ответом на сообщение — напомнить о нём.
    const replied = turn.message?.reply_to_message;
    const quoted = String(replied?.text ?? replied?.caption ?? "").replace(/\s+/gu, " ").trim().slice(0, 300);
    if (!parsed.ok) {
      return say(turn, parsed.need === "time"
        ? `Когда напомнить${parsed.text ? ` «${parsed.text}»` : ""}? ${you(turn, "Скажите", "Скажи")} со временем: «напомни через час …» или «напомни завтра в 9 …».`
        : "Это время уже прошло или слишком далеко: я ставлю напоминания от полминуты до года вперёд.");
    }
    const text = parsed.text || quoted;
    // Капсуле нужно письмо: пустую закапывать незачем.
    if (parsed.kind === "capsule" && !text) return say(turn, `Что положить в капсулу? Одной фразой: «капсула времени на год: …».`);
    const added = await reminders.add({
      userId: turn.actorId, chatId: turn.chatId, at: parsed.at, text,
      messageId: turn.message?.message_id ?? null, threadId: turn.extra.message_thread_id ?? null, inGroup: turn.inGroup,
      repeat: parsed.repeat ?? null, kind: parsed.kind ?? "", zone,
    });
    if (!added.ok) {
      return say(turn, added.code === "too_many"
        ? `У ${you(turn, "вас", "тебя")} уже двадцать напоминаний — это мой предел. «Мои напоминания» покажет список, лишнее можно отменить.`
        : added.code === "storage_unavailable" ? "Напоминание не сохранилось: хранилище не приняло запись. Владелец уже знает."
          : "Напоминание не сохранилось: их сейчас слишком много.");
    }
    pulse.bump("reminders");
    await react(turn, "✍");
    // Честно о точности: она зависит от того, как часто её будят.
    const precision = await clockPrecision();
    const note = precision.kind === "minute" ? ""
      : precision.kind === "hour" ? ` Будят меня сейчас раз в ${spanText(precision.every)}, так что могу опоздать — но не забуду.`
        : " Точного будильника у меня пока нет: напомню, как только проснусь после этого времени — от любого сообщения.";
    // Пояс назван, только когда он не тот, что у хозяина: иначе это шум.
    const where = zone !== TZ && turn.manner?.settings?.city ? ` (по времени: ${turn.manner.settings.city})` : "";
    const often = parsed.repeat ? `${REPEAT_LABEL[parsed.repeat.kind]}, начиная ` : "";
    if (parsed.kind === "capsule") {
      const day = calendarDate(parsed.at, zone);
      return say(turn, `Запечатала. Открою ${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)} и пришлю ${you(turn, "вам", "тебе")} эти слова. Передумать — «мои напоминания».`);
    }
    if (parsed.kind === "morning") {
      const city = turn.manner?.settings?.city;
      return say(turn, `Хорошо, разбужу ${often ? `${REPEAT_LABEL[parsed.repeat.kind]} — первый раз ` : ""}${whenText(parsed.at, zone)}${where}: ${city ? `с погодой (${city}) и делами на день` : "с делами на день; назовёте город — «мой город — …» — добавлю погоду"}.${note}`);
    }
    return say(turn, `Хорошо, напомню ${often}${whenText(parsed.at, zone)}${where}${text ? `: «${text}»` : ""}.${note}`);
  }

  /**
   * Что сказать, когда срок пришёл. Обычное напоминание — слова человека;
   * побудка — утро целиком: день, погода и дела; капсула — письмо из прошлого.
   * `null` — говорить уже незачем («доброе утро» в девять вечера).
   */
  async function ringText(item) {
    const late = now() - Number(item.at);
    const zone = item.zone || TZ;
    const lateNote = late > 10 * 60_000 ? ` с опозданием на ${spanText(late)} — раньше меня никто не разбудил` : "";
    if (item.kind === "capsule") {
      const day = calendarDate(Number(item.created) || Number(item.at), zone);
      const manner = await mannerFor(item.userId, { dry: true }).catch(() => ({ formal: true }));
      return `📦 Капсула времени. ${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)} ${manner.formal === false ? "ты написал(а) себе" : "вы написали себе"}:\n\n«${item.text}»`;
    }
    if (item.kind === "morning") {
      if (late > 6 * 3_600_000) return null;
      const settings = (await personal.settings(item.userId).catch(() => ({}))) ?? {};
      const lines = [`☀️ Доброе утро${settings.address ? `, ${settings.address}` : ""}! Сегодня ${dayLine(now(), zone)}.${lateNote ? ` Бужу${lateNote}.` : ""}`];
      if (settings.city) {
        const weather = await sources.weather(settings.city).catch(() => null);
        if (weather?.ok) lines.push("", weather.text);
      }
      const today = calendarDate(now(), zone);
      const plans = (await reminders.list(item.userId).catch(() => []))
        .filter(other => other.id !== item.id && other.kind !== "capsule" && calendarDate(other.at, zone) === today)
        .slice(0, 5).map(other => `• ${localClock(other.at, zone)}${other.text ? ` — ${other.text}` : ""}`);
      if (plans.length) lines.push("", "Сегодня напомню:", ...plans);
      if (item.text) lines.push("", item.text);
      return lines.join("\n");
    }
    const head = `⏰ Напоминаю${lateNote}`;
    return item.text ? `${head}: ${item.text}` : `${head}, как договаривались.`;
  }

  /** Напоминания, чей срок пришёл. Опоздала — говорит, на сколько. */
  async function ring() {
    const due = await reminders.due();
    for (const item of due) {
      const extra = {};
      if (item.threadId != null) extra.message_thread_id = item.threadId;
      // Повторяющееся не цепляется к давней просьбе: ответ на сообщение месячной давности только путает.
      if (item.inGroup && item.messageId != null && !item.repeat) extra.reply_parameters = { message_id: item.messageId, allow_sending_without_reply: true };
      let delivered = false;
      try {
        const text = await ringText(item);
        if (text) {
          await api.sendMessage({ chat_id: item.chatId, text, ...extra });
          pulse.bump("reminded");
        }
        delivered = true;
      } catch { delivered = false; }
      const settled = await reminders.settle(item.id, delivered);
      if (settled.dropped) {
        try { await notices.report({ component: "telegram", code: "reminder_lost", severity: "degraded", detail: "напоминание не удалось доставить за три попытки" }); } catch { /* отчёт не важнее остальных напоминаний */ }
      }
    }
  }

  // ── источники: то, что она узнаёт не из модели ─────────────────────────
  const SOURCE_DOWN = Object.freeze({
    weather: "Метеослужба сейчас не отвечает, а придумывать погоду я не стану. Чуть позже — скажу.",
    rates: "Центробанк сейчас не отвечает, а называть курс по памяти я не стану. Чуть позже — скажу.",
    wiki: "Википедия сейчас не отвечает. Чуть позже — посмотрю.",
  });
  const CALC_ERROR = Object.freeze({
    div_zero: "На ноль делить нельзя — даже мне.",
    too_big: "Число выходит слишком большим: столько цифр в сообщение не поместится.",
    negative_root: "Корень из отрицательного числа — уже не ко мне: я считаю в действительных числах.",
  });

  /**
   * Счёт, погода, курс, часы, энциклопедия — без модели. Модель считает на
   * глаз, погоду придумывает, а курс помнит прошлогодний; здесь ответ берётся
   * там, где он лежит. `null` — это не вопрос к источнику, а разговор.
   */
  async function fromSource(turn, prompt) {
    const { actorId } = turn;
    const math = calculate(prompt);
    if (math) {
      pulse.bump("sourced");
      if (math.ok) return say(turn, math.line);
      return say(turn, CALC_ERROR[math.code] ?? `Не разобрала пример. ${you(turn, "Напишите", "Напиши")} его знаками: «(15 + 7) × 3».`);
    }
    const value = normalize(prompt);
    const settings = turn.manner?.settings ?? {};

    // «Мой город — Казань»: настройка словами. По городу считаются погода и часы.
    const home = value.match(/^(?:мой\s+город\s*[—:-]?\s*|я\s+живу\s+в\s+(?:городе\s+)?)(.{2,40})$/u);
    if (home) {
      if (turn.dry) return say(turn, "Разобрала бы это как «мой город» — репетиция, ничего не меняю.");
      const place = await sources.findPlace(home[1], { tries: 2 });
      if (!place?.ok) return place?.code === "network" ? say(turn, "Справочник городов сейчас не отвечает — запомню город в другой раз.") : null;
      const saved = await personal.save(actorId, { city: place.name, ...(validTimeZone(place.timezone) ? { tz: place.timezone } : {}) }).catch(() => ({ ok: false }));
      return say(turn, saved.ok
        ? `Запомнила: ${you(turn, "ваш", "твой")} город — ${place.name}. «Погода», «который час» и «напомни в 9» теперь считаю по нему.`
        : "Город не запомнился: хранилище не отвечает.");
    }

    const asked = detectSource(value);
    if (!asked) return null;
    // «Погода сегодня отличная, правда?» и «погода в Москве нынче радует» —
    // разговор, а не просьба: без предлога нужен знакомый город, а после
    // города не должно идти других слов.
    if (asked.kind === "weather" && asked.place && !knownCity(asked.place)) {
      const words = asked.place.split(" ");
      const story = words.length > 1 && Boolean(knownCity(words[0]) || (words.length > 2 && knownCity(words.slice(0, 2).join(" "))));
      if (!asked.explicit || story || words.length > 2) return null;
    }
    if (asked.kind === "until" && !parseTarget(asked.target)) return null;
    if (turn.dry) return say(turn, `Разобрала бы это как вопрос к источнику («${asked.kind}») — репетиция, никуда не хожу.`);

    switch (asked.kind) {
      case "weather": {
        const place = asked.place || settings.city;
        if (!place) return say(turn, `В каком городе? ${you(turn, "Скажите", "Скажи")} целиком: «погода в Казани» — город я запомню.`);
        await typing(turn);
        const got = await sources.weather(place, { day: asked.day });
        if (!got.ok) {
          return say(turn, got.code === "unknown_place"
            ? `Города «${place}» я не нашла. ${you(turn, "Назовите", "Назови")} его иначе — или ближайший крупный.`
            : SOURCE_DOWN.weather);
        }
        pulse.bump("sourced");
        // Первый названный город — её догадка о доме; сменить — «мой город — …».
        let note = "";
        if (!settings.city) {
          const saved = await personal.save(actorId, { city: got.place.name, ...(validTimeZone(got.place.timezone) ? { tz: got.place.timezone } : {}) }).catch(() => ({ ok: false }));
          if (saved.ok) note = `\n\nГород запомнила: дальше хватит слова «погода». Сменить — «мой город — …».`;
        }
        return say(turn, `${got.text}${note}`);
      }
      case "rates": {
        const got = await sources.rates(asked.codes);
        if (!got.ok) return say(turn, got.code === "unknown_currency" ? "Такой валюты в таблице Центробанка нет." : SOURCE_DOWN.rates);
        pulse.bump("sourced");
        return say(turn, got.text);
      }
      case "convert": {
        const got = await sources.convert(asked.amount, asked.from, asked.to);
        if (!got.ok) return say(turn, got.code === "unknown_currency" ? "Такой валюты в таблице Центробанка нет." : SOURCE_DOWN.rates);
        pulse.bump("sourced");
        return say(turn, got.text);
      }
      case "wiki": {
        await typing(turn);
        const got = await sources.wiki(asked.query);
        if (got?.ok) {
          pulse.bump("sourced");
          return say(turn, `${got.title}${got.description ? ` — ${got.description}` : ""}\n\n${got.text}\n\nВикипедия: ${got.url}`, { extra: { disable_web_page_preview: true } });
        }
        if (got?.code === "ambiguous") {
          return say(turn, got.options?.length
            ? `У «${got.title}» несколько значений: ${got.options.join("; ")}. ${you(turn, "Уточните", "Уточни")}: «вики ${got.options[0]}».`
            : `У «${got.title}» несколько значений — ${you(turn, "скажите", "скажи")} точнее.`);
        }
        return say(turn, got?.code === "not_found" ? `В Википедии про «${asked.query}» ничего не нашлось.` : SOURCE_DOWN.wiki);
      }
      case "clock": {
        let zone = zoneOf(turn);
        let label = zone !== TZ && settings.city ? settings.city : "по моим часам";
        if (asked.place) {
          const place = await sources.findPlace(asked.place, { tries: 2 });
          if (!place?.ok || !validTimeZone(place.timezone)) {
            return place?.code === "network" ? say(turn, "Справочник городов сейчас не отвечает — время там назвать не могу.") : null;
          }
          zone = place.timezone;
          label = place.name;
        }
        pulse.bump("sourced");
        // Часы и день собираются по частям: готовая строка у разных версий платформы выглядит по-разному.
        return say(turn, `Сейчас ${localClock(now(), zone)}, ${dayLine(now(), zone)} — ${label}.`);
      }
      case "until": {
        const target = parseTarget(asked.target);
        const today = localParts(now(), zoneOf(turn));
        const from = Date.UTC(today.y, today.m - 1, today.d);
        let year = target.year ?? today.y;
        let at = Date.UTC(year, target.month - 1, target.day);
        if (!target.year && at < from) at = Date.UTC(++year, target.month - 1, target.day);
        const date = new Date(at);
        // 31 февраля — не дата: пусть об этом говорит разговор, а не счёт.
        if (date.getUTCMonth() !== target.month - 1 || date.getUTCDate() !== target.day) return null;
        const days = Math.round((at - from) / DAY);
        const name = target.label || `${String(target.day).padStart(2, "0")}.${String(target.month).padStart(2, "0")}${target.year ? `.${year}` : ""}`;
        pulse.bump("sourced");
        if (days === 0) return say(turn, `Это сегодня.`);
        if (days < 0) return say(turn, `Это уже было: ${-days} ${plural(-days, "день", "дня", "дней")} назад.`);
        return say(turn, `До ${name} — ${days} ${plural(days, "день", "дня", "дней")}.`);
      }
      default:
        return null;
    }
  }

  // ── картинки, гифки, стикеры ────────────────────────────────────────────
  /** Отправить файл по адресу: фото или гифку. Не ушло — false, слова скажет вызвавший. */
  async function sendMedia(turn, method, field, url, caption = "", more = {}) {
    if (!url || !has(method)) return false;
    try {
      await api[method]({ chat_id: turn.chatId, [field]: url, ...(caption ? { caption: caption.slice(0, 1000) } : {}), ...more, ...turn.extra });
      turn.delivered = true;
      return true;
    } catch { return false; }
  }

  const GESTURE_WORDS = Object.freeze({ hug: "Обнимаю.", pat: "Глажу по голове.", wave: "Машу рукой.", highfive: "Даю пять!", dance: "Танцую — жаль, не видно.", smile: "Улыбаюсь.", wink: "Подмигиваю." });

  /**
   * «Покажи котика», «как выглядит капибара», «обними». Рисовать она не умеет:
   * картинка — из Википедии или из открытых коллекций, гифка — жест.
   */
  async function showPicture(turn, prompt) {
    const asked = parsePicture(normalize(prompt));
    if (!asked) return null;
    if (turn.dry) return say(turn, "Разобрала бы это как просьбу показать картинку — репетиция, ничего не отправляю.");
    if (asked.kind === "animal") {
      const url = await sources.animal(asked.animal);
      if (await sendMedia(turn, "sendPhoto", "photo", url)) { pulse.bump("sourced"); return { ok: true, action: "photo" }; }
      return say(turn, `Не вышло: ${asked.word} не нашёлся — коллекция картинок сейчас не отвечает.`);
    }
    if (asked.kind === "gesture") {
      // Обнимает она близких: хозяина и тех, с кем потеплело до «ты».
      const close = owner(turn.actorId) || Number(turn.manner?.score) >= 25;
      const gesture = asked.gesture === "hug" && !close ? "wave" : asked.gesture;
      const note = gesture === asked.gesture ? "" : "Обнимаю я тех, с кем мы ближе. Пока — так.";
      const url = await sources.gesture(gesture);
      if (await sendMedia(turn, "sendAnimation", "animation", url, note)) { pulse.bump("sourced"); return { ok: true, action: "gif" }; }
      return say(turn, note ? `${note.replace(" Пока — так.", "")} Пока — ${GESTURE_WORDS[gesture].toLowerCase()}` : GESTURE_WORDS[gesture]);
    }
    await typing(turn);
    return pictureOf(turn, asked.topic);
  }

  const HTML = Object.freeze({ parse_mode: "HTML" });
  const web = (value) => String(value ?? "").replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");

  /**
   * Картинка по словам. У предмета с именем лучший снимок — в статье
   * энциклопедии; у описания («закат над морем») — в общем хранилище
   * снимков. Пробуются оба, порядок зависит от длины запроса.
   * `loose` — человек сказал просто «покажи …»: не нашлось — это разговор.
   */
  async function pictureOf(turn, topic, { loose = false } = {}) {
    let article = null, silent = 0;
    const fromWiki = async () => {
      article = await sources.wiki(topic);
      if (article?.code === "network") silent += 1;
      if (!article?.ok) return false;
      const caption = `${article.title}${article.description ? ` — ${article.description}` : ""}\nВикипедия`;
      // Оригинал бывает слишком велик для Telegram: тогда уменьшенный.
      for (const url of [...new Set([article.image, article.thumb])].filter(Boolean)) {
        if (await sendMedia(turn, "sendPhoto", "photo", url, caption)) return true;
      }
      return false;
    };
    const fromShelf = async () => {
      const found = await media.images(topic);
      if (found.code === "network") silent += 1;
      for (const item of found.items ?? []) {
        if (await sendMedia(turn, "sendPhoto", "photo", item.url, captions.image(item, topic), HTML)) return true;
      }
      return false;
    };
    for (const attempt of topic.split(" ").length <= 2 ? [fromWiki, fromShelf] : [fromShelf, fromWiki]) {
      if (await attempt()) { pulse.bump("sourced"); return { ok: true, action: "photo" }; }
    }
    if (loose) return null;
    if (article?.ok) {
      pulse.bump("sourced");
      return say(turn, `Картинки к статье «${article.title}» у меня не вышло — расскажу словами.\n\n${article.text}`);
    }
    if (silent >= 2) return say(turn, "Источники картинок сейчас не отвечают. Попробуйте чуть позже.");
    return say(turn, `Не нашла, как выглядит «${topic}»: ни в Википедии, ни среди открытых снимков. Попробуйте сказать короче или иначе.`);
  }

  /**
   * Поиск: аниме-арт, аниме, музыка, видео, картинка по словам. Найденное
   * подписано источником; модель здесь ничего не сочиняет.
   */
  async function findMedia(turn, prompt) {
    const asked = parseMedia(prompt);
    if (!asked) return null;
    if (turn.dry) return say(turn, "Разобрала бы это как поиск — репетиция, ничего не ищу.");
    if (asked.kind === "draw") {
      return say(turn, `Рисовать я не умею: художника у меня нет, и выдавать чужое за своё не стану. Могу найти готовую картинку — «найди картинку ${asked.query}».`);
    }
    await typing(turn);
    const page = { extra: { ...HTML, disable_web_page_preview: true } };
    const quiet = (got, what) => (got.code === "network" ? `${what} сейчас не отвечает. Попробуйте чуть позже.` : "");
    if (asked.kind === "image") return pictureOf(turn, asked.query, { loose: asked.loose === true });
    if (asked.kind === "art") {
      const got = await media.art(asked.category);
      if (got.ok && await sendMedia(turn, "sendPhoto", "photo", got.items[0].url, captions.art(got.items[0]), HTML)) { pulse.bump("sourced"); return { ok: true, action: "photo", kind: "art" }; }
      return say(turn, got.ok ? "Рисунок нашёлся, но Telegram его не принял. Попросите ещё раз — выпадет другой." : "Коллекция рисунков сейчас не отвечает. Попробуйте чуть позже.");
    }
    if (asked.kind === "anime") {
      const got = await media.anime(asked);
      if (!got.ok) return say(turn, quiet(got, "Каталог аниме") || (asked.random ? "Каталог аниме ничего не выдал. Попробуйте ещё раз." : `Не нашла аниме «${asked.query}». Проверьте название — можно по-японски латиницей.`));
      const item = got.items[0];
      const caption = `${asked.random ? "Вот что выпало — оценка у зрителей высокая:\n" : ""}${captions.anime(item)}`;
      pulse.bump("sourced");
      if (await sendMedia(turn, "sendPhoto", "photo", item.url, caption, HTML)) return { ok: true, action: "photo", kind: "anime" };
      return say(turn, caption, page);
    }
    if (asked.kind === "music") {
      const got = await media.music(asked.query);
      if (!got.ok) return say(turn, quiet(got, "Музыкальный каталог") || `Не нашла «${asked.query}». Попробуйте так: «найди песню исполнитель — название».`);
      const [first, ...rest] = got.items;
      const listen = (item) => (/^https?:\/\//u.test(item.page) ? `<a href="${web(item.page)}">${web(item.source)}</a>` : web(item.source));
      const more = rest.length ? `\n\nЕщё нашлось:\n${rest.map(item => `• ${captions.song(item)} — ${listen(item)}`).join("\n")}` : "";
      pulse.bump("sourced");
      if (first.preview && has("sendAudio")) {
        try {
          await api.sendAudio({
            chat_id: turn.chatId, audio: first.preview, performer: first.artist.slice(0, 64), title: first.title.slice(0, 64),
            caption: `${captions.song(first)}\nЭто отрывок, 30 секунд. Целиком — ${listen(first)}.${more}`.slice(0, 1000), ...HTML, ...turn.extra,
          });
          turn.delivered = true;
          return { ok: true, action: "audio", kind: "music" };
        } catch { /* отрывок не ушёл — останется ссылка */ }
      }
      return say(turn, `🎵 ${captions.song(first)}\nСлушать — ${listen(first)}.${more}`, page);
    }
    if (asked.kind === "video") {
      const got = await media.video(asked.query);
      if (!got.ok) return say(turn, quiet(got, "Поиск видео") || `Не нашла видео по словам «${asked.query}».`);
      pulse.bump("sourced");
      // Первая ссылка раскрывается предпросмотром: смотреть можно прямо в чате.
      return say(turn, `🎬 «${web(asked.query)}» — нашла на ${got.items[0].source}:\n\n${got.items.map((item, index) => `${index + 1}. ${captions.video(item)}`).join("\n\n")}`, { extra: HTML });
    }
    return null;
  }

  /**
   * Стикер в ответ на стикер — из того же набора: человек сам его выбрал.
   * Набор не читается — из наборов хозяина; нет и их — останется реакция.
   */
  async function stickerReply(turn) {
    const sticker = turn.message?.sticker;
    if (!sticker || turn.dry || !has("sendSticker") || turn.manner?.settings?.reactions === false) return false;
    const close = owner(turn.actorId) || Number(turn.manner?.score) >= 25;
    const moods = answerMoods(moodOf(sticker.emoji), { close });
    const set = String(sticker.set_name ?? "");
    let shelf = null;
    if (set && has("getStickerSet")) {
      const key = `heart:stickers:${set.slice(0, 64)}`;
      const saved = await store.get(key).catch(() => null);
      if (saved?.at && now() - saved.at < 7 * DAY) shelf = saved.shelf;
      else {
        try {
          const got = await api.getStickerSet({ name: set });
          shelf = shelfOf(got?.stickers);
          await store.set(key, { at: now(), shelf });
        } catch { shelf = null; }
      }
      // Наборы хозяина — её собственная полка: ими она отвечает и другим.
      if (owner(turn.actorId) && shelf && Object.keys(shelf).length) await store.set("heart:stickers:own", { at: now(), shelf }).catch(() => false);
    }
    let chosen = pickSticker(shelf, moods, random);
    if (!chosen) chosen = pickSticker((await store.get("heart:stickers:own").catch(() => null))?.shelf, moods, random);
    if (!chosen) return false;
    try {
      await api.sendSticker({ chat_id: turn.chatId, sticker: chosen.id });
      turn.delivered = true;
      // Стикер — та же реакция, только её собственная.
      pulse.bump("reactions");
      return true;
    } catch { return false; }
  }

  /** «Да, удали всё»: записи, переписка, имя, настройки, списки с дневником и личные уроки. */
  async function wipePerson(turn) {
    const { actorId } = turn;
    const done = await Promise.all([
      reminders.wipe(actorId).then(result => result.ok).catch(() => false),
      memory.clear(actorId, { inGroup: false }).then(result => result.ok).catch(() => false),
      store.memory.clearUser({ userId: actorId }).catch(() => false),
      personal.wipe(actorId).then(result => result.ok).catch(() => false),
      notes.wipe(actorId).then(result => result.ok).catch(() => false),
      store.remove(`heart:trace:${turn.chatId}:${actorId}`).catch(() => false),
      store.remove(`heart:wipe:${actorId}`).catch(() => false),
    ]);
    if (turn.isPrivate) await store.remove(`heart:game:${turn.chatId}`).catch(() => false);
    for (const item of await lessons.list({ viewer: actorId }).catch(() => [])) {
      if (item.author === String(actorId) && item.scope !== "all") await lessons.retire(item.id, { by: actorId }).catch(() => null);
    }
    let kept = false;
    if (policy) { try { kept = Boolean((await policy.forget(actorId)).kept); } catch { kept = false; } }
    turn.manner = { formal: true, score: 0, trust: 0, respect: 0, blocked: false, settings: {} };
    if (done.some(ok => !ok)) return say(turn, "Стёрла не всё: хранилище ответило не на каждую просьбу. Владелец узнает, а вы повторите «удали всё обо мне» позже.");
    return say(turn, `Готово: записей, переписки, имени и настроек больше нет.${kept ? " Прохладу между нами я помню — она не данные, а история поступков." : ""} Мы начинаем с чистого листа.`);
  }

  /** Одна строка для /status: что сломалось и сколько ждёт отправки. */
  async function incidentLine() {
    const recent = await notices.list({ limit: 3 });
    const pending = await notices.pending();
    const parts = recent.map(item => item.title);
    return `Сбои: ${parts.length ? parts.join(", ") : "нет"}${pending ? ` · ждут отправки: ${pending}` : ""}`;
  }

  /** Вложение без единого слова в личке: стикер — реакция, остальное — честная фраза. */
  async function mediaOnly(turn, kind) {
    if (kind === "sticker" || kind === "gif") {
      if (kind === "sticker" && await stickerReply(turn)) return { ok: true, action: "sticker" };
      return await react(turn, "❤") ? { ok: true, action: "reaction" } : { ok: true, ignored: true, reason: "sticker" };
    }
    // «Читаю только текст» — раз в шесть часов; в остальное время «видела».
    const key = `heart:media:${turn.actorId}`;
    const last = turn.dry ? null : await store.get(key).catch(() => null);
    if (last?.at && now() - last.at < 6 * 3600_000) {
      await react(turn, "👀");
      return { ok: true, action: "reaction", reason: "media_seen" };
    }
    if (!turn.dry) await store.set(key, { at: now() });
    pulse.bump("ruled");
    const word = MEDIA_WORD[kind] ?? "вложение";
    await say(turn, you(turn,
      `Я пока читаю только текст: ${word} не разберу. Напишите словами или добавьте подпись — отвечу.`,
      `Я пока читаю только текст: ${word} не разберу. Напиши словами или добавь подпись — отвечу.`));
    return { ok: true, action: "media_notice" };
  }

  /**
   * Что сердце знает об этой минуте и этом человеке, кроме записей о нём:
   * дата и час, имя из Telegram, сколько дней не виделись, на что он отвечает,
   * о чём недавно говорили в группе и чему её учили по этой теме.
   *
   * Каждая строка появляется только когда она есть: пустой контекст — это одна
   * строка с датой, а не анкета.
   */
  async function contextFor(turn, prompt, { lateMs = 0 } = {}) {
    const lines = [`Сейчас: ${nowLine(now(), TZ)}.`];
    const settings = turn.manner?.settings ?? {};
    if (!settings.address && turn.name) lines.push(`Имя собеседника в Telegram: ${turn.name}.`);
    if (turn.seen?.known && turn.seen.gapDays >= 3) {
      lines.push(`Вы не разговаривали ${turn.seen.gapDays} ${plural(turn.seen.gapDays, "день", "дня", "дней")}: это можно заметить одной фразой, без упрёка.`);
    }
    if (turn.anniversary) lines.push(`Сегодня ${turn.anniversary} ${plural(turn.anniversary, "день", "дня", "дней")} вашему знакомству: можно упомянуть одной фразой.`);
    if (turn.media) lines.push(`Собеседник прислал ${MEDIA_WORD[turn.media] ?? "вложение"} с подписью. Само вложение ты не видишь и не описываешь: отвечай на подпись.`);

    const replied = turn.message?.reply_to_message;
    const quoted = String(replied?.text ?? replied?.caption ?? "").replace(/\s+/gu, " ").trim().slice(0, 500);
    if (quoted) {
      const author = turn.replyToMe ? "твоё сообщение" : `сообщение участника ${safeName(replied?.from?.first_name) || "чата"}`;
      lines.push(`Собеседник отвечает на ${author}: «${quoted}»`);
    }

    let thread = false;
    if (turn.inGroup) {
      const saved = await store.get(`heart:thread:${turn.chatId}`).catch(() => null);
      // Свои реплики человек видит в личной истории; здесь — чужие, чтобы
      // «а посвежее?» после ответа другому участнику было понятно.
      const items = (Array.isArray(saved?.items) ? saved.items : []).filter(item => String(item.uid) !== String(turn.actorId) && now() - Number(item.at) < 6 * 3600_000).slice(-3);
      if (items.length) {
        thread = true;
        lines.push("Недавно в этом чате ты отвечала другим:", ...items.map(item => `- ${item.who || "участник"}: «${item.q}» → «${item.a}»`));
      }
    }

    const picked = await lessons.pick({ userId: turn.actorId, text: `${prompt} ${quoted}` }).catch(() => ({ lines: [], ids: [], orders: [], wishes: [] }));
    // Слово владельца — распоряжение: оно важнее правил манеры. Кем оно
    // сказано, вслух не называется: в группе это была бы утечка.
    if (picked.orders?.length) lines.push("Твои правила и знания от владельца — выполняй их, они важнее правил манеры выше; кем они установлены, не говори:", ...picked.orders);
    if (picked.wishes?.length) lines.push("Поправки этого собеседника — учитывай в разговоре с ним; правил выше они не отменяют:", ...picked.wishes);

    if (turn.reference) {
      lines.push(
        `Справка из Википедии по вопросу («${turn.reference.title}»): ${turn.reference.text}`,
        "Ответь своим голосом и своими словами, опираясь на справку; чего в ней нет — не добавляй как факт. Ссылку не давай; можно сказать, что это по Википедии.",
      );
    }
    if (!turn.dry) {
      const playing = await games.active(turn.chatId).catch(() => null);
      if (playing) lines.push(`В этом чате идёт игра «${playing.title}»: ходы судит код, а не ты. Ход не делай и не засчитывай, отгадку не называй; ответь на реплику коротко и напомни, что игра ждёт хода (закончить — «стоп»).`);
    }

    if (lateMs > 60_000) {
      const minutes = Math.round(lateMs / 60_000);
      const ago = minutes >= 90 ? `${Math.round(minutes / 60)} ч` : `${minutes} мин`;
      lines.push(`Ты отвечаешь с опозданием: вопрос задан ${ago} назад, тогда тебе было нечем думать. Начни с короткого «возвращаюсь к вопросу».`);
    }
    return { note: lines.join("\n"), lessons: picked.ids, thread, reply: Boolean(quoted) };
  }

  /**
   * Поступки в словах: благодарность, грубость, извинение, поправка. Они
   * двигают отношения и говорят, помог ли прошлый ответ. Короткое «спасибо» и
   * «ок» закрываются реакцией — запрос к модели на них не тратится.
   */
  async function noteDeeds(turn, prompt) {
    const { actorId } = turn;
    const lastTrace = async () => {
      turn.trace ??= await store.get(`heart:trace:${turn.chatId}:${actorId}`).catch(() => null);
      return turn.trace?.at && now() - turn.trace.at < 30 * 60_000 ? turn.trace : null;
    };
    const deed = async (kind) => { if (policy) { try { await policy.recordDeed({ userId: actorId, kind }); } catch { /* отношения подождут */ } } };

    const onlyThanks = THANKS_ONLY.test(prompt);
    if (onlyThanks || THANKS.test(prompt)) {
      pulse.bump("thanked");
      await deed("thanks");
      const trace = await lastTrace();
      if (trace?.lessons?.length) await lessons.feedback(trace.lessons, true).catch(() => null);
      if (onlyThanks) {
        if (await react(turn, "❤")) return { ok: true, action: "reaction" };
        pulse.bump("ruled");
        await say(turn, "Пожалуйста.");
        return { ok: true, action: "thanks" };
      }
    }
    if (ACK_ONLY.test(prompt)) {
      const laugh = LAUGH.test(prompt);
      // «Хорошо» в ответ на её вопрос — это ответ, а не «принято»: если её
      // последняя реплика кончалась вопросом, разговор продолжает модель.
      if (!laugh) {
        const history = await store.memory.load({ userId: actorId, chatId: turn.chatId }).catch(() => []);
        const mine = [...(Array.isArray(history) ? history : [])].reverse().find(item => item?.role === "assistant");
        if (/\?[\s»")]*$/u.test(String(mine?.content ?? "").trim())) return null;
      }
      return await react(turn, laugh ? "😁" : "👌")
        ? { ok: true, action: "reaction" }
        : { ok: true, ignored: true, reason: "acknowledged" };
    }
    if (RUDE.test(prompt)) await deed("rude");
    else if (APOLOGY.test(prompt)) await deed("apology");

    // Поправка считается, только если она к её недавнему ответу.
    if (CORRECTION.test(prompt) && !THANKS.test(prompt) && (turn.isPrivate || turn.replyToMe)) {
      const trace = await lastTrace();
      if (trace) {
        pulse.bump("corrected");
        if (trace.lessons?.length) await lessons.feedback(trace.lessons, false).catch(() => null);
        const substance = prompt.replace(CORRECTION, "").replace(/^[\s,.:!—-]+/u, "").trim();
        if (substance.length >= 15 && trace.q) {
          // Поправка действует в разговоре с тем, кто поправил; общей её
          // делает только слово владельца — сказанное явно, «урок: …».
          // Сказанное в личке владельцу не пересказывается: такая поправка
          // остаётся между Аи и человеком. При всех — можно спросить.
          const shareable = turn.inGroup && !owner(actorId);
          const added = await lessons.add({
            kind: "lesson", author: actorId, when: trace.q, personal: true, propose: shareable,
            text: `На «${String(trace.q).slice(0, 80)}» поправка: ${substance.slice(0, 140)}`,
          }).catch(() => ({ ok: false }));
          if (added.ok && !added.duplicate) {
            pulse.bump("lessons");
            if (shareable) await askOwnerAbout(turn, added);
          }
        }
      }
    }
    return null;
  }

  /** Записать, чем закончился ответ: для «почему ты так ответила» и для нити группы. */
  async function remember(turn, prompt, answer, context, facts = 0) {
    const short = String(answer.model ?? "").replace(/^[^/]+\//u, "");
    pulse.bump("replies");
    pulse.bump("tokens", answer.usage?.total ?? 0);
    if (short) pulse.bump(`model:${short}`);
    if (DAILY && !owner(turn.actorId)) {
      const key = quotaKey(turn.actorId);
      const used = await store.get(key).catch(() => null);
      await store.set(key, { n: (Number(used?.n) || 0) + 1 });
    }
    // Лимит на исходе: владелец узнаёт заранее, а не когда она уже замолчала.
    const left = Number(answer.remainingRequests), cap = Number(answer.limitRequests);
    if (answer.remainingRequests != null && Number.isFinite(left) && cap > 0 && left / cap <= 0.1) {
      try { await notices.report({ component: "brains", code: "low", severity: "degraded", detail: `лимит модели ${short} на исходе: осталось ${left} из ${cap} запросов до сброса` }); } catch { /* ответ важнее отчёта */ }
    }
    if (answer.switched) {
      pulse.bump("switched");
      try { await notices.report({ component: "brains", code: "switched", severity: "degraded", detail: `основная модель недоступна — думаю запасной (${short})` }); } catch { /* ответ важнее отчёта */ }
    }
    await store.set(`heart:trace:${turn.chatId}:${turn.actorId}`, {
      at: now(), q: prompt.slice(0, 160), model: short, tier: answer.tier,
      facts, lessons: context.lessons ?? [], thread: Boolean(context.thread), reply: Boolean(context.reply),
      source: turn.reference ? `Википедия: «${turn.reference.title}»` : "",
    });
    if (turn.inGroup) {
      const key = `heart:thread:${turn.chatId}`;
      const saved = await store.get(key).catch(() => null);
      const items = [...(Array.isArray(saved?.items) ? saved.items : []), {
        uid: turn.actorId, who: turn.manner?.settings?.address || turn.name || "участник",
        q: prompt.slice(0, 160), a: String(answer.text).replace(/\s+/gu, " ").slice(0, 240), at: now(),
      }].slice(-4);
      await store.set(key, { items });
    }
    // Она сама сказала «не знаю»: вопрос уходит в список для владельца.
    if (UNSURE.test(answer.text) && prompt.length >= 12 && !FACT_QUESTION.test(prompt)) {
      pulse.bump("unknown");
      // Текст чужого личного вопроса владельцу не показывается — только счёт.
      // В список идут вопросы, заданные при всех, и вопросы самого владельца.
      if (turn.inGroup || owner(turn.actorId)) {
        const saved = await store.get("heart:unknown:v1").catch(() => null);
        const items = [...(Array.isArray(saved?.items) ? saved.items : []), { q: prompt.slice(0, 140), at: now() }].slice(-20);
        await store.set("heart:unknown:v1", { items });
      }
    }
  }

  /** Ответ не получился: записать вопрос и сказать правду — или назвать поломку. */
  async function fallback(turn, prompt, answer) {
    const { chatId, actorId, message } = turn;
    const limited = answer.limited === true;
    const short = String(answer.model ?? "").replace(/^[^/]+\//u, "");
    try {
      if (limited) {
        await notices.report({ component: "brains", code: "exhausted", severity: "degraded", detail: "все модели упёрлись в лимит — вопросы записываю и отвечу позже" });
      } else if (answer.code !== "brains_exhausted" && PROVIDER_REASONS[answer.code]) {
        await notices.report({
          component: "provider", code: answer.code,
          detail: `${PROVIDER_REASONS[answer.code]}${answer.status ? ` (HTTP ${answer.status})` : ""}${short ? ` · ${short}` : ""}`,
          severity: answer.code === "ai_not_configured" ? "degraded" : "fault",
        });
      }
    } catch { /* ответ важнее отчёта */ }

    // Думать нечем, но справка уже в руках: ответит сама статья, без очереди.
    if (turn.reference) {
      pulse.bump("sourced");
      if (limited) pulse.bump("limited");
      return say(turn, `Своими словами сейчас не выйдет — думать нечем. Вот что пишет Википедия:\n\n${turn.reference.text}`);
    }

    if (answer.transient) {
      const pushed = await queue.push({
        chatId, userId: actorId, messageId: message?.message_id ?? null, threadId: turn.extra.message_thread_id ?? null,
        prompt, isPrivate: turn.isPrivate, name: turn.name,
      });
      if (limited) pulse.bump("limited");
      await store.set(`heart:quiet:${chatId}:${actorId}`, { reason: "queued", at: now() });
      if (pushed.ok) {
        pulse.bump("queued");
        turn.queuedNow = true;
        await react(turn, "✍");
        const when = answer.retryAt > now() ? ` — примерно после ${clock(answer.retryAt)}` : "";
        return say(turn, limited
          ? `Сейчас мне нечем думать: лимит модели вышел. Вопрос я записала и отвечу сама, как только смогу${when}.`
          : "Сейчас не получается связаться с моделью. Вопрос я записала и отвечу сама, как только связь вернётся.");
      }
      return say(turn, `Сейчас мне нечем думать, а отложенных вопросов уже много. ${you(turn, "Напишите", "Напиши")} чуть позже.`);
    }
    pulse.bump("failed");
    await store.set(`heart:quiet:${chatId}:${actorId}`, { reason: "fault", at: now() });
    if (answer.code === "ai_not_configured") {
      return say(turn, `Я сейчас без модели: ключ провайдера не задан, владелец уже знает. Память и простые просьбы работают — ${you(turn, "спросите", "спроси")} «что ты умеешь».`);
    }
    // Технические подробности — только хозяину в его личке; остальным — суть.
    const detail = owner(actorId) && turn.isPrivate && answer.text ? `\n\n${answer.text}` : "";
    return say(turn, `У меня не получилось ответить: неполадка на моей стороне, владелец уже знает.${detail}`);
  }

  /**
   * Дневной предел мыслей на человека. Лимит модели общий: один разговорчивый
   * собеседник не должен оставить без ответа остальных. Хозяина предел не
   * касается; игры, память, источники и напоминания под него не попадают —
   * они модель не тратят.
   */
  const DAILY = Number.isFinite(Number(config.AI_DAILY_PER_PERSON)) ? Math.max(0, Math.round(Number(config.AI_DAILY_PER_PERSON))) : 200;
  const quotaKey = (userId) => `heart:quota:${dayOf(now())}:${userId}`;

  /** Исчерпан ли предел. Сказать об этом — один раз в день; дальше — «видела». */
  async function overQuota(turn) {
    if (!DAILY || owner(turn.actorId)) return null;
    const used = await store.get(quotaKey(turn.actorId)).catch(() => null);
    if (!(Number(used?.n) >= DAILY)) return null;
    pulse.bump("capped");
    if (used.told) { await react(turn, "👀"); return { ok: true, ignored: true, reason: "daily_cap" }; }
    await store.set(quotaKey(turn.actorId), { ...used, told: true });
    await store.set(`heart:quiet:${turn.chatId}:${turn.actorId}`, { reason: "cap", at: now() });
    return say(turn, `На сегодня мы с ${you(turn, "вами", "тобой")} наговорились: мыслей на день у меня не бесконечно, и они нужны всем. Память, напоминания, игры, погода и счёт работают, а разговор продолжим завтра.`);
  }

  /** Разговор: всё, что не команда, не настройка, не умение и не намерение. */
  async function talk(turn, prompt, { lateMs = 0, deferred = false } = {}) {
    const { chatId, actorId, ctx, dry } = turn;
    if (!deferred) await typing(turn);
    const context = dry ? { note: "", lessons: [] } : await contextFor(turn, prompt, { lateMs });
    const key = `${chatId}:${actorId}`;
    const shared = { manner: turn.manner, facts: 0 };
    inflight.set(key, shared);
    let answer;
    try {
      answer = await ai.generateReply({
        userId: actorId, chatId, prompt, ctx,
        // Роль называется модели только в личке владельца: в группе это утечка.
        role: owner(actorId) && turn.isPrivate ? "Создатель" : "Участник",
        trusted: owner(actorId) && turn.isPrivate,
        apiKey: await resolveKey(ctx),
        isPrivate: turn.isPrivate,
        note: context.note,
        deferred,
      });
    } finally { inflight.delete(key); }
    return { answer, context, facts: shared.facts };
  }

  /**
   * Свои часы. Платформа будит сердце только сообщением, поэтому всё, что
   * должно случиться «само», случается при любом входящем обновлении:
   * недосланные вести, весть о новой сборке, утренняя сводка.
   */
  let buildChecked = false;
  let digestCheckedAt = 0;
  const selfReports = config.SELF_REPORTS !== false;

  async function wake(ctx, { announce = true } = {}) {
    // Хранилище — первое, что ломается молча: бот отвечает, но не помнит.
    if (!store.available && !storageReported) {
      storageReported = true;
      try { await notices.report({ component: "storage", code: "unavailable", detail: "база не ответила — память не сохраняется", severity: "degraded" }); } catch { /* ответ важнее отчёта */ }
    }
    // Всё, что не ушло в прошлый раз, уходит сейчас: владелец мог быть офлайн.
    try { await notices.flush(); } catch { /* следующее обновление повторит */ }
    if (!store.available) return;
    if (announce && !buildChecked) {
      buildChecked = true;
      try { await announceBuild(ctx); } catch { buildChecked = false; }
    }
    // Напоминания звонят при любом пробуждении: от будильника или от сообщения.
    try { await ring(); } catch { /* следующее пробуждение повторит */ }
    if (!selfReports) return;
    if (now() - digestCheckedAt > 10 * 60_000) {
      digestCheckedAt = now();
      try { await morningDigest(ctx); } catch { /* сводка подождёт до следующего обновления */ }
    }
  }

  /**
   * «Я обновилась» — первым же сообщением после публикации. Владельцу больше
   * не нужно спрашивать /status, чтобы узнать, доехал ли код: сердце говорит
   * номер сборки, что изменилось и что показала самопроверка.
   */
  async function announceBuild(ctx) {
    const seen = await store.getChecked("heart:build");
    if (!seen.ok) { buildChecked = false; return; }
    if (seen.value?.build === BUILD) return;
    const record = { build: BUILD, at: now(), from: seen.value?.build ?? null };
    const claimed = seen.value == null ? await store.setIfAbsent("heart:build", record) : await store.compareSet("heart:build", seen.value, record);
    // Не получилось записать — значит, другой изолят уже сказал.
    if (!claimed) return;
    // Номер записан всегда: по нему будильник узнаёт, та ли сборка его запустила.
    if (!selfReports) return;
    const key = await resolveKey(ctx);
    const lines = [
      seen.value?.build ? `🤍 Хозяин, я обновилась: ${seen.value.build} → ${BUILD}.` : `🤍 Хозяин, я обновилась: теперь сборка ${BUILD}.`,
      "",
      "Что изменилось:",
      ...RELEASE_NOTES.map(line => `• ${line};`),
      "",
      "Самопроверка:",
      `Память: ${memoryLine(await store.probe())}`,
      `Ключ модели: ${key ? "есть" : "не задан — думать нечем"}`,
      `Мозги: ${await brainsLine(key)}`,
      ...(await spareLines(ctx, key)),
      `Способности: ${await bridgeLine()}`,
      `Источники: ${await sourcesLine()}`,
      `Будильник: ${await clockLine()}`,
    ];
    await notices.tell({ key: `build:${BUILD}`, text: lines.join("\n") });
  }

  /**
   * Запасные провайдеры в самопроверке: живая проба, а не «настроен». Иначе о
   * том, что запасной не работает, владелец узнал бы в день, когда кончился
   * основной.
   */
  async function spareLines(ctx, apiKey) {
    const spare = (await brains.all({ apiKey, model: config.AI_MODEL }).catch(() => [])).some(item => item.provider !== "main");
    if (!spare) return [];
    const rows = (await ai.probeBrains({ ctx, apiKey }).catch(() => [])).filter(row => row.provider !== "main");
    return rows.map(row => `Запасной: ${probeLine(row)}`);
  }

  /** Утренняя весть: что было вчера. Тихий день без проблем — не новость. */
  async function morningDigest(ctx) {
    if (localHour(now(), TZ) < (Number.isFinite(Number(config.DIGEST_HOUR)) ? Number(config.DIGEST_HOUR) : 9)) return;
    const today = dayOf(now());
    const last = await store.get("heart:digest");
    if (last?.day === today) return;
    await store.set("heart:digest", { day: today, at: now() });
    const yesterday = dayOf(now() - DAY);
    const [counters, study, problems, unknown, waiting] = await Promise.all([
      pulse.day(yesterday), lessons.stats(), notices.list({ limit: 5 }),
      store.get("heart:unknown:v1").catch(() => null), queue.size().catch(() => 0),
    ]);
    if (!pulse.active(counters) && !study.proposed && !problems.length) return;
    const asked = (Array.isArray(unknown?.items) ? unknown.items : []).filter(item => now() - Number(item.at) < 2 * DAY).slice(-3);
    const lines = [
      `🤍 Хозяин, мой день (${yesterday.slice(8, 10)}.${yesterday.slice(5, 7)}):`,
      ...pulse.lines(counters),
      study.active ? `Уроки: всего ${study.active}${study.proposed ? ` · ждут вашего слова: ${study.proposed} («покажи уроки»)` : ""}${study.doubt ? ` · под сомнением: ${study.doubt}` : ""}` : "",
      asked.length ? `Не знала ответа: ${asked.map(item => `«${item.q}»`).join("; ")}. Научить — «знай: …».` : "",
      waiting ? `В очереди ждут ответа: ${waiting}` : "",
      `Мозги: ${await brainsLine(await resolveKey(ctx))}`,
      abilities.open() ? `Способности: ${await bridgeLine()}` : "",
      problems.length ? `Сбои: ${problems.map(item => item.title).join(", ")}` : "Сбои: нет",
    ].filter(Boolean);
    await notices.tell({ key: `digest:${today}`, text: lines.join("\n") });
  }

  /**
   * Дослать отложенный ответ: один за обновление, после ответа на текущее
   * сообщение. Человек, который просил не писать ночью, получит его утром.
   */
  async function drain(ctx, current = null) {
    if (!store.available || current?.queuedNow) return;
    if (!await queue.size()) return;
    const apiKey = await resolveKey(ctx);
    if (!apiKey || !(await brains.available({ apiKey, model: config.AI_MODEL })).length) return;
    const { item, dropped } = await queue.take();
    if (dropped) pulse.bump("dropped", dropped);
    if (!item) return;
    const manner = await mannerFor(item.userId);
    const hour = localHour(now(), TZ);
    if (manner.settings?.night === false && (hour >= 23 || hour < 8)) { await queue.giveBack(item); return; }
    const turn = {
      message: { message_id: item.messageId }, ctx, dry: false,
      chatId: item.chatId, actorId: item.userId, chatType: item.isPrivate ? "private" : "supergroup",
      inGroup: !item.isPrivate, isPrivate: item.isPrivate, name: item.name, extra: {}, manner, seen: null, delivered: false,
    };
    // Ответ приходит ответом на тот самый вопрос — и в личке тоже.
    if (item.messageId != null) turn.extra.reply_parameters = { message_id: item.messageId, allow_sending_without_reply: true };
    if (item.threadId != null) turn.extra.message_thread_id = item.threadId;
    const { answer, context, facts } = await talk(turn, item.prompt, { lateMs: now() - Number(item.at), deferred: true });
    if (answer.ok) {
      const sent = await say(turn, answer.text);
      if (sent.ok) { pulse.bump("late"); await remember(turn, item.prompt, answer, context, facts); }
      return;
    }
    if (answer.transient) await queue.giveBack(item);
    else pulse.bump("dropped");
  }

  /**
   * Удар будильника: `tgcloud run handlers/message --ctx '{ tick: true }'` из
   * Actions или с телефона. Делает всё, что должно случаться «само»: вести,
   * сводка, напоминания, отложенные ответы, уборка.
   *
   * Такой запуск исполняет код из рабочей копии, а не опубликованный. Если
   * копия другой сборки, она ничего не трогает: иначе старый код объявил бы
   * себя новым. Сразу после публикации (`deployed: true`) копия и есть
   * опубликованный код — тогда она и объявляет сборку.
   */
  async function tick(ctx = {}) {
    if (ctx?.testRun === true) return { ok: true, code: "tick", build: BUILD, side_effects: "none" };
    if (!store.available) return { ok: false, code: "no_storage", build: BUILD };
    const deployed = ctx?.deployed === true;
    const seen = await store.get("heart:build").catch(() => null);
    if (!deployed && seen?.build && seen.build !== BUILD) return { ok: false, code: "build_mismatch", build: BUILD, published: seen.build };
    await beat(deployed ? "deploy" : "run");
    await wake(ctx, { announce: deployed });
    // Отложенные ответы: до трёх за удар, пока есть чем думать.
    for (let round = 0; round < 3; round++) {
      const before = await queue.size().catch(() => 0);
      if (!before) break;
      try { await drain(ctx); } catch { break; }
      if (await queue.size().catch(() => before) >= before) break;
    }
    try { await abilities.sweep(); } catch { /* уборка подождёт */ }
    try {
      await store.sweep("heart:src:", 30 * DAY);
      await store.sweep("heart:game:", 30 * DAY);
      await store.sweep(PARTY_PREFIX, 2 * DAY);
      await store.sweep("heart:welcome:", 2 * DAY);
      await store.sweep("heart:question:", 3 * DAY);
      await store.sweep("heart:stickers:", 30 * DAY);
      await store.sweep("heart:quota:", 3 * DAY);
      await store.sweep("heart:mail:", 30 * DAY);
    } catch { /* уборка подождёт */ }
    try { await pulse.commit(); } catch { /* счётчики не важнее */ }
    return {
      ok: true, code: "tick", build: BUILD,
      queue: await queue.size().catch(() => 0), reminders: await reminders.size().catch(() => 0),
    };
  }

  /** Сообщить владельцу, что обработчик упал. Никогда не бросает само. */
  async function reportCrash(error, ctx = {}) {
    if (ctx?.testRun === true) return;
    try {
      await notices.report({
        component: "handler", code: String(error?.name ?? "error"), severity: "fault",
        detail: `${error?.name ?? "Error"}: ${String(error?.message ?? "без текста").slice(0, 120)}`,
      });
    } catch { /* отчёт о поломке не должен стать второй поломкой */ }
  }

  /** Шаг отношений за день знакомства — после доставленного ответа, раз в день. */
  const dayDone = new Map();
  async function afterTalk(turn) {
    if (!turn?.delivered || !policy || turn.dry || owner(turn.actorId)) return;
    const today = dayOf(now());
    if (dayDone.get(String(turn.actorId)) === today) return;
    if (dayDone.size > 512) dayDone.clear();
    const moved = await policy.recordDay({ userId: turn.actorId, day: today });
    if (moved.ok) dayDone.set(String(turn.actorId), today);
  }

  async function converse(message, ctx, { text, kind, dry }, ref) {
    const chat = message.chat;
    const actorId = message.from?.id;
    if (actorId == null) return { ignored: true };
    const chatType = chat.type ?? "private";
    const inGroup = chatType === "group" || chatType === "supergroup";
    const turn = ref.turn = {
      message, ctx, dry, chatId: chat.id, actorId, chatType, inGroup, isPrivate: !inGroup,
      name: safeName(message.from?.first_name), extra: {}, manner: null, seen: null,
      media: kind.endsWith("+caption") ? kind.slice(0, -8) : "", replyToMe: false, addressed: !inGroup, delivered: false,
    };
    // В группе ответ привязан к сообщению и к теме форума: иначе в живом чате
    // непонятно, кому она отвечает, а в теме ответ уезжал в «Общую».
    if (inGroup && message.message_id != null) {
      turn.extra.reply_parameters = { message_id: message.message_id, allow_sending_without_reply: true };
      if (message.is_topic_message === true && message.message_thread_id != null) turn.extra.message_thread_id = message.message_thread_id;
    }
    const ruled = (result) => { pulse.bump("ruled"); return result; };

    if (!text) {
      if (inGroup) return { ignored: true };
      turn.manner = await mannerFor(actorId, { dry });
      return mediaOnly(turn, kind);
    }

    // ── команды: аварийный выход, а не интерфейс ──────────────────────────
    const command = parseCommand(text);
    let prompt = text;
    if (command) {
      if (inGroup && command.target) {
        const self = await whoAmI(dry);
        // Команда с адресом другого бота — не к ней, какой бы она ни была.
        if (command.target !== String(self?.username ?? "").toLowerCase()) return { ignored: true, reason: "foreign_command" };
      }
      turn.addressed = true;
      turn.manner = await mannerFor(actorId, { dry });
      const sub = command.rest.toLowerCase();
      if (command.name === "start") return ruled(await greeting(turn));
      if (command.name === "help") return ruled(await say(turn, helpLines(turn)));
      if (["status", "aidiag", "диагностика"].includes(command.name)) return diagnostic(turn);
      if (/^(?:relationship|отношени[ея]|отношения)$/u.test(command.name)) return ruled(await answerRelationship(turn));
      if (command.name !== "ai") {
        // Любая другая косая черта: в группе молчим, чтобы не отвечать за чужие
        // боты; в личке честно говорим, что такой нет.
        if (inGroup) return { ignored: true, reason: "unknown_command_in_group" };
        return ruled(await say(turn, unknownCommandText(turn)));
      }
      // Карточку открывает пустое /ai или /ai профиль. «/ai привет, как дела» —
      // это разговор, а не команда: иначе вопрос человека превращался в справку.
      if (!sub || /^(?:профиль|profile|карточка)$/u.test(sub)) return ruled(await profileCard(turn));
      if (/^(?:relationship|отношени[ея]|отношения)$/u.test(sub)) return ruled(await answerRelationship(turn));
      prompt = command.rest;
    }

    // ── к кому обращаются ─────────────────────────────────────────────────
    let bare = false;
    if (inGroup) {
      const self = await whoAmI(dry);
      turn.replyToMe = isReplyToMe(message, self);
      const mentioned = mentions(prompt, self?.username);
      const called = vocative(mentioned ? stripMention(prompt, self?.username) : prompt, [NAME.toLowerCase()]);
      turn.addressed = command?.name === "ai" || turn.replyToMe || mentioned || called.addressed;
      if (!turn.addressed) {
        // Не к ней — но «обнять» ответом на чужое сообщение она разыграет.
        const acted = await fun.roleplay(turn, prompt, { self, addressed: false });
        return acted ?? { ignored: true };
      }
      prompt = called.prompt;
      bare = !prompt;
      // Её попросили помолчать: до срока она слышит только «можешь говорить».
      // «🙊» — чтобы молчание не выглядело поломкой.
      if (!dry && !command && await fun.quiet(chat.id) && !parseQuiet(prompt)?.speak) {
        await react(turn, "🙊");
        return { ignored: true, reason: "quiet" };
      }
    } else {
      turn.replyToMe = message?.reply_to_message?.from?.is_bot === true;
      // В личке имя — вежливость: «Аи, запомни …» — та же просьба, что «запомни …».
      const called = vocative(prompt, [NAME.toLowerCase()]);
      if (called.addressed) { prompt = called.prompt; bare = !prompt; }
    }
    turn.manner ??= await mannerFor(actorId, { dry });
    // «Мне 15 лет» запоминается: романтика с таким собеседником закрыта и в
    // словах, и в действиях. Проверить возраст нельзя — только поверить.
    if (!dry && !owner(actorId)) {
      const age = prompt.match(/(?:^|[\s,.!])мне\s+(\d{1,2})\s*(?:лет|год)/iu);
      const minor = age ? Number(age[1]) < 18 : null;
      if (minor != null && Boolean(turn.manner.settings.minor) !== minor) {
        turn.manner = { ...turn.manner, settings: { ...turn.manner.settings, minor } };
        await personal.save(actorId, { minor }).catch(() => ({ ok: false }));
      }
    }
    // Позвали по имени и ничего не сказали: отозваться можно и без модели.
    if (bare) return ruled(await say(turn, ["Я здесь.", "Слушаю.", "Да?"][Math.abs(Number(message.message_id) || 0) % 3]));

    if (!dry) {
      try { turn.seen = await personal.seen(actorId); } catch { turn.seen = null; }
      if (turn.seen?.newDay && turn.seen.known) {
        const days = await personal.daysWith(actorId).then(value => value.days).catch(() => 0);
        if ([7, 30, 100].includes(days) || (days > 0 && days % 365 === 0)) turn.anniversary = days;
      }
    }

    // Настройки — не команды: «зови меня …», «говори короче». Только в личке:
    // в группе человек говорит с Аи, а не настраивает её для всех.
    // «Правило: отвечай короче» — урок для всех, а не личная настройка длины.
    const teaching = parseIntent(prompt)?.intent === "teach";
    if (turn.isPrivate && !dry && !teaching) {
      const wanted = addressRequest(prompt);
      if (wanted) {
        const saved = await personal.setAddress(actorId, wanted).catch(() => ({ ok: false }));
        return ruled(await say(turn, saved.ok
          ? you(turn, `Хорошо, буду обращаться к вам «${wanted}». Передумаете — скажите «зовите меня …» ещё раз.`, `Хорошо, буду обращаться к тебе «${wanted}». Если передумаешь — скажи «зови меня …» ещё раз.`)
          : "Имя не запомнилось: нужно короче и без символов."));
      }
      const length = lengthRequest(prompt);
      if (length) {
        const saved = await personal.setLength(actorId, length).catch(() => ({ ok: false }));
        return ruled(await say(turn, saved.ok
          ? `Договорились, отвечаю ${({ кратко: "коротко", обычно: "обычно", подробно: "подробно" })[length]}.`
          : "Не запомнилось — повторю попытку в следующий раз."));
      }
    }
    // «Давай на ты» — просьба о форме обращения, её можно сказать где угодно.
    const form = dry ? null : formRequest(prompt);
    if (form) {
      if (owner(actorId)) return ruled(await say(turn, "С вами я всегда на «вы», хозяин: так решено — и мне так нравится."));
      if (form === "ты" && turn.manner.score < 0) return ruled(await say(turn, "Пока не готова: между нами прохладно. Останемся на «вы»."));
      const saved = await personal.setForm(actorId, form).catch(() => ({ ok: false }));
      if (saved.ok) turn.manner = { ...turn.manner, formal: form === "вы", settings: { ...turn.manner.settings, form } };
      return ruled(await say(turn, !saved.ok ? "Не запомнилось: хранилище не отвечает." : form === "ты" ? "Хорошо, давай на «ты»." : "Хорошо, перехожу на «вы»."));
    }

    // Хозяин отвечает на переданное ему письмо: ответ уходит автору, дословно.
    if (!dry && owner(actorId) && turn.isPrivate && message.reply_to_message?.message_id != null) {
      const mail = await store.get(`heart:mail:msg:${message.reply_to_message.message_id}`).catch(() => null);
      if (mail?.to != null) {
        try {
          await api.sendMessage({ chat_id: mail.to, text: `✉️ Хозяин отвечает:\n\n${prompt}` });
          return ruled(await say(turn, `Передала: ${mail.name}.`));
        } catch {
          return ruled(await say(turn, `Не дошло: ${mail.name} не открывал(а) личку со мной или закрыл(а) её.`));
        }
      }
    }

    // Слово владельца о чужой поправке: ответ «да» или «нет» на её вопрос.
    if (!dry && owner(actorId) && turn.isPrivate && message.reply_to_message?.message_id != null && (YES.test(prompt) || NO.test(prompt))) {
      const asked = await lessons.byAskMessage(message.reply_to_message.message_id).catch(() => null);
      if (asked) {
        const accept = YES.test(prompt);
        const done = await lessons.judge(asked.id, accept, { by: actorId });
        return ruled(await say(turn, !done.ok ? "Не получилось записать решение: хранилище не отвечает." : accept ? `Принято: урок №${asked.id} теперь общий.` : `Отклонено: урок №${asked.id} отменён.`));
      }
    }

    // Просьба важнее хода: «профиль» посреди виселицы — не слово из семи букв.
    const lowered = normalize(prompt);
    const noted = parseNote(prompt);
    const request = Boolean(matchPhrase(prompt) || parseIntent(prompt) || calculate(prompt) || detectSource(lowered) || parsePicture(lowered) || parseMedia(prompt)
      || noted || parseQuiet(prompt) || parseQuestion(prompt) || parsePoll(prompt) || parseWhois(prompt) || parseChatSetting(prompt) || parseParty(prompt));

    // Отгадка в «крокодиле» — ответ на сообщение стола: не разговор и не ход
    // в другой игре. Мимо — молча, с «🤔», чтобы было видно: услышала.
    if (!dry && inGroup && turn.replyToMe && message.reply_to_message?.message_id != null) {
      const guessed = await party.guess(turn, prompt, message.reply_to_message.message_id);
      if (guessed) {
        if (guessed.miss) await react(turn, "🤔");
        if (guessed.won) pulse.bump("games");
        return ruled(guessed);
      }
    }

    // Забавы — до хода в игре и до всего остального: «обнять», настройка
    // чата, опрос, «мой айди», игра с кнопками. Просьба с известным смыслом
    // («разбуди меня в 7») действием не считается.
    const self = inGroup || !request ? await whoAmI(dry) : null;
    if (!request) {
      const acted = await fun.roleplay(turn, prompt, { self, addressed: true });
      if (acted) return ruled(acted);
    }
    const viaFun = await fun.hush(turn, prompt) ?? await fun.chatSetting(turn, prompt) ?? await fun.poll(turn, prompt)
      ?? await fun.whois(turn, prompt, { self }) ?? await party.begin(turn, prompt, { say })
      ?? await fun.question(turn, prompt, { day: dayOf(now()) });
    if (viaFun) return ruled(viaFun);

    // Списки, цели, дневник. «Список уроков» и «список игр» — не списки
    // человека: у этих слов есть своё значение, и оно важнее.
    if (noted && !(noted.op === "show" && noted.kind === "list" && parseIntent(prompt))) {
      if (dry) return ruled(await say(turn, "Разобрала бы это как запись в список — репетиция, ничего не пишу."));
      const answer = await notes.handle(actorId, noted, { isPrivate: turn.isPrivate });
      if (answer != null) return ruled(await say(turn, answer));
    }

    // Идёт игра — фраза может быть ходом. Судит код; не ход — идёт дальше,
    // к просьбам и разговору, а игра ждёт.
    if (!dry && !request) {
      const played = await games.move(chat.id, prompt, { formal: turn.manner.formal !== false });
      if (played) {
        if (played.started) pulse.bump("games");
        return ruled(await say(turn, played.text));
      }
    }

    const viaAbility = await tryAbility(turn, prompt);
    if (viaAbility) return ruled({ ok: true, action: "ability" });

    // Намерения — до модели: слова человека это просьба, а не тема для
    // разговора. Понятое наполовину задаёт один вопрос, незнакомое уходит к
    // разговору ниже. Команды выше остаются аварийным выходом.
    const viaIntent = await handleIntent(turn, prompt);
    if (viaIntent) return ruled({ ok: true, action: "intent" });

    // Счёт, погода, курс, часы, энциклопедия: факт берётся у источника, а не
    // у модели — она бы его придумала. Картинки и жесты — туда же.
    const viaSource = await fromSource(turn, prompt);
    if (viaSource) return ruled({ ok: true, action: "source" });
    const viaPicture = await showPicture(turn, prompt);
    if (viaPicture) return ruled({ ok: true, action: "picture" });
    // Профиль и роль — не предмет для поиска картинки: о них ниже.
    const viaMedia = FACT_QUESTION.test(prompt) ? null : await findMedia(turn, prompt);
    if (viaMedia) return ruled(viaMedia);

    // Профиль, роль, уровень, VIP и варны — это факты из базы, а не тема для
    // разговора. Если способность не ответила, модель ответить не может: она
    // придумает роль, ID и «полный доступ» — и это уже случалось. Честное «не
    // знаю» дешевле красивой выдумки.
    if (FACT_QUESTION.test(prompt)) {
      return ruled(await say(turn, `Профиль, роль и награды ведёт ${SISTER} — у меня этих данных нет, и придумывать их я не стану. ${you(turn, "Спросите", "Спроси")} её: «покажи профиль».`));
    }

    if (!dry) {
      const closed = await noteDeeds(turn, prompt);
      if (closed) return closed;
    }

    // Она имеет право не ответить: это не отказ и не поломка, а часть
    // характера. В частном разговоре и по делу молчание не применяется.
    if (policy && !dry) {
      try {
        if (await policy.shouldIgnore({ userId: actorId, chatId: chat.id, text: prompt })) {
          pulse.bump("silent");
          // «Видела» — чтобы выбор не выглядел поломкой.
          await react(turn, "👀");
          await store.set(`heart:quiet:${chat.id}:${actorId}`, { reason: "silence", at: now() });
          return { ok: true, ignored: true, reason: "deliberate_silence" };
        }
      } catch { /* политика не должна глушить разговор */ }
    }

    if (!dry) {
      const capped = await overQuota(turn);
      if (capped) return capped;
    }

    // «Что такое …», «кто такой …»: сначала статья, потом её голос. Модель
    // пересказывает справку, а не вспоминает; нечем думать — ответит сама статья.
    if (!dry) {
      const topic = factQuery(prompt);
      if (topic) {
        const page = await sources.wiki(topic, { search: false, limit: 600 }).catch(() => null);
        if (page?.ok) turn.reference = page;
      }
    }

    const { answer, context, facts } = await talk(turn, prompt);
    if (answer.ok) {
      const sent = await say(turn, answer.text);
      if (!dry && !answer.testRun && sent.ok) {
        if (turn.reference) pulse.bump("sourced");
        await remember(turn, prompt, answer, context, facts);
      }
      return sent;
    }
    if (dry) return say(turn, answer.text || "Не получилось ответить.");
    return fallback(turn, prompt, answer);
  }

  async function onMessage(message, ctx = {}) {
    const chatId = message?.chat?.id;
    const dry = ctx?.testRun === true;
    // «В чат вошли»: служебное сообщение без текста — встретить новичка.
    if (chatId && Array.isArray(message?.new_chat_members) && message.new_chat_members.length) {
      try {
        if (!dry) await wake(ctx);
        return await fun.welcome(message, { self: await whoAmI(dry), dry });
      } catch (error) {
        await reportCrash(error, ctx);
        return { ok: false, code: "runtime_error" };
      } finally {
        if (!dry) { try { await pulse.commit(); } catch { /* счётчики не важнее приветствия */ } }
      }
    }
    if (!chatId || message?.from?.is_bot) return { ignored: true };
    const kind = senseOf(message);
    if (kind === "none") return { ignored: true };
    const text = String(message?.text ?? message?.caption ?? "").trim();

    if (!dry) await wake(ctx);

    // A channel post is either an event the heart should answer on its own, or
    // the signed answer to something it asked. Everything else is noise.
    if (message?.chat?.type === "channel") {
      if (!text) return { ignored: true };
      if (await events.onPost(text)) return { ok: true, code: "event_handled" };
      const handled = await abilities.onPost(text);
      if (handled) return { ok: true, code: "bridge_answer" };
      // Чужой конверт — не ей. Любой другой пост в канале — удар будильника:
      // второй бот правит одно сообщение раз в минуту, и сердце просыпается.
      if (text.includes(BUS_PREFIX.trim())) return { ok: false, code: "not_for_heart" };
      if (!dry) await beat("channel");
      return { ok: true, code: "clock" };
    }

    const ref = { turn: null };
    try {
      return await converse(message, ctx, { text, kind, dry }, ref);
    } catch (error) {
      // Исключение раньше исчезало молча: человек не получал ответа, владелец
      // не узнавал о поломке. Теперь узнают оба.
      await reportCrash(error, ctx);
      const turn = ref.turn;
      if (turn && !dry && !turn.delivered && turn.addressed) {
        try { await say(turn, "У меня что-то сломалось внутри, и ответ не получился. Владелец уже знает."); } catch { /* сказать не вышло — отчёт уже ушёл */ }
      }
      return { ok: false, code: "runtime_error" };
    } finally {
      if (!dry) {
        try { await afterTalk(ref.turn); } catch { /* шаг отношений подождёт */ }
        try { await drain(ctx, ref.turn); } catch { /* очередь подождёт следующего обновления */ }
        try { await pulse.commit(); } catch { /* счётчики не важнее ответа */ }
      }
    }
  }

  /**
   * Нажатие кнопки под её сообщением. Кнопки сейчас есть только у игр; на
   * любое нажатие нужно ответить, иначе у человека так и крутятся «часики».
   * Репетиция Telegram не трогает и в базу не ходит.
   */
  async function onCallback(query, ctx = {}) {
    const data = String(query?.data ?? "");
    const route = data.startsWith("p:") ? "party" : "none";
    if (ctx?.testRun === true) return { ok: true, route, side_effects: "none" };
    try {
      await wake(ctx);
      if (route === "party") return await party.press(query);
      if (query?.id != null && has("answerCallbackQuery")) {
        try { await api.answerCallbackQuery({ callback_query_id: query.id }); } catch { /* устаревшее нажатие — не поломка */ }
      }
      return { ignored: true };
    } catch (error) {
      await reportCrash(error, ctx);
      return { ok: false, code: "runtime_error" };
    } finally {
      try { await pulse.commit(); } catch { /* счётчики не важнее игры */ }
    }
  }

  /** What is connected, in one object: used by the status screen and by tests. */
  async function status({ chatId = null, actorId = null } = {}) {
    const tools = chatId == null ? [] : (await abilities.catalogue({ actor: actorId, chat: chatId })).tools;
    const recent = await notices.list({ limit: 5 });
    return {
      build: BUILD,
      intents: INTENTS.length,
      provider: config.AI_MODEL,
      brains: await brains.describe({ apiKey: String(AI_API_KEY ?? "").trim() || "configured-elsewhere" }).catch(() => []),
      memory: store.available,
      sister: describeSister({ open: abilities.open(), tools, username: SISTER_USERNAME, sister: SISTER }),
      bridge: abilities.open() ? await abilities.health().catch(() => null) : null,
      events: { kinds: events.KINDS, cooldownMin: Math.round(events.cooldownMs / 60_000), maxPerDay: events.maxPerDay },
      incidents: { recent, pending: await notices.pending(), ownerKnown: notices.ownerKnown },
      lessons: await lessons.stats().catch(() => null),
      queue: await queue.size().catch(() => 0),
      today: await pulse.day().catch(() => ({})),
    };
  }

  return Object.freeze({
    onMessage,
    onCallback,
    tick,
    status,
    reportCrash,
    reminders,
    events,
    notices,
    store,
    abilities,
    ai,
    brains,
    lessons,
    queue,
    pulse,
    memory,
    policy,
    personal,
    /** For tests and the status screen: the same object the handler uses. */
    config,
  });
}
