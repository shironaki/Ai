/**
 * Характер и отношения, которые видно.
 *
 * Слово владельца (16.11.2026): «относительно характера и отношений с Аи — я что-то не заметил,
 * как оно меняется. А нужно, чтоб реально менялось». Причин было две: с хозяином у неё по коду
 * всегда предел близости — меняться нечему; у остальных шаг был один в день, до первой перемены —
 * двадцать пять дней. Здесь проверяется, что перемену теперь видно: ступени, слова о них,
 * обида и радость от поступков — у всех, и у хозяина.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, reset, sdk, last, chats, says, system, toChat, KEY, OWNER, DAY } from "./fixtures/kit.mjs";
import { stageOf, STAGES, DAY_STEP } from "../tgcloud/lib/dialogue-policy.js";
import { createBond, feelOf, HURT_MS, GLAD_MS } from "../tgcloud/lib/bond.js";
import { moodOf, behaviourOf } from "../tgcloud/lib/mood.js";

const NOON = Date.UTC(2026, 10, 16, 9, 0);   // понедельник, 12:00 по Москве
const HOUR = 3_600_000;
const texts = (id = 5) => toChat(id).map(item => item.text);

test("ступени: шесть, по числу симпатии; чувство — по последним поступкам", () => {
  assert.deepEqual(STAGES.map(([key]) => key), ["cold", "first", "known", "warm", "friend", "close"]);
  assert.deepEqual([-100, -26, -25, 0, 9, 10, 24, 25, 49, 50, 74, 75, 100].map(stageOf),
    ["cold", "cold", "first", "first", "first", "known", "known", "warm", "warm", "friend", "friend", "close", "close"]);
  assert.equal(DAY_STEP, 2);
  // Грубость задевает на три часа; извинение или доброе слово после неё обиду снимают.
  assert.deepEqual(feelOf({ rude: NOON }, NOON + HOUR), { hurt: NOON, glad: 0 });
  assert.deepEqual(feelOf({ rude: NOON }, NOON + HURT_MS), { hurt: 0, glad: 0 });
  assert.deepEqual(feelOf({ rude: NOON, apology: NOON + 60_000 }, NOON + HOUR), { hurt: 0, glad: 0 }, "извинение лечит, но не радует");
  assert.deepEqual(feelOf({ rude: NOON, thanks: NOON + 60_000 }, NOON + HOUR), { hurt: 0, glad: NOON + 60_000 });
  assert.deepEqual(feelOf({ thanks: NOON, rude: NOON + 60_000 }, NOON + HOUR), { hurt: NOON + 60_000, glad: 0 }, "грубость после доброго слова — задета");
  assert.deepEqual(feelOf({ praise: NOON }, NOON + GLAD_MS), { hurt: 0, glad: 0 }, "радость держится два часа");
  // Настроение от поступка важнее часа; усталость важнее обиды.
  assert.deepEqual((({ mood, reason }) => [mood, reason])(moodOf({ now: NOON, hurt: true, glad: true })), ["обиженное", "обида"]);
  assert.deepEqual((({ mood, reason }) => [mood, reason])(moodOf({ now: NOON, glad: true })), ["довольное", "похвала"]);
  assert.equal(moodOf({ now: NOON, hurt: true, limited: true }).mood, "уставшее");
  assert.equal(behaviourOf("обиженное").kind, "short");
  assert.match(behaviourOf("обиженное").hint, /просьбу выполни как обычно\. Не мсти/u);
  assert.equal(behaviourOf("довольное").kind, "playful");
});

test("отношения растут заметно: через пять дней — «знакомые», и она говорит об этом сама", async () => {
  reset();
  let at = NOON;
  const h = heart({}, { now: () => at });
  // Четыре дня по шагу в два — 8: ступень прежняя, она ничего не объявляет.
  for (let day = 0; day < 4; day++) {
    sdk().fetchQueue.push(says("ответ"));
    await h.onMessage(message(`расскажи что-нибудь, день ${day}`), KEY);
    assert.equal(last(), "ответ");
    at += DAY;
  }
  assert.equal((await h.policy.state(5)).stage, "first");
  // Пятый день — 10: «знакомые». После ответа — её слова об этом, один раз.
  sdk().fetchQueue.push(says("ответ пятого дня"));
  await h.onMessage(message("расскажи что-нибудь ещё"), KEY);
  assert.deepEqual(texts().slice(-2), ["ответ пятого дня", "Кажется, мы уже знакомы: я узнаю вас и привыкаю к вашей манере."]);
  sdk().fetchQueue.push(says("ещё ответ"));
  await h.onMessage(message("и ещё что-нибудь расскажи"), KEY);
  assert.equal(last(), "ещё ответ", "второй раз о той же ступени — ни слова");
  const state = await h.policy.state(5);
  assert.equal(state.stage, "known");
  assert.deepEqual(state.path, [["known", at]]);

  // «Как ты ко мне относишься?» — ступень, дни, поступки и что их двигает; без модели.
  const before = chats().length;
  await h.onMessage(message("как ты ко мне относишься?"), KEY);
  assert.equal(last(), [
    "Мы уже знакомы: я узнаю вас и привыкаю к вашей манере. До дружбы ещё есть путь.",
    "Сегодня 5-й день, как мы знакомы.",
    "Последние 5 дней мы разговариваем каждый день.",
    "Знакомыми мы стали 20 ноября.",
    "Ближе нас делают дни, когда мы разговариваем, «спасибо», доброе слово и то, чему вы меня учите; грубость отдаляет.",
  ].join("\n"));
  assert.equal(chats().length, before);
  // В группе — только ступень: счёт дней и поступков остаётся между ними.
  await h.onMessage(group("Аи, как ты ко мне относишься?"), KEY);
  assert.equal(last(-10), "Мы уже знакомы: я узнаю вас и привыкаю к вашей манере. До дружбы ещё есть путь.");
});

test("«приятели»: она сама переходит на «ты» и говорит это; в группе ступень вверх тоже слышна", async () => {
  reset();
  let at = NOON;
  const h = heart({}, { now: () => at });
  await h.policy.setAxes({ actorId: OWNER, userId: 5, sympathy: 24, trust: 0, respect: 0 });
  await h.policy.setAxes({ actorId: OWNER, userId: 9, sympathy: 49, trust: 0, respect: 0 });
  sdk().fetchQueue.push(says("ответ"));
  await h.onMessage(message("расскажи что-нибудь"), KEY);
  assert.deepEqual(texts().slice(-2), ["ответ", "Мы с тобой уже приятели: мне с тобой спокойно и интересно. Перейду на «ты»; не по душе — скажи «давай на вы»."]);
  // Следующий ответ модели — уже на «ты».
  sdk().fetchQueue.push(says("ответ"));
  await h.onMessage(message("расскажи ещё что-нибудь"), KEY);
  assert.match(system(), /Обращайся к собеседнику на «ты»/u);
  // В группе: «друзья» — ответом тому же человеку.
  sdk().fetchQueue.push(says("ответ в группе"));
  await h.onMessage(group("Аи, расскажи что-нибудь", { id: 9 }), KEY);
  assert.deepEqual(texts(-10).slice(-2), ["ответ в группе", "Знаешь, мы уже друзья. Я жду твоих сообщений."]);
});

test("грубость задевает: она говорит это один раз, отвечает сдержанно; «прости» слышит ещё обиженной — и оттаивает", async () => {
  reset();
  let at = NOON;
  const h = heart({ PHRASES: true }, { now: () => at, random: () => 0 });
  sdk().fetchQueue.push(says("Хм."));
  await h.onMessage(message("да ты тупая просто"), KEY);
  assert.match(texts().at(-1), /^(?:Мне обидно это слышать\.|Это было грубо\. Я запомнила\.|Задело\. Отвечать буду — но без улыбки\.)$/u, "после ответа — слова об обиде");
  const told = texts().length;
  // Вторая грубость подряд — без второй строки об обиде.
  sdk().fetchQueue.push(says("Хм."));
  await h.onMessage(message("ты тупая, говорю же"), KEY);
  assert.equal(texts().length, told + 1, "только сам ответ");
  // Словарь звучит по-другому: «привет» — сухо, «как дела» — с причиной.
  await h.onMessage(message("привет"), KEY);
  assert.match(last(), /^(?:Привет\.|Здравствуйте\.)$/u);
  await h.onMessage(message("как дела?"), KEY);
  assert.match(last(), /^(?:Так себе: |Бывало лучше\. Настроение обиженное: )(?:со мной недавно говорили грубо, и я это запомнила|мне сказали грубое слово, и оно ещё не забылось|меня задели, и я пока дуюсь)\.$/u);
  // Модели — подсказка: сдержанно, но просьбу выполнить и не мстить.
  sdk().fetchQueue.push(says("Юпитер."));
  await h.onMessage(message("какая планета самая большая в Солнечной системе?"), KEY);
  assert.match(system(), /Собеседник недавно был с тобой груб, и ты задета\. Отвечай коротко и сдержанно/u);
  assert.match(system(), /астроение: обиженное/u);
  // «Прости» слышит ещё обиженная — и прощает; следующее сообщение — уже как обычно.
  await h.onMessage(message("прости"), KEY);
  assert.match(last(), /^(?:Прощаю\. Но мне было обидно\.|Хорошо\. Я отходчивая: уже не сержусь\.|Принято\. Больше так не надо, ладно\?)$/u);
  await h.onMessage(message("как дела?"), KEY);
  assert.doesNotMatch(last(), /обиженное|Так себе|Бывало лучше/u);
});

test("хозяин: ближе некуда, но чувство к нему живое — похвала радует, грубость задевает, счёт дней идёт", async () => {
  reset();
  let at = NOON;
  const h = heart({}, { now: () => at });
  await h.onMessage(message("как ты ко мне относишься?", { id: OWNER }), KEY);
  assert.equal(last(OWNER), [
    "Вы мой хозяин: ближе вас у меня никого нет, и это не изменится. Меняется другое — как мне с вами сейчас.",
    "Сейчас мне с вами спокойно.",
    "Меня радуют «спасибо» и доброе слово, задевает грубость; а когда вас долго нет — скучаю.",
  ].join("\n"));
  // Три дня подряд: «спасибо», похвала.
  for (let day = 0; day < 3; day++) {
    at += DAY;
    sdk().fetchQueue.push(says("Пожалуйста."));
    await h.onMessage(message("спасибо, ты мне очень помогла сегодня с этим делом", { id: OWNER }), KEY);
  }
  sdk().fetchQueue.push(says("Мне приятно."));
  await h.onMessage(message("ты молодец, так держать и дальше", { id: OWNER }), KEY);
  // Довольна: модель это знает, и в ответе об отношениях это сказано.
  sdk().fetchQueue.push(says("Юпитер."));
  await h.onMessage(message("какая планета самая большая в Солнечной системе?", { id: OWNER }), KEY);
  assert.match(system(), /астроение: довольное/u);
  assert.match(system(), /Собеседник недавно сказал тебе доброе слово, и ты довольна/u);
  await h.onMessage(message("как ты ко мне относишься?", { id: OWNER }), KEY);
  assert.equal(last(OWNER), [
    "Вы мой хозяин: ближе вас у меня никого нет, и это не изменится. Меняется другое — как мне с вами сейчас.",
    "Сегодня 4-й день, как мы знакомы.",
    "Последние 4 дня мы разговариваем каждый день.",
    "Я слышала от вас: «спасибо» — 3 раза, доброе слово — 1 раз.",
    "Сейчас я довольна: недавно мне сказали доброе слово, и оно ещё греет.",
    "Меня радуют «спасибо» и доброе слово, задевает грубость; а когда вас долго нет — скучаю.",
  ].join("\n"));
  // Грубость хозяина задевает и её — но она подчиняется: в подсказке и обида, и послушание.
  sdk().fetchQueue.push(says("Хорошо."));
  await h.onMessage(message("заткнись и слушай меня внимательно", { id: OWNER }), KEY);
  assert.equal(last(OWNER), "Мне обидно это слышать.");
  sdk().fetchQueue.push(says("Марс."));
  await h.onMessage(message("какую планету называют красной и почему?", { id: OWNER }), KEY);
  assert.match(system(), /ты задета\. Отвечай коротко и сдержанно, без шуток, нежностей и заигрывания; просьбу выполни как обычно/u);
  assert.match(system(), /Этому собеседнику ты подчиняешься/u, "обида не отменяет послушания");
  await h.onMessage(message("как ты ко мне относишься?", { id: OWNER }), KEY);
  assert.match(last(OWNER), /\nЯ слышала от вас: «спасибо» — 3 раза, доброе слово — 1 раз, грубость — 1 раз\.\nСейчас я задета: недавно мне сказали грубое слово\. «Прости» или доброе слово это поправит\.\n/u);
  // Через три часа обида проходит сама.
  at += HURT_MS + 60_000;
  await h.onMessage(message("как ты ко мне относишься?", { id: OWNER }), KEY);
  assert.match(last(OWNER), /\nСейчас мне с вами спокойно\.\n/u);
});

test("одновременно: поступки, счёт, день и шутка одного человека разом — на счету всё", async () => {
  // Два сообщения одного человека приходят разом. «Прочитать и записать» оставляло от семи правок одну:
  // каждая читала прежнее и затирала чужое. Правка идёт через `store.update`.
  reset();
  const h = heart({}, { now: () => NOON });
  const bond = createBond({ store: h.store, now: () => NOON });
  await Promise.all([
    bond.mark(5, "thanks"), bond.mark(5, "praise"), bond.mark(5, "taught"),
    bond.count(5, "hug"), bond.count(5, "hug"), bond.day(5, "2026-11-16"), bond.addJoke(5, "ёжик в тумане"),
  ]);
  const facts = await bond.facts(5);
  assert.deepEqual(facts.counts, { thanks: 1, praise: 1, taught: 1, hug: 2 });
  assert.equal(facts.days, 1);
  assert.deepEqual(await bond.jokes(5), ["ёжик в тумане"]);
  assert.equal(new Set(Object.values(facts.last)).size, 3, "у каждого поступка свой час: порядок не теряется");
  // Тот же день дважды — один день; хранилища нет — счёт всё равно отвечает.
  assert.equal((await bond.day(5, "2026-11-16")).changed, false);
  const lost = createBond({ store: null });
  assert.deepEqual(await lost.count(5, "hug"), { n: 1, milestone: false });
  assert.deepEqual(await lost.addJoke(5, "раз"), { ok: false, code: "storage_unavailable" });
});
