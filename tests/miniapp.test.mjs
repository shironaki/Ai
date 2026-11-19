/**
 * Мини-приложение «Комната» (0.38.0; рисунок заново — 0.39.0) — шаг 2 идей 41 и 112–114: комнату можно
 * открыть картинкой.
 *
 * Браузера и Telegram здесь нет. Проверяется всё, что от них не зависит: рисунок (`miniapp/scene.js`),
 * раскладка ответа сердца по странице (`miniapp/logic.js`), функция комнаты (`heart.onRoom`, её зовёт
 * страница), кнопки (под ответом и в меню бота) и то, что страница действительно уходит на платформу.
 * Как это публикуется телефоном — в `tests/phone.test.mjs`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { heart, message, group, reset, last, chats, sdk, toChat, toOwner, calls, OWNER, KEY, DAY, BUILD } from "./fixtures/kit.mjs";

const scene = await import("../miniapp/scene.js");
const logic = await import("../miniapp/logic.js");
const room = await import("../tgcloud/lib/room.js");
const { default: endpoint } = await import("../tgcloud/endpoints/room.js");
const { createPhrasebook } = await import("../tgcloud/lib/phrasebook.js");
const { FIRST_KEY } = await import("../tgcloud/lib/personal.js");

const { drawRoom, drawBackdrop, drawRain, drawInside, WIDTH, HEIGHT, WIN, RAIN_SHIFT, PARTS, HER_POSES, CAT_SHAPES, CAT_PLACES, THINGS, MOODS, tint } = scene;
const ROOT = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const ON = { PHRASES: true };
// 18.11.2026, 14:00 по Москве: день, она не спит, Байт не спит.
const NOON = Date.parse("2026-11-18T11:00:00Z");
const PAGE = "https://app123.tgcloud.ai/";
const book = createPhrasebook({ random: () => 0 });
const pool = (name, ctx = {}) => book.pool(`+комната:${name}`, { formal: true, vars: { "цвет": "синий", "рисунок": "кот в шляпе" }, ...ctx });
const roomOf = (id) => JSON.parse(sdk().kv.get(room.ROOM_KEY(id)) ?? "null");
const pageOf = () => JSON.parse(sdk().kv.get("heart:page") ?? "null");
const clock = (start = NOON) => { let at = start; return { now: () => at, add: (ms) => { at += ms; } }; };
/** Кто зашёл: так платформа передаёт функции проверенного человека. */
const from = (id, extra = {}) => ({ ...KEY, initData: { user: { id, first_name: "Тест" } }, ...extra });
const own = (text) => message(text, { id: OWNER });

// ── рисунок ─────────────────────────────────────────────────────────────────

/** Области нажатия по порядку: кто дальше в списке, тот ближе к пальцу. */
function zonesOf(markup) {
  const layer = markup.slice(markup.indexOf('<g class="zones">'));
  const found = [...layer.matchAll(/<g class="tap" data-act="([^"]+)" role="button" tabindex="0" aria-label="([^"]+)"(?: id="([a-z]+)")?><rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)" fill="#000" fill-opacity="0"\/><\/g>/gu)];
  return found.map(([, act, label, id = "", x, y, w, h]) => ({ act, label, id, x: Number(x), y: Number(y), w: Number(w), h: Number(h) }));
}
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const CARE_ACTS = ["water", "tea", "feed", "play"];

/** Разметка цела: каждый тег закрыт своим, а вне тегов нет ни «<», ни «>». */
function wellFormed(markup) {
  const stack = [];
  let rest = 0;
  for (const tag of markup.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|[^<>"])*?)(\/?)>/gu)) {
    const between = markup.slice(rest, tag.index);
    if (/[<>]/u.test(between)) return `лишний знак перед ${tag[0].slice(0, 40)}`;
    rest = tag.index + tag[0].length;
    if (tag[4]) continue;
    if (!tag[1]) { stack.push(tag[2]); continue; }
    if (stack.pop() !== tag[2]) return `</${tag[2]}> закрывает не свой тег`;
  }
  if (/[<>]/u.test(markup.slice(rest))) return "лишний знак в конце";
  return stack.length ? `не закрыт <${stack.at(-1)}>` : "";
}

test("рисунок: каждая поза Аи, каждая фигура и место Байта, каждая вещь и каждый час рисуются; разметка цела, имена не повторяются", () => {
  let drawn = 0;
  const check = (view, label) => {
    const markup = drawRoom(view);
    drawn += 1;
    assert.equal(wellFormed(markup), "", label);
    assert.doesNotMatch(markup, /NaN|undefined|null|Infinity|\[object/u, label);
    const ids = [...markup.matchAll(/ id="([^"]+)"/gu)].map(found => found[1]);
    assert.equal(new Set(ids).size, ids.length, `${label}: имена повторяются — ${ids.filter((id, index) => ids.indexOf(id) !== index).join(", ")}`);
    return markup;
  };
  // Каждая поза — в каждый час, с каждым её состоянием по очереди; Байт при этом обходит все свои места.
  const keys = Object.keys(MOODS);
  let turn = 0;
  for (const part of PARTS) for (const pose of HER_POSES) {
    turn += 1;
    const markup = check({ part, her: { pose, key: keys[turn % keys.length] }, cat: { shape: CAT_SHAPES[turn % CAT_SHAPES.length], place: CAT_PLACES[turn % CAT_PLACES.length], key: "сыт" }, plant: turn % 2 ? "wet" : "dry", things: turn % 3 ? [...THINGS] : [], lamp: "#7fd0c8", fed: turn % 2 === 0, tea: turn % 4 === 0 }, `${part}/${pose}`);
    assert.ok(markup.length > 12_000, `${part}/${pose}: рисунок подозрительно мал`);
  }
  // Каждая фигура Байта — в каждом месте и в каждом его состоянии по очереди.
  const cats = ["голоден", "сыт", "спит", "ласка", "игра", "шалит", "обижен"];
  for (const shape of CAT_SHAPES) for (const place of CAT_PLACES) {
    turn += 1;
    check({ part: PARTS[turn % 4], her: { pose: HER_POSES[turn % HER_POSES.length], key: "уют" }, cat: { shape, place, key: cats[turn % cats.length] }, things: [] }, `${shape}.${place}`);
  }
  assert.equal(drawn, PARTS.length * HER_POSES.length + CAT_SHAPES.length * CAT_PLACES.length);

  // Каждая вещь меняет рисунок и даёт своё место для нажатия; без вещей таких мест нет.
  const bare = { part: "день", her: { pose: "desk", key: "дело" }, cat: { shape: "sit", place: "rug", key: "сыт" } };
  const empty = drawRoom({ ...bare, things: [] });
  assert.deepEqual(zonesOf(empty).filter(zone => zone.act.startsWith("thing:")), []);
  for (const key of THINGS) {
    const withIt = drawRoom({ ...bare, things: [key] });
    assert.notEqual(withIt, empty, `вещь «${key}» ничего не меняет на рисунке`);
    assert.deepEqual(zonesOf(withIt).filter(zone => zone.act.startsWith("thing:")).map(zone => zone.act), [`thing:${key}`]);
  }
  // Абажур — любимого цвета человека.
  assert.ok(drawRoom({ ...bare, part: "вечер", things: ["абажур"], lamp: "#3f6fd8" }).includes("#3f6fd8"));
  assert.ok(!drawRoom({ ...bare, part: "вечер", things: [], lamp: "#3f6fd8" }).includes("#3f6fd9"));
  // Час виден: вечером и ночью горит лампа, дождь идёт всегда.
  for (const part of PARTS) {
    const markup = drawRoom({ ...bare, part });
    assert.equal(markup.includes('class="glow"'), part === "вечер" || part === "ночь", part);
    assert.match(markup, /class="rain /u, `${part}: за окном всегда дождь`);
  }
  assert.notEqual(drawRoom({ ...bare, part: "день" }), drawRoom({ ...bare, part: "ночь" }));
  // Полная миска, политая Колючка и чай у неё в руках — видны.
  assert.notEqual(drawRoom({ ...bare, fed: true }), drawRoom(bare));
  assert.notEqual(drawRoom({ ...bare, plant: "dry" }), drawRoom({ ...bare, plant: "wet" }));
  assert.notEqual(drawRoom({ ...bare, tea: true }), drawRoom(bare));
  // Цвет под час: днём — как есть, ночью — темнее; не цвет — возвращается как был.
  assert.equal(tint("#ffffff", "день"), "#ffffff");
  assert.match(tint("#ffffff", "ночь"), /^#[0-9a-f]{6}$/u);
  assert.notEqual(tint("#ffffff", "ночь"), "#ffffff");
  assert.equal(tint("none", "ночь"), "none");
});

test("рисунок: нажатия — отдельным слоем поверх картинки; забота — поверх всех, свет лампы пальцу не мешает, Байт у миски не закрывает миску", () => {
  const view = { part: "ночь", her: { pose: "desk", key: "дело" }, cat: { shape: "sit", place: "bowl", key: "голоден" }, things: [...THINGS], lamp: "#7fd0c8" };
  const markup = drawRoom(view);
  // Четыре слоя: за окном, дождь по стеклу, картинка, нажатия. Первые три нажатий не ловят вовсе.
  const rain = `<g clip-path="url(#s-glass)" pointer-events="none"><g transform="translate(${WIN.x} ${WIN.y})">${drawRain("ночь")}</g></g>`;
  assert.equal(markup, `${drawBackdrop("ночь")}${rain}${drawInside(view)}`);
  assert.ok(markup.startsWith('<g class="backdrop" pointer-events="none">'));
  assert.equal((markup.match(/<g class="art" pointer-events="none">/gu) ?? []).length, 1);
  assert.equal((markup.match(/<g class="zones">/gu) ?? []).length, 1);
  const art = markup.slice(0, markup.indexOf('<g class="zones">'));
  assert.doesNotMatch(art, /data-act=|fill-opacity="0"|role="button"/u, "в картинке нажимать не на что: всё — в слое нажатий");
  assert.ok(art.includes('class="glow"'), "свет лампы — в картинке, а не поверх нажатий");
  // За окном — только час: при нажатиях страница эту часть не перерисовывает, и дождь не прыгает.
  assert.equal(drawBackdrop("ночь"), drawBackdrop("ночь"));
  assert.notEqual(drawBackdrop("ночь"), drawBackdrop("день"));
  assert.equal(drawBackdrop("чепуха"), drawBackdrop("день"));
  assert.ok(!drawInside(view).includes('class="rain'), "дождь — за окном");
  // Дождь — отдельным слоем: страница рисует его раз в час и двигает целиком, поэтому в небе и в комнате его нет,
  // имён в нём нет (два плана лежат в двух отдельных картинках) и нажатий он не ловит.
  assert.ok(!drawBackdrop("ночь").includes('class="rain'));
  for (const part of PARTS) {
    assert.equal(drawRain(part), drawRain(part, "far") + drawRain(part, "near"), part);
    for (const plane of ["far", "near"]) {
      const layer = drawRain(part, plane);
      assert.ok(layer.startsWith(`<g class="rain ${plane}" pointer-events="none" `), `${part}/${plane}`);
      assert.equal(wellFormed(layer), "", `${part}/${plane}`);
      assert.doesNotMatch(layer, / id="|url\(#|NaN|undefined/u, `${part}/${plane}`);
      assert.ok((layer.match(/<path /gu) ?? []).length >= 12, `${part}/${plane}: струй мало`);
    }
  }
  assert.equal(drawRain("чепуха"), drawRain("день"));
  assert.notEqual(drawRain("день"), drawRain("ночь"), "ночью струи светлее неба — другой цвет");

  const zones = zonesOf(markup);
  assert.equal((markup.match(/data-act="/gu) ?? []).length, zones.length, "каждое место нажатия — прямоугольник в слое нажатий");
  assert.deepEqual(zones[0], { act: "window", label: "Окно", id: "", x: 124, y: 44, w: 264, h: 218 });
  assert.deepEqual(zones.slice(-4).map(zone => [zone.act, zone.id, zone.label]), [["water", "plant", "Колючка"], ["tea", "kettle", "Чайник"], ["feed", "bowl", "Миска Байта"], ["play", "toy", "Клубок"]], "забота — поверх всех");
  // Слова нажатий — те же, что знает страница и сердце: «pet» — погладить.
  assert.deepEqual([...new Set(zones.map(zone => zone.act.replace(/:.*/u, ":")))].sort(), ["feed", "her", "pet", "play", "tea", "thing:", "water", "window"]);
  assert.deepEqual(zones.find(zone => zone.act === "pet").id, "cat");
  assert.deepEqual(zones.find(zone => zone.act === "her").id, "her");
  for (const act of ["pet", "feed", "play", "tea", "water"]) assert.ok(logic.CARE.includes(act));

  // Все позы, все места, все фигуры: области — в пределах рисунка и не меньше пальца; Байт не заходит на заботу.
  let seen = 0;
  for (const pose of HER_POSES) for (const place of CAT_PLACES) for (const shape of CAT_SHAPES) for (const things of [[], [...THINGS]]) {
    const label = `${pose}/${shape}.${place}/${things.length ? "вещи" : "пусто"}`;
    const list = zonesOf(drawInside({ part: "день", her: { pose, key: "уют" }, cat: { shape, place, key: "сыт" }, things }));
    seen += 1;
    for (const zone of list) {
      assert.ok(zone.x >= 0 && zone.y >= 0 && zone.x + zone.w <= WIDTH + 0.11 && zone.y + zone.h <= HEIGHT + 0.11, `${label}: «${zone.act}» выходит за рисунок`);
      assert.ok(zone.w >= 14 && zone.h >= 12, `${label}: «${zone.act}» слишком мала`);
    }
    const cat = list.find(zone => zone.act === "pet"), she = list.find(zone => zone.act === "her");
    const care = list.filter(zone => CARE_ACTS.includes(zone.act));
    assert.equal(care.length, 4, label);
    assert.deepEqual(list.slice(-4), care, `${label}: забота — поверх всех`);
    for (const zone of care) {
      assert.ok(zone.w >= 28 && zone.h >= 28, `${label}: «${zone.act}» меньше пальца`);
      assert.ok(!overlap(cat, zone), `${label}: Байт закрывает «${zone.label}»`);
    }
    assert.ok(cat.w >= 36 && cat.h >= 24, `${label}: до Байта не дотянуться (${cat.w}×${cat.h})`);
    assert.ok(she.w >= 50 && she.h >= 60, `${label}: до неё не дотянуться`);
    // Вещи — только те, что есть; плед, которым она укрыта, с кресла снят.
    const owned = list.filter(zone => zone.act.startsWith("thing:")).map(zone => zone.act.slice(6)).sort();
    const covered = pose === "lie" || pose === "nap" || pose === "chair";
    assert.deepEqual(owned, things.filter(key => !(key === "плед" && covered)).sort(), label);
  }
  assert.equal(seen, HER_POSES.length * CAT_PLACES.length * CAT_SHAPES.length * 2);

  // Кто ближе к пальцу. Обычно Байт: он маленький, сидит у неё на коленях или выглядывает из-под кресла.
  const order = (her, cat) => zonesOf(drawInside({ part: "день", her: { pose: her, key: "уют" }, cat: { ...cat, key: "сыт" }, things: [] })).map(zone => zone.act).filter(act => act === "her" || act === "pet");
  assert.deepEqual(order("chair", { shape: "lie", place: "chair" }), ["her", "pet"]);
  assert.deepEqual(order("chair", { shape: "eyes", place: "under" }), ["her", "pet"]);
  assert.deepEqual(order("shelf", { shape: "sit", place: "bowl" }), ["her", "pet"], "Байт у миски — перед её ногами");
  assert.deepEqual(order("lie", { shape: "curl", place: "plaid" }), ["her", "pet"], "Байт на пледе, которым она укрыта, — поверх неё");
  // Но когда она стоит на полу перед ним и закрывает его собой — первой палец встречает её.
  assert.deepEqual(order("shelf", { shape: "sit", place: "plaid" }), ["pet", "her"]);
  assert.deepEqual(order("dance", { shape: "claw", place: "chair" }), ["pet", "her"]);
  // Лампа, ёлка и место рядом с Байтом — поверх фигур; остальные вещи — под ними.
  const acts = zonesOf(drawInside({ part: "день", her: { pose: "desk", key: "дело" }, cat: { shape: "sit", place: "sill", key: "шалит" }, things: [...THINGS] })).map(zone => zone.act);
  for (const key of ["абажур", "ёлка", "место"]) assert.ok(acts.indexOf(`thing:${key}`) > acts.indexOf("pet"), key);
  for (const key of THINGS.filter(name => !["абажур", "ёлка", "место"].includes(name))) assert.ok(acts.indexOf(`thing:${key}`) < acts.indexOf("her"), key);

  // На кресле Байт лежит или спит: сидя он закрыл бы ей лицо.
  for (const shape of CAT_SHAPES.filter(name => name !== "claw")) {
    const lap = drawInside({ part: "день", her: { pose: "chair", key: "уют" }, cat: { shape, place: "chair", key: "сыт" }, things: [] });
    assert.match(lap, shape === "curl" ? /class="cat curl"/u : /class="cat lie"/u, shape);
  }
});

test("рисунок: незнакомое и чужое не ломает картинку и не попадает в разметку", () => {
  // Пустое описание — пустая комната: без неё и без Байта, но с окном и заботой.
  for (const view of [undefined, {}, { her: null, cat: null }, { part: 5, things: "все", plant: 1 }]) {
    const markup = drawRoom(view);
    assert.equal(wellFormed(markup), "");
    assert.deepEqual(zonesOf(markup).map(zone => zone.act), ["window", "water", "tea", "feed", "play"]);
  }
  // Незнакомые поза, место, фигура и час — заменяются известными.
  const odd = drawRoom({ part: "полдень", her: { pose: "на потолке", key: "восторг" }, cat: { shape: "шар", place: "луна", key: "?" }, things: ["рояль"] });
  assert.equal(odd, drawRoom({ part: "день", her: { pose: "desk", key: "" }, cat: { shape: "sit", place: "rug", key: "" }, things: [] }));
  // Чужие строки не доходят до разметки ни в каком поле: ни тегом, ни атрибутом.
  const evil = '"><script>alert(1)</script><g x="';
  const hostile = drawRoom({ part: evil, her: { pose: evil, key: evil }, cat: { shape: evil, place: evil, key: evil }, things: [evil, "кружка"], lamp: evil, plant: evil, fed: evil, tea: evil });
  assert.equal(wellFormed(hostile), "");
  assert.doesNotMatch(hostile, /script|alert/u);
  assert.equal(hostile, drawRoom({ part: "день", her: { pose: "desk", key: "" }, cat: { shape: "sit", place: "rug", key: "" }, things: ["кружка"], fed: true, tea: true, plant: "wet" }));
  // Цвет абажура — только «#rrggbb»: иначе обычный янтарный.
  assert.equal(drawRoom({ things: ["абажур"], lamp: "red; background: url(x)" }), drawRoom({ things: ["абажур"] }));
});

test("рисунок и сердце говорят об одном: позы, фигуры, места, вещи; у каждой её фразы и фразы о Байте есть картинка", () => {
  assert.deepEqual([...HER_POSES], [...room.HER_POSES]);
  assert.deepEqual([...CAT_SHAPES], [...room.CAT_SHAPES]);
  assert.deepEqual([...CAT_PLACES], [...room.CAT_PLACES]);
  assert.deepEqual([...THINGS].sort(), room.ITEMS.map(item => item.key).sort());
  assert.deepEqual([...PARTS], ["утро", "день", "вечер", "ночь"]);
  // Каждая её строка в словаре даёт позу, которую рисунок знает; каждое состояние — лицо.
  const seenPoses = new Set();
  for (const key of ["дело", "уют", "игра", "сон", "устала", "обида", "ревность"]) {
    assert.ok(MOODS[key], `нет лица для «${key}»`);
    for (const owner of [true, false]) for (const line of pool(`она:${key}`, { owner, level: owner ? "close" : "known" })) {
      const pose = room.herPose(line, key);
      assert.ok(HER_POSES.includes(pose), line);
      seenPoses.add(pose);
    }
  }
  assert.deepEqual([...seenPoses].sort(), [...HER_POSES].sort(), "каждая нарисованная поза встречается в её фразах");
  const seenCats = new Set();
  for (const key of ["голоден", "сыт", "спит", "ласка", "игра", "шалит", "обижен"]) for (const line of pool(`байт:${key}`)) {
    const { shape, place } = room.catPose(line, key);
    assert.ok(CAT_SHAPES.includes(shape) && CAT_PLACES.includes(place), line);
    seenCats.add(`${shape}.${place}`);
  }
  assert.ok(seenCats.size >= 12, `Байт нарисован разнообразно: ${[...seenCats].join(", ")}`);
  // После заботы Байт занят ею.
  assert.deepEqual([room.catAfter("feed"), room.catAfter("feed", { again: true }), room.catAfter("play"), room.catAfter("pet"), room.catAfter("tea"), room.catAfter("water")],
    [{ shape: "eat", place: "bowl" }, { shape: "sit", place: "bowl" }, { shape: "play", place: "rug" }, { shape: "sit", place: "near" }, null, null]);
  // Любимый цвет — цветом абажура; незнакомое название — янтарный, как у лампы.
  assert.equal(room.colourHex("Синий"), "#3f6fd8");
  assert.equal(room.colourHex("цвет морской волны"), "#3fc7b8");
  assert.equal(room.colourHex("цвет печали"), room.LAMP_COLOUR);
  for (const name of ["красный", "зелёный", "жёлтый", "розовый", "фиолетовый", "чёрный", "белый", "оранжевый", "голубой", "серый", "коричневый"]) assert.match(room.colourHex(name), /^#[0-9a-f]{6}$/u, name);
});

// ── страница: что показать ──────────────────────────────────────────────────

const LOOK = Object.freeze({
  ok: true, do: "look", build: "0.38.0", formal: true, clock: { hour: 20, part: "вечер", day: "2026-11-18" },
  greet: "Заходите. Тапочки у двери.", window: "Вечер. За окном дождь и фонари.",
  her: { key: "уют", pose: "chair", line: "Я в кресле у окна, под пледом." },
  cat: { key: "голоден", shape: "sit", place: "bowl", line: "Байт сидит у миски." },
  plant: { state: "dry" }, done: { pet: 0, feed: 0, play: 0, tea: 0, water: 0 }, cared: false,
  things: [{ key: "кружка", title: "вторая кружка — для гостя", line: "На столе — вторая кружка." }, { key: "тапочки", title: "тапочки у двери", line: "" }, { key: "рояль", title: "рояль", line: "?" }],
  lamp: "#3f6fd8", drawing: "", fresh: ["кружка", "рояль"], next: { days: 4 },
  scene: { key: "sock", text: "Байт принёс носок.", options: ["Похвалить", "Отобрать"], pick: null, outcome: null }, first: true,
});

test("страница: ответ сердца раскладывается по картинке и словам; отказ — словами и кнопкой «ещё раз», рисунок остаётся", () => {
  const start = logic.blank(9);
  assert.deepEqual([start.ready, start.part, start.her, start.cat, start.said], [false, "утро", null, null, "Дверь открывается…"]);
  assert.deepEqual([0, 4, 5, 11, 12, 17, 18, 22, 23].map(logic.partOf), ["ночь", "ночь", "утро", "утро", "день", "день", "вечер", "вечер", "ночь"]);
  for (const part of PARTS) { assert.ok(logic.LIGHTS[part]); assert.match(logic.HEADERS[part], /^#[0-9a-f]{6}$/u); }
  assert.match(logic.PAGE, /^\d+$/u);

  const seen = logic.applyLook(start, LOOK);
  assert.equal(seen.ready, true);
  assert.deepEqual(logic.viewOf(seen), { part: "вечер", her: { pose: "chair", key: "уют" }, cat: { shape: "sit", place: "bowl", key: "голоден" }, plant: "dry", things: ["кружка", "тапочки"], lamp: "#3f6fd8", fed: false, tea: false });
  // В разговоре — приветствие, она, Байт и новая вещь; незнакомая вещь («рояль») не показывается и не называется.
  assert.equal(seen.said, "Заходите. Тапочки у двери.\nЯ в кресле у окна, под пледом.\nБайт сидит у миски.\nНовое в комнате. На столе — вторая кружка.");
  assert.deepEqual(seen.scene, { key: "sock", text: "Байт принёс носок.", options: ["Похвалить", "Отобрать"], pick: null, outcome: "" });
  assert.deepEqual([seen.build, seen.next, seen.tone, seen.retry], ["0.38.0", 4, "", false]);
  // То, что отдано рисунку, рисуется.
  assert.equal(wellFormed(drawRoom(logic.viewOf(seen))), "");

  // Нажатие на неё, на окно и на вещь — её слова; у вещи без строки — название; на пустое место — ничего.
  assert.equal(logic.applyTap(seen, "her").said, "Я в кресле у окна, под пледом.");
  assert.equal(logic.applyTap(seen, "window").said, "Вечер. За окном дождь и фонари.");
  assert.equal(logic.applyTap(seen, "thing:кружка").said, "На столе — вторая кружка.");
  assert.equal(logic.applyTap(seen, "thing:тапочки").said, "Тапочки у двери.");
  for (const act of ["thing:рояль", "pet", "", null, "thing:"]) assert.equal(logic.applyTap(seen, act), null, String(act));

  // Забота: слова, Байт у миски ест, миска полна; чай — у неё в руках; повтор — тоже слова.
  const fed = logic.applyCare({ ...seen, busy: "feed" }, "feed", { ok: true, do: "feed", line: "Байт ест.", again: false, cat: { key: "сыт", shape: "eat", place: "bowl" }, plant: { state: "dry" }, done: { feed: 1 }, cared: true, note: "Мы стали ближе." });
  assert.deepEqual([fed.said, fed.busy, fed.fed, fed.cat, fed.done.feed, fed.lines.cat], ["Байт ест.\nМы стали ближе.", "", true, { shape: "eat", place: "bowl", key: "сыт" }, 1, "Байт ест."]);
  const tea = logic.applyCare(fed, "tea", { ok: true, do: "tea", line: "Спасибо.", plant: { state: "wet" }, done: { feed: 1, tea: 1 } });
  assert.deepEqual([tea.tea, tea.fed, tea.plant, tea.cat], [true, true, "wet", fed.cat], "чай Байта не касается: он остаётся, где был");

  // Сценка: выбор сделан — исход в разговоре, сценка сыграна; «уже сыграна» — сценка убирается.
  const picked = logic.applyPick({ ...seen, busy: "pick" }, { ok: true, do: "pick", line: "Носок отобран.", scene: { ...LOOK.scene, pick: 1, outcome: "Носок отобран." } });
  assert.deepEqual([picked.said, picked.scene.pick, picked.scene.outcome, picked.busy], ["Носок отобран.", 1, "Носок отобран.", ""]);
  const late = logic.applyPick(seen, { ok: false, code: "played", text: "Эта сценка уже сыграна." });
  assert.deepEqual([late.scene, late.said, late.tone], [null, "Эта сценка уже сыграна.", "warn"]);
  assert.deepEqual(logic.applyPick(seen, { ok: false, code: "storage", text: "Память недоступна." }).scene, seen.scene, "не записалось — сценка остаётся: можно попробовать ещё раз");

  // Отказ: слова сердца — в разговор; рисунок не меняется. На входе — с кнопкой «ещё раз».
  const closed = logic.applyLook(start, { ok: false, code: "off", text: "Комната сейчас закрыта." });
  assert.deepEqual([closed.ready, closed.said, closed.tone, closed.retry], [false, "Комната сейчас закрыта.", "warn", true]);
  const failed = logic.applyCare({ ...seen, busy: "pet" }, "pet", { ok: false, code: "storage", text: "" });
  assert.deepEqual([failed.said, failed.tone, failed.busy, failed.retry], ["Что-то пошло не так. Попробуйте ещё раз.", "warn", "", false]);
  assert.deepEqual(logic.viewOf(failed), logic.viewOf(seen));
  for (const broken of [null, undefined, "строка", 5, {}, { ok: "да" }]) assert.equal(logic.applyLook(start, broken).ready, false);

  // Мусор в ответе не ломает страницу: всё незнакомое заменяется известным.
  const odd = logic.applyLook(start, { ok: true, clock: { hour: "поздно" }, her: { pose: "на люстре" }, cat: "кот", things: [null, 5, { key: "ёлка" }], lamp: "javascript:alert(1)", scene: { key: "x", text: "y", options: ["одна"] }, done: { pet: -3, feed: "2", play: null }, next: { days: -1 } });
  assert.deepEqual(logic.viewOf(odd), { part: "ночь", her: { pose: "desk", key: "" }, cat: null, plant: "wet", things: ["ёлка"], lamp: "", fed: true, tea: false });
  assert.deepEqual([odd.scene, odd.next, odd.done, odd.said], [null, null, { pet: 0, feed: 2, play: 0, tea: 0, water: 0 }, "Заходите."]);
  assert.equal(wellFormed(drawRoom(logic.viewOf(odd))), "");
});

test("страница: ошибки связи — словами; ответ функции понимается и голый, и в обёртке", () => {
  assert.equal(logic.explain({ type: "ENDPOINT_ERROR", message: "Комната закрыта." }), "Комната закрыта.");
  assert.match(logic.explain({ type: "UNAUTHORIZED" }), /Telegram не подтвердил, кто зашёл/u);
  assert.match(logic.explain({ message: "HTTP 401" }), /Telegram не подтвердил/u);
  assert.match(logic.explain({ type: "NOT_FOUND" }), /ещё не опубликована до конца/u);
  assert.match(logic.explain({ message: "429 Too Many Requests" }), /Слишком часто/u);
  assert.equal(logic.explain({ type: "TIMEOUT" }), "Комната не ответила (TIMEOUT). Попробуйте ещё раз чуть позже.");
  assert.equal(logic.explain(null), "Комната не ответила. Попробуйте ещё раз чуть позже.");
  assert.deepEqual(logic.unwrap(LOOK), LOOK);
  assert.deepEqual(logic.unwrap({ ok: true, result: LOOK }), LOOK);
  assert.deepEqual(logic.unwrap({ ok: false, code: "off", text: "закрыта", build: "1" }), { ok: false, code: "off", text: "закрыта", build: "1" });
  for (const empty of [null, undefined, "", 0]) assert.deepEqual([logic.unwrap(empty).ok, logic.unwrap(empty).code], [false, "empty"]);
});

test("витрина: страница, открытая не из Telegram, показывает комнату по часам устройства; забота — понарошку и по тем же правилам", () => {
  for (const hour of [3, 9, 14, 20]) {
    const state = logic.applyLook(logic.blank(hour), logic.demoLook(hour));
    assert.equal(state.ready, true);
    assert.equal(state.part, logic.partOf(hour));
    assert.ok(state.said.startsWith(logic.DEMO_NOTE), "витрина честно говорит, что она витрина");
    assert.ok(state.scene && state.scene.options.length === 2);
    assert.equal(wellFormed(drawRoom(logic.viewOf(state))), "");
  }
  // Настройки снимка: час, поза, Байт, вещи, цвет; незнакомое — как обычно.
  const shot = logic.applyLook(logic.blank(12), logic.demoLook(12, { part: "ночь", her: "dance", cat: "curl.pillow.спит", things: "all", lamp: "#7fd0c8", plant: "wet", scene: "0" }));
  assert.deepEqual(logic.viewOf(shot), { part: "ночь", her: { pose: "dance", key: shot.her.key }, cat: { shape: "curl", place: "pillow", key: "спит" }, plant: "wet", things: [...THINGS], lamp: "#7fd0c8", fed: false, tea: false });
  assert.equal(shot.scene, null);
  const odd = logic.applyLook(logic.blank(12), logic.demoLook(12, { her: "tea", cat: "loaf.moon", things: "рояль,кружка" }));
  assert.deepEqual([odd.cat.shape, odd.cat.place, odd.things], ["sit", "rug", ["кружка"]]);
  // У каждой вещи витрины есть свои слова: нажатие на неё не молчит.
  for (const key of THINGS) assert.ok((logic.applyTap(shot, `thing:${key}`)?.said ?? "").length > 12, key);

  // Забота в витрине: первый раз — одни слова, второй — другие; Колючку дважды не поливают.
  let state = logic.applyLook(logic.blank(14), logic.demoLook(14));
  for (const op of logic.CARE) {
    const first = logic.demoCare(state, op);
    assert.deepEqual([first.ok, first.again, first.build], [true, op === "water" && state.plant === "wet", ""], op);
    state = logic.applyCare(state, op, first);
    assert.ok(state.said.length > 5, op);
    const second = logic.demoCare(state, op);
    assert.equal(second.again, true, op);
    assert.notEqual(second.line, first.line, op);
    state = logic.applyCare(state, op, second);
    assert.equal(wellFormed(drawRoom(logic.viewOf(state))), "");
  }
  assert.deepEqual([state.fed, state.tea, state.plant], [true, true, "wet"]);
  const picked = logic.applyPick(state, logic.demoPick(state, 1));
  assert.equal(picked.scene.pick, 1);
  assert.ok(picked.said.length > 10);
});

// ── сердце: функция комнаты ─────────────────────────────────────────────────

test("функция комнаты: зайти — всё, что видно; поза на рисунке — из её же слов; в чат ничего не пишется", async () => {
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  const seen = await h.onRoom({ do: "look" }, from(5));
  assert.equal(seen.ok, true);
  assert.deepEqual([seen.do, seen.build, seen.formal, seen.first], ["look", BUILD, true, true]);
  assert.deepEqual(seen.clock, { hour: 14, part: "день", day: "2026-11-18" });
  assert.ok(pool("зайти").includes(seen.greet), seen.greet);
  assert.ok(pool("окно").some(line => seen.window === line), seen.window);
  // Она и Байт: строка — из словаря, поза — из этой строки.
  assert.ok(pool(`она:${seen.her.key}`).includes(seen.her.line), seen.her.line);
  assert.equal(seen.her.pose, room.herPose(seen.her.line, seen.her.key));
  assert.ok(pool(`байт:${seen.cat.key}`).includes(seen.cat.line), seen.cat.line);
  assert.deepEqual({ shape: seen.cat.shape, place: seen.cat.place }, room.catPose(seen.cat.line, seen.cat.key));
  assert.deepEqual([seen.plant, seen.done, seen.cared, seen.things, seen.lamp, seen.fresh, seen.next], [{ state: "dry" }, { pet: 0, feed: 0, play: 0, tea: 0, water: 0 }, false, [], "", [], { days: 3 }]);
  // Сценка дня — та же, что пришла бы в чат; её кнопки — два решения.
  const today = room.sceneFor(5, "2026-11-18");
  assert.deepEqual(seen.scene, { key: today.key, text: today.text.replace(/\{[^|}]*\|([^}]*)\}/gu, "$1"), options: today.options.map(option => option[0]), pick: null, outcome: null });
  // Заход считается заходом; в чат при этом ничего не уходит, модель не спрошена.
  assert.deepEqual([roomOf(5).n, toChat(5).length, chats().length], [1, 0, 0]);
  // Страница раскладывает этот ответ и рисует его.
  const state = logic.applyLook(logic.blank(), seen);
  assert.equal(state.ready, true);
  assert.equal(wellFormed(drawRoom(logic.viewOf(state))), "");
  assert.equal(state.said, [seen.greet, seen.her.line, seen.cat.line].join("\n"));

  // Второй заход — уже не первый; сценка та же, пока не сыграна.
  const again = await h.onRoom({ do: "look" }, from(5));
  assert.deepEqual([again.first, again.scene.key, roomOf(5).n], [false, today.key, 2]);
  // Без «do» — тоже зайти.
  assert.equal((await h.onRoom({}, from(5))).do, "look");
  assert.equal((await h.onRoom(undefined, from(5))).do, "look");

  // Хозяину — его слова; платформа может отдать человека и строкой — он тот же.
  const warm = heart(ON, { now: () => NOON, random: () => 0.999999 });
  const mine = await warm.onRoom({ do: "look" }, { ...KEY, initData: JSON.stringify({ user: JSON.stringify({ id: OWNER }) }) });
  assert.equal(mine.ok, true);
  assert.match(mine.greet, /хозяин/iu);
  assert.equal(roomOf(OWNER).n, 1);
  assert.equal(roomOf(5).n, 4, "гость и хозяин — каждый в своей комнате");
});

test("функция комнаты: вещи приходят со временем — с подписью, цветом абажура и новостью; ночью она спит, и страница темнеет", async () => {
  reset();
  const time = clock();
  const h = heart(ON, { now: time.now, random: () => 0 });
  sdk().kv.set(FIRST_KEY(5), JSON.stringify({ at: NOON - 35 * DAY }));
  const seen = await h.onRoom({ do: "look" }, from(5));
  // За заход — не больше двух новостей; на рисунке — всё, что уже есть.
  assert.deepEqual(seen.things.map(item => item.key), ["кружка", "тапочки", "подушка", "снимок"]);
  assert.deepEqual(seen.fresh, ["кружка", "тапочки"]);
  for (const item of seen.things) { assert.ok(item.title.length > 3); assert.ok(pool(`вещь:${item.key}`).includes(item.line), item.line); }
  assert.deepEqual(seen.next, { days: 25 });
  assert.match(logic.applyLook(logic.blank(), seen).said, /\nНовое в комнате\. .+\nНовое в комнате\. /u);
  // Любимый цвет — абажур этого цвета.
  await h.onMessage(message("мой любимый цвет — синий"), KEY);
  const lamp = await h.onRoom({ do: "look" }, from(5));
  assert.equal(lamp.lamp, "#3f6fd8");
  assert.ok(lamp.things.some(item => item.key === "абажур" && /синий/u.test(item.line)));
  // Ночь: она спит, страница — ночная.
  time.add(12 * 3_600_000);
  const night = await h.onRoom({ do: "look" }, from(5));
  assert.deepEqual([night.clock.part, night.her.key], ["ночь", "сон"]);
  assert.equal(logic.LIGHTS[logic.applyLook(logic.blank(), night).part], "night");
});

test("функция комнаты: забота и сценка — по тем же правилам, что словами в чате; шаг в отношениях — раз в день", async () => {
  reset();
  const time = clock();
  const h = heart(ON, { now: time.now, random: () => 0 });
  const seen = await h.onRoom({ do: "look" }, from(5));

  const pet = await h.onRoom({ do: "pet" }, from(5));
  assert.deepEqual([pet.ok, pet.again, pet.early, pet.counted, pet.cared], [true, false, false, true, true]);
  assert.ok(pool("погладить").includes(pet.line), pet.line);
  assert.deepEqual(pet.cat, { key: "ласка", shape: "sit", place: "near" }, "погладили — Байт рядом");
  assert.equal(pet.done.pet, 1);
  const again = await h.onRoom({ do: "pet" }, from(5));
  assert.deepEqual([again.again, again.counted, again.done.pet], [true, false, 2]);
  assert.ok(pool("погладить:ещё").includes(again.line), again.line);

  const fed = await h.onRoom({ do: "feed" }, from(5));
  assert.deepEqual([fed.cat, fed.counted, fed.done.feed], [{ key: "сыт", shape: "eat", place: "bowl" }, false, 1], "забота за день считается один раз");
  assert.deepEqual((await h.onRoom({ do: "feed" }, from(5))).cat, { key: "сыт", shape: "sit", place: "bowl" });
  const play = await h.onRoom({ do: "play" }, from(5));
  assert.deepEqual(play.cat, { key: "игра", shape: "play", place: "rug" });
  // Чай и вода Байта не касаются: о нём в ответе ничего — он остаётся, где был.
  const tea = await h.onRoom({ do: "tea" }, from(5));
  assert.deepEqual(["cat" in tea, tea.done.tea], [false, 1]);
  assert.ok(pool("чай").includes(tea.line), tea.line);
  const water = await h.onRoom({ do: "water" }, from(5));
  assert.deepEqual([water.plant, water.early, "cat" in water], [{ state: "wet" }, false, false]);
  const soon = await h.onRoom({ do: "water" }, from(5));
  assert.deepEqual([soon.early, soon.again, soon.done.water], [true, true, 1]);
  assert.ok(pool("полить:рано").includes(soon.line), soon.line);
  // Страница принимает каждый ответ.
  let state = logic.applyLook(logic.blank(), seen);
  for (const [op, result] of [["pet", pet], ["feed", fed], ["play", play], ["tea", tea], ["water", water]]) { state = logic.applyCare(state, op, result); assert.equal(state.said.split("\n")[0], result.line); }
  assert.deepEqual([state.fed, state.tea, state.plant, state.cat.shape], [true, true, "wet", "play"]);

  // В чат забота из комнаты не пишет, но словами там о ней знают: «покормить» — уже «ещё раз», а не первый.
  assert.equal(toChat(5).length, 0);
  await h.onMessage(message("покормить Байта"), KEY);
  assert.ok(pool("покормить:ещё").some(line => last().includes(line)), last());
  // И наоборот: что сделано словами, комната видит.
  const look = await h.onRoom({ do: "look" }, from(5));
  assert.deepEqual([look.done.feed, look.cared, look.plant.state], [3, true, "wet"]);

  // Сценка: выбор — один раз; исход — те же слова, что под кнопкой в чате.
  const today = room.sceneFor(5, "2026-11-18");
  const picked = await h.onRoom({ do: "pick", key: today.key, pick: 1 }, from(5));
  assert.deepEqual([picked.ok, picked.scene.pick, picked.counted], [true, 1, false]);
  assert.equal(picked.line, today.options[1][1].replace(/\{[^|}]*\|([^}]*)\}/gu, "$1"));
  assert.equal(picked.scene.outcome, picked.line);
  assert.deepEqual(roomOf(5).scene, { day: "2026-11-18", key: today.key, pick: 1 });
  assert.deepEqual(await h.onRoom({ do: "pick", key: today.key, pick: 0 }, from(5)), { ok: false, code: "played", text: "Эта сценка уже сыграна.", build: BUILD });
  // Вчерашняя или чужая сценка — «её день прошёл»: страница убирает карточку. Сценки, которой нет вовсе, — тоже нет.
  const other = room.SCENES.find(scene => scene.key !== today.key).key;
  assert.deepEqual(await h.onRoom({ do: "pick", key: other, pick: 0 }, from(5)), { ok: false, code: "gone", text: "Этой сценки уже нет: её день прошёл.", build: BUILD });
  const stale = await h.onRoom({ do: "pick", key: "nosuch", pick: 0 }, from(5));
  assert.deepEqual([stale.ok, stale.code, stale.text], [false, "unknown", "Этой сценки уже нет: её день прошёл."]);
  assert.equal((await h.onRoom({ do: "look" }, from(5))).scene.pick, 1, "сыгранная сценка видна и при следующем заходе");

  // На другой день всё считается заново; Колючка ещё полита.
  time.add(DAY);
  const next = await h.onRoom({ do: "pet" }, from(5));
  assert.deepEqual([next.again, next.counted, next.done.pet, next.plant.state], [false, true, 1, "wet"]);
  assert.equal(chats().length, 0, "модель ни разу не спрошена");
});

test("функция комнаты: отказы — словами и без исключений; репетиция ничего не читает и не пишет", async () => {
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  // Репетиция перед публикацией: ни базы, ни Telegram.
  assert.deepEqual(await h.onRoom({ do: "look" }, { testRun: true }), { ok: true, route: "room", do: "look", build: BUILD, side_effects: "none" });
  assert.deepEqual(await h.onRoom({ do: "pet" }, { testRun: true, initData: { user: { id: 5 } } }), { ok: true, route: "room", do: "pet", build: BUILD, side_effects: "none" });
  assert.deepEqual([sdk().kv.size, sdk().sent.length, sdk().calls.length], [0, 0, 0]);

  // Кто зашёл — неизвестно: без подписи Telegram в комнату не пускают.
  for (const ctx of [KEY, {}, undefined, { initData: null }, { initData: {} }, { initData: { user: {} } }, { initData: { user: { id: "abc" } } }, { initData: { user: { id: -5 } } }, { initData: { user: { id: 0 } } },
    { initData: { user: { id: 5, is_bot: true } } }, { initData: "не json" }, { initData: { user: { id: 1.5 } } }]) {
    const refused = await h.onRoom({ do: "pet" }, ctx);
    assert.deepEqual(refused, { ok: false, code: "auth", text: "Не вижу, кто зашёл. Откройте комнату кнопкой в чате со мной.", build: BUILD }, JSON.stringify(ctx));
  }
  assert.equal(sdk().kv.size, 0, "неизвестный гость ничего не записал");
  // Незнакомое действие.
  for (const op of ["dance", "", "hurt", "menuoff", "open", "x".repeat(400), 5, {}]) {
    const refused = await h.onRoom({ do: op }, from(5));
    assert.deepEqual([refused.ok, refused.code, refused.text], [false, "unknown", "Такого в комнате не делают."], String(op).slice(0, 20));
  }
  assert.equal(roomOf(5), null, "отказ ничего не записал");
  // Сценка без ключа и с чужим выбором — отказ, а не запись.
  for (const input of [{ do: "pick" }, { do: "pick", key: 5, pick: "да" }, { do: "pick", key: room.sceneFor(5, "2026-11-18").key, pick: 7 }]) assert.equal((await h.onRoom(input, from(5))).ok, false);

  // Комната выключена настройкой — закрыта и функция.
  for (const off of [{ ROOM_APP: false }, { ROOM: false }, { PHRASES: false }]) {
    reset();
    const closed = await heart({ ...ON, ...off }, { now: () => NOON }).onRoom({ do: "look" }, from(5));
    assert.deepEqual([closed.ok, closed.code], [false, "off"], JSON.stringify(off));
  }
  // Базы нет — память недоступна; исключения нет.
  reset();
  const blind = heart(ON, { now: () => NOON, db: null });
  assert.deepEqual(await blind.onRoom({ do: "look" }, from(5)), { ok: false, code: "storage", text: "Память сейчас недоступна — загляните чуть позже.", build: BUILD });

  // Поломка внутри — человеку слова, хозяину отчёт; наружу исключение не выходит.
  reset();
  const broken = heart({ ...ON, SELF_REPORTS: true }, { now: () => NOON, random: () => { throw new Error("кубик сломан"); } });
  const crashed = await broken.onRoom({ do: "look" }, from(5));
  assert.deepEqual([crashed.ok, crashed.code], [false, "runtime_error"]);
  assert.ok(toOwner().some(item => /кубик сломан/u.test(item.text)), "хозяин узнаёт о поломке");

  // Сама функция (`tgcloud/endpoints/room.js`) — тонкая обёртка, которая не бросает.
  assert.equal(typeof endpoint, "function");
  assert.deepEqual(await endpoint({ do: "look" }, { testRun: true }), { ok: true, route: "room", do: "look", build: BUILD, side_effects: "none" });
  const source = read("tgcloud/endpoints/room.js");
  assert.match(source, /heart\.onRoom\(/u);
  assert.match(source, /catch/u, "обёртка ловит и то, что не поймало сердце");
});

// ── кнопки: под ответом и в меню ────────────────────────────────────────────

test("адрес страницы: телефон называет его с пробуждением — сердце запоминает, ставит кнопку в меню и говорит о комнате в «статус»", async () => {
  reset();
  let h = heart({ ...ON, SELF_REPORTS: true }, { now: () => NOON, random: () => 0 });
  // Пока адреса нет: комната словами, кнопки нет.
  await h.onMessage(message("статус", { id: OWNER }), KEY);
  assert.match(last(OWNER), /Комната: словами \(«зайду к тебе»\); мини-приложение не опубликовано — телефон не назвал адрес страницы/u);
  await h.onMessage(message("зайду к тебе"), KEY);
  assert.equal(toChat(5).at(-2).reply_markup, undefined, "без адреса — без кнопки");
  // «Открой комнату», а открыть нечем — она говорит об этом и рассказывает словами.
  await h.onMessage(message("открой комнату"), KEY);
  assert.ok(pool("дверь:нет").some(line => last().startsWith(line)), last());
  assert.ok(pool("зайти").some(line => last().split("\n")[1] === line), last());

  // Странный адрес не принимается: кнопка ведёт только на https. Сборка при этом объявляется как обычно.
  for (const bad of ["http://app123.tgcloud.ai/", "javascript:alert(1)", "https://x.example/?a=1", 'https://x.example/" }', `https://x.example/${"a".repeat(220)}`, "", 5, null]) {
    const tick = await h.tick({ tick: true, deployed: true, page: bad }, KEY);
    assert.equal(tick.ok, true, String(bad));
    assert.equal(tick.page, typeof bad === "string" && bad ? false : undefined, String(bad));
  }
  // Обычный удар адреса не приносит: его называет только публикация.
  assert.equal((await h.tick({ tick: true, page: PAGE }, KEY)).page, undefined);
  assert.equal(pageOf(), null);
  assert.deepEqual(calls("setChatMenuButton"), []);
  assert.ok(toOwner().some(item => /я обновилась/u.test(item.text) && /Комната: словами \(«зайду к тебе»\); мини-приложение не опубликовано/u.test(item.text)), "страницы нет — в «я обновилась» так и сказано");

  // Телефон опубликовал страницу и назвал адрес — вместе с первым пробуждением новой сборки.
  reset();
  h = heart({ ...ON, SELF_REPORTS: true }, { now: () => NOON, random: () => 0 });
  const tick = await h.tick({ tick: true, deployed: true, page: PAGE }, KEY);
  assert.deepEqual([tick.ok, tick.page], [true, true]);
  assert.deepEqual(pageOf(), { url: PAGE, build: BUILD, at: NOON, menu: "on" });
  assert.deepEqual(calls("setChatMenuButton"), [{ menu_button: { type: "web_app", text: "Комната", web_app: { url: PAGE } } }]);
  assert.ok(toOwner().some(item => /я обновилась/u.test(item.text) && /Комната: мини-приложение открыто — кнопка под ответом на «зайду к тебе» и в меню/u.test(item.text)), "в «я обновилась» видно, открылось ли мини-приложение");
  await h.onMessage(message("статус", { id: OWNER }), KEY);
  assert.match(last(OWNER), /Комната: мини-приложение открыто — кнопка под ответом на «зайду к тебе» и в меню/u);
  // Обычный удар адреса не несёт — запись остаётся; тот же адрес ещё раз меню не трогает.
  assert.equal((await h.tick({ tick: true }, KEY)).page, undefined);
  await h.tick({ tick: true, deployed: true, page: PAGE }, KEY);
  assert.equal(calls("setChatMenuButton").length, 1);
  assert.equal(pageOf().url, PAGE);
});

test("кнопка «Открыть комнату»: под ответом в личке; в группе — словами; «открой комнату» — зайти и получить кнопку", async () => {
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  await h.tick({ tick: true, deployed: true, page: PAGE }, KEY);
  const door = { inline_keyboard: [[{ text: "🚪 Открыть комнату", web_app: { url: PAGE } }]] };

  await h.onMessage(message("зайду к тебе"), KEY);
  const [answer, offer] = toChat(5);
  assert.deepEqual(answer.reply_markup, door);
  assert.ok(pool("зайти").includes(answer.text.split("\n")[0]));
  assert.ok(offer.reply_markup.inline_keyboard[0].every(button => /^h:[a-z]+:[01]$/u.test(button.callback_data)), "сценка дня — следом, со своими кнопками");
  // «Открой комнату», «покажи комнату», «открой мини-приложение» — то же самое: зайти и кнопка. Модель не нужна.
  for (const said of ["открой комнату", "покажи комнату", "открой мини-приложение", "где кнопка комнаты", "хочу в комнату", "покажи, где ты живёшь"]) {
    await h.onMessage(message(said), KEY);
    assert.deepEqual(toChat(5).at(-1).reply_markup, door, said);
    assert.ok(pool("зайти").includes(last().split("\n")[0]), `${said}: ${last()}`);
  }
  assert.equal(chats().length, 0);
  // Спросить о Байте или позаботиться — без кнопки: это не вход.
  await h.onMessage(message("как там Байт"), KEY);
  assert.equal(toChat(5).at(-1).reply_markup, undefined);

  // В группе Telegram таких кнопок не даёт: там — словами, с пояснением на «открой комнату».
  await h.onMessage(group("Аи, зайду к тебе", { id: 6 }), KEY);
  assert.equal(toChat(-10).at(-1).reply_markup, undefined);
  await h.onMessage(group("Аи, открой комнату", { id: 6 }), KEY);
  assert.equal(toChat(-10).at(-1).reply_markup, undefined);
  assert.ok(pool("дверь:личка").some(line => toChat(-10).at(-1).text.startsWith(line)), toChat(-10).at(-1).text);

  // Мини-приложение выключено настройкой — кнопки нет, комната словами, как в 0.37.0.
  reset();
  const off = heart({ ...ON, ROOM_APP: false }, { now: () => NOON, random: () => 0 });
  await off.tick({ tick: true, deployed: true, page: PAGE }, KEY);
  assert.deepEqual(calls("setChatMenuButton"), []);
  await off.onMessage(message("зайду к тебе"), KEY);
  assert.equal(toChat(5)[0].reply_markup, undefined);
  await off.onMessage(own("статус"), KEY);
  assert.match(last(OWNER), /Комната: словами; мини-приложение выключено настройкой/u);
});

test("кнопку не принял Telegram — ответ уходит без неё, хозяин узнаёт, а кнопка отдыхает до следующей проверки адреса", async () => {
  reset();
  const time = clock();
  const h = heart({ ...ON, SELF_REPORTS: true }, { now: time.now, random: () => 0 });
  await h.tick({ tick: true, deployed: true, page: PAGE }, KEY);
  const told = toOwner().length;
  // Telegram отказывает в сообщении с кнопкой мини-приложения (например, не принял адрес страницы).
  let tries = 0;
  sdk().duringSend = (params) => { if (params.reply_markup?.inline_keyboard?.[0]?.[0]?.web_app) { tries += 1; throw Object.assign(new Error("Bad Request: BUTTON_TYPE_INVALID"), { code: 400 }); } };
  await h.onMessage(message("зайду к тебе"), KEY);
  const sent = toChat(5);
  assert.equal(tries, 1);
  assert.ok(pool("зайти").includes(sent[0].text.split("\n")[0]), "ответ важнее кнопки: он пришёл");
  assert.equal(sent[0].reply_markup, undefined);
  assert.equal(sent.length, 2, "и сценка дня — тоже");
  const news = toOwner().slice(told).map(item => item.text).join("\n");
  assert.match(news, /Telegram не принял кнопку мини-приложения под сообщением — комната пока отвечает словами/u);
  assert.doesNotMatch(news, /сообщение не ушло в чат/u, "причина названа точно, а не «не ушло»");
  // Следующий заход — уже без попытки с кнопкой: каждое сообщение дважды не отправляется.
  await h.onMessage(message("загляну к тебе"), KEY);
  assert.equal(tries, 1, "кнопка отдыхает");
  assert.equal(toChat(5).at(-1).reply_markup, undefined);
  assert.ok(pool("зайти").includes(last().split("\n")[0]), last());
  // Через минуту адрес перечитывается — и кнопка пробуется снова: отказ мог быть минутным.
  delete sdk().duringSend;
  time.add(61_000);
  await h.onMessage(message("я у тебя"), KEY);
  assert.equal(toChat(5).at(-1).reply_markup?.inline_keyboard?.[0]?.[0]?.web_app?.url, PAGE);
});

test("кнопка в меню: убрать и вернуть — слово хозяина; новая сборка убранную не возвращает", async () => {
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  // Страницы ещё нет — ставить нечего.
  await h.onMessage(own("убери комнату из меню"), KEY);
  assert.match(last(OWNER), /Мини-приложения пока нет: телефон ещё не опубликовал страницу комнаты/u);
  await h.tick({ tick: true, deployed: true, page: PAGE }, KEY);
  assert.equal(calls("setChatMenuButton").length, 1);

  // Гостю — нельзя: меню бота общее.
  await h.onMessage(message("убери комнату из меню"), KEY);
  assert.equal(last(), "Что стоит в меню, решает хозяин.");
  assert.equal(calls("setChatMenuButton").length, 1);

  await h.onMessage(own("убери комнату из меню"), KEY);
  assert.match(last(OWNER), /^Убрала: в меню снова обычная кнопка\./u);
  assert.deepEqual(calls("setChatMenuButton").at(-1), { menu_button: { type: "default" } });
  assert.equal(pageOf().menu, "off");
  await h.onMessage(own("статус"), KEY);
  assert.match(last(OWNER), /Комната: мини-приложение открыто — кнопка под ответом на «зайду к тебе»; из меню убрана/u);
  // Кнопка под ответом остаётся.
  await h.onMessage(own("зайду к тебе"), KEY);
  assert.ok(toChat(OWNER).some(item => item.reply_markup?.inline_keyboard?.[0]?.[0]?.web_app?.url === PAGE));
  // Новая сборка (и новый адрес) меню не трогает: хозяин его убрал.
  await h.tick({ tick: true, deployed: true, page: "https://app123.tgcloud.ai/v2/" }, KEY);
  assert.equal(calls("setChatMenuButton").length, 2);
  assert.deepEqual([pageOf().url, pageOf().menu], ["https://app123.tgcloud.ai/v2/", "off"]);

  await h.onMessage(own("верни комнату в меню"), KEY);
  assert.match(last(OWNER), /^Вернула: кнопка «Комната» снова в меню/u);
  assert.deepEqual(calls("setChatMenuButton").at(-1), { menu_button: { type: "web_app", text: "Комната", web_app: { url: "https://app123.tgcloud.ai/v2/" } } });
  assert.equal(pageOf().menu, "on");
  assert.deepEqual(chats().filter(call => !/\\"content\\":\\"ping\\"/u.test(JSON.stringify(call))), [], "слова о меню до модели не доходят («статус» сам проверяет провайдера — это не в счёт)");

  // Telegram не принял смену кнопки — сказано честно, запись не тронута.
  sdk().failing.setChatMenuButton = new Error("Bad Request");
  await h.onMessage(own("убери комнату из меню"), KEY);
  assert.match(last(OWNER), /^Не вышло: Telegram не принял смену кнопки меню/u);
  assert.equal(pageOf().menu, "on");

  // Кнопка в меню выключена настройкой — адрес запоминается, меню не трогается.
  reset();
  const plain = heart({ ...ON, ROOM_MENU: false }, { now: () => NOON, random: () => 0 });
  assert.equal((await plain.tick({ tick: true, deployed: true, page: PAGE }, KEY)).page, true);
  assert.deepEqual(calls("setChatMenuButton"), []);
  await plain.onMessage(message("зайду к тебе"), KEY);
  assert.ok(toChat(5)[0].reply_markup?.inline_keyboard?.[0]?.[0]?.web_app, "кнопка под ответом — есть");
});

// ── файлы страницы и публикация ─────────────────────────────────────────────

test("страница: папка уходит на платформу как есть — настройки проекта читаются, файлы на месте, лишнего и тяжёлого нет", () => {
  // tgcloud.jsonc: инструмент читает его при каждой отправке — и кода тоже. Ошибка в нём сорвала бы публикацию бота.
  const raw = read("tgcloud.jsonc");
  const config = JSON.parse(raw.split("\n").filter(line => !/^\s*\/\//u.test(line)).join("\n"));
  assert.deepEqual(config, { static: { source: "miniapp" } }, "только то, что нужно: незнакомый платформе ключ сорвал бы отправку страницы");
  assert.ok(!existsSync(new URL("tgcloud.json", ROOT)), "двух файлов настроек инструмент не терпит");
  // Папка: не из тех имён, что не сохраняются и не попадают в коммит.
  assert.ok(!["dist", "build", "out"].includes(config.static.source));
  assert.doesNotMatch(read(".gitignore"), /^\/?miniapp\/?$/mu);
  const folder = new URL("miniapp/", ROOT);
  const files = readdirSync(folder).sort();
  assert.deepEqual(files, ["app.js", "index.html", "logic.js", "scene.js"], "в папке — только страница: всё, что в ней лежит, становится публичным");
  const total = files.reduce((sum, name) => sum + statSync(new URL(name, folder)).size, 0);
  assert.ok(total < 220_000, `страница весит ${total} байт — открываться должна сразу`);

  const html = read("miniapp/index.html");
  assert.match(html, /<script src="https:\/\/telegram\.org\/js\/telegram-web-app\.js"><\/script>/u, "без этого скрипта Telegram не даёт странице ни человека, ни связи");
  assert.match(html, /<script type="module" src="\.\/app\.js"><\/script>/u);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1/u);
  assert.match(html, /<svg id="room" viewBox="0 0 400 520"/u);
  assert.equal(`${WIDTH} ${HEIGHT}`, "400 520");
  // Три картинки одна над другой: небо с городом, дождь, комната со слоем нажатий. Дождь лежит ровно по стеклу —
  // числа в стилях те же, что `WIN` в рисунке, — и сдвигается на один шаг пунктира (`RAIN_SHIFT`): иначе он шёл бы
  // рывками или вылезал на стену.
  assert.match(html, /<svg id="sky" viewBox="0 0 400 520"[^>]*><g id="backdrop"><\/g><\/svg>/u);
  const pct = (value) => String(Number(value.toFixed(4)));
  assert.ok(html.includes(`.rainbox { position: absolute; left: ${pct(WIN.x / WIDTH * 100)}%; top: ${pct(WIN.y / HEIGHT * 100)}%; width: ${pct(WIN.w / WIDTH * 100)}%; height: ${pct(WIN.h / HEIGHT * 100)}%; overflow: hidden; pointer-events: none; }`), "дождь — по стеклу");
  for (const plane of ["far", "near"]) {
    const { x, y, seconds } = RAIN_SHIFT[plane];
    assert.match(html, new RegExp(`<svg class="plane ${plane}" id="rain${plane === "far" ? "Far" : "Near"}" viewBox="0 0 ${WIN.w} ${WIN.h}"`, "u"), plane);
    assert.ok(html.includes(`.rainbox .${plane} { animation: rain-${plane} ${seconds}s linear infinite; }`), plane);
    assert.ok(html.includes(`@keyframes rain-${plane} { to { transform: translate(${pct(x)}%, ${pct(y)}%); } }`), plane);
  }
  for (const id of ["app", "stage", "sky", "rainFar", "rainNear", "room", "backdrop", "inside", "talk", "who", "say", "retry", "scene", "sceneText", "sceneChoice", "scenePicked", "actions", "hint", "foot"]) assert.match(html, new RegExp(` id="${id}"`, "u"), id);
  // Пять кнопок заботы — теми же словами, что знает сердце.
  assert.deepEqual([...html.matchAll(/<button type="button" data-act="([a-z]+)"/gu)].map(found => found[1]), [...logic.CARE]);
  assert.deepEqual([...html.matchAll(/data-pick="([01])"/gu)].map(found => found[1]), ["0", "1"]);
  // Спрятанное спрятано, какой бы display ни задал стиль: иначе сыгранная сценка оставалась бы с кнопками.
  assert.match(html, /\[hidden\] \{ display: none !important; \}/u);
  // Движение отключается у тех, кто просил его не показывать.
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)/u);
  // Движение живёт в двух местах: рисунок вешает класс, стили страницы его двигают. Переименуй одно без другого —
  // и хвост замрёт, а тесты промолчат. Поэтому: у каждого класса из рисунка, кроме неподвижных, есть правило,
  // и каждое правило для рисунка относится к классу, который рисунок в самом деле ставит.
  const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
  const styled = new Set([...css.matchAll(/(?:#room|#sky)((?: ?\.[a-z][a-z0-9]*)+)/gu)].flatMap(found => found[1].match(/[a-z][a-z0-9]*/gu)));
  const classes = new Set();
  let turn = 0;
  const cats = ["шалит", "сыт", "обижен", "игра"];
  const collect = (view) => { for (const found of drawRoom(view).matchAll(/class="([^"]+)"/gu)) for (const name of found[1].split(" ")) classes.add(name); };
  for (const part of PARTS) for (const pose of HER_POSES) {
    turn += 1;
    collect({ part, her: { pose, key: "уют" }, cat: { shape: CAT_SHAPES[turn % CAT_SHAPES.length], place: CAT_PLACES[turn % CAT_PLACES.length], key: cats[turn % cats.length] }, things: [...THINGS], tea: true, fed: true });
  }
  for (const [shape, place] of [["claw", "chair"], ["play", "rug"], ["eat", "bowl"], ["curl", "pillow"], ["walk", "near"]]) collect({ part: "вечер", her: { pose: "desk", key: "дело" }, cat: { shape, place, key: "шалит" }, things: [] });
  const still = new Set(["art", "zones", "backdrop", "frame", "glow", "city", "rain", "far", "near", "b0", "s0", ...CAT_SHAPES]);
  assert.deepEqual([...classes].filter(name => !styled.has(name) && !still.has(name)).sort(), [], "класс в рисунке есть, а правила в стилях нет");
  assert.deepEqual([...styled].filter(name => !classes.has(name)).sort(), [], "правило в стилях есть, а рисунок такого класса не ставит");
  for (const name of ["breath", "blink", "slide", "bulb", "tailwag", "steam", "zzz"]) assert.ok(classes.has(name) && styled.has(name), name);
  // Класс движения не стоит на части с собственным сдвигом: стиль заменил бы сдвиг, и часть уехала бы в угол.
  const moving = [...styled].filter(name => name !== "tap" && name !== "cat");
  for (const view of [{ part: "вечер", her: { pose: "dance", key: "игра" }, cat: { shape: "play", place: "rug", key: "игра" }, things: [...THINGS], tea: true }, { part: "ночь", her: { pose: "nap", key: "сон" }, cat: { shape: "claw", place: "chair", key: "шалит" }, things: [] }]) {
    for (const tag of drawRoom(view).matchAll(/<[a-z]+ ((?:"[^"]*"|[^<>"])*)>/gu)) {
      const names = /class="([^"]+)"/u.exec(tag[1])?.[1].split(" ") ?? [];
      if (names.some(name => moving.includes(name))) assert.doesNotMatch(tag[1], /(?:^| )transform="/u, names.join("."));
    }
  }
  // Чужих скриптов, стилей и картинок нет: кроме скрипта Telegram страница ничего не тянет со стороны.
  const outside = [...html.matchAll(/(?:src|href)="(https?:[^"]+)"/gu)].map(found => found[1]);
  assert.deepEqual(outside, ["https://telegram.org/js/telegram-web-app.js"]);

  const app = read("miniapp/app.js");
  assert.deepEqual([...app.matchAll(/^import .+ from "([^"]+)";$/gmu)].map(found => found[1]), ["./scene.js", "./logic.js"]);
  assert.match(app, /Serverless\.call\("room", /u, "страница зовёт функцию комнаты по имени файла в tgcloud/endpoints");
  assert.ok(existsSync(new URL("tgcloud/endpoints/room.js", ROOT)));
  // Настройки витрины из адреса — только на своей машине: иначе ссылкой можно вложить ей в уста чужие слова.
  assert.match(app, /const params = local \? /u);
  assert.match(app, /localhost\|127/u);
  // Текст на страницу попадает текстом, а не разметкой: рисунок — единственное, что вставляется как разметка.
  const markupWrites = [...app.matchAll(/\.innerHTML = ([^;]+);/gu)].map(found => found[1].trim());
  assert.deepEqual(markupWrites.filter(value => !/^draw(?:Backdrop|Rain|Inside)\(/u.test(value) && !value.startsWith("'<svg ")), []);
  for (const name of ["scene.js", "logic.js"]) {
    const source = read(`miniapp/${name}`);
    const code = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
    assert.doesNotMatch(code, /\b(?:document|window|fetch|localStorage|Telegram|navigator|location)\s*[.(]/u, `${name} — чистые функции: ни страницы, ни сети`);
    assert.deepEqual([...source.matchAll(/^import .+ from "([^"]+)";$/gmu)].map(found => found[1]), name === "logic.js" ? ["./scene.js"] : []);
  }
  // Ключей в странице нет и быть не может: она публична.
  for (const name of files) assert.doesNotMatch(read(`miniapp/${name}`), /secrets\.js|AI_PROVIDER_KEY|TGCLOUD_|gsk_|bot\d{6,}:/u, name);
  // Страница проверяется вместе с кодом: разбор и eslint смотрят и в её папку.
  assert.match(read("scripts/check-syntax.mjs"), /"miniapp"/u);
  assert.match(read("scripts/verify.sh"), /files: \["miniapp\/\*\*\/\*\.js"\]/u);
});

test("запасная кнопка публикации делает то же, что телефон: репетиция функции, код с ней, страница отдельно, адрес — сердцу", () => {
  const workflow = read(".github/workflows/heart.yml");
  const deploy = workflow.slice(workflow.indexOf("\n  deploy:"), workflow.indexOf("\n  alarm:"));
  const order = ["Rehearse in the cloud before publishing", "Rehearse the room endpoint", "name: Publish\n", "push handlers lib schema endpoints", "Apply database schema", "Publish the room page", "push miniapp", "Wake the heart on the new build"];
  let at = -1;
  for (const mark of order) { const next = deploy.indexOf(mark, at + 1); assert.ok(next > at, `порядок шагов: «${mark}»`); at = next; }
  assert.match(deploy, /run endpoints\/room '\{ do: "look" \}' --ctx '\{ testRun: true \}'/u);
  // Комната — надстройка: её шаги не останавливают публикацию бота.
  assert.match(deploy, /push handlers lib schema endpoints; then[\s\S]+?\n {10}npx --yes @tgcloud\/cli@0\.2\.0 push handlers lib schema\n/u, "не приняла платформа код с функцией — бот уходит без неё");
  assert.match(deploy, /if: \$\{\{ steps\.publish\.outputs\.room == '1' \}\}/u, "страница уходит, только если ушла функция");
  assert.match(deploy, /--ctx "\{ tick: true, deployed: true, page: \\"\$PAGE_URL\\" \}"/u);
  assert.match(deploy, /--ctx '\{ tick: true, deployed: true \}'/u, "нет адреса — пробуждение прежнее");
  // Адрес берётся из ответа платформы и проверяется: в строку настроек попадают только безопасные знаки.
  assert.match(deploy, /\.tgcloud\/static\.json/u);
  assert.match(deploy, /\^https:\\\/\\\/\[A-Za-z0-9\._~:\\\/-\]\+\$/u);
  // И проверка без отправки репетирует функцию комнаты.
  const smoke = workflow.slice(workflow.indexOf("\n  smoke:"), workflow.indexOf("\n  deploy:"));
  assert.match(smoke, /run endpoints\/room '\{ do: "look" \}' --ctx '\{ testRun: true \}'/u);
  // Телефон: те же слова.
  const phone = read("scripts/phone.sh");
  assert.match(phone, /tg run endpoints\/room '\{ do: "look" \}' --ctx '\{ testRun: true \}'/u);
  assert.match(phone, /tg push miniapp/u);
  assert.match(phone, /ctx="\{ tick: true, deployed: true, page: \\"\$PAGE_URL\\" \}"/u);
});
