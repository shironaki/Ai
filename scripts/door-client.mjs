#!/usr/bin/env node
/**
 * Дверь приложения со стороны посредника — образец и опыт в одном файле. Договор — `docs/DOOR.md`.
 *
 * Зачем: приложение (другой чат) пишет посредника на своём языке; здесь — то же самое на Node без зависимостей,
 * сверенное тестами с сердцем (`tests/door.test.mjs`). С телефона этим же файлом делается опыт: настоящий запрос
 * уходит в канал двери от бота двери, и сердце отвечает. Обычно его зовёт `bash scripts/phone.sh door` — тот ведёт
 * по шагам: бот двери → канал → ключ → публикация сердца с ключом → опыт.
 *
 *   node scripts/door-client.mjs bot [токен]             годится ли бот для двери; с токеном — проверить и записать его
 *   node scripts/door-client.mjs setup [канал] [--wait=с] настроить: найти канал двери (или дождаться его), проверить
 *                                                        права ботов, придумать секрет и дописать строку KEY_DOOR
 *   node scripts/door-client.mjs key [номер канала]      новый секрет; с номером канала — готовая строка KEY_DOOR
 *   node scripts/door-client.mjs where                   в каких каналах бот двери — администратор: имя и номер
 *   node scripts/door-client.mjs [действие] [json]       опыт: запрос через Telegram и ответ сердца (по умолчанию look);
 *                                                        --full — весь ответ, --flat — он же одной строкой
 *   node scripts/door-client.mjs seal <действие> [json]  напечатать текст поста с запросом, ничего не посылая
 *   node scripts/door-client.mjs open < посты.txt        проверить и собрать ответ из текстов постов (по строке)
 *
 * Что нужно для опыта — строками в ~/.heart.env (тот же файл, что у `phone.sh`) или в окружении:
 *   KEY_DOOR=номер канала:секрет    тот же, с которым опубликовано сердце
 *   DOOR_BOT_TOKEN=…                токен бота двери: свой бот от @BotFather. Нет строки — пробуется ALARM_BOT_TOKEN,
 *                                   но бот, который живёт на сервере (у него вебхук), не годится: слушать канал
 *                                   через него с телефона нельзя (22.11.2026 первый опыт владельца упёрся в это)
 *   OWNER_TG_ID=…                   от чьего имени войти — если хозяин не записан в `tgcloud/lib/config.js`: как и
 *                                   сердце, посредник сначала смотрит туда (или `--uid=число`)
 *   DOOR_AI_ID=…                    номер бота Аи — чтобы назвать её права в канале (его передаёт `phone.sh door`)
 * Ни токена публикации, ни ключа бота Аи этому файлу не нужно — в этом и смысл двери.
 *
 * Чужой вебхук этот файл не трогает никогда: ни `deleteWebhook`, ни `setWebhook` здесь нет и быть не должно —
 * бот с вебхуком занят своим делом, и снять его значило бы оглушить чужую программу.
 *
 * Чем кончается (код выхода): 0 — вышло; 1 — не вышло, причина словами; 2 — дверь или комната отказали;
 * 3 — бот живёт на сервере; 4 — это сама Аи; 5 — ответа нет; 6 — бота двери нет вовсе; 7 — ключи у сторон разные.
 */
import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
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
  const own = pick("DOOR_BOT_TOKEN"), alarm = pick("ALARM_BOT_TOKEN");
  return {
    key: doorKey(pick("KEY_DOOR")), rawKey: pick("KEY_DOOR"), token: own || alarm, borrowed: !own && Boolean(alarm), owner: pick("OWNER_TG_ID"), alarmRoom: pick("ALARM_CHAT_ID"),
    ai: /^\d{3,20}$/u.test(pick("DOOR_AI_ID")) ? Number(pick("DOOR_AI_ID")) : 0, api: pick("DOOR_API") || "https://api.telegram.org", file, inFile: found.KEY_DOOR ?? "",
    // Под `phone.sh door` следующий шаг делает он сам: подсказки «что дальше» не нужны.
    led: pick("DOOR_FLOW") === "1",
    // Другой файл настроек вместо `tgcloud/lib/config.js` — для тестов: у их сердца хозяин свой.
    config: pick("DOOR_CONFIG"),
  };
}

/**
 * Кто хозяин — так же, как это решает сердце (`OWNER` в `tgcloud/lib/heart.js`): сначала `OWNER_TG_ID` из `config.js`,
 * и только если там пусто — строка OWNER_TG_ID из ключей. Дверь пускает только хозяина, поэтому спрашивать надо там
 * же, где спросит она; а в файле ключей телефона этой строки может не быть вовсе — `phone.sh check` говорит о ней
 * «годится, если владелец записан в config.js».
 */
async function ownerOf(conf) {
  try {
    const { CONFIG } = await import(conf.config ? pathToFileURL(conf.config).href : new URL("../tgcloud/lib/config.js", import.meta.url).href);
    const id = Number(CONFIG?.OWNER_TG_ID);
    if (Number.isSafeInteger(id) && id > 0) return id;
  } catch { /* настроек рядом нет — остаётся строка из ключей */ }
  return Number(conf.owner) || 0;
}

/**
 * Каналы, которые дверью быть не могут: по ним уже ходит другое — мост с сестрой (`ABILITIES_CHANNEL_ID` в настройках
 * сердца) и будильник (`ALARM_CHAT_ID` в ключах). Дверь забирает себе все посты своего канала: стань им «Мост» —
 * будильник и мост замолчали бы, а на экране всё выглядело бы исправным. Сердце такой ключ тоже не примет.
 */
async function busyOf(conf) {
  const found = [conf.alarmRoom];
  try {
    const { CONFIG } = await import(conf.config ? pathToFileURL(conf.config).href : new URL("../tgcloud/lib/config.js", import.meta.url).href);
    found.push(String(CONFIG?.ABILITIES_CHANNEL_ID ?? ""));
  } catch { /* настроек рядом нет — остаётся строка из ключей */ }
  return new Set(found.filter(id => /^-100\d{5,15}$/u.test(id)));
}

/** Вписать строку «ИМЯ=значение» в файл ключей: прежняя строка с этим именем заменяется, остальные целы. */
function keep(file, name, value, comment) {
  let before = "";
  try { before = readFileSync(file, "utf8"); } catch { before = ""; }
  const lines = before.split("\n"), at = lines.findIndex(line => new RegExp(`^\\s*${name}=`, "u").test(line));
  let after;
  if (at >= 0) { lines[at] = `${name}=${value}`; after = lines.join("\n"); }
  else after = `${before}${before && !before.endsWith("\n") ? "\n" : ""}${comment ? `# ${comment}\n` : ""}${name}=${value}\n`;
  writeFileSync(file, after, { mode: 0o600 });
}

/**
 * Запрос к Bot API. Заодно запоминает, сколько сейчас на часах Telegram (заголовок `Date` его ответа): время в запросе
 * двери сверяется с временем поста по этим часам, и часы телефона, спешащие на пять минут, не должны закрывать дверь.
 */
function telegram({ api, token }) {
  const clock = { skew: 0, known: false };
  const call = async (method, params = {}) => {
    let response;
    try {
      response = await fetch(`${api}/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params), signal: AbortSignal.timeout((Number(params.timeout) || 0) * 1000 + 25_000) });
    } catch (error) { throw Object.assign(Error(`нет связи с Telegram (${error?.cause?.code ?? error?.name ?? "сеть"})`), { code: 0 }); }
    // Заголовок — с точностью до секунды и уже без её дробной части: полсекунды — середина.
    const stamp = Date.parse(response.headers.get("date") ?? "");
    if (Number.isFinite(stamp)) { clock.skew = stamp + 500 - Date.now(); clock.known = true; }
    const body = await response.json().catch(() => null);
    if (!body?.ok) throw Object.assign(Error(`${method}: ${body?.description ?? `ответ ${response.status}`}`), { code: body?.error_code ?? response.status, why: String(body?.description ?? "") });
    return body.result;
  };
  call.now = () => Date.now() + (clock.known ? clock.skew : 0);
  call.skew = () => (clock.known ? clock.skew : 0);
  return call;
}

/** Обновления, которые боту двери нужны: посты каналов и «меня сделали администратором». Один список на все вызовы. */
const UPDATES = ["channel_post", "my_chat_member"];
/** Что делать, когда бота для двери нет. Под `phone.sh door` токен спросят тут же — «затем» говорить незачем. */
const newBot = (led) => `Двери нужен свой бот: в Telegram — @BotFather → /newbot (имя и адрес любые), он пришлёт токен.${led ? "" : " Затем: bash scripts/phone.sh door"}`;

/**
 * Годится ли бот для двери. Не годится: токен не принят; это сама Аи (своих постов бот не получает); у бота вебхук —
 * он живёт на сервере, и всё, что он слышит, Telegram отдаёт туда: с телефона его не спросить. Вебхук не трогается.
 */
async function fit(call, { ai = 0, borrowed = false, led = false } = {}) {
  let me, hook;
  try { me = await call("getMe"); }
  catch (error) { return { ok: false, code: 1, lines: [error.code === 401 || error.code === 404 ? "Telegram не принял токен бота двери: проверьте строку DOOR_BOT_TOKEN — токен целиком, как его прислал @BotFather." : `Telegram не ответил: ${error.message}`] }; }
  const name = `@${me.username ?? me.id}`;
  if (ai && me.id === ai) return { ok: false, code: 4, me, lines: [`${name} — это сама Аи: своих постов бот не получает, и себя она не услышит.`, newBot(led)] };
  try { hook = await call("getWebhookInfo"); }
  catch (error) { return { ok: false, code: 1, me, lines: [`Telegram не ответил: ${error.message}`] }; }
  if (hook?.url) {
    let host = "";
    try { host = new URL(hook.url).hostname; } catch { host = ""; }
    return { ok: false, code: 3, me, lines: [
      `${borrowed ? "Бот будильника" : "Бот"} ${name} живёт на сервере${host ? ` (${host})` : ""}: всё, что он слышит, Telegram отдаёт туда, и с телефона его не спросить.`,
      "Трогать его не надо — он занят своим делом.", newBot(led),
    ] };
  }
  return { ok: true, code: 0, me, name };
}

/** Почему `getUpdates` не дали: вебхук или второй слушатель с тем же токеном. */
const deaf = (error) => (error.code !== 409 ? `Telegram не ответил: ${error.message}`
  : /webhook/iu.test(error.why ?? "") ? "У этого бота включён вебхук — он живёт на сервере, с телефона его не спросить. Двери нужен свой бот."
  : "Этого бота сейчас опрашивает другая программа с тем же токеном — ответ сердца достанется ей. Остановите её или возьмите для двери своего бота.");

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const span = (seconds) => (seconds >= 120 ? `${Math.round(seconds / 60)} мин` : `${Math.round(seconds)} с`);

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

  const uid = Number(flag("uid")) || await ownerOf(conf);
  if (command === "seal") {
    if (!conf.key) { say(`Нет строки KEY_DOOR (смотрела в окружении и в ${conf.file}).`); return 1; }
    if (!Number.isSafeInteger(uid) || uid <= 0) { say("От чьего имени? Хозяин не записан ни в tgcloud/lib/config.js, ни строкой OWNER_TG_ID; можно и --uid=число."); return 1; }
    let input = {};
    try { input = words[2] ? JSON.parse(words[2]) : {}; } catch { say("Третье слово — JSON с полями действия, например '{\"id\":\"abc123\"}'."); return 1; }
    say(doorWire(await sealRequest({ secret: conf.key.secret, uid, do: words[1] ?? "look", input })));
    return 0;
  }

  // Бот двери: годится ли нынешний; с токеном — проверить нового и записать его в файл ключей.
  if (command === "bot") {
    const given = words[1] ?? "";
    if (given) {
      const token = /\d{5,15}:[A-Za-z0-9_-]{30,}/u.exec(given)?.[0];
      if (!token) { say("Это не похоже на токен бота: цифры, двоеточие, буквы — целиком, как его прислал @BotFather."); return 1; }
      const who = await fit(telegram({ api: conf.api, token }), { ai: conf.ai, led: conf.led });
      if (!who.ok) { who.lines.forEach(say); return who.code; }
      try { keep(conf.file, "DOOR_BOT_TOKEN", token, "Бот двери приложения (docs/DOOR.md): свой бот от @BotFather — не Аи и не тот, что живёт на сервере"); }
      catch (error) { say(`Не смогла записать токен в ${conf.file}: ${error.message}. Впишите сами строку DOOR_BOT_TOKEN=токен.`); return 1; }
      say(`✓ Бот двери: ${who.name} — токен записан в ${conf.file}.`);
      return 0;
    }
    if (!conf.token) { say(`Бота двери ещё нет: в ${conf.file} нет строки DOOR_BOT_TOKEN.`); say(newBot(conf.led)); return 6; }
    const who = await fit(telegram(conf), conf);
    if (!who.ok) { who.lines.forEach(say); return who.code; }
    say(`✓ Бот двери: ${who.name}${conf.borrowed ? " — он же бьёт будильник" : ""}.`);
    return 0;
  }

  if (!conf.token) { say(`Бота двери ещё нет: в ${conf.file} нет строки DOOR_BOT_TOKEN.`); say(newBot(conf.led)); return 6; }
  const call = telegram(conf);
  const who = await fit(call, conf);
  if (!who.ok) { who.lines.forEach(say); return who.code; }
  const me = who.me;
  const busy = await busyOf(conf), warned = new Set();
  const BUSY = (title) => `• Канал «${title}» для двери не годится: по нему ходят будильник и мост — дверь забрала бы их посты себе. Нужен отдельный закрытый канал; бота двери из «${title}» уберите.`;
  const TAKEN = (channel) => `Канал ${channel} занят: по нему ходят будильник и мост — дверь забрала бы их посты себе. Двери нужен отдельный закрытый канал.`;

  /**
   * Каналы, где бот двери — администратор, по его обновлениям: номер → имя. `null` — Telegram не дал спросить.
   * `until` — до какого времени ждать первого канала: человек в это время добавляет бота в канал.
   * Обновления читаются, но не подтверждаются: повторный запуск увидит то же.
   */
  const channels = async (until = 0) => {
    const seen = new Map();
    const note = (updates) => {
      for (const update of updates) {
        const post = update.channel_post, mine = update.my_chat_member;
        const chat = post?.chat?.type === "channel" ? post.chat : mine?.chat?.type === "channel" ? mine.chat : null;
        if (!chat) continue;
        const id = String(chat.id), title = chat.title ?? "без имени";
        // Убрали из канала — он больше не кандидат; сделали администратором или в нём пишут — кандидат.
        if (!post && mine.new_chat_member?.status !== "administrator") { seen.delete(id); continue; }
        // Занятый канал (мост, будильник) — не кандидат: сказать об этом один раз и ждать дальше.
        if (busy.has(id)) { if (!warned.has(id)) { warned.add(id); say(BUSY(title)); } continue; }
        seen.set(id, title);
      }
    };
    let next = 0;
    try {
      // Последние сто, а не первые: у бота, которого никто не спрашивает, за сутки копится очередь.
      const updates = await call("getUpdates", { offset: -100, limit: 100, timeout: 0, allowed_updates: UPDATES });
      note(updates);
      if (updates.length) next = updates.at(-1).update_id + 1;
      while (!seen.size && Date.now() < until) {
        const fresh = await call("getUpdates", { offset: next, limit: 100, timeout: Math.max(1, Math.min(20, Math.ceil((until - Date.now()) / 1000))), allowed_updates: UPDATES });
        note(fresh);
        // Подтверждается только то, в чём канала не оказалось: обновление с каналом останется для повторного запуска.
        if (fresh.length && !seen.size) next = fresh.at(-1).update_id + 1;
      }
    } catch (error) { say(deaf(error)); return null; }
    return seen;
  };
  const NOT_SEEN = `Бот двери ${who.name} пока не администратор ни в одном канале. Добавьте его в администраторы канала двери, напишите в канале любое слово и повторите.`;

  if (command === "where") {
    const seen = await channels();
    if (!seen) return 1;
    if (!seen.size) { say(NOT_SEEN); return 1; }
    for (const [id, title] of seen) say(`канал «${title}»: ${id}`);
    return 0;
  }

  if (command === "setup") {
    const wait = Math.max(0, Math.min(900, Number(flag("wait")) || 0)), deadline = Date.now() + wait * 1000;
    let channel = words[1] ?? "", title = "";
    if (conf.key && (!channel || channel === conf.key.channel)) channel = conf.key.channel;
    else if (conf.rawKey && conf.inFile) { say(`В ${conf.file} уже есть строка KEY_DOOR — с другим каналом или записанная не так. Уберите её сами: молча менять ключ не буду.`); return 1; }
    if (busy.has(channel)) { say(`${TAKEN(channel)}${conf.key ? ` На него указывает строка KEY_DOOR в ${conf.file}: уберите её и запустите ещё раз.` : ""}`); return 1; }
    if (!channel) {
      let seen = await channels();
      if (!seen) return 1;
      if (!seen.size && wait) {
        say(`Теперь в Telegram — жду ${span(wait)}, здесь ничего нажимать не нужно:`);
        say("  1. закрытый канал для двери — отдельный, не тот, где будильник: новый или уже заведённый для двери; никого в него не зовите;");
        say(`  2. канал → «Администраторы» → добавьте ${who.name} и Аи: обоим — публиковать и удалять сообщения;`);
        say("  3. напишите в канале любое слово.");
        seen = await channels(deadline);
        if (!seen) return 1;
      }
      if (!seen.size) { say(wait ? `Не дождалась: ${who.name} так и не стал администратором канала. Добавьте его и запустите ещё раз.` : NOT_SEEN); return 1; }
      const named = [...seen].filter(([, name]) => /двер|door/iu.test(name)), pool = named.length ? named : [...seen];
      if (pool.length !== 1) {
        say("Каналов несколько — назовите номер нужного: node scripts/door-client.mjs setup <номер>");
        for (const [id, name] of seen) say(`канал «${name}»: ${id}`);
        return 1;
      }
      [channel, title] = pool[0];
    }
    if (!/^-100\d{5,15}$/u.test(channel)) { say("Номер канала должен начинаться с -100 и состоять из цифр — его называет «where»."); return 1; }

    let chat;
    try { chat = await call("getChat", { chat_id: channel }); }
    catch (error) { say(`Канал ${channel} боту двери ${who.name} не виден (${error.why || error.message}). Сделайте его администратором этого канала.`); return 1; }
    title = chat.title ?? title;
    if (chat.type !== "channel") { say(`«${title}» — не канал. Дверь живёт в закрытом канале, не в группе: в группе боты друг друга не слышат.`); return 1; }
    if (chat.username) { say(`Канал «${title}» открытый (@${chat.username}): его посты читает кто угодно. Сделайте его закрытым и повторите.`); return 1; }

    // Кто в канале. Bot API отдаёт в списке администраторов чужих ботов только с `return_bots` (у прежних версий — людей
    // и самого спросившего), поэтому про Аи при пустом списке ботов спрашивается отдельно.
    const rightsOf = (item) => (item?.status === "creator" ? { post: true, erase: true } : item?.status === "administrator" ? { post: item.can_post_messages === true, erase: item.can_delete_messages === true } : null);
    const roster = async () => { try { return await call("getChatAdministrators", { chat_id: channel, return_bots: true }); } catch { return null; } };
    const heart = async (list) => {
      const bots = list.filter(item => item.user?.is_bot && item.user.id !== me.id);
      const listed = conf.ai ? bots.find(item => item.user.id === conf.ai) : null;
      if (listed) return { rights: rightsOf(listed), sure: true, bots, name: `@${listed.user.username ?? "Аи"}` };
      // Чужой бот в списке один, и номер Аи неизвестен или не сошёлся — это она: гадать о «лишнем» здесь нельзя.
      if (bots.length === 1) return { rights: rightsOf(bots[0]), sure: false, bots, name: `@${bots[0].user.username ?? "бот"}` };
      if (bots.length || !conf.ai) return { rights: undefined, sure: false, bots, name: "" };
      try { return { rights: rightsOf(await call("getChatMember", { chat_id: channel, user_id: conf.ai })) ?? false, sure: true, bots, name: "Аи", asked: true }; }
      catch { return { rights: undefined, sure: false, bots, name: "" }; }
    };
    let list = await roster();
    if (!list) { say(`Бот двери ${who.name} в канале «${title}» не администратор. Добавьте его в администраторы канала (право публиковать сообщения).`); return 1; }
    const mine = rightsOf(list.find(item => item.user?.id === me.id));
    if (mine && !mine.post) { say(`У бота двери ${who.name} нет права публиковать в канале «${title}»: канал → «Администраторы» → он → «Публикация сообщений».`); return 1; }
    let ai = await heart(list);
    // Её нет или ей нельзя писать — подождать, пока человек добавит: но не дольше трёх минут и не дольше общего срока.
    // (Бота двери он добавил только что — отсюда настройка и пошла дальше; Аи — следующим действием.)
    const lacking = () => ai.rights === false || (ai.rights && !ai.rights.post);
    if (lacking() && Date.now() < deadline) {
      say(ai.rights === false ? `• Аи в канале «${title}» не администратор. Добавьте её туда же (право публиковать и удалять сообщения) — жду…` : `• У Аи в канале «${title}» нет права публиковать сообщения — ответить она не сможет. Дайте его — жду…`);
      const until = Math.min(deadline, Date.now() + 180_000);
      while (lacking() && Date.now() < until) { await pause(Number(flag("step")) || 4000); list = await roster() ?? list; ai = await heart(list); }
    }
    if (ai.rights === false) say("• Не вижу Аи среди администраторов этого канала. Пробую всё равно: не будет ответа — дело в этом.");
    else if (ai.rights && !ai.rights.post) say("• У Аи в этом канале нет права публиковать сообщения: ответить она не сможет.");
    else if (ai.rights && !ai.rights.erase) say("• У Аи нет права удалять сообщения: прочитанные запросы будут копиться в канале. Работать будет, но право лучше дать.");
    else if (ai.rights === undefined && !ai.bots.length) say("• Есть ли Аи среди администраторов этого канала, отсюда не видно. Проверьте сами: без неё ответа не будет.");
    // Лишние читатели. По имени называется только тот, про кого известно точно: Аи опознана по номеру.
    const extra = ai.bots.filter(item => !(conf.ai && item.user.id === conf.ai));
    if (ai.sure && !ai.asked && extra.length) say(`• В канале ещё ${extra.length === 1 ? "бот" : "боты"} ${extra.map(item => `@${item.user.username ?? item.user.id}`).join(", ")}: ${extra.length === 1 ? "он" : "они"} тоже получа${extra.length === 1 ? "ет" : "ют"} все посты двери. Уберите ${extra.length === 1 ? "его" : "их"} из администраторов этого канала — только этого.`);
    else if (!ai.sure && ai.bots.length > 1) say(`• В канале, кроме бота двери, боты ${ai.bots.map(item => `@${item.user.username ?? item.user.id}`).join(", ")}. Нужна только Аи: остальные тоже получают все посты двери.`);
    try {
      const count = Number(await call("getChatMemberCount", { chat_id: channel })) || 0;
      const known = new Set(list.map(item => item.user?.id)); known.add(me.id);
      // Аи, которую не видно в списке, — тоже участник: один «лишний» при неизвестной Аи — это она.
      const unseen = ai.asked ? (ai.rights ? 1 : 0) : ai.bots.length ? 0 : 1;
      if (count > known.size + unseen) say(`• В канале участников: ${count}, а администраторов — ${known.size + unseen}. Остальные читают посты двери: уберите их из канала.`);
    } catch { /* число участников — не главное */ }

    // Может ли бот двери писать: слово в канал, без звука, и сразу убрать за собой.
    try {
      const probe = await call("sendMessage", { chat_id: channel, text: "Проверка: бот двери может писать в этот канал.", disable_notification: true });
      try { await call("deleteMessage", { chat_id: channel, message_id: probe.message_id }); } catch { /* останется одно слово в канале */ }
    } catch (error) { say(`Бот двери ${who.name} не смог написать в канал «${title}»: ${error.why || error.message}. Дайте ему право публиковать сообщения.`); return 1; }
    say(`✓ Канал «${title}»: бот двери ${who.name} пишет${ai.rights && ai.rights.post ? `, Аи${ai.name && ai.name !== "Аи" ? ` (${ai.name})` : ""} — администратор` : ""}.`);

    if (conf.key) {
      say(`✓ Ключ двери уже записан${conf.inFile ? ` в ${conf.file}` : ""} — оставляю его.`);
      if (!conf.led) say("Дальше: bash scripts/phone.sh door — опубликует сердце с этим ключом и проверит дверь.");
      return 0;
    }
    const line = `${channel}:${randomBytes(32).toString("base64url")}`;
    try { keep(conf.file, "KEY_DOOR", line, "Дверь отдельного приложения (docs/DOOR.md): номер канала двери, двоеточие, секрет"); }
    catch (error) { say(`Не смогла дописать ${conf.file}: ${error.message}. Впишите строку сами:`); say(`KEY_DOOR=${line}`); return 1; }
    say(`✓ Ключ двери придуман и записан в ${conf.file}. Посреднику приложения нужен он же — из этого файла, в чат его не шлите.`);
    if (!conf.led) say("Дальше: bash scripts/phone.sh door — опубликует сердце с ключом и проверит дверь.");
    return 0;
  }

  // Опыт: запрос через Telegram и ответ сердца.
  if (!conf.key) { say(conf.rawKey ? "Строка KEY_DOOR записана не так: нужен вид «номер канала:секрет», секрет от 32 знаков." : `Нет строки KEY_DOOR (смотрела в окружении и в ${conf.file}). Её пишет: bash scripts/phone.sh door`); return 1; }
  if (!Number.isSafeInteger(uid) || uid <= 0) { say("От чьего имени войти? Хозяин не записан ни в tgcloud/lib/config.js, ни строкой OWNER_TG_ID; можно и --uid=число."); return 1; }
  if (busy.has(conf.key.channel)) { say(`${TAKEN(conf.key.channel)} На него указывает строка KEY_DOOR в ${conf.file}: уберите её и запустите: bash scripts/phone.sh door`); return 1; }
  let input = {};
  try { input = words[1] ? JSON.parse(words[1]) : {}; } catch { say("Второе слово — JSON с полями действия, например '{\"id\":\"abc123\"}'."); return 1; }
  const wait = Math.max(3, Math.min(120, Number(flag("wait")) || 25)), channel = conf.key.channel;
  let offset = 0;
  try {
    const tail = await call("getUpdates", { offset: -1, timeout: 0, allowed_updates: UPDATES });
    if (tail.length) offset = tail.at(-1).update_id + 1;
  } catch (error) { say(deaf(error)); return 1; }
  // Время запроса — по часам Telegram: по ним же сердце сверит его с временем поста.
  const skew = Math.round(call.skew() / 1000);
  if (Math.abs(skew) >= 30) say(`Часы телефона ${skew > 0 ? "отстают" : "спешат"} на ${span(Math.abs(skew))} — время запроса беру по часам Telegram.`);
  const request = await sealRequest({ secret: conf.key.secret, uid, do: command, input, ts: call.now() });
  const started = Date.now();
  let sent;
  try { sent = await call("sendMessage", { chat_id: channel, text: doorWire(request), disable_web_page_preview: true, disable_notification: true }); }
  catch (error) { say(`Запрос не ушёл в канал двери: ${error.why || error.message}. Бот двери должен быть администратором канала с правом публиковать.`); return 1; }
  const texts = [], answers = [];
  const tidy = async (ids) => { if (!flags.includes("--keep")) for (const id of ids) { try { await call("deleteMessage", { chat_id: channel, message_id: id }); } catch { /* нет права удалять — останется в канале */ } } };
  const WHY = {
    bad_signature: "ключ у сердца не тот, что в файле ключей: сердце опубликовано с другим ключом двери или без него",
    stale: "время запроса разошлось с временем поста больше чем на две минуты",
    bad_envelope: "сердце не разобрало запрос — версии договора у сторон разные",
    door_closed: "дверь пускает только хозяина, а запрос — от другого номера",
    slow: "слишком часто — не больше десяти запросов в минуту",
    forbidden: "этого действия через дверь не делают",
    bad_input: "сердце не разобрало поля действия",
    too_big: "ответ не поместился в дверь",
  };
  while (Date.now() - started < wait * 1000) {
    let updates = [];
    try { updates = await call("getUpdates", { offset, timeout: Number(flag("poll")) || 5, allowed_updates: UPDATES }); }
    catch (error) { say(deaf(error)); return 1; }
    for (const update of updates) {
      offset = update.update_id + 1;
      const post = update.channel_post;
      if (!post || String(post.chat?.id) !== channel || typeof post.text !== "string") continue;
      texts.push(post.text);
      if (doorRead(post.text)?.re === request.id && post.message_id != null) answers.push(post.message_id);
    }
    const opened = await openAnswer({ secret: conf.key.secret, id: request.id, texts });
    const took = ((Date.now() - started) / 1000).toFixed(1);
    if (opened.ok) {
      // Прочитанный ответ убирается из канала: канал — провод, а не журнал (docs/DOOR.md, раздел 8).
      await tidy(answers);
      const result = opened.result, size = JSON.stringify(result).length;
      if (flags.includes("--flat") || flags.includes("--full")) {
        say(`Сердце ответило за ${took} с, постов: ${opened.parts}.`);
        say(JSON.stringify(result, null, flags.includes("--flat") ? 0 : 2));
      } else if (result?.ok === false) {
        say(`✗ Дверь на месте, но не пустила: ${WHY[result.code] ?? result.text ?? result.code}.`);
        say(`  Сердце ответило за ${took} с; его слова: «${String(result.text ?? result.code)}».`);
      } else {
        say(`✓ Дверь работает: сердце ответило за ${took} с (постов: ${opened.parts}, знаков: ${size}).`);
        if (command === "look") say(`  Комната: сборка ${result?.build ?? "?"} · хозяин: ${result?.owner === true ? "да" : "нет"}${result?.greet ? ` · её слова: «${String(result.greet)}»` : ""}`);
        else say(`  Ответ: ${JSON.stringify(result).slice(0, 300)}${size > 300 ? "…" : ""}`);
        say("  Скажите Аи «статус» — там строка «Дверь приложения: открыта только вам».");
      }
      return result?.ok === false ? 2 : 0;
    }
    if (opened.code !== "waiting") {
      await tidy(answers);
      if (opened.trusted) { say(`✗ Дверь не пустила: ${WHY[opened.code] ?? opened.code} (${opened.code}, сердце ${opened.build ?? "?"}).`); return 2; }
      say(`✗ Дверь не пустила: ${opened.code}; подпись пометки не сошлась — ключи у сердца и здесь разные.`);
      if (!conf.led) say("  Опубликуйте сердце заново — оно возьмёт ключ из файла: bash scripts/phone.sh door");
      return 7;
    }
  }
  // Ответа нет. Улика: запрос, который сердце прочло, оно само убирает из канала. Лежит на месте — не прочло.
  let lying = null;
  try { await call("deleteMessage", { chat_id: channel, message_id: sent.message_id }); lying = true; }
  catch (error) { if (/not found/iu.test(error.why ?? "")) lying = false; }
  say(`✗ За ${wait} с ответа нет.${lying === true ? " Запрос так и лежал в канале (убрала его): Аи его не прочла — или дверь у неё закрыта." : lying === false ? " Запроса в канале уже нет — значит, Аи его прочла и убрала, но её ответ до бота двери не дошёл." : ""}`);
  if (!flags.includes("--try")) {
    if (conf.led || lying === false) say("  Скажите Аи «статус» и пришлите в чат разработки этот экран и её строку «Дверь приложения» (или что такой строки нет): по ним видно, где потерялся запрос.");
    else {
      say("  Скажите Аи «статус». Строки «Дверь приложения» нет — сердце опубликовано без ключа: bash scripts/phone.sh door");
      say("  Строка есть, а «за сутки запросов: 0» — Аи не администратор канала двери или пост до неё не дошёл.");
    }
  }
  return 5;
}

// Запущен как команда, а не взят модулем; путь сверяется настоящий — папка на телефоне бывает ссылкой.
const direct = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (direct) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, (error) => { say(`Не вышло: ${error?.message ?? error}`); process.exitCode = 1; });
}
