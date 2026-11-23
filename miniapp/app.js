/**
 * Комната Аи — страница (мини-приложение): нажатия, связь с сердцем, раскладка по разметке.
 *
 * Что нарисовать — `scene.js`; что показать по ответу сердца — `logic.js` (оба проверяются тестами без браузера).
 * Здесь — только то, чему нужен браузер и Telegram:
 *   • связь: `Telegram.WebApp.Serverless.call("room", { do }, (err, result) => …)` — платформа сама прикладывает
 *     подпись Telegram, а функция `endpoints/room` получает проверенного человека;
 *   • открыта не из Telegram (нет подписи) — витрина: комната по часам устройства, забота понарошку;
 *   • ошибка связи — словами в её реплике и кнопкой «Попробовать ещё раз», а не пустым экраном; с 0.49.0 кнопка
 *     повторяет то же действие, не дошедший запрос страница повторяет сама (с тем же номером действия), а все
 *     отказы ложатся в журнал ошибок — он открывается нажатием на строку «страница N» внизу;
 *   • страница свёрнута (с 0.49.0) — все её часы стоят: своя жизнь, сверка, кадры, отсчёты, движение на рисунке;
 *   • её картинки (папка `her/`, с 0.40.0): грузится только та, что нужна сейчас; пока картинка в пути — на её
 *     месте силуэт, а комната открывается в любом случае; последние картинки лежат в памяти телефона (с 0.52.0);
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
// `frameOf`, `applyBook`, `demoBook`, с 0.48.0 — `applyWindow`, `demoWindow`), перед вызовом проверяется.
const { drawBackdrop, drawRain, drawInside, spriteOf, drawSprite, spritesOf, spriteStand, castOf, walkOf, walkSeconds, DOOR_X, frameOf, drawPicture } = scene;
const { PAGE, CARE, LIGHTS, HEADERS, blank, viewOf, applyLook, applyCare, applyPick, applyTap, applyPat, nextTurn, refused, explain, unwrap, demoLook, demoCare, demoPick, demoPat, applyTick, changeOf, nextBeat, leftOf, applyBook, demoBook, applyLamp, demoLamp, applyMusic, demoMusic, applyCall, demoCall, applyWear, demoWear, applyBrew, demoBrew, wearAt, applyQuiet, demoQuiet, applyWindow, demoWindow, demoKept } = logic;
/**
 * Каким светом красить небо и страницу (0.47.0): по солнцу города, если его знают и рисунок (`scene.lightIn`), и
 * описание (`view.light`); прежний `scene.js` красит комнату по часам — тогда по часам и небо, и шапка.
 */
const lightIn = (view) => (typeof scene.lightIn === "function" ? scene.lightIn(view) : view.part);
/** Второй кадр картинки (движение внутри позы, 0.45.0); прежний `scene.js` кадров не знает. */
const frameName = (name) => (typeof frameOf === "function" ? frameOf(name) : null);
/** Третий кадр позы — голова повёрнута (0.53.0); прежний `scene.js` его не знает. */
const turnName = (name) => (typeof scene.turnOf === "function" ? scene.turnOf(name) : null);
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
// Её картинка не пришла (0.52.0, сообщение 53: «прогружается данный вид иллюстрации… она не появляется, пока не
// догрузится»): фигуры, нарисованной кодом, на её месте больше нет — силуэт «появляется» ждёт, а страница просит
// картинку снова: через 2, 5, 12, 25 и 60 секунд. Не пришла и тогда — запись в журнал; новый круг начнётся со
// следующей перерисовки комнаты или когда вернётся связь.
const SPRITE_AGAIN_MS = Object.freeze([2_000, 5_000, 12_000, 25_000, 60_000]);
// Через сколько секунд ожидания внизу страницы появляется «картинка Аи ещё в пути».
const SPRITE_SLOW_MS = 8_000;

let state = { ...blank(new Date().getHours()), demo: !inTelegram };
let header = "";
// Что уже нарисовано: рисунок меняется, только когда изменилось то, что на нём видно. `cast` — кто где на рисунке:
// её картинка и место, где она стоит, место и фигура Байта — по ним прежняя поза тает, а до нового места они
// доходят шагом. `back` и `inside` — приставки имён слоёв: когда час сменяется при открытой странице, прежний слой
// тает поверх нового, и имена у них должны быть разными.
const drawn = { part: "", sky: "", moon: null, view: "", cast: null, back: "s-", inside: "r-", until: 0, still: null, shown: null, inks: null, zones: "", room: "", fedUntil: 0 };
/** Сколько длится «миску наполнили» (0.56.0): корм падает в неё и горка растёт; рисунок в это время миску не трогает. */
const REFILL_MS = 3000;
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
// `sprites`: имя → спрайт; `false` — пришла, но этот телефон показать её не может (тогда она нарисована кодом);
// имени нет — ещё в пути (на её месте силуэт «появляется»): так и при слабой связи, сколько бы ни пришлось ждать.
const sprites = {};
const asked = new Set();
// С какого времени ждём картинку и когда попросим её снова: имя → время, имя → [отсчёт, попытка].
const since = new Map(), sooner = new Map();
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
  since.delete(name);
  // Перерисовать — только если на рисунке сейчас нужна именно эта картинка: лишняя перерисовка запускает заново
  // гирлянду и хвост Байта.
  const shown = spriteOf(viewOf(state));
  if (shown === name) { drawn.view = ""; paint(); return; }
  // Второй кадр позы, что сейчас на рисунке, пришёл позже неё самой: показать — но не посреди перехода.
  if (sprite && (frameName(shown) === name || turnName(shown) === name)) frameLater();
}
/**
 * Второй кадр пришёл, когда поза уже на рисунке: перерисовка покажет его, но она же оборвала бы переход — прежняя
 * поза ещё тает, или она ещё идёт. Поэтому перерисовка ждёт конца перехода (`drawn.until`).
 */
let frameTimer = 0;
// Страница свёрнута (0.49.0): её часы стоят — никто никуда не идёт, ничего не перерисовывается, отсчёты ждут.
let resting = false;
function frameLater() {
  clearTimeout(frameTimer);
  if (resting) return;
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
// Она и Байт живут сами, не дожидаясь нажатий. С 0.48.0 их день ведёт сердце (`steady`): занятие длится минуты, а
// не полминуты, и страница спрашивает комнату заново, когда шаг сменится (см. «Смена часа» ниже). Ходы по кругу
// раз в 24–40 секунд остались для прежнего сердца и для проверки в браузере (`#turn=`): у каждой реплики
// распорядка своя картинка, и слова под рисунком меняются вместе с ним.
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
  if (!canTurn || resting) return;
  turnTimer = setTimeout(() => {
    lifeTurn += 1;
    // По очереди: она, Байт. Кому идти некуда, тот ход пропускает — второй не ходит за двоих.
    // Её день ведёт сердце (`steady`) — тогда ход уходит на жест (0.49.0): наклон головы, взгляд на Байта, вздох.
    if (lifeTurn % 2) { if (!state.her?.steady) herStep(); else gesture(); } else if (!state.cat?.steady) catStep(); else gesture();
    scheduleTurn();
  }, TURN_MS[0] + Math.random() * (TURN_MS[1] - TURN_MS[0]));
}

// ── Смена часа при открытой странице ─────────────────────────────────────────
// Сердце говорит, сколько осталось до ближайшей перемены: до следующей части суток (`clock.left`) или, с 0.48.0, до
// следующего шага её дня и нового места Байта (`step`); страница сама спрашивает комнату заново в эту минуту — и не
// реже раза в десять минут, пока открыта: Байт успевает проголодаться, а дождь — кончиться.
// Прежнее сердце срока не называет и на повторный вопрос считало бы новый заход — его страница не переспрашивает.
const REFRESH_MS = 10 * 60_000;
const canTick = typeof applyTick === "function" && typeof changeOf === "function";
let tickTimer = 0, lookedAt = 0;
const tickLeft = () => (state.clock ? state.clock.at + state.clock.left - Date.now() : state.demo && typeof leftOf === "function" ? leftOf() : null);
function scheduleTick() {
  clearTimeout(tickTimer);
  const left = canTick && state.ready && !resting ? tickLeft() : null;
  if (left == null) return;
  // Через полторы секунды после границы: часы телефона и сердца могут расходиться.
  tickTimer = setTimeout(tick, Math.max(3_000, Math.min(REFRESH_MS, left + 1500)));
}
/** Витрина: тот же вопрос — себе. На своей машине следующий час можно назвать в адресе (`#then=вечер`). */
/** Минута по часам устройства — с долей: по ней идёт её день на витрине. */
const demoNow = () => ({ ...params, minute: new Date().getMinutes() + new Date().getSeconds() / 60 });
const demoTick = () => demoLook(new Date().getHours(), { ...demoNow(), open: state.open ? "1" : "0", dark: state.dark ? "1" : "0", brew: state.brew, ...(params.then ? { part: params.then } : {}), ...(params.thenSky ? { sky: params.thenSky } : {}), ...(params.thenLight ? { light: params.thenLight } : {}), left: "" });
async function tick() {
  if (!canTick || !state.ready) return;
  // Идёт действие, сцена у шкафа или сценка встречи (0.49.0) — сверка подождёт: рисунок сейчас не про нынешнюю минуту.
  if (state.busy || acting || (Number.isInteger(state.storyAt) && state.storyAt >= 0)) { clearTimeout(tickTimer); if (!resting) tickTimer = setTimeout(tick, 3_000); return; }
  // Страница свёрнута — вопрос подождёт: его задаст возвращение.
  if (document.hidden) return;
  const at = Date.now();
  const result = state.demo ? demoTick() : await call({ do: "look", again: true });
  lookedAt = Date.now();
  if (result?.ok === true && !state.busy && !acting) {
    const fresh = applyTick(state, result, at);
    // Витрина помнит заботу сама: сверка её не стирает (`demoKept`).
    await play(changeOf(state, state.demo && typeof demoKept === "function" ? demoKept(state, fresh) : fresh));
    // Тихий час сверяется с сердцем: начали на другом устройстве, закончили раньше, страница была свёрнута.
    if (!state.demo) quietFor(state.quiet, state.quietEnd);
    flush();
  } else if (result?.ok !== true && !state.demo) {
    // 0.49.0. Сверка не прошла: комната остаётся как была, внизу — «нет связи», запись — в журнал.
    note("сверка", result?.code, result?.text);
    if (typeof logic.transient === "function" && logic.transient(result) && !state.busy && !acting) { state = { ...state, down: true }; paint(); }
  }
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
  soundScene();
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

// ── Её картинки — в памяти телефона (0.52.0) ─────────────────────────────────
// Сообщение 53: «если резко зайти или же есть проблемы с сетью…». Последние восемь её картинок лежат в памяти
// страницы на телефоне (`localStorage`): зашли снова — она на месте сразу, без сети. Картинка из сети спрашивается
// всё равно: пришла другая (новая сборка) — заменит запись, и в следующий заход покажется уже она. Номер страницы —
// в имени записи: страница сменилась — прежние записи стираются. Память закрыта или полна — всё идёт из сети.
const HER_KEY = `ai-room-her:${PAGE}:`, HER_LIST = "ai-room-her", HER_KEPT = 8;
function keptList() {
  try { const list = JSON.parse(localStorage.getItem(HER_LIST) ?? "[]"); return Array.isArray(list) ? list.filter(item => typeof item === "string") : []; } catch { return []; }
}
function keptSprite(name) {
  try {
    const text = localStorage.getItem(HER_KEY + name), sprite = text ? JSON.parse(text) : null;
    return sprite && typeof sprite.src === "string" ? { sprite, text } : null;
  } catch { return null; }
}
/** Записать картинку (`sprite`) или только отметить, что она снова понадобилась (без него): давние уходят первыми. */
function keepSprite(name, sprite = null) {
  try {
    const key = HER_KEY + name, list = keptList();
    if (!sprite && !list.includes(key)) return;
    const rest = list.filter(item => item !== key && item.startsWith(HER_KEY)), gone = [...list.filter(item => !item.startsWith(HER_KEY)), ...rest.slice(0, Math.max(0, rest.length - HER_KEPT + 1))];
    for (const item of gone) localStorage.removeItem(item);
    if (sprite) localStorage.setItem(key, JSON.stringify(sprite));
    localStorage.setItem(HER_LIST, JSON.stringify([...rest.filter(item => !gone.includes(item)), key]));
  } catch {
    try { for (const item of keptList()) localStorage.removeItem(item); localStorage.removeItem(HER_LIST); } catch { /* память телефона закрыта: картинки придут из сети */ }
  }
}

function fetchSprite(name) {
  if (!canPaint || !name || asked.has(name)) return;
  asked.add(name);
  if (!since.has(name)) since.set(name, Date.now());
  // Ждём долго — внизу страницы об этом сказано (`paint`).
  setTimeout(() => { if (sprites[name] === undefined && state.ready && spriteOf(viewOf(state)) === name) paint(); }, SPRITE_SLOW_MS + 60);
  const kept = keptSprite(name);
  if (!kept) { loadSprite(name, 0, ""); return; }
  // Из памяти телефона — сразу на рисунок; из сети — следом, только сверить.
  decoded(kept.sprite).then((fine) => {
    const shown = fine && sprites[name] === undefined && store(name, kept.sprite);
    if (shown) { settle(name, kept.sprite); fetchSprite(frameName(name)); }
    loadSprite(name, 0, shown ? kept.text : "");
  });
}
function loadSprite(name, attempt, kept) {
  sooner.delete(name);
  // Повторная просьба — под другим адресом: иначе браузер мог бы вернуть запомненный отказ, не спросив сервер.
  (attempt ? import(`./her/${name}.js?again=${attempt}`) : import(`./her/${name}.js`))
    .then(async (module) => {
      const sprite = module?.default;
      if (!sprite || typeof sprite.src !== "string") throw new Error("empty");
      // На рисунке уже картинка из памяти телефона: из сети пришла другая — она покажется в следующий заход.
      if (kept) { if (JSON.stringify(sprite) !== kept && await decoded(sprite)) keepSprite(name, sprite); return; }
      if (!(await decoded(sprite))) throw new Error("unreadable");
      settle(name, store(name, sprite) ? sprite : false);
      // Следом за позой — её второй кадр (0.45.0): когда поза выйдет на рисунок, кадр уже будет здесь.
      fetchSprite(frameName(name));
      keepSprite(name, sprite);
    })
    .catch((error) => {
      if (kept) return;
      // Картинка пришла, но показать её этот телефон не может — она нарисована кодом, как до 0.40.0. Не пришла
      // вовсе (связь, сервер) — на её месте силуэт, а страница просит снова.
      if (error?.message === "empty" || error?.message === "unreadable") { settle(name, false); return; }
      const wait = SPRITE_AGAIN_MS[attempt];
      if (wait === undefined) { note("картинка", "late", name); asked.delete(name); return; }
      sooner.set(name, [setTimeout(() => loadSprite(name, attempt + 1, ""), wait), attempt + 1]);
    });
}
/** Связь вернулась — картинки, которых ждём, спрашиваются сразу, а не по отсчёту. */
function hurrySprites() {
  for (const [name, [timer, attempt]] of [...sooner]) { clearTimeout(timer); loadSprite(name, attempt, ""); }
  for (const [name, [timer, attempt]] of [...roomSooner]) { clearTimeout(timer); loadRoom(name, attempt, ""); }
}

// ── Комната картинкой (0.53.0, идея 202) ─────────────────────────────────────
// Сообщение 53: «Как мы можешь обновить комнату? Именно саму комнату» — владелец выбрал эскиз, и комната теперь
// написана художником: стены, пол, окно и мебель — картинка (`./room/day.js` — с солнцем на полу, `./room/dull.js` —
// пасмурная), вещи встают на неё с листа, а небо, свет часа, она и Байт остаются живыми (`scene.js`). Картинка
// грузится по ходу дела и остаётся в памяти телефона: пока её нет, комната нарисована кодом — тем, что доступно, —
// а пришла — проступает поверх. Не пришла — страница просит снова, как её картинки; не читается — комната кодом.
// На своей машине `#room=code` оставляет комнату кодом — для проверки в браузере.
const ROOM_KEY = `ai-room-pic:${PAGE}:`, ROOM_NAMES = Object.freeze(["day", "dull"]);
const rooms = {}, roomAsked = new Set(), roomSooner = new Map();
const canRoom = canPaint && typeof scene.roomNameOf === "function" && typeof drawPicture === "function" && typeof scene.drawParts === "function" && !(local && params.room === "code");
/**
 * Какая картинка комнаты нужна этому рисунку (по погоде) — и она сама, если уже здесь. Нужная ещё в пути (или не
 * читается), а другая на месте — комната остаётся картинкой: солнце на полу под дождём на несколько секунд — меньшая
 * неправда, чем комната, которая на глазах становится рисунком кодом и обратно.
 */
const roomNameOf = (view) => (canRoom ? scene.roomNameOf(view) : "");
const roomFor = (view) => rooms[roomNameOf(view)] || ROOM_NAMES.map(name => rooms[name]).find(Boolean) || null;
function keptRoom(name) {
  try {
    const text = localStorage.getItem(ROOM_KEY + name), room = text ? JSON.parse(text) : null;
    return room && typeof room.src === "string" ? { room, text } : null;
  } catch { return null; }
}
function keepRoom(name, room) {
  try {
    // Номер страницы — в имени записи: картинки прежних страниц стираются.
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key && key.startsWith("ai-room-pic:") && !key.startsWith(ROOM_KEY)) localStorage.removeItem(key);
    }
    localStorage.setItem(ROOM_KEY + name, JSON.stringify(room));
  } catch {
    try { localStorage.removeItem(ROOM_KEY + name); } catch { /* память телефона закрыта: картинка придёт из сети */ }
  }
}
/** Обе картинки (сама комната и лист вещей) читаются — и разобраны заранее. */
const roomDecoded = (room) => (room?.things ? Promise.all([decoded(room), decoded(room.things)]).then(([one, two]) => one && two) : Promise.resolve(false));
/** Определения картинок комнаты — в кладовую рисунка; негодные рисунок не примет — вернёт пустую строку. */
function storeRoom(room) {
  const shelf = $("store");
  if (!shelf) return false;
  const holder = document.createElementNS("http://www.w3.org/2000/svg", "g");
  holder.innerHTML = drawPicture(room);
  if (!holder.firstChild) return false;
  shelf.append(holder);
  return true;
}
function settleRoom(name, room) {
  if (rooms[name] !== undefined) return;
  rooms[name] = room;
  if (!room) return;
  // На рисунке нужна именно она — перерисовать: комната кодом тает, картинка проступает (`paint`).
  if (state.ready && roomFor(viewOf(state)) === room) { drawn.view = ""; paint(); }
  // Вторая картинка — заранее, но не сразу: погода сменится — комната не вернётся к рисунку кодом.
  setTimeout(() => { for (const other of ROOM_NAMES) if (other !== name) fetchRoom(other); }, 20_000);
}
function fetchRoom(name) {
  if (!canRoom || !ROOM_NAMES.includes(name) || roomAsked.has(name)) return;
  roomAsked.add(name);
  const kept = keptRoom(name);
  if (!kept) { loadRoom(name, 0, ""); return; }
  // Из памяти телефона — сразу на рисунок; из сети — следом, только сверить.
  roomDecoded(kept.room).then((fine) => {
    const shown = fine && rooms[name] === undefined && storeRoom(kept.room);
    if (shown) settleRoom(name, kept.room);
    loadRoom(name, 0, shown ? kept.text : "");
  });
}
function loadRoom(name, attempt, kept) {
  roomSooner.delete(name);
  (attempt ? import(`./room/${name}.js?again=${attempt}`) : import(`./room/${name}.js`))
    .then(async (module) => {
      const room = module?.default;
      if (!room || typeof room.src !== "string") throw new Error("empty");
      // На рисунке уже картинка из памяти телефона: из сети пришла другая — она покажется в следующий заход.
      if (kept) { if (JSON.stringify(room) !== kept && await roomDecoded(room)) keepRoom(name, room); return; }
      if (!(await roomDecoded(room))) throw new Error("unreadable");
      settleRoom(name, storeRoom(room) ? room : false);
      keepRoom(name, room);
    })
    .catch((error) => {
      if (kept) return;
      // Пришла, но показать её этот телефон не может — комната остаётся нарисованной кодом. Не пришла — просим снова.
      if (error?.message === "empty" || error?.message === "unreadable") { settleRoom(name, false); return; }
      const wait = SPRITE_AGAIN_MS[attempt];
      if (wait === undefined) { note("картинка", "late", `room/${name}`); roomAsked.delete(name); return; }
      roomSooner.set(name, [setTimeout(() => loadRoom(name, attempt + 1, ""), wait), attempt + 1]);
    });
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
/**
 * Комната изнутри — по частям (0.48.0, сообщение 47: «перед сменой анимации мерцает чёрным экран — это перезагрузка
 * страницы?»). Нет, не перезагрузка: до 0.48.0 любая перемена — она сменила позу, Байт перешёл — заменяла всю
 * разметку комнаты разом: восемьсот с лишним частей, и каждое движение начиналось заново. Телефон не успевал
 * нарисовать новый слой к следующему кадру и на миг показывал пустой — тёмный фон страницы. Теперь меняются только
 * те части, что стали другими (`scene.drawParts`): стены, мебель, гирлянда и вещи остаются на месте и движутся как
 * двигались. `whole` — заменить всё (первый рисунок и смена света: там меняется каждый цвет).
 * Возвращает то, что на рисунке заменено: по этому видно, идёт ли на нём сейчас переход.
 */
function putInside(view, options, whole = false) {
  const inside = $("inside");
  if (typeof scene.drawParts !== "function") {
    inside.innerHTML = drawInside(view, options);
    drawn.still = null;
    return [inside];
  }
  // «Как есть» — рисунок, на котором все уже дошли и никто не тает: по нему видно, какая часть на самом деле стала
  // другой. «В движении» — тот же рисунок с переходами от прежнего (она идёт, прежняя поза тает, Байт перебегает).
  const calm = options ? { sprites: options.sprites, ...(options.room ? { room: options.room } : {}), ...(options.prefix ? { prefix: options.prefix } : {}) } : undefined;
  const still = scene.drawParts(view, calm), moving = options ? scene.drawParts(view, options) : still;
  const art = inside.firstElementChild, zones = inside.lastElementChild, store = art?.firstElementChild ?? null;
  const fits = !whole && drawn.still && drawn.shown && drawn.inks && art && zones && art !== zones && store?.localName === "defs"
    && art.childElementCount === still.parts.length + 1 && drawn.still.length === still.parts.length;
  if (!fits) {
    inside.innerHTML = `<g class="art" pointer-events="none"><defs>${moving.inks.join("")}</defs>${moving.parts.map(piece => `<g>${piece}</g>`).join("")}</g><g class="zones">${moving.zones}</g>`;
    drawn.still = still.parts;
    drawn.shown = [...moving.parts];
    drawn.inks = new Map([...inside.firstElementChild.firstElementChild.children].map((node, index) => [moving.inks[index], node]));
    drawn.zones = moving.zones;
    return [inside];
  }
  // Переходы цвета: лишние убрать, новые добавить (сначала убрать — у нового может быть то же имя).
  const wanted = new Set(moving.inks);
  for (const [text, node] of drawn.inks) if (!wanted.has(text)) { node.remove(); drawn.inks.delete(text); }
  for (let index = 0; index < moving.inks.length; index += 1) {
    if (drawn.inks.has(moving.inks[index])) continue;
    const holder = document.createElementNS("http://www.w3.org/2000/svg", "g");
    holder.innerHTML = moving.inks[index];
    const node = holder.firstElementChild;
    if (node) { store.append(node); drawn.inks.set(moving.inks[index], node); }
  }
  const replaced = [];
  for (let index = 0; index < still.parts.length; index += 1) {
    // Часть та же и нового перехода в ней нет — не трогаем: то, что в ней идёт или уже дошло, так и остаётся.
    if (still.parts[index] === drawn.still[index] && moving.parts[index] === still.parts[index]) continue;
    if (moving.parts[index] === drawn.shown[index]) continue;
    const node = art.children[index + 1];
    node.innerHTML = moving.parts[index];
    drawn.shown[index] = moving.parts[index];
    replaced.push(node);
  }
  if (moving.zones !== drawn.zones) { zones.innerHTML = moving.zones; drawn.zones = moving.zones; }
  drawn.still = still.parts;
  return replaced;
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
  // Ветер (0.51.0): слово на самой странице — облака плывут быстрее, шторы у открытого окна ходят сильнее (стили).
  document.body.classList.toggle("windy", state.wind === 1);
  document.body.classList.toggle("gale", state.wind === 2);
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
  let tardy = false;
  if (canPaint) {
    const name = spriteOf(view);
    fetchSprite(name);
    // Её картинка в пути дольше восьми секунд (слабая связь) — об этом сказано внизу страницы: комната работает и без неё.
    tardy = Boolean(name) && state.ready && view?.her && view.her.away !== true && sprites[name] === undefined && Date.now() - (since.get(name) ?? Date.now()) >= SPRITE_SLOW_MS;
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
    // И третий — голова повёрнута (0.53.0): когда она посмотрит в окно или на Байта, кадр уже будет здесь.
    if (sprites[name]) fetchSprite(turnName(name));
    // Комната картинкой (0.53.0): та, что нужна при этой погоде.
    fetchRoom(roomNameOf(view));
  }
  const picture = roomFor(view), pictureName = picture?.name ?? "";
  if (drawn.view !== key || state.entering) {
    // Где она и Байт были на прежнем рисунке: прежняя поза тает, пока новая проявляется, а до другого места они
    // доходят шагом. Свет сменился — прежняя комната тает целиком, и ходить в ней некому.
    // Картинка комнаты пришла при открытой странице (или сменилась вместе с погодой) — прежняя комната тает поверх
    // новой, как при смене света: резкой подмены нет.
    const renew = fade || (drawn.shown !== null && drawn.room !== pictureName);
    const before = renew ? null : drawn.cast;
    const options = canPaint ? {
      sprites, ...(picture ? { room: picture } : {}), ...(before?.her ? { was: before.her } : {}), ...(before?.cat ? { catWas: before.cat } : {}), ...(before?.fed === false || Date.now() < drawn.fedUntil ? { fedWas: false } : {}), ...(state.entering ? { enter: true } : {}),
    } : undefined;
    if (renew) {
      drawn.inside = drawn.inside === "r-" ? "q-" : "r-";
      ghostOf($("inside"));
    }
    if (options && drawn.inside !== "r-") options.prefix = drawn.inside;
    // Свет сменился — комната рисуется заново целиком (прежняя тает поверх); иначе — только то, что стало другим.
    const fresh = putInside(view, options, renew);
    drawn.view = key;
    drawn.room = pictureName;
    drawn.cast = castNow(view);
    // Миску наполнили только что (0.56.0): пока корм в неё падает, следующий рисунок получает ту же примету — миска
    // рисуется теми же словами, и страница её не трогает: пролёт не обрывается на середине.
    if (before?.fed === false && drawn.cast?.fed === true) drawn.fedUntil = Date.now() + REFILL_MS;
    // Картинка, которая сейчас на рисунке, в памяти телефона — последняя: её и ждать в следующий заход.
    if (drawn.cast?.her?.name) keepSprite(drawn.cast.her.name);
    // До какого времени на рисунке идёт переход (она идёт, тает, проявляется): запоздавший второй кадр его не обрывает.
    // Идут и она, и Байт — ждём того, кто идёт дольше (с 0.46.0 Байт идёт шагом, до четырёх с половиной секунд).
    // Смотрим только в том, что сейчас заменено: в нетронутых частях переходы уже идут своим чередом.
    const strides = fresh.flatMap(node => [...node.querySelectorAll(".stride")]), moving = strides.length > 0 || fresh.some(node => node.querySelector(".leave, .arrive"));
    // Байт, пропуская её, трогается позже (`--w`, 0.55.0): его переход длится ожидание и путь вместе.
    if (moving) drawn.until = Date.now() + Math.max(0, ...strides.map(stride => (Number.parseFloat(stride.style.getPropertyValue("--t")) || 3.5) + (Number.parseFloat(stride.style.getPropertyValue("--w")) || 0))) * 1000 + FADE_MS + 200;
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
  paintChips();
  paintTeas();
  paintWords();
  paintStory();
  soundScene();
  $("foot").textContent = [
    state.next ? `Новая вещь появится через ${state.next} ${plural(state.next, "день", "дня", "дней")}` : "",
    `страница ${PAGE}`, state.build ? `сердце ${state.build}` : "", state.demo ? "витрина" : "", state.down ? "нет связи: комната как была" : "", tardy ? "картинка Аи ещё в пути" : "",
  ].filter(Boolean).join(" · ");
  app.dataset.down = state.down ? "1" : "";
  paintOops();
  theme();
}

// ── Журнал ошибок страницы (0.49.0) ──────────────────────────────────────────
// Последние двадцать отказов — только на этом телефоне (`localStorage`): место, код и короткий текст, без подписи
// Telegram, адресов и длинных чисел (`logic.scrub`). Открывается нажатием на строку «страница N» внизу: владелец
// проверяет с телефона, и снимок этого журнала — то, что он может прислать. Три последние записи один раз за заход
// уходят сердцу (`do: "oops"`) — хозяин видит их по словам «ошибки комнаты».
const OOPS_KEY = "ai-room-oops";
const canNote = typeof logic.oopsAdd === "function";
let oops = (() => { try { const kept = JSON.parse(localStorage.getItem(OOPS_KEY) ?? "[]"); return Array.isArray(kept) ? kept.slice(-20) : []; } catch { return []; } })();
let unsent = [], reported = false;
const stamp = (at) => { const date = new Date(at), two = (value) => String(value).padStart(2, "0"); return `${two(date.getDate())}.${two(date.getMonth() + 1)} ${two(date.getHours())}:${two(date.getMinutes())}`; };
function paintOops() {
  const box = $("oops");
  if (!box || box.hidden) return;
  box.textContent = [
    `Журнал ошибок: страница ${PAGE}${state.build ? `, сердце ${state.build}` : ""}. Хранится только на этом телефоне.`,
    ...(oops.length ? oops.map(item => `${stamp(item.at)} · ${item.where} · ${item.code}${item.n > 1 ? ` ×${item.n}` : ""} · ${item.text}`) : ["Ошибок не было."]),
  ].join("\n");
}
function note(where, code, words) {
  if (!canNote) return;
  oops = logic.oopsAdd(oops, where, code ?? "error", words ?? "", Date.now());
  unsent = [...unsent, oops[oops.length - 1]].slice(-3);
  try { localStorage.setItem(OOPS_KEY, JSON.stringify(oops)); } catch { /* память телефона закрыта: журнал живёт, пока открыта страница */ }
  paintOops();
}
/** Отчёт хозяину: один раз за заход, когда связь есть. Без того, кто зашёл: сердце записывает только «хозяин или гость». */
function flush() {
  if (reported || !unsent.length || state.demo || !canCall || !state.once) return;
  reported = true;
  const items = unsent.map(({ where, code, text }) => ({ where, code, text }));
  unsent = [];
  call({ do: "oops", page: PAGE, items });
}
window.addEventListener("error", (event) => note("страница", "script", `${event.message ?? ""} ${String(event.filename ?? "").split("/").pop()}:${event.lineno ?? ""}`));
window.addEventListener("unhandledrejection", (event) => note("страница", "promise", String(event.reason?.message ?? event.reason ?? "")));

// ── Действие — сердцу (0.49.0) ───────────────────────────────────────────────
// У каждого действия свой номер (`id`), его придумывает страница. Ответ не дошёл за срок или связь оборвалась —
// запрос уходит ещё раз, сам, с тем же номером: сердце, которое номера помнит (`state.once`), дважды его не
// выполнит, а ответит комнатой как она есть (`repeat`). Прежнему сердцу повтор не шлётся: оно выполнило бы дважды.
// `redo` — как повторить это действие кнопкой «Попробовать ещё раз».
const newId = () => Array.from({ length: 10 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
// Кнопка «Попробовать ещё раз» шлёт то же действие с тем же номером (`sameId`): если прошлый запрос на самом деле
// дошёл, сердце не выполнит его второй раз (окно не закроется обратно), а покажет комнату как она есть.
let again = null, sameId = null;
async function send(input, redo = null) {
  const name = String(input.do), id = sameId && sameId.op === name ? sameId.id : newId();
  sameId = null;
  let result = await call({ ...input, id });
  if (result?.ok !== true && state.once && typeof logic.resend === "function" && logic.resend(result) && !document.hidden) {
    note(name, result.code, `${result.text ?? ""} Повторяю сама.`);
    await sleep(local && Number(params.resend) >= 50 ? Number(params.resend) : 1200);
    result = await call({ ...input, id });
  }
  if (result?.ok === true) { again = null; state = { ...state, down: false }; flush(); } else { note(name, result?.code, result?.text); again = redo ? { run: redo, id, op: name } : null; }
  return result;
}
/** Ответ на повтор уже сделанного действия: комната как она есть — она и показывается. Возвращает, был ли это повтор. */
function repeated(result) {
  if (result?.ok !== true || result.repeat !== true || typeof logic.applyRepeat !== "function") return false;
  state = logic.applyRepeat(state, result, Date.now());
  tuneFor(state.music);
  quietFor(state.quiet, state.quietEnd);
  paint();
  return true;
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

const RETRY_MS = Object.freeze(local && Number(params.retry) >= 50 ? [Number(params.retry)] : [5_000, 15_000, 40_000]);
let retryTimer = 0, retries = 0;
async function enter() {
  state = { ...state, retry: false, tone: "", said: "Дверь открывается…" };
  paint();
  if (state.demo) {
    state = applyLook(state, demoLook(new Date().getHours(), demoNow()), Date.now());
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
  // Пока сердце отвечает, из памяти телефона поднимается картинка, что была на рисунке в прошлый раз (0.52.0):
  // чаще всего она же и нужна — и тогда она на месте с первой секунды.
  if (canPaint) { const last = keptList().filter(item => item.startsWith(HER_KEY)).pop(); if (last) fetchSprite(last.slice(HER_KEY.length)); }
  // И картинка комнаты (0.53.0): лежит в памяти телефона — комната с первой секунды такая же, как в прошлый раз.
  for (const name of ROOM_NAMES) if (canRoom && keptRoom(name)) fetchRoom(name);
  const result = await call({ do: "look" });
  state = applyLook(state, result, at);
  tuneFor(state.music);
  quietFor(state.quiet, state.quietEnd);
  lookedAt = Date.now();
  paint();
  buzz(state.ready ? "light" : "error");
  scheduleTick();
  scheduleTurn();
  // 0.49.0. Не открылась из-за связи — страница пробует сама: через пять, пятнадцать и сорок секунд.
  clearTimeout(retryTimer);
  if (result?.ok === true) { retries = 0; flush(); return; }
  note("вход", result?.code, result?.text);
  if (typeof logic.transient === "function" && logic.transient(result) && retries < RETRY_MS.length && !resting) {
    retryTimer = setTimeout(() => { if (!state.ready && !document.hidden) enter(); }, RETRY_MS[retries]);
    retries += 1;
  }
}

/** Погладить её по голове: её слова — от сердца (по тому, насколько вы близки); раз в день это ещё и шаг в отношениях. */
async function pat() {
  // Прежняя логика (старая копия `logic.js`) гладить не умеет — тогда нажатие на голову значит то же, что на неё.
  if (typeof applyPat !== "function" || typeof demoPat !== "function") { act("her"); return; }
  scheduleTurn();
  state = { ...state, busy: "pat" };
  paint();
  const result = state.demo ? demoPat(state) : await send({ do: "pat" }, () => pat());
  if (repeated(result)) return;
  state = applyPat(state, result);
  paint();
  if (result?.ok !== true) { buzz("error"); return; }
  buzz(result.again ? "light" : "medium");
  ring("pat");
  if (!result.again) heart("pat");
  // Погладили — она закрывает глаза и краснеет (0.48.0).
  react("patted", 1700);
}

/** Полка с книгами (0.45.0): она берёт книгу и садится читать; её слова и новое место — от сердца. */
async function book() {
  if (typeof applyBook !== "function" || typeof demoBook !== "function") return;
  scheduleTurn();
  state = { ...state, busy: "book" };
  paint();
  const result = state.demo ? demoBook(state) : await send({ do: "book" }, () => book());
  if (repeated(result)) return;
  state = applyBook(state, result);
  paint();
  buzz(result?.ok === true ? "light" : "error");
}

/**
 * Кнопки под рисунком (0.47.0): «посидеть рядом», «надеть свитер / куртку» и «чай: жасмин / улун / мята». Их знает
 * сердце с 0.47.0 (оно называет чай в ответе — `state.brew`); прежнее сердце или прежняя копия `logic.js` — и кнопок нет.
 */
function paintChips() {
  // С 0.48.0 эти кнопки — хозяину (сообщение 47): гостю те же дела даёт сам рисунок (чайник спросит, какой чай) и
  // её собственная воля (наряд — по погоде).
  const known = state.ready && Boolean(state.brew) && state.owner === true, idle = !state.busy && !acting;
  const wear = $("wear"), brew = $("brew"), quiet = $("quiet"), albumChip = $("album");
  // Альбом (0.49.0) — всем: это не управление комнатой, а память о ней. Точка на кнопке — в альбоме есть новое.
  // Сердце без альбома (до 0.49.0) поля `album` не шлёт — кнопки нет; на витрине альбом — для примера.
  if (albumChip) {
    const can = state.ready && canAlbum && (state.demo || state.once === true);
    albumChip.hidden = !can;
    albumChip.disabled = !idle;
    albumChip.setAttribute("aria-pressed", albumShown ? "true" : "false");
    if (can) albumChip.querySelector("span").textContent = state.album?.fresh > 0 && !albumShown ? "Альбом •" : "Альбом";
  }
  if (quiet) {
    const can = known && typeof applyQuiet === "function" && typeof demoQuiet === "function", left = quietLeft();
    quiet.hidden = !can;
    quiet.disabled = !idle;
    quiet.setAttribute("aria-pressed", left > 0 ? "true" : "false");
    if (can) quiet.querySelector("span").textContent = left > 0 ? `Тихий час · ${Math.floor(Math.ceil(left / 1000) / 60)}:${String(Math.ceil(left / 1000) % 60).padStart(2, "0")}` : "Посидеть рядом";
  }
  if (wear) {
    const can = known && Boolean(state.her) && typeof applyWear === "function" && typeof demoWear === "function" && typeof wearAt === "function";
    wear.hidden = !can;
    wear.disabled = !idle;
    if (can) wear.querySelector("span").textContent = wearAt(state.part, state.her.wear) === "home" ? "Надеть куртку" : "Надеть свитер";
  }
  if (brew) {
    const can = known && typeof applyBrew === "function" && typeof demoBrew === "function";
    brew.hidden = !can;
    brew.disabled = !idle;
    if (can) brew.querySelector("span").textContent = `Чай: ${state.brew}`;
  }
}
// Тихий час (0.47.0, идея 161): двадцать пять минут рядом — она читает, Байт спит; на кнопке под рисунком идёт
// отсчёт. Время вышло — её слова (их прислало сердце заранее: связь для этого не нужна), и комната спрашивается заново.
let quietUntil = 0, quietTimer = 0, quietWords = "";
const quietLeft = () => Math.max(0, quietUntil - Date.now());
function quietDone() {
  clearInterval(quietTimer);
  quietUntil = 0;
  state = { ...state, quiet: 0, quietEnd: "", tone: "", retry: false, said: quietWords || "Время вышло." };
  paint();
  buzz("medium");
}
function quietFor(left, words = "") {
  clearInterval(quietTimer);
  if (left > 0) {
    quietUntil = Date.now() + left;
    if (words) quietWords = words;
    if (!resting) quietTimer = setInterval(() => { if (quietLeft() > 0) paintChips(); else { quietDone(); tick(); } }, 1000);
    return;
  }
  // Отсчёт шёл и вышел, пока страница была свёрнута: сердце уже говорит «не идёт» — её слова всё равно звучат.
  if (quietUntil > 0 && quietUntil <= Date.now()) quietDone(); else quietUntil = 0;
}
/** Посидеть рядом (0.47.0): начать тихий час — или закончить раньше, если он идёт. */
async function sit() {
  if (!state.ready || state.busy || acting || typeof applyQuiet !== "function" || typeof demoQuiet !== "function") return;
  scheduleTurn();
  state = { ...state, busy: "quiet" };
  paint();
  const result = state.demo ? demoQuiet({ ...state, quiet: quietLeft() }) : await send({ do: "quiet" }, () => sit());
  if (repeated(result)) return;
  state = applyQuiet(state, result);
  quietFor(state.quiet, state.quietEnd);
  paint();
  buzz(result?.ok === true ? "light" : "error");
}
/** Переодеться (0.47.0): она идёт к шкафу и возвращается в другом — та же сцена, что при смене часа. */
async function dress() {
  if (!state.ready || state.busy || acting || typeof applyWear !== "function" || typeof demoWear !== "function") return;
  scheduleTurn();
  const before = state;
  state = { ...state, busy: "wear" };
  paint();
  const result = state.demo ? demoWear(before) : await send({ do: "wear" }, () => dress());
  if (repeated(result)) return;
  const change = applyWear(before, result);
  if (change.kind !== "wardrobe") { state = change.state; paint(); buzz(result?.ok === true ? "light" : "error"); return; }
  state = before;
  await play(change);
  paint();
}
/**
 * Слово ей (0.57.0; идея 204, шаг второй): поле под её словами. Отвечает сердце — словарём, как в чате (`say`); в чат
 * ничего не уходит. Пока идёт запрос, гаснет кнопка, а не поле: погасшее поле закрыло бы клавиатуру. Ответ пришёл —
 * поле пустое; не пришёл — слова остаются в нём, «Попробовать ещё раз» шлёт их же с тем же номером.
 */
async function talk() {
  const field = $("word");
  if (!field || !state.ready || state.busy || acting || typeof logic.applySay !== "function" || typeof logic.demoSay !== "function") return;
  const words = logic.wordsOf(field.value);
  if (!words) return;
  scheduleTurn();
  state = { ...state, busy: "say" };
  paint();
  const result = state.demo ? logic.demoSay(state, words) : await send({ do: "say", text: words }, () => talk());
  // Повтор того же номера у слова — тот же её ответ, а не «комната как она есть»: `repeated` здесь не нужен.
  state = logic.applySay(state, result);
  if (result?.ok === true) field.value = "";
  paint();
  buzz(result?.ok === true ? "light" : "error");
  // Слово её разбудило (0.58.0): рисунок перечитывается сразу — она уже не спит, а сидит в кресле сонная.
  if (result?.ok === true && result.woke === true) tick();
}
/** Поле для слов видно, когда комната открыта и она не спрашивает про чай; кнопка гаснет, пока что-то делается. */
function paintWords() {
  const form = $("words"), button = $("wordSend");
  if (!form || !button) return;
  form.hidden = !state.ready || state.asking === "tea" || typeof logic.applySay !== "function";
  button.disabled = Boolean(state.busy) || acting;
}
/** Выбрать чай (0.47.0): следующий по кругу — жасмин, улун, мята; сердце запоминает, какой наливать. */
async function steep() {
  if (!state.ready || state.busy || acting || typeof applyBrew !== "function" || typeof demoBrew !== "function") return;
  scheduleTurn();
  state = { ...state, busy: "brew" };
  paint();
  const result = state.demo ? demoBrew(state) : await send({ do: "brew" }, () => steep());
  if (repeated(result)) return;
  state = applyBrew(state, result);
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
  const result = state.demo ? demoCall(state) : await send({ do: "call" }, () => beckon());
  if (repeated(result)) return;
  state = applyCall(state, result);
  // Витрина помнит, что он подошёл на зов, — чтобы второй зов его спугнул.
  if (state.demo && result?.cat?.called === true && state.cat) state = { ...state, cat: { ...state.cat, called: true } };
  paint();
  buzz(result?.ok === true ? "light" : "error");
  if (result?.came === true) ring("pet");
  // Байт подошёл или удрал — она смотрит ему вслед (0.49.0).
  if (result?.ok === true) lookAt("cat", result.fled === true);
}

/** Лампа (0.46.0): свет гаснет — остаётся гирлянда — или загорается; как оставили, так и запомнится. */
async function lamp() {
  if (typeof applyLamp !== "function" || typeof demoLamp !== "function") return;
  scheduleTurn();
  state = { ...state, busy: "lamp" };
  paint();
  const result = state.demo ? demoLamp(state) : await send({ do: "lamp" }, () => lamp());
  if (repeated(result)) return;
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
  const result = state.demo ? demoMusic(state) : await send({ do: "music" }, () => music());
  if (repeated(result)) return;
  state = applyMusic(state, result);
  paint();
  buzz(result?.ok === true ? "light" : "error");
  if (result?.ok === true) tuneFor(state.music);
}

// ── Жесты (0.49.0) ───────────────────────────────────────────────────────────
// Между делами она не замирает: раз в полминуты — жест по занятию и настроению (`logic.gestureOf`), и по событию —
// взгляд туда, где что-то случилось: Байт подошёл, окно открыли. Жест — слово на рисунке на две-три секунды.
const GESTURE_MS = Object.freeze({ tilt: 2800, nod: 1600, hair: 2600, bow: 2800, away: 3200, huff: 2200, sigh: 3000, yawn: 3000, smile: 2600 });
let gestures = 0;
/** Посмотреть в сторону: `to` — Байт или окно. Сторона — по тому, где они на рисунке относительно неё. */
function lookAt(to, ask = false) {
  const herX = drawn.cast?.her?.x, toX = to === "cat" ? drawn.cast?.cat?.x : 256;
  if (!Number.isFinite(herX) || !Number.isFinite(toX)) return false;
  if (Math.abs(toX - herX) < 14) {
    // Стоит прямо перед окном (0.51.0): головой вертеть некуда — бросает взгляд вбок, если у позы есть такие глаза.
    const eyes = to === "win" ? sprites[spriteOf(viewOf(state))] : null;
    if (!eyes?.lookr && !eyes?.lookl) return false;
    react(eyes.lookr ? "look-r" : "look-l", 3200);
    return true;
  }
  react(toX < herX ? "look-l" : "look-r", 3200);
  if (ask) react("g-ask", 2200);
  return true;
}
function gesture(name = "") {
  if (typeof logic.gestureOf !== "function" || !state.ready || state.busy || acting || document.hidden || Date.now() < drawn.until) return;
  let what = name || logic.gestureOf(state, gestures);
  if (!name) gestures += 1;
  if (!what) return;
  // Улыбка — картинкой, и есть она не у каждой позы: где её нет, вместо неё наклон головы.
  if (what === "smile" && !sprites[spriteOf(viewOf(state))]?.smile) what = "tilt";
  if (what === "look-cat" || what === "look-win") { lookAt(what === "look-cat" ? "cat" : "win", gestures % 2 === 0); return; }
  if (what === "peek") { react("peek", 2600); return; }
  react(`g-${what}`, GESTURE_MS[what] ?? 2600);
}

/** Мимика по нажатию (0.48.0): слово на рисунке комнаты на короткое время — остальное делают стили страницы. */
const reacting = {};
function react(name, ms) {
  const inside = $("inside");
  if (!inside) return;
  clearTimeout(reacting[name]);
  inside.classList.remove(name);
  void inside.getBoundingClientRect();
  inside.classList.add(name);
  reacting[name] = setTimeout(() => inside.classList.remove(name), ms);
}
/**
 * Что слышно в комнате (0.48.0): окно открыто — улица; закрыто — дом: мурчит Байт, шуршат страницы, скрипит ручка.
 * Прежний `sound.js` этого не умеет — тогда звучит как раньше.
 */
function soundScene() {
  if (!soundOn || typeof sound?.scene !== "function") return;
  const view = viewOf(state), her = view.her && !view.her.away ? view.her : null, cat = view.cat;
  try {
    sound.scene({
      open: view.open === true || (Array.isArray(view.fx) && view.fx.includes("window")),
      purr: Boolean(cat) && (cat.key === "ласка" || cat.key === "сыт" || cat.shape === "curl" || cat.shape === "belly"),
      pages: her?.pose === "read",
      pen: her?.key === "дело" && ["desk", "chair", "sill", "shelf"].includes(her.pose),
      birds: (state.part === "утро" || state.part === "день") && !["rain", "storm", "snow"].includes(skyName(state.sky)),
    });
  } catch { /* звук не важнее комнаты */ }
}
/** Окно (0.48.0): нажали — она открывает его, и слышна улица; ещё раз — закрывает, и слышен дом. */
async function air() {
  scheduleTurn();
  state = { ...state, busy: "window" };
  paint();
  const result = state.demo ? demoWindow(state) : await send({ do: "window" }, () => air());
  if (repeated(result)) return;
  state = applyWindow(state, result);
  paint();
  buzz(result?.ok === true ? "light" : "error");
  if (result?.ok === true) ring("lamp");
  // Открыли окно — она оборачивается к нему, и волосы качнулись от сквозняка (0.49.0).
  if (result?.ok === true) { lookAt("win"); if (state.open === true) react("g-hair", 2600); }
}
// ── Альбом воспоминаний, подарки, снимок, сценка встречи (0.49.0) ─────────────
// Альбом — отдельным модулем (`album.js`): грузится, когда его открыли. Страница даёт ему список от сердца и три
// дела: подарить, сохранить этот момент, нарисовать снимок (комната той минуты — тем же рисунком, отдельной картинкой).
let albumModule = null, albumShown = false;
const canAlbum = typeof logic.applyGift === "function" && typeof logic.demoAlbum === "function";
/** Снимок — отдельной картинкой SVG: имена её красок не спорят с комнатой на странице; веки, второй кадр и метки спрятаны. */
async function thumbOf(view) {
  const name = canPaint ? spriteOf(view) : null;
  if (name) await settled([name], 4000);
  const body = scene.drawRoom(view, canPaint ? { sprites, ...(roomFor(view) ? { room: roomFor(view) } : {}) } : undefined);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.WIDTH ?? 400} ${scene.HEIGHT ?? 520}"><style>.wink,.fr.b,.mark,.emo,.coming{display:none}</style>${body}</svg>`)}`;
}
function closeAlbum() {
  albumShown = false;
  const box = $("albumBox");
  if (box) box.hidden = true;
  paintChips();
}
async function album() {
  const box = $("albumBox");
  if (!box || !canAlbum || !state.ready || state.busy || acting) return;
  if (albumShown) { closeAlbum(); return; }
  scheduleTurn();
  state = { ...state, busy: "album" };
  paint();
  try { albumModule ??= await import("./album.js"); } catch { albumModule = null; }
  const result = state.demo ? logic.demoAlbum(state) : await send({ do: "album" }, () => album());
  if (!albumModule || result?.ok !== true) { state = refused({ ...state, busy: "" }, albumModule ? result : { ok: false, code: "error", text: "Альбом не загрузился. Попробуйте ещё раз." }); paint(); buzz("error"); return; }
  state = { ...state, busy: "", tone: "", retry: false, said: typeof result.line === "string" && result.line ? result.line : state.said, album: { count: Array.isArray(result.items) ? result.items.length : 0, fresh: 0 } };
  albumShown = true;
  box.hidden = false;
  albumModule.show(box, result, { thumb: thumbOf, gift: give, snap: keep, close: closeAlbum });
  paint();
  buzz("light");
}
/** Обновить открытый альбом после подарка или снимка. */
async function refreshAlbum() {
  if (!albumShown || !albumModule) return;
  const result = state.demo ? logic.demoAlbum(state) : await call({ do: "album" });
  if (result?.ok === true) albumModule.show($("albumBox"), result, { thumb: thumbOf, gift: give, snap: keep, close: closeAlbum });
}
/** Подарить (идея 163): цветок, книгу или игрушку Байту — раз в неделю; подарок остаётся в комнате и в альбоме. */
async function give(kind) {
  if (!state.ready || state.busy || acting) return;
  state = { ...state, busy: "gift" };
  paint();
  const result = state.demo ? logic.demoGift(state, kind) : await send({ do: "gift", kind }, () => give(kind));
  if (repeated(result)) return;
  state = logic.applyGift(state, result);
  paint();
  buzz(result?.ok === true && result.taken ? "medium" : result?.ok === true ? "light" : "error");
  if (result?.ok === true && result.taken) { react("glad", 1800); heart("her"); }
  await refreshAlbum();
}
/** Сохранить этот момент (идея 165): комната этой минуты ложится в альбом; сердце собирает её само. */
async function keep() {
  if (!state.ready || state.busy || acting) return;
  state = { ...state, busy: "snap" };
  paint();
  const result = state.demo ? logic.demoSnap() : await send({ do: "snap" }, () => keep());
  if (repeated(result)) return;
  if (result?.ok !== true) { state = refused(state, result); paint(); buzz("error"); return; }
  // Витрина помнит снимки сама, пока открыта страница.
  const snaps = state.demo ? [...(Array.isArray(state.snaps) ? state.snaps : []), { view: viewOf(state), line: state.lines?.her ?? "" }].slice(-4) : state.snaps;
  state = { ...state, busy: "", tone: "", retry: false, said: typeof result.line === "string" && result.line ? result.line : state.said, ...(state.demo ? { snaps } : {}) };
  paint();
  buzz(result.taken ? "medium" : "light");
  await refreshAlbum();
}
/** Сценка встречи: следующий шаг — её слова и картинка этого шага; после последнего комната возвращается к нынешней минуте. */
function tell() {
  if (!state.ready || state.busy || acting || typeof logic.applyStory !== "function") return;
  scheduleTurn();
  state = logic.applyStory(state);
  paint();
  buzz("light");
}
function paintStory() {
  const box = $("story"), button = $("storyNext");
  if (!box || !button) return;
  const left = typeof logic.storyLeft === "function" && state.ready ? logic.storyLeft(state) : 0, going = Number.isInteger(state.storyAt) && state.storyAt >= 0;
  box.hidden = !(left > 0 || going) || state.asking === "tea";
  button.disabled = Boolean(state.busy) || acting;
  button.textContent = !going ? "Что тут было без меня?" : left > 0 ? "Дальше" : "Понятно";
}
/** Выбор чая под её словами (0.48.0): виден, пока она спрашивает, какой налить; нынешний чай отмечен. */
function paintTeas() {
  const teas = $("teas");
  if (!teas) return;
  teas.hidden = !state.ready || state.asking !== "tea";
  for (const button of teas.querySelectorAll("button")) {
    button.disabled = Boolean(state.busy) || acting;
    button.classList.toggle("done", button.dataset.tea === state.brew);
  }
}
const TEA_ASK = "Какой налить? Жасмин, улун или мяту?";
/** Забота: её слова — от сердца; `extra` — что уточнили (какой чай налить). */
async function care(name, extra = {}) {
  state = { ...state, busy: name };
  paint();
  const result = state.demo ? demoCare(state, name, extra.kind) : await send({ do: name, ...extra }, () => care(name, extra));
  if (repeated(result)) return;
  state = applyCare(state, name, result);
  paint();
  if (result?.ok !== true) { buzz("error"); return; }
  buzz(result.again ? "light" : "medium");
  ring(name);
  if (!result.again) heart(name === "tea" ? "her" : name === "water" ? "plant" : "cat");
  // Налили чай — румянец (0.48.0).
  if (name === "tea") react("glad", 1800);
  // Позаботились о Байте — она смотрит в его сторону (0.49.0).
  if (name === "pet" || name === "feed" || name === "play") lookAt("cat");
}

async function act(name) {
  if (!state.ready || state.busy || acting) return;
  // Она спрашивала, какой чай налить, а нажали на другое — вопрос снят.
  if (state.asking && name !== "tea") { state = { ...state, asking: "" }; paintTeas(); }
  if (name === "window" && state.airy === true && typeof applyWindow === "function" && typeof demoWindow === "function") { await air(); return; }
  if (name === "pat") { await pat(); return; }
  if (name === "book") { await book(); return; }
  if (name === "lamp") { await lamp(); return; }
  if (name === "music") { await music(); return; }
  if (name === "call") { await beckon(); return; }
  // Любое нажатие отодвигает её и Байта следующий ход: дать прочесть ответ.
  scheduleTurn();
  if (!CARE.includes(name)) {
    // Нажали на неё. Её день ведёт сердце (`steady`, 0.48.0): она поднимает глаза и говорит, чем занята, а со второго
    // нажатия подряд — что было до этого и что дальше. Прежнее сердце: переходит к следующему занятию и говорит о
    // нём; идти некуда — повторяет нынешнее.
    if (name === "her" && !state.her?.steady && canBeat && nextBeat(state, "her") && herStep()) { buzz("light"); return; }
    const next = applyTap(state, name);
    if (next) { state = next; paint(); buzz("light"); }
    if (name === "her" && next) react("poked", 900);
    // Клевала носом, а её тронули — над головой «!» (0.49.0).
    if (name === "her" && next && state.her?.face === "drowsy") react("g-bang", 2200);
    // Прежнее сердце (без распорядка): она ответила и сменила позу.
    if (name === "her" && next && !state.her?.steady && !(canBeat && nextBeat(state, "her"))) turn();
    return;
  }
  // Чайник (0.48.0, сообщение 47: «нажав на чайник, можно выбрать какой чай»): она спрашивает, какой налить, — под её
  // словами три кнопки. Нажали на чайник ещё раз — наливается тот же, что в прошлый раз. Прежнее сердце чаёв не
  // называет — наливается сразу.
  if (name === "tea" && Array.isArray(state.kinds) && state.kinds.length > 1 && state.asking !== "tea") {
    state = { ...state, asking: "tea", tone: "", retry: false, said: TEA_ASK };
    paint();
    buzz("light");
    return;
  }
  await care(name);
}

async function pick(index) {
  const scene = state.scene;
  if (!state.ready || state.busy || acting || !scene || scene.pick != null) return;
  scheduleTurn();
  state = { ...state, busy: "pick" };
  paint();
  const result = state.demo ? demoPick(state, index) : await send({ do: "pick", key: scene.key, pick: index }, () => pick(index));
  if (repeated(result)) return;
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
// «Попробовать ещё раз» (0.49.0): то действие, что не прошло; при входе — сам вход.
$("retry").addEventListener("click", () => { const redo = again; again = null; if (redo && state.ready) { sameId = { id: redo.id, op: redo.op }; redo.run(); } else enter(); });
// Журнал ошибок — по нажатию на строку «страница N».
const showOops = () => { const box = $("oops"); if (!box) return; box.hidden = !box.hidden; $("foot").setAttribute("aria-expanded", String(!box.hidden)); paintOops(); };
$("foot").addEventListener("click", showOops);
$("foot").addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); showOops(); } });
$("quiet")?.addEventListener("click", () => sit());
$("album")?.addEventListener("click", () => album());
$("storyNext")?.addEventListener("click", () => tell());
$("wear")?.addEventListener("click", () => dress());
$("brew")?.addEventListener("click", () => steep());
$("words")?.addEventListener("submit", (event) => { event.preventDefault(); talk(); });
$("teas")?.addEventListener("click", (event) => {
  const kind = event.target instanceof Element ? event.target.closest("[data-tea]")?.dataset.tea : null;
  if (kind && state.ready && !state.busy && !acting) care("tea", { kind });
});

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
// Комнату свернули — всё ждёт (0.49.0): звук, своя жизнь, сверка, кадры, отсчёт тихого часа, повтор входа и само
// движение на рисунке (стили: `.resting`). До 0.49.0 свёрнутая страница молчала и не спрашивала сердце, но
// продолжала водить её и Байта, менять кадры и раз в секунду перерисовывать отсчёт. Вернулись — всё продолжается с
// того, что есть на самом деле: сроки шли и без страницы, а комната спрашивается заново, если сменился час или
// прошло больше минуты.
function rest() {
  resting = true;
  for (const timer of [turnTimer, tickTimer, frameTimer, tuneTimer, retryTimer]) clearTimeout(timer);
  clearInterval(quietTimer);
  document.documentElement.classList.add("resting");
  try { sound?.off(); } catch { /* звук не важнее комнаты */ }
}
function wake() {
  if (!resting) return;
  resting = false;
  document.documentElement.classList.remove("resting");
  if (soundOn) startSound().then(retune);
  scheduleTurn();
  frameLater();
  // Тихий час и музыка: срок шёл и без страницы — вышел, так вышел.
  if (quietUntil > 0) quietFor(quietLeft(), quietWords);
  if (tuneUntil > 0) { const left = tuneUntil - Date.now(); if (left > 0) tuneFor(left); else { tuneUntil = 0; state = { ...state, music: 0 }; paint(); } }
  if (!state.ready) { if (!state.busy) enter(); return; }
  const left = canTick ? tickLeft() : null;
  if (left != null && (left <= 0 || Date.now() - lookedAt > 60_000 || state.down)) tick(); else scheduleTick();
}
document.addEventListener("visibilitychange", () => (document.hidden ? rest() : wake()));
window.addEventListener("pagehide", rest);
window.addEventListener("pageshow", () => { if (!document.hidden) wake(); });
// Связь вернулась — страница не ждёт нажатия: открывает комнату или сверяется.
window.addEventListener("online", () => { hurrySprites(); if (resting) return; if (!state.ready) enter(); else if (state.down) tick(); });
window.addEventListener("offline", () => { if (state.ready && !state.down) { state = { ...state, down: true }; paint(); } });

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
