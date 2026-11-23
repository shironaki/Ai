/**
 * Дверь приложения (0.54.0, `docs/DOOR.md`): второй вход в ту же комнату — подписанным постом в закрытый канал.
 * Сторона сердца — `tgcloud/lib/bridge.js` (`createDoor`), сторона посредника — `scripts/door-client.mjs`.
 * Здесь они проверяются друг о друга, а числа из договора — о `node:crypto`, чтобы документ не разошёлся с кодом.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { heart, sdk, reset, KEY, OWNER, toChat, toOwner, calls } from "./fixtures/kit.mjs";
import { api as sdkApi, db as sdkDb } from "./fixtures/sdk-stub.mjs";
import { telegramStub as telegramFixture, AI_ID, AI_NAME, DOOR_BOT, VOICE_BOT, NEW_BOT, idOf } from "./fixtures/telegram.mjs";

const { doorKey, doorPayload, doorWire, doorRead, doorParts, hmac, DOOR_ALLOW, DOOR_NOT_ALLOWED, DOOR_POST_MAX, DOOR_PER_MINUTE, DOOR_PER_PERSON, DOOR_NOTES, DOOR_PREFIX, DOOR_STATE_KEY, DOOR_WAYS, DOOR_SLOT_TEXT, DOOR_SAYS } = await import("../tgcloud/lib/bridge.js");
const { sealRequest, openAnswer } = await import("../scripts/door-client.mjs");
const { BUILD: BUILD_NOW } = await import("../tgcloud/lib/heart.js");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const SECRET = "door-test-secret-0123456789abcdefghij";
const DOOR = "-100900900";
const LINE = `${DOOR}:${SECRET}`;
const T = Date.UTC(2026, 10, 22, 9, 0, 0);
const GUEST = 5;
let clock = T, mid = 1000;

beforeEach(() => { reset(); clock = T; mid = 1000; });

const make = (overrides = {}) => heart({ PHRASES: true, ROOM_APP: true, DOOR_KEY: LINE, ...overrides }, { now: () => clock });
const post = (text, { chat = DOOR, date = clock, extra = {} } = {}) => ({ message_id: (mid += 1), date: Math.floor(date / 1000), chat: { id: Number(chat), type: "channel", title: "Дверь" }, text, ...extra });
const knock = async (h, fields = {}, options = {}) => {
  const request = await sealRequest({ secret: SECRET, uid: OWNER, ts: clock, ...fields });
  const sent = post(doorWire(request), options);
  return { request, sent, out: await h.onMessage(sent, KEY) };
};
const posts = (chat = DOOR) => toChat(chat).map(item => item.text);
const opened = (request, secret = SECRET) => openAnswer({ secret, id: request.id, texts: posts() });
const room = (h, input, id = OWNER) => h.onRoom(input, { initData: { user: { id } } });

test("ключ двери — «номер канала:секрет»: секрет короче 32 знаков, чужой номер и пробелы не годятся", () => {
  assert.deepEqual(doorKey(LINE), { channel: DOOR, secret: SECRET });
  assert.deepEqual(doorKey(`  -1001234567890:${"a:b".repeat(11)}  `), { channel: "-1001234567890", secret: "a:b".repeat(11) }, "двоеточие в секрете — часть секрета");
  for (const bad of ["", SECRET, `${DOOR}:short`, `123:${SECRET}`, `${DOOR}:${"я".repeat(40)}`, `${DOOR}: ${SECRET}`, null, undefined]) assert.equal(doorKey(bad), null, String(bad));
});

test("строка под подпись — поля через перевод строки; подпись сходится с node:crypto; пост читается обратно", async () => {
  const request = await sealRequest({ secret: SECRET, uid: 123456789, do: "feed", input: { id: "abc123" }, id: "q7Hk2mZx9LpA", ts: 1795338000123 });
  assert.equal(doorPayload(request), 'AI-DOOR1\nq\nq7Hk2mZx9LpA\n1795338000123\n123456789\nfeed\n{"id":"abc123"}');
  assert.equal(request.sig, createHmac("sha256", SECRET).update(doorPayload(request)).digest("hex"));
  assert.match(request.sig, /^[0-9a-f]{64}$/u);
  const wire = doorWire(request);
  assert.ok(wire.startsWith(DOOR_PREFIX));
  assert.deepEqual(doorRead(wire), request);
  assert.deepEqual(doorRead(`\n  ${wire}  \n`), request, "пробелы по краям Telegram срезает сам");
  assert.equal(doorRead("просто слово"), null);
  assert.equal(doorRead("AI-DOOR1 {не json"), false);
  assert.equal(doorRead("AI-DOOR1 [1,2]"), false);
  const answer = { v: 1, t: "a", re: "q7Hk2mZx9LpA", n: 1, of: 2, ts: 1795338001456, body: '{"ok":true,"line":"Байт сыт 🤍' };
  assert.equal(doorPayload(answer), 'AI-DOOR1\na\nq7Hk2mZx9LpA\n1\n2\n1795338001456\n{"ok":true,"line":"Байт сыт 🤍');
  assert.equal(doorPayload({ v: 1, t: "e", re: "", code: "bad_signature", ts: 5, build: "0.54.0" }), "AI-DOOR1\ne\n\nbad_signature\n5\n0.54.0");
});

test("в посте — только простые знаки: эмодзи и значки идут записью \\uXXXX, а читаются теми же", () => {
  const body = "Чай — «зелёный» № 2… °C ☕ 🤍 a\u00a0b \u200d \u2028 \"кавычки\" \\ черта";
  const wire = doorWire({ v: 1, t: "a", re: "abcdefgh", n: 1, of: 1, ts: 1, body, sig: "0".repeat(64) });
  assert.match(wire, /^[\x20-\x7e\u0400-\u04ff«»—–…№]+$/u, "ни одного знака вне простых");
  assert.ok(wire.includes("\\ud83e\\udd0d") && wire.includes("\\u00a0") && wire.includes("\\u2028") && wire.includes("\\u00b0"), "эмодзи — парой, пробел неразрывный, градус");
  assert.ok(wire.includes("Чай — «зелёный» № 2…"), "кириллица и привычная пунктуация — как есть");
  assert.equal(doorRead(wire).body, body);
});

test("длинный ответ режется на части по тому, сколько займёт в посте; пара суррогатов не рвётся", () => {
  const one = doorParts("коротко");
  assert.deepEqual(one, ["коротко"]);
  const text = JSON.stringify({ lines: Array.from({ length: 400 }, (_, index) => `строка ${index} — «с кавычками» "и такими" 🤍`) });
  const parts = doorParts(text);
  assert.ok(parts.length > 3);
  assert.equal(parts.join(""), text);
  for (const [index, part] of parts.entries()) {
    const wire = doorWire({ v: 1, t: "a", re: "q7Hk2mZx9LpA_q7Hk2mZx9LpA_q7Hk2mZx9LpA_q", n: index + 1, of: parts.length, ts: 1795338001456, body: part, sig: "f".repeat(64) });
    assert.ok(wire.length <= DOOR_POST_MAX, `часть ${index + 1}: ${wire.length} знаков`);
    assert.ok(!/[\ud800-\udbff]$/u.test(part) && !/^[\udc00-\udfff]/u.test(part), "половинок эмодзи на краях нет");
  }
  assert.equal(doorParts("🤍".repeat(700)).join(""), "🤍".repeat(700));
  assert.ok(doorParts("🤍".repeat(700)).every(part => part.length % 2 === 0));
});

test("числа в договоре — те, что считает код: пример из docs/DOOR.md сверяется с node:crypto", () => {
  const doc = read("docs/DOOR.md");
  const block = doc.match(/<!-- пример:начало -->\s*```json\n([\s\S]*?)\n```\s*<!-- пример:конец -->/u)?.[1];
  assert.ok(block, "в docs/DOOR.md есть пример между пометками «пример:начало» и «пример:конец»");
  const sample = JSON.parse(block);
  assert.ok(doorKey(`${sample.channel}:${sample.secret}`), "ключ примера годится как KEY_DOOR");
  const sign = (payload) => createHmac("sha256", sample.secret).update(payload).digest("hex");
  assert.equal(sample.request_payload, doorPayload(sample.request));
  assert.equal(sample.request.sig, sign(sample.request_payload));
  assert.equal(sample.request_post, doorWire(sample.request));
  assert.deepEqual(doorRead(sample.request_post), sample.request);
  assert.ok(sample.answer_posts.length >= 2, "в примере ответ из нескольких частей");
  const bodies = [];
  for (const [index, text] of sample.answer_posts.entries()) {
    const part = doorRead(text);
    assert.equal(part.t, "a"); assert.equal(part.re, sample.request.id); assert.equal(part.n, index + 1); assert.equal(part.of, sample.answer_posts.length);
    assert.equal(part.sig, sign(doorPayload(part)), `подпись части ${index + 1}`);
    assert.equal(text, doorWire(part));
    bodies.push(part.body);
  }
  assert.equal(sample.answer_payload_1, doorPayload(doorRead(sample.answer_posts[0])));
  assert.deepEqual(JSON.parse(bodies.join("")), sample.answer_result);
  const note = doorRead(sample.note_post);
  assert.equal(note.t, "e"); assert.equal(note.sig, sign(doorPayload(note))); assert.equal(sample.note_payload, doorPayload(note));
});

test("запрос из канала двери: сердце отвечает тем же, что onRoom, — та же комната и та же база; запрос убран из канала", async () => {
  const h = make();
  const { request, sent, out } = await knock(h, { do: "look" });
  assert.deepEqual(out, { ok: true, code: "door_answer", do: "look", parts: 1, answered: true });
  const got = await opened(request);
  assert.equal(got.ok, true);
  assert.equal(got.result.ok, true); assert.equal(got.result.do, "look"); assert.equal(got.result.owner, true); assert.equal(got.result.first, true);
  const direct = await room(h, { do: "look" });
  assert.equal(direct.first, false, "страница после приложения видит уже знакомую комнату: база одна");
  assert.deepEqual(Object.keys(got.result).sort(), Object.keys(direct).sort(), "договор ответа тот же, что у страницы");
  assert.deepEqual(calls("deleteMessage").at(-1), { chat_id: DOOR, message_id: sent.message_id });
  // Забота через дверь видна странице, и наоборот.
  const fed = await knock(h, { do: "feed", input: { id: "abc123" } });
  assert.equal((await opened(fed.request)).result.ok, true);
  assert.equal((await room(h, { do: "look" })).done.feed, 1);
  const again = await knock(h, { do: "feed", input: { id: "abc123" } });
  assert.equal((await opened(again.request)).result.ok, true);
  assert.equal((await room(h, { do: "look" })).done.feed, 1, "тот же номер действия второй раз ничего не меняет — как у страницы");
  for (const text of posts()) assert.ok(text.length <= DOOR_POST_MAX);
});

test("без ключа двери нет: тот же пост — обычный пост канала; с ключом пост из другого канала двери не достаётся", async () => {
  const off = make({ DOOR_KEY: "" });
  const first = await knock(off, { do: "look" });
  assert.equal(first.out.code, "clock", "без ключа это просто пост в канале");
  assert.equal(posts().length, 0);
  reset();
  const bad = make({ DOOR_KEY: `${DOOR}:коротко` });
  assert.equal((await knock(bad, { do: "look" })).out.code, "clock", "ключ записан не так — двери тоже нет");
  reset();
  const h = make();
  const stray = await knock(h, { do: "look" }, { chat: "-100777" });
  assert.equal(stray.out.code, "clock", "верная подпись в чужом канале ничего не открывает");
  assert.equal(posts().length + posts("-100777").length, 0);
});

test("в канале двери не запрос — молчит и будильник не заводит: слово человека, чужой ответ; что слышала — помнит", async () => {
  const h = make();
  assert.deepEqual(await h.onMessage(post("проверка связи"), KEY), { ok: true, code: "door_ignored" });
  const answer = { v: 1, t: "a", re: "abcdefgh", n: 1, of: 1, ts: clock, body: "{}" };
  assert.deepEqual(await h.onMessage(post(doorWire({ ...answer, sig: await hmac(SECRET, doorPayload(answer)) })), KEY), { ok: true, code: "door_ignored" });
  // Правка поста без запроса — тоже просто слово (сама правка с 0.54.2 — путь запроса, см. тест путей).
  assert.deepEqual(await h.onMessage(post("поправила слово", { extra: { edit_date: Math.floor(clock / 1000) } }), KEY), { ok: true, code: "door_ignored" });
  assert.equal(posts().length, 0);
  assert.equal(calls("deleteMessage").length, 0, "чужое слово из канала не убирается");
  // По этой записи после неудачного опыта видно, доходят ли до сердца посты канала двери вообще.
  const state = JSON.parse(sdk().kv.get(DOOR_STATE_KEY));
  assert.deepEqual(state.heard.map(item => [item.way, item.code]), [["edit", "door_ignored"], ["post", "door_ignored"], ["post", "door_ignored"]]);
  assert.equal(state.asked, undefined, "запросом это не считается");
});

test("неверная подпись: запрос не исполняется, в канале — подписанная пометка, хозяину — одно слово; пометок не больше трёх за десять минут", async () => {
  const h = make();
  const wrong = await sealRequest({ secret: `${SECRET}x`, uid: OWNER, ts: clock, do: "feed", input: { id: "abc123" } });
  const out = await h.onMessage(post(doorWire(wrong)), KEY);
  assert.deepEqual(out, { ok: false, code: "door_bad_signature", noted: true });
  const note = doorRead(posts().at(-1));
  assert.equal(note.t, "e"); assert.equal(note.code, "bad_signature"); assert.equal(note.re, wrong.id);
  assert.equal(note.sig, createHmac("sha256", SECRET).update(doorPayload(note)).digest("hex"));
  assert.deepEqual(await openAnswer({ secret: SECRET, id: wrong.id, texts: posts() }), { ok: false, code: "bad_signature", build: note.build, trusted: true });
  assert.equal((await openAnswer({ secret: `${SECRET}x`, id: wrong.id, texts: posts() })).trusted, false, "с другим ключом пометку прочесть можно, поверить ей — нет");
  assert.equal((await room(h, { do: "look" })).done.feed, 0);
  assert.equal(toOwner().filter(item => /Дверь приложения/u.test(item.text) && /неверной подписью/u.test(item.text)).length, 1);
  // Подделка поля после подписи — та же неверная подпись.
  const real = await sealRequest({ secret: SECRET, uid: GUEST, ts: clock });
  assert.equal((await h.onMessage(post(doorWire({ ...real, uid: OWNER })), KEY)).code, "door_bad_signature");
  for (let index = 0; index < 4; index += 1) await h.onMessage(post(doorWire({ ...wrong, id: `forged-${index}-0000` })), KEY);
  assert.equal(posts().length, DOOR_NOTES, "дальше — молча");
  assert.equal(toOwner().filter(item => /неверной подписью/u.test(item.text)).length, 1, "хозяину та же весть дважды не идёт");
  // Не разобрать вовсе — тоже пометка, когда окно откроется.
  clock += 11 * 60_000;
  assert.deepEqual(await h.onMessage(post("AI-DOOR1 {оборвано"), KEY), { ok: false, code: "door_bad_envelope", noted: true });
  assert.equal(doorRead(posts().at(-1)).code, "bad_envelope");
  const odd = await sealRequest({ secret: SECRET, uid: OWNER, ts: clock, do: "LOOK!" });
  assert.equal((await h.onMessage(post(doorWire(odd)), KEY)).code, "door_bad_envelope", "действие — только строчные латинские буквы");
});

test("время: запрос сверяется с временем поста по часам Telegram; старый пост не исполняется, повтор — тоже", async () => {
  const h = make();
  const early = await knock(h, { do: "look", ts: clock - 121_000 });
  assert.deepEqual(early.out, { ok: false, code: "door_stale", noted: true });
  assert.equal(doorRead(posts().at(-1)).code, "stale");
  assert.equal((await knock(h, { do: "look", ts: clock + 119_000 })).out.code, "door_answer", "до двух минут в любую сторону — годится");
  // Часы сердца спешат на девять минут — пост всё ещё свежий; на одиннадцать — уже нет, и об этом молча.
  const before = posts().length;
  const posted = clock;
  clock = posted + 9 * 60_000;
  assert.equal((await knock(h, { do: "look", ts: posted }, { date: posted })).out.code, "door_answer");
  clock = posted + 11 * 60_000;
  assert.deepEqual((await knock(h, { do: "look", ts: posted }, { date: posted })).out, { ok: false, code: "door_late" });
  assert.equal(posts().length, before + 1);
  // Повтор того же конверта: исполнен один раз, второй раз — молча, даже новым постом.
  clock = T + 3600_000;
  const first = await knock(h, { do: "feed", input: {} });
  assert.equal(first.out.code, "door_answer");
  const count = posts().length;
  assert.deepEqual(await h.onMessage(post(doorWire(first.request)), KEY), { ok: false, code: "door_replay" });
  assert.equal(posts().length, count);
  assert.equal((await room(h, { do: "look" })).done.feed, 1);
});

test("пока дверь пускает только хозяина; гостям её открывает одна строка настройки — и у гостя своя комната", async () => {
  const h = make();
  const guest = await knock(h, { uid: GUEST, do: "look" });
  assert.equal(guest.out.answered, false);
  const refused = (await opened(guest.request)).result;
  assert.equal(refused.ok, false); assert.equal(refused.code, "door_closed"); assert.match(refused.text, /только хозяину/u); assert.ok(refused.build);
  reset();
  const open = make({ DOOR_GUESTS: true });
  const let_in = await knock(open, { uid: GUEST, do: "look" });
  const seen = (await opened(let_in.request)).result;
  assert.equal(seen.ok, true); assert.equal(seen.owner, false); assert.equal(seen.first, true);
  assert.equal((await room(open, { do: "look" }, OWNER)).first, true, "комната хозяина при этом не тронута");
});

test("разрешённые действия названы списком: журнал ошибок страницы через дверь не пишется; новое действие комнаты заставит решить", async () => {
  const h = make();
  const oops = await knock(h, { do: "oops", input: { items: [{ where: "x", code: "y", text: "z" }] } });
  const refused = (await opened(oops.request)).result;
  assert.equal(refused.ok, false); assert.equal(refused.code, "forbidden");
  const strange = await knock(h, { do: "fly" });
  assert.equal((await opened(strange.request)).result.code, "forbidden", "чего нет в списке, до комнаты не доходит");
  const narrow = make({ DOOR_ALLOW: ["look"] });
  const fed = await knock(narrow, { do: "feed" });
  assert.equal((await opened(fed.request)).result.code, "forbidden", "список можно сузить настройкой");
  // Все действия комнаты — либо разрешены, либо названы среди неразрешённых.
  const door = read("tgcloud/lib/roomdoor.js"), heartCode = read("tgcloud/lib/heart.js");
  const pool = [...heartCode.match(/const ROOM_POOL = Object\.freeze\(\{([^}]*)\}\);/u)[1].matchAll(/(\w+):/gu)].map(item => item[1]);
  const ops = new Set([...pool, ...[...door.matchAll(/\bop === "([a-z]+)"/gu)].map(item => item[1])]);
  assert.ok(ops.size >= 20);
  assert.deepEqual([...ops].sort(), [...DOOR_ALLOW, ...DOOR_NOT_ALLOWED].sort(), "новое действие комнаты: впишите его в DOOR_ALLOW или в DOOR_NOT_ALLOWED (bridge.js) и в docs/DOOR.md");
  // Поля действия — объект; иное до комнаты не доходит.
  const list = await sealRequest({ secret: SECRET, uid: OWNER, ts: clock, do: "look" });
  const forged = { ...list, in: "[1,2]" };
  forged.sig = await hmac(SECRET, doorPayload(forged));
  await h.onMessage(post(doorWire(forged)), KEY);
  assert.equal((await opened(forged)).result.code, "bad_input");
});

test("частота: одиннадцатый запрос человека за минуту — отказ словами; девятнадцатый пост двери за минуту — тишина", async () => {
  const h = make({ DOOR_GUESTS: true });
  for (let index = 0; index < DOOR_PER_PERSON; index += 1) assert.equal((await knock(h, { do: "look" })).out.answered, true);
  const eleventh = await knock(h, { do: "look" });
  const slow = (await opened(eleventh.request)).result;
  assert.equal(slow.ok, false); assert.equal(slow.code, "slow"); assert.equal(slow.retry, 60);
  // Другие люди ещё проходят — пока дверь целиком не упёрлась в предел постов.
  let passed = 0, silent = 0;
  for (let uid = 100; uid < 112; uid += 1) {
    const before = posts().length;
    const one = await knock(h, { uid, do: "look" });
    if (one.out.code === "door_full") { silent += 1; assert.equal(posts().length, before); } else passed += 1;
  }
  assert.equal(posts().length, DOOR_PER_MINUTE);
  assert.equal(passed, DOOR_PER_MINUTE - DOOR_PER_PERSON - 1); assert.equal(silent, 12 - passed);
  // Следующая минута — по времени поста — и дверь снова открыта.
  clock += 60_000;
  assert.equal((await knock(h, { do: "look" })).out.answered, true);
});

test("ответ, который не влез в один пост, приходит частями и собирается в тот же ответ", async () => {
  const h = make();
  // Альбом растёт с каждым днём: снимок, сценка, забота.
  for (let day = 0; day < 12; day += 1) {
    for (const op of ["pet", "feed", "play", "tea", "water", "book", "snap", "call"]) { await room(h, { do: op, id: `act${day}x${op}` }); clock += 70_000; }
    clock += 24 * 3600_000;
  }
  const direct = await room(h, { do: "album" });
  assert.ok(JSON.stringify(direct).length > 4096, "такой ответ в одно сообщение Telegram не помещается");
  const { request, out } = await knock(h, { do: "album" });
  assert.ok(out.parts >= 2);
  const got = await opened(request);
  assert.equal(got.parts, out.parts);
  // Её слова к альбому выбираются случайно (одна из трёх строк): сравнивается всё остальное. До 0.54.1 сравнивалось
  // целиком — и тест падал примерно раз из восьми (26 расхождений на 200 пар ответов); 742 из 742 в 0.54.0 сошлись
  // по везению.
  const { line: said, ...album } = got.result, { line: saidDirect, ...albumDirect } = direct;
  assert.deepEqual(album, albumDirect);
  assert.ok(said && saidDirect, "слова есть в обоих ответах");
  for (const text of posts()) { assert.ok(text.length <= DOOR_POST_MAX); assert.match(text, /^[\x20-\x7e\u0400-\u04ff«»—–…№]+$/u); }
  // Части в любом порядке и вперемешку с чужими постами — тот же ответ; без одной части ответа нет.
  const mixed = ["слово", ...[...posts()].reverse(), doorWire({ v: 1, t: "a", re: request.id, n: 1, of: 1, ts: 1, body: "{\"ok\":true}", sig: "0".repeat(64) })];
  assert.deepEqual((await openAnswer({ secret: SECRET, id: request.id, texts: mixed })).result, got.result, "часть с чужой подписью не подменяет настоящую");
  const partial = await openAnswer({ secret: SECRET, id: request.id, texts: posts().slice(1) });
  assert.equal(partial.ok, false); assert.equal(partial.code, "waiting");
});

test("репетиция платформы ничего не шлёт и не пишет; строка статуса говорит о двери только там, где есть ключ", async () => {
  const h = make();
  const request = await sealRequest({ secret: SECRET, uid: OWNER, ts: clock });
  assert.deepEqual(await h.onMessage(post(doorWire(request)), { ...KEY, testRun: true }), { ok: true, code: "door_request", side_effects: "none" });
  assert.equal(sdk().sent.length, 0);
  assert.equal(sdk().kv.has(DOOR_STATE_KEY), false);
  const status = async (heartOf) => { await heartOf.onMessage({ message_id: (mid += 1), date: Math.floor(clock / 1000), from: { id: OWNER, first_name: "Хозяин" }, chat: { id: OWNER, type: "private" }, text: "/status" }, KEY); return toOwner().at(-1).text; };
  assert.match(await status(h), /Дверь приложения: открыта только вам · за сутки запросов: 0 · от бота двери пока ничего не приходило\n/u);
  await knock(h, { do: "look" });
  await knock(h, { do: "oops" });
  assert.match(await status(h), /Дверь приложения: открыта только вам · за сутки запросов: 2, отказов: 1 \(последний — forbidden\) · путь: новый пост\n/u);
  reset();
  assert.ok(!/Дверь приложения/u.test(await status(make({ DOOR_KEY: "" }))), "ключа нет — о двери ни слова");
  reset();
  assert.match(await status(make({ DOOR_KEY: `${DOOR}:коротко` })), /Дверь приложения: закрыта — ключ записан не так/u);
  reset();
  assert.match(await status(make({ DOOR_GUESTS: true })), /Дверь приложения: открыта всем, кого назовёт посредник/u);
});

test("канал моста дверью не становится: с таким ключом двери нет, пост остаётся ударом будильника; статус говорит почему", async () => {
  // Дверь забирает себе все посты своего канала. Стань им канал моста — будильник и мост с сестрой замолчали бы,
  // а опыт двери при этом прошёл бы. Сердце такой ключ не принимает.
  const BRIDGE = "-100444000111";
  const h = make({ ABILITIES_CHANNEL_ID: BRIDGE, ABILITIES_SECRET: "bridge-secret", DOOR_KEY: `${BRIDGE}:${SECRET}` });
  const request = await sealRequest({ secret: SECRET, uid: OWNER, ts: clock });
  const out = await h.onMessage(post(doorWire(request), { chat: BRIDGE }), KEY);
  assert.equal(out.code, "clock", "запрос двери в канале моста — обычный пост канала: удар будильника");
  assert.equal(toChat(BRIDGE).length, 0, "ответа двери нет");
  assert.equal(sdk().kv.has(DOOR_STATE_KEY), false);
  await h.onMessage({ message_id: (mid += 1), date: Math.floor(clock / 1000), from: { id: OWNER, first_name: "Хозяин" }, chat: { id: OWNER, type: "private" }, text: "/status" }, KEY);
  assert.match(toOwner().at(-1).text, /Дверь приложения: закрыта — канал двери тот же, что у моста: двери нужен свой канал/u);
  // Свой канал при том же мосте — дверь на месте.
  reset();
  const fine = make({ ABILITIES_CHANNEL_ID: BRIDGE, ABILITIES_SECRET: "bridge-secret" });
  const through = await knock(fine);
  assert.equal(through.out.code, "door_answer");
  assert.equal((await opened(through.request)).ok, true);
});

const edits = (chat = DOOR) => calls("editMessageText").filter(item => String(item.chat_id) === String(chat));
/** Личное сообщение бота двери: так его отдаёт Telegram с Bot API 10.0 — чат личный, отправитель — бот. */
const BOT = { id: 777001, is_bot: true, first_name: "door_bot", username: "door_bot" };
const letter = (text, { from = BOT, type = "private", chat = from.id } = {}) => ({ message_id: (mid += 1), date: Math.floor(clock / 1000), from, chat: { id: chat, type }, text });

test("канал называет автора поста — в посте бота есть from: запрос двери исполняется и постом, и правкой, будильник в другом канале бьёт (до 0.54.2 такой пост отбрасывался с порога)", async () => {
  // «from … may be empty for messages sent to channels» — может и не быть пустым: в канале с подписями-профилями
  // сервер Bot API называет автора (Client.cpp: `from` пишется при любом sender_user_id). Сердце 0.54.0–0.54.1
  // первой строкой бросало всё, что от бота, — и до двери такой пост не доходил: «за сутки запросов: 0».
  const h = make();
  const status = async (heartOf) => { await heartOf.onMessage({ message_id: (mid += 1), date: Math.floor(clock / 1000), from: { id: OWNER, first_name: "Хозяин" }, chat: { id: OWNER, type: "private" }, text: "/status" }, KEY); return toOwner().at(-1).text; };
  const named = { from: BOT, author_signature: "door_bot" };
  const request = await sealRequest({ secret: SECRET, uid: OWNER, ts: clock });
  const posted = post(doorWire(request), { extra: named });
  assert.deepEqual(await h.onMessage(posted, KEY), { ok: true, code: "door_answer", do: "look", parts: 1, answered: true });
  assert.equal((await opened(request)).result.owner, true);
  const second = await sealRequest({ secret: SECRET, uid: OWNER, ts: clock });
  const edited = post(doorWire(second), { date: clock - 300_000, extra: { ...named, edit_date: Math.floor(clock / 1000) } });
  assert.deepEqual(await h.onMessage(edited, KEY), { ok: true, code: "door_answer", do: "look", parts: 1, answered: true });
  assert.match(await status(h), /за сутки запросов: 2 · путь: правка поста\n/u);
  // Не запрос в канале двери от названного бота — молчание, как и без имени: будильник им не заводится.
  assert.deepEqual(await h.onMessage(post("тик", { extra: named }), KEY), { ok: true, code: "door_ignored" });
  // Другой канал (мост, будильник): пост названного бота — удар будильника, как и пост без автора.
  assert.equal((await h.onMessage(post("тик", { chat: "-100777", extra: named }), KEY)).code, "clock");
  // А в группе и в личке бот по-прежнему не собеседник.
  assert.deepEqual(await h.onMessage(letter("Аи, привет", { type: "supergroup", chat: -10 }), KEY), { ignored: true });
  assert.deepEqual(await h.onMessage(letter("привет"), KEY), { ignored: true });
});

test("пути (0.54.2): запрос правкой поста — ответ заготовкой и её правкой; личное сообщение бота — ответ лично, по имени; повтор другим путём не исполняется", async () => {
  assert.deepEqual([...DOOR_WAYS], ["direct", "edit", "post"], "порядок опыта: от описанного Telegram к обходам");
  const h = make();
  // Правка: пост старый (заготовка), время запроса сверяется с временем правки.
  const request = await sealRequest({ secret: SECRET, uid: OWNER, ts: clock });
  const edited = post(doorWire(request), { date: clock - 300_000, extra: { edit_date: Math.floor(clock / 1000) } });
  assert.deepEqual(await h.onMessage(edited, KEY), { ok: true, code: "door_answer", do: "look", parts: 1, answered: true });
  assert.deepEqual(posts(), [DOOR_SLOT_TEXT], "в канал ушла заготовка…");
  assert.equal(edits().length, 1);
  assert.equal(edits()[0].message_id, sdk().sent.length, "…и тут же её правка — тем же сообщением");
  const viaEdit = await openAnswer({ secret: SECRET, id: request.id, texts: edits().map(item => item.text) });
  assert.equal(viaEdit.ok, true); assert.equal(viaEdit.result.owner, true);
  assert.deepEqual(calls("deleteMessage").at(-1), { chat_id: DOOR, message_id: edited.message_id }, "прочитанный запрос убран");
  // Та же правка пришла ещё раз (Telegram шлёт её и по мелочам) — повтор, без второго ответа.
  assert.equal((await h.onMessage({ ...edited, edit_date: edited.edit_date + 1 }, KEY)).code, "door_replay");
  assert.equal(edits().length, 1);
  // Правка с запросом, чьё время разошлось с временем правки, — пометка «stale», тем же путём.
  const late = await sealRequest({ secret: SECRET, uid: OWNER, ts: clock - 600_000 });
  assert.equal((await h.onMessage(post(doorWire(late), { extra: { edit_date: Math.floor(clock / 1000) } }), KEY)).code, "door_stale");
  assert.equal(doorRead(edits().at(-1).text).code, "stale");

  // Личное сообщение бота: ответ — ему же, по имени; из лички ничего не удаляется.
  const sentBefore = sdk().sent.length, erasedBefore = calls("deleteMessage").length;
  const direct = await sealRequest({ secret: SECRET, uid: OWNER, do: "look", ts: clock });
  assert.deepEqual(await h.onMessage(letter(doorWire(direct)), KEY), { ok: true, code: "door_answer", do: "look", parts: 1, answered: true });
  const mail = sdk().sent.slice(sentBefore);
  assert.deepEqual(mail.map(item => item.chat_id), ["@door_bot"]);
  assert.equal(mail[0].disable_notification, true);
  assert.equal((await openAnswer({ secret: SECRET, id: direct.id, texts: mail.map(item => item.text) })).ok, true);
  assert.equal(calls("deleteMessage").length, erasedBefore);
  // Тот же запрос вторым путём — повтор: номер запроса один на все пути.
  assert.equal((await h.onMessage(post(doorWire(direct)), KEY)).code, "door_replay");
  // Чужая подпись в личном сообщении — пометка лично, запрос не исполнен.
  const forged = await sealRequest({ secret: "x".repeat(40), uid: OWNER, ts: clock });
  assert.equal((await h.onMessage(letter(doorWire(forged)), KEY)).code, "door_bad_signature");
  assert.equal(doorRead(sdk().sent.at(-1).text).code, "bad_signature"); assert.equal(sdk().sent.at(-1).chat_id, "@door_bot");

  // От ботов она по-прежнему не слушает ничего другого: слово бота в личке и в группе — мимо; конверт двери в группе —
  // мимо, но запомнен («пришёл не туда»).
  const quiet = sdk().sent.length;
  assert.deepEqual(await h.onMessage(letter("привет, я бот"), KEY), { ignored: true });
  assert.deepEqual(await h.onMessage(letter("привет", { type: "supergroup", chat: -10 }), KEY), { ignored: true });
  const lost = await sealRequest({ secret: SECRET, uid: OWNER, ts: clock });
  assert.deepEqual(await h.onMessage(letter(doorWire(lost), { type: "supergroup", chat: -10 }), KEY), { ignored: true });
  assert.equal(sdk().sent.length, quiet);
  assert.deepEqual([JSON.parse(sdk().kv.get(DOOR_STATE_KEY)).heard[0].way, JSON.parse(sdk().kv.get(DOOR_STATE_KEY)).heard[0].code], ["stray", "supergroup -10, от бота"]);
  // Репетиция платформы: личное сообщение бота узнаётся, но ничего не шлёт.
  assert.deepEqual(await h.onMessage(letter(doorWire(await sealRequest({ secret: SECRET, uid: OWNER, ts: clock }))), { ...KEY, testRun: true }), { ok: true, code: "door_request", side_effects: "none" });
  assert.equal(sdk().sent.length, quiet);
});

test("личный ответ боту: по имени не вышло — по номеру чата; не вышло вовсе — весть хозяину о режиме общения ботов", async () => {
  // Telegram описывает путь «по имени»; примет ли он номер, неизвестно — поэтому сердце пробует оба.
  const refused = [];
  const api = new Proxy({}, { get: (_, name) => (name !== "sendMessage" ? sdkApi[name] : async (params) => {
    if (String(params.chat_id).startsWith("@")) { refused.push(params.chat_id); throw Object.assign(new Error("Bad Request: chat not found"), { code: 400 }); }
    return sdkApi.sendMessage(params);
  }) });
  const h = heart({ PHRASES: true, ROOM_APP: true, DOOR_KEY: LINE }, { now: () => clock, api });
  const request = await sealRequest({ secret: SECRET, uid: OWNER, ts: clock });
  assert.equal((await h.onMessage(letter(doorWire(request)), KEY)).code, "door_answer");
  assert.deepEqual(refused, ["@door_bot"]);
  assert.equal(toChat(BOT.id).length, 1, "ответ ушёл по номеру чата");
  assert.equal((await openAnswer({ secret: SECRET, id: request.id, texts: toChat(BOT.id).map(item => item.text) })).ok, true);
});

test("дверь помнит, что слышала: строка статуса и слова для телефона; режим общения ботов включается по вопросу телефона и после публикации", async () => {
  const h = make();
  // Вопрос телефона (`phone.sh door`): сердце включает у себя режим общения ботов и говорит, что слышало.
  const first = await h.doorState();
  assert.deepEqual(calls("setMySettings"), [{ can_communicate_with_bots: true }]);
  assert.deepEqual(first.split(" | "), [
    `${DOOR_SAYS} name=ai_heart_bot seq=0`, "Что слышала Аи от бота двери за последние четверть часа:",
    "• личное сообщение бота — не слышала", "• правка поста — не слышала", "• новый пост — не слышала", "Общение ботов у Аи: включено.",
  ]);
  assert.ok(!first.includes(SECRET) && !first.includes(DOOR), "ни ключа, ни номера канала в этих словах нет");
  // Слово в канале, запрос правкой, запрос лично — и что из этого вышло.
  await h.onMessage(post("Проверка: бот двери может писать в этот канал."), KEY);
  clock += 20_000;
  await h.onMessage(post(doorWire(await sealRequest({ secret: SECRET, uid: OWNER, ts: clock })), { extra: { edit_date: Math.floor(clock / 1000) } }), KEY);
  clock += 100_000;
  await h.onMessage(letter(doorWire(await sealRequest({ secret: "y".repeat(40), uid: OWNER, ts: clock }))), KEY);
  clock += 5_000;
  assert.deepEqual((await h.doorState()).split(" | ").slice(2, 5), [
    "• личное сообщение бота — 5 с назад: запрос с чужой подписью: ключи у сторон разные", "• правка поста — 2 мин назад: запрос, ответила", "• новый пост — 2 мин назад: не запрос, просто слово",
  ]);
  // Телефон называет номер, после которого считать (он взял его до опыта): в ответе — только пришедшее после, и без
  // времени: часы у разных запусков платформы расходятся на минуты, а номер по порядку — нет.
  assert.match(await h.doorState(), new RegExp(`^${DOOR_SAYS} name=ai_heart_bot seq=3 \\| `, "u"));
  assert.deepEqual((await h.doorState({ after: 1 })).split(" | ").slice(1, 5), [
    "Что слышала Аи от бота двери за этот опыт:", "• личное сообщение бота — запрос с чужой подписью: ключи у сторон разные", "• правка поста — запрос, ответила", "• новый пост — не слышала",
  ]);
  assert.match(await h.doorState({ after: 3 }), /• личное сообщение бота — не слышала \| • правка поста — не слышала \| • новый пост — не слышала/u);
  const status = async (heartOf) => { await heartOf.onMessage({ message_id: (mid += 1), date: Math.floor(clock / 1000), from: { id: OWNER, first_name: "Хозяин" }, chat: { id: OWNER, type: "private" }, text: "/status" }, KEY); return toOwner().at(-1).text; };
  assert.match(await status(h), /Дверь приложения: открыта только вам · за сутки запросов: 1, отказов: 1 \(последний — bad_signature\) · путь: правка поста\n/u);
  // Через четверть часа услышанное телефону уже не показывается: опыт давно кончился.
  clock += 16 * 60_000;
  assert.match(await h.doorState(), /• личное сообщение бота — не слышала \| • правка поста — не слышала \| • новый пост — не слышала/u);

  // Запрос с верной подписью пришёл из другого канала: ключ записан не на тот канал — это видно и в статусе, и телефону.
  reset();
  const other = make();
  assert.equal((await knock(other, {}, { chat: "-100777" })).out.code, "clock");
  assert.match(await status(other), /за сутки запросов: 0 · запрос двери пришёл не туда \(channel -100777\)\n/u);
  assert.match(await other.doorState(), /• запрос двери пришёл не туда — 0 с назад: channel -100777; если это канал — ключ записан на другой/u);
  assert.match(await other.doorState({ after: 0 }), /• запрос двери пришёл не туда — channel -100777; если это канал — ключ записан на другой/u);
  // Конверт двери от человека (или в виде, которого сердце не ждёт) — не разговор: запомнен и оставлен без ответа.
  const sentSoFar = sdk().sent.length;
  const pasted = await sealRequest({ secret: SECRET, uid: OWNER, ts: clock });
  assert.deepEqual(await other.onMessage({ message_id: (mid += 1), date: Math.floor(clock / 1000), from: { id: 5, first_name: "Гость", is_bot: false }, chat: { id: 5, type: "private" }, text: doorWire(pasted) }, KEY), { ignored: true, reason: "door" });
  assert.equal(sdk().sent.length, sentSoFar);
  assert.match(await other.doorState({ after: 1 }), /• запрос двери пришёл не туда — private 5, не от бота;/u);

  // Сервер без setMySettings (до Bot API 10.5): причина — в статусе и в словах телефону, с тем, где включить руками.
  reset();
  sdk().failing.setMySettings = Object.assign(new Error("setMySettings failed"), { code: 404, description: "Not Found: method not found" });
  const old = make();
  assert.match(await old.doorState(), /Общение ботов у Аи не включилось \(Not Found: method not found\) — включите сами: @BotFather → \/mybots → бот Аи → Bot Settings → Bot-to-Bot Communication Mode\.$/u);
  assert.match(await status(old), /от бота двери пока ничего не приходило · общение ботов не включилось \(Not Found: method not found\)\n/u);
  // Учёт запросов эту запись не стирает.
  await knock(old);
  assert.match(await status(old), /путь: новый пост · общение ботов не включилось/u);

  // После публикации (пробуждение с `deployed`) режим включается сам; обычный удар его не трогает; без ключа — тоже.
  reset();
  const fresh = make();
  await fresh.tick({ ...KEY, tick: true });
  assert.equal(calls("setMySettings").length, 0);
  await fresh.tick({ ...KEY, tick: true, deployed: true });
  assert.deepEqual(calls("setMySettings"), [{ can_communicate_with_bots: true }]);
  reset();
  const closed = make({ DOOR_KEY: "" });
  await closed.tick({ ...KEY, tick: true, deployed: true });
  assert.equal(calls("setMySettings").length, 0, "двери нет — режим общения ботов ей не нужен");
  assert.equal(await closed.doorState(), `${DOOR_SAYS} name=ai_heart_bot seq=0 | У сердца нет ключа двери: оно опубликовано без строки KEY_DOOR.`);
  // Тем же входом, что удар будильника: обработчик сообщений с контекстом владельца токена публикации. В самом
  // репозитории ключа двери нет — настоящее сердце так и отвечает.
  const { default: handler } = await import("../tgcloud/handlers/message.js");
  assert.match(await handler({}, { door: "state", after: 0 }), new RegExp(`^${DOOR_SAYS} name=\\S+ seq=0 \\| У сердца нет ключа двери: оно опубликовано без строки KEY_DOOR\\.$`, "u"));
});

test("ключ двери попадает в сердце тем же путём, что остальные: KEY_DOOR → secrets.js; записан не так — двери нет", () => {
  const dir = mkdtempSync(join(tmpdir(), "door-"));
  try {
    const file = join(dir, "secrets.js");
    const fill = (env) => new Promise((resolve) => {
      writeFileSync(file, read("tgcloud/lib/secrets.js"));
      execFile(process.execPath, ["scripts/inject-secrets.mjs", `--file=${file}`], { cwd: new URL("..", import.meta.url), env: { PATH: process.env.PATH, AI_PROVIDER_KEY: "test-provider-key", ...env } }, (error, stdout) => resolve({ out: String(stdout), text: readFileSync(file, "utf8") }));
    });
    return (async () => {
      const good = await fill({ KEY_DOOR: LINE });
      assert.ok(good.text.includes(`export const AI_EXTRA_KEYS = ${JSON.stringify({ door: LINE })};`));
      assert.ok(!good.out.includes(SECRET), "ключ не печатается");
      const bad = await fill({ KEY_DOOR: "секрет-без-канала-0123456789abcdefghijklmnop".replace(/[^\x21-\x7e]/gu, "x") });
      assert.ok(bad.text.includes("export const AI_EXTRA_KEYS = {};"));
      assert.match(bad.out, /KEY_DOOR must look like/u);
      assert.match(read("tgcloud/lib/heart.js"), /key: config\.DOOR_KEY \?\? extraKeys\.door \?\? ""/u, "сердце берёт ключ оттуда же");
      assert.ok(!/DOOR_KEY/u.test(read("tgcloud/lib/config.js").replace(/\/\/.*$/gmu, "")), "в открытом хранилище ключа двери нет");
    })().finally(() => rmSync(dir, { recursive: true, force: true }));
  } catch (error) { rmSync(dir, { recursive: true, force: true }); throw error; }
});

// ── Посредник: `scripts/door-client.mjs` против поддельного Bot API ─────────────────────────────────────────────────
//
// Поддельный Bot API — `tests/fixtures/telegram.mjs`: он ведёт себя так, как написано в исходниках настоящего сервера,
// а не так, как удобно тесту (в 0.54.0 было наоборот — и первый живой опыт упёрся в то, чего тест не видел).
// Путь по умолчанию у этих тестов — новый пост в канале (`DOOR_WAY=post`): так был написан посредник 0.54.1.
// Тесты путей (0.54.2) называют путь сами.
const telegramStub = async (options = {}) => {
  const tg = await telegramFixture({ door: DOOR, nextId: () => (mid += 1), ...options });
  return { ...tg, run: (args, extra = {}, input = null) => tg.run(args, { DOOR_WAY: "post", ...extra }, input) };
};
// Эти тесты поднимают сервер на 127.0.0.1 и запускают посредника отдельными процессами. Телефон гоняет набор перед
// публикацией, и там тест порта не открывает и от скорости устройства не зависит (AGENTS.md, «Тесты»): пропуск. В 0.54.0
// пропуска не было — правило было нарушено; на телефоне тест прошёл, но зависеть от этого публикация не должна.
const skip = process.platform === "android" ? "поддельный Telegram — сервер и отдельные процессы: на телефоне не запускается" : false;
const READY = [`OWNER_TG_ID=${OWNER}`, `DOOR_BOT_TOKEN=${DOOR_BOT}`, `KEY_DOOR=${LINE}`];

test("опыт с телефона: запрос уходит ботом двери, сердце отвечает; прочитанное убрано, посты — без звука", { skip }, async () => {
  const h = make();
  const tg = await telegramStub({ hearts: () => h });
  try {
    clock = Date.now();
    tg.keys(READY);
    tg.push(DOOR_BOT, { channel_post: { message_id: 5, date: 1, chat: { id: Number(DOOR), title: "Дверь", type: "channel" }, text: "слово в канале" } });
    const where = await tg.run(["where"]);
    assert.equal(where.code, 0, where.out); assert.match(where.out, /канал «Дверь»: -100900900/u);
    // Опыт как его видит владелец: итог одной строкой, без простыни JSON.
    const look = await tg.run(["look", "--wait=10", "--poll=1"]);
    assert.equal(look.code, 0, look.out);
    assert.match(look.out, /^✓ Дверь работает: сердце ответило за \d+\.\d с \(постов: 1, знаков: \d+\)\.$/mu);
    assert.match(look.out, /Комната: сборка \d+\.\d+\.\d+ · хозяин: да · её слова: «.+»/u);
    assert.ok(look.out.split("\n").length <= 5, "итог опыта помещается на экран телефона");
    assert.deepEqual(tg.left(), [], "канал — провод: запрос убрало сердце, ответ — посредник");
    assert.ok(toChat(DOOR).every(item => item.disable_notification === true), "ответы сердца — без звука: владелец состоит в канале двери");
    // То же — целиком, для машины.
    const flat = await tg.run(["look", "--wait=10", "--poll=1", "--flat"]);
    assert.equal(flat.code, 0, flat.out);
    assert.match(flat.out, /Сердце ответило за \d+\.\d с, постов: 1\./u);
    const result = JSON.parse(flat.out.split("\n")[1]);
    assert.equal(result.ok, true); assert.equal(result.owner, true);
    // Кто хозяин, посредник решает как сердце: сначала настройки (`config.js`), потом строка ключей. На телефоне
    // строки OWNER_TG_ID может не быть вовсе — а в настройках хозяин записан.
    tg.setOwner(OWNER);
    tg.keys(READY.filter(line => !line.startsWith("OWNER_TG_ID=")));
    const bare = await tg.run(["look", "--wait=10", "--poll=1"]);
    assert.equal(bare.code, 0, bare.out); assert.match(bare.out, /хозяин: да/u);
    tg.keys(READY.map(line => (line.startsWith("OWNER_TG_ID=") ? `OWNER_TG_ID=${GUEST}` : line)));
    const fromConfig = await tg.run(["look", "--wait=10", "--poll=1"]);
    assert.equal(fromConfig.code, 0, "в ключах другой номер — запрос всё равно идёт от хозяина из настроек, как решит и сердце");
    tg.setOwner(0);
    tg.keys(READY.filter(line => !line.startsWith("OWNER_TG_ID=")));
    const nobody = await tg.run(["look", "--wait=10", "--poll=1"]);
    assert.equal(nobody.code, 1); assert.match(nobody.out, /От чьего имени войти\? Хозяин не записан ни в tgcloud\/lib\/config\.js, ни строкой OWNER_TG_ID/u);
    tg.keys(READY);
    const guest = await tg.run(["look", `--uid=${GUEST}`, "--wait=10", "--poll=1"]);
    assert.equal(guest.code, 2, "отказ двери или комнаты — код 2");
    assert.match(guest.out, /✗ Дверь на месте, но не пустила: дверь пускает только хозяина/u);
    const wrong = await tg.run(["look", "--wait=10", "--poll=1"], { KEY_DOOR: `${DOOR}:${SECRET}-zzzzz` });
    assert.equal(wrong.code, 7, "ключи разные — свой код: телефон по нему публикует сердце заново");
    assert.match(wrong.out, /Дверь не пустила: bad_signature; подпись пометки не сошлась — ключи у сердца и здесь разные/u);
    // Без сети: запечатать и проверить.
    const sealed = await tg.run(["seal", "feed", '{"id":"abc123"}']);
    const envelope = doorRead(sealed.out.trim());
    assert.equal(envelope.do, "feed"); assert.equal(envelope.uid, OWNER); assert.equal(envelope.sig, createHmac("sha256", SECRET).update(doorPayload(envelope)).digest("hex"));
    const kept = await tg.run(["look", "--wait=10", "--poll=1", "--flat", "--keep"]);
    const answer = tg.left().find(text => text.includes('"t":"a"'));
    assert.ok(answer, "с --keep ответ остаётся в канале");
    const checked = await tg.run(["open"], {}, `${answer}\n`);
    assert.equal(checked.code, 0, kept.out + checked.out); assert.equal(JSON.parse(checked.out).result.owner, true);
    const key = await tg.run(["key", DOOR]);
    assert.ok(doorKey(key.out.trim().replace(/^KEY_DOOR=/u, "")), "готовая строка для файла ключей");
    tg.keys(READY.slice(0, 2));
    assert.match((await tg.run(["look"])).out, /Нет строки KEY_DOOR .+ Её пишет: bash scripts\/phone\.sh door/u);
    tg.keys([`OWNER_TG_ID=${OWNER}`, `KEY_DOOR=${LINE}`]);
    const none = await tg.run(["look"]);
    assert.equal(none.code, 6); assert.match(none.out, /Бота двери ещё нет[\s\S]+@BotFather → \/newbot/u);
    assert.equal(tg.called("setWebhook") + tg.called("deleteWebhook"), 0);
  } finally { tg.close(); }
});

test("бот с вебхуком (опыт 22.11.2026): сказано, что он живёт на сервере и что делать; вебхук не тронут", { skip }, async () => {
  const tg = await telegramStub();
  try {
    // Как у владельца: своего бота двери нет, есть бот будильника — он живёт на сервере.
    tg.keys([`OWNER_TG_ID=${OWNER}`, `ALARM_BOT_TOKEN=${VOICE_BOT}`]);
    for (const command of [["bot"], ["setup"], ["where"], ["look"]]) {
      const out = await tg.run(command, command[0] === "look" ? { KEY_DOOR: LINE } : {});
      assert.equal(out.code, 3, `${command[0]}: бот с вебхуком — код 3\n${out.out}`);
      assert.match(out.out, /Бот будильника @voice_bot живёт на сервере \(hook\.example\): всё, что он слышит, Telegram отдаёт туда/u);
      assert.match(out.out, /Трогать его не надо/u);
      assert.match(out.out, /Двери нужен свой бот: в Telegram — @BotFather → \/newbot .+ bash scripts\/phone\.sh door/u);
      assert.ok(!out.out.includes("secret-path"), "адрес вебхука целиком на экран не идёт — в нём бывает секрет");
    }
    assert.equal(tg.called("getUpdates"), 0, "спрашивать «что нового» у бота с вебхуком незачем: сначала — годится ли он");
    assert.equal(tg.called("setWebhook") + tg.called("deleteWebhook"), 0, "чужой вебхук не трогается никогда");
    assert.equal(tg.state.bots.get(VOICE_BOT).hook, "https://hook.example/secret-path/7");
    assert.doesNotMatch(read("scripts/door-client.mjs").replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, ""), /deleteWebhook|setWebhook/u, "в коде посредника этих вызовов нет вовсе");

    // Новый бот: токен проверяется и вписывается в файл ключей сам; на экран не печатается.
    const fresh = await tg.run(["bot", `  ${NEW_BOT}\n`]);
    assert.equal(fresh.code, 0, fresh.out);
    assert.match(fresh.out, /✓ Бот двери: @fresh_bot — токен записан в /u);
    assert.ok(!fresh.out.includes(NEW_BOT.split(":")[1]), "токен на экран не печатается");
    assert.equal(tg.text(), `OWNER_TG_ID=${OWNER}\nALARM_BOT_TOKEN=${VOICE_BOT}\n# Бот двери приложения (docs/DOOR.md): свой бот от @BotFather — не Аи и не тот, что живёт на сервере\nDOOR_BOT_TOKEN=${NEW_BOT}\n`);
    assert.match((await tg.run(["bot"])).out, /✓ Бот двери: @fresh_bot\./u);
    // Второй раз — та же строка заменяется, а не множится.
    assert.equal((await tg.run(["bot", DOOR_BOT])).code, 0);
    assert.equal(tg.text().match(/^DOOR_BOT_TOKEN=/gmu).length, 1);
    assert.ok(tg.text().includes(`DOOR_BOT_TOKEN=${DOOR_BOT}\n`));
    // Не токен; токен, который Telegram не знает; бот с вебхуком; сама Аи.
    assert.match((await tg.run(["bot", "bash scripts/phone.sh"])).out, /Это не похоже на токен бота/u);
    const unknown = await tg.run(["bot", "555000:unknown-token-DDDDDDDDDDDDDDDDDDDDDDDDDDDDD"]);
    assert.equal(unknown.code, 1); assert.match(unknown.out, /Telegram не принял токен бота двери/u);
    const hooked = await tg.run(["bot", VOICE_BOT]);
    assert.equal(hooked.code, 3); assert.match(hooked.out, /Бот @voice_bot живёт на сервере/u);
    const herself = await tg.run(["bot", DOOR_BOT], { DOOR_AI_ID: String(idOf(DOOR_BOT)) });
    assert.equal(herself.code, 4); assert.match(herself.out, /@door_bot — это сама Аи: своих постов бот не получает/u);
    assert.ok(tg.text().includes(`DOOR_BOT_TOKEN=${DOOR_BOT}\n`), "негодный токен в файл не попадает");
  } finally { tg.close(); }
});

test("настройка: канал находится по «сделали администратором» — и дожидается его; секрет придуман и вписан; с ним пускает", { skip }, async () => {
  let h = make();
  const tg = await telegramStub({ hearts: () => h });
  try {
    clock = Date.now();
    tg.keys([`OWNER_TG_ID=${OWNER}`, `DOOR_BOT_TOKEN=${DOOR_BOT}`]);
    // Бот двери только что создан: ни в одном канале его ещё нет.
    tg.state.channel.admins.delete(idOf(DOOR_BOT));
    const idle = await tg.run(["setup"]);
    assert.equal(idle.code, 1); assert.match(idle.out, /Бот двери @door_bot пока не администратор ни в одном канале/u);
    // С ожиданием: человек в это время добавляет бота в канал — настройка идёт дальше сама.
    const waiting = tg.run(["setup", "--wait=8"], { DOOR_FLOW: "1" });
    setTimeout(() => {
      tg.state.channel.admins.set(idOf(DOOR_BOT), { username: "door_bot", post: true, erase: true });
      tg.push(DOOR_BOT, { my_chat_member: { chat: { id: Number(DOOR), title: "Дверь", type: "channel" }, new_chat_member: { status: "administrator" } } });
    }, 400);
    const setup = await waiting;
    assert.equal(setup.code, 0, setup.out);
    assert.match(setup.out, /Теперь в Telegram — жду 8 с, здесь ничего нажимать не нужно:\n {2}1\. закрытый канал для двери[^\n]+\n {2}2\. канал → «Администраторы» → добавьте @door_bot и Аи: обоим — публиковать и удалять сообщения;\n {2}3\. напишите в канале любое слово\./u);
    assert.match(setup.out, /✓ Канал «Дверь»: бот двери @door_bot пишет, Аи \(@ai_heart_bot\) — администратор\./u);
    assert.match(setup.out, /✓ Ключ двери придуман и записан в /u);
    assert.doesNotMatch(setup.out, /•|Дальше:/u, "в чистом канале предупреждать не о чем; под phone.sh подсказка «дальше» не нужна");
    const written = tg.text().match(/^KEY_DOOR=(.+)$/mu)?.[1];
    assert.ok(doorKey(written)); assert.equal(doorKey(written).channel, DOOR);
    assert.ok(tg.text().startsWith(`OWNER_TG_ID=${OWNER}\nDOOR_BOT_TOKEN=${DOOR_BOT}\n# Дверь`), "прежние строки целы, новая — с новой строки");
    assert.ok(tg.text().endsWith("\n"));
    assert.ok(!setup.out.includes(doorKey(written).secret), "секрет на экран не печатается");
    assert.deepEqual(tg.left(), [], "слово-проверка убрано за собой");
    assert.equal(toChat(DOOR).length, 0, "слово-проверку сердце оставило без ответа");
    const text = tg.text();
    const twice = await tg.run(["setup"]);
    assert.equal(twice.code, 0); assert.match(twice.out, /Ключ двери уже записан[\s\S]+Дальше: bash scripts\/phone\.sh door/u);
    assert.equal(tg.text(), text, "второй раз файл не меняется");
    assert.match((await tg.run(["setup", "-100555666777"])).out, /молча менять ключ не буду/u);
    h = make({ DOOR_KEY: written });
    const through = await tg.run(["look", "--wait=10", "--poll=1"]);
    assert.equal(through.code, 0, through.out); assert.match(through.out, /✓ Дверь работает/u);
    // Бота убрали из канала — канал больше не кандидат.
    tg.keys([`OWNER_TG_ID=${OWNER}`, `DOOR_BOT_TOKEN=${DOOR_BOT}`]);
    tg.push(DOOR_BOT, { my_chat_member: { chat: { id: Number(DOOR), title: "Дверь", type: "channel" }, new_chat_member: { status: "left" } } });
    assert.match((await tg.run(["where"])).out, /пока не администратор ни в одном канале/u);
  } finally { tg.close(); }
});

test("настройка: «Мост» дверью не становится — бот двери в канале будильника не кандидат, сказано почему; отдельный канал находится", { skip }, async () => {
  const tg = await telegramStub();
  try {
    const BRIDGE = "-100444000111";
    const lines = [`OWNER_TG_ID=${OWNER}`, `DOOR_BOT_TOKEN=${DOOR_BOT}`, `ALARM_CHAT_ID=${BRIDGE}`];
    tg.keys(lines);
    tg.state.channel.admins.delete(idOf(DOOR_BOT));
    // Бота двери добавили в «Мост»: там уже есть Аи и второй бот — соблазн понятный.
    tg.push(DOOR_BOT, { my_chat_member: { chat: { id: Number(BRIDGE), title: "Мост", type: "channel" }, new_chat_member: { status: "administrator" } } });
    const idle = await tg.run(["setup"]);
    assert.equal(idle.code, 1, idle.out);
    assert.match(idle.out, /• Канал «Мост» для двери не годится: по нему ходят будильник и мост — дверь забрала бы их посты себе\. Нужен отдельный закрытый канал; бота двери из «Мост» уберите\./u);
    assert.match(idle.out, /пока не администратор ни в одном канале/u);
    assert.ok(!tg.text().includes("KEY_DOOR"), "ключ с каналом моста не пишется");
    assert.match((await tg.run(["where"])).out, /Канал «Мост» для двери не годится[\s\S]+пока не администратор ни в одном канале/u);
    // С ожиданием: о «Мосте» сказано один раз, настройка ждёт дальше — и находит отдельный канал.
    const waiting = tg.run(["setup", "--wait=8"], { DOOR_FLOW: "1" });
    setTimeout(() => {
      tg.state.channel.admins.set(idOf(DOOR_BOT), { username: "door_bot", post: true, erase: true });
      tg.push(DOOR_BOT, { my_chat_member: { chat: { id: Number(DOOR), title: "Дверь", type: "channel" }, new_chat_member: { status: "administrator" } } });
    }, 400);
    const setup = await waiting;
    assert.equal(setup.code, 0, setup.out);
    assert.equal(setup.out.match(/Канал «Мост» для двери не годится/gu)?.length, 1, setup.out);
    assert.match(setup.out, /отдельный, не тот, где будильник/u);
    assert.equal(doorKey(tg.text().match(/^KEY_DOOR=(.+)$/mu)?.[1])?.channel, DOOR);
    // Канал моста, названный прямо, — отказ словами; записанный в ключе руками — тоже, и опыт в него не идёт.
    tg.keys(lines);
    const named = await tg.run(["setup", BRIDGE]);
    assert.equal(named.code, 1); assert.match(named.out, /Канал -100444000111 занят: по нему ходят будильник и мост/u);
    assert.ok(!tg.text().includes("KEY_DOOR"));
    tg.keys([...lines, `KEY_DOOR=${BRIDGE}:${SECRET}`]);
    for (const args of [["setup"], ["look", "--wait=3"]]) {
      const done = await tg.run(args);
      assert.equal(done.code, 1, args[0]); assert.match(done.out, /Канал -100444000111 занят[\s\S]+На него указывает строка KEY_DOOR/u, args[0]);
    }
    assert.equal(tg.called("sendMessage"), 1, "в канал моста посредник не написал ни слова: единственный пост — проверка в канале двери");
    // Тот же канал посредник знает и из настроек сердца — без строки будильника в ключах.
    tg.keys([`OWNER_TG_ID=${OWNER}`, `DOOR_BOT_TOKEN=${DOOR_BOT}`]);
    tg.setOwner(0, BRIDGE);
    assert.match((await tg.run(["setup", BRIDGE])).out, /Канал -100444000111 занят/u);
  } finally { tg.close(); }
});

test("настройка называет права как есть: прежний Bot API без return_bots, Аи не в канале, лишний бот, подписчики, открытый канал", { skip }, async () => {
  const tg = await telegramStub();
  const fresh = () => { tg.keys([`OWNER_TG_ID=${OWNER}`, `DOOR_BOT_TOKEN=${DOOR_BOT}`]); return tg.run(["setup", DOOR, "--wait=1", "--step=40"]); };
  try {
    // Прежний Bot API: чужих ботов в списке администраторов нет — об Аи спрашивается отдельно, ложных тревог нет.
    tg.state.channel.returnBots = false;
    const old = await fresh();
    assert.equal(old.code, 0, old.out);
    assert.match(old.out, /✓ Канал «Дверь»: бот двери @door_bot пишет, Аи — администратор\./u);
    assert.doesNotMatch(old.out, /•/u, old.out);
    // …и даже если о ней не спросить (номер Аи неизвестен) — не пугает «лишним участником», а говорит как есть:
    // отсюда её не видно. Одна строка — и настройка идёт дальше.
    tg.keys([`OWNER_TG_ID=${OWNER}`, `DOOR_BOT_TOKEN=${DOOR_BOT}`]);
    const blind = await tg.run(["setup", DOOR], { DOOR_AI_ID: "" });
    assert.equal(blind.code, 0);
    assert.deepEqual(blind.out.split("\n").filter(line => line.startsWith("•")), ["• Есть ли Аи среди администраторов этого канала, отсюда не видно. Проверьте сами: без неё ответа не будет."], blind.out);
    assert.match(blind.out, /✓ Канал «Дверь»: бот двери @door_bot пишет\./u);
    // То же, когда о ней спросили, а Telegram ответил отказом: не видно — так и сказано.
    tg.state.channel.blind = true;
    const unseen = await fresh();
    assert.equal(unseen.code, 0, unseen.out); assert.match(unseen.out, /• Есть ли Аи среди администраторов этого канала, отсюда не видно/u);
    tg.state.channel.blind = false;
    tg.state.channel.returnBots = true;

    // Аи в канале нет: ждёт, пока добавят, — не дождалась, но настройку не бросает (вдруг её просто не видно).
    tg.state.channel.admins.delete(AI_ID);
    const alone = await fresh();
    assert.equal(alone.code, 0, alone.out);
    assert.match(alone.out, /• Аи в канале «Дверь» не администратор\. Добавьте её туда же .+ — жду…/u);
    assert.match(alone.out, /• Не вижу Аи среди администраторов этого канала\. Пробую всё равно/u);
    // Добавили, пока ждала, — идёт дальше без второго предупреждения.
    tg.keys([`OWNER_TG_ID=${OWNER}`, `DOOR_BOT_TOKEN=${DOOR_BOT}`]);
    const adding = tg.run(["setup", DOOR, "--wait=8", "--step=40"]);
    setTimeout(() => tg.state.channel.admins.set(AI_ID, { username: AI_NAME, post: true, erase: false }), 300);
    const added = await adding;
    assert.match(added.out, /жду…/u); assert.doesNotMatch(added.out, /Не вижу Аи/u);
    assert.match(added.out, /• У Аи нет права удалять сообщения: прочитанные запросы будут копиться/u);
    tg.state.channel.admins.set(AI_ID, { username: AI_NAME, post: true, erase: true });

    // В канале остался бот будильника: он получает все посты двери — назван по имени, раз Аи опознана.
    tg.state.channel.admins.set(idOf(VOICE_BOT), { username: "voice_bot", post: true, erase: true });
    const crowd = await fresh();
    assert.match(crowd.out, /• В канале ещё бот @voice_bot: он тоже получает все посты двери\. Уберите его из администраторов этого канала — только этого\./u);
    // Номер Аи не сошёлся (или неизвестен) — никого «убрать» не советует: назвать лишним можно было бы её саму.
    tg.keys([`OWNER_TG_ID=${OWNER}`, `DOOR_BOT_TOKEN=${DOOR_BOT}`]);
    const unsure = await tg.run(["setup", DOOR], { DOOR_AI_ID: "424242" });
    assert.doesNotMatch(unsure.out, /Уберите/u, unsure.out);
    assert.match(unsure.out, /• В канале, кроме бота двери, боты @ai_heart_bot, @voice_bot\. Нужна только Аи/u);
    tg.state.channel.admins.delete(idOf(VOICE_BOT));
    tg.keys([`OWNER_TG_ID=${OWNER}`, `DOOR_BOT_TOKEN=${DOOR_BOT}`]);
    const lone = await tg.run(["setup", DOOR], { DOOR_AI_ID: "424242" });
    assert.doesNotMatch(lone.out, /•/u, "один чужой бот в канале — это Аи, даже если номер не сошёлся");
    assert.match(lone.out, /Аи \(@ai_heart_bot\) — администратор/u);

    // Подписчики читают посты двери.
    tg.state.channel.plain = 2;
    assert.match((await fresh()).out, /• В канале участников: 5, а администраторов — 3\. Остальные читают посты двери/u);
    tg.state.channel.plain = 0;
    // Открытый канал читает кто угодно: ключ не пишется.
    tg.state.channel.username = "door_public";
    const open = await fresh();
    assert.equal(open.code, 1); assert.match(open.out, /Канал «Дверь» открытый \(@door_public\)/u);
    assert.doesNotMatch(tg.text(), /KEY_DOOR/u);
    tg.state.channel.username = "";
    // Боту двери нельзя писать.
    tg.state.channel.admins.set(idOf(DOOR_BOT), { username: "door_bot", post: false, erase: false });
    const mute = await fresh();
    assert.equal(mute.code, 1); assert.match(mute.out, /У бота двери @door_bot нет права публиковать в канале «Дверь»/u);
    assert.equal(tg.called("setWebhook") + tg.called("deleteWebhook"), 0);
  } finally { tg.close(); }
});

test("часы телефона спешат на пять минут: время запроса берётся по часам Telegram — дверь открыта", { skip }, async () => {
  const h = make();
  // У Telegram сейчас на пять минут меньше, чем на телефоне: по своим часам запрос вышел бы «просроченным».
  const tg = await telegramStub({ hearts: () => h, ahead: -300_000 });
  try {
    clock = Date.now() - 300_000;
    tg.keys(READY);
    const look = await tg.run(["look", "--wait=10", "--poll=1"]);
    assert.equal(look.code, 0, look.out);
    assert.match(look.out, /Часы телефона спешат на 5 мин — время запроса беру по часам Telegram\./u);
    assert.match(look.out, /✓ Дверь работает/u);
  } finally { tg.close(); }
});

test("ответа нет — улика в канале: запрос лежит на месте — «не прочла»; запроса нет — «прочла, ответ не дошёл»", { skip }, async () => {
  // Сердце опубликовано без ключа двери: пост для него — обычный пост канала.
  let h = make({ DOOR_KEY: "" });
  const tg = await telegramStub({ hearts: () => h });
  try {
    clock = Date.now();
    tg.keys(READY);
    const closed = await tg.run(["look", "--wait=3", "--poll=1"]);
    assert.equal(closed.code, 5, closed.out);
    assert.match(closed.out, /✗ За 3 с ответа нет\. Запрос так и лежал в канале \(убрала его\): Аи его не прочла — или дверь у неё закрыта\./u);
    assert.match(closed.out, /Скажите Аи «статус»\. Строки «Дверь приложения» нет — сердце опубликовано без ключа: bash scripts\/phone\.sh door/u);
    assert.deepEqual(tg.left(), [], "несостоявшийся запрос убран из канала");
    // Проба перед публикацией: та же улика одной строкой, без списка «что проверить».
    const brief = await tg.run(["look", "--wait=3", "--poll=1", "--try"]);
    assert.equal(brief.code, 5); assert.equal(brief.out.trim().split("\n").length, 1, brief.out);
    // Сердце ответило и убрало запрос, но до бота двери его посты не дошли.
    h = make();
    tg.state.deaf = true;
    const lost = await tg.run(["look", "--wait=3", "--poll=1"]);
    assert.equal(lost.code, 5, lost.out);
    assert.match(lost.out, /Запроса в канале уже нет — значит, Аи его прочла и убрала, но её ответ до бота двери не дошёл\./u);
    // Здесь «опубликуйте заново» не поможет: нужна улика — экран и строка статуса.
    assert.match(lost.out, /Скажите Аи «статус» и пришлите в чат разработки этот экран и её строку «Дверь приложения»/u);
    assert.doesNotMatch(lost.out, /опубликовано без ключа/u);
    // Под командой телефона сердце только что опубликовано с ключом — «опубликуйте» тоже не говорится.
    h = make({ DOOR_KEY: "" });
    tg.state.deaf = false;
    const led = await tg.run(["look", "--wait=3", "--poll=1"], { DOOR_FLOW: "1" });
    assert.equal(led.code, 5, led.out);
    assert.match(led.out, /Запрос так и лежал в канале[\s\S]+пришлите в чат разработки этот экран/u);
    assert.doesNotMatch(led.out, /опубликовано без ключа/u);
  } finally { tg.close(); }
});

// ── Опыт трёх путей (0.54.2) ──
// Вживую 22.11.2026 новый пост бота двери до двери не дошёл. Поддельный Telegram умеет и так (`botPosts: false`):
// правки и личные сообщения ботов доходят, новые посты ботов друг до друга — нет.
test("опыт трёх путей, как вживую 22.11.2026: новые посты ботов не доходят — личное сообщение и правка проходят в обе стороны; путь записан", { skip }, async () => {
  const h = make();
  const tg = await telegramStub({ hearts: () => h, botPosts: false });
  try {
    clock = Date.now();
    tg.keys([`OWNER_TG_ID=${OWNER}`, `DOOR_BOT_TOKEN=${DOOR_BOT}`, `KEY_DOOR=${LINE}`]);
    // Сердце включает у себя режим общения ботов по вопросу телефона — как в `phone.sh door`; телефон запоминает
    // номер последнего услышанного, чтобы после опыта спросить «что пришло за него».
    const before = Number(/ seq=(\d+) /u.exec(await h.doorState())[1]);
    const done = await tg.run(["ways", "--wait=3", "--poll=1"], { DOOR_WAY: "" });
    assert.equal(done.code, 0, done.out);
    const lines = done.out.trimEnd().split("\n");
    assert.equal(lines[0], "Опыт двери: три пути по очереди — запрос к Аи и её ответ.");
    assert.match(lines[1], /^ {2}✓ личное сообщение бота: ответ за \d+\.\d с$/u);
    assert.match(lines[2], /^ {2}✓ правка поста в канале: ответ за \d+\.\d с \(новый пост Аи до бота двери не дошёл — дошла его правка\)$/u);
    assert.equal(lines[3], "  ✗ новый пост в канале: за 3 с ответа нет — запрос так и лежал в канале (убрала его): Аи его не прочла");
    assert.equal(lines[4], `✓ Дверь работает: путь — личное сообщение бота. Записала в ${tg.file}: DOOR_WAY=direct.`);
    assert.match(lines[5], /^ {2}Комната: сборка \d+\.\d+\.\d+ · хозяин: да/u);
    assert.equal(lines.length, 6, done.out);
    assert.match(tg.text(), /^DOOR_WAY=direct$/mu);
    assert.ok(tg.text().includes(`KEY_DOOR=${LINE}`), "прежние строки целы");
    assert.deepEqual(tg.left(), [], "в канале после опыта пусто: заготовки, запросы и ответы убраны");
    assert.equal(tg.called("setMySettings"), 1, "режим общения ботов бот двери включил себе сам, один раз");
    assert.equal(tg.called("setWebhook") + tg.called("deleteWebhook"), 0);
    // Что слышало сердце за этот опыт: личное и правку — исполнило; нового поста не слышало вовсе.
    assert.deepEqual((await h.doorState({ after: before })).split(" | ").slice(1, 5), [
      "Что слышала Аи от бота двери за этот опыт:", "• личное сообщение бота — запрос, ответила", "• правка поста — запрос, ответила", "• новый пост — не слышала",
    ]);
    // Дальше «look» идёт записанным путём — одним запросом, без опыта.
    const sentSoFar = tg.called("sendMessage");
    const again = await tg.run(["look", "--wait=5", "--poll=1"], { DOOR_WAY: "" });
    assert.equal(again.code, 0, again.out);
    assert.match(again.out, /^✓ Дверь работает: сердце ответило за /u);
    assert.equal(tg.called("sendMessage"), sentSoFar + 1, "один запрос — лично");
    // И любым названным: правкой.
    const byEdit = await tg.run(["look", "--way=edit", "--wait=5", "--poll=1", "--flat"], { DOOR_WAY: "" });
    assert.equal(byEdit.code, 0, byEdit.out);
    assert.equal(JSON.parse(byEdit.out.split("\n")[1]).owner, true);
    // Действие без названного и без записанного пути — не гадает.
    tg.keys([`OWNER_TG_ID=${OWNER}`, `DOOR_BOT_TOKEN=${DOOR_BOT}`, `KEY_DOOR=${LINE}`]);
    const blind = await tg.run(["feed", '{"id":"abc123"}'], { DOOR_WAY: "" });
    assert.equal(blind.code, 1); assert.match(blind.out, /Каким путём\? Сначала опыт: node scripts\/door-client\.mjs ways/u);
    assert.match((await tg.run(["look", "--way=pigeon"], { DOOR_WAY: "" })).out, /Пути «pigeon» нет\. Есть: direct, edit, post\./u);
  } finally { tg.close(); }
});

test("опыт трёх путей, когда доходит всё: три галочки; «look» без пути — он же; в правке видно, что новый пост Аи тоже дошёл", { skip }, async () => {
  const h = make();
  const tg = await telegramStub({ hearts: () => h, talks: true });
  try {
    clock = Date.now();
    tg.keys([`OWNER_TG_ID=${OWNER}`, `DOOR_BOT_TOKEN=${DOOR_BOT}`, `KEY_DOOR=${LINE}`]);
    // Имя бота Аи называет телефон (`DOOR_AI_NAME`); номер её при этом может быть и неизвестен.
    const done = await tg.run(["look", "--wait=4", "--poll=1"], { DOOR_WAY: "", DOOR_AI_ID: "", DOOR_AI_NAME: AI_NAME });
    assert.equal(done.code, 0, done.out);
    assert.match(done.out, /✓ личное сообщение бота: ответ за [\d.]+ с\n {2}✓ правка поста в канале: ответ за [\d.]+ с \(новый пост Аи до бота двери тоже дошёл\)\n {2}✓ новый пост в канале: ответ за [\d.]+ с\n✓ Дверь работает: путь — личное сообщение бота\./u);
    assert.deepEqual(tg.left(), []);
  } finally { tg.close(); }
});

test("личное сообщение не уходит: режим общения ботов не включён у Аи или у бота двери — слова Telegram и где включить; остальные пути пробуются", { skip }, async () => {
  const h = make();
  // У Аи режим не включён (сердце о нём ещё не спрашивали); новые посты ботов не доходят.
  const tg = await telegramStub({ hearts: () => h, botPosts: false });
  try {
    clock = Date.now();
    tg.keys([`OWNER_TG_ID=${OWNER}`, `DOOR_BOT_TOKEN=${DOOR_BOT}`, `KEY_DOOR=${LINE}`]);
    const done = await tg.run(["ways", "--wait=3", "--poll=1"], { DOOR_WAY: "" });
    assert.equal(done.code, 0, done.out);
    assert.match(done.out, /✗ личное сообщение бота: запрос не ушёл — Forbidden: bot can't send messages to bots\n {2}Личное сообщение бота требует режима общения ботов у обоих: у бота двери он включён, у Аи его включает само сердце\. Не помогло — включите руками у обоих ботов \(у бота двери и у Аи\): @BotFather → \/mybots → бот → Bot Settings → Bot-to-Bot Communication Mode — и повторите команду\.\n/u);
    assert.match(done.out, /✓ правка поста в канале: ответ за /u);
    assert.match(done.out, /✓ Дверь работает: путь — правка поста в канале\./u);
    assert.match(tg.text(), /^DOOR_WAY=edit$/mu);
    // Сервер до Bot API 10.5: включить режим сам бот не может — сказано, что не вышло и где включить руками.
    tg.state.oldApi = true; tg.state.bots.get(DOOR_BOT).talks = false;
    const old = await tg.run(["look", "--way=direct", "--wait=3"], { DOOR_WAY: "" });
    assert.equal(old.code, 1, old.out);
    assert.match(old.out, /^Запрос не ушёл Аи лично: Forbidden: bot can't send messages to bots\.\n {2}Личное сообщение бота требует режима общения ботов у обоих: у бота двери включить не вышло \(Not Found: method not found\)/u);
    // Telegram принял личное сообщение молча (как он поступит без режима, вживую не видели), а включить режим бот
    // двери себе не смог: ответа нет — и та же строка говорит, у кого режим не включён.
    tg.state.swallow = true;
    const mute = await tg.run(["ways", "--wait=3", "--poll=1"], { DOOR_WAY: "" });
    assert.match(mute.out, /✗ личное сообщение бота: за 3 с ответа нет\n {2}Личное сообщение бота требует режима общения ботов у обоих: у бота двери включить не вышло \(Not Found: method not found\), у Аи его включает само сердце\. Не помогло — включите руками у обоих ботов/u);
    tg.state.swallow = false;
    // Ни один путь не прошёл: Аи в канале нет, личное не уходит — код «ответа нет», запросы за собой убраны.
    tg.state.channel.admins.delete(AI_ID);
    const none = await tg.run(["ways", "--wait=3", "--poll=1"], { DOOR_WAY: "" });
    assert.equal(none.code, 5, none.out);
    assert.match(none.out, /✗ Ни одним путём ответ не пришёл\.\n {2}Скажите Аи «статус» и пришлите в чат разработки этот экран и её строку «Дверь приложения»/u);
    assert.deepEqual(tg.left(), []);
    // Под `phone.sh door` подсказку говорит он сам — после того как спросит сердце, что оно слышало.
    assert.doesNotMatch((await tg.run(["ways", "--wait=3", "--poll=1"], { DOOR_WAY: "", DOOR_FLOW: "1" })).out, /Скажите Аи/u);
  } finally { tg.close(); }
});

// ── пакетная синхронизация (0.59.0): действие двери `sync` — очередь приложения, которое работает без сети ──
// Запрос владельца — `docs/SYNC-CONTRACT.md` в репозитории приложения; договор сердца — `docs/DOOR.md`, раздел 14.
const { DOOR_SYNC, DOOR_SYNC_DO, DOOR_SYNC_EVENTS, DOOR_SYNC_IN_MAX, DOOR_IN_MAX, DOOR_SYNC_KEEP, DOOR_SYNC_DEVICES, DOOR_SYNC_KEY, DOOR_SYNC_LATER, DOOR_SYNC_PENDING_MS } = await import("../tgcloud/lib/bridge.js");
const { ROOM_KEY, IDS_MAX } = await import("../tgcloud/lib/room.js");
const DEVICE = "k3m8p4r2t7v9x5z1";
const event = (seq, action, input = {}, id = `ev${String(seq).padStart(18, "0")}`) => ({ id, seq, at: clock - 1000, do: action, in: input });
const batch = (base, events, more = {}) => ({ v: 1, device: DEVICE, base, events, ...more });
/** Пачка через дверь: между пачками приложение ждёт не меньше шести секунд. */
const syncing = async (h, input, fields = {}) => { clock += 7000; const sent = await knock(h, { do: "sync", input, ...fields }); return { out: sent.out, ...(await opened(sent.request)) }; };
const kept = (id = OWNER) => JSON.parse(sdk().kv.get(ROOM_KEY(id)) ?? "null");
const ledger = (id = OWNER) => JSON.parse(sdk().kv.get(DOOR_SYNC_KEY(id)) ?? "null");
/** Каждый номер события — ровно в одном из трёх списков. */
const sorted = (result) => [...result.ack, ...result.rejected.map(item => item.id), ...result.retry].sort();
const CURSOR = /^c1\.[1-9]\d*\.[0-9a-f]{16}$/u;

test("sync: пачка применяется по порядку к нынешней комнате; точный повтор второй раз её не меняет — и на другой день; другое под тем же seq — seq_conflict", async () => {
  const h = make();
  const first = await syncing(h, batch(null, [event(1, "feed"), event(2, "tea")]));
  assert.deepEqual([first.out.code, first.out.do, first.out.answered], ["door_answer", "sync", true]);
  const one = first.result;
  assert.deepEqual(Object.keys(one), ["ok", "do", "build", "server_ts", "cursor", "ack", "rejected", "retry", "conflicts", "snapshot"], "поля ответа — как в договоре");
  assert.deepEqual([one.ok, one.do, one.server_ts], [true, "sync", clock]);
  assert.match(one.cursor, CURSOR);
  assert.deepEqual([one.ack, one.rejected, one.retry, one.conflicts], [[event(1, "feed").id, event(2, "tea").id], [], [], []]);
  // Снимок — полный ответ `look` после всех применений: комнату по нему можно нарисовать.
  assert.deepEqual([one.snapshot.ok, one.snapshot.do, one.snapshot.done.feed, one.snapshot.done.tea], [true, "look", 1, 1]);
  for (const field of ["her", "cat", "plant", "clock", "things", "sky", "done"]) assert.ok(field in one.snapshot, `в снимке есть «${field}»`);
  assert.deepEqual(kept().done, { feed: 1, tea: 1 });
  assert.deepEqual(kept().ids, one.ack.map(id => `+${id}`), "номер события — номер действия комнаты: запись помнит его без срока");

  // Ответ не дошёл — приложение шлёт ту же пачку: подтверждена, комната не тронута, курсор тот же.
  const again = (await syncing(h, batch(null, [event(1, "feed"), event(2, "tea")]))).result;
  assert.deepEqual([again.ok, again.ack, again.rejected, again.retry, again.cursor], [true, one.ack, [], [], one.cursor]);
  assert.deepEqual(kept().done, { feed: 1, tea: 1 }, "второй раз Байта не кормили");

  // Тот же seq с другим действием, другими полями или другим номером — постоянный отказ, без применения.
  const clash = (await syncing(h, batch(one.cursor, [event(1, "feed", { kind: "x" }), event(2, "water"), event(3, "water", {}, "zz000000000000000003"), event(4, "play")]))).result;
  assert.deepEqual(clash.rejected.map(item => [item.id, item.code, item.final]), [[event(1, "feed").id, "seq_conflict", true], [event(2, "tea").id, "seq_conflict", true]]);
  assert.deepEqual(clash.ack, ["zz000000000000000003", event(4, "play").id], "остальные события пачки применены");
  assert.deepEqual(kept().done, { feed: 1, tea: 1, water: 1, play: 1 });
  assert.deepEqual(sorted(clash), [event(1, "x").id, event(2, "x").id, event(4, "x").id, "zz000000000000000003"].sort());
  const other = (await syncing(h, batch(clash.cursor, [event(3, "water", {}, "yy000000000000000003")]))).result;
  assert.deepEqual(other.rejected.map(item => item.code), ["seq_conflict"], "тот же seq с другим номером события");
  // Тот же номер события под другим seq — тоже отказ: это не повтор.
  const moved = (await syncing(h, batch(other.cursor, [event(9, "play", {}, event(4, "play").id)]))).result;
  assert.deepEqual(moved.rejected.map(item => [item.code, item.final]), [["id_conflict", true]]);
  assert.equal(kept().done.play, 1);

  // Смена дня и перезапуск: память о событиях — в базе, без срока.
  clock += 86_400_000 + 3_600_000;
  const later = (await syncing(make(), batch(moved.cursor, [event(1, "feed"), event(2, "tea")]))).result;
  assert.deepEqual([later.ack, later.rejected, later.retry], [one.ack, [], []]);
  assert.equal(kept().day, "2026-11-22", "запись комнаты повтор не тронул");
  assert.deepEqual([later.snapshot.done.feed, later.snapshot.done.tea], [0, 0], "в новом дне Байта ещё не кормили — и повтор его не кормил");
  assert.equal(later.cursor, moved.cursor, "комната не менялась — курсор прежний");
});

test("sync: курсор меняется от любой перемены комнаты; устаревший — применить и пометить rebased; чужой и «из будущего» — bad_cursor со свежим снимком", async () => {
  const h = make();
  await room(h, { do: "look" });
  const one = (await syncing(h, batch(null, [event(1, "feed")]))).result;
  // Пустая пачка с нынешним курсором — сверка: тот же курсор и свежий снимок.
  const idle = (await syncing(h, batch(one.cursor, []))).result;
  assert.deepEqual([idle.ok, idle.cursor, idle.ack, idle.retry, idle.snapshot.ok], [true, one.cursor, [], [], true]);
  // Ещё один заход на страницу — не перемена: курсор тот же.
  await room(h, { do: "look" });
  assert.equal((await syncing(h, batch(one.cursor, []))).result.cursor, one.cursor);
  // Комнату изменили другим входом — страницей: прежний курсор устарел. Пачка не отвергается: применена поверх.
  assert.equal((await room(h, { do: "tea", id: "page000001" })).ok, true);
  const rebased = (await syncing(h, batch(one.cursor, [event(2, "water"), event(3, "pick", { key: "нет-такой", pick: 0 })]))).result;
  assert.equal(rebased.ok, true);
  assert.deepEqual(rebased.ack, [event(2, "water").id]);
  assert.deepEqual(rebased.conflicts.map(item => [item.id, item.code]), [[event(2, "water").id, "rebased"]], "помечено только применённое");
  assert.ok(rebased.conflicts[0].text.length > 10);
  assert.notEqual(rebased.cursor, one.cursor);
  assert.deepEqual([rebased.snapshot.done.tea, rebased.snapshot.done.water], [1, 1], "в снимке — и чужая перемена, и своя");
  // Одиночное действие двери — такая же перемена.
  clock += 7000;
  await knock(h, { do: "play", input: { id: "door000001" } });
  const stale = (await syncing(h, batch(rebased.cursor, [event(4, "pet")]))).result;
  assert.deepEqual(stale.conflicts.map(item => item.code), ["rebased"]);
  // С нынешним курсором — без пометок.
  const fresh = (await syncing(h, batch(stale.cursor, [event(5, "lamp")]))).result;
  assert.deepEqual([fresh.ack.length, fresh.conflicts], [1, []]);

  // Курсор не её: испорчен, с чужой печатью, не того вида. Ничего не применяется; это обычный ответ, не пометка двери.
  const before = JSON.stringify(kept());
  clock += 61_000;
  for (const bad of ["мусор", "c1.2.0123456789abcdef", `${fresh.cursor}0`, fresh.cursor.replace(/^c1\.(\d+)/u, (_, n) => `c1.${Number(n) + 1}`), ""]) {
    const refused = await syncing(h, batch(bad, [event(6, "pat"), event(7, "book")]));
    assert.equal(refused.out.code, "door_answer", bad);
    assert.deepEqual([refused.result.ok, refused.result.do, refused.result.code], [false, "sync", "bad_cursor"], bad);
    assert.deepEqual([refused.result.ack, refused.result.rejected, refused.result.retry, refused.result.conflicts], [[], [], [event(6, "pat").id, event(7, "book").id], []], bad);
    assert.equal(refused.result.cursor, fresh.cursor, "свежий курсор — в том же ответе");
    assert.deepEqual([refused.result.snapshot.ok, refused.result.snapshot.do], [true, "look"]);
  }
  assert.equal(JSON.stringify(kept()), before, "комната не тронута");
  assert.equal(ledger().devices[DEVICE].seen[6], undefined, "и события не запомнены: их пришлют снова");
  // «Из будущего»: печать верная, а номер больше нынешнего — сердце потеряло счёт (память чистили).
  sdk().kv.delete(DOOR_SYNC_KEY(OWNER));
  clock += 61_000;
  const future = (await syncing(h, batch(fresh.cursor, [event(6, "pat")]))).result;
  assert.deepEqual([future.ok, future.code, future.retry], [false, "bad_cursor", [event(6, "pat").id]]);
  assert.match(future.cursor, CURSOR);
  const healed = (await syncing(h, batch(future.cursor, [event(6, "pat")]))).result;
  assert.deepEqual([healed.ok, healed.ack, healed.conflicts], [true, [event(6, "pat").id], []], "со свежим курсором пачка проходит");
});

test("sync: что не так с пачкой целиком — отказ bad_sync; что не так с событием — постоянный отказ ему одному; пределы — 12 событий и 3000 знаков", async () => {
  const h = make();
  const whole = [
    batch(null, [], { v: 2 }), { ...batch(null, []), device: "short" }, { ...batch(null, []), device: "К".repeat(16) }, batch(7, []), batch("c".repeat(65), []),
    { v: 1, device: DEVICE, base: null }, batch(null, "нет"), batch(null, Array.from({ length: DOOR_SYNC_EVENTS + 1 }, (_, index) => event(100 + index, "pet"))),
    batch(null, [event(1, "pet", {}, "short")]), batch(null, [event(1, "pet", {}, "EV000000000000000001")]), batch(null, [event(1, "pet"), event(2, "pet", {}, event(1, "pet").id)]),
    batch(null, [event(2, "pet"), event(1, "feed")]), batch(null, [event(2, "pet"), event(2, "feed", {}, "zz000000000000000002")]), batch(null, [{ ...event(1, "pet"), seq: 0 }]), batch(null, [{ ...event(1, "pet"), seq: 1.5 }]), batch(null, ["событие"]),
  ];
  for (const input of whole) {
    clock += 61_000 / 4;
    const refused = (await syncing(h, input)).result;
    assert.deepEqual([refused.ok, refused.do, refused.code], [false, "sync", "bad_sync"], JSON.stringify(input).slice(0, 90));
    assert.ok(refused.text.length > 5);
  }
  assert.equal(ledger(), null, "от таких пачек в памяти ничего не остаётся");
  assert.equal(kept(), null);

  // Событие с верным номером, но негодное: отказ ему одному, остальные идут. Отказ запомнен: повтор получит его же.
  clock += 61_000;
  const input = batch(null, [
    event(1, "look"), event(2, "album"), event(3, "say", { text: "привет" }), event(4, "fly"), event(5, "feed", [1, 2]), { ...event(6, "feed"), at: "вчера" }, { id: event(7, "feed").id, seq: 7, do: "feed", in: {} },
    event(8, "pick", { key: "нет-такой", pick: 0 }), event(9, "gift", { kind: "слон" }), { id: event(10, "water").id, seq: 10, at: clock, do: "water" }, event(11, "feed"),
  ]);
  const mixed = (await syncing(h, input)).result;
  assert.equal(mixed.ok, true);
  assert.deepEqual(mixed.rejected.map(item => [item.id.slice(-2), item.code, item.final]), [["01", "bad_do", true], ["02", "bad_do", true], ["03", "bad_do", true], ["04", "bad_do", true], ["05", "bad_in", true], ["06", "bad_at", true], ["07", "bad_at", true], ["08", "unknown", true], ["09", "unknown", true]]);
  assert.ok(mixed.rejected.every(item => typeof item.text === "string" && item.text.length > 5), "у каждого отказа — слова");
  assert.deepEqual(mixed.ack, [event(10, "water").id, event(11, "feed").id], "поле in можно не слать: это {}");
  assert.deepEqual(sorted(mixed), input.events.map(item => item.id).sort());
  assert.deepEqual(kept().done, { water: 1, feed: 1 });
  const repeat = (await syncing(h, batch(mixed.cursor, input.events))).result;
  assert.deepEqual([repeat.rejected.map(item => item.code), repeat.ack, repeat.cursor], [mixed.rejected.map(item => item.code), mixed.ack, mixed.cursor]);
  assert.deepEqual(kept().done, { water: 1, feed: 1 });

  // Предел поля `in`: у пачки — 3000 знаков, у одиночного действия — прежние 1024. Больше — пометка двери, как и была.
  assert.deepEqual([DOOR_IN_MAX, DOOR_SYNC_IN_MAX, DOOR_SYNC_EVENTS], [1024, 3000, 12]);
  clock += 61_000;
  const wide = batch(mixed.cursor, [event(12, "pet")], { pad: "" });
  wide.pad = "x".repeat(DOOR_SYNC_IN_MAX - JSON.stringify(wide).length);
  assert.equal(JSON.stringify(wide).length, 3000);
  assert.deepEqual((await syncing(h, wide)).result.ack, [event(12, "pet").id], "ровно 3000 — проходит; лишние поля пачки не мешают");
  const over = await syncing(h, { ...wide, pad: `${wide.pad}x` });
  assert.deepEqual([over.out.code, over.ok, over.code], ["door_bad_envelope", false, "bad_envelope"]);
  clock += 7000;
  const single = await knock(h, { do: "feed", input: { pad: "x".repeat(DOOR_IN_MAX) } });
  assert.equal(single.out.code, "door_bad_envelope", "одиночным действиям предел не подняли");
  // Двенадцать событий — в одной пачке, одним ответом: предел частоты страницы к очереди не относится.
  clock += 61_000;
  const full = (await syncing(h, batch(null, Array.from({ length: DOOR_SYNC_EVENTS }, (_, index) => event(20 + index, index % 2 ? "lamp" : "music"))))).result;
  assert.deepEqual([full.ack.length, full.rejected, full.retry], [DOOR_SYNC_EVENTS, [], []]);
  const more = (await syncing(h, batch(full.cursor, Array.from({ length: DOOR_SYNC_EVENTS }, (_, index) => event(40 + index, index % 2 ? "lamp" : "music"))))).result;
  assert.deepEqual([more.ack.length, more.retry], [DOOR_SYNC_EVENTS, []], "и следующая пачка через семь секунд — тоже");
  // Частота самих пачек — как у одиночных действий: десять запросов человека в минуту. У отказа — `wait`, секунды:
  // `retry` у пачки — список событий.
  clock = Math.ceil(clock / 60_000) * 60_000 + 61_000;
  let slow = null;
  for (let index = 0; index <= DOOR_PER_PERSON; index += 1) { const sent = await knock(h, { do: "sync", input: batch(null, []) }); slow = (await opened(sent.request)).result; }
  assert.deepEqual([slow.ok, slow.do, slow.code, slow.retry], [false, "sync", "slow", undefined]);
  assert.ok(Number.isInteger(slow.wait) && slow.wait > 0 && slow.wait <= 60);
});

test("sync: кого и что пускает дверь; список действий очереди — всё, что меняет комнату; память о событиях ограничена числом, а не сроком", async () => {
  // Действие двери, а не комнаты: в списке действий комнаты его нет, страница его не знает.
  assert.equal(DOOR_SYNC, "sync");
  assert.ok(!DOOR_ALLOW.includes(DOOR_SYNC) && !DOOR_NOT_ALLOWED.includes(DOOR_SYNC));
  assert.deepEqual([...DOOR_SYNC_DO].sort(), DOOR_ALLOW.filter(name => name !== "look" && name !== "album").sort(), "в очередь идёт всё разрешённое, кроме чтения");
  assert.deepEqual([...DOOR_SYNC_LATER].sort(), ["off", "runtime_error", "slow", "storage"]);
  const h = make();
  assert.equal((await room(h, { do: "sync", v: 1, device: DEVICE, base: null, events: [] })).code, "unknown", "со страницы пачку не принять");
  // Чужому — как и одиночные действия: дверь открыта только хозяину.
  const guest = (await syncing(h, batch(null, [event(1, "feed")]), { uid: GUEST })).result;
  assert.deepEqual([guest.ok, guest.do, guest.code], [false, "sync", "door_closed"]);
  assert.equal(kept(GUEST), null);
  // Список действий сузили настройкой: пачки идут, только если в нём названо `sync`; событие вне списка — отказ ему.
  const narrow = (await syncing(make({ DOOR_ALLOW: ["look", "feed"] }), batch(null, [event(1, "feed")]))).result;
  assert.deepEqual([narrow.ok, narrow.do, narrow.code], [false, "sync", "forbidden"]);
  const some = (await syncing(make({ DOOR_ALLOW: ["look", "feed", "sync"] }), batch(null, [event(1, "feed"), event(2, "tea")]))).result;
  assert.deepEqual([some.ack, some.rejected.map(item => [item.code, item.final])], [[event(1, "feed").id], [["forbidden", true]]]);
  // У гостя, которого пустили, — своя запись: события хозяина ему не подтверждаются.
  const open = make({ DOOR_GUESTS: true });
  clock += 61_000;
  const visitor = (await syncing(open, batch(null, [event(1, "feed")]), { uid: GUEST })).result;
  assert.deepEqual([visitor.ok, visitor.ack.length], [true, 1]);
  assert.equal(kept(GUEST).done.feed, 1);
  assert.notEqual(visitor.cursor, some.cursor);

  // Память: последние DOOR_SYNC_KEEP событий установки; вытесненное — «ниже пола»: seq_old, без применения.
  reset(); clock = T;
  const long = make();
  let cursor = null, seq = 0;
  for (let round = 0; round < 6; round += 1) {
    clock += 61_000;
    const done = (await syncing(long, batch(cursor, Array.from({ length: DOOR_SYNC_EVENTS }, () => { seq += 1; return event(seq, seq % 2 ? "lamp" : "music"); })))).result;
    assert.deepEqual([done.ack.length, done.retry.length, done.rejected.length], [DOOR_SYNC_EVENTS, 0, 0]);
    cursor = done.cursor;
  }
  const mine = ledger().devices[DEVICE];
  assert.deepEqual([Object.keys(mine.seen).length, mine.floor], [DOOR_SYNC_KEEP, 72 - DOOR_SYNC_KEEP]);
  assert.ok(kept().ids.length <= IDS_MAX);
  clock += 61_000;
  const old = (await syncing(long, batch(cursor, [event(1, "lamp"), event(60, "music"), event(72, "music")]))).result;
  assert.deepEqual(old.rejected.map(item => [item.id, item.code, item.final]), [[event(1, "lamp").id, "seq_old", true]]);
  assert.deepEqual(old.ack, [event(60, "music").id, event(72, "music").id], "что в памяти — подтверждается");
  assert.equal(old.cursor, cursor, "ничего не применено");
  // Установок у человека — не больше DOOR_SYNC_DEVICES: дольше всех молчавшая забывается.
  for (let index = 0; index < DOOR_SYNC_DEVICES + 1; index += 1) {
    clock += 61_000;
    await syncing(long, { ...batch(null, [event(1, "lamp", {}, `dv${String(index).padStart(18, "0")}`)]), device: `device${String(index).padStart(10, "0")}` });
  }
  assert.equal(Object.keys(ledger().devices).length, DOOR_SYNC_DEVICES);
  assert.ok(!(DEVICE in ledger().devices), "первой забыта та, что молчала дольше всех");
});

test("sync: память отказала посреди пачки — применённое подтверждено, остальное ждёт; повтор той же пачки безопасен", async () => {
  const h = make();
  const one = (await syncing(h, batch(null, [event(1, "lamp")]))).result;
  // После первой записи комнаты её чтение начинает падать: первое событие пачки легло, второе и третье — уже нет.
  const realGet = sdkDb.get, realRun = sdkDb.run;
  let armed = false, broken = false;
  sdkDb.run = async (query, params = {}) => { const out = await realRun(query, params); if (armed && params[":key"] === ROOM_KEY(OWNER) && query.includes("kv_state")) broken = true; return out; };
  sdkDb.get = async (query, params = {}) => { if (broken && params[":key"] === ROOM_KEY(OWNER)) throw new Error("база не ответила"); return realGet(query, params); };
  let half = null;
  const events = [event(2, "feed"), event(3, "tea"), event(4, "water")];
  try {
    clock += 7000;
    const request = await sealRequest({ secret: SECRET, uid: OWNER, ts: clock, do: "sync", input: batch(one.cursor, events) });
    armed = true;
    await h.onMessage(post(doorWire(request)), KEY);
    half = (await opened(request)).result;
  } finally { sdkDb.get = realGet; sdkDb.run = realRun; }
  assert.equal(half.ok, true);
  assert.deepEqual([half.ack, half.rejected, half.retry], [[events[0].id], [], [events[1].id, events[2].id]], "временный отказ — не постоянный: события остаются в очереди");
  assert.deepEqual([half.snapshot.ok, half.snapshot.code], [false, "storage"], "снимка нет — так и сказано");
  assert.match(half.cursor, CURSOR);
  assert.deepEqual(sorted(half), events.map(item => item.id).sort());
  assert.equal(kept().done.feed, 1);
  // Повтор той же пачки, когда память вернулась: первое — подтверждено и не применяется второй раз, остальные — применены.
  const whole = (await syncing(h, batch(one.cursor, events))).result;
  assert.deepEqual([whole.ok, whole.ack, whole.retry, whole.rejected], [true, events.map(item => item.id), [], []]);
  assert.deepEqual(kept().done, { feed: 1, tea: 1, water: 1 });
  assert.equal(whole.snapshot.ok, true);
  assert.deepEqual(whole.conflicts.map(item => [item.id, item.code]), [[events[1].id, "rebased"], [events[2].id, "rebased"]], "курсор пачки устарел: первое событие комнату уже изменило");

  // Запуск оборвался между применением и записью исхода: событие числится «в работе». Пока полминуты не прошло —
  // «подождать»; потом оно применяется заново — и комната второй раз его не принимает: помнит номер.
  clock += 61_000;
  const lost = event(5, "play");
  assert.equal((await h.onRoom({ do: "play", id: lost.id }, { initData: { user: { id: OWNER } }, door: true, sync: true })).ok, true, "комната событие применила");
  const digest = (await hmac(SECRET, "AI-DOOR1\nevent\nplay\n{}")).slice(0, 16);
  const pending = (stamp) => sdk().kv.set(DOOR_SYNC_KEY(OWNER), JSON.stringify({ ...ledger(), devices: { [DEVICE]: { ...ledger().devices[DEVICE], seen: { ...ledger().devices[DEVICE].seen, 5: [lost.id, digest, "p", stamp, "чужой"] } } } }));
  pending(clock + 7000);
  const busy = (await syncing(h, batch(null, [lost, event(6, "pet")]))).result;
  assert.deepEqual([busy.ack, busy.rejected, busy.retry], [[], [], [lost.id, event(6, "pet").id]], "событие у другого запуска — ждём; что после него — тоже: порядок важнее");
  assert.equal(kept().done.pet, undefined);
  assert.equal(ledger().devices[DEVICE].seen[6], undefined, "заявка на то, что не применялось, снята");
  clock += DOOR_SYNC_PENDING_MS;
  const healed = (await syncing(h, batch(null, [lost, event(6, "pet")]))).result;
  assert.deepEqual([healed.ack, healed.rejected, healed.retry], [[lost.id, event(6, "pet").id], [], []]);
  assert.deepEqual([kept().done.play, kept().done.pet], [1, 1], "с Байтом сыграли один раз, а не два");
  assert.deepEqual(ledger().devices[DEVICE].seen[5].slice(0, 3), [lost.id, digest, "a"]);
});

test("sync: договор в docs/DOOR.md (раздел 14) сходится с кодом — список действий, коды, пределы, проверочный курсор", () => {
  const doc = read("docs/DOOR.md"), part = doc.slice(doc.indexOf("\n## 14. "));
  assert.ok(doc.includes("\n## 14. ") && part.length > 4000);
  for (const name of DOOR_SYNC_DO) assert.ok(part.includes(`\`${name}\``), name);
  for (const code of ["bad_sync", "bad_cursor", "seq_conflict", "id_conflict", "seq_old", "bad_do", "bad_in", "bad_at", "forbidden", "rebased", "too_big", "door_closed", "bad_input", ...DOOR_SYNC_LATER]) assert.ok(part.includes(`\`${code}\``), code);
  for (const number of [DOOR_SYNC_IN_MAX, DOOR_IN_MAX, DOOR_SYNC_EVENTS, DOOR_SYNC_KEEP, DOOR_SYNC_DEVICES, IDS_MAX, DOOR_SYNC_PENDING_MS / 1000, DOOR_PER_PERSON, DOOR_PER_MINUTE]) assert.match(part, new RegExp(`(^|\\D)${number}(\\D|$)`, "u"), String(number));
  // Курсор из примера — тот, что выдаст сердце с ключом и человеком стенда на второй перемене.
  assert.ok(part.includes(`Ключ двери \`${SECRET}\`, \`uid\` ${OWNER}`));
  const vector = `c1.2.${createHmac("sha256", SECRET).update(`AI-DOOR1\ncursor\n${OWNER}\n2`).digest("hex").slice(0, 16)}`;
  assert.ok(part.includes(vector), vector);
  // Примеры раздела — настоящий JSON с полями договора.
  const samples = [...part.matchAll(/```json\n([\s\S]*?)\n```/gu)].map(found => JSON.parse(found[1]));
  assert.ok(samples.length >= 5);
  const answers = samples.filter(item => item.do === "sync");
  assert.ok(answers.length >= 3 && answers.every(item => ["ok", "do", "build", "server_ts", "cursor", "ack", "rejected", "retry", "conflicts", "snapshot"].every(field => field in item)));
  assert.ok(answers.some(item => item.conflicts.some(entry => entry.code === "rebased")), "есть пример с устаревшим курсором");
  assert.ok(answers.some(item => item.ok === false && item.code === "bad_cursor" && item.retry.length === 1));
  assert.ok(answers.every(item => item.build === BUILD_NOW), "сборка в примерах — нынешняя");
});
