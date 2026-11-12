/**
 * Опросы словами: «опрос: что смотрим? Наруто, Блич, Ван-Пис».
 *
 * Здесь только разбор: вопрос, варианты, вид опроса. Создаёт его сердце — и
 * только то, что человек сказал сам; придуманный моделью опрос идёт отдельной
 * просьбой («придумай опрос про …») и проходит тот же разбор.
 */

const KIND = "(?:опрос|опросник|голосование|голосовалку|викторин[ауы])";
const LEAD = new RegExp(
  `^(?:(?:создай|сделай|запусти|устрой|проведи|начни|открой|поставь)(?:те)?\\s+)?` +
  `((?:(?:анонимн|открыт|публичн|неанонимн|тайн)[а-яё]*\\s+)?)(${KIND})(?=$|[\\s:—–-])` +
  `((?:\\s+с\\s+(?:несколькими|множественным[а-яё]*)\\s+(?:ответами|вариантами|выбором))?)` +
  `\\s*[:—–-]?\\s*([\\s\\S]*)$`, "iu");
const COMPOSE = new RegExp(`^(?:придумай|сочини|сгенерируй|предложи|составь)(?:те)?\\s+(?:мне\\s+|нам\\s+)?(?:какой-нибудь\\s+|какую-нибудь\\s+)?(${KIND})(?:\\s+(?:про|о|об|на\\s+тему|по\\s+теме|по)\\s+([\\s\\S]{2,120}))?$`, "iu");
const STOP = /^(?:закрой|останови|заверши|закончи|подведи|стоп)(?:те)?\s+(?:этот\s+)?(?:опрос|голосование|викторину|итоги?(?:\s+опроса)?)$|^итоги?\s+опроса$/iu;

const clean = (value) => String(value ?? "").replace(/\s+/gu, " ").replace(/^[\s\-–—•*·]+(?=\S)/u, "").trim();
const unquote = (value) => value.replace(/^[«"“']+|[»"”']+$/gu, "").trim();

/** Отметка верного ответа в викторине: звёздочка, плюс или «(верно)». */
function marked(option) {
  const hit = /^[*+✓✔]\s*|\s*[*+✓✔]$|\s*\((?:верно|правильно|да)\)$/iu;
  return hit.test(option) ? { text: option.replace(hit, "").replace(hit, "").trim(), correct: true } : { text: option, correct: false };
}

/** Варианты из строки: по строкам, «|», «;», затем по запятым и «или». */
function splitOptions(text) {
  const value = String(text ?? "").trim();
  if (!value) return [];
  let parts = value.split(/\n+/u).map(item => item.trim()).filter(Boolean);
  if (parts.length < 2) parts = value.split(/\s*[|;/]\s*/u).filter(Boolean);
  if (parts.length < 2) parts = value.split(/\s*,\s*|\s+или\s+/iu).filter(Boolean);
  return parts.map(item => unquote(item.replace(/^\s*(?:\d{1,2}[.)]|[-–—•·])\s*/u, "").trim())).filter(Boolean);
}

/**
 * Разобрать просьбу об опросе.
 *   { stop: true }                        — закрыть опрос (ответом на него);
 *   { compose: true, topic, quiz }        — придумать самой;
 *   { question, options, anonymous, multiple, quiz, correct }  — создать;
 *   { error: "…" }                        — просьба понята, но данных мало;
 *   null                                   — это не про опрос.
 */
export function parsePoll(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const line = raw.replace(/\s+/gu, " ");
  if (STOP.test(line.replace(/[.!?…]+$/u, ""))) return { stop: true };
  const composed = line.replace(/[.!?…]+$/u, "").match(COMPOSE);
  if (composed) return { compose: true, topic: clean(composed[2] ?? ""), quiz: /^викторин/iu.test(composed[1]) };
  const lead = raw.match(LEAD);
  if (!lead) return null;
  const [, mode, kind, multi, body] = lead;
  const quiz = /^викторин/iu.test(kind);
  const rest = body.trim();
  // «Опрос» одним словом — вопрос, а не готовая просьба.
  if (!rest) return quiz ? null : { error: "Какой вопрос и какие варианты? Например: «опрос: что смотрим? Наруто, Блич, Ван-Пис»." };

  let question = "", tail = "";
  const lines = rest.split(/\n+/u).map(item => item.trim()).filter(Boolean);
  if (lines.length >= 2) { question = lines[0]; tail = lines.slice(1).join("\n"); }
  else {
    const mark = rest.indexOf("?");
    const bar = rest.search(/\s*[|;]\s*/u);
    if (mark >= 0 && (bar < 0 || mark < bar)) { question = rest.slice(0, mark + 1); tail = rest.slice(mark + 1); }
    else if (bar >= 0) { question = rest.slice(0, bar); tail = rest.slice(bar).replace(/^\s*[|;]\s*/u, ""); }
    else { question = rest; tail = ""; }
  }
  question = unquote(clean(question)).slice(0, 300);
  if (question.length < 2) return { error: "Не вижу вопроса. Например: «опрос: идём в кино? Да, Нет, Не знаю»." };

  let correct = -1;
  const seen = new Set();
  const options = [];
  for (const item of splitOptions(tail)) {
    const { text: label, correct: right } = marked(item);
    const value = label.slice(0, 100);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    if (right && correct < 0) correct = options.length;
    options.push(value);
  }
  // «Чай или кофе?» — варианты уже названы в самом вопросе.
  if (!options.length) {
    const either = question.replace(/[?!.]+$/u, "").split(/\s*,\s*|\s+или\s+/iu).map(item => item.trim()).filter(Boolean);
    if (/\sили\s/iu.test(question) && either.length >= 2 && either.length <= 10 && either.every(item => item.length <= 40)) {
      for (const item of either) {
        const value = item[0].toUpperCase() + item.slice(1);
        if (!seen.has(value.toLowerCase())) { seen.add(value.toLowerCase()); options.push(value); }
      }
    }
  }
  if (!options.length && !quiz) options.push("Да", "Нет");
  if (options.length < 2) return { error: quiz ? "Викторине нужны варианты, верный — со звёздочкой: «викторина: столица Австралии? Сидней, *Канберра, Мельбурн»." : "Нужно хотя бы два варианта." };
  if (options.length > 10) return { error: `Вариантов ${options.length}, а Telegram разрешает не больше десяти.` };
  if (quiz && correct < 0) return { error: "Какой вариант верный? Отметьте его звёздочкой: «…, *Канберра, …»." };

  const word = mode.trim().toLowerCase();
  return {
    question, options, quiz,
    correct: quiz ? correct : -1,
    // Как в Telegram: опрос анонимный, пока не попросили открытый.
    anonymous: !/^(?:открыт|публичн|неанонимн)/u.test(word),
    multiple: !quiz && Boolean(multi.trim()),
  };
}

/**
 * Ответ модели на «придумай опрос» → вопрос и варианты. Формат, о котором её
 * просят: первая строка — вопрос, дальше по варианту на строку. Всё лишнее
 * (нумерация, кавычки, «Вопрос:») снимается; не разобралось — null.
 */
export function pollFromModel(text, { quiz = false } = {}) {
  const lines = String(text ?? "").split(/\n+/u).map(item => item.replace(/^\s*(?:\d{1,2}[.)]|[-–—•·])\s*/u, "").replace(/^(?:вопрос|варианты?|ответы?)\s*[:—-]\s*/iu, "").trim()).filter(Boolean);
  if (lines.length < 3) return null;
  const built = parsePoll(`${quiz ? "викторина" : "опрос"}:\n${lines.slice(0, 11).join("\n")}`);
  return built && !built.error && built.options ? built : null;
}
