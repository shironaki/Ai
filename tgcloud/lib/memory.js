/**
 * Память о человеке: то, что он сам попросил запомнить.
 *
 * Не переписка и не догадки модели — только прямые слова «запомни, …».
 * Список короткий и с границей: память, которая растёт бесконечно, перестаёт
 * быть памятью и становится складом.
 *
 * Формат записи — массив строк в `heart:facts:<id>`: его уже читает контекст
 * ответа, поэтому новые модули не должны менять форму.
 */
const LIMIT = 40;
const FACT_KEY = userId => `heart:facts:${userId}`;

/** Одна строка, без переводов строк и без мусора: это попадает в ответ. */
export function cleanFact(value) {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  if (!text) return "";
  return text.slice(0, 200);
}

export function createMemory({ store } = {}) {
  if (!store) throw new TypeError("createMemory needs store");

  async function list(userId) {
    const value = await store.get(FACT_KEY(userId));
    const items = Array.isArray(value?.items) ? value.items : [];
    return items.filter(item => typeof item === "string" && item.trim());
  }

  /**
   * Добавить факт. Повтор не дублируется: сказать одно и то же дважды —
   * обычное дело, и память не должна от этого пухнуть.
   */
  async function add(userId, value) {
    const text = cleanFact(value);
    if (!text) return { ok: false, code: "empty" };
    const items = await list(userId);
    const exists = items.some(item => item.toLowerCase() === text.toLowerCase());
    const next = exists ? items : [...items, text].slice(-LIMIT);
    const saved = await store.set(FACT_KEY(userId), { items: next, updatedAt: Date.now() });
    if (!saved) return { ok: false, code: "storage_unavailable" };
    return { ok: true, text, duplicate: exists, count: next.length };
  }

  /** Убрать одну запись по номеру из списка (нумерация с единицы). */
  async function removeAt(userId, index) {
    const items = await list(userId);
    const position = Number(index) - 1;
    if (!Number.isInteger(position) || position < 0 || position >= items.length) {
      return { ok: false, code: "no_such_fact", count: items.length };
    }
    const [removed] = items.splice(position, 1);
    const saved = await store.set(FACT_KEY(userId), { items, updatedAt: Date.now() });
    if (!saved) return { ok: false, code: "storage_unavailable" };
    return { ok: true, removed, count: items.length };
  }

  async function clear(userId) {
    const items = await list(userId);
    const saved = await store.set(FACT_KEY(userId), { items: [], updatedAt: Date.now() });
    if (!saved) return { ok: false, code: "storage_unavailable" };
    return { ok: true, removed: items.length };
  }

  return Object.freeze({ list, add, removeAt, clear, LIMIT });
}
