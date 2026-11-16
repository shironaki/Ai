/**
 * «Узнаю и вернусь»: вопросы, на которые она не знала ответа, и возврат к
 * человеку. Вопрос, заданный при всех, записывается вместе с местом — чатом и
 * сообщением. Хозяин видит список («чего ты не знала?») и отвечает словом:
 * «ответ 2: …» — она передаёт ответ в тот же чат, ответом на то сообщение.
 *
 * Текст чужого личного вопроса хозяину не показывается и сюда не попадает.
 */
export const ASKED_KEY = "heart:unknown:v1";
export const ASKED_MAX = 20;

const fold = (text) => String(text ?? "").toLowerCase().replace(/ё/gu, "е").replace(/\s+/gu, " ").trim();
const LIST = /^(?:а\s+)?(?:(?:чего|что)\s+ты\s+не\s+знала|на\s+что\s+ты\s+не\s+(?:ответила|смогла\s+ответить)|(?:покажи\s+)?(?:вопросы\s+без\s+ответа|неотвеченные\s+вопросы))$/u;
const ANSWER = /^ответ(?:ь|ить)?\s+(?:на\s+)?(?:вопрос\s+)?(?:№\s*)?(\d{1,2})\s*[:—–-]\s*([\s\S]+)$/iu;
const DROP = /^(?:забудь|убери|сними|удали)(?:те)?\s+вопрос\s+(?:№\s*)?(\d{1,2})$/u;
const CLEAR = /^(?:забудь|убери|очисти|удали)(?:те)?\s+(?:все\s+)?вопросы(?:\s+без\s+ответа)?$/u;

/**
 * Слова хозяина о вопросах без ответа:
 *   { list: true }               — «чего ты не знала?», «вопросы без ответа»;
 *   { answer: { index, text } }  — «ответ 2: столица — Канберра»;
 *   { drop: index }              — «забудь вопрос 2»;
 *   { clear: true }              — «забудь все вопросы».
 */
export function parseAsked(text) {
  const raw = String(text ?? "").replace(/\s+/gu, " ").trim();
  if (!raw || raw.length > 900) return null;
  const answer = raw.match(ANSWER);
  if (answer) {
    const words = answer[2].trim();
    return words ? { answer: { index: Number(answer[1]), text: words.slice(0, 700) } } : null;
  }
  const value = fold(raw).replace(/[.!?…]+$/u, "").trim();
  if (value.length > 60) return null;
  if (LIST.test(value)) return { list: true };
  const drop = value.match(DROP);
  if (drop) return { drop: Number(drop[1]) };
  if (CLEAR.test(value)) return { clear: true };
  return null;
}

/** Записи списка — только годные, по порядку. */
export const askedItems = (saved) => (Array.isArray(saved?.items) ? saved.items : []).filter(item => item && typeof item.q === "string" && item.q.trim()).slice(-ASKED_MAX);
