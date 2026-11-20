/**
 * Сборка 0.44.0 — «чтоб она казалась живой» (сообщение 40 владельца, со скриншотом комнаты).
 *
 * Его слова — и что здесь проверяется:
 *   «почему постоянно идёт дождь? …какая погода у меня в городе, такая и у неё; если не знает — случайная» — небо;
 *   «в тексте кот перевернулся на спину, а по факту нет», «кот сел сторожить подоконник, но лежит на полу» —
 *     Байт на рисунке там и такой, как о нём сказано: в словах заботы и в исходе сценки;
 *   «название не просклонено» («Мекку» вместо «Мекка») — подпись рисунка;
 *   «она садится во что-то, что появляется вместе с ней» — она сидит в кресле комнаты;
 *   «плавный переход … дошла до шкафа и потом сцена „переодевается“» — смена часа при открытой странице;
 *   «она с котом жила своей жизнью … чтоб она казалась живой» — распорядок: она и Байт сами переходят к
 *     следующему занятию, а слова под рисунком — о том, что на нём сейчас.
 *
 * Модули берутся целиком (`room.`, `logic.`, `scene.`): на коде прежней сборки каждый тест падает сам, своим
 * словом («room.randomSky is not a function»), а не весь файл разом на первой строке.
 * Что видно только в браузере (она идёт, дышит, комната перетекает из дня в вечер) — в `verify.sh page`, шаг 8.
 */
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { heart, message, reset, sdk, last, toChat, chats, source, KEY, OWNER, BUILD } from "./fixtures/kit.mjs";
import { db as stubDb } from "./fixtures/sdk-stub.mjs";

import * as room from "../tgcloud/lib/room.js";
import * as logic from "../miniapp/logic.js";
import * as scene from "../miniapp/scene.js";
import { createPhrasebook, SECTIONS } from "../tgcloud/lib/phrasebook.js";
import { ALBUM_KEY } from "../tgcloud/lib/draw.js";
import { prayersOn } from "../tgcloud/lib/fajr.js";

const ON = { PHRASES: true };
const HOUR = 3_600_000;
// 18.11.2026, 14:00 по Москве: день, она не спит, Байт не спит.
const NOON = Date.parse("2026-11-18T11:00:00Z");
const TODAY = "2026-11-18";
const VARS = { "цвет": "синий", "рисунок": "кот в шляпе", "что нарисовать": "кота в шляпе", "лет": "2 года", "праздник": "Рамадан", "трофеи": "носок", "число": "1" };
const book = createPhrasebook({ random: () => 0 });
/** Запас комнаты целиком, как записан, — и только строки, годные сейчас (пометки часа и неба). */
const pool = (name, ctx = {}) => book.pool(`+комната:${name}`, { formal: true, vars: VARS, ...ctx });
const fitting = (name, ctx = {}) => book.all(`+комната:${name}`, { formal: true, isPrivate: true, vars: VARS, ...ctx });
const WINDOW = Object.freeze({ clear: "окно:ясно", clouds: "окно:облачно", overcast: "окно:пасмурно", fog: "окно:туман", rain: "окно", storm: "окно:гроза", snow: "окно:снег" });
const from = (id, extra = {}) => ({ ...KEY, initData: { user: { id, first_name: "Тест" } }, ...extra });
const roomOf = (id) => JSON.parse(sdk().kv.get(room.ROOM_KEY(id)) ?? "null");
const clock = (start = NOON) => { let at = start; return { now: () => at, add: (ms) => { at += ms; }, set: (value) => { at = value; } }; };
const madeUpSky = (id, at = NOON, month = 11) => room.randomSky({ seed: room.seedOf(id, "sky"), at, month });
/** Гость, у которого сегодня именно эта сценка (при той погоде, какую она ему выдумала). */
const guestWith = (key, at = NOON, day = TODAY) => { for (let id = 100; id < 2000; id += 1) if (room.sceneFor(id, day, madeUpSky(id, at)).key === key) return id; throw new Error(`нет гостя со сценкой ${key}`); };
const plain = (text) => text.replace(/\{[^|}]*\|([^}]*)\}/gu, "$1");
/** Её картинки — те самые модули, что грузит страница. */
const SPRITES = Object.fromEntries(await Promise.all(Object.keys(scene.HER_SPRITES).map(async (name) => [name, (await import(`../miniapp/her/${name}.js`)).default])));
const PAINTED = { sprites: SPRITES };
const classesOf = (markup) => new Set([...markup.matchAll(/class="([^"]+)"/gu)].flatMap(found => found[1].split(" ")));
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// ── небо ────────────────────────────────────────────────────────────────────

test("небо 0.44.0: код службы погоды — вид неба; города нет — погода выдумана: одна на шесть часов, у каждого своя, по времени года", () => {
  assert.deepEqual([...room.SKIES], ["clear", "clouds", "overcast", "fog", "rain", "storm", "snow"]);
  // Одни и те же слова знают сердце, раскладка страницы и рисунок: назови сердце небо иначе — страница покажет дождь.
  assert.deepEqual([...scene.SKIES], [...room.SKIES]);
  assert.deepEqual([...logic.SKIES], [...room.SKIES]);

  // Таблица ВМО (её же читает «погода в …», `sources.js`).
  const table = { clear: [0, 1], clouds: [2], overcast: [3], fog: [45, 48], rain: [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82], snow: [71, 73, 75, 77, 85, 86], storm: [95, 96, 99] };
  for (const [sky, codes] of Object.entries(table)) for (const code of codes) assert.equal(room.skyOfCode(code), sky, String(code));
  assert.equal(room.skyOfCode("61"), "rain", "код строкой — тот же код");
  assert.equal(room.skyOfCode(4), "overcast", "незнакомый код — пасмурно: ни дождя, ни солнца не выдумывать");
  // Кода нет — неба не знаем. Пустое не должно стать «ясно»: у нуля в таблице именно этот смысл.
  for (const none of [undefined, null, "", NaN, "ясно", true, false, {}]) assert.equal(room.skyOfCode(none), null, String(none));

  // Выдуманная погода держится шесть часов: комната не меняет небо при каждом заходе.
  assert.equal(room.SKY_SPAN_MS, 6 * HOUR);
  const span = Math.floor(NOON / room.SKY_SPAN_MS) * room.SKY_SPAN_MS;
  for (const id of [5, 7, 100, 12345]) {
    const first = madeUpSky(id, span);
    assert.ok(room.SKIES.includes(first), first);
    for (const shift of [1, 60_000, HOUR, 3 * HOUR, room.SKY_SPAN_MS - 1]) assert.equal(madeUpSky(id, span + shift), first, `${id}: +${shift}`);
  }
  // …но не вечно: за десять суток небо у человека меняется, и не у всех оно одно.
  const tenDays = (id, month = 11) => Array.from({ length: 40 }, (_, step) => madeUpSky(id, span + step * room.SKY_SPAN_MS, month));
  for (const id of [5, 7, 100]) assert.ok(new Set(tenDays(id)).size >= 3, `${id}: ${[...new Set(tenDays(id))].join(", ")}`);
  assert.ok(new Set([5, 6, 7, 8, 9, 10, 11, 12].map(id => madeUpSky(id, span))).size >= 2, "у разных людей в один час — разная погода");

  // По времени года: зимой грозы нет и чаще всего снег; летом снега нет и чаще всего ясно; весной и осенью — дождь.
  const year = (month) => { const seen = {}; for (let id = 1; id <= 60; id += 1) for (const sky of tenDays(id, month)) seen[sky] = (seen[sky] ?? 0) + 1; return seen; };
  const most = (seen) => Object.entries(seen).sort((a, b) => b[1] - a[1])[0][0];
  for (const month of [12, 1, 2]) { const seen = year(month); assert.equal(most(seen), "snow", `${month}: ${JSON.stringify(seen)}`); assert.equal(seen.storm, undefined, `${month}: гроза зимой`); }
  for (const month of [6, 7, 8]) { const seen = year(month); assert.equal(most(seen), "clear", `${month}: ${JSON.stringify(seen)}`); assert.equal(seen.snow, undefined, `${month}: снег летом`); }
  for (const month of [3, 4, 5, 9, 10, 11]) { const seen = year(month); assert.equal(most(seen), "rain", `${month}: ${JSON.stringify(seen)}`); assert.equal(seen.snow, undefined, `${month}: снег без города осенью и весной не выдумывается`); }
  // Каждое небо, кроме снега, осенью случается: дождь — самое частое, но не единственное (владелец видел только его).
  assert.deepEqual(Object.keys(year(11)).sort(), ["clear", "clouds", "fog", "overcast", "rain", "storm"]);
  // Без слов — тоже небо, а не ошибка.
  assert.ok(room.SKIES.includes(room.randomSky()));
});

test("небо на рисунке: семь видов — солнце и облака, звёзды и луна, туман, молния, дождь, снег; незнакомое слово — дождь, как прежде", () => {
  const rainOf = (part, sky) => ["far", "near"].map(plane => scene.drawRain(part, plane, sky)).join("");
  for (const part of scene.PARTS) {
    const backs = Object.fromEntries(scene.SKIES.map(sky => [sky, scene.drawBackdrop(part, sky, { phase: 0.5 })]));
    // У каждого неба — свой вид. Дождь и пасмурно различает то, что падает: фон у них один — тучи.
    for (const a of scene.SKIES) for (const b of scene.SKIES) {
      if (a >= b) continue;
      assert.notEqual(`${backs[a]}${rainOf(part, a)}`, `${backs[b]}${rainOf(part, b)}`, `${part}: ${a} и ${b} нарисованы одинаково`);
    }
    for (const sky of scene.SKIES) {
      assert.doesNotMatch(backs[sky], /NaN|undefined|null|Infinity|\[object/u, `${part} ${sky}`);
      // Падает — только когда идёт: дождь, гроза, снег. В ясный день за стеклом сухо.
      assert.equal(rainOf(part, sky) !== "", ["rain", "storm", "snow"].includes(sky), `${part} ${sky}`);
      const classes = classesOf(backs[sky]);
      assert.equal(classes.has("flash"), sky === "storm", `${part} ${sky}: молния — только в грозу`);
      assert.equal(classes.has("mist"), sky === "fog", `${part} ${sky}: туман`);
      assert.equal(classes.has("drift"), sky === "clear" || sky === "clouds", `${part} ${sky}: облака плывут — когда они видны по отдельности`);
      // Светила — только на открытом небе: вечером и ночью звёзды, утром, днём и на закате — солнце.
      const open = sky === "clear" || sky === "clouds";
      assert.equal(classes.has("star"), open && (part === "вечер" || part === "ночь"), `${part} ${sky}: звёзды`);
      assert.equal(/ id="[a-z]-sunGlow"/u.test(backs[sky]), open && part !== "ночь", `${part} ${sky}: солнце`);
    }
    // Гроза — тот же дождь, только с молнией; снег — не дождь.
    assert.equal(rainOf(part, "storm"), rainOf(part, "rain"));
    assert.notEqual(rainOf(part, "snow"), rainOf(part, "rain"));
    // Небо не назвали или назвали незнакомо (страница новее сердца, или наоборот) — дождь, как было всегда.
    assert.equal(scene.drawBackdrop(part), scene.drawBackdrop(part, "rain"));
    assert.equal(scene.drawBackdrop(part, "ураган"), scene.drawBackdrop(part, "rain"));
  }
  // Луна — по фазе: в полнолуние она есть, в новолуние её на небе нет; серп и полная луна — разные.
  const moonlit = (phase, sky = "clear", part = "ночь") => scene.drawBackdrop(part, sky, { phase });
  assert.match(moonlit(0.5), / id="s-moonGlow"/u);
  assert.doesNotMatch(moonlit(0.02), /moonGlow/u);
  assert.notEqual(moonlit(0.5), moonlit(0.12));
  assert.notEqual(moonlit(0.12), moonlit(0.88), "растущий серп и убывающий — в разные стороны");
  assert.equal(moonlit(0.5, "overcast"), moonlit(0.02, "overcast"), "за тучами луны не видно");
  assert.doesNotMatch(moonlit(0.5, "clear", "день"), /moonGlow/u, "днём — солнце");
  // Фазу рисунку называет страница — по дню человека из ответа сердца.
  assert.match(scene.drawRoom({ part: "ночь", sky: "clear", moon: 0.5, her: null, cat: null, things: [] }), /moonGlow/u);
  assert.doesNotMatch(scene.drawRoom({ part: "ночь", sky: "clear", moon: 0.02, her: null, cat: null, things: [] }), /moonGlow/u);
  assert.deepEqual([logic.moonOf("2026-11-24"), logic.moonOf("2026-11-09"), logic.moonOf("чепуха"), logic.moonOf(null)], [0.5, 0.98, 0.3, 0.3], "24.11.2026 — полнолуние, 9.11 — новолуние; дня нет — обычный месяц");

  // Страница: небо из ответа сердца — в описание рисунка; до ответа — ровное серое (какая погода, ещё неизвестно).
  assert.equal(logic.blank(12).sky, "overcast");
  const look = (sky) => logic.applyLook(logic.blank(12), logic.demoLook(14, { sky }), NOON);
  for (const sky of scene.SKIES) {
    const view = logic.viewOf(look(sky));
    // Слово «rain» рисунку не шлётся: прежний рисунок (копия в памяти Telegram) его не знает, а дождь рисует и так.
    assert.equal(view.sky, sky === "rain" ? undefined : sky, sky);
    assert.ok(scene.drawRoom(view).includes(scene.drawBackdrop(view.part, sky, { phase: view.moon })), `${sky}: комната рисует именно это небо`);
  }
  assert.equal(look("ураган").sky, "rain");
  assert.equal(logic.applyLook(logic.blank(12), { ...logic.demoLook(14), sky: undefined }, NOON).sky, "rain", "прежнее сердце неба не называет — дождь");
});

// ── сценка дня ──────────────────────────────────────────────────────────────

test("сценка дня 0.44.0: о дожде — только под дождём; что в ней сказано — то на рисунке, пока не сыграна, и три часа после выбора", () => {
  // Сценки о дожде и о луже под окном — только когда льёт: в сухой день берётся следующая по кругу.
  const wet = room.SCENES.filter(item => item.sky);
  assert.deepEqual(wet.map(item => item.key).sort(), ["puddle", "rain"]);
  for (const item of wet) assert.deepEqual([...item.sky].sort(), ["rain", "storm"], item.key);
  const days = Array.from({ length: 40 }, (_, step) => new Date(NOON + step * 86_400_000).toISOString().slice(0, 10));
  let skipped = 0;
  for (const id of [5, 7, 311]) for (const day of days) {
    const old = room.sceneFor(id, day);
    for (const sky of room.SKIES) {
      const now = room.sceneFor(id, day, sky);
      assert.ok(!now.sky || now.sky.includes(sky), `${id} ${day} ${sky}: ${now.key}`);
      // Под дождём и в грозу круг сценок прежний — тот же, что без слова о небе (так выбирало прежнее сердце).
      if (sky === "rain" || sky === "storm" || !old.sky) assert.equal(now.key, old.key, `${id} ${day} ${sky}`);
      else {
        skipped += 1;
        const order = room.SCENES.map(item => item.key), start = order.indexOf(old.key);
        const next = Array.from({ length: order.length }, (_, step) => room.SCENES[(start + step) % order.length]).find(item => !item.sky);
        assert.equal(now.key, next.key, `${id} ${day} ${sky}: вместо «${old.key}» — следующая по кругу`);
      }
    }
  }
  assert.ok(skipped > 0, "в сорока днях нашлась хоть одна сценка о дожде в сухую погоду");

  // Что сценка меняет на рисунке: слова рисунка и сердца — одни; каждое изменение кому-то нужно.
  assert.deepEqual([...scene.SCENE_FX], [...room.SCENE_FX]);
  const used = new Set();
  for (const item of room.SCENES) for (const look of [item.show, ...item.options.map(option => option[2])]) {
    if (!look) continue;
    assert.deepEqual(Object.keys(look).filter(name => !["cat", "her", "fx"].includes(name)), [], item.key);
    for (const name of look.fx ?? []) { assert.ok(room.SCENE_FX.includes(name), `${item.key}: ${name}`); used.add(name); }
    if (look.cat) assert.ok(room.CAT_SHAPES.includes(look.cat[0]) && room.CAT_PLACES.includes(look.cat[1]), `${item.key}: ${look.cat}`);
    if (look.her) assert.ok(room.HER_POSES.includes(look.her), `${item.key}: ${look.her}`);
  }
  assert.deepEqual([...used].sort(), [...room.SCENE_FX].sort(), "каждое изменение комнаты нужно какой-то сценке");

  // `sceneLook`: несыгранная сценка видна весь свой день; исход — три часа после выбора; потом комната живёт сама.
  const kettle = room.sceneByKey("kettle");
  assert.deepEqual(room.sceneLook({ day: TODAY, key: "kettle", pick: null }, { today: TODAY, at: NOON }), { cat: null, her: "", fx: ["haze"], since: 0 });
  assert.deepEqual(room.sceneLook({ day: TODAY, key: "kettle", pick: null }, { today: TODAY, at: NOON + 9 * HOUR }), { cat: null, her: "", fx: ["haze"], since: 0 }, "не сыграна — видна до конца дня");
  assert.deepEqual(room.sceneLook({ day: TODAY, key: "kettle", pick: 1, at: NOON }, { today: TODAY, at: NOON + HOUR }), { cat: { shape: "sit", place: "sill" }, her: "", fx: ["window"], since: NOON });
  assert.deepEqual(room.sceneLook({ day: TODAY, key: "kettle", pick: 0, at: NOON }, { today: TODAY, at: NOON }), { cat: null, her: "garland", fx: [], since: NOON });
  assert.equal(room.FRESH_MS, 3 * HOUR);
  assert.notEqual(room.sceneLook({ day: TODAY, key: "kettle", pick: 1, at: NOON }, { today: TODAY, at: NOON + room.FRESH_MS - 1 }), null);
  assert.equal(room.sceneLook({ day: TODAY, key: "kettle", pick: 1, at: NOON }, { today: TODAY, at: NOON + room.FRESH_MS }), null, "через три часа окно снова закрыто");
  assert.equal(room.sceneLook({ day: TODAY, key: "kettle", pick: 1 }, { today: TODAY, at: NOON }), null, "запись прежней сборки — без времени выбора: исход не показывается");
  assert.equal(room.sceneLook({ day: TODAY, key: "kettle", pick: 1, at: NOON + HOUR }, { today: TODAY, at: NOON }), null, "выбор «из будущего» (часы сбились) — не показывается");
  assert.equal(room.sceneLook({ day: "2026-11-17", key: "kettle", pick: null }, { today: TODAY, at: NOON }), null, "вчерашняя сценка");
  assert.equal(room.sceneLook({ day: TODAY, key: "nosuch", pick: null }, { today: TODAY, at: NOON }), null);
  assert.equal(room.sceneLook(null, { today: TODAY, at: NOON }), null);
  assert.equal(room.sceneLook({ day: TODAY, key: "book", pick: null }, { today: TODAY, at: NOON }), null, "«что почитать» в комнате ничего не меняет, пока не выбрано");
  assert.equal(kettle.show.fx[0], "haze");

  // Каждое изменение рисуется — и только названное: незнакомое слово рисунок пропускает.
  const base = { part: "день", sky: "clear", her: { pose: "desk", key: "дело" }, cat: { shape: "sit", place: "rug", key: "шалит" }, things: [] };
  const bare = scene.drawRoom(base);
  for (const name of scene.SCENE_FX) {
    const drawn = scene.drawRoom({ ...base, fx: [name] });
    assert.notEqual(drawn, bare, `${name}: рисунок не изменился`);
    assert.doesNotMatch(drawn, /NaN|undefined|null|Infinity|\[object/u, name);
  }
  assert.equal(scene.drawRoom({ ...base, fx: ["потоп", 7, null] }), bare);
  assert.equal(scene.drawRoom({ ...base, fx: "haze" }), bare, "не список — не изменение");
  // «Плед пропал» — пледа на кресле нет; «окно открыто» и «лужа» — створка открыта; «лампочка мигает» — одна, а не все.
  assert.ok(scene.drawRoom({ ...base, fx: ["noplaid"] }).length < bare.length);
  assert.ok(classesOf(scene.drawRoom({ ...base, fx: ["window"] })).has("fx-window"));
  assert.ok(classesOf(scene.drawRoom({ ...base, fx: ["puddle"] })).has("fx-window"), "лужа натекла из открытого окна");
  assert.equal((scene.drawRoom({ ...base, part: "вечер", fx: ["blink"] }).match(/class="[^"]*\brogue\b/gu) ?? []).length, 1);
  assert.equal((bare.match(/class="[^"]*\brogue\b/gu) ?? []).length, 0);
});

test("функция комнаты 0.44.0: исход сценки виден на рисунке — Байт там, где сказано («сел сторожить подоконник»), пока о нём не позаботились", async () => {
  // Слова исхода и место Байта — одно: названо место — он там (владелец: «по результату кот сел сторожить
  // подоконник, но он лежит на полу»).
  const PLACES = [[/подоконник/u, "sill"], [/под кресл/u, "under"], [/в коробк/u, "box"], [/на клавиатур|блокнот/u, "desk"]];
  let told = 0;
  for (const item of room.SCENES) for (const [label, outcome, look] of item.options) {
    for (const sentence of plain(outcome).split(/(?<=[.!?])\s+/u).filter(part => /Байт/u.test(part))) {
      const named = PLACES.find(([rule]) => rule.test(sentence));
      if (!named) continue;
      told += 1;
      assert.equal(look?.cat?.[1], named[1], `${item.key} «${label}»: «${sentence}» — а на рисунке он ${look?.cat ?? "где был"}`);
    }
  }
  assert.ok(told >= 5, `исходов, где место Байта названо: ${told}`);

  reset();
  const time = clock();
  const h = heart(ON, { now: time.now, random: () => 0 });
  const id = guestWith("kettle");
  const seen = await h.onRoom({ do: "look" }, from(id));
  // Не сыграна — видна: «в комнате туман — хоть ложкой ешь».
  assert.deepEqual([seen.scene.key, seen.scene.fx], ["kettle", ["haze"]]);
  const picked = await h.onRoom({ do: "pick", key: "kettle", pick: 1 }, from(id));
  assert.match(picked.line, /Байт сел сторожить подоконник/u);
  // Он — на подоконнике, сидит, и с места сам не уходит; окно открыто, тумана нет.
  assert.deepEqual({ shape: picked.cat.shape, place: picked.cat.place, still: picked.cat.still, beats: picked.cat.beats }, { shape: "sit", place: "sill", still: true, beats: [] });
  assert.deepEqual(picked.scene.fx, ["window"]);
  assert.deepEqual(roomOf(id).scene, { day: TODAY, key: "kettle", pick: 1, at: NOON });

  // Страница: рисунок идёт за словами исхода; своей жизнью Байт пока не живёт — его держит сценка.
  let state = logic.applyPick(logic.applyLook(logic.blank(14), seen, NOON), picked);
  assert.deepEqual([state.fx, logic.viewOf(state).fx], [["window"], ["window"]]);
  assert.deepEqual(logic.viewOf(state).cat, { shape: "sit", place: "sill", key: picked.cat.key });
  assert.equal(logic.nextBeat(state, "cat"), null, "с подоконника он сам не уйдёт");
  assert.equal(state.said, picked.line);

  // Час спустя страница спрашивает комнату заново — всё на месте.
  time.add(HOUR);
  const later = await h.onRoom({ do: "look", again: true }, from(id));
  assert.deepEqual([later.scene.fx, later.cat.shape, later.cat.place, later.cat.still], [["window"], "sit", "sill", true]);
  // Погладили — Байт идёт к человеку: забота сильнее сценки. Окно остаётся открытым.
  const pet = await h.onRoom({ do: "pet" }, from(id));
  assert.deepEqual([pet.cat.place, pet.cat.key], ["near", "ласка"]);
  const cared = await h.onRoom({ do: "look", again: true }, from(id));
  assert.deepEqual([cared.scene.fx, cared.cat.key, cared.cat.still], [["window"], "ласка", false]);
  assert.notEqual(cared.cat.place, "sill");
  // Через три часа после выбора комната снова обычная; сыгранная сценка остаётся сыгранной.
  time.add(2 * HOUR);
  const gone = await h.onRoom({ do: "look", again: true }, from(id));
  assert.deepEqual([gone.scene.fx, gone.scene.pick], [[], 1]);
  state = logic.applyTick(state, gone, time.now());
  assert.deepEqual([state.fx, "fx" in logic.viewOf(state)], [[], false]);

  // Другой исход ставит её саму: «новый чай готов» — она пьёт его под гирляндой.
  reset();
  time.set(NOON);
  const other = heart(ON, { now: time.now, random: () => 0 });
  const before = await other.onRoom({ do: "look" }, from(id));
  const tea = await other.onRoom({ do: "pick", key: "kettle", pick: 0 }, from(id));
  assert.deepEqual([tea.scene.fx, tea.her.key, tea.her.pose, tea.her.line], [[], "уют", "garland", tea.line]);
  assert.equal(scene.spriteOf(logic.viewOf(logic.applyPick(logic.applyLook(logic.blank(14), before, NOON), tea))), "tea2", "с кружкой под гирляндой");
  // Исход, который её не ставит, о ней и не говорит: она остаётся, где была.
  assert.equal("her" in picked, false);
  // Байта этот исход не трогает: он остаётся, где был, и живёт сам.
  assert.deepEqual([tea.cat.shape, tea.cat.place, tea.cat.still], [before.cat.shape, before.cat.place, before.cat.still]);
});

test("сценка дня и погода: в сухой день сердце не предложит «дождь разошёлся» и лужу под окном — ни на странице, ни в чате", async () => {
  // Гости, которым по кругу сегодня выпала сценка о дожде, а погода у них (выдуманная) — сухая.
  const dry = [];
  for (let id = 100; id < 3000 && dry.length < 4; id += 1) {
    const usual = room.sceneFor(id, TODAY), sky = madeUpSky(id);
    if (usual.sky && !usual.sky.includes(sky)) dry.push([id, usual.key, sky]);
  }
  assert.equal(dry.length, 4, "нашлись четверо");
  assert.ok(new Set(dry.map(row => row[1])).size === 2, `обе сценки о дожде: ${dry.map(row => row[1]).join(", ")}`);
  for (const [id, usual, sky] of dry) {
    // На странице.
    reset();
    const seen = await heart(ON, { now: () => NOON, random: () => 0 }).onRoom({ do: "look" }, from(id));
    assert.equal(seen.sky, sky);
    assert.notEqual(seen.scene.key, usual, `${id}: небо ${sky}, а сценка — о дожде`);
    assert.equal(seen.scene.key, room.sceneFor(id, TODAY, sky).key);
    assert.doesNotMatch(seen.scene.text, /[Дд]ожд|луж/u, seen.scene.text);
    assert.ok(!seen.scene.fx.includes("puddle"));
    // В чате: та же сценка, с теми же двумя кнопками.
    reset();
    const h = heart(ON, { now: () => NOON, random: () => 0 });
    await h.onMessage(message("зайду к тебе", { id }), KEY);
    const card = toChat(id).find(item => item.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data?.startsWith("h:"));
    assert.ok(card, `${id}: сценка в чате`);
    assert.equal(card.reply_markup.inline_keyboard[0][0].callback_data, `h:${seen.scene.key}:0`);
    assert.doesNotMatch(card.text, /[Дд]ожд|луж/u, card.text);
  }
  // А под дождём — именно она: гость, у которого сегодня льёт и по кругу выпала сценка о дожде.
  let wet = null;
  for (let id = 100; id < 6000 && !wet; id += 1) { const usual = room.sceneFor(id, TODAY); if (usual.sky?.includes(madeUpSky(id))) wet = [id, usual.key]; }
  assert.ok(wet, "нашёлся гость под дождём");
  reset();
  const rainy = await heart(ON, { now: () => NOON, random: () => 0 }).onRoom({ do: "look" }, from(wet[0]));
  assert.deepEqual([rainy.scene.key, ["rain", "storm"].includes(rainy.sky)], [wet[1], true]);
});

// ── слова и картинка — об одном ──────────────────────────────────────────────

test("Байт 0.44.0: где он и какой — по словам самой заботы («перевернулся на спину» — лежит на спине); у слов без примет — по таблице", async () => {
  // Правило.
  assert.ok(room.CAT_SHAPES.includes("belly"));
  assert.deepEqual([...scene.CAT_SHAPES], [...room.CAT_SHAPES]);
  assert.deepEqual(room.catPose("Байт перевернулся на спину. Это ловушка — но приятная.", "ласка", room.catAfter("pet")), { shape: "belly", place: "near" });
  assert.deepEqual(room.catPose("Байт выгнул спину и включил мотор.", "ласка", room.catAfter("pet")), { shape: "walk", place: "near" }, "«выгнул спину» — не «на спину»");
  assert.deepEqual(room.catPose("Байт несёт добычу через весь ковёр. Горд.", "игра", room.catAfter("play")), { shape: "walk", place: "rug" });
  assert.deepEqual(room.catPose("Байт не против. Он никогда не против.", "ласка", room.catAfter("pet")), { shape: "sit", place: "near" }, "слова без примет — таблица заботы");
  assert.deepEqual(room.catPose("Байт не против.", "ласка"), { shape: "sit", place: "near" }, "и без таблицы — поза состояния");
  assert.deepEqual(room.catPose("", "нет такого"), { shape: "sit", place: "rug" });
  assert.deepEqual([...room.CAT_STILL], ["спит", "обижен"]);

  // Каждая строка заботы: что в ней сказано о Байте — то и нарисуют. Приметы, которые человек увидел бы глазами.
  const SEEN = [
    [/на спину|кверху лапами|пузом кверху/u, cat => cat.shape === "belly", "лежит на спине"],
    [/носится|погнался|охотится/u, cat => cat.shape === "play", "в прыжке"],
    [/набегался|устал|\bл[её]г\b|растянулся/u, cat => cat.shape === "lie", "лежит"],
    [/у миски|миска/u, cat => cat.place === "bowl", "у миски"],
    [/\bест\b|с набитым ртом/u, cat => cat.shape === "eat", "ест"],
    [/под креслом/u, cat => cat.place === "under", "под креслом"],
  ];
  let checked = 0;
  for (const [op, key] of [["pet", "ласка"], ["feed", "сыт"], ["play", "игра"]]) for (const again of [false, true]) {
    const name = `${{ pet: "погладить", feed: "покормить", play: "поиграть" }[op]}${again ? ":ещё" : ""}`;
    for (const owner of [false, true]) for (const line of pool(name, { owner })) {
      const cat = room.catPose(line, key, room.catAfter(op, { again }));
      assert.ok(room.CAT_SHAPES.includes(cat.shape) && room.CAT_PLACES.includes(cat.place), line);
      assert.ok(typeof scene.drawRoom({ part: "день", her: null, cat: { ...cat, key }, things: [] }) === "string");
      for (const [words, fits, what] of SEEN) if (words.test(line.toLowerCase())) { checked += 1; assert.ok(fits(cat), `«${line}» — ${what}, а нарисован ${cat.shape} ${cat.place}`); }
    }
  }
  assert.ok(checked >= 12, `строк с приметами: ${checked}`);

  // Через сердце: та самая строка — и Байт на спине. Страница рисует его так, и лапы у него шевелятся.
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0.9 });
  const seen = await h.onRoom({ do: "look" }, from(5));
  let state = logic.applyLook(logic.blank(14), seen, NOON);
  const lines = [];
  for (let n = 0; n < 2; n += 1) {
    const pet = await h.onRoom({ do: "pet" }, from(5));
    lines.push(pet.line);
    assert.deepEqual({ shape: pet.cat.shape, place: pet.cat.place }, room.catPose(pet.line, "ласка", room.catAfter("pet", { again: n > 0 })), pet.line);
    state = logic.applyCare(state, "pet", pet);
    // Слова о Байте под рисунком — слова самой заботы; его распорядок начнётся потом (`beat: -1`).
    assert.deepEqual([state.lines.cat, state.cat.beat, state.said], [pet.line, -1, pet.line]);
  }
  assert.match(lines[1], /перевернулся на спину/u, lines.join(" | "));
  assert.deepEqual(logic.viewOf(state).cat, { shape: "belly", place: "near", key: "ласка" });
  const drawn = scene.drawRoom(logic.viewOf(state), PAINTED);
  assert.ok(classesOf(drawn).has("belly") && classesOf(drawn).has("paws"), "на спине, лапы кверху и шевелятся");
  assert.equal(scene.castOf(logic.viewOf(state), PAINTED).cat.shape, "belly");
  // Потом он живёт дальше: следующая реплика — о нём же, со своей картинкой.
  const next = logic.nextBeat(state, "cat");
  assert.deepEqual([next.cat.beat, next.said, next.lines.cat], [0, state.cat.beats[0].line, state.cat.beats[0].line]);
  assert.deepEqual({ shape: logic.viewOf(next).cat.shape, place: logic.viewOf(next).cat.place }, room.catPose(next.said, "ласка"));
});

test("подпись рисунка 0.44.0: название — в именительном («Мекку» → «Мекка»); в падеже не уверена — говорит иначе, не коверкая", async () => {
  const table = {
    "Мекку": "Мекка", "мекку": "мекка", "Москву": "Москва", "луну": "луна", "розу": "роза", "башню": "башня", "собаку": "собака",
    "красную машину": "красная машина", "большую синюю птицу": "большая синяя птица", "мою маму": "моя мама", "девушку с зонтом": "девушка с зонтом",
    "бабочку на цветке": "бабочка на цветке", "землю из космоса": "земля из космоса",
    // Винительный, равный именительному, остаётся как был.
    "закат над морем": "закат над морем", "море": "море", "небо": "небо", "Казань": "Казань", "кот в шляпе": "кот в шляпе", "горы": "горы",
    // Несклоняемое на «у» — не винительный.
    "кенгуру": "кенгуру", "какаду": "какаду",
    // О себе и о нём — названием.
    "себя": "автопортрет", "тебя": "автопортрет", "меня": "портрет", "нас": "мы вдвоём",
    "себя в шляпе": "автопортрет в шляпе", "Себя с Байтом на руках": "автопортрет с Байтом на руках", "меня с котом": "портрет с котом", "нас у моря": "мы вдвоём у моря",
  };
  for (const [asked, title] of Object.entries(table)) assert.equal(room.nominative(asked), title, asked);
  // Слово на «-а/-я» может быть кем угодно («кота» — винительный, «Мекка» — именительный): тут она не гадает.
  for (const unsure of ["кота", "кота в шляпе", "дракона", "ёжика в тумане", "двух котов", "Байта", "самурая", "мужу открытку", "аниме девочку", "cat", "3 кота", "", null, undefined]) assert.equal(room.nominative(unsure), null, String(unsure));
  assert.equal(room.nominative(Array.from({ length: 13 }, () => "луну").join(" ")), null, "длинная просьба — не название");

  // В запасе две строки: с названием — и без него, где винительный на своём месте.
  const lines = pool("вещь:рисунок");
  assert.ok(lines.some(line => line.includes("«кот в шляпе»")) && lines.some(line => /нарисовать кота в шляпе/u.test(line)), JSON.stringify(lines));

  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  const caption = async (asked) => {
    sdk().kv.set(ALBUM_KEY(5), JSON.stringify({ items: [{ q: asked, at: NOON }], at: NOON }));
    return (await h.onRoom({ do: "look" }, from(5))).things.find(item => item.key === "рисунок").line;
  };
  // То самое: просил «нарисуй Мекку» — на стене «Мекка».
  const mecca = await caption("Мекку");
  assert.match(mecca, /«Мекка»/u);
  assert.doesNotMatch(mecca, /Мекку|\{/u);
  assert.match(await caption("красную машину"), /«красная машина»/u);
  // Не уверена — «вы просили нарисовать кота в шляпе»: падеж на месте, кавычек с винительным нет.
  const cat = await caption("кота в шляпе");
  assert.match(cat, /нарисовать кота в шляпе/u);
  assert.doesNotMatch(cat, /«кота|\{/u);
  // Страница показывает подпись как пришла — по нажатию на рисунок на стене.
  const state = logic.applyLook(logic.blank(14), await (async () => { sdk().kv.set(ALBUM_KEY(5), JSON.stringify({ items: [{ q: "Мекку", at: NOON }], at: NOON })); return h.onRoom({ do: "look" }, from(5)); })(), NOON);
  assert.match(logic.applyTap(state, "thing:рисунок").said, /«Мекка»/u);
  // И в чате — то же название.
  await h.onMessage(message("что нового в комнате"), KEY);
  await h.onMessage(message("зайду к тебе"), KEY);
  assert.doesNotMatch(toChat(5).map(item => item.text).join("\n"), /«Мекку»/u);
});

// ── чай ─────────────────────────────────────────────────────────────────────

test("чай 0.44.0: налили — час она с кружкой, блокнот и ленточка ждут; обиду, усталость и сон кружка не отменяет", async () => {
  assert.equal(room.TEA_WARM_MS, HOUR);
  const at = NOON, warm = { tea: at - 10 * 60_000, at };
  // «Дело» и «игра» уступают кружке; «уют» — и так с ней.
  assert.deepEqual([room.herKey("ворчливое", 14), room.herKey("ворчливое", 14, warm)], ["дело", "уют"]);
  assert.deepEqual([room.herKey("игривое", 14), room.herKey("игривое", 14, warm)], ["игра", "уют"]);
  assert.deepEqual([room.herKey("уютное", 14), room.herKey("уютное", 14, warm)], ["уют", "уют"]);
  assert.equal(room.herKey("никакое", 14, warm), "уют", "настроение без своего занятия — «дело», и оно тоже уступает");
  // Чувство к человеку, усталость и ночь сильнее чая.
  for (const [mood, key] of [["обиженное", "обида"], ["ревнивое", "ревность"], ["уставшее", "устала"], ["сонное", "сон"]]) assert.equal(room.herKey(mood, 14, warm), key, mood);
  for (const hour of [23, 0, 4]) assert.equal(room.herKey("ворчливое", hour, warm), "сон", String(hour));
  // Ровно час: потом чай остыл. Чай «из будущего» и без отметки — не чай.
  assert.equal(room.herKey("ворчливое", 14, { tea: at - room.TEA_WARM_MS + 1, at }), "уют");
  assert.equal(room.herKey("ворчливое", 14, { tea: at - room.TEA_WARM_MS, at }), "дело");
  assert.equal(room.herKey("ворчливое", 14, { tea: at + 1, at }), "дело");
  for (const tea of [0, null, undefined, "", NaN]) assert.equal(room.herKey("ворчливое", 14, { tea, at }), "дело", String(tea));

  // Через сердце и страницу. 9:30 по Москве: у этого гостя она всё утро занята. Чем она была бы занята без чая —
  // видно в такой же комнате, где вместо чая полили Колючку (забота та же, кружки нет).
  const MORNING = Date.parse("2026-11-18T06:30:00Z"), HANDS = { "дело": /^work/u, "игра": /^play/u };
  reset();
  const dryTime = clock(MORNING);
  const dry = heart(ON, { now: dryTime.now, random: () => 0 });
  await dry.onRoom({ do: "look" }, from(5));
  await dry.onRoom({ do: "water" }, from(5));
  const without = [];
  for (const minutes of [0, 59, 1]) { dryTime.add(minutes * 60_000); without.push((await dry.onRoom({ do: "look", again: true }, from(5))).her.key); }
  for (const key of without) assert.ok(Object.hasOwn(HANDS, key), `без чая она занята: ${without.join(", ")}`);

  reset();
  const time = clock(MORNING);
  const h = heart(ON, { now: time.now, random: () => 0 });
  const seen = await h.onRoom({ do: "look" }, from(5));
  const busy = seen.her.key;
  assert.ok(Object.hasOwn(HANDS, busy), busy);
  let state = logic.applyLook(logic.blank(9), seen, MORNING);
  assert.match(scene.spriteOf(logic.viewOf(state)), HANDS[busy], "занята — в руках блокнот или ленточка");
  const tea = await h.onRoom({ do: "tea" }, from(5));
  assert.equal(tea.her.key, "уют");
  state = logic.applyCare(state, "tea", tea);
  // Теперь у неё в руках кружка — и слова по нажатию на неё о том же.
  assert.deepEqual([state.her.key, state.her.beat, state.lines.her], ["уют", 0, tea.her.line]);
  assert.match(scene.spriteOf(logic.viewOf(state)), /^tea/u, "с чаем — кружка, а не блокнот");
  assert.equal(state.said, tea.line, "под рисунком — её «спасибо», а не новая реплика");
  assert.equal(logic.applyTap(state, "her").said, tea.her.line);
  // Вторая кружка: занята тем же — с места не срывается и на первую реплику не возвращается.
  state = logic.nextBeat(state, "her");
  const second = logic.applyCare(state, "tea", await h.onRoom({ do: "tea" }, from(5)));
  assert.deepEqual([second.her.key, second.her.beat, second.lines.her], ["уют", 1, state.lines.her]);
  // В чате — та же она: «зайду к тебе» — и слова о ней из запаса «с кружкой».
  await h.onMessage(message("зайду к тебе"), KEY);
  const air = { sky: seen.sky, part: seen.clock.part };
  assert.ok(fitting("она:уют", air).some(line => last().includes(line)), last());
  for (const key of Object.keys(HANDS)) assert.ok(!fitting(`она:${key}`, air).some(line => last().includes(line)), last());
  // Без минуты час — ещё с кружкой (без чая в эту минуту она была бы занята).
  time.add(59 * 60_000);
  assert.equal((await h.onRoom({ do: "look", again: true }, from(5))).her.key, "уют");
  // Через час чай остыл — она снова занята своим; страница узнаёт об этом сама (`again`) и меняет рисунок без шкафа.
  time.add(60_000);
  const cold = await h.onRoom({ do: "look", again: true }, from(5));
  assert.equal(cold.her.key, without[2]);
  const after = logic.applyTick(second, cold, time.now());
  const change = logic.changeOf(second, after);
  assert.deepEqual([change.kind, change.state.her.key, change.state.said], ["quiet", cold.her.key, cold.her.line]);
  assert.match(scene.spriteOf(logic.viewOf(change.state)), HANDS[cold.her.key]);
});

// ── своя жизнь ──────────────────────────────────────────────────────────────

test("распорядок 0.44.0: она и Байт сами переходят к следующей реплике; слова под рисунком — о том, что на нём сейчас", async () => {
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  const seen = await h.onRoom({ do: "look" }, from(5));
  const air = { sky: seen.sky, part: seen.clock.part };
  // Распорядок — все реплики её состояния, годные сейчас; первая — та, что сказана при входе.
  assert.ok(seen.her.beats.length >= 3 && seen.cat.beats.length >= 2, JSON.stringify([seen.her.beats.length, seen.cat.beats.length]));
  assert.deepEqual(seen.her.beats.map(beat => beat.line).sort(), [...fitting(`она:${seen.her.key}`, air)].sort());
  let state = logic.applyLook(logic.blank(14), seen, NOON);
  assert.deepEqual([state.her.beat, state.cat.beat], [0, 0]);

  // Она: по кругу, каждая реплика — со своим местом и своей картинкой.
  const walked = [];
  for (let step = 1; step <= seen.her.beats.length; step += 1) {
    const next = logic.nextBeat(state, "her"), beat = seen.her.beats[step % seen.her.beats.length];
    assert.deepEqual([next.her.beat, next.said, next.lines.her, next.tone], [step % seen.her.beats.length, beat.line, beat.line, ""]);
    const view = logic.viewOf(next);
    assert.deepEqual([view.her.pose, view.her.key, view.her.beat], [beat.pose, seen.her.key, true]);
    // Картинка — та, о которой слова: «у полки» — у полки, «на подоконнике» — у окна.
    assert.equal(scene.spriteOf(view), scene.lookOf(seen.her.key, beat.pose), beat.line);
    assert.equal(logic.applyTap(next, "her").said, beat.line, "нажали на неё — она говорит о том, чем занята на рисунке");
    walked.push(scene.castOf(view, PAINTED).her.x);
    state = next;
  }
  assert.equal(state.her.beat, 0, "круг замкнулся");
  assert.ok(new Set(walked).size >= 2, `она ходит по комнате, а не стоит: ${walked.join(", ")}`);
  // Остального переход не трогает: Байт, вещи, счётчики заботы — как были.
  assert.deepEqual([state.cat, state.done, state.things, state.sky], [logic.applyLook(logic.blank(14), seen, NOON).cat, seen.done, [], seen.sky]);

  // Байт: то же — и его место на рисунке идёт за словами.
  for (let step = 1; step <= seen.cat.beats.length; step += 1) {
    const next = logic.nextBeat(state, "cat"), beat = seen.cat.beats[step % seen.cat.beats.length];
    assert.deepEqual([next.cat.beat, next.said, next.lines.cat], [step % seen.cat.beats.length, beat.line, beat.line]);
    assert.deepEqual(logic.viewOf(next).cat, { shape: beat.shape, place: beat.place, key: seen.cat.key });
    state = next;
  }

  // Идти некуда: реплика одна; её нет в комнате; Байт спит или прячется; распорядка нет (прежнее сердце).
  const one = { ...state, her: { ...state.her, beats: state.her.beats.slice(0, 1), beat: 0 } };
  assert.equal(logic.nextBeat(one, "her"), null);
  assert.equal(logic.nextBeat({ ...state, away: true }, "her"), null);
  assert.equal(logic.nextBeat({ ...state, cat: { ...state.cat, still: true } }, "cat"), null);
  assert.equal(logic.nextBeat({ ...state, cat: { ...state.cat, beats: state.cat.beats.slice(0, 1), beat: 0 } }, "cat"), null);
  assert.equal(logic.nextBeat({ ...state, cat: null }, "cat"), null);
  const old = logic.applyLook(logic.blank(14), { ...seen, her: { key: seen.her.key, pose: seen.her.pose, line: seen.her.line }, cat: { key: seen.cat.key, shape: seen.cat.shape, place: seen.cat.place, line: seen.cat.line } }, NOON);
  assert.deepEqual([logic.nextBeat(old, "her"), logic.nextBeat(old, "cat")], [null, null]);
  // Тогда позы идут по кругу сами, как до 0.44.0 (`turn`), — и рисунок получает счёт, а не знак распорядка.
  assert.deepEqual([logic.viewOf(old).her.beat, logic.viewOf(logic.nextTurn(old)).her.turn], [undefined, 1]);

  // Ночью оба спят — и никуда не ходят: распорядка у спящего Байта нет вовсе.
  reset();
  const night = await heart(ON, { now: () => Date.parse("2026-11-18T21:30:00Z"), random: () => 0 }).onRoom({ do: "look" }, from(5));
  assert.deepEqual([night.her.key, night.cat.key, night.cat.still, night.cat.beats], ["сон", "спит", true, []]);
  const asleep = logic.applyLook(logic.blank(0), night, NOON);
  assert.equal(logic.nextBeat(asleep, "cat"), null);

  // Она дразнит Байта ленточкой — он рядом и ловит её, чем бы ни был занят; спящего и спрятавшегося она не будит.
  const tease = { ...state, her: { ...state.her, key: "игра", beats: [{ pose: "ribbon", line: "Дразню Байта ленточкой." }, { pose: "dance", line: "Танцую." }], beat: 0 } };
  assert.deepEqual([logic.viewOf(tease).cat.shape, logic.viewOf(tease).cat.place], ["play", "near"]);
  assert.notDeepEqual([logic.viewOf(logic.nextBeat(tease, "her")).cat.shape, logic.viewOf(logic.nextBeat(tease, "her")).cat.place], ["play", "near"], "убрала ленточку — он вернулся к своему");
  const sleepy = { ...tease, cat: { ...tease.cat, shape: "curl", place: "pillow", key: "спит", still: true, beats: [], beat: -1 } };
  assert.deepEqual([logic.viewOf(sleepy).cat.shape, logic.viewOf(sleepy).cat.place], ["curl", "pillow"]);
});

test("сценка ставит её саму — и слова идут за рисунком: «значит, манга» — она в кресле с книгой и говорит о манге; спящую сценка не будит", async () => {
  assert.deepEqual([...room.HER_CALM], ["дело", "уют", "игра"]);
  reset();
  const time = clock();
  const h = heart(ON, { now: time.now, random: () => 0 });
  const id = guestWith("book");
  const seen = await h.onRoom({ do: "look" }, from(id));
  const air = { sky: seen.sky, part: seen.clock.part };
  const picked = await h.onRoom({ do: "pick", key: "book", pick: 1 }, from(id));
  // Ответ несёт её заново: она отдыхает («уют»), в кресле; первая её реплика — сами слова исхода.
  assert.match(picked.line, /^Значит, манга/u);
  // С 0.45.0 она при этом читает (`read`): до того «значит, манга» показывалось картинкой с кружкой.
  assert.deepEqual([picked.her.key, picked.her.pose, picked.her.line], ["уют", "read", picked.line]);
  assert.deepEqual(picked.her.beats[0], { pose: "read", line: picked.line });
  // Дальше — её обычные реплики «с кружкой», кроме той, что тоже о кресле: о «Маленьком принце» после «значит, манга»
  // она не заговорит, и дважды подряд на одном месте не окажется.
  const usual = fitting("она:уют", air).filter(line => room.herPose(line, "уют") !== "read");
  assert.ok(usual.length >= 2, JSON.stringify(usual));
  assert.deepEqual(picked.her.beats.slice(1), usual.map(line => ({ pose: room.herPose(line, "уют"), line })));

  // Страница: она в кресле с книгой. Нажали на неё — говорит о манге, а не «я у стола с блокнотом».
  const state = logic.applyPick(logic.applyLook(logic.blank(14), seen, NOON), picked);
  const view = logic.viewOf(state);
  assert.deepEqual([view.her.pose, view.her.key, view.her.beat], ["read", "уют", true]);
  assert.equal(scene.spriteOf(view), "read");
  assert.deepEqual([state.said, logic.applyTap(state, "her").said], [picked.line, picked.line]);
  // Потом она живёт дальше — отдыхая: следующая реплика из тех же, со своим местом.
  const next = logic.nextBeat(state, "her");
  assert.deepEqual([next.her.key, next.said, logic.viewOf(next).her.pose], ["уют", usual[0], room.herPose(usual[0], "уют")]);
  // Страница спросила комнату заново — она остаётся на своей реплике: обратно в кресло не прыгает.
  time.add(10 * 60_000);
  const tick = await h.onRoom({ do: "look", again: true }, from(id));
  assert.deepEqual([tick.her.key, tick.her.pose, tick.her.line], ["уют", "read", picked.line]);
  const ticked = logic.applyTick(next, tick, time.now());
  assert.deepEqual([ticked.her.beat, logic.changeOf(next, ticked).kind], [1, "same"]);
  // Зашёл заново, пока исход виден, — она там же и говорит то же.
  const again = await h.onRoom({ do: "look" }, from(id));
  assert.deepEqual([again.her.key, again.her.pose, again.her.line], ["уют", "read", picked.line]);
  const entered = logic.applyLook(logic.blank(14), again, time.now());
  assert.ok(entered.said.split("\n").includes(picked.line), entered.said);
  assert.equal(scene.spriteOf(logic.viewOf(entered)), "read");
  // В чате — о том же: «читаю в кресле», а не «у стола с блокнотом»; и не о другой книге, чем выбрана.
  await h.onMessage(message("зайду к тебе", { id }), KEY);
  const inChair = fitting("она:уют", air).filter(line => room.herPose(line, "уют") === "read");
  assert.doesNotMatch(inChair.join(" "), /принц|манг/iu, "реплика «читаю» не называет книгу: её называет исход сценки или полка");
  assert.ok(inChair.length > 0 && inChair.some(line => last(id).includes(line)), last(id));
  // Через три часа исход больше не виден — она снова живёт по настроению: реплики её состояния, все до одной.
  time.set(NOON + room.FRESH_MS);
  const later = await h.onRoom({ do: "look", again: true }, from(id));
  const then = { sky: later.sky, part: later.clock.part };
  assert.notEqual(later.her.line, picked.line);
  assert.deepEqual(later.her.beats.map(beat => beat.line).sort(), [...fitting(`она:${later.her.key}`, then)].sort());

  // Ночью она спит — и сценка её не будит: выбор сделан, а она под пледом, и о ней ответ молчит.
  reset();
  const NIGHT = Date.parse("2026-11-18T20:30:00Z");   // 23:30 по Москве
  time.set(NIGHT);
  const dark = heart(ON, { now: time.now, random: () => 0 });
  const sleeper = guestWith("book", NIGHT);
  const asleep = await dark.onRoom({ do: "look" }, from(sleeper));
  assert.deepEqual([asleep.her.key, asleep.scene.key], ["сон", "book"]);
  const whisper = await dark.onRoom({ do: "pick", key: "book", pick: 0 }, from(sleeper));
  assert.deepEqual([whisper.ok, "her" in whisper], [true, false]);
  const still = await dark.onRoom({ do: "look", again: true }, from(sleeper));
  assert.deepEqual([still.her.key, still.her.line], ["сон", asleep.her.line]);
  assert.match(scene.spriteOf(logic.viewOf(logic.applyPick(logic.applyLook(logic.blank(23), asleep, NIGHT), whisper))), /sleep/u);
});

// ── смена часа при открытой странице ─────────────────────────────────────────

test("смена часа 0.44.0: страница сама спрашивает комнату заново — это не новый заход; день → вечер — она уходит к шкафу и возвращается в свитере", async () => {
  reset();
  const time = clock(Date.parse("2026-11-18T14:59:30Z"));   // 17:59:30 по Москве
  const h = heart(ON, { now: time.now, random: () => 0 });
  const seen = await h.onRoom({ do: "look" }, from(5));
  // Сколько осталось до вечера — в ответе: страница заведёт на это свои часы.
  assert.deepEqual(seen.clock, { hour: 17, part: "день", day: TODAY, left: 30_000 });
  let state = logic.applyLook(logic.blank(17), seen, time.now());
  assert.deepEqual(state.clock, { left: 30_000, at: time.now(), day: TODAY });
  assert.deepEqual(roomOf(5).n, 1);
  const stored = sdk().kv.get(room.ROOM_KEY(5));

  // Тот же час: спросила заново — ничего не изменилось, и это не заход: счёт, приветствие, новости не тронуты.
  time.add(10_000);
  const same = await h.onRoom({ do: "look", again: true }, from(5));
  assert.deepEqual([same.ok, same.again, same.greet, same.first, same.fresh, same.build], [true, true, "", false, [], BUILD]);
  assert.equal(sdk().kv.get(room.ROOM_KEY(5)), stored, "запись о комнате не тронута");
  assert.deepEqual([toChat(5).length, chats().length], [0, 0]);
  const ticked = logic.applyTick(state, same, time.now());
  assert.equal(logic.changeOf(state, ticked).kind, "same");
  // Слова под рисунком — прежние: их меняет то, что происходит на рисунке, а не сам опрос.
  // До вечера двадцать секунд, но сердце называет не меньше тридцати: чаще страница комнату не спрашивает.
  assert.deepEqual([ticked.said, ticked.her.beat, ticked.clock], [state.said, 0, { left: 30_000, at: time.now(), day: TODAY }]);
  // Она ушла на вторую реплику — после опроса остаётся на ней, а не возвращается к первой.
  const onSecond = logic.nextBeat(state, "her");
  assert.equal(logic.applyTick(onSecond, same, time.now()).her.beat, 1);
  assert.equal(logic.changeOf(onSecond, logic.applyTick(onSecond, same, time.now())).kind, "same");
  // Отказ или пустой ответ — комната остаётся какой была; до первого ответа опрашивать нечего.
  assert.equal(logic.applyTick(state, { ok: false, code: "storage", text: "Память недоступна." }, time.now()), state);
  assert.equal(logic.applyTick(state, null, time.now()), state);
  assert.deepEqual(logic.applyTick(logic.blank(17), same, time.now()), logic.blank(17));

  // 18:00. Вечер: она в домашнем — значит, шкаф.
  time.set(Date.parse("2026-11-18T15:00:05Z"));
  const evening = await h.onRoom({ do: "look", again: true }, from(5));
  assert.deepEqual([evening.clock.part, evening.clock.hour, evening.clock.left], ["вечер", 18, 5 * HOUR - 5000]);
  assert.ok(pool("шкаф:вечер").includes(evening.wardrobe.leave), evening.wardrobe.leave);
  assert.ok(pool("переоделась:вечер").includes(evening.wardrobe.back), evening.wardrobe.back);
  const after = logic.applyTick(state, evening, time.now());
  const change = logic.changeOf(state, after);
  assert.equal(change.kind, "wardrobe");
  assert.equal(change.leave, evening.wardrobe.leave);
  // Вернулась — говорит, что переоделась, и чем занята теперь.
  assert.deepEqual(change.back.split("\n"), [evening.wardrobe.back, evening.her.line]);
  // До и после: шла в куртке — вернулась в свитере; и стоит уже в нём.
  assert.deepEqual([scene.walkOf(logic.viewOf(state)), scene.walkOf(logic.viewOf(after))], ["walk", "home-walk"]);
  assert.doesNotMatch(scene.spriteOf(logic.viewOf(state)), /^home-/u);
  assert.match(scene.spriteOf(logic.viewOf(after)), /^home-/u);
  assert.deepEqual([logic.LIGHTS[state.part], logic.LIGHTS[after.part]], ["day", "evening"]);
  // Пока она у шкафа — в комнате её нет: рисунок без неё, Байт на месте.
  const away = logic.viewOf({ ...after, away: true });
  assert.equal(away.her.away, true);
  assert.deepEqual([scene.castOf(away, PAINTED).her, scene.spriteStand(away)], [null, null]);
  assert.equal((scene.drawInside(away, PAINTED).match(/href="#r-her-/gu) ?? []).length, 0);
  assert.ok(scene.castOf(away, PAINTED).cat);
  assert.equal(logic.nextBeat({ ...after, away: true }, "her"), null, "пока переодевается — распорядок ждёт");

  // Слов прежнего сердца нет — она всё равно что-то скажет у шкафа.
  const mute = logic.changeOf(state, { ...after, wardrobe: null });
  assert.deepEqual([mute.kind, mute.leave, mute.back.split("\n")[0]], ["wardrobe", "Пойду переоденусь — я быстро.", "Вот. Так лучше."]);

  // 23:00. Ночь: наряд тот же — шкафа нет, свет перетекает; она засыпает, Байт тоже.
  time.set(Date.parse("2026-11-18T20:00:05Z"));
  const night = await h.onRoom({ do: "look", again: true }, from(5));
  const asleep = logic.applyTick(after, night, time.now());
  assert.deepEqual([logic.changeOf(after, asleep).kind, asleep.her.key, asleep.cat.key, asleep.cat.still], ["light", "сон", "спит", true]);
  assert.deepEqual(logic.changeOf(after, asleep).state.said.split("\n"), [night.window, night.her.line], "новый час — слова об окне и о ней");
  // 05:00. Утро: из свитера в куртку — снова шкаф, слова утренние.
  time.set(Date.parse("2026-11-19T02:00:05Z"));
  const morning = await h.onRoom({ do: "look", again: true }, from(5));
  assert.ok(pool("шкаф:утро").includes(morning.wardrobe.leave) && pool("переоделась:утро").includes(morning.wardrobe.back), JSON.stringify(morning.wardrobe));
  const awake = logic.applyTick(asleep, morning, time.now());
  assert.deepEqual([logic.changeOf(asleep, awake).kind, logic.changeOf(asleep, awake).leave], ["wardrobe", morning.wardrobe.leave]);
  assert.equal(scene.walkOf(logic.viewOf(awake)), "walk");
  // 12:00. День: куртка та же — свет, без шкафа.
  time.set(Date.parse("2026-11-19T09:00:05Z"));
  const day = logic.applyTick(awake, await h.onRoom({ do: "look", again: true }, from(5)), time.now());
  assert.equal(logic.changeOf(awake, day).kind, "light");
  // За все эти часы — ни одного нового захода: человек зашёл один раз.
  assert.equal(roomOf(5).n, 1);

  // Хозяину у шкафа — его слова.
  reset();
  time.set(Date.parse("2026-11-18T15:00:05Z"));
  const mine = await heart(ON, { now: time.now, random: () => 0.999 }).onRoom({ do: "look" }, from(OWNER));
  assert.match(`${mine.wardrobe.leave} ${mine.wardrobe.back}`, /хозяин/iu);
});

test("смена часа: в том же часу рисунок меняется сам — Байт проголодался, пошёл снег; слова под рисунком идут за ним", () => {
  const seen = logic.demoLook(14, { sky: "clear" });
  const before = logic.applyLook(logic.blank(14), seen, NOON);
  // Ничего не изменилось.
  assert.equal(logic.changeOf(before, logic.applyTick(before, seen, NOON + 60_000)).kind, "same");
  // Пошёл снег: рисунок меняется тихо. Слова под рисунком — прежние: человек читал не про окно.
  const snowy = logic.applyTick(before, { ...seen, sky: "snow", window: "За окном снег." }, NOON + 60_000);
  const quiet = logic.changeOf(before, snowy);
  assert.deepEqual([quiet.kind, quiet.state.sky, quiet.state.said, quiet.state.lines.window], ["quiet", "snow", before.said, "За окном снег."]);
  // А если читал про окно — слова меняются вместе с небом.
  const atWindow = logic.applyTap(before, "window");
  assert.equal(logic.changeOf(atWindow, logic.applyTick(atWindow, { ...seen, sky: "snow", window: "За окном снег." }, NOON + 60_000)).state.said, "За окном снег.");
  // Байт сменил состояние: под рисунком были слова о нём — теперь новые о нём; были другие — остаются.
  const fed = { ...seen, cat: { key: "сыт", shape: "lie", place: "rug", line: "Байт сыт и растянулся на ковре.", beats: [{ shape: "lie", place: "rug", line: "Байт сыт и растянулся на ковре." }], still: true } };
  const aboutCat = { ...before, said: before.lines.cat };
  assert.deepEqual([logic.changeOf(aboutCat, logic.applyTick(aboutCat, fed, NOON)).kind, logic.changeOf(aboutCat, logic.applyTick(aboutCat, fed, NOON)).state.said], ["quiet", "Байт сыт и растянулся на ковре."]);
  assert.equal(logic.changeOf(before, logic.applyTick(before, fed, NOON)).state.said, before.said);
  // Она сменила занятие — говорит новую реплику, о чём бы ни были слова до того.
  const tired = { ...seen, her: { key: "устала", pose: "chair", line: "Сижу в кресле. Глаза закрываются сами.", beats: [{ pose: "chair", line: "Сижу в кресле. Глаза закрываются сами." }] } };
  assert.deepEqual([logic.changeOf(before, logic.applyTick(before, tired, NOON)).kind, logic.changeOf(before, logic.applyTick(before, tired, NOON)).state.said], ["quiet", "Сижу в кресле. Глаза закрываются сами."]);
  // До первого ответа сравнивать не с чем.
  assert.equal(logic.changeOf(logic.blank(14), before).kind, "same");

  // Часы устройства — для витрины и прежнего сердца: сколько до следующей части суток (5, 12, 18, 23 часа).
  const left = (hours, minutes = 0, seconds = 0) => logic.leftOf(new Date(2026, 10, 18, hours, minutes, seconds));
  assert.deepEqual([left(17), left(12), left(5), left(0), left(23, 30)], [HOUR, 6 * HOUR, 7 * HOUR, 5 * HOUR, 5.5 * HOUR]);
  assert.deepEqual([left(17, 59, 30), left(17, 59, 59), left(4, 59, 59)], [30_000, 30_000, 30_000], "не чаще раза в полминуты");
  // Ответ без часов (прежнее сердце) — `clock: null`: страница возьмёт часы устройства.
  assert.equal(logic.applyLook(logic.blank(14), { ...seen, clock: { hour: 14, part: "день" } }, NOON).clock, null);
  assert.equal(logic.applyLook(logic.blank(14), { ...seen, clock: { hour: 14, part: "день", left: 99 * HOUR } }, NOON).clock.left, 24 * HOUR, "сутки — предел: дольше страница не ждёт");
});

// ── рисунок ─────────────────────────────────────────────────────────────────

test("рисунок 0.44.0: она сидит в кресле комнаты; до нового места доходит шагом, в том наряде, что на ней; у шкафа её нет; она дышит", () => {
  const view = (pose, key, extra = {}) => ({ part: "день", sky: "clear", her: { pose, key, beat: true }, cat: { shape: "curl", place: "pillow", key: "спит" }, things: [], ...extra });
  // Пуфа, который появлялся вместе с ней, больше нет: сидит она там же, где стоит кресло, — в обоих нарядах, и
  // сонная, и ревнивая. Кресло при этом одно и то же — что с ней, что без неё.
  // 0.47.0 (идея 168): «в кресле» — сидящая картинка у каждого состояния, где есть такое место. До этого сонная и
  // ревнивая у кресла стояли, а запасная фигура кодом в том же месте сидела.
  const seats = [["chair", "уют", "tea3"], ["read", "уют", "read"], ["chair", "устала", "tired3"], ["chair", "ревность", "jealous3"], ["chair", "дело", "work3"]];
  const xs = new Set();
  for (const [pose, key, name] of seats) for (const part of ["день", "вечер"]) {
    const cast = scene.castOf(view(pose, key, { part }), PAINTED);
    assert.equal(cast.her.name, part === "вечер" ? `home-${name}` : name, `${key} ${part}`);
    assert.equal(scene.HER_SPRITES[cast.her.name].kind, "seat", `${cast.her.name}: в кресле сидят`);
    xs.add(cast.her.x);
  }
  // И наоборот: сидящая картинка есть только у места «в кресле» — у стола и у полки она не сядет в воздух.
  for (const key of Object.keys(scene.MOODS)) for (const pose of scene.HER_POSES) {
    const name = scene.lookOf(key, pose);
    if (name && scene.HER_SPRITES[name].kind === "seat") assert.ok(pose === "chair" || pose === "read", `${key}, ${pose}: ${name} сидит не в кресле`);
  }
  assert.equal(xs.size, 1, `сидит в одном и том же кресле: ${[...xs].join(", ")}`);
  const chairOf = (markup) => markup.slice(markup.indexOf("<g class=\"zones\">")).match(/data-act="thing:[^"]*кресло[^"]*"/u);
  assert.equal(chairOf(scene.drawRoom(view("chair", "уют"), PAINTED))?.[0], chairOf(scene.drawRoom(view("desk", "дело"), PAINTED))?.[0]);
  assert.doesNotMatch(read("miniapp/scene.js"), /function pouf|pouf\(/u, "пуф не рисуется");

  // Идёт: картинка «идёт» — в том наряде, что на ней сейчас.
  assert.deepEqual([scene.walkOf(view("desk", "дело")), scene.walkOf(view("desk", "дело", { part: "утро" })), scene.walkOf(view("desk", "дело", { part: "вечер" })), scene.walkOf(view("nap", "сон", { part: "ночь" }))], ["walk", "walk", "home-walk", "home-walk"]);
  assert.equal(scene.walkOf({ part: "день", her: null }), null);
  assert.equal(scene.walkOf(view("desk", "дело", { part: "вечер", her: { pose: "desk", key: "дело", wear: "jacket" } })), "walk", "наряд назван — идёт в нём");
  for (const name of ["walk", "home-walk"]) assert.equal(scene.HER_SPRITES[name].kind, "walk", name);
  // Ни одно состояние не показывает «идёт» как позу: это только переход.
  for (const key of Object.keys(scene.MOODS)) for (const part of scene.PARTS) for (const name of scene.spritesOf({ part, her: { pose: "desk", key }, things: [] })) assert.doesNotMatch(name, /walk/u, `${key} ${part}`);

  // Стояла у полки — пошла к столу: прежняя поза тает, картинка «идёт» едет от старого места к новому, новая поза
  // проявляется, когда дошла.
  const from = scene.castOf(view("shelf", "дело"), PAINTED), to = scene.castOf(view("desk", "дело"), PAINTED);
  assert.ok(Math.abs(from.her.x - to.her.x) >= 50, `полка и стол — в разных местах: ${from.her.x} и ${to.her.x}`);
  const moved = scene.drawInside(view("desk", "дело"), { ...PAINTED, was: from.her, catWas: from.cat });
  const stride = moved.match(/<g class="stride" style="--dx:(-?[\d.]+)px;--t:([\d.]+)s"><g class="step">/u);
  assert.ok(stride, "идёт");
  assert.equal(Number(stride[1]), from.her.x - to.her.x, "путь — от прежнего места");
  assert.equal(Number(stride[2]), scene.walkSeconds(from.her.x, to.her.x));
  assert.match(moved, /href="#r-her-walk"/u);
  assert.match(moved, /<g class="leave">/u);
  assert.match(moved, new RegExp(`<g class="arrive late" style="--t:${stride[2]}s">`, "u"));
  // Идёт влево — картинка отражена: нарисована она лицом вправо.
  const back = scene.drawInside(view("shelf", "дело"), { ...PAINTED, was: to.her, catWas: to.cat });
  assert.match(back, /<g class="step"><g transform="translate\([\d.]+ 0\) scale\(-1 1\)">/u);
  assert.doesNotMatch(moved, /<g class="step"><g transform="translate\([\d.]+ 0\) scale\(-1 1\)">/u);
  // Осталась на месте — никуда не идёт; сменила позу на том же месте — прежняя тает, без шага.
  const stay = scene.drawInside(view("desk", "дело"), { ...PAINTED, was: to.her, catWas: to.cat });
  assert.doesNotMatch(stay, /class="stride"/u);
  // Вечером идёт в свитере.
  const evening = scene.drawInside(view("desk", "дело", { part: "вечер" }), { ...PAINTED, was: { name: "home-work", x: from.her.x }, catWas: from.cat });
  assert.match(evening, /href="#r-her-home-walk"/u);
  assert.doesNotMatch(evening, /href="#r-her-walk"/u);
  // Скорость шага: дальше — дольше, но не короче секунды и не дольше трёх с половиной.
  assert.deepEqual([0, 70, 140, 210, 1000].map(distance => scene.walkSeconds(0, distance)), [1, 1, 2, 3, 3.5]);
  assert.equal(scene.walkSeconds(300, 90), scene.walkSeconds(90, 300));

  // У шкафа: уходит за левый край рисунка — и входит оттуда же.
  assert.ok(scene.DOOR_X < 0, "шкаф и дверь — за левым краем");
  const leaving = scene.drawInside({ ...view("desk", "дело"), her: { pose: "desk", key: "дело", beat: true, away: true } }, { ...PAINTED, was: to.her, catWas: to.cat });
  const out = leaving.match(/<g class="stride" style="--dx:(-?[\d.]+)px;--t:([\d.]+)s">/u);
  assert.ok(out && Number(out[1]) === to.her.x - scene.DOOR_X, `уходит от стола к двери: ${out?.[1]}`);
  assert.doesNotMatch(leaving, /class="alive"/u, "ушла — в комнате её нет");
  const entering = scene.drawInside(view("desk", "дело", { part: "вечер" }), { ...PAINTED, enter: true });
  const came = entering.match(/<g class="stride" style="--dx:(-?[\d.]+)px;--t:([\d.]+)s">/u);
  assert.ok(came && Number(came[1]) === scene.DOOR_X - to.her.x, `входит от двери к столу: ${came?.[1]}`);
  assert.match(entering, /href="#r-her-home-walk"/u);
  // Спящая на ковре не встаёт и не идёт: она тает и проявляется.
  const lying = scene.castOf(view("nap", "сон", { part: "ночь" }), PAINTED);
  assert.doesNotMatch(scene.drawInside(view("nap", "сон", { part: "ночь" }), { ...PAINTED, was: { name: "home-work", x: 252 }, catWas: lying.cat }), /class="stride"/u);

  // Дышит: любая её картинка — в группе, которая чуть растёт и опадает (стили страницы); у стилей есть правило и
  // отказ от движения для тех, кто просил телефон не двигать картинки.
  for (const [pose, key] of [["desk", "дело"], ["chair", "уют"], ["dance", "игра"], ["nap", "сон"], ["back", "обида"]]) assert.match(scene.drawInside(view(pose, key), PAINTED), /<g class="alive">/u, key);
  const css = read("miniapp/index.html");
  for (const name of ["alive", "stride", "step", "paws", "changing"]) assert.match(css, new RegExp(`#room \\.${name}\\b[^{]*\\{[^}]*animation:`, "u"), name);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/u);

  // Байт идёт так же: прежний тает, по полу рысцой идёт Байт, на новом месте проявляется новый. Идёт он по полу —
  // даже если сидел на подоконнике: по воздуху от окна к миске коты не ходят.
  const cat = (shape, place, key = "шалит") => ({ ...view("desk", "дело"), cat: { shape, place, key } });
  const sill = scene.castOf(cat("sit", "sill"), PAINTED), bowl = scene.castOf(cat("sit", "bowl"), PAINTED);
  assert.ok(bowl.cat.y - sill.cat.y > 100, "подоконник выше пола");
  const trot = scene.drawInside(cat("sit", "bowl"), { ...PAINTED, was: sill.her, catWas: sill.cat });
  // С 0.46.0 он идёт лапами (`.pad`, `.lg`), а не подпрыгивает неподвижной фигурой (`.step.trot` до 0.46.0).
  const path = trot.match(/<g class="stride" style="--dx:(-?[\d.]+)px;--dy:(-?[\d.]+)px;--t:([\d.]+)s;--g:([\d.]+)s"><g class="pad">/u);
  assert.ok(path, "Байт идёт");
  assert.equal(Number(path[1]), sill.cat.x - bowl.cat.x, "от подоконника до миски — по горизонтали весь путь");
  assert.ok(Math.abs(Number(path[2])) < 60, `по полу, а не по воздуху: ${path[2]}`);
  assert.ok(Number(path[3]) >= 1 && Number(path[3]) <= 4.5, path[3]);
  assert.match(trot, /<g class="cat walk">/u);
  assert.doesNotMatch(trot, /step trot/u, "подскоков больше нет");
  assert.doesNotMatch(scene.drawInside(cat("sit", "sill"), { ...PAINTED, was: sill.her, catWas: sill.cat }), /class="pad"/u, "на месте — не идёт");
  // «Ушёл под кресло» — уходит туда шагом, и дальше видны одни глаза.
  const hid = scene.drawInside(cat("eyes", "under", "обижен"), { ...PAINTED, was: sill.her, catWas: sill.cat });
  assert.match(hid, /class="pad"/u);
  assert.equal(scene.castOf(cat("eyes", "under", "обижен"), PAINTED).cat.shape, "eyes");
  // Прежнего места не назвали (первый рисунок) — он просто там, где сказано.
  assert.doesNotMatch(scene.drawInside(cat("sit", "bowl"), PAINTED), /class="stride"|class="leave"/u);
});

// ── словарь ─────────────────────────────────────────────────────────────────

test("словарь 0.44.0: «у меня всегда дождь» не говорится нигде; слова о погоде — только под своё небо; о новом в комнате она отвечает сама", async () => {
  // Канон изменён словом владельца: за окном — погода города человека. Ни одна строка словаря — и строка о комнате
  // в подсказке модели — не говорит, что дождь идёт всегда.
  const NEVER = /всегда дождь|дождь не кончается|дождь ид[её]т вс[её] время|дождь, как всегда|дождь у меня почти всегда|за ним всегда дождь|вечный дождь|он у меня всегда ид[её]т|у меня всегда ид[её]т дождь/iu;
  for (const section of SECTIONS) for (const [, body] of section.l) assert.doesNotMatch(body, NEVER, `${section.n}: ${body.slice(0, 80)}`);
  assert.doesNotMatch(read("PHRASES.txt").split("\n").filter(line => !line.startsWith("#") && !line.startsWith("когда:")).join("\n"), NEVER);

  // Слова комнаты о том, что идёт за окном, — только под своё небо: в запасе этого неба или с пометкой.
  const WET = new Set(["+комната:окно", "+комната:окно:гроза"]), WHITE = new Set(["+комната:окно:снег"]), CLEAR = new Set(["+комната:окно:ясно", "+комната:окно:облачно"]);
  // Не о погоде: «полито… мокро» — о Колючке; «карта звёздного неба» — на стене; «ни звёзд, ни луны», «солнца нет» — о том, чего нет.
  const NOT_WEATHER = /Полито\.|звёздного неба|[Нн]и звёзд, ни луны|солнца нет|вместо звёзд|без дождя/u;
  for (const section of SECTIONS.filter(item => item.n.startsWith("+комната:"))) for (const [tags, body] of section.l) {
    const marks = tags ? tags.split(",") : [];
    if (NOT_WEATHER.test(body)) continue;
    // «Подождёт» — не о дожде: слово должно начинаться с «дожд».
    if (/(?<![а-яё])(?:дожд|ливен|ливн)|капл|мокр/iu.test(body)) assert.ok(WET.has(section.n) || marks.includes("дождь") || marks.includes("гроза"), `${section.n}: «${body}» — о дожде без пометки`);
    if (/снег|снеж|метел|сугроб/iu.test(body)) assert.ok(WHITE.has(section.n) || marks.includes("снег"), `${section.n}: «${body}» — о снеге без пометки`);
    if (/солнц|солнеч|звёзд[ыа]? вид|лун[аыу]\b/iu.test(body)) assert.ok(CLEAR.has(section.n) || marks.includes("ясно"), `${section.n}: «${body}» — о ясном небе без пометки`);
  }
  // У каждого неба — свои слова об окне: каждому, в любой час. И у шкафа — в обе стороны.
  for (const sky of room.SKIES) for (const part of scene.PARTS) for (const owner of [false, true]) for (const formal of [true, false]) {
    assert.ok(fitting(WINDOW[sky], { sky, part, owner, formal }).length > 0, `${sky} ${part} ${owner ? "хозяин" : "гость"}`);
    // И она, и Байт в любую погоду найдут, что сказать: распорядок не пустеет от пометок.
    for (const key of ["дело", "уют", "игра"]) if (part !== "ночь") assert.ok(fitting(`она:${key}`, { sky, part, owner, formal }).length >= 2, `она:${key} ${sky} ${part}`);
    for (const key of ["голоден", "шалит", "ласка", "сыт", "игра"]) assert.ok(fitting(`байт:${key}`, { sky, part, owner, formal }).length >= 2, `байт:${key} ${sky} ${part}`);
  }
  for (const name of ["шкаф:вечер", "шкаф:утро", "переоделась:вечер", "переоделась:утро"]) for (const owner of [false, true]) for (const formal of [true, false]) {
    const lines = fitting(name, { owner, formal });
    assert.ok(lines.length > 0, `${name} ${owner ? "хозяин" : "гость"}`);
    for (const line of lines) assert.doesNotMatch(line, /[{}]/u, line);
  }

  // О новом она отвечает сама, без модели.
  const ask = {
    // «Какая у тебя погода» — вопрос о погоде, а не о виде из окна: «крыши и фонари» на него не отвечают.
    "у тебя дождь": ["у тебя дождь?", "почему у тебя всегда дождь", "у тебя гроза", "у тебя солнце", "почему у тебя нет дождя", "откуда у тебя погода",
      "какая у тебя погода", "почему всегда дождь?", "почему в комнате всегда дождь", "откуда ты знаешь погоду", "почему у тебя гроза"],
    "за окном": ["что у тебя за окном", "что ты видишь из окна"],
    "снег за окном": ["у тебя снег", "а где дождь", "у тебя же всегда дождь"],
    "ты ходишь по комнате": ["ты ходишь по комнате", "ты теперь ходишь", "куда ты пошла"],
    "ты дышишь в комнате": ["ты дышишь", "ты как живая", "комната ожила"],
    "куда ты ушла": ["куда ты ушла", "что значит переодевается", "ты ушла к шкафу", "ты переодеваешься"],
    "время в комнате": ["в комнате стемнело", "надо ли перезаходить в комнату", "у тебя ночь", "какое у тебя время"],
    "байт на спине": ["байт на спине", "байт перевернулся на спину", "байт лежит кверху лапами"],
    "байт ходит по комнате": ["байт ходит по комнате", "куда пошел байт", "Байт сам ходит по комнате?", "почему Байт убежал"],
    "сценка в комнате видна": ["колючка упала", "почему окно открыто", "откуда лужа", "что за носок на полу", "почему лампочка мигает"],
    "на чём ты сидишь": ["на чем ты сидишь", "куда делся пуф", "ты сидишь в кресле", "где твой пуф", "почему ты в кресле"],
    // Вопросы владельца из сообщения 40 — его же словами.
    "слова и картинка": ["почему картинка не совпадает с текстом", "почему кот не на подоконнике", "кот лежит на полу", "в тексте одно а на картинке другое"],
    "своя жизнь": ["чем ты занята без меня", "вы живёте своей жизнью?", "что ты делаешь когда меня нет"],
    "кресло сзади": ["почему кресло остаётся сзади", "почему ты не в кресле"],
    "рисунок на стене": ["что за рисунок на стене", "почему подпись Мекку"],
    "!близкий заболел": ["маме будут делать операцию", "папу будут оперировать"],
    // Прежние темы не задеты.
    "!операция": ["мне будут делать операцию"],
    "когда ты переодеваешься": ["когда ты переодеваешься"],
    "ты моргаешь": ["ты моргаешь"],
    "гроза": ["гроза", "у меня гроза"],
  };
  const norm = (name) => name.replace(/ё/gu, "е");
  for (const [topic, said] of Object.entries(ask)) for (const words of said) assert.deepEqual(book.match(words)?.map(norm), [norm(topic)], words);
  // Погода человека — по-прежнему не о ней; время — тоже.
  for (const words of ["который час", "доброе утро", "у меня дождь", "дождь"]) assert.ok(!["у тебя дождь", "за окном", "время в комнате"].includes(book.match(words)?.[0]), words);

  // И отвечает правду: погода за окном — его города; без города — выдумана. Дождь она по-прежнему любит.
  const said = (name, ctx = {}) => book.pool(name, { formal: true, ...ctx }).join(" ");
  for (const owner of [false, true]) {
    assert.match(said("у тебя дождь", { owner }), /погод[аы] ваш|как у вас|вашего города/u);
    assert.match(said("за окном", { owner }), /[Тт]о же, что у вас|та же, что у вас|у вас за окном|из вашего города/u);
    assert.match(said("куда ты ушла", { owner }), /шкаф/u);
    assert.match(said("время в комнате", { owner }), /ваш[еи]/u);
    assert.match(said("на чём ты сидишь", { owner }), /[Вв] кресле/u);
    assert.match(said("слова и картинка", { owner }), /[Тт]еперь/u);
    assert.match(said("кресло сзади", { owner }), /кресл/u);
    assert.match(said("рисунок на стене", { owner }), /[Пп]оследн/u);
    assert.match(said("своя жизнь", { owner }), /Байт/u);
    // Каждая строка темы «у тебя дождь» — о погоде: на «какая у тебя погода?» любая из них — ответ.
    for (const line of book.pool("у тебя дождь", { formal: true, owner })) assert.match(line, /погод|дожд/iu, line);
  }
  assert.match(said("у тебя дождь"), /выдумываю/u);
  assert.match(said("дождь"), /любимая погода/u);
  assert.match(said("твоя комната"), /та же погода, что у вас/u);

  // В чате — без модели: спросили о погоде у неё — ответила сама.
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  for (const words of ["почему у тебя всегда дождь?", "куда ты ушла?", "байт перевернулся на спину", "куда делся пуф?"]) {
    await h.onMessage(message(words), KEY);
    assert.ok(last().length > 0, words);
  }
  assert.equal(chats().length, 0, "модель не спрошена");
  assert.match(toChat(5)[0].text, /погод|город|выдумываю/u);
});

// ── сборка 0.45.0: торт на столе, полка с книгами, кадры внутри позы ─────────

/** Вторые кадры поз — те же модули, что грузит страница. */
const FRAME_SPRITES = Object.fromEntries(await Promise.all(Object.values(scene.HER_FRAMES ?? {}).map(async ([name]) => [name, (await import(`../miniapp/her/${name}.js`)).default])));

test("торт 0.45.0: стоит на столе, как она и говорит, и рисуется после стола и лампы — мебель его не закрывает", () => {
  // Что было (день рождения владельца, 19.11.2026): слова — «на столе торт со свечкой», рисунок — торт на табурете,
  // задвинутом под стол, нарисованный раньше стола: ящик закрывал его целиком. Сердце было право, рисунок — нет.
  const view = (things) => ({ part: "день", sky: "clear", her: null, cat: null, plant: "wet", things });
  const bare = scene.drawInside(view([])), festive = scene.drawInside(view(["торт"]));
  const zone = /data-act="thing:торт"[^>]*><rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/u.exec(festive).slice(1).map(Number);
  // Место нажатия — над столешницей (её верх — 316, ящик — 322–345) и в её ширину (293–405): торт на столе.
  assert.ok(zone[1] + zone[3] <= 326 && zone[1] >= 270, `место торта по высоте: ${zone}`);
  assert.ok(zone[0] >= 293 && zone[0] + zone[2] <= 405, `место торта по ширине: ${zone}`);
  // Рисуется после стола и лампы: всё, что торт добавил в рисунок, стоит в разметке позже ручки ящика и света лампы.
  const cakeAt = festive.indexOf("url(#r-cake)"), deskAt = festive.lastIndexOf("url(#r-deskTop)"), lampAt = festive.lastIndexOf("url(#r-shade)");
  assert.ok(deskAt > 0 && lampAt > deskAt && cakeAt > lampAt, `стол в разметке на ${deskAt}, лампа — на ${lampAt}, торт — на ${cakeAt}`);
  assert.equal(bare.indexOf("url(#r-cake)"), -1, "без дня рождения торта нет");
  assert.ok(festive.length > bare.length);
  // Слова о торте называют то же место, что и рисунок.
  assert.match(pool("вещь:торт")[0], /^На столе торт со свечкой/u);
  assert.doesNotMatch(pool("вещь:торт").join(" "), /табурет/u);
  // Проверка «каждая вещь видна» — в `verify.sh page`: её сценарий лежит рядом и вызывается оттуда.
  assert.match(read("scripts/verify.sh"), /\n {2}\(cd "\$PAGE" && node room-check\.mjs [^\n]+\n {2}seen\n\}/u);
  assert.match(read("scripts/room-seen.mjs"), /const SEEN = \{ "день": 0\.3, "ночь": 0\.15 \};/u);
});

test("кадры 0.45.0: второй кадр — та же поза, а не новая; лежит поверх первой и в списки поз не входит; не загрузился — стоит одной картинкой", () => {
  const frames = Object.entries(scene.HER_FRAMES);
  assert.deepEqual(frames.map(([base, [name, how]]) => `${base}>${name}:${how}`), [
    "tea3>tea3b:sip", "home-tea3>home-tea3b:sip", "work>workb:glance", "home-work>home-workb:glance", "play2>play2b:dance", "home-play2>home-play2b:dance",
    // 0.46.0: чай у подоконника, книга, шаг — в обоих нарядах; чай под гирляндой в свитере — с 0.47.0.
    "tea>teab:sip", "home-tea>home-teab:sip", "tea2>tea2b:glance", "home-tea2>home-tea2b:glance", "read>readb:sip", "home-read>home-readb:sip", "walk>walkb:pace", "home-walk>home-walkb:pace",
  ]);
  for (const [base, [name, how]] of frames) {
    assert.ok(Object.hasOwn(scene.HER_SPRITES, base), base);
    assert.ok(!Object.hasOwn(scene.HER_SPRITES, name), `${name}: кадр — не поза`);
    assert.equal(scene.frameOf(base), name);
    // Та же фигура того же роста: кадр кладётся с числами первой картинки (`tall`, место), своя у него только ось.
    assert.equal(FRAME_SPRITES[name].h, SPRITES[base].h, name);
    // Ширина: у неподвижной позы — почти та же; у танца лента улетает в другую сторону, у шага ноги сходятся —
    // там разница больше, а совпадение головы и тела смотрит `verify.sh pairs` (ось тела у кадра — от первой картинки).
    const slack = how === "dance" || how === "pace" ? 50 : 16;
    assert.ok(Math.abs(FRAME_SPRITES[name].w - SPRITES[base].w) <= slack, `${name}: ширина ${FRAME_SPRITES[name].w} против ${SPRITES[base].w}`);
    assert.equal(FRAME_SPRITES[name].blink, undefined, `${name}: веки живут в первом кадре`);
  }
  for (const none of ["tired", "play", "tea3b", "walkb", "constructor", "", null, undefined, 7]) assert.equal(scene.frameOf(none), null, String(none));
  // Кадр не попадает ни в один список поз: ни днём, ни вечером, ни по реплике.
  const names = new Set(frames.map(([, [name]]) => name));
  for (const key of Object.keys(scene.MOODS)) for (const part of scene.PARTS) for (const pose of scene.HER_POSES) for (const beat of [false, true]) {
    for (const name of scene.spritesOf({ part, her: { pose, key, beat }, things: [] })) assert.ok(!names.has(name), `${key} ${part} ${pose}: ${name}`);
  }

  // На рисунке: оба кадра внутри «дыхания», второй — поверх первого и со своим видом движения.
  const seated = { part: "день", sky: "clear", her: { pose: "chair", key: "уют", beat: true }, cat: null, plant: "wet", things: [] };
  assert.equal(scene.spriteOf(seated), "tea3");
  const both = scene.drawRoom(seated, { sprites: { ...SPRITES, ...FRAME_SPRITES } });
  assert.match(both, /<g class="alive"><g class="fr a sip"><use href="#r-her-tea3" [^>]+\/><use class="wink" href="#r-her-tea3-blink"[^>]+\/><g class="steam"/u, "первый кадр: картинка, веки и пар над кружкой — вместе");
  assert.match(both, /<\/g><g class="fr b sip"><use href="#r-her-tea3b" [^>]+\/><\/g><\/g>/u, "второй кадр — следом, поверх");
  assert.match(both, /<image id="r-her-tea3b" /u, "определение второго кадра — в рисунке");
  // Тот же сдвиг и тот же размер: кадр ложится на ту же фигуру (ось тела у кадров общая, рост — первой картинки).
  const at = (name) => new RegExp(`<use href="#r-her-${name}" transform="translate\\(([-\\d.]+) ([-\\d.]+)\\) scale\\(([\\d.]+)\\)"`, "u").exec(both).slice(1).map(Number);
  const [ax, ay, ak] = at("tea3"), [bx, by, bk] = at("tea3b");
  assert.deepEqual([ay, ak], [by, bk]);
  assert.ok(Math.abs((ax + SPRITES.tea3.w * SPRITES.tea3.cx * ak) - (bx + FRAME_SPRITES.tea3b.w * FRAME_SPRITES.tea3b.cx * bk)) < 0.2, "ось тела у кадров — в одной точке");
  // Вечером — пара в свитере; пишет в блокнот — «glance»; танец в свитере — «dance».
  for (const [view, base, name, how] of [
    [{ ...seated, part: "вечер" }, "home-tea3", "home-tea3b", "sip"],
    [{ ...seated, her: { pose: "desk", key: "дело", beat: true } }, "work", "workb", "glance"],
    [{ ...seated, part: "ночь", her: { pose: "desk", key: "дело", beat: true, wear: "home" } }, "home-work", "home-workb", "glance"],
    [{ ...seated, part: "вечер", her: { pose: "dance", key: "игра", beat: true } }, "home-play2", "home-play2b", "dance"],
    // 0.46.0: танец — и в куртке; чай у подоконника, чай под гирляндой, книга.
    [{ ...seated, her: { pose: "dance", key: "игра", beat: true } }, "play2", "play2b", "dance"],
  ]) {
    assert.equal(scene.spriteOf(view), base);
    const drawn = scene.drawRoom(view, { sprites: { ...SPRITES, ...FRAME_SPRITES } });
    assert.match(drawn, new RegExp(`<g class="fr a ${how}"><use href="#r-her-${base}" `, "u"), base);
    assert.match(drawn, new RegExp(`<g class="fr b ${how}"><use href="#r-her-${name}" `, "u"), name);
  }
  // Второй кадр не загружен (или у позы его нет) — она одной картинкой, как раньше: ни одного слоя кадров.
  const single = scene.drawRoom(seated, PAINTED);
  assert.doesNotMatch(single, /class="fr /u);
  assert.match(single, /<g class="alive"><use href="#r-her-tea3" /u);
  assert.doesNotMatch(scene.drawRoom({ ...seated, her: { pose: "nap", key: "сон", beat: true } }, { sprites: { ...SPRITES, ...FRAME_SPRITES } }), /class="fr /u, "у спящей второго кадра нет");
  // Негодный кадр — тоже одной картинкой.
  assert.doesNotMatch(scene.drawRoom(seated, { sprites: { ...SPRITES, tea3b: { ...FRAME_SPRITES.tea3b, src: "javascript:alert(1)" } } }), /class="fr |alert/u);

  // Страница: движение кадров — стилями; при «меньше движения» второй кадр не показывается вовсе.
  const html = read("miniapp/index.html");
  assert.match(html, /#room \.fr\.b \{ opacity: 0; \}/u);
  for (const how of ["sip", "glance", "dance", "pace"]) for (const layer of ["a", "b"]) assert.match(html, new RegExp(`#room \\.${how}\\.${layer} \\{ animation: \\w+ [\\d.]+s linear infinite; \\}`, "u"), `${how}.${layer}`);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\) \{\n {2}#room \*,/u);
  // И грузит второй кадр страница сама — после самой позы; старая копия `scene.js` кадров не знает, и это не поломка.
  const app = read("miniapp/app.js");
  assert.match(app, /const frameName = \(name\) => \(typeof frameOf === "function" \? frameOf\(name\) : null\);/u);
  assert.match(app, /if \(sprites\[name\]\) fetchSprite\(frameName\(name\)\);/u);
});

test("полка с книгами 0.45.0: нажали — она берёт книгу и садится читать; полчаса или до чая; спящую и обиженную книга не трогает", async () => {
  reset();
  const time = clock();
  const h = heart(ON, { now: time.now, random: () => 0 });
  const before = await h.onRoom({ do: "look" }, from(5));
  assert.ok(room.HER_CALM.includes(before.her.key), before.her.key);
  assert.notEqual(before.her.pose, "read");

  // Взяла книгу: слова — из запаса «полка», она сама — заново: отдыхает, в кресле с книгой, и говорит об этом.
  const took = await h.onRoom({ do: "book" }, from(5));
  assert.deepEqual([took.ok, took.do, took.taken, took.again], [true, "book", true, false]);
  assert.ok(pool("полка").includes(took.line), took.line);
  assert.deepEqual([took.her.key, took.her.pose], ["уют", "read"]);
  assert.match(took.her.line, /^Читаю в кресле/u);
  assert.deepEqual(took.her.beats[0], { pose: "read", line: took.her.line });
  assert.ok(took.her.beats.length >= 3 && took.her.beats.slice(1).every(beat => beat.pose !== "read"), JSON.stringify(took.her.beats.map(beat => beat.pose)));
  assert.ok(roomOf(5).book > 0);
  // Заботой это не считается и в отношения не идёт.
  assert.equal(roomOf(5).cared, "");

  // Страница: она в кресле с книгой (картинка «read»), слова в полосе — её ответ; нажали на неё — говорит, что читает.
  const state = logic.applyBook(logic.applyLook(logic.blank(14), before, NOON), took);
  const view = logic.viewOf(state);
  assert.deepEqual([view.her.pose, view.her.key, state.said, state.busy], ["read", "уют", took.line, ""]);
  assert.equal(scene.spriteOf(view), "read");
  assert.equal(scene.spriteOf({ ...view, part: "вечер" }), "home-read");
  assert.equal(logic.applyTap(state, "her").said, took.her.line);
  // Сидит в кресле — на том же месте, что с кружкой; плед остаётся на кресле.
  assert.equal(scene.castOf(view, PAINTED).her.x, scene.castOf({ ...view, her: { ...view.her, pose: "chair" } }, PAINTED).her.x);

  // Нажали ещё раз — она уже читает: другие слова, отметка времени прежняя.
  const mark = roomOf(5).book;
  time.add(60_000);
  const twice = await h.onRoom({ do: "book" }, from(5));
  assert.deepEqual([twice.taken, twice.again, twice.her.pose], [true, true, "read"]);
  assert.ok(pool("полка:ещё").includes(twice.line), twice.line);
  assert.equal(roomOf(5).book, mark);
  // Зашёл заново или страница спросила сама — она читает; и в чате говорит о том же.
  assert.equal((await h.onRoom({ do: "look", again: true }, from(5))).her.pose, "read");
  await h.onMessage(message("зайду к тебе"), KEY);
  assert.match(last(), /Читаю в кресле/u);

  // Налили чай — кружка сильнее книги: она с кружкой, а не с книгой.
  time.add(60_000);
  const tea = await h.onRoom({ do: "tea" }, from(5));
  assert.equal(tea.ok, true);
  const warm = await h.onRoom({ do: "look", again: true }, from(5));
  assert.equal(warm.her.key, "уют");
  assert.notEqual(warm.her.pose, "read", "после чая она с кружкой");
  assert.equal(room.readingNow(roomOf(5), time.now()), false, "после чая она не читает");
  // Полчаса прошло — книга отложена сама собой.
  assert.equal(room.READ_MS, 30 * 60_000);
  assert.equal(room.readingNow({ book: 1000, tea: 0 }, 1000 + room.READ_MS - 1), true);
  assert.equal(room.readingNow({ book: 1000, tea: 0 }, 1000 + room.READ_MS), false);
  assert.equal(room.readingNow({ book: 1000, tea: 2000 }, 3000), false);
  assert.equal(room.readingNow({ book: 3000, tea: 2000 }, 4000), true, "книга после чая — читает");
  for (const none of [null, undefined, {}, { book: 0 }, { book: "x" }]) assert.equal(room.readingNow(none, 5000), false);

  // Ночью она спит: книга остаётся на полке, она — где была; страница получает одни слова.
  reset();
  const night = clock(Date.parse("2026-11-18T23:30:00Z"));
  const asleep = heart(ON, { now: night.now, random: () => 0 });
  const dark = await asleep.onRoom({ do: "look" }, from(5));
  assert.equal(dark.her.key, "сон");
  const refused = await asleep.onRoom({ do: "book" }, from(5));
  assert.deepEqual([refused.ok, refused.taken, refused.her], [true, false, undefined]);
  assert.deepEqual(pool("полка:сон"), [refused.line]);
  assert.equal(roomOf(5).book ?? 0, 0);
  const still = logic.applyBook(logic.applyLook(logic.blank(2), dark, night.now()), refused);
  assert.deepEqual([logic.viewOf(still).her.key, still.said], ["сон", refused.line]);
  // На каждое состояние, когда ей не до книг, есть свои слова.
  for (const key of Object.keys(scene.MOODS).filter(mood => !room.HER_CALM.includes(mood))) assert.ok(pool(`полка:${key}`).length >= 1, key);

  // Место нажатия — две верхние полки шкафа; вещи на полках (кружка, рамка, свеча) лежат выше него и нажимаются сами.
  const drawn = scene.drawInside({ part: "день", her: null, cat: null, things: ["кружка", "снимок", "свеча"] });
  const order = [...drawn.matchAll(/data-act="([^"]+)"/gu)].map(found => found[1]);
  assert.ok(order.includes("book"));
  for (const key of ["кружка", "снимок", "свеча"]) assert.ok(order.indexOf("book") < order.indexOf(`thing:${key}`), key);
  assert.ok(order.indexOf("window") < order.indexOf("book"));
  // Витрина (без сердца): тот же ответ тем же путём; спящая — только слова.
  const demo = logic.demoBook({ her: { key: "дело" } });
  assert.deepEqual([demo.ok, demo.taken, demo.her.pose, room.herPose(demo.her.line, "уют")], [true, true, "read", "read"]);
  assert.ok(pool("полка", { formal: true }).includes(demo.line) && pool("она:уют").includes(demo.her.line), "слова витрины — из словаря");
  assert.deepEqual([logic.demoBook({ her: { key: "сон" } }).taken, logic.demoBook({ her: { key: "сон" } }).her], [false, undefined]);
  // Сбой — её слова об ошибке, а не тишина.
  assert.notEqual(logic.applyBook(state, null).said, "");
  assert.equal(logic.applyBook(state, { ok: false, code: "storage" }).busy, "");
});

test("«считаю капли» — не «читаю»: место в её словах берётся по целому слову", () => {
  for (const line of ["Устроилась на полу, в пледе: считаю капли. Сбилась на сороковой.", "Пересчитаю записки и вернусь.", "Считаю огни за окном."]) assert.notEqual(room.herPose(line, "сон"), "read", line);
  for (const line of ["Читаю в кресле.", "Сижу и читаю мангу под гирляндой.", "Перечитываю «Маленького принца».", "Дочитываю главу.", "Листаю альбом.", "Сижу с книгой.", "В кресле, с мангой."]) assert.equal(room.herPose(line, "уют"), "read", line);
  // Прежние места — на месте: «книги уже переставила» — у полки, «манга ждёт» под гирляндой — у гирлянды.
  assert.equal(room.herPose("У полки, скрестив руки. Книги уже переставила — громче, чем нужно.", "обида"), "shelf");
  assert.equal(room.herPose("Пью чай под гирляндой. Манга ждёт: третья глава, наконец-то.", "уют"), "garland");
  assert.equal(room.herPose("Чай, кресло, плед и «Маленький принц» — в таком порядке. Пока на первом пункте.", "уют"), "chair");
});

test("0.46.0, Байт идёт лапами: четыре лапы из двух частей шагают по очереди, круг шага — по скорости; стоя на месте лапами не перебирает", () => {
  const room = (shape, place, key = "сыт") => ({ part: "день", sky: "clear", her: { pose: "desk", key: "дело" }, cat: { shape, place, key }, plant: "wet", things: [] });
  const from = scene.castOf(room("sit", "near"), PAINTED), to = scene.castOf(room("sit", "bowl"), PAINTED);
  const walking = scene.drawInside(room("sit", "bowl"), { ...PAINTED, was: from.her, catWas: from.cat });
  const gait = walking.slice(walking.indexOf('<g class="pad">'), walking.indexOf("</g></g></g>", walking.indexOf('<g class="cat walk">')));
  // Каждая лапа — верх (от плеча) и низ (от сгиба), у каждой свой черёд: 0 — передняя ближняя, 1 — задняя ближняя,
  // 2 — передняя дальняя, 3 — задняя дальняя. Так ходят коты: задняя, за ней передняя с той же стороны.
  for (const turn of [0, 1, 2, 3]) for (const part of ["up", "low"]) assert.equal(walking.split(`<g class="lg ${part} p${turn}">`).length - 1, 1, `${part} p${turn}`);
  assert.ok(gait.length > 200, "лапы — внутри идущей фигуры");
  // Группа, которую качают стили, своего сдвига не несёт: сдвиг — у группы снаружи, иначе стиль его затрёт.
  assert.doesNotMatch(walking, /<g class="(?:lg|pad)[^"]*" transform=/u);
  assert.match(walking, /<g transform="translate\([-\d.]+ [-\d.]+\)"><g class="lg up p0">/u);
  // Круг шага — по скорости: за полкруга лапа уходит назад на столько, сколько он сам прошёл; не мелькает и не волочится.
  const style = /--dx:(-?[\d.]+)px;--dy:(-?[\d.]+)px;--t:([\d.]+)s;--g:([\d.]+)s"><g class="pad">/u.exec(walking).slice(1).map(Number);
  const distance = Math.hypot(style[0], style[1]);
  assert.equal(style[2], scene.catSeconds(from.cat, to.cat));
  assert.equal(style[3], scene.gaitSeconds(distance, style[2]));
  assert.ok(style[3] >= 0.32 && style[3] <= 0.64, String(style[3]));
  const slip = Math.abs(distance / style[2] * style[3] / 2 - 13.5);
  assert.ok(slip < 2.5, `лапа на полу скользит на ${slip.toFixed(1)} точки за шаг`);
  // Шагом — не быстрее шестидесяти точек в секунду (до 0.46.0 — сто, и неподвижной фигурой); за игрушкой — бегом.
  for (const [a, b] of [[{ x: 90, y: 440 }, { x: 330, y: 470 }], [{ x: 60, y: 450 }, { x: 110, y: 452 }], [{ x: 40, y: 440 }, { x: 380, y: 480 }]]) {
    const far = Math.hypot(b.x - a.x, b.y - a.y), walk = scene.catSeconds(a, b), run = scene.catSeconds(a, b, true);
    assert.ok(walk >= 1 && walk <= 4.5 && run >= 0.7 && run <= 2.5 && run <= walk, `${far}: ${walk} / ${run}`);
    if (far > 60 && far < 240) assert.ok(far / walk <= 60, `${far} за ${walk} с`);
    const beat = scene.gaitSeconds(far, walk);
    assert.ok(beat >= 0.32 && beat <= 0.64, String(beat));
  }
  const play = scene.drawInside(room("play", "rug", "игра"), { ...PAINTED, was: from.her, catWas: scene.castOf(room("sit", "bowl"), PAINTED).cat });
  const ran = /--t:([\d.]+)s;--g:([\d.]+)s"><g class="pad">/u.exec(play);
  if (ran) assert.ok(Number(ran[1]) <= 2.5, `за игрушкой — бегом: ${ran[1]}`);
  // Стоит на месте в той же фигуре («ходит кругами») — прежний неподвижный рисунок: лапами не перебирает.
  const still = scene.drawInside(room("walk", "near", "шалит"), PAINTED);
  assert.match(still, /class="cat walk"/u);
  assert.doesNotMatch(still, /class="lg |class="pad"/u);

  // Страница: лапы качаются стилями, каждая в свой черёд; подскока (`.trot`) больше нет; при «меньше движения» — стоят.
  const html = read("miniapp/index.html");
  assert.match(html, /#room \.lg \{ animation: var\(--g, 0\.5s\) linear infinite; \}/u);
  assert.match(html, /#room \.lg\.up \{ animation-name: legUp; \}\n#room \.lg\.low \{ animation-name: legLow; \}/u);
  for (const [turn, part] of [[1, "0.75"], [2, "0.5"], [3, "0.25"]]) assert.ok(html.includes(`#room .lg.p${turn} { animation-delay: calc(var(--g, 0.5s) * -${part}); }`), `p${turn}`);
  assert.match(html, /@keyframes legUp \{ 0% \{ transform: rotate\(26deg\); \} 50% \{ transform: rotate\(-26deg\); \}/u, "полкруга лапа на полу: уходит назад прямой");
  assert.match(html, /@keyframes legLow \{ 0%, 50% \{ transform: rotate\(0deg\); \}/u, "на полу лапа не согнута");
  assert.match(html, /#room \.pad \{ animation: pad var\(--g, 0\.5s\) ease-in-out infinite; \}/u);
  assert.doesNotMatch(html, /\.trot\b/u);
});

test("0.46.0, скорость Байта: шагом — 55 точек в секунду, от секунды до четырёх с половиной; бегом — сто; круг шага — такой, чтобы лапа не скользила", () => {
  const at = (x) => ({ x, y: 470 });
  // Шагом.
  assert.equal(scene.catSeconds(at(100), at(210)), 2);
  assert.equal(scene.catSeconds(at(100), at(265)), 3);
  assert.equal(scene.catSeconds(at(100), at(110)), 1, "не короче секунды");
  assert.equal(scene.catSeconds(at(20), at(380)), 4.5, "не дольше четырёх с половиной");
  // По диагонали — по длине пути; влево — так же, как вправо.
  assert.equal(scene.catSeconds({ x: 100, y: 430 }, { x: 188, y: 496 }), 2);
  assert.equal(scene.catSeconds(at(210), at(100)), 2);
  // Бегом — за игрушкой.
  assert.equal(scene.catSeconds(at(100), at(250), true), 1.5);
  assert.equal(scene.catSeconds(at(100), at(120), true), 0.7);
  assert.equal(scene.catSeconds(at(20), at(380), true), 2.5);
  // Круг шага: за полкруга лапа проходит назад 13,5 точки — столько же проходит он сам.
  assert.equal(scene.gaitSeconds(110, 2), 0.49);
  assert.equal(scene.gaitSeconds(360, 4.5), 0.34);
  assert.equal(scene.gaitSeconds(150, 1.5), 0.32, "быстрее трети секунды лапы не мелькают");
  assert.equal(scene.gaitSeconds(20, 1), 0.64, "медленнее двух третей — не волочатся");
});

test("0.46.0, её шаг в два кадра: «ноги в шаге» и «ноги вместе» — попеременно, в обоих нарядах, в обе стороны; кадр не загрузился — идёт одной картинкой", () => {
  const all = { sprites: { ...SPRITES, ...FRAME_SPRITES } };
  const view = (part, pose) => ({ part, sky: "clear", her: { pose, key: "дело", beat: true }, cat: null, plant: "wet", things: [] });
  for (const [part, name, frame] of [["день", "walk", "walkb"], ["вечер", "home-walk", "home-walkb"]]) {
    assert.equal(scene.walkOf(view(part, "desk")), name);
    assert.equal(scene.frameOf(name), frame);
    const right = scene.drawInside(view(part, "desk"), { ...all, was: { name: part === "день" ? "work" : "home-work", x: 100 } });
    // (В сумерках у каждой картинки поверх ещё слой света — поэтому между кадрами может стоять не один элемент.)
    const pair = new RegExp(`<g class="step"><g class="fr a pace"><use href="#r-her-${name}" (?:(?!class="fr ).)*</g><g class="fr b pace"><use href="#r-her-${frame}" `, "u");
    assert.match(right, pair, `${part}: оба кадра шага — внутри покачивания`);
    // Идёт влево — оба кадра отражены вместе: одна группа с отражением вокруг них.
    const left = scene.drawInside(view(part, "shelf"), { ...all, was: { name: part === "день" ? "work" : "home-work", x: 300 } });
    assert.match(left, new RegExp(`<g class="step"><g transform="translate\\([-\\d.]+ 0\\) scale\\(-1 1\\)"><g class="fr a pace"><use href="#r-her-${name}" (?:(?!class="fr ).)*</g><g class="fr b pace"><use href="#r-her-${frame}" `, "u"), `${part}: влево`);
    // Ось тела и рост у кадров шага общие: голова не прыгает.
    const at = (which) => new RegExp(`<use href="#r-her-${which}" transform="translate\\(([-\\d.]+) ([-\\d.]+)\\) scale\\(([\\d.]+)\\)"`, "u").exec(right).slice(1).map(Number);
    const [ax, ay, ak] = at(name), [bx, by, bk] = at(frame);
    assert.deepEqual([ay, ak], [by, bk]);
    assert.ok(Math.abs((ax + SPRITES[name].w * SPRITES[name].cx * ak) - (bx + FRAME_SPRITES[frame].w * FRAME_SPRITES[frame].cx * bk)) < 0.2, `${name}: ось`);
    // Второй кадр не загружен — идёт одной картинкой, как до 0.46.0.
    const single = scene.drawInside(view(part, "desk"), { ...PAINTED, was: { name: part === "день" ? "work" : "home-work", x: 100 } });
    assert.match(single, new RegExp(`<g class="step"><use href="#r-her-${name}" `, "u"));
    assert.doesNotMatch(single, /class="fr [ab] pace"/u);
    // И входит от двери — тоже в два кадра.
    assert.match(scene.drawInside(view(part, "chair"), { ...all, enter: true }), /<g class="fr b pace">/u, `${part}: входит`);
  }
  // Определения обоих кадров шага — в рисунке, когда она идёт; когда стоит — их нет.
  const moving = scene.drawRoom(view("день", "desk"), { ...all, was: { name: "work", x: 100 } });
  assert.match(moving, /<image id="r-her-walk" /u);
  assert.match(moving, /<image id="r-her-walkb" /u);
  assert.doesNotMatch(scene.drawRoom(view("день", "desk"), all), /r-her-walkb/u);
  // Страница: кадры шага меняются в такт покачиванию — тот же круг 0,62 с.
  const html = read("miniapp/index.html");
  assert.match(html, /#room \.step \{[^}]*animation: step 0\.62s /u);
  assert.match(html, /#room \.pace\.a \{ animation: paceA 0\.62s linear infinite; \}\n#room \.pace\.b \{ animation: paceB 0\.62s linear infinite; \}/u);
  // И второй кадр шага страница грузит сама: следом за любой загруженной картинкой — её кадр (`fetchSprite`).
  assert.match(read("miniapp/app.js"), /settle\(name, store\(name, sprite\) \? sprite : false\);\n[^\n]*\n\s+fetchSprite\(frameName\(name\)\);/u);
});

test("0.46.0, лампа: вечером и ночью нажатие гасит её и зажигает — и это запоминается; днём она не горит и так; без лампы светит гирлянда", async () => {
  reset();
  const evening = clock(Date.parse("2026-11-18T16:30:00Z"));
  const h = heart(ON, { now: evening.now, random: () => 0 });
  const before = await h.onRoom({ do: "look" }, from(5));
  assert.deepEqual([before.clock.part, before.dark], ["вечер", false]);
  const off = await h.onRoom({ do: "lamp" }, from(5));
  assert.deepEqual([off.ok, off.do, off.dark, off.changed], [true, "lamp", true, true]);
  assert.ok(pool("свет:выкл").includes(off.line), off.line);
  assert.equal(roomOf(5).dark, true);
  assert.equal(roomOf(5).cared, "", "выключатель — не забота: в отношения не идёт");
  // Запомнилось: заглянул заново — в комнате по-прежнему полумрак.
  assert.equal((await h.onRoom({ do: "look" }, from(5))).dark, true);
  assert.equal((await h.onRoom({ do: "look", again: true }, from(5))).dark, true);
  const on = await h.onRoom({ do: "lamp" }, from(5));
  assert.deepEqual([on.dark, on.changed], [false, true]);
  assert.ok(pool("свет:вкл").includes(on.line), on.line);
  assert.equal(roomOf(5).dark, false);

  // Страница: свет погашен — рисунок это знает; отказ ничего не меняет; прежнее сердце (поля нет) — как было.
  const state = logic.applyLamp(logic.applyLook(logic.blank(19), before, evening.now()), off);
  assert.deepEqual([state.dark, logic.viewOf(state).dark, state.said, state.busy], [true, true, off.line, ""]);
  assert.equal(logic.viewOf(logic.applyLamp(state, on)).dark, undefined);
  assert.equal(logic.applyLamp(state, { ok: false, code: "storage" }).dark, true);
  assert.equal(logic.applyTick(state, { ...before, dark: undefined }, evening.now()).dark, true);
  assert.equal(logic.applyTick(state, { ...before, dark: false }, evening.now()).dark, false);

  // Рисунок: лампа тёмная, тёплого круга нет ни над столом, ни на полу; гирлянда светит; тень комнаты — от окна.
  const view = { part: "вечер", sky: "clear", her: { pose: "chair", key: "уют", beat: true }, cat: null, plant: "wet", things: [] };
  const lit = scene.drawRoom(view, PAINTED), dim = scene.drawRoom({ ...view, dark: true }, PAINTED);
  assert.match(lit, /lampGlow/u);
  assert.match(lit, /lampFloor/u);
  assert.match(lit, /<ellipse cx="385" cy="291\.4" rx="14" ry="3\.4" fill="#fff4d2"\/>/u, "горящая лампа: свет под колпаком");
  assert.doesNotMatch(dim, /lampGlow|lampFloor|fill="#fff4d2"/u);
  assert.match(dim, /garlandGlow/u);
  assert.match(lit, /<radialGradient id="r-dusk"[^>]*cx="385" cy="300" r="420"/u);
  assert.match(dim, /<radialGradient id="r-dusk"[^>]*cx="256" cy="50" r="480"/u);
  // Ночью — то же; днём лампа не горит и так, и выключатель рисунка не меняет.
  assert.doesNotMatch(scene.drawRoom({ ...view, part: "ночь", her: { pose: "nap", key: "сон", beat: true }, dark: true }, PAINTED), /lampGlow|lampFloor/u);
  assert.equal(scene.drawRoom({ ...view, part: "день", dark: true }, PAINTED), scene.drawRoom({ ...view, part: "день" }, PAINTED));
  // Мест нажатия два: гирлянда над окном и сама лампа — колпак с ножкой. Колпак — место вещи «абажур любимого
  // цвета», перед ножкой в день рождения стоит торт: выключателем остаётся свободное; заняты оба — только гирлянда.
  const boxes = (markup) => [...markup.matchAll(/class="tap" data-act="lamp"[^>]* id="(garland|switch)"><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/gu)].map(found => [found[1], ...found.slice(2).map(Number)]);
  assert.deepEqual(boxes(dim), [["garland", 118, 30, 276, 28], ["switch", 364, 258, 36, 62]]);
  assert.deepEqual(boxes(scene.drawRoom({ ...view, things: ["абажур"] }, PAINTED))[1], ["switch", 366, 292, 34, 28]);
  assert.deepEqual(boxes(scene.drawRoom({ ...view, things: ["торт"] }, PAINTED))[1], ["switch", 364, 258, 36, 28]);
  assert.deepEqual(boxes(scene.drawRoom({ ...view, things: ["абажур", "торт"] }, PAINTED)).map(box => box[0]), ["garland"]);
  // Ни абажур, ни торт выключатель не заслоняет: их места с его местом не пересекаются.
  const zoneOf = (markup, act) => markup.match(new RegExp(`data-act="${act}"[^>]*><rect x="([\\d.]+)" y="([\\d.]+)" width="([\\d.]+)" height="([\\d.]+)"`, "u")).slice(1).map(Number);
  const apart = (a, b) => a[0] + a[2] <= b[0] || b[0] + b[2] <= a[0] || a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1];
  const shaded = scene.drawRoom({ ...view, things: ["абажур"] }, PAINTED), feast = scene.drawRoom({ ...view, things: ["торт"] }, PAINTED);
  assert.ok(apart(boxes(shaded)[1].slice(1), zoneOf(shaded, "thing:абажур")), "абажур и ножка лампы");
  assert.ok(apart(boxes(feast)[1].slice(1), zoneOf(feast, "thing:торт")), "торт и колпак лампы");

  // Днём: только слова, выключатель — как был.
  reset();
  const noon = clock();
  const day = heart(ON, { now: noon.now, random: () => 0 });
  await day.onRoom({ do: "look" }, from(5));
  const idle = await day.onRoom({ do: "lamp" }, from(5));
  assert.deepEqual([idle.ok, idle.dark, idle.changed], [true, false, false]);
  assert.ok(pool("свет:день").includes(idle.line), idle.line);
  assert.equal(roomOf(5).dark ?? false, false);
  // Ночью она спит — и отвечает сквозь сон.
  reset();
  const night = clock(Date.parse("2026-11-18T23:30:00Z"));
  const asleep = heart(ON, { now: night.now, random: () => 0 });
  assert.equal((await asleep.onRoom({ do: "look" }, from(5))).her.key, "сон");
  const sleepy = await asleep.onRoom({ do: "lamp" }, from(5));
  assert.equal(sleepy.dark, true);
  assert.ok(pool("свет:выкл:сон").includes(sleepy.line), sleepy.line);
  assert.ok(pool("свет:вкл:сон").includes((await asleep.onRoom({ do: "lamp" }, from(5))).line));

  // Витрина: те же правила без сердца.
  const demo = logic.applyLook(logic.blank(20), logic.demoLook(20, { part: "вечер" }), NOON);
  const demoOff = logic.demoLamp(demo);
  assert.deepEqual([demoOff.ok, demoOff.dark, demoOff.changed], [true, true, true]);
  assert.equal(logic.demoLamp(logic.applyLamp(demo, demoOff)).dark, false);
  const demoDay = logic.demoLamp(logic.applyLook(logic.blank(14), logic.demoLook(14, { part: "день" }), NOON));
  assert.deepEqual([demoDay.dark, demoDay.changed], [false, false]);
  assert.equal(logic.applyLook(logic.blank(20), logic.demoLook(20, { part: "вечер", dark: "1" }), NOON).dark, true);
  // Страница знает это действие и не падает на прежней логике.
  const app = read("miniapp/app.js");
  assert.match(app, /if \(name === "lamp"\) \{ await lamp\(\); return; \}/u);
  assert.match(app, /if \(typeof applyLamp !== "function" \|\| typeof demoLamp !== "function"\) return;/u);
});

test("0.46.0, колонка: нажали — три минуты музыки, и она танцует; нажали ещё раз — выключила; доиграла — возвращается к делам; спящую музыка не будит", async () => {
  reset();
  const time = clock();
  const h = heart(ON, { now: time.now, random: () => 0 });
  const before = await h.onRoom({ do: "look" }, from(5));
  assert.equal(before.music, 0);
  assert.equal(room.MUSIC_MS, 180_000);
  const played = await h.onRoom({ do: "music" }, from(5));
  assert.deepEqual([played.ok, played.do, played.on, played.left], [true, "music", true, room.MUSIC_MS]);
  assert.ok(pool("колонка").includes(played.line), played.line);
  assert.deepEqual([played.her.key, played.her.pose], ["игра", "dance"]);
  assert.ok(pool("она:музыка").includes(played.her.line), played.her.line);
  assert.deepEqual(played.her.beats, [{ pose: "dance", line: played.her.line }], "пока играет, других занятий нет");
  assert.ok(roomOf(5).music > 0);
  assert.equal(roomOf(5).cared, "", "музыка — не забота");
  // В переписке остаётся след: модель потом знает, что ей включали музыку.
  const keptThread = await stubDb.get("SELECT messages FROM ai_memory WHERE chat_id = :chat AND user_id = :user", { ":chat": "5", ":user": "5" });
  assert.match(String(keptThread?.messages), /\[в комнате\] включил тебе музыку/u);
  // Через минуту заглянул заново: играет ещё две минуты, она танцует.
  time.add(60_000);
  const mid = await h.onRoom({ do: "look", again: true }, from(5));
  assert.equal(mid.music, room.MUSIC_MS - 60_000);
  assert.deepEqual([mid.her.key, mid.her.pose, mid.her.beats.length], ["игра", "dance", 1]);

  // Страница: колонка играет — рисунок это знает; она танцует (в куртке — картинка «play2», с 0.46.0 в два кадра).
  const state = logic.applyMusic(logic.applyLook(logic.blank(14), before, NOON), played);
  const view = logic.viewOf(state);
  assert.deepEqual([state.music, view.music, view.her.pose, view.her.key, state.said, state.busy], [room.MUSIC_MS, true, "dance", "игра", played.line, ""]);
  assert.equal(scene.spriteOf(view), "play2");
  assert.equal(scene.frameOf(scene.spriteOf(view)), "play2b");
  // Рисунок: над колонкой три ноты и огонёк — в любое время суток; без музыки днём нот нет, вечером — одна, как раньше.
  const notes = (markup) => markup.split('<g class="note"').length - 1;
  assert.equal(notes(scene.drawRoom(view, PAINTED)), 3);
  assert.equal(notes(scene.drawRoom({ ...view, music: undefined }, PAINTED)), 0);
  assert.equal(notes(scene.drawRoom({ ...view, part: "вечер", music: undefined }, PAINTED)), 1);
  assert.equal(notes(scene.drawRoom({ ...view, part: "ночь" }, PAINTED)), 3);
  const zones = [...scene.drawRoom(view, PAINTED).matchAll(/class="tap" data-act="([^"]+)"/gu)].map(found => found[1]);
  assert.ok(zones.indexOf("book") < zones.indexOf("music"), "колонка — поверх полки с книгами");

  // Нажали, пока играет, — выключила: она возвращается к своим делам, нот нет.
  const stopped = await h.onRoom({ do: "music" }, from(5));
  assert.deepEqual([stopped.ok, stopped.on, stopped.left], [true, false, 0]);
  assert.ok(pool("колонка:стоп").includes(stopped.line), stopped.line);
  assert.ok(stopped.her.beats.length > 1, "снова её обычный распорядок");
  assert.equal(roomOf(5).music, 0);
  const quiet = logic.applyMusic(state, stopped);
  assert.deepEqual([quiet.music, logic.viewOf(quiet).music], [0, undefined]);
  // Доиграла сама: через три минуты — как не включали.
  await h.onRoom({ do: "music" }, from(5));
  time.add(room.MUSIC_MS + 1000);
  const later = await h.onRoom({ do: "look", again: true }, from(5));
  assert.equal(later.music, 0);
  assert.ok(later.her.beats.length > 1);
  assert.equal(logic.applyTick(state, later, time.now()).music, 0);
  // Музыка играет, а ей предложили книгу — книга свежее: садится читать.
  await h.onRoom({ do: "music" }, from(5));
  time.add(5_000);
  assert.equal((await h.onRoom({ do: "book" }, from(5))).her.pose, "read");

  // Ночью она спит: колонка молчит, она — где была.
  reset();
  const night = clock(Date.parse("2026-11-18T23:30:00Z"));
  const asleep = heart(ON, { now: night.now, random: () => 0 });
  await asleep.onRoom({ do: "look" }, from(5));
  const no = await asleep.onRoom({ do: "music" }, from(5));
  assert.deepEqual([no.ok, no.on, no.left, no.her], [true, false, 0, undefined]);
  assert.ok(pool("колонка:сон").includes(no.line), no.line);
  assert.equal(roomOf(5).music ?? 0, 0);

  // Музыка ещё играет, а ей уже не до танцев — наступила ночь, уснула: спит, а не танцует.
  reset();
  const late = clock(Date.parse("2026-11-18T19:58:30Z"));
  const dusk = heart(ON, { now: late.now, random: () => 0 });
  await dusk.onRoom({ do: "look" }, from(5));
  assert.equal((await dusk.onRoom({ do: "music" }, from(5))).on, true);
  late.add(120_000);
  const dozed = await dusk.onRoom({ do: "look", again: true }, from(5));
  assert.ok(dozed.music > 0, "колонка ещё играет");
  assert.deepEqual([dozed.her.key, dozed.her.pose === "dance"], ["сон", false]);

  // Место нажатия — сама колонка на нижней полке; гирлянда — полоса над окном.
  const bare = scene.drawRoom({ part: "день", sky: "clear", her: null, cat: null, plant: "wet", things: [] }, PAINTED);
  assert.match(bare, /<g class="tap" data-act="music"[^>]*><rect x="12" y="322" width="45" height="46"/u);
  assert.match(bare, /<g class="tap" data-act="lamp"[^>]*><rect x="118" y="30" width="276" height="28"/u);

  // Витрина: те же правила без сердца.
  const demo = logic.applyLook(logic.blank(14), logic.demoLook(14, { part: "день", scene: "0" }), NOON);
  const on = logic.demoMusic(demo), dancing = logic.applyMusic(demo, on);
  assert.deepEqual([on.on, dancing.music, logic.viewOf(dancing).her.pose, logic.viewOf(dancing).music], [true, 180_000, "dance", true]);
  const off = logic.demoMusic(dancing);
  assert.equal(off.on, false);
  assert.deepEqual([logic.applyMusic(dancing, off).music, logic.viewOf(logic.applyMusic(dancing, off)).her.pose === "dance" && logic.applyMusic(dancing, off).her.beats.length === 1], [0, false]);
  assert.equal(logic.demoMusic({ ...demo, her: { ...demo.her, key: "сон" } }).on, false);
  assert.equal(logic.applyLook(logic.blank(14), logic.demoLook(14, { music: "1" }), NOON).music, 180_000);
  const app = read("miniapp/app.js");
  assert.match(app, /if \(name === "music"\) \{ await music\(\); return; \}/u);
  assert.match(app, /if \(typeof applyMusic !== "function" \|\| typeof demoMusic !== "function"\) return;/u);
});

test("0.46.0, мелодия колонки: играет сам телефон — ноты ставятся на такт вперёд; без включённого звука молчит; «тише» обрывает", async () => {
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
  const log = [];
  const node = (kind) => ({ kind, type: "", gain: param(), frequency: param(), Q: param(), detune: param(), playbackRate: param(), buffer: null, loop: false, connect(to) { return to; }, disconnect() {}, start(at) { log.push([kind, at]); }, stop() {} });
  class FakeAudio {
    constructor() {
      this.currentTime = 10; this.state = "suspended"; this.sampleRate = 8000; this.destination = node("out");
      FakeAudio.made = new Proxy(this, { get: (target, name) => (name in target ? target[name] : String(name).startsWith("create") ? () => node(String(name)) : undefined) });
      return FakeAudio.made;
    }
    resume() { this.state = "running"; return Promise.resolve(); }
    suspend() { this.state = "suspended"; return Promise.resolve(); }
    createBuffer(channels, length) { const data = new Float32Array(length); return { length, getChannelData: () => data }; }
  }
  const kept = globalThis.AudioContext;
  globalThis.AudioContext = FakeAudio;
  try {
    const { createSound } = await import("../miniapp/sound.js");
    const sound = createSound();
    assert.equal(sound.tune(30), false, "звук не включён — мелодии нет");
    assert.equal(await sound.on("clear"), true);
    const quietBefore = log.filter(([kind]) => kind === "createOscillator").length;
    // Следующие такты ставит таймер — в тесте время идёт по слову теста.
    mock.timers.enable({ apis: ["setTimeout"] });
    assert.equal(sound.tune(30), true);
    const tones = log.filter(([kind]) => kind === "createOscillator").slice(quietBefore);
    // Первый такт: бас и восемь нот перебором; все — не раньше «сейчас» и в пределах такта (72 удара в минуту).
    assert.equal(tones.length, 9, JSON.stringify(tones));
    const bar = 4 * 60 / 72;
    for (const [, at] of tones) assert.ok(at >= 10 && at < 10.1 + bar, String(at));
    assert.equal(new Set(tones.map(([, at]) => at.toFixed(3))).size, 8, "восемь долей такта: бас звучит вместе с первой нотой");
    // Темп: восемь нот по полудоле — последняя через три с половиной доли после первой.
    const starts = tones.map(([, at]) => at).sort((a, b) => a - b);
    assert.ok(Math.abs(starts.at(-1) - starts[0] - 3.5 * 60 / 72) < 1e-6, String(starts.at(-1) - starts[0]));
    const count = () => log.filter(([kind]) => kind === "createOscillator").length;
    // Через секунду таймер ставит следующий такт — встык с первым.
    let had = count();
    FakeAudio.made.currentTime = 11;
    mock.timers.tick(900);
    assert.equal(count() - had, 9, "следующий такт");
    assert.ok(Math.abs(Math.min(...log.slice(-9).map(([, at]) => at)) - (10.1 + bar)) < 1e-6, "встык с первым");
    // Таймер опоздал (страницу сворачивали): пропущенные такты не доигрываются разом — один такт, и не в прошлом.
    had = count();
    FakeAudio.made.currentTime = 24;
    mock.timers.tick(900);
    assert.equal(count() - had, 9, "один такт, а не все пропущенные");
    for (const [, at] of log.slice(-9)) assert.ok(at >= 24, `нота в прошлом: ${at}`);
    assert.ok(Math.abs((Math.min(...log.slice(-9).map(([, at]) => at)) - 10.1) / bar - Math.round((Math.min(...log.slice(-9).map(([, at]) => at)) - 10.1) / bar)) < 1e-6, "такт — на той же сетке");
    // «Тише» обрывает: таймер больше ничего не ставит.
    sound.hush();
    had = count();
    FakeAudio.made.currentTime = 30;
    mock.timers.tick(5000);
    assert.equal(count() - had, 0, "после «тише» нот нет");
    // Тридцать секунд — это тридцать секунд: на сороковой нот уже нет; а дольше десяти минут не играет, сколько ни проси.
    assert.equal(sound.tune(30), true);
    had = count();
    FakeAudio.made.currentTime = 55;
    mock.timers.tick(900);
    assert.equal(count() - had, 9, "на двадцать пятой секунде ещё играет");
    FakeAudio.made.currentTime = 61;
    mock.timers.tick(900);
    assert.equal(count() - had, 9, "тридцать секунд прошли");
    assert.equal(sound.tune(9000), true);
    had = count();
    FakeAudio.made.currentTime = 61 + 601;
    mock.timers.tick(900);
    assert.equal(count() - had, 0, "десять минут прошли — нот больше нет");
    assert.equal(sound.tune(0), false);
    // Щелчок выключателя — отдельный отклик.
    assert.equal(sound.play("click"), true);
    assert.equal(sound.play("нет такого"), false);
    sound.hush();
    sound.off();
    assert.equal(sound.tune(30), false, "звук выключили — мелодии нет");
  } finally {
    mock.timers.reset();
    if (kept === undefined) delete globalThis.AudioContext; else globalThis.AudioContext = kept;
  }
  // И в самой странице: колонка включает звук касанием, а мелодия продолжается, если звук включили позже.
  const app = read("miniapp/app.js");
  assert.match(app, /if \(!soundOn && canSound && !\(state\.music > 0\)\) await startSound\(\);/u);
  // Кнопка «звук», нажатая первым же касанием при запомненном «включено», не спорит с запуском, который уже идёт.
  assert.match(app, /\$\("sound"\)\?\.addEventListener\("click", async \(\) => \{\n(?:\s*\/\/[^\n]*\n)+\s+if \(soundBusy\) return;\n\s+if \(soundOn\) \{ stopSound\(\); keepSound\(false\); return; \}/u);
  assert.match(app, /function retune\(\) \{\n  const left = tuneUntil - Date\.now\(\);/u);
});

test("0.46.0, гроза: Байт под пледом — наружу один хвост, с места не ходит; приласкали — вышел; сценка дня сильнее", async () => {
  const storms = [];
  for (let id = 100; id < 3000 && storms.length < 8; id += 1) if (madeUpSky(id) === "storm") storms.push(id);
  assert.ok(storms.length >= 3, `гостей с грозой: ${storms.length}`);
  let hidden = 0;
  for (const id of storms) {
    reset();
    const time = clock();
    const h = heart(ON, { now: time.now, random: () => 0 });
    const seen = await h.onRoom({ do: "look" }, from(id));
    assert.equal(seen.sky, "storm", String(id));
    // Сценка дня держит Байта там, где сказано в ней: её слова — на странице.
    if (room.sceneLook(roomOf(id)?.scene, { today: TODAY, at: time.now() })?.cat) { assert.notEqual(seen.cat.place, "plaid", `${id}: сценка дня сильнее грозы`); continue; }
    hidden += 1;
    assert.deepEqual([seen.cat.shape, seen.cat.place, seen.cat.still, seen.cat.beats], ["tail", "plaid", true, []], String(id));
    assert.ok(pool("байт:гроза").includes(seen.cat.line), seen.cat.line);
    // Слова и рисунок — одно: по самой фразе он там же.
    const byWords = room.catPose(seen.cat.line, seen.cat.key);
    assert.deepEqual([byWords.shape, byWords.place], ["tail", "plaid"]);
    // Страница: хвост из-под пледа; своя жизнь его с места не ведёт.
    const state = logic.applyLook(logic.blank(14), seen, NOON);
    assert.deepEqual([logic.viewOf(state).cat.shape, logic.viewOf(state).cat.place], ["tail", "plaid"]);
    assert.ok(!logic.nextBeat(state, "cat"), "под пледом — не ходит");
    assert.match(scene.drawRoom(logic.viewOf(state), PAINTED), /class="cat tail"/u);
    // Погладили — вышел; и пока о нём помнят, под плед не возвращается.
    const pet = await h.onRoom({ do: "pet" }, from(id));
    assert.notEqual(pet.cat?.place, "plaid", "погладили — он рядом, а не под пледом");
    time.add(60_000);
    assert.notEqual((await h.onRoom({ do: "look", again: true }, from(id))).cat.place, "plaid", "о нём только что позаботились");
    // Обиженный уже спрятался — под кресло: гроза его под плед не переводит.
    sdk().kv.set(room.ROOM_KEY(id), JSON.stringify({ ...roomOf(id), last: "hurt", lastAt: time.now() }));
    const hurt = await h.onRoom({ do: "look", again: true }, from(id));
    assert.deepEqual([hurt.cat.key, hurt.cat.place === "plaid"], ["обижен", false], String(id));
  }
  assert.ok(hidden >= 1, "хотя бы у одного гостя с грозой сценка дня Байта не держит");
  // Все фразы запаса — про плед: иначе слова разошлись бы с рисунком.
  for (const line of pool("байт:гроза")) assert.match(line, /из-под пледа/u, line);
  // Без грозы он под плед не лезет (запас «гроза» не используется).
  reset();
  const calm = (() => { for (let id = 100; id < 3000; id += 1) if (madeUpSky(id) === "clear") return id; return 0; })();
  const fair = await heart(ON, { now: clock().now, random: () => 0 }).onRoom({ do: "look" }, from(calm));
  assert.ok(!pool("байт:гроза").includes(fair.cat.line));
  // Витрина: в грозу — так же; попросили Байта в адресе — стоит где попросили.
  const demo = logic.demoLook(14, { sky: "storm" });
  assert.deepEqual([demo.cat.shape, demo.cat.place, demo.cat.still], ["tail", "plaid", true]);
  assert.match(demo.cat.line, /из-под пледа/u);
  assert.deepEqual([logic.demoLook(14, { sky: "storm", cat: "sit.bowl.сыт" }).cat.place, logic.demoLook(14, { sky: "rain" }).cat.place === "plaid"], ["bowl", false]);
});


test("0.46.0, вечерняя тень на идущей: пока она идёт мимо окна, тень комнаты ложится и на неё — маской с теми же движениями; днём маски нет", () => {
  const view = (part) => ({ part, sky: "clear", her: { pose: "desk", key: "дело", beat: true }, cat: null, plant: "wet", things: [] });
  const walking = (part, x) => scene.drawInside(view(part), { ...PAINTED, sprites: { ...SPRITES, ...FRAME_SPRITES }, was: { name: part === "день" ? "work" : "home-work", x } });
  for (const part of ["вечер", "ночь"]) for (const x of [100, 300]) {
    const markup = walking(part, x);
    const mask = markup.match(/<mask id="r-herAirWalk" style="mask-type:alpha" maskUnits="userSpaceOnUse" x="124" y="44" width="264" height="218">(.*?)<\/mask><path fill="url\(#r-dusk\)" d="M124 44V262H388V44Z" mask="url\(#r-herAirWalk\)"\/>/u);
    assert.ok(mask, `${part}, от ${x}: маска тени на идущей`);
    // Силуэт движется так же, как сама картинка «идёт»: тот же путь и срок, то же покачивание, те же два кадра.
    const stride = markup.match(/<g class="stride" style="([^"]+)"><g class="step">/u);
    assert.ok(stride && mask[1].startsWith(`<g class="stride" style="${stride[1]}"><g class="step">`), `${part}, от ${x}: путь и срок — те же`);
    assert.match(mask[1], /<g class="fr a pace"><use href="#r-her-home-walk" [^>]+\/><\/g><g class="fr b pace"><use href="#r-her-home-walkb" [^>]+\/><\/g>/u);
    assert.equal(/scale\(-1 1\)/u.test(mask[1]), /<g class="step"><g transform="translate\([-\d.]+ 0\) scale\(-1 1\)">/u.test(markup.slice(0, markup.indexOf("<mask id=\"r-herAirWalk\""))), "повёрнута так же, как сама картинка");
    // В маске — одни картинки: без света часа и без своих масок.
    assert.doesNotMatch(mask[1], /<mask|<rect/u);
    // Тень новой позы проявляется вместе с ней — когда дошла, а не сразу тёмным силуэтом на окне; тень прежней — тает с ней.
    const late = markup.match(/<g class="arrive late" style="(--t:[\d.]+s)">/u);
    assert.ok(late && markup.includes(`<g class="arrive late" style="${late[1]}"><path fill="url(#r-dusk)" d="M124 44V262H388V44Z" mask="url(#r-herMask)"/></g>`), `${part}, от ${x}: тень новой позы — с ней`);
    assert.ok(markup.includes('<g class="leave"><path fill="url(#r-dusk)" d="M124 44V262H388V44Z" mask="url(#r-herMaskWas)"/></g>'), `${part}, от ${x}: тень прежней позы — с ней`);
    for (const id of ["r-herMask", "r-herMaskWas", "r-herAirWalk"]) assert.equal(markup.split(`<mask id="${id}"`).length, 2, `${id}: маска одна`);
  }
  // Сменила позу на том же месте (не идёт): тень новой позы проявляется с ней, прежней — тает.
  const same = scene.drawInside(view("вечер"), { ...PAINTED, was: { name: "home-tea", x: scene.spriteStand(view("вечер")).x } });
  assert.ok(same.includes('<g class="arrive"><path fill="url(#r-dusk)" d="M124 44V262H388V44Z" mask="url(#r-herMask)"/></g>'));
  assert.ok(same.includes('<g class="leave"><path fill="url(#r-dusk)" d="M124 44V262H388V44Z" mask="url(#r-herMaskWas)"/></g>'));
  assert.doesNotMatch(same, /herAirWalk|class="stride"/u);
  // Ушла к шкафу: прежняя поза тает со своей тенью, идущая — под своей; новой позы нет, и тени её нет.
  const gone = scene.drawInside({ ...view("вечер"), her: { away: true } }, { ...PAINTED, sprites: { ...SPRITES, ...FRAME_SPRITES }, was: { name: "home-work", x: 252 } });
  assert.ok(gone.includes('<g class="leave"><path fill="url(#r-dusk)" d="M124 44V262H388V44Z" mask="url(#r-herMaskWas)"/></g>'));
  assert.match(gone, /<mask id="r-herAirWalk"/u);
  assert.doesNotMatch(gone, /mask="url\(#r-herMask\)"/u);
  // Ничего не менялось — тень на ней лежит просто так, без групп.
  assert.match(scene.drawInside(view("вечер"), PAINTED), /<\/g><path fill="url\(#r-dusk\)" d="M124 44V262H388V44Z" mask="url\(#r-herMask\)"\/>|[^>]><path fill="url\(#r-dusk\)" d="M124 44V262H388V44Z" mask="url\(#r-herMask\)"\/>/u);
  assert.doesNotMatch(scene.drawInside(view("вечер"), PAINTED), /class="(?:arrive|leave)"/u);
  // Днём тени нет — и маски нет; стоит на месте — тоже.
  assert.doesNotMatch(walking("день", 100), /herAirWalk/u);
  assert.doesNotMatch(scene.drawInside(view("вечер"), PAINTED), /herAirWalk/u);
  // Второй кадр шага не загрузился — в маске одна картинка.
  const single = scene.drawInside(view("вечер"), { ...PAINTED, was: { name: "home-work", x: 100 } });
  assert.match(single, /<mask id="r-herAirWalk"[^>]*><g class="stride" style="[^"]+"><g class="step"><use href="#r-her-home-walk" [^>]+\/><\/g><\/g><\/mask>/u);
});

// ── 0.47.0: свет по солнцу (идея 164) ────────────────────────────────────────

test("0.47.0, свет по солнцу: рассвет — за сорок минут до восхода, закат — пятьдесят до захода и сорок после; короткий день делится пополам; солнца не знаем — по часам", () => {
  const M = 60_000, rise = Date.parse("2026-11-20T04:55:00Z"), set = Date.parse("2026-11-20T13:50:00Z");
  const at = (ms) => room.lightAt(ms, { rise, set });
  assert.deepEqual(at(rise - 41 * M), { light: "ночь", left: M });
  assert.deepEqual(at(rise - 40 * M), { light: "утро", left: 190 * M });
  assert.equal(at(rise + 150 * M - 1).light, "утро");
  assert.deepEqual(at(rise + 150 * M), { light: "день", left: set - 50 * M - (rise + 150 * M) });
  assert.equal(at(set - 50 * M - 1).light, "день");
  assert.deepEqual(at(set - 50 * M), { light: "вечер", left: 90 * M });
  assert.equal(at(set + 40 * M - 1).light, "вечер");
  // Стемнело: следующая перемена — завтрашний рассвет (сегодняшний плюс сутки).
  assert.deepEqual(at(set + 40 * M), { light: "ночь", left: rise - 40 * M + 24 * HOUR - (set + 40 * M) });
  assert.deepEqual(at(rise - 5 * HOUR), { light: "ночь", left: 5 * HOUR - 40 * M });
  // Зимний день в четыре часа: утро кончается в его середине, а не через два с половиной часа после восхода.
  const short = { rise: 0, set: 4 * HOUR };
  assert.deepEqual([room.lightAt(2 * HOUR - 1, short).light, room.lightAt(2 * HOUR, short).light, room.lightAt(4 * HOUR - 50 * M, short).light], ["утро", "день", "вечер"]);
  // День в два часа: закатный свет начинается с середины дня, дня между утром и вечером нет вовсе.
  const tiny = { rise: 0, set: 2 * HOUR };
  assert.deepEqual([room.lightAt(HOUR - 1, tiny).light, room.lightAt(HOUR, tiny).light, room.lightAt(70 * M, tiny).light], ["утро", "день", "вечер"]);
  assert.deepEqual(room.lightAt(HOUR, tiny), { light: "день", left: 10 * M });
  // Солнца не знаем (города нет, полярная ночь, мусор вместо чисел) — `null`: свет идёт по часам.
  for (const sun of [null, undefined, {}, { rise: 5 }, { set: 5 }, { rise: Number.NaN, set: 1 }, { rise: 10 * HOUR, set: 5 * HOUR }, { rise: 0, set: 59 * M }]) assert.equal(room.lightAt(0, sun), null, JSON.stringify(sun));
  assert.equal(room.lightAt(Number.NaN, { rise, set }), null);

  // Слова об окне: свет сошёлся с часами — пометка части суток; разошёлся — «затемно», «стемнело», «светло».
  const table = {
    "утро": { "утро": "утро", "день": "утро", "вечер": "вечер", "ночь": "затемно" },
    "день": { "утро": "день", "день": "день", "вечер": "вечер", "ночь": "стемнело" },
    "вечер": { "утро": "светло", "день": "светло", "вечер": "вечер", "ночь": "стемнело" },
    "ночь": { "утро": "утро", "день": "светло", "вечер": "вечер", "ночь": "ночь" },
  };
  for (const [part, row] of Object.entries(table)) for (const [light, tag] of Object.entries(row)) assert.equal(room.windowTag(part, light), tag, `${part} по часам, ${light} за окном`);
  for (const light of ["", undefined, null, "сумерки"]) assert.equal(room.windowTag("вечер", light), "вечер", "света не знаем — по часам");

  // На каждое небо и на каждый такой случай слова есть — и хозяину, и гостю; с временем восхода и заката и без него.
  const sun = { "восход": "08:48", "закат": "16:27" };
  for (const sky of room.SKIES) for (const tag of ["затемно", "стемнело", "светло"]) for (const owner of [true, false]) {
    const air = { owner, level: owner ? "close" : "known", part: tag, sky };
    const lines = fitting(WINDOW[sky], { ...air, vars: { ...VARS, ...sun } });
    assert.ok(lines.length >= 2, `${sky}, ${tag}: строк ${lines.length}`);
    assert.ok(fitting(WINDOW[sky], air).length >= 1, `${sky}, ${tag}: без времени восхода и заката сказать нечего`);
    for (const line of lines) {
      // Они не называют часть суток, которой на часах нет, и не оставляют скобок.
      assert.doesNotMatch(line, /^(?:Ночь|День|Вечер)[.,]|[{}]/u, line);
      if (sky !== "rain" && sky !== "storm") assert.doesNotMatch(line, /(?<![а-яё])дожд|капл/iu, `${sky}: ${line}`);
      if (sky !== "snow") assert.doesNotMatch(line, /снег|снежин|хлопь/iu, `${sky}: ${line}`);
      // Темно — значит, о солнце на небе ни слова; светло — ни слова о звёздах и луне.
      if (tag !== "светло") assert.doesNotMatch(line, /солнце и облака|на солнце|небо дневное/u, line);
      if (tag === "светло") assert.doesNotMatch(line, /звёзд|луна|фонар/u, line);
    }
    // В обычный час эти строки молчат: пометка — только под свой случай.
    for (const part of ["утро", "день", "вечер", "ночь"]) for (const line of fitting(WINDOW[sky], { ...air, part, vars: { ...VARS, ...sun } })) assert.ok(!lines.includes(line), `${part}: ${line}`);
  }
});

test("0.47.0, свет по солнцу в комнате: зимой в четыре дня — закат и лампа уже работает, в семь вечера — темно; летом в восемь вечера — светло; наряд и сон — по часам; города нет — как раньше", async () => {
  const moscow = () => source("geocoding-api.open-meteo.com", { results: [{ name: "Москва", country: "Россия", admin1: "Москва", latitude: 55.7558, longitude: 37.6173, timezone: "Europe/Moscow", feature_code: "PPLC" }] });
  const forecast = (code) => ({ current: { temperature_2m: -3, apparent_temperature: -7, weather_code: code, wind_speed_10m: 3 }, daily: { temperature_2m_max: [-1, 0, 1], temperature_2m_min: [-6, -5, -3], weather_code: [code, 3, 3], precipitation_probability_max: [80, 10, 5] } });
  const hhmm = (ms) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }).format(ms);
  const sunOn = (y, m, d) => { const times = prayersOn({ y, m, d, latitude: 55.7558, longitude: 37.6173 }); return { rise: times.sunrise, set: times.maghrib }; };
  const enter = async (iso, code = 0) => {
    reset();
    moscow();
    source("api.open-meteo.com/v1/forecast", forecast(code));
    const time = clock(Date.parse(iso));
    const h = heart({ ...ON, SOURCES: true }, { now: time.now, random: () => 0 });
    await h.onMessage(message("мой город — Москва", { id: OWNER }), KEY);
    return { h, time, out: await h.onRoom({ do: "look" }, from(OWNER)) };
  };
  const winter = sunOn(2027, 1, 15), M = 60_000;
  // Москва, 15 января: солнце встаёт около девяти и садится в половине пятого. Числа — из расчёта, а не на память.
  assert.match(hhmm(winter.rise), /^08:[3-5]\d$/u);
  assert.match(hhmm(winter.set), /^16:[1-4]\d$/u);
  const vars = { ...VARS, "восход": hhmm(winter.rise), "закат": hhmm(winter.set) };
  const air = (part) => ({ owner: true, part, sky: "clear", vars });

  // Четыре часа дня: по часам день, а за окном закат — небо вечернее, и слова о нём вечерние.
  const four = await enter("2027-01-15T13:00:00Z");
  assert.deepEqual([four.out.clock.part, four.out.clock.light, four.out.sky, four.out.city], ["день", "вечер", "clear", true]);
  assert.ok(fitting(WINDOW.clear, air("вечер")).includes(four.out.window), four.out.window);
  // Страница спросит комнату заново, когда стемнеет (через сорок минут после захода), а не в шесть по часам.
  assert.equal(four.out.clock.left, winter.set + 40 * M - four.time.now());
  assert.ok(four.out.clock.left < 2 * HOUR);
  // Она в куртке: наряд — по часам. А рисунок красится вечерним светом.
  const seen = logic.viewOf(logic.applyLook(logic.blank(13), four.out, four.time.now()));
  assert.deepEqual([seen.part, seen.light, scene.walkOf(seen)], ["день", "вечер", "walk"]);
  // И лампа уже работает: до 0.47.0 в четыре дня она отвечала «днём я не горю», хотя за окном темнело.
  const off = await four.h.onRoom({ do: "lamp" }, from(OWNER));
  assert.deepEqual([off.changed, off.dark], [true, true]);

  // Семь вечера: по часам вечер, за окном ночь. Слова — «стемнело», а не «небо над крышами розовое».
  const seven = await enter("2027-01-15T16:00:00Z");
  assert.deepEqual([seven.out.clock.part, seven.out.clock.light], ["вечер", "ночь"]);
  assert.ok(fitting(WINDOW.clear, air("стемнело")).includes(seven.out.window), seven.out.window);
  assert.ok(!fitting(WINDOW.clear, air("вечер")).includes(seven.out.window) && !fitting(WINDOW.clear, air("ночь")).includes(seven.out.window));
  // До рассвета далеко — раньше сменится час (в одиннадцать она ляжет спать).
  assert.equal(seven.out.clock.left, 4 * HOUR);
  const dusk = logic.viewOf(logic.applyLook(logic.blank(19), seven.out, seven.time.now()));
  assert.deepEqual([dusk.part, dusk.light, scene.walkOf(dusk)], ["вечер", "ночь", "home-walk"]);
  // Зашёл словами — за окном то же самое.
  await seven.h.onMessage(message("зайду к тебе", { id: OWNER }), KEY);
  assert.ok(fitting(WINDOW.clear, air("стемнело")).some(line => last(OWNER).includes(line)), last(OWNER));

  // Восемь утра: по часам утро, а солнце ещё не встало — «затемно», и до рассвета считаные минуты.
  const eight = await enter("2027-01-15T05:00:00Z");
  assert.deepEqual([eight.out.clock.part, eight.out.clock.light], ["утро", "ночь"]);
  assert.ok(fitting(WINDOW.clear, air("затемно")).includes(eight.out.window), eight.out.window);
  assert.equal(eight.out.clock.left, winter.rise - 40 * M - eight.time.now());
  // Через час рассвело: утро и по часам, и за окном — поля те же, слова обычные утренние.
  const nine = await enter("2027-01-15T06:00:00Z");
  assert.deepEqual([nine.out.clock.part, nine.out.clock.light], ["утро", "утро"]);
  assert.ok(fitting(WINDOW.clear, air("утро")).includes(nine.out.window), nine.out.window);
  assert.equal(Object.hasOwn(logic.viewOf(logic.applyLook(logic.blank(9), nine.out, nine.time.now())), "light"), false, "свет сошёлся с часами — описание рисунка прежнее");

  // Лето, восемь вечера: по часам вечер (она в свитере), а за окном день — и лампа отдыхает.
  const summer = sunOn(2027, 6, 20), june = await enter("2027-06-20T17:00:00Z");
  assert.match(hhmm(summer.set), /^21:[0-3]\d$/u);
  assert.deepEqual([june.out.clock.part, june.out.clock.light], ["вечер", "день"]);
  const bright = { owner: true, part: "светло", sky: "clear", vars: { ...VARS, "восход": hhmm(summer.rise), "закат": hhmm(summer.set) } };
  assert.ok(fitting(WINDOW.clear, bright).includes(june.out.window), june.out.window);
  const lamp = await june.h.onRoom({ do: "lamp" }, from(OWNER));
  assert.deepEqual([lamp.changed, lamp.dark], [false, false]);
  assert.ok(pool("свет:день").map(plain).includes(lamp.line), lamp.line);
  assert.doesNotMatch(pool("свет:день").join(" "), /[Дд]н[её]м|[Вв]ечером/u, "слова лампы — о свете, а не о часах: летом в восемь вечера светло");
  const late = logic.viewOf(logic.applyLook(logic.blank(20), june.out, june.time.now()));
  assert.deepEqual([late.part, late.light, scene.walkOf(late)], ["вечер", "день", "home-walk"]);

  // Города нет — солнца она не знает: поля `light` нет, свет идёт по часам, как до 0.47.0.
  reset();
  const alone = heart({ ...ON, SOURCES: true }, { now: () => Date.parse("2027-01-15T13:00:00Z"), random: () => 0 });
  const plainLook = await alone.onRoom({ do: "look" }, from(5));
  assert.deepEqual(Object.keys(plainLook.clock).sort(), ["day", "hour", "left", "part"]);
  assert.equal((await alone.onRoom({ do: "lamp" }, from(5))).changed, false, "день по часам — лампа не горит");
  // За полярным кругом в декабре солнце не встаёт: посчитать нечего — тоже по часам, и комната открывается.
  reset();
  source("geocoding-api.open-meteo.com", { results: [{ name: "Мурманск", country: "Россия", admin1: "Мурманская область", latitude: 68.9707, longitude: 33.0749, timezone: "Europe/Moscow", feature_code: "PPLA" }] });
  source("api.open-meteo.com/v1/forecast", forecast(0));
  const north = heart({ ...ON, SOURCES: true }, { now: () => Date.parse("2026-12-21T10:00:00Z"), random: () => 0 });
  await north.onMessage(message("мой город — Мурманск", { id: OWNER }), KEY);
  const polar = await north.onRoom({ do: "look" }, from(OWNER));
  assert.deepEqual([polar.ok, polar.city, Object.hasOwn(polar.clock, "light")], [true, true, false]);
});

test("0.47.0, свет по солнцу на рисунке: небо, стены и лампа красятся светом, наряд — по часам; свет сменился посреди часа — комната перетекает; прежнее сердце — как было", () => {
  const her = { pose: "desk", key: "дело", beat: true }, cat = { shape: "curl", place: "pillow", key: "спит" };
  const view = (extra) => ({ sky: "clear", her, cat, things: [], plant: "wet", ...extra });
  // Вечер по часам, день за окном: рисунок — дневной, только она в свитере.
  const summer = view({ part: "вечер", light: "день" });
  assert.equal(scene.lightIn(summer), "день");
  assert.equal(scene.walkOf(summer), "home-walk");
  assert.equal(scene.castOf(summer, PAINTED).her.name, "home-work");
  // Тот же наряд назван явно — рисунок тот же самый, что днём: свет взят из `light`, а не из часа.
  const worn = { ...her, wear: "home" };
  assert.equal(scene.drawRoom(view({ part: "вечер", light: "день", her: worn }), PAINTED), scene.drawRoom(view({ part: "день", her: worn }), PAINTED));
  assert.equal(scene.drawInside(view({ part: "день", light: "ночь", her: { ...her, wear: "jacket" } }), PAINTED), scene.drawInside(view({ part: "ночь", her: { ...her, wear: "jacket" } }), PAINTED));
  assert.notEqual(scene.drawInside(view({ part: "день", light: "ночь" }), PAINTED), scene.drawInside(view({ part: "день" }), PAINTED));
  // Свет не назван или назван мусором — по часам.
  for (const light of [undefined, "", "сумерки", 5]) assert.equal(scene.lightIn({ part: "вечер", light }), "вечер");
  assert.equal(scene.lightIn({}), "день");

  // Раскладка страницы: свет из ответа сердца; сошёлся с часами — в описании рисунка его нет.
  const look = (clock) => ({ ok: true, do: "look", build: BUILD, clock, her: { pose: "desk", key: "дело", line: "Я у стола с блокнотом." }, cat: { shape: "sit", place: "bowl", key: "сыт", line: "Байт сыт." }, plant: { state: "wet" }, things: [], window: "За окном.", sky: "clear" });
  const state = (clock) => logic.applyLook(logic.blank(12), look(clock), NOON);
  assert.deepEqual([logic.lightOf(state({ hour: 16, part: "день", light: "вечер" })), logic.viewOf(state({ hour: 16, part: "день", light: "вечер" })).light], ["вечер", "вечер"]);
  assert.equal(Object.hasOwn(logic.viewOf(state({ hour: 14, part: "день", light: "день" })), "light"), false);
  // Прежнее сердце света не называет, мусор не считается: свет по часам.
  for (const light of [undefined, "", "сумерки"]) {
    assert.equal(logic.lightOf(state({ hour: 14, part: "день", light })), "день");
    assert.equal(Object.hasOwn(logic.viewOf(state({ hour: 14, part: "день", light })), "light"), false);
  }
  // Свет не залипает: сердце перестало его называть (город убрали) — страница возвращается к часам.
  assert.equal(logic.lightOf(logic.applyLook(state({ hour: 16, part: "день", light: "вечер" }), look({ hour: 16, part: "день" }), NOON)), "день");
  // Закат посреди дня — перемена света: комната перетекает («light»), к шкафу она не идёт — наряд тот же.
  const before = state({ hour: 16, part: "день", light: "день" }), after = state({ hour: 16, part: "день", light: "вечер" });
  assert.equal(logic.changeOf(before, after).kind, "light");
  assert.equal(logic.changeOf(before, state({ hour: 16, part: "день", light: "день" })).kind, "same");
  // Час сменился, а свет остался (летом в шесть вечера светло): она переодевается, как и раньше.
  assert.equal(logic.changeOf(state({ hour: 17, part: "день", light: "день" }), state({ hour: 18, part: "вечер", light: "день" })).kind, "wardrobe");
  // Лампа на витрине — по тому же свету.
  assert.equal(logic.demoLamp({ part: "вечер", light: "день", dark: false }).changed, false);
  assert.equal(logic.demoLamp({ part: "день", light: "ночь", dark: false }).changed, true);
  assert.equal(logic.demoLamp({ part: "день", dark: false }).changed, false);
  assert.ok(pool("свет:день").map(plain).includes(logic.demoLamp({ part: "день" }).line), "витрина говорит словами словаря");
  // Витрина: свет можно назвать в адресе (для снимков), сам он там по часам телефона.
  assert.equal(logic.demoLook(14, { light: "ночь" }).clock.light, "ночь");
  assert.equal(Object.hasOwn(logic.demoLook(14, {}).clock, "light"), false);
  assert.equal(Object.hasOwn(logic.demoLook(14, { light: "сумерки" }).clock, "light"), false);
});

// ── 0.47.0: позвать Байта (идея 162), что она советует (идея 167) ─────────────

test("0.47.0, позвать Байта: нажали на ковёр — подошёл и сел рядом; второй раз за полминуты — удрал под кресло бегом; третий — снова подошёл; спит или прячется — не идёт", async () => {
  reset();
  const time = clock(NOON);
  const h = heart(ON, { now: time.now, random: () => 0 });
  await h.onRoom({ do: "look" }, from(5));
  const came = await h.onRoom({ do: "call" }, from(5));
  assert.deepEqual([came.ok, came.do, came.came, came.fled], [true, "call", true, false]);
  assert.ok(pool("байт:позвать").map(plain).includes(came.line), came.line);
  assert.deepEqual([came.cat.shape, came.cat.place, Object.hasOwn(came.cat, "run")], ["sit", "near", false]);
  assert.equal(roomOf(5).call, NOON);
  assert.equal(roomOf(5).cared, "", "зов — не забота: в отношения не идёт");
  // Через двадцать секунд зовут снова — кот решает, что дело нечисто: под кресло, бегом.
  time.add(20_000);
  const fled = await h.onRoom({ do: "call" }, from(5));
  assert.deepEqual([fled.came, fled.fled, fled.cat.shape, fled.cat.place, fled.cat.run], [false, true, "eyes", "under", true]);
  assert.ok(pool("байт:позвать:ещё").map(plain).includes(fled.line), fled.line);
  assert.equal(roomOf(5).call, 0, "удрал — отметка стёрта");
  // Третий зов — снова первый: подходит.
  time.add(5_000);
  const back = await h.onRoom({ do: "call" }, from(5));
  assert.deepEqual([back.came, back.cat.shape, back.cat.place], [true, "sit", "near"]);
  // Позвали через минуту — это не «второй раз подряд»: он просто подходит.
  time.add(room.CALL_MS + 1);
  assert.equal((await h.onRoom({ do: "call" }, from(5))).came, true);
  time.add(room.CALL_MS - 1);
  assert.equal((await h.onRoom({ do: "call" }, from(5))).fled, true, "за секунду до конца полуминуты — ещё «подряд»");
  // Комната после зова живёт дальше: заглянули заново — Байт там, где ему положено по его состоянию, не «под креслом навсегда».
  const after = await h.onRoom({ do: "look", again: true }, from(5));
  assert.ok(after.cat && room.CAT_PLACES.includes(after.cat.place));

  // Ночью он спит — на зов поворачивается одно ухо: слова есть, Байт остаётся где был.
  reset();
  const night = heart(ON, { now: () => Date.parse("2026-11-18T22:30:00Z"), random: () => 0 });
  await night.onRoom({ do: "look" }, from(5));
  const asleep = await night.onRoom({ do: "call" }, from(5));
  assert.deepEqual([asleep.ok, asleep.came, asleep.fled, Object.hasOwn(asleep, "cat")], [true, false, false, false]);
  assert.ok(pool("байт:позвать:спит").includes(asleep.line), asleep.line);
  assert.equal(roomOf(5).call, 0, "не подошёл — отметки нет");
  // Гроза: он под пледом — не выходит.
  for (const line of [...pool("байт:позвать:спит"), ...pool("байт:позвать:нет")]) assert.deepEqual(room.catPose(line, "спит"), { shape: "curl", place: "pillow" }, `«${line}» — он не двигается: в словах нет места`);
  // Слова зова не уводят его в другое место: «подошёл» — сидит рядом, «удрал» — глаза под креслом.
  for (const line of pool("байт:позвать").map(plain)) assert.deepEqual(room.catPose(line, "сыт", room.catAfter("call")), { shape: "sit", place: "near" }, line);
  for (const line of pool("байт:позвать:ещё").map(plain)) {
    assert.deepEqual(room.catPose(line, "сыт", room.catAfter("call", { again: true })), { shape: "eyes", place: "under" }, line);
    assert.match(line, /под кресло/u, line);
  }
  assert.equal(room.catAfter("call", { again: false }).place, "near");

  // Страница: ответ ставит Байта на новое место; `run` доходит до рисунка — и только на этот переход.
  const start = logic.applyLook(logic.blank(14), await (async () => { reset(); const hh = heart(ON, { now: () => NOON, random: () => 0 }); return hh.onRoom({ do: "look" }, from(5)); })(), NOON);
  const near = logic.applyCall(start, came);
  assert.deepEqual([logic.viewOf(near).cat.shape, logic.viewOf(near).cat.place, Object.hasOwn(logic.viewOf(near).cat, "run"), near.said], ["sit", "near", false, came.line]);
  const away = logic.applyCall(near, fled);
  assert.deepEqual([logic.viewOf(away).cat.shape, logic.viewOf(away).cat.place, logic.viewOf(away).cat.run], ["eyes", "under", true]);
  assert.equal(away.lines.cat, fled.line);
  // Не идёт — Байт на рисунке остаётся где был, меняются только слова.
  const stays = logic.applyCall(near, asleep);
  assert.deepEqual([logic.viewOf(stays).cat, stays.said], [logic.viewOf(near).cat, asleep.line]);
  assert.equal(logic.applyCall(near, { ok: false, text: "нет связи" }).tone, "warn");
  // На рисунке: бежит — быстрее, чем идёт; ковёр — место нажатия, и оно первое в списке (дальше всех от пальца).
  const view = (cat) => ({ part: "день", sky: "clear", her: { pose: "desk", key: "дело", beat: true }, cat, things: [] });
  const at = scene.castOf(view({ shape: "sit", place: "near", key: "сыт" }), PAINTED);
  const stride = (cat) => Number(scene.drawInside(view(cat), { ...PAINTED, was: at.her, catWas: at.cat }).match(/<g class="stride" style="--dx:-?[\d.]+px;--dy:-?[\d.]+px;--t:([\d.]+)s/u)?.[1]);
  const walked = stride({ shape: "eyes", place: "under", key: "сыт" }), ran = stride({ shape: "eyes", place: "under", key: "сыт", run: true });
  assert.ok(walked > 0 && ran > 0 && ran < walked, `шагом ${walked} с, бегом ${ran} с`);
  const zones = scene.drawInside(view({ shape: "sit", place: "bowl", key: "сыт" }), PAINTED).split('<g class="zones">')[1];
  const acts = [...zones.matchAll(/data-act="([^"]+)"/gu)].map(found => found[1]);
  assert.deepEqual(acts.slice(0, 2), ["window", "call"], "ковёр — сразу за окном: всё остальное лежит поверх него");
  assert.equal(acts.filter(name => name === "call").length, 1);
  // Витрина: подошёл; позвали ещё раз — удрал. Слова — из словаря.
  const demo = logic.demoCall({ cat: { shape: "sit", place: "bowl", key: "голоден" } });
  assert.deepEqual([demo.came, demo.cat.place], [true, "near"]);
  assert.ok(pool("байт:позвать").map(plain).includes(demo.line), demo.line);
  const twice = logic.demoCall({ cat: { shape: "sit", place: "near", key: "голоден", called: true } });
  assert.deepEqual([twice.fled, twice.cat.place, twice.cat.run], [true, "under", true]);
  assert.ok(pool("байт:позвать:ещё").map(plain).includes(twice.line), twice.line);
});

test("0.47.0, что она советует (идея 167): пока читает, второе нажатие на полку — совет, что взять; книги — те же, что она называет в чате", async () => {
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  await h.onRoom({ do: "look" }, from(5));
  const first = await h.onRoom({ do: "book" }, from(5));
  assert.deepEqual([first.taken, first.again], [true, false]);
  const again = await h.onRoom({ do: "book" }, from(5));
  assert.deepEqual([again.taken, again.again], [true, true]);
  assert.ok(pool("полка:ещё").map(plain).includes(again.line), again.line);
  // Каждая строка «ещё» называет книгу — и только ту, что есть в её списке «что почитать» или любимая.
  const known = `${book.pool("что почитать", { formal: true }).join(" ")} ${book.pool("любимая книга", { formal: true }).join(" ")}`;
  for (const line of pool("полка:ещё")) {
    const titles = [...line.matchAll(/«([^»]+)»/gu)].map(found => found[1]);
    assert.ok(titles.length >= 1 || /Чехов/u.test(line), `«${line}» — совета нет`);
    for (const title of titles) assert.ok(known.includes(title.replace(/ого принца$/u, "ий принц").replace(/^Маленьк/u, "Маленьк")) || known.includes(title), `«${title}» — такой книги в её списках нет`);
  }
  assert.match(known, /Чехов/u);
  // О том, что так можно, она говорит сама.
  assert.match(book.pool("возьми книгу", { formal: true }).join(" "), /ещё раз, пока я читаю/u);
});

// ── 0.47.0: наряд по просьбе (идея 157), чай на выбор (идея 166) ──────────────

test("0.47.0, наряд по просьбе: из нарисованных — куртка и свитер; держится, пока она не переоденется сама; спит — не переодевается; в чате — теми же словами", async () => {
  reset();
  const time = clock(NOON); // 14:00 по Москве: по часам она в куртке
  const h = heart(ON, { now: time.now, random: () => 0 });
  const first = await h.onRoom({ do: "look" }, from(5));
  assert.equal(Object.hasOwn(first.her, "wear"), false, "наряд не назван — по часам");
  // Без названия — в другой: днём это свитер. Слова — на пути к шкафу и по возвращении.
  const home = await h.onRoom({ do: "wear" }, from(5));
  assert.deepEqual([home.ok, home.do, home.wear, home.changed, home.her.wear], [true, "wear", "home", true, "home"]);
  assert.ok(pool("наряд:свитер").map(plain).includes(home.line), home.line);
  assert.ok(pool("наряд:свитер:готово").map(plain).includes(home.back), home.back);
  // Держится до шести вечера по его часам — тогда она надела бы свитер и сама.
  assert.deepEqual(roomOf(5).wear, { name: "home", until: Date.parse("2026-11-18T15:00:00Z") });
  assert.equal(roomOf(5).cared, "", "наряд — не забота: в отношения не идёт");
  assert.equal((await h.onRoom({ do: "look", again: true }, from(5))).her.wear, "home");
  // Страница: та же сцена у шкафа, что при смене часа; на рисунке — свитер днём.
  const before = logic.applyLook(logic.blank(14), first, NOON);
  const change = logic.applyWear(before, home);
  assert.deepEqual([change.kind, change.leave, change.state.her.wear, scene.walkOf(logic.viewOf(change.state))], ["wardrobe", home.line, "home", "home-walk"]);
  assert.ok(change.back.startsWith(home.back), change.back);
  assert.equal(scene.walkOf(logic.viewOf(before)), "walk");
  // Уже в нём — одни слова, рисунок не меняется.
  const same = await h.onRoom({ do: "wear", wear: "home" }, from(5));
  assert.deepEqual([same.changed, same.wear], [false, "home"]);
  assert.ok(pool("наряд:свитер:уже").map(plain).includes(same.line), same.line);
  assert.equal(logic.applyWear(change.state, same).kind, "same");
  // Обратно в куртку — то, что она надела бы и сама: выбор просто снимается.
  const jacket = await h.onRoom({ do: "wear" }, from(5));
  assert.deepEqual([jacket.wear, jacket.changed, Object.hasOwn(jacket.her, "wear")], ["jacket", true, false]);
  assert.ok(pool("наряд:куртка").map(plain).includes(jacket.line) && pool("наряд:куртка:готово").map(plain).includes(jacket.back));
  assert.equal(roomOf(5).wear, null);
  assert.equal(scene.walkOf(logic.viewOf(logic.applyWear(change.state, jacket).state)), "walk");
  // Свитер днём — и наступил вечер: выбор кончился, она в свитере уже по часам; к шкафу не идёт.
  await h.onRoom({ do: "wear", wear: "home" }, from(5));
  const day = logic.applyTick(before, await h.onRoom({ do: "look", again: true }, from(5)), time.now());
  time.set(Date.parse("2026-11-18T15:30:00Z"));
  const evening = await h.onRoom({ do: "look", again: true }, from(5));
  assert.deepEqual([evening.clock.part, Object.hasOwn(evening.her, "wear")], ["вечер", false]);
  assert.notEqual(logic.changeOf(day, logic.applyTick(day, evening, time.now())).kind, "wardrobe");
  // Вечером — куртка по просьбе: до одиннадцати; перед сном она переодевается сама.
  const late = await h.onRoom({ do: "wear" }, from(5));
  assert.deepEqual([late.wear, late.changed], ["jacket", true]);
  assert.deepEqual(roomOf(5).wear, { name: "jacket", until: Date.parse("2026-11-18T20:00:00Z") });
  time.set(Date.parse("2026-11-18T20:10:00Z"));
  const night = await h.onRoom({ do: "look", again: true }, from(5));
  assert.deepEqual([night.clock.part, night.her.key, Object.hasOwn(night.her, "wear")], ["ночь", "сон", false]);
  // Спит — не переодевается.
  const asleep = await h.onRoom({ do: "wear" }, from(5));
  assert.deepEqual([asleep.changed, asleep.wear], [false, "home"]);
  assert.ok(pool("наряд:сон").includes(asleep.line), asleep.line);
  // Незнакомый наряд — как «без названия»; мусор в записи не считается нарядом.
  assert.equal(room.wearNow({ wear: { name: "пижама", until: Infinity } }, 0), null);
  assert.equal(room.wearNow({ wear: { name: "home", until: 10 } }, 10), null);
  assert.equal(room.wearNow({ wear: { name: "home", until: 10 } }, 9), "home");
  assert.equal(room.wearNow(null, 0), null);

  // В чате — теми же словами: «надень свитер», «надень куртку», «переоденься».
  reset();
  const chat = heart(ON, { now: () => NOON, random: () => 0 });
  await chat.onMessage(message("надень свитер"), KEY);
  assert.ok(pool("наряд:свитер:готово").map(plain).some(line => last(5).includes(line)), last(5));
  assert.equal(roomOf(5).wear.name, "home");
  await chat.onMessage(message("Надень свитер!"), KEY);
  assert.ok(pool("наряд:свитер:уже").map(plain).some(line => last(5).includes(line)), last(5));
  await chat.onMessage(message("переоденься"), KEY);
  assert.ok(pool("наряд:куртка:готово").map(plain).some(line => last(5).includes(line)), last(5));
  assert.equal(roomOf(5).wear, null);
  await chat.onMessage(message("переоденься в свитер"), KEY);
  assert.equal(roomOf(5).wear.name, "home");
  assert.equal((await chat.onRoom({ do: "look" }, from(5))).her.wear, "home", "переодел словами — в комнате она в том же");
  for (const [said, op] of [["надень свитер", "wearhome"], ["надень куртку", "wearjacket"], ["переоденься в куртку", "wearjacket"], ["смени наряд", "wearswap"], ["надень что-нибудь другое", "wearswap"]]) assert.equal(room.parseRoom(said)?.op, op, said);
  // Того, чего не нарисовано, она не надевает: на это отвечает словарь.
  for (const said of ["надень платье", "надень пижаму", "надень шляпу", "переоденься в платье"]) assert.equal(room.parseRoom(said), null, said);
  assert.deepEqual(book.match("надень платье"), ["переоденься"]);
  assert.doesNotMatch(book.pool("переоденься", { formal: true }).join(" "), /не умею|[Нн]аряд меняет время/u, "о наряде по просьбе она больше не говорит «не умею»");

  // Витрина: в другой наряд; спит — нет. Слова — из словаря.
  const demo = logic.demoWear({ part: "день", her: { key: "дело" } });
  assert.deepEqual([demo.wear, demo.changed], ["home", true]);
  assert.ok(pool("наряд:свитер").includes(demo.line) && pool("наряд:свитер:готово").includes(demo.back));
  const other = logic.demoWear({ part: "день", her: { key: "дело", wear: "home" } });
  assert.deepEqual([other.wear, other.changed], ["jacket", true]);
  assert.ok(pool("наряд:куртка").includes(other.line) && pool("наряд:куртка:готово").includes(other.back));
  assert.equal(logic.demoWear({ part: "ночь", her: { key: "сон" } }).changed, false);
  assert.equal(logic.applyWear(before, { ok: false, text: "нет связи" }).state.tone, "warn");
});

test("0.47.0, чай на выбор: жасмин, улун, мята — по кругу; выбор запоминается; первая кружка — словами этого чая; в чате «налью тебе улун» выбирает и наливает", async () => {
  reset();
  const time = clock(NOON);
  const h = heart(ON, { now: time.now, random: () => 0 });
  const first = await h.onRoom({ do: "look" }, from(5));
  assert.equal(first.brew, "жасмин", "с жасмина всё начинается: он её любимый");
  const oolong = await h.onRoom({ do: "brew" }, from(5));
  assert.deepEqual([oolong.ok, oolong.do, oolong.brew], [true, "brew", "улун"]);
  assert.ok(pool("заварка:улун").map(plain).includes(oolong.line), oolong.line);
  assert.equal(roomOf(5).brew, "улун");
  assert.equal(roomOf(5).cared, "", "выбор чая — не забота");
  // Налили — её слова об улуне; вторая кружка — обычное «ещё».
  const cup = await h.onRoom({ do: "tea" }, from(5));
  assert.ok(pool("чай:улун").map(plain).includes(cup.line), cup.line);
  assert.ok(pool("чай:ещё").map(plain).includes((await h.onRoom({ do: "tea" }, from(5))).line));
  // По кругу: мята, снова жасмин; названный чай — он и есть.
  assert.equal((await h.onRoom({ do: "brew" }, from(5))).brew, "мята");
  assert.equal((await h.onRoom({ do: "brew" }, from(5))).brew, "жасмин");
  assert.equal((await h.onRoom({ do: "brew", kind: "мята" }, from(5))).brew, "мята");
  assert.equal((await h.onRoom({ do: "brew", kind: "какао" }, from(5))).brew, "жасмин", "незнакомый чай — следующий по кругу");
  await h.onRoom({ do: "brew", kind: "мята" }, from(5));
  // Запомнилось: назавтра — тот же, и первая кружка дня — о нём.
  time.add(24 * HOUR);
  assert.equal((await h.onRoom({ do: "look" }, from(5))).brew, "мята");
  const mint = await h.onRoom({ do: "tea" }, from(5));
  assert.ok(pool("чай:мята").map(plain).includes(mint.line), mint.line);
  // Жасмин — прежними словами.
  await h.onRoom({ do: "brew", kind: "жасмин" }, from(5));
  time.add(24 * HOUR);
  assert.ok(fitting("чай", { sky: (await h.onRoom({ do: "look" }, from(5))).sky }).map(plain).includes((await h.onRoom({ do: "tea" }, from(5))).line));
  // У каждого чая — слова и о выборе, и о кружке; друг о друге они не говорят.
  for (const kind of room.BREWS) {
    assert.ok(pool(`заварка:${kind}`).length >= 2, kind);
    const others = { "жасмин": /[Уу]лун|[Мм]ят/u, "улун": /[Жж]асмин|[Мм]ят/u, "мята": /[Жж]асмин|[Уу]лун/u }[kind];
    for (const line of [...pool(`заварка:${kind}`), ...(kind === "жасмин" ? [] : pool(`чай:${kind}`))]) assert.doesNotMatch(line, others, line);
  }
  assert.deepEqual([...logic.BREWS], [...room.BREWS]);

  // В чате: «налью тебе улун» — выбрать и налить; «налью тебе чай с жасмином» — выбрать жасмин, а не «тот же».
  reset();
  const chat = heart(ON, { now: () => NOON, random: () => 0 });
  await chat.onMessage(message("налью тебе улун"), KEY);
  assert.ok(pool("чай:улун").map(plain).some(line => last(5).includes(line)), last(5));
  assert.equal(roomOf(5).brew, "улун");
  assert.equal((await chat.onRoom({ do: "look" }, from(5))).brew, "улун");
  await chat.onMessage(message("налью тебе чай с жасмином"), KEY);
  assert.equal(roomOf(5).brew, "жасмин");
  for (const [said, op] of [["налью тебе улун", "brewoolong"], ["держи улун", "brewoolong"], ["заварю тебе чай с мятой", "brewmint"], ["принёс мятный чай", "brewmint"], ["налью тебе жасминовый", "brewjasmine"], ["налью тебе чай", "tea"], ["налью тебе чаю", "tea"]]) assert.equal(room.parseRoom(said)?.op, op, said);

  // Страница: чай из ответа сердца; прежнее сердце его не называет — кнопок нет (пусто).
  const state = logic.applyLook(logic.blank(14), first, NOON);
  assert.equal(state.brew, "жасмин");
  assert.equal(logic.applyBrew(state, oolong).brew, "улун");
  assert.equal(logic.applyBrew(state, oolong).said, oolong.line);
  assert.equal(logic.applyBrew(state, { ok: true, brew: "какао", line: "?" }).brew, "жасмин");
  assert.equal(logic.applyBrew(state, { ok: false, text: "нет связи" }).tone, "warn");
  const { brew: _, ...old } = first;
  assert.equal(logic.applyLook(logic.blank(14), old, NOON).brew, "");
  assert.equal(logic.blank(14).brew, "");
  // Витрина: по кругу, словами словаря.
  let demo = logic.applyLook(logic.blank(14), logic.demoLook(14, {}), NOON);
  assert.equal(demo.brew, "жасмин");
  for (const kind of ["улун", "мята", "жасмин"]) {
    const next = logic.demoBrew(demo);
    assert.equal(next.brew, kind);
    assert.ok(pool(`заварка:${kind}`).includes(next.line), next.line);
    demo = logic.applyBrew(demo, next);
  }
});
