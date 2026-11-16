/**
 * The heart's storage: two ports, nothing else.
 *
 * Memory is a conversation, storage is a small key-value map (relationship,
 * names, preferences). Both are expressed as the shapes the core already
 * expects, so the heart can be moved to another database by replacing this file
 * alone.
 */
import { sleep } from "./timers.js";

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

  /** Удалить ключ. «Не было» и «удалён» — один исход: его больше нет. */
  async function remove(key) {
    if (!has) return false;
    try {
      await db.run("DELETE FROM kv_state WHERE key = :key", { ":key": String(key) });
      return true;
    } catch { return false; }
  }

  /**
   * Убрать устаревшие записи с общим началом ключа: ответы моста, которых
   * никто не дождался, отметки одноразовых событий. Сами не исчезают.
   */
  async function sweep(prefix, olderThanMs) {
    if (!has) return false;
    try {
      await db.run(
        "DELETE FROM kv_state WHERE key LIKE :prefix AND updated_at < :before",
        // Отрицательный срок — «всё, что есть»: граница уходит в будущее.
        { ":prefix": `${String(prefix)}%`, ":before": now() - (Number(olderThanMs) || 0) },
      );
      return true;
    } catch { return false; }
  }

  /** Все записи с общим началом ключа — для резервной копии. `null` — база не ответила. */
  async function dump(prefix, limit = 5000) {
    if (!has || typeof db.all !== "function") return null;
    try {
      const rows = await db.all(
        `SELECT key, value FROM kv_state WHERE key LIKE :prefix ORDER BY key LIMIT ${Math.max(1, Math.min(20_000, Math.round(Number(limit) || 5000)))}`,
        { ":prefix": `${String(prefix)}%` },
      );
      return (Array.isArray(rows) ? rows : []).filter(row => row?.key != null && row.value != null).map(row => ({ key: String(row.key), value: String(row.value) }));
    } catch { return null; }
  }

  /** Последние записи с общим началом ключа, по порядку ключей: хвост журнала. `null` — база не ответила. */
  async function tail(prefix, limit = 100) {
    if (!has || typeof db.all !== "function") return null;
    try {
      const rows = await db.all(
        `SELECT key, value FROM kv_state WHERE key LIKE :prefix ORDER BY key DESC LIMIT ${Math.max(1, Math.min(1000, Math.round(Number(limit) || 100)))}`,
        { ":prefix": `${String(prefix)}%` },
      );
      const out = [];
      for (const row of Array.isArray(rows) ? rows : []) {
        try { out.push({ key: String(row.key), value: JSON.parse(String(row.value)) }); } catch { /* битая запись — мимо */ }
      }
      return out.reverse();
    } catch { return null; }
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

  /** Пауза в миллисекундах; где таймеров нет (так на платформе) — без паузы. */
  const pause = sleep;

  /**
   * Правка поверх самого свежего значения. `change(value)` получает то, что
   * лежит сейчас (или null), и возвращает новое; null — «править нечего».
   *
   * Пишется одним условным запросом — «замени, только если там всё ещё то, что
   * я читала». База выполняет его целиком, поэтому из двух одновременных правок
   * проходит одна, а вторая повторяется уже поверх первой: ничья запись не
   * затирается. У `compareSet` между чтением и записью есть щель в один запрос;
   * здесь её нет.
   *
   * Возвращает true, если правка легла. `change` может быть вызвана несколько
   * раз — она не должна ничего делать, кроме как считать новое значение.
   */
  async function update(key, change, { tries = 16 } = {}) {
    if (!has || typeof change !== "function") return false;
    const name = String(key);
    const read = () => db.get("SELECT value FROM kv_state WHERE key = :key", { ":key": name });
    let seen;
    let cycle = 0;
    for (let attempt = 0; attempt < tries; attempt += 1) {
      // Не прошло — кто-то пишет в ту же секунду. Разойтись с ним на случайное время:
      // окно растёт вдвое с каждой неудачей и меряется тем, сколько длится одна попытка
      // здесь, — тогда и сорок одновременных правок расходятся, а две почти не ждут.
      if (attempt > 0) await pause(Math.random() * Math.min(1500, cycle * 2 ** attempt));
      // Время — настоящее: `now` в тестах стоит на месте.
      const started = Date.now();
      let before = null;
      let next;
      try {
        const row = await read();
        before = row?.value == null ? null : String(row.value);
        next = change(before == null ? null : JSON.parse(before));
      } catch { return false; }
      if (next == null) return false;
      const text = JSON.stringify(next);
      // Значение не менялось, а условная запись всё равно не прошла: база сравнивает
      // не так, как ожидалось. Пишем по-старому — редкая гонка лучше правки, которая
      // не ложится никогда.
      if (attempt > 0 && before === seen) return set(name, next);
      seen = before;
      try {
        const result = before == null
          ? await db.run(
            "INSERT INTO kv_state (key, value, updated_at) VALUES (:key, :value, :at) ON CONFLICT(key) DO NOTHING",
            { ":key": name, ":value": text, ":at": now() },
          )
          : await db.run(
            "UPDATE kv_state SET value = :value, updated_at = :at WHERE key = :key AND value = :before",
            { ":key": name, ":value": text, ":at": now(), ":before": before },
          );
        if (typeof result?.rowsAffected === "number") {
          if (result.rowsAffected > 0) return true;
        } else {
          // База не сказала, сколько строк тронула: смотрим, что лежит. Две одинаковые
          // правки так не различить (обе увидят «своё») — разные не теряются и здесь.
          const row = await read();
          if (row?.value === text) return true;
        }
      } catch {
        // Условный запрос не выполнился вовсе — пишем по-старому.
        return set(name, next);
      }
      cycle = Math.max(2, Date.now() - started);
    }
    // Столько раз подряд опередили. Свою правку всё равно кладём — поверх того, что лежит
    // сейчас: потерять её наверняка хуже, чем, может быть, задеть соседнюю.
    try {
      const last = change(await get(name));
      return last == null ? false : await set(name, last);
    } catch { return false; }
  }

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

  /** Вся переписка человека во всех чатах: для «удали всё обо мне». */
  async function clearUser({ userId }) {
    if (!has) return false;
    try {
      await db.run("DELETE FROM ai_memory WHERE user_id = :user", { ":user": String(userId) });
      return true;
    } catch { return false; }
  }

  /**
   * «Хранилище есть» и «хранилище работает» — разные факты, и разница стоила
   * пользователю двух часов недоумения: /status отвечал «доступно» (объект
   * базы передан), а «запомни, …» — «не отвечает» (таблиц не было).
   *
   * Проба делает настоящие чтение и запись. Обе половины называются отдельно:
   * чтение есть, а записи нет — это неприменённая схема, а не поломка базы.
   */
  async function probe() {
    if (!has) return { read: false, write: false, code: "no_database" };
    const read = await getChecked("heart:probe").then(result => result.ok).catch(() => false);
    const write = await set("heart:probe", { at: now() });
    return { read, write, code: read && write ? "ok" : read ? "write_failed" : "read_failed" };
  }

  return Object.freeze({
    available: has,
    dump, tail,
    probe,
    get, getChecked, set, setIfAbsent, compareSet, compareSetGuarded, update, remove, sweep,
    memory: Object.freeze({ load, save, clear, clearUser }),
  });
}
