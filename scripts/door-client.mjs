#!/usr/bin/env node
/**
 * Дверь приложения со стороны посредника — образец и опыт в одном файле. Договор — `docs/DOOR.md`.
 *
 * Зачем: приложение (другой чат) пишет посредника на своём языке; здесь — то же самое, сорок строк на Node без
 * зависимостей, сверенных тестами с сердцем (`tests/door.test.mjs`). С телефона этим же файлом делается опыт:
 * настоящий запрос уходит в канал двери от второго бота, и сердце отвечает.
 *
 *   node scripts/door-client.mjs setup [номер канала]   настроить: найти канал двери, придумать секрет и дописать
 *                                                       строку KEY_DOOR в файл ключей; проверить права ботов
 *   node scripts/door-client.mjs key [номер канала]     новый секрет; с номером канала — готовая строка KEY_DOOR
 *   node scripts/door-client.mjs where                  в каких каналах бот двери видел посты: имя и номер
 *   node scripts/door-client.mjs [действие] [json]      опыт: запрос через Telegram и ответ сердца (по умолчанию look)
 *   node scripts/door-client.mjs seal <действие> [json] напечатать текст поста с запросом, ничего не посылая
 *   node scripts/door-client.mjs open < посты.txt       проверить и собрать ответ из текстов постов (по строке)
 *
 * Что нужно для опыта — строками в ~/.heart.env (тот же файл, что у `phone.sh`) или в окружении:
 *   KEY_DOOR=номер канала:секрет    тот же, с которым опубликовано сердце
 *   DOOR_BOT_TOKEN=…                токен бота двери — любого, кроме Аи; нет строки — берётся ALARM_BOT_TOKEN
 *   OWNER_TG_ID=…                   от чьего имени войти (или `--uid число`)
 * Ни токена публикации, ни ключа бота Аи этому файлу не нужно — в этом и смысл двери.
 */
import { readFileSync, appendFileSync, realpathSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { hmac, sameBytes, doorKey, doorPayload, doorWire, doorRead, DOOR_PREFIX } from "../tgcloud/lib/bridge.js";

/** Запечатать запрос: то, что посредник пишет постом в канал двери. */
export async function sealRequest({ secret, uid, do: action = "look", input = {}, id = randomBytes(12).toString("base64url"), ts = Date.now() }) {
  const envelope = { v: 1, t: "q", id, ts, uid: Number(uid), do: String(action), in: JSON.stringify(input ?? {}) };
  return { ...envelope, sig: await hmac(secret, doorPayload(envelope)) };
}

/**
 * Разобрать посты сердца по одному запросу. `texts` — тексты постов канала, в любом порядке и с чужими вперемешку.
 * Ответ готов, когда собраны все части с верной подписью: `{ ok: true, result }` — `result` и есть ответ `onRoom`.
 * Пометка двери (`t: "e"`) — `{ ok: false, code, trusted }`: запрос не исполнялся; `trusted: false` — подпись
 * пометки не сошлась, то есть ключи у сторон разные, и код годится только для журнала.
 */
export async function openAnswer({ secret, id, texts = [] }) {
  const parts = new Map();
  let total = 0, refusal = null;
  for (const text of texts) {
    const envelope = doorRead(text);
    if (!envelope || envelope.re !== id) continue;
    const signed = typeof envelope.sig === "string" && sameBytes(await hmac(secret, doorPayload(envelope)), envelope.sig);
    if (envelope.t === "e") { refusal = { ok: false, code: String(envelope.code ?? "refused"), build: envelope.build, trusted: signed }; continue; }
    if (envelope.t !== "a" || !signed) continue;
    if (!Number.isInteger(envelope.n) || !Number.isInteger(envelope.of) || envelope.n < 1 || envelope.n > envelope.of || typeof envelope.body !== "string") continue;
    total = envelope.of;
    parts.set(envelope.n, envelope.body);
  }
  if (total && parts.size === total) {
    const body = Array.from({ length: total }, (_, index) => parts.get(index + 1)).join("");
    try { return { ok: true, result: JSON.parse(body), parts: total }; } catch { return { ok: false, code: "bad_body" }; }
  }
  return refusal ?? { ok: false, code: "waiting", have: parts.size, of: total };
}

/** Строки «ИМЯ=значение» из файла ключей; окружение главнее файла. */
function settings() {
  const file = process.env.HEART_ENV || `${homedir()}/.heart.env`, found = {};
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const pair = /^\s*([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
      if (pair) found[pair[1]] = pair[2].trim().replace(/^(["'])(.*)\1$/u, "$2");
    }
  } catch { /* файла нет — остаётся окружение */ }
  const pick = (name) => String(process.env[name] || found[name] || "").trim();
  return { key: doorKey(pick("KEY_DOOR")), rawKey: pick("KEY_DOOR"), token: pick("DOOR_BOT_TOKEN") || pick("ALARM_BOT_TOKEN"), owner: pick("OWNER_TG_ID"), api: pick("DOOR_API") || "https://api.telegram.org", file, inFile: found.KEY_DOOR ?? "" };
}

function telegram({ api, token }) {
  return async (method, params = {}) => {
    const response = await fetch(`${api}/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params) });
    const body = await response.json().catch(() => null);
    if (!body?.ok) throw Object.assign(Error(`${method}: ${body?.description ?? `ответ ${response.status}`}`), { code: body?.error_code ?? response.status });
    return body.result;
  };
}

const say = (text) => process.stdout.write(`${text}\n`);

async function main(args) {
  const flags = args.filter(item => item.startsWith("--")), words = args.filter(item => !item.startsWith("--"));
  const flag = (name) => flags.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3) ?? "";
  const command = words[0] ?? "look", conf = settings();

  if (command === "key") {
    const secret = randomBytes(32).toString("base64url");
    if (!words[1]) { say(secret); return 0; }
    if (!doorKey(`${words[1]}:${secret}`)) { say("Номер канала должен начинаться с -100 и состоять из цифр — его называет «where»."); return 1; }
    say(`KEY_DOOR=${words[1]}:${secret}`);
    return 0;
  }

  if (command === "open") {
    if (!conf.key) { say("Нет строки KEY_DOOR — проверять подпись нечем."); return 1; }
    const texts = readFileSync(0, "utf8").split("\n").filter(line => line.includes(DOOR_PREFIX.trim()));
    const ids = [...new Set(texts.map(text => doorRead(text)?.re).filter(Boolean))];
    if (!ids.length) { say("В этих строках нет постов сердца."); return 1; }
    let bad = 0;
    for (const id of ids) {
      const opened = await openAnswer({ secret: conf.key.secret, id, texts });
      if (!opened.ok) bad += 1;
      say(JSON.stringify({ id, ...opened }));
    }
    return bad ? 1 : 0;
  }

  const uid = Number(flag("uid") || conf.owner);
  if (command === "seal") {
    if (!conf.key) { say(`Нет строки KEY_DOOR (смотрела в окружении и в ${conf.file}).`); return 1; }
    if (!Number.isSafeInteger(uid) || uid <= 0) { say("От чьего имени? Нужна строка OWNER_TG_ID или --uid=число."); return 1; }
    let input = {};
    try { input = words[2] ? JSON.parse(words[2]) : {}; } catch { say("Третье слово — JSON с полями действия, например '{\"id\":\"abc123\"}'."); return 1; }
    say(doorWire(await sealRequest({ secret: conf.key.secret, uid, do: words[1] ?? "look", input })));
    return 0;
  }

  if (!conf.token) { say(`Нет токена бота двери: строка DOOR_BOT_TOKEN (или ALARM_BOT_TOKEN) в ${conf.file}.`); return 1; }
  const call = telegram(conf);

  /** Каналы, которые бот двери видел в последних обновлениях: номер → имя. `null` — Telegram не дал спросить. */
  const channels = async () => {
    let updates;
    // Последние сто, а не первые: у бота, которого никто не спрашивает, за сутки копится очередь из чужих каналов.
    try { updates = await call("getUpdates", { offset: -100, limit: 100, timeout: 0, allowed_updates: ["channel_post", "my_chat_member"] }); }
    catch (error) { say(error.code === 409 ? "У этого бота включён вебхук — спросить его «что нового» нельзя. Возьмите другого бота." : `Telegram не ответил: ${error.message}`); return null; }
    const seen = new Map();
    for (const update of updates) {
      const chat = update.channel_post?.chat ?? update.my_chat_member?.chat;
      if (chat?.type === "channel") seen.set(String(chat.id), chat.title ?? "без имени");
    }
    return seen;
  };
  const NOT_SEEN = "Бот двери пока не видел ни одного канала. Сделайте его администратором канала двери, напишите в канале любое слово и повторите.";

  if (command === "where") {
    const seen = await channels();
    if (!seen) return 1;
    if (!seen.size) { say(NOT_SEEN); return 1; }
    for (const [id, title] of seen) say(`канал «${title}»: ${id}`);
    return 0;
  }

  if (command === "setup") {
    let channel = words[1] ?? "", title = "";
    if (conf.key && (!channel || channel === conf.key.channel)) channel = conf.key.channel;
    else if (conf.rawKey && conf.inFile) { say(`В ${conf.file} уже есть строка KEY_DOOR — с другим каналом или записанная не так. Уберите её сами: молча менять ключ не буду.`); return 1; }
    if (!channel) {
      const seen = await channels();
      if (!seen) return 1;
      if (!seen.size) { say(NOT_SEEN); return 1; }
      const named = [...seen].filter(([, name]) => /двер|door/iu.test(name)), pool = named.length ? named : [...seen];
      if (pool.length !== 1) {
        say("Каналов несколько — назовите номер нужного: node scripts/door-client.mjs setup <номер>");
        for (const [id, name] of seen) say(`канал «${name}»: ${id}`);
        return 1;
      }
      [channel, title] = pool[0];
    }
    if (!/^-100\d{5,15}$/u.test(channel)) { say("Номер канала должен начинаться с -100 и состоять из цифр — его называет «where»."); return 1; }
    // Права: бот двери должен писать, Аи — быть администратором; лишних читателей в канале быть не должно.
    let admins = [];
    try { admins = await call("getChatAdministrators", { chat_id: channel }); }
    catch (error) { say(`Канал ${channel} боту двери не виден: ${error.message}. Сделайте бота двери администратором канала.`); return 1; }
    const bots = admins.filter(item => item.user?.is_bot).map(item => `@${item.user.username}`);
    say(`Канал${title ? ` «${title}»` : ""}: ${channel}. Боты-администраторы: ${bots.join(", ") || "нет"}.`);
    if (bots.length < 2) say("• В канале должен быть и бот двери, и Аи — оба администраторами. Добавьте недостающего.");
    try {
      const members = await call("getChatMemberCount", { chat_id: channel });
      if (Number(members) > admins.length) say(`• В канале участников: ${members}, администраторов: ${admins.length}. Подписчики читают посты двери — уберите лишних.`);
    } catch { /* число участников — не главное */ }
    try { await call("sendMessage", { chat_id: channel, text: "Проверка: бот двери может писать в этот канал." }); }
    catch (error) { say(`• Бот двери не смог написать в канал: ${error.message}. Дайте ему право публиковать сообщения.`); return 1; }
    if (conf.key) { say(`Строка KEY_DOOR уже есть${conf.inFile ? ` в ${conf.file}` : ""} — оставляю её. Дальше: опубликовать сердце с этим ключом и проверить — node scripts/door-client.mjs look`); return 0; }
    const line = `KEY_DOOR=${channel}:${randomBytes(32).toString("base64url")}`;
    try {
      let before = "";
      try { before = readFileSync(conf.file, "utf8"); } catch { before = ""; }
      appendFileSync(conf.file, `${before && !before.endsWith("\n") ? "\n" : ""}# Дверь отдельного приложения (docs/DOOR.md): номер канала двери, двоеточие, секрет\n${line}\n`, { mode: 0o600 });
    } catch (error) { say(`Не смогла дописать ${conf.file}: ${error.message}. Впишите строку сами:`); say(line); return 1; }
    say(`Готово: строка KEY_DOOR дописана в ${conf.file}. Тот же ключ нужен посреднику приложения — возьмите его из этого файла, в чат не шлите.`);
    say("Дальше: опубликовать сердце с ключом (bash scripts/phone.sh deploy) и проверить — node scripts/door-client.mjs look");
    return 0;
  }

  // Опыт: запрос через Telegram и ответ сердца.
  if (!conf.key) { say(conf.rawKey ? "Строка KEY_DOOR записана не так: нужен вид «номер канала:секрет», секрет от 32 знаков." : `Нет строки KEY_DOOR (смотрела в окружении и в ${conf.file}).`); return 1; }
  if (!Number.isSafeInteger(uid) || uid <= 0) { say("От чьего имени войти? Нужна строка OWNER_TG_ID или --uid=число."); return 1; }
  let input = {};
  try { input = words[1] ? JSON.parse(words[1]) : {}; } catch { say("Второе слово — JSON с полями действия, например '{\"id\":\"abc123\"}'."); return 1; }
  const wait = Math.max(3, Math.min(120, Number(flag("wait")) || 25));
  let offset = 0;
  try {
    const tail = await call("getUpdates", { offset: -1, timeout: 0, allowed_updates: ["channel_post"] });
    if (tail.length) offset = tail.at(-1).update_id + 1;
  } catch (error) { say(error.code === 409 ? "У этого бота включён вебхук — ответ сердца он получить не сможет. Возьмите другого бота." : `Telegram не ответил: ${error.message}`); return 1; }
  const request = await sealRequest({ secret: conf.key.secret, uid, do: command, input });
  const started = Date.now();
  try { await call("sendMessage", { chat_id: conf.key.channel, text: doorWire(request), disable_web_page_preview: true }); }
  catch (error) { say(`Запрос не ушёл в канал двери: ${error.message}. Бот двери должен быть администратором канала с правом публиковать.`); return 1; }
  const texts = [];
  while (Date.now() - started < wait * 1000) {
    let updates = [];
    try { updates = await call("getUpdates", { offset, timeout: Number(flag("poll")) || 5, allowed_updates: ["channel_post"] }); }
    catch (error) { say(`Telegram не ответил: ${error.message}`); return 1; }
    for (const update of updates) {
      offset = update.update_id + 1;
      const post = update.channel_post;
      if (post && String(post.chat?.id) === conf.key.channel && typeof post.text === "string") texts.push(post.text);
    }
    const opened = await openAnswer({ secret: conf.key.secret, id: request.id, texts });
    if (opened.ok) {
      say(`Сердце ответило за ${((Date.now() - started) / 1000).toFixed(1)} с, постов: ${opened.parts}.`);
      say(JSON.stringify(opened.result, null, flags.includes("--flat") ? 0 : 2));
      return opened.result?.ok === false ? 2 : 0;
    }
    if (opened.code !== "waiting") {
      say(opened.trusted ? `Дверь не пустила: ${opened.code} (сердце ${opened.build ?? "?"}).` : `Дверь не пустила: ${opened.code}; подпись пометки не сошлась — ключи у сердца и здесь разные.`);
      return 1;
    }
  }
  say(`За ${wait} с ответа нет. Что проверить: сердце опубликовано с этой строкой KEY_DOOR; Аи — администратор канала двери; в «статус» у неё есть строка «Дверь приложения».`);
  return 1;
}

// Запущен как команда, а не взят модулем; путь сверяется настоящий — папка на телефоне бывает ссылкой.
const direct = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (direct) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, (error) => { say(`Не вышло: ${error?.message ?? error}`); process.exitCode = 1; });
}
