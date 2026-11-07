/** Recording stand-in for the Telegram Serverless `sdk` module. No network. */
const state = globalThis.__sdkStub = globalThis.__sdkStub ?? {
  sent: [],
  fetches: [],
  kv: new Map(),
  memory: new Map(),
  fetchQueue: [],
};

export const api = {
  async sendMessage(params) {
    state.sent.push(params);
    return { message_id: state.sent.length };
  },
};

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
      state.kv.set(params[":key"], params[":value"]);
      return true;
    }
    if (query.includes("INSERT INTO ai_memory")) {
      state.memory.set(`${params[":chat"]}:${params[":user"]}`, { messages: params[":messages"] });
      return true;
    }
    if (query.includes("DELETE FROM ai_memory")) {
      return state.memory.delete(`${params[":chat"]}:${params[":user"]}`);
    }
    return true;
  },
};
