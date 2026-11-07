/**
 * Вести владельцу: сердце само говорит, что у него сломалось.
 *
 * До этого модуля о поломке можно было узнать только спросив — `/aidiag`
 * показывал состояние, но показывал его тому, кто уже зашёл. Владелец заходит
 * в разное время и живёт в своём часовом поясе, поэтому отчёт идёт первым, а не
 * ждёт вопроса.
 *
 * Что делает жалобу жалобой, а не шумом:
 *   - одна поломка — одно сообщение в сутки; повторы считаются числом;
 *   - не больше шести сообщений в сутки, остальное видно в `/aidiag`;
 *   - подробность чистится от ключей и обрезается: ни текста разговоров, ни
 *     чужих профилей в отчёте нет;
 *   - не дошло (Telegram, блокировка, офлайн) — осталось в очереди и уйдёт со
 *     следующим обновлением. Поэтому «разное время входа» больше не значит
 *     «не увидел».
 *
 * Сердце не зависит от этого модуля: без базы отчёт живёт в памяти изолята,
 * без владельца — копится в очереди, с закрытым мостом — работает как обычно.
 */

export const NOTICES_KEY = "notices:registry:v1";
export const OUTBOX_KEY = "notices:outbox:v1";
export const FLUSH_KEY = "notices:flush:v1";
/** Сколько сообщений о поломках владелец получает за сутки. */
export const MAX_PER_DAY = 6;
/** Через сколько одна и та же поломка снова имеет право на сообщение. */
export const REPEAT_AFTER_MS = 24 * 3600_000;
/** Слишком частые вызовы flush (одно обновление = один проход). */
export const FLUSH_INTERVAL_MS = 60_000;
/** Больше этого очередь не растёт: старое вытесняется, чтобы не копить мусор. */
export const OUTBOX_LIMIT = 12;
/** Сколько разных поломок помнить для /aidiag. */
export const KEEP = 24;
const DAY = 86_400_000;

/** Что делать — по компоненту, а не по тексту ошибки. */
const DEFAULT_HINTS = Object.freeze({
  provider: "Ключ провайдера: /aikey.",
  telegram: "Telegram не принял сообщение: проверьте, что бот не заблокирован.",
  storage: "Хранилище не отвечает — работаю без памяти.",
  bridge: "Мост к сестре: канал и секрет в настройках.",
  handler: "Подробности: /aidiag.",
  health: "Подробности: /aidiag.",
});

/**
 * Всё, что похоже на секрет, вырезается до сохранения: отчёт о поломке не
 * должен сам становиться утечкой.
 */
const SECRET_SHAPES = Object.freeze([
  /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/gu, // токен бота
  /\b(?:sk|pk|gsk|xai|hf)[-_][A-Za-z0-9_-]{8,}\b/gu, // ключи провайдеров
  /\b[A-Za-z0-9_-]{32,}\b/gu, // длинные случайные строки, включая наши секреты
]);

export function redactDetail(value, limit = 160) {
  let text = String(value ?? "").replace(/\s+/gu, " ").trim();
  for (const shape of SECRET_SHAPES) text = text.replace(shape, "«скрыто»");
  return text.slice(0, limit);
}

function slug(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/gu, "_")
    .replace(/_+/gu, "_")
    .replace(/^[_.:-]+|[_.:-]+$/gu, "")
    .slice(0, 64) || "unknown";
}

/** Устойчивый ключ поломки: перезапуск не делает её новой. */
export function fingerprintOf(component, code) {
  return `${slug(component)}:${slug(code)}`;
}

/** Текст, который владелец увидит в личке. */
export function incidentText({ title = "", detail = "", count = 1, hint = "", fingerprint = "", severity = "fault" } = {}) {
  const head = severity === "degraded"
    ? "△ Хозяин, у меня это работает хуже"
    : "🚨 Хозяин, у меня это сломалось";
  const lines = [head, "━━━━━━━━━━━━━━━━━━━━", `Где: ${title}`, `Что: ${detail || "без подробностей"}`];
  if (count > 1) lines.push(`Повтор: ${count} ${plural(count)} за сутки`);
  if (hint) lines.push(`Что делать: ${hint}`);
  if (fingerprint) lines.push(`Код: ${fingerprint}`);
  return lines.join("\n");
}

export function plural(count, one = "раз", few = "раза", many = "раз") {
  const value = Math.abs(Number(count) || 0) % 100;
  const last = value % 10;
  if (value > 10 && value < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

const clone = (value) => JSON.parse(JSON.stringify(value));

export function createNotices({ store = null, send = null, ownerId = null, now = () => Date.now(), maxPerDay = MAX_PER_DAY, repeatAfterMs = REPEAT_AFTER_MS, hints = {} } = {}) {
  const persistent = Boolean(store && typeof store.get === "function" && typeof store.set === "function");
  const owner = ownerId == null || String(ownerId).trim() === "" || String(ownerId) === "0" ? null : String(ownerId);
  // База может не ответить в момент поломки. Тогда хотя бы этот изолят
  // расскажет о случившемся, вместо того чтобы промолчать вдвойне.
  const memory = new Map();

  async function read(key) {
    if (persistent) {
      try {
        const value = await store.get(key);
        if (value != null) return value;
      } catch { /* падаем в память ниже */ }
    }
    return memory.has(key) ? clone(memory.get(key)) : null;
  }

  async function write(key, before, next) {
    memory.set(key, clone(next));
    if (!persistent) return true;
    try {
      if (before == null) {
        if (typeof store.setIfAbsent === "function" && await store.setIfAbsent(key, next)) return true;
      } else if (typeof store.compareSet === "function" && await store.compareSet(key, before, next)) {
        return true;
      }
      return Boolean(await store.set(key, next));
    } catch {
      return false;
    }
  }

  /**
   * Прочитать, изменить, записать. Пачка обновлений может прийти одновременно,
   * поэтому запись сравнивается с прочитанным; после трёх неудач выигрывает
   * «просто записать»: потерянный счётчик повторов дешевле потерянной поломки.
   */
  async function update(key, shape, change) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const raw = await read(key);
      const before = raw && typeof raw === "object" ? raw : null;
      const next = change(clone(before ?? shape));
      if (next == null) return before;
      if (await write(key, before, next)) return next;
    }
    const raw = await read(key);
    const next = change(clone(raw && typeof raw === "object" ? raw : shape));
    if (next != null) await write(key, null, next);
    return next;
  }

  const dayOf = (at) => new Date(at).toISOString().slice(0, 10);
  const hintFor = (component, given) => given || hints[component] || DEFAULT_HINTS[component] || "";

  /**
   * Записать поломку. Возвращает, что произошло на самом деле: это повтор,
   * это уже седьмое сообщение за сутки, или оно ушло владельцу.
   */
  async function report({ component = "bot", code = "error", title = "", detail = "", severity = "fault", hint = "" } = {}) {
    const fingerprint = fingerprintOf(component, code);
    const at = now();
    const clean = redactDetail(detail);
    const label = redactDetail(title || component, 48);

    let entry = null;
    await update(NOTICES_KEY, { version: 1, items: {} }, registry => {
      const items = registry.items && typeof registry.items === "object" ? registry.items : {};
      const previous = items[fingerprint] ?? null;
      entry = {
        fingerprint,
        component: slug(component),
        title: label,
        code: slug(code),
        detail: clean,
        severity: severity === "degraded" ? "degraded" : "fault",
        firstAt: previous?.firstAt ?? at,
        lastAt: at,
        count: Number(previous?.count ?? 0) + 1,
        reportedAt: Number(previous?.reportedAt ?? 0),
        suppressed: Number(previous?.suppressed ?? 0),
      };
      items[fingerprint] = entry;
      const ordered = Object.entries(items).sort((a, b) => Number(b[1]?.lastAt ?? 0) - Number(a[1]?.lastAt ?? 0));
      registry.items = Object.fromEntries(ordered.slice(0, KEEP));
      return registry;
    });
    if (!entry) return { ok: false, code: "not_recorded", fingerprint, sent: 0 };

    // Первая поломка — сразу. Та же самая — раз в сутки, и только числом.
    if (at - entry.reportedAt < repeatAfterMs) {
      return { ok: true, duplicate: true, queued: false, sent: 0, fingerprint, count: entry.count };
    }

    const counterKey = `notices:day:${dayOf(at)}`;
    const usedToday = Number(await read(counterKey)) || 0;
    if (usedToday >= maxPerDay) {
      await update(NOTICES_KEY, { version: 1, items: {} }, registry => {
        const item = registry.items?.[fingerprint];
        if (item) item.suppressed = Number(item.suppressed ?? 0) + 1;
        return registry;
      });
      return { ok: true, duplicate: false, queued: false, sent: 0, code: "daily_cap", fingerprint, count: entry.count };
    }

    const text = incidentText({ title: label, detail: clean, count: entry.count, hint: hintFor(component, hint), fingerprint, severity: entry.severity });
    const queued = await update(OUTBOX_KEY, { version: 1, items: [] }, box => {
      const items = Array.isArray(box.items) ? box.items : [];
      items.push({ id: `${fingerprint}@${at}`, fingerprint, text, at, tries: 0 });
      while (items.length > OUTBOX_LIMIT) items.shift();
      box.items = items;
      return box;
    });

    await update(NOTICES_KEY, { version: 1, items: {} }, registry => {
      const item = registry.items?.[fingerprint];
      if (item) item.reportedAt = at;
      return registry;
    });
    await write(counterKey, usedToday, usedToday + 1);

    // Ждать отправку прямо здесь: изолят может быть остановлен сразу после
    // ответа, и «отправим потом» означало бы «не отправим никогда».
    const delivered = await flush({ force: true, limit: 1 });
    return { ok: true, duplicate: false, queued: Boolean(queued), sent: delivered.sent ?? 0, fingerprint, count: entry.count, text };
  }

  /** Дослать то, что не дошло. Пустая очередь стоит одного чтения ключа. */
  async function flush({ force = false, limit = 4 } = {}) {
    const box = await read(OUTBOX_KEY);
    const items = Array.isArray(box?.items) ? [...box.items] : [];
    // Чистая очередь — самый частый случай, и он не должен стоить записи.
    if (!items.length) return { ok: true, sent: 0, failed: 0, pending: 0 };
    // Долбящий Telegram бот — не заботливый бот: между попытками минута.
    const last = Number(await read(FLUSH_KEY)) || 0;
    if (!force && now() - last < FLUSH_INTERVAL_MS) return { ok: true, skipped: "interval", sent: 0, pending: items.length };
    await write(FLUSH_KEY, last || null, now());
    if (!owner) return { ok: false, code: "owner_unknown", sent: 0, failed: 0, pending: items.length };
    if (typeof send !== "function") return { ok: false, code: "send_unavailable", sent: 0, failed: 0, pending: items.length };

    const keep = [];
    let sent = 0;
    let failed = 0;
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (sent >= limit) { keep.push(item); continue; }
      if (failed >= 2) { keep.push(item); continue; }
      try {
        await send(owner, item.text);
        sent++;
      } catch {
        // Не долбим Telegram пачкой: один отказ — пауза до следующего обновления.
        failed++;
        keep.push({ ...item, tries: Number(item.tries ?? 0) + 1 });
      }
    }
    await update(OUTBOX_KEY, { version: 1, items }, () => ({ version: 1, items: keep }));
    return { ok: failed === 0, sent, failed, pending: keep.length };
  }

  /** Что сломалось за последние сутки — для /aidiag. */
  async function list({ limit = 8, withinMs = DAY } = {}) {
    const registry = await read(NOTICES_KEY);
    const items = registry?.items && typeof registry.items === "object" ? Object.values(registry.items) : [];
    return items
      .filter(item => item && now() - Number(item.lastAt ?? 0) <= withinMs)
      .sort((a, b) => Number(b.lastAt ?? 0) - Number(a.lastAt ?? 0))
      .slice(0, Math.max(1, limit));
  }

  /** Короткая строка для диагностики: «нет» — тоже ответ. */
  async function text({ limit = 5 } = {}) {
    const items = await list({ limit });
    if (!items.length) return "Сбои: нет — за сутки ничего не ломалось.";
    const lines = items.map(item => {
      const mark = item.severity === "degraded" ? "△" : "✕";
      const times = Number(item.count ?? 1) > 1 ? ` · ${item.count} ${plural(Number(item.count))}` : "";
      return `${mark} ${item.title}: ${item.detail}${times}`;
    });
    return ["Сбои (за сутки):", ...lines].join("\n");
  }

  /** Сколько ждёт отправки: один ключ, без чтения всей очереди. */
  async function pending() {
    const box = await read(OUTBOX_KEY);
    return Array.isArray(box?.items) ? box.items.length : 0;
  }

  return Object.freeze({
    configured: persistent,
    ownerKnown: owner != null,
    report,
    flush,
    list,
    text,
    pending,
    redactDetail,
    fingerprintOf,
    incidentText,
  });
}
