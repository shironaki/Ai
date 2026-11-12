/**
 * Память о человеке: то, что он сам попросил запомнить.
 *
 * Не переписка и не догадки модели — только прямые слова «запомни, …».
 * Список короткий и с границей: память, которая растёт бесконечно, перестаёт
 * быть памятью и становится складом.
 *
 * У памяти есть место. Сказанное в личке остаётся в личке: раньше факт из
 * личного разговора попадал в подсказку ответа в группе, и модель могла
 * произнести его при всех. Теперь списков два:
 *   - `heart:facts:<id>`        — сказано в личке, в группе не используется;
 *   - `heart:facts:public:<id>` — сказано при всех, годится везде.
 * Старые записи лежат в первом ключе и потому считаются личными: это
 * безопасная сторона ошибки.
 */
const LIMIT = 40;
const PRIVATE_KEY = userId => `heart:facts:${userId}`;
const PUBLIC_KEY = userId => `heart:facts:public:${userId}`;

/** Одна строка, без переводов строк и без мусора: это попадает в ответ. */
export function cleanFact(value) {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  if (!text) return "";
  return text.slice(0, 200);
}

export function createMemory({ store, now = () => Date.now() } = {}) {
  if (!store) throw new TypeError("createMemory needs store");

  async function read(key) {
    const value = await store.get(key);
    const items = Array.isArray(value?.items) ? value.items : [];
    return items.filter(item => typeof item === "string" && item.trim());
  }
  const write = (key, items) => store.set(key, { items, updatedAt: now() });

  /**
   * Что видно в этом месте, в том порядке, в каком показывается человеку:
   * в группе — только сказанное при всех, в личке — личное, затем общее.
   * Номера в «забудь 2» считаются по этому же списку.
   */
  async function visible(userId, { inGroup = false } = {}) {
    const shared = (await read(PUBLIC_KEY(userId))).map(text => ({ text, shared: true }));
    if (inGroup) return shared;
    const own = (await read(PRIVATE_KEY(userId))).map(text => ({ text, shared: false }));
    return [...own, ...shared];
  }

  async function list(userId, place = {}) {
    return (await visible(userId, place)).map(item => item.text);
  }

  /**
   * Добавить факт туда, где он сказан. Повтор не дублируется: сказать одно и
   * то же дважды — обычное дело, и память не должна от этого пухнуть.
   */
  async function add(userId, value, { inGroup = false } = {}) {
    const text = cleanFact(value);
    if (!text) return { ok: false, code: "empty" };
    const known = await visible(userId, { inGroup: false });
    if (known.some(item => item.text.toLowerCase() === text.toLowerCase())) {
      return { ok: true, text, duplicate: true, count: known.length };
    }
    const key = inGroup ? PUBLIC_KEY(userId) : PRIVATE_KEY(userId);
    const next = [...await read(key), text].slice(-LIMIT);
    if (!await write(key, next)) return { ok: false, code: "storage_unavailable" };
    return { ok: true, text, duplicate: false, count: known.length + 1 };
  }

  async function removeWhere(userId, place, pick) {
    const items = await visible(userId, place);
    const position = pick(items);
    if (!Number.isInteger(position) || position < 0 || position >= items.length) {
      return { ok: false, code: "no_such_fact", count: items.length };
    }
    const target = items[position];
    const key = target.shared ? PUBLIC_KEY(userId) : PRIVATE_KEY(userId);
    const rest = await read(key);
    const at = rest.indexOf(target.text);
    if (at >= 0) rest.splice(at, 1);
    if (!await write(key, rest)) return { ok: false, code: "storage_unavailable" };
    return { ok: true, removed: target.text, count: items.length - 1 };
  }

  /** Убрать одну запись по номеру из показанного списка (нумерация с единицы). */
  const removeAt = (userId, index, place = {}) => removeWhere(userId, place, () => Number(index) - 1);

  /** «Забудь это» — последняя запись, а не вся память. */
  const removeLast = (userId, place = {}) => removeWhere(userId, place, items => {
    // Последнее сказанное здесь: в личке это личная запись, если она есть.
    if (!place.inGroup) {
      const own = items.filter(item => !item.shared).length;
      if (own > 0) return own - 1;
    }
    return items.length - 1;
  });

  /** «Забудь всё»: в группе — только сказанное при всех, в личке — оба списка. */
  async function clear(userId, { inGroup = false } = {}) {
    const items = await visible(userId, { inGroup });
    const done = [await write(PUBLIC_KEY(userId), [])];
    if (!inGroup) done.push(await write(PRIVATE_KEY(userId), []));
    if (done.some(ok => !ok)) return { ok: false, code: "storage_unavailable" };
    return { ok: true, removed: items.length };
  }

  /** Сколько записей всего, без оглядки на место: для карточки в личке. */
  async function count(userId) {
    return (await visible(userId, { inGroup: false })).length;
  }

  return Object.freeze({ list, add, removeAt, removeLast, clear, count, LIMIT });
}
