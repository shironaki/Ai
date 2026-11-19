/**
 * Комната Аи — страница (мини-приложение, сборка 0.43.0): нажатия, связь с сердцем, раскладка по разметке.
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
 *   • звук (`sound.js`, с 0.41.0): выключатель под рисунком; модуль грузится, когда звук включили;
 *   • кнопка «на главный экран» — там, где Telegram это умеет.
 */
import * as scene from "./scene.js";
import * as logic from "./logic.js";

// Имена берутся из модулей целиком, а не по одному. Страница — четыре файла, и после новой публикации браузер
// может какое-то время держать старую копию любого из них. Импорт по именам такого не прощает: нет в старом
// `scene.js` нового имени — и страница не запускается вовсе. Так имя просто окажется пустым; всё, что добавлено
// после первой публикации (`drawRain`, `spriteOf`, `drawSprite`, `spritesOf`, `spriteStand`, `applyPat`, `nextTurn`),
// перед вызовом проверяется.
const { drawBackdrop, drawRain, drawInside, spriteOf, drawSprite, spritesOf, spriteStand } = scene;
const { PAGE, CARE, LIGHTS, HEADERS, blank, viewOf, applyLook, applyCare, applyPick, applyTap, applyPat, nextTurn, refused, explain, unwrap, demoLook, demoCare, demoPick, demoPat } = logic;

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
// Что уже нарисовано: рисунок меняется, только когда изменилось то, что на нём видно. `her` — её картинка на
// рисунке и место, где она стоит: по ним прежняя поза тает, пока новая проявляется.
const drawn = { part: "", sky: "", view: "", her: null };

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
  if (spriteOf(viewOf(state)) !== name) return;
  drawn.view = "";
  paint();
}
/** Все позы этого состояния по порядку; в прежнем рисунке их одна. */
const posesOf = (view) => (canTurn ? spritesOf(view) : []);
/**
 * Следующая поза — только когда её картинка уже здесь: иначе она пропала бы на время загрузки. Нет картинки —
 * она заказывается, а смена случится в следующий раз. Возвращает, сменилась ли поза.
 */
function turn() {
  if (!canTurn || !state.ready || state.busy || document.hidden) return false;
  const list = posesOf(viewOf(state));
  if (list.length < 2) return false;
  const next = list[((Number.isInteger(state.turn) ? state.turn : 0) + 1) % list.length];
  if (!sprites[next]) { fetchSprite(next); return false; }
  state = nextTurn(state);
  paint();
  return true;
}
let turnTimer = 0;
function scheduleTurn() {
  clearTimeout(turnTimer);
  if (!canTurn) return;
  turnTimer = setTimeout(() => { turn(); scheduleTurn(); }, TURN_MS[0] + Math.random() * (TURN_MS[1] - TURN_MS[0]));
}

// ── Звук ─────────────────────────────────────────────────────────────────────
// Выключатель запоминается на этом телефоне. Сам звук начинается только с нажатия человека (так устроены
// телефоны), поэтому запомненное «включено» ждёт первого касания страницы. Модуль `sound.js` грузится, когда звук
// включили: не загрузился или телефон звука не умеет — комната остаётся тихой, и только.
const SOUND_KEY = "ai-room-sound";
const SOUNDS = Object.freeze({ pet: "purr", feed: "crunch", play: "toy", tea: "pour", water: "drip", pat: "pat" });
const canSound = typeof (globalThis.AudioContext ?? globalThis.webkitAudioContext) === "function";
let sound = null, soundOn = false, soundBusy = false;
const soundKept = () => { try { return localStorage.getItem(SOUND_KEY) === "1"; } catch { return false; } };
const keepSound = (on) => { try { localStorage.setItem(SOUND_KEY, on ? "1" : "0"); } catch { /* память телефона закрыта: выбор не запомнится */ } };
/** Что за окном слышно: дождь или снег (снег — тихий ветер). */
const skyOf = () => (state.sky === "snow" ? "snow" : "rain");
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
  const colour = HEADERS[state.part] ?? HEADERS["день"];
  const page = getComputedStyle($("app")).getPropertyValue("--bg").trim() || "#f1e8dc";
  document.documentElement.style.setProperty("--page", page);
  if (!tg || header === colour) return;
  header = colour;
  try { tg.setHeaderColor?.(colour); } catch { /* старый Telegram: без цвета шапки */ }
  try { tg.setBackgroundColor?.(page); } catch { /* то же */ }
  try { tg.setBottomBarColor?.(page); } catch { /* то же */ }
}

function paint() {
  const app = $("app");
  app.dataset.light = LIGHTS[state.part] ?? "day";
  app.dataset.state = state.ready ? "ready" : "loading";
  // Три слоя. Небо с городом и дождь перерисовываются только со сменой часа, комната — когда в ней что-то
  // изменилось: иначе при каждом нажатии дождь прыгал бы назад, а гирлянда мигала заново. Сам дождь движется
  // без рисования вовсе: страница сдвигает его слой целиком (стили `.rainbox`).
  const view = viewOf(state), key = JSON.stringify(view), sky = view.sky === "snow" ? "snow" : "rain";
  if (drawn.part !== view.part || drawn.sky !== sky) {
    $("backdrop").innerHTML = drawBackdrop(view.part, sky);
    // Слои дождя есть только в новой разметке, а `drawRain` — только в новом рисунке (см. выше про старые копии):
    // нет одного из двух — комната открывается без дождя, но открывается. Снег — те же слои, другой узор и шаг.
    for (const [id, plane] of [["rainFar", "far"], ["rainNear", "near"]]) {
      const layer = $(id);
      if (layer && drawRain) layer.innerHTML = drawRain(view.part, plane, sky);
      if (layer?.parentElement) layer.parentElement.dataset.sky = sky;
    }
    // За окном сменилось — сменился и фон звука: дождь или тихий ветер.
    if (drawn.sky && drawn.sky !== sky && soundOn) startSound();
    drawn.part = view.part;
    drawn.sky = sky;
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
  }
  if (drawn.view !== key) {
    // Где она встанет и какой картинкой: прежняя поза тает, пока новая проявляется (`was`).
    const stood = canPaint && typeof spriteStand === "function" ? spriteStand(view) : null;
    const now = stood && sprites[stood.name] ? { name: stood.name, x: stood.x } : null;
    const was = now && drawn.her && drawn.her.name !== now.name && sprites[drawn.her.name] ? drawn.her : null;
    $("inside").innerHTML = drawInside(view, canPaint ? { sprites, ...(was ? { was } : {}) } : undefined);
    drawn.view = key;
    drawn.her = now;
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
    state = applyLook(state, demoLook(new Date().getHours(), params));
    if (params.say) state = { ...state, said: params.say };
    paint();
    return;
  }
  if (!canCall) {
    state = refused(state, { text: "Этой версии Telegram не хватает связи с комнатой. Обновите приложение Telegram и откройте комнату снова." });
    paint();
    return;
  }
  state = applyLook(state, await call({ do: "look" }));
  paint();
  buzz(state.ready ? "light" : "error");
}

/** Погладить её по голове: её слова — от сердца (по тому, насколько вы близки); раз в день это ещё и шаг в отношениях. */
async function pat() {
  // Прежняя логика (старая копия `logic.js`) гладить не умеет — тогда нажатие на голову значит то же, что на неё.
  if (typeof applyPat !== "function" || typeof demoPat !== "function") { act("her"); return; }
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

async function act(name) {
  if (!state.ready || state.busy) return;
  if (name === "pat") { await pat(); return; }
  if (!CARE.includes(name)) {
    const next = applyTap(state, name);
    if (next) { state = next; paint(); buzz("light"); }
    // Нажали на неё — она ответила и сменила позу.
    if (name === "her" && next) { turn(); scheduleTurn(); }
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
  if (!state.ready || state.busy || !scene || scene.pick != null) return;
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
  if (soundOn) { stopSound(); keepSound(false); return; }
  const ok = await startSound();
  keepSound(ok);
  if (!ok) { state = { ...state, tone: "warn", said: "Звук не включился: этот телефон не дал комнате звучать." }; paint(); }
});
if (canSound && soundKept()) document.addEventListener("pointerdown", () => { if (!soundOn) startSound(); }, { once: true });
// Комнату свернули — звук и смена поз ждут; вернулись — продолжаются.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { try { sound?.off(); } catch { /* звук не важнее комнаты */ } return; }
  if (soundOn) startSound();
  scheduleTurn();
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
