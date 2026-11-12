/**
 * Non-secret configuration of the heart.
 *
 * Telegram Serverless gives a module no environment variables: the handler
 * receives only the raw update. So the settings live here, in git, and only
 * secrets are injected at publish time into `lib/secrets.js`.
 *
 * OWNER_TG_ID is the Founder's numeric Telegram ID. It is not a secret — it is
 * an identity check — and belongs here so a fresh deploy cannot be claimed by
 * whoever writes first and so the founder is known without the bridge. The
 * abilities bot confirms the same identity through `__context`; either source
 * is enough, and neither is guessed.
 */
export const CONFIG = Object.freeze({
  OWNER_TG_ID: 1057867710,
  TIME_ZONE: "Europe/Moscow",
  AI_MODEL: "openai/gpt-oss-20b",
  AI_MIN_INTERVAL_MS: 1500,

  // Запасные модели на том же ключе. Лимиты у провайдера считаются по каждой
  // модели отдельно: упёршись в одну, сердце думает следующей. Модели, которой
  // у провайдера уже нет, сердце само пропускает сутки и спрашивает список.
  AI_MODELS: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"],

  // Другие провайдеры с OpenAI-совместимым API — ещё один запас на случай,
  // когда кончились все модели основного. Ключа здесь нет: он приходит из
  // строки KEY_<ИМЯ> в ~/.heart.env на телефоне (или из GitHub-секрета
  // AI_EXTRA_KEYS, {"имя": "ключ"}) только на время публикации.
  // Пример записи: { id: "cerebras", baseUrl: "https://api.cerebras.ai/v1", models: ["llama-3.3-70b"] }
  AI_PROVIDERS: [
    // Experiential Labs: шлюз с OpenAI-совместимым API. В бесплатном плане две
    // разговорные модели делят миллион токенов в сутки (сброс в 00:00 UTC) и
    // десять запросов в минуту. Суффикс «:free» — только бесплатный объём:
    // кончился — запрос останавливается, денег не списывает никогда.
    // Условия на 12.11.2026: нужна разовая проверка карты ($1, возвращается);
    // на бесплатном плане шлюз хранит тексты запросов, и выключить это нельзя.
    // Ключ — в секрет AI_EXTRA_KEYS как {"explabs": "xpl_…"}; без него запись спит.
    {
      id: "explabs", name: "Experiential Labs",
      baseUrl: "https://api.experientiallabs.ai/v1",
      models: ["deepseek-v4.1-flash:free", "gpt-6-luna:free"],
      // Обе модели рассуждают перед ответом; для разговора хватает малого усилия.
      effort: "low",
    },
    // GigaChat (Сбер): бесплатный Freemium для физлиц по Сбер ID, без карты —
    // на год 50 млн токенов Ultra, 25 млн Max, 40 млн Pro и 250 млн Lite. Объём
    // у каждой модели свой: кончился — она отвечает 402, и в ход идёт следующая.
    // Ключ авторизации — в секрет AI_EXTRA_KEYS как {"gigachat": "<Authorization
    // Key>"}; без него запись спит. Вход особый (`kind`): ключ меняется на
    // получасовой токен.
    // ВАЖНО: адреса Сбера подписаны сертификатом Минцифры. Зарубежное облако
    // ему обычно не доверяет — тогда «проверь мозги» скажет «нет связи при
    // обмене ключа», и напрямую GigaChat недоступен. Сердце при этом не
    // страдает: провайдер без связи отдыхает всё дольше, до шести часов.
    {
      id: "gigachat", name: "GigaChat", kind: "gigachat",
      baseUrl: "https://api.giga.chat/v1",
      authUrl: "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
      scope: "GIGACHAT_API_PERS",
      models: ["GigaChat-3-Ultra", "GigaChat-2-Max", "GigaChat-2-Pro", "GigaChat-2"],
    },
  ],

  // Своё имя в Telegram без «@». Обычно сердце узнаёт его само (getMe); это
  // запасной вариант, чтобы «@имя привет» в группе понималось и без него.
  BOT_USERNAME: "",

  // Час по TIME_ZONE, после которого владелец получает сводку за вчера.
  DIGEST_HOUR: 9,

  // Сколько ответов моделью в день получает один собеседник. Лимит модели
  // общий: предел не даёт одному человеку оставить без ответа остальных.
  // Хозяина не касается; игры, память, источники и напоминания модель не
  // тратят и под предел не попадают. 0 — без предела.
  AI_DAILY_PER_PERSON: 200,

  // The VIP perk "the heart answers faster" is a fact, not an adjective: the
  // pause shrinks only when the sister confirms the status. Same number as in
  // the abilities deployment, kept here because the heart has no env.
  AI_VIP_INTERVAL_MS: 700,

  // The abilities bot (moderation, games, quests, profiles) lives in a separate
  // deployment. The channel is the only transport: both bots are its admins, so
  // both receive every post. Empty values keep the bridge off and the heart
  // fully self-sufficient.
  ABILITIES_CHANNEL_ID: "-1004294683725",
  ABILITIES_SECRET: "most-chanel-yui-ai-2026-02-07-2503",

  // What the heart says about itself when asked who it is.
  NAME: "Аи",

  // The sibling by name, and — when known — her public username. Without a
  // username the heart still says the ability is missing, it simply cannot
  // offer a button; it never invents a link.
  SISTER_NAME: "Юи",
  SISTER_BOT_USERNAME: "",
});
