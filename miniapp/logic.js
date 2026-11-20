/**
 * Комната Аи — что показать (мини-приложение; номер страницы — `PAGE`, номер сборки сердца приходит в ответе).
 *
 * Чистые функции между ответом сердца (`endpoints/room`) и рисунком (`scene.js`): здесь нет ни страницы, ни
 * Telegram, поэтому всё проверяется тестами. Страница (`app.js`) только зовёт их и раскладывает итог по разметке.
 */
import { PARTS, HER_POSES, CAT_SHAPES, CAT_PLACES, THINGS } from "./scene.js";

/** Номер страницы: растёт, когда страница меняется. Виден внизу — по нему понятно, не открылась ли старая копия. */
export const PAGE = "12";
export const CARE = Object.freeze(["pet", "feed", "play", "tea", "water"]);
/** Свет страницы под рисунок: утром и днём — светлая, вечером и ночью — тёмная. */
export const LIGHTS = Object.freeze({ "утро": "day", "день": "day", "вечер": "evening", "ночь": "night" });
/** Цвет шапки Telegram под стену комнаты в этот час. */
export const HEADERS = Object.freeze({ "утро": "#c9b5ab", "день": "#cbbeb3", "вечер": "#65536a", "ночь": "#443f5d" });
export const partOf = (hour) => (hour < 5 ? "ночь" : hour < 12 ? "утро" : hour < 18 ? "день" : hour < 23 ? "вечер" : "ночь");

/** Наряды, которые может назвать сердце (те же, что `HER_WEARS` в рисунке; из рисунка имя не берётся: рядом может лежать его прежняя копия). */
const WEARS = Object.freeze(["jacket", "home"]);
/**
 * Что за окном (те же слова, что `SKIES` в рисунке и в сердце): с 0.44.0 — погода города человека. Прежнее сердце
 * знает два слова, «rain» и «snow»; незнакомое слово — дождь, как было всегда.
 */
export const SKIES = Object.freeze(["clear", "clouds", "overcast", "fog", "rain", "storm", "snow"]);
/** Чай на выбор (0.47.0): те же слова, что `BREWS` в сердце. */
export const BREWS = Object.freeze(["жасмин", "улун", "мята"]);
const skyOf = (value) => (SKIES.includes(value) ? value : "rain");
/** Что сценка дня меняет в комнате (те же слова, что `SCENE_FX` в рисунке и в сердце). */
const FX = Object.freeze(["cactus", "haze", "window", "blink", "sock", "curtains", "noplaid", "puddle", "boat"]);
/** В чём она в этот час, если наряд не назван: вечером и ночью — домашнее (то же правило — в рисунке). */
/**
 * Каким светом нарисована комната (0.47.0, идея 164): по солнцу города — если сердце его назвало (`clock.light`),
 * иначе по часам. Наряд, сон и её слова идут по часам (`part`) всегда.
 */
export const lightOf = (state) => (PARTS.includes(state?.light) ? state.light : state?.part);
export const wearAt = (part, named = "") => (WEARS.includes(named) ? named : part === "вечер" || part === "ночь" ? "home" : "jacket");
/** Фаза луны на этот день: доля лунного месяца (0 — новолуние, 0,5 — полнолуние). `day` — «2026-11-19» или момент времени. */
export function moonOf(day) {
  const at = typeof day === "number" ? day : Date.parse(`${String(day ?? "").slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(at)) return 0.3;
  const age = (at - Date.UTC(2000, 0, 6, 18, 14)) / (29.530588853 * 86_400_000);
  return Math.round((age - Math.floor(age)) * 50) / 50;
}

const text = (value, limit = 600) => (typeof value === "string" ? value.trim().slice(0, limit) : "");
const count = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : 0);

/** Состояние страницы до первого ответа: комната по часам телефона, без неё и без Байта. */
export function blank(hour = 12) {
  return {
    ready: false, demo: false, busy: "", tone: "", said: "Дверь открывается…", retry: false,
    part: partOf(hour), light: "", her: null, cat: null, plant: "wet", things: [], lamp: "", fed: false, tea: false,
    lines: { her: "", window: "", cat: "", box: "", things: {} }, done: {}, scene: null, build: "", next: null,
    // Которая по счёту её поза (позы состояния идут по кругу) и гладили ли её сегодня; что за окном (`SKIES`).
    // Пока сердце не ответило, за окном — ровное серое небо: какая там погода, ещё неизвестно.
    turn: 0, patted: false, sky: "overcast",
    // 0.44.0. Луна по фазе; что сценка дня изменила в комнате; её нет в комнате (ушла к шкафу) или она только что
    // вошла; сколько осталось до смены часа (`left`, мс — от `at`, когда пришёл ответ); её слова у шкафа.
    moon: 0.3, fx: [], away: false, entering: false, clock: null, wardrobe: null,
    // 0.46.0. Лампа погашена — горит одна гирлянда; сколько ещё играет колонка (мс от ответа сердца; 0 — молчит).
    dark: false, music: 0,
    // 0.47.0. Какой чай ей наливают; пусто — сердце прежнее: выбирать чай и наряд оно не умеет, кнопок нет.
    brew: "",
    // Тихий час: сколько осталось (мс от ответа сердца; 0 — не идёт) и её слова, когда время выйдет.
    quiet: 0, quietEnd: "",
    // 0.48.0. Кнопки под рисунком — хозяину (`owner`); окно открыто (`open`) и умеет ли сердце его открывать (`airy`);
    // какие чаи есть (`kinds`) и спрашивает ли она сейчас, какой налить (`asking`), её слова о чае, сказанные сама
    // (`offer`); её слова о плане дня (`plan`) и говорила ли она только что, чем занята (`told`).
    owner: false, open: false, airy: false, kinds: [], asking: "", offer: "", plan: "", told: "",
  };
}

/**
 * Её нынешняя реплика распорядка — `{ pose, line }` — или `null`: распорядка нет (прежнее сердце) — тогда позы идут
 * по кругу сами (`turn`), как до 0.44.0.
 */
export const herBeat = (state) => (Array.isArray(state.her?.beats) && state.her.beats.length ? state.her.beats[(Number(state.her.beat) || 0) % state.her.beats.length] : null);
/** Нынешняя реплика о Байте — `{ shape, place, line }` — или `null`: он там, куда его поставила забота или сценка. */
export const catBeat = (state) => (Array.isArray(state.cat?.beats) && state.cat.beats.length && Number.isInteger(state.cat.beat) && state.cat.beat >= 0 ? state.cat.beats[state.cat.beat % state.cat.beats.length] : null);
/**
 * Что отдать рисунку. У каждой реплики распорядка своя картинка: рисунок получает её место (`pose`) и знак `beat` —
 * «картинку брать по месту». Без распорядка — `turn`: которая по счёту поза.
 */
export function viewOf(state) {
  const turn = Number.isInteger(state.turn) && state.turn > 0 ? state.turn : 0;
  const beat = herBeat(state);
  const her = !state.her ? null : {
    pose: beat?.pose ?? state.her.pose, key: state.her.key, ...(state.her.wear ? { wear: state.her.wear } : {}), ...(state.her.face ? { face: state.her.face } : {}),
    ...(beat ? { beat: true } : turn ? { turn } : {}), ...(state.away ? { away: true } : {}),
  };
  const pet = catBeat(state);
  // Она дразнит Байта ленточкой — он рядом и ловит её, чем бы ни был занят до того (если не спит и не прячется).
  const teased = her && !state.away && her.pose === "ribbon" && state.cat && state.cat.still !== true;
  const cat = !state.cat ? null : {
    shape: teased ? "play" : pet?.shape ?? state.cat.shape, place: teased ? "near" : pet?.place ?? state.cat.place, key: state.cat.key,
    // Бежит он только туда, куда его послал сам ответ; следующий шаг распорядка — уже шагом.
    ...(state.cat.run === true && !teased && !pet ? { run: true } : {}),
  };
  return {
    part: state.part, her, cat, plant: state.plant, things: state.things, lamp: state.lamp, fed: state.fed, tea: state.tea,
    // Свет по солнцу назван, только когда он разошёлся с часами: иначе описание рисунка то же, что и было.
    ...(lightOf(state) !== state.part ? { light: lightOf(state) } : {}),
    // Прежнему рисунку небо называлось только когда шёл снег: слово «rain» в описании ему не нужно и теперь.
    ...(skyOf(state.sky) === "rain" ? {} : { sky: skyOf(state.sky) }),
    ...(Array.isArray(state.fx) && state.fx.length ? { fx: state.fx } : {}),
    ...(Number.isFinite(state.moon) ? { moon: state.moon } : {}),
    ...(state.dark === true ? { dark: true } : {}), ...(state.music > 0 ? { music: true } : {}),
    // 0.48.0. Окно открыто по нажатию: створка распахнута, слышна улица.
    ...(state.open === true ? { open: true } : {}),
  };
}
/** Следующая её поза (без распорядка: позы состояния идут по кругу). */
export const nextTurn = (state) => ({ ...state, turn: (Number.isInteger(state.turn) && state.turn > 0 ? state.turn : 0) + 1 });
/**
 * Следующая реплика распорядка: `who` — «her» или «cat». Меняются сразу и рисунок, и слова: то, что она говорит под
 * рисунком, — о том, что на нём сейчас. Возвращает новое состояние или `null` — идти некуда (реплика одна, Байт
 * спит или прячется, её нет в комнате).
 */
export function nextBeat(state, who) {
  if (who === "her") {
    const beats = state.her?.beats;
    if (state.away || !Array.isArray(beats) || beats.length < 2) return null;
    const beat = ((Number(state.her.beat) || 0) + 1) % beats.length, line = beats[beat].line;
    return { ...state, her: { ...state.her, beat }, lines: { ...state.lines, her: line || state.lines.her }, ...(line ? { tone: "", retry: false, said: line } : {}) };
  }
  const beats = state.cat?.beats;
  if (!state.cat || state.cat.still === true || !Array.isArray(beats) || !beats.length) return null;
  const now = Number.isInteger(state.cat.beat) ? state.cat.beat : -1;
  if (now >= 0 && beats.length < 2) return null;
  const beat = (now + 1) % beats.length, line = beats[beat].line;
  return { ...state, cat: { ...state.cat, beat, shape: beats[beat].shape, place: beats[beat].place }, lines: { ...state.lines, cat: line || state.lines.cat }, ...(line ? { tone: "", retry: false, said: line } : {}) };
}

function sceneOf(raw) {
  if (!raw || typeof raw !== "object" || !text(raw.key, 24) || !text(raw.text)) return null;
  const options = Array.isArray(raw.options) ? raw.options.map(option => text(option, 60)).filter(Boolean).slice(0, 2) : [];
  if (options.length !== 2) return null;
  const pick = raw.pick === 0 || raw.pick === 1 ? raw.pick : null;
  return {
    key: text(raw.key, 24), text: text(raw.text), options, pick, outcome: pick == null ? "" : text(raw.outcome),
    // Что сценка меняет в самой комнате (0.44.0); прежнее сердце этого не шлёт.
    fx: (Array.isArray(raw.fx) ? raw.fx : []).filter(name => FX.includes(name)),
  };
}
const shapeOf = (value) => (CAT_SHAPES.includes(value) ? value : "sit");
const placeOf = (value) => (CAT_PLACES.includes(value) ? value : "rug");
/**
 * Байт из ответа сердца: где он и какой, чем занят — и его распорядок (`beats`: реплики состояния, каждая со своей
 * картинкой). `first` — он сейчас на первой реплике распорядка (так при входе); после заботы и сценки он там, куда
 * его поставили её слова (`beat: -1`), а распорядок начнётся потом. `still` — с места не ходит (спит, прячется).
 */
function catOf(raw, before = null, { first = false } = {}) {
  if (!raw || typeof raw !== "object") return before;
  const beats = (Array.isArray(raw.beats) ? raw.beats : []).filter(beat => beat && typeof beat === "object").slice(0, 8).map(beat => ({ shape: shapeOf(beat.shape), place: placeOf(beat.place), line: text(beat.line) }));
  // `run` — на это место он бежит, а не идёт (0.47.0: удрал под кресло, когда позвали второй раз подряд).
  return { shape: shapeOf(raw.shape), place: placeOf(raw.place), key: text(raw.key, 16), beats, beat: first && beats.length ? 0 : -1, still: raw.still === true || !beats.length, ...(raw.run === true ? { run: true } : {}), ...(raw.steady === true ? { steady: true } : {}) };
}
/** Она из ответа сердца: чем занята, где — и её распорядок (`beats`: реплики состояния, каждая со своим местом). */
function herOf(raw) {
  const beats = (Array.isArray(raw?.beats) ? raw.beats : []).filter(beat => beat && typeof beat === "object" && HER_POSES.includes(beat.pose)).slice(0, 8).map(beat => ({ pose: beat.pose, line: text(beat.line) }));
  return { pose: HER_POSES.includes(raw?.pose) ? raw.pose : "desk", key: text(raw?.key, 16), ...(WEARS.includes(raw?.wear) ? { wear: raw.wear } : {}), beats, beat: 0,
    // 0.48.0. `steady` — её день ведёт сердце: первая реплика — то, что она делает сейчас, и сама страница её дальше
    // не ведёт. `face` — мимика: drowsy — клюёт носом.
    ...(raw?.steady === true ? { steady: true } : {}), ...(raw?.face === "drowsy" ? { face: "drowsy" } : {}) };
}
/** Часы человека из ответа: сколько осталось до ближайшей перемены (`left`, мс) и когда это было сказано (`at`). */
function clockOf(raw, at, step = 0) {
  // `step` (0.48.0) — через сколько сменится шаг её дня или место Байта: страница спросит комнату в ближайший из сроков.
  const left = Math.min(...[Number(raw?.left), Number(step)].filter(value => Number.isFinite(value) && value > 0));
  return Number.isFinite(left) ? { left: Math.min(left, 24 * 3_600_000), at, day: text(raw?.day, 10) } : null;
}
const wardrobeOf = (raw) => (raw && typeof raw === "object" && (text(raw.leave) || text(raw.back)) ? { leave: text(raw.leave), back: text(raw.back) } : null);
function doneOf(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return Object.fromEntries(CARE.map(name => [name, count(source[name])]));
}

/** Отказ сердца или платформы: слова — в разговор, рисунок остаётся каким был. */
export function refused(state, result, { retry = false } = {}) {
  // 0.49.0. Отказ «на время» (связь, срок, память, сбой сердца): комната остаётся на экране, под словами — кнопка
  // «Попробовать ещё раз» (она повторяет то же действие), внизу — пометка «нет связи» (`down`).
  const down = transient(result);
  return { ...state, busy: "", tone: "warn", retry: retry || down, down, said: text(result?.text) || "Что-то пошло не так. Попробуйте ещё раз." };
}
/**
 * Отказы «навсегда» — сердце сказало «нет» по делу (не тот человек, комната закрыта, сценка сыграна) или Telegram не
 * подтвердил вход: повторять то же самое бессмысленно. Всё остальное — «на время» (0.49.0): не дошло, не успело, не
 * запомнилось.
 */
const FINAL = /^(?:auth|off|closed|unknown|played|gone)$|UNAUTHORIZED|INIT_DATA|401|NOT_FOUND|404/iu;
export const transient = (result) => Boolean(result) && typeof result === "object" && result.ok !== true && !FINAL.test(String(result.code ?? "error"));
/** Запрос не дошёл или ответ не вернулся (срок, обрыв, пустой ответ): его можно послать ещё раз с тем же номером действия. */
export const resend = (result) => transient(result) && !/^(?:storage|runtime_error|slow)$|ENDPOINT|RATE|429/iu.test(String(result.code ?? "error"));
/**
 * Журнал ошибок страницы (0.49.0): место, код и короткий текст — без подписи Telegram, адресов, длинных чисел и
 * строк, похожих на ключи. `scrub` вычищает их из любого текста; `oopsAdd` кладёт запись в список (не больше
 * двадцати; та же ошибка подряд — одна строка со счётчиком).
 */
const SECRETS = Object.freeze([/tgWebApp[A-Za-z]*=[^\s&#]*/gu, /(?:query_id|auth_date|hash|signature|user|init_?data|token|key|secret)=[^\s&#]*/giu, /https?:\/\/\S+/gu, /[A-Za-z0-9_%+\/=-]{24,}/gu, /\d{6,}/gu]);
export const scrub = (value, limit = 140) => SECRETS.reduce((line, rule) => line.replace(rule, "…"), String(value ?? "")).replace(/\s+/gu, " ").trim().slice(0, limit);
export const OOPS_MAX = 20;
export function oopsAdd(list, where, code, words, at = 0) {
  const item = { at: Number(at) || 0, where: scrub(where, 24), code: scrub(code, 32), text: scrub(words) };
  const kept = (Array.isArray(list) ? list : []).filter(entry => entry && typeof entry === "object" && typeof entry.text === "string");
  const last = kept[kept.length - 1];
  if (last && last.where === item.where && last.code === item.code && last.text === item.text) return [...kept.slice(0, -1), { ...last, at: item.at, n: (Number(last.n) || 1) + 1 }];
  return [...kept, item].slice(-OOPS_MAX);
}

/** Ответ на «зайти» (`do: "look"`): всё, что видно в комнате. */
export function applyLook(state, result, at = 0) {
  if (!result || result.ok !== true) return refused(state, result, { retry: true });
  const part = PARTS.includes(result.clock?.part) ? result.clock.part : partOf(count(result.clock?.hour));
  const things = (Array.isArray(result.things) ? result.things : []).filter(item => THINGS.includes(item?.key));
  const thingLines = Object.fromEntries(things.map(item => [item.key, text(item.line) || `${text(item.title).slice(0, 1).toUpperCase()}${text(item.title).slice(1)}.`]));
  const fresh = (Array.isArray(result.fresh) ? result.fresh : []).filter(key => thingLines[key]);
  const done = doneOf(result.done);
  const lines = { her: text(result.her?.line), window: text(result.window), cat: text(result.cat?.line), box: text(result.box?.line), things: thingLines };
  // Она сама предлагает чай (0.48.0): её слова — последними, под ними страница покажет выбор.
  const offer = text(result.offer?.kind, 8) === "tea" ? text(result.offer.text) : "";
  const kinds = (Array.isArray(result.kinds) ? result.kinds : []).filter(kind => BREWS.includes(kind));
  const said = [text(result.greet), lines.her, lines.cat, ...fresh.map(key => `Новое в комнате. ${thingLines[key]}`), offer].filter(Boolean).join("\n");
  return {
    ...state, ready: true, busy: "", tone: "", retry: false, part, light: PARTS.includes(result.clock?.light) ? result.clock.light : "",
    her: herOf(result.her),
    turn: 0, patted: result.patted === true, sky: skyOf(result.sky),
    // Луна — по дню человека; дня в ответе нет — по часам устройства; нет и их — обычный месяц.
    moon: moonOf(text(result.clock?.day, 10) || (at > 0 ? at : null)), fx: sceneOf(result.scene)?.fx ?? [], away: false, entering: false,
    clock: clockOf(result.clock, at, result.step), wardrobe: wardrobeOf(result.wardrobe),
    // Прежнее сердце о лампе и колонке не знает (полей нет) — тогда они остаются какими были.
    dark: result.dark === undefined ? state.dark === true : result.dark === true, music: result.music === undefined ? count(state.music) : count(result.music),
    // Чай: сердце 0.48.0 называет его в `kind` каждому, а в `brew` — только хозяину (по `brew` прежняя страница
    // показывала кнопки под рисунком). Кнопки — хозяину: сердце 0.47.0 этого слова не знает — тогда как раньше.
    brew: BREWS.includes(result.brew) ? result.brew : BREWS.includes(result.kind) ? result.kind : "", quiet: count(result.quiet), quietEnd: text(result.quietEnd),
    owner: result.owner === undefined ? BREWS.includes(result.brew) : result.owner === true,
    // 0.49.0. `once` — это сердце помнит номера действий: не дошедший запрос страница может повторить сама.
    // Ответ пришёл — пометка «нет связи» снята.
    once: result.once === true, down: false,
    open: result.open === undefined ? state.open === true : result.open === true, airy: result.open !== undefined,
    kinds, offer, asking: offer && kinds.length > 1 ? "tea" : "", plan: text(result.her?.plan), told: "",
    cat: catOf(result.cat, null, { first: true }), plant: result.plant?.state === "dry" ? "dry" : "wet",
    things: things.map(item => item.key), lamp: /^#[0-9a-f]{6}$/iu.test(String(result.lamp ?? "")) ? result.lamp : "",
    fed: done.feed > 0, tea: done.tea > 0, lines, done, scene: sceneOf(result.scene), build: text(result.build, 20),
    next: count(result.next?.days) || null, said: said || "Заходите.",
  };
}

/**
 * Ответ на «что сейчас в комнате» при открытой странице (`do: "look", again: true`): сменился час или прошло время.
 * Возвращает состояние, каким комната должна стать: час, небо, она, Байт, вещи, сценка — но не слова под рисунком
 * (их говорит то, что произойдёт на рисунке) и не счётчики заботы. Отказ — прежнее состояние: комната остаётся
 * какой была, страница спросит позже.
 */
export function applyTick(state, result, at = 0) {
  if (!result || result.ok !== true || !state.ready) return state;
  const seen = applyLook(state, result, at);
  // Занята тем же, что и была, — остаётся на своей реплике: не возвращаться же к первой каждые десять минут.
  const same = (was, now) => { const index = was ? now.beats.findIndex(beat => beat.line && beat.line === was.line) : -1; return index >= 0 ? { ...now, beat: index } : now; };
  // Сердце 0.48.0 ведёт её день и Байта само (`steady`): где они сейчас, сказано в ответе — так и будет.
  const her = seen.her?.steady ? seen.her : state.her && seen.her && state.her.key === seen.her.key ? same(herBeat(state), seen.her) : seen.her;
  const cat = seen.cat?.steady ? seen.cat : state.cat && seen.cat && state.cat.key === seen.cat.key && seen.cat.still !== true && catBeat(state) ? same(catBeat(state), seen.cat) : seen.cat;
  // Она предложила чай, пока страница открыта, — выбор показывается один раз: те же слова второй раз не спрашивают.
  const asking = seen.offer && seen.offer !== state.offer && seen.kinds.length > 1 ? "tea" : state.asking;
  return { ...seen, her, cat, asking, told: state.told, said: state.said, tone: state.tone, retry: state.retry, busy: state.busy, demo: state.demo, patted: state.patted || seen.patted };
}

/**
 * Ответ на повтор уже сделанного действия (0.49.0, `repeat`): запрос тогда дошёл, а ответ — нет, и страница послала
 * его снова с тем же номером. Сердце второй раз ничего не делает и отвечает комнатой как она есть — она и
 * показывается; слова под рисунком — её нынешняя реплика.
 */
export function applyRepeat(state, result, at = 0) {
  if (!result || result.ok !== true) return refused(state, result);
  const next = applyTick({ ...state, busy: "" }, result, at);
  return { ...next, busy: "", tone: "", retry: false, down: false, said: herBeat(next)?.line || next.lines?.her || state.said };
}

/**
 * Витрина между сверками (0.48.0). У неё нет сердца, которое помнит: сделанную заботу, политый кактус, сыгранную
 * сценку, музыку и тихий час помнит сама страница. С 0.48.0 витрина сверяется каждые десять минут (шаг её дня) —
 * без этого каждая сверка стирала бы отметки заботы. `before` — что было, `after` — что дала сверка (`applyTick`).
 */
export function demoKept(before, after) {
  return { ...after, done: before.done, fed: before.fed, tea: before.tea, plant: before.plant, scene: before.scene, fx: before.fx, music: before.music, quiet: before.quiet, quietEnd: before.quietEnd };
}

/** Сколько миллисекунд до следующей части суток по часам устройства (границы — 5, 12, 18 и 23 часа): для витрины и прежнего сердца. */
export function leftOf(date = new Date()) {
  const hour = date.getHours(), edge = [5, 12, 18, 23].find(value => value > hour) ?? 29;
  return Math.max(30_000, ((edge - hour) * 60 - date.getMinutes()) * 60_000 - date.getSeconds() * 1000);
}
/**
 * Что сыграть, когда комната изменилась при открытой странице. `before` — что было, `after` — что стало (`applyTick`).
 *   same     — на рисунке ничего не изменилось;
 *   quiet    — час тот же: рисунок меняется сам (Байт проголодался, пошёл снег);
 *   light    — сменился час, наряд тот же: свет перетекает, она говорит новую реплику;
 *   wardrobe — сменился час и наряд: она уходит к шкафу, «*переодевается*», возвращается в другом.
 * `state` — состояние для первого шага (со словами под рисунком), `leave` и `back` — её слова у шкафа.
 */
export function changeOf(before, after) {
  const change = changeIn(before, after);
  // Она сама предложила чай (0.48.0) — под рисунком её вопрос; у шкафа он подождёт до её возвращения.
  const asked = after.offer && after.offer !== before.offer && after.asking === "tea";
  return asked && change.kind !== "wardrobe" ? { ...change, kind: change.kind === "same" ? "quiet" : change.kind, state: { ...change.state, said: after.offer } } : change;
}
function changeIn(before, after) {
  if (!before.ready || !after.ready) return { kind: "same", state: after };
  const herLine = herBeat(after)?.line || after.lines.her, catLine = catBeat(after)?.line || after.lines.cat;
  const lines = { ...after.lines, her: herLine || after.lines.her };
  const dressed = Boolean(before.her && after.her) && wearAt(before.part, before.her.wear) !== wearAt(after.part, after.her.wear);
  const closet = () => ({ leave: after.wardrobe?.leave || "Пойду переоденусь — я быстро.", back: [after.wardrobe?.back || "Вот. Так лучше.", herLine].filter(Boolean).join("\n") });
  // Час тот же и свет тот же. Свет по солнцу (0.47.0) меняется и посреди часа: закат в пять вечера — тоже перемена.
  if (before.part === after.part && lightOf(before) === lightOf(after)) {
    if (JSON.stringify(viewOf(before)) === JSON.stringify(viewOf(after))) return { kind: "same", state: { ...after, lines } };
    // Слова под рисунком идут за ним: изменилась она — её новая реплика; изменился Байт, а слова были о нём — новая о нём.
    // Её день ведёт сердце (0.48.0): новый шаг того же занятия — тоже перемена, и слова под рисунком — о нём.
    const herMoved = before.her?.key !== after.her?.key || (after.her?.steady === true && herBeat(before)?.line !== herBeat(after)?.line), catMoved = before.cat?.key !== after.cat?.key || before.cat?.place !== after.cat?.place || before.cat?.shape !== after.cat?.shape;
    const said = herMoved && herLine ? herLine : catMoved && catLine && before.said === before.lines.cat ? catLine : before.sky !== after.sky && after.lines.window && before.said === before.lines.window ? after.lines.window : after.said;
    // Час тот же, а наряд другой (0.48.0: проснулась и оделась по-дневному) — та же сцена у шкафа, что вечером.
    if (dressed) return { kind: "wardrobe", state: { ...after, lines, said: herLine || after.said }, ...closet() };
    return { kind: "quiet", state: { ...after, lines, said } };
  }
  const said = [after.lines.window, herLine].filter(Boolean).join("\n") || after.said;
  if (!dressed) return { kind: "light", state: { ...after, lines, said } };
  return { kind: "wardrobe", state: { ...after, lines, said }, ...closet() };
}

/** Ответ на заботу (`do`: pet, feed, play, tea, water). */
export function applyCare(state, op, result) {
  if (!result || result.ok !== true) return refused(state, result);
  const done = doneOf(result.done);
  const said = [text(result.line), text(result.note)].filter(Boolean).join("\n");
  // О Байте теперь говорят слова самой заботы: прежняя строка («сидит у миски») устарела.
  // Ей налили чай, пока она была за делом, — теперь она с кружкой: сердце шлёт её заново (0.44.0). Занята тем же,
  // чем была, — остаётся на своей реплике: от второй кружки она с места не срывается.
  const her = result.her && typeof result.her === "object" && state.her ? herOf(result.her) : null;
  const moved = her && her.key !== state.her.key;
  const lines = { ...state.lines, ...(result.cat ? { cat: text(result.line) } : {}), ...(moved && text(result.her.line) ? { her: text(result.her.line) } : {}) };
  return {
    ...state, busy: "", tone: "", retry: false, cat: catOf(result.cat, state.cat), plant: result.plant?.state === "dry" ? "dry" : "wet",
    ...(moved ? { her, turn: 0 } : {}),
    // Чай выбрали у чайника (0.48.0): вопрос «какой налить» снят, а налитый чай запомнен.
    asking: "", ...(BREWS.includes(result.kind) ? { brew: result.kind } : {}),
    done, fed: done.feed > 0, tea: done.tea > 0, lines, said: said || "Спасибо.",
  };
}

/**
 * Ответ на нажатие по полке с книгами (`do: "book"`, 0.45.0): она берёт книгу и садится читать — сердце шлёт её
 * заново (`her`); когда ей не до книг, приходят одни слова, и она остаётся где была.
 */
export function applyBook(state, result) {
  if (!result || result.ok !== true) return refused(state, result);
  const her = result.her && typeof result.her === "object" && state.her ? herOf(result.her) : null;
  return {
    ...state, busy: "", tone: "", retry: false,
    ...(her ? { her, turn: 0, lines: { ...state.lines, ...(text(result.her.line) ? { her: text(result.her.line) } : {}) } } : {}),
    said: text(result.line) || "…",
  };
}

/**
 * Ответ на «переодеться» (`do: "wear"`, 0.47.0): перемена для страницы — та же сцена у шкафа, что при смене часа
 * (`changeOf`). `kind: "wardrobe"` — она уходит, «*переодевается*», возвращается в другом (`leave`, `back` — её
 * слова); `same` — наряд тот же (она уже в нём или спит): одни слова.
 */
export function applyWear(state, result) {
  if (!result || result.ok !== true) return { kind: "same", state: refused(state, result) };
  const said = text(result.line) || "…";
  if (result.changed !== true || !WEARS.includes(result.wear) || !state.her) return { kind: "same", state: { ...state, busy: "", tone: "", retry: false, said } };
  const fresh = result.her && typeof result.her === "object";
  // Наряд назван ответом — он на ней поверх часов; занята она тем же — остаётся на своей реплике.
  const her = { ...(fresh && herOf(result.her).key !== state.her.key ? herOf(result.her) : state.her), wear: result.wear };
  const target = { ...state, busy: "", tone: "", retry: false, her, said };
  return { kind: "wardrobe", state: target, leave: said, back: [text(result.back) || "Вот.", herBeat(target)?.line || target.lines.her].filter(Boolean).join("\n") };
}

/**
 * Ответ на «посидеть рядом» (`do: "quiet"`, 0.47.0): идёт ли тихий час (`on`) и сколько осталось (`left`, мс);
 * сердце шлёт её и Байта заново — она читает в кресле, он спит; `end` — её слова, когда время выйдет.
 */
export function applyQuiet(state, result) {
  if (!result || result.ok !== true) return refused(state, result);
  const her = result.her && typeof result.her === "object" && state.her ? herOf(result.her) : null;
  const moved = result.cat && typeof result.cat === "object";
  return {
    ...state, busy: "", tone: "", retry: false, quiet: result.on === true ? count(result.left) : 0, quietEnd: result.on === true ? text(result.end) : "",
    ...(her ? { her, turn: 0 } : {}), cat: moved ? catOf(result.cat, state.cat) : state.cat,
    lines: { ...state.lines, ...(her && text(result.her.line) ? { her: text(result.her.line) } : {}), ...(moved && text(result.cat.line) ? { cat: text(result.cat.line) } : {}) },
    said: text(result.line) || "…",
  };
}

/** Ответ на «выбрать чай» (`do: "brew"`, 0.47.0): какой ей теперь наливают — и её слова о нём. */
export function applyBrew(state, result) {
  if (!result || result.ok !== true) return refused(state, result);
  return { ...state, busy: "", tone: "", retry: false, brew: BREWS.includes(result.brew) ? result.brew : state.brew, said: text(result.line) || "…" };
}

/**
 * Ответ на «позвать Байта» (`do: "call"`, 0.47.0): нажали на ковёр — он подошёл или, позванный второй раз подряд,
 * удрал под кресло; не идёт (спит, прячется) — приходят одни слова, и он остаётся где был.
 */
export function applyCall(state, result) {
  if (!result || result.ok !== true) return refused(state, result);
  const moved = result.cat && typeof result.cat === "object";
  return {
    ...state, busy: "", tone: "", retry: false, cat: moved ? catOf(result.cat, state.cat) : state.cat,
    lines: { ...state.lines, ...(moved ? { cat: text(result.line) } : {}) }, said: [text(result.line), text(result.note)].filter(Boolean).join("\n") || "…",
  };
}

/**
 * Ответ на нажатие по окну (`do: "window"`, 0.48.0): она открыла его или закрыла. Под рисунком — её слова и то, что
 * за окном; открытое окно слышно — улицей, закрытое — домом (`sound.js`).
 */
export function applyWindow(state, result) {
  if (!result || result.ok !== true) return refused(state, result);
  const outside = text(result.window) || state.lines.window;
  return { ...state, busy: "", tone: "", retry: false, open: result.open === true, lines: { ...state.lines, window: outside }, said: [text(result.line), outside].filter(Boolean).join("\n") || "…" };
}

/** Ответ на нажатие по лампе (`do: "lamp"`, 0.46.0): свет погашен или горит — и её слова об этом. */
export function applyLamp(state, result) {
  if (!result || result.ok !== true) return refused(state, result);
  return { ...state, busy: "", tone: "", retry: false, dark: result.dark === true, said: text(result.line) || "…" };
}

/**
 * Ответ на нажатие по колонке (`do: "music"`, 0.46.0): играет ли она (`on`) и сколько ещё (`left`, мс); сердце шлёт
 * её заново (`her`) — она танцует или возвращается к своим делам. Когда ей не до танцев, приходят одни слова.
 */
export function applyMusic(state, result) {
  if (!result || result.ok !== true) return refused(state, result);
  const her = result.her && typeof result.her === "object" && state.her ? herOf(result.her) : null;
  return {
    ...state, busy: "", tone: "", retry: false, music: result.on === true ? count(result.left) || 180_000 : 0,
    ...(her ? { her, turn: 0, lines: { ...state.lines, ...(text(result.her.line) ? { her: text(result.her.line) } : {}) } } : {}),
    said: text(result.line) || "…",
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
  const scene = sceneOf(result.scene) ?? state.scene;
  // Исход поставил её саму («значит, манга» — она в кресле с кружкой): сердце шлёт её заново — чем занята, где и
  // что говорит. Её первая реплика теперь — сами слова исхода: нажали на неё — она скажет о том, что на рисунке.
  const her = result.her && typeof result.her === "object" && state.her ? herOf(result.her) : null;
  return {
    ...state, busy: "", tone: "", retry: false, scene, said: [text(result.line), text(result.note)].filter(Boolean).join("\n") || state.said,
    lines: her && text(result.her.line) ? { ...lines, her: text(result.her.line) } : lines,
    // Рисунок идёт за словами исхода (0.44.0): Байт — туда, где сказано; в комнате — то, что сказано; она — где сказано.
    fx: scene?.fx ?? [], cat: catOf(result.cat, state.cat),
    ...(her ? { her, turn: 0 } : {}),
  };
}

/** Нажатие на то, что не забота: она сама, окно, коробка Байта, вещь. Возвращает новое состояние или `null` — сказать нечего. */
export function applyTap(state, act) {
  const name = String(act ?? "");
  // Нажали на неё второй раз подряд (0.48.0) — она говорит, что было до этого и что дальше по её плану.
  const second = name === "her" && state.told === "her" && state.said === state.lines.her && Boolean(state.plan);
  const said = name === "her" ? (second ? state.plan : state.lines.her) : name === "window" ? state.lines.window : name === "box" ? state.lines.box : name.startsWith("thing:") ? state.lines.things[name.slice(6)] : "";
  return said ? { ...state, tone: "", retry: false, said, told: name === "her" && !second ? "her" : "" } : null;
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
/** Чем она занята на витрине в этот час: состояние и распорядок — реплики с местами, как их прислало бы сердце. */
const DEMO_HER = Object.freeze({
  "утро": ["дело", [["desk", "Я у стола с блокнотом: разбираю записки и напоминания."], ["shelf", "Навожу порядок на полке и веду опись в блокноте. Чай — следующим пунктом."], ["sill", "С блокнотом у подоконника: вспоминаю, что обещала не забыть. Ручка — у губ."]]],
  "день": ["игра", [["shelf", "Дирижирую парадом на полке: ВАЛЛ-И сегодня командир."], ["dance", "Танцую под lo-fi с ленточкой. Плохо, зато с душой."], ["ribbon", "Дразню Байта ленточкой. Счёт три — ноль в его пользу."]]],
  "вечер": ["уют", [["chair", "Чай, кресло, плед и «Маленький принц» — в таком порядке. Пока на первом пункте."], ["garland", "Пью чай под гирляндой. Манга ждёт: третья глава, наконец-то."], ["map", "С кружкой у карты звёздного неба. Нашла Кассиопею — и тут же потеряла."]]],
  "ночь": ["сон", [["nap", "Завернулась в плед по самый нос. Почти сплю."]]],
});
/**
 * День на витрине (0.48.0): по часам устройства, как у сердца, — `[с какого часа, состояние, шаги]`; шаг — десять
 * минут. Утро, день, вечер и ночь — прежние реплики; у подъёма, чая и уборки — свои. Слова — из словаря.
 */
const DEMO_DAY = Object.freeze([
  [0, ...DEMO_HER["ночь"]],
  [7, "дело", [["sill", "Проснулась. Стою с блокнотом у подоконника: смотрю, какая погода, и пишу план на день."], ["feed", "Насыпаю Байту корм. Он уже тут: хрустит прямо из-под пакета, до миски не дотерпел."], ["dust", "Смахиваю пыль метёлкой: с рамки, с ВАЛЛ-И, с книжных корешков. Утро начинается с порядка."]]],
  [8, ...DEMO_HER["утро"]],
  [13, "уют", [["chair", "Чай, кресло, плед. Перерыв — это тоже пункт плана."], ["garland", "Пью чай под гирляндой. Первый глоток — самый лучший."], ["map", "С кружкой у карты звёздного неба: ищу Кассиопею. Чай помогает."]]],
  [14, ...DEMO_HER["день"]],
  [17, "дело", [["dust", "Смахиваю пыль метёлкой: полка, рамка, ВАЛЛ-И. Байт чихает из солидарности."], ["sort", "Раскладываю книги: стопка в руке, остальные — по росту. По алфавиту скучно."]]],
  [18, ...DEMO_HER["вечер"]],
  [23, ...DEMO_HER["ночь"]],
]);
/** Байт на витрине при её занятии: она насыпает корм — он ест рядом; она спит — он спит у неё под боком. */
const DEMO_MEAL = Object.freeze({ shape: "eat", place: "near", key: "голоден", line: "Байт хрустит кормом прямо из-под пакета. До миски он не дотерпел.", beats: [], still: true });
const DEMO_NIGHT = Object.freeze({ shape: "curl", place: "near", key: "спит", line: "Байт свернулся у меня под боком и сопит. Нас двое — не будите.", beats: [], still: true });
const DEMO_OFFER = "Время чая. Что налить — жасмин, улун или мяту?";
/** Чай на витрине — словами этого чая: как у сердца (запасы «+комната:чай:улун», «+комната:чай:мята»). */
const DEMO_TEA = Object.freeze({ "улун": "Улун. Спасибо: тёплый, молочный — и кружка греет ладони.", "мята": "С мятой. Спасибо — вдох, глоток, и день становится короче." });
const DEMO_AIR = Object.freeze({ open: "Открыла окно: слышно город. Проветрю — и через час закрою сама.", shut: "Закрыла. Снова слышно комнату: чайник, страницы и Байта." });
const DEMO_RAIN = Object.freeze({
  "утро": "За окном серое утро и дождь: город только просыпается.", "день": "За окном — город в дожде. Лампа выключена: света хватает.",
  "вечер": "Вечер. За окном дождь и фонари, гирлянда уже горит.", "ночь": "Ночь. За окном — огни ночного города и капли на стекле.",
});
/** Слова об окне на витрине — по небу; о дожде — ещё и по часу. */
const DEMO_WINDOW = Object.freeze({
  clear: "За окном ясно: над крышами чистое небо.", clouds: "За окном облака идут над крышами.", overcast: "За окном пасмурно, но сухо.",
  fog: "За окном туман: дальних крыш не видно.", storm: "За окном гроза: дождь стеной, над башней сверкает.", snow: "За окном снег: крыши белые, город притих.",
});
/** Байт на витрине: голоден — и его распорядок. */
const DEMO_CAT = Object.freeze([
  ["sit", "bowl", "Байт сидит у миски и смотрит. На миску. На меня. Снова на миску."],
  ["walk", "rug", "Байт ходит кругами по ковру и жалуется на жизнь. Миска пуста."],
  ["lie", "bowl", "Байт изображает голодный обморок у миски. Талантливо."],
]);
const DEMO_WARDROBE = Object.freeze({
  home: { leave: "Вечер. Пойду переоденусь в домашнее — я быстро.", back: "Вот так лучше: свитер, наушники — вечер начался." },
  jacket: { leave: "Утро. Переоденусь — и за дела.", back: "Готова. Куртка на плечах — можно начинать день." },
});
const DEMO_CARE = Object.freeze({
  pet: ["Байт подставил ухо и замурчал. Вас одобрили.", "Байт перевернулся на спину. Это ловушка — но приятная.", { shape: "sit", place: "near" }],
  feed: ["Миска полна, Байт счастлив.", "Он уже ел. Смотрит честными глазами — не верьте.", { shape: "eat", place: "bowl" }],
  play: ["Байт носится по комнате серой молнией. Колючка в безопасности — пока.", "Байт уже набегался: смотрит на ленточку одним глазом.", { shape: "play", place: "rug" }],
  tea: ["Спасибо. Жасминовый — мой любимый.", "Ещё кружка? Наливайте. Чая много не бывает.", null],
  water: ["Колючка полита. Она молчит, но я вижу: довольна.", "Ей пока хватит: она кактус, а не водяная лилия.", null],
});
const DEMO_SCENE = Object.freeze({
  key: "sock", text: "Байт принёс добычу и положил к ногам. Это носок. Чей — неизвестно.", options: ["Похвалить охотника", "Отобрать носок"],
  outcomes: ["Байт горд собой и унёс носок в коробку — к остальным трофеям. Там уже целая коллекция.", "Носок отобран. Байт смотрит так, будто его ограбили. Придётся мириться вкусняшкой."],
  // Где Байт после каждого исхода — как сказано словами: унёс в коробку — в коробке; ограблен — сидит рядом.
  cats: [{ shape: "curl", place: "box" }, { shape: "sit", place: "near" }],
});
const DEMO_THINGS = Object.freeze({
  "кружка": "Вторая кружка — для гостя. То есть для вас.", "тапочки": "Тапочки у двери. Гостевые.", "подушка": "Вторая подушка на подоконнике: смотреть в окно вдвоём.",
  "снимок": "Рамка с нашим первым разговором.", "плед": "Плед на двоих. Синий, как и мой.", "календарь": "Календарь. Один день обведён — день знакомства.",
  "кресло": "Второе кресло у окна. Ваше.", "кактус": "Маленький кактус рядом с Колючкой. Имя ещё не придумала.", "место": "Место на подоконнике рядом с Байтом. Он подвинулся — это редкость.",
  "абажур": "Абажур — любимого цвета гостя.", "рисунок": "Мой рисунок на стене.", "ёлка": "Ёлка с гирляндой. Байт уже присматривается к шарам.",
  "торт": "Торт со свечкой — в день рождения гостя.", "свеча": "Свеча у рамки — в годовщину знакомства.", "фонарь": "Фонарь у окна — в Рамадан и оба байрама.",
});
export const DEMO_NOTE = "Это витрина: по-настоящему комната открывается из Telegram — кнопкой «Комната» в чате с Аи.";

/**
 * Ответ «зайти» для витрины. `params` — из адреса после «#» (для снимков и проверки): part, her, key, cat, things,
 * lamp, plant, sky (что за окном), left (через сколько миллисекунд сменится час), fx (что изменила сценка).
 */
export function demoLook(hour = 12, params = {}) {
  const part = PARTS.includes(params.part) ? params.part : partOf(hour);
  // Час назван в адресе (`part`) или минута не названа (тесты, снимки) — её занятие по часу, как раньше. Иначе — её
  // день по часам устройства (0.48.0): эпизод по часу, шаг по минуте; страница сверится, когда шаг сменится (`step`).
  const minute = Number(params.minute ?? NaN), timed = Number.isFinite(minute) && !PARTS.includes(params.part);
  const block = [...DEMO_DAY].reverse().find(([from]) => from <= hour) ?? DEMO_DAY[0];
  const [key, steps] = PARTS.includes(params.part) ? DEMO_HER[part] : [block[1], block[2]];
  const from = timed ? Math.floor(((hour - block[0]) * 60 + minute) / 10) % steps.length : 0;
  const beats = [...steps.slice(from), ...steps.slice(0, from)];
  // С `#turn=` (проверка в браузере) страница листает шаги сама, как до 0.48.0.
  const steady = timed && !(Number(params.turn) > 0);
  const pace = timed ? Math.floor((hour * 60 + minute) / 7) % DEMO_CAT.length : 0, pets = [...DEMO_CAT.slice(pace), ...DEMO_CAT.slice(0, pace)];
  const [shape = "sit", place = "bowl", catKey = "голоден"] = String(params.cat ?? "").split(".").filter(Boolean);
  const listed = params.things === "all" ? [...THINGS] : String(params.things ?? "кружка,тапочки").split(",").filter(name => THINGS.includes(name));
  const sky = skyOf(params.sky), left = Number(params.left);
  // Позу назвали в адресе — она стоит в ней и распорядка нет: снимок должен быть таким, каким его попросили.
  const fixed = HER_POSES.includes(params.her);
  return {
    ok: true, do: "look", build: "", owner: true, kinds: [...BREWS], open: params.open === "1",
    ...(timed ? { step: Math.max(3_000, Math.round((10 - (minute % 10)) * 60_000)) } : {}),
    ...(timed && block[0] === 13 && (hour - 13) * 60 + minute < 25 ? { offer: { id: "витрина", kind: "tea", text: DEMO_OFFER } } : {}),
    clock: { hour, part, ...(PARTS.includes(params.light) ? { light: params.light } : {}), ...(left > 0 ? { left } : {}) }, greet: DEMO_NOTE, window: sky === "rain" ? DEMO_RAIN[part] : DEMO_WINDOW[sky], sky,
    wardrobe: DEMO_WARDROBE[wearAt(part)],
    her: { pose: fixed ? params.her : beats[0][0], key: params.key ?? key, line: fixed ? "" : beats[0][1], beats: fixed || params.key ? [] : beats.map(([pose, line]) => ({ pose, line })), ...(steady && !fixed && !params.key ? { steady: true } : {}) },
    // Гроза (0.46.0): Байт под пледом, наружу один хвост, — как у сердца (запас «+комната:байт:гроза»).
    cat: sky === "storm" && !params.cat ? { shape: "tail", place: "plaid", key: "шалит", line: "Гром — и Байта как не бывало: из-под пледа торчит один хвост и делает вид, что он ни при чём.", beats: [], still: true }
      : steady && !params.cat && !fixed && !params.key && beats[0][0] === "feed" ? { ...DEMO_MEAL }
        : steady && !params.cat && !fixed && !params.key && key === "сон" ? { ...DEMO_NIGHT }
          : { shape: params.cat ? shape : pets[0][0], place: params.cat ? place : pets[0][1], key: catKey, line: params.cat ? "" : pets[0][2], beats: params.cat ? [] : pets.map(([one, where, line]) => ({ shape: one, place: where, line })), still: Boolean(params.cat), ...(steady ? { steady: true } : {}) },
    plant: { state: params.plant === "wet" ? "wet" : "dry" }, done: {}, cared: false,
    things: listed.map(name => ({ key: name, title: name, line: DEMO_THINGS[name] ?? "" })), lamp: params.lamp ?? "", drawing: "", fresh: [], next: null,
    dark: params.dark === "1", music: params.music === "1" ? 180_000 : 0, brew: BREWS.includes(params.brew) ? params.brew : BREWS[0],
    box: { count: 2, line: "В коробке Байта — его трофеи: носок неизвестного происхождения и лампочка от гирлянды. Растёт с каждой сценкой." }, patted: false,
    scene: params.scene === "0" ? null : { key: DEMO_SCENE.key, text: DEMO_SCENE.text, options: DEMO_SCENE.options, pick: null, outcome: null, fx: String(params.fx ?? "sock").split(",").filter(Boolean) }, first: true,
  };
}
/** Ответ на заботу для витрины: те же поля, что у сердца. */
export function demoCare(state, op, kind = "") {
  const [usual, again, moved] = DEMO_CARE[op] ?? ["", "", null];
  // Чай выбрали у чайника (0.48.0): первая кружка — словами этого чая.
  const poured = op === "tea" ? (BREWS.includes(kind) ? kind : state.brew || BREWS[0]) : "", first = DEMO_TEA[poured] ?? usual;
  const before = count(state.done?.[op]);
  const early = op === "water" && state.plant === "wet";
  return {
    ok: true, do: op, build: "", line: before || early ? again : first, again: Boolean(before) || early, early, peace: false, counted: false,
    // Где Байт — по словам ответа: «перевернулся на спину» — лежит на спине, «уже ел» — сидит у миски.
    ...(moved ? { cat: { key: op === "feed" ? "сыт" : op === "play" ? "игра" : "ласка", ...(!before ? moved : op === "pet" ? { shape: "belly", place: "near" } : { shape: op === "feed" ? "sit" : "lie", place: moved.place }) } } : {}),
    // Чай налили, пока она была за делом, — час она с кружкой: как у сердца (`herKey` с отметкой о чае).
    ...(op === "tea" && (state.her?.key === "дело" || state.her?.key === "игра") ? { her: { key: "уют", pose: DEMO_HER["вечер"][1][0][0], line: DEMO_HER["вечер"][1][0][1], beats: DEMO_HER["вечер"][1].map(([pose, line]) => ({ pose, line })) } } : {}),
    plant: { state: op === "water" ? "wet" : state.plant }, done: { ...state.done, [op]: before + (early ? 0 : 1) }, cared: true,
    ...(poured ? { kind: poured, brew: poured } : {}),
  };
}
/** Окно на витрине (0.48.0): открыла — закрыла; слова — из словаря. */
export function demoWindow(state) {
  const open = state.open !== true;
  return { ok: true, do: "window", build: "", open, line: open ? DEMO_AIR.open : DEMO_AIR.shut, window: state.lines?.window ?? "" };
}
/** «Возьми книгу» на витрине: она садится читать, если не спит. */
export function demoBook(state) {
  if (state.her?.key === "сон") return { ok: true, do: "book", build: "", line: "…Сплю. Книга подождёт до утра.", taken: false };
  // Те же слова, что прислало бы сердце: запасы «+комната:полка» и «+комната:она:уют».
  const line = "Читаю в кресле. Глава такая, что не оторваться: Байт зовёт ужинать уже второй раз.";
  return { ok: true, do: "book", build: "", line: "Возьму вот эту — «Маленького принца». Перечитываю каждую осень. Кресло, я иду.", taken: true, again: false, her: { key: "уют", pose: "read", line, beats: [{ pose: "read", line }] } };
}
/** «Посидеть рядом» на витрине: двадцать пять минут она читает, Байт спит; нажали ещё раз — закончили. Слова — из словаря. */
export function demoQuiet(state) {
  if (count(state.quiet) > 0) return { ok: true, do: "quiet", build: "", line: "Уже всё? Хорошо. Сколько успелось — столько успелось.", on: false, left: 0, end: "" };
  const line = "Читаю рядом и не мешаю. Время идёт — я за ним слежу.", nap = "Байт свернулся на подушке и спит: тихий час — его любимый жанр.";
  return {
    ok: true, do: "quiet", build: "", line: "Сажусь рядом с книгой. Двадцать пять минут тишины: я слежу за временем, Байт — за порядком.", on: true, left: 25 * 60_000,
    end: "Всё, время вышло. Сидели тихо, как в библиотеке. Теперь можно и потянуться.",
    ...(state.her?.key === "сон" ? {} : { her: { key: "уют", pose: "read", line, beats: [{ pose: "read", line }] } }),
    cat: { key: "спит", shape: "curl", place: "pillow", line: nap, beats: [], still: true },
  };
}
/** «Переодеться» на витрине: в другой наряд — не тот, что на ней; спит — не переодевается. Слова — из словаря. */
export function demoWear(state) {
  const worn = wearAt(state.part, state.her?.wear);
  if (state.her?.key === "сон") return { ok: true, do: "wear", build: "", line: "…Сплю. Переоденусь утром.", wear: worn, changed: false };
  return worn === "home"
    ? { ok: true, do: "wear", build: "", line: "Куртка так куртка: вид деловой, характер прежний. Минуту.", back: "Вот. Куртка, чокер — и вид, будто у меня планы.", wear: "jacket", changed: true }
    : { ok: true, do: "wear", build: "", line: "Свитер так свитер: куртку — на вешалку. Минуту.", back: "Вот. Свитер, тёплые рукава — и никуда не тороплюсь.", wear: "home", changed: true };
}
const DEMO_BREW = Object.freeze({
  "жасмин": "Возвращаемся к жасмину. Он пахнет так, будто всё уже хорошо.",
  "улун": "Улун. Его заваривают не торопясь — значит, и мы никуда не торопимся.",
  "мята": "Мятный. От него в комнате пахнет летом, какой бы ни был месяц.",
});
/** «Выбрать чай» на витрине: следующий по кругу. Слова — из словаря. */
export function demoBrew(state) {
  const kind = BREWS[(Math.max(0, BREWS.indexOf(state.brew)) + 1) % BREWS.length];
  return { ok: true, do: "brew", build: "", brew: kind, line: DEMO_BREW[kind] };
}
/** «Позвать Байта» на витрине: подходит; позвали ещё раз, пока он рядом, — удирает под кресло. Слова — из словаря. */
export function demoCall(state) {
  const near = state.cat?.place === "near" && state.cat?.shape === "sit" && state.cat?.called === true;
  if (near) return { ok: true, do: "call", build: "", line: "«Кс-кс» дважды — это уже подозрительно. Байт метнулся под кресло: из темноты смотрят два глаза.", came: false, fled: true, cat: { key: state.cat.key, shape: "eyes", place: "under", beats: [], still: true, run: true } };
  return { ok: true, do: "call", build: "", line: "Услышал. Потянулся, зевнул и пришёл — будто сам собирался. Сидит рядом, хвост вокруг лап.", came: true, fled: false, cat: { key: state.cat?.key ?? "сыт", shape: "sit", place: "near", beats: [], still: true, called: true } };
}
/** Лампа на витрине: когда за окном темно — гаснет и загорается; пока светло, она не горит и так. */
export function demoLamp(state) {
  const light = lightOf(state);
  if (light !== "вечер" && light !== "ночь") return { ok: true, do: "lamp", build: "", line: "Пока за окном светло, лампа отдыхает: окно светит ярче неё. Стемнеет — другое дело.", dark: state.dark === true, changed: false };
  const dark = state.dark !== true;
  return { ok: true, do: "lamp", build: "", line: dark ? "Гашу лампу. Остаётся гирлянда — так даже уютнее." : "Свет вернулся. Гирлянда делает вид, что и одна справлялась.", dark, changed: true };
}
/** Колонка на витрине: три минуты музыки, и она танцует; нажали ещё раз — выключила и вернулась к своим делам. */
export function demoMusic(state) {
  if (state.her?.key === "сон") return { ok: true, do: "music", build: "", line: "…Сплю. Музыку — утром, ладно?", on: false, left: 0 };
  if (state.music > 0) {
    const [key, beats] = DEMO_HER[PARTS.includes(state.part) ? state.part : "день"];
    return { ok: true, do: "music", build: "", line: "Выключаю. Тишина — тоже музыка: так считает Байт, когда спит.", on: false, left: 0, her: { key, pose: beats[0][0], line: beats[0][1], beats: beats.map(([pose, line]) => ({ pose, line })) } };
  }
  const line = "Танцую под lo-fi из колонки. Плохо, зато от души — Байт не жалуется.";
  return { ok: true, do: "music", build: "", line: "О, музыка. Ставлю lo-fi — тихо, чтобы Байт не возражал. И да, я буду танцевать.", on: true, left: 180_000, her: { key: "игра", pose: "dance", line, beats: [{ pose: "dance", line }] } };
}
/** «Погладить её» на витрине. */
export function demoPat(state) {
  return { ok: true, do: "pat", build: "", line: state.patted ? "Ещё? Я не против. Только Байту не говорите: он считает, что гладить положено его." : "…Так можно было? Ладно. Мне нравится.", again: state.patted === true, counted: false };
}
export function demoPick(state, pick) {
  const index = pick === 1 ? 1 : 0;
  return {
    ok: true, do: "pick", build: "", line: DEMO_SCENE.outcomes[index], counted: false, scene: { ...state.scene, pick: index, outcome: DEMO_SCENE.outcomes[index], fx: [] },
    cat: { key: "шалит", ...DEMO_SCENE.cats[index], beats: [], still: true }, cared: true,
  };
}
