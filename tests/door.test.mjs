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
import { telegramStub as telegramFixture, AI_ID, AI_NAME, DOOR_BOT, VOICE_BOT, NEW_BOT, idOf } from "./fixtures/telegram.mjs";

const { doorKey, doorPayload, doorWire, doorRead, doorParts, hmac, DOOR_ALLOW, DOOR_NOT_ALLOWED, DOOR_POST_MAX, DOOR_PER_MINUTE, DOOR_PER_PERSON, DOOR_NOTES, DOOR_PREFIX, DOOR_STATE_KEY } = await import("../tgcloud/lib/bridge.js");
const { sealRequest, openAnswer } = await import("../scripts/door-client.mjs");

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

test("в канале двери не запрос — молчит и будильник не заводит: слово человека, правка поста, чужой ответ", async () => {
  const h = make();
  assert.deepEqual(await h.onMessage(post("проверка связи"), KEY), { ok: true, code: "door_ignored" });
  const request = await sealRequest({ secret: SECRET, uid: OWNER, ts: clock });
  assert.deepEqual(await h.onMessage(post(doorWire(request), { extra: { edit_date: Math.floor(clock / 1000) } }), KEY), { ok: true, code: "door_ignored" });
  const answer = { v: 1, t: "a", re: "abcdefgh", n: 1, of: 1, ts: clock, body: "{}" };
  assert.deepEqual(await h.onMessage(post(doorWire({ ...answer, sig: await hmac(SECRET, doorPayload(answer)) })), KEY), { ok: true, code: "door_ignored" });
  assert.equal(posts().length, 0);
  assert.equal(sdk().kv.has(DOOR_STATE_KEY), false, "и в базу ничего не пишет");
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
  assert.match(await status(h), /Дверь приложения: открыта только вам · за сутки запросов: 0\n/u);
  await knock(h, { do: "look" });
  await knock(h, { do: "oops" });
  assert.match(await status(h), /Дверь приложения: открыта только вам · за сутки запросов: 2, отказов: 1 \(последний — forbidden\)\n/u);
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
const telegramStub = (options = {}) => telegramFixture({ door: DOOR, nextId: () => (mid += 1), ...options });
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
