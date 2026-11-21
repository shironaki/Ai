/**
 * Надёжность комнаты (0.49.0, сообщение 48: «защита памяти комнаты», «проверка успешности сохранения», «защита от
 * повторных действий», «остановка фоновых таймеров», «единый строгий контракт между сервером и страницей», «единая
 * обработка ошибок», «журнал ошибок без секретов»).
 *
 * Браузера здесь нет: сердце — настоящее, база — стаб, у которого можно «уронить» чтение и запись одной записи;
 * страница проверяется по своим чистым функциям (`miniapp/logic.js`) и по тексту `miniapp/app.js`. То, чему нужен
 * браузер (часы страницы стоят, пока она свёрнута; журнал открывается нажатием), проверяет `scripts/room-check.mjs`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { heart, message, reset, last, sdk, OWNER, KEY } from "./fixtures/kit.mjs";
import { db } from "./fixtures/sdk-stub.mjs";

const room = await import("../tgcloud/lib/room.js");
const logic = await import("../miniapp/logic.js");
const scene = await import("../miniapp/scene.js");
const { createHeartStore } = await import("../tgcloud/lib/store.js");

const ROOT = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const ON = { PHRASES: true };
// 18.11.2026, 14:00 по Москве: день, она не спит.
const NOON = Date.parse("2026-11-18T11:00:00Z");
const from = (id) => ({ ...KEY, initData: { user: { id, first_name: "Тест" } } });
const stored = (id) => sdk().kv.get(room.ROOM_KEY(id));
const clock = (start = NOON) => { let at = start; return { now: () => at, add: (ms) => { at += ms; } }; };
/** Уронить базу для одной записи: `get` — чтение, `run` — запись. Возвращает, как вернуть всё на место. */
function breakDb(method, key) {
  const real = db[method];
  db[method] = async (query, params = {}) => { if (params[":key"] === key) throw new Error("база не ответила"); return real(query, params); };
  return () => { db[method] = real; };
}

test("память комнаты: сбой чтения — это не «новая комната»; запись не стирается ни страницей, ни чатом", async () => {
  reset();
  const time = clock();
  const h = heart(ON, { now: time.now, random: () => 0 });
  await h.onRoom({ do: "look" }, from(5));
  await h.onRoom({ do: "feed" }, from(5));
  await h.onRoom({ do: "tea" }, from(5));
  const before = stored(5);
  assert.ok(JSON.parse(before).care === 1 && JSON.parse(before).n === 1, "в записи — заход и забота");

  const mend = breakDb("get", room.ROOM_KEY(5));
  try {
    time.add(60_000);
    // «Погладить её» здесь нет: едва знакомому она не даётся и до памяти дело не доходит.
    for (const input of [{ do: "look" }, { do: "look", again: true }, { do: "feed" }, { do: "book" }, { do: "window" }, { do: "lamp" }, { do: "music" }, { do: "call" }, { do: "quiet" }, { do: "wear" }, { do: "brew" }]) {
      const reply = await h.onRoom(input, from(5));
      assert.deepEqual([reply.ok, reply.code], [false, "storage"], `${input.do}: память не ответила — отказ, а не пустая комната`);
      assert.match(reply.text, /[Пп]амять комнаты/u, input.do);
    }
    // В чате — то же: она говорит как есть, а не «спасибо».
    for (const words of ["покорми Байта", "зайду к тебе"]) {
      await h.onMessage(message(words), KEY);
      assert.match(last(), /Память комнаты сейчас не отвечает/u, words);
    }
  } finally { mend(); }
  assert.equal(stored(5), before, "после сбоя запись — та же, до байта");
  // База ожила — комната та же: заход второй, а не первый.
  const back = await h.onRoom({ do: "look" }, from(5));
  assert.deepEqual([back.ok, back.first, JSON.parse(stored(5)).n], [true, false, 2]);
});

test("сохранение: запись не легла — отказ «не запомнилось», а не «сделано»; повтор после починки проходит", async () => {
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  await h.onRoom({ do: "look" }, from(5));
  const before = stored(5);
  const mend = breakDb("run", room.ROOM_KEY(5));
  try {
    for (const input of [{ do: "feed" }, { do: "tea", kind: "улун" }, { do: "book" }, { do: "window" }, { do: "music" }, { do: "quiet" }, { do: "wear" }, { do: "brew" }]) {
      const reply = await h.onRoom(input, from(5));
      assert.deepEqual([reply.ok, reply.code], [false, "storage"], input.do);
      assert.match(reply.text, /не запомнилось/u, input.do);
    }
  } finally { mend(); }
  assert.equal(stored(5), before, "ничего не записано");
  const fed = await h.onRoom({ do: "feed" }, from(5));
  assert.deepEqual([fed.ok, fed.again, JSON.parse(stored(5)).done.feed], [true, false, 1], "после починки забота первая, а не «ещё раз»");
});

test("повтор действия: тот же номер второй раз ничего не меняет — в ответ комната как она есть", async () => {
  reset();
  const time = clock();
  const h = heart(ON, { now: time.now, random: () => 0 });
  const look = await h.onRoom({ do: "look" }, from(5));
  assert.equal(look.once, true, "сердце говорит странице, что номера помнит");
  // Окно: открыли; ответ «не дошёл», страница повторила с тем же номером — окно осталось открытым.
  const opened = await h.onRoom({ do: "window", id: "abc123defg" }, from(5));
  assert.deepEqual([opened.ok, opened.open, opened.repeat], [true, true, undefined]);
  time.add(21_000);
  const twice = await h.onRoom({ do: "window", id: "abc123defg" }, from(5));
  assert.deepEqual([twice.ok, twice.do, twice.repeat, twice.again, twice.open], [true, "look", true, true, true], "повтор — не второе нажатие");
  assert.ok(twice.her && twice.clock && twice.cat, "в ответе на повтор — вся комната");
  assert.ok(JSON.parse(stored(5)).open > 0, "в записи окно открыто");
  // Музыка и тихий час — то же: повтор не выключает.
  for (const [op, field] of [["music", "music"], ["quiet", "quiet"]]) {
    const id = `${op}000111aa`;
    const first = await h.onRoom({ do: op, id }, from(5));
    assert.equal(first.ok, true, op);
    const kept = JSON.stringify(JSON.parse(stored(5))[field]);
    const again = await h.onRoom({ do: op, id }, from(5));
    assert.equal(again.repeat, true, op);
    assert.equal(JSON.stringify(JSON.parse(stored(5))[field]), kept, `${op}: запись не тронута`);
  }
  // Зов Байта: повтор его не спугивает (второй зов за полминуты — «удрал»).
  const bare = room.createRoom({ store: createHeartStore({ db, now: time.now }), now: time.now });
  const called = await bare.call(6, { day: "2026-11-18", id: "call000001" }), calledTwice = await bare.call(6, { day: "2026-11-18", id: "call000001" });
  assert.deepEqual([called.again, called.repeat, calledTwice.repeat, JSON.parse(stored(6)).call > 0], [false, undefined, true, true]);
  assert.equal((await bare.call(6, { day: "2026-11-18", id: "call000002" })).again, true, "а второй зов человека — спугивает, как и раньше");
  // Забота с тем же номером не считается дважды; с другим — «ещё раз», как и раньше.
  await h.onRoom({ do: "feed", id: "feed000001" }, from(5));
  assert.equal((await h.onRoom({ do: "feed", id: "feed000001" }, from(5))).repeat, true);
  assert.equal(JSON.parse(stored(5)).done.feed, 1);
  assert.equal((await h.onRoom({ do: "feed", id: "feed000002" }, from(5))).again, true);
  // Новое нажатие (другой номер) окно закрывает: защита — от повтора, а не от человека.
  const shut = await h.onRoom({ do: "window", id: "zzz999yyy8" }, from(5));
  assert.deepEqual([shut.ok, shut.open], [true, false]);
  // Номер помнится десять минут и не длиннее; негодный номер — как без номера.
  time.add(room.OPS_KEEP_MS + 1000);
  assert.equal((await h.onRoom({ do: "window", id: "abc123defg" }, from(5))).repeat, undefined, "через десять минут номер забыт");
  assert.equal((await h.onRoom({ do: "window", id: "!!" }, from(5))).ok, true);
  assert.ok(JSON.parse(stored(5)).ops.length <= room.OPS_MAX);
});

test("предел частоты: двенадцать действий за двадцать секунд — тринадцатое подождёт; чат предела не знает", async () => {
  reset();
  const time = clock();
  const h = heart(ON, { now: time.now, random: () => 0 });
  await h.onRoom({ do: "look" }, from(5));
  for (let index = 0; index < room.RUSH_MAX; index += 1) { time.add(100); assert.equal((await h.onRoom({ do: "window" }, from(5))).ok, true, String(index)); }
  const slow = await h.onRoom({ do: "feed" }, from(5));
  assert.deepEqual([slow.ok, slow.code], [false, "slow"]);
  assert.equal(JSON.parse(stored(5)).done.feed, undefined, "действие сверх предела не выполнено");
  time.add(room.RUSH_MS + 1000);
  assert.equal((await h.onRoom({ do: "feed" }, from(5))).ok, true, "через двадцать секунд — снова можно");
});

test("две правки в одну секунду не затирают друг друга (страница и чат, два телефона)", async () => {
  reset();
  const store = createHeartStore({ db, now: () => NOON });
  const one = room.createRoom({ store, now: () => NOON }), two = room.createRoom({ store, now: () => NOON });
  await one.visit(5, { day: "2026-11-18" });
  await Promise.all([one.care(5, "feed", { day: "2026-11-18" }), two.care(5, "tea", { day: "2026-11-18" }), one.air(5, { day: "2026-11-18" }), two.book(5, { day: "2026-11-18" }), one.care(5, "pet", { day: "2026-11-18" })]);
  const state = JSON.parse(stored(5));
  assert.deepEqual([state.done.feed, state.done.tea, state.done.pet, state.open > 0, state.book > 0, state.care], [1, 1, 1, true, true, 1], "легли все пять правок, забота дня посчитана один раз");
  // Хранилища нет вовсе — комната отвечает, но не пишет; это не «память не ответила».
  const bare = room.createRoom({ store: { available: false }, now: () => NOON });
  const care = await bare.care(5, "pet", { day: "2026-11-18" });
  assert.deepEqual([care.ok, care.saved, care.lost], [true, false, undefined]);
  // Запись испорчена (не объект) — читается как пустая, а не роняет комнату.
  sdk().kv.set(room.ROOM_KEY(7), JSON.stringify("мусор"));
  assert.deepEqual([(await one.read(7)).n, (await one.read(7)).lost], [0, undefined]);
});

test("страница: отказ «на время» — комната остаётся, кнопка «ещё раз» и пометка «нет связи»; отказ по делу — без них", () => {
  const ready = { ...logic.blank(14), ready: true, said: "Пью чай.", lines: { her: "Пью чай.", things: {} }, busy: "tea" };
  for (const code of ["timeout", "error", "empty", "storage", "runtime_error", "slow", "NETWORK_ERROR", "ENDPOINT_ERROR"]) {
    const next = logic.applyCare(ready, "tea", { ok: false, code, text: "Не вышло." });
    assert.deepEqual([next.ready, next.retry, next.down, next.tone, next.busy, next.said], [true, true, true, "warn", "", "Не вышло."], code);
    assert.equal(logic.transient({ ok: false, code }), true, code);
  }
  for (const code of ["auth", "off", "closed", "unknown", "played", "gone", "UNAUTHORIZED", "NOT_FOUND"]) {
    const next = logic.applyCare(ready, "tea", { ok: false, code, text: "Нет." });
    assert.deepEqual([next.retry, next.down], [false, false], code);
  }
  // Сама страница повторяет только то, что могло не дойти: память и сбой сердца — нет.
  assert.deepEqual(["timeout", "empty", "error", "NETWORK_ERROR", "storage", "runtime_error", "slow", "auth"].map(code => logic.resend({ ok: false, code })), [true, true, true, true, false, false, false, false]);
  assert.equal(logic.transient({ ok: true }), false);
  assert.equal(logic.transient(null), false);
});

test("страница: ответ на повтор показывает комнату как она есть; вход снимает «нет связи»", async () => {
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  const entered = logic.applyLook(logic.blank(14), await h.onRoom({ do: "look" }, from(5)), NOON);
  assert.deepEqual([entered.once, entered.down], [true, false]);
  await h.onRoom({ do: "window", id: "abc123defg" }, from(5));
  const reply = await h.onRoom({ do: "window", id: "abc123defg" }, from(5));
  const next = logic.applyRepeat({ ...entered, busy: "window", down: true, retry: true, tone: "warn", said: "Комната не ответила." }, reply, NOON);
  assert.deepEqual([next.open, next.busy, next.down, next.retry, next.tone], [true, "", false, false, ""]);
  assert.equal(next.said, next.lines.her, "слова — её нынешняя реплика, а не старый отказ");
  assert.equal(logic.applyRepeat(entered, { ok: false, code: "timeout", text: "Нет." }, NOON).down, true);
});

test("журнал ошибок: без подписи Telegram, адресов и длинных чисел; двадцать записей; хозяин читает его словами", async () => {
  const dirty = "fetch https://app.tgcloud.ai/room?tgWebAppData=query_id%3DAAH&user=%7B%22id%22%3A123456789%7D&hash=0123456789abcdef0123456789abcdef упал у 987654321";
  const clean = logic.scrub(dirty);
  for (const secret of ["tgWebAppData", "query_id", "123456789", "987654321", "0123456789abcdef", "https://", "hash="]) assert.ok(!clean.includes(secret), `${secret}: ${clean}`);
  assert.ok(clean.length <= 140);
  let list = [];
  for (let index = 0; index < 30; index += 1) list = logic.oopsAdd(list, "tea", "timeout", `сбой ${index} ${dirty}`, index);
  assert.equal(list.length, logic.OOPS_MAX);
  assert.ok(list.every(item => !/tgWebAppData|123456789/u.test(JSON.stringify(item))));
  const twice = logic.oopsAdd(logic.oopsAdd([], "вход", "timeout", "Комната не ответила", 5), "вход", "timeout", "Комната не ответила", 9);
  assert.deepEqual(twice, [{ at: 9, where: "вход", code: "timeout", text: "Комната не ответила", n: 2 }], "та же ошибка подряд — одна строка со счётчиком");

  reset();
  const time = clock();
  const h = heart(ON, { now: time.now, random: () => 0 });
  await h.onRoom({ do: "look" }, from(5));
  const sent = await h.onRoom({ do: "oops", page: "12", items: [{ where: "tea", code: "timeout", text: dirty }, { where: "вход", code: "script", text: "x is not defined app.js:12" }, {}, { code: "a" }, { code: "b" }] }, from(5));
  assert.deepEqual([sent.ok, sent.kept], [true, 2], "принимается не больше трёх записей, пустые — мимо");
  const log = JSON.parse(sdk().kv.get(room.ROOM_OOPS_KEY));
  assert.equal(log.length, 2);
  assert.ok(!/123456789|tgWebAppData|https:/u.test(JSON.stringify(log)), "сердце вычищает и то, что прислала чужая страница");
  assert.ok(log.every(item => !("user" in item) && !("id" in item) && item.owner === false && item.page === "12"), "кто зашёл — не пишется: только «хозяин или гость»");
  // Чаще раза в десять минут от человека — не принимается.
  assert.equal((await h.onRoom({ do: "oops", items: [{ code: "again", text: "ещё" }] }, from(5))).kept, 0);
  time.add(room.OOPS_EVERY_MS + 1000);
  assert.equal((await h.onRoom({ do: "oops", items: [{ code: "later", text: "позже" }] }, from(5))).kept, 1);
  // Хранится тридцать записей.
  for (let index = 0; index < 40; index += 1) { time.add(room.OOPS_EVERY_MS + 1000); await h.onRoom({ do: "oops", items: [{ code: `c${index}`, text: "т" }] }, from(5)); }
  assert.equal(JSON.parse(sdk().kv.get(room.ROOM_OOPS_KEY)).length, room.OOPS_KEEP);
  // Хозяин — словами; гостю журнал не показывается.
  await h.onMessage(message("ошибки комнаты", { id: OWNER }), KEY);
  assert.match(last(OWNER), /Последние ошибки страницы комнаты \(8\):/u);
  assert.match(last(OWNER), /• 18\.11 20:50 · страница \?, сердце \S+ · у гостя · c39 · т$/u);
  await h.onMessage(message("ошибки комнаты"), KEY);
  assert.equal(last(), "Журнал страницы — для хозяина.");
  reset();
  const empty = heart(ON, { now: () => NOON, random: () => 0 });
  await empty.onMessage(message("ошибки комнаты", { id: OWNER }), KEY);
  assert.equal(last(OWNER), "Страница комнаты ошибок не присылала.");
});

test("страница: действия идут с номером и через одну дверь; свёрнутая страница останавливает все свои часы", () => {
  const app = read("miniapp/app.js");
  // Напрямую сердце зовут только вход, сверка, отчёт об ошибках, перечитывание открытого альбома (оно ничего не
  // меняет) и сама «дверь» действий.
  const direct = [...app.matchAll(/(?<![a-zA-Z])call\(\{ ([^}]*)\}\)/gu)].map(found => found[1].trim());
  assert.deepEqual(direct.sort(), ['...input, id', '...input, id', 'do: "album"', 'do: "look"', 'do: "look", again: true', 'do: "oops", page: PAGE, items'].sort());
  const sends = [...app.matchAll(/await send\(\{ do: ("[a-z]+"|name)/gu)].map(found => found[1]);
  assert.deepEqual(sends.sort(), ['"album"', '"book"', '"brew"', '"call"', '"gift"', '"lamp"', '"music"', '"pat"', '"pick"', '"quiet"', '"snap"', '"wear"', '"window"', "name"].sort(), "каждое действие — через `send`");
  // Разбор ответа на повтор — у каждого действия, которое что-то меняет (альбом только читается).
  assert.equal((app.match(/if \(repeated\(result\)\) return;/gu) ?? []).length, sends.length - 1, "и у каждого — разбор ответа на повтор");
  // Кнопка «ещё раз» шлёт то же действие с тем же номером: дошедшее в прошлый раз второй раз не выполнится.
  assert.match(app, /if \(redo && state\.ready\) \{ sameId = \{ id: redo\.id, op: redo\.op \}; redo\.run\(\); \} else enter\(\);/u);
  assert.match(app, /id = sameId && sameId\.op === name \? sameId\.id : newId\(\);/u);
  // Повтор шлётся только сердцу, которое помнит номера.
  assert.match(app, /state\.once && typeof logic\.resend === "function" && logic\.resend\(result\)/u);
  // Все часы страницы названы в `rest` — и ни один не заводится, пока она свёрнута.
  const timers = [...new Set([...app.matchAll(/\b([a-z]+Timer) = set(?:Timeout|Interval)\(/gu)].map(found => found[1]))].sort();
  assert.deepEqual(timers, ["frameTimer", "quietTimer", "retryTimer", "tickTimer", "tuneTimer", "turnTimer"]);
  const rest = app.slice(app.indexOf("function rest() {"), app.indexOf("function wake() {"));
  for (const timer of timers) assert.ok(rest.includes(timer), `${timer}: останавливается, когда страница свёрнута`);
  assert.match(rest, /classList\.add\("resting"\)/u);
  assert.match(app, /document\.addEventListener\("visibilitychange", \(\) => \(document\.hidden \? rest\(\) : wake\(\)\)\);/u);
  assert.match(read("miniapp/index.html"), /\.resting #room \*, \.resting #sky \*, \.resting \.rainbox \* \{ animation-play-state: paused !important; \}/u);
  // Журнал: то, что уходит сердцу, — без того, кто зашёл.
  assert.ok(!/initData/u.test(app.slice(app.indexOf("// ── Журнал ошибок страницы"), app.indexOf("/** Вызов функции сердца."))), "в журнале подписи Telegram нет");
});

test("страница: её картинки грузятся по одной, когда нужны; в шапках файлов нет номера сборки", () => {
  const app = read("miniapp/app.js"), html = read("miniapp/index.html");
  assert.equal((app.match(/import\(`\.\/her\/\$\{name\}\.js`\)/gu) ?? []).length, 1, "картинка — отдельным модулем, по имени");
  for (const [name, text] of [["app.js", app], ["logic.js", read("miniapp/logic.js")], ["scene.js", read("miniapp/scene.js")], ["sound.js", read("miniapp/sound.js")]]) {
    assert.ok(!/^import [^;]*\.\/her\//mu.test(text), `${name}: картинки заранее не подключаются`);
    assert.ok(!/сборка \d+\.\d+/u.test(text.slice(0, text.indexOf("*/"))), `${name}: в шапке нет номера сборки — он устаревает (сообщение 48)`);
  }
  assert.ok(!/her\//u.test(html.replace(/<!--[\s\S]*?-->/gu, "")), "разметка картинок не называет");
  assert.ok(!/сборка \d+\.\d+/u.test(html.slice(0, html.indexOf("-->"))), "index.html: в шапке нет номера сборки");
  // Картинка в пути — силуэт с точками, а не пустое место.
  const waiting = scene.drawRoom({ part: "день", her: { key: "дело", pose: "desk" } }, { sprites: {} });
  assert.match(waiting, /class="coming" role="img" aria-label="Аи появляется"/u);
  const coded = scene.drawRoom({ part: "день", her: { key: "дело", pose: "desk" } }, { sprites: { work: false } });
  assert.ok(!coded.includes('class="coming"'), "не загрузилась — нарисована кодом, силуэта нет");
});

/**
 * Договор сердца и страницы (0.49.0): какие поля несёт ответ «зайти» и кто их читает. Страница и сердце
 * публикуются порознь, поэтому на самой странице строгости нет — старая копия должна понимать новую; строгость —
 * здесь: новое поле без строки в этом списке или поле, которое страница перестала читать, — красный тест.
 */
const isText = (value) => typeof value === "string";
const isFlag = (value) => typeof value === "boolean";
const isCount = (value) => Number.isFinite(value) && value >= 0;
const LOOK = {
  ok: [(value) => value === true, "page"], do: [(value) => value === "look", "only-heart: страница знает, что спрашивала"],
  build: [isText, "page"], formal: [isFlag, "only-heart: «вы» или «ты» уже в самих словах"], once: [(value) => value === true, "page"],
  again: [isFlag, "only-heart: отметка, что это сверка"], repeat: [isFlag, "page"], step: [isCount, "page"],
  clock: [(value) => scene.PARTS.includes(value.part) && Number.isInteger(value.hour) && /^\d{4}-\d\d-\d\d$/u.test(value.day) && value.left > 0 && value.lightLeft >= value.left && (value.light === undefined || scene.PARTS.includes(value.light)), "page"],
  wardrobe: [(value) => isText(value.leave) && isText(value.back), "page"], greet: [isText, "page"], window: [isText, "page"],
  sky: [(value) => scene.SKIES.includes(value), "page"], city: [isFlag, "only-heart: настоящая ли погода — для тестов и хозяина"],
  box: [(value) => value && isText(value.line), "page"], patted: [isFlag, "page"],
  her: [(value) => scene.HER_POSES.includes(value.pose) && Object.hasOwn(scene.MOODS, value.key) && isText(value.line) && Array.isArray(value.beats) && value.steady === true && value.left > 0 && isText(value.stage) && scene.HER_WEARS.includes(value.wear), "page"],
  cat: [(value) => scene.CAT_SHAPES.includes(value.shape) && scene.CAT_PLACES.includes(value.place) && isText(value.key) && isText(value.line) && Array.isArray(value.beats), "page"],
  plant: [(value) => ["wet", "dry"].includes(value.state), "page"], done: [(value) => Object.values(value).every(isCount), "page"],
  cared: [isFlag, "only-heart: была ли сегодня забота — страница считает по `done`"], owner: [isFlag, "page"], open: [isFlag, "page"],
  kind: [(value) => logic.BREWS.includes(value), "page"], kinds: [(value) => Array.isArray(value) && value.every(kind => logic.BREWS.includes(kind)), "page"],
  offer: [(value) => value.kind === "tea" && isText(value.text) && isText(value.id), "page"], dark: [isFlag, "page"], music: [isCount, "page"],
  brew: [(value) => logic.BREWS.includes(value), "page"], quiet: [isCount, "page"], quietEnd: [isText, "page"],
  things: [(value) => Array.isArray(value) && value.every(item => isText(item.key) && isText(item.title) && isText(item.line)), "page"],
  lamp: [isText, "page"], drawing: [isText, "only-heart: подпись рисунка уже в строке вещи"], fresh: [Array.isArray, "page"],
  next: [(value) => value === null || value.days > 0, "page"], scene: [(value) => value === null || (isText(value.key) && Array.isArray(value.options)), "page"],
  first: [isFlag, "only-heart: первый ли заход — слова приветствия уже другие"],
  // 0.49.0: её вещи, подарки, альбом, событие дня, сценка встречи.
  own: [(value) => isCount(value.sketches) && value.sketches <= 3 && isFlag(value.book) && isFlag(value.card), "page"],
  gifts: [(value) => Array.isArray(value) && value.every(kind => logic.GIFT_KINDS.includes(kind)), "page"],
  album: [(value) => isCount(value.count) && isCount(value.fresh), "page"], event: [isText, "page"],
  story: [(value) => Array.isArray(value) && value.length > 0 && value.every(beat => isText(beat.line) && beat.line), "page"],
};
test("договор сердца и страницы: каждое поле ответа «зайти» описано, годно и прочитано страницей", async () => {
  const source = `${read("miniapp/logic.js")}\n${read("miniapp/app.js")}`;
  for (const [name, [, reader]] of Object.entries(LOOK)) {
    if (reader === "page") assert.match(source, new RegExp(`result\\.${name}\\b`, "u"), `${name}: страница это поле читает`);
    else assert.match(reader, /^only-heart: \S/u, `${name}: названо, почему страница его не читает`);
  }
  const seen = new Set();
  for (const [hour, id] of [[11, 5], [5, OWNER], [15, 6], [20, 7]]) {
    reset();
    const time = clock(Date.parse(`2026-11-18T${String(hour).padStart(2, "0")}:00:00Z`));
    const h = heart(ON, { now: time.now, random: () => 0 });
    for (const input of [{ do: "look" }, { do: "look", again: true }]) {
      const reply = await h.onRoom(input, from(id));
      assert.equal(reply.ok, true, JSON.stringify(reply).slice(0, 200));
      for (const [name, value] of Object.entries(reply)) {
        assert.ok(Object.hasOwn(LOOK, name), `поле «${name}» в ответе сердца не описано в договоре`);
        assert.ok(LOOK[name][0](value), `${name}: ${JSON.stringify(value).slice(0, 160)}`);
        seen.add(name);
      }
      // Страница принимает ответ целиком и остаётся в рабочем виде.
      const state = logic.applyLook(logic.blank(14), reply, time.now());
      assert.deepEqual([state.ready, state.tone, state.her.pose, state.sky], [true, "", reply.her.pose, reply.sky]);
    }
    // Ответ на повтор — тот же договор.
    await h.onRoom({ do: "window", id: "abc123defg" }, from(id));
    const twice = await h.onRoom({ do: "window", id: "abc123defg" }, from(id));
    for (const [name, value] of Object.entries(twice)) { assert.ok(Object.hasOwn(LOOK, name) && LOOK[name][0](value), `повтор: ${name}`); seen.add(name); }
  }
  // Поля, которых эти заходы не дали (предложение чая, слова конца тихого часа), проверены в `tests/alive.test.mjs`.
  assert.deepEqual(Object.keys(LOOK).filter(name => !seen.has(name)).sort(), ["event", "offer", "quietEnd", "story"]);
});

test("дверь комнаты вынесена из сердца: списки имён у двери и у сердца совпадают, лишних нет; запас веса сердца назван", async () => {
  const { readFileSync } = await import("node:fs");
  const { slim } = await import("../scripts/slim.mjs");
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const door = read("tgcloud/lib/roomdoor.js"), heartCode = read("tgcloud/lib/heart.js");
  const list = (text) => text.split(",").map(name => name.trim()).filter(Boolean);
  const wanted = list(door.match(/const \{\n([\s\S]*?)\n {2}\} = deps;/u)[1]);
  const given = list(heartCode.match(/createRoomDoor\(\{\n([\s\S]*?)\n {2}\}\)\)\(input, ctx\);/u)[1]);
  assert.deepEqual(given, wanted, "сердце даёт двери ровно то, что она берёт");
  assert.equal(new Set(wanted).size, wanted.length, "без повторов");
  const body = door.slice(door.indexOf("} = deps;"));
  for (const name of wanted) assert.match(body, new RegExp(`(?<![.\\w$])${name.replace(/\$/gu, "\\$")}(?![\\w$])`, "u"), `«${name}» двери не нужно — убрать из обоих списков`);
  assert.ok(!/from "\.\/heart\.js"/u.test(door), "дверь не тянет сердце обратно: всё нужное приходит через deps");
  assert.match(heartCode, /import \{ createRoomDoor \} from "\.\/roomdoor\.js";/u);
  // Запас сердца до предела веса модуля — не меньше двадцати килобайт: меньше — выносить следующую часть комнаты
  // (`roomWords`, `herState`, `herStep`) до выпуска, а не после (сообщение 49: запас оказался три килобайта).
  const weight = Buffer.byteLength(slim(heartCode));
  assert.ok(weight < 620_000, `heart.js после облегчения — ${weight} байт: до предела в 640 000 осталось меньше двадцати килобайт`);
});
