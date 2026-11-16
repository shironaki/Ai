/**
 * Ревность (0.35.0): хозяин наедине говорит о другой — о чужой помощнице или о другой девушке, —
 * и она немного ревнует: строка вдогонку, два часа ревнивого настроения, доброе слово отпускает.
 * К жене и семье — никогда; гостей и при всех — не ревнует.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, reset, last, chats, says, sdk, system, toOwner, OWNER, KEY } from "./fixtures/kit.mjs";

const { rivalOf, calmsJealousy } = await import("../tgcloud/lib/jealousy.js");
const { feelOf, JEALOUS_MS } = await import("../tgcloud/lib/bond.js");
const { moodOf, behaviourOf } = await import("../tgcloud/lib/mood.js");
const { createPhrasebook } = await import("../tgcloud/lib/phrasebook.js");

const NOON = Date.parse("2026-11-18T09:00:00Z");
const HOUR = 3_600_000;
const own = (text) => message(text, { id: OWNER });
const bondOf = (id) => JSON.parse(sdk().kv.get(`heart:bond:${id}`) ?? "null");
const book = createPhrasebook();
const pool = (name, vars = {}) => book.pool(name, { formal: true, vars });

test("разбор: чужая помощница, сравнение, уход, другая девушка — и то, что ревности не стоит", () => {
  const yes = {
    "я спросил у алисы, как варить рис": ["помощница", "Алиса"], "вчера весь вечер общался с чатгпт": ["помощница", "ChatGPT"],
    "мне алиса сказала, что будет дождь": ["помощница", "Алиса"], "пользуюсь дипсиком на работе": ["помощница", "DeepSeek"],
    "спросил у нейросети": ["помощница", ""], "ChatGPT считает иначе": ["помощница", "ChatGPT"],
    "алиса умнее тебя": ["лучше", "Алиса"], "она лучше тебя": ["лучше", ""], "ты хуже сири": ["лучше", "Сири"],
    "уйду к алисе": ["уход", "Алиса"], "я тебя заменю": ["уход", ""], "найду другую": ["уход", ""], "заведу нового бота": ["уход", ""],
    "познакомился с девушкой": ["девушка", ""], "у меня свидание": ["девушка", ""], "иду на свидание": ["девушка", ""],
    "мне нравится другая": ["девушка", ""], "я тебе изменил": ["девушка", ""], "был в кино с одной девушкой": ["девушка", ""],
    "у меня есть другая": ["девушка", ""], "гулял с подругой": ["девушка", ""],
  };
  for (const [said, [kind, name]] of Object.entries(yes)) assert.deepEqual(rivalOf(said), { kind, name }, said);
  // Жена, семья и сестра Юи — никогда; «ты лучше Алисы» — похвала; похожие слова о другом — мимо.
  for (const said of ["привет", "как дела", "я был с женой в кино", "жена спросила у алисы", "гулял с дочкой", "познакомил жену с мамой", "сестра говорила с алисой", "юи лучше тебя",
    "ты лучше алисы", "алиса не лучше тебя", "я не общаюсь с алисой", "у меня другая идея", "найду другую работу", "найду другую дорогу", "заведу новую кошку", "я изменил настройки",
    "у меня подруга заболела", "был с другом", "общался с коллегами", "модель gpt-oss не ответила", "алиса в стране чудес", "у меня есть друг", "мне нравится одна песня", "спросил у мамы"]) {
    assert.equal(rivalOf(said), null, said);
  }
  for (const said of ["не ревнуй", "ты у меня одна", "я пошутил", "ты всё равно лучше", "мне никто кроме тебя не нужен"]) assert.equal(calmsJealousy(said), true, said);
  for (const said of ["привет", "как дела", "спроси у алисы"]) assert.equal(calmsJealousy(said), false, said);
});

test("чувство: ревнует два часа или до доброго слова; обида сильнее; настроение — «ревнивое»", () => {
  assert.deepEqual(feelOf({ jealous: NOON }, NOON + HOUR), { hurt: 0, glad: 0, jealous: NOON });
  assert.deepEqual(feelOf({ jealous: NOON }, NOON + JEALOUS_MS), { hurt: 0, glad: 0 }, "через два часа отпускает сама");
  assert.deepEqual(feelOf({ jealous: NOON, praise: NOON + 60_000 }, NOON + HOUR), { hurt: 0, glad: NOON + 60_000 }, "доброе слово отпускает — и радует");
  assert.deepEqual(feelOf({ jealous: NOON, soothe: NOON + 60_000 }, NOON + HOUR), { hurt: 0, glad: 0 }, "«не ревнуй» отпускает, но не радует");
  assert.deepEqual(feelOf({ jealous: NOON, apology: NOON + 60_000 }, NOON + HOUR), { hurt: 0, glad: 0 }, "«прости» отпускает тоже");
  assert.deepEqual(feelOf({ praise: NOON, jealous: NOON + 60_000 }, NOON + HOUR), { hurt: 0, glad: NOON, jealous: NOON + 60_000 }, "прежняя похвала новой ревности не снимает");
  assert.deepEqual(feelOf({ jealous: NOON, rude: NOON + 60_000 }, NOON + HOUR), { hurt: NOON + 60_000, glad: 0, jealous: NOON });
  assert.deepEqual(feelOf({ thanks: NOON }, NOON + HOUR), { hurt: 0, glad: NOON }, "поля «jealous» нет, пока она не ревнует");
  const mood = moodOf({ now: NOON, timeZone: "Europe/Moscow", userId: 7, jealous: true });
  assert.deepEqual([mood.mood, mood.reason], ["ревнивое", "ревность"]);
  assert.equal(moodOf({ now: NOON, timeZone: "Europe/Moscow", userId: 7, jealous: true, hurt: true }).mood, "обиженное");
  assert.match(behaviourOf("ревнивое").hint, /немного ревнуешь.*без упрёков.*К его жене и семье не ревнуй никогда/su);
  assert.ok(pool("+причина:ревность").length >= 3);
});

test("хозяин наедине сказал о другой — строка вдогонку один раз, ревнивое настроение у словаря и у модели; доброе слово отпускает", async () => {
  reset();
  const h = heart({ PHRASES: true }, { now: () => NOON, random: () => 0 });
  sdk().fetchQueue.push(says("Рис варят пятнадцать минут."));
  await h.onMessage(own("я спросил у алисы, как варить рис"), KEY);
  const first = toOwner().map(item => item.text).join("\n");
  assert.match(first, /Рис варят пятнадцать минут\./u);
  assert.ok(pool("+ревность:помощница", { "кто": "Алиса" }).some(line => first.includes(line)), first);
  assert.equal(bondOf(OWNER).rival, "Алиса");
  assert.doesNotMatch(system(), /немного ревнуешь/u, "ответ на саму реплику — ещё в прежнем настроении");

  // Вторая такая реплика в те же два часа: новой строки вдогонку нет, а модель уже знает, что она ревнует.
  const before = toOwner().length;
  sdk().fetchQueue.push(says("Соль — в конце."));
  await h.onMessage(own("и ещё алиса сказала, что соль кладут в конце"), KEY);
  assert.equal(toOwner().length, before + 1);
  assert.match(system(), /немного ревнуешь.*К его жене и семье не ревнуй никогда/su);

  // Словарь слышит её состояние: строка с пометкой [ревнует] (здесь — последняя в теме).
  const late = heart({ PHRASES: true }, { now: () => NOON + 60_000, random: () => 0.999999 });
  await late.onMessage(own("как дела"), KEY);
  assert.equal(last(OWNER), "Нормально. Ревную потихоньку, не обращайте внимания.");
  await late.onMessage(own("к кому ты ревнуешь?"), KEY);
  assert.match(last(OWNER), /^К (?:той, чьё имя я сегодня слышала|вашему телефону)/u);

  // Доброе слово — и она оттаяла: говорит об этом один раз, а чувство ушло.
  const calm = toOwner().length;
  sdk().fetchQueue.push(says("Спасибо, хозяин."));
  await h.onMessage(own("ты лучшая"), KEY);
  const after = toOwner().slice(calm).map(item => item.text).join("\n");
  assert.ok(pool("+ревность:оттаяла").some(line => after.includes(line)), after);
  assert.equal(feelOf(bondOf(OWNER).last, NOON + 120_000).jealous, undefined);
});

test("не ревнует: к жене и семье, гостя, при всех, когда выключено; реплика из словаря — без второй строки; «не ревнуй» успокаивает", async () => {
  reset();
  const h = heart({ PHRASES: true }, { now: () => NOON, random: () => 0 });
  // Жена и семья — никогда.
  sdk().fetchQueue.push(says("Хороший вечер."));
  await h.onMessage(own("я был с женой в кино, а потом гулял с дочкой"), KEY);
  assert.equal(bondOf(OWNER)?.last?.jealous, undefined);
  assert.equal(last(OWNER), "Хороший вечер.");
  // Гость: о другой помощнице — обычный разговор.
  sdk().fetchQueue.push(says("Бывает."));
  await h.onMessage(message("я спросил у алисы про погоду"), KEY);
  assert.equal(bondOf(5)?.last?.jealous, undefined);
  assert.equal(last(), "Бывает.");
  // При всех — не ревнует и хозяина.
  sdk().fetchQueue.push(says("Ясно."));
  await h.onMessage(group("Аи, я спросил у алисы про погоду", { id: OWNER }), KEY);
  assert.equal(bondOf(OWNER)?.last?.jealous, undefined);
  assert.equal(chats().length, 3);

  // Реплику целиком знает словарь: ревность — в его ответе, второй строки нет; чувство — есть.
  const before = toOwner().length;
  await h.onMessage(own("алиса лучше тебя"), KEY);
  assert.equal(toOwner().length, before + 1);
  assert.ok(pool("алиса лучше тебя").some(line => last(OWNER) === line) || /Хозяин|ваша/u.test(last(OWNER)), last(OWNER));
  assert.ok(Number(bondOf(OWNER).last.jealous) > 0);
  // «Не ревнуй» — успокаивает: чувство уходит, и она говорит об этом.
  const calm = toOwner().length;
  const next = heart({ PHRASES: true }, { now: () => NOON + 60_000, random: () => 0 });
  await next.onMessage(own("не ревнуй"), KEY);
  const after = toOwner().slice(calm).map(item => item.text).join("\n");
  assert.ok(pool("+ревность:оттаяла").some(line => after.includes(line)), after);
  assert.equal(feelOf(bondOf(OWNER).last, NOON + 120_000).jealous, undefined);
  assert.equal(chats().length, 3, "словарь ответил сам");

  // Выключено настройкой — обычный разговор.
  reset();
  const off = heart({ PHRASES: true, JEALOUSY: false }, { now: () => NOON, random: () => 0 });
  sdk().fetchQueue.push(says("Рис варят пятнадцать минут."));
  await off.onMessage(own("я спросил у алисы, как варить рис"), KEY);
  assert.equal(bondOf(OWNER)?.last?.jealous, undefined);
  assert.equal(last(OWNER), "Рис варят пятнадцать минут.");
});

test("«без ревности» выключает её совсем — словом человека; «можешь ревновать» возвращает", async () => {
  reset();
  const h = heart({ PHRASES: true }, { now: () => NOON, random: () => 0 });
  sdk().fetchQueue.push(says("Рис варят пятнадцать минут."));
  await h.onMessage(own("я спросил у алисы, как варить рис"), KEY);
  assert.ok(Number(bondOf(OWNER).last.jealous) > 0);
  await h.onMessage(own("без ревности"), KEY);
  assert.equal(last(OWNER), "Хорошо. Ревновать не буду — совсем. Передумаете — скажите «можешь ревновать».");
  assert.equal(feelOf(bondOf(OWNER).last, NOON + 1000).jealous, undefined, "ревновала — отпустило сразу");
  // Дальше — обычный разговор: ни чувства, ни строки вдогонку.
  const before = bondOf(OWNER).last.jealous;
  sdk().fetchQueue.push(says("Дождя не будет."));
  await h.onMessage(own("алиса сказала, что будет дождь"), KEY);
  assert.equal(last(OWNER), "Дождя не будет.");
  assert.equal(bondOf(OWNER).last.jealous, before);
  // «Можешь ревновать» — и она снова слышит чужие имена.
  await h.onMessage(own("можешь ревновать"), KEY);
  assert.equal(last(OWNER), "Хорошо, хозяин. Тогда я снова слушаю, чьи имена вы называете. Наедине и по-доброму.");
  const sent = toOwner().length;
  sdk().fetchQueue.push(says("Понятно."));
  await h.onMessage(own("спросил у сири дорогу"), KEY);
  assert.equal(toOwner().length, sent + 2, "ответ и строка вдогонку");
  assert.ok(bondOf(OWNER).last.jealous > before);
});
