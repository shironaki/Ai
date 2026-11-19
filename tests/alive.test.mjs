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
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { heart, message, reset, sdk, last, toChat, chats, KEY, OWNER, BUILD } from "./fixtures/kit.mjs";

import * as room from "../tgcloud/lib/room.js";
import * as logic from "../miniapp/logic.js";
import * as scene from "../miniapp/scene.js";
import { createPhrasebook, SECTIONS } from "../tgcloud/lib/phrasebook.js";
import { ALBUM_KEY } from "../tgcloud/lib/draw.js";

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

test("сценка ставит её саму — и слова идут за рисунком: «значит, манга» — она в кресле с кружкой и говорит о манге; спящую сценка не будит", async () => {
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
  assert.deepEqual([picked.her.key, picked.her.pose, picked.her.line], ["уют", "chair", picked.line]);
  assert.deepEqual(picked.her.beats[0], { pose: "chair", line: picked.line });
  // Дальше — её обычные реплики «с кружкой», кроме той, что тоже о кресле: о «Маленьком принце» после «значит, манга»
  // она не заговорит, и дважды подряд на одном месте не окажется.
  const usual = fitting("она:уют", air).filter(line => room.herPose(line, "уют") !== "chair");
  assert.ok(usual.length >= 2, JSON.stringify(usual));
  assert.deepEqual(picked.her.beats.slice(1), usual.map(line => ({ pose: room.herPose(line, "уют"), line })));

  // Страница: она в кресле с кружкой. Нажали на неё — говорит о манге, а не «я у стола с блокнотом».
  const state = logic.applyPick(logic.applyLook(logic.blank(14), seen, NOON), picked);
  const view = logic.viewOf(state);
  assert.deepEqual([view.her.pose, view.her.key, view.her.beat], ["chair", "уют", true]);
  assert.equal(scene.spriteOf(view), "tea3");
  assert.deepEqual([state.said, logic.applyTap(state, "her").said], [picked.line, picked.line]);
  // Потом она живёт дальше — отдыхая: следующая реплика из тех же, со своим местом.
  const next = logic.nextBeat(state, "her");
  assert.deepEqual([next.her.key, next.said, logic.viewOf(next).her.pose], ["уют", usual[0], room.herPose(usual[0], "уют")]);
  // Страница спросила комнату заново — она остаётся на своей реплике: обратно в кресло не прыгает.
  time.add(10 * 60_000);
  const tick = await h.onRoom({ do: "look", again: true }, from(id));
  assert.deepEqual([tick.her.key, tick.her.pose, tick.her.line], ["уют", "chair", picked.line]);
  const ticked = logic.applyTick(next, tick, time.now());
  assert.deepEqual([ticked.her.beat, logic.changeOf(next, ticked).kind], [1, "same"]);
  // Зашёл заново, пока исход виден, — она там же и говорит то же.
  const again = await h.onRoom({ do: "look" }, from(id));
  assert.deepEqual([again.her.key, again.her.pose, again.her.line], ["уют", "chair", picked.line]);
  const entered = logic.applyLook(logic.blank(14), again, time.now());
  assert.ok(entered.said.split("\n").includes(picked.line), entered.said);
  assert.equal(scene.spriteOf(logic.viewOf(entered)), "tea3");
  // В чате — о том же месте: «чай, кресло, плед», а не «у стола с блокнотом».
  await h.onMessage(message("зайду к тебе", { id }), KEY);
  const inChair = fitting("она:уют", air).filter(line => room.herPose(line, "уют") === "chair");
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
  const seats = [["chair", "уют", "tea3"], ["chair", "устала", "tired2"], ["chair", "ревность", "jealous"]];
  const xs = new Set();
  for (const [pose, key, name] of seats) for (const part of ["день", "вечер"]) {
    const cast = scene.castOf(view(pose, key, { part }), PAINTED);
    assert.equal(cast.her.name, part === "вечер" ? `home-${name}` : name, `${key} ${part}`);
    xs.add(cast.her.x);
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
  const path = trot.match(/<g class="stride" style="--dx:(-?[\d.]+)px;--dy:(-?[\d.]+)px;--t:([\d.]+)s"><g class="step trot">/u);
  assert.ok(path, "Байт идёт");
  assert.equal(Number(path[1]), sill.cat.x - bowl.cat.x, "от подоконника до миски — по горизонтали весь путь");
  assert.ok(Math.abs(Number(path[2])) < 60, `по полу, а не по воздуху: ${path[2]}`);
  assert.ok(Number(path[3]) >= 0.7 && Number(path[3]) <= 2.5, path[3]);
  assert.match(trot, /<g class="cat walk">/u);
  assert.doesNotMatch(scene.drawInside(cat("sit", "sill"), { ...PAINTED, was: sill.her, catWas: sill.cat }), /step trot/u, "на месте — не идёт");
  // «Ушёл под кресло» — уходит туда шагом, и дальше видны одни глаза.
  const hid = scene.drawInside(cat("eyes", "under", "обижен"), { ...PAINTED, was: sill.her, catWas: sill.cat });
  assert.match(hid, /step trot/u);
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
    "у тебя дождь": ["у тебя дождь?", "почему у тебя всегда дождь", "у тебя гроза", "у тебя солнце", "почему у тебя нет дождя", "откуда у тебя погода"],
    "за окном": ["что у тебя за окном", "какая у тебя погода"],
    "снег за окном": ["у тебя снег", "а где дождь", "у тебя же всегда дождь"],
    "ты ходишь по комнате": ["ты ходишь по комнате", "ты теперь ходишь", "куда ты пошла"],
    "ты дышишь в комнате": ["ты дышишь", "ты как живая", "комната ожила"],
    "куда ты ушла": ["куда ты ушла", "что значит переодевается", "ты ушла к шкафу", "ты переодеваешься"],
    "время в комнате": ["в комнате стемнело", "надо ли перезаходить в комнату", "у тебя ночь", "какое у тебя время"],
    "байт на спине": ["байт на спине", "байт перевернулся на спину", "байт лежит кверху лапами"],
    "байт ходит по комнате": ["байт ходит по комнате", "куда пошел байт"],
    "сценка в комнате видна": ["колючка упала", "почему окно открыто", "откуда лужа", "что за носок на полу", "почему лампочка мигает"],
    "на чём ты сидишь": ["на чем ты сидишь", "куда делся пуф", "ты сидишь в кресле"],
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
