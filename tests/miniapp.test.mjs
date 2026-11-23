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
import { slim as slimCode } from "../scripts/slim.mjs";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { heart, message, group, reset, last, chats, sdk, toChat, toOwner, calls, source, says, OWNER, KEY, DAY, BUILD } from "./fixtures/kit.mjs";

const scene = await import("../miniapp/scene.js");
const logic = await import("../miniapp/logic.js");
const room = await import("../tgcloud/lib/room.js");
const { default: endpoint } = await import("../tgcloud/endpoints/room.js");
const { createPhrasebook, SECTIONS } = await import("../tgcloud/lib/phrasebook.js");
const { FIRST_KEY } = await import("../tgcloud/lib/personal.js");
const { hijriOf } = await import("../tgcloud/lib/feasts.js");

const { drawRoom, drawBackdrop, drawRain, drawInside, WIDTH, HEIGHT, WIN, RAIN_SHIFT, SNOW_SHIFT, PARTS, HER_POSES, CAT_SHAPES, CAT_PLACES, THINGS, MOODS, tint, HER_SPRITES, HER_WEARS, spriteOf, spritesOf, drawSprite, spriteStand } = scene;
/** Её картинки — те самые модули, что грузит страница (папка `miniapp/her/`, с 0.40.0). */
const SPRITES = Object.fromEntries(await Promise.all(Object.keys(HER_SPRITES).map(async (name) => [name, (await import(`../miniapp/her/${name}.js`)).default])));
const PAINTED = { sprites: SPRITES };
/** Вторые кадры поз (0.45.0): не позы — в `HER_SPRITES` их нет, а в папке картинок они лежат рядом. */
const FRAMES = Object.values(scene.HER_FRAMES).map(([name]) => name);
const FRAME_SPRITES = Object.fromEntries(await Promise.all(FRAMES.map(async (name) => [name, (await import(`../miniapp/her/${name}.js`)).default])));
/** Третьи кадры (0.53.0): голова повёрнута — тоже не позы, лежат рядом (`HER_TURNS`; подробно — `tests/painted.test.mjs`). */
const TURN_SPRITES = Object.fromEntries(await Promise.all(Object.values(scene.HER_TURNS).map(async ([name]) => [name, (await import(`../miniapp/her/${name}.js`)).default])));
const ROOT = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const ON = { PHRASES: true };
// 18.11.2026, 14:00 по Москве: день, она не спит, Байт не спит.
const NOON = Date.parse("2026-11-18T11:00:00Z");
const PAGE = "https://app123.tgcloud.ai/";
const book = createPhrasebook({ random: () => 0 });
const pool = (name, ctx = {}) => book.pool(`+комната:${name}`, { formal: true, vars: { "цвет": "синий", "рисунок": "кот в шляпе", "что нарисовать": "кота в шляпе" }, ...ctx });
/** Запас слов об окне — по небу (0.44.0): за её окном погода города человека, а не вечный дождь. */
const WINDOW = Object.freeze({ clear: "окно:ясно", clouds: "окно:облачно", overcast: "окно:пасмурно", fog: "окно:туман", rain: "окно", storm: "окно:гроза", snow: "окно:снег" });
/**
 * Строки запаса, годные сейчас: пометки словаря по небу — «[дождь] …» звучит под дождём и в грозу, «[снег] …» — в
 * снег, «[без осадков] …» — в сухую погоду. `pool` отдаёт запас целиком, как он записан; `fitting` — как его слышно.
 */
const fitting = (name, ctx = {}) => book.all(`+комната:${name}`, { formal: true, isPrivate: true, vars: { "цвет": "синий", "рисунок": "кот в шляпе", "что нарисовать": "кота в шляпе" }, ...ctx });
/** Небо, которое она выдумывает сама, когда города человека не знает: одно на шесть часов, у каждого своё. */
/** Классы, которые приносит небо (0.44.0): что движется — облака, звёзды, молния, туман; и что стоит — солнце, луна. */
const SKY_CLASSES = Object.freeze(["drift", "flash", "mote", "o0", "o1", "o2", "snow", "star", "t0", "t1", "t2"]);
/** Первый из трёх ритмов (облака тумана, пылинки, звёзды) — без своего правила: у него ритм самого класса. */
const SKY_STILL = Object.freeze(["m0", "o0", "t0"]);
const madeUpSky = (id, at, month = 11) => room.randomSky({ seed: room.seedOf(id, "sky"), at, month });
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
  // Час виден: вечером и ночью горит лампа. Неба не назвали (так отвечало сердце до 0.44.0) — за окном дождь, как прежде.
  for (const part of PARTS) {
    const markup = drawRoom({ ...bare, part });
    assert.equal(markup.includes('class="glow"'), part === "вечер" || part === "ночь", part);
    assert.match(markup, /class="rain /u, `${part}: неба не назвали — дождь`);
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
  // Слой едет вниз и влево на один шаг и начинает сначала. Струи должны закрывать стекло и в начале оборота, и в
  // конце: начинаться выше окна хотя бы на шаг, кончаться ниже него, а крайние — уходить за углы. Иначе к концу
  // оборота верх окна оголится, и дождь «заморгает».
  for (const plane of ["far", "near"]) {
    const fall = RAIN_SHIFT[plane].y / 100 * WIN.h, drift = -RAIN_SHIFT[plane].x / 100 * WIN.w;
    assert.ok(fall > 20 && drift > 0 && RAIN_SHIFT[plane].seconds > 0.3, plane);
    const lines = [...drawRain("день", plane).matchAll(/<path d="M(-?[\d.]+) (-?[\d.]+) L(-?[\d.]+) (-?[\d.]+)" stroke-dasharray="([\d.]+) ([\d.]+)"/gu)].map(found => found.slice(1).map(Number));
    assert.ok(lines.length >= 12, plane);
    const cross = ([x1, y1, x2, y2], y) => x1 + (x2 - x1) * (y - y1) / (y2 - y1);
    const gap = Math.abs(lines[1][0] - lines[0][0]);
    for (const [x1, y1, x2, y2, dash, rest] of lines) {
      assert.ok(y1 <= -fall && y2 >= WIN.h, `${plane}: струя от ${y1} до ${y2} не закрывает стекло на всём обороте`);
      assert.ok(x2 < x1, `${plane}: струи наклонены влево`);
      // Пунктир повторяется ровно через шаг: сдвинутый на шаг слой неотличим от исходного.
      assert.ok(Math.abs((dash + rest) - Math.hypot(fall, drift)) < 0.06, `${plane}: шаг пунктира ${dash + rest}, а слой сдвигается на ${Math.hypot(fall, drift)}`);
    }
    assert.ok(Math.min(...lines.map(line => cross(line, WIN.h))) <= gap, `${plane}: левый нижний угол без струй`);
    assert.ok(Math.max(...lines.map(line => cross(line, 0))) >= WIN.w + drift - gap, `${plane}: правый верхний угол без струй к концу оборота`);
  }

  const zones = zonesOf(markup);
  assert.equal((markup.match(/data-act="/gu) ?? []).length, zones.length, "каждое место нажатия — прямоугольник в слое нажатий");
  assert.deepEqual(zones[0], { act: "window", label: "Окно", id: "", x: 124, y: 44, w: 264, h: 218 });
  assert.deepEqual(zones.slice(-4).map(zone => [zone.act, zone.id, zone.label]), [["water", "plant", "Колючка"], ["tea", "kettle", "Чайник"], ["feed", "bowl", "Миска Байта"], ["play", "toy", "Клубок"]], "забота — поверх всех");
  // Слова нажатий — те же, что знает страница и сердце: «pet» — погладить.
  assert.deepEqual([...new Set(zones.map(zone => zone.act.replace(/:.*/u, ":")))].sort(), ["book", "box", "call", "feed", "her", "lamp", "music", "pet", "play", "tea", "thing:", "water", "window"]);
  // Ковёр (0.47.0) — позвать Байта: место целиком на ковре и выше полосы с её словами; она, Байт и клубок — поверх.
  const rug = zones.find(zone => zone.act === "call");
  assert.deepEqual([rug.id, rug.label, zones.indexOf(rug)], ["rug", "Ковёр: позвать Байта", 1]);
  assert.ok(rug.x >= 47 && rug.x + rug.w <= 353 && rug.y >= 408 && rug.y + rug.h <= 480 && rug.w >= 120 && rug.h >= 40, JSON.stringify(rug));
  for (const [x, y] of [[rug.x, rug.y], [rug.x + rug.w, rug.y], [rug.x, rug.y + rug.h], [rug.x + rug.w, rug.y + rug.h]]) assert.ok(((x - 200) / 153) ** 2 + ((y - 451) / 44) ** 2 <= 1, `угол ${x},${y} — за краем ковра`);
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
    const covered = pose === "lie" || pose === "nap" || pose === "chair" || pose === "read";
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
    assert.deepEqual(zonesOf(markup).map(zone => zone.act), ["window", "call", "lamp", "book", "music", "lamp", "box", "water", "tea", "feed", "play"]);
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
  // 0.48.0: у эпизодов её дня свои запасы — и свои позы: кормит Байта, смахивает пыль, раскладывает книги.
  for (const stage of Object.values(room.EPISODES)) for (const owner of [true, false]) for (const line of pool(stage.pool, { owner, level: owner ? "close" : "known" })) {
    const pose = room.herPose(line, stage.key);
    assert.ok(HER_POSES.includes(pose), line);
    seenPoses.add(pose);
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

test("словарь 0.39.0: о новом рисунке она отвечает сама; о чём говорит у окна — то и нарисовано; прежние темы не задеты", () => {
  // Что на рисунке видно — о том можно спросить, и ответ не уходит модели.
  const hit = {
    "ты сделала ремонт?": "в комнате ремонт", "почему комната другая": "в комнате ремонт", "комната стала красивее": "ремонт удался", "новая комната супер": "ремонт удался",
    "комната не очень": "комната не нравится", "верни старую комнату": "комната не нравится", "кто нарисовал комнату?": "кто нарисовал комнату", "помнишь старую комнату?": "где старая комната",
    "ты там красивая": "ты красивая в комнате", "ты в комнате другая": "ты изменилась в комнате", "почему у тебя красные глаза?": "глаза на рисунке", "у тебя красивые глаза": "красивые глаза",
    "у тебя длинные волосы": "волосы на рисунке", "красивые волосы": "красивые волосы", "что у тебя на шее?": "чокер", "ты подросла": "ты подросла", "красивая куртка": "наряд в комнате",
    "ты моргаешь": "ты моргаешь", "Байт полосатый": "байт полосатый", "почему Байт машет хвостом?": "хвост байта", "какие у Байта глаза?": "глаза байта", "почему Байт под креслом?": "байт под креслом",
    "красивые шторы": "шторы", "что за башня за окном?": "вид из окна", "что за вывеска?": "вывеска за окном", "что мигает на башне?": "огонек на башне", "красивый ковёр": "ковер",
    "что за коробка?": "коробка байта", "что играет в комнате?": "колонка", "почему гирлянда мигает?": "красивая гирлянда", "красивая лампа": "лампа на столе", "обои в полоску": "обои",
    "красивый чайник": "чайник на столе", "что за робот на полке?": "робот на полке", "что за созвездие на карте?": "карта звезд", "у тебя большое окно": "окно во всю стену",
    "удобное кресло": "кресло", "зачем табуретка?": "табуретка",
  };
  for (const [said, name] of Object.entries(hit)) assert.deepEqual(book.match(said), [name], said);
  // Прежние темы остались при своих словах: новое их не отняло.
  const kept = {
    "во что ты одета": "что на тебе", "ты изменилась": "что с тобой", "какой у тебя вид из окна": "за окном", "что у тебя играет": "что слушаешь", "байт красивый": "байт хороший",
    "как ты выглядишь": "как ты выглядишь", "почему ты там маленькая": "ты чиби", "красивая комната": "красивая комната", "что у тебя на стене": "на стене", "включи гирлянду": "гирлянда",
  };
  for (const [said, name] of Object.entries(kept)) assert.deepEqual(book.match(said), [name], said);
  // Чужое остаётся чужим: «красивые глаза у твоей сестры» и вопрос по делу — не к этим темам.
  for (const said of ["красивые глаза у твоей сестры", "какие шторы купить в спальню", "что за вывеска на фото"]) assert.equal(book.match(said), null, said);

  // О чём она говорит, когда нажимают на окно, — то и нарисовано в этот час.
  const marks = [
    [/вывеск/u, (part) => /class="neon"/u.test(drawBackdrop(part)), "вывеска светится"],
    [/огон[её]к/u, (part) => /class="beacon"/u.test(drawBackdrop(part)), "огонёк на башне горит"],
    [/гирлянда уже горит|лампа и гирлянда|светится одна гирлянда|[Гг]орит только лампа/u, (part) => /class="glow"/u.test(drawInside({ part })), "свет в комнате зажжён"],
    [/[Лл]ампа выключена|в комнате светло/u, (part) => !/class="glow"/u.test(drawInside({ part })), "свет в комнате не горит"],
  ];
  const window = SECTIONS.find(item => item.n === "+комната:окно");
  assert.ok(window, "запас «+комната:окно» на месте");
  const seen = new Set();
  for (const [tags, line] of window.l) {
    // 0.47.0: свет за окном идёт по солнцу и может разойтись с часами — у таких строк пометка света, а не часа:
    // «затемно» и «стемнело» — за окном ночь, «светло» — день. Сверяются они с рисунком в этом свете.
    const LIT = { "затемно": "ночь", "стемнело": "ночь", "светло": "день" };
    const marked = String(tags).split(",");
    const part = PARTS.find(name => marked.includes(name)) ?? LIT[Object.keys(LIT).find(name => marked.includes(name))];
    assert.ok(part, `строка об окне без часа: ${line}`);
    for (const [word, drawn, what] of marks) {
      if (!word.test(line)) continue;
      seen.add(what);
      assert.ok(drawn(part), `«${line}» (${part}) — а на рисунке не так: ${what}`);
    }
  }
  assert.deepEqual([...seen].sort(), marks.map(([, , what]) => what).sort(), "каждая примета встречается в её словах об окне");
  // Вывеска и огонёк — приметы вечера и ночи: днём их в словах нет, и на рисунке они не горят.
  for (const part of ["утро", "день"]) {
    assert.doesNotMatch(drawBackdrop(part), /class="(?:neon|beacon)"/u, part);
    for (const [tags, line] of window.l) if (String(tags).split(",").includes(part)) assert.doesNotMatch(line, /вывеск|огон[её]к/u, line);
  }
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

test("словарь 0.40.0: о картинке она отвечает сама; её слова в комнате — о том, что на картинке видно; прежние темы не задеты", () => {
  // Что на картинке видно — о том можно спросить, и ответ не уходит модели.
  const hit = {
    "ты как на портрете": "ты как на портрете", "тебя перерисовали?": "ты как на портрете", "почему ты стоишь?": "почему ты стоишь", "ты не устала стоять": "почему ты стоишь",
    "ты выше шкафа": "ты высокая", "ты загораживаешь окно": "ты высокая", "что у тебя в руках?": "что у тебя в руках", "что за палочка?": "что у тебя в руках",
    "что у тебя в кружке?": "что в кружке", "почему от кружки пар": "что в кружке", "почему ты в пледе?": "ты в пледе", "ты отвернулась": "ты отвернулась", "почему ты стоишь спиной?": "ты отвернулась",
    "почему ты спишь на полу?": "ты спишь на полу", "почему ты скрестила руки?": "ты покраснела в комнате", "ты там покраснела": "ты покраснела в комнате", "ты зеваешь": "ты зеваешь",
    "ты подмигнула": "ты подмигнула", "красивые ботинки": "ботинки", "почему ты не двигаешься?": "ты моргаешь", "ты не моргаешь": "ты моргаешь", "ты застыла": "ты моргаешь",
  };
  for (const [said, name] of Object.entries(hit)) assert.deepEqual(book.match(said), [name], said);
  // Прежние темы остались при своих словах: новое их не отняло.
  const kept = {
    "ты высокая": "рост и вес", "ты покраснела": "ты стесняешься", "что ты пьешь": "любимый напиток", "ты устала": "ты устала", "ты там красивая": "ты красивая в комнате",
    "во что ты одета": "что на тебе", "как ты выглядишь": "как ты выглядишь", "почему ты там маленькая": "ты чиби", "кто нарисовал комнату?": "кто нарисовал комнату", "ты подросла": "ты подросла",
  };
  for (const [said, name] of Object.entries(kept)) assert.deepEqual(book.match(said), [name], said);
  // Чужое остаётся чужим: вопрос не о ней — не к этим темам.
  for (const said of ["что у тебя в руках на фото", "почему ты стоишь на остановке", "красивые ботинки купил брат", "ты зеваешь на уроке", "что в кружке у начальника"]) assert.equal(book.match(said), null, said);

  // Темы о рисунке не обещают того, чего картинка не делает. С 0.41.0 она моргает (там, где у картинки есть веки) и
  // меняет позы; с 0.44.0 — дышит и ходит (до того слова «дышу» здесь не было и быть не могло); и уже не маленькая.
  const said = (name, ctx = {}) => book.pool(name, { formal: true, ...ctx }).join(" ");
  for (const owner of [false, true]) {
    assert.doesNotMatch(said("ты моргаешь", { owner }), /стою смирно|[Нн]е моргаю|пуф/u);
    assert.match(said("ты моргаешь", { owner }), /[Мм]оргаю/u);
    assert.match(said("ты моргаешь", { owner }), /[Дд]ышу/u);
    assert.match(said("ты моргаешь", { owner }), /[Хх]ожу/u);
    assert.doesNotMatch(said("ты чиби", { owner }), /я маленькая|все маленькие|до размеров кружки/u);
    assert.doesNotMatch(said("кто нарисовал комнату", { owner }), /ни одной картинки/u);
    assert.doesNotMatch(said("ты подросла", { owner }), /не достаю|с чайник/u);
    assert.doesNotMatch(said("наряд в комнате", { owner }), /чулк/u);
  }
  assert.match(said("кто нарисовал комнату"), /картинкой, по моему портрету/u);

  // Её слова в комнате — о том, что видно. С 0.44.0 у каждой реплики своя картинка: место сердце читает из самих
  // слов (`herPose`), картинку по состоянию и месту даёт рисунок (`lookOf`), страница показывает их вместе. До того
  // слова и позы шли двумя списками по кругу и расходились: «разглядываю гирлянду» — а глаза закрыты (владелец
  // увидел это на Байте: «в тексте перевернулся на спину, а по факту нет»). Поэтому здесь: у каждой реплики — при
  // любом небе, хозяину и гостю — есть картинка, и реплика говорит то, что на этой картинке видно.
  const SEEN = {
    work: /блокнот/u, work2: /блокнот.*[Рр]учка — у губ/u, tea: /[Сс] кружкой/u, tea2: /[Пп]ью чай/u, tea3: /[Чч]ай, кресло/u, read: /[Чч]итаю в кресле/u,
    play: /[Дд]ирижирую/u, play2: /[Тт]анцую/u, play3: /ленточкой/u, sleep: /плед/u, tired: /[Зз]ева/u, tired2: /плед.*тру глаз/u,
    pout: /спиной|[Оо]твернулась/u, pout2: /скрестив руки/u, jealous: /[Рр]азглядываю/u, jealous2: /[Сс]крестила руки/u,
    // 0.47.0: в кресле — с блокнотом, под пледом с закрытыми глазами, скрестив руки. Слово «в кресле» обязательно:
    // по нему и выбирается сидящая картинка.
    work3: /[Вв] кресле с блокнотом/u, tired3: /[Вв] кресле.*плед.*[Гг]лаза закрыты/u, jealous3: /[Вв] кресле, скрестив руки/u,
  };
  // И ни одна не говорит того, чего на её картинке нет: «сижу» (где она сидит, сказано словом «кресло»), «лежу»,
  // «читаю».
  const absent = /(?:^|[^а-яё])(?:сижу|лежу|читаю|листаю|переставляю|поправляю|завариваю)(?:[^а-яё]|$)|я в кресле|на подоконнике с|под пледом/iu;
  const drawnFor = new Set();
  for (const key of Object.keys(MOODS)) for (const sky of room.SKIES) for (const owner of [true, false]) {
    const lines = fitting(`она:${key}`, { owner, level: owner ? "close" : "known", sky, part: "день" });
    // При любой погоде ей есть что сказать, а если она не спит — то и чем заняться: реплик несколько.
    assert.ok(lines.length >= (key === "сон" ? 1 : 3), `${key}, ${sky}: реплик ${lines.length}`);
    for (const line of lines) {
      const pose = room.herPose(line, key), name = scene.lookOf(key, pose);
      assert.ok(name && SEEN[name], `${key}: «${line}» — место «${pose}», а картинки для него нет`);
      assert.match(line, SEEN[name], `${key}: «${line}» — не о том, что на картинке «${name}»`);
      // «Читаю» — только у картинки с книгой (0.45.0): у остальных книги в руках нет.
      assert.doesNotMatch(name === "read" ? line.replace(/[Чч]итаю/u, "") : line, absent, `${key}: «${line}» — этого на картинке нет`);
      // Слова о погоде — только при этой погоде.
      if (sky !== "rain" && sky !== "storm") assert.doesNotMatch(line, /дожд|капл/iu, `${sky}: ${line}`);
      if (sky !== "snow") assert.doesNotMatch(line, /снег|снежин/iu, `${sky}: ${line}`);
      drawnFor.add(name);
    }
  }
  // 0.48.0: у эпизодов её дня свои запасы («+комната:день:…») — правила те же: у каждой реплики есть картинка, и
  // говорит реплика о том, что на этой картинке видно; слова о погоде — только при этой погоде.
  const SEEN_DAY = {
    work: /блокнот/u, work2: /блокнот/u, work3: /[Вв] кресле с блокнотом/u, read: /[Чч]итаю/u, tea: /[Сс] кружкой/u, tea2: /[Пп]ью чай/u, tea3: /кресл/u,
    tidy: /метёлк/u, books: /книги/u, feed: /корм/u,
  };
  for (const [name, stage] of Object.entries(room.EPISODES)) for (const sky of room.SKIES) for (const owner of [true, false]) {
    if (!stage.pool.startsWith("день:")) continue;
    const lines = fitting(stage.pool, { owner, level: owner ? "close" : "known", sky, part: "день" });
    assert.ok(lines.length >= (stage.story ? 2 : 3), `${name}, ${sky}: реплик ${lines.length}`);
    for (const line of lines) {
      const pose = room.herPose(line, stage.key), sprite = scene.lookOf(stage.key, pose);
      assert.ok(sprite && SEEN_DAY[sprite], `${name}: «${line}» — место «${pose}», а картинки для него нет`);
      assert.match(line, SEEN_DAY[sprite], `${name}: «${line}» — не о том, что на картинке «${sprite}»`);
      if (sky !== "rain" && sky !== "storm") assert.doesNotMatch(line, /дожд|капл/iu, `${sky}: ${line}`);
      if (sky !== "snow") assert.doesNotMatch(line, /снег|снежин/iu, `${sky}: ${line}`);
      drawnFor.add(sprite);
    }
  }
  // Название эпизода звучит в её словах о плане и в «отложила»: слов-примет места в нём быть не должно — иначе
  // «по плану — уборка» встало бы у полки. И сама «отложила» — в кресле, под пледом.
  for (const stage of Object.values(room.EPISODES)) {
    const put = pool("день:отложила", { vars: { "план": stage.title } });
    assert.ok(put.length >= 2 && put.every(line => line.includes(stage.title)), stage.title);
    for (const line of put) assert.equal(scene.lookOf("устала", room.herPose(line, "устала")), "tired3", line);
  }
  // И наоборот: каждая поза в куртке кому-то нужна — картинки, о которой нет ни одной реплики, не осталось.
  assert.deepEqual([...drawnFor].sort(), Object.keys(HER_SPRITES).filter(name => !name.includes("-") && HER_SPRITES[name].kind !== "walk").sort());
  // Незнакомое место или состояние — картинки нет: страница тогда берёт первую позу состояния.
  assert.deepEqual([scene.lookOf("уют", "dance"), scene.lookOf("constructor", "desk"), scene.lookOf("уют", "constructor")], [null, null, null]);
  // Спит она на полу, в пледе: кресло в словах о сне не названо.
  for (const line of pool("она:сон")) assert.doesNotMatch(line, /кресл/u, line);
  // Витрина говорит теми же словами, что и словарь: её строки — из тех же запасов.
  for (const hour of [8, 14, 20, 2]) {
    const look = logic.demoLook(hour);
    assert.ok(pool(`она:${look.her.key}`).includes(look.her.line), `витрина, ${hour} ч: «${look.her.line}» — такой строки в словаре нет`);
    assert.equal(room.herPose(look.her.line, look.her.key), look.her.pose, look.her.line);
    // И её распорядок на витрине — те же реплики с теми же местами, какие прислало бы сердце.
    assert.deepEqual(look.her.beats[0], { pose: look.her.pose, line: look.her.line });
    for (const beat of look.her.beats) {
      assert.ok(pool(`она:${look.her.key}`).includes(beat.line), `витрина, ${hour} ч: «${beat.line}»`);
      assert.equal(room.herPose(beat.line, look.her.key), beat.pose, beat.line);
    }
  }
});

test("словарь 0.43.0: слова сходятся с картинками — числа в словах те же, что в папке, вечером она меняет позы; о новом видимом отвечает сама", () => {
  const said = (name) => book.pool(name, { formal: true }).join(" ");
  // Позы — картинки состояний; «идёт» (0.44.0) — не поза: ею она переходит от места к месту, и считается отдельно.
  const strides = Object.keys(HER_SPRITES).filter(name => HER_SPRITES[name].kind === "walk");
  const names = Object.keys(HER_SPRITES).filter(name => !strides.includes(name)), jackets = names.filter(name => !name.includes("-")), lidded = names.filter(name => SPRITES[name].blink);
  // Числа, которые она называет вслух, — из папки с картинками. Прибавилась картинка — тест напомнит перечитать
  // темы (их список — в шапке блока «СБОРКА 0.44.0» в PHRASES.txt) и назвать новое число здесь.
  const WORDS = { 2: /две/u, 10: /десят/u, 14: /четырнадцат/u, 15: /пятнадцат/u, 16: /шестнадцат/u, 18: /восемнадцат/u, 19: /девятнадцат/u, 20: /двадцат/u, 24: /двадцат[иь] четыр/u, 30: /[Тт]ридцат/u, 32: /[Тт]ридцать дв/u, 38: /[Тт]ридцать восемь/u, 22: /двадцать дв/u, 44: /[Сс]орок четыре/u };
  const word = (count, what) => { assert.ok(WORDS[count], `${what}: ${count} — этого числа словами здесь нет: перечитать темы о картинках и дописать`); return WORDS[count]; };
  for (const topic of ["сколько у тебя поз", "кто тебя рисует"]) {
    assert.match(said(topic), word(names.length, "картинок"), topic);
    assert.match(said(topic), word(jackets.length, "поз в куртке"), topic);
    assert.match(said(topic), word(strides.length, "картинок «идёт»"), topic);
  }
  assert.match(said("как часто ты моргаешь"), word(lidded.length, "картинок с веками"));
  // Где она моргает — названо словами: у каждой картинки с веками есть своё слово в теме. Новые веки — новое слово.
  // С 0.44.0 веки есть у каждой картинки с открытыми глазами; сидит она в кресле — пуфа в словах больше нет.
  const LIDS = { tea: /кружк/u, tea3: /в кресле/u, read: /с книгой/u, work: /блокнот/u, work2: /блокнот/u, jealous: /скрещ[её]нными руками/u, jealous3: /скрещ[её]нными руками.*в кресле/u, work3: /блокнот.*в кресле/u, play: /ленточк/u, play3: /ленточк/u, pout2: /дуюсь/u, tired2: /тру глаз/u, tidy: /метёлк/u, books: /стопк/u, feed: /корм/u };
  for (const topic of ["как часто ты моргаешь", "ты моргаешь", "на чём ты сидишь", "позы вечером", "ты меняешь позы", "почему ты стоишь", "длина волос"]) {
    assert.doesNotMatch(said(topic).replace(/Пуфа больше нет[^.]*\.|Пуф убрали[^.]*\./gu, ""), /пуф/iu, `${topic}: пуфа в комнате нет — она сидит в кресле`);
  }
  assert.match(said("на чём ты сидишь"), /[Вв] кресле/u);
  // Волосы сидя не длиннее, чем стоя (владелец: «когда она сидит, у неё волосы становятся в разы длиннее»).
  assert.doesNotMatch(said("длина волос"), /[Дд]о пола|на ковре/u);
  for (const name of lidded.filter(item => !item.includes("-"))) {
    assert.ok(LIDS[name], `${name}: веки есть, а слова о них в темах «как часто ты моргаешь» и «ты моргаешь» нет — дописать`);
    assert.match(said("как часто ты моргаешь"), LIDS[name], name);
  }
  assert.match(said("как часто ты моргаешь"), /в куртке и в свитере|в обоих нарядах/u);
  // Свитер полон (это держит тест «она картинкой»): значит, ни одна тема не говорит «вечером поза одна».
  assert.deepEqual(names.filter(name => name.startsWith("home-")).sort(), jackets.map(name => `home-${name}`).sort());
  for (const topic of ["позы вечером", "ты меняешь позы", "сколько у тебя поз", "ты моргаешь", "как часто ты моргаешь", "свитер на весь вечер", "свитер в комнате", "почему ты стоишь", "те же позы в свитере", "кто тебя рисует"]) {
    assert.ok(said(topic), `темы «${topic}» нет`);
    assert.doesNotMatch(said(topic), /пока (?:по )?одн|ещё не нарисован|единственн|позу не меняю|[Дд]нём — меняю/u, topic);
  }
  assert.match(said("позы вечером"), /[Мм]еняю/u);
  // Прежний вопрос «почему вечером одна поза» не остался без ответа: тема та же, ответ — новый.
  for (const asked of ["почему ты вечером не меняешь позу?", "ты в свитере не двигаешься", "ты и вечером меняешь позы?"]) assert.deepEqual(book.match(asked), ["позы вечером"], asked);

  // Что видно на новых картинках — о том можно спросить, и ответ не уходит модели.
  const hit = {
    "что за ленточка?": "ленточка", "зачем тебе лента": "ленточка", "ты оглядываешься": "ты оглядываешься", "почему ты смотришь через плечо?": "ты оглядываешься",
    "ты грызёшь ручку": "ручка у губ", "ты задумалась": "ручка у губ", "ты трёшь глаз": "ты трешь глаз", "ты сонная": "ты трешь глаз",
    "ты опять пьёшь чай": "ты опять пьешь чай", "почему ты пьёшь с закрытыми глазами?": "пьешь с закрытыми глазами", "ты красиво танцуешь": "ты танцуешь", "под что ты танцуешь?": "музыка для танцев",
    "кто тебя рисует?": "кто тебя рисует", "почему позы одинаковые?": "те же позы в свитере", "у тебя красивая улыбка": "твоя улыбка", "какой длины твои волосы?": "длина волос", "ты заплетаешь косу?": "прическа",
  };
  for (const [asked, name] of Object.entries(hit)) assert.deepEqual(book.match(asked), [name], asked);
  // Прежние темы остались при своих словах: новое их не отняло.
  const kept = {
    "ты умеешь танцевать": "станцуй", "о чем ты задумалась": "о чем думаешь", "ты подглядываешь": "ты меня видишь", "что ты пьешь": "любимый напиток", "ты улыбаешься": "ты смеешься",
    "красивые волосы": "красивые волосы", "что у тебя в руках?": "что у тебя в руках", "кто нарисовал комнату?": "кто нарисовал комнату", "ты зеваешь": "ты зеваешь", "ты отвернулась": "ты отвернулась",
  };
  for (const [asked, name] of Object.entries(kept)) assert.deepEqual(book.match(asked), [name], asked);
  // Чужое остаётся чужим: вопрос не о ней — не к этим темам.
  for (const asked of ["что за ленточка у кота на шее", "ты оглядываешься на прошлое", "кто тебя рисует на уроке", "какой длины твои волосы были в школе"]) assert.equal(book.match(asked), null, asked);

  // О жизни человека: тяжёлое — серьёзной темой (без манер и шуток), и только о людях и питомцах.
  const life = {
    "у меня умер дедушка": "!утрата", "не стало мамы": "!утрата", "кота усыпили": "!умер питомец", "мама в больнице": "!близкий заболел", "я боюсь операции": "!операция",
    "я лежу в больнице": "!в больнице", "давление скачет": "!давление", "меня выписали": "выписали", "я закрыл кредит": "закрыл кредит", "у сына утренник": "утренник",
    "меня никто не поздравил": "никто не поздравил", "завтра дедлайн": "дедлайн", "делаем уроки": "уроки с ребенком", "надо позвонить маме": "надо позвонить маме", "сегодня день матери": "день матери",
  };
  for (const [asked, name] of Object.entries(life)) assert.deepEqual(book.match(asked), [name], asked);
  for (const asked of ["у меня умер телефон", "умер аккумулятор", "у меня умерла надежда", "давление в шинах упало", "меня выписали из чата"]) assert.equal(book.match(asked), null, asked);
  // Скорую она называет номером, который работает с любого телефона.
  assert.match(said("!давление"), /112/u);
  assert.doesNotMatch(said("!давление"), /Байт|кофе — понимаю/u);
  for (const topic of ["!утрата", "!умер питомец", "!операция", "!в больнице"]) assert.doesNotMatch(said(topic), /мяу|(?:^|[^а-яё])ня(?:[^а-яё]|$)|Байт (?:так|считает)/iu, topic);
});

// ── она картинкой (0.40.0) ──────────────────────────────────────────────────

/** Пары «поза и состояние» и «фигура и место» — те, что сердце в самом деле шлёт: по строкам словаря. */
function dictionaryPairs() {
  const hers = new Set(), cats = new Set();
  for (const key of Object.keys(MOODS)) for (const owner of [true, false]) for (const line of pool(`она:${key}`, { owner, level: owner ? "close" : "known" })) hers.add(`${room.herPose(line, key)}/${key}`);
  for (const key of ["голоден", "сыт", "спит", "ласка", "игра", "шалит", "обижен"]) for (const line of pool(`байт:${key}`)) { const { shape, place } = room.catPose(line, key); cats.add(`${shape}.${place}`); }
  for (const op of ["feed", "play", "pet"]) for (const again of [false, true]) { const { shape, place } = room.catAfter(op, { again }); cats.add(`${shape}.${place}`); }
  return { hers: [...hers].map(pair => pair.split("/")), cats: [...cats].map(pair => pair.split(".")) };
}

test("она картинкой: у каждого состояния своя картинка; комната ссылается на неё, а не несёт в себе; нет картинки — она нарисована кодом", () => {
  // Модули картинок: то, что собирает `scripts/room-sprite.mjs`, и ничего сверх.
  for (const [name, sprite] of Object.entries(SPRITES)) {
    // «Веки» (моргание) — только у тех картинок, для которых они собраны (`scripts/room-blink.mjs`).
    assert.deepEqual(Object.keys(sprite).filter(key => !["blink", "smile", "lookl", "lookr"].includes(key)).sort(), ["cx", "h", "src", "w"], name);
    assert.ok(Number.isInteger(sprite.w) && Number.isInteger(sprite.h) && sprite.w >= 200 && sprite.h >= 400 && sprite.h <= 1000, `${name}: ${sprite.w}×${sprite.h}`);
    // Ось тела — около середины; у картинок с рукой, вытянутой в сторону (метёлка, книга у полки — 0.48.0), она
    // смещена к краю: рамка картинки шире фигуры.
    assert.ok(sprite.cx > 0.3 && sprite.cx < 0.75, `${name}: ось тела ${sprite.cx}`);
    assert.match(sprite.src, /^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/u, name);
    // Стоит или идёт — картинка высокая (её рост на рисунке — три четверти); присела, сидит, спит на полу — ниже и шире.
    const data = HER_SPRITES[name], stands = ["stand", "walk"].includes(data.kind ?? "stand");
    assert.equal(sprite.h >= 800, stands, `${name}: ${sprite.w}×${sprite.h}`);
    assert.ok(stands ? data.tall >= 370 && data.tall <= 400 : data.tall >= 150 && data.tall <= 340, `${name}: рост на рисунке ${data.tall}`);
    assert.ok(["stand", "crouch", "seat", "floor", "walk"].includes(data.kind ?? "stand"), name);
    // Что движется рядом и где голова — в долях картинки: внутри неё.
    for (const [fx, fy] of [data.mark?.slice(1), data.head].filter(Boolean)) assert.ok(fx > 0 && fx < 1 && fy > 0 && fy < 1, `${name}: ${fx}, ${fy}`);
    if (sprite.blink) {
      const { x, y, w, h, src } = sprite.blink;
      assert.ok([x, y, w, h].every(Number.isInteger) && x >= 0 && y >= 0 && w >= 40 && h >= 20 && x + w <= sprite.w && y + h <= sprite.h * 0.4, `${name}: веки ${x},${y} ${w}×${h}`);
      assert.match(src, /^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/u, name);
      assert.ok(src.length < 12_000, `${name}: заплатка на глаза — ${src.length} знаков`);
    }
  }
  // Имя картинки: наряд (кроме куртки) — приставкой через дефис; наряд из списка.
  assert.deepEqual([...HER_WEARS], ["jacket", "home"]);
  for (const name of Object.keys(HER_SPRITES)) assert.match(name, new RegExp(`^(?:(?:${HER_WEARS.filter(wear => wear !== "jacket").join("|")})-)?[a-z]+\\d?$`, "u"), name);
  // У каждого состояния — картинки, и каждая картинка кому-то нужна.
  assert.equal(spriteOf({}), null);
  assert.equal(spriteOf({ her: null }), null);
  assert.deepEqual(spritesOf({}), []);
  const used = new Set(), first = new Set();
  for (const key of Object.keys(MOODS)) {
    const name = spriteOf({ her: { pose: "desk", key } });
    assert.ok(Object.hasOwn(HER_SPRITES, name), key);
    first.add(name);
    // И по кругу (прежнее сердце, без распорядка), и по реплике (`beat`): у реплики картинка одна. «Читает» (0.45.0)
    // есть только у реплики: в круг «уюта» она не входит — там у всех поз в руках кружка.
    for (const part of PARTS) for (const tea of [false, true]) for (const pose of HER_POSES) for (const beat of [false, true]) {
      const list = spritesOf({ part, her: { pose, key, beat }, tea });
      assert.ok(list.length >= 1 && new Set(list).size === list.length && list.every(item => Object.hasOwn(HER_SPRITES, item)), `${part}/${pose}/${key}: ${list}`);
      assert.ok(!beat || list.length === 1, `${part}/${pose}/${key}: у реплики картинка одна`);
      // Позы идут по кругу: какой бы ни был счёт, имя — из списка; счёт из чужих рук — как ноль.
      for (const turn of [0, 1, 2, 5, 17]) assert.equal(spriteOf({ part, her: { pose, key, turn, beat }, tea }), list[turn % list.length]);
      for (const turn of [-1, 1.5, "2", null, NaN]) assert.equal(spriteOf({ part, her: { pose, key, turn, beat }, tea }), list[0]);
      // Все позы одного списка — в одном наряде: она не переодевается, сменив позу.
      assert.equal(new Set(list.map(item => (item.includes("-") ? item.split("-")[0] : "jacket"))).size, 1, `${part}/${pose}/${key}: ${list}`);
      for (const item of list) used.add(item);
    }
  }
  // «Идёт» — не поза состояния: ею она переходит от места к месту (0.44.0). В списки поз она не попадает.
  const strides = Object.keys(HER_SPRITES).filter(name => HER_SPRITES[name].kind === "walk");
  assert.deepEqual(strides.sort(), ["home-walk", "walk"]);
  assert.deepEqual([...used].sort(), Object.keys(HER_SPRITES).filter(name => !strides.includes(name)).sort());
  assert.equal(first.size, Object.keys(MOODS).length, "у двух состояний одна первая картинка — их не отличить");
  // Наряд: вечером и ночью — домашний, но только там, где у него есть картинка этого состояния; названный
  // сердцем — сильнее часа; незнакомый — как не названный. Ей налили чай за делом — кружка, а куртка та же.
  assert.deepEqual(spritesOf({ part: "день", her: { pose: "desk", key: "уют" } }), ["tea", "tea2", "tea3"]);
  assert.deepEqual(spritesOf({ part: "вечер", her: { pose: "desk", key: "уют" } }), ["home-tea", "home-tea2", "home-tea3"]);
  assert.deepEqual(spritesOf({ part: "ночь", her: { pose: "desk", key: "уют" } }), ["home-tea", "home-tea2", "home-tea3"]);
  assert.deepEqual(spritesOf({ part: "вечер", her: { pose: "desk", key: "уют", wear: "jacket" } }), ["tea", "tea2", "tea3"]);
  assert.deepEqual(spritesOf({ part: "день", her: { pose: "desk", key: "уют", wear: "home" } }), ["home-tea", "home-tea2", "home-tea3"]);
  assert.deepEqual(spritesOf({ part: "вечер", her: { pose: "desk", key: "уют", wear: "constructor" } }), ["home-tea", "home-tea2", "home-tea3"]);
  assert.deepEqual(spritesOf({ part: "вечер", her: { pose: "desk", key: "дело" }, tea: true }), ["home-tea", "home-tea2", "home-tea3"]);
  // С 0.42.0 свитер нарисован для каждого состояния: вечером и ночью она в нём, чем бы ни была занята. С 0.43.0 —
  // и для каждой позы: вечерний список — тот же, что дневной, в том же порядке (первая поза по её словам — та же),
  // только в свитере. В 0.42.0 поз в свитере было по одной, и вечером она позу не меняла.
  for (const part of ["вечер", "ночь"]) for (const key of Object.keys(MOODS)) for (const pose of HER_POSES) for (const tea of [false, true]) {
    const day = spritesOf({ part: "день", her: { pose, key }, tea });
    assert.deepEqual(spritesOf({ part, her: { pose, key }, tea }), day.map(name => `home-${name}`), `${part}/${pose}/${key}/${tea}`);
  }
  assert.deepEqual(spritesOf({ part: "вечер", her: { pose: "dance", key: "игра" } }), ["home-play2", "home-play3", "home-play"]);
  assert.deepEqual(spritesOf({ part: "ночь", her: { pose: "chair", key: "уют" } }), ["home-tea3", "home-tea", "home-tea2"]);
  assert.equal(spriteOf({ part: "вечер", her: { pose: "desk", key: "дело", turn: 1 } }), "home-work2");
  // Свитер полон: у каждой позы в куртке есть пара, и лишних картинок в нём нет.
  const jackets = Object.keys(HER_SPRITES).filter(name => !name.includes("-"));
  assert.deepEqual(Object.keys(HER_SPRITES).filter(name => name.startsWith("home-")).sort(), jackets.map(name => `home-${name}`).sort());
  for (const name of jackets.map(item => `home-${item}`)) {
    // Числа у пары одни: рост, вид, что закрывает, где голова. Метка (пар, «z z») — того же рода и в двух сотых от
    // пары: кружку нейросеть сдвинула на волос.
    const { mark: mine, ...own } = HER_SPRITES[name], { mark: theirs, ...twin } = HER_SPRITES[name.slice(5)];
    assert.deepEqual(own, twin, name);
    assert.equal(mine?.[0], theirs?.[0], name);
    if (mine) assert.ok(Math.abs(mine[1] - theirs[1]) < 0.02 && Math.abs(mine[2] - theirs[2]) < 0.02, name);
    // И сама картинка пары — того же размера (она переодета, а не перерисована): ширина гуляет на рукав куртки.
    assert.equal(SPRITES[name].h, SPRITES[name.slice(5)].h, name);
    // Исключение одно (0.47.0): плед на плечах лёг по-разному — поверх куртки он шире (её рукава свисают по бокам),
    // поверх свитера падает вдоль рук. Поза та же, а `half` у пары — по широкой картинке.
    const draped = name === "home-tired3";
    assert.ok(draped || Math.abs(SPRITES[name].w - SPRITES[name.slice(5)].w) <= 16, `${name}: ширина ${SPRITES[name].w} против ${SPRITES[name.slice(5)].w}`);
  }
  assert.deepEqual(spritesOf({ part: "вечер", her: { pose: "desk", key: "игра", wear: "jacket" } }), ["play", "play2", "play3"]);
  // Первая поза — та, что ближе к её словам: «танцую» — танцует, «дразню Байта ленточкой» — присела с ленточкой,
  // «чай, кресло, плед» — сидит с кружкой, «пью чай под гирляндой» — пьёт.
  assert.deepEqual(spritesOf({ part: "день", her: { pose: "dance", key: "игра" } }), ["play2", "play3", "play"]);
  assert.deepEqual(spritesOf({ part: "день", her: { pose: "ribbon", key: "игра" } }), ["play3", "play", "play2"]);
  assert.deepEqual(spritesOf({ part: "день", her: { pose: "chair", key: "уют" } }), ["tea3", "tea", "tea2"]);
  assert.deepEqual(spritesOf({ part: "день", her: { pose: "garland", key: "уют" } }), ["tea2", "tea3", "tea"]);
  assert.deepEqual(spritesOf({ part: "день", her: { pose: "constructor", key: "уют" } }), ["tea", "tea2", "tea3"]);
  // Ей налили чай — в руках кружка, а не блокнот; незнакомое состояние — спокойная она с кружкой.
  assert.equal(spriteOf({ her: { pose: "desk", key: "дело" } }), "work");
  assert.equal(spriteOf({ her: { pose: "desk", key: "дело" }, tea: true }), "tea");
  assert.equal(spriteOf({ her: { pose: "desk", key: "сон" }, tea: true }), "sleep");
  assert.equal(spriteOf({ her: { pose: "desk", key: "constructor" } }), "tea");

  // Определение картинки: один тег, только из проверенных частей.
  assert.equal(drawSprite("tea2", SPRITES.tea2), `<image id="r-her-tea2" width="${SPRITES.tea2.w}" height="${SPRITES.tea2.h}" preserveAspectRatio="none" href="${SPRITES.tea2.src}"/>`);
  // Веки — у двадцати четырёх картинок (0.47.0: в кресле с блокнотом и скрестив руки; 0.45.0 — у двадцати, 0.44.0 —
  // у восемнадцати): у каждой, где глаза открыты, — в куртке и в свитере. У картинок с закрытыми глазами (пьёт, танцует, зевает, спит, отвернулась, «мне всё
  // равно») их нет и не будет; «идёт» смотрит в сторону — ей они не нужны.
  const lidded = Object.keys(SPRITES).filter(name => SPRITES[name].blink).sort();
  // 0.48.0 — тридцать: с метёлкой, со стопкой книг и с пакетом корма — в обоих нарядах.
  assert.deepEqual(lidded, ["books", "feed", "home-books", "home-feed", "home-jealous", "home-jealous3", "home-play", "home-play3", "home-pout2", "home-read", "home-tea", "home-tea3", "home-tidy", "home-tired2", "home-work", "home-work2", "home-work3", "jealous", "jealous3", "play", "play3", "pout2", "read", "tea", "tea3", "tidy", "tired2", "work", "work2", "work3"]);
  // Моргает в куртке — моргает и в свитере: веки пары переносятся без новой картинки (`blink … by=head`).
  for (const name of lidded.filter(item => !item.includes("-"))) assert.ok(lidded.includes(`home-${name}`), `home-${name}: веки есть у пары в куртке — перенести`);
  // У картинки с «веками» определений два: она сама и заплатка на глаза — в точках самой картинки.
  const lids = SPRITES.tea.blink;
  // С улыбкой (0.50.0) — три: ещё заплатка на всё лицо.
  const grin = SPRITES.tea.smile;
  // Со взглядом в сторону (0.51.0) — четыре: ещё заплатка на глаза, зрачки вбок.
  const gaze = SPRITES.tea.lookr;
  // Со взглядом влево (0.52.0) — пять.
  const left = SPRITES.tea.lookl;
  assert.equal(drawSprite("tea", SPRITES.tea), `<image id="r-her-tea" width="${SPRITES.tea.w}" height="${SPRITES.tea.h}" preserveAspectRatio="none" href="${SPRITES.tea.src}"/><image id="r-her-tea-blink" x="${lids.x}" y="${lids.y}" width="${lids.w}" height="${lids.h}" preserveAspectRatio="none" href="${lids.src}"/><image id="r-her-tea-smile" x="${grin.x}" y="${grin.y}" width="${grin.w}" height="${grin.h}" preserveAspectRatio="none" href="${grin.src}"/><image id="r-her-tea-lookl" x="${left.x}" y="${left.y}" width="${left.w}" height="${left.h}" preserveAspectRatio="none" href="${left.src}"/><image id="r-her-tea-lookr" x="${gaze.x}" y="${gaze.y}" width="${gaze.w}" height="${gaze.h}" preserveAspectRatio="none" href="${gaze.src}"/>`);
  // Негодные «веки» — картинка без них, а не без неё самой.
  for (const blink of [null, "x", { ...lids, w: 0 }, { ...lids, x: SPRITES.tea.w }, { ...lids, src: "javascript:alert(1)" }, { ...lids, src: 'data:image/webp;base64,AAAA"/><script>' }]) {
    assert.equal(drawSprite("tea", { ...SPRITES.tea, blink, smile: undefined, lookr: undefined, lookl: undefined }), `<image id="r-her-tea" width="${SPRITES.tea.w}" height="${SPRITES.tea.h}" preserveAspectRatio="none" href="${SPRITES.tea.src}"/>`, JSON.stringify(blink).slice(0, 50));
    // Негодная улыбка — так же: картинка и веки на месте, заплатки на лицо нет.
    assert.equal(drawSprite("tea", { ...SPRITES.tea, smile: blink, lookr: blink, lookl: blink }), `<image id="r-her-tea" width="${SPRITES.tea.w}" height="${SPRITES.tea.h}" preserveAspectRatio="none" href="${SPRITES.tea.src}"/><image id="r-her-tea-blink" x="${lids.x}" y="${lids.y}" width="${lids.w}" height="${lids.h}" preserveAspectRatio="none" href="${lids.src}"/>`, JSON.stringify(blink).slice(0, 50));
  }
  for (const [name, sprite] of [["чужая", SPRITES.tea], ["constructor", SPRITES.tea], ["tea", null], ["tea", false], ["tea", { ...SPRITES.tea, w: 0 }], ["tea", { ...SPRITES.tea, h: "900" }],
    ["tea", { ...SPRITES.tea, src: 'data:image/webp;base64,AAAA"/><script>alert(1)</script>' }], ["tea", { ...SPRITES.tea, src: "https://example.com/x.webp" }], ["tea", { ...SPRITES.tea, src: "data:image/svg+xml;base64,AAAA" }]]) {
    assert.equal(drawSprite(name, sprite), "", `${name}: ${JSON.stringify(sprite).slice(0, 60)}`);
  }

  const cat = { shape: "sit", place: "rug", key: "сыт" };
  for (const part of PARTS) for (const key of Object.keys(MOODS)) for (const pose of ["desk", "shelf", "chair", "sill", "nap"]) {
    const view = { part, her: { pose, key }, cat, plant: "wet", things: [...THINGS] }, name = spriteOf(view), label = `${part}/${pose}/${key}`;
    const markup = drawInside(view, PAINTED);
    assert.equal(wellFormed(markup), "", label);
    // Днём — одна ссылка на картинку; утром, вечером и ночью — ещё одна в маске: свет часа ложится только на неё.
    // И ещё одна — в маске румянца (0.48.0): он есть у картинок с веками, кроме четырёх, где лицо повёрнуто или наклонено.
    const rosy = Boolean(SPRITES[name]?.blink) && HER_SPRITES[name].blush !== false;
    assert.equal(markup.includes('<g class="blush" opacity="0" mask="url(#r-herBlush)" style="mix-blend-mode:multiply">'), rosy, label);
    // И ещё одна — слой головы (0.49.0): та же картинка под мягким овалом; у спящей на полу слоя нет.
    const headed = HER_SPRITES[name].kind !== "floor";
    assert.equal(markup.includes('<g class="hd" style="transform-origin:'), headed, label);
    assert.equal((markup.match(new RegExp(`<use href="#r-her-${name}" transform="translate\\([\\d.-]+ [\\d.-]+\\) scale\\([\\d.]+\\)"/>`, "gu")) ?? []).length, (part === "день" ? 1 : 2) + (rosy ? 1 : 0) + (headed ? 1 : 0), label);
    assert.equal(markup.includes('<mask id="r-herMask" style="mask-type:alpha" maskUnits="userSpaceOnUse"'), part !== "день", label);
    // Сама картинка — не в комнате: комнату перерисовывает каждое нажатие, и картинка грузилась бы заново.
    assert.ok(!markup.includes("<image") && !markup.includes("base64"), label);
    // Нарисованной кодом её при этом нет: ни дыхания, ни моргания (Байт моргает — у него свой класс «cat»).
    assert.ok(!markup.includes('class="breath"'), label);
    const zones = zonesOf(markup), her = zones.find(zone => zone.id === "her");
    assert.ok(her && her.act === "her" && her.label === "Аи", label);
    assert.ok(her.x >= 0 && her.x + her.w <= WIDTH && her.y >= 0, label);
    // Ниже 500 — полоса с её словами: туда не уходят ни ботинки, ни место нажатия.
    assert.ok(her.y + her.h <= 500, `${label}: её место кончается на ${her.y + her.h}`);
    assert.deepEqual(zones.slice(-4).map(zone => zone.act).sort(), [...CARE_ACTS].sort(), `${label}: забота — поверх всех`);
    // Рисунок целиком несёт и определение картинки — он виден сам по себе (листы, снимки).
    const whole = drawRoom(view, PAINTED);
    assert.equal(wellFormed(whole), "", label);
    assert.equal((whole.match(/<image /gu) ?? []).length, 1 + ["blink", "smile", "lookl", "lookr"].filter(key => SPRITES[name][key]).length, label);
    assert.ok(whole.includes(`<defs><image id="r-her-${name}" `), label);
    // Что движется рядом с неподвижной картинкой: пар над её кружкой, «z z Z» над спящей.
    const calm = drawInside({ ...view, cat: null }, PAINTED);
    assert.equal((calm.match(/class="steam"/gu) ?? []).length, HER_SPRITES[name].mark?.[0] === "steam" ? 1 : 0, label);
    assert.equal((calm.match(/class="zzz"/gu) ?? []).length, HER_SPRITES[name].mark?.[0] === "zzz" ? 1 : 0, label);
    // Моргает та, у чьей картинки есть «веки»: заплатка — под тенью часа, сразу за самой картинкой.
    assert.equal(markup.includes(`<use class="wink" href="#r-her-${name}-blink" `), Boolean(SPRITES[name].blink), label);
    // Голова — отдельное место поверх неё самой: по голове гладят. Оно целиком на рисунке и выше её середины.
    const head = zones.find(zone => zone.id === "pat");
    assert.ok(head && head.act === "pat" && head.label === "Погладить Аи по голове", label);
    assert.ok(head.x >= 0 && head.x + head.w <= WIDTH && head.y >= 0 && head.y + head.h / 2 < her.y + her.h / 2 && head.w >= 40 && head.h >= 40, `${label}: ${JSON.stringify(head)}`);
    assert.ok(zones.indexOf(head) > zones.indexOf(her), `${label}: голова — поверх неё`);
    // Коробка Байта нажимается всегда.
    assert.ok(zones.some(zone => zone.id === "box" && zone.act === "box"), label);
  }
  // Каждая картинка встаёт в комнату: на рисунке, с местом нажатия выше полосы с её словами.
  for (const part of PARTS) for (const name of Object.keys(HER_SPRITES).filter(item => HER_SPRITES[item].kind !== "walk")) {
    const key = Object.keys(MOODS).find(mood => [false, true].some(tea => ["jacket", "home"].some(wear => spritesOf({ part, her: { pose: "desk", key: mood, wear }, tea }).includes(name))));
    // Картинка только у реплики («читает»): её состояние и место — из таблицы реплик (`lookOf`).
    const told = key ? null : Object.keys(MOODS).flatMap(mood => HER_POSES.map(pose => [mood, pose])).find(([mood, pose]) => scene.lookOf(mood, pose) === name.replace(/^home-/u, ""));
    assert.ok(key || told, name);
    const wear = name.includes("-") ? name.split("-")[0] : "jacket", tea = Boolean(key) && !spritesOf({ part, her: { pose: "desk", key, wear } }).includes(name);
    const list = key ? spritesOf({ part, her: { pose: "desk", key, wear }, tea }) : [name];
    const view = { part, her: key ? { pose: "desk", key, wear, turn: list.indexOf(name) } : { pose: told[1], key: told[0], wear, beat: true }, tea, cat, plant: "wet", things: [...THINGS] };
    assert.equal(spriteOf(view), name);
    const markup = drawInside(view, PAINTED), zones = zonesOf(markup), her = zones.find(zone => zone.id === "her");
    assert.equal(wellFormed(markup), "", `${part}/${name}`);
    assert.ok(markup.includes(`<use href="#r-her-${name}" `) && her && her.y >= 0 && her.y + her.h <= 500 && her.x >= 0 && her.x + her.w <= WIDTH, `${part}/${name}: ${JSON.stringify(her)}`);
    // Пуфа, который появлялся вместе с сидящей, больше нет (0.44.0): сидит она в кресле комнаты — ровно посреди него.
    assert.ok(!markup.includes("pouf"), `${part}/${name}`);
    if (HER_SPRITES[name].kind === "seat") assert.ok(Math.abs(her.x + her.w / 2 - 196) <= 8, `${part}/${name}: сидит на ${her.x + her.w / 2}, а кресло — на 196`);
  }
  // Смена позы: прежняя картинка тает, новая проявляется; рисунок целиком несёт определения обеих.
  {
    // Стемнело — сменился наряд: куртка тает, свитер проявляется тем же переходом, вечерняя тень лежит на обеих.
    const dusk = { part: "вечер", her: { pose: "desk", key: "дело" }, cat, plant: "wet", things: [] };
    const changed = drawInside(dusk, { ...PAINTED, was: { name: "work", x: 252 } });
    assert.equal(wellFormed(changed), "");
    assert.ok(changed.includes('<g class="leave"><use href="#r-her-work" ') && changed.includes('<g class="arrive"><g class="mim m-calm"><g class="lean"><g class="alive"><use href="#r-her-home-work" ') && changed.includes('<mask id="r-herMaskWas" '));
    assert.deepEqual(zonesOf(changed), zonesOf(drawInside(dusk, PAINTED)));

    const view = { part: "день", her: { pose: "desk", key: "дело", turn: 1 }, cat, plant: "wet", things: [] };
    const plain = drawInside(view, PAINTED), smooth = drawInside(view, { ...PAINTED, was: { name: "work", x: 252 } });
    assert.ok(!plain.includes('class="leave"') && !plain.includes('class="arrive"'));
    assert.equal(wellFormed(smooth), "");
    assert.ok(smooth.includes('<g class="leave"><use href="#r-her-work" ') && smooth.includes('<g class="arrive"><g class="mim m-calm"><g class="lean"><g class="alive"><use href="#r-her-work2" ') && !smooth.includes('<mask id="r-herMaskWas" '));
    assert.deepEqual(zonesOf(smooth), zonesOf(plain));
    // Прежняя — та же самая, незнакомая, не загруженная или без места: тогда смена — без перехода.
    for (const was of [{ name: "work2", x: 252 }, { name: "constructor", x: 252 }, { name: "чужая", x: 252 }, { name: "work", x: "252" }, null, "work", { name: "work" }]) assert.equal(drawInside(view, { ...PAINTED, was }), plain, JSON.stringify(was));
    assert.equal(drawInside(view, { sprites: { ...SPRITES, work: false }, was: { name: "work", x: 252 } }), plain);
    const whole = drawRoom(view, { ...PAINTED, was: { name: "work", x: 252 } });
    assert.equal(wellFormed(whole), "");
    assert.ok(whole.includes('<image id="r-her-work2" ') && whole.includes('<image id="r-her-work" '));
  }

  const view = { part: "вечер", her: { pose: "chair", key: "уют" }, cat, plant: "wet", things: [...THINGS], tea: true };
  // Картинка не загрузилась, негодная или спрайтов не дали — она нарисована кодом, ровно как до 0.40.0.
  const drawn = drawInside(view);
  assert.ok(drawn.includes('class="breath"') && !drawn.includes("<use"));
  const none = Object.fromEntries(Object.keys(HER_SPRITES).map(name => [name, false]));
  const wanted = spriteOf(view);
  // «Чай, кресло, плед» — вечером она сидит с кружкой в свитере (до 0.43.0 в свитере была одна поза — стоя).
  assert.equal(wanted, "home-tea3");
  for (const options of [{}, { sprites: null }, { sprites: none }, { sprites: { [wanted]: { ...SPRITES[wanted], src: "javascript:alert(1)" } } }, { sprites: { [wanted]: "data:image/webp;base64,AAAA" } }, null, "sprites", 7]) {
    assert.equal(drawInside(view, options), drawn, JSON.stringify(options).slice(0, 60));
  }
  assert.equal(drawRoom(view), drawRoom(view, {}));
  assert.ok(!drawRoom(view, { sprites: none }).includes("<image"));
  // Картинка ещё в пути (имени в списке нет): её не видно ни картинкой, ни кодом; Байт уже сидит там, где будет при ней.
  const painted = drawInside(view, PAINTED), waiting = drawInside(view, { sprites: {} });
  assert.equal(wellFormed(waiting), "");
  assert.ok(!waiting.includes("<use") && !waiting.includes('class="breath"') && !zonesOf(waiting).some(zone => zone.id === "her"));
  assert.deepEqual(zonesOf(waiting).find(zone => zone.id === "cat"), zonesOf(painted).find(zone => zone.id === "cat"));
  assert.deepEqual(zonesOf(waiting).filter(zone => zone.id !== "her"), zonesOf(painted).filter(zone => zone.id !== "her" && zone.id !== "pat"));
  // Имя из чужих рук в разметку не попадает: состояние — только из списка.
  const odd = drawInside({ ...view, her: { pose: 'x"><script>', key: '"><script>alert(1)</script>' } }, PAINTED);
  assert.ok(!odd.includes("script") && odd.includes('<use href="#r-her-home-tea" '));
  // Плед, в который она закутана, с кресла снят — нажать на него там нельзя.
  for (const [key, on] of [["устала", false], ["сон", false], ["уют", true], ["дело", true]]) {
    assert.equal(zonesOf(drawInside({ ...view, her: { pose: "chair", key } }, PAINTED)).some(zone => zone.act === "thing:плед"), on, key);
  }
});

test("она картинкой: Байта она собой не закрывает, на клубок он не садится, до обоих можно дотянуться — на каждой паре из словаря", () => {
  const { hers, cats } = dictionaryPairs();
  assert.ok(hers.length >= 15 && cats.length >= 15, `пар из словаря: её — ${hers.length}, Байта — ${cats.length}`);
  const seen = new Set(), moved = new Set();
  let total = 0;
  // Каждая поза каждого состояния (их до трёх) — днём, в куртке, и ночью, когда «уют» — в домашнем.
  for (const part of ["день", "ночь"]) for (const [pose, key] of hers) for (const turn of [0, 1, 2]) for (const tea of [false, true]) for (const things of [[], [...THINGS]]) for (const [shape, place] of cats) {
    const view = { part, her: { pose, key, turn }, cat: { shape, place, key: "сыт" }, plant: "wet", things, tea }, label = `${part} · ${pose}/${key}/${turn}${tea ? "+чай" : ""} · ${shape}.${place}`;
    const stand = spriteStand(view);
    seen.add(stand.x);
    total += 1;
    // Мерка одна на двоих: доля Байта, закрытая ею или лежащая на клубке (клубок — забота, его должно быть видно).
    // Хвост из-под пледа торчит у самого её бедра: по грубой мерке он закрыт на треть, на листе — виден.
    assert.ok(stand.hidden <= (shape === "tail" && place === "plaid" ? 0.5 : 0.15), `${label}: Байт закрыт на ${Math.round(stand.hidden * 100)} % (она стоит на ${stand.x})`);
    const zones = zonesOf(drawInside(view, PAINTED)), her = zones.find(zone => zone.id === "her"), pet = zones.find(zone => zone.id === "cat");
    assert.ok(her && pet, label);
    // Её место — там, где она встала; Байта — не под полосой с её словами и не меньше пальца.
    assert.ok(Math.abs(her.x + her.w / 2 - stand.x) <= (HER_SPRITES[stand.name].kind === "floor" ? 1 : 0.01), label);
    // Голова — на рисунке и выше полосы с её словами: гладить можно в любой позе.
    const head = zones.find(zone => zone.id === "pat");
    assert.ok(head && head.y + head.h <= 480 && head.x >= 0 && head.x + head.w <= WIDTH, `${label}: голова ${JSON.stringify(head)}`);
    assert.ok(pet.y + pet.h / 2 < 490 && pet.w >= 20 && pet.h >= 12, `${label}: место Байта ${JSON.stringify(pet)}`);
    const home = { desk: 252, shelf: 160, map: 160, chair: 196, read: 196, lie: 224, nap: 218, sill: 226, back: 226, garland: 226, dance: 226, ribbon: 226 }[pose];
    // Счёт «ушла со своего места» — по стоящей прямо: широкие и низкие картинки (танцует, присела, сидит на пуфе, спит
    // в пледе) занимают больше пола и подвигаются чаще.
    const data = HER_SPRITES[stand.name];
    if (stand.x !== home && (data.kind ?? "stand") === "stand" && !data.legs) moved.add(place);
  }
  // Встаёт она у того, о чём её слова: мест несколько, и все они в середине комнаты — миска, шкаф, стол и чайник открыты.
  // Кресло (196) — там она сидит; середина ковра (218) — там спит, закутавшись в плед.
  assert.deepEqual([...seen].sort((a, b) => a - b), [160, 196, 218, 226, 252]);
  // Со своего места она (стоящая прямо) уходит, только когда иначе закрыла бы Байта: он в кресле, под пледом или
  // на подоконнике. Миска, стол, коробка, шкаф и его подушка в стороне — из-за них она не двигается; «у её ног» он
  // садится с той стороны, где свободно; под большим креслом (0.44.0) места хватает — глаза видны сбоку от её ног.
  assert.deepEqual([...moved].sort(), ["chair", "plaid", "sill"], `всего рисунков ${total}`);
  // Одна и та же комната — одно и то же место: от перерисовки она не прыгает.
  const same = { part: "день", her: { pose: "sill", key: "уют" }, cat: { shape: "sit", place: "sill", key: "сыт" }, things: [] };
  assert.deepEqual(spriteStand(same), spriteStand(structuredClone(same)));
  assert.equal(spriteStand({ part: "день", her: null }), null);
  assert.deepEqual(spriteStand({ part: "день", her: { pose: "shelf", key: "уют" } }), { name: "tea", x: 160, cat: null, hidden: 0 });
});

test("страница: ответ сердца раскладывается по картинке и словам; отказ — словами и кнопкой «ещё раз», рисунок остаётся", () => {
  const start = logic.blank(9);
  assert.deepEqual([start.ready, start.part, start.her, start.cat, start.said], [false, "утро", null, null, "Дверь открывается…"]);
  assert.deepEqual([0, 4, 5, 11, 12, 17, 18, 22, 23].map(logic.partOf), ["ночь", "ночь", "утро", "утро", "день", "день", "вечер", "вечер", "ночь"]);
  for (const part of PARTS) { assert.ok(logic.LIGHTS[part]); assert.match(logic.HEADERS[part], /^#[0-9a-f]{6}$/u); }
  assert.match(logic.PAGE, /^\d+$/u);

  const seen = logic.applyLook(start, LOOK);
  assert.equal(seen.ready, true);
  // Луна — по дню из ответа: 18 ноября 2026 — девятый день после новолуния (0.44.0). Прежнее сердце неба не
  // называет — за окном дождь, как и было; слово «rain» рисунку не передаётся.
  assert.deepEqual(logic.viewOf(seen), { part: "вечер", her: { pose: "chair", key: "уют" }, cat: { shape: "sit", place: "bowl", key: "голоден" }, plant: "dry", things: ["кружка", "тапочки"], lamp: "#3f6fd8", fed: false, tea: false, moon: 0.3 });
  // В разговоре — приветствие, она, Байт и новая вещь; незнакомая вещь («рояль») не показывается и не называется.
  assert.equal(seen.said, "Заходите. Тапочки у двери.\nЯ в кресле у окна, под пледом.\nБайт сидит у миски.\nНовое в комнате. На столе — вторая кружка.");
  // У сценки с 0.44.0 — ещё и то, что она меняет на рисунке (`fx`), и куда встаёт она сама (`her`); прежнее сердце
  // их не шлёт — пусто.
  assert.deepEqual(seen.scene, { key: "sock", text: "Байт принёс носок.", options: ["Похвалить", "Отобрать"], pick: null, outcome: "", fx: [] });
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
  // После заботы Байт — там, куда его поставили её слова (`beat: -1`); распорядка прежнее сердце не шлёт — он на месте.
  assert.deepEqual([fed.said, fed.busy, fed.fed, fed.cat, fed.done.feed, fed.lines.cat], ["Байт ест.\nМы стали ближе.", "", true, { shape: "eat", place: "bowl", key: "сыт", beats: [], beat: -1, still: true }, 1, "Байт ест."]);
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
  // 0.49.0: «память не ответила» — отказ на время: под словами кнопка «ещё раз» (она повторит то же действие).
  assert.deepEqual([failed.said, failed.tone, failed.busy, failed.retry, failed.down], ["Что-то пошло не так. Попробуйте ещё раз.", "warn", "", true, true]);
  assert.deepEqual(logic.viewOf(failed), logic.viewOf(seen));
  for (const broken of [null, undefined, "строка", 5, {}, { ok: "да" }]) assert.equal(logic.applyLook(start, broken).ready, false);

  // Мусор в ответе не ломает страницу: всё незнакомое заменяется известным.
  const odd = logic.applyLook(start, { ok: true, clock: { hour: "поздно" }, her: { pose: "на люстре" }, cat: "кот", things: [null, 5, { key: "ёлка" }], lamp: "javascript:alert(1)", scene: { key: "x", text: "y", options: ["одна"] }, done: { pet: -3, feed: "2", play: null }, next: { days: -1 } });
  assert.deepEqual(logic.viewOf(odd), { part: "ночь", her: { pose: "desk", key: "" }, cat: null, plant: "wet", things: ["ёлка"], lamp: "", fed: true, tea: false, moon: 0.3 });
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
  assert.deepEqual(logic.viewOf(shot), { part: "ночь", her: { pose: "dance", key: shot.her.key }, cat: { shape: "curl", place: "pillow", key: "спит" }, plant: "wet", things: [...THINGS], lamp: "#7fd0c8", fed: false, tea: false, moon: 0.3 });
  // Названная поза — без распорядка: снимок остаётся таким, каким его попросили; Байт, названный в адресе, с места не ходит.
  assert.deepEqual([shot.her.beats, shot.cat.beats, shot.cat.still], [[], [], true]);
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
  // Часы человека — и сколько осталось до вечера (0.44.0): открытая страница сама спросит комнату, когда час сменится.
  assert.deepEqual(seen.clock, { hour: 14, part: "день", day: "2026-11-18", left: 4 * 3_600_000, lightLeft: 4 * 3_600_000 });
  assert.ok(pool("зайти").includes(seen.greet), seen.greet);
  // За окном — не вечный дождь: города гость не называл — погоду она выдумывает сама, и слова об окне — о ней.
  assert.equal(seen.sky, madeUpSky(5, NOON));
  assert.equal(seen.city, false, "погода выдумана: это не погода его города");
  const air = { sky: seen.sky, part: seen.clock.part };
  assert.ok(fitting(WINDOW[seen.sky], air).includes(seen.window), `${seen.sky}: ${seen.window}`);
  // Она и Байт: строка — из словаря, поза — из этой строки.
  assert.ok(fitting(`она:${seen.her.key}`, air).includes(seen.her.line), seen.her.line);
  assert.equal(seen.her.pose, room.herPose(seen.her.line, seen.her.key));
  assert.ok(fitting(`байт:${seen.cat.key}`, air).includes(seen.cat.line), seen.cat.line);
  assert.deepEqual({ shape: seen.cat.shape, place: seen.cat.place }, room.catPose(seen.cat.line, seen.cat.key));
  // Распорядок: все реплики её состояния, каждая со своим местом; первая — та, что сказана. То же у Байта. Строки —
  // только те, что годятся при этом небе: «следит за каплями» под ясным небом не звучит.
  assert.deepEqual(seen.her.beats[0], { pose: seen.her.pose, line: seen.her.line });
  assert.deepEqual(seen.her.beats.map(beat => beat.line).sort(), [...fitting(`она:${seen.her.key}`, air)].sort());
  for (const beat of seen.her.beats) assert.equal(beat.pose, room.herPose(beat.line, seen.her.key), beat.line);
  assert.deepEqual(seen.cat.beats[0], { shape: seen.cat.shape, place: seen.cat.place, line: seen.cat.line });
  assert.deepEqual(seen.cat.beats.map(beat => beat.line).sort(), [...fitting(`байт:${seen.cat.key}`, air)].sort());
  for (const beat of seen.cat.beats) assert.deepEqual({ shape: beat.shape, place: beat.place }, room.catPose(beat.line, seen.cat.key), beat.line);
  assert.equal(typeof seen.cat.still, "boolean");
  assert.deepEqual([seen.plant, seen.done, seen.cared, seen.things, seen.lamp, seen.fresh, seen.next], [{ state: "dry" }, { pet: 0, feed: 0, play: 0, tea: 0, water: 0 }, false, [], "", [], { days: 3 }]);
  // Сценка дня — та же, что пришла бы в чат; её кнопки — два решения.
  // С 0.44.0 сценка выбирается под погоду (о луже под окном в сухой день не будет) и видна на рисунке: `fx` — что она
  // изменила в комнате, пока не сыграна.
  const today = room.sceneFor(5, "2026-11-18", seen.sky);
  const shown = room.sceneLook({ day: "2026-11-18", key: today.key, pick: null }, { today: "2026-11-18", at: NOON });
  assert.deepEqual(seen.scene, { key: today.key, text: today.text.replace(/\{[^|}]*\|([^}]*)\}/gu, "$1"), options: today.options.map(option => option[0]), pick: null, outcome: null, fx: shown?.fx ?? [] });
  assert.deepEqual(seen.scene.fx, today.show?.fx ?? []);
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
  // Где Байт и какой — по словам самого ответа; у слов без примет — по таблице заботы (0.44.0). С ним — его
  // распорядок: реплики нового состояния, каждая со своей картинкой.
  const air = { sky: seen.sky, part: seen.clock.part };
  const where = (cat) => ({ key: cat.key, shape: cat.shape, place: cat.place });
  assert.deepEqual(where(pet.cat), { key: "ласка", shape: "sit", place: "near" }, "погладили — Байт рядом");
  // (0.48.0: распорядок начинается с той реплики, что идёт в эту минуту, — остальные за ней по кругу.)
  assert.deepEqual(pet.cat.beats.map(beat => beat.line).sort(), [...fitting("байт:ласка", air)].sort());
  for (const beat of pet.cat.beats) assert.deepEqual({ shape: beat.shape, place: beat.place }, room.catPose(beat.line, "ласка"), beat.line);
  assert.equal(pet.cat.still, false);
  assert.equal(pet.done.pet, 1);
  const again = await h.onRoom({ do: "pet" }, from(5));
  assert.deepEqual([again.again, again.counted, again.done.pet], [true, false, 2]);
  assert.ok(pool("погладить:ещё").includes(again.line), again.line);

  const fed = await h.onRoom({ do: "feed" }, from(5));
  assert.deepEqual([where(fed.cat), fed.counted, fed.done.feed], [{ key: "сыт", shape: "eat", place: "bowl" }, false, 1], "забота за день считается один раз");
  assert.deepEqual(where((await h.onRoom({ do: "feed" }, from(5))).cat), { key: "сыт", shape: "sit", place: "bowl" });
  const play = await h.onRoom({ do: "play" }, from(5));
  assert.deepEqual(where(play.cat), { key: "игра", shape: "play", place: "rug" });
  // Чай и вода Байта не касаются: о нём в ответе ничего — он остаётся, где был.
  const tea = await h.onRoom({ do: "tea" }, from(5));
  assert.deepEqual(["cat" in tea, tea.done.tea], [false, 1]);
  assert.ok(pool("чай").includes(tea.line), tea.line);
  // Зато чай касается её: час после него она с кружкой — блокнот и ленточка ждут (0.44.0). Ответ несёт её заново.
  assert.notEqual(seen.her.key, "уют");
  assert.equal(tea.her.key, "уют");
  assert.deepEqual(tea.her.beats[0], { pose: tea.her.pose, line: tea.her.line });
  // (0.48.0: у налитого чая свой запас — «день:чай»: кружка в каждой реплике.)
  assert.deepEqual(tea.her.beats.map(beat => beat.line).sort(), [...fitting("день:чай", air)].sort());
  assert.ok(!("her" in pet) && !("her" in fed) && !("her" in play), "о ней — только в ответе на чай");
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
  const today = room.sceneFor(5, "2026-11-18", seen.sky);
  const picked = await h.onRoom({ do: "pick", key: today.key, pick: 1 }, from(5));
  assert.deepEqual([picked.ok, picked.scene.pick, picked.counted], [true, 1, false]);
  assert.equal(picked.line, today.options[1][1].replace(/\{[^|}]*\|([^}]*)\}/gu, "$1"));
  assert.equal(picked.scene.outcome, picked.line);
  // Когда выбрано — записано: исход виден на рисунке три часа (0.44.0).
  assert.deepEqual(roomOf(5).scene, { day: "2026-11-18", key: today.key, pick: 1, at: NOON });
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

test("комната 0.41.0: её гладят по голове — своим она рада, едва знакомому не даётся; коробка Байта копит трофеи сценок", async () => {
  reset();
  const time = clock();
  const h = heart(ON, { now: time.now, random: () => 0 });
  const near = (name, line, ctx) => pool(name, ctx).some(item => line.includes(item) || item.includes(line));

  // Едва знакомый (день первый): не даётся — и это не забота: ни счёта в комнате, ни шага в отношениях.
  await h.onRoom({ do: "look" }, from(5));
  const shy = await h.onRoom({ do: "pat" }, from(5));
  assert.deepEqual([shy.ok, shy.shy, shy.again, shy.counted], [true, true, false, false]);
  assert.ok(near("она:погладить:рано", shy.line, { level: "first" }), shy.line);
  assert.deepEqual([roomOf(5).done.pat ?? 0, roomOf(5).care, roomOf(5).cared], [0, 0, ""]);

  // Хозяин: рада. Первый раз за день — шаг в отношениях (как ласка в чате), слова остаются в переписке;
  // второй — другие слова и без счёта. Байта это не касается: он остаётся, где был.
  const look = await h.onRoom({ do: "look" }, from(OWNER));
  // Города хозяин здесь не называл — небо она выдумала сама (0.44.0; до того за окном всегда шёл дождь).
  assert.deepEqual([look.patted, look.sky, look.box.count], [false, madeUpSky(OWNER, NOON), 0]);
  assert.ok(near("коробка:пусто", look.box.line, { owner: true }), look.box.line);
  const pat = await h.onRoom({ do: "pat" }, from(OWNER));
  assert.deepEqual([pat.ok, pat.shy, pat.again, pat.counted], [true, false, false, true]);
  assert.ok(near("она:погладить", pat.line, { owner: true }), pat.line);
  assert.deepEqual([roomOf(OWNER).done.pat, roomOf(OWNER).care, roomOf(OWNER).last], [1, 1, ""]);
  const more = await h.onRoom({ do: "pat" }, from(OWNER));
  assert.deepEqual([more.again, more.counted, roomOf(OWNER).done.pat, roomOf(OWNER).care], [true, false, 2, 1]);
  assert.ok(near("она:погладить:ещё", more.line, { owner: true }), more.line);
  assert.notEqual(more.line, pat.line);
  assert.equal((await h.onRoom({ do: "look" }, from(OWNER))).patted, true);
  // Назавтра — снова «не гладили».
  time.add(DAY);
  assert.equal((await h.onRoom({ do: "look" }, from(OWNER))).patted, false);

  // Коробка Байта: сыграл сценку — трофей в коробке; та же сценка второй раз трофея не прибавит.
  const scene = (await h.onRoom({ do: "look" }, from(OWNER))).scene;
  const picked = await h.onRoom({ do: "pick", key: scene.key, pick: 0 }, from(OWNER));
  const [trophy] = room.lootOf([scene.key]);
  assert.ok(trophy && picked.box.count === 1 && picked.box.line.includes(trophy), JSON.stringify(picked.box));
  assert.deepEqual(roomOf(OWNER).loot, [scene.key]);
  const seen = await h.onRoom({ do: "look" }, from(OWNER));
  assert.ok(seen.box.count === 1 && seen.box.line.includes(trophy));
  // В чате — теми же словами, без модели; «покажи трофеи Байта» — не просьба о картинке.
  for (const said of ["что в коробке у Байта?", "покажи трофеи Байта", "что натаскал Байт"]) {
    await h.onMessage(own(said), KEY);
    assert.ok(last(OWNER).includes(trophy), `${said}: ${last(OWNER)}`);
  }
  assert.equal(chats().length, 0, "модель не тратится");
  // Правила трофеев: у каждой сценки — свой; незнакомый ключ — ничего.
  assert.equal(new Set(room.SCENES.map(item => item.loot)).size, room.SCENES.length);
  assert.deepEqual(room.lootOf(["sock", "нет такой", "puddle", 7]), ["носок неизвестного происхождения", "бумажный кораблик"]);
  assert.deepEqual(room.lootOf(null), []);
  // Незнакомое действие — отказ, как и раньше.
  assert.equal((await h.onRoom({ do: "hug" }, from(OWNER))).ok, false);
});

test("комната 0.41.0: день рождения гостя — торт, годовщина — свеча, Рамадан и байрамы — фонарь; погода его города — погода за окном (0.44.0)", async () => {
  // Правила дат.
  assert.deepEqual(room.feastsOf(), { list: [], islam: "", years: 0 });
  assert.deepEqual(room.feastsOf({ birthday: true, days: 730, hijri: { hm: 9, hd: 14 } }), { list: ["birthday", "anniversary", "lantern"], islam: "ramadan", years: 2 });
  for (const [hm, hd, islam] of [[9, 1, "ramadan"], [9, 30, "ramadan"], [10, 1, "fitr"], [10, 3, "fitr"], [10, 4, ""], [12, 9, ""], [12, 10, "adha"], [12, 13, "adha"], [12, 14, ""], [8, 29, ""]]) assert.equal(room.feastsOf({ hijri: { hm, hd } }).islam, islam, `${hd}.${hm}`);
  for (const [days, years] of [[0, 0], [364, 0], [365, 1], [366, 0], [730, 2]]) assert.equal(room.feastsOf({ days }).years, years, String(days));
  assert.deepEqual(room.itemsFor({ feasts: ["birthday"] }), ["торт"]);
  assert.deepEqual(room.itemsFor({ feasts: ["lantern", "anniversary"] }), ["свеча", "фонарь"]);
  assert.deepEqual(room.itemsFor({ feasts: ["чужое"] }), []);

  // Обычный день: праздничных вещей нет.
  reset();
  let now = NOON;
  const h = heart(ON, { now: () => now, random: () => 0 });
  const keysOf = (look) => look.things.map(item => item.key);
  assert.deepEqual(keysOf(await h.onRoom({ do: "look" }, from(5))).filter(key => ["торт", "свеча", "фонарь"].includes(key)), []);

  // День рождения: гость назвал его сам — в этот день у стола торт, и она говорит о нём как о новом.
  sdk().fetchQueue.push(says("Весной, значит."));
  await h.onMessage(message("мой день рождения 5 марта"), KEY);
  await h.onMessage(message("да"), KEY);
  now = Date.parse("2027-03-04T11:00:00Z");
  assert.ok(!keysOf(await h.onRoom({ do: "look" }, from(5))).includes("торт"), "накануне торта нет");
  now = Date.parse("2027-03-05T11:00:00Z");
  const born = await h.onRoom({ do: "look" }, from(5));
  assert.ok(keysOf(born).includes("торт") && born.fresh.includes("торт"), JSON.stringify(keysOf(born)));
  assert.match(born.things.find(item => item.key === "торт").line, /день рождения|днём рождения|день/iu);
  now = Date.parse("2027-03-06T11:00:00Z");
  assert.ok(!keysOf(await h.onRoom({ do: "look" }, from(5))).includes("торт"), "назавтра торта нет");

  // Рамадан: у окна фонарь — и строка называет праздник. День берётся из таблицы хиджры.
  const day = (wanted) => { for (let at = Date.parse("2027-01-01T11:00:00Z"); ; at += DAY) { const date = new Date(at), hijri = hijriOf(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()); if (hijri && wanted(hijri)) return at; } };
  for (const [wanted, name] of [[(hijri) => hijri.hm === 9 && hijri.hd === 10, "Рамадан"], [(hijri) => hijri.hm === 10 && hijri.hd === 1, "Ураза-байрам"], [(hijri) => hijri.hm === 12 && hijri.hd === 10, "Курбан-байрам"]]) {
    reset();
    now = day(wanted);
    const feast = await heart(ON, { now: () => now, random: () => 0 }).onRoom({ do: "look" }, from(5));
    const lantern = feast.things.find(item => item.key === "фонарь");
    assert.ok(lantern && lantern.line.includes(name), `${name}: ${JSON.stringify(feast.things.map(item => item.key))}`);
    assert.ok(!lantern.line.includes("{"), lantern.line);
  }

  // Годовщина знакомства: ровно год — свеча у рамки, и строка говорит «1 год».
  reset();
  now = NOON;
  const long = heart(ON, { now: () => now, random: () => 0 });
  await long.onRoom({ do: "look" }, from(5));
  await long.onMessage(message("привет"), KEY);
  now = NOON + 365 * DAY;
  const year = await long.onRoom({ do: "look" }, from(5));
  const light = year.things.find(item => item.key === "свеча");
  assert.ok(light && /1 год/u.test(light.line) && !light.line.includes("{"), JSON.stringify(year.things.map(item => item.key)));
  now = NOON + 366 * DAY;
  assert.ok(!keysOf(await long.onRoom({ do: "look" }, from(5))).includes("свеча"));

  // Погода (0.44.0, слово владельца): какая в городе человека — такая и за её окном, и слова об окне — о ней. До
  // 0.44.0 за окном шёл дождь, а из погоды города брался один снег («снег в его городе — снег за окном», 0.41.0).
  const forecast = (code) => ({ current: { temperature_2m: -3, apparent_temperature: -7, weather_code: code, wind_speed_10m: 3 }, daily: { temperature_2m_max: [-1, 0, 1], temperature_2m_min: [-6, -5, -3], weather_code: [code, 3, 3], precipitation_probability_max: [80, 10, 5] } });
  const moscow = () => source("geocoding-api.open-meteo.com", { results: [{ name: "Москва", country: "Россия", admin1: "Москва", latitude: 55.7558, longitude: 37.6173, timezone: "Europe/Moscow", feature_code: "PPLC" }] });
  for (const [code, sky] of [[0, "clear"], [1, "clear"], [2, "clouds"], [3, "overcast"], [45, "fog"], [61, "rain"], [80, "rain"], [73, "snow"], [85, "snow"], [95, "storm"]]) {
    reset();
    moscow();
    source("api.open-meteo.com/v1/forecast", forecast(code));
    now = Date.parse("2027-01-15T10:00:00Z");
    const winter = heart({ ...ON, SOURCES: true }, { now: () => now, random: () => 0 });
    await winter.onMessage(own("мой город — Москва"), KEY);
    const out = await winter.onRoom({ do: "look" }, from(OWNER));
    assert.deepEqual([out.sky, out.city], [sky, true], String(code));
    const air = { owner: true, part: out.clock.part, sky };
    assert.ok(fitting(WINDOW[sky], air).includes(out.window), `${code}: ${out.window}`);
    // Слова о дожде — только под дождём: «за окном дождь» при ясном небе владелец и увидел.
    assert.equal(pool("окно", air).includes(out.window), sky === "rain", `${code}: ${out.window}`);
    // И она, и Байт говорят о той же погоде: строки с пометкой другой погоды молчат.
    for (const line of [out.her.line, out.cat.line, ...out.her.beats.map(beat => beat.line), ...out.cat.beats.map(beat => beat.line)]) {
      if (sky !== "rain" && sky !== "storm") assert.doesNotMatch(line, /дожд|капл/iu, `${code}: ${line}`);
      if (sky !== "snow") assert.doesNotMatch(line, /снег|снежин/iu, `${code}: ${line}`);
    }
    // И в чате: зашёл словами — за окном то же.
    await winter.onMessage(own("зайду к тебе"), KEY);
    assert.ok(fitting(WINDOW[sky], air).some(line => last(OWNER).includes(line)), `${code}: ${last(OWNER)}`);
  }
  // Города нет — погоду она выдумывает сама: зимой чаще снег, одна и та же шесть часов подряд; комната открывается.
  reset();
  now = Date.parse("2027-01-15T10:00:00Z");
  const alone = heart({ ...ON, SOURCES: true }, { now: () => now, random: () => 0 });
  const silent = await alone.onRoom({ do: "look" }, from(5));
  assert.deepEqual([silent.ok, silent.sky, silent.city], [true, madeUpSky(5, now, 1), false], "города нет — погода выдумана");
  now += 20 * 60_000;
  assert.equal((await alone.onRoom({ do: "look" }, from(5))).sky, silent.sky, "через двадцать минут небо то же");
  // Город назван, а служба погоды молчит — то же самое: выдуманная погода, а не отказ.
  reset();
  moscow();
  source("api.open-meteo.com/v1/forecast", new Error("сеть"));
  now = Date.parse("2027-01-15T10:00:00Z");
  const deaf = heart({ ...ON, SOURCES: true }, { now: () => now, random: () => 0 });
  await deaf.onMessage(own("мой город — Москва"), KEY);
  const blind = await deaf.onRoom({ do: "look" }, from(OWNER));
  assert.deepEqual([blind.ok, blind.sky, blind.city], [true, madeUpSky(OWNER, now, 1), false], "служба молчит — погода выдумана");
});

test("дверь под «добрым утром» и «спокойной ночи» (0.41.0): кнопка комнаты — когда мини-приложение опубликовано; нет страницы — привет без кнопки", async () => {
  const moscow = () => source("geocoding-api.open-meteo.com", { results: [{ name: "Москва", country: "Россия", admin1: "Москва", latitude: 55.7558, longitude: 37.6173, timezone: "Europe/Moscow", feature_code: "PPLC" }] });
  for (const published of [true, false]) {
    reset();
    moscow();
    let now = Date.parse("2026-11-13T09:00:00Z");
    const h = heart({ ...ON, GREET: true, SOURCES: true }, { now: () => now, random: () => 0 });
    await h.onMessage(own("мой город — Москва"), KEY);
    if (published) await h.tick({ tick: true, deployed: true, page: PAGE }, KEY);
    const before = toOwner().length;
    now = Date.parse("2026-11-14T02:54:00Z"); // 05:54 по Москве — фаджр начался: «доброе утро»
    await h.tick({});
    const morning = toOwner().slice(before).at(-1);
    assert.ok(morning?.text, "утренний привет ушёл");
    const door = morning.reply_markup?.inline_keyboard?.[0]?.[0];
    if (published) assert.deepEqual(door, { text: "🚪 Открыть комнату", web_app: { url: PAGE } });
    else assert.equal(morning.reply_markup, undefined);
    // И под «спокойной ночи».
    const sent = toOwner().length;
    now = Date.parse("2026-11-14T20:10:00Z");
    await h.tick({});
    const night = toOwner().slice(sent).at(-1);
    assert.ok(night?.text, "ночной привет ушёл");
    assert.equal(night.reply_markup?.inline_keyboard?.[0]?.[0]?.web_app?.url, published ? PAGE : undefined);
    assert.equal(chats().length, 0, "модель не тратится");
  }
});

test("страница 0.41.0: позы, погладить, коробка, снег — ответ сердца раскладывается по состоянию страницы", () => {
  const start = logic.blank(12);
  // Пока сердце не ответило, за окном — ровное серое небо (0.44.0): какая там погода, ещё неизвестно.
  assert.deepEqual([start.turn, start.patted, start.sky, start.lines.box], [0, false, "overcast", ""]);
  // Ответ без распорядка (так отвечает сердце до 0.44.0 и витрина с позой, названной в адресе): позы идут по кругу сами.
  const look = logic.demoLook(13, { part: "день", her: "desk", cat: "sit.rug.сыт", scene: "0" });
  const seen = logic.applyLook(start, { ...look, sky: "snow", patted: true, her: { ...look.her, wear: "home" }, box: { count: 1, line: "В коробке — носок." } });
  assert.deepEqual([seen.sky, seen.patted, seen.lines.box, seen.her.wear, seen.turn], ["snow", true, "В коробке — носок.", "home", 0]);
  // Незнакомое небо и незнакомый наряд — как не названные; неба в ответе нет вовсе (прежнее сердце) — дождь, как был.
  const odd = logic.applyLook(start, { ...look, sky: "град", her: { ...look.her, wear: "constructor" } });
  assert.deepEqual([odd.sky, "wear" in odd.her], ["rain", false]);
  const { sky: _, ...skyless } = look;
  assert.equal(logic.applyLook(start, skyless).sky, "rain");
  for (const sky of logic.SKIES) assert.equal(logic.applyLook(start, { ...look, sky }).sky, sky);
  assert.deepEqual([...logic.SKIES].sort(), [...room.SKIES].sort(), "страница и сердце знают одни и те же виды неба");
  // Рисунку: счёт позы — только когда он не ноль; небо — только когда это не дождь (иначе вид комнаты прежний, и
  // лишней перерисовки нет); луна — по дню.
  assert.deepEqual(logic.viewOf(odd), { part: odd.part, her: { pose: "desk", key: odd.her.key }, cat: { shape: "sit", place: "rug", key: "сыт" }, plant: odd.plant, things: odd.things, lamp: odd.lamp, fed: odd.fed, tea: odd.tea, moon: 0.3 });
  const turned = logic.nextTurn(logic.nextTurn(seen));
  assert.equal(turned.turn, 2);
  assert.deepEqual(logic.viewOf(turned).her, { pose: "desk", key: seen.her.key, wear: "home", turn: 2 });
  assert.equal(logic.viewOf(turned).sky, "snow");
  assert.equal(logic.nextTurn({ ...seen, turn: "много" }).turn, 1);
  // Новый заход — поза снова первая.
  assert.equal(logic.applyLook(turned, look).turn, 0);
  // Нажатие на коробку — её слова о трофеях; пусто — молчит.
  assert.equal(logic.applyTap(seen, "box").said, "В коробке — носок.");
  assert.equal(logic.applyTap(start, "box"), null);
  // Погладить: её слова; отметка «гладили» остаётся; отказ — словами, рисунок прежний.
  const patted = logic.applyPat({ ...odd, busy: "pat" }, { ok: true, line: "Ой.", note: "Мы стали ближе." });
  assert.deepEqual([patted.said, patted.patted, patted.busy, patted.tone], ["Ой.\nМы стали ближе.", true, "", ""]);
  const refused = logic.applyPat({ ...odd, busy: "pat" }, { ok: false, text: "Память сейчас недоступна." });
  assert.deepEqual([refused.said, refused.tone, refused.patted, refused.busy], ["Память сейчас недоступна.", "warn", false, ""]);
  // Сыграли сценку — строка о коробке обновилась.
  assert.equal(logic.applyPick(seen, { ok: true, line: "Готово.", scene: null, box: { count: 2, line: "В коробке — носок и кораблик." } }).lines.box, "В коробке — носок и кораблик.");
  assert.equal(logic.applyPick(seen, { ok: true, line: "Готово.", scene: null }).lines.box, "В коробке — носок.");
  // Витрина: погладить — первый раз одни слова, второй — другие; снег — по настройке из адреса.
  const first = logic.demoPat(odd), second = logic.demoPat({ ...odd, patted: true });
  assert.deepEqual([first.ok, first.again, second.again, first.line !== second.line], [true, false, true, true]);
  assert.equal(logic.demoLook(13, { sky: "snow" }).sky, "snow");
  assert.equal(logic.demoLook(13, {}).sky, "rain");
  assert.ok(logic.demoLook(13, {}).box.line);
  assert.equal(logic.PAGE, "18");
});

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
  // На «открой комнату» в группе — кнопка-ссылка в личку с ней (0.41.0): одно нажатие, и там приходит дверь.
  const link = toChat(-10).at(-1).reply_markup?.inline_keyboard?.[0]?.[0];
  assert.match(String(link?.url), /^https:\/\/t\.me\/[A-Za-z0-9_]{4,40}\?start=room$/u, JSON.stringify(toChat(-10).at(-1).reply_markup));
  assert.equal(link.text, "🚪 Открыть комнату — в личке");
  assert.equal(link.web_app, undefined, "кнопку мини-приложения Telegram в группе не примет");
  assert.ok(pool("дверь:личка").some(line => toChat(-10).at(-1).text.startsWith(line)), toChat(-10).at(-1).text);
  // По этой ссылке Telegram шлёт в личку «/start room» — и она сразу открывает дверь, а не здоровается заново.
  const sentBefore = toChat(6).length;
  await h.onMessage(message("/start room", { id: 6 }), KEY);
  const opened = toChat(6).slice(sentBefore).find(item => item.reply_markup?.inline_keyboard?.[0]?.[0]?.web_app);
  assert.ok(opened, JSON.stringify(toChat(6).slice(sentBefore).map(item => item.text?.slice(0, 60))));
  assert.equal(opened.reply_markup.inline_keyboard[0][0].text, "🚪 Открыть комнату");

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

test("страница: папка уходит на платформу файлами (код — без комментариев) — настройки проекта читаются, файлы на месте, лишнего и тяжёлого нет", () => {
  // tgcloud.jsonc: инструмент читает его при каждой отправке — и кода тоже. Ошибка в нём сорвала бы публикацию бота.
  const raw = read("tgcloud.jsonc");
  const config = JSON.parse(raw.split("\n").filter(line => !/^\s*\/\//u.test(line)).join("\n"));
  assert.deepEqual(config, { static: { source: "miniapp" } }, "только то, что нужно: незнакомый платформе ключ сорвал бы отправку страницы");
  assert.ok(!existsSync(new URL("tgcloud.json", ROOT)), "двух файлов настроек инструмент не терпит");
  // Папка: не из тех имён, что не сохраняются и не попадают в коммит.
  assert.ok(!["dist", "build", "out"].includes(config.static.source));
  assert.doesNotMatch(read(".gitignore"), /^\/?miniapp\/?$/mu);
  const folder = new URL("miniapp/", ROOT);
  // 0.49.0: альбом воспоминаний — отдельным модулем (`album.js`): грузится, когда его открыли.
  // 0.53.0: комната картинкой — папка `room` (два модуля: «день» и «пасмурно»; `tests/painted.test.mjs`).
  assert.deepEqual(readdirSync(folder).sort(), ["album.js", "app.js", "her", "index.html", "logic.js", "room", "scene.js", "sound.js"], "в папке — только страница: всё, что в ней лежит, становится публичным");
  const page = ["app.js", "index.html", "logic.js", "scene.js"];
  const total = page.reduce((sum, name) => sum + statSync(new URL(name, folder)).size, 0);
  // Мера — о скорости, а не о платформе: эти четыре файла нужны, чтобы комната открылась. С 0.41.0 в них позы,
  // веки, наряд, новые места нажатий, снег и праздники — предел поднят с 220 до 270 КБ; с 0.44.0 — небо семи видов,
  // кресло, шаги её и Байта, сценка дня на рисунке, своя жизнь и смена часа — с 270 до 340 КБ (по сети это около
  // 90 КБ: текст сжимается вчетверо). Звук и её картинки в предел не входят: они догружаются по ходу дела.
  // С 0.46.0 — лапы Байта, шаг в два кадра, лампа-выключатель, колонка и лист «движение»: с 340 до 360 КБ.
  // С 0.47.0 — свет по солнцу, зов Байта, наряд по просьбе, чай на выбор, тихий час: с 360 до 380 КБ.
  // С 0.48.0 — рисунок по частям, её день на витрине, мимика (покачивание, румянец, взгляд на нажатие, «села —
  // встала»), выбор чая у чайника, окно: с 380 до 420 КБ. Звук — улица и дом, фон за стеклом: с 16 до 20 КБ.
  // С 0.49.0 — номер действия и повтор запроса, журнал ошибок, часы страницы стоят, пока она свёрнута; слой головы,
  // метки-эмоции, новые фигуры Байта, её вещи и подарки: с 420 до 470 КБ. Альбом — отдельным модулем, по нажатию.
  // С 0.51.0 мера — то, что уходит на платформу: телефон убирает из кода страницы комментарии (`scripts/slim.mjs`),
  // как с 0.36.3 убирает их из кода облака. Комментарии — больше трети страницы: с ними четыре файла весили 468 КБ,
  // без них — 306 (сжатые — 79 против 132; сжимает ли платформа текст, не проверено). Взгляд в сторону и ветер
  // (0.51.0) — уже в этих 350: с ними без комментариев 309.
  const sent = page.reduce((sum, name) => { const text = readFileSync(new URL(name, folder), "utf8"); return sum + Buffer.byteLength(name.endsWith(".js") ? slimCode(text) : text); }, 0);
  assert.ok(sent < 350_000, `страница без комментариев весит ${sent} байт — открываться должна сразу`);
  // Не облегчилась (телефон об этом скажет) — уйдёт как лежит: и такая не должна разбухать незаметно.
  assert.ok(total < 560_000, `страница с комментариями весит ${total} байт`);
  assert.ok(statSync(new URL("sound.js", folder)).size < 20_000, "звук — маленький модуль: шум и тон делает сам телефон");
  // Её картинки (0.40.0) — по модулю на спрайт, и ничего больше. Грузится только та, что нужна сейчас (и следующая
  // поза — заранее), поэтому мера у каждой своя; все вместе — чтобы папка не разбухала незаметно: предел растёт
  // вместе с числом картинок, осознанно.
  const pictures = readdirSync(new URL("her/", folder)).sort();
  // 0.53.0: третьи кадры — голова повёрнута (`HER_TURNS`).
  assert.deepEqual(pictures, [...Object.keys(HER_SPRITES), ...FRAMES, ...Object.values(scene.HER_TURNS).map(([name]) => name)].map(name => `${name}.js`).sort(), "в папке картинок — по модулю на каждый спрайт, на каждый второй и третий кадр из рисунка, и ничего больше");
  const weights = pictures.map(name => statSync(new URL(`her/${name}`, folder)).size);
  for (const [index, name] of pictures.entries()) assert.ok(weights[index] < 76_000, `картинка ${name} весит ${weights[index]} байт`);
  assert.ok(weights.reduce((sum, size) => sum + size, 0) < pictures.length * 56_000, `картинки вместе весят ${weights.reduce((sum, size) => sum + size, 0)} байт`);
  for (const name of pictures) assert.match(read(`miniapp/her/${name}`), /^\/\/ Спрайт Аи «[a-z0-9-]+»: собран командой «bash scripts\/verify\.sh sprite …» \(scripts\/room-sprite\.mjs\)\. Руками не править\.\nexport default \{ w: \d+, h: \d+, cx: [\d.]+, (?:(?:blink|smile|lookl|lookr): \{ x: \d+, y: \d+, w: \d+, h: \d+, src: "data:image\/webp;base64,[A-Za-z0-9+/=]+" \}, ){0,4}src: "data:image\/webp;base64,[A-Za-z0-9+/=]+" \};\n$/u, name);
  const files = [...page, ...pictures.map(name => `her/${name}`), ...readdirSync(new URL("room/", folder)).map(name => `room/${name}`)];

  const html = read("miniapp/index.html");
  assert.match(html, /<script src="https:\/\/telegram\.org\/js\/telegram-web-app\.js"><\/script>/u, "без этого скрипта Telegram не даёт странице ни человека, ни связи");
  assert.match(html, /<script type="module" src="\.\/app\.js"><\/script>/u);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1/u);
  assert.match(html, /<svg id="room" viewBox="0 0 400 520"/u);
  // Кладовая её картинок — в самом рисунке, перед комнатой: комната ссылается на картинку по имени.
  assert.match(html, /<svg id="room" [^>]*><defs id="store"><\/defs><g id="inside"><\/g><\/svg>/u);
  assert.equal(`${WIDTH} ${HEIGHT}`, "400 520");
  // Три картинки одна над другой: небо с городом, дождь, комната со слоем нажатий. Дождь лежит ровно по стеклу —
  // числа в стилях те же, что `WIN` в рисунке, — и сдвигается на один шаг пунктира (`RAIN_SHIFT`): иначе он шёл бы
  // рывками или вылезал на стену.
  assert.match(html, /<svg id="sky" viewBox="0 0 400 520"[^>]*><g id="backdrop"><\/g><\/svg>/u);
  const pct = (value) => String(Number(value.toFixed(4)));
  assert.ok(html.includes(`.rainbox { position: absolute; left: ${pct(WIN.x / WIDTH * 100)}%; top: ${pct(WIN.y / HEIGHT * 100)}%; width: ${pct(WIN.w / WIDTH * 100)}%; height: ${pct(WIN.h / HEIGHT * 100)}%; overflow: hidden; pointer-events: none; transition: opacity 0.7s; }`), "дождь — по стеклу");
  // Погода сменилась при открытой странице — слой дождя гаснет и проявляется уже другим (0.44.0); у тех, кто просил
  // не показывать движение, — сразу.
  assert.ok(html.includes(".rainbox.dim { opacity: 0; }") && html.includes(".rainbox { transition: none !important; }"));
  for (const plane of ["far", "near"]) {
    const { x, y, seconds } = RAIN_SHIFT[plane];
    assert.match(html, new RegExp(`<svg class="plane ${plane}" id="rain${plane === "far" ? "Far" : "Near"}" viewBox="0 0 ${WIN.w} ${WIN.h}"`, "u"), plane);
    assert.ok(html.includes(`.rainbox .plane.${plane} { animation: rain-${plane} ${seconds}s linear infinite; }`), plane);
    assert.ok(html.includes(`@keyframes rain-${plane} { to { transform: translate(${pct(x)}%, ${pct(y)}%); } }`), plane);
  }
  for (const id of ["app", "stage", "sky", "rainFar", "rainNear", "room", "backdrop", "inside", "talk", "who", "say", "retry", "scene", "sceneText", "sceneChoice", "scenePicked", "actions", "tools", "sound", "home", "hint", "foot", "teas"]) assert.match(html, new RegExp(` id="${id}"`, "u"), id);
  // Пять кнопок заботы — теми же словами, что знает сердце.
  assert.deepEqual([...html.matchAll(/<button type="button" data-act="([a-z]+)"/gu)].map(found => found[1]), [...logic.CARE]);
  assert.deepEqual([...html.matchAll(/data-pick="([01])"/gu)].map(found => found[1]), ["0", "1"]);
  // Спрятанное спрятано, какой бы display ни задал стиль: иначе сыгранная сценка оставалась бы с кнопками.
  assert.match(html, /\[hidden\] \{ display: none !important; \}/u);
  // Движение отключается у тех, кто просил его не показывать, — всё: и рисунок, и небо, и дождь целиком.
  const calm = /@media \(prefers-reduced-motion: reduce\) \{\s*([^{}]+)\{ animation: none !important; \}/u.exec(html)?.[1].split(",").map(item => item.trim()) ?? [];
  for (const selector of ["#room *", "#sky *", ".rainbox *"]) assert.ok(calm.includes(selector), `движение не отключается у «${selector}»`);
  // Движение живёт в двух местах: рисунок вешает класс, стили страницы его двигают. Переименуй одно без другого —
  // и хвост замрёт, а тесты промолчат. Поэтому: у каждого класса из рисунка, кроме неподвижных, есть правило,
  // и каждое правило для рисунка относится к классу, который рисунок в самом деле ставит.
  const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
  // Имена классов — с дефисом тоже (0.49.0: `g-tilt`, `look-l`, `e-bang`, `m-tired`).
  const styled = new Set([...css.matchAll(/(?:#room|#sky)((?: ?\.[a-z][a-z0-9-]*)+)/gu)].flatMap(found => found[1].match(/[a-z][a-z0-9-]*/gu)));
  const classes = new Set();
  let turn = 0;
  const cats = ["шалит", "сыт", "обижен", "игра"];
  const collect = (view) => { for (const found of drawRoom(view).matchAll(/class="([^"]+)"/gu)) for (const name of found[1].split(" ")) classes.add(name); };
  for (const part of PARTS) for (const pose of HER_POSES) {
    turn += 1;
    collect({ part, her: { pose, key: "уют" }, cat: { shape: CAT_SHAPES[turn % CAT_SHAPES.length], place: CAT_PLACES[turn % CAT_PLACES.length], key: cats[turn % cats.length] }, things: [...THINGS], tea: true, fed: true });
  }
  for (const [shape, place] of [["claw", "chair"], ["play", "rug"], ["eat", "bowl"], ["curl", "pillow"], ["walk", "near"]]) collect({ part: "вечер", her: { pose: "desk", key: "дело" }, cat: { shape, place, key: "шалит" }, things: [] });
  // Она картинкой приносит три своих класса: «веки» (моргает) и пару для смены позы (прежняя тает, новая
  // проявляется). Всё остальное, что при ней движется, движется прежними правилами.
  const before = new Set(classes);
  const gather = (view, options = PAINTED) => { for (const found of drawRoom(view, options).matchAll(/class="([^"]+)"/gu)) for (const name of found[1].split(" ")) classes.add(name); };
  for (const part of ["день", "ночь"]) for (const key of Object.keys(MOODS)) for (const turn of [0, 1, 2]) gather({ part, her: { pose: "chair", key, turn }, cat: { shape: "sit", place: "near", key: "сыт" }, things: [...THINGS] });
  gather({ part: "день", her: { pose: "desk", key: "дело", turn: 1 }, things: [] }, { ...PAINTED, was: { name: "work", x: 252 } });
  // С 0.44.0 — ещё «alive»: картинка дышит.
  // С 0.48.0 — «lean» (стоя покачивается) и «blush» (румянец под глазами, невидимый до ласки).
  // С 0.49.0 — три слоя движения: слой мимики («mim») с настроением («m-…»), слой головы («hd») и концы волос
  // («hr»), метки-эмоции («emo», «e-…»): невидимы, пока страница не покажет жест.
  assert.deepEqual([...classes].filter(name => !before.has(name)).sort(), ["alive", "arrive", "blush", "e-ask", "e-bang", "e-drop", "e-huff", "e-zz", "emo", "eyl", "eyr", "grin", "hd", "hr", "lean", "leave",
    ...Object.values(MOODS).map(mood => `m-${mood}`), "mim", "wink"].sort());
  // Своя жизнь (0.44.0): она идёт от места к месту, входит и уходит к шкафу; Байт идёт сам; на её месте — надпись.
  const lived = new Set(classes);
  gather({ part: "день", her: { pose: "shelf", key: "дело", beat: true }, cat: { shape: "sit", place: "bowl", key: "сыт" }, things: [] }, { ...PAINTED, was: { name: "work", x: 252 }, catWas: { x: 300, y: 456, shape: "sit", mirror: false, k: 1 } });
  gather({ part: "вечер", her: { pose: "chair", key: "уют", beat: true }, things: [] }, { ...PAINTED, enter: true });
  gather({ part: "вечер", her: { pose: "desk", key: "дело", away: true }, things: [] }, { ...PAINTED, was: { name: "work", x: 252 } });
  // С 0.55.0 Байт обходит её: шёл бы у самых её ног — путь в два отрезка (`seg`), за её ногами.
  gather({ part: "день", her: { pose: "desk", key: "дело", beat: true }, cat: { shape: "sit", place: "near", key: "сыт" }, things: [] }, { ...PAINTED, catWas: { x: 330, y: 497, shape: "sit", mirror: false, k: 1 } });
  // С 0.46.0 Байт идёт лапами: `pad` — тело, `lg` — часть лапы (`up`, `low`), `p0`–`p3` — которой по счёту она ступает.
  // С 0.48.0 — «lower»: вошла и села — опускается в кресло.
  assert.deepEqual([...classes].filter(name => !lived.has(name)).sort(), ["changing", "late", "lg", "low", "lower", "p0", "p1", "p2", "p3", "pad", "seg", "step", "stride", "up"]);
  // Вторые кадры поз (0.45.0): слои кадров и вид их движения — когда кадр загружен.
  const framed = new Set(classes);
  const withFrames = { sprites: { ...SPRITES, ...FRAME_SPRITES } };
  gather({ part: "день", her: { pose: "chair", key: "уют", beat: true }, things: [] }, withFrames);
  gather({ part: "день", her: { pose: "desk", key: "дело", beat: true }, things: [] }, withFrames);
  gather({ part: "вечер", her: { pose: "dance", key: "игра", beat: true }, things: [] }, withFrames);
  // 0.46.0: шаг в два кадра — `pace`.
  gather({ part: "день", her: { pose: "desk", key: "дело", beat: true }, things: [] }, { ...withFrames, was: { name: "work", x: 100 } });
  // 0.49.0: взмах метёлкой и ленточкой — `sweep`.
  gather({ part: "день", her: { pose: "dust", key: "дело", beat: true }, things: [] }, withFrames);
  // С 0.48.0 — «lk» и «nl»: на каком кадре она смотрит на зрителя, а на каком нет.
  assert.deepEqual([...classes].filter(name => !framed.has(name)).sort(), ["a", "b", "dance", "fr", "glance", "lk", "nl", "pace", "sip", "sweep"]);
  // 0.53.0: третий кадр — голова повёрнута: слой `c`; в какую сторону она на нём смотрит — словом на группе (`tl`, `tr`).
  const turned = new Set(classes);
  const withTurns = { sprites: { ...SPRITES, ...FRAME_SPRITES, ...TURN_SPRITES } };
  gather({ part: "день", her: { pose: "desk", key: "дело", beat: true }, things: [] }, withTurns);
  gather({ part: "вечер", her: { pose: "desk", key: "дело", beat: true, wear: "home" }, things: [] }, withTurns);
  assert.deepEqual([...classes].filter(name => !turned.has(name)).sort(), ["c", "tl", "tr"]);
  // Мимика 0.48.0: встаёт из кресла («rise»), клюёт носом («slow»), Байт замечает, что она подошла («notice», «hop», «mark»).
  const mimed = new Set(classes);
  gather({ part: "день", her: { pose: "desk", key: "дело", beat: true }, things: [] }, { ...PAINTED, was: { name: "tea3", x: 196 } });
  gather({ part: "вечер", her: { pose: "read", key: "уют", beat: true, face: "drowsy" }, things: [] });
  gather({ part: "день", her: { pose: "shelf", key: "дело", beat: true }, cat: { shape: "sit", place: "bowl", key: "сыт" }, things: [] }, { ...PAINTED, was: { name: "work", x: 252 } });
  assert.deepEqual([...classes].filter(name => !mimed.has(name)).sort(), ["hop", "mark", "notice", "rise", "slow"]);
  // Сценка дня на рисунке и небо по погоде: у каждой перемены и у каждого неба — свои классы.
  const staged = new Set(classes);
  for (const name of scene.SCENE_FX) gather({ part: "день", her: { pose: "desk", key: "дело" }, cat: { shape: "belly", place: "near", key: "ласка" }, things: [...THINGS], fx: [name] });
  const shown = [...classes].filter(name => !staged.has(name)).sort();
  // Лампочка, что «решила жить своей жизнью», — класс на самой лампочке; плед, который Байт утащил, просто исчезает с
  // кресла; остальные перемены — своей группой. Что в них движется: кораблик покачивается, пар от чайника плывёт.
  // 0.49.0: окно открыто (сценкой или нажатием) — шторы ходят от сквозняка («breeze»).
  assert.deepEqual(shown, ["breeze", "fx", ...scene.SCENE_FX.filter(name => name !== "blink" && name !== "noplaid").map(name => `fx-${name}`), "rogue", "float", "mist", "m0", "m1", "m2"].sort());
  const plaid = (fx) => zonesOf(drawInside({ part: "день", her: { pose: "desk", key: "дело" }, things: [...THINGS], fx }, PAINTED)).some(zone => zone.act === "thing:плед");
  assert.deepEqual([plaid([]), plaid(["noplaid"])], [true, false], "плед унесён — на кресле его нет, и нажать на него нельзя");
  const skied = new Set(classes);
  for (const part of PARTS) for (const sky of scene.SKIES) gather({ part, sky, her: null, things: [] });
  assert.deepEqual([...classes].filter(name => !skied.has(name)).sort(), SKY_CLASSES);
  // 0.49.0. Её картинка ещё в пути — на её месте силуэт с тремя точками (первая точка — без своей задержки).
  const waited = new Set(classes);
  gather({ part: "день", her: { pose: "desk", key: "дело" }, things: [] }, { sprites: {} });
  assert.deepEqual([...classes].filter(name => !waited.has(name)).sort(), ["coming", "d0", "d1", "d2", "dot"]);
  const still = new Set(["art", "zones", "backdrop", "frame", "glow", "dusk", "city", "rain", "snow", "far", "near", "b0", "s0", "d0", "m-calm", "m-smile", "fx", ...scene.SCENE_FX.map(name => `fx-${name}`), ...SKY_STILL, ...CAT_SHAPES]);
  assert.deepEqual([...classes].filter(name => !styled.has(name) && !still.has(name)).sort(), [], "класс в рисунке есть, а правила в стилях нет");
  // «fading» ставит не рисунок, а сама страница — на копию прежнего слоя: она тает поверх нового, когда час или
  // погода сменились при открытой комнате (0.44.0).
  assert.match(read("miniapp/app.js"), /copy\.setAttribute\("class", "fading"\)/u);
  // Мимику по нажатию (0.48.0) тоже ставит страница — на сам рисунок комнаты, на короткое время: «poked» — нажали на
  // неё, «patted» — погладили, «glad» — налили чай.
  for (const name of ["poked", "patted", "glad"]) assert.match(read("miniapp/app.js"), new RegExp(`react\\("${name}", \\d+\\)`, "u"), name);
  // Жесты 0.49.0 — тоже слова страницы на рисунке: наклон головы, взгляд в сторону, вздох, метки-эмоции (`gesture`,
  // `lookAt` в app.js; какой жест — `logic.gestureOf`).
  const GESTURE_WORDS = ["peek", "look-l", "look-r", "g-ask", "g-bang", ...logic.GESTURES.filter(name => !["peek", "look-cat", "look-win"].includes(name)).map(name => `g-${name}`)];
  for (const name of logic.GESTURES.filter(word => !["peek", "look-cat", "look-win"].includes(word))) assert.ok(styled.has(`g-${name}`), `жест «${name}»: правило в стилях`);
  // «eyl» — взгляд влево: с 0.52.0 картинки есть (work, tea и их пары в свитере) — исключением он больше не числится.
  assert.deepEqual([...styled].filter(name => !classes.has(name) && !["fading", "poked", "patted", "glad", ...GESTURE_WORDS].includes(name)).sort(), [], "правило в стилях есть, а рисунок такого класса не ставит");
  for (const name of ["breath", "blink", "slide", "bulb", "tailwag", "steam", "zzz"]) assert.ok(classes.has(name) && styled.has(name), name);
  // Правило с классом из рисунка действует только внутри рисунка (`#room`, `#sky`) — или на сам слой дождя
  // (`.plane.far`, `.plane.near`). У струй внутри слоя те же классы `far` и `near`: правило `.rainbox .far` двигало
  // и слой, и струи — дождь шёл вдвое быстрее, а верх окна пустел на каждом обороте (найдено до выпуска 0.39.0).
  for (const rule of css.replace(/\/\*[\s\S]*?\*\//gu, "").matchAll(/([^{}@]+)\{[^{}]*\}/gu)) for (const selector of rule[1].split(",")) {
    const used = [...selector.matchAll(/\.([a-z][a-z0-9]*)/gu)].map(found => found[1]).filter(name => classes.has(name));
    if (!used.length || /#room|#sky/u.test(selector)) continue;
    // Снег (0.41.0) и гроза (0.44.0) — те же два слоя: правило по-прежнему только для самого слоя, а не для хлопьев
    // и струй внутри него.
    assert.match(selector.trim(), /^\.rainbox(?:\[data-sky="(?:snow|storm)"\])? \.plane\.(?:far|near)$/u, `правило «${selector.trim()}» заденет части рисунка с классом «${used.join("», «")}»`);
  }
  // Класс движения не стоит на части с собственным сдвигом: стиль заменил бы сдвиг, и часть уехала бы в угол.
  const moving = [...styled].filter(name => name !== "tap" && name !== "cat");
  for (const view of [{ part: "вечер", her: { pose: "dance", key: "игра" }, cat: { shape: "play", place: "rug", key: "игра" }, things: [...THINGS], tea: true }, { part: "ночь", her: { pose: "nap", key: "сон" }, cat: { shape: "claw", place: "chair", key: "шалит" }, things: [] }]) {
    for (const tag of [...drawRoom(view).matchAll(/<[a-z]+ ((?:"[^"]*"|[^<>"])*)>/gu), ...drawInside(view, PAINTED).matchAll(/<[a-z]+ ((?:"[^"]*"|[^<>"])*)>/gu)]) {
      const names = /class="([^"]+)"/u.exec(tag[1])?.[1].split(" ") ?? [];
      if (names.some(name => moving.includes(name))) assert.doesNotMatch(tag[1], /(?:^| )transform="/u, names.join("."));
    }
  }
  // Чужих скриптов, стилей и картинок нет: кроме скрипта Telegram страница ничего не тянет со стороны.
  const outside = [...html.matchAll(/(?:src|href)="(https?:[^"]+)"/gu)].map(found => found[1]);
  assert.deepEqual(outside, ["https://telegram.org/js/telegram-web-app.js"]);

  const app = read("miniapp/app.js");
  assert.deepEqual([...app.matchAll(/^import .+ from "([^"]+)";$/gmu)].map(found => found[1]), ["./scene.js", "./logic.js"]);
  // Имена из своих модулей страница берёт целиком (`import * as`), а не по одному. После новой публикации браузер
  // может какое-то время держать старую копию любого из четырёх файлов; импорт по имени, которого в старой копии
  // нет, не даёт странице запуститься вовсе — так в 0.39.0 новый `app.js` падал рядом с прежним `scene.js`.
  // Всё, что появилось после первой публикации, перед вызовом проверяется. Смеси файлов открывает
  // `bash scripts/verify.sh page` (шаг 5).
  assert.match(app, /^import \* as scene from "\.\/scene\.js";$/mu);
  assert.match(app, /^import \* as logic from "\.\/logic\.js";$/mu);
  assert.doesNotMatch(app, /^import \{/mu, "импорт по именам: старая копия модуля остановит страницу");
  assert.match(app, /const layer = \$\(id\);\s+if \(layer && drawRain\) layer\.innerHTML = drawRain\(light, plane, sky\);/u, "слой дождя и `drawRain` проверяются перед вызовом");
  // Свет по солнцу (0.47.0): `scene.lightIn` — новое имя; прежний `scene.js` его не знает — тогда свет по часам.
  assert.match(app, /const lightIn = \(view\) => \(typeof scene\.lightIn === "function" \? scene\.lightIn\(view\) : view\.part\);/u, "`lightIn` проверяется перед вызовом");
  assert.doesNotMatch(app, /logic\.lightOf|\blightOf\b/u, "`lightOf` — новое имя раскладки: странице оно не нужно, свет она берёт из описания рисунка");
  // Снег (0.41.0): те же слои; шаг и время оборота в стилях — те же числа, что `SNOW_SHIFT` в рисунке.
  for (const plane of ["far", "near"]) {
    const { x, y, seconds } = SNOW_SHIFT[plane];
    assert.ok(html.includes(`.rainbox[data-sky="snow"] .plane.${plane} { animation: snow-${plane} ${seconds}s linear infinite; }`), plane);
    assert.ok(html.includes(`@keyframes snow-${plane} { to { transform: translate(${pct(x)}%, ${pct(y)}%); } }`), plane);
    // Узор хлопьев повторяется через этот шаг: слой, съехав на него, совпадает сам с собой.
    const flakes = [...drawRain("день", plane, "snow").matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.]+)"\/>/gu)].map(found => found.slice(1).map(Number));
    assert.ok(flakes.length >= 20, `${plane}: хлопьев ${flakes.length}`);
    const dx = x / 100 * WIN.w, dy = y / 100 * WIN.h, has = ([fx, fy, r]) => flakes.some(([ox, oy, or]) => Math.abs(ox - fx) < 0.11 && Math.abs(oy - fy) < 0.11 && or === r);
    // Каждое хлопье, что видно в окне, после сдвига на шаг встаёт на место другого такого же.
    for (const [fx, fy, r] of flakes.filter(([fx, fy]) => fx >= 0 && fx <= WIN.w && fy >= 0 && fy <= WIN.h - dy)) assert.ok(has([fx + dx, fy + dy, r]), `${plane}: хлопье ${fx}, ${fy} после шага остаётся без пары`);
    assert.ok(drawRain("вечер", plane, "snow").includes(`<g class="snow ${plane}" `) && !drawRain("вечер", plane, "snow").includes("<path"), plane);
    assert.ok(drawRain("вечер", plane).includes(`<g class="rain ${plane}" `) && drawRain("вечер", plane, "что-то").includes(`<g class="rain ${plane}" `), "незнакомое небо — дождь");
  }
  assert.match(app, /if \(layer\?\.parentElement\) layer\.parentElement\.dataset\.sky = sky;/u);
  assert.ok(drawBackdrop("день", "snow") !== drawBackdrop("день") && drawBackdrop("день", "rain") === drawBackdrop("день"));
  assert.equal(wellFormed(drawRoom({ part: "ночь", her: { pose: "desk", key: "уют" }, sky: "snow", things: [...THINGS] }, PAINTED)), "");
  assert.match(read("scripts/verify.sh"), /previous_page\(\) \{/u);
  assert.match(app, /Serverless\.call\("room", /u, "страница зовёт функцию комнаты по имени файла в tgcloud/endpoints");
  assert.ok(existsSync(new URL("tgcloud/endpoints/room.js", ROOT)));
  // Настройки витрины из адреса — только на своей машине: иначе ссылкой можно вложить ей в уста чужие слова.
  assert.match(app, /const params = local \? /u);
  assert.match(app, /localhost\|127/u);
  // Текст на страницу попадает текстом, а не разметкой: рисунок — единственное, что вставляется как разметка.
  // С 0.48.0 комната рисуется по частям: разметкой вставляются части рисунка (`scene.drawParts`) — и только они.
  const markupWrites = [...app.matchAll(/\.innerHTML = ([^;]+);/gu)].map(found => found[1].trim());
  const drawnParts = (value) => /^moving\.(?:parts|inks)\[index\]$/u.test(value) || value === "moving.zones"
    || value === '`<g class="art" pointer-events="none"><defs>${moving.inks.join("")}</defs>${moving.parts.map(piece => `<g>${piece}</g>`).join("")}</g><g class="zones">${moving.zones}</g>`';
  assert.deepEqual(markupWrites.filter(value => !/^draw(?:Backdrop|Rain|Inside|Sprite|Picture)\(/u.test(value) && !value.startsWith("'<svg ") && !drawnParts(value)), []);
  assert.ok(markupWrites.some(drawnParts), "рисунок по частям на странице есть");
  assert.match(app, /const still = scene\.drawParts\(view, calm\), moving = options \? scene\.drawParts\(view, options\) : still;/u, "части рисунка — только из рисунка");
  // Её картинки (0.40.0): модуль грузится по имени из рисунка и только когда нужен; новые имена рисунка перед
  // вызовом проверяются (рядом может лежать прежний `scene.js`). С 0.52.0 (сообщение 53): не пришла — она НЕ
  // нарисована кодом, на её месте силуэт, а страница просит картинку снова; кодом — только если картинка пришла,
  // а показать её телефон не может.
  assert.match(app, /const canPaint = typeof spriteOf === "function" && typeof drawSprite === "function";/u);
  assert.match(app, /if \(!canPaint \|\| !name \|\| asked\.has\(name\)\) return;/u);
  assert.match(app, /import\(`\.\/her\/\$\{name\}\.js`\)/u);
  assert.doesNotMatch(app, /SPRITE_WAIT_MS|clearTimeout\(late\)/u, "срока, после которого её рисует код, больше нет");
  assert.match(app, /const SPRITE_AGAIN_MS = Object\.freeze\(\[2_000, 5_000, 12_000, 25_000, 60_000\]\);/u);
  assert.match(app, /if \(error\?\.message === "empty" \|\| error\?\.message === "unreadable"\) \{ settle\(name, false\); return; \}/u, "кодом — только когда картинку не показать");
  assert.match(app, /const wait = SPRITE_AGAIN_MS\[attempt\];\n\s+if \(wait === undefined\) \{ note\("картинка", "late", name\); asked\.delete\(name\); return; \}\n\s+sooner\.set\(name, \[setTimeout\(\(\) => loadSprite\(name, attempt \+ 1, ""\), wait\), attempt \+ 1\]\);/u, "не пришла — просит снова, а потом пишет в журнал");
  assert.match(app, /\(attempt \? import\(`\.\/her\/\$\{name\}\.js\?again=\$\{attempt\}`\) : import\(`\.\/her\/\$\{name\}\.js`\)\)/u, "повторная просьба — под другим адресом");
  // Память телефона (0.52.0): последние восемь картинок — в `localStorage`, под номером страницы; всё в try/catch.
  assert.match(app, /const HER_KEY = `ai-room-her:\$\{PAGE\}:`, HER_LIST = "ai-room-her", HER_KEPT = 8;/u);
  assert.match(app, /if \(kept\) \{ if \(JSON\.stringify\(sprite\) !== kept && await decoded\(sprite\)\) keepSprite\(name, sprite\); return; \}/u, "картинка из памяти уже на рисунке: новая — в следующий заход");
  assert.match(app, /tardy \? "картинка Аи ещё в пути" : ""/u);
  // Модуль пришёл, а картинку в нём браузер показать не может (не знает формата, страница не даёт) — это тоже
  // «не загрузилась»: иначе рисунок сослался бы на картинку, которой не видно, и её в комнате не было бы вовсе.
  // Так и было до выпуска 0.40.0: ошибка разбора картинки проглатывалась. Случай открывает `verify.sh page` (шаг 6).
  assert.match(app, /image\.onerror = \(\) => resolve\(false\);/u);
  assert.match(app, /if \(!\(image\.naturalWidth > 0\)\) \{ resolve\(false\); return; \}/u);
  assert.match(app, /if \(!\(await decoded\(sprite\)\)\) throw new Error\("unreadable"\);/u);
  assert.match(read("scripts/room-check.mjs"), /"картинка пришла, но не читается"/u);
  // Рисунку отдаётся, что уже загружено и кто где был на прежнем рисунке (0.44.0: до нового места она и Байт доходят
  // шагом); страница без картинок (рядом прежний `scene.js`) рисует её кодом.
  // С 0.53.0 — и картинка комнаты (`room`), если она уже здесь.
  assert.match(app, /const options = canPaint \? \{\s+sprites, \.\.\.\(picture \? \{ room: picture \} : \{\}\), \.\.\.\(before\?\.her \? \{ was: before\.her \} : \{\}\), \.\.\.\(before\?\.cat \? \{ catWas: before\.cat \} : \{\}\), \.\.\.\(state\.entering \? \{ enter: true \} : \{\}\),\s+\} : undefined;/u);
  // С 0.48.0 комната меняется по частям (`putInside`); рядом прежний `scene.js` без `drawParts` — целиком, как раньше.
  assert.match(app, /const fresh = putInside\(view, options, renew\);/u);
  assert.match(app, /if \(typeof scene\.drawParts !== "function"\) \{\s+inside\.innerHTML = drawInside\(view, options\);/u);
  assert.deepEqual([...app.matchAll(/\bimport\(([^)]+)\)/gu)].map(found => found[1]), ['"./sound.js"', "`./her/${name}.js?again=${attempt}`", "`./her/${name}.js`", "`./room/${name}.js?again=${attempt}`", "`./room/${name}.js`", '"./album.js"'], "страница грузит по ходу дела только её картинки, картинки комнаты (0.53.0), звук и альбом (0.49.0)");
  // Позы (0.41.0): смена — только когда следующая картинка уже здесь; новые имена рисунка и логики перед вызовом
  // проверяются (рядом может лежать прежняя копия любого из файлов).
  assert.match(app, /const canTurn = canPaint && typeof spritesOf === "function" && typeof nextTurn === "function";/u);
  assert.match(app, /if \(!sprites\[next\]\) \{ fetchSprite\(next\); return false; \}/u);
  // Кто где на рисунке — у нового рисунка (`castOf`, 0.44.0: она и Байт); у прежнего — только она (`spriteStand`).
  assert.match(app, /if \(typeof castOf === "function"\) return castOf\(view, \{ sprites \}\);\s+const stood = typeof spriteStand === "function" \? spriteStand\(view\) : null;/u);
  // Своя жизнь и смена часа (0.44.0): новые имена логики и рисунка перед вызовом проверяются — рядом может лежать
  // прежняя копия любого из файлов, и тогда комната живёт по-старому, но открывается.
  assert.match(app, /const canBeat = typeof nextBeat === "function";/u);
  assert.match(app, /const canTick = typeof applyTick === "function" && typeof changeOf === "function";/u);
  assert.match(app, /const strider = canPaint && typeof walkOf === "function" \? walkOf\(viewOf\(state\)\) : null;/u);
  assert.match(app, /const SKY_NAMES = Array\.isArray\(logic\.SKIES\) \? logic\.SKIES : \["rain", "snow"\];/u);
  assert.match(app, /if \(typeof applyPat !== "function" \|\| typeof demoPat !== "function"\) \{ act\("her"\); return; \}/u);
  // Звук (0.41.0): по умолчанию тихо; включается нажатием; модуль грузится тогда же; чего нет в прежней разметке
  // (кнопки звука, кнопки «на главный экран», строки с ними) — того страница не трогает.
  assert.match(app, /let sound = null, soundOn = false, soundBusy = false;/u);
  assert.match(app, /\$\("sound"\)\?\.addEventListener\("click"/u);
  assert.match(app, /const button = \$\("home"\);\s+if \(!button \|\| !tg \|\| typeof tg\.addToHomeScreen !== "function" \|\| typeof tg\.checkHomeScreenStatus !== "function"\) return;/u);
  assert.match(app, /const tools = \$\("tools"\);\s+if \(tools\) tools\.hidden = !state\.ready;/u);
  const sound = read("miniapp/sound.js");
  assert.match(sound, /^export function createSound\(\) \{$/mu);
  assert.doesNotMatch(sound, /\bimport\b|fetch\(|new Audio\(|\.mp3|\.ogg|\.wav|https?:/u, "звук делает сам телефон: ни файлов, ни сети");
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

test("ветер (0.51.0): сила — из погоды города; сильный — слова об окне о нём; поле в ответе — только когда дует", async () => {
  const forecast = (code, wind) => ({ current: { temperature_2m: 5, apparent_temperature: 2, weather_code: code, wind_speed_10m: wind }, daily: { temperature_2m_max: [6, 5, 4], temperature_2m_min: [1, 0, -1], weather_code: [code, 3, 3], precipitation_probability_max: [10, 10, 5] } });
  const moscow = () => source("geocoding-api.open-meteo.com", { results: [{ name: "Москва", country: "Россия", admin1: "Москва", latitude: 55.7558, longitude: 37.6173, timezone: "Europe/Moscow", feature_code: "PPLC" }] });
  const gale = read("PHRASES.txt").split("== +комната:окно:ветер ==\n")[1].split("\n\n")[0].split("\n").map(line => line.replace(/^\[[^\]]+\] /u, ""));
  assert.ok(gale.length >= 5);
  // Ветер бывает при любом небе и при любом окне: в его словах нет ни дождя, ни солнца, ни снега, ни «открыто».
  for (const line of gale) assert.doesNotMatch(line, /дожд|снег|солн|ясн|туман|гроз|молни|открыт|закрыт/iu, line);
  for (const [code, wind, level, sky] of [[3, 2.5, 0, "overcast"], [3, 4, 1, "overcast"], [2, 7.9, 1, "clouds"], [0, 8, 2, "clear"], [3, 14, 2, "overcast"], [95, 1, 2, "storm"], [73, 9, 2, "snow"]]) {
    reset();
    moscow();
    source("api.open-meteo.com/v1/forecast", forecast(code, wind));
    const at = Date.parse("2027-04-15T10:00:00Z");
    const windy = heart({ ...ON, SOURCES: true }, { now: () => at, random: () => 0 });
    await windy.onMessage(own("мой город — Москва"), KEY);
    const out = await windy.onRoom({ do: "look" }, from(OWNER));
    assert.deepEqual([out.sky, out.city, out.wind], [sky, true, level || undefined], `${code}, ${wind} м/с`);
    assert.equal(Object.hasOwn(out, "wind"), level > 0, "поле есть, только когда дует: прежняя страница его не ждёт");
    // Сильный ветер — слова о нём; в грозу — слова грозы; слабее — слова о небе.
    assert.equal(gale.includes(out.window), level === 2 && sky !== "storm", `${code}, ${wind} м/с: ${out.window}`);
    // Страница: слово о ветре доходит до её состояния.
    assert.equal(logic.applyLook(logic.blank(13), out, at).wind, level);
  }
  // Города нет — ветра нет: выдумывать его не из чего (кроме грозы — она без ветра не бывает).
  reset();
  const calm = heart(ON, { now: () => Date.parse("2027-04-15T10:00:00Z"), random: () => 0 });
  const out = await calm.onRoom({ do: "look" }, from(5));
  assert.deepEqual([out.city, out.wind], [false, out.sky === "storm" ? 2 : undefined]);
});

