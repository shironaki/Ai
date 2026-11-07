/**
 * The heart's storage: two ports, nothing else.
 *
 * Memory is a conversation, storage is a small key-value map (relationship,
 * names, preferences). Both are expressed as the shapes the core already
 * expects, so the heart can be moved to another database by replacing this file
 * alone.
 */
export function createHeartStore({ db, now = () => Date.now() } = {}) {
  const has = db && typeof db.get === "function" && typeof db.run === "function";

  async function get(key) {
    if (!has) return null;
    try {
      const row = await db.get("SELECT value FROM kv_state WHERE key = :key", { ":key": String(key) });
      return row?.value == null ? null : JSON.parse(row.value);
    } catch { return null; }
  }

  async function getChecked(key) {
    if (!has) return { ok: false, reason: "storage_unavailable" };
    try {
      const row = await db.get("SELECT value FROM kv_state WHERE key = :key", { ":key": String(key) });
      return { ok: true, value: row?.value == null ? null : JSON.parse(row.value) };
    } catch { return { ok: false, reason: "storage_unavailable" }; }
  }

  async function set(key, value) {
    if (!has) return false;
    try {
      await db.run(
        "INSERT INTO kv_state (key, value, updated_at) VALUES (:key, :value, :at) ON CONFLICT(key) DO UPDATE SET value = :value, updated_at = :at",
        { ":key": String(key), ":value": JSON.stringify(value ?? null), ":at": now() },
      );
      return true;
    } catch { return false; }
  }

  async function setIfAbsent(key, value) {
    if (!has) return false;
    try {
      await db.run(
        "INSERT INTO kv_state (key, value, updated_at) VALUES (:key, :value, :at) ON CONFLICT(key) DO NOTHING",
        { ":key": String(key), ":value": JSON.stringify(value ?? null), ":at": now() },
      );
      const row = await db.get("SELECT value FROM kv_state WHERE key = :key", { ":key": String(key) });
      return row?.value === JSON.stringify(value ?? null);
    } catch { return false; }
  }

  // Optimistic write: the caller read `before`, and only that exact value is
  // replaced. A lost race returns false instead of overwriting a newer state.
  async function compareSet(key, before, next) {
    if (!has) return false;
    try {
      const row = await db.get("SELECT value FROM kv_state WHERE key = :key", { ":key": String(key) });
      const current = row?.value == null ? null : JSON.parse(row.value);
      if (JSON.stringify(current ?? null) !== JSON.stringify(before ?? null)) return false;
      return await set(key, next);
    } catch { return false; }
  }

  const compareSetGuarded = (key, before, next) => compareSet(key, before, next);

  /** Conversation history: one row per (chat, user), bounded by the caller. */
  async function load({ userId, chatId }) {
    if (!has) return [];
    try {
      const row = await db.get(
        "SELECT messages FROM ai_memory WHERE chat_id = :chat AND user_id = :user",
        { ":chat": String(chatId), ":user": String(userId) },
      );
      const parsed = row?.messages ? JSON.parse(row.messages) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }

  async function save({ userId, chatId, messages }) {
    if (!has) return false;
    try {
      await db.run(
        "INSERT INTO ai_memory (chat_id, user_id, messages, updated_at) VALUES (:chat, :user, :messages, :at) ON CONFLICT(chat_id, user_id) DO UPDATE SET messages = :messages, updated_at = :at",
        { ":chat": String(chatId), ":user": String(userId), ":messages": JSON.stringify(messages ?? []), ":at": now() },
      );
      return true;
    } catch { return false; }
  }

  async function clear({ userId, chatId }) {
    if (!has) return false;
    try {
      await db.run(
        "DELETE FROM ai_memory WHERE chat_id = :chat AND user_id = :user",
        { ":chat": String(chatId), ":user": String(userId) },
      );
      return true;
    } catch { return false; }
  }

  return Object.freeze({
    available: has,
    get, getChecked, set, setIfAbsent, compareSet, compareSetGuarded,
    memory: Object.freeze({ load, save, clear }),
  });
}
