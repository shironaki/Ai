import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { api as sdkApi, db as sdkDb, fetch as sdkFetch } from "./fixtures/sdk-stub.mjs";

register(new URL("./fixtures/sdk-loader.mjs", import.meta.url));

const { createHeart } = await import("../tgcloud/lib/heart.js");
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
};

function sdk() { return globalThis.__sdkStub; }
function reset() {
  sdk().sent.length = 0;
  sdk().fetches.length = 0;
  sdk().fetchQueue.length = 0;
  sdk().kv.clear();
  sdk().memory.clear();
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

test("/help lists only what the heart really does, and never asks the model", async () => {
  reset();
  const h = heart();
  await h.onMessage(message("/help"));
  const text = sdk().sent[0].text;
  assert.equal(sdk().fetches.length, 0, "no provider call for a command list");
  assert.match(text, /Что я умею/);
  assert.match(text, /\/status/);
  // The two commands the model invented on the live bot.
  assert.doesNotMatch(text, /\/settings/);
  assert.doesNotMatch(text, /\/feedback/);
});

test("an unknown slash command is named as unknown, without a provider call", async () => {
  reset();
  const h = heart();
  await h.onMessage(message("/command2"));
  assert.equal(sdk().fetches.length, 0);
  assert.match(sdk().sent[0].text, /такой команды у меня нет/);
  assert.match(sdk().sent[0].text, /\/help/);
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
  assert.match(text, /\/packs/);
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
