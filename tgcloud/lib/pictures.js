/**
 * Картинки, гифки и стикеры: ответ не всегда слова.
 *
 * Здесь только разбор — что просят показать и каким стикером ответить.
 * Отправляет сердце. Рисовать Аи не умеет: картинка либо из Википедии, либо
 * случайный зверь из открытых коллекций, а гифка — жест, а не иллюстрация.
 */
import { fold } from "./sources.js";

const SHOW = "(?:(?:покажи|пришли|скинь|кинь|дай|отправь)(?:те)?|хочу|хочется)";
const ANIMALS = [
  ["cat", "кот(?:а|ика|иков|ю|ейку|ов|ят|енка|еночка)?|кошк[уаи]|кошечк[уаи]|кошек|киску|кису"],
  ["dog", "собак[уаи]?|собачк[уаи]|собачек|пс[аов]+|песик(?:а|ов)?|песеля|пса|щенк(?:а|ов)|щеночка"],
  ["fox", "лис[ауы]?|лисичк[уаи]|лисенка|лисят"],
];
const ANIMAL = new RegExp(`^${SHOW}\\s+(?:мне\\s+)?(?:(?:фото|фотку|фотографию|картинку|гифку)\\s+)?(?:(?:милого|милую|милых|случайного|случайную|какого-нибудь|какую-нибудь|еще|другого|другую)\\s+)*(${ANIMALS.map(([, body]) => body).join("|")})$`, "u");
const ANIMAL_WORD = Object.freeze({ cat: "котик", dog: "пёс", fox: "лис" });

/** [жест, слова, категория гифок]. Обнимает она не каждого — решает сердце. */
const GESTURES = [
  ["hug", /^(?:обними(?:те)?(?:\s+меня)?|обнимашки|обнимешь(?:\s+меня)?|хочу\s+(?:обнимашек|обниматься)|обнимемся)$/u],
  ["pat", /^погладь(?:те)?(?:\s+меня)?(?:\s+по\s+голов(?:е|ке))?$/u],
  ["wave", /^помаши(?:те)?(?:\s+(?:мне|рукой|ручкой|лапкой))*$/u],
  ["highfive", /^(?:дай(?:те)?\s+пять|пять\s+давай)$/u],
  ["dance", /^(?:станцуй(?:те)?|потанцуй(?:те)?|танцуй(?:те)?)(?:\s+(?:для\s+меня|со\s+мной))?$/u],
  ["smile", /^улыбнись(?:\s+мне)?$/u],
  ["wink", /^подмигни(?:\s+мне)?$/u],
];
const PERSONAL = /(?:^|\s)(?:я|ты|мы|вы|он|она|они|мне|меня|тебе|тебя|нас|вас|мой|моя|мое|мои|мою|моего|моей|твой|твоя|твое|твои|твою|наш|наша|наше|ваш|ваша|себя|это|этот|эта|эти|тут|здесь)(?=\s|$)/u;

/**
 * Что просят показать. `value` — фраза в нижнем регистре без хвостовой
 * пунктуации. Возвращает `{ kind: "animal" | "gesture" | "look", … }` или null.
 */
export function parsePicture(value) {
  const text = fold(value).replace(/[?!.…]+$/u, "").trim();
  if (!text) return null;
  let match = text.match(ANIMAL);
  if (match) {
    const animal = ANIMALS.find(([, body]) => new RegExp(`^(?:${body})$`, "u").test(match[1]))?.[0] ?? "cat";
    return { kind: "animal", animal, word: ANIMAL_WORD[animal] };
  }
  for (const [gesture, pattern] of GESTURES) if (pattern.test(text)) return { kind: "gesture", gesture };
  match = text.match(new RegExp(`^${SHOW}\\s+(?:мне\\s+)?(?:(?:фото|фотку|фотографию|картинку|изображение)\\s+|как\\s+выглядит\\s+)(.{2,60})$`, "u"))
    ?? text.match(/^как\s+выгляд(?:ит|ят)\s+(.{2,60})$/u);
  if (match) {
    const topic = match[1].replace(/^[«"']+|[»"']+$/gu, "").trim();
    if (!topic || PERSONAL.test(topic) || topic.split(" ").length > 5) return null;
    return { kind: "look", topic };
  }
  return null;
}

// ── стикеры ───────────────────────────────────────────────────────────────
const MOODS = Object.freeze({
  love: "❤️ ❤ 🥰 😍 😘 💕 💖 💗 💓 💞 💘 🫶 💋 😻 ♥️",
  joy: "😊 ☺️ ☺ 😄 😁 🙂 😀 😃 🤗 🥳 🎉 👍 ✨ 😌 😇 😺 😸 👌 🙌 💪 🔥",
  laugh: "😂 🤣 😆 😹 😅 😜 😝 🤪 😛",
  sad: "😢 😭 😔 🥺 ☹️ 😞 😿 💔 😟 😥 😩 😫",
  angry: "😠 😡 🤬 👿 💢 😤",
  hello: "👋 🙋 🙋‍♀️ 🙋‍♂️ 🤝",
  sleep: "😴 🌙 💤 🥱 🛌",
  surprise: "😮 😲 😱 🤯 😳 🙀 😯",
  think: "🤔 🧐 🤨 😐 😶",
  hug: "🤗 🫂",
});
const strip = (emoji) => String(emoji ?? "").replace(/\uFE0F/gu, "");
const MOOD_OF = new Map();
for (const [mood, list] of Object.entries(MOODS)) for (const emoji of list.split(/\s+/u)) if (!MOOD_OF.has(strip(emoji))) MOOD_OF.set(strip(emoji), mood);

/** Настроение стикера по его эмодзи; незнакомое — «joy». */
export const moodOf = (emoji) => MOOD_OF.get(strip(emoji)) ?? "joy";

/**
 * Чем ответить на настроение: список настроений по убыванию уместности.
 * `close` — близкий человек: только ему в ответ на сердечко идёт сердечко.
 */
export function answerMoods(mood, { close = false } = {}) {
  switch (mood) {
    case "love": return close ? ["love", "hug", "joy"] : ["joy", "hug"];
    case "laugh": return ["laugh", "joy"];
    case "sad": return ["hug", close ? "love" : "joy", "sad"];
    case "angry": return ["surprise", "sad", "think"];
    case "hello": return ["hello", "joy"];
    case "sleep": return ["sleep", close ? "love" : "joy"];
    case "surprise": return ["laugh", "surprise", "joy"];
    case "think": return ["think", "joy"];
    case "hug": return close ? ["hug", "love", "joy"] : ["hug", "joy"];
    default: return ["joy", "laugh"];
  }
}

/** Набор стикеров → `{ настроение: [file_id, …] }`, не больше шести на настроение. */
export function shelfOf(stickers = []) {
  const shelf = {};
  for (const item of Array.isArray(stickers) ? stickers : []) {
    const id = String(item?.file_id ?? "");
    if (!id || !item?.emoji) continue;
    const mood = moodOf(item.emoji);
    if (!MOOD_OF.has(strip(item.emoji))) continue;
    (shelf[mood] ??= []);
    if (shelf[mood].length < 6) shelf[mood].push(id);
  }
  return shelf;
}

/** Стикер с полки под первое подходящее настроение — или null. */
export function pickSticker(shelf, moods, random = Math.random) {
  for (const mood of moods) {
    const list = shelf?.[mood];
    if (Array.isArray(list) && list.length) return { mood, id: list[Math.min(list.length - 1, Math.floor(random() * list.length))] };
  }
  return null;
}
