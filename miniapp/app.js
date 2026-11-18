/**
 * Комната Аи — страница (мини-приложение, сборка 0.38.0): нажатия, связь с сердцем, раскладка по разметке.
 *
 * Что нарисовать — `scene.js`; что показать по ответу сердца — `logic.js` (оба проверяются тестами без браузера).
 * Здесь — только то, чему нужен браузер и Telegram:
 *   • связь: `Telegram.WebApp.Serverless.call("room", { do }, (err, result) => …)` — платформа сама прикладывает
 *     подпись Telegram, а функция `endpoints/room` получает проверенного человека;
 *   • открыта не из Telegram (нет подписи) — витрина: комната по часам устройства, забота понарошку;
 *   • ошибка связи — словами в её реплике и кнопкой «Попробовать ещё раз», а не пустым экраном.
 */
import { drawBackdrop, drawInside } from "./scene.js";
import { PAGE, CARE, LIGHTS, HEADERS, blank, viewOf, applyLook, applyCare, applyPick, applyTap, refused, explain, unwrap, demoLook, demoCare, demoPick } from "./logic.js";

const tg = window.Telegram?.WebApp ?? null;
const $ = (id) => document.getElementById(id);
const inTelegram = Boolean(tg && typeof tg.initData === "string" && tg.initData);
const canCall = Boolean(inTelegram && tg.Serverless && typeof tg.Serverless.call === "function");
// Настройки витрины из адреса (`#part=вечер&things=all`) — только для снимков на своей машине: на опубликованной
// странице их нет, иначе ссылкой можно было бы вложить ей в уста чужие слова.
const local = /^(?:localhost|127\.0\.0\.1)$/u.test(location.hostname);
const params = local ? Object.fromEntries(new URLSearchParams(location.hash.replace(/^#/u, ""))) : {};
const WAIT_MS = 20_000;

let state = { ...blank(new Date().getHours()), demo: !inTelegram };
let header = "";
// Что уже нарисовано: рисунок меняется, только когда изменилось то, что на нём видно.
const drawn = { part: "", view: "" };

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
  const page = getComputedStyle($("app")).getPropertyValue("--bg").trim() || "#efe6da";
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
  // Дождь идёт своим чередом: за окном перерисовывается только со сменой часа, комната — когда в ней что-то
  // изменилось. Иначе при каждом нажатии капли прыгали бы назад, а гирлянда мигала заново.
  const view = viewOf(state), key = JSON.stringify(view);
  if (drawn.part !== view.part) { $("backdrop").innerHTML = drawBackdrop(view.part); drawn.part = view.part; }
  if (drawn.view !== key) { $("inside").innerHTML = drawInside(view); drawn.view = key; }
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
