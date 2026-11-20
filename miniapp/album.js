/**
 * Комната Аи — альбом воспоминаний (0.49.0, сообщение 48: «не журнал действий, а небольшая коллекция воспоминаний»;
 * сюда же — подарки, идея 163, и снимок на память, идея 165).
 *
 * Модуль грузится, когда альбом открыли: в вес первой загрузки страницы он не входит. Сам к сердцу не ходит — список
 * и три дела ему даёт страница (`app.js`): `thumb(view)` — нарисовать снимок картинкой, `gift(kind)` — подарить,
 * `snap()` — сохранить этот момент, `close()` — закрыть. Текст от сердца кладётся только как текст (`textContent`).
 */
const GIFT_LABELS = Object.freeze({ flower: "Цветок", book: "Книгу", toy: "Игрушку Байту" });
const plural = (count, one, few, many) => { const tens = count % 100, units = count % 10; return tens > 10 && tens < 20 ? many : units === 1 ? one : units > 1 && units < 5 ? few : many; };
const node = (tag, className = "", text = "") => { const made = document.createElement(tag); if (className) made.className = className; if (text) made.textContent = text; return made; };
const button = (label, className, data) => { const made = node("button", className, label); made.type = "button"; for (const [key, value] of Object.entries(data)) made.dataset[key] = value; return made; };

/** Какие записи показать и в каком порядке: годные, не больше сорока; новые — сверху (так их шлёт сердце). */
export function listOf(result) {
  return (Array.isArray(result?.items) ? result.items : []).filter(item => item && typeof item === "object" && typeof item.title === "string" && item.title)
    .slice(0, 40).map(item => ({ kind: String(item.k ?? ""), date: typeof item.date === "string" ? item.date : "", title: item.title.slice(0, 120), line: typeof item.line === "string" ? item.line.slice(0, 240) : "", view: item.k === "snap" && item.view && typeof item.view === "object" ? item.view : null, told: item.told === true }));
}

/** Нарисовать альбом в `box`. Повторный вызов — перерисовать (после подарка или снимка). */
export function show(box, result, { thumb = null, gift = null, snap = null, close = null } = {}) {
  if (!box) return;
  const items = listOf(result);
  box.textContent = "";
  box.append(node("p", "label", `Альбом воспоминаний${items.length ? ` · ${items.length} ${plural(items.length, "запись", "записи", "записей")}` : ""}`));
  const list = node("ul", "album");
  for (const item of items) {
    const row = node("li", item.kind === "snap" ? "snap" : "");
    row.append(node("span", "when", item.date), node("span", "what", item.told ? `${item.title} (рассказала потом)` : item.title));
    if (item.line) row.append(node("span", "line", item.line));
    if (item.view && typeof thumb === "function") {
      const picture = node("img");
      picture.alt = `Снимок комнаты, ${item.date}`;
      picture.loading = "lazy";
      row.append(picture);
      // Картинка снимка рисуется тем же рисунком, что и комната; не нарисовалась — остаётся подпись.
      Promise.resolve().then(() => thumb(item.view)).then((src) => { if (typeof src === "string" && src) picture.src = src; else picture.remove(); }, () => picture.remove());
    }
    list.append(row);
  }
  if (items.length) box.append(list); else box.append(node("p", "albumNote", "Пока пусто. Сюда ложится то, что было в комнате при вас: первые разы, памятные дни, события, подарки и снимки."));
  // Подарки — раз в неделю: кнопки или срок до следующего.
  const kinds = (Array.isArray(result?.kinds) ? result.kinds : []).filter(kind => Object.hasOwn(GIFT_LABELS, kind));
  if (kinds.length && typeof gift === "function") {
    if (result?.gift?.ok === true) {
      const gifts = node("div", "choice");
      for (const kind of kinds) gifts.append(button(`Подарить: ${GIFT_LABELS[kind].toLowerCase()}`, "main", { gift: kind }));
      box.append(gifts);
    } else {
      const days = Math.max(1, Math.floor(Number(result?.gift?.days) || 1));
      box.append(node("p", "albumNote", `Следующий подарок — через ${days} ${plural(days, "день", "дня", "дней")}: подарки — раз в неделю.`));
    }
  }
  const tools = node("div", "choice");
  if (typeof snap === "function") tools.append(button("Сохранить этот момент", "main", { snap: "1" }));
  tools.append(button("Закрыть альбом", "main", { close: "1" }));
  box.append(tools);
  box.onclick = (event) => {
    const pressed = event.target instanceof Element ? event.target.closest("button") : null;
    if (!pressed) return;
    if (pressed.dataset.gift && typeof gift === "function") gift(pressed.dataset.gift);
    else if (pressed.dataset.snap && typeof snap === "function") snap();
    else if (pressed.dataset.close && typeof close === "function") close();
  };
}
