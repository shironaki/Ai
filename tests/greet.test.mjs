/**
 * Она пишет хозяину первой (утро и перед сном) и меняет поведение по
 * настроению: ворчливая и сонная — короче, игривая — поддразнит.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, reset, last, chats, says, sdk, system, toOwner, toChat, OWNER, KEY, DAY } from "./fixtures/kit.mjs";

const { parseGreet, greetSettings, GREET_KEY } = await import("../tgcloud/lib/greet.js");
const { moodOf, behaviourOf } = await import("../tgcloud/lib/mood.js");
const { createPhrasebook } = await import("../tgcloud/lib/phrasebook.js");

const ON = { PHRASES: true, GREET: true };
const at = (text) => Date.parse(text);
const own = (text) => message(text, { id: OWNER });
const book = createPhrasebook();
const MORNING = book.pool("+утро хозяину", { formal: true, vars: { "настроение": "X", "причина": "Y" } });
const NIGHT = book.pool("+ночь хозяину", { formal: true });
const HOUR = 3_600_000;

test("разбор: время утра и ночи, выключить, включить, спросить; обычное «доброе утро» — не настройка", () => {
  const cases = {
    "пиши мне доброе утро в 7:30": { set: "morning", time: "07:30" }, "желай доброго утра в 8": { set: "morning", time: "08:00" },
    "Желай спокойной ночи в 23 30.": { set: "night", time: "23:30" }, "пиши спокойной ночи в 11 вечера": { set: "night", time: "23:00" },
    "желай доброй ночи в 0:30": { set: "night", time: "00:30" },
    "не пиши мне первой": { off: "all" }, "не желай спокойной ночи": { off: "night" }, "не пиши по утрам": { off: "morning" },
    "пиши первой": { on: "all" }, "желай доброго утра": { on: "morning" }, "желай спокойной ночи": { on: "night" },
    "когда ты пишешь первой?": { show: true },
  };
  for (const [said, want] of Object.entries(cases)) assert.deepEqual(parseGreet(said), want, said);
  for (const said of ["доброе утро", "спокойной ночи", "пиши мне", "желай удачи", "пиши доброе утро в 25", "не пиши ночью"]) assert.equal(parseGreet(said), null, said);
  assert.deepEqual(greetSettings(null), { morning: "08:00", night: "23:00", morningOff: false, nightOff: false, m: "", n: "" });
});

test("утром и перед сном — по разу, в свой час, словами из словаря; опоздала на два часа — молчит", async () => {
  reset();
  let now = at("2026-11-18T04:30:00Z"); // 07:30 по Москве
  const h = heart(ON, { now: () => now });
  await h.tick({});
  assert.equal(toOwner().length, 0, "раньше времени не пишет");
  now = at("2026-11-18T05:05:00Z"); // 08:05
  await h.tick({});
  assert.equal(toOwner().length, 1);
  assert.ok(MORNING.some(line => toOwner()[0].text.startsWith(line.split("X")[0].slice(0, 12))), `утренняя строка из словаря: ${toOwner()[0].text}`);
  assert.match(toOwner()[0].text, /хозяин/u);
  assert.doesNotMatch(toOwner()[0].text, /[{}]/u, "переменные подставлены");
  await h.tick({});
  now += 30 * 60_000;
  await h.tick({});
  assert.equal(toOwner().length, 1, "второй раз за утро не пишет");
  assert.equal(chats().length, 0, "модель не тратится");

  now = at("2026-11-18T20:10:00Z"); // 23:10
  await h.tick({});
  assert.equal(toOwner().length, 2);
  assert.ok(NIGHT.includes(toOwner()[1].text), `вечерняя строка из словаря: ${toOwner()[1].text}`);
  now = at("2026-11-18T21:30:00Z"); // 00:30 следующего дня — та же ночь
  await h.tick({});
  assert.equal(toOwner().length, 2, "ночь одна — и слова одни");

  // Будильник молчал до половины одиннадцатого: утро пропущено, вечером — снова пишет.
  now = at("2026-11-19T07:35:00Z");
  await h.tick({});
  assert.equal(toOwner().length, 2);
  // Через полночь: в 23:00 будильник молчал, в 00:40 — ещё уместно.
  now = at("2026-11-19T21:40:00Z");
  await h.tick({});
  assert.equal(toOwner().length, 3);
  assert.ok(NIGHT.includes(toOwner()[2].text));

  // Сказанное остаётся в переписке: ответ хозяина модель поймёт.
  sdk().fetchQueue.push(says("И вам, хозяин."));
  now += 60_000;
  await h.onMessage(own("а ты сама-то отдыхаешь хоть иногда, расскажи подробно"), KEY);
  const history = JSON.parse(chats().at(-1).options.body).messages.map(item => item.content).join("\n");
  assert.ok(history.includes(toOwner()[2].text), "её вечерние слова есть в истории");
});

test("не повторяет сказанное: с утра уже говорили, «спокойной ночи» он сказал сам", async () => {
  reset();
  let now = at("2026-11-18T04:20:00Z"); // 07:20 — хозяин уже пишет
  const h = heart(ON, { now: () => now });
  await h.onMessage(own("привет"), KEY);
  const before = toOwner().length;
  now = at("2026-11-18T05:10:00Z");
  await h.tick({});
  assert.equal(toOwner().length, before, "уже разговаривали утром — «доброе утро» вдогонку не шлёт");

  now = at("2026-11-18T19:50:00Z"); // 22:50
  await h.onMessage(own("спокойной ночи"), KEY);
  const after = toOwner().length;
  now = at("2026-11-18T20:15:00Z");
  await h.tick({});
  assert.equal(toOwner().length, after, "он уже попрощался на ночь");
});

test("время и выключатель — словами хозяина; другим она первой не пишет и настройку от них не берёт", async () => {
  reset();
  let now = at("2026-11-18T09:00:00Z");
  const h = heart(ON, { now: () => now });
  await h.onMessage(own("желай доброго утра в 6:30"), KEY);
  assert.match(last(OWNER), /Хорошо, хозяин: доброе утро — в 06:30, спокойной ночи — в 23:00\./u);
  await h.onMessage(own("желай спокойной ночи в 0:30"), KEY);
  await h.onMessage(own("когда ты пишешь первой?"), KEY);
  assert.match(last(OWNER), /доброе утро — в 06:30, спокойной ночи — в 00:30/u);
  const count = toOwner().length;
  now = at("2026-11-19T03:40:00Z"); // 06:40
  await h.tick({});
  assert.equal(toOwner().length, count + 1, "в новый час — пишет");
  now = at("2026-11-19T05:10:00Z"); // 08:10 — прежний час больше не её
  await h.tick({});
  assert.equal(toOwner().length, count + 1);

  await h.onMessage(own("не пиши по утрам"), KEY);
  assert.match(last(OWNER), /по утрам не пишу, спокойной ночи — в 00:30/u);
  await h.onMessage(own("не пиши первой"), KEY);
  assert.match(last(OWNER), /первой писать не буду/u);
  const quiet = toOwner().length;
  for (const moment of ["2026-11-20T03:40:00Z", "2026-11-20T21:40:00Z"]) { now = at(moment); await h.tick({}); }
  assert.equal(toOwner().length, quiet, "выключено — молчит");
  await h.onMessage(own("пиши первой"), KEY);
  assert.match(last(OWNER), /доброе утро — в 06:30, спокойной ночи — в 00:30/u);

  // Посторонний: настройка не его, и первой ему никто не пишет.
  sdk().fetchQueue.push(says("Ответ модели."));
  await h.onMessage(message("не пиши первой"), KEY);
  assert.equal(last(), "Ответ модели.");
  assert.equal(JSON.parse(sdk().kv.get(GREET_KEY)).morningOff, false);

  // Выключено настройкой сборки или нет словаря — не пишет вовсе.
  for (const config of [{ PHRASES: true, GREET: false }, { PHRASES: false, GREET: true }]) {
    reset();
    now = at("2026-11-18T05:05:00Z");
    const off = heart(config, { now: () => now });
    await off.tick({});
    assert.equal(toOwner().length, 0);
  }
});

// ── настроение меняет поведение ──────────────────────────────────────────
/** Человек, у которого в этот час нужное настроение: зерно зависит от его номера. */
const someone = (moment, mood, extra = {}) => {
  for (let id = 100; id < 400; id += 1) if (moodOf({ now: moment, timeZone: "Europe/Moscow", userId: id, ...extra }).mood === mood) return id;
  throw new Error(`не нашлось человека с настроением «${mood}»`);
};
/** Случайность с зерном: одна и та же последовательность для сравнения. */
const seeded = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

test("настроение → поведение: виды и подсказки модели", () => {
  assert.equal(behaviourOf("ворчливое").kind, "short");
  assert.equal(behaviourOf("сонное").kind, "short");
  assert.equal(behaviourOf("игривое").kind, "playful");
  assert.equal(behaviourOf("мечтательное").kind, "soft");
  assert.equal(behaviourOf("разговорчивое").kind, "chatty");
  assert.deepEqual(behaviourOf("деловое"), { kind: "plain", hint: "" });
  assert.match(behaviourOf("уставшее").hint, /короче обычного/u);
  assert.match(behaviourOf("хулиганское").hint, /шутить и поддразнивать/u);
});

test("сонная и ворчливая отвечают короче; модели говорится то же", async () => {
  const night = at("2026-11-17T23:30:00Z"); // 02:30 по Москве
  const noon = at("2026-11-18T09:00:00Z");
  const sleepy = someone(night, "сонное");
  const plain = someone(noon, "деловое");
  const total = async (moment, id) => {
    let sum = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      reset();
      const h = heart({ PHRASES: true }, { now: () => moment, random: seeded(seed) });
      await h.onMessage(message("что делаешь", { id }), KEY);
      sum += last(id).length;
    }
    return sum;
  };
  const [short, usual] = [await total(night, sleepy), await total(noon, plain)];
  assert.ok(short < usual, `сонная в сумме короче: ${short} против ${usual}`);

  reset();
  const h = heart({ PHRASES: true }, { now: () => night });
  sdk().fetchQueue.push(says("Мм."));
  await h.onMessage(message("объясни в двух словах, почему ночью тихо", { id: sleepy }), KEY);
  assert.match(system(), /Настроение: сонное/u);
  assert.match(system(), /Сейчас отвечай короче обычного и чуть суше/u);
  sdk().fetchQueue.push(says("Да."));
  const calm = heart({ PHRASES: true }, { now: () => noon });
  await calm.onMessage(message("объясни в двух словах, почему днём шумно", { id: plain }), KEY);
  assert.doesNotMatch(system(), /Сейчас отвечай короче|Сейчас можно шутить/u, "обычное настроение — без добавки");
});

test("игривая поддразнит вдогонку — не всегда, не на прощание и не к серьёзному", async () => {
  const friday = at("2026-11-20T13:30:00Z"); // пятница, 16:30
  const id = someone(friday, "игривое");
  const tails = book.pool("+настроение:игривое", { formal: true });
  const ask = async (text, roll) => {
    reset();
    const h = heart({ PHRASES: true }, { now: () => friday, random: () => roll });
    await h.onMessage(message(text, { id }), KEY);
    return last(id);
  };
  const teased = await ask("какой твой любимый цвет", 0.1);
  assert.ok(tails.some(tail => teased.endsWith(` ${tail}`)), `в ответ добавлена игривая строка: ${teased}`);
  const calm = await ask("какой твой любимый цвет", 0.9);
  assert.ok(!tails.some(tail => calm.endsWith(` ${tail}`)), "чаще — без добавки");
  const bye = await ask("пока", 0.1);
  assert.ok(!tails.some(tail => bye.endsWith(` ${tail}`)), "на прощание не дразнит");
  const grave = await ask("не хочу жить", 0.1);
  assert.match(grave, /112/u);
  assert.ok(!tails.some(tail => grave.endsWith(` ${tail}`)), "к серьёзному — ничего вдогонку");
});
