/**
 * Комната Аи — страница (мини-приложение, сборка 0.44.0): нажатия, связь с сердцем, раскладка по разметке.
 *
 * Что нарисовать — `scene.js`; что показать по ответу сердца — `logic.js` (оба проверяются тестами без браузера).
 * Здесь — только то, чему нужен браузер и Telegram:
 *   • связь: `Telegram.WebApp.Serverless.call("room", { do }, (err, result) => …)` — платформа сама прикладывает
 *     подпись Telegram, а функция `endpoints/room` получает проверенного человека;
 *   • открыта не из Telegram (нет подписи) — витрина: комната по часам устройства, забота понарошку;
 *   • ошибка связи — словами в её реплике и кнопкой «Попробовать ещё раз», а не пустым экраном;
 *   • её картинки (папка `her/`, с 0.40.0): грузится только та, что нужна сейчас; не загрузилась — она нарисована
 *     кодом, как раньше, а комната открывается в любом случае;
 *   • позы (с 0.41.0): картинок у состояния несколько — она меняет позу сама и от нажатия; следующая картинка
 *     подгружается заранее, а смена идёт только когда она уже здесь;
 *   • своя жизнь (с 0.44.0): она и Байт меняют занятие сами, по очереди, — и доходят до нового места шагом;
 *     слова под рисунком при этом те, что о нынешней картинке (распорядок присылает сердце: `her.beats`, `cat.beats`);
 *   • смена часа при открытой странице (с 0.44.0): страница сама спрашивает комнату заново — свет перетекает, а
 *     если в этот час она переодевается, уходит к шкафу, «*переодевается*» и возвращается в другом;
 *   • звук (`sound.js`, с 0.41.0): выключатель под рисунком; модуль грузится, когда звук включили;
 *   • кнопка «на главный экран» — там, где Telegram это умеет.
 */
import * as scene from "./scene.js";
import * as logic from "./logic.js";

// Имена берутся из модулей целиком, а не по одному. Страница — четыре файла, и после новой публикации браузер
// может какое-то время держать старую копию любого из них. Импорт по именам такого не прощает: нет в старом
// `scene.js` нового имени — и страница не запускается вовсе. Так имя просто окажется пустым; всё, что добавлено
// после первой публикации (`drawRain`, `spriteOf`, `drawSprite`, `spritesOf`, `spriteStand`, `applyPat`, `nextTurn`,
// а с 0.44.0 — `castOf`, `walkOf`, `walkSeconds`, `DOOR_X`, `applyTick`, `changeOf`, `nextBeat`, `leftOf`, с 0.45.0 —
// `frameOf`, `applyBook`, `demoBook`), перед вызовом проверяется.
const { drawBackdrop, drawRain, drawInside, spriteOf, drawSprite, spritesOf, spriteStand, castOf, walkOf, walkSeconds, DOOR_X, frameOf } = scene;
const { PAGE, CARE, LIGHTS, HEADERS, blank, viewOf, applyLook, applyCare, applyPick, applyTap, applyPat, nextTurn, refused, explain, unwrap, demoLook, demoCare, demoPick, demoPat, applyTick, changeOf, nextBeat, leftOf, applyBook, demoBook, applyLamp, demoLamp, applyMusic, demoMusic, applyCall, demoCall } = logic;
/**
 * Каким светом красить небо и страницу (0.47.0): по солнцу города, если его знают и рисунок (`scene.lightIn`), и
 * описание (`view.light`); прежний `scene.js` красит комнату по часам — тогда по часам и небо, и шапка.
 */
const lightIn = (view) => (typeof scene.lightIn === "function" ? scene.lightIn(view) : view.part);
/** Второй кадр картинки (движение внутри позы, 0.45.0); прежний `scene.js` кадров не знает. */
const frameName = (name) => (typeof frameOf === "function" ? frameOf(name) : null);
// Что бывает за окном: с 0.44.0 — семь видов неба (погода города человека); прежняя логика знает два.
const SKY_NAMES = Array.isArray(logic.SKIES) ? logic.SKIES : ["rain", "snow"];
const skyName = (value) => (SKY_NAMES.includes(value) ? value : "rain");
const SKY_WORDS = Object.freeze({ clear: "ясное небо", clouds: "облака", overcast: "пасмурное небо", fog: "туман", rain: "дождь", storm: "гроза", snow: "снег" });

const tg = window.Telegram?.WebApp ?? null;
const $ = (id) => document.getElementById(id);
const inTelegram = Boolean(tg && typeof tg.initData === "string" && tg.initData);
const canCall = Boolean(inTelegram && tg.Serverless && typeof tg.Serverless.call === "function");
// Настройки витрины из адреса (`#part=вечер&things=all`) — только для снимков на своей машине: на опубликованной
// странице их нет, иначе ссылкой можно было бы вложить ей в уста чужие слова.
const local = /^(?:localhost|127\.0\.0\.1)$/u.test(location.hostname);
const params = local ? Object.fromEntries(new URLSearchParams(location.hash.replace(/^#/u, ""))) : {};
const WAIT_MS = 20_000;
// Сколько ждать её картинку, прежде чем нарисовать её кодом. Придёт позже — картинка встанет на место.
const SPRITE_WAIT_MS = 6_000;

let state = { ...blank(new Date().getHours()), demo: !inTelegram };
let header = "";
// Что уже нарисовано: рисунок меняется, только когда изменилось то, что на нём видно. `cast` — кто где на рисунке:
// её картинка и место, где она стоит, место и фигура Байта — по ним прежняя поза тает, а до нового места они
// доходят шагом. `back` и `inside` — приставки имён слоёв: когда час сменяется при открытой странице, прежний слой
// тает поверх нового, и имена у них должны быть разными.
const drawn = { part: "", sky: "", moon: null, view: "", cast: null, back: "s-", inside: "r-", until: 0 };
// Сколько прежний слой тает поверх нового (то же число — в стилях: `.fading`).
const FADE_MS = 1600;
// Сколько её нет, пока она переодевается.
const CHANGE_MS = local && Number(params.change) >= 200 ? Number(params.change) : 3400;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
// Идёт сцена у шкафа: нажатия ждут, своя жизнь тоже.
let acting = false;

// ── Она картинкой ────────────────────────────────────────────────────────────
// Картинка на каждое её состояние — отдельным модулем в папке `her/`: `export default { w, h, cx, src }`. Модуль
// грузится, когда понадобился. Его определение кладётся в рисунок один раз (в «кладовую», `<defs id="store">`), а
// комната при каждой перерисовке только ссылается на него — так она не моргает от нажатий.
// `sprites`: имя → спрайт; `false` — не загрузился (она нарисована кодом); имени нет — ещё в пути (её пока не видно).
const sprites = {};
const asked = new Set();
const kept = [];
const canPaint = typeof spriteOf === "function" && typeof drawSprite === "function";
// Позы сменяются, только если рисунок и логика — новые: в прежних копиях этих имён нет.
const canTurn = canPaint && typeof spritesOf === "function" && typeof nextTurn === "function";
// Сколько она стоит в одной позе: от и до, миллисекунды. На своей машине срок можно назвать в адресе (`#turn=900`) —
// для проверки в браузере: ждать полминуты она не может.
const TURN_MS = Object.freeze(local && Number(params.turn) >= 200 ? [Number(params.turn), Number(params.turn)] : [24_000, 40_000]);

/** Определение картинки — в кладовую рисунка. Кладовой в разметке нет (старая копия `index.html`) — создаётся. */
function store(name, sprite) {
  const room = $("room");
  if (!room) return false;
  let shelf = $("store");
  if (!shelf) {
    shelf = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    shelf.id = "store";
    room.prepend(shelf);
  }
  const holder = document.createElementNS("http://www.w3.org/2000/svg", "g");
  // Негодную картинку рисунок не примет — вернёт пустую строку.
  holder.innerHTML = drawSprite(name, sprite);
  if (!holder.firstChild) return false;
  shelf.append(holder);
  return true;
}
/**
 * Читается ли картинка — и заодно разобрать её заранее: тогда она появляется сразу целиком, а не кусками. `false` —
 * браузер её показать не может (не знает формата, или страница не даёт показывать такие картинки): тогда она
 * будет нарисована кодом. Без этого вопроса рисунок сослался бы на картинку, которой не видно, — и её не было бы вовсе.
 */
function decoded(sprite) {
  return new Promise((resolve) => {
    try {
      const image = new Image();
      kept.push(image);
      image.onerror = () => resolve(false);
      image.onload = () => {
        if (!(image.naturalWidth > 0)) { resolve(false); return; }
        if (typeof image.decode === "function") image.decode().then(() => resolve(true), () => resolve(true));
        else resolve(true);
      };
      image.src = sprite.src;
    } catch { resolve(false); }
  });
}
function settle(name, sprite) {
  if (sprites[name] === sprite || (sprites[name] && !sprite)) return;
  sprites[name] = sprite;
  // Перерисовать — только если на рисунке сейчас нужна именно эта картинка: лишняя перерисовка запускает заново
  // гирлянду и хвост Байта.
  const shown = spriteOf(viewOf(state));
  if (shown === name) { drawn.view = ""; paint(); return; }
  // Второй кадр позы, что сейчас на рисунке, пришёл позже неё самой: показать — но не посреди перехода.
  if (sprite && frameName(shown) === name) frameLater();
}
/**
 * Второй кадр пришёл, когда поза уже на рисунке: перерисовка покажет его, но она же оборвала бы переход — прежняя
 * поза ещё тает, или она ещё идёт. Поэтому перерисовка ждёт конца перехода (`drawn.until`).
 */
let frameTimer = 0;
function frameLater() {
  clearTimeout(frameTimer);
  frameTimer = setTimeout(() => {
    if (Date.now() < drawn.until) { frameLater(); return; }
    const frame = frameName(spriteOf(viewOf(state)));
    if (!frame || !sprites[frame] || acting) return;
    drawn.view = "";
    paint();
  }, Math.max(0, drawn.until - Date.now()) + 60);
}
/** Все позы этого состояния по порядку; в прежнем рисунке их одна. */
const posesOf = (view) => (canTurn ? spritesOf(view) : []);
/** Дождаться картинок (или срока): перед сценой у шкафа нужны обе «идёт» и новая поза. */
function settled(names, wait = 5000) {
  const wanted = names.filter(Boolean);
  for (const name of wanted) fetchSprite(name);
  const until = Date.now() + wait;
  return new Promise((resolve) => {
    const check = () => { if (wanted.every(name => sprites[name] !== undefined) || Date.now() > until) resolve(); else setTimeout(check, 120); };
    check();
  });
}
/**
 * Следующая поза — только когда её картинка уже здесь: иначе она пропала бы на время загрузки. Нет картинки —
 * она заказывается, а смена случится в следующий раз. Возвращает, сменилась ли поза.
 */
function turn() {
  if (!canTurn || !state.ready || state.busy || acting || document.hidden) return false;
  const list = posesOf(viewOf(state));
  if (list.length < 2) return false;
  const next = list[((Number.isInteger(state.turn) ? state.turn : 0) + 1) % list.length];
  if (!sprites[next]) { fetchSprite(next); return false; }
  state = nextTurn(state);
  paint();
  return true;
}
// ── Своя жизнь ───────────────────────────────────────────────────────────────
// Она и Байт живут сами, не дожидаясь нажатий: по очереди переходят к следующему занятию. У каждой реплики
// распорядка своя картинка, поэтому слова под рисунком меняются вместе с ним — и говорят о том, что на нём сейчас.
const canBeat = typeof nextBeat === "function";
/** Её следующее занятие. Картинки ещё нет — она заказывается, а ход случится в следующий раз. */
function herStep() {
  if (!state.ready || state.busy || acting || document.hidden) return false;
  const next = canBeat ? nextBeat(state, "her") : null;
  // Распорядка нет (прежнее сердце или витрина с заданной позой) — позы идут по кругу, как раньше.
  if (!next) return turn();
  const name = canPaint ? spriteOf(viewOf(next)) : null;
  if (name && sprites[name] === undefined) { fetchSprite(name); return false; }
  state = next;
  paint();
  return true;
}
/** Байт идёт на следующее место. Спит, прячется или его держит сценка — остаётся где был. */
function catStep() {
  if (!state.ready || state.busy || acting || document.hidden) return false;
  const next = canBeat ? nextBeat(state, "cat") : null;
  if (!next) return false;
  state = next;
  paint();
  return true;
}
let turnTimer = 0, lifeTurn = 0;
function scheduleTurn() {
  clearTimeout(turnTimer);
  if (!canTurn) return;
  turnTimer = setTimeout(() => {
    lifeTurn += 1;
    // По очереди: она, Байт. Кому идти некуда, тот ход пропускает — второй не ходит за двоих.
    if (lifeTurn % 2) herStep(); else catStep();
    scheduleTurn();
  }, TURN_MS[0] + Math.random() * (TURN_MS[1] - TURN_MS[0]));
}

// ── Смена часа при открытой странице ─────────────────────────────────────────
// Сердце говорит, сколько осталось до следующей части суток (`clock.left`); страница сама спрашивает комнату
// заново в эту минуту — и ещё раз в десять минут, пока открыта: Байт успевает проголодаться, а дождь — кончиться.
// Прежнее сердце срока не называет и на повторный вопрос считало бы новый заход — его страница не переспрашивает.
const REFRESH_MS = 10 * 60_000;
const canTick = typeof applyTick === "function" && typeof changeOf === "function";
let tickTimer = 0, lookedAt = 0;
const tickLeft = () => (state.clock ? state.clock.at + state.clock.left - Date.now() : state.demo && typeof leftOf === "function" ? leftOf() : null);
function scheduleTick() {
  clearTimeout(tickTimer);
  const left = canTick && state.ready ? tickLeft() : null;
  if (left == null) return;
  // Через полторы секунды после границы: часы телефона и сердца могут расходиться.
  tickTimer = setTimeout(tick, Math.max(3_000, Math.min(REFRESH_MS, left + 1500)));
}
/** Витрина: тот же вопрос — себе. На своей машине следующий час можно назвать в адресе (`#then=вечер`). */
const demoTick = () => demoLook(new Date().getHours(), { ...params, ...(params.then ? { part: params.then } : {}), ...(params.thenSky ? { sky: params.thenSky } : {}), ...(params.thenLight ? { light: params.thenLight } : {}), left: "" });
async function tick() {
  if (!canTick || !state.ready) return;
  if (state.busy || acting) { clearTimeout(tickTimer); tickTimer = setTimeout(tick, 3_000); return; }
  // Страница свёрнута — вопрос подождёт: его задаст возвращение.
  if (document.hidden) return;
  const at = Date.now();
  const result = state.demo ? demoTick() : await call({ do: "look", again: true });
  lookedAt = Date.now();
  if (result?.ok === true && !state.busy && !acting) await play(changeOf(state, applyTick(state, result, at)));
  scheduleTick();
}
/** Сыграть перемену: тихо, сменой света — или сценой у шкафа. */
async function play(change) {
  const stood = drawn.cast?.her ?? null;
  const strider = canPaint && typeof walkOf === "function" ? walkOf(viewOf(state)) : null;
  if (change.kind !== "wardrobe" || !stood || typeof walkSeconds !== "function") { state = change.state; paint(); return; }
  acting = true;
  try {
    const target = change.state;
    await settled([strider, walkOf(viewOf(target)), spriteOf(viewOf(target))]);
    // 1. Уходит к шкафу — ещё в прежнем свете и в прежнем наряде.
    state = { ...state, away: true, tone: "", retry: false, said: change.leave };
    paint();
    await sleep(1000 * (sprites[strider] ? walkSeconds(stood.x, DOOR_X) : 0.6) + 300);
    // 2. Свет часа меняется без неё; на её месте — «*переодевается*».
    state = { ...target, away: true, said: "*переодевается*" };
    paint();
    await sleep(CHANGE_MS);
    // 3. Возвращается в другом — от двери к своему месту.
    state = { ...target, away: false, entering: true, said: change.back };
    paint();
    state = { ...state, entering: false };
    buzz("light");
  } finally {
    acting = false;
    if (state.away) { state = { ...state, away: false }; paint(); }
  }
}

// ── Звук ─────────────────────────────────────────────────────────────────────
// Выключатель запоминается на этом телефоне. Сам звук начинается только с нажатия человека (так устроены
// телефоны), поэтому запомненное «включено» ждёт первого касания страницы. Модуль `sound.js` грузится, когда звук
// включили: не загрузился или телефон звука не умеет — комната остаётся тихой, и только.
const SOUND_KEY = "ai-room-sound";
const SOUNDS = Object.freeze({ pet: "purr", feed: "crunch", play: "toy", tea: "pour", water: "drip", pat: "pat", lamp: "click" });
const canSound = typeof (globalThis.AudioContext ?? globalThis.webkitAudioContext) === "function";
let sound = null, soundOn = false, soundBusy = false;
const soundKept = () => { try { return localStorage.getItem(SOUND_KEY) === "1"; } catch { return false; } };
const keepSound = (on) => { try { localStorage.setItem(SOUND_KEY, on ? "1" : "0"); } catch { /* память телефона закрыта: выбор не запомнится */ } };
/** Что за окном слышно: дождь, гроза, снег (тихий ветер) — или тихая комната, когда сухо. */
const skyOf = () => { const sky = skyName(state.sky); return sky === "rain" || sky === "storm" || sky === "snow" ? sky : "calm"; };
function paintSound() {
  const button = $("sound");
  if (!button) return;
  button.hidden = !canSound;
  button.setAttribute("aria-pressed", soundOn ? "true" : "false");
  const label = button.querySelector("span");
  if (label) label.textContent = soundOn ? "Звук включён" : "Включить звук";
}
async function startSound() {
  if (!canSound || soundBusy) return false;
  soundBusy = true;
  let ok = false;
  try {
    if (!sound) sound = (await import("./sound.js")).createSound?.() ?? null;
    ok = sound ? await sound.on(skyOf()) === true : false;
  } catch { ok = false; }
  soundBusy = false;
  soundOn = ok;
  paintSound();
  return ok;
}
function stopSound() {
  soundOn = false;
  try { sound?.off(); } catch { /* звук не важнее комнаты */ }
  paintSound();
}
const ring = (name) => { if (soundOn && Object.hasOwn(SOUNDS, name)) { try { sound?.play(SOUNDS[name]); } catch { /* звук не важнее комнаты */ } } };
// Колонка (0.46.0): пока она играет, телефон сам выводит тихую мелодию (`sound.tune`), а на рисунке над ней ноты.
// `tuneUntil` — до какого времени играет: звук включили позже или страницу развернули — мелодия продолжается.
let tuneTimer = 0, tuneUntil = 0;
function retune() {
  const left = tuneUntil - Date.now();
  if (left > 1500 && soundOn) { try { sound?.tune?.(left / 1000); } catch { /* звук не важнее комнаты */ } }
}
function tuneFor(ms) {
  clearTimeout(tuneTimer);
  if (!(ms > 0)) { tuneUntil = 0; try { sound?.hush?.(); } catch { /* звук не важнее комнаты */ } return; }
  tuneUntil = Date.now() + ms;
  retune();
  // Доиграла — ноты гаснут, а комната спрашивается заново: она возвращается к своим делам.
  tuneTimer = setTimeout(() => { tuneUntil = 0; state = { ...state, music: 0 }; paint(); tick(); }, ms + 1500);
}

function fetchSprite(name) {
  if (!canPaint || !name || asked.has(name)) return;
  asked.add(name);
  const late = setTimeout(() => settle(name, false), SPRITE_WAIT_MS);
  import(`./her/${name}.js`)
    .then(async (module) => {
      const sprite = module?.default;
      if (!sprite || typeof sprite.src !== "string") throw new Error("empty");
      if (!(await decoded(sprite))) throw new Error("unreadable");
      clearTimeout(late);
      settle(name, store(name, sprite) ? sprite : false);
      // Следом за позой — её второй кадр (0.45.0): когда поза выйдет на рисунок, кадр уже будет здесь.
      fetchSprite(frameName(name));
    })
    .catch(() => { clearTimeout(late); settle(name, false); });
}

const plural = (count, one, few, many) => {
  const tens = count % 100, ones = count % 10;
  return tens > 10 && tens < 20 ? many : ones === 1 ? one : ones >= 2 && ones <= 4 ? few : many;
};
const buzz = (kind) => {
  try {
    if (kind === "error") tg?.HapticFeedback?.notificationOccurred?.("error");
    else tg?.HapticFeedback?.impactOccurred?.(kind);
  } catch { /* вибрация не важнее комнаты */ }
};

/** Шапка и фон Telegram — под стену комнаты в этот час. */
function theme() {
  const colour = HEADERS[lightIn(viewOf(state))] ?? HEADERS["день"];
  const page = getComputedStyle($("app")).getPropertyValue("--bg").trim() || "#f1e8dc";
  document.documentElement.style.setProperty("--page", page);
  if (!tg || header === colour) return;
  header = colour;
  try { tg.setHeaderColor?.(colour); } catch { /* старый Telegram: без цвета шапки */ }
  try { tg.setBackgroundColor?.(page); } catch { /* то же */ }
  try { tg.setBottomBarColor?.(page); } catch { /* то же */ }
}

/**
 * Прежний слой — копией поверх нового: тает и убирается. Места нажатий из копии вынимаются: нажимают на новый слой.
 */
function ghostOf(layer) {
  if (!layer || !layer.firstChild) return;
  const copy = layer.cloneNode(true);
  copy.removeAttribute("id");
  copy.setAttribute("class", "fading");
  copy.setAttribute("pointer-events", "none");
  copy.querySelector(".zones")?.remove();
  layer.after(copy);
  setTimeout(() => copy.remove(), FADE_MS);
}
/** Кто где на рисунке сейчас: её картинка и место, место и фигура Байта. В прежнем рисунке — только она. */
function castNow(view) {
  if (!canPaint) return null;
  if (typeof castOf === "function") return castOf(view, { sprites });
  const stood = typeof spriteStand === "function" ? spriteStand(view) : null;
  return { her: stood && sprites[stood.name] ? { name: stood.name, x: stood.x } : null, cat: null };
}

function paint() {
  const app = $("app");
  app.dataset.light = LIGHTS[lightIn(viewOf(state))] ?? "day";
  app.dataset.state = state.ready ? "ready" : "loading";
  // Три слоя. Небо с городом и дождь перерисовываются только со сменой часа и погоды, комната — когда в ней
  // что-то изменилось: иначе при каждом нажатии дождь прыгал бы назад, а гирлянда мигала заново. Сам дождь движется
  // без рисования вовсе: страница сдвигает его слой целиком (стили `.rainbox`).
  const view = viewOf(state), key = JSON.stringify(view), sky = skyName(view.sky);
  const moon = Number.isFinite(view.moon) ? view.moon : null;
  // Небо красится светом: по солнцу города, а без него по часам (`drawn.part` — каким светом оно нарисовано).
  const light = lightIn(view);
  const outside = drawn.part !== light || drawn.sky !== sky || drawn.moon !== moon;
  // Час или погода сменились при открытой странице — прежний рисунок тает поверх нового (`ghostOf`).
  const fade = outside && Boolean(drawn.part) && (drawn.part !== light || drawn.sky !== sky);
  if (outside) {
    const rain = () => {
      // Слои дождя есть только в новой разметке, а `drawRain` — только в новом рисунке (см. выше про старые копии):
      // нет одного из двух — комната открывается без дождя, но открывается. Снег — те же слои, другой узор и шаг;
      // в сухую погоду слои пусты.
      for (const [id, plane] of [["rainFar", "far"], ["rainNear", "near"]]) {
        const layer = $(id);
        if (layer && drawRain) layer.innerHTML = drawRain(light, plane, sky);
        if (layer?.parentElement) layer.parentElement.dataset.sky = sky;
      }
    };
    const box = $("rainFar")?.parentElement ?? null;
    if (fade) {
      drawn.back = drawn.back === "s-" ? "t-" : "s-";
      ghostOf($("backdrop"));
      // Дождь гаснет, сменяется и проступает снова.
      if (box) { box.classList.add("dim"); setTimeout(() => { rain(); box.classList.remove("dim"); }, FADE_MS / 2); } else rain();
    } else rain();
    $("backdrop").innerHTML = drawBackdrop(light, sky, { phase: moon ?? 0.3, prefix: drawn.back });
    $("room").setAttribute("aria-label", `Комната Аи: окно во всю стену, за ним город и ${SKY_WORDS[sky] ?? "небо"}`);
    // За окном сменилось — сменился и фон звука: дождь, гроза, тихий ветер или тишина комнаты.
    if (drawn.sky && drawn.sky !== sky && soundOn) startSound();
    drawn.part = light;
    drawn.sky = sky;
    drawn.moon = moon;
  }
  if (canPaint) {
    const name = spriteOf(view);
    fetchSprite(name);
    // Она за делом — следующей может понадобиться картинка с кружкой (ей нальют чай): пусть будет под рукой.
    // Вечером это другая картинка (в свитере), поэтому имя не зашито, а спрашивается у рисунка.
    const withTea = spriteOf({ ...view, tea: true });
    if (withTea !== name && sprites[name]) fetchSprite(withTea);
    // Следующая поза — тоже заранее: смена идёт, только когда картинка уже здесь.
    const list = posesOf(view);
    if (sprites[name] && list.length > 1) fetchSprite(list[(list.indexOf(name) + 1) % list.length]);
    if (sprites[name] && canBeat) {
      const next = nextBeat(state, "her");
      if (next) fetchSprite(spriteOf(viewOf(next)));
    }
    // Картинка «идёт» в её нынешнем наряде: от места к месту она доходит шагом.
    if (sprites[name] && typeof walkOf === "function") fetchSprite(walkOf(view));
    // Второй кадр её нынешней позы — после самой позы: без него она стоит одной картинкой, с ним — движется.
    if (sprites[name]) fetchSprite(frameName(name));
  }
  if (drawn.view !== key || state.entering) {
    // Где она и Байт были на прежнем рисунке: прежняя поза тает, пока новая проявляется, а до другого места они
    // доходят шагом. Свет сменился — прежняя комната тает целиком, и ходить в ней некому.
    const before = fade ? null : drawn.cast;
    const options = canPaint ? {
      sprites, ...(before?.her ? { was: before.her } : {}), ...(before?.cat ? { catWas: before.cat } : {}), ...(state.entering ? { enter: true } : {}),
    } : undefined;
    if (fade) {
      drawn.inside = drawn.inside === "r-" ? "q-" : "r-";
      ghostOf($("inside"));
    }
    if (options && drawn.inside !== "r-") options.prefix = drawn.inside;
    $("inside").innerHTML = drawInside(view, options);
    drawn.view = key;
    drawn.cast = castNow(view);
    // До какого времени на рисунке идёт переход (она идёт, тает, проявляется): запоздавший второй кадр его не обрывает.
    // Идут и она, и Байт — ждём того, кто идёт дольше (с 0.46.0 Байт идёт шагом, до четырёх с половиной секунд).
    const strides = [...$("inside").querySelectorAll(".stride")], moving = strides.length > 0 || $("inside").querySelector(".leave, .arrive");
    if (moving) drawn.until = Date.now() + Math.max(0, ...strides.map(stride => Number.parseFloat(stride.style.getPropertyValue("--t")) || 3.5)) * 1000 + FADE_MS + 200;
  }
  const say = $("say");
  if (say.textContent !== state.said) {
    say.textContent = state.said;
    say.classList.remove("fresh");
    void say.offsetWidth;
    say.classList.add("fresh");
  }
  $("talk").dataset.tone = state.tone;
  $("who").textContent = state.tone === "warn" ? "Комната" : "Аи";
  $("retry").hidden = !state.retry;
  for (const button of $("actions").querySelectorAll("button")) {
    const name = button.dataset.act;
    button.disabled = !state.ready || Boolean(state.busy);
    button.classList.toggle("busy", state.busy === name);
    button.classList.toggle("done", (state.done[name] ?? 0) > 0);
  }
  const scene = state.scene;
  $("scene").hidden = !scene;
  if (scene) {
    const played = scene.pick != null;
    $("sceneText").textContent = scene.text;
    $("sceneChoice").hidden = played;
    for (const button of $("sceneChoice").querySelectorAll("button")) {
      button.textContent = scene.options[Number(button.dataset.pick)] ?? "";
      button.disabled = Boolean(state.busy);
    }
    $("scenePicked").hidden = !played;
    $("scenePicked").textContent = played ? `«${scene.options[scene.pick]}». ${scene.outcome} Новая сценка — завтра.` : "";
  }
  $("hint").hidden = !state.ready;
  const tools = $("tools");
  if (tools) tools.hidden = !state.ready;
  paintSound();
  $("foot").textContent = [
    state.next ? `Новая вещь появится через ${state.next} ${plural(state.next, "день", "дня", "дней")}` : "",
    `страница ${PAGE}`, state.build ? `сердце ${state.build}` : "", state.demo ? "витрина" : "",
  ].filter(Boolean).join(" · ");
  theme();
}

/** Вызов функции сердца. Отвечает всегда: ошибка и молчание — тоже ответ, словами. */
function call(input) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const failed = (err) => finish({ ok: false, code: String(err?.type ?? "error"), text: explain(err) });
    const timer = setTimeout(() => finish({ ok: false, code: "timeout", text: "Комната не ответила за двадцать секунд. Попробуйте ещё раз." }), WAIT_MS);
    try {
      const pending = tg.Serverless.call("room", input, (err, result) => (err ? failed(err) : finish(unwrap(result))));
      // Если вызов вернул обещание — ответ придёт и по нему.
      if (pending && typeof pending.then === "function") pending.then(result => finish(unwrap(result)), failed);
    } catch (error) {
      failed({ message: String(error?.message ?? error) });
    }
  });
}

/** Сердечко над тем, о ком позаботились. */
function heart(id) {
  const target = document.getElementById(id), stage = $("stage");
  if (!target || !stage) return;
  const box = target.getBoundingClientRect(), frame = stage.getBoundingClientRect();
  const mark = document.createElement("div");
  mark.className = "heart";
  mark.style.left = `${box.left - frame.left + box.width / 2}px`;
  mark.style.top = `${box.top - frame.top + box.height * 0.2}px`;
  mark.innerHTML = '<svg viewBox="0 0 22 22" width="22" height="22"><path d="M11 19.4C4.6 14.6 2 11.6 2 8.2A4.7 4.7 0 0 1 11 6a4.7 4.7 0 0 1 9 2.2c0 3.4-2.6 6.4-9 11.2z" fill="#e2364f" stroke="#fff" stroke-width="1.2"/></svg>';
  stage.append(mark);
  setTimeout(() => mark.remove(), 1200);
}

async function enter() {
  state = { ...state, retry: false, tone: "", said: "Дверь открывается…" };
  paint();
  if (state.demo) {
    state = applyLook(state, demoLook(new Date().getHours(), params), Date.now());
    tuneFor(state.music);
    if (params.say) state = { ...state, said: params.say };
    paint();
    scheduleTick();
    return;
  }
  if (!canCall) {
    state = refused(state, { text: "Этой версии Telegram не хватает связи с комнатой. Обновите приложение Telegram и откройте комнату снова." });
    paint();
    return;
  }
  const at = Date.now();
  state = applyLook(state, await call({ do: "look" }), at);
  tuneFor(state.music);
  lookedAt = Date.now();
  paint();
  buzz(state.ready ? "light" : "error");
  scheduleTick();
  scheduleTurn();
}

/** Погладить её по голове: её слова — от сердца (по тому, насколько вы близки); раз в день это ещё и шаг в отношениях. */
async function pat() {
  // Прежняя логика (старая копия `logic.js`) гладить не умеет — тогда нажатие на голову значит то же, что на неё.
  if (typeof applyPat !== "function" || typeof demoPat !== "function") { act("her"); return; }
  scheduleTurn();
  state = { ...state, busy: "pat" };
  paint();
  const result = state.demo ? demoPat(state) : await call({ do: "pat" });
  state = applyPat(state, result);
  paint();
  if (result?.ok !== true) { buzz("error"); return; }
  buzz(result.again ? "light" : "medium");
  ring("pat");
  if (!result.again) heart("pat");
}

/** Полка с книгами (0.45.0): она берёт книгу и садится читать; её слова и новое место — от сердца. */
async function book() {
  if (typeof applyBook !== "function" || typeof demoBook !== "function") return;
  scheduleTurn();
  state = { ...state, busy: "book" };
  paint();
  const result = state.demo ? demoBook(state) : await call({ do: "book" });
  state = applyBook(state, result);
  paint();
  buzz(result?.ok === true ? "light" : "error");
}

/**
 * Позвать Байта (0.47.0): нажали на ковёр — он подходит; позвали ещё раз, пока он рядом, — удирает под кресло.
 * Прежняя логика (старая копия `logic.js`) звать не умеет — тогда нажатие на ковёр ничего не делает.
 */
async function beckon() {
  if (typeof applyCall !== "function" || typeof demoCall !== "function") return;
  scheduleTurn();
  state = { ...state, busy: "call" };
  paint();
  const result = state.demo ? demoCall(state) : await call({ do: "call" });
  state = applyCall(state, result);
  // Витрина помнит, что он подошёл на зов, — чтобы второй зов его спугнул.
  if (state.demo && result?.cat?.called === true && state.cat) state = { ...state, cat: { ...state.cat, called: true } };
  paint();
  buzz(result?.ok === true ? "light" : "error");
  if (result?.came === true) ring("pet");
}

/** Лампа (0.46.0): свет гаснет — остаётся гирлянда — или загорается; как оставили, так и запомнится. */
async function lamp() {
  if (typeof applyLamp !== "function" || typeof demoLamp !== "function") return;
  scheduleTurn();
  state = { ...state, busy: "lamp" };
  paint();
  const result = state.demo ? demoLamp(state) : await call({ do: "lamp" });
  state = applyLamp(state, result);
  paint();
  buzz(result?.ok === true ? "light" : "error");
  if (result?.changed === true) ring("lamp");
}

/**
 * Колонка (0.46.0): три минуты тихой музыки, и она танцует; нажали, пока играет, — выключили. Нажатие на колонку —
 * и есть просьба о звуке: выключенный звук включается (телефон даёт звук только с касания) — на этот заход; запоминает
 * выбор только кнопка «звук».
 */
async function music() {
  if (typeof applyMusic !== "function" || typeof demoMusic !== "function") return;
  scheduleTurn();
  if (!soundOn && canSound && !(state.music > 0)) await startSound();
  state = { ...state, busy: "music" };
  paint();
  const result = state.demo ? demoMusic(state) : await call({ do: "music" });
  state = applyMusic(state, result);
  paint();
  buzz(result?.ok === true ? "light" : "error");
  if (result?.ok === true) tuneFor(state.music);
}

async function act(name) {
  if (!state.ready || state.busy || acting) return;
  if (name === "pat") { await pat(); return; }
  if (name === "book") { await book(); return; }
  if (name === "lamp") { await lamp(); return; }
  if (name === "music") { await music(); return; }
  if (name === "call") { await beckon(); return; }
  // Любое нажатие отодвигает её и Байта следующий ход: дать прочесть ответ.
  scheduleTurn();
  if (!CARE.includes(name)) {
    // Нажали на неё — она переходит к следующему занятию и говорит о нём; идти некуда — повторяет нынешнее.
    if (name === "her" && canBeat && nextBeat(state, "her") && herStep()) { buzz("light"); return; }
    const next = applyTap(state, name);
    if (next) { state = next; paint(); buzz("light"); }
    // Прежнее сердце (без распорядка): она ответила и сменила позу.
    if (name === "her" && next && !(canBeat && nextBeat(state, "her"))) turn();
    return;
  }
  state = { ...state, busy: name };
  paint();
  const result = state.demo ? demoCare(state, name) : await call({ do: name });
  state = applyCare(state, name, result);
  paint();
  if (result?.ok !== true) { buzz("error"); return; }
  buzz(result.again ? "light" : "medium");
  ring(name);
  if (!result.again) heart(name === "tea" ? "her" : name === "water" ? "plant" : "cat");
}

async function pick(index) {
  const scene = state.scene;
  if (!state.ready || state.busy || acting || !scene || scene.pick != null) return;
  scheduleTurn();
  state = { ...state, busy: "pick" };
  paint();
  const result = state.demo ? demoPick(state, index) : await call({ do: "pick", key: scene.key, pick: index });
  state = applyPick(state, result);
  paint();
  buzz(result?.ok === true ? "medium" : "error");
}

const actOf = (event) => event.target instanceof Element ? event.target.closest("[data-act]")?.dataset.act : null;
$("room").addEventListener("click", (event) => { const name = actOf(event); if (name) act(name); });
$("room").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const name = actOf(event);
  if (name) { event.preventDefault(); act(name); }
});
$("actions").addEventListener("click", (event) => { const name = actOf(event); if (name) act(name); });
$("sceneChoice").addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest("[data-pick]") : null;
  if (button) pick(Number(button.dataset.pick));
});
$("retry").addEventListener("click", () => enter());

// Звук: выключатель под рисунком. Запомненное «включено» ждёт первого касания страницы.
$("sound")?.addEventListener("click", async () => {
  // Звук уже включается: запомненное «включено» запустило его этим же касанием. Второй запуск вернул бы «не вышло» —
  // и кнопка записала бы «выключено» и показала бы предупреждение при звуке, который играет.
  if (soundBusy) return;
  if (soundOn) { stopSound(); keepSound(false); return; }
  const ok = await startSound();
  keepSound(ok);
  if (ok) retune();
  if (!ok) { state = { ...state, tone: "warn", said: "Звук не включился: этот телефон не дал комнате звучать." }; paint(); }
});
if (canSound && soundKept()) document.addEventListener("pointerdown", () => { if (!soundOn) startSound().then(retune); }, { once: true });
// Комнату свернули — звук и своя жизнь ждут; вернулись — продолжаются, а комната спрашивается заново, если
// за это время сменился час или прошло больше минуты.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { try { sound?.off(); } catch { /* звук не важнее комнаты */ } return; }
  if (soundOn) startSound().then(retune);
  scheduleTurn();
  const left = canTick && state.ready ? tickLeft() : null;
  if (left != null && (left <= 0 || Date.now() - lookedAt > 60_000)) tick(); else scheduleTick();
});

// «На главный экран»: кнопка видна там, где Telegram это умеет и где комнату туда ещё не добавили.
(function homeScreen() {
  const button = $("home");
  if (!button || !tg || typeof tg.addToHomeScreen !== "function" || typeof tg.checkHomeScreenStatus !== "function") return;
  try {
    tg.checkHomeScreenStatus((status) => { button.hidden = !(status === "missed" || status === "unknown"); });
    tg.onEvent?.("homeScreenAdded", () => { button.hidden = true; });
  } catch { /* старый Telegram: кнопки не будет */ }
  button.addEventListener("click", () => { try { tg.addToHomeScreen(); } catch { /* не вышло — кнопка просто не сработала */ } });
})();

try { tg?.ready?.(); tg?.expand?.(); } catch { /* вне Telegram этих вызовов нет */ }
paint();
enter();
scheduleTurn();
