/**
 * Комната Аи — что показать (мини-приложение, сборка 0.43.0).
 *
 * Чистые функции между ответом сердца (`endpoints/room`) и рисунком (`scene.js`): здесь нет ни страницы, ни
 * Telegram, поэтому всё проверяется тестами. Страница (`app.js`) только зовёт их и раскладывает итог по разметке.
 */
import { PARTS, HER_POSES, CAT_SHAPES, CAT_PLACES, THINGS } from "./scene.js";

/** Номер страницы: растёт, когда страница меняется. Виден внизу — по нему понятно, не открылась ли старая копия. */
export const PAGE = "6";
export const CARE = Object.freeze(["pet", "feed", "play", "tea", "water"]);
/** Свет страницы под рисунок: утром и днём — светлая, вечером и ночью — тёмная. */
export const LIGHTS = Object.freeze({ "утро": "day", "день": "day", "вечер": "evening", "ночь": "night" });
/** Цвет шапки Telegram под стену комнаты в этот час. */
export const HEADERS = Object.freeze({ "утро": "#c9b5ab", "день": "#cbbeb3", "вечер": "#65536a", "ночь": "#443f5d" });
export const partOf = (hour) => (hour < 5 ? "ночь" : hour < 12 ? "утро" : hour < 18 ? "день" : hour < 23 ? "вечер" : "ночь");

/** Наряды, которые может назвать сердце (те же, что `HER_WEARS` в рисунке; из рисунка имя не берётся: рядом может лежать его прежняя копия). */
const WEARS = Object.freeze(["jacket", "home"]);

const text = (value, limit = 600) => (typeof value === "string" ? value.trim().slice(0, limit) : "");
const count = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : 0);

/** Состояние страницы до первого ответа: комната по часам телефона, без неё и без Байта. */
export function blank(hour = 12) {
  return {
    ready: false, demo: false, busy: "", tone: "", said: "Дверь открывается…", retry: false,
    part: partOf(hour), her: null, cat: null, plant: "wet", things: [], lamp: "", fed: false, tea: false,
    lines: { her: "", window: "", cat: "", box: "", things: {} }, done: {}, scene: null, build: "", next: null,
    // Которая по счёту её поза (позы состояния идут по кругу) и гладили ли её сегодня; что за окном — дождь или снег.
    turn: 0, patted: false, sky: "rain",
  };
}

/** Что отдать рисунку. `turn` — которая по счёту её поза: страница прибавляет его со временем и от нажатия. */
export function viewOf(state) {
  const turn = Number.isInteger(state.turn) && state.turn > 0 ? state.turn : 0;
  return { part: state.part, her: state.her && turn ? { ...state.her, turn } : state.her, cat: state.cat, plant: state.plant, things: state.things, lamp: state.lamp, fed: state.fed, tea: state.tea, ...(state.sky === "snow" ? { sky: "snow" } : {}) };
}
/** Следующая её поза. */
export const nextTurn = (state) => ({ ...state, turn: (Number.isInteger(state.turn) && state.turn > 0 ? state.turn : 0) + 1 });

function sceneOf(raw) {
  if (!raw || typeof raw !== "object" || !text(raw.key, 24) || !text(raw.text)) return null;
  const options = Array.isArray(raw.options) ? raw.options.map(option => text(option, 60)).filter(Boolean).slice(0, 2) : [];
  if (options.length !== 2) return null;
  const pick = raw.pick === 0 || raw.pick === 1 ? raw.pick : null;
  return { key: text(raw.key, 24), text: text(raw.text), options, pick, outcome: pick == null ? "" : text(raw.outcome) };
}
function catOf(raw, before = null) {
  if (!raw || typeof raw !== "object") return before;
  return { shape: CAT_SHAPES.includes(raw.shape) ? raw.shape : "sit", place: CAT_PLACES.includes(raw.place) ? raw.place : "rug", key: text(raw.key, 16) };
}
function doneOf(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return Object.fromEntries(CARE.map(name => [name, count(source[name])]));
}

/** Отказ сердца или платформы: слова — в разговор, рисунок остаётся каким был. */
export function refused(state, result, { retry = false } = {}) {
  return { ...state, busy: "", tone: "warn", retry, said: text(result?.text) || "Что-то пошло не так. Попробуйте ещё раз." };
}

/** Ответ на «зайти» (`do: "look"`): всё, что видно в комнате. */
export function applyLook(state, result) {
  if (!result || result.ok !== true) return refused(state, result, { retry: true });
  const part = PARTS.includes(result.clock?.part) ? result.clock.part : partOf(count(result.clock?.hour));
  const things = (Array.isArray(result.things) ? result.things : []).filter(item => THINGS.includes(item?.key));
  const thingLines = Object.fromEntries(things.map(item => [item.key, text(item.line) || `${text(item.title).slice(0, 1).toUpperCase()}${text(item.title).slice(1)}.`]));
  const fresh = (Array.isArray(result.fresh) ? result.fresh : []).filter(key => thingLines[key]);
  const done = doneOf(result.done);
  const lines = { her: text(result.her?.line), window: text(result.window), cat: text(result.cat?.line), box: text(result.box?.line), things: thingLines };
  const said = [text(result.greet), lines.her, lines.cat, ...fresh.map(key => `Новое в комнате. ${thingLines[key]}`)].filter(Boolean).join("\n");
  return {
    ...state, ready: true, busy: "", tone: "", retry: false, part,
    her: { pose: HER_POSES.includes(result.her?.pose) ? result.her.pose : "desk", key: text(result.her?.key, 16), ...(WEARS.includes(result.her?.wear) ? { wear: result.her.wear } : {}) },
    turn: 0, patted: result.patted === true, sky: result.sky === "snow" ? "snow" : "rain",
    cat: catOf(result.cat), plant: result.plant?.state === "dry" ? "dry" : "wet",
    things: things.map(item => item.key), lamp: /^#[0-9a-f]{6}$/iu.test(String(result.lamp ?? "")) ? result.lamp : "",
    fed: done.feed > 0, tea: done.tea > 0, lines, done, scene: sceneOf(result.scene), build: text(result.build, 20),
    next: count(result.next?.days) || null, said: said || "Заходите.",
  };
}

/** Ответ на заботу (`do`: pet, feed, play, tea, water). */
export function applyCare(state, op, result) {
  if (!result || result.ok !== true) return refused(state, result);
  const done = doneOf(result.done);
  const said = [text(result.line), text(result.note)].filter(Boolean).join("\n");
  // О Байте теперь говорят слова самой заботы: прежняя строка («сидит у миски») устарела.
  const lines = { ...state.lines, ...(result.cat ? { cat: text(result.line) } : {}) };
  return {
    ...state, busy: "", tone: "", retry: false, cat: catOf(result.cat, state.cat), plant: result.plant?.state === "dry" ? "dry" : "wet",
    done, fed: done.feed > 0, tea: done.tea > 0, lines, said: said || "Спасибо.",
  };
}

/** Ответ на выбор в сценке дня (`do: "pick"`). */
export function applyPick(state, result) {
  if (!result || result.ok !== true) {
    // «Уже сыграна» — сценку больше не предлагать: выбор сделан в чате.
    const closed = result?.code === "played" || result?.code === "gone";
    return { ...refused(state, result), scene: closed ? null : state.scene };
  }
  // Сыграли сценку — Байт унёс в коробку трофей: строка о коробке приходит новая.
  const lines = text(result.box?.line) ? { ...state.lines, box: text(result.box.line) } : state.lines;
  return { ...state, busy: "", tone: "", retry: false, lines, scene: sceneOf(result.scene) ?? state.scene, said: [text(result.line), text(result.note)].filter(Boolean).join("\n") || state.said };
}

/** Нажатие на то, что не забота: она сама, окно, коробка Байта, вещь. Возвращает новое состояние или `null` — сказать нечего. */
export function applyTap(state, act) {
  const name = String(act ?? "");
  const said = name === "her" ? state.lines.her : name === "window" ? state.lines.window : name === "box" ? state.lines.box : name.startsWith("thing:") ? state.lines.things[name.slice(6)] : "";
  return said ? { ...state, tone: "", retry: false, said } : null;
}

/** Ответ на «погладить её» (`do: "pat"`): её слова; гладили сегодня — отметка остаётся. */
export function applyPat(state, result) {
  if (!result || result.ok !== true) return refused(state, result);
  return { ...state, busy: "", tone: "", retry: false, patted: true, said: [text(result.line), text(result.note)].filter(Boolean).join("\n") || "…" };
}

/** Ошибка связи словами. `err` — то, что отдаёт `Telegram.WebApp.Serverless.call`: `message`, `type`. */
export function explain(err) {
  const type = text(err?.type, 40), message = text(err?.message, 200);
  if (type === "ENDPOINT_ERROR" && message) return message;
  if (/UNAUTHORIZED|INIT_DATA|401/iu.test(`${type} ${message}`)) return "Telegram не подтвердил, кто зашёл. Закройте комнату и откройте её снова кнопкой в чате.";
  if (/NOT_FOUND|404/iu.test(`${type} ${message}`)) return "Комната ещё не опубликована до конца: страница есть, а ответить ей некому. Хозяину: это видно в журнале телефона.";
  if (/RATE|429/iu.test(`${type} ${message}`)) return "Слишком часто. Минутку — и можно снова.";
  return `Комната не ответила${type ? ` (${type})` : ""}. Попробуйте ещё раз чуть позже.`;
}

/** Что пришло от вызова: сам ответ функции или он же в обёртке `{ ok, result }` — страница понимает оба вида. */
export function unwrap(result) {
  if (result && typeof result === "object" && result.build === undefined && result.result && typeof result.result === "object") return result.result;
  return result && typeof result === "object" ? result : { ok: false, code: "empty", text: "Комната ответила пусто. Попробуйте ещё раз." };
}

// ── витрина: страница открыта не из Telegram ─────────────────────────────────
const DEMO_HER = Object.freeze({
  "утро": ["desk", "дело", "Я у стола с блокнотом: разбираю записки и напоминания."],
  "день": ["shelf", "игра", "Дирижирую парадом на полке: ВАЛЛ-И сегодня командир."],
  "вечер": ["chair", "уют", "Чай, кресло, плед и «Маленький принц» — в таком порядке. Пока на первом пункте."],
  "ночь": ["nap", "сон", "Дремлю под дождь. Кружка остыла, плед — нет."],
});
const DEMO_WINDOW = Object.freeze({
  "утро": "За окном серое утро и дождь: город только просыпается.", "день": "За окном — город в дожде. Лампа выключена: света хватает.",
  "вечер": "Вечер. За окном дождь и фонари, гирлянда уже горит.", "ночь": "Ночь. За окном — огни ночного города и капли на стекле.",
});
const DEMO_CARE = Object.freeze({
  pet: ["Байт подставил ухо и замурчал. Вас одобрили.", "Байт не против. Он никогда не против.", { shape: "sit", place: "near" }],
  feed: ["Миска полна, Байт счастлив.", "Он уже ел. Смотрит честными глазами — не верьте.", { shape: "eat", place: "bowl" }],
  play: ["Байт носится по комнате серой молнией. Колючка в безопасности — пока.", "Байт уже набегался: смотрит на ленточку одним глазом.", { shape: "play", place: "rug" }],
  tea: ["Спасибо. Жасминовый — мой любимый.", "Ещё кружка? Наливайте. Чая много не бывает.", null],
  water: ["Колючка полита. Она молчит, но я вижу: довольна.", "Ей пока хватит: она кактус, а не водяная лилия.", null],
});
const DEMO_SCENE = Object.freeze({
  key: "sock", text: "Байт принёс добычу и положил к ногам. Это носок. Чей — неизвестно.", options: ["Похвалить охотника", "Отобрать носок"],
  outcomes: ["Байт горд собой и унёс носок в коробку — к остальным трофеям. Там уже целая коллекция.", "Носок отобран. Байт смотрит так, будто его ограбили. Придётся мириться вкусняшкой."],
});
const DEMO_THINGS = Object.freeze({
  "кружка": "Вторая кружка — для гостя. То есть для вас.", "тапочки": "Тапочки у двери. Гостевые.", "подушка": "Вторая подушка на подоконнике: смотреть на дождь вдвоём.",
  "снимок": "Рамка с нашим первым разговором.", "плед": "Плед на двоих. Синий, как и мой.", "календарь": "Календарь. Один день обведён — день знакомства.",
  "кресло": "Второе кресло у окна. Ваше.", "кактус": "Маленький кактус рядом с Колючкой. Имя ещё не придумала.", "место": "Место на подоконнике рядом с Байтом. Он подвинулся — это редкость.",
  "абажур": "Абажур — любимого цвета гостя.", "рисунок": "Мой рисунок на стене.", "ёлка": "Ёлка с гирляндой. Байт уже присматривается к шарам.",
  "торт": "Торт со свечкой — в день рождения гостя.", "свеча": "Свеча у рамки — в годовщину знакомства.", "фонарь": "Фонарь у окна — в Рамадан и оба байрама.",
});
export const DEMO_NOTE = "Это витрина: по-настоящему комната открывается из Telegram — кнопкой «Комната» в чате с Аи.";

/** Ответ «зайти» для витрины. `params` — из адреса после «#» (для снимков): part, her, key, cat, things, lamp, plant. */
export function demoLook(hour = 12, params = {}) {
  const part = PARTS.includes(params.part) ? params.part : partOf(hour);
  const [pose, key, line] = DEMO_HER[part];
  const [shape = "sit", place = "bowl", catKey = "голоден"] = String(params.cat ?? "").split(".").filter(Boolean);
  const listed = params.things === "all" ? [...THINGS] : String(params.things ?? "кружка,тапочки").split(",").filter(name => THINGS.includes(name));
  return {
    ok: true, do: "look", build: "", clock: { hour, part }, greet: DEMO_NOTE, window: params.sky === "snow" ? "Сегодня вместо дождя — снег: крыши белые, город притих." : DEMO_WINDOW[part], sky: params.sky === "snow" ? "snow" : "rain",
    her: { pose: HER_POSES.includes(params.her) ? params.her : pose, key: params.key ?? key, line: params.her ? "" : line },
    cat: { shape, place, key: catKey, line: params.cat ? "" : "Байт сидит у миски и смотрит. На миску. На меня. Снова на миску." },
    plant: { state: params.plant === "wet" ? "wet" : "dry" }, done: {}, cared: false,
    things: listed.map(name => ({ key: name, title: name, line: DEMO_THINGS[name] ?? "" })), lamp: params.lamp ?? "", drawing: "", fresh: [], next: null,
    box: { count: 2, line: "В коробке Байта — его трофеи: носок неизвестного происхождения и лампочка от гирлянды. Растёт с каждой сценкой." }, patted: false,
    scene: params.scene === "0" ? null : { key: DEMO_SCENE.key, text: DEMO_SCENE.text, options: DEMO_SCENE.options, pick: null, outcome: null }, first: true,
  };
}
/** Ответ на заботу для витрины: те же поля, что у сердца. */
export function demoCare(state, op) {
  const [first, again, moved] = DEMO_CARE[op] ?? ["", "", null];
  const before = count(state.done?.[op]);
  const early = op === "water" && state.plant === "wet";
  return {
    ok: true, do: op, build: "", line: before || early ? again : first, again: Boolean(before) || early, early, peace: false, counted: false,
    ...(moved ? { cat: { key: op === "feed" ? "сыт" : op === "play" ? "игра" : "ласка", ...(before && op !== "pet" ? { shape: op === "feed" ? "sit" : "lie", place: moved.place } : moved) } } : {}),
    plant: { state: op === "water" ? "wet" : state.plant }, done: { ...state.done, [op]: before + (early ? 0 : 1) }, cared: true,
  };
}
/** «Погладить её» на витрине. */
export function demoPat(state) {
  return { ok: true, do: "pat", build: "", line: state.patted ? "Ещё? Я не против. Только Байту не говорите: он считает, что гладить положено его." : "…Так можно было? Ладно. Мне нравится.", again: state.patted === true, counted: false };
}
export function demoPick(state, pick) {
  const index = pick === 1 ? 1 : 0;
  return { ok: true, do: "pick", build: "", line: DEMO_SCENE.outcomes[index], counted: false, scene: { ...state.scene, pick: index, outcome: DEMO_SCENE.outcomes[index] }, cared: true };
}
