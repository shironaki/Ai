import test from "node:test";
import assert from "node:assert/strict";
import { parseIntent, normalize, INTENTS, ABILITY_OF } from "../tgcloud/lib/intents.js";

test("слова, а не команды: одна просьба — одно намерение", () => {
  assert.deepEqual(parseIntent("Запомни, что я люблю кофе без сахара"), {
    intent: "remember", confidence: "sure", arg: "что я люблю кофе без сахара",
  });
  assert.equal(parseIntent("запомни: день рождения 3 мая").arg, "день рождения 3 мая");
  assert.equal(parseIntent("что ты обо мне помнишь").intent, "memories");
  assert.equal(parseIntent("Покажи профиль").intent, "profile");
  assert.equal(parseIntent("мой профиль").intent, "profile");
  assert.equal(parseIntent("как ты ко мне относишься?").intent, "relationship");
  assert.equal(parseIntent("давай сыграем").intent, "play");
  assert.equal(parseIntent("что нового").intent, "news");
});

test("мягкие формулировки — тот же смысл", () => {
  assert.equal(normalize("  Ёлка, «привет»!  "), "елка, привет");
  assert.equal(parseIntent("Слушай, запомни пожалуйста это").confidence, "maybe", "обращение и вежливость не мешают");
  assert.equal(parseIntent("слушай, запомни, что я люблю кофе").arg, "что я люблю кофе");
  assert.equal(parseIntent("не реагируй на каждое сообщение").intent, "no_reactions");
  assert.equal(parseIntent("без флирта").intent, "no_flirt");
  assert.equal(parseIntent("не пиши мне ночью").intent, "no_night");
  assert.equal(parseIntent("почему ты молчала").intent, "whyquiet");
  // 0.32.1: тот же вопрос без «ты» и другими словами — ответом будет настоящая причина.
  for (const said of ["почему молчишь", "Чего молчишь?", "что молчишь", "чего ты молчишь", "ты меня игнорируешь?", "игноришь?", "почему ты меня игнорируешь", "ты игнорируешь меня"]) {
    assert.equal(parseIntent(said)?.intent, "whyquiet", said);
  }
  // Та же форма, но это разговор, а не вопрос о её молчании.
  for (const said of ["что молчишь об этом", "почему молчишь про вчерашнее", "игнорируешь правила", "ты игнорируешь мой вопрос", "молчишь", "он меня игнорирует"]) {
    assert.notEqual(parseIntent(said)?.intent, "whyquiet", said);
  }
});

test("наполовину понятое — один вопрос, а не догадка", () => {
  const partial = parseIntent("запомни");
  assert.equal(partial.confidence, "maybe");
  assert.equal(partial.intent, "remember");
  assert.match(partial.question, /что запомнить/i);

  const forget = parseIntent("забудь");
  assert.equal(forget.confidence, "maybe");
  assert.match(forget.question, /всё|одну запись/u);
});

test("обычная речь остаётся разговором", () => {
  for (const line of ["привет", "как дела", "расскажи сказку", "запомнил твои слова", "профильтруй воду"]) {
    assert.equal(parseIntent(line), null, line);
  }
  assert.equal(parseIntent(""), null);
  assert.equal(parseIntent(null), null);
});

test("наказания, роли и деньги сердце не исполняет", () => {
  for (const line of ["забань его", "замуть на час", "кикни", "выдай роль админа", "переведи деньги", "купи вип"]) {
    const parsed = parseIntent(line);
    assert.equal(parsed.intent, "not_mine", line);
    assert.equal(parsed.confidence, "sure");
  }
});

test("список закрыт: каждое намерение либо действие, либо способность сестры", async () => {
  assert.equal(new Set(INTENTS).size, INTENTS.length);
  // Обработчики читаются из самого сердца: список в тесте, который правят
  // руками, расходился бы с кодом при каждом новом намерении.
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../tgcloud/lib/heart.js", import.meta.url), "utf8");
  const handled = new Set([...Object.keys(ABILITY_OF), ...[...source.matchAll(/case "([a-z_]+)":/gu)].map(match => match[1])]);
  for (const tool of Object.values(ABILITY_OF)) assert.equal(typeof tool, "string");
  for (const intent of INTENTS) assert.ok(handled.has(intent), `нет обработчика: ${intent}`);
  // Что из этого показывается человеку — в SKILLS.txt; сверка с кодом — tests/skills.test.mjs.
});
