/**
 * Общий набор для тестов сердца: одна точка, где собирается сердце на
 * записывающем стабе платформы. Сети нет, Telegram нет, базы нет.
 */
import { register } from "node:module";
import { api as sdkApi, db as sdkDb, fetch as sdkFetch, InputFile } from "./sdk-stub.mjs";

register(new URL("./sdk-loader.mjs", import.meta.url));

export const heartModule = await import("../../tgcloud/lib/heart.js");
export const { createHeart, BUILD, RELEASE_NOTES } = heartModule;
const { createBridge } = await import("../../tgcloud/lib/bridge.js");
const { decodeEnvelope, encodeEnvelope } = await import("../../tgcloud/lib/abilities.js");

export const SECRET = "0123456789abcdef0123456789abcdef";
export const CHANNEL = "-100500";
export const OWNER = 7;
export const DAY = 86_400_000;
export const BASE = {
  OWNER_TG_ID: OWNER,
  TIME_ZONE: "Europe/Moscow",
  AI_MODEL: "openai/gpt-oss-20b",
  AI_MIN_INTERVAL_MS: 0,
  ABILITIES_CHANNEL_ID: "",
  ABILITIES_SECRET: "",
  NAME: "Аи",
  SISTER_NAME: "Юи",
  SISTER_BOT_USERNAME: "",
  // Вести владельцу проверяются там, где они нужны; иначе каждый тест
  // считал бы чужое «я обновилась».
  SELF_REPORTS: false,
};

export const sdk = () => globalThis.__sdkStub;
export function reset() {
  const state = sdk();
  state.sent.length = 0;
  state.fetches.length = 0;
  state.fetchQueue.length = 0;
  state.calls.length = 0;
  state.sourceReplies.length = 0;
  state.sourceFetches.length = 0;
  delete state.diceValue;
  for (const name of Object.keys(state.apiReplies)) delete state.apiReplies[name];
  state.kv.clear();
  state.kvAt.clear();
  state.memory.clear();
  for (const name of Object.keys(state.failing)) delete state.failing[name];
  delete state.me;
}

export const KEY = { env: { AI_PROVIDER_KEY: "test-provider-key" } };
let serial = 100;
export function message(text, { id = 5, chat = id, type = "private", name = "Тест", reply = null, extra = {} } = {}) {
  return {
    message_id: ++serial,
    chat: { id: chat, type },
    from: { id, first_name: name, is_bot: false },
    ...(text == null ? {} : { text }),
    ...(reply ? { reply_to_message: reply } : {}),
    ...extra,
  };
}
export const group = (text, options = {}) => message(text, { chat: -10, type: "supergroup", ...options });
/** Её собственное сообщение, на которое отвечают. */
export const hers = (text = "ответ", id = 50) => ({ message_id: id, from: { id: 999, is_bot: true, username: "ai_heart_bot" }, text });

export function heart(overrides = {}, options = {}) {
  return createHeart({ db: sdkDb, api: sdkApi, fetchImpl: sdkFetch, InputFile, config: { ...BASE, ...overrides }, ...options });
}

/** Тело запроса к провайдеру и системная подсказка в нём. */
export const request = (index = -1) => JSON.parse(sdk().fetches.at(index).options.body);
export const system = (index = -1) => request(index).messages[0].content;
export const chats = () => sdk().fetches.filter(item => String(item.url).endsWith("/chat/completions"));

const headersOf = (headers = {}) => ({ get: (name) => headers[String(name).toLowerCase()] ?? null });
/** Ответ модели. */
export const says = (content, { finish = "stop", usage = { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }, headers = {} } = {}) => ({
  ok: true, status: 200, headers: headersOf(headers),
  json: async () => ({ choices: [{ message: { content }, finish_reason: finish }], usage }),
});
/** Отказ провайдера: статус, код ошибки и заголовки. */
export const refuses = (status, { code = "", param = null, headers = {} } = {}) => ({
  ok: false, status, headers: headersOf(headers),
  text: async () => JSON.stringify({ error: { code, ...(param ? { param } : {}) } }),
});

/**
 * Ответ источника (вики, погода, курс, картинки): `match` — часть адреса или
 * регулярное выражение, `reply` — тело JSON, функция от адреса или Error.
 * Источник без ответа отдаёт 404.
 */
export const source = (match, reply) => { sdk().sourceReplies.push({ match, reply }); };
export const sourced = () => sdk().sourceFetches.map(item => item.url);
/** Вызовы Telegram, кроме сообщений: фото, гифки, стикеры, кубик. */
export const calls = (method) => sdk().calls.filter(item => item.method === method).map(item => item.params);
/** Случайность по списку: значения по кругу. */
export const dice = (...values) => { let i = 0; return () => values[i++ % values.length]; };

/**
 * Дождаться, пока `probe` вернёт что-то непустое. Вместо «подождать 20 мс»:
 * подпись конверта — настоящая криптография, и на телефоне, где тесты идут
 * рядом с десятком других процессов, она в такой срок не укладывается.
 */
export async function until(probe, { ms = 15_000, step = 5 } = {}) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`условие не выполнилось за ${ms} мс`);
    await new Promise(resolve => setTimeout(resolve, step));
  }
}

/** Конверт, который сердце отправило сестре о человеке `actor`: свой, а не оставшийся от соседнего теста. */
export const asked = (actor) => sdk().sent
  .filter(item => String(item.chat_id) === CHANNEL)
  .map(item => decodeEnvelope(item.text))
  .find(envelope => envelope && String(envelope.actor) === String(actor));

export const toChat = (id) => sdk().sent.filter(item => String(item.chat_id) === String(id));
export const toOwner = () => toChat(OWNER);
export const last = (id = 5) => toChat(id).at(-1)?.text ?? "";
export const reactions = () => sdk().calls.filter(item => item.method === "setMessageReaction").map(item => item.params.reaction[0].emoji);

/**
 * Сердце с открытым мостом, на другом конце которого стоит «сестра»: тот же
 * секрет, свой объект моста. `alive: false` — она молчит. Возвращает сердце и
 * все конверты, которые оно отправило в канал.
 */
export function withSister({ alive = true, facts = { role: "Игрок", level: 10 }, overrides = {}, options = {} } = {}) {
  const clock = options.now ?? (() => Date.now());
  const sister = createBridge({ secret: SECRET, capabilities: { call: async () => ({}) }, now: clock });
  const posts = [];
  const state = { alive };
  let h = null;
  const api = new Proxy({}, {
    get(_, name) {
      if (name !== "sendMessage") return sdkApi[name];
      return async (params) => {
        if (String(params.chat_id) !== CHANNEL) return sdkApi.sendMessage(params);
        const asked = decodeEnvelope(params.text);
        posts.push(asked);
        if (state.alive) {
          const answer = await sister.sealResult({ id: asked.id, tool: asked.tool, result: { ok: true, code: "ok", text: "", data: asked.tool === "__catalog" ? [] : facts } });
          setTimeout(() => { h.onMessage({ message_id: 1, chat: { id: Number(CHANNEL), type: "channel" }, text: encodeEnvelope(answer.envelope) }); }, 0);
        }
        return { message_id: 1 };
      };
    },
  });
  // Срок — сколько сердце ждёт сестру. Она отвечает настоящей подписью, так
  // что срок с запасом: живая сестра укладывается и на медленном телефоне, а
  // молчащая стоит тесту полсекунды.
  h = heart({ ABILITIES_CHANNEL_ID: CHANNEL, ABILITIES_SECRET: SECRET, ABILITIES_TIMEOUT_MS: 500, ...overrides }, { api, ...options });
  return { h, posts, state };
}
