/**
 * Открытки: рисунок к случаю и подпись её словами.
 *
 * Два входа. По просьбе: «нарисуй открытку Маше на день рождения». И сама:
 * в день рождения человека; хозяину — в праздники из его списка и в круглый
 * день знакомства. Праздники называет хозяин: «добавь праздник Ураза-байрам
 * 20 марта 2027». Сама она праздников не назначает и дат, которые каждый год
 * другие, не вычисляет.
 *
 * Описания для художника — готовые, на английском и без надписей: буквы на
 * картинках выходят плохо, слова идут подписью.
 */
import { parseTarget } from "./sources.js";

const STYLE = "greeting card illustration, anime style, warm soft colors, detailed, no text, no letters";
/** Случай → описание для художника и запас слов для подписи. */
export const OCCASIONS = Object.freeze({
  birthday: { prompt: `birthday ${STYLE}, festive cake with candles, balloons, confetti, a fluffy grey cat in a party hat`, pool: "+открытка:день рождения", lead: "с днём рождения" },
  newyear: { prompt: `new year ${STYLE}, decorated fir tree with garlands, snow outside the window, tangerines, a fluffy grey cat under the tree`, pool: "+открытка:новый год", lead: "с Новым годом" },
  march8: { prompt: `spring ${STYLE}, bouquet of tulips and mimosa, soft sunlight, ribbons`, pool: "+открытка:8 марта", lead: "с 8 Марта" },
  feb23: { prompt: `festive ${STYLE}, starry night sky, mountains, a steaming mug and a warm scarf, calm and strong mood`, pool: "+открытка:23 февраля", lead: "с 23 февраля" },
  love: { prompt: `romantic ${STYLE}, two cups of tea by a rainy window, string lights, paper hearts`, pool: "+открытка:любовь", lead: "с любовью" },
  thanks: { prompt: `thank you ${STYLE}, a small gift box with a ribbon, wild flowers, sunlight`, pool: "+открытка:спасибо", lead: "спасибо" },
  getwell: { prompt: `get well soon ${STYLE}, a cup of hot tea with lemon, warm blanket, a sleeping grey cat, sunny window`, pool: "+открытка:выздоравливай", lead: "выздоравливай" },
  wedding: { prompt: `wedding ${STYLE}, two rings on a silk ribbon, white flowers, soft light`, pool: "+открытка:свадьба", lead: "с днём свадьбы" },
  // Праздники веры — без людей и лиц: полумесяц, фонари, узор.
  faith: { prompt: `festive ${STYLE}, crescent moon, glowing lanterns, geometric ornaments, mosque silhouette at dusk, no people`, pool: "+открытка:праздник", lead: "с праздником" },
  known: { prompt: `cozy ${STYLE}, two cups of tea by a rainy window with city lights, a warm lamp, a grey cat on the windowsill`, pool: "+открытка:знакомство", lead: "" },
  holiday: { prompt: `festive ${STYLE}, garlands, flowers, ribbons, sparkles, joyful mood`, pool: "+открытка:праздник", lead: "с праздником" },
});
const FAITH = /ураз|курбан|рамадан|рамазан|байрам|ид\s+аль|мавлид|ашур|лейлят|ляйлят|джум/u;
const squash = (text) => String(text ?? "").replace(/\s+/gu, " ").trim().replace(/[.!?…]+$/u, "").trim();
const fold = (text) => squash(text).toLowerCase().replace(/ё/gu, "е");

const OCCASION_WORDS = [
  ["birthday", /(?:(?:на|к|ко|с)\s+)?(?:дн(?:ю|ем|я)|день)\s+рождени[яюе]|(?:на|к)\s+др|(?:на|к)\s+днюх[уе]|на\s+юбилей|к\s+юбилею|с\s+юбилеем/u],
  ["newyear", /(?:(?:на|к|с)\s+)?нов(?:ый|ому|ым)\s+год(?:у|ом)?/u],
  ["march8", /(?:(?:на|к|с)\s+)?(?:8|восьмое|восьмому|восьмым)\s+марта/u],
  ["feb23", /(?:(?:на|к|с)\s+)?(?:23|двадцать\s+третье(?:му)?)\s+февраля/u],
  ["wedding", /(?:(?:на|к|с)\s+)?(?:свадьб[уеы]|дн(?:ю|ем)\s+свадьбы|годовщин[уеы]\s+свадьбы)/u],
  ["getwell", /(?:выздоравливай(?:те)?|(?:с\s+пожеланием\s+)?(?:скорейшего\s+)?выздоровлени[яе]|поправляйся|поправляйтесь)/u],
  ["thanks", /(?:(?:со?\s+)?спасибо|с\s+благодарностью|в\s+благодарность)/u],
  ["love", /(?:(?:на|к|с)\s+)?(?:дн(?:ю|ем)\s+(?:святого\s+)?валентина|14\s+февраля)|с\s+любовью|с\s+признанием(?:\s+в\s+любви)?/u],
];

/**
 * Слова после «нарисуй»: «открытку Маше на день рождения» →
 *   { occasion: "birthday", to: "Маше", title: "" }
 * «Открытку к празднику Ураза-байрам» → { occasion: "faith", to: "", title: "Ураза-байрам" }.
 * Не про открытку — null.
 */
export function parsePostcard(query) {
  const text = squash(query);
  const head = text.match(/^(?:открытк[уаи]|открыточк[уа]|поздравительн\S+\s+открытк[уа]|поздравлени[ея]\s+с\s+картинкой)(?:\s+(.*))?$/iu);
  if (!head) return null;
  let rest = String(head[1] ?? "").trim();
  if (rest.length > 160) return null;
  let occasion = "", title = "";
  const low = () => rest.toLowerCase().replace(/ё/gu, "е");
  for (const [key, pattern] of OCCASION_WORDS) {
    const found = low().match(pattern);
    if (!found) continue;
    occasion = key;
    rest = `${rest.slice(0, found.index)} ${rest.slice(found.index + found[0].length)}`.replace(/\s+/gu, " ").trim();
    break;
  }
  if (!occasion) {
    // «к празднику Ураза-байрам», «на праздник Навруз», «с праздником» — название остаётся подписью.
    const feast = low().match(/(?:^|\s)(?:(?:к|на)\s+праздник[уа]?|с\s+праздником|ко?\s+дню|на\s+день|с\s+дн[её]м)(?:\s+(.+))?$/u);
    if (feast) {
      title = feast[1] ? rest.slice(rest.length - feast[1].length).trim() : "";
      rest = rest.slice(0, feast.index).trim();
      occasion = FAITH.test(fold(title)) ? "faith" : "holiday";
      if (/^(?:ко?\s+дню|на\s+день|с\s+дн[её]м)/u.test(feast[0].trim().toLowerCase())) title = `День ${title}`.trim();
    } else if (FAITH.test(low())) {
      const found = low().match(/(?:(?:на|к|с)\s+)?((?:ураза|курбан)[-\s]байрам\S*|рамадан\S*|рамазан\S*|ид\s+аль[-\s]\S+|мавлид\S*)/u);
      if (found) { title = rest.slice(found.index + found[0].length - found[1].length, found.index + found[0].length); rest = `${rest.slice(0, found.index)} ${rest.slice(found.index + found[0].length)}`.replace(/\s+/gu, " ").trim(); occasion = "faith"; }
    }
  }
  // Кому: «Маше», «для Маши», «моей маме». Что осталось — это и есть адресат.
  const to = rest.replace(/^для\s+/iu, "").replace(/[,;:]+$/u, "").trim();
  if (to.length > 60 || /[\d@/\\<>]/u.test(to)) return null;
  return { occasion: occasion || "holiday", to, title: title.slice(0, 60) };
}

/** Описание открытки для художника: по случаю; у праздника веры — без людей. */
export function postcardPrompt(occasion, title = "") {
  const key = occasion === "holiday" && FAITH.test(fold(title)) ? "faith" : occasion;
  return (OCCASIONS[key] ?? OCCASIONS.holiday).prompt;
}

// ── праздники хозяина ────────────────────────────────────────────────────
export const HOLIDAYS_KEY = "heart:holidays:v1";
export const HOLIDAYS_MAX = 40;
/**
 * Сама она праздников не назначает: какие дни для хозяина праздник — знает
 * только он. Список пуст, пока он не назвал.
 */
export const HOLIDAY_DEFAULTS = Object.freeze([]);
const MONTH_NAMES = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
export const holidayDate = (item) => `${item.d} ${MONTH_NAMES[item.m - 1]}${item.y ? ` ${item.y}` : ""}`;

/** Список праздников: сохранённый или запасной. */
export function holidaysOf(saved) {
  const items = Array.isArray(saved?.items) ? saved.items : HOLIDAY_DEFAULTS;
  return items.filter(item => item && Number.isInteger(item.d) && Number.isInteger(item.m) && item.title)
    .map(item => ({ d: item.d, m: item.m, ...(item.y ? { y: item.y } : {}), title: String(item.title).slice(0, 60) }));
}

const DATE_TAIL = /(?:\s+|^)(?:—\s*|-\s*|на\s+)?(\d{1,2}[./]\d{1,2}(?:[./]\d{4})?|\d{1,2}\s+[а-яё]+(?:\s+\d{4})?(?:\s+года)?)$/iu;
/**
 * Слова хозяина о праздниках → просьба, иначе null:
 *   { list: true }                           — «праздники», «какие праздники ты помнишь»;
 *   { add: { d, m, y?, title } }             — «добавь праздник Ураза-байрам 20 марта 2027»;
 *   { drop: 2 } / { drop: "навруз" }         — «убери праздник 2», «убери праздник Навруз»;
 *   { cards: false } / { cards: true }       — «не присылай открытки», «присылай открытки».
 */
export function parseHoliday(text) {
  const value = squash(text);
  const low = fold(value);
  if (!low || low.length > 120) return null;
  if (/^(?:(?:покажи|назови|перечисли)\s+)?(?:мои\s+|наши\s+|все\s+)?праздники$|^какие\s+праздники\s+ты\s+(?:помнишь|знаешь|отмечаешь)$|^список\s+праздников$/u.test(low)) return { list: true };
  if (/^(?:не\s+(?:присылай|рисуй|шли|отправляй)\s+(?:мне\s+)?открытк[иу]|открытки\s+не\s+(?:надо|нужны|присылай)|выключи\s+открытки|хватит\s+открыток)$/u.test(low)) return { cards: false };
  if (/^(?:присылай\s+(?:мне\s+)?открытки|включи\s+открытки|рисуй\s+(?:мне\s+)?открытки(?:\s+к\s+праздникам)?|можно\s+открытки)$/u.test(low)) return { cards: true };
  let found = low.match(/^(?:убери|удали|забудь|вычеркни)\s+праздник\s+(.{1,60})$/u);
  if (found) {
    const what = found[1].replace(/^(?:номер\s+|№\s*)/u, "").trim();
    return /^\d{1,2}$/u.test(what) ? { drop: Number(what) } : { drop: what };
  }
  found = value.match(/^(?:добавь|запомни|запиши|отмечай)\s+праздник:?\s+(.{2,100})$/iu);
  if (found) {
    const tail = found[1].match(DATE_TAIL);
    if (!tail) return { add: null };
    const date = parseTarget(tail[1].replace(/\s+года$/iu, ""));
    const title = found[1].slice(0, tail.index).replace(/[\s—:,-]+$/u, "").replace(/^[«"]|[»"]$/gu, "").trim();
    if (!date || !title || title.length > 60) return { add: null };
    if (!(date.day >= 1 && date.day <= 31 && date.month >= 1 && date.month <= 12)) return { add: null };
    return { add: { d: date.day, m: date.month, ...(date.year ? { y: date.year } : {}), title } };
  }
  return null;
}
