/**
 * Дверь приложения (0.54.0, `docs/DOOR.md`): второй вход в ту же комнату — подписанным постом в закрытый канал.
 * Сторона сердца — `tgcloud/lib/bridge.js` (`createDoor`), сторона посредника — `scripts/door-client.mjs`.
 * Здесь они проверяются друг о друга, а числа из договора — о `node:crypto`, чтобы документ не разошёлся с кодом.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { heart, sdk, reset, KEY, OWNER, toChat, toOwner, calls } from "./fixtures/kit.mjs";

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
  assert.deepEqual(got.result, direct);
  for (const text of posts()) { assert.ok(text.length <= DOOR_POST_MAX); assert.match(text, /^[\x20-\x7e\u0400-\u04ff«»—–…№]+$/u); }
  // Части в любом порядке и вперемешку с чужими постами — тот же ответ; без одной части ответа нет.
  const mixed = ["слово", ...[...posts()].reverse(), doorWire({ v: 1, t: "a", re: request.id, n: 1, of: 1, ts: 1, body: "{\"ok\":true}", sig: "0".repeat(64) })];
  assert.deepEqual((await openAnswer({ secret: SECRET, id: request.id, texts: mixed })).result, direct, "часть с чужой подписью не подменяет настоящую");
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

test("опыт с телефона: scripts/door-client.mjs шлёт запрос через Telegram ботом двери и получает ответ сердца", async () => {
  let h = make();
  const TOKEN = "777:door-bot-token";
  const updates = [];
  let serial = 0, served = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      const reply = (result, ok = true) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(ok ? { ok: true, result } : { ok: false, error_code: 400, description: result })); };
      const [, token, method] = /^\/bot([^/]+)\/(\w+)$/u.exec(req.url) ?? [];
      if (token !== TOKEN) return reply("Unauthorized", false);
      const params = body ? JSON.parse(body) : {};
      if (method === "getUpdates") {
        const from = Number(params.offset) || 0;
        return reply(from < 0 ? updates.slice(from) : updates.filter(item => item.update_id >= from));
      }
      if (method === "sendMessage") {
        if (String(params.chat_id) !== DOOR) return reply("Bad Request: chat not found", false);
        const sent = post(params.text);
        reply(sent);
        // Пост бота двери Telegram отдаёт сердцу; посты сердца — боту двери.
        await h.onMessage(sent, KEY);
        for (const item of toChat(DOOR).slice(served)) updates.push({ update_id: (serial += 1), channel_post: post(item.text) });
        served = toChat(DOOR).length;
        return undefined;
      }
      if (method === "getChatAdministrators") return reply([{ user: { id: 1, is_bot: false, first_name: "Хозяин" } }, { user: { id: 999, is_bot: true, username: "ai_heart_bot" } }, { user: { id: 777, is_bot: true, username: "door_bot" } }]);
      if (method === "getChatMemberCount") return reply(4);
      return reply("Not Found", false);
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const env = { PATH: process.env.PATH, HEART_ENV: "/nonexistent/.heart.env", DOOR_API: `http://127.0.0.1:${server.address().port}`, KEY_DOOR: LINE, DOOR_BOT_TOKEN: TOKEN, OWNER_TG_ID: String(OWNER) };
  const run = (args, extra = {}, input = null) => new Promise((resolve) => {
    const child = execFile(process.execPath, ["scripts/door-client.mjs", ...args], { cwd: new URL("..", import.meta.url), env: { ...env, ...extra }, timeout: 30_000 }, (error, stdout) => resolve({ code: error ? error.code ?? 1 : 0, out: String(stdout) }));
    if (input != null) child.stdin.end(input);
  });
  try {
    // Часы сердца в тесте стоят; пост бота двери получает время «сейчас» по этим же часам, а запрос — настоящее.
    clock = Date.now();
    updates.push({ update_id: (serial += 1), channel_post: post("слово в канале") });
    const where = await run(["where"]);
    assert.equal(where.code, 0); assert.match(where.out, /канал «Дверь»: -100900900/u);
    const look = await run(["look", "--wait=10", "--poll=0", "--flat"]);
    assert.equal(look.code, 0, look.out);
    assert.match(look.out, /Сердце ответило за \d+\.\d с, постов: 1\./u);
    const result = JSON.parse(look.out.split("\n")[1]);
    assert.equal(result.ok, true); assert.equal(result.owner, true); assert.equal(result.first, true);
    const guest = await run(["look", "--uid=5", "--wait=10", "--poll=0", "--flat"]);
    assert.equal(guest.code, 2, "отказ комнаты или двери — код 2");
    assert.equal(JSON.parse(guest.out.split("\n")[1]).code, "door_closed");
    const wrong = await run(["look", "--wait=10", "--poll=0"], { KEY_DOOR: `${DOOR}:${SECRET}-другой`.replace(/[^\x21-\x7e]/gu, "z") });
    assert.equal(wrong.code, 1); assert.match(wrong.out, /Дверь не пустила: bad_signature; подпись пометки не сошлась/u);
    // Без сети: запечатать и проверить.
    const sealed = await run(["seal", "feed", '{"id":"abc123"}']);
    const envelope = doorRead(sealed.out.trim());
    assert.equal(envelope.do, "feed"); assert.equal(envelope.uid, OWNER); assert.equal(envelope.sig, createHmac("sha256", SECRET).update(doorPayload(envelope)).digest("hex"));
    const checked = await run(["open"], {}, `${posts()[0]}\n`);
    assert.equal(checked.code, 0); assert.equal(JSON.parse(checked.out).result.owner, true);
    const key = await run(["key", DOOR]);
    assert.ok(doorKey(key.out.trim().replace(/^KEY_DOOR=/u, "")), "готовая строка для файла ключей");
    assert.match((await run(["look"], { KEY_DOOR: "", DOOR_BOT_TOKEN: TOKEN })).out, /Нет строки KEY_DOOR/u);
    assert.match((await run(["look"], { DOOR_BOT_TOKEN: "", ALARM_BOT_TOKEN: "" })).out, /Нет токена бота двери/u);

    // Настройка одной командой: канал найден по имени, секрет придуман, строка дописана в файл ключей — и с ней пускает.
    const dir = mkdtempSync(join(tmpdir(), "door-env-"));
    try {
      const file = join(dir, ".heart.env");
      writeFileSync(file, `OWNER_TG_ID=${OWNER}\nALARM_BOT_TOKEN=${TOKEN}`);
      const bare = { HEART_ENV: file, KEY_DOOR: "", DOOR_BOT_TOKEN: "", OWNER_TG_ID: "" };
      const setup = await run(["setup"], bare);
      assert.equal(setup.code, 0, setup.out);
      assert.match(setup.out, /Канал «Дверь»: -100900900\. Боты-администраторы: @ai_heart_bot, @door_bot\./u);
      assert.match(setup.out, /участников: 4, администраторов: 3\. Подписчики читают посты двери/u);
      assert.match(setup.out, /Готово: строка KEY_DOOR дописана/u);
      const text = readFileSync(file, "utf8");
      const written = text.match(/^KEY_DOOR=(.+)$/mu)?.[1];
      assert.ok(doorKey(written)); assert.equal(doorKey(written).channel, DOOR);
      assert.ok(text.startsWith(`OWNER_TG_ID=${OWNER}\nALARM_BOT_TOKEN=${TOKEN}\n# Дверь`), "прежние строки целы, новая — с новой строки");
      assert.ok(text.endsWith("\n"));
      assert.ok(!setup.out.includes(doorKey(written).secret), "секрет на экран не печатается");
      assert.equal(toChat(DOOR).length, served, "слово-проверку бота двери сердце оставило без ответа");
      const twice = await run(["setup"], bare);
      assert.equal(twice.code, 0); assert.match(twice.out, /Строка KEY_DOOR уже есть/u);
      assert.equal(readFileSync(file, "utf8"), text, "второй раз файл не меняется");
      assert.match((await run(["setup", "-100555666777"], bare)).out, /молча менять ключ не буду/u);
      h = make({ DOOR_KEY: written });
      const through = await run(["look", "--wait=10", "--poll=0", "--flat"], bare);
      assert.equal(through.code, 0, through.out);
      assert.equal(JSON.parse(through.out.split("\n")[1]).owner, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  } finally { server.close(); }
});
