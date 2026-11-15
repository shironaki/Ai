/**
 * Перевод без модели разговора: «переведи на английский: …», «как по-турецки …»,
 * «переведи» ответом на сообщение. Переводит переводчик на ключе Cloudflare;
 * нет ключа или он не справился — просьба уходит в разговор, как раньше.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, reset, last, chats, says, sdk, source, sourced, OWNER, KEY } from "./fixtures/kit.mjs";

const { parseTranslate, guessLanguage, LANGUAGES } = await import("../tgcloud/lib/translate.js");

const CF = "0123456789abcdef0123456789abcdef:cf-token_ABCDEFGH-1234567890xyz";
const ON = { DRAW_KEY: CF, DRAW_DIRECTOR: false };
const translated = (text) => ({ success: true, result: { translated_text: text } });
const asked = () => sdk().sourceFetches.filter(item => item.url.includes("m2m100")).map(item => JSON.parse(item.options.body));
const hers = (text, id = 50) => ({ message_id: id, from: { id: 999, is_bot: true }, text });

test("разбор: язык, направление, текст; деньги, «в текст» и разговор — мимо", () => {
  const cases = {
    "переведи на английский: доброе утро": { to: "en", text: "доброе утро" },
    "Переведи на турецкий «спасибо большое»": { to: "tr", text: "спасибо большое" },
    "переведи с немецкого: Guten Morgen": { from: "de", text: "Guten Morgen" },
    "переведи с английского на русский: How are you?": { to: "ru", from: "en", text: "How are you?" },
    "переведи пожалуйста на английский язык: я дома": { to: "en", text: "я дома" },
    "переведи": { text: "" }, "переведи это": { text: "" }, "переведи на русский": { to: "ru", text: "" },
    "переведи: good morning": { text: "good morning" },
    "как по-английски \"доброе утро\"?": { to: "en", text: "доброе утро" },
    "как будет по-турецки спасибо": { to: "tr", text: "спасибо" },
    "как на арабском мир": { to: "ar", text: "мир" },
    "как по-английски будет «кот»?": { to: "en", text: "кот" },
    "а как по-немецки слово дом": { to: "de", text: "дом" },
    "как по-русски thank you": { to: "ru", text: "thank you" },
    "переведи на голландский: добрый день": { to: "nl", text: "добрый день" },
    "переведи на татарский: привет": { unknown: "татарский" },
  };
  for (const [said, want] of Object.entries(cases)) assert.deepEqual(parseTranslate(said), want, said);
  for (const said of ["переведи 100 долларов в рубли", "переведи в текст", "переведи деньги маме", "переведи на карту 500", "переведи часы", "как дела", "как по-твоему, это правда?",
    "как насчёт завтра", "перевод", "переводчик нужен", "как по-английски"]) assert.equal(parseTranslate(said), null, said);
  assert.deepEqual(["привет", "hello", "Günaydın", "شكرا", "こんにちは", "Guten Morgen, schön", "сәлем, қалайсың", "привіт, як справи їжак"].map(guessLanguage), ["ru", "en", "tr", "ar", "ja", "de", "kk", "uk"]);
  assert.equal(new Set(LANGUAGES.map(item => item.code)).size, LANGUAGES.length);
});

test("перевод переводчиком: модель разговора не тратится; не справился — отвечает разговор", async () => {
  reset();
  source("m2m100", (url, options) => translated({ "доброе утро": "Good morning", "Good morning": "Доброе утро", "спасибо": "teşekkür ederim", "Guten Morgen": "Доброе утро" }[JSON.parse(options.body).text] ?? "перевод"));
  const h = heart(ON);
  await h.onMessage(message("переведи на английский: доброе утро"), KEY);
  assert.equal(last(), "Good morning");
  assert.deepEqual(asked()[0], { text: "доброе утро", source_lang: "ru", target_lang: "en" });
  await h.onMessage(message("как по-турецки спасибо?"), KEY);
  assert.equal(last(), "teşekkür ederim");
  assert.deepEqual([asked()[1].source_lang, asked()[1].target_lang], ["ru", "tr"]);
  // Язык не назван — по буквам: латиница → на русский, кириллица → на английский.
  await h.onMessage(message("переведи: Good morning"), KEY);
  assert.equal(last(), "Доброе утро");
  assert.deepEqual([asked()[2].source_lang, asked()[2].target_lang], ["en", "ru"]);
  await h.onMessage(message("переведи с немецкого: Guten Morgen"), KEY);
  assert.deepEqual([asked()[3].source_lang, asked()[3].target_lang], ["de", "ru"]);
  // Ответом на сообщение — его текст; в группе — по обращению.
  await h.onMessage(group("Аи, переведи на английский", { reply: { message_id: 9, from: { id: 22, is_bot: false }, text: "доброе утро" } }), KEY);
  assert.equal(last(-10), "Good morning");
  await h.onMessage(message("переведи", { reply: hers("Good morning") }), KEY);
  assert.equal(last(), "Доброе утро");
  assert.equal(chats().length, 0, "модель разговора не тратилась");

  // Нечего переводить — подсказка; уже на этом языке — так и скажет.
  await h.onMessage(message("переведи"), KEY);
  assert.match(last(), /^Что перевести\? Напишите так: «переведи на английский: доброе утро»/u);
  await h.onMessage(message("переведи на русский: доброе утро"), KEY);
  assert.match(last(), /^Это уже по-русски\./u);
  const before = asked().length;

  // Деньги — по-прежнему курс, а не переводчик; «в текст» — не перевод.
  sdk().fetchQueue.push(says("Это не ко мне."));
  await h.onMessage(message("переведи деньги маме"), KEY);
  assert.equal(asked().length, before);
  sdk().fetchQueue.length = 0;

  // Язык переводчику незнаком, текст длинный, переводчик вернул то же самое или молчит — отвечает разговор.
  for (const said of ["переведи на татарский: привет", `переведи на английский: ${"очень длинный текст ".repeat(60)}`]) {
    sdk().fetchQueue.push(says("Перевод от модели."));
    await h.onMessage(message(said), KEY);
    assert.equal(last(), "Перевод от модели.", said.slice(0, 40));
  }
  assert.equal(asked().length, before, "переводчик не спрашивался");
  sdk().sourceReplies.length = 0;
  source("m2m100", (url, options) => translated(JSON.parse(options.body).text));
  sdk().fetchQueue.push(says("Hello — так будет по-английски."));
  await h.onMessage(message("переведи на английский: привет"), KEY);
  assert.equal(last(), "Hello — так будет по-английски.");
  sdk().sourceReplies.length = 0;
  source("m2m100", new Error("down"));
  sdk().fetchQueue.push(says("Hello."));
  await h.onMessage(message("переведи на английский: привет"), KEY);
  assert.equal(last(), "Hello.");

  // Не хозяину — не больше тридцати в день: дальше отвечает разговор. Хозяину — без счёта.
  reset();
  source("m2m100", translated("Good morning"));
  const capped = heart(ON);
  for (let index = 0; index < 30; index += 1) await capped.onMessage(message("переведи на английский: доброе утро"), KEY);
  assert.equal(asked().length, 30);
  sdk().fetchQueue.push(says("Good morning — от модели."));
  await capped.onMessage(message("переведи на английский: доброе утро"), KEY);
  assert.equal(last(), "Good morning — от модели.");
  assert.equal(asked().length, 30);
  for (let index = 0; index < 32; index += 1) await capped.onMessage(message("переведи на английский: доброе утро", { id: OWNER }), KEY);
  assert.equal(asked().length, 62);

  // Без ключа — как раньше: разговор.
  reset();
  const plain = heart({});
  sdk().fetchQueue.push(says("Good morning."));
  await plain.onMessage(message("переведи на английский: доброе утро"), KEY);
  assert.equal(last(), "Good morning.");
  assert.equal(sourced().length, 0);
});
