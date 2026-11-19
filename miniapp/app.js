/**
 * Комната Аи — страница (мини-приложение, сборка 0.40.0): нажатия, связь с сердцем, раскладка по разметке.
 *
 * Что нарисовать — `scene.js`; что показать по ответу сердца — `logic.js` (оба проверяются тестами без браузера).
 * Здесь — только то, чему нужен браузер и Telegram:
 *   • связь: `Telegram.WebApp.Serverless.call("room", { do }, (err, result) => …)` — платформа сама прикладывает
 *     подпись Telegram, а функция `endpoints/room` получает проверенного человека;
 *   • открыта не из Telegram (нет подписи) — витрина: комната по часам устройства, забота понарошку;
 *   • ошибка связи — словами в её реплике и кнопкой «Попробовать ещё раз», а не пустым экраном;
 *   • её картинки (папка `her/`, с 0.40.0): грузится только та, что нужна сейчас; не загрузилась — она нарисована
 *     кодом, как раньше, а комната открывается в любом случае.
 */
import * as scene from "./scene.js";
import * as logic from "./logic.js";

// Имена берутся из модулей целиком, а не по одному. Страница — четыре файла, и после новой публикации браузер
// может какое-то время держать старую копию любого из них. Импорт по именам такого не прощает: нет в старом
// `scene.js` нового имени — и страница не запускается вовсе. Так имя просто окажется пустым; всё, что добавлено
// после первой публикации (`drawRain`, `spriteOf`, `drawSprite`), перед вызовом проверяется.
const { drawBackdrop, drawRain, drawInside, spriteOf, drawSprite } = scene;
const { PAGE, CARE, LIGHTS, HEADERS, blank, viewOf, applyLook, applyCare, applyPick, applyTap, refused, explain, unwrap, demoLook, demoCare, demoPick } = logic;

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
// Что уже нарисовано: рисунок меняется, только когда изменилось то, что на нём видно.
const drawn = { part: "", view: "" };

// ── Она картинкой ────────────────────────────────────────────────────────────
// Картинка на каждое её состояние — отдельным модулем в папке `her/`: `export default { w, h, cx, src }`. Модуль
// грузится, когда понадобился. Его определение кладётся в рисунок один раз (в «кладовую», `<defs id="store">`), а
// комната при каждой перерисовке только ссылается на него — так она не моргает от нажатий.
// `sprites`: имя → спрайт; `false` — не загрузился (она нарисована кодом); имени нет — ещё в пути (её пока не видно).
const sprites = {};
const asked = new Set();
const kept = [];
const canPaint = typeof spriteOf === "function" && typeof drawSprite === "function";

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
  const view = viewOf(state), key = JSON.stringify(view);
  if (drawn.part !== view.part) {
    $("backdrop").innerHTML = drawBackdrop(view.part);
    // Слои дождя есть только в новой разметке, а `drawRain` — только в новом рисунке (см. выше про старые копии):
    // нет одного из двух — комната открывается без дождя, но открывается.
    for (const [id, plane] of [["rainFar", "far"], ["rainNear", "near"]]) {
      const layer = $(id);
      if (layer && drawRain) layer.innerHTML = drawRain(view.part, plane);
    }
    drawn.part = view.part;
  }
  if (canPaint) {
    const name = spriteOf(view);
    fetchSprite(name);
    // Она с блокнотом — следующей может понадобиться картинка с кружкой (ей нальют чай): пусть будет под рукой.
    if (name === "work" && sprites.work) fetchSprite("tea");
  }
  if (drawn.view !== key) { $("inside").innerHTML = drawInside(view, canPaint ? { sprites } : undefined); drawn.view = key; }
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

async function act(name) {
  if (!state.ready || state.busy) return;
  if (!CARE.includes(name)) {
    const next = applyTap(state, name);
    if (next) { state = next; paint(); buzz("light"); }
    return;
  }
  state = { ...state, busy: name };
  paint();
  const result = state.demo ? demoCare(state, name) : await call({ do: name });
  state = applyCare(state, name, result);
  paint();
  if (result?.ok !== true) { buzz("error"); return; }
  buzz(result.again ? "light" : "medium");
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

try { tg?.ready?.(); tg?.expand?.(); } catch { /* вне Telegram этих вызовов нет */ }
paint();
enter();
