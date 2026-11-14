/**
 * Резервная копия души: всё, что Аи знает и помнит, одним файлом.
 *
 * Душа — это не код (он в репозитории), а нажитое: уроки и знания, отношения,
 * память о людях, их настройки, списки, привычки, напоминания, настройки
 * чатов и цитатники. Живёт оно в одной базе платформы; копия — способ
 * пережить потерю этой базы или перенести Аи в другой дом.
 *
 * Копию получает только хозяин и только в личке: в ней чужие записи.
 * Восстановление — тоже только его словом: файл возвращается ей с подписью
 * «восстанови душу». Записывается лишь то, что относится к душе: сборка,
 * очереди, кэши и замки из файла не берутся, даже если их туда вписать.
 */
import { fold } from "./sources.js";
import { utf8Bytes } from "./senses.js";

/** Начала ключей, из которых состоит душа. Остальное — кэши и служебное. */
export const SOUL_PREFIXES = Object.freeze([
  "ai:relationship:", "ai:impression:", "ai:names:",
  "heart:lessons:", "heart:unknown:", "heart:facts:",
  "heart:style:", "heart:first:", "heart:last:",
  "heart:lists:", "heart:habits:", "heart:reminders:",
  "heart:chat:", "heart:quotes:", "heart:score:",
  "heart:bond:", "heart:taught:",
]);
const MAX_KEYS = 20_000;

const SAVE = /^(?:(?:сделай|создай|пришли|дай|скинь|сохрани)\s+)?(?:резервн(?:ая|ую)\s+копи[яю](?:\s+души)?|копи[яю]\s+души|бэкап(?:\s+души)?|бекап(?:\s+души)?)$/u;
const LOAD = /^(?:восстанови|верни|загрузи)\s+(?:душу|копию\s+души|из\s+копии|резервную\s+копию)$/u;
/** «Резервная копия» → "save", «восстанови душу» → "load". */
export function parseSoul(text) {
  const value = fold(text).replace(/[?!.…]+$/u, "").trim();
  return SAVE.test(value) ? "save" : LOAD.test(value) ? "load" : null;
}

/** Байты → строка. `TextDecoder` в изоляте не обещан — есть своя запасная. */
export function utf8(bytes) {
  try { if (typeof TextDecoder === "function") return new TextDecoder("utf-8").decode(bytes); } catch { /* ниже — вручную */ }
  let out = "";
  for (let i = 0; i < bytes.length;) {
    const a = bytes[i++];
    if (a < 0x80) out += String.fromCharCode(a);
    else if (a < 0xe0) out += String.fromCharCode(((a & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (a < 0xf0) out += String.fromCharCode(((a & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    else out += String.fromCodePoint(((a & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
  }
  return out;
}

export function createSoul({ store = null, api = null, InputFile = null, now = () => Date.now(), build = "", dayOf = (at) => new Date(at).toISOString().slice(0, 10) } = {}) {
  /** Собрать копию: `{ ok, soul, count }`. */
  async function collect() {
    if (!store?.available || typeof store.dump !== "function") return { ok: false, code: "storage_unavailable" };
    const keys = {};
    let count = 0;
    for (const prefix of SOUL_PREFIXES) {
      const rows = await store.dump(prefix);
      if (rows == null) return { ok: false, code: "storage_unavailable" };
      for (const row of rows) {
        if (count >= MAX_KEYS) break;
        try { keys[row.key] = JSON.parse(row.value); count += 1; } catch { /* битая запись в копию не идёт */ }
      }
    }
    return { ok: true, count, soul: { soul: 1, build, at: now(), keys } };
  }

  /** Отправить копию файлом. */
  async function save(chatId) {
    const made = await collect();
    if (!made.ok) return made;
    if (typeof InputFile !== "function" || typeof api?.sendDocument !== "function") return { ok: false, code: "no_files" };
    const bytes = utf8Bytes(JSON.stringify(made.soul));
    const name = `ai-soul-${dayOf(now())}.json`;
    try {
      await api.sendDocument({
        chat_id: chatId, document: new InputFile(bytes, name, { type: "application/json" }),
        caption: `Копия души: записей — ${made.count}, сборка ${build}. Вернуть — прислать мне этот файл с подписью «восстанови душу».`,
      });
    } catch { return { ok: false, code: "send_failed" }; }
    return { ok: true, count: made.count, bytes: bytes.length, name };
  }

  /** Восстановить из файла. Пишет только ключи души; остальное пропускает. */
  async function load(fileId) {
    if (!store?.available) return { ok: false, code: "storage_unavailable" };
    if (!fileId || typeof api?.getFileContent !== "function") return { ok: false, code: "no_files" };
    let bytes = null;
    try { bytes = await api.getFileContent(fileId); } catch { return { ok: false, code: "download_failed" }; }
    if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
    if (!(bytes instanceof Uint8Array) || !bytes.length) return { ok: false, code: "download_failed" };
    let data = null;
    try { data = JSON.parse(utf8(bytes)); } catch { return { ok: false, code: "not_soul" }; }
    if (data?.soul !== 1 || !data.keys || typeof data.keys !== "object" || Array.isArray(data.keys)) return { ok: false, code: "not_soul" };
    let written = 0, skipped = 0, failed = 0;
    for (const [key, value] of Object.entries(data.keys).slice(0, MAX_KEYS)) {
      if (!SOUL_PREFIXES.some(prefix => key.startsWith(prefix)) || value == null || typeof value !== "object") { skipped += 1; continue; }
      if (await store.set(key, value)) written += 1; else failed += 1;
    }
    return { ok: failed === 0, code: failed ? "partial" : "ok", written, skipped, failed, at: Number(data.at) || 0, build: String(data.build ?? "") };
  }

  return Object.freeze({ collect, save, load });
}
