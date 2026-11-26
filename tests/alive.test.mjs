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
  // (0.48.0: у налитого чая свой запас — «день:чай»: в каждой реплике кружка; до того она могла «читать» без неё.)
  assert.ok(fitting("день:чай", air).some(line => last().includes(line)), last());
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
  // 0.48.0: её день ведёт сердце (`steady`) — после сверки она там, где сказано им: снова в кресле с книгой.
  const ticked = logic.applyTick(next, tick, time.now());
  assert.deepEqual([ticked.her.steady, ticked.her.beat, logic.viewOf(ticked).her.pose], [true, 0, "read"]);
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
  // (0.48.0: «по настроению» — теперь по её дню: в пять вечера это эпизод «уборка» со своим запасом реплик.)
  const stage = room.stageAt(room.dayPlan(TODAY), 17 * 60);
  assert.deepEqual([later.her.stage, later.her.key], [stage.name, stage.key]);
  assert.deepEqual(later.her.beats.map(beat => beat.line).sort(), [...fitting(stage.pool, then)].sort());

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
  // `lightLeft` (0.49.0) — срок до перемены света: без города он тот же, что до перемены часа.
  assert.deepEqual(seen.clock, { hour: 17, part: "день", day: TODAY, left: 30_000, lightLeft: 30_000 });
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
  // Прежнее сердце (без `steady`): она ушла на вторую реплику — после опроса остаётся на ней, а не возвращается к
  // первой. Сердце 0.48.0 ведёт её день само: после опроса она на том шаге, который назвало оно.
  const onSecond = logic.nextBeat(state, "her"), old = { ...same, her: { ...same.her, steady: false }, cat: { ...same.cat, steady: false } };
  assert.equal(logic.applyTick(onSecond, old, time.now()).her.beat, 1);
  assert.equal(logic.changeOf(onSecond, logic.applyTick(onSecond, old, time.now())).kind, "same");
  assert.equal(logic.applyTick(onSecond, same, time.now()).her.beat, 0);
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

  // 23:00. Ночь: она засыпает — в пижаме (0.70.0), но шкафа нет: к шкафу ходит та, что не спит; свет перетекает; Байт тоже спит.
  time.set(Date.parse("2026-11-18T20:00:05Z"));
  const night = await h.onRoom({ do: "look", again: true }, from(5));
  const asleep = logic.applyTick(after, night, time.now());
  assert.deepEqual([logic.changeOf(after, asleep).kind, asleep.her.key, asleep.cat.key, asleep.cat.still], ["light", "сон", "спит", true]);
  assert.deepEqual(logic.changeOf(after, asleep).state.said.split("\n"), [night.window, night.her.line], "новый час — слова об окне и о ней");
  // 05:00. Светает, а она ещё спит (0.48.0: встаёт около семи): свет перетекает, наряд домашний — шкафа нет.
  time.set(Date.parse("2026-11-19T02:00:05Z"));
  const dawn = await h.onRoom({ do: "look", again: true }, from(5));
  const dozing = logic.applyTick(asleep, dawn, time.now());
  assert.deepEqual([dawn.clock.part, dawn.her.key, dawn.her.wear, logic.changeOf(asleep, dozing).kind], ["утро", "сон", "pajama", "light"]);
  // Подъём — около семи, у каждого дня своя минута (`dayPlan`). Час тот же, а наряд другой: из свитера в куртку (за
  // окном сухо) — снова шкаф, слова утренние.
  time.set(Date.parse("2026-11-19T00:00:00+03:00") + room.dayPlan("2026-11-19")[1].from * 60_000 + 5_000);
  const morning = await h.onRoom({ do: "look", again: true }, from(5));
  assert.deepEqual([morning.clock.part, morning.her.stage, morning.her.wear, room.dressFor(morning.sky)], ["утро", "подъём", "jacket", "jacket"]);
  assert.ok(pool("шкаф:утро").includes(morning.wardrobe.leave) && pool("переоделась:утро").includes(morning.wardrobe.back), JSON.stringify(morning.wardrobe));
  const awake = logic.applyTick(dozing, morning, time.now());
  assert.deepEqual([logic.changeOf(dozing, awake).kind, logic.changeOf(dozing, awake).leave], ["wardrobe", morning.wardrobe.leave]);
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
  // Картинка «идёт» нарисована лицом влево (сообщение 47: «она ходит задом наперёд» — до 0.48.0 код считал, что
  // вправо): идёт вправо — отражена вокруг места, куда идёт; идёт влево — как нарисована.
  assert.ok(from.her.x < to.her.x, "от шкафа к столу — вправо");
  assert.match(moved, new RegExp(`<g class="step"><g transform="translate\\(${to.her.x * 2} 0\\) scale\\(-1 1\\)">`, "u"));
  const back = scene.drawInside(view("shelf", "дело"), { ...PAINTED, was: to.her, catWas: to.cat });
  assert.match(back, /<g class="stride" [^>]*><g class="step">/u);
  assert.doesNotMatch(back, /<g class="step"><g transform="translate\([\d.]+ 0\) scale\(-1 1\)">/u);
  for (const name of ["walk", "home-walk"]) assert.equal(scene.HER_SPRITES[name].faces, "left", name);
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
    "tea>teab:sip", "home-tea>home-teab:sip", "tea2>tea2b:glance", "home-tea2>home-tea2b:glance", "read>readb:sip", "home-read>home-readb:sip", "walk>walkb:pace", "home-walk>home-walkb:pace", "pajama-walk>pajama-walkb:pace",
    // 0.49.0: кадры для поз дня, у которых движения не было.
    "work2>work2b:glance", "home-work2>home-work2b:glance", "work3>work3b:sip", "home-work3>home-work3b:sip", "tidy>tidyb:sweep", "home-tidy>home-tidyb:sweep",
    "books>booksb:sip", "home-books>home-booksb:sip", "play3>play3b:sweep", "home-play3>home-play3b:sweep",
  ]);
  for (const [base, [name, how, , grow = 1]] of frames) {
    assert.ok(Object.hasOwn(scene.HER_SPRITES, base), base);
    assert.ok(!Object.hasOwn(scene.HER_SPRITES, name), `${name}: кадр — не поза`);
    assert.equal(scene.frameOf(base), name);
    // Та же фигура того же роста: кадр кладётся с числами первой картинки (`tall`, место), своя у него только ось.
    // Четвёртое слово (0.49.0) — рост кадра относительно позы: лента взлетела выше головы, и картинка кадра выше.
    assert.equal(FRAME_SPRITES[name].h, Math.round(SPRITES[base].h * grow), name);
    // Ширина: у неподвижной позы — почти та же; у танца лента улетает в другую сторону, у шага ноги сходятся —
    // там разница больше, а совпадение головы и тела смотрит `verify.sh pairs` (ось тела у кадра — от первой картинки).
    // Взмах метёлкой и лентой (`sweep`, 0.49.0) — метёлка уходит в сторону: разница ещё больше.
    const slack = how === "sweep" ? 70 : how === "dance" || how === "pace" ? 50 : 16;
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
  // (0.48.0: кадр, на котором она смотрит на зрителя, помечен `lk`, второй — `nl`; рядом с веками — румянец, невидимый до ласки.)
  // (0.49.0: веки и румянец — в слое головы: та же картинка под мягким овалом, её наклоняют стили — `hd`, `hr`.)
  assert.match(both, /<g class="alive"><g class="fr a sip lk"><use href="#r-her-tea3" [^>]+\/><mask id="r-herHead"[^>]+><ellipse [^>]+\/><\/mask><g class="hd" style="transform-origin:[\d.]+px [\d.]+px"><g class="hr" style="transform-origin:[\d.]+px [\d.]+px"><g mask="url\(#r-herHead\)"><use href="#r-her-tea3" [^>]+\/>(?:<use class="ey[lr]" opacity="0" href="#r-her-tea3-look[lr]"[^>]+\/>)*<use class="wink" href="#r-her-tea3-blink"[^>]+\/>(?:<use class="grin" opacity="0" href="#r-her-tea3-smile"[^>]+\/>)?<mask id="r-herBlush"[^>]+><use href="#r-her-tea3" [^>]+\/><\/mask><g class="blush" opacity="0" [^>]+><g fill="#ff5f7a" [^>]+>(?:<ellipse [^>]+\/>){2}<\/g><\/g><\/g><\/g><\/g><g class="steam"/u, "первый кадр: картинка, слой головы с веками и румянцем и пар над кружкой — вместе");
  assert.match(both, /<\/g><g class="fr b sip nl"><use href="#r-her-tea3b" [^>]+\/><\/g><\/g>/u, "второй кадр — следом, поверх");
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
    // Танец не прерывается и на нажатие: пометок взгляда у его кадров нет.
    assert.match(drawn, new RegExp(`<g class="fr a ${how}${how === "dance" ? "" : " lk"}"><use href="#r-her-${base}" `, "u"), base);
    assert.match(drawn, new RegExp(`<g class="fr b ${how}${how === "dance" ? "" : " nl"}"><use href="#r-her-${name}" `, "u"), name);
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
  assert.equal(scene.spriteOf({ ...view, part: "вечер", her: { ...view.her, wear: "home" } }), "home-read");
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

test("0.55.0, Байт не идёт сквозь неё: путь знает, где она стоит, — мимо её ног он проходит за ней, отогнув путь вглубь комнаты; спит она на полу — перед ней", () => {
  const her = { x0: 222, x1: 282, y: 500, low: false };
  // Её нет — путь прямой и поверх всего, как до 0.55.0.
  assert.deepEqual(scene.catRoute({ x: 60, y: 430 }, { x: 340, y: 470 }, null), { via: null, behind: false });
  // Мимо неё не идёт вовсе: путь прямой; он за ней по глубине — и нарисован под ней.
  assert.deepEqual(scene.catRoute({ x: 90, y: 424 }, { x: 176, y: 497 }, her), { via: null, behind: true });
  // Насквозь, у самых её ног: точка поворота — за её ногами, на тридцать четыре точки глубже ступней.
  assert.deepEqual(scene.catRoute({ x: 100, y: 497 }, { x: 330, y: 497 }, her), { via: { x: 252, y: 466 }, behind: true });
  assert.deepEqual(scene.catRoute({ x: 330, y: 497 }, { x: 100, y: 497 }, her), { via: { x: 252, y: 466 }, behind: true }, "в обе стороны одинаково");
  // Насквозь, но и так в глубине комнаты — гнуть нечего.
  assert.deepEqual(scene.catRoute({ x: 100, y: 456 }, { x: 330, y: 460 }, her), { via: null, behind: true });
  assert.deepEqual(scene.catRoute({ x: 90, y: 424 }, { x: 332, y: 485 }, her), { via: null, behind: true });
  // Путь кончается у неё: за ней (сиденье кресла) — под ней; перед ней (ест у её ног) — поверх.
  assert.deepEqual(scene.catRoute({ x: 90, y: 424 }, { x: 250, y: 452 }, her), { via: null, behind: true });
  assert.deepEqual(scene.catRoute({ x: 90, y: 424 }, { x: 250, y: 497, depth: 501 }, her), { via: null, behind: false });
  assert.deepEqual(scene.catRoute({ x: 300, y: 497, depth: 501 }, { x: 340, y: 470 }, her), { via: null, behind: false }, "был перед ней — и уходит перед ней");
  // Она спит на полу, в пледе: сзади её не обойти, не пропав, — он идёт перед ней, по краю ковра.
  const low = { x0: 126, x1: 310, y: 490, low: true };
  assert.deepEqual(scene.catRoute({ x: 60, y: 430 }, { x: 340, y: 470 }, low), { via: { x: 218, y: 497 }, behind: false });
  assert.deepEqual(scene.catRoute({ x: 60, y: 497 }, { x: 340, y: 496 }, low), { via: null, behind: false }, "и так идёт по краю");
});

test("0.55.0, Байт обходит её на рисунке: путь в два отрезка под её слоем, срок — по длине пути; она идёт ему наперерез — он ждёт, пока она дойдёт; язык убран", () => {
  const room = (cat, her = { pose: "desk", key: "дело" }, part = "день") => ({ part, sky: "clear", her, cat, plant: "wet", things: [] });
  const near = { shape: "sit", place: "near", key: "сыт" };
  const stood = scene.castOf(room(near), PAINTED);
  // Он был справа от неё, у самых ног, а место «рядом с ней» — слева: по прямой прошёл бы сквозь её ноги.
  const was = { x: stood.her.x + 80, y: 497, shape: "sit", mirror: false, k: 1 };
  assert.ok(stood.cat.x < stood.her.x && stood.cat.y === 497, JSON.stringify(stood));
  const made = scene.drawParts(room(near), { ...PAINTED, was: stood.her, catWas: was });
  const walkAt = made.parts.findIndex(piece => piece.includes('class="cat walk"')), herAt = made.parts.findIndex(piece => piece.includes(`#r-her-${stood.her.name}"`));
  assert.ok(walkAt >= 0 && herAt >= 0 && walkAt < herAt, `идущий Байт — под ней: ${walkAt} и ${herAt}`);
  const bent = /^<g class="stride" style="--t:([\d.]+)s;--g:([\d.]+)s"><g class="seg" style="--dx:(-?[\d.]+)px;--dy:(-?[\d.]+)px;--t:([\d.]+)s;--w:0s"><g class="seg" style="--dx:(-?[\d.]+)px;--dy:(-?[\d.]+)px;--t:([\d.]+)s;--w:([\d.]+)s"><g class="pad">/u.exec(made.parts[walkAt]);
  assert.ok(bent, made.parts[walkAt].slice(0, 260));
  const [whole, gait, dx1, dy1, t1, dx2, dy2, t2, w2] = bent.slice(1).map(Number);
  // Два отрезка вместе — весь путь: от прежнего места до нового; поворот — за её ногами, в глубине.
  assert.equal(dx1 + dx2, was.x - stood.cat.x);
  assert.equal(dy1 + dy2, 0);
  assert.equal(dy1, 34 - 3, "от её ступней — на тридцать четыре точки вглубь");
  assert.equal(was.x - dx1, stood.her.x, "поворот — прямо за ней");
  // Срок — по длине пути, а не по прямой; второй отрезок начинается, когда кончился первый.
  const length = Math.hypot(dx1, dy1) + Math.hypot(dx2, dy2);
  assert.equal(whole, scene.catSeconds({ x: 0, y: 0 }, { x: length, y: 0 }));
  assert.equal(gait, scene.gaitSeconds(length, whole));
  assert.equal(Math.round((t1 + t2) * 10) / 10, whole);
  assert.equal(w2, t1);
  assert.match(made.parts.join(""), new RegExp(`<g class="leave"><g transform="translate\\(${was.x} 497\\)"><g class="cat sit">`, "u"));
  assert.match(made.parts.join(""), new RegExp(`<g class="arrive late" style="--t:${whole}s">`, "u"));
  // Её часть рисунка при этом та же, что без его перехода: страница её не трогает, и её движения не начинаются заново.
  assert.equal(made.parts[herAt], scene.drawParts(room(near), PAINTED).parts[herAt]);
  // Мимо неё по прямой — разметка прежняя, один отрезок.
  const aside = scene.drawInside(room({ shape: "sit", place: "bowl", key: "сыт" }), { ...PAINTED, was: stood.her, catWas: stood.cat });
  assert.match(aside, /<g class="stride" style="--dx:-?[\d.]+px;--dy:-?[\d.]+px;--t:[\d.]+s;--g:[\d.]+s"><g class="pad">/u);
  assert.doesNotMatch(aside, /class="seg"|--w:/u);

  // Она сама идёт к столу — как раз через его путь: Байт сидит, где сидел, пока она не дойдёт, и только тогда идёт.
  const cross = scene.drawInside(room(near), { ...PAINTED, was: { name: stood.her.name, x: 100 }, catWas: was });
  const hers = scene.walkSeconds(100, stood.her.x), wait = Math.round((hers - 0.2) * 10) / 10;
  assert.ok(wait >= 1, String(wait));
  const held = new RegExp(`<g class="stride" style="--t:([\\d.]+)s;--g:[\\d.]+s;--w:${wait}s"><g class="seg" style="[^"]+;--w:${wait}s"><g class="seg" style="[^"]+;--w:([\\d.]+)s">`, "u").exec(cross);
  assert.ok(held, "ждёт её");
  assert.ok(Number(held[2]) > wait, "второй отрезок — после первого");
  assert.match(cross, new RegExp(`<g class="leave" style="--w:${wait}s"><g transform="translate\\(${was.x} 497\\)"><g class="cat sit">`, "u"));
  assert.match(cross, new RegExp(`<g class="arrive late" style="--t:${Math.round((wait + Number(held[1])) * 10) / 10}s"><(?:path|ellipse|g)[^>]*>(?:<[^>]+>)*?<g class="cat sit">`, "u"));
  // Она идёт в стороне от его пути — ждать некого.
  const sill = { shape: "sit", place: "sill", key: "сыт" }, shelf = { pose: "shelf", key: "дело" };
  const apart = scene.castOf(room(sill, shelf), PAINTED);
  assert.ok(apart.cat.x - 56 > apart.her.x, JSON.stringify(apart));
  const free = scene.drawInside(room(sill, shelf), { ...PAINTED, was: { name: apart.her.name, x: 100 }, catWas: { x: 332, y: 485, shape: "sit", mirror: false, k: 1 } });
  assert.match(free, /class="cat walk"/u);
  assert.match(free, /class="step"/u, "она идёт");
  assert.doesNotMatch(free, /--w:/u);
  // Она ушла к шкафу через его путь — он пропускает её и идёт уже по пустой комнате, по прямой.
  const gone = scene.drawInside({ ...room(near), her: { pose: "desk", key: "дело", away: true } }, { ...PAINTED, was: stood.her, catWas: was });
  assert.match(gone, /<g class="stride" style="--dx:-?[\d.]+px;--dy:-?[\d.]+px;--t:[\d.]+s;--g:[\d.]+s;--w:[\d.]+s"><g class="pad">/u);

  // Она спит на полу — он идёт перед ней: его часть — над её частью, путь отогнут к краю ковра.
  const asleep = room({ shape: "curl", place: "pillow", key: "спит" }, { pose: "nap", key: "сон" }, "ночь");
  const night = scene.castOf(asleep, PAINTED);
  const lying = scene.drawParts(asleep, { ...PAINTED, was: night.her, catWas: { x: 60, y: 430, shape: "sit", mirror: false, k: 1 } });
  const walkLow = lying.parts.findIndex(piece => piece.includes('class="cat walk"')), herLow = lying.parts.findIndex(piece => piece.includes(`#r-her-${night.her.name}"`));
  assert.ok(herLow >= 0 && walkLow > herLow, `идущий Байт — над ней: ${walkLow} и ${herLow}`);
  const low = /class="seg" style="--dx:(-?[\d.]+)px;--dy:(-?[\d.]+)px;/u.exec(lying.parts[walkLow]);
  assert.ok(low && Number(low[2]) === 430 - 497, "первый отрезок — к краю ковра");

  // Стили: отрезок пути, ожидание у идущего и у тающего; страница ждёт конца перехода вместе с ожиданием.
  const html = read("miniapp/index.html");
  assert.match(html, /#room \.seg \{ animation: seg var\(--t, 1s\) linear var\(--w, 0s\) backwards; \}/u);
  assert.match(html, /@keyframes seg \{ from \{ transform: translate\(var\(--dx, 0px\), var\(--dy, 0px\)\); \} to \{ transform: translate\(0px, 0px\); \} \}/u);
  assert.match(html, /#room \.stride \{ opacity: 0; animation: stride var\(--t, 1\.5s\) linear var\(--w, 0s\); \}/u);
  assert.match(html, /#room \.leave \{ opacity: 0; animation: leave 0\.5s ease-in var\(--w, 0s\) backwards; \}/u);
  assert.match(read("miniapp/app.js"), /getPropertyValue\("--t"\)\) \|\| 3\.5\) \+ \(Number\.parseFloat\(stride\.style\.getPropertyValue\("--w"\)\) \|\| 0\)/u);

  // Язык (сообщение 65: «убери язык у кота, а то он на собаку похож»): розового под ртом нет ни у одной морды.
  for (const key of ["шалит", "сыт", "голоден", "обижен", "игра", "ласка", "спит"]) for (const shape of ["sit", "lie", "play", "walk", "beg", "claw", "eat", "belly", "gift"]) {
    const drawn = scene.drawInside(room({ shape, place: "rug", key }), PAINTED);
    assert.doesNotMatch(drawn, /f08aa8/iu, `${key}, ${shape}`);
    assert.doesNotMatch(drawn, /M-1\.7 6\.5 h3\.4/u, `${key}, ${shape}`);
  }
  assert.doesNotMatch(read("miniapp/scene.js"), /f08aa8/iu);
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
    const pair = `<g class="fr a pace"><use href="#r-her-${name}" (?:(?!class="fr ).)*</g><g class="fr b pace"><use href="#r-her-${frame}" `;
    // Идёт влево — как нарисована (лицом влево): оба кадра шага — внутри покачивания.
    const left = scene.drawInside(view(part, "shelf"), { ...all, was: { name: part === "день" ? "work" : "home-work", x: 300 } });
    assert.match(left, new RegExp(`<g class="step">${pair}`, "u"), `${part}: влево — оба кадра шага внутри покачивания`);
    // Идёт вправо — оба кадра отражены вместе: одна группа с отражением вокруг них.
    assert.match(right, new RegExp(`<g class="step"><g transform="translate\\([-\\d.]+ 0\\) scale\\(-1 1\\)">${pair}`, "u"), `${part}: вправо`);
    // Ось тела и рост у кадров шага общие: голова не прыгает.
    const at = (which) => new RegExp(`<use href="#r-her-${which}" transform="translate\\(([-\\d.]+) ([-\\d.]+)\\) scale\\(([\\d.]+)\\)"`, "u").exec(right).slice(1).map(Number);
    const [ax, ay, ak] = at(name), [bx, by, bk] = at(frame);
    assert.deepEqual([ay, ak], [by, bk]);
    assert.ok(Math.abs((ax + SPRITES[name].w * SPRITES[name].cx * ak) - (bx + FRAME_SPRITES[frame].w * FRAME_SPRITES[frame].cx * bk)) < 0.2, `${name}: ось`);
    // Второй кадр не загружен — идёт одной картинкой, как до 0.46.0.
    const single = scene.drawInside(view(part, "desk"), { ...PAINTED, was: { name: part === "день" ? "work" : "home-work", x: 100 } });
    assert.match(single, new RegExp(`<g class="step"><g transform="translate\\([-\\d.]+ 0\\) scale\\(-1 1\\)"><use href="#r-her-${name}" `, "u"));
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
    // (0.48.0: реплика о Байте считается из времени, а среди его обиженных есть и «из-под пледа торчит хвост» —
    // поэтому сверяется не место, а запас: слова — его обиды, а не грозы.)
    assert.deepEqual([hurt.cat.key, pool("байт:обижен").map(plain).includes(hurt.cat.line), pool("байт:гроза").map(plain).includes(hurt.cat.line)], ["обижен", true, false], String(id));
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
  // (Идёт вправо — картинка, нарисованная лицом влево, отражена: и в маске тоже.)
  assert.match(single, /<mask id="r-herAirWalk"[^>]*><g class="stride" style="[^"]+"><g class="step"><g transform="translate\([-\d.]+ 0\) scale\(-1 1\)"><use href="#r-her-home-walk" [^>]+\/><\/g><\/g><\/g><\/mask>/u);
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
  assert.deepEqual(Object.keys(plainLook.clock).sort(), ["day", "hour", "left", "lightLeft", "part"]);
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
  assert.deepEqual([first.sky, first.her.wear], ["clear", "jacket"], "наряд назван всегда (0.48.0): днём — по погоде, в ясный день — куртка");
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
  assert.deepEqual([jacket.wear, jacket.changed, jacket.her.wear], ["jacket", true, "jacket"]);
  assert.ok(pool("наряд:куртка").map(plain).includes(jacket.line) && pool("наряд:куртка:готово").map(plain).includes(jacket.back));
  assert.equal(roomOf(5).wear, null);
  assert.equal(scene.walkOf(logic.viewOf(logic.applyWear(change.state, jacket).state)), "walk");
  // Свитер днём — и наступил вечер: выбор кончился, она в свитере уже по часам; к шкафу не идёт.
  await h.onRoom({ do: "wear", wear: "home" }, from(5));
  const day = logic.applyTick(before, await h.onRoom({ do: "look", again: true }, from(5)), time.now());
  time.set(Date.parse("2026-11-18T15:30:00Z"));
  const evening = await h.onRoom({ do: "look", again: true }, from(5));
  assert.deepEqual([evening.clock.part, evening.her.wear], ["вечер", "home"]);
  assert.notEqual(logic.changeOf(day, logic.applyTick(day, evening, time.now())).kind, "wardrobe");
  // Вечером — куртка по просьбе: до одиннадцати; перед сном она переодевается сама.
  const late = await h.onRoom({ do: "wear" }, from(5));
  assert.deepEqual([late.wear, late.changed], ["jacket", true]);
  assert.deepEqual(roomOf(5).wear, { name: "jacket", until: Date.parse("2026-11-18T20:00:00Z") });
  time.set(Date.parse("2026-11-18T20:10:00Z"));
  const night = await h.onRoom({ do: "look", again: true }, from(5));
  assert.deepEqual([night.clock.part, night.her.key, night.her.wear], ["ночь", "сон", "pajama"], "спит она в пижаме (0.70.0)");
  // Спит — не переодевается.
  const asleep = await h.onRoom({ do: "wear" }, from(5));
  assert.deepEqual([asleep.changed, asleep.wear], [false, "pajama"]);
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
  for (const [said, op] of [["надень свитер", "wearhome"], ["надень куртку", "wearjacket"], ["переоденься в куртку", "wearjacket"], ["смени наряд", "wearswap"], ["надень что-нибудь другое", "wearswap"], ["надень пижаму", "wearpajama"], ["переоденься в пижаму", "wearpajama"], ["надень худи", "wearhoodie"], ["переоденься в худи", "wearhoodie"]]) assert.equal(room.parseRoom(said)?.op, op, said);
  // Того, чего не нарисовано, она не надевает: на это отвечает словарь.
  for (const said of ["надень платье", "надень шляпу", "переоденься в платье"]) assert.equal(room.parseRoom(said), null, said);
  assert.deepEqual(book.match("надень платье"), ["переоденься"]);
  assert.doesNotMatch(book.pool("переоденься", { formal: true }).join(" "), /не умею|[Нн]аряд меняет время/u, "о наряде по просьбе она больше не говорит «не умею»");

  // Витрина: в другой наряд; спит — нет. Слова — из словаря.
  const demo = logic.demoWear({ part: "день", her: { key: "дело" } });
  assert.deepEqual([demo.wear, demo.changed], ["hoodie", true]);
  assert.ok(pool("наряд:худи").includes(demo.line) && pool("наряд:худи:готово").includes(demo.back));
  const other = logic.demoWear({ part: "день", her: { key: "дело", wear: "hoodie" } });
  assert.deepEqual([other.wear, other.changed], ["home", true]);
  assert.ok(pool("наряд:свитер").includes(other.line) && pool("наряд:свитер:готово").includes(other.back));
  assert.equal(logic.demoWear({ part: "ночь", her: { key: "сон" } }).changed, false);
  assert.equal(logic.applyWear(before, { ok: false, text: "нет связи" }).state.tone, "warn");
});

test("0.70.0, пижама с облаками: вечером по просьбе — словом и кнопкой по кругу; днём — отказ; с половины одиннадцатого — сама; чего в пижаме нет — в свитере", async () => {
  reset();
  const time = clock(NOON); // 14:00 по Москве
  const h = heart(ON, { now: time.now, random: () => 0 });
  await h.onRoom({ do: "look" }, from(5));
  // Днём — отказ словами, наряд прежний.
  const early = await h.onRoom({ do: "wear", wear: "pajama" }, from(5));
  assert.deepEqual([early.ok, early.changed, early.wear], [true, false, "jacket"]);
  assert.ok(pool("наряд:пижама:рано").map(plain).includes(early.line), early.line);
  assert.equal(roomOf(5).wear, null);
  // Кнопка под рисунком называет следующий наряд по кругу; днём — без пижамы.
  assert.deepEqual([logic.nextWear("день", "jacket"), logic.nextWear("день", "hoodie"), logic.nextWear("день", "home"), logic.nextWear("день", "pajama"), logic.nextWear("день")], ["hoodie", "home", "jacket", "jacket", "hoodie"]);
  assert.deepEqual([logic.nextWear("вечер", "jacket"), logic.nextWear("вечер", "hoodie"), logic.nextWear("вечер", "home"), logic.nextWear("вечер"), logic.nextWear("ночь", "pajama")], ["hoodie", "home", "pajama", "pajama", "jacket"]);
  assert.deepEqual(Object.keys(logic.WEAR_LABELS).sort(), ["home", "hoodie", "jacket", "pajama"]);
  // Вечером — надевает: слова на пути к шкафу и по возвращении; второй раз — «уже».
  time.set(Date.parse("2026-11-18T15:30:00Z")); // 18:30
  const evening = await h.onRoom({ do: "look", again: true }, from(5));
  assert.deepEqual([evening.clock.part, evening.her.wear], ["вечер", "home"]);
  const worn = await h.onRoom({ do: "wear", wear: "pajama" }, from(5));
  assert.deepEqual([worn.ok, worn.changed, worn.wear, worn.her.wear], [true, true, "pajama", "pajama"]);
  assert.ok(pool("наряд:пижама").map(plain).includes(worn.line), worn.line);
  assert.ok(pool("наряд:пижама:готово").map(plain).includes(worn.back), worn.back);
  const same = await h.onRoom({ do: "wear", wear: "pajama" }, from(5));
  assert.deepEqual([same.changed, same.wear], [false, "pajama"]);
  assert.ok(pool("наряд:пижама:уже").map(plain).includes(same.line), same.line);
  // Страница: та же сцена у шкафа; идёт она в пижаме.
  const before = logic.applyLook(logic.blank(18), evening, time.now());
  const change = logic.applyWear(before, worn);
  assert.deepEqual([change.kind, change.state.her.wear, scene.walkOf(logic.viewOf(change.state))], ["wardrobe", "pajama", "pajama-walk"]);
  assert.equal(scene.frameOf("pajama-walk"), "pajama-walkb");
  // Рисунок: в пижаме — кресло, карта, гирлянда, плед, сон; чего нет — та же поза в свитере, а не в куртке.
  const view = (key, pose, more = {}) => ({ part: "вечер", her: { key, pose, wear: "pajama", ...more } });
  assert.deepEqual(scene.spritesOf(view("уют", "chair", { beat: true })), ["pajama-tea3"]);
  assert.deepEqual(scene.spritesOf(view("уют", "read", { beat: true })), ["pajama-read"]);
  assert.deepEqual(scene.spritesOf(view("уют", "sill", { beat: true })), ["home-tea4"], "на подоконнике в пижаме не нарисована");
  assert.ok(scene.spritesOf(view("уют", "chair")).every(name => name.startsWith("pajama-")), scene.spritesOf(view("уют", "chair")).join(" "));
  assert.ok(scene.spritesOf(view("устала", "chair")).every(name => name.startsWith("pajama-")));
  assert.ok(scene.spritesOf(view("дело", "desk")).every(name => name.startsWith("home-")), "дела в пижаме не нарисованы — она в свитере");
  assert.deepEqual(scene.spritesOf({ part: "ночь", her: { key: "сон", pose: "nap", wear: "pajama" } }), ["pajama-sleep"]);
  // Прежняя страница имени «pajama» не знает — у неё ночью свитер, как раньше; новая без имени — тоже.
  assert.deepEqual(scene.spritesOf({ part: "ночь", her: { key: "сон", pose: "nap" } }), ["home-sleep"]);

  // Сама — с половины одиннадцатого («дрёма»): слова у шкафа — ночные.
  reset();
  const h2 = heart(ON, { now: () => Date.parse("2026-11-18T19:40:00Z"), random: () => 0 }); // 22:40 по Москве
  const drowsy = await h2.onRoom({ do: "look" }, from(5));
  assert.deepEqual([drowsy.her.stage, drowsy.her.wear], ["дрёма", "pajama"]);
  assert.ok(pool("шкаф:ночь").map(plain).includes(drowsy.wardrobe.leave), drowsy.wardrobe.leave);
  assert.ok(pool("переоделась:ночь").map(plain).includes(drowsy.wardrobe.back), drowsy.wardrobe.back);

  // В чате — теми же словами: вечером надевает, днём отказывает.
  reset();
  const chat = heart(ON, { now: () => Date.parse("2026-11-18T15:30:00Z"), random: () => 0 });
  await chat.onMessage(message("надень пижаму"), KEY);
  assert.ok(pool("наряд:пижама:готово").map(plain).some(line => last(5).includes(line)), last(5));
  reset();
  const noon = heart(ON, { now: () => NOON, random: () => 0 });
  await noon.onMessage(message("надень пижаму"), KEY);
  assert.ok(pool("наряд:пижама:рано").map(plain).some(line => last(5).includes(line)), last(5));
});

test("0.47.0, чай на выбор: жасмин, улун, мята — по кругу; выбор запоминается; первая кружка — словами этого чая; в чате «налью тебе улун» выбирает и наливает", async () => {
  reset();
  const time = clock(NOON);
  const h = heart(ON, { now: time.now, random: () => 0 });
  const first = await h.onRoom({ do: "look" }, from(5));
  // 0.48.0: чай назван каждому (`kind`), а поле `brew`, по которому страница показывает кнопки под рисунком, — хозяину.
  assert.deepEqual([first.kind, first.brew, first.owner, first.kinds], ["жасмин", undefined, false, [...room.BREWS]], "с жасмина всё начинается: он её любимый");
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
  assert.equal((await h.onRoom({ do: "look" }, from(5))).kind, "мята");
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
  assert.equal((await chat.onRoom({ do: "look" }, from(5))).kind, "улун");
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
  // Прежнее сердце (до 0.47.0): о чае в ответе нет ни слова.
  const old = { ...first };
  for (const name of ["brew", "kind", "kinds", "owner"]) delete old[name];
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

// ── 0.47.0: посидеть рядом — тихий час (идея 161) ────────────────────────────

test("0.47.0, тихий час: двадцать пять минут она читает рядом, Байт спит, распорядок стоит; время вышло — её слова и всё как было; нажали раньше — закончили", async () => {
  reset();
  const time = clock(NOON), M = 60_000;
  const h = heart(ON, { now: time.now, random: () => 0 });
  const first = await h.onRoom({ do: "look" }, from(5));
  assert.deepEqual([first.quiet, Object.hasOwn(first, "quietEnd")], [0, false]);
  assert.ok(first.her.beats.length > 1, "до тихого часа у неё распорядок");
  const on = await h.onRoom({ do: "quiet" }, from(5));
  assert.deepEqual([on.ok, on.do, on.on, on.left], [true, "quiet", true, room.QUIET_MS]);
  assert.equal(room.QUIET_MS, 25 * M);
  assert.ok(pool("тихий час").map(plain).includes(on.line), on.line);
  assert.ok(pool("тихий час:конец").map(plain).includes(on.end), on.end);
  // Она — в кресле с книгой, и только: распорядка на это время нет. Байт спит на подушке и с места не ходит.
  assert.deepEqual([on.her.key, on.her.pose, on.her.beats.length], ["уют", "read", 1]);
  assert.ok(pool("она:тихий час").includes(on.her.line), on.her.line);
  assert.deepEqual([on.cat.key, on.cat.shape, on.cat.place, on.cat.still, on.cat.beats.length], ["спит", "curl", "pillow", true, 0]);
  assert.ok(pool("байт:тихий час").includes(on.cat.line), on.cat.line);
  assert.equal(roomOf(5).cared, "", "тихий час — не забота: в отношения не идёт");
  // Слова на рисунке — о том, что на нём: она с книгой в кресле, он на подушке.
  for (const line of pool("она:тихий час")) assert.equal(room.herPose(line, "уют"), "read", line);
  for (const line of pool("байт:тихий час")) assert.deepEqual(room.catPose(line, "спит"), { shape: "curl", place: "pillow" }, line);
  // Через десять минут заглянули заново: осталось пятнадцать, всё по-прежнему; слова конца — при ней.
  time.add(10 * M);
  const mid = await h.onRoom({ do: "look", again: true }, from(5));
  assert.deepEqual([mid.quiet, mid.her.pose, mid.her.beats.length, mid.cat.place, mid.cat.still], [15 * M, "read", 1, "pillow", true]);
  assert.ok(pool("тихий час:конец").map(plain).includes(mid.quietEnd), mid.quietEnd);
  // Байта зовут — он спит; покормили — проснулся и ест (забота сильнее тишины).
  assert.ok(pool("байт:позвать:спит").includes((await h.onRoom({ do: "call" }, from(5))).line));
  assert.deepEqual([(await h.onRoom({ do: "feed" }, from(5))).cat.place], ["bowl"]);
  // Время вышло: тихого часа нет, она вернулась к распорядку.
  time.add(15 * M);
  const after = await h.onRoom({ do: "look", again: true }, from(5));
  assert.deepEqual([after.quiet, Object.hasOwn(after, "quietEnd")], [0, false]);
  assert.ok(after.her.beats.length > 1, "распорядок вернулся");
  // Нажали, пока идёт, — закончили раньше.
  await h.onRoom({ do: "quiet" }, from(5));
  time.add(M);
  const off = await h.onRoom({ do: "quiet" }, from(5));
  assert.deepEqual([off.on, off.left, off.end], [false, 0, ""]);
  assert.ok(pool("тихий час:стоп").map(plain).includes(off.line), off.line);
  assert.equal(roomOf(5).quiet, null);
  assert.ok(off.her.beats.length > 1);
  // Ночью она спит: тихий час идёт, а она остаётся под пледом — будить её книгой не станут.
  time.set(Date.parse("2026-11-18T22:30:00Z"));
  const night = await h.onRoom({ do: "quiet" }, from(5));
  assert.deepEqual([night.on, night.her.key], [true, "сон"]);
  // Счёт времени.
  const record = { quiet: { at: 1000, ms: 500 } };
  assert.deepEqual([room.quietLeft(record, 999), room.quietLeft(record, 1000), room.quietLeft(record, 1499), room.quietLeft(record, 1500)], [0, 500, 1, 0]);
  for (const junk of [null, {}, { quiet: null }, { quiet: { at: 0, ms: 5 } }, { quiet: { at: 5 } }, { quiet: "да" }]) assert.equal(room.quietLeft(junk, 10), 0, JSON.stringify(junk));

  // Страница: ответ ставит её в кресло с книгой, Байта — на подушку; отсчёт и слова конца — при странице.
  const state = logic.applyLook(logic.blank(14), first, NOON);
  const sat = logic.applyQuiet(state, on);
  assert.deepEqual([sat.quiet, sat.quietEnd, sat.said, logic.viewOf(sat).her.pose, logic.viewOf(sat).cat.shape, logic.viewOf(sat).cat.place], [room.QUIET_MS, on.end, on.line, "read", "curl", "pillow"]);
  assert.deepEqual([sat.her.beats.length, sat.lines.her, sat.lines.cat], [1, on.her.line, on.cat.line]);
  assert.equal(scene.castOf(logic.viewOf(sat), PAINTED).her.name, "read");
  const done = logic.applyQuiet(sat, off);
  assert.deepEqual([done.quiet, done.quietEnd, done.said], [0, "", off.line]);
  const seen = logic.applyLook(logic.blank(14), mid, NOON);
  assert.deepEqual([seen.quiet, seen.quietEnd], [15 * M, mid.quietEnd]);
  assert.deepEqual([logic.blank(14).quiet, logic.blank(14).quietEnd], [0, ""]);
  assert.equal(logic.applyQuiet(state, { ok: false, text: "нет связи" }).tone, "warn");
  // Прежнее сердце о тихом часе не знает — отсчёта нет.
  const { quiet: _, ...old } = first;
  assert.equal(logic.applyLook(logic.blank(14), old, NOON).quiet, 0);
  // Витрина: те же слова, что в словаре; нажали ещё раз — закончили.
  const demo = logic.demoQuiet({ quiet: 0, her: { key: "дело" }, cat: { key: "сыт" } });
  assert.deepEqual([demo.on, demo.left, demo.her.pose, demo.cat.shape, demo.cat.place], [true, room.QUIET_MS, "read", "curl", "pillow"]);
  assert.ok(pool("тихий час").includes(demo.line) && pool("тихий час:конец").includes(demo.end) && pool("она:тихий час").includes(demo.her.line) && pool("байт:тихий час").includes(demo.cat.line));
  const stop = logic.demoQuiet({ quiet: 60_000 });
  assert.deepEqual([stop.on, stop.left], [false, 0]);
  assert.ok(pool("тихий час:стоп").includes(stop.line), stop.line);
  assert.equal(Object.hasOwn(logic.demoQuiet({ quiet: 0, her: { key: "сон" } }), "her"), false, "спящую витрина не будит");
});

// ── 0.48.0: рисунок по частям (сообщение 47: «перед сменой анимации мерцает чёрным экран») ────────────────────

test("0.48.0, рисунок по частям: части складываются ровно в прежний рисунок; их число не меняется; сменила позу или перешёл Байт — другими стали только их части, а стены, мебель и гирлянда — те же", () => {
  const base = (her, cat = { shape: "sit", place: "sill", key: "сыт" }, extra = {}) => ({ part: "день", sky: "clear", her, cat, plant: "wet", things: ["кружка", "плед", "тапочки"], ...extra });
  const views = [];
  for (const part of ["утро", "день", "вечер", "ночь"]) {
    for (const [key, pose] of [["дело", "desk"], ["дело", "chair"], ["уют", "chair"], ["уют", "read"], ["игра", "dance"], ["сон", "nap"], ["устала", "chair"], ["обида", "back"]]) {
      views.push({ ...base({ key, pose, beat: true }), part });
    }
  }
  views.push(base({ key: "дело", pose: "desk", beat: true }, { shape: "curl", place: "pillow", key: "спит" }, { sky: "rain", dark: true, music: true, tea: true, fed: true }));
  views.push(base(null, null));
  let count = 0;
  for (const view of views) {
    for (const options of [PAINTED, { ...PAINTED, was: { name: "work", x: 100 }, catWas: { x: 300, y: 456, shape: "sit" } }, { ...PAINTED, enter: true }, {}, { ...PAINTED, prefix: "q-" }]) {
      const made = scene.drawParts(view, options), whole = scene.drawInside(view, options);
      // Сложенные части — тот же рисунок, знак в знак: листы и проверки смотрят на то же, что видит страница.
      assert.equal(`<g class="art" pointer-events="none"><defs>${made.inks.join("")}</defs>${made.parts.join("")}</g><g class="zones">${made.zones}</g>`, whole);
      assert.ok(made.parts.every(piece => typeof piece === "string"), "каждая часть — строка: пустая, если такого на рисунке нет");
      count ||= made.parts.length;
      assert.equal(made.parts.length, count, "частей всегда одно и то же число: страница находит часть по её месту в списке");
      assert.equal(new Set(made.inks).size, made.inks.length, "описания цвета не повторяются");
    }
  }
  assert.ok(count >= 50, `частей — ${count}`);

  // Она пересела из-за стола в кресло: другими стали её части — и ничего из стен, мебели и света.
  const changed = (a, b) => a.parts.map((piece, index) => (piece === b.parts[index] ? -1 : index)).filter(index => index >= 0);
  // (Вечером: гирлянда горит — её огоньки мигают, и раньше при каждой перемене они начинали мигать заново.)
  const evening = (her, cat) => ({ ...base(her, cat), part: "вечер" });
  const atDesk = scene.drawParts(evening({ key: "дело", pose: "desk", beat: true }), PAINTED), inChair = scene.drawParts(evening({ key: "дело", pose: "chair", beat: true }), PAINTED);
  const herMoved = changed(atDesk, inChair);
  assert.ok(herMoved.length >= 1 && herMoved.length <= 8, `сменила место — частей изменилось ${herMoved.length} из ${count}`);
  const garland = atDesk.parts.findIndex(piece => piece.includes('class="bulb'));
  for (const [name, index] of [["гирлянда", garland], ["стены", atDesk.parts.findIndex(piece => piece.includes("url(#r-wall)"))], ["шкаф", atDesk.parts.findIndex(piece => piece.includes("url(#r-caseShade)"))], ["шторы", atDesk.parts.findIndex(piece => piece.includes("url(#r-curtain)"))]]) {
    assert.ok(index >= 0, `${name} — отдельная часть`);
    assert.ok(!herMoved.includes(index), `${name}: от смены её позы не меняется — значит, на странице не перерисовывается и не мигает`);
  }
  // Байт перешёл с подоконника на подушку: другими стали его части, а она — та же.
  const catMoved = changed(atDesk, scene.drawParts(evening({ key: "дело", pose: "desk", beat: true }, { shape: "curl", place: "pillow", key: "спит" }), PAINTED));
  assert.ok(catMoved.length >= 1 && catMoved.length <= 4, `Байт перешёл — частей изменилось ${catMoved.length}`);
  const hers = atDesk.parts.findIndex(piece => piece.includes('href="#r-her-home-work"'));
  assert.ok(hers >= 0 && !catMoved.includes(hers), "она от перехода Байта не перерисовывается");
  assert.ok(!catMoved.includes(garland));
  // Переход (она идёт, прежняя тает) живёт только в её части: «в движении» и «как есть» отличаются ею одной —
  // и вечерней тенью, которая идёт вместе с ней.
  const walking = changed(atDesk, scene.drawParts(evening({ key: "дело", pose: "desk", beat: true }), { ...PAINTED, was: { name: "home-work", x: 100 } }));
  assert.ok(walking.length >= 1 && walking.length <= 4, `идёт — частей в движении ${walking.length}`);
  assert.ok(walking.includes(hers) && !walking.includes(garland));
  // Ничего не изменилось — ни одна часть не другая: страница рисунка не трогает вовсе.
  assert.deepEqual(changed(atDesk, scene.drawParts(evening({ key: "дело", pose: "desk", beat: true }), PAINTED)), []);
});

// ── 0.48.0: её день (сообщение 47) ───────────────────────────────────────────

test("0.48.0, её день: план из эпизодов по часам человека; границы у каждого дня свои, но весь день одни; шаг внутри эпизода длится минуты", () => {
  const WEEK = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"];
  for (const day of WEEK) {
    const plan = room.dayPlan(day), weekend = [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay());
    assert.deepEqual(plan, room.dayPlan(day), `${day}: план дня не меняется от вопроса к вопросу`);
    assert.deepEqual([plan[0].from, plan.at(-1).to], [0, 1440]);
    for (const [index, item] of plan.entries()) {
      assert.ok(room.EPISODES[item.name] && item.to > item.from, `${day}: ${item.name}`);
      if (index) assert.equal(item.from, plan[index - 1].to, `${day}: «${item.name}» начинается там, где кончилось прежнее`);
    }
    // Порядок — как в примере владельца: пробуждение, занятия, отдых (чай и игра с Байтом), дела, вечер, сон.
    const names = plan.map(item => item.name);
    assert.deepEqual(names.filter(name => name !== "чай" && name !== "игра"), ["сон", "подъём", "занятия", "дела", "порядок", "вечер", "ждёт", "дрёма", "сон"], day);
    assert.deepEqual(names.slice(3, 5).sort(), ["игра", "чай"], `${day}: чай и игра — после занятий, в порядке этого дня`);
    const at = Object.fromEntries(plan.slice(1).map(item => [item.name, item.from])), late = weekend ? 50 : 0;
    assert.ok(at["подъём"] >= 400 + late && at["подъём"] <= 440 + late, `${day}: подъём в ${at["подъём"]}-ю минуту`);
    assert.equal(at["занятия"], at["подъём"] + 60);
    assert.ok(at["порядок"] >= 1005 && at["порядок"] <= 1035 && at["ждёт"] >= 1245 && at["ждёт"] <= 1275, day);
    assert.deepEqual([at["вечер"], at["дрёма"], at["сон"]], [18 * 60, 22 * 60 + 30, 23 * 60], `${day}: в шесть — домашнее, в одиннадцать — сон`);
  }
  assert.ok(new Set(WEEK.map(day => room.dayPlan(day)[1].from)).size >= 3, "подъём — не по будильнику: у каждого дня своя минута");
  // Эпизод по минуте — со своим описанием: состояние (картинка), запас реплик, наряд.
  const plan = room.dayPlan(TODAY), wake = plan[1].from;
  assert.deepEqual((({ name, key, pool: words, wear, story, index }) => [name, key, words, wear, story, index])(room.stageAt(plan, wake + 0.5)), ["подъём", "дело", "день:подъём", "day", true, 1]);
  assert.deepEqual([room.stageAt(plan, wake - 0.1).name, room.stageAt(plan, 0).name, room.stageAt(plan, 1439.9).name, room.stageAt(plan, 18 * 60).wear], ["сон", "сон", "сон", "home"]);
  // Шаги рассказа (подъём): по порядку, поровну, один раз.
  const story = (at) => room.stepAt({ count: 3, from: 420, to: 480, at, story: true });
  assert.deepEqual([story(420), story(439.5), story(440), story(479.5)], [{ index: 0, left: 1_200_000 }, { index: 0, left: 30_000 }, { index: 1, left: 1_200_000 }, { index: 2, left: 30_000 }]);
  // Шаги по кругу: от двенадцати до восемнадцати минут каждый — по зерну дня; с какого начать — тоже по нему.
  for (const seed of [0, 3, 6, 7, 1234567]) {
    const every = room.STEP_MIN[0] + (seed % 7), turn = (at) => room.stepAt({ count: 4, from: 600, to: 900, at, seed });
    assert.ok(every >= 12 && every <= 18);
    assert.deepEqual(turn(600), { index: seed % 4, left: every * 60_000 }, String(seed));
    assert.equal(turn(600 + every - 0.01).index, seed % 4, "весь шаг — одно и то же занятие");
    assert.equal(turn(600 + every).index, (seed + 1) % 4, "следующий шаг — следующая реплика");
    assert.equal(turn(899.5).left, 30_000, "последний шаг кончается вместе с эпизодом");
  }
  assert.deepEqual(room.stepAt({ count: 1, from: 0, to: 60, at: 30 }), { index: 0, left: 1_800_000 });
  assert.deepEqual(room.stepAt({ count: 0 }), { index: 0, left: 86_400_000 });
  // Наряд днём — по погоде: в дождь, грозу и снег — свитер.
  assert.deepEqual(room.SKIES.filter(sky => room.dressFor(sky) === "home").sort(), ["rain", "snow", "storm"]);
  // «Что делаешь?» — слова о её дне; о планах на завтра — нет.
  for (const said of ["что делаешь", "Что делаешь?", "чем занята", "а ты что делаешь", "что ты сейчас делаешь", "чем занимаешься"]) assert.deepEqual(room.parseRoom(said), { op: "busy" }, said);
  assert.equal(room.parseRoom("что делаешь завтра вечером"), null);
});

/** Общие для двух реплик три слова подряд: «прямо из-под пакета». Так видно, что вторая повторяет первую. */
const sameRuns = (one, other) => {
  const runs = (text) => { const list = String(text ?? "").toLowerCase().replace(/ё/gu, "е").replace(/[^a-zа-я0-9\s-]/gu, " ").split(/\s+/u).filter(Boolean); return list.slice(0, -2).map((word, index) => `${word} ${list[index + 1]} ${list[index + 2]}`); };
  const mine = new Set(runs(one));
  return runs(other).filter(run => mine.has(run));
};

test("0.55.1, слова под рисунком не говорят одно и то же дважды: реплика Байта не повторяет её реплику — по всему её дню; о завтраке он добавляет своё", async () => {
  // Экран владельца (сообщение 66): «Насыпаю Байту корм. Он уже тут: хрустит прямо из-под пакета, до миски не
  // дотерпел.» — и следом: «Байт хрустит кормом прямо из-под пакета. До миски он не дотерпел.»
  assert.deepEqual(sameRuns("Насыпаю Байту корм. Он уже тут: хрустит прямо из-под пакета, до миски не дотерпел.", "Байт хрустит кормом прямо из-под пакета. До миски он не дотерпел."), ["прямо из-под пакета", "из-под пакета до", "пакета до миски"]);
  const meals = fitting("день:подъём").filter(line => /корм/u.test(line));
  assert.ok(meals.length >= 1 && pool("байт:завтрак").length >= 3, "о завтраке Байта — не меньше трёх реплик");
  for (const hers of meals) for (const his of pool("байт:завтрак")) assert.deepEqual(sameRuns(hers, plain(his)), [], `«${hers}» и «${his}»`);
  for (const his of pool("байт:завтрак")) assert.doesNotMatch(his, /из-под пакета|до миски/u, his);
  // Весь её день, каждые десять минут, как отвечает сердце странице: её слова и слова о Байте стоят рядом. Гостей
  // несколько: у кого-то сценка дня весь день держит Байта на месте, и слов о нём тогда нет.
  let pairs = 0, fed = 0;
  for (const id of [5, 6, 7, 8, 9, 10]) {
    reset();
    const midnight = Date.parse(`${TODAY}T00:00:00+03:00`), time = clock(midnight);
    const h = heart(ON, { now: time.now, random: () => 0 });
    for (let minute = 0; minute < 24 * 60; minute += 10) {
      time.set(midnight + minute * 60_000);
      const seen = await h.onRoom({ do: "look" }, from(id));
      if (!seen.her?.line || !seen.cat?.line) continue;
      pairs += 1;
      if (seen.her.pose === "feed") fed += 1;
      assert.deepEqual(sameRuns(seen.her.line, seen.cat.line), [], `гость ${id}, ${Math.floor(minute / 60)}:${minute % 60} — «${seen.her.line}» и «${seen.cat.line}»`);
    }
  }
  assert.ok(pairs > 300 && fed >= 2, `пар реплик: ${pairs}, из них за кормом: ${fed}`);
  // Витрина страницы (без сердца) показывает ту же пару — и тоже без повтора.
  const meal = logic.demoLook(7, { minute: 12 });
  assert.deepEqual([meal.her.pose, meal.cat.shape], ["feed", "eat"]);
  assert.deepEqual(sameRuns(meal.her.line, meal.cat.line), []);
});

test("0.55.1, слово ей прямо в комнате (204, шаг первый — сердце): отвечает сама, словарём и тем же голосом, что в чате; чего в словаре нет — «об этом в чате»; в чат ничего не уходит; повтор номера — тот же ответ", async () => {
  reset();
  const time = clock(NOON);
  // С 0.61.0 на то, чего нет в словаре, отвечает модель; «об этом в чате» — когда это выключено (`ROOM_TALK: false`).
  const h = heart({ ...ON, ROOM_TALK: false }, { now: time.now, random: () => 0 });
  const { SAY_MAX } = await import("../tgcloud/lib/roomdoor.js");
  const { DOOR_ALLOW, DOOR_NOT_ALLOWED } = await import("../tgcloud/lib/bridge.js");
  const sent = () => sdk().calls.filter(item => /^send|^edit/u.test(item.method)).length;
  await h.onRoom({ do: "look" }, from(5));
  const quiet = sent(), asked = chats().length;
  // Тема словаря — та же, что в чате: гостю — его ответ, хозяину — свой.
  const written = read("PHRASES.txt"), at = written.indexOf("== язык байта ==\n"), lines = written.slice(at, written.indexOf("\n\n", at)).split("\n").slice(2);
  const topic = lines.filter(line => !line.startsWith("[")).map(plain), mine = lines.filter(line => line.startsWith("[хозяин] ")).map(line => line.slice(9));
  assert.ok(at > 0 && topic.length >= 3 && mine.length >= 1);
  const guest = await h.onRoom({ do: "say", text: "  где язык   у Байта? ", id: "word000001" }, from(5));
  assert.deepEqual([guest.ok, guest.do, guest.known, guest.build], [true, "say", true, BUILD]);
  assert.ok(topic.includes(guest.line), guest.line);
  const master = await h.onRoom({ do: "say", text: "где язык у Байта", id: "word000002" }, from(OWNER));
  // Хозяину — из тех же строк темы и из его собственных («[хозяин]» — вес, а не замена), его голосом.
  assert.ok(master.known && [...topic, ...mine].some(line => master.line.startsWith(line.replace(/[.!?]$/u, ""))), master.line);
  // Второй раз подряд — другой ответ той же темы: что сказано последним, она помнит (и чат помнит то же).
  const second = await h.onRoom({ do: "say", text: "где язык у Байта", id: "word000003" }, from(5));
  assert.ok(topic.includes(second.line) && second.line !== guest.line, second.line);
  assert.equal(JSON.parse(sdk().kv.get("heart:said:5")).t, second.line);
  // Повтор запроса с тем же номером (страница не дождалась ответа): тот же ответ, а не третий.
  const again = await h.onRoom({ do: "say", text: "где язык у Байта", id: "word000003" }, from(5));
  assert.deepEqual([again.ok, again.repeat, again.line], [true, true, second.line]);
  // Чего в словаре нет — не молчит и не выдумывает: «об этом — в чате». Модель не зовётся.
  const past = await h.onRoom({ do: "say", text: "рассчитай траекторию полёта до Марса с тремя пересадками", id: "word000004" }, from(5));
  assert.deepEqual([past.ok, past.known], [true, false]);
  assert.ok(pool("слово:мимо").map(plain).includes(past.line), past.line);
  assert.ok(pool("слово:мимо").length >= 3);
  // Пусто и слишком длинно — отказ словами; предел — двести знаков.
  assert.equal(SAY_MAX, 200);
  assert.deepEqual([(await h.onRoom({ do: "say", text: "   " }, from(5))).code, (await h.onRoom({ do: "say" }, from(5))).code, (await h.onRoom({ do: "say", text: 42 }, from(5))).code], ["empty", "empty", "empty"]);
  const long = await h.onRoom({ do: "say", text: "а".repeat(SAY_MAX + 1) }, from(5));
  assert.deepEqual([long.ok, long.code], [false, "long"]);
  assert.equal((await h.onRoom({ do: "say", text: `привет${" ".repeat(400)}` }, from(5))).ok, true, "пробелы в счёт не идут");
  // В чат из комнаты ничего не ушло, и модель никто не спрашивал.
  assert.equal(sent(), quiet);
  assert.equal(chats().length, asked);
  // Слишком часто — отказ, как у любого действия комнаты.
  let slow = null;
  for (let n = 0; n < 16 && !slow; n += 1) { const got = await h.onRoom({ do: "say", text: "привет", id: `rush0000${String(n).padStart(2, "0")}` }, from(6)); if (!got.ok) slow = got; }
  assert.equal(slow?.code, "slow");
  // Слова человека в записи комнаты не лежат: только её ответ на последний номер.
  const kept = roomOf(5);
  assert.deepEqual(Object.keys(kept.word).sort(), ["a", "id", "t"]);
  assert.doesNotMatch(JSON.stringify(kept), /Марса|где язык/u);
  // Дверь приложения этого действия не пускает: она остаётся как была (сообщение 63).
  assert.ok(!DOOR_ALLOW.includes("say") && DOOR_NOT_ALLOWED.includes("say"));
});

test("0.48.0, её день в комнате: шаг один и тот же — на рисунке, при повторном вопросе и в чате; утром она кормит Байта, и он ест рядом; ночью спит, и он у неё под боком", async () => {
  reset();
  const plan = room.dayPlan(TODAY), wake = plan[1].from, midnight = Date.parse(`${TODAY}T00:00:00+03:00`);
  // Подъём: три шага по двадцать минут — у окна с блокнотом, корм Байту, метёлка. Идёт пятая минута второго.
  const time = clock(midnight + (wake + 25) * 60_000);
  const h = heart(ON, { now: time.now, random: () => 0 });
  const seen = await h.onRoom({ do: "look" }, from(5));
  const air = { sky: seen.sky, part: seen.clock.part };
  assert.deepEqual([seen.her.stage, seen.her.key, seen.her.pose, seen.her.steady], ["подъём", "дело", "feed", true]);
  assert.deepEqual(seen.her.beats[0], { pose: "feed", line: seen.her.line });
  assert.ok(fitting("день:подъём", air).includes(seen.her.line) && /корм/u.test(seen.her.line), seen.her.line);
  // Сколько до следующего шага — в ответе: страница спросит комнату заново к этому сроку (или раньше — когда Байт сменит место).
  assert.equal(seen.her.left, 15 * 60_000);
  assert.ok(seen.step >= 30_000 && seen.step <= seen.her.left && seen.step <= room.CAT_STEP_MS, String(seen.step));
  // Байт — при ней: ест рядом, с места не ходит.
  assert.deepEqual([seen.cat.shape, seen.cat.place, seen.cat.still], ["eat", "near", true]);
  assert.ok(pool("байт:завтрак").map(plain).includes(seen.cat.line), seen.cat.line);
  // Страница: картинка «насыпает корм». С 0.57.0 (сообщение 68: «давай в миску, а кот ждёт») она сидит у миски, а
  // Байт сидит перед ней, слева, и ждёт; сердцу он по-прежнему «ест рядом» — слова о нём уже о том, что он ждёт.
  const state = logic.applyLook(logic.blank(7), seen, time.now());
  assert.match(scene.spriteOf(logic.viewOf(state)), /^(?:home-)?feed$/u);
  const cast = scene.castOf(logic.viewOf(state), PAINTED);
  assert.ok(cast.cat.x < cast.her.x && cast.cat.y > 440 && cast.cat.shape === "sit", JSON.stringify(cast));
  for (const his of pool("байт:завтрак")) assert.doesNotMatch(his, /(?:^|\s)(?:ест|жу[её]т|ловит|хрустит)(?:\s|[.,!?—:]|$)/u, `он ещё ждёт: ${his}`);
  // Через пять минут она говорит то же: спросили заново, спросили в чате, зашли словами.
  time.add(5 * 60_000);
  const again = await h.onRoom({ do: "look", again: true }, from(5));
  assert.deepEqual([again.her.pose, again.her.line, again.her.left], ["feed", seen.her.line, 10 * 60_000]);
  await h.onMessage(message("что делаешь"), KEY);
  assert.ok(last().includes(seen.her.line), last());
  await h.onMessage(message("зайду к тебе"), KEY);
  assert.ok(last().includes(seen.her.line), last());
  // Шаг сменился: метёлка. Страница узнаёт об этом сама — и слова под рисунком теперь о новом шаге.
  time.add(10 * 60_000 + 1000);
  const next = await h.onRoom({ do: "look", again: true }, from(5));
  assert.deepEqual([next.her.stage, next.her.pose], ["подъём", "dust"]);
  const change = logic.changeOf(state, logic.applyTick(state, next, time.now()));
  assert.deepEqual([change.kind, change.state.her.beat, change.state.said, scene.spriteOf(logic.viewOf(change.state)).replace(/^home-/u, "")], ["quiet", 0, next.her.line, "tidy"]);
  // 0.60.0, «наедается»: она отошла — он у миски, ест то, что она насыпала (до 0.60.0 корм из миски пропадал).
  assert.deepEqual([next.cat.shape, next.cat.place, next.bowl], ["eat", "bowl", "full"]);
  assert.notEqual(next.cat.key, "голоден", "утром она его покормила: три часа он не голоден");

  // Ночь: спит по своему дню — до подъёма (раньше вставала в пять); Байт спит у неё под боком.
  time.set(midnight + 26 * HOUR);
  const night = await h.onRoom({ do: "look", again: true }, from(5));
  assert.deepEqual([night.her.stage, night.her.key, night.her.wear, night.cat.shape, night.cat.place], ["сон", "сон", "pajama", "curl", "near"]);
  assert.ok(pool("байт:ночь").map(plain).includes(night.cat.line), night.cat.line);
  assert.equal(night.her.plan, undefined, "спит — не до планов");
  time.set(midnight + 30 * HOUR);
  assert.equal((await h.onRoom({ do: "look", again: true }, from(5))).her.key, "сон", "в шесть утра она ещё спит");

  // Что было до этого и что дальше — её словами; нажали на неё дважды подряд — она их и говорит.
  reset();
  const day = heart(ON, { now: () => NOON, random: () => 0 });
  const noon = await day.onRoom({ do: "look" }, from(5));
  const stage = room.stageAt(plan, 14 * 60), before = room.EPISODES[plan[stage.index - 1].name].title, after = plan[stage.index + 1];
  const hhmm = `${String(Math.floor(after.from / 60)).padStart(2, "0")}:${String(after.from % 60).padStart(2, "0")}`;
  assert.equal(noon.her.stage, stage.name);
  assert.ok(noon.her.plan.includes(before) && noon.her.plan.includes(room.EPISODES[after.name].title) && noon.her.plan.includes(hhmm), noon.her.plan);
  const once = logic.applyTap(logic.applyLook(logic.blank(14), noon, NOON), "her"), twice = logic.applyTap(once, "her"), thrice = logic.applyTap(twice, "her");
  assert.deepEqual([once.said, twice.said, thrice.said], [noon.her.line, noon.her.plan, noon.her.line]);
});

test("0.48.0, причины и следствия: в свой перерыв она сама предлагает чай; чай выбирают у чайника; налили посреди дел — час она с кружкой; долго не был — встречает другими словами", async () => {
  reset();
  const plan = room.dayPlan(TODAY), midnight = Date.parse(`${TODAY}T00:00:00+03:00`), tea = plan.find(item => item.name === "чай"), work = plan.find(item => item.name === "дела");
  const time = clock(midnight + (tea.from + 3) * 60_000);
  const h = heart(ON, { now: time.now, random: () => 0 });
  // Чайный перерыв начался: она сама спрашивает, какой налить, — страница показывает выбор под её словами.
  const seen = await h.onRoom({ do: "look" }, from(5));
  assert.deepEqual([seen.her.stage, seen.her.key, seen.offer?.kind], ["чай", "уют", "tea"]);
  assert.ok(pool("чай:предложить").map(plain).includes(seen.offer.text), seen.offer.text);
  let state = logic.applyLook(logic.blank(13), seen, time.now());
  assert.deepEqual([state.asking, state.said.split("\n").at(-1), state.kinds], ["tea", seen.offer.text, [...room.BREWS]]);
  // Выбрали улун: заварка запомнена, слова — об улуне, вопрос снят; больше она не спрашивает.
  const cup = await h.onRoom({ do: "tea", kind: "улун" }, from(5));
  assert.deepEqual([cup.ok, cup.kind, roomOf(5).brew], [true, "улун", "улун"]);
  assert.ok(pool("чай:улун").map(plain).includes(cup.line), cup.line);
  state = logic.applyCare(state, "tea", cup);
  assert.deepEqual([state.asking, state.brew], ["", "улун"]);
  assert.equal((await h.onRoom({ do: "look", again: true }, from(5))).offer, undefined);
  assert.equal((await h.onRoom({ do: "tea", kind: "какао" }, from(5))).kind, "улун", "незнакомый чай заварку не меняет");
  // Перерыв идёт давно — не спрашивает: предложение — в его начале.
  reset();
  const late = heart(ON, { now: () => midnight + (tea.from + 30) * 60_000, random: () => 0 });
  assert.equal((await late.onRoom({ do: "look" }, from(5))).offer, undefined);

  // Налили чай посреди дел — час она с кружкой: каждая реплика — о чае; потом возвращается к делам своего дня.
  reset();
  const busy = clock(midnight + (work.from + 5) * 60_000);
  const g = heart(ON, { now: busy.now, random: () => 0 });
  const first = await g.onRoom({ do: "look" }, from(5));
  assert.deepEqual([first.her.stage, first.her.key, first.offer], ["дела", "дело", undefined]);
  assert.ok(fitting("зайти").map(plain).includes(first.greet), first.greet);
  const poured = await g.onRoom({ do: "tea" }, from(5));
  assert.deepEqual([poured.her.key, poured.her.left <= room.STEP_MIN[0] * 60_000], ["уют", true]);
  for (const beat of poured.her.beats) assert.match(beat.line, /[Чч]ай|кружк/u, beat.line);
  busy.add(61 * 60_000);
  assert.equal((await g.onRoom({ do: "look", again: true }, from(5))).her.key, room.stageAt(plan, work.from + 66).key);
  // Долго не был: три дня и больше — она встречает другими словами, с числом дней.
  busy.add(4 * 24 * HOUR);
  const back = await g.onRoom({ do: "look" }, from(5));
  assert.ok(fitting("зайти:давно", { vars: { ...VARS, "дней": "4 дня" } }).map(plain).includes(back.greet), back.greet);
  assert.match(back.greet, /4 дня/u);
});

test("0.48.0, окно, кнопки и наряд: окно открывается на час и закрывается по нажатию; кнопки под рисунком — хозяину; днём она одета по погоде", async () => {
  reset();
  const time = clock(NOON);
  const h = heart(ON, { now: time.now, random: () => 0 });
  const seen = await h.onRoom({ do: "look" }, from(5));
  assert.deepEqual([seen.open, seen.owner, seen.brew, seen.kind], [false, false, undefined, "жасмин"]);
  // Нажали на окно — открыла: слова по небу и то, что за окном.
  const opened = await h.onRoom({ do: "window" }, from(5));
  assert.deepEqual([opened.ok, opened.do, opened.open, opened.window], [true, "window", true, seen.window]);
  assert.ok(fitting("створка:открыть", { sky: seen.sky }).map(plain).includes(opened.line), opened.line);
  assert.equal(roomOf(5).cared, "", "окно — не забота");
  assert.equal((await h.onRoom({ do: "look", again: true }, from(5))).open, true);
  // Страница: створка распахнута, под рисунком — её слова и слова об окне.
  let state = logic.applyWindow(logic.applyLook(logic.blank(14), seen, NOON), opened);
  assert.deepEqual([state.airy, state.open, logic.viewOf(state).open, state.said], [true, true, true, `${opened.line}\n${seen.window}`]);
  assert.match(scene.drawRoom(logic.viewOf(state), PAINTED), /class="fx fx-window"/u);
  assert.doesNotMatch(scene.drawRoom({ ...logic.viewOf(state), open: false }, PAINTED), /fx-window/u);
  // Ещё раз — закрыла.
  const shut = await h.onRoom({ do: "window" }, from(5));
  assert.equal(shut.open, false);
  assert.ok(pool("створка:закрыть").map(plain).includes(shut.line), shut.line);
  state = logic.applyWindow(state, shut);
  assert.equal(logic.viewOf(state).open, undefined);
  // Открытое окно она закрывает сама — через час.
  await h.onRoom({ do: "window" }, from(5));
  time.add(room.AIR_MS - 1000);
  assert.equal((await h.onRoom({ do: "look", again: true }, from(5))).open, true);
  time.add(2000);
  assert.equal((await h.onRoom({ do: "look", again: true }, from(5))).open, false);
  // Прежнее сердце окна не открывает: нажатие на окно — её слова о том, что за ним, как раньше.
  const old = { ...seen };
  delete old.open;
  assert.equal(logic.applyLook(logic.blank(14), old, NOON).airy, false);

  // Кнопки под рисунком — хозяину: поле `brew`, по которому их показывала и прежняя страница, — только ему.
  const mine = await h.onRoom({ do: "look" }, from(OWNER));
  assert.deepEqual([mine.owner, mine.brew, mine.kind], [true, "жасмин", "жасмин"]);
  assert.deepEqual([logic.applyLook(logic.blank(14), mine, NOON).owner, logic.applyLook(logic.blank(14), seen, NOON).owner], [true, false]);
  // Сердце 0.47.0 слова «owner» не знает, а чай называет всем: кнопки — как тогда.
  delete old.owner;
  assert.equal(logic.applyLook(logic.blank(14), { ...old, brew: "улун" }, NOON).owner, true);

  // Наряд днём — по погоде: решён при первом заходе в этот день и записан; до вечера она его не меняет.
  const ids = Array.from({ length: 400 }, (_, index) => 100 + index), wetSky = (id) => ["rain", "snow", "storm"].includes(madeUpSky(id, time.now()));
  const wet = ids.find(wetSky), dry = ids.find(id => !wetSky(id));
  const rainy = await h.onRoom({ do: "look" }, from(wet)), clear = await h.onRoom({ do: "look" }, from(dry));
  assert.deepEqual([rainy.her.wear, roomOf(wet).dress, clear.her.wear, roomOf(dry).dress], ["home", { day: TODAY, name: "home" }, "jacket", { day: TODAY, name: "jacket" }]);
  time.set(NOON + 3 * HOUR - 60_000);
  assert.equal((await h.onRoom({ do: "look", again: true }, from(wet))).her.wear, "home");
  assert.equal((await h.onRoom({ do: "look", again: true }, from(dry))).her.wear, "jacket");
  // Вечером — домашнее у всех.
  time.set(NOON + 5 * HOUR);
  assert.equal((await h.onRoom({ do: "look", again: true }, from(dry))).her.wear, "home");
});

test("0.48.0, страница: день на витрине идёт по часам устройства; мимика — в рисунке; чай выбирают у чайника; за закрытым окном дождь тише музыки", () => {
  const anySky = (name) => room.SKIES.flatMap(sky => fitting(name, { sky })).map(plain);
  // Витрина: час и минута устройства → эпизод и шаг; слова — из словаря, место — из слов, картинка — есть.
  for (const [hour, name] of [[7, "день:подъём"], [13, "день:чай"], [17, "день:порядок"]]) for (const minute of [0, 10, 20, 30]) {
    const look = logic.demoLook(hour, { minute });
    assert.ok(anySky(name).includes(look.her.line), `${hour}:${minute} — «${look.her.line}»`);
    assert.equal(room.herPose(look.her.line, look.her.key), look.her.pose, look.her.line);
    assert.deepEqual([look.her.steady, look.her.beats[0], look.step], [true, { pose: look.her.pose, line: look.her.line }, 600_000]);
    assert.ok(scene.lookOf(look.her.key, look.her.pose), look.her.line);
  }
  // Кормит — Байт ест рядом; ночью спит — он под боком; в начале чайного перерыва сама предлагает чай.
  const meal = logic.demoLook(7, { minute: 12 }), night = logic.demoLook(2, { minute: 0 }), tea = logic.demoLook(13, { minute: 5 });
  assert.deepEqual([meal.her.pose, meal.cat.shape, meal.cat.place, night.cat.shape, night.cat.place], ["feed", "eat", "near", "curl", "near"]);
  assert.ok(pool("байт:завтрак").includes(meal.cat.line) && pool("байт:ночь").includes(night.cat.line));
  assert.ok(pool("чай:предложить").includes(tea.offer.text));
  assert.equal(logic.demoLook(13, { minute: 40 }).offer, undefined);
  // Шаг — десять минут: через десять минут — следующая реплика; сверка — к границе шага.
  assert.notEqual(logic.demoLook(7, { minute: 0 }).her.line, logic.demoLook(7, { minute: 10 }).her.line);
  assert.equal(logic.demoLook(7, { minute: 7.5 }).step, 150_000);
  // Без минуты (тесты, снимки) и с названным часом — как раньше: первая реплика часа, распорядок списком.
  assert.deepEqual([logic.demoLook(14).her.steady, logic.demoLook(7, { minute: 3, part: "день" }).her.steady, logic.demoLook(14).step], [undefined, undefined, undefined]);
  // С `#turn=` страница листает шаги сама — для проверки в браузере.
  assert.equal(logic.demoLook(9, { minute: 3, turn: "700" }).her.steady, undefined);

  // Страница: её ведёт сердце (`steady`) — после сверки она на том шаге, что назван, и слова под рисунком — о нём.
  let state = logic.applyLook(logic.blank(7), logic.demoLook(7, { minute: 2 }), 1000);
  assert.deepEqual([state.her.steady, state.cat.steady, state.owner, state.airy, state.clock.left], [true, true, true, true, 480_000]);
  const later = logic.applyTick(state, logic.demoLook(7, { minute: 12 }), 2000), change = logic.changeOf(state, later);
  assert.deepEqual([later.her.beat, change.kind, change.state.said], [0, "quiet", later.her.beats[0].line]);
  // Проснулась и оделась по-дневному: час тот же, наряд другой — сцена у шкафа.
  const inHome = { ...state, her: { ...state.her, wear: "home" } }, inJacket = { ...state, her: { ...state.her, wear: "jacket" } };
  assert.deepEqual([logic.changeOf(inHome, inJacket).kind, logic.changeOf(inHome, inHome).kind], ["wardrobe", "same"]);
  // Чай: она спрашивает — выбор показан; налили — вопрос снят, чай запомнен; слова — этого чая.
  state = logic.applyLook(logic.blank(13), tea, 1000);
  assert.deepEqual([state.asking, state.offer], ["tea", tea.offer.text]);
  const cup = logic.demoCare(state, "tea", "мята");
  assert.ok(pool("чай:мята").map(plain).includes(cup.line), cup.line);
  state = logic.applyCare(state, "tea", cup);
  assert.deepEqual([state.asking, state.brew], ["", "мята"]);
  // Тот же вопрос второй раз не всплывает; новый — показывается, и слова под рисунком — её вопрос.
  assert.equal(logic.applyTick(state, logic.demoLook(13, { minute: 6 }), 3000).asking, "");
  const quiet = logic.applyLook(logic.blank(13), logic.demoLook(13, { minute: 40 }), 1000), asked = logic.applyTick(quiet, logic.demoLook(13, { minute: 5 }), 2000);
  assert.deepEqual([quiet.asking, asked.asking, logic.changeOf(quiet, asked).state.said], ["", "tea", tea.offer.text]);
  // Витрина помнит заботу сама: сверка раз в десять минут отметок не стирает.
  const kept = logic.demoKept(state, logic.applyTick(state, logic.demoLook(13, { minute: 16 }), 4000));
  assert.deepEqual([state.done.tea, logic.applyTick(state, logic.demoLook(13, { minute: 16 }), 4000).done.tea, kept.done.tea, kept.tea], [1, 0, 1, true]);
  // Окно на витрине — теми же словами, что в словаре.
  const opened = logic.demoWindow(state);
  assert.ok(anySky("створка:открыть").includes(opened.line), opened.line);
  state = logic.applyWindow(state, opened);
  assert.equal(logic.viewOf(state).open, true);
  assert.ok(pool("створка:закрыть").includes(logic.demoWindow(state).line));

  // Мимика в рисунке: стоя покачивается; садится — опускается, встаёт — поднимается; клюёт носом — моргает медленно;
  // на кадре с поднятыми глазами — пометка (её показывает нажатие); Байт замечает, что она подошла.
  const stand = { part: "день", sky: "clear", her: { pose: "desk", key: "дело", beat: true }, cat: null, plant: "wet", things: [] }, seat = { ...stand, her: { pose: "chair", key: "уют", beat: true } };
  const walked = { ...PAINTED, was: { name: "work", x: 252 } };
  assert.match(scene.drawRoom(stand, PAINTED), /<g class="lean"><g class="alive">/u);
  assert.doesNotMatch(scene.drawRoom(seat, PAINTED), /class="lean"/u);
  assert.match(scene.drawRoom(seat, walked), /<g class="leave"><use href="#r-her-work" [^]*<g class="arrive late lower" style="--t:[\d.]+s">/u);
  assert.match(scene.drawRoom(stand, { ...PAINTED, was: { name: "tea3", x: 196 } }), /<g class="leave rise"><use href="#r-her-tea3" /u);
  assert.match(scene.drawRoom({ ...seat, her: { pose: "read", key: "уют", beat: true, face: "drowsy" } }, PAINTED), /<use class="wink slow" href="#r-her-read-blink"/u);
  assert.match(scene.drawRoom({ ...seat, her: { pose: "garland", key: "уют", beat: true } }, { sprites: { ...SPRITES, ...FRAME_SPRITES } }), /<g class="fr a glance nl">[^]*<g class="fr b glance lk">/u);
  const near = { ...stand, her: { pose: "shelf", key: "дело", beat: true }, cat: { shape: "sit", place: "bowl", key: "сыт" } };
  assert.match(scene.drawRoom(near, walked), /<g class="notice" style="--t:[\d.]+s"><g class="hop">[^]*<text class="mark" [^>]+>!<\/text><\/g>/u);
  assert.doesNotMatch(scene.drawRoom(near, PAINTED), /class="notice"/u, "стоит на месте — замечать нечего");
  assert.doesNotMatch(scene.drawRoom({ ...near, cat: { shape: "curl", place: "pillow", key: "спит" } }, walked), /class="notice"/u, "спящий её не замечает");
  // Страница ставит мимику по нажатию и красит кнопки под рисунком только хозяину.
  const app = read("miniapp/app.js");
  assert.match(app, /const known = state\.ready && Boolean\(state\.brew\) && state\.owner === true,/u);
  // С 0.49.0 ход при сердце, которое ведёт её день, уходит на жест (наклон головы, взгляд на Байта).
  assert.match(app, /if \(lifeTurn % 2\) \{ if \(!state\.her\?\.steady\) herStep\(\); else gesture\(\); \} else if \(!state\.cat\?\.steady\) catStep\(\); else gesture\(\);/u);
  // Звук: за закрытым окном улица втрое тише и глуше, мелодия — громче; открыто — улица в полный голос.
  const sound = read("miniapp/sound.js");
  assert.match(sound, /const SHUT = 0\.3, OPEN = 0\.75, DUCK = 0\.6, GLASS_HZ = 700, AIR_HZ = 16000, SONG = 1\.9;/u);
  assert.ok(0.8 * 0.3 * 0.6 < 0.1 * 1.9, "дождь за стеклом под музыку тише её самых тихих нот");
  for (const name of ["purr", "pages", "pen", "birds", "car"]) assert.match(sound, new RegExp(`\\n    ${name}\\(at\\) `, "u"), name);
  assert.match(sound, /scene\(what = \{\}\) \{/u);
});

test("0.48.0, словарь: о распорядке, наряде по погоде, окне, чае у чайника и о том, что исправлено, она отвечает сама", () => {
  for (const [said, topic] of [
    ["какой у тебя распорядок дня", "твой распорядок"], ["почему ты днем в свитере", "наряд по погоде"], ["открой окно", "открыть окно"],
    ["дождь громче музыки", "дождь громче музыки"], ["ты ходишь задом наперед", "ходишь задом наперед"], ["экран мерцает черным", "экран мерцает"],
    ["как налить другой чай", "чай у чайника"],
  ]) assert.deepEqual(book.match(said), [topic], said);
  // Устаревшее ушло: позу по нажатию она больше не меняет и «раз в полминуты» не ходит.
  for (const topic of ["позы вечером", "ты меняешь позы", "почему ты стоишь"]) assert.doesNotMatch(book.pool(topic, { formal: true }).join(" "), /сменю (?:сразу|занятие)|[Пп]одожд\S+ полминуты|[Рр]аз в полминуты сама/u, topic);
  // У каждого чая — слова и для выбора у чайника; у окна — для любой погоды.
  for (const sky of room.SKIES) assert.ok(fitting("створка:открыть", { sky }).length >= 1, sky);
  const told = { vars: { ...VARS, "было": "занятия", "дальше": "чай", "время": "13:00", "дней": "4 дня" } };
  assert.ok(pool("чай:предложить").length >= 2 && pool("день:план", told).length >= 2 && pool("зайти:давно", told).length >= 2);
});

test("0.58.0, она встаёт в назначенный час (сообщение 69: «пусть она просыпается вместе с установленным временем в доброе утро»): подъём плана — названная минута; не названа — день прежний", () => {
  const usual = room.dayPlan(TODAY), early = room.dayPlan(TODAY, { wake: 6 * 60 + 12 });
  assert.deepEqual(room.dayPlan(TODAY, {}), usual);
  assert.deepEqual(room.dayPlan(TODAY, { wake: null }), usual);
  assert.deepEqual([early[0].name, early[0].to, early[1].name, early[1].from, early[2].name, early[2].from], ["сон", 372, "подъём", 372, "занятия", 432]);
  assert.deepEqual(early.slice(3), usual.slice(3), "остальной день — тот же");
  assert.equal(early[2].to, usual[2].to);
  // Названное за пределами «от двух ночи до одиннадцати утра» прижимается к краю: день должен сложиться.
  assert.deepEqual([room.dayPlan(TODAY, { wake: 10 })[1].from, room.dayPlan(TODAY, { wake: 900 })[1].from], [...room.WAKE_SPAN]);
  for (const wake of [120, 372, 660]) { const plan = room.dayPlan(TODAY, { wake }); assert.ok(plan.every(item => item.to > item.from), `${wake}: ${JSON.stringify(plan)}`); }
  // Разбудили — двадцать минут она не спит.
  assert.equal(room.WOKE_MS, 20 * 60_000);
  assert.deepEqual([room.wokeNow({ woke: 1000 }, 1000), room.wokeNow({ woke: 1000 }, 999 + room.WOKE_MS), room.wokeNow({ woke: 1000 }, 1000 + room.WOKE_MS), room.wokeNow({}, 5), room.wokeNow({ woke: 2000 }, 1000), room.wokeNow(null, 5)], [true, true, false, false, false, false]);
});

test("0.60.0, Байт наедается (остаток идеи 208): она насыпала и отошла — десять минут он ест из миски, и миска полна; потом миска пуста, а он не голоден", async () => {
  reset();
  const plan = room.dayPlan(TODAY), wake = plan[1].from, midnight = Date.parse(`${TODAY}T00:00:00+03:00`);
  assert.equal(room.MEAL_MIN, 10);
  // Она сыплет корм (второй шаг подъёма): миску наполняет рисунок её рук — в ответе сердца миска ещё не «полна».
  const time = clock(midnight + (wake + 39) * 60_000);
  const h = heart(ON, { now: time.now, random: () => 0 });
  const pours = await h.onRoom({ do: "look" }, from(5));
  assert.deepEqual([pours.her.pose, pours.cat.shape, pours.cat.place, pours.bowl], ["feed", "eat", "near", undefined]);
  let state = logic.applyLook(logic.blank(7), pours, time.now());
  assert.equal(logic.viewOf(state).fed, false);
  assert.equal(scene.castOf(logic.viewOf(state), PAINTED).fed, true, "на этом рисунке миска наполняется: следующий не сыплет в неё корм сверху");
  // Отошла с метёлкой — Байт у миски: ест. Миска полна; страница спросит комнату заново не позже, чем он доест.
  time.add(2 * 60_000);
  const meal = await h.onRoom({ do: "look", again: true }, from(5));
  assert.deepEqual([meal.her.pose, meal.cat.shape, meal.cat.place, meal.cat.key, meal.cat.still, meal.bowl], ["dust", "eat", "bowl", "сыт", true, "full"]);
  assert.ok(pool("байт:ест").length >= 3 && pool("байт:ест").map(plain).includes(meal.cat.line), meal.cat.line);
  assert.ok(meal.step >= 30_000 && meal.step <= 9 * 60_000, String(meal.step));
  state = logic.applyTick(state, meal, time.now());
  assert.deepEqual([logic.viewOf(state).fed, state.fed, state.served], [true, false, true], "миска полна, хотя человек Байта не кормил");
  assert.deepEqual([scene.castOf(logic.viewOf(state), PAINTED).cat.shape, scene.castOf(logic.viewOf(state), PAINTED).fed], ["eat", true]);
  // Слова о нём — уже о еде; об ожидании — в запасе «завтрак», и там он ещё не ест.
  for (const his of pool("байт:ест")) assert.match(his, /(?:^|\s)(?:ест|завтракает)|хрустит/u, his);
  for (const his of pool("байт:ест")) assert.ok(!pool("байт:завтрак").includes(his));
  // В чате о нём — то же, что на рисунке.
  await h.onMessage(message("зайду к тебе"), KEY);
  assert.ok(pool("байт:ест").map(plain).some(line => last().includes(line)), last());
  // Погладили его посреди еды — он отвлёкся, а корм из миски не пропал.
  const pet = await h.onRoom({ do: "pet" }, from(5));
  assert.deepEqual([pet.ok, pet.bowl], [true, "full"]);
  assert.equal(logic.viewOf(logic.applyCare(state, "pet", pet)).fed, true);
  // Десять минут прошли: доел. Миска пуста, он не голоден; человек может покормить его сам — как и раньше.
  time.add(9 * 60_000);
  const done = await h.onRoom({ do: "look", again: true }, from(5));
  assert.deepEqual([done.her.pose, done.bowl], ["dust", undefined]);
  assert.notEqual(done.cat.key, "голоден");
  state = logic.applyTick(state, done, time.now());
  assert.deepEqual([logic.viewOf(state).fed, state.served], [false, false]);
  const fed = await h.onRoom({ do: "feed" }, from(5));
  assert.deepEqual([fed.ok, fed.done.feed, fed.cat.shape, fed.cat.place], [true, 1, "eat", "bowl"]);
  assert.equal(logic.viewOf(logic.applyCare(state, "feed", fed)).fed, true);
  // Тихий час посреди его завтрака: она села читать, Байт ушёл спать на подушку — а корм из миски никуда не делся.
  reset();
  const other = clock(midnight + (wake + 41) * 60_000);
  const quiet = heart(ON, { now: other.now, random: () => 0 });
  assert.equal((await quiet.onRoom({ do: "look" }, from(5))).bowl, "full");
  assert.equal((await quiet.onRoom({ do: "quiet" }, from(5))).ok, true);
  other.add(60_000);
  const hushed = await quiet.onRoom({ do: "look", again: true }, from(5));
  assert.deepEqual([hushed.bowl, hushed.cat.shape, hushed.cat.place], ["full", "curl", "pillow"], JSON.stringify(hushed.cat));
});

test("0.61.0, слово в комнате (204, шаг 3): чего нет в словаре — отвечает модель, коротко и тем же разговором, что в чате; повтор номера — тот же ответ без второго вопроса; думает дольше страницы — «ещё думаю»", async () => {
  const { says, refuses, request } = await import("./fixtures/kit.mjs");
  const { fetch: stubFetch } = await import("./fixtures/sdk-stub.mjs");
  const { SAY_THINK_MS, SAY_POLL_S } = await import("../tgcloud/lib/roomdoor.js");
  reset();
  const time = clock(NOON);
  const h = heart(ON, { now: time.now, random: () => 0 });
  const sent = () => sdk().calls.filter(item => /^send|^edit/u.test(item.method)).length;
  await h.onRoom({ do: "look" }, from(5));
  const quiet = sent();
  // Вопрос, которого словарь не знает: модель отвечает — и ответ встаёт под рисунком одной строкой, без разметки.
  sdk().fetchQueue.push(says("Квазар — это **ядро** далёкой галактики.\nОчень яркое."));
  const said = await h.onRoom({ do: "say", text: "что такое квазар?", id: "word610001" }, from(5));
  assert.deepEqual([said.ok, said.do, said.known, said.model, said.line], [true, "say", false, true, "Квазар — это ядро далёкой галактики. Очень яркое."]);
  assert.equal(chats().length, 1);
  // Модель знает, где это сказано и каким должен быть ответ; вопрос ушёл ей как есть.
  assert.match(JSON.stringify(request().messages), /в комнате \(мини-приложение\)/u);
  assert.match(JSON.stringify(request().messages), /одна-три фразы/u);
  // Умения чата из комнаты не работают — и модель об этом знает: обещать напоминание отсюда она не должна.
  assert.match(JSON.stringify(request().messages), /напоминания, заметки, рисунки, поиск и настройки отсюда не работают/u);
  assert.equal(request().messages.at(-1).content, "что такое квазар?");
  // Тот же номер ещё раз (страница не дождалась): тот же ответ, модель второй раз не спрашивают.
  const again = await h.onRoom({ do: "say", text: "что такое квазар?", id: "word610001" }, from(5));
  assert.deepEqual([again.ok, again.repeat, again.model, again.line], [true, true, true, said.line]);
  assert.equal(chats().length, 1);
  // Что словарь знает — отвечает сама, как раньше: без модели.
  const hello = await h.onRoom({ do: "say", text: "привет", id: "word610002" }, from(5));
  assert.deepEqual([hello.known, hello.model], [true, undefined]);
  assert.equal(chats().length, 1);
  // Расход виден в «статусе» сразу: счётчики записаны этим же вызовом (своего «конца хода» у комнаты нет).
  const pulse = JSON.parse([...sdk().kv.entries()].find(([key]) => key.startsWith("heart:pulse:"))?.[1] ?? "{}");
  assert.ok(pulse.roomTalk === 1 && pulse.tokens > 0 && pulse.replies === 1, JSON.stringify(pulse));
  // В чат из комнаты ничего не ушло; вопроса в записи комнаты нет — только её ответ.
  assert.equal(sent(), quiet);
  const kept = roomOf(5);
  assert.doesNotMatch(JSON.stringify(kept), /что такое квазар/u);
  // Разговор — один: в чате она помнит, о чём говорили в комнате.
  await h.onMessage(message("а подробнее?"), KEY);
  assert.match(JSON.stringify(request().messages), /что такое квазар\?/u);
  assert.match(JSON.stringify(request().messages), /далёкой галактики/u);
  // Длинный ответ режется по границе фразы: под рисунком — не простыня.
  sdk().fetchQueue.push(says(`${"Это долгая история. ".repeat(40)}Конец.`));
  const long = await h.onRoom({ do: "say", text: "расскажи историю звёзд", id: "word610003" }, from(5));
  assert.ok(long.model === true && long.line.length <= 420 && /\.$/u.test(long.line), `${long.line.length}: ${long.line.slice(-30)}`);

  // Модель думает дольше, чем страница ждёт запрос. Таймеров у сердца нет — оно не прерывает, а помнит, что думает.
  reset();
  let release = null;
  const gate = new Promise((resolve) => { release = resolve; });
  const slow = heart(ON, { now: time.now, random: () => 0, fetchImpl: async (url, options) => { if (String(url).endsWith("/chat/completions")) await gate; return stubFetch(url, options); } });
  await slow.onRoom({ do: "look" }, from(5));
  const first = slow.onRoom({ do: "say", text: "что такое пульсар?", id: "word610004" }, from(5));
  // Страница не дождалась и спросила тот же номер: «ещё думаю» и через сколько секунд спросить снова.
  let poll = null;
  for (let n = 0; n < 200 && !(poll?.pending); n += 1) { await new Promise(resolve => setImmediate(resolve)); if (roomOf(5)?.word?.id === "word610004") poll = await slow.onRoom({ do: "say", text: "что такое пульсар?", id: "word610004" }, from(5)); }
  assert.deepEqual([poll.ok, poll.pending, poll.wait, poll.known, poll.repeat], [true, true, SAY_POLL_S, false, true]);
  assert.ok(pool("слово:думаю").map(plain).includes(poll.line) && pool("слово:думаю").length >= 3, poll.line);
  assert.equal(roomOf(5).word.a, "", "пока думает, ответа в записи нет");
  // Модель ответила: первый вызов отдаёт ответ, и он же лежит под номером — страница получит его повтором.
  release();
  const thought = await first;
  assert.deepEqual([thought.ok, thought.model, thought.line], [true, true, "ответ из стаба"]);
  const got = await slow.onRoom({ do: "say", text: "что такое пульсар?", id: "word610004" }, from(5));
  assert.deepEqual([got.repeat, got.model, got.line, got.pending], [true, true, "ответ из стаба", undefined]);
  assert.equal(chats().length, 1, "модель спросили один раз");
  // Вызов оборвался, ответа так и нет: полторы минуты — и «не успела», а не вечное «думаю».
  assert.equal(SAY_THINK_MS, 90_000);
  sdk().kv.set(room.ROOM_KEY(5), JSON.stringify({ ...roomOf(5), word: { id: "word610005", a: "", t: time.now() } }));
  assert.equal((await slow.onRoom({ do: "say", text: "что такое магнетар?", id: "word610005" }, from(5))).pending, true);
  time.add(SAY_THINK_MS + 1000);
  const late = await slow.onRoom({ do: "say", text: "что такое магнетар?", id: "word610005" }, from(5));
  assert.deepEqual([late.ok, late.late, late.pending], [true, true, undefined]);
  assert.ok(pool("слово:долго").map(plain).includes(late.line), late.line);
  assert.equal(chats().length, 1);

  // Выключено настройкой — как до 0.61.0: «об этом в чате», без модели.
  reset();
  const off = heart({ ...ON, ROOM_TALK: false }, { now: time.now, random: () => 0 });
  await off.onRoom({ do: "look" }, from(5));
  const past = await off.onRoom({ do: "say", text: "что такое пульсар?", id: "word610006" }, from(5));
  assert.ok(pool("слово:мимо").map(plain).includes(past.line) && past.model === undefined, past.line);
  assert.equal(chats().length, 0);
  // Дневной предел мыслей на человека — общий с чатом: вышел — говорит об этом, модель не тратит. Хозяина не касается.
  reset();
  const cap = heart({ ...ON, AI_DAILY_PER_PERSON: 1 }, { now: time.now, random: () => 0 });
  await cap.onRoom({ do: "look" }, from(5));
  assert.equal((await cap.onRoom({ do: "say", text: "что такое пульсар?", id: "word610007" }, from(5))).model, true);
  const over = await cap.onRoom({ do: "say", text: "а что такое магнетар?", id: "word610008" }, from(5));
  assert.ok(pool("слово:предел").map(plain).includes(over.line) && over.model === undefined, over.line);
  assert.equal(chats().length, 1);
  await cap.onRoom({ do: "look" }, from(OWNER));
  for (const id of ["word610009", "word610010"]) assert.equal((await cap.onRoom({ do: "say", text: "что такое пульсар?", id }, from(OWNER))).model, true);
  // Модель не ответила — честные слова об этом, не молчание и не «в чате».
  reset();
  const bad = heart(ON, { now: time.now, random: () => 0 });
  await bad.onRoom({ do: "look" }, from(5));
  for (let n = 0; n < 8; n += 1) sdk().fetchQueue.push(refuses(500));
  const failed = await bad.onRoom({ do: "say", text: "что такое пульсар?", id: "word610011" }, from(5));
  assert.ok(failed.ok === true && failed.model === undefined && pool("слово:сбой").map(plain).includes(failed.line), failed.line);
  assert.ok(pool("слово:сбой").length >= 2);
});

test("0.62.0, снимок в чат (165): страница присылает комнату картинкой — сердце шлёт её в личку с подписью; тот же номер второй раз не шлёт; не чаще раза в минуту; не ушла — можно повторить", async () => {
  const { request } = await import("./fixtures/kit.mjs");
  const { PHOTO_MAX, PHOTO_EVERY_MS } = await import("../tgcloud/lib/roomdoor.js");
  const { DOOR_ALLOW, DOOR_NOT_ALLOWED } = await import("../tgcloud/lib/bridge.js");
  reset();
  const time = clock(NOON);
  const h = heart(ON, { now: time.now, random: () => 0 });
  const photos = () => sdk().calls.filter(item => item.method === "sendPhoto").map(item => item.params);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000, 7)]).toString("base64");
  await h.onRoom({ do: "look" }, from(5));
  const seen = await h.onRoom({ do: "look", again: true }, from(5));
  const quiet = sdk().sent.length;
  // Картинка уходит человеку в личку как пришла; подпись собирает сердце: день, время суток и её слова этой минуты.
  const sent = await h.onRoom({ do: "photo", image: jpeg, id: "photo62001" }, from(5));
  assert.deepEqual([sent.ok, sent.do, sent.sent], [true, "photo", true]);
  assert.ok(pool("фото").map(plain).includes(sent.line), sent.line);
  assert.equal(photos().length, 1);
  const [posted] = photos();
  assert.deepEqual([posted.chat_id, posted.photo.name, posted.photo.type, posted.photo.bytes.length], [5, "room.jpg", "image/jpeg", 3004]);
  assert.deepEqual([...posted.photo.bytes.slice(0, 4)], [0xff, 0xd8, 0xff, 0xe0]);
  assert.match(posted.caption, /^(?:Комната\.|На память:) \d{1,2} [а-я]+, (?:утро|день|вечер|ночь)\.\n\n/u);
  assert.ok(seen.her.line && posted.caption.endsWith(seen.her.line), posted.caption);
  assert.equal(sdk().sent.length, quiet, "текстом в чат ничего не ушло — только картинка");
  // Тот же номер ещё раз (страница не дождалась ответа): второй картинки нет.
  const again = await h.onRoom({ do: "photo", image: jpeg, id: "photo62001" }, from(5));
  assert.deepEqual([again.ok, again.sent, again.repeat], [true, true, true]);
  assert.equal(photos().length, 1);
  // Чаще раза в минуту — не шлёт и говорит об этом.
  const early = await h.onRoom({ do: "photo", image: jpeg, id: "photo62002" }, from(5));
  assert.deepEqual([early.ok, early.sent, early.early], [true, false, true]);
  assert.ok(pool("фото:рано").map(plain).includes(early.line), early.line);
  assert.equal(photos().length, 1);
  assert.equal(PHOTO_EVERY_MS, 60_000);
  time.add(PHOTO_EVERY_MS + 1000);
  assert.equal((await h.onRoom({ do: "photo", image: jpeg, id: "photo62003" }, from(5))).sent, true);
  assert.equal(photos().length, 2);
  // Не картинка, пусто, слишком тяжело — отказ словами, в чат ничего.
  time.add(PHOTO_EVERY_MS + 1000);
  const bad = await h.onRoom({ do: "photo", image: Buffer.alloc(3000, 1).toString("base64"), id: "photo62004" }, from(5));
  assert.deepEqual([bad.ok, bad.code], [false, "bad_image"]);
  assert.deepEqual([(await h.onRoom({ do: "photo" }, from(5))).code, (await h.onRoom({ do: "photo", image: 42 }, from(5))).code, (await h.onRoom({ do: "photo", image: "A".repeat(PHOTO_MAX + 1) }, from(5))).code], ["empty", "empty", "big"]);
  assert.equal(photos().length, 2);
  // Отказ номер не «съедает»: тот же номер с настоящей картинкой — уходит.
  assert.equal((await h.onRoom({ do: "photo", image: jpeg, id: "photo62004" }, from(5))).sent, true);
  assert.equal(photos().length, 3);
  // Telegram не принял (человек закрыл чат с ней): честные слова; «ещё раз» с тем же номером — отправит.
  time.add(PHOTO_EVERY_MS + 1000);
  sdk().failing.sendPhoto = new Error("Forbidden: bot was blocked by the user");
  const failed = await h.onRoom({ do: "photo", image: jpeg, id: "photo62005" }, from(5));
  delete sdk().failing.sendPhoto;
  assert.deepEqual([failed.ok, failed.code], [false, "send"]);
  const retried = await h.onRoom({ do: "photo", image: jpeg, id: "photo62005" }, from(5));
  assert.deepEqual([retried.ok, retried.sent, retried.repeat], [true, true, undefined]);
  // Вызов оборвался посреди отправки (отметка есть, «ушло» нет): минуту — «отправляю», потом тот же номер шлёт заново.
  time.add(PHOTO_EVERY_MS + 1000);
  sdk().kv.set(room.ROOM_KEY(5), JSON.stringify({ ...roomOf(5), shot: { id: "photo62006", at: time.now(), ok: false }, ops: [...(roomOf(5).ops ?? []), ["photo62006", time.now()]] }));
  const count = photos().length;
  const going = await h.onRoom({ do: "photo", image: jpeg, id: "photo62006" }, from(5));
  assert.deepEqual([going.ok, going.sent, going.pending], [true, false, true]);
  assert.ok(pool("фото:идёт").map(plain).includes(going.line), going.line);
  assert.equal(photos().length, count);
  // Пока тот снимок уходит, запрос с другим номером (страница шлёт картинку поменьше) второго следом не шлёт.
  const other = await h.onRoom({ do: "photo", image: jpeg, id: "photo62008" }, from(5));
  assert.deepEqual([other.ok, other.sent, other.pending], [true, false, true]);
  assert.equal(photos().length, count);
  time.add(PHOTO_EVERY_MS + 1000);
  assert.equal((await h.onRoom({ do: "photo", image: jpeg, id: "photo62006" }, from(5))).sent, true);
  assert.equal(photos().length, count + 1);
  // Сама картинка нигде не хранится: в записи комнаты — только отметка.
  assert.deepEqual(Object.keys(roomOf(5).shot).sort(), ["at", "id", "ok"]);
  assert.ok(!sdk().kv.get(room.ROOM_KEY(5)).includes(jpeg.slice(0, 40)));
  // Счёт виден в «статусе»; разговор один — в чате она помнит, что прислала снимок.
  const pulse = JSON.parse([...sdk().kv.entries()].find(([key]) => key.startsWith("heart:pulse:"))?.[1] ?? "{}");
  assert.ok(pulse.roomPhoto >= 1, JSON.stringify(pulse));
  await h.onMessage(message("что на снимке?"), KEY);
  assert.match(JSON.stringify(request().messages), /прислала в чат снимок комнаты/u);
  // Отправить нечем (на платформе нет `InputFile`) — отказ словами, а не падение.
  reset();
  const bare = heart(ON, { now: time.now, random: () => 0, InputFile: null });
  await bare.onRoom({ do: "look" }, from(5));
  assert.equal((await bare.onRoom({ do: "photo", image: jpeg, id: "photo62007" }, from(5))).code, "no_send");
  // Дверь приложения этого действия не пускает: картинке туда не пройти по размеру.
  assert.ok(!DOOR_ALLOW.includes("photo") && DOOR_NOT_ALLOWED.includes("photo"));
});

test("0.63.0, хвосты сна (209): ложится в названную минуту — вечер сдвигается вместе с ней; событие дня стоит в своём эпизоде по её часам", async () => {
  const { eventFor, eventNow } = await import("../tgcloud/lib/keepsake.js");
  const usual = room.dayPlan(TODAY), early = room.dayPlan(TODAY, { bed: 22 * 60 + 15 }), late = room.dayPlan(TODAY, { bed: 23 * 60 + 40 });
  const from = (plan, name) => plan.filter(item => item.name === name).at(-1).from;
  assert.deepEqual(room.dayPlan(TODAY, { bed: null }), usual);
  assert.deepEqual(room.dayPlan(TODAY, { bed: 23 * 60 }), usual, "одиннадцать — как раньше");
  // Раньше одиннадцати: «сон», «дрёма» и «ждёт» — раньше на столько же; день до вечера — тот же.
  assert.deepEqual([from(early, "сон"), from(early, "дрёма"), from(usual, "ждёт") - from(early, "ждёт")], [22 * 60 + 15, 21 * 60 + 45, 45]);
  assert.deepEqual(early.slice(0, 7), usual.slice(0, 7));
  // Позже одиннадцати: дольше сидит вечером; ждать начинает как обычно.
  assert.deepEqual([from(late, "сон"), from(late, "дрёма"), from(late, "ждёт")], [23 * 60 + 40, 23 * 60 + 10, from(usual, "ждёт")]);
  // Названное за пределами «от половины десятого до без десяти полночь» прижимается к краю: день должен сложиться.
  assert.deepEqual([from(room.dayPlan(TODAY, { bed: 20 * 60 }), "сон"), from(room.dayPlan(TODAY, { bed: 1439 }), "сон")], [...room.BED_SPAN]);
  for (const bed of [...room.BED_SPAN, 22 * 60]) for (const wake of [120, 660]) {
    const plan = room.dayPlan(TODAY, { wake, bed });
    assert.ok(plan.every(item => item.to > item.from), `${wake}, ${bed}: ${JSON.stringify(plan)}`);
  }
  // Событие дня — внутри своего эпизода по её часам. Встаёт в одиннадцать — «занятия» начинаются в полдень, и
  // событие «занятий» до полудня не случается (раньше оно считалось по обычному дню и выпадало на её сон).
  let checked = 0, moved = 0;
  for (let back = 0; back < 200 && checked < 4; back += 1) {
    const day = new Date(Date.parse(`${TODAY}T12:00:00Z`) - back * 86_400_000).toISOString().slice(0, 10);
    const plain = eventFor(day);
    if (!plain || plain.stage !== "занятия") continue;
    const own = eventFor(day, { wake: 660 }), stage = room.dayPlan(day, { wake: 660 }).find(item => item.name === "занятия");
    assert.ok(own.from >= stage.from && own.to <= stage.to, `${day}: ${JSON.stringify([own.from, own.to, stage.from, stage.to])}`);
    assert.deepEqual([eventFor(day, {}), eventFor(day, { wake: null, bed: null })], [plain, plain]);
    assert.equal(eventNow(day, own.from, { wake: 660 })?.key, plain.key);
    if (plain.from < stage.from) { moved += 1; assert.equal(eventNow(day, plain.from, { wake: 660 }), null); }
    checked += 1;
  }
  assert.deepEqual([checked, moved > 0], [4, true]);
  // Вечернее событие — внутри «вечера», и когда она ложится рано.
  for (let back = 0, seen = 0; back < 200 && seen < 3; back += 1) {
    const day = new Date(Date.parse(`${TODAY}T12:00:00Z`) - back * 86_400_000).toISOString().slice(0, 10);
    const own = eventFor(day, { bed: room.BED_SPAN[0] });
    if (!own || own.stage !== "вечер") continue;
    const stage = room.dayPlan(day, { bed: room.BED_SPAN[0] }).find(item => item.name === "вечер");
    assert.ok(own.from >= stage.from && own.to <= stage.to, `${day}: ${JSON.stringify([own.from, own.to, stage.from, stage.to])}`);
    seen += 1;
  }
});
