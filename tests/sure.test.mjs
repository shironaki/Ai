/**
 * «Ты уверена?» — перепроверка прошлого ответа другой моделью (идея 67).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, hers, reset, last, chats, says, refuses, sdk, request, OWNER, KEY } from "./fixtures/kit.mjs";

const MODELS = { AI_MODELS: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"] };
const NOON = Date.UTC(2026, 10, 18, 9);
const models = () => chats().map(item => JSON.parse(item.options.body).model);

test("«ты уверена?»: спрашивается не та модель, что отвечала; другой нет — та же, и это сказано", async () => {
  reset();
  let at = NOON;
  const h = heart(MODELS, { now: () => at });
  // Перепроверять нечего: ответа моделью ещё не было — это обычный разговор.
  sdk().fetchQueue.push(says("В чём?"));
  await h.onMessage(message("ты уверена?"), KEY);
  assert.equal(last(), "В чём?");
  assert.doesNotMatch(request().messages.at(-1).content, /усомнился/u);

  sdk().fetchQueue.push(says("Столица Австралии — Сидней."));
  await h.onMessage(message("какая столица Австралии?"), KEY);
  const first = models().at(-1);
  sdk().fetchQueue.push(says("Нет: столица Австралии — Канберра, а не Сидней. Сидней — крупнейший город."));
  await h.onMessage(message("Ты уверена?"), KEY);
  assert.equal(last(), "Нет: столица Австралии — Канберра, а не Сидней. Сидней — крупнейший город.\n\nПерепроверила другой моделью.");
  assert.notEqual(models().at(-1), first, "перепроверяет другая модель");
  const asked = request().messages.at(-1).content;
  assert.match(asked, /^Собеседник усомнился в твоём ответе и просит перепроверить\. Вопрос был: «какая столица Австралии\?»\. Проверь его по существу/u);
  // Ещё раз — снова не та, что отвечала последней: теперь первая.
  sdk().fetchQueue.push(says("Да, Канберра: это столица с 1913 года."));
  await h.onMessage(message("перепроверь"), KEY);
  assert.equal(models().at(-1), first);
  assert.match(last(), /\n\nПерепроверила другой моделью\.$/u);

  // Ответом на её сообщение — её слова уходят в проверку дословно; хозяину наедине названа модель.
  sdk().fetchQueue.push(says("Вода кипит при 90 градусах."));
  await h.onMessage(message("при какой температуре кипит вода?", { id: OWNER }), KEY);
  sdk().fetchQueue.push(says("Ошибка: на уровне моря вода кипит при 100 °C."));
  await h.onMessage(message("а ты не ошибаешься?", { id: OWNER, reply: hers("Вода кипит при 90 градусах.") }), KEY);
  assert.match(request().messages.at(-1).content, /Твой ответ: «Вода кипит при 90 градусах\.»\./u);
  assert.match(last(OWNER), /^Ошибка: на уровне моря вода кипит при 100 °C\.\n\nПерепроверила другой моделью: \S+\.$/u);

  // Четверть часа прошло — запись о прошлом ответе несвежая: без цитаты это уже разговор.
  at += 16 * 60_000;
  sdk().fetchQueue.push(says("Вы о чём?"));
  await h.onMessage(message("ты уверена?"), KEY);
  assert.equal(last(), "Вы о чём?");

  // В группе — так же; чужая запись о прошлом ответе не берётся.
  sdk().fetchQueue.push(says("Луна — спутник Марса."));
  await h.onMessage(group("Аи, чей спутник Луна?", { id: 21, name: "Вася" }), KEY);
  sdk().fetchQueue.push(says("Нет: Луна — спутник Земли."));
  await h.onMessage(group("Аи, это точно?", { id: 21, name: "Вася" }), KEY);
  assert.match(last(-10), /^Нет: Луна — спутник Земли\.\n\nПерепроверила другой моделью\.$/u);

  // Другие модели сейчас не отвечают (лимит) — перепроверяет та же, и это сказано.
  reset();
  const single = heart(MODELS, { now: () => NOON });
  sdk().fetchQueue.push(says("Дважды два — пять."));
  await single.onMessage(message("сколько будет дважды два в шутку?"), KEY);
  const answered = models().at(-1);
  const limited = () => refuses(429, { code: "rate_limit_exceeded", headers: { "retry-after": "3600" } });
  sdk().fetchQueue.push(limited(), limited(), says("Нет: дважды два — четыре."));
  await single.onMessage(message("ты точно уверена?"), KEY);
  assert.equal(models().at(-1), answered, "другая отказала — спросили ту же");
  assert.equal(last(), "Нет: дважды два — четыре.\n\nДругой модели сейчас нет: перепроверяла та же.");
});
