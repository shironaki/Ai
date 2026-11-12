import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { api as sdkApi, db as sdkDb, fetch as sdkFetch } from "./fixtures/sdk-stub.mjs";

register(new URL("./fixtures/sdk-loader.mjs", import.meta.url));

const { createHeart, pauseFor, rightsFrames } = await import("../tgcloud/lib/heart.js");
const { currentSympathy } = await import("../tgcloud/lib/dialogue-policy.js");
const { createBridge } = await import("../tgcloud/lib/bridge.js");
const { encodeEnvelope, decodeEnvelope, matchPhrase, createAbilities } = await import("../tgcloud/lib/abilities.js");

const SECRET = "0123456789abcdef0123456789abcdef";
const CONFIG = {
  OWNER_TG_ID: 7,
  TIME_ZONE: "Europe/Moscow",
  AI_MODEL: "openai/gpt-oss-20b",
  AI_MIN_INTERVAL_MS: 0,
  ABILITIES_CHANNEL_ID: "",
  ABILITIES_SECRET: "",
  NAME: "Аи",
  SISTER_NAME: "Юи",
  SISTER_BOT_USERNAME: "",
  // Вести владельцу («я обновилась», сводка дня) проверяются отдельно: здесь
  // они выключены, чтобы каждый тест считал только свои сообщения.
  SELF_REPORTS: false,
};

function sdk() { return globalThis.__sdkStub; }
function reset() {
  sdk().sent.length = 0;
  sdk().fetches.length = 0;
  sdk().fetchQueue.length = 0;
  sdk().kv.clear();
  sdk().memory.clear();
  sdk().calls.length = 0;
  for (const name of Object.keys(sdk().failing)) delete sdk().failing[name];
  delete sdk().me;
}

const KEY = { env: { AI_PROVIDER_KEY: "test-provider-key" } };
const message = (text, { id = 5, chat = 5, type = "private" } = {}) => ({
  message_id: 1,
  chat: { id: chat, type },
  from: { id, first_name: "Тест", is_bot: false },
  text,
});

function heart(overrides = {}, options = {}) {
  return createHeart({ db: sdkDb, api: sdkApi, fetchImpl: sdkFetch, config: { ...CONFIG, ...overrides }, ...options });
}

test("the heart answers a private message as a conversation, with no commands at all", async () => {
  reset();
  const result = await heart().onMessage(message("привет"), KEY);
  assert.equal(result.ok, true);
  assert.equal(sdk().sent.length, 1);
  assert.equal(sdk().sent[0].text, "ответ из стаба");
  // The prompt went to the provider with the character attached.
  const body = JSON.parse(sdk().fetches[0].options.body);
  assert.equal(body.model, "openai/gpt-oss-20b");
  assert.match(body.messages[0].content, /Аи/);
});

test("a group is not interrupted: only an addressed message is answered", async () => {
  reset();
  const h = heart();
  assert.equal((await h.onMessage(message("просто болтаю", { chat: -10, type: "supergroup" }))).ignored, true);
  assert.equal(sdk().sent.length, 0);
  await h.onMessage(message("Аи, привет", { chat: -10, type: "supergroup" }), KEY);
  assert.equal(sdk().sent.length, 1);
  // The prefix is a way to speak to her, not part of the sentence.
  const body = JSON.parse(sdk().fetches.at(-1).options.body);
  assert.equal(body.messages.at(-1).content, "привет");
});

test("the relationship is real: it shapes the reply and is spoken in words, not numbers", async () => {
  reset();
  const h = heart();
  // A fresh acquaintance: the answer is honest about not knowing yet.
  await h.onMessage(message("/ai relationship"), KEY);
  assert.match(sdk().sent[0].text, /присматриваемся|отношени/i);
  assert.doesNotMatch(sdk().sent[0].text, /\d/, "no numbers are shown to a person");

  // The owner of the relationship can set it; the reply follows.
  await h.policy.setAxes({ actorId: 7, userId: 5, sympathy: 80, trust: 70, respect: 60 });
  sdk().sent.length = 0; sdk().fetches.length = 0;
  await h.onMessage(message("как ты ко мне относишься?"), KEY);
  assert.match(sdk().sent[0].text, /близост|нравишься/i);
  assert.match(sdk().sent[0].text, /доверяю/i);
  assert.equal(sdk().fetches.length, 0, "the relationship is data, not a model guess");
});

test("talking to her moves the relationship forward, and the character sees it", async () => {
  reset();
  const h = heart();
  const before = (await h.policy.state(5)).score;
  await h.onMessage(message("привет"), KEY);
  const after = (await h.policy.state(5)).score;
  assert.ok(after >= before, "a delivered conversation is recorded");

  // The character profile receives the relationship, so tone can change at all.
  sdk().sent.length = 0; sdk().fetches.length = 0;
  await h.policy.setAxes({ actorId: 7, userId: 5, sympathy: 90, trust: 90, respect: 90 });
  await h.onMessage(message("привет"), KEY);
  const body = JSON.parse(sdk().fetches[0].options.body);
  assert.match(body.messages[0].content, /Отношение очень хорошее|доверительн/i);
});

test("a cold relationship is allowed to stay silent, and that is not a fault", async () => {
  reset();
  // random() печатает 0 — значит «да, промолчать», и тест не гадает на монетке.
  const h = heart({}, { random: () => 0 });
  await h.policy.setAxes({ actorId: 7, userId: 5, sympathy: -50, trust: -50, respect: -50 });
  let silent = 0;
  for (let i = 0; i < 12; i++) {
    const result = await h.onMessage(message("ну что"), KEY);
    if (result.reason === "deliberate_silence") silent++;
  }
  assert.ok(silent > 0, "discretion exists at all");
  assert.equal(sdk().fetches.length + silent, 12, "every message was either answered or deliberately ignored");
  // The owner is never ignored by their own bot.
  reset();
  await h.policy.setAxes({ actorId: 7, userId: 7, sympathy: -100, trust: -100, respect: -100 }).catch(() => {});
  const ownerReply = await h.onMessage(message("привет", { id: 7 }), KEY);
  assert.notEqual(ownerReply.reason, "deliberate_silence");
});

test("/help lists only what the heart really does, and never asks the model", async () => {
  reset();
  const h = heart();
  await h.onMessage(message("/help"));
  const text = sdk().sent[0].text;
  assert.equal(sdk().fetches.length, 0, "no provider call for a command list");
  assert.match(text, /Что я умею/);
  // Команд в справке нет вовсе: она понимает слова. Тем более нет тех двух,
  // что модель однажды выдумала на живом боте.
  assert.doesNotMatch(text, /(?:^|\s)\/[a-z]/iu, "справка не учит командам");
  assert.match(text, /запомни/);
  // Те же слова без команды — тот же ответ и тоже без модели.
  await h.onMessage(message("что ты умеешь?"), KEY);
  assert.equal(sdk().sent[1].text, text);
  assert.equal(sdk().fetches.length, 0);
  // Хозяину справка называет его слова: «статус» и уроки.
  reset();
  await h.onMessage(message("помощь", { id: 7, chat: 7 }), KEY);
  assert.match(sdk().sent[0].text, /статус/);
  assert.match(sdk().sent[0].text, /покажи уроки/);
});

test("an unknown slash command is named as unknown, without a provider call", async () => {
  reset();
  const h = heart();
  await h.onMessage(message("/command2"));
  assert.equal(sdk().fetches.length, 0);
  assert.match(sdk().sent[0].text, /такой команды у меня нет/);
  // Вместо другой команды — слова, которыми можно спросить.
  assert.match(sdk().sent[0].text, /что ты умеешь/);
  assert.doesNotMatch(sdk().sent[0].text, /\/help/);
});

test("in a group an unknown slash command is not answered at all", async () => {
  reset();
  const h = heart();
  const result = await h.onMessage(message("/otherbot", { chat: -10, type: "supergroup" }));
  assert.equal(result.ignored, true);
  assert.equal(sdk().sent.length, 0);
});

test("a bare word names the ability, so the model never invents a profile", async () => {
  reset();
  const h = heart();
  const result = await h.onMessage(message("Профиль"), KEY);
  assert.equal(result.ok, true);
  assert.equal(sdk().fetches.length, 0, "no invented profile from the model");
  assert.equal(sdk().sent.length, 1);
  assert.match(sdk().sent[0].text, /Юи|профил/i);
});

test("a refusal from the provider is said out loud, and the owner is told too", async () => {
  reset();
  sdk().fetchQueue.push(Error("network is down"));
  const result = await heart().onMessage(message("привет"), KEY);
  assert.equal(result.ok, true);
  // Two people, two messages: the person gets an apology in the chat, the owner
  // gets a fault in the private chat — without running /aidiag first.
  assert.equal(sdk().sent.length, 2);
  const notice = sdk().sent.find(item => String(item.chat_id) === "7");
  const answer = sdk().sent.find(item => String(item.chat_id) === "5");
  assert.ok(notice, "the owner is told");
  assert.match(notice.text, /Хозяин, у меня это сломалось/);
  assert.match(notice.text, /provider:provider_network_error/);
  assert.match(answer.text, /связаться|позже/i);
});

test("the same fault is reported once, not on every message", async () => {
  reset();
  const h = heart();
  sdk().fetchQueue.push(Error("down"));
  await h.onMessage(message("раз"), KEY);
  sdk().fetchQueue.push(Error("down"));
  await h.onMessage(message("два"), KEY);
  const notices = sdk().sent.filter(item => String(item.chat_id) === "7");
  assert.equal(notices.length, 1, "one fault, one report");
});

test("a report Telegram refused waits for the next update instead of disappearing", async () => {
  reset();
  let blocked = true;
  let clock = 1_800_000_000_000;
  const api = {
    async sendMessage(params) {
      if (blocked && String(params.chat_id) === "7") throw Error("owner unreachable");
      sdk().sent.push(params);
      return { message_id: sdk().sent.length };
    },
  };
  const h = createHeart({ db: sdkDb, api, fetchImpl: sdkFetch, config: CONFIG, now: () => clock });
  sdk().fetchQueue.push(Error("down"));
  await h.onMessage(message("привет"), KEY);
  assert.equal(sdk().sent.filter(item => String(item.chat_id) === "7").length, 0);
  assert.equal(await h.notices.pending(), 1, "the report is kept, not dropped");

  blocked = false;
  clock += 61_000;
  await h.onMessage(message("ещё"), KEY);
  const delivered = sdk().sent.filter(item => String(item.chat_id) === "7");
  assert.equal(delivered.length, 1);
  assert.match(delivered[0].text, /Хозяин/);
  assert.equal(await h.notices.pending(), 0);
});

test("without an owner nobody is guessed, and the report is visible in /aidiag", async () => {
  reset();
  sdk().fetchQueue.push(Error("down"));
  const h = heart({ OWNER_TG_ID: 0 });
  await h.onMessage(message("привет", { id: 5 }), KEY);
  assert.equal(sdk().sent.length, 1, "only the answer; no invented recipient");
  assert.equal((await h.status({ chatId: 5, actorId: 5 })).incidents.pending, 1);

  reset();
  const owner = heart();
  sdk().fetchQueue.push(Error("down"));
  await owner.onMessage(message("привет"), KEY);
  await owner.onMessage(message("/aidiag", { id: 7 }), {});
  const diag = sdk().sent.at(-1).text;
  assert.match(diag, /Сбои:/);
  assert.match(diag, /провайдер|Провайдер/);
});

test("a test run proves the route without sending a single notice", async () => {
  reset();
  sdk().fetchQueue.push(Error("down"));
  const result = await heart().onMessage(message("привет"), { ...KEY, testRun: true });
  assert.equal(result.side_effects, "none");
  assert.equal(sdk().sent.length, 0, "a rehearsal must not page the owner");
});

test("storage that never answered is a fault named once, not a silent amnesia", async () => {
  reset();
  const h = createHeart({ db: null, api: sdkApi, fetchImpl: sdkFetch, config: CONFIG });
  await h.onMessage(message("привет"), KEY);
  await h.onMessage(message("ещё"), KEY);
  const notices = sdk().sent.filter(item => String(item.chat_id) === "7");
  assert.equal(notices.length, 1);
  assert.match(notices[0].text, /storage:unavailable/);
  assert.match(notices[0].text, /памят/i);
});

test("/start introduces her and mentions the sibling only when it exists", async () => {
  reset();
  await heart().onMessage(message("/start"));
  assert.match(sdk().sent[0].text, /Аи/);
  assert.doesNotMatch(sdk().sent[0].text, /вторая половина/);

  reset();
  await heart({ ABILITIES_CHANNEL_ID: "-100500", ABILITIES_SECRET: SECRET }).onMessage(message("/start"));
  assert.match(sdk().sent[0].text, /Юи/);
});

test("diagnostics are for the owner and name what is really connected", async () => {
  reset();
  const h = heart();
  await h.onMessage(message("/aidiag", { id: 5 }));
  assert.match(sdk().sent[0].text, /внутренняя проверка/);

  reset();
  await h.onMessage(message("/aidiag", { id: 7 }), {});
  assert.match(sdk().sent[0].text, /Проверка сердца/);
  assert.match(sdk().sent[0].text, /мост закрыт/);
});

test("memory survives between messages through the same store", async () => {
  reset();
  const h = heart();
  await h.onMessage(message("меня зовут Ли"), KEY);
  await h.onMessage(message("как меня зовут?"), KEY);
  const body = JSON.parse(sdk().fetches.at(-1).options.body);
  assert.ok(body.messages.some(item => item.role === "assistant"), "the first answer is in history");
});

test("просьба словами записывается, показывается и забывается — без команд", async () => {
  reset();
  const h = heart();

  const saved = await h.onMessage(message("Запомни, что я люблю кофе без сахара"));
  assert.equal(saved.action, "intent");
  assert.equal(sdk().fetches.length, 0, "память пишет код, а не модель");
  assert.match(sdk().sent.at(-1).text, /Запомнила/);

  await h.onMessage(message("что ты обо мне помнишь"));
  assert.match(sdk().sent.at(-1).text, /кофе без сахара/);

  // Повтор не размножает запись: человек вправе сказать одно и то же дважды.
  await h.onMessage(message("запомни, что я люблю кофе без сахара"));
  assert.match(sdk().sent.at(-1).text, /и так помню/);
  await h.onMessage(message("что ты обо мне помнишь"));
  assert.equal(sdk().sent.at(-1).text.match(/кофе без сахара/g).length, 1);

  await h.onMessage(message("забудь 1"));
  assert.match(sdk().sent.at(-1).text, /Забыла/);
  await h.onMessage(message("что ты обо мне помнишь"));
  assert.match(sdk().sent.at(-1).text, /ничего не записано/);
});

test("понятое наполовину — один вопрос вместо догадки и вместо модели", async () => {
  reset();
  const h = heart();
  const result = await h.onMessage(message("запомни"));
  assert.equal(result.action, "intent");
  assert.match(sdk().sent.at(-1).text, /Что запомнить/);
  assert.equal(sdk().fetches.length, 0);

  const forget = await h.onMessage(message("забудь"));
  assert.match(sdk().sent.at(-1).text, /одну запись или всё/);
});

test("наказания и деньги — не её работа: отказ вместо исполнения", async () => {
  reset();
  const h = heart();
  const result = await h.onMessage(message("забань его"));
  assert.equal(result.action, "intent");
  const text = sdk().sent.at(-1).text;
  assert.match(text, /не моё/);
  assert.match(text, /Юи/);
  assert.doesNotMatch(text, /забанила|забанен/);
});

test("репетиция не пишет память", async () => {
  reset();
  const h = heart();
  await h.onMessage(message("запомни, что я люблю кофе"), { testRun: true });
  assert.equal(sdk().kv.size, 0, "ничего не сохранено");
  await h.onMessage(message("что ты обо мне помнишь"));
  assert.match(sdk().sent.at(-1).text, /ничего не записано/);
});

test("хранилище без таблиц говорит об этом прямо, а не «попробуйте позже»", async () => {
  reset();
  // Ровно то, что случилось в живом боте: объект базы есть, схемы нет. Проба
  // обязана это увидеть, иначе /status снова соврёт «доступно».
  const broken = { async get() { throw Error("no such table: kv_state"); }, async run() { throw Error("no such table: kv_state"); } };
  const blind = createHeart({ db: broken, api: sdkApi, fetchImpl: sdkFetch, config: { ...CONFIG, OWNER_TG_ID: 7 } });
  const state = await blind.store.probe();
  assert.equal(state.read, false);
  assert.equal(state.write, false);

  await blind.onMessage(message("/status", { id: 7, chat: 7 }));
  assert.match(sdk().sent.at(-1).text, /таблиц нет|схема базы не применена/);
  assert.doesNotMatch(sdk().sent.at(-1).text, /память: хранилище доступно/iu);

  // И запись факта не притворяется успешной.
  await blind.onMessage(message("запомни, что я люблю кофе", { id: 7, chat: 7 }));
  assert.match(sdk().sent.at(-1).text, /не приняло запись|схема базы/);
});

test("канал моста говорит словами, а подпись всё равно сходится", async () => {
  const { encodeEnvelope, decodeEnvelope } = await import("../tgcloud/lib/abilities.js");
  const bridge = createBridge({ secret: SECRET, capabilities: { call: async () => ({}) } });
  const sealed = await bridge.seal({ tool: "__context", args: {}, actor: "5", chat: "5" });
  const line = encodeEnvelope(sealed.envelope, "🤍 Аи → Юи · что известно о человеке · чат 5");
  assert.match(line.split("\n")[0], /Аи → Юи · что известно о человеке/, "первая строка читается человеком");
  const parsed = decodeEnvelope(line);
  assert.equal(parsed.id, sealed.envelope.id);
  assert.equal((await bridge.verify(parsed)).ok, true, "пояснение не ломает подпись");
  // Отправитель без пояснения разбирается как раньше.
  assert.equal(decodeEnvelope(encodeEnvelope(sealed.envelope)).id, sealed.envelope.id);
});

test("phrases map to abilities, and a plain sentence never does", async () => {
  assert.equal(matchPhrase("покажи профиль"), "profile");
  assert.equal(matchPhrase("Аи, покажи профиль"), null, "the prefix is stripped before matching");
  assert.equal(matchPhrase("расскажи сказку"), null);
  assert.equal(matchPhrase(""), null);
});

test("the sibling is asked over a signed channel and its signed answer is used", async () => {
  reset();
  const calls = [];
  const abilities = createAbilitiesWithEcho();
  const catalogue = await abilities.catalog({ actor: 5, chat: 5 });
  assert.deepEqual(catalogue.map(tool => tool.name), ["profile"]);

  const result = await abilities.call("profile", { actor: 5, chat: 5, args: { args: "" } });
  assert.equal(result.ok, true);
  assert.equal(result.text, "Профиль: Ли");
  assert.equal(calls.length, 2, "one catalogue request, then one tool call");
  // Nothing secret travels: the channel sees identifiers and arguments only.
  for (const line of calls) assert.ok(!line.includes(SECRET));

  /** A stand-in for the abilities bot: verifies, then answers signed. */
  function createAbilitiesWithEcho() {
    let bus = null;
    // The sibling has its own bridge object: the same secret, the other side.
    const sibling = createBridge({ secret: SECRET, capabilities: { call: async () => ({}) }, now: () => 1_000_000 });
    bus = createAbilities({
      secret: SECRET,
      channelId: "-100500",
      now: () => 1_000_000,
      async send(line) {
        calls.push(line);
        const request = decodeEnvelope(line);
        const data = request.tool === "__catalog" ? [{ name: "profile", title: "/profile", description: "Профиль", role: "Игрок" }] : undefined;
        const answer = await sibling.sealResult({
          id: request.id,
          tool: request.tool,
          result: { ok: true, code: "ok", text: request.tool === "__catalog" ? "" : "Профиль: Ли", data },
        });
        return bus.onPost(encodeEnvelope(answer.envelope));
      },
    });
    return bus;
  }
});

test("with the bridge closed an ability phrase is refused honestly, not answered by the model", async () => {
  reset();
  const h = heart();
  assert.equal(h.abilities.open(), false);
  const result = await h.onMessage(message("покажи профиль"), KEY);
  assert.equal(result.ok, true);
  assert.equal(sdk().sent.length, 1);
  // No invented action, no invented command, and no provider call: a refusal is
  // cheap, immediate and the same every time.
  assert.equal(sdk().fetches.length, 0);
  assert.match(sdk().sent[0].text, /профил/i);
  assert.match(sdk().sent[0].text, /Юи/);
  assert.deepEqual(await h.abilities.catalog({ actor: 5, chat: 5 }), []);
});

test("a missing ability offers the invitation, and in a group it names who can add her", async () => {
  const { missingAbilityText } = await import("../tgcloud/lib/sibling.js");
  const privateText = missingAbilityText({ tool: "profile", reason: "not_in_chat", chatType: "private", username: "YuiBot" });
  assert.match(privateText, /https:\/\/t\.me\/YuiBot\?startgroup=true/);
  const groupText = missingAbilityText({ tool: "play", reason: "not_in_chat", chatType: "supergroup", username: "YuiBot" });
  assert.match(groupText, /Администратор/);
  // Without a username there is no invented link, only the truth.
  const unknown = missingAbilityText({ tool: "render", reason: "bridge_closed", username: "" });
  assert.doesNotMatch(unknown, /t\.me/);
  assert.match(unknown, /Юи/);
});

test("a switched-off module is reported as switched off, not as a failure", async () => {
  const { missingAbilityText } = await import("../tgcloud/lib/sibling.js");
  const text = missingAbilityText({ tool: "profile", reason: "module_disabled", chatType: "group" });
  assert.match(text, /выключено/);
  // Чужую команду сердце не называет: оно не знает списка команд сестры.
  assert.doesNotMatch(text, /\/[a-z]/iu);
  assert.match(text, /владелец чата/);
});

test("an event from the sister is answered once, quietly, and only for known kinds", async () => {
  reset();
  const { createBridge } = await import("../tgcloud/lib/bridge.js");
  // One clock for both sides: a sealed envelope is only valid inside its window,
  // and the test must be able to move time deliberately.
  let clock = 1_800_000_000_000;
  const h = heart({ ABILITIES_CHANNEL_ID: "-100500", ABILITIES_SECRET: SECRET }, { now: () => clock });
  const sibling = createBridge({ secret: SECRET, capabilities: { call: async () => ({}) }, now: () => clock });

  const post = async ({ kind, chatId = -100500, name = "Ли", detail = "" }) => {
    const sealed = await sibling.seal({ tool: "__event", args: { kind, chatId, name, detail }, actor: "77", chat: String(chatId) });
    const line = encodeEnvelope(sealed.envelope);
    const handled = await h.events.onPost(line);
    return { handled, line };
  };

  const first = await post({ kind: "member_joined" });
  assert.equal(first.handled, true);
  assert.equal(sdk().sent.length, 1);
  assert.match(sdk().sent[0].text, /Ли/);

  // The identical post again is the same event: no second greeting.
  assert.equal(await h.events.onPost(first.line), true);
  assert.equal(sdk().sent.length, 1, "a replayed id speaks once");

  // A new id, same kind, same chat, inside the cooldown: still silent.
  clock += 60_000;
  await post({ kind: "member_joined", name: "Май" });
  assert.equal(sdk().sent.length, 1, "cooldown holds");

  // Another kind is a different key, so it may speak immediately.
  await post({ kind: "game_finished", name: "Ли", detail: "Победа." });
  assert.equal(sdk().sent.length, 2);

  // After the cooldown the same kind may speak again.
  clock += 11 * 60_000;
  await post({ kind: "member_joined", name: "Май" });
  assert.equal(sdk().sent.length, 3);

  // An unknown kind is never spoken: a new event type in the other repository
  // cannot start a monologue here.
  await post({ kind: "something_new", name: "Ли" });
  assert.equal(sdk().sent.length, 3);
});

test("an unsigned or foreign event is dropped without speaking", async () => {
  reset();
  const h = heart({ ABILITIES_CHANNEL_ID: "-100500", ABILITIES_SECRET: SECRET });
  const forged = encodeEnvelope({ v: 1, id: "x", ts: Date.now(), ttl: 60_000, tool: "__event", args: { kind: "member_joined", chatId: -100500, name: "Ли" }, sig: "00".repeat(32) });
  assert.equal(await h.events.onPost(forged), false);
  assert.equal(await h.events.onPost("обычный пост в канале"), false);
  assert.equal(sdk().sent.length, 0);
});

test("the running build says its own name, so «я запушил» can be checked", async () => {
  reset();
  const { BUILD } = await import("../tgcloud/lib/heart.js");
  const h = heart();
  const state = await h.status({ chatId: 7, actorId: 7 });
  assert.equal(state.build, BUILD);
  assert.equal(state.intents >= 10, true);

  // Владелец видит сборку в /status — это единственный способ узнать из
  // Telegram, какой код реально запущен.
  await h.onMessage(message("/status", { id: 7, chat: 7 }));
  assert.match(sdk().sent.at(-1).text, new RegExp(`Сердце: ${BUILD.replace(/\./g, "\\.")}`));
});

test("status tells the truth about what is connected", async () => {
  reset();
  const alone = await heart().status({ chatId: 5, actorId: 5 });
  assert.equal(alone.sister.here, false);
  assert.equal(alone.sister.reason, "bridge_closed");
  assert.equal(alone.events.kinds.includes("member_joined"), true);

  const connected = await heart({ ABILITIES_CHANNEL_ID: "-100500", ABILITIES_SECRET: SECRET }).status({ chatId: 5, actorId: 5 });
  assert.equal(connected.sister.reason, "not_in_chat", "connected but her catalogue is empty here");
});

test("a broken sibling is a named refusal, never a hang", async () => {
  const abilities = createAbilities({
    secret: SECRET,
    channelId: "-100500",
    now: () => 1_000_000,
    async send() { return { message_id: 1 }; },
  });
  const result = await abilities.call("profile", { actor: 5, chat: 5, timeout: 50 });
  assert.equal(result.ok, false);
  assert.equal(result.code, "bridge_timeout");
});

test("the deployed entrypoint routes through the heart and never throws", async () => {
  const { default: handle } = await import("../tgcloud/handlers/message.js");
  reset();
  const result = await handle(message("привет"), { ...KEY, testRun: true });
  assert.equal(result.ok, true);
  assert.equal(result.side_effects, "none");
  assert.equal(sdk().sent.length, 0, "a test run does not send");

  const broken = await handle(null, {});
  assert.equal(broken.ignored, true);
});

test("VIP answers faster only when the status is confirmed, not because a word says so", async () => {
  reset();
  const limits = { AI_MIN_INTERVAL_MS: 1500, AI_VIP_INTERVAL_MS: 700 };
  // Мост закрыт: фактов нет, значит и ускорения нет.
  assert.equal(pauseFor({ facts: null, config: limits }), 1500);
  // Сестра подтвердила VIP — пауза вдвое короче.
  assert.equal(pauseFor({ facts: { vip: true }, config: limits }), 700);
  // Слово в роли или в переписке статусом не является.
  assert.equal(pauseFor({ facts: { vip: false, role: "VIP" }, config: limits }), 1500);

  // И сердце действительно ждёт — но не отказывает: второе сообщение в ту же
  // секунду раньше получало «дай секунду подумать» и пропадало.
  const h = heart({ AI_MIN_INTERVAL_MS: 150 }, { now: () => 1_000_000 });
  await h.onMessage(message("привет"), KEY);
  const started = Date.now();
  await h.onMessage(message("и ещё"), KEY);
  assert.ok(Date.now() - started >= 120, "пауза выдержана");
  assert.equal(sdk().sent.at(-1).text, "ответ из стаба", "и ответ всё равно пришёл");
  assert.equal(sdk().fetches.length, 2);
});

test("«Вы и Аи» is one card in words, and two settings are said out loud", async () => {
  reset();
  const h = heart();
  await h.onMessage(message("/ai"), KEY);
  const card = sdk().sent[0].text;
  assert.match(card, /Вы и Аи/);
  assert.match(card, /только начали разговаривать/);
  assert.doesNotMatch(card, /\d/, "никаких шкал и чисел на карточке");

  // «/ai привет» — разговор, а не справка: вопрос человека важнее карточки.
  sdk().sent.length = 0; sdk().fetches.length = 0;
  await h.onMessage(message("/ai привет, как дела"), KEY);
  assert.equal(sdk().fetches.length, 1);
  assert.doesNotMatch(sdk().sent[0].text, /Вы и Аи/);

  // Имя — просьба, а не команда: она запоминается и попадает в характер.
  await h.onMessage(message("зови меня Алекс"), KEY);
  assert.match(sdk().sent.at(-1).text, /Алекс/);
  sdk().sent.length = 0; sdk().fetches.length = 0;
  await h.onMessage(message("привет"), KEY);
  const body = JSON.parse(sdk().fetches[0].options.body);
  assert.match(body.messages[0].content, /звать его «Алекс»/);

  // Длина ответа — тоже пожелание словами, а не меню.
  await h.onMessage(message("говори короче"), KEY);
  assert.match(sdk().sent.at(-1).text, /коротко/);
  assert.equal((await h.personal.settings(5)).length, "кратко");

  sdk().sent.length = 0;
  await h.onMessage(message("/ai профиль"), KEY);
  // С незнакомым человеком она на «вы»: «ты» приходит с близостью.
  assert.match(sdk().sent[0].text, /Для меня вы — Алекс/);
  assert.match(sdk().sent[0].text, /Отвечаю коротко/);
});

test("the founder is recognised without a bridge, and a role from the sister is a fact, not a guess", async () => {
  reset();
  // Хозяин — это не «первый, кто написал»: ID из конфига узнаётся сразу.
  const h = heart();
  await h.onMessage(message("привет", { id: 7 }), KEY);
  let body = JSON.parse(sdk().fetches.at(-1).options.body);
  assert.match(body.messages[0].content, /создатель и хозяин|хозяин/);

  // Чужой не получает слова о хозяине.
  await h.onMessage(message("привет", { id: 9 }), KEY);
  body = JSON.parse(sdk().fetches.at(-1).options.body);
  assert.doesNotMatch(body.messages[0].content, /создатель и хозяин/);

  // Роль и уровень приходят от сестры, а не угадываются по словам в чате.
  const admin = rightsFrames({ role: "Администратор", level: 30 }).join("\n");
  assert.match(admin, /администратор этого чата/i);
  assert.match(admin, /не обещай результат/);
  // Модератор — рабочие замечания, но не власть администратора.
  const moderator = rightsFrames({ role: "Модератор", level: 20 }).join("\n");
  assert.match(moderator, /модератор/i);
  assert.doesNotMatch(moderator, /администратор этого чата/i);
  // Обычный участник не получает ни одной рамки: власти нет — слов о власти тоже.
  assert.deepEqual(rightsFrames({ role: "Игрок", level: 10 }), []);
  // Нет ответа сестры — нет фактов. Никакого «наверное, админ».
  assert.deepEqual(rightsFrames(null), []);
});

test("warmth cools slowly and only downwards; frost does not thaw by itself", () => {
  const DAY = 86_400_000;
  // Семь суток — grace: ничего не тает.
  assert.equal(currentSympathy({ sympathy: 40, affinityAt: 0 }, 6 * DAY), 40);
  // Дальше — пункт в сутки, до нуля, но не в минус.
  assert.equal(currentSympathy({ sympathy: 40, affinityAt: 0 }, 10 * DAY), 37);
  assert.equal(currentSympathy({ sympathy: 2, affinityAt: 0 }, 30 * DAY), 0);
  // Холод сам не оттаивает, а старая запись без даты не пересчитывается задним числом.
  assert.equal(currentSympathy({ sympathy: -40, affinityAt: 0 }, 90 * DAY), -40);
  assert.equal(currentSympathy({ sympathy: 40 }, 90 * DAY), 40);
});

test("a rehearsal never posts into the bridge channel, even when the bridge is open", async () => {
  // The regression this exists for: with a channel and a secret configured, a
  // test run asked the sister twice (interval and profile), waited twelve
  // seconds for each answer, and marked the result "side effects: none" while
  // two signed lines had already landed in the channel.
  reset();
  const open = heart({ ABILITIES_CHANNEL_ID: "-100500", ABILITIES_SECRET: SECRET });
  const conversation = await open.onMessage(message("привет"), { ...KEY, testRun: true });
  assert.equal(conversation.side_effects, "none");
  assert.equal(sdk().sent.length, 0, "a rehearsal sends nothing");
  assert.equal(sdk().fetches.length, 0, "a rehearsal does not call the provider");

  // The same for an ability phrase: nothing is asked of the sister.
  reset();
  const ability = await open.onMessage(message("покажи профиль"), { ...KEY, testRun: true });
  assert.equal(ability.action, "ability");
  assert.equal(sdk().sent.length, 0, "a rehearsal does not ask the sister");
  assert.equal(sdk().fetches.length, 0);

  // And a diagnostic does not probe the provider on a rehearsal.
  reset();
  const diag = await open.onMessage(message("/aidiag", { id: 7, chat: 7 }), { ...KEY, testRun: true });
  assert.equal(diag.side_effects, "none");
  assert.equal(sdk().fetches.length, 0);
  assert.match(diag.text, /живая проверка не выполнялась/);
});

test("«покажи мне профиль» — та же просьба, что «покажи профиль»", () => {
  // Лишнее слово не должно превращать факт в разговор с моделью: именно так
  // Аи однажды нарисовала профиль из воздуха — «Создатель, полный доступ».
  assert.equal(matchPhrase("покажи профиль"), "profile");
  assert.equal(matchPhrase("Покажи мне профиль"), "profile");
  assert.equal(matchPhrase("мой профиль"), "profile");
  assert.equal(matchPhrase("моя карточка"), null, "карточка без просьбы — разговор");
  assert.equal(matchPhrase("покажи, пожалуйста, профиль"), "profile");
  assert.equal(matchPhrase("расскажи сказку"), null);
});

test("молчание сестры — это «не ответила», а не «её нет в этом чате»", async () => {
  // Мост открыт, канал есть, а ответа нет: раньше каталог возвращал пустой
  // список, и Аи уверенно говорила «профиля здесь нет». Человек шёл искать
  // бота, который уже стоит в этом чате.
  const calls = [];
  const silent = createAbilities({
    secret: SECRET,
    channelId: "-100500",
    now: () => 1_000_000,
    async send(line) { calls.push(line); return { message_id: 1 }; }, // никто не отвечает
  });
  const listed = await silent.catalogue({ actor: 5, chat: 5 });
  assert.equal(listed.ok, false);
  assert.equal(listed.code, "bridge_timeout");
  assert.deepEqual(listed.tools, []);
  // И список совместимости остался списком.
  assert.deepEqual(await silent.catalog({ actor: 5, chat: 5 }), []);
});

test("вопрос о профиле без данных не уходит к модели", async () => {
  // Худший ответ — не «не знаю», а придуманный профиль с ролью и ID.
  reset();
  await heart().onMessage(message("покажи мне профиль"), KEY);
  assert.equal(sdk().fetches.length, 0, "провайдер не вызывался");
  assert.match(sdk().sent.at(-1).text, /профиль не входит в мои умения/);

  // Вопрос словами, а не фразой-умением: модель его тоже не увидит.
  reset();
  await heart().onMessage(message("какая у меня роль?"), KEY);
  assert.equal(sdk().fetches.length, 0, "факт не выдумывается моделью");
  assert.match(sdk().sent.at(-1).text, /придумывать их я не стану/);
  assert.doesNotMatch(sdk().sent.at(-1).text, /Создатель|Полный доступ|12345/);

  // Вопрос, который не про факты, по-прежнему идёт к модели.
  reset();
  await heart().onMessage(message("как дела?"), KEY);
  assert.equal(sdk().fetches.length, 1);
});

test("каталог спрашивается с типом чата и не переиспользуется между чатами", async () => {
  // Список умений зависит от места: /warn есть только в группе. Раньше тип
  // чата вообще не уходил по мосту, и сестра считала любой вопрос личным —
  // в группе Аи не находила половину умений.
  const seen = [];
  const sibling = createBridge({ secret: SECRET, capabilities: { call: async () => ({}) }, now: () => 1_000_000 });
  let bus = null;
  bus = createAbilities({
    secret: SECRET,
    channelId: "-100500",
    now: () => 1_000_000,
    async send(line) {
      const request = decodeEnvelope(line);
      seen.push(request.chatType ?? null);
      const data = request.chatType === "supergroup" ? [{ name: "warn" }] : [{ name: "actions" }];
      const answer = await sibling.sealResult({ id: request.id, tool: request.tool, result: { ok: true, code: "ok", text: "", data } });
      return bus.onPost(encodeEnvelope(answer.envelope));
    },
  });

  const group = await bus.catalogue({ actor: 7, chat: -10, chatType: "supergroup" });
  const priv = await bus.catalogue({ actor: 7, chat: 7, chatType: "private" });
  assert.deepEqual(group.tools.map(tool => tool.name), ["warn"]);
  assert.deepEqual(priv.tools.map(tool => tool.name), ["actions"]);
  assert.deepEqual(seen, ["supergroup", "private"], "тип чата уходит и попадает в подпись");
  // Повторный вопрос того же чата берётся из кэша: канал не гоняет лишнее.
  await bus.catalogue({ actor: 7, chat: -10, chatType: "supergroup" });
  assert.equal(seen.length, 2);
});
