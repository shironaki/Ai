/**
 * Силы: «устала», когда лимит на исходе.
 *
 * Слово владельца (16.11.2026): «если лимит запросов подходит к концу, то она говорит, что
 * утомилась или устала, и на последующие запросы отвечает уже запасом или из своего словаря».
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, reset, sdk, last, chats, says, refuses, toOwner, KEY, OWNER } from "./fixtures/kit.mjs";
import { tire, tiredNow, runningLow, staminaLine, LOW_REST_MS } from "../tgcloud/lib/stamina.js";

const NOON = Date.UTC(2026, 10, 16, 9, 0);   // понедельник, 12:00 по Москве
const HOUR = 3_600_000;
const low = (text, left = 90) => says(text, { headers: { "x-ratelimit-remaining-requests": String(left), "x-ratelimit-limit-requests": "1000" } });
const models = () => chats().map(item => JSON.parse(item.options.body).model);
const SPARES = { AI_MODELS: ["openai/gpt-oss-120b", "qwen/qwen3.8-27b"] };
const TIRED_LINE = /утомилась|устала/u;

test("правила усталости: одна усталость — одна запись; причина только утяжеляется", () => {
  assert.equal(runningLow(100, 1000), true);
  assert.equal(runningLow(101, 1000), false);
  assert.equal(runningLow(null, 1000), false, "нет заголовков — нет усталости");
  const first = tire(null, { why: "low", model: "gpt-oss-20b", left: 90, cap: 1000 }, NOON);
  assert.deepEqual(first, { why: "low", since: NOON, until: NOON + LOW_REST_MS, model: "gpt-oss-20b", left: 90, cap: 1000 });
  // Тот же повод через час: начало не сдвигается — «я устала» не прозвучит второй раз.
  const again = tire(first, { why: "low", model: "gpt-oss-20b", left: 60, cap: 1000 }, NOON + HOUR);
  assert.equal(again.since, NOON);
  assert.equal(again.left, 60);
  // Дневной лимит тяжелее «на исходе», срок только растёт; лёгкая причина тяжёлую не отменяет.
  const heavy = tire(again, { why: "limit", until: NOON + 10 * HOUR, model: "gpt-oss-20b" }, NOON + HOUR);
  assert.equal(heavy.why, "limit");
  assert.equal(heavy.until, NOON + 10 * HOUR);
  assert.equal(tire(heavy, { why: "low" }, NOON + 2 * HOUR).why, "limit");
  assert.equal(tiredNow(heavy, NOON + 10 * HOUR), false, "срок вышел — отдохнула");
  // Отдохнула — следующая усталость начинается заново.
  assert.equal(tire(heavy, { why: "low" }, NOON + 11 * HOUR).since, NOON + 11 * HOUR);
  assert.equal(staminaLine(null, { at: NOON }), "бодра");
  assert.match(staminaLine(first, { at: NOON }), /^устала — запас основной модели gpt-oss-20b на исходе: осталось 90 из 1000 запросов; людям отвечают запасные, вам — основная · с 09:00, проверю себя в 12:00$/u);
});

test("лимит на исходе: говорит, что устала, — раз на чат; дальше людям отвечают запасные, хозяину — основная", async () => {
  reset();
  let at = NOON;
  const h = heart(SPARES, { now: () => at });
  // Основная ответила, а запросов осталось 90 из 1000: в этом же ответе она говорит, что устала.
  sdk().fetchQueue.push(low("Юпитер."));
  await h.onMessage(message("какая планета самая большая?"), KEY);
  const [answer, aside] = last().split("\n\n");
  assert.equal(answer, "Юпитер.");
  assert.match(aside, TIRED_LINE);
  // Второй ответ в том же чате — уже без слов об усталости, и отвечает запасная: основная бережётся.
  sdk().fetchQueue.push(says("Меркурий."));
  await h.onMessage(message("а самая маленькая планета какая?"), KEY);
  assert.equal(last(), "Меркурий.");
  assert.equal(models().at(-1), "openai/gpt-oss-120b", "человеку ответила запасная");
  assert.equal(JSON.parse(chats().at(-1).options.body).max_tokens, 420, "уставшая отвечает короче: 700 → 420");
  // Другой чат слышит об усталости свой один раз.
  sdk().fetchQueue.push(says("Сатурн."));
  await h.onMessage(message("у какой планеты есть кольца?", { id: 9 }), KEY);
  assert.match(last(9), /^Сатурн\.\n\n.*(?:утомилась|устала)/u);
  // Хозяину — без ограничений: его вопрос идёт к основной, ответ полной длины.
  sdk().fetchQueue.push(low("Венера.", 80));
  await h.onMessage(message("какая планета самая горячая?", { id: OWNER }), KEY);
  assert.equal(models().at(-1), "openai/gpt-oss-20b", "хозяину отвечает основная");
  assert.equal(JSON.parse(chats().at(-1).options.body).max_tokens, 700);
  assert.match(last(OWNER), /^Венера\.\n\n.*(?:утомилась|устала)/u, "и хозяин слышит это один раз");
  // «Статус» называет причину и час.
  await h.onMessage(message("статус", { id: OWNER }), KEY);
  assert.match(last(OWNER), /\nСилы: устала — запас основной модели gpt-oss-20b на исходе: осталось 80 из 1000 запросов; людям отвечают запасные, вам — основная · с 12:00, проверю себя в 15:00\n/u);
  // Весть владельцу о лимите говорит то же, что она делает.
  assert.match(toOwner().map(item => item.text).join("\n"), /людям я скажу, что устала, и отвечать им будут запасные модели/u);

  // Через три часа она проверяет себя: основная отвечает с запасом — отдохнула, слов об усталости нет.
  at = NOON + 3 * HOUR + 60_000;
  sdk().fetchQueue.push(says("Марс.", { headers: { "x-ratelimit-remaining-requests": "400", "x-ratelimit-limit-requests": "1000" } }));
  await h.onMessage(message("какую планету зовут красной?"), KEY);
  assert.equal(last(), "Марс.");
  assert.equal(models().at(-1), "openai/gpt-oss-20b", "основная снова первая");
  await h.onMessage(message("статус", { id: OWNER }), KEY);
  assert.match(last(OWNER), /\nСилы: бодра\n/u);
});

test("основная ответила с запасом раньше срока — усталость снята сразу", async () => {
  reset();
  let at = NOON;
  const h = heart(SPARES, { now: () => at });
  sdk().fetchQueue.push(low("Раз."));
  await h.onMessage(message("скажи что-нибудь первое", { id: OWNER }), KEY);
  assert.match(last(OWNER), TIRED_LINE);
  at += 30 * 60_000;
  // Хозяин спрашивает — основная отвечает, запас вернулся: 300 из 1000.
  sdk().fetchQueue.push(low("Два.", 300));
  await h.onMessage(message("скажи что-нибудь второе", { id: OWNER }), KEY);
  assert.equal(last(OWNER), "Два.");
  sdk().fetchQueue.push(says("Три."));
  await h.onMessage(message("скажи что-нибудь третье"), KEY);
  assert.equal(models().at(-1), "openai/gpt-oss-20b", "человеку снова отвечает основная");
  assert.equal(last(), "Три.");
});

test("усталость слышна и в словаре: «ты устала?» и «как дела» отвечают по состоянию", async () => {
  reset();
  let at = NOON;
  const h = heart({ ...SPARES, PHRASES: true }, { now: () => at, random: () => 0 });
  await h.onMessage(message("ты устала?"), KEY);
  assert.doesNotMatch(last(), /утомилась|Устала, не скрою|Есть такое/u, "бодра — строки [устала] не звучат");
  sdk().fetchQueue.push(low("Юпитер — самая большая планета Солнечной системы."));
  await h.onMessage(message("расскажи, какая планета самая большая и почему"), KEY);
  assert.match(last(), TIRED_LINE);
  const before = chats().length;
  await h.onMessage(message("ты устала?"), KEY);
  assert.match(last(), /^(?:Да, утомилась|Устала, не скрою|Есть такое): /u, "устала — звучат только строки [устала]");
  await h.onMessage(message("как дела?"), KEY);
  assert.match(last(), /^(?:Утомилась|Честно — устала): /u);
  assert.equal(chats().length, before, "на это модель не тратится");
});

test("у основной вышел дневной лимит: ответила запасная — и в том же ответе сказано, что устала", async () => {
  reset();
  const at = NOON;
  const h = heart(SPARES, { now: () => at });
  sdk().fetchQueue.push(
    refuses(429, { code: "rate_limit_exceeded", headers: { "retry-after": "7200" }, message: "Rate limit reached for model in organization on tokens per day (TPD): Limit 200000, Used 199000, Requested 2000." }),
    says("Восемь."),
  );
  await h.onMessage(message("сколько планет в Солнечной системе?"), KEY);
  assert.match(last(), /^Восемь\.\n\n.*(?:утомилась|устала)/u);
  assert.deepEqual(models(), ["openai/gpt-oss-20b", "openai/gpt-oss-120b"]);
  await h.onMessage(message("статус", { id: OWNER }), KEY);
  assert.match(last(OWNER), /\nСилы: устала — у основной модели gpt-oss-20b вышел дневной лимит; отвечают запасные · с 12:00, проверю себя в 14:00\n/u);
  // Короткий лимит (в минуту) — обычная работа цепочки: усталостью не считается.
  reset();
  const fresh = heart(SPARES, { now: () => at });
  sdk().fetchQueue.push(refuses(429, { code: "rate_limit_exceeded", headers: { "retry-after": "7" }, message: "Rate limit reached on tokens per minute (TPM): Limit 8000, Used 7900, Requested 500." }), says("Восемь."));
  await fresh.onMessage(message("сколько планет в Солнечной системе?"), KEY);
  assert.equal(last(), "Восемь.");
});

test("упёрлись все модели: «выдохлась», вопрос записан; в статусе — причина", async () => {
  reset();
  const at = NOON;
  const h = heart(SPARES, { now: () => at });
  const out = () => refuses(429, { code: "rate_limit_exceeded", headers: { "retry-after": "1200" }, message: "Rate limit reached for model in organization on tokens per day (TPD): Limit 200000, Used 199000, Requested 2000." });
  sdk().fetchQueue.push(out(), out(), out());
  await h.onMessage(message("сколько планет в Солнечной системе?"), KEY);
  assert.match(last(), /^Я выдохлась: мысли на сегодня кончились\. Вопрос я записала и отвечу сама, как только отдохну — примерно после 12:20\.$/u);
  await h.onMessage(message("статус", { id: OWNER }), KEY);
  assert.match(last(OWNER), /\nСилы: выдохлась — у всех моделей вышел лимит; отвечаю из словаря, вопросы записываю · с 12:00, проверю себя в 12:20\n/u);
});
