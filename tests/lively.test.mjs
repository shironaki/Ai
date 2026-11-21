/**
 * Живая комната (0.49.0, сообщение 48): жесты по занятию и настроению, события её дня, альбом воспоминаний, её вещи и
 * подарки, снимок на память, встреча-сценка после отлучки, Байт при ней, письмо первой и «не пиши».
 *
 * Сердце — настоящее, время — заданное: события считаются из даты, поэтому дни здесь названы прямо (ноябрь 2026:
 * 14-го — перерыв, 15-го — книга в 9:51 по Москве, 19-го вечером Байт несёт добычу, 21-го — книга в 10:06,
 * 25-го — шалость в 13:43). Сдвинется расчёт (`eventFor`, `catGift`, `dayPlan`) — первый тест назовёт новые дни.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { heart, message, reset, last, sdk, toChat, OWNER, KEY } from "./fixtures/kit.mjs";

const room = await import("../tgcloud/lib/room.js");
const keep = await import("../tgcloud/lib/keepsake.js");
const logic = await import("../miniapp/logic.js");
const scene = await import("../miniapp/scene.js");
const albumPage = await import("../miniapp/album.js");
const { createPhrasebook } = await import("../tgcloud/lib/phrasebook.js");

const ROOT = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const ON = { PHRASES: true };
const from = (id) => ({ ...KEY, initData: { user: { id, first_name: "Тест" } } });
const at = (iso) => Date.parse(iso);
const clock = (iso) => { let now = at(iso); return { now: () => now, set: (next) => { now = at(next); }, add: (ms) => { now += ms; } }; };
const book = createPhrasebook({ random: () => 0 });
const pool = (name) => book.all(`+комната:${name}`, { formal: true, isPrivate: true, vars: { "когда": "вчера", "дней": "3 дня" } });
const albumOf = (id) => JSON.parse(sdk().kv.get(keep.KEEPSAKE_KEY(id)) ?? "null");
const roomOf = (id) => JSON.parse(sdk().kv.get(room.ROOM_KEY(id)) ?? "null");
const hhmm = (minute) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

test("события её дня: не больше одного в день, не каждый день, один вид — не чаще раза в шесть дней, внутри своего эпизода", () => {
  const first = keep.dayNumber("2026-01-01"), seen = {}, kinds = new Set();
  let total = 0;
  for (let back = 0; back < 365; back += 1) {
    const day = keep.dayOf(first + back), event = keep.eventFor(day);
    assert.deepEqual(keep.eventFor(day), event, "то же при повторном вопросе");
    if (!event) continue;
    total += 1;
    kinds.add(event.key);
    if (seen[event.key] !== undefined) assert.ok(back - seen[event.key] >= keep.EVENTS.length, `${day}: «${event.key}» было ${back - seen[event.key]} дней назад`);
    seen[event.key] = back;
    const stage = room.dayPlan(day).find(item => item.name === event.stage);
    assert.ok(event.from >= stage.from && event.to <= stage.to && event.to - event.from === keep.EVENT_MIN, `${day}: ${event.key} ${hhmm(event.from)} — вне эпизода «${event.stage}»`);
  }
  assert.ok(total > 365 * 0.5 && total < 365 * 0.7, `событий за год: ${total} — три дня из пяти`);
  assert.deepEqual([...kinds].sort(), keep.EVENTS.map(event => event.key).sort(), "за год бывает каждое");
  // Дни, на которые опираются тесты ниже.
  assert.deepEqual(["2026-11-14", "2026-11-15", "2026-11-18", "2026-11-21", "2026-11-25"].map(day => { const event = keep.eventFor(day); return event ? `${event.key}@${hhmm(event.from)}` : "-"; }),
    ["break@12:16", "book@09:51", "-", "book@10:06", "prank@13:43"]);
  assert.equal(hhmm(keep.catGift("2026-11-19").from), "18:52");
  assert.equal(keep.catGift("2026-11-18"), null);
  // Её вещи — следы событий: набросков не больше трёх; сегодняшняя книга появляется, когда событие кончилось.
  assert.deepEqual([keep.ownThings("2026-11-15", 9 * 60).book, keep.ownThings("2026-11-15", 11 * 60).book, keep.ownThings("2026-11-26", 0).book], ["", "2026-11-15", "2026-11-21"]);
  assert.equal(keep.ownThings("2026-12-05", 0).book, "2026-12-03", "новая находка сменяет прежнюю");
  assert.ok(keep.ownThings("2026-11-15", 0).sketches.length <= 3);
  // У каждого события есть слова: пока идёт, при встрече и для письма первой.
  // (У «неба» часть слов — под свою погоду: без названного неба слышна одна общая.)
  for (const event of keep.EVENTS) for (const name of [`событие:${event.pool}`, `было:${event.pool}`, `первой:${event.pool}`]) assert.ok(pool(name).length >= (name === "событие:небо" ? 1 : 2), name);
  for (const line of pool("событие:шалость")) assert.ok(scene.CAT_SHAPES.includes(room.catPose(line, "шалит").shape) && room.catPose(line, "шалит").place !== "sill", `шалость видна по Байту: ${line}`);
});

test("событие в её дне: двадцать пять минут она занята им — на рисунке, в словах и в чате; потом остаётся вещь и запись в альбоме", async () => {
  reset();
  const time = clock("2026-11-15T07:00:00Z");
  const h = heart(ON, { now: time.now, random: () => 0 });
  const look = await h.onRoom({ do: "look" }, from(5));
  assert.deepEqual([look.her.key, look.her.pose, look.her.event, look.event, look.own.book], ["дело", "read", "book", "book", false]);
  assert.ok(pool("событие:книга").includes(look.her.line), look.her.line);
  assert.ok(look.her.left <= keep.EVENT_MIN * 60_000, "страница спросит комнату заново, когда событие кончится");
  // Страница рисует то же: картинка с книгой.
  const state = logic.applyLook(logic.blank(10), look, time.now());
  assert.deepEqual([state.event, scene.spriteOf(logic.viewOf(state))], ["book", "read"]);
  // В чате — то же занятие.
  await h.onMessage(message("что делаешь"), KEY);
  assert.ok(last().startsWith(look.her.line), last());
  // Событие кончилось: она вернулась к своему дню, найденная книга лежит в комнате, запись — в альбоме.
  time.set("2026-11-15T07:30:00Z");
  const after = await h.onRoom({ do: "look", again: true }, from(5));
  assert.deepEqual([after.her.event, after.event, after.own.book, after.her.pose === "read"], [undefined, undefined, true, false]);
  assert.deepEqual(albumOf(5).items.map(item => `${item.k}:${item.key}:${item.day}`), ["first:visit:2026-11-15", "event:book:2026-11-15"]);
  // (Без неё самой: нарисованная кодом, она сидит на этом табурете; картинкой — стоит рядом.)
  assert.match(scene.drawRoom({ ...logic.viewOf(logic.applyLook(logic.blank(10), after, time.now())), her: null }), /<path d="M382 347 v7\.4/u, "на табурете — найденная книга с закладкой");
});

test("Байт при ней: шалость — событие дня; открыли окно — он на подоконнике; вечером несёт добычу; она сидит — приходит сам; она спит — не шумит", async () => {
  // Шалость (25.11, 13:50): она играет по плану, а по Байту видно, что он натворил.
  reset();
  let time = clock("2026-11-25T10:50:00Z");
  let h = heart(ON, { now: time.now, random: () => 0 });
  const prank = await h.onRoom({ do: "look" }, from(11));
  assert.deepEqual([prank.her.key, prank.event, prank.cat.prank, prank.cat.steady], ["игра", "prank", true, true]);
  assert.ok(pool("событие:шалость").includes(prank.cat.line), prank.cat.line);
  assert.deepEqual(room.catPose(prank.cat.line, "шалит"), { shape: prank.cat.shape, place: prank.cat.place });

  // Окно (18.11, 14:00): десять минут после того, как его открыли, Байт на подоконнике и смотрит на улицу.
  reset();
  time = clock("2026-11-18T11:00:00Z");
  h = heart(ON, { now: time.now, random: () => 0 });
  await h.onRoom({ do: "look" }, from(5));
  await h.onRoom({ do: "window" }, from(5));
  time.add(60_000);
  const airy = await h.onRoom({ do: "look", again: true }, from(5));
  assert.deepEqual([airy.open, airy.cat.shape, airy.cat.place], [true, "sit", "sill"]);
  assert.ok(pool("байт:окно").includes(airy.cat.line), airy.cat.line);
  time.add(11 * 60_000);
  assert.ok(!pool("байт:окно").includes((await h.onRoom({ do: "look", again: true }, from(5))).cat.line), "через десять минут он снова сам по себе");

  // Добыча (19.11, 19:00): она читает в кресле — он сидит рядом, у лап мышь; случай ложится в альбом.
  reset();
  time = clock("2026-11-19T16:00:00Z");
  h = heart(ON, { now: time.now, random: () => 0 });
  const gift = await h.onRoom({ do: "look" }, from(6));
  assert.deepEqual([gift.cat.shape, gift.cat.place, gift.cat.gift], ["gift", "near", true]);
  assert.ok(pool("байт:добыча").includes(gift.cat.line));
  assert.ok(albumOf(6).items.some(item => item.k === "cat" && item.key === "gift" && item.day === "2026-11-19"));
  time.add(20 * 60_000);
  assert.notEqual((await h.onRoom({ do: "look", again: true }, from(6))).cat.shape, "gift", "четверть часа — и добыча унесена");

  // Она сидит (вечер 18.11) — Байт приходит сам: ложится у ног, просится на руки, трётся о ноги; стоит — не просится.
  reset();
  time = clock("2026-11-18T16:30:00Z");
  h = heart(ON, { now: time.now, random: () => 0 });
  await h.onRoom({ do: "look" }, from(7));
  await h.onRoom({ do: "feed" }, from(7));
  const came = new Set(), begged = [];
  for (let step = 0; step < 60; step += 1) {
    time.add(room.CAT_STEP_MS);
    const now = await h.onRoom({ do: "look", again: true }, from(7));
    if (pool("байт:к ней").includes(now.cat.line)) { came.add(`${now.cat.shape}.${now.cat.place}`); assert.ok(["chair", "read"].includes(now.her.pose), `пришёл к сидящей: ${now.her.pose}`); }
    if (now.cat.shape === "beg") begged.push(now.her.pose);
  }
  assert.deepEqual([...came].sort(), ["beg.near", "lie.near", "walk.near"], "ложится у ног, просится на руки, трётся о ноги");
  assert.ok(begged.length > 0 && begged.every(pose => pose === "chair" || pose === "read"), "на руки — только к сидящей");

  // Она спит (ночь), а с Байтом только что играли: шумного он не затевает.
  reset();
  time = clock("2026-11-18T19:50:00Z");
  h = heart(ON, { now: time.now, random: () => 0 });
  await h.onRoom({ do: "look" }, from(7));
  await h.onRoom({ do: "play" }, from(7));
  time.set("2026-11-18T20:10:00Z");
  for (let step = 0; step < 16; step += 1) {
    time.add(room.CAT_STEP_MS);
    const night = await h.onRoom({ do: "look", again: true }, from(7));
    assert.deepEqual([night.her.key, night.cat.key], ["сон", "игра"]);
    assert.ok(!["play", "claw", "walk"].includes(night.cat.shape) && !/охотится|носится|о кресло/u.test(night.cat.line), `она спит, а Байт: ${night.cat.line}`);
  }
  // Правило — отдельно: шумное не при спящей, «на солнце» — в солнечный день, «на руки» — к сидящей.
  assert.deepEqual([room.catFits("Байт всё ещё охотится на бантик.", { asleep: true }), room.catFits("Байт всё ещё охотится на бантик.", {}), room.catFits("Байт спит на подоконнике, на солнце.", {}), room.catFits("Байт спит на подоконнике, на солнце.", { sunny: true }),
    room.catFits("Байт просится на руки.", {}), room.catFits("Байт просится на руки.", { seated: true })], [false, true, false, true, false, true]);
  // Новые приметы слов: добыча, «на руки», место сна.
  assert.deepEqual(["Байт принёс мне игрушечную мышь и положил у ног.", "Байт просится на руки: встал на задние лапы.", "Байт спит на подоконнике, на солнце.", "Байт уснул у моих ног: свернулся клубком.", "Байт пришёл сам и лёг у моих ног."].map(line => Object.values(room.catPose(line, "сыт")).join(".")),
    ["gift.near", "beg.near", "curl.sill", "curl.near", "lie.near"]);
});

test("альбом воспоминаний: первые разы, события, подарки и снимки — отдельной записью; подарок — раз в неделю; снимок — комната той минуты", async () => {
  reset();
  const time = clock("2026-11-18T11:00:00Z");
  const h = heart(ON, { now: time.now, random: () => 0 });
  const look = await h.onRoom({ do: "look" }, from(5));
  assert.deepEqual([look.album, look.gifts], [{ count: 1, fresh: 1 }, []]);
  // Первые разы — по одному на действие; второй чай в альбом не идёт.
  for (const op of ["tea", "feed", "tea", "window", "music"]) { time.add(1500); assert.equal((await h.onRoom({ do: op }, from(5))).ok, true, op); }
  assert.deepEqual(albumOf(5).items.map(item => `${item.k}:${item.key}`), ["first:visit", "first:tea", "first:feed", "first:window", "first:music"]);
  assert.deepEqual(roomOf(5).firsts, ["tea", "feed", "window", "music"]);
  assert.ok(!("items" in roomOf(5)), "история — не в записи комнаты");
  // Подарок: остаётся в комнате и в альбоме; второй — через неделю; это забота дня.
  const gift = await h.onRoom({ do: "gift", kind: "flower" }, from(5));
  assert.deepEqual([gift.ok, gift.taken, gift.gifts, pool("подарок:цветок").includes(gift.line)], [true, true, ["flower"], true]);
  const early = await h.onRoom({ do: "gift", kind: "book" }, from(5));
  assert.deepEqual([early.ok, early.taken, early.days, early.gifts], [true, false, 7, ["flower"]]);
  assert.match(early.line, /7 дней/u);
  assert.equal((await h.onRoom({ do: "gift", kind: "диван" }, from(5))).code, "unknown");
  await h.onMessage(message("дарю тебе книгу"), KEY);
  assert.match(last(), /7 дней/u, "и словами — тот же срок");
  // Снимок: комнату собирает сердце; не чаще раза в десять минут.
  const snap = await h.onRoom({ do: "snap" }, from(5));
  assert.deepEqual([snap.ok, snap.taken], [true, true]);
  assert.equal((await h.onRoom({ do: "snap" }, from(5))).taken, false);
  const saved = albumOf(5).items.find(item => item.k === "snap");
  assert.deepEqual([saved.view.part, saved.view.her.key, scene.HER_POSES.includes(saved.view.her.pose), saved.view.open, saved.view.gifts], ["день", look.her.key, true, true, ["flower"]]);
  // Альбом для страницы: новые сверху, подписи и даты словами, у снимка — комната.
  const album = await h.onRoom({ do: "album" }, from(5));
  assert.deepEqual(album.items.map(item => item.title), ["Первый снимок на память", "Снимок на память", "Первый подарок", "Цветок от вас", "Первый танец под колонку", "Окно впервые открыли при вас", "Первый корм Байту от вас", "Первая чашка чая от вас", "Первый раз у меня в комнате"]);
  assert.ok(album.items.every(item => item.date === "18 ноября"));
  assert.deepEqual([album.gift, album.kinds], [{ ok: false, days: 7 }, ["flower", "book", "toy"]]);
  const shown = albumPage.listOf(album);
  assert.deepEqual([shown.length, shown[1].kind, Boolean(shown[1].view), shown[0].view], [9, "snap", true, null]);
  // Снимок рисуется тем же рисунком: комната той минуты — с цветком на шкафу.
  assert.match(scene.drawRoom(shown[1].view), /<circle cx="23" cy="143\.4" r="1\.7"/u);
  // В чате — словами.
  await h.onMessage(message("покажи альбом"), KEY);
  assert.match(last(), /18 ноября — Первый снимок на память/u);
  // Через неделю цветок убран, запись осталась; можно дарить снова — книга и игрушка остаются.
  time.add(keep.GIFT_EVERY_MS + 60_000);
  assert.deepEqual((await h.onRoom({ do: "look" }, from(5))).gifts, []);
  assert.deepEqual((await h.onRoom({ do: "gift", kind: "toy" }, from(5))).gifts, ["toy"]);
  assert.ok(albumOf(5).items.some(item => item.k === "gift" && item.key === "flower"));
  // «Удали всё обо мне» стирает и альбом.
  await h.onMessage(message("удали всё обо мне"), KEY);
  await h.onMessage(message("да, удали"), KEY);
});

test("альбом: не больше шестидесяти записей — «первые» остаются; снимков — восемь; сбой памяти не выглядит пустым альбомом", async () => {
  reset();
  const { createHeartStore } = await import("../tgcloud/lib/store.js");
  const { db } = await import("./fixtures/sdk-stub.mjs");
  let now = at("2026-11-18T11:00:00Z");
  const book = keep.createKeepsakes({ store: createHeartStore({ db, now: () => now }), now: () => now });
  await book.add(5, [{ k: "first", key: "visit", day: "2026-01-01", at: 1 }]);
  for (let index = 0; index < 80; index += 1) await book.add(5, [{ k: "event", key: "book", day: keep.dayOf(20000 + index), at: index + 2 }]);
  const full = await book.read(5);
  assert.deepEqual([full.items.length, full.items[0].k, full.items.at(-1).day], [keep.KEEPSAKE_MAX, "first", keep.dayOf(20079)]);
  // Та же запись дважды не ложится.
  assert.deepEqual((await book.add(5, [{ k: "first", key: "visit", day: "2026-02-02", at: 9 }, { k: "event", key: "book", day: keep.dayOf(20079), at: 9 }])).added, []);
  for (let index = 0; index < 12; index += 1) { now += keep.SNAP_EVERY_MS + 1000; assert.equal((await book.snap(5, { part: "день" }, "слова", { day: "2026-11-18" })).early, false); }
  assert.equal((await book.read(5)).items.filter(item => item.k === "snap").length, keep.SNAP_MAX);
  // Чтение не удалось — это не «пусто», и запись не затирается.
  const before = sdk().kv.get(keep.KEEPSAKE_KEY(5)), real = db.get;
  db.get = async (query, params = {}) => { if (params[":key"] === keep.KEEPSAKE_KEY(5)) throw new Error("база не ответила"); return real(query, params); };
  try {
    assert.equal((await book.read(5)).lost, true);
    assert.equal((await book.add(5, [{ k: "first", key: "tea", day: "2026-11-18", at: 5 }])).saved, false);
    assert.equal((await book.gift(5, "flower", { day: "2026-11-18" })).code, "storage");
  } finally { db.get = real; }
  assert.equal(sdk().kv.get(keep.KEEPSAKE_KEY(5)), before);
});

test("встреча после отлучки: сценка — что было без человека, с её местом на каждом шаге; рассказанное ложится в альбом", async () => {
  reset();
  const time = clock("2026-11-13T09:00:00Z");
  const h = heart(ON, { now: time.now, random: () => 0 });
  await h.onRoom({ do: "look" }, from(5));
  time.set("2026-11-17T09:00:00Z");
  const back = await h.onRoom({ do: "look" }, from(5));
  assert.match(back.greet, /4 дня/u);
  assert.deepEqual(back.story.map(beat => [beat.her?.pose ?? "", /^Пока вас не было, 3 дня назад/u.test(beat.line), /^(?:Ещё|Главная новость): позавчера/u.test(beat.line)]), [["chair", true, false], ["read", false, true], ["", false, false]]);
  assert.ok(pool("встреча:конец").includes(back.story[2].line));
  assert.deepEqual(albumOf(5).items.filter(item => item.told).map(item => `${item.key}:${item.day}`), ["break:2026-11-14", "book:2026-11-15"]);
  // Сверка сценку не повторяет; заход на следующий день — тоже.
  assert.equal((await h.onRoom({ do: "look", again: true }, from(5))).story, undefined);
  time.set("2026-11-18T09:00:00Z");
  assert.equal((await h.onRoom({ do: "look" }, from(5))).story, undefined);

  // Страница: кнопка ведёт по шагам; на каждом — её слова и её место; после последнего комната возвращается к нынешней минуте.
  let state = logic.applyLook(logic.blank(12), back, time.now());
  const present = logic.viewOf(state).her.pose;
  assert.deepEqual([logic.storyLeft(state), state.storyAt], [3, -1]);
  state = logic.applyStory(state);
  assert.deepEqual([state.said, logic.viewOf(state).her.pose, logic.viewOf(state).her.key, logic.storyLeft(state)], [back.story[0].line, "chair", "уют", 2]);
  // Сверка посреди сценки её не обрывает.
  const ticked = logic.applyTick(state, { ...back, story: undefined }, time.now());
  assert.deepEqual([ticked.storyAt, ticked.story.length, logic.viewOf(ticked).her.pose], [0, 3, "chair"]);
  state = logic.applyStory(state);
  assert.deepEqual([logic.viewOf(state).her.pose, state.said], ["read", back.story[1].line]);
  state = logic.applyStory(state);
  assert.deepEqual([logic.viewOf(state).her.pose, logic.storyLeft(state)], [present, 0], "последний шаг — без своего места: она там, где сейчас");
  state = logic.applyStory(state);
  assert.deepEqual([state.story, state.storyAt, logic.viewOf(state).her.pose, state.said], [[], -1, present, state.lines.her]);
  // Негодные шаги страница не берёт.
  assert.deepEqual(logic.applyLook(logic.blank(12), { ...back, story: [{ line: "" }, null, { line: "Ок", her: { pose: "летает" }, cat: { shape: "лев", place: "rug" } }] }, 0).story, [{ line: "Ок" }]);
});

test("пишет первой о событии своего дня — тем, кто бывает в комнате; «не пиши» — и больше не пишет", async () => {
  reset();
  const time = clock("2026-11-16T09:00:00Z");
  const h = heart(ON, { now: time.now, random: () => 0 });
  // Гость 5 заходил три дня подряд; гость 6 — один раз.
  for (const day of ["16", "17", "18"]) { time.set(`2026-11-${day}T09:00:00Z`); await h.onRoom({ do: "look" }, from(5)); }
  await h.onRoom({ do: "look" }, from(6));
  assert.deepEqual(Object.keys(JSON.parse(sdk().kv.get(room.ROOM_RECENT_KEY)).users).sort(), ["5", "6"]);
  const notes = (id) => toChat(id).filter(item => pool("первой:книга").some(line => String(item.text).startsWith(line)));
  // 21.11, 10:30 по Москве: книга нашлась в 10:06. Сердце будит чужое сообщение.
  time.set("2026-11-21T07:30:00Z");
  await h.onMessage(message("привет", { id: 9 }), KEY);
  assert.equal(notes(5).length, 1, "тому, кто бывает, — письмо");
  assert.match(notes(5)[0].text, /скажите «не пиши»/u, "в первом письме — как это выключить");
  assert.equal(notes(6).length, 0, "зашедшему один раз — нет");
  assert.deepEqual([roomOf(5).noted, roomOf(5).notes], ["2026-11-21", 1]);
  assert.ok(albumOf(5).items.some(item => item.k === "event" && item.key === "book" && item.day === "2026-11-21" && item.told === true), "о чём написала — то в альбоме");
  // Второй раз за день не пишет; и чаще раза в двое суток — тоже (20-го был перерыв, 21-го — книга: нужен новый повод).
  time.add(20 * 60_000);
  await h.onMessage(message("привет", { id: 9 }), KEY);
  assert.equal(notes(5).length, 1);
  // Ночью, после срока события или тому, кто только что был в комнате, — не пишет.
  reset();
  const late = clock("2026-11-16T09:00:00Z");
  const quiet = heart(ON, { now: late.now, random: () => 0 });
  for (const day of ["16", "17", "18"]) { late.set(`2026-11-${day}T09:00:00Z`); await quiet.onRoom({ do: "look" }, from(5)); }
  late.set("2026-11-21T11:00:00Z");
  await quiet.onMessage(message("привет", { id: 9 }), KEY);
  assert.equal(toChat(5).length, 0, "через четыре часа после события — уже не новость");
  late.set("2026-11-25T10:50:00Z");
  await quiet.onRoom({ do: "look", again: true }, from(5));
  late.add(16 * 60_000);
  // 25.11, шалость Байта в 13:43: письмо уходит — и человек отвечает «хватит мне писать».
  const pranks = () => toChat(5).filter(item => pool("первой:шалость").some(line => String(item.text).startsWith(line))).length;
  await quiet.onMessage(message("привет", { id: 9 }), KEY);
  assert.equal(pranks(), 1);
  await quiet.onMessage(message("хватит мне писать"), KEY);
  assert.ok(pool("первой:стоп").includes(last()), last());
  assert.equal(roomOf(5).mute, true);
  // 1.12 — снова шалость, повод есть, двое суток прошли — а письма нет: он сказал «не пиши».
  late.set("2026-12-01T10:30:00Z");
  await quiet.onMessage(message("привет", { id: 9 }), KEY);
  assert.equal(pranks(), 1);
  // «Пиши мне» — снова можно: 3.12 книга в 8:48 — днём по её правилу «с десяти» письмо не уйдёт; 9.12 книга в 10:35 — уйдёт.
  await quiet.onMessage(message("пиши мне"), KEY);
  assert.ok(pool("первой:можно").includes(last()));
  assert.equal(roomOf(5).mute, false);
  for (const day of ["05", "06", "07"]) { late.set(`2026-12-${day}T09:00:00Z`); await quiet.onRoom({ do: "look" }, from(5)); }
  late.set("2026-12-09T08:00:00Z");
  await quiet.onMessage(message("привет", { id: 9 }), KEY);
  assert.equal(toChat(5).filter(item => pool("первой:книга").some(line => String(item.text).startsWith(line))).length, 1);
  // Выключено настройкой сборки — не пишет вовсе.
  reset();
  const off = clock("2026-11-16T09:00:00Z");
  const silent = heart({ ...ON, ROOM_NOTES: false }, { now: off.now, random: () => 0 });
  for (const day of ["16", "17", "18"]) { off.set(`2026-11-${day}T09:00:00Z`); await silent.onRoom({ do: "look" }, from(5)); }
  off.set("2026-11-21T07:30:00Z");
  await silent.onMessage(message("привет", { id: 9 }), KEY);
  assert.equal(toChat(5).length, 0);
  // Слова «не пиши» — в любой форме; «не пиши первой» у хозяина остаётся настройкой привета.
  for (const words of ["не пиши", "не пиши мне", "больше не пиши мне", "не пишите мне больше", "хватит писать", "перестань мне писать", "не надо мне писать", "не беспокой меня", "не пиши первой"]) assert.equal(room.parseRoom(words)?.op, "noteoff", words);
  for (const words of ["пиши мне", "можешь писать", "можешь мне писать", "пиши когда хочешь"]) assert.equal(room.parseRoom(words)?.op, "noteon", words);
  for (const words of ["пиши", "напиши стих", "не пиши так много букв"]) assert.equal(room.parseRoom(words), null, words);
});

test("улыбка картинкой (0.50.0): заплатка на лицо у двадцати картинок; на рисунке не видна, пока её не покажут стили", async () => {
  // Сообщение 51 («продолжай генерацию»): десять картинок хода — улыбка с закрытыми глазами для десяти поз; на ту же
  // позу в свитере она перенесена без новой картинки (лицо у нарядов одно), как веки.
  const { readdirSync } = await import("node:fs");
  const dir = new URL("../miniapp/her/", import.meta.url);
  const smiling = [];
  for (const file of readdirSync(dir).filter(name => name.endsWith(".js"))) {
    const sprite = (await import(new URL(file, dir))).default;
    if (!sprite.smile) continue;
    smiling.push(file.replace(/\.js$/u, ""));
    const { blink, smile } = sprite;
    assert.ok(blink, `${file}: улыбка ставится по векам — веки должны быть`);
    assert.ok(smile.x >= 0 && smile.y >= 0 && smile.x + smile.w <= sprite.w && smile.y + smile.h <= sprite.h, `${file}: заплатка внутри картинки`);
    // Лицо целиком: заплатка накрывает веки и уходит ниже них — туда, где рот.
    assert.ok(smile.x <= blink.x + 4 && smile.x + smile.w >= blink.x + blink.w - 4 && smile.y <= blink.y + 2 && smile.y + smile.h >= blink.y + blink.h + 20, `${file}: заплатка накрывает глаза и рот`);
    assert.match(smile.src, /^data:image\/webp;base64,[A-Za-z0-9+/=]+$/u);
  }
  const poses = ["books", "feed", "play3", "read", "tea", "tea3", "tidy", "work", "work2", "work3"];
  assert.deepEqual(smiling.sort(), [...poses, ...poses.map(name => `home-${name}`)].sort());
  // На рисунке: определение заплатки — рядом с картинкой, сама она — в слое головы, поверх век, и не видна.
  const sprite = { w: 300, h: 900, cx: 0.5, src: "data:image/webp;base64,AAAA", blink: { x: 120, y: 60, w: 60, h: 20, src: "data:image/webp;base64,AAAA" }, smile: { x: 118, y: 56, w: 64, h: 60, src: "data:image/webp;base64,BBBB" } };
  const drawn = scene.drawRoom({ part: "день", her: { key: "устала", pose: "desk" } }, { sprites: { tired: sprite } });
  assert.match(drawn, /<image id="r-her-tired-smile" x="118" y="56" width="64" height="60" preserveAspectRatio="none" href="data:image\/webp;base64,BBBB"\/>/u);
  assert.match(drawn, /<use class="wink" href="#r-her-tired-blink" [^>]+\/><use class="grin" opacity="0" href="#r-her-tired-smile" [^>]+\/>/u);
  // Без заплатки — как раньше: ни определения, ни слоя.
  const plain = scene.drawRoom({ part: "день", her: { key: "устала", pose: "desk" } }, { sprites: { tired: { ...sprite, smile: undefined } } });
  assert.ok(!plain.includes("grin") && !plain.includes("-smile"));
  // Кривая заплатка (вышла за картинку) не рисуется вовсе.
  const broken = scene.drawRoom({ part: "день", her: { key: "устала", pose: "desk" } }, { sprites: { tired: { ...sprite, smile: { ...sprite.smile, x: 280 } } } });
  assert.ok(!broken.includes("grin"));
  // Стили: видна, пока гладят, когда рада и жестом; страница заменяет жест наклоном головы там, где улыбки нет.
  const html = readFileSync(new URL("../miniapp/index.html", import.meta.url), "utf8"), app = readFileSync(new URL("../miniapp/app.js", import.meta.url), "utf8");
  assert.ok(html.includes("#room .grin { opacity: 0;") && html.includes("#room .patted .grin, #room .glad .grin, #room .g-smile .grin { opacity: 1; }"));
  assert.ok(app.includes('if (what === "smile" && !sprites[spriteOf(viewOf(state))]?.smile) what = "tilt";'));
});

test("жесты: по занятию и настроению, по кругу, не случайно; спит — жестов нет; слой головы и метки — в рисунке", () => {
  const she = (key, extra = {}) => ({ ready: true, her: { key, pose: "desk", ...(extra.face ? { face: extra.face } : {}) }, cat: extra.cat ?? { place: "pillow", shape: "curl" }, open: extra.open === true });
  const row = (state) => [0, 1, 2, 3, 4].map(count => logic.gestureOf(state, count));
  assert.deepEqual(row(she("сон")), ["", "", "", "", ""], "спит — только дышит");
  assert.deepEqual(row(she("дело")), ["nod", "bow", "tilt", "peek", "look-win"]);
  assert.deepEqual(row(she("дело", { open: true, cat: { place: "near", shape: "sit" } })), ["nod", "look-cat", "hair", "peek", "look-win"], "окно открыто — качнулись волосы; Байт рядом — взгляд на него");
  assert.deepEqual(row(she("обида")).filter(Boolean).every(name => ["huff", "away"].includes(name)), true, "обижена — отворачивается и не смотрит на зрителя");
  assert.ok(row(she("устала")).includes("sigh") && !row(she("устала")).includes("peek"));
  assert.ok(row(she("уют", { face: "drowsy" })).includes("yawn"));
  assert.equal(logic.gestureOf(she("игра"), 8), logic.gestureOf(she("игра"), 2), "жесты идут по кругу");
  // 0.50.0 — улыбка: за делом — шестым жестом, в уюте и за игрой — четвёртым; обижена, ревнует, устала — не улыбается.
  assert.deepEqual([logic.gestureOf(she("дело"), 5), logic.gestureOf(she("уют"), 3), logic.gestureOf(she("игра"), 3)], ["smile", "smile", "smile"]);
  for (const key of ["обида", "ревность", "устала"]) assert.ok(![0, 1, 2, 3, 4, 5, 6, 7].some(count => logic.gestureOf(she(key), count) === "smile"), key);
  assert.equal(logic.gestureOf({ ready: false }, 0), "");
  for (const key of Object.keys(scene.MOODS)) for (const name of row(she(key))) assert.ok(name === "" || logic.GESTURES.includes(name), `${key}: ${name}`);
  // На рисунке: слой головы — та же картинка под мягким овалом; слой мимики — с настроением; метки не видны.
  const sprite = { w: 300, h: 900, cx: 0.5, src: "data:image/webp;base64,AAAA", blink: { x: 120, y: 60, w: 60, h: 20, src: "data:image/webp;base64,AAAA" } };
  const drawn = scene.drawRoom({ part: "день", her: { key: "устала", pose: "desk" } }, { sprites: { tired: sprite } });
  assert.match(drawn, /<g class="mim m-tired"><g class="lean"><g class="alive"><use href="#r-her-tired" [^>]+\/><mask id="r-herHead"/u);
  assert.match(drawn, /<g class="hd" style="transform-origin:[\d.]+px [\d.]+px"><g class="hr" style="transform-origin:[\d.]+px [\d.]+px"><g mask="url\(#r-herHead\)"><use href="#r-her-tired" [^>]+\/><use class="wink"/u, "веки — в слое головы: наклоняются вместе с ней");
  assert.deepEqual([...drawn.matchAll(/<g class="emo (e-[a-z]+)" opacity="0">/gu)].map(found => found[1]), ["e-bang", "e-ask", "e-huff", "e-drop", "e-zz"]);
  // Спит на полу — слоя головы нет.
  assert.ok(!scene.drawRoom({ part: "ночь", her: { key: "сон", pose: "nap" } }, { sprites: { "home-sleep": { ...sprite, h: 500 } } }).includes('class="hd"'));
  // Страница: жест — раз в ход своей жизни и по событию; у каждого слова жеста есть правило в стилях.
  const app = read("miniapp/app.js"), html = read("miniapp/index.html");
  for (const name of logic.GESTURES.filter(word => !["peek", "look-cat", "look-win"].includes(word))) assert.ok(html.includes(`#room .g-${name} `), name);
  for (const rule of ["#room .look-l .hd", "#room .look-r .hd", "#room .peek .alive .fr.lk", "#room .poked .mim", "#room .g-bang .e-bang"]) assert.ok(html.includes(rule), rule);
  assert.match(app, /if \(result\?\.ok === true\) \{ lookAt\("win"\); if \(state\.open === true\) react\("g-hair", 2600\); \}/u, "открыли окно — оборачивается, волосы качнулись");
  assert.ok(!html.includes("#room .poked .alive {"), "реакция не подменяет дыхание: у неё свой слой");
});

test("рисунок: Байт просится на руки и приносит мышь; её вещи и подарки видны; у страницы — кнопка альбома и кнопка сценки", () => {
  const view = (cat, extra = {}) => ({ part: "день", her: { key: "уют", pose: "chair" }, cat, things: [], ...extra });
  const beg = scene.drawRoom(view({ shape: "beg", place: "near", key: "сыт" })), gift = scene.drawRoom(view({ shape: "gift", place: "near", key: "сыт" }));
  assert.match(beg, /<g class="cat beg">/u);
  assert.match(beg, /class="reach"/u, "лапы тянутся, а не дерут");
  assert.ok(!beg.includes('class="scratch"'));
  assert.match(gift, /<g class="cat gift">/u);
  assert.deepEqual([room.CAT_SHAPES, logic.GIFT_KINDS], [scene.CAT_SHAPES, keep.GIFTS], "сердце и страница знают одни и те же фигуры и подарки");
  const bare = scene.drawRoom(view(null)), full = scene.drawRoom(view(null, { own: { sketches: 3, book: true, card: true }, gifts: ["flower", "book", "toy"] }));
  assert.ok(full.length - bare.length > 2500, "вещи нарисованы");
  assert.equal((full.match(/<rect x="3\.4" y="-1\.4" width="5\.2" height="2\.6"/gu) ?? []).length, 3, "три наброска на стекле — каждый на полоске скотча");
  assert.equal((scene.drawRoom(view(null, { own: { sketches: 1 } })).match(/<rect x="3\.4" y="-1\.4"/gu) ?? []).length, 1);
  assert.equal(scene.drawRoom(view(null, { own: { sketches: "много", book: "да" }, gifts: ["слон"] })), bare, "негодное описание вещей ничего не рисует");
  // Описание рисунка без вещей — то же, что и было: рисунок не перерисовывается зря.
  const plain = logic.applyLook(logic.blank(12), { ok: true, clock: { hour: 12, part: "день" }, her: { key: "дело", pose: "desk" }, own: { sketches: 0, book: false, card: false }, gifts: [] }, 0);
  assert.deepEqual(["own" in logic.viewOf(plain), "gifts" in logic.viewOf(plain)], [false, false]);
  const html = read("miniapp/index.html");
  for (const id of ["album", "albumBox", "story", "storyNext", "oops"]) assert.ok(html.includes(`id="${id}"`), id);
  // Альбом — отдельным модулем: в первую загрузку не входит и к сердцу сам не ходит.
  const module = read("miniapp/album.js");
  assert.ok(!/\bimport\b/u.test(module.replace(/\/\*[\s\S]*?\*\//gu, "")) && !/Telegram|fetch\(|innerHTML/u.test(module));
  assert.deepEqual(albumPage.listOf({ items: [null, { title: "" }, { k: "snap", title: "Снимок", view: "нет" }, { k: "first", title: "Первый раз", date: "1 мая", told: true }] }).map(item => [item.kind, item.title, item.view, item.told]), [["snap", "Снимок", null, false], ["first", "Первый раз", null, true]]);
});

test("свет меняется не разом: за пятьдесят минут до перемены за окном проступает следующий свет — шагами по четверти", async () => {
  // Страница: срок до перемены света называет сердце; доля растёт четвертями, перед днём ничего не подмешивается.
  const glow = (minutes, light) => logic.glowOf({ lightLeft: minutes * 60_000 }, light);
  assert.deepEqual([60, 50, 49, 38, 37, 25, 13, 12, 1].map(minutes => glow(minutes, "день")?.k ?? 0), [0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 1, 1]);
  assert.deepEqual([glow(10, "день").to, glow(10, "вечер").to, glow(10, "ночь").to, glow(10, "утро")], ["вечер", "ночь", "утро", null]);
  assert.deepEqual([logic.glowOf({}, "день"), logic.glowOf({ lightLeft: -5 }, "день"), logic.glowOf({ lightLeft: 60_000 }, "полдень"), logic.glowOf(null, "день")], [null, null, null, null], "прежнее сердце срока не называет — зари нет");
  // Сердце: без города свет идёт по часам — до шести вечера полчаса, значит закат наполовину.
  reset();
  const time = clock("2026-11-18T14:30:00Z");
  const h = heart(ON, { now: time.now, random: () => 0 });
  const look = await h.onRoom({ do: "look" }, from(31));
  assert.equal(look.clock.lightLeft, 30 * 60_000);
  assert.ok(look.clock.left <= look.clock.lightLeft);
  const state = logic.applyLook(logic.blank(17), look, time.now());
  assert.deepEqual(state.glow, { to: "вечер", k: 0.5 });
  assert.deepEqual(logic.viewOf(state).glow, { to: "вечер", k: 0.5 });
  // В три часа дня до перемены далеко: в описании рисунка поля нет — рисунок тот же, что и был.
  time.set("2026-11-18T12:00:00Z");
  const noon = logic.applyLook(state, await h.onRoom({ do: "look", again: true }, from(31)), time.now());
  assert.equal(noon.glow, null);
  assert.ok(!("glow" in logic.viewOf(noon)));
  // Рисунок: ясным днём — тёплая полоса у горизонта, в дождь — небо темнеет, перед ночью — синева сверху.
  const view = (extra) => ({ part: "день", sky: "clear", her: null, cat: null, things: [], ...extra });
  const plain = scene.drawRoom(view({}));
  const dusk = (extra) => scene.drawRoom(view(extra)).match(/<rect class="dusk"[^>]*>/u)?.[0] ?? "";
  assert.ok(!plain.includes('class="dusk"'));
  assert.match(dusk({ glow: { to: "вечер", k: 1 } }), /fill="url\(#[^)]+\)"/u);
  assert.match(dusk({ glow: { to: "вечер", k: 1 }, sky: "rain" }), /fill="#141a33" opacity="0\.24"/u);
  assert.match(dusk({ glow: { to: "вечер", k: 0.5 }, sky: "rain" }), /opacity="0\.12"/u);
  assert.match(dusk({ part: "ночь", glow: { to: "утро", k: 0.25 }, sky: "fog" }), /fill="#dfe6f2"/u);
  assert.notEqual(dusk({ part: "вечер", glow: { to: "ночь", k: 1 } }), "");
  for (const bad of [{ to: "день", k: 1 }, { to: "вечер", k: 0 }, { to: "вечер", k: "много" }, "вечер", { k: 1 }]) assert.equal(scene.drawRoom(view({ glow: bad })), plain, JSON.stringify(bad));
  // Окно открыто — шторы ходят от сквозняка, каждая в своём ритме; закрыто — висят.
  assert.equal((scene.drawRoom(view({ open: true })).match(/<g class="breeze( b1)?">/gu) ?? []).length, 2);
  assert.ok(!plain.includes('class="breeze'));
  assert.match(read("miniapp/index.html"), /#room \.breeze \{[^}]*animation: breeze/u);
});

test("подарок и «не пиши» словами: цветок и книга — ей, игрушка — Байту, и «дарю тебе игрушку» тоже; «не пиши» понимается в десяти видах", () => {
  const op = (text) => room.parseRoom(text)?.op ?? "";
  assert.deepEqual(["дарю тебе цветок", "это тебе цветок", "принёс тебе книгу", "дарю тебе игрушку", "дарю Байту игрушку", "принёс игрушку для Байта", "это вам мячик"].map(op),
    ["giftflower", "giftflower", "giftbook", "gifttoy", "gifttoy", "gifttoy", "gifttoy"]);
  // Его слово (сообщение 48): «если человек скажет не пиши или что-то типа того, то она не пишет».
  for (const text of ["не пиши", "не пиши мне", "больше не пиши", "не пиши первой", "хватит мне писать", "перестань писать первой", "не надо мне писать", "прекрати писать", "не беспокой меня", "не пиши пожалуйста"]) assert.equal(op(text), "noteoff", text);
  assert.deepEqual(["пиши мне", "можешь писать"].map(op), ["noteon", "noteon"]);
  // «Не пиши код», «не пиши ему» — не о её письмах.
  for (const text of ["не пиши код", "не пиши ему", "не пиши так длинно"]) assert.notEqual(op(text), "noteoff", text);
});

test("«удали всё обо мне»: комната, альбом и место в списке «кто бывает в комнате» стираются; чужое остаётся", async () => {
  reset();
  const time = clock("2026-11-15T07:00:00Z");
  const h = heart(ON, { now: time.now, random: () => 0 });
  for (const id of [41, 42]) await h.onRoom({ do: "look" }, from(id));
  const recent = () => Object.keys(JSON.parse(sdk().kv.get(room.ROOM_RECENT_KEY) ?? "{}")?.users ?? {}).sort();
  assert.deepEqual(recent(), ["41", "42"]);
  assert.ok(roomOf(41) && albumOf(41), "запись комнаты и альбом заведены");
  await h.onMessage(message("удали всё обо мне", { id: 41 }), KEY);
  await h.onMessage(message("да, удали всё", { id: 41 }), KEY);
  assert.deepEqual([roomOf(41), albumOf(41), recent()], [null, null, ["42"]]);
  assert.ok(roomOf(42) && albumOf(42), "чужое на месте");
});

test("фразы со скриншота владельца (0.50.0): четыре берёт сама, две — продолжение разговора: их ведёт модель, а из списка непонятного они уходят", async () => {
  const { readFileSync } = await import("node:fs");
  const { parseMedia } = await import("../tgcloud/lib/media.js");
  const { notForDictionary } = await import("../tgcloud/lib/taught.js");
  const { createPhrasebook } = await import("../tgcloud/lib/phrasebook.js");
  const { clean } = await import("../tgcloud/lib/catalogue.js");
  const book = createPhrasebook({ random: () => 0 });
  // Словарь: о любви, о дне рождения хозяина, о зубе — и соседние слова.
  for (const [said, topic] of [["кого ты любишь", "кого ты любишь"], ["Кого ты любишь больше всех?", "кого ты любишь"], ["кто тебе нравится", "кого ты любишь"],
    ["сегодня день рождения твоего хозяина", "день рождения хозяина"], ["У хозяина сегодня день рождения!", "день рождения хозяина"],
    ["одного зуба нету", "нет зуба"], ["у меня выпал зуб", "нет зуба"]]) {
    assert.ok(book.match(said)?.includes(topic), `${said}: тема «${topic}»`);
  }
  // В темах о хозяине нет строк без пометки: иначе он услышит о себе в третьем лице, а гость — «вас, хозяин».
  const source = readFileSync(new URL("../PHRASES.txt", import.meta.url), "utf8");
  for (const name of ["кого ты любишь", "день рождения хозяина"]) {
    const lines = source.split(`== ${name} ==\n`)[1].split("\n\n")[0].split("\n").filter(line => line && !line.startsWith("когда:") && !line.startsWith("#"));
    assert.ok(lines.some(line => line.startsWith("[хозяин]")) && lines.some(line => line.startsWith("[не хозяин")), name);
    for (const line of lines) assert.match(line, /^\[(?:хозяин|не хозяин)[\],]/u, `${name}: ${line}`);
  }
  // «А сможешь нарисовать меня?» — просьба, сказанная вопросом: её берёт рисование, как «нарисуй меня».
  for (const said of ["а сможешь нарисовать меня", "А сможешь нарисовать меня?", "сможешь нарисовать кота в шляпе", "можешь нарисовать мне дракона", "ты можешь нарисовать море", "нарисуешь кота", "а нарисуй кота", "сумеешь нарисовать замок"]) {
    assert.equal(parseMedia(said)?.kind, "draw", said);
  }
  assert.match(parseMedia("а сможешь нарисовать меня").query, /^меня\??$/u);
  // Вопрос об умении, отказ и «нарисуй смайликами» — не рисунок.
  for (const said of ["ты умеешь рисовать людей", "не можешь нарисовать кота", "сможешь нарисовать смайликами кота", "кто сможет нарисовать кота"]) assert.notEqual(parseMedia(said)?.kind, "draw", said);
  // «Кто же», «вот так выгляжу» — продолжение разговора: в списке «что не поняла» им не место.
  for (const said of ["кто же", "и кто же", "а почему", "ну и где же", "кого именно", "что", "вот так выгляжу", "вот так я выгляжу", "вот я", "вот смотри"]) assert.equal(notForDictionary(clean(said)), "talk", said);
  for (const said of ["это я", "вот это я", "я так выгляжу", "вот как я выгляжу"]) assert.equal(notForDictionary(clean(said)), "talk", said);
  // А самостоятельные реплики и возгласы в списке остаются — до тех пор, пока словарь их не выучит.
  for (const said of ["кто писал", "вот блин", "вот это да", "вот это номер был", "вот так сюрприз", "одного зуба нету", "го встречается", "а ты кто"]) assert.equal(notForDictionary(clean(said)), "", said);
  // «Не пиши… или что-то типа того» (владелец, сообщение 48): те же слова, сказанные иначе, — та же просьба.
  const { parseRoom } = await import("../tgcloud/lib/room.js");
  for (const said of ["не пиши", "Не присылай мне сообщения", "не присылай мне больше сообщения", "не шли мне сообщения", "хватит мне писать", "перестань писать", "не надо мне писать",
    "не присылайте ничего", "прекрати присылать сообщения", "пожалуйста не отправляй мне сообщения"]) assert.equal(parseRoom(said)?.op, "noteoff", said);
  for (const said of ["не пиши ночью", "не присылай мне сообщения ночью", "напиши мне сообщение", "хватит писать код", "не присылай мне котов"]) assert.notEqual(parseRoom(said)?.op, "noteoff", said);
});

test("взгляд в сторону картинкой (0.51.0): заплатка на глаза у восьми поз в обоих нарядах; скрыта, пока она не смотрит в ту сторону; лежит под веками", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const scene = await import("../miniapp/scene.js");
  const folder = new URL("../miniapp/her/", import.meta.url);
  const sprites = {};
  for (const file of readdirSync(folder)) sprites[file.replace(/\.js$/u, "")] = (await import(new URL(file, folder))).default;
  const gazing = Object.keys(sprites).filter(name => sprites[name].lookr || sprites[name].lookl).sort();
  const poses = ["play3", "read", "tea", "tea3", "tidy", "work", "work2", "work3"];
  assert.deepEqual(gazing, [...poses.map(name => `home-${name}`), ...poses].sort());
  for (const name of gazing) {
    const { blink, lookr, lookl } = sprites[name];
    // Все девять картинок вышли «вправо» (к правому краю рисунка) — «влево» пока нет ни у кого.
    assert.equal(lookl, undefined, name);
    assert.ok(blink, `${name}: взгляд ставится по векам`);
    // Заплатка — на глаза: того же размера, что веки, и на том же месте (плюс-минус подгонка).
    assert.ok(Math.abs(lookr.x - blink.x) <= 8 && Math.abs(lookr.y - blink.y) <= 8 && Math.abs(lookr.w - blink.w) <= 8 && Math.abs(lookr.h - blink.h) <= 8, `${name}: ${JSON.stringify({ ...lookr, src: "" })}`);
    assert.match(lookr.src, /^data:image\/webp;base64,[A-Za-z0-9+/=]+$/u, name);
    assert.ok(scene.drawSprite(name, sprites[name]).includes(`<image id="r-her-${name}-lookr" x="${lookr.x}" y="${lookr.y}" width="${lookr.w}" height="${lookr.h}"`), name);
  }
  // На рисунке: слой взгляда скрыт (opacity="0") и стоит раньше век — моргание идёт поверх него.
  const drawn = scene.drawRoom({ part: "день", her: { pose: "chair", key: "уют", beat: true }, cat: { shape: "sit", place: "near", key: "сыт" }, things: ["кресло"] }, { sprites });
  const name = scene.spriteOf({ part: "день", her: { pose: "chair", key: "уют" } });
  assert.ok(sprites[name].lookr, `${name}: у позы в кресле взгляд есть`);
  assert.match(drawn, new RegExp(`<use class="eyr" opacity="0" href="#r-her-${name}-lookr"[^>]+/><use class="wink" href="#r-her-${name}-blink"`, "u"));
  // Негодная заплатка — рисунок без неё, а не без неё самой; у позы без заплатки слоя нет.
  const broken = scene.drawRoom({ part: "день", her: { pose: "chair", key: "уют", beat: true }, things: [] }, { sprites: { ...sprites, [name]: { ...sprites[name], lookr: { ...sprites[name].lookr, w: 0 } } } });
  assert.ok(!broken.includes('class="eyr"') && broken.includes('class="wink"'));
  // Стили: видна, пока на рисунке слово «смотрит вправо / влево»; страница ставит его и тогда, когда она стоит прямо
  // перед окном (головой вертеть некуда) — если у позы есть такие глаза.
  const css = readFileSync(new URL("../miniapp/index.html", import.meta.url), "utf8");
  assert.ok(css.includes("#room .eyl, #room .eyr { opacity: 0; transition: opacity 0.2s ease-in-out; }") && css.includes("#room .look-l .eyl, #room .look-r .eyr { opacity: 1; }"));
  const app = readFileSync(new URL("../miniapp/app.js", import.meta.url), "utf8");
  assert.match(app, /if \(Math\.abs\(toX - herX\) < 14\) \{[^}]*const eyes = to === "win" \? sprites\[spriteOf\(viewOf\(state\)\)\] : null;\s*if \(!eyes\?\.lookr && !eyes\?\.lookl\) return false;\s*react\(eyes\.lookr \? "look-r" : "look-l", 3200\);/u);
});

