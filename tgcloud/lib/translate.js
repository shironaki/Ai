/**
 * «Переведи на английский: доброе утро» — перевод без модели разговора.
 *
 * Переводит тот же переводчик, что готовит описания для художника (m2m100 на
 * ключе Cloudflare): фраза стоит доли нейрона, а модель разговора на неё не
 * тратится. Нет ключа или переводчик молчит — просьба уходит в разговор, как
 * раньше.
 *
 * Здесь только разбор слов и языки; сам запрос — в `draw.translate`.
 */

/** Языки: код переводчика → [название по-английски, «на какой», «с какого», «по-каковски»]. */
const ROWS = `
en english английский английского по-английски
ru russian русский русского по-русски
tr turkish турецкий турецкого по-турецки
ar arabic арабский арабского по-арабски
de german немецкий немецкого по-немецки
fr french французский французского по-французски
es spanish испанский испанского по-испански
it italian итальянский итальянского по-итальянски
nl dutch нидерландский нидерландского по-нидерландски
pt portuguese португальский португальского по-португальски
pl polish польский польского по-польски
uk ukrainian украинский украинского по-украински
be belarusian белорусский белорусского по-белорусски
kk kazakh казахский казахского по-казахски
uz uzbek узбекский узбекского по-узбекски
az azerbaijani азербайджанский азербайджанского по-азербайджански
ka georgian грузинский грузинского по-грузински
hy armenian армянский армянского по-армянски
fa persian персидский персидского по-персидски
ur urdu урду урду на-урду
hi hindi хинди хинди на-хинди
he hebrew иврит иврита на-иврите
zh chinese китайский китайского по-китайски
ja japanese японский японского по-японски
ko korean корейский корейского по-корейски
id indonesian индонезийский индонезийского по-индонезийски
cs czech чешский чешского по-чешски
sv swedish шведский шведского по-шведски
fi finnish финский финского по-фински
el greek греческий греческого по-гречески
sr serbian сербский сербского по-сербски
bg bulgarian болгарский болгарского по-болгарски
ba bashkir башкирский башкирского по-башкирски
ro romanian румынский румынского по-румынски
hu hungarian венгерский венгерского по-венгерски
da danish датский датского по-датски
no norwegian норвежский норвежского по-норвежски
lt lithuanian литовский литовского по-литовски
lv latvian латышский латышского по-латышски
et estonian эстонский эстонского по-эстонски
vi vietnamese вьетнамский вьетнамского по-вьетнамски
th thai тайский тайского по-тайски
mn mongolian монгольский монгольского по-монгольски
tt tatar татарский татарского по-татарски spare
ky kyrgyz киргизский киргизского по-киргизски spare
tg tajik таджикский таджикского по-таджикски spare
tk turkmen туркменский туркменского по-туркменски spare
la latin латынь латыни на-латыни spare
`;
/**
 * `spare: true` — языка нет у переводчика Cloudflare (m2m100): его переводит только
 * запасной переводчик MyMemory (открытый, без ключа; фраза до 500 байт).
 */
export const LANGUAGES = Object.freeze(ROWS.trim().split("\n").map(line => {
  const [code, english, to, from, how, spare] = line.trim().split(" ");
  return Object.freeze({ code, english, to, from, how, spare: spare === "spare" });
}));
const BY_TO = new Map(LANGUAGES.map(item => [item.to, item]));
const BY_FROM = new Map(LANGUAGES.map(item => [item.from, item]));
const BY_HOW = new Map(LANGUAGES.map(item => [item.how, item]));
// Как ещё называют: «голландский», «фарси», «инглиш».
for (const [alias, code] of [["голландский", "nl"], ["фарси", "fa"], ["инглиш", "en"], ["кыргызский", "ky"], ["латинский", "la"]]) {
  if (code) BY_TO.set(alias, LANGUAGES.find(item => item.code === code));
}
for (const [alias, code] of [["голландского", "nl"], ["фарси", "fa"], ["кыргызского", "ky"], ["латинского", "la"]]) BY_FROM.set(alias, LANGUAGES.find(item => item.code === code));
// «На татарском», «на турецком» — предложный падеж прилагательного выводится сам.
for (const item of LANGUAGES) if (/(?:ский|цкий)$/u.test(item.to) && !BY_HOW.has(`на ${item.to.slice(0, -2)}ом`)) BY_HOW.set(`на ${item.to.slice(0, -2)}ом`, item);
for (const [alias, code] of [["по-кыргызски", "ky"], ["на латыни", "la"], ["по-латыни", "la"]]) BY_HOW.set(alias, LANGUAGES.find(item => item.code === code));
for (const [alias, code] of [["по-голландски", "nl"], ["на английском", "en"], ["на русском", "ru"], ["на турецком", "tr"], ["на арабском", "ar"], ["на немецком", "de"], ["на французском", "fr"], ["на испанском", "es"], ["на итальянском", "it"], ["на нидерландском", "nl"], ["на казахском", "kk"], ["на узбекском", "uz"], ["на китайском", "zh"], ["на японском", "ja"], ["на корейском", "ko"], ["на украинском", "uk"], ["на урду", "ur"], ["на хинди", "hi"], ["на иврите", "he"], ["на фарси", "fa"]]) BY_HOW.set(alias, LANGUAGES.find(item => item.code === code));
/** Языки, которых переводчик не знает: о них она говорит прямо, а не переводит на похожий. */
const UNKNOWN = /^(?:чеченск|аварск|ингушск|осетинск|якутск|чувашск|удмуртск|марийск|калмыцк|бурятск|эсперанто)/u;

export const languageName = (code) => LANGUAGES.find(item => item.code === code)?.to ?? code;

/** На каком языке текст — по буквам. Наверняка узнаются только письменности; остальное — догадка. */
export function guessLanguage(text) {
  const value = String(text ?? "");
  if (/[\u3040-\u30ff]/u.test(value)) return "ja";
  if (/[\uac00-\ud7af]/u.test(value)) return "ko";
  if (/[\u4e00-\u9fff]/u.test(value)) return "zh";
  if (/[\u0590-\u05ff]/u.test(value)) return "he";
  if (/[\u0600-\u06ff]/u.test(value)) return /[پچژگ]/u.test(value) ? "fa" : "ar";
  if (/[\u0530-\u058f]/u.test(value)) return "hy";
  if (/[\u10a0-\u10ff]/u.test(value)) return "ka";
  if (/[\u0370-\u03ff]/u.test(value)) return "el";
  if (/[\u0900-\u097f]/u.test(value)) return "hi";
  if (/[а-яё]/iu.test(value)) {
    // Казахские «ұ» и «і» рядом с «ә» — казахский; «ә» без них — татарский (или башкирский: без «ҙ», «ҫ» не различить).
    if (/[әөүһң]/iu.test(value) && /[ұқғі]/iu.test(value)) return "kk";
    if (/[ҙҫ]/iu.test(value)) return "ba";
    if (/[әөүһңҗ]/iu.test(value)) return "tt";
    if (/[їєґ]/iu.test(value)) return "uk";
    if (/[ўҳқғ]/iu.test(value)) return /і/iu.test(value) ? "be" : "uz";
    return "ru";
  }
  if (/[ğışİ]/u.test(value)) return "tr";
  if (/[ßäöü]/iu.test(value)) return "de";
  if (/[ñ¿¡]/iu.test(value)) return "es";
  if (/[àâçèêëîïôœù]/iu.test(value)) return "fr";
  return "en";
}

const fold = (text) => String(text ?? "").toLowerCase().replace(/ё/gu, "е").replace(/\s+/gu, " ").trim();
const unquote = (text) => String(text ?? "").trim().replace(/^[«"“„'`]+|[»"”'`]+$/gu, "").trim();

/**
 * Слова → просьба о переводе, иначе null:
 *   { to, from?, text }   — «переведи на английский: доброе утро», «как по-турецки спасибо»,
 *                           «переведи с немецкого: guten Morgen»;
 *   { to?, from?, text: "" } — «переведи», «переведи на русский» ответом на сообщение: текст — в нём;
 *   { unknown: "татарский" } — языка переводчик не знает.
 * «Переведи 100 долларов в рубли» и «переведи в текст» — не сюда.
 */
export function parseTranslate(text) {
  const raw = String(text ?? "").replace(/\s+/gu, " ").trim();
  const low = fold(raw);
  if (!low || raw.length > 1200) return null;
  // «как по-английски "доброе утро"», «как будет на турецком спасибо», «как сказать по-арабски …»
  let found = low.match(/^(?:а\s+)?как\s+(?:будет\s+|сказать\s+|пишется\s+|звучит\s+)?(по-[а-я]+|на-[а-я]+|на\s+[а-я]+)\s+(?:будет\s+|сказать\s+|пишется\s+|звучит\s+)?(?:(?:слово|фраза|выражение)\s+)?[:—-]?\s*(.+)$/u);
  if (found) {
    const lang = BY_HOW.get(found[1].replace(/\s+/gu, " "));
    const body = unquote(raw.slice(raw.length - found[2].length).replace(/[?\s]+$/u, ""));
    if (lang && body && body.length <= 300) return { to: lang.code, text: body };
    return null;
  }
  found = low.match(/^(?:а\s+)?переведи(?:те)?(?:[-\s]ка)?(?:\s+(?:мне|пожалуйста|пж))?(?:\s+(?:это|текст|фразу|слово|слова|предложение|сообщение))?(.*)$/u);
  if (!found) return null;
  let rest = found[1].trim();
  let from = "", to = "", unknown = "";
  // «с немецкого», «на английский [язык]» — в любом порядке.
  for (let pass = 0; pass < 2; pass += 1) {
    const lang = rest.match(/^(с|со|на|в)\s+([а-я]+)(?:\s+язык[а]?)?(?=$|[\s:—-])/u);
    if (!lang) break;
    const source = lang[1] === "с" || lang[1] === "со";
    const hit = source ? BY_FROM.get(lang[2]) : BY_TO.get(lang[2]);
    if (!hit) {
      if (UNKNOWN.test(lang[2])) { unknown = lang[2]; rest = rest.slice(lang[0].length).trim(); continue; }
      // «в рубли», «в текст», «на карту» — это не язык: просьба не о переводе слов.
      return null;
    }
    if (source) from = hit.code; else to = hit.code;
    rest = rest.slice(lang[0].length).trim();
  }
  if (unknown) return { unknown };
  const colon = /^[:—-]/u.test(rest);
  rest = rest.replace(/^[:—-]\s*/u, "").trim();
  // Текст после слов «переведи …» — только после двоеточия или когда язык назван: «переведи деньги маме» — не сюда.
  if (rest && !colon && !from && !to) return null;
  const body = rest ? unquote(raw.slice(raw.length - rest.length)) : "";
  return { ...(to ? { to } : {}), ...(from ? { from } : {}), text: body };
}
