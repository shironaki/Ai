/**
 * Отложенные ответы: вопрос, на который сейчас нечем думать.
 *
 * Лимит провайдера кончился, связь пропала — раньше человек получал «лимит
 * исчерпан», и на этом всё: вопрос пропадал, спрашивать надо было заново.
 * Теперь вопрос записывается, а Аи отвечает сама, когда сможет, — ответом на
 * то самое сообщение.
 *
 * Очередь короткая и с границами: не больше двух вопросов от одного человека,
 * не больше двадцати всего, и ничего старше суток — ответ на вчерашний вопрос
 * уже не ответ.
 */
export const QUEUE_KEY = "heart:queue:v1";
const DAY = 86_400_000;

export function createQueue({ store = null, now = () => Date.now(), limit = 20, perUser = 2, ttlMs = DAY } = {}) {
  let memory = { seq: 0, items: [] };

  async function read() {
    let saved = null;
    try { saved = store && typeof store.get === "function" ? await store.get(QUEUE_KEY) : null; } catch { saved = null; }
    const value = saved && typeof saved === "object" ? saved : memory;
    return { seq: Number(value.seq) || 0, items: Array.isArray(value.items) ? value.items : [] };
  }

  async function write(before, next) {
    memory = next;
    if (!store || typeof store.set !== "function") return true;
    try {
      if (before.items.length || before.seq) {
        if (typeof store.compareSet === "function") return Boolean(await store.compareSet(QUEUE_KEY, before, next));
      }
      return Boolean(await store.set(QUEUE_KEY, next));
    } catch { return false; }
  }

  /** Записать вопрос. Отказ называет причину: «очередь полна» — тоже ответ. */
  async function push(item = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const state = await read();
      const fresh = state.items.filter(entry => now() - Number(entry.at) < ttlMs);
      if (fresh.filter(entry => String(entry.userId) === String(item.userId)).length >= perUser) return { ok: false, code: "user_cap", size: fresh.length };
      if (fresh.length >= limit) return { ok: false, code: "full", size: fresh.length };
      const entry = {
        id: state.seq + 1,
        chatId: item.chatId, userId: item.userId,
        messageId: item.messageId ?? null, threadId: item.threadId ?? null,
        prompt: String(item.prompt ?? "").slice(0, 2000),
        note: String(item.note ?? "").slice(0, 600),
        isPrivate: Boolean(item.isPrivate),
        name: String(item.name ?? "").slice(0, 32),
        at: now(),
      };
      if (await write(state, { seq: entry.id, items: [...fresh, entry] })) return { ok: true, id: entry.id, size: fresh.length + 1 };
    }
    return { ok: false, code: "storage_unavailable", size: 0 };
  }

  /**
   * Взять самый старый вопрос. Он сразу уходит из очереди: если ответить не
   * выйдет, вызывающий вернёт его сам (`giveBack`), а два изолята не ответят
   * на один вопрос дважды.
   */
  async function take() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const state = await read();
      if (!state.items.length) return { item: null, dropped: 0 };
      const fresh = state.items.filter(entry => now() - Number(entry.at) < ttlMs);
      const dropped = state.items.length - fresh.length;
      const [item, ...rest] = fresh;
      if (await write(state, { seq: state.seq, items: rest })) return { item: item ?? null, dropped };
    }
    return { item: null, dropped: 0 };
  }

  /** Вернуть вопрос в начало очереди: ответить снова не получилось. */
  async function giveBack(item) {
    if (!item) return false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const state = await read();
      if (state.items.some(entry => entry.id === item.id)) return true;
      if (await write(state, { seq: state.seq, items: [item, ...state.items].slice(0, limit) })) return true;
    }
    return false;
  }

  async function size() {
    return (await read()).items.filter(entry => now() - Number(entry.at) < ttlMs).length;
  }

  return Object.freeze({ push, take, giveBack, size });
}
