/** Recording stand-in for the Telegram Serverless `sdk` module. No network. */
const state = globalThis.__sdkStub = globalThis.__sdkStub ?? {
  sent: [],
  fetches: [],
  kv: new Map(),
  memory: new Map(),
  fetchQueue: [],
};

state.calls ??= [];
state.kvAt ??= new Map();
state.failing ??= {};
// Источники (вики, погода, курс, картинки) — отдельно от провайдера: их
// запросы не должны съедать ответы модели из `fetchQueue`.
state.sourceReplies ??= [];
state.sourceFetches ??= [];
state.apiReplies ??= {};

const SOURCE_HOSTS = /(?:api\.tavily\.com|search\.brave\.com|mymemory\.translated\.net|cloudflare\.com\/client\/v4\/accounts\/[^/]+\/ai\/run\/|example\.org|nagerholidays\.com|wikipedia\.org|wiktionary\.org|open-meteo\.com|cbr-xml-daily\.ru|jsdelivr\.net|er-api\.com|thecatapi\.com|dog\.ceo|randomfox\.ca|nekos\.best|wikimedia\.org|openverse\.org|shikimori\.|itunes\.apple\.com|deezer\.com|rutube\.ru|dailymotion\.com)/u;

const methods = {
  async sendMessage(params) {
    if (state.failing.sendMessage) throw state.failing.sendMessage;
    // Отправка в Telegram длится: тест может сделать что-то посреди неё.
    if (typeof state.duringSend === "function") await state.duringSend(params);
    // Шёпот — сообщение для одного человека. Стаб знает его, только если тест задал
    // `state.whispers = { admin: [чаты] }`: без этого он, как старый сервер, молча
    // отбрасывает параметр и шлёт сообщение всем.
    const eph = params.ephemeral_message_parameters;
    if (eph && state.whispers) {
      // Не администратор и не ответ на нажатие — отказ. Текст ошибки условный: код от него не зависит.
      if (eph.callback_query_id == null && !(state.whispers.admin ?? []).includes(params.chat_id)) {
        state.calls.push({ method: "sendMessage:refused", params });
        throw Object.assign(new Error("Bad Request: ephemeral message can't be sent"), { code: 400 });
      }
      state.sent.push(params);
      return { message_id: 0, ephemeral_message_id: state.sent.length, receiver_user: { id: eph.receiver_user_id ?? 0 } };
    }
    state.sent.push(params);
    return { message_id: state.sent.length };
  },
  // Живой кубик: значение выбирает Telegram, стаб отдаёт заданное тестом.
  async sendDice(params) {
    state.calls.push({ method: "sendDice", params });
    if (state.failing.sendDice) throw state.failing.sendDice;
    return { message_id: 900, dice: { emoji: params.emoji ?? "🎲", value: state.diceValue ?? 4 } };
  },
  async getMe() {
    state.calls.push({ method: "getMe", params: {} });
    if (state.failing.getMe) throw state.failing.getMe;
    return state.me ?? { id: 999, is_bot: true, first_name: "Аи", username: "ai_heart_bot" };
  },
};

/**
 * The real `api` is a Proxy: any Bot API method exists. The stub records every
 * call that is not a message, so a test can ask "was a reaction set?".
 */
export const api = new Proxy(methods, {
  get(target, name) {
    if (name in target) return target[name];
    if (typeof name !== "string" || name === "then") return undefined;
    return async (params = {}) => {
      state.calls.push({ method: name, params });
      if (state.failing[name]) throw state.failing[name];
      // Ответ метода, заданный тестом: значение или функция от параметров.
      if (name in state.apiReplies) return typeof state.apiReplies[name] === "function" ? state.apiReplies[name](params) : state.apiReplies[name];
      return true;
    };
  },
});

export async function fetch(url, options = {}) {
  const address = String(url);
  if (SOURCE_HOSTS.test(address)) {
    state.sourceFetches.push({ url: address, options });
    const hit = state.sourceReplies.find(item => (typeof item.match === "string" ? address.includes(item.match) : item.match.test(address)));
    // Источник, о котором тест ничего не сказал, не отвечает: 404.
    if (!hit) return { ok: false, status: 404, json: async () => ({}) };
    const reply = typeof hit.reply === "function" ? hit.reply(address, options) : hit.reply;
    if (reply instanceof Error) throw reply;
    // Готовый ответ: JSON, текст или поток байт (как отдаёт файлы платформа: `for await (… of res.body)`).
    if (reply && typeof reply === "object" && typeof reply.status === "number" && (typeof reply.json === "function" || typeof reply.text === "function" || reply.body != null)) return reply;
    return { ok: true, status: 200, json: async () => reply };
  }
  state.fetches.push({ url, options });
  const queued = state.fetchQueue.shift();
  if (queued instanceof Error) throw queued;
  if (queued) return queued;
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "ответ из стаба" } }] }) };
}

/** Файл для отправки: стаб хранит байты, имя и тип — тест может их прочесть. */
export class InputFile {
  constructor(bytes, name, options = {}) { this.bytes = bytes; this.name = name; this.type = options.type ?? ""; }
}

export const db = {
  async all(query, params = {}) {
    if (!query.includes("FROM kv_state WHERE key LIKE")) return [];
    const prefix = String(params[":prefix"]).replace(/%$/u, "");
    const rows = [...state.kv.entries()].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, value]) => ({ key, value }));
    const limit = Number(query.match(/LIMIT (\d+)/u)?.[1]) || rows.length;
    return (query.includes("ORDER BY key DESC") ? rows.reverse() : rows).slice(0, limit);
  },
  async get(query, params = {}) {
    if (query.includes("FROM kv_state")) {
      const value = state.kv.get(params[":key"]);
      return value === undefined ? null : { value };
    }
    if (query.includes("FROM ai_memory")) {
      const row = state.memory.get(`${params[":chat"]}:${params[":user"]}`);
      return row ? { messages: row.messages } : null;
    }
    return null;
  },
  async run(query, params = {}) {
    // Запись в kv_state отвечает так же, как настоящая база: сколько строк тронуто.
    const touched = (n) => ({ rowsAffected: n, lastInsertRowid: 0, rows: [] });
    if (query.includes("INSERT INTO kv_state")) {
      // «Только если нет» — отдельный запрос: существующую запись он не трогает.
      if (query.includes("DO NOTHING") && state.kv.has(params[":key"])) return touched(0);
      state.kv.set(params[":key"], params[":value"]);
      state.kvAt.set(params[":key"], Number(params[":at"]) || 0);
      return touched(1);
    }
    if (query.includes("UPDATE kv_state SET value")) {
      // Условная замена: только если лежит ровно то, что читали. Один шаг, без щели.
      if (state.kv.get(params[":key"]) !== params[":before"]) return touched(0);
      state.kv.set(params[":key"], params[":value"]);
      state.kvAt.set(params[":key"], Number(params[":at"]) || 0);
      return touched(1);
    }
    if (query.includes("DELETE FROM kv_state WHERE key LIKE")) {
      const prefix = String(params[":prefix"]).replace(/%$/u, "");
      for (const key of [...state.kv.keys()]) {
        if (key.startsWith(prefix) && (state.kvAt.get(key) ?? 0) < params[":before"]) { state.kv.delete(key); state.kvAt.delete(key); }
      }
      return true;
    }
    if (query.includes("INSERT INTO ai_memory")) {
      state.memory.set(`${params[":chat"]}:${params[":user"]}`, { messages: params[":messages"] });
      return true;
    }
    if (query.includes("DELETE FROM ai_memory") && !(":chat" in params)) {
      for (const key of [...state.memory.keys()]) if (key.endsWith(`:${params[":user"]}`)) state.memory.delete(key);
      return true;
    }
    if (query.includes("DELETE FROM ai_memory")) {
      return state.memory.delete(`${params[":chat"]}:${params[":user"]}`);
    }
    if (query.includes("DELETE FROM kv_state")) {
      return state.kv.delete(params[":key"]);
    }
    return true;
  },
};
