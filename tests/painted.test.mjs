/**
 * Комната картинкой (0.53.0, идея 202) и поворот головы третьим кадром (идея 185).
 *
 * Сообщение 53: «Как мы можешь обновить комнату? Именно саму комнату» — владелец выбрал эскиз, и комната написана
 * художником. Здесь — то, что можно сторожить без браузера: модули картинок на месте и нужного вида; рисунок с
 * картинкой ссылается на неё, а не рисует стены кодом; вещи человека встают с листа, только если они у него есть;
 * всё живое — небо, она, Байт, пар, огни — остаётся; негодная картинка не принимается, и комната рисуется кодом.
 * Как это выглядит и работает в браузере — `bash scripts/verify.sh page`, шаг «6а».
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const scene = await import("../miniapp/scene.js");
const day = (await import("../miniapp/room/day.js")).default, dull = (await import("../miniapp/room/dull.js")).default;
const ALL = ["рисунок", "календарь", "снимок", "кружка", "подушка", "место", "кактус", "плед", "кресло", "абажур", "тапочки"];
const view = (extra = {}) => ({ part: "день", sky: "clear", plant: "wet", her: { key: "уют", pose: "shelf", beat: true }, cat: { shape: "sit", place: "sill", key: "сыт" }, things: ALL, ...extra });
const art = (described, options) => { const made = scene.drawParts(described, options); return { parts: made.parts, text: made.parts.join(""), inks: made.inks.join(""), zones: made.zones }; };
/** Какие вещи с листа стоят на рисунке: по месту вещи на листе (`viewBox`). */
const shownThings = (text, room) => Object.entries(room.things.at).filter(([, [ax, ay, aw, ah]]) => text.includes(`viewBox="${ax} ${ay} ${aw} ${ah}"`)).map(([name]) => name).sort();

test("комната картинкой: два модуля — «день» и «пасмурно», собраны сценарием, нужного вида и веса", () => {
  assert.deepEqual(readdirSync(new URL("miniapp/room/", ROOT)).sort(), ["day.js", "dull.js"]);
  for (const [name, room] of [["day", day], ["dull", dull]]) {
    const text = read(`miniapp/room/${name}.js`);
    assert.match(text, /^\/\/ Комната картинкой \(идея 202\)\. Модуль собран `scripts\/room-paint\.mjs` и руками не правится: он и есть оригинал\.\n(?:\/\/ [^\n]*\n){3}export default \{"v":1,"name":"[a-z]+","w":800,"h":1040,"src":"data:image\/webp;base64,[A-Za-z0-9+/=]+","things":\{"w":\d+,"h":\d+,"src":"data:image\/webp;base64,[A-Za-z0-9+/=]+","at":\{[^{}]+\}\},"bulbs":\[[^\n]+\]\};\n$/u, name);
    assert.equal(room.name, name);
    // Грузится после первой отрисовки и остаётся в памяти телефона; мера — чтобы не разбухала незаметно.
    assert.ok(statSync(new URL(`miniapp/room/${name}.js`, ROOT)).size < 170_000, `${name}: ${statSync(new URL(`miniapp/room/${name}.js`, ROOT)).size} байт`);
    assert.equal(scene.roomOf({ room }), room, "рисунок принимает картинку");
    // Вещи: у каждой — место на листе и место в комнате, внутри листа и внутри рисунка.
    assert.deepEqual(Object.keys(room.things.at).sort(), ["bed", "boxFront", "lamp", "plant", "stool", "кактус", "календарь", "кресло", "кружка", "место", "плед", "подушка", "рисунок", "снимок", "тапочки"]);
    for (const [thing, [ax, ay, aw, ah, x, y, w, h]] of Object.entries(room.things.at)) {
      assert.ok(ax >= 0 && ay >= 0 && ax + aw <= room.things.w && ay + ah <= room.things.h, `${name}/${thing}: на листе`);
      assert.ok(x >= 0 && y >= 0 && x + w <= scene.WIDTH + 0.5 && y + h <= scene.HEIGHT + 0.5, `${name}/${thing}: в комнате`);
      // Лист вдвое крупнее рисунка.
      assert.ok(Math.abs(aw / 2 - w) <= 0.5 && Math.abs(ah / 2 - h) <= 0.5, `${name}/${thing}: масштаб`);
    }
    // Гирлянда: лампочки над окном и по левой шторе.
    assert.equal(room.bulbs.length, 32);
    for (const [x, y, colour] of room.bulbs) assert.ok(x > 110 && x < 395 && y > 40 && y < 255 && /^#[0-9a-f]{6}$/u.test(colour));
  }
  // Вещи стоят на одних и тех же местах в обеих картинках: погода сменилась — они не прыгают.
  for (const thing of Object.keys(day.things.at)) for (const index of [4, 5]) assert.ok(Math.abs(day.things.at[thing][index] - dull.things.at[thing][index]) <= 5.5, `${thing}: ${day.things.at[thing].slice(4)} и ${dull.things.at[thing].slice(4)}`);
  // Сценарий сборки лежит в репозитории и двоичных файлов не оставляет.
  assert.match(read("scripts/room-paint.mjs"), /Запуск: node scripts\/room-paint\.mjs <с вещами\.png> <без вещей\.png>/u);
});

test("комната картинкой: какая картинка нужна — по небу; под тучами солнца на полу нет", () => {
  assert.deepEqual(["clear", "clouds", "overcast", "fog", "rain", "storm", "snow", "что-то"].map(sky => scene.roomNameOf({ sky })), ["day", "day", "dull", "dull", "dull", "dull", "dull", "dull"]);
  assert.equal(scene.roomNameOf({}), "dull", "незнакомое небо — дождь, как и за окном");
});

test("комната картинкой: рисунок ссылается на картинку, стен и мебели кодом нет, частей столько же", () => {
  const code = art(view(), {}), painted = art(view(), { room: day });
  assert.equal(painted.parts.length, code.parts.length, "страница меняет рисунок по частям: их число то же");
  assert.ok(painted.text.includes('<use href="#r-room-day"/>') && !painted.text.includes("r-room-dull"));
  // Обои узором, половицы, рама, ковёр — приметы комнаты кодом.
  assert.match(code.inks, /<pattern /u);
  assert.doesNotMatch(painted.inks, /<pattern /u, "обоев кодом нет");
  assert.ok(painted.text.length < code.text.length / 2, `рисунок с картинкой легче: ${painted.text.length} против ${code.text.length}`);
  // Сама картинка в части рисунка не вставлена: она лежит в кладовой, один раз.
  assert.doesNotMatch(painted.text + painted.inks.replace(/<mask[\s\S]*?<\/mask>/gu, ""), /data:image/u);
  const store = scene.drawPicture(day);
  assert.match(store, /^<image id="r-room-day" width="400" height="520" preserveAspectRatio="none" href="data:image\/webp;base64,[^"]+"\/><image id="r-room-day-things" width="\d+" height="\d+" preserveAspectRatio="none" href="data:image\/webp;base64,[^"]+"\/>$/u);
  // Рисунок целиком (листы, альбом) несёт определения сам.
  assert.ok(scene.drawRoom(view(), { room: day }).includes('<image id="r-room-day"'));
  assert.ok(!scene.drawRoom(view(), {}).includes("r-room-"));
  // Места нажатий — те же: картинка написана по комнате кодом, вещи стоят там же.
  assert.equal(painted.zones, code.zones);
});

test("комната картинкой: вещь человека встаёт с листа, только если она у него есть", () => {
  const all = shownThings(art(view(), { room: day }).text, day);
  assert.deepEqual(all, ["bed", "lamp", "plant", "stool", "кактус", "календарь", "кресло", "кружка", "место", "плед", "подушка", "рисунок", "снимок", "тапочки"]);
  const none = shownThings(art(view({ things: [] }), { room: day }).text, day);
  // Без вещей: кактус на подоконнике, лампа, табурет, лежанка Байта и плед (малый) — они в комнате всегда.
  assert.deepEqual(none, ["bed", "lamp", "plant", "stool", "плед"]);
  for (const thing of ["рисунок", "календарь", "снимок", "кружка", "подушка", "место", "кактус", "кресло", "тапочки"]) {
    assert.deepEqual(shownThings(art(view({ things: [thing] }), { room: day }).text, day), [...none, thing].sort(), thing);
  }
  // Плед: «на двоих» — как написан; без него — тот же, но короче (обрезан, бахрома кодом). Укрыта им — на кресле его нет.
  const small = art(view({ things: [] }), { room: day }), big = art(view({ things: ["плед"] }), { room: day });
  assert.match(small.inks, /<clipPath id="r-plaidCut">/u);
  assert.doesNotMatch(big.inks, /plaidCut/u);
  // Она сидит за столом на табурете (нарисована кодом) — у стены табурета нет.
  assert.ok(!shownThings(art(view({ her: { key: "дело", pose: "desk", beat: true } }), { room: day }).text, day).includes("stool"));
  assert.ok(!shownThings(art(view({ fx: ["noplaid"] }), { room: day }).text, day).includes("плед"), "сценка «плед пропал»");
  // Кактус упал (сценка) — на подоконнике его нет; засох — нарисован кодом: у художника он цветёт.
  assert.ok(!shownThings(art(view({ fx: ["cactus"] }), { room: day }).text, day).includes("plant"));
  assert.ok(!shownThings(art(view({ plant: "dry" }), { room: day }).text, day).includes("plant"));
  // Байт в коробке — её передняя стенка встаёт поверх него; не в коробке — стенка не нужна.
  assert.ok(shownThings(art(view({ cat: { shape: "curl", place: "box", key: "спит" } }), { room: day }).text, day).includes("boxFront"));
  assert.ok(!all.includes("boxFront"));
});

test("комната картинкой: живое остаётся кодом — пар, корм, ноты, огни гирлянды, свет часа, сценки", () => {
  const plain = art(view(), { room: day }).text;
  assert.doesNotMatch(plain, /class="steam"|class="note"|class="bulb/u);
  assert.match(art(view({ tea: true }), { room: day }).text, /class="steam"/u, "пар над чайником");
  assert.match(art(view({ music: true }), { room: day }).text, /class="note"/u, "колонка играет");
  assert.notEqual(art(view({ fed: true }), { room: day }).text, plain, "корм в миске");
  // Гирлянда: вечером и ночью горит каждая лампочка; сценка «замигала» — одна горит и днём.
  for (const part of ["вечер", "ночь"]) assert.equal((art(view({ part }), { room: day }).text.match(/class="bulb b[0-3]"/gu) ?? []).length, 32, part);
  assert.equal((art(view({ fx: ["blink"] }), { room: day }).text.match(/class="bulb rogue"/gu) ?? []).length, 1);
  // Свет часа: днём заливки нет; утром, вечером и ночью — поверх картинки, маской служит она сама.
  assert.doesNotMatch(art(view(), { room: day }).inks, /roomMask/u);
  for (const part of ["утро", "вечер", "ночь"]) {
    const made = art(view({ part }), { room: day });
    assert.match(made.inks, /<mask id="r-roomMask-day" style="mask-type:alpha"[^>]*><use href="#r-room-day"\/><\/mask>/u, part);
    assert.match(made.text, /<use href="#r-room-day"\/><rect width="400" height="520" fill="#[0-9a-f]{6}" opacity="0\.\d+" mask="url\(#r-roomMask-day\)"\/>/u, part);
  }
  // Лампа: вечером горит — свет часа на неё не ложится; погасили нажатием — темнеет вместе с комнатой.
  const lampMask = `thing-day-${["рисунок", "календарь", "снимок", "подушка", "кружка", "место", "кресло", "плед", "plant", "кактус", "lamp"].indexOf("lamp")}`;
  assert.ok(!art(view({ part: "вечер" }), { room: day }).inks.includes(lampMask), "лампа горит");
  assert.ok(art(view({ part: "вечер", dark: true }), { room: day }).inks.includes(lampMask), "лампа погашена");
  // Написанный свет вокруг лампы не рисуется никогда (0.54.0): от вещи берётся силуэт, свет даёт код.
  for (const how of [{}, { part: "вечер" }, { part: "вечер", dark: true }, { part: "ночь" }]) {
    const made = art(view(how), { room: day });
    assert.match(made.text, /<g clip-path="url\(#r-lampCut\)"><svg /u, JSON.stringify(how));
    assert.match(made.inks, /<clipPath id="r-lampCut"><path d="M[^"]+Z"\/><\/clipPath>/u, JSON.stringify(how));
  }
  // Днём и погашенная лампа не горит: абажур приглушён тоном ткани. Вечером и ночью — горит, как написана.
  for (const how of [{}, { part: "утро" }, { part: "вечер", dark: true }]) assert.match(art(view(how), { room: day }).text, /<path class="unlit" /u, JSON.stringify(how));
  for (const part of ["вечер", "ночь"]) assert.doesNotMatch(art(view({ part }), { room: day }).text, /class="unlit"/u, part);
  // Верх абажура виден на фоне окна: у погашенной лампы тень проёма ложится и на него, последним слоем.
  assert.match(art(view({ part: "вечер", dark: true }), { room: day }).text, /<path fill="url\(#r-dusk\)" d="[^"]+" mask="url\(#r-lampAir\)"\/><\/g>/u);
  // Вещи на подоконнике тоже видны на фоне окна: вечером и ночью тень проёма ложится на Колючку, днём её нет.
  const plantMask = `thing-day-${["рисунок", "календарь", "снимок", "подушка", "кружка", "место", "кресло", "плед", "plant"].indexOf("plant")}`;
  for (const part of ["вечер", "ночь"]) assert.ok(art(view({ part }), { room: day }).text.includes(`<path fill="url(#r-dusk)" d="M124 44V262H388V44Z" mask="url(#r-${plantMask})"/>`), part);
  assert.ok(!art(view(), { room: day }).text.includes(`mask="url(#r-${plantMask})"`), "днём тени нет");
  // А вещь в глубине комнаты (табурет у стола) в проём окна не попадает — отдельной тени на ней нет.
  assert.ok(!art(view({ part: "вечер" }), { room: day }).text.includes(`d="M124 44V262H388V44Z" mask="url(#r-thing-day-11)"`));
  // «Абажур любимого цвета» — его цвет поверх написанного абажура.
  assert.ok(art(view({ lamp: "#7fc8f0" }), { room: day }).text.includes('fill="#7fc8f0" opacity="0.6"'));
  assert.ok(!art(view({ lamp: "#7fc8f0", things: [] }), { room: day }).text.includes("#7fc8f0"), "без вещи «абажур» цвет лампы — как написан");
  // Окно открыто — шторы ходят от сквозняка: поверх каждой написанной шторы — её же копия, кусок той же картинки.
  const airy = art(view({ open: true }), { room: day }).text;
  assert.equal((airy.match(/<g class="breeze(?: b1)?" mask="url\(#r-curtainFade[01]\)"><svg [^>]+><use href="#r-room-day"\/><\/svg>/gu) ?? []).length, 2);
  assert.doesNotMatch(plain, /class="breeze/u, "окно закрыто — шторы висят");
  assert.doesNotMatch(art(view({ open: true, fx: ["curtains"] }), { room: day }).text, /class="breeze/u, "шторы задёрнуты сценкой — копий нет");
  // Сценки дня и праздники рисует код, как и раньше.
  for (const [extra, mark] of [[{ fx: ["curtains"] }, "fx-curtains"], [{ fx: ["window"] }, "fx-window"], [{ fx: ["cactus"] }, "fx-cactus"], [{ fx: ["haze"] }, "fx-haze"]]) assert.ok(art(view(extra), { room: day }).text.includes(mark), mark);
  // Солнечного пятна на полу кодом нет: оно написано художником.
  assert.match(art(view(), {}).inks, /sunFloor/u);
  assert.doesNotMatch(art(view(), { room: day }).inks, /sunFloor|dayFloor|nightFloor|lampFloor/u);
});

test("комната картинкой: негодную картинку рисунок не принимает — комната кодом", () => {
  const code = art(view(), {}).text;
  const bad = [
    null, {}, { ...day, v: 2 }, { ...day, name: "Day!" }, { ...day, src: "https://example.com/room.webp" }, { ...day, src: 'data:image/webp;base64,AAAA" onload="x' },
    { ...day, things: null }, { ...day, things: { ...day.things, src: "javascript:alert(1)" } }, { ...day, things: { ...day.things, at: { ...day.things.at, "плед": [0, 0, 0, 0, 0, 0, 0, 0] } } },
    { ...day, things: { ...day.things, at: Object.fromEntries(Object.entries(day.things.at).filter(([name]) => name !== "lamp")) } }, { ...day, bulbs: [[1, 2, "red"]] }, { ...day, bulbs: "нет" },
  ];
  for (const room of bad) {
    assert.equal(scene.roomOf({ room }), null, JSON.stringify(room)?.slice(0, 80));
    assert.equal(scene.drawPicture(room), "");
    assert.equal(art(view(), { room }).text, code);
  }
});

test("комната картинкой: страница грузит её по ходу дела, держит в памяти телефона и просит снова", () => {
  const app = read("miniapp/app.js");
  assert.match(app, /const ROOM_KEY = `ai-room-pic:\$\{PAGE\}:`, ROOM_NAMES = Object\.freeze\(\["day", "dull"\]\);/u);
  assert.match(app, /const canRoom = canPaint && typeof scene\.roomNameOf === "function" && typeof drawPicture === "function" && typeof scene\.drawParts === "function" && !\(local && params\.room === "code"\);/u, "новые имена рисунка проверяются: рядом может лежать прежний `scene.js`");
  assert.match(app, /\(attempt \? import\(`\.\/room\/\$\{name\}\.js\?again=\$\{attempt\}`\) : import\(`\.\/room\/\$\{name\}\.js`\)\)/u, "повторная просьба — под другим адресом");
  assert.match(app, /if \(!canRoom \|\| !ROOM_NAMES\.includes\(name\) \|\| roomAsked\.has\(name\)\) return;/u, "имя модуля — только из списка");
  assert.match(app, /if \(error\?\.message === "empty" \|\| error\?\.message === "unreadable"\) \{ settleRoom\(name, false\); return; \}/u, "не читается — комната кодом");
  assert.match(app, /const wait = SPRITE_AGAIN_MS\[attempt\];\n\s+if \(wait === undefined\) \{ note\("картинка", "late", `room\/\$\{name\}`\); roomAsked\.delete\(name\); return; \}/u);
  assert.match(app, /for \(const \[name, \[timer, attempt\]\] of \[\.\.\.roomSooner\]\) \{ clearTimeout\(timer\); loadRoom\(name, attempt, ""\); \}/u, "связь вернулась — просит сразу");
  // Память телефона — в try/catch: закрыта или полна — картинка придёт из сети.
  assert.match(app, /function keepRoom\(name, room\) \{\n\s+try \{/u);
  assert.match(app, /function keptRoom\(name\) \{\n\s+try \{/u);
  // Пришла при открытой странице — прежняя комната тает поверх новой, а не подменяется разом.
  assert.match(app, /const renew = fade \|\| \(drawn\.shown !== null && drawn\.room !== pictureName\);/u);
  assert.match(app, /const fresh = putInside\(view, options, renew\);/u);
  // Спокойный рисунок (по нему страница решает, что изменилось) — с той же картинкой, что и рисунок в движении.
  assert.match(app, /const calm = options \? \{ sprites: options\.sprites, \.\.\.\(options\.room \? \{ room: options\.room \} : \{\}\), /u);
});

test("поворот головы: третий кадр позы лежит рядом с ней, встаёт на рисунок и виден только по слову страницы", async () => {
  // Идея 185 («больше движений»): заплаткой на лицо поворот не выходит — только целым кадром той же позы.
  assert.deepEqual(scene.HER_TURNS, {
    work: ["workc", "r"], "home-work": ["home-workc", "l"], tea: ["teac", "r"], "home-tea": ["home-teac", "l"],
    // 0.54.0: сидя в кресле — с блокнотом, с кружкой, с книгой.
    work3: ["work3c", "r"], "home-work3": ["home-work3c", "l"], tea3: ["tea3c", "r"], "home-tea3": ["home-tea3c", "l"],
    read: ["readc", "r"], "home-read": ["home-readc", "l"],
    // Стоя: у подоконника с блокнотом, с метёлкой — влево в обоих нарядах (сторону выбирает художник).
    work2: ["work2c", "l"], "home-work2": ["home-work2c", "l"], tidy: ["tidyc", "l"], "home-tidy": ["home-tidyc", "l"],
  });
  // Каким рисунком страница приходит к этой позе: состояние и место.
  const HOW = { work: ["дело", "desk"], tea: ["уют", "sill"], work3: ["дело", "chair"], tea3: ["уют", "chair"], read: ["уют", "read"], work2: ["дело", "sill"], tidy: ["дело", "dust"] };
  assert.equal(scene.turnOf("work"), "workc");
  assert.equal(scene.turnOf("tea"), "teac");
  assert.equal(scene.turnOf("read"), "readc");
  assert.equal(scene.turnOf("sleep"), null);
  assert.equal(scene.turnOf(null), null);
  const load = async (name) => (await import(`../miniapp/her/${name}.js`)).default;
  for (const [pose, [turnName, side]] of Object.entries(scene.HER_TURNS)) {
    const base = await load(pose), frame = await load(scene.frameOf(pose)), turn = await load(turnName);
    // Та же фигура того же роста; ось тела — там же, с поправкой на то, как легли волосы (ширина меняется).
    assert.equal(turn.h, base.h, turnName);
    // Ширина — по волосам: у повёрнутой головы они ложатся шире (сидя — до пятой части), ось от этого не зависит.
    assert.ok(Math.abs(turn.w - base.w) <= base.w * 0.2, `${turnName}: ширина ${turn.w} против ${base.w}`);
    // Ось кадра — там же, где у позы, с поправкой на волосы (`bash scripts/verify.sh axis` ставит её по ногам).
    assert.ok(Math.abs(turn.cx * turn.w - base.cx * base.w) <= base.w * 0.12, `${turnName}: ось ${turn.cx} против ${base.cx}`);
    assert.match(scene.drawSprite(turnName, turn), new RegExp(`^<image id="r-her-${turnName}" width="${turn.w}" height="${turn.h}"`, "u"));
    const [key, where] = HOW[pose.replace(/^home-/u, "")];
    const described = { part: pose.startsWith("home-") ? "вечер" : "день", sky: "clear", plant: "wet", her: { key, pose: where, beat: true, ...(pose.startsWith("home-") ? { wear: "home" } : {}) }, cat: null, things: [] };
    assert.equal(scene.spriteOf(described), pose);
    const sprites = { [pose]: base, [scene.frameOf(pose)]: frame, [turnName]: turn };
    const withTurn = scene.drawParts(described, { sprites }).parts.join("");
    assert.ok(withTurn.includes(`<g class="alive t${side}">`), `${pose}: сторона взгляда — словом на группе`);
    assert.ok(withTurn.includes(`<g class="fr c"><use href="#r-her-${turnName}"`), `${pose}: третий кадр на рисунке`);
    // Кадр не пришёл — поза как раньше: два кадра, без слова о стороне.
    const without = scene.drawParts(described, { sprites: { [pose]: base, [scene.frameOf(pose)]: frame } }).parts.join("");
    assert.ok(!without.includes("fr c") && without.includes('<g class="alive">'), pose);
    // Рисунок целиком (листы, альбом) кладёт определение кадра сам.
    assert.ok(scene.drawRoom(described, { sprites }).includes(`id="r-her-${turnName}"`));
  }
  // Стили страницы: кадр не виден, пока она не смотрит в его сторону; первые два кадра уходят с задержкой — когда он
  // уже проявился (иначе сквозь неё на миг была бы видна комната).
  const html = read("miniapp/index.html");
  assert.ok(html.includes("#room .fr.c { opacity: 0; transition: opacity 0.28s ease-in-out; }"));
  assert.ok(html.includes("#room .look-l .alive.tl .fr.c, #room .look-r .alive.tr .fr.c { opacity: 1; }"));
  assert.ok(html.includes("#room .look-l .alive.tl .fr.a, #room .look-l .alive.tl .fr.b, #room .look-r .alive.tr .fr.a, #room .look-r .alive.tr .fr.b { opacity: 0; animation: none; transition: opacity 0.05s linear 0.27s; }"));
  // Страница заказывает кадр следом за позой; пришёл позже — рисунок обновится, когда кончится переход.
  const app = read("miniapp/app.js");
  assert.match(app, /const turnName = \(name\) => \(typeof scene\.turnOf === "function" \? scene\.turnOf\(name\) : null\);/u, "прежний `scene.js` кадра не знает");
  assert.match(app, /if \(sprites\[name\]\) fetchSprite\(turnName\(name\)\);/u);
  assert.match(app, /if \(sprite && \(frameName\(shown\) === name \|\| turnName\(shown\) === name\)\) frameLater\(\);/u);
});
