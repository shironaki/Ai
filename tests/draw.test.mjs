/**
 * Рисование: «нарисуй …» через Cloudflare Workers AI. Ключ, перевод запроса,
 * отказ от недопустимого, предел на человека, отдых при лимите, честные слова
 * при сбоях; тот же ключ — запасной мозг.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, copyFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { heart, message, group, reset, last, calls, chats, says, refuses, sdk, source, sourced, toOwner, OWNER, KEY } from "./fixtures/kit.mjs";

const { splitKey, fromBase64, refusal, subjectOf, createDraw } = await import("../tgcloud/lib/draw.js");
const { CONFIG } = await import("../tgcloud/lib/config.js");

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const CF = `${ACCOUNT}:cf-token_ABCDEFGH-1234567890xyz`;
const ON = { DRAW_KEY: CF };
const NOON = Date.parse("2026-11-18T09:00:00Z");
// «Картинка»: достаточно байт, чтобы её не приняли за пустой ответ.
const PIXELS = Buffer.from(Array.from({ length: 600 }, (_, index) => index % 251));
const image = () => ({ success: true, result: { image: PIXELS.toString("base64") } });
const translated = (text) => ({ success: true, result: { translated_text: text } });
const cfError = (status, code, text) => ({ ok: false, status, text: async () => JSON.stringify({ success: false, errors: [{ code, message: text }] }) });
/** Тела запросов к мастерской, по порядку. */
const asked = (model) => sdk().sourceFetches.filter(item => item.url.includes(model)).map(item => JSON.parse(item.options.body));
const photos = () => calls("sendPhoto");

test("ключ и разбор: «ID:токен», base64 своими силами, что просят и чего нельзя", () => {
  assert.deepEqual(splitKey(CF), { account: ACCOUNT, token: "cf-token_ABCDEFGH-1234567890xyz" });
  for (const bad of ["", "только-токен-без-аккаунта-1234567890", "abc:короткий", `${ACCOUNT}:`, `${ACCOUNT}:ключ с пробелом и буквами`]) assert.equal(splitKey(bad), null, bad);
  assert.deepEqual([...fromBase64(Buffer.from([0, 1, 2, 250, 255]).toString("base64"))], [0, 1, 2, 250, 255]);
  assert.deepEqual([...fromBase64(`data:image/jpeg;base64,${PIXELS.toString("base64")}`)], [...PIXELS]);

  assert.equal(subjectOf("себя").own, "self");
  assert.equal(subjectOf("свою комнату").own, "room");
  assert.equal(subjectOf("Байта").own, "cat");
  assert.deepEqual(subjectOf("меня"), { me: true });
  assert.deepEqual(subjectOf("ещё"), { again: true });
  assert.deepEqual(subjectOf("кота в шляпе"), { text: "кота в шляпе" });

  for (const [said, why] of Object.entries({
    "голую девушку": "adult", "девушку без одежды": "adult", "хентай": "adult", "sexy girl": "adult", "лоли в купальнике": "minor",
    "расчленённое тело": "gore", "флаг со свастикой": "hate",
  })) assert.equal(refusal(said), why, said);
  // Слова, похожие на запретные, запретом не считаются.
  for (const said of ["кота в шляпе", "голые деревья зимой", "кота, который соскучился", "греблю на озере", "члена экипажа у штурвала", "Sussex landscape"]) assert.equal(refusal(said), "", said);
});

test("без ключа — прежнее честное «не умею»; с ключом — перевод, рисунок файлом, подпись её словами", async () => {
  reset();
  const plain = heart();
  await plain.onMessage(message("нарисуй кота в шляпе"), KEY);
  assert.match(last(), /Рисовать я не умею.*«найди картинку кота в шляпе»/su);
  assert.equal(sourced().length, 0, "без ключа в мастерскую не стучится");

  reset();
  source("m2m100", translated("a cat in a hat"));
  source("flux-1-schnell", image());
  const h = heart(ON, { now: () => NOON });
  const result = await h.onMessage(message("Аи, нарисуй кота в шляпе"), KEY);
  assert.equal(result.kind, "draw");
  assert.deepEqual(asked("m2m100")[0], { text: "кота в шляпе", source_lang: "ru", target_lang: "en" });
  const painted = asked("flux-1-schnell")[0];
  assert.equal(painted.prompt, "a cat in a hat", "модели уходит английское описание");
  assert.equal(painted.steps, 4);
  const request = sdk().sourceFetches.find(item => item.url.includes("flux-1-schnell"));
  assert.equal(request.url, `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/black-forest-labs/flux-1-schnell`);
  assert.equal(request.options.headers.Authorization, "Bearer cf-token_ABCDEFGH-1234567890xyz");
  assert.equal(photos().length, 1);
  assert.deepEqual([...photos()[0].photo.bytes], [...PIXELS], "картинка ушла байтами, а не ссылкой");
  assert.equal(photos()[0].photo.type, "image/jpeg");
  assert.ok(photos()[0].caption.length > 2, "подпись — её словами");
  assert.doesNotMatch(photos()[0].caption, /cloudflare|flux|http/iu, "источник в подписи не называется");
  assert.equal(chats().length, 0, "модель на рисунок не тратится");

  // «Откуда это?» — это её работа. В справке и статусе рисование видно.
  await h.onMessage(message("откуда это?"), KEY);
  assert.match(last(), /Это я нарисовала сама — по словам «кота в шляпе»/u);
  await h.onMessage(message("что ты умеешь"), KEY);
  assert.match(last(), /рисование — «нарисуй кота в шляпе»/u);
  await h.onMessage(message("статус", { id: OWNER }), KEY);
  assert.match(last(OWNER), /Рисование: краски есть · сегодня нарисовано: 1 · на человека в день — 5/u);
  assert.match(last(OWNER), /нарисовала: 1/u);
});

test("она сама, её комната, «ещё» и «нарисуй меня»: канон без перевода, повтор прошлого запроса", async () => {
  reset();
  source("flux-1-schnell", image());
  source("m2m100", translated("a red fox in the snow"));
  const h = heart(ON, { now: () => NOON });
  await h.onMessage(message("нарисуй себя"), KEY);
  assert.match(asked("flux-1-schnell")[0].prompt, /dark hair with one blue streak.*headphones/u);
  assert.equal(asked("m2m100").length, 0, "канон уже по-английски — переводить нечего");
  await h.onMessage(message("нарисуй свою комнату"), KEY);
  assert.match(asked("flux-1-schnell")[1].prompt, /window with rain.*grey cat/u);
  await h.onMessage(message("нарисуй меня"), KEY);
  assert.match(last(), /Я не знаю, как вы выглядите.*Опишите словами/su);
  assert.equal(photos().length, 2);

  await h.onMessage(message("нарисуй лису на снегу"), KEY);
  await h.onMessage(message("нарисуй ещё"), KEY);
  assert.equal(asked("flux-1-schnell").at(-1).prompt, "a red fox in the snow", "«ещё» — тот же запрос заново");
  assert.equal(photos().length, 4);

  reset();
  const fresh = heart(ON, { now: () => NOON });
  await fresh.onMessage(message("нарисуй ещё"), KEY);
  assert.match(last(), /пока ничего здесь не рисовала/u);
});

test("чего она не рисует: отказ до запроса, и отказ самой мастерской", async () => {
  reset();
  source("flux-1-schnell", image());
  const h = heart(ON, { now: () => NOON });
  await h.onMessage(message("нарисуй голую девушку"), KEY);
  assert.match(last(), /Откровенное я не рисую/u);
  await h.onMessage(message("нарисуй лоли"), KEY);
  assert.match(last(), /Такое я рисовать не буду/u);
  await h.onMessage(message("нарисуй голую девушку", { id: OWNER }), KEY);
  assert.match(last(OWNER), /Откровенное я не рисую/u, "хозяину — тоже нет");
  assert.equal(sourced().length, 0, "в мастерскую такие просьбы не уходят");
  assert.equal(photos().length, 0);

  reset();
  source("m2m100", translated("something"));
  source("flux-1-schnell", cfError(400, 3030, "Input prompt contains NSFW content."));
  const strict = heart(ON, { now: () => NOON });
  await strict.onMessage(message("нарисуй странную сцену"), KEY);
  assert.match(last(), /Такое я рисовать не буду/u);
});

test("предел на человека: пять в день; хозяину — сколько угодно; на завтра — снова можно", async () => {
  reset();
  source("flux-1-schnell", image());
  source("m2m100", translated("a tree"));
  let at = NOON;
  const h = heart(ON, { now: () => at });
  for (let index = 0; index < 5; index += 1) await h.onMessage(message("нарисуй дерево"), KEY);
  assert.equal(photos().length, 5);
  await h.onMessage(message("нарисуй дерево"), KEY);
  assert.match(last(), /уже нарисовала 5 картинок — краски не бесконечные/u);
  assert.equal(photos().length, 5);
  // Другому человеку и хозяину норма первого не мешает.
  await h.onMessage(message("нарисуй дерево", { id: 6 }), KEY);
  for (let index = 0; index < 7; index += 1) await h.onMessage(message("нарисуй дерево", { id: OWNER }), KEY);
  assert.equal(photos().length, 13);
  at += 24 * 3_600_000;
  await h.onMessage(message("нарисуй дерево"), KEY);
  assert.equal(photos().length, 14);

  reset();
  source("flux-1-schnell", image());
  source("m2m100", translated("a tree"));
  const free = heart({ ...ON, DRAW_DAILY_PER_PERSON: 0 }, { now: () => NOON });
  for (let index = 0; index < 8; index += 1) await free.onMessage(message("нарисуй дерево"), KEY);
  assert.equal(photos().length, 8, "0 — без предела");
});

test("лимит мастерской: отдых до полуночи по UTC, без новых запросов; ключ не принят — весть хозяину", async () => {
  reset();
  source("m2m100", translated("a tree"));
  source("flux-1-schnell", cfError(429, 4006, "you have used up your daily free allocation of 10,000 neurons"));
  let at = NOON;
  const h = heart(ON, { now: () => at });
  await h.onMessage(message("нарисуй дерево"), KEY);
  assert.match(last(), /Краски на сегодня кончились.*Вернутся в 03:00/su, "полночь UTC — три часа ночи по Москве");
  const before = sourced().length;
  await h.onMessage(message("нарисуй дерево"), KEY);
  assert.match(last(), /Краски на сегодня кончились/u);
  assert.equal(sourced().length, before, "пока отдыхает — в мастерскую не стучится");
  await h.onMessage(message("статус", { id: OWNER }), KEY);
  assert.match(last(OWNER), /Рисование: краски кончились до 03:00/u);
  // После полуночи — снова рисует.
  sdk().sourceReplies.length = 0;
  source("m2m100", translated("a tree"));
  source("flux-1-schnell", image());
  at += 16 * 3_600_000;
  await h.onMessage(message("нарисуй дерево"), KEY);
  assert.equal(photos().length, 1);

  reset();
  source("m2m100", cfError(401, 10000, "Authentication error"));
  source("flux-1-schnell", cfError(401, 10000, "Authentication error"));
  const locked = heart({ ...ON, SELF_REPORTS: true }, { now: () => NOON });
  await locked.onMessage(message("нарисуй дерево"), KEY);
  assert.match(last(), /Мои краски не открываются: ключ к ним не принят/u);
  assert.ok(toOwner().some(item => /KEY_CLOUDFLARE.*ID аккаунта:токен/su.test(item.text)), "хозяин узнаёт, что именно проверить");
  assert.equal(asked("m2m100").length, 1, "после отказа по ключу перевод не повторяется другим способом");
});

test("сбои: мастерская молчит, перевод не вышел, Telegram не принял файл — слова честные", async () => {
  reset();
  source("m2m100", translated("a tree"));
  source("flux-1-schnell", new Error("network down"));
  const h = heart(ON, { now: () => NOON });
  await h.onMessage(message("нарисуй дерево"), KEY);
  assert.match(last(), /мастерская сейчас не отвечает/u);

  // Перевод не ответил — рисует по русским словам; коды языков не подошли — пробует названия.
  reset();
  let translations = 0;
  source("m2m100", () => { translations += 1; return translations === 1 ? cfError(400, 5006, "bad language") : translated("an oak"); });
  source("flux-1-schnell", image());
  const second = heart(ON, { now: () => NOON });
  await second.onMessage(message("нарисуй дуб"), KEY);
  assert.deepEqual(asked("m2m100").map(body => body.source_lang), ["ru", "russian"]);
  assert.equal(asked("flux-1-schnell")[0].prompt, "an oak");

  reset();
  source("m2m100", new Error("no translator"));
  source("flux-1-schnell", image());
  const third = heart(ON, { now: () => NOON });
  await third.onMessage(message("нарисуй дуб"), KEY);
  assert.equal(asked("flux-1-schnell")[0].prompt, "дуб", "без перевода — как сказано");
  assert.equal(photos().length, 1);

  reset();
  source("m2m100", translated("a tree"));
  source("flux-1-schnell", image());
  sdk().failing.sendPhoto = new Error("PHOTO_INVALID");
  const fourth = heart(ON, { now: () => NOON });
  await fourth.onMessage(message("нарисуй дерево"), KEY);
  assert.match(last(), /Рисунок готов, но Telegram его не принял/u);
  // Несостоявшийся рисунок в счёт не идёт.
  delete sdk().failing.sendPhoto;
  for (let index = 0; index < 5; index += 1) await fourth.onMessage(message("нарисуй дерево"), KEY);
  assert.equal(photos().length, 6, "пять удачных после одной неудачной попытки");

  // Выключено настройкой — как без ключа.
  reset();
  const off = heart({ ...ON, DRAW: false });
  await off.onMessage(message("нарисуй дерево"), KEY);
  assert.match(last(), /Рисовать я не умею/u);
  await off.onMessage(message("статус", { id: OWNER }), KEY);
  assert.match(last(OWNER), /Рисование: выключено настройкой/u);
});

test("в группе: рисует по обращению, в ту же тему; отдельной модели не тратит", async () => {
  reset();
  source("m2m100", translated("a tree"));
  source("flux-1-schnell", image());
  const h = heart(ON, { now: () => NOON });
  await h.onMessage(group("нарисуй дерево"), KEY);
  assert.equal(photos().length, 0, "без обращения — мимо");
  await h.onMessage(group("Аи, нарисуй дерево", { extra: { message_thread_id: 77, is_topic_message: true } }), KEY);
  assert.equal(photos().length, 1);
  assert.equal(photos()[0].chat_id, -10);
  assert.equal(photos()[0].message_thread_id, 77);
  assert.ok(calls("sendChatAction").some(item => item.action === "upload_photo"));
});

test("тот же ключ — запасной мозг: адрес с ID аккаунта, токен без ID; дневная норма — отдых до полуночи UTC", async () => {
  const entry = CONFIG.AI_PROVIDERS.find(item => item.id === "cloudflare");
  assert.ok(entry, "провайдер записан в настройках и спит без ключа");
  assert.equal(entry.kind, "cloudflare");
  assert.match(entry.baseUrl, /\{account\}\/ai\/v1$/u);
  assert.ok(entry.models.every(name => name.startsWith("@cf/") && !/gpt-oss/u.test(name)), "gpt-oss у Cloudflare отвечает только через Responses API — в цепочку не берётся");

  reset();
  const providers = [{ id: "cloudflare", name: "Cloudflare Workers AI", kind: "cloudflare", baseUrl: "https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1", models: ["@cf/google/gemma-4-26b-a4b-it"], key: CF }];
  let at = NOON;
  const h = heart({ AI_MODELS: [], AI_PROVIDERS: providers }, { now: () => at });
  // Основная модель упёрлась в лимит — отвечает Cloudflare.
  sdk().fetchQueue.push(refuses(429, { code: "rate_limit_exceeded", headers: { "retry-after": "3600" } }), says("Отвечаю запасным мозгом."));
  await h.onMessage(message("объясни, почему небо синее, в двух словах"), KEY);
  assert.equal(last(), "Отвечаю запасным мозгом.");
  const spare = chats().at(-1);
  assert.equal(spare.url, `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/v1/chat/completions`);
  assert.equal(spare.options.headers.Authorization, "Bearer cf-token_ABCDEFGH-1234567890xyz", "в заголовке — только токен");
  assert.equal(JSON.parse(spare.options.body).model, "@cf/google/gemma-4-26b-a4b-it");

  // Норма Cloudflare вышла: отдыхает до полуночи UTC, а не минуту.
  sdk().fetchQueue.push({ ok: false, status: 429, headers: { get: () => null }, text: async () => JSON.stringify({ success: false, errors: [{ code: 4006, message: "daily free allocation" }] }) });
  await h.onMessage(message("а трава почему зелёная, тоже коротко"), KEY);
  await h.onMessage(message("статус", { id: OWNER }), KEY);
  assert.match(last(OWNER), /gemma-4-26b-a4b-it[^\n]*03:00/u, `запасной отдыхает до трёх ночи по Москве:\n${last(OWNER)}`);

  // Кривой ключ: провайдер спит, сердце работает как раньше.
  reset();
  const broken = heart({ AI_MODELS: [], AI_PROVIDERS: providers.map(item => ({ ...item, key: "не-ключ" })) }, { now: () => NOON });
  sdk().fetchQueue.push(says("Обычный ответ."));
  await broken.onMessage(message("объясни, почему небо синее, в двух словах"), KEY);
  assert.equal(last(), "Обычный ответ.");
  assert.equal(chats().length, 1);
});

test("публикация: KEY_CLOUDFLARE проверяется на вид «ID:токен» и не печатается", () => {
  const dir = mkdtempSync(join(tmpdir(), "heart-draw-"));
  const file = join(dir, "secrets.js");
  copyFileSync(new URL("../tgcloud/lib/secrets.js", import.meta.url), file);
  const script = new URL("../scripts/inject-secrets.mjs", import.meta.url).pathname;
  const run = (env) => execFileSync(process.execPath, [script, `--file=${file}`], { env: { PATH: process.env.PATH, AI_PROVIDER_KEY: "gsk_model_key", ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const good = run({ KEY_CLOUDFLARE: CF });
  assert.doesNotMatch(good, new RegExp(ACCOUNT, "u"), "значение не попадает в журнал");
  assert.match(readFileSync(file, "utf8"), new RegExp(`"cloudflare":"${ACCOUNT}:cf-token_ABCDEFGH-1234567890xyz"`, "u"));
  copyFileSync(new URL("../tgcloud/lib/secrets.js", import.meta.url), file);
  run({ KEY_CLOUDFLARE: "только-токен-без-аккаунта-1234567890" });
  assert.doesNotMatch(readFileSync(file, "utf8"), /cloudflare/u, "ключ не того вида в сборку не попадает");
  rmSync(dir, { recursive: true, force: true });
});
