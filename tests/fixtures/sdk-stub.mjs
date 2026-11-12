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

const methods = {
  async sendMessage(params) {
    if (state.failing.sendMessage) throw state.failing.sendMessage;
    state.sent.push(params);
    return { message_id: state.sent.length };
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
      return true;
    };
  },
});

export async function fetch(url, options = {}) {
  state.fetches.push({ url, options });
  const queued = state.fetchQueue.shift();
  if (queued instanceof Error) throw queued;
  if (queued) return queued;
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "ответ из стаба" } }] }) };
}

export const db = {
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
    if (query.includes("INSERT INTO kv_state")) {
      // «Только если нет» — отдельный запрос: существующую запись он не трогает.
      if (query.includes("DO NOTHING") && state.kv.has(params[":key"])) return true;
      state.kv.set(params[":key"], params[":value"]);
      state.kvAt.set(params[":key"], Number(params[":at"]) || 0);
      return true;
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
