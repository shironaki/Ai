/**
 * Канал моста: часы двух ботов могут расходиться на минуты, а прочитанные
 * конверты из канала убираются. Снимок владельца от 15.11.2026: время в
 * вопросе Аи — на три минуты впереди Telegram, ответ сестры — «expired».
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, reset, sdk, calls, toOwner, last, until, OWNER, SECRET, CHANNEL, KEY } from "./fixtures/kit.mjs";
import { api as sdkApi } from "./fixtures/sdk-stub.mjs";

const { createBridge } = await import("../tgcloud/lib/bridge.js");
const { encodeEnvelope, decodeEnvelope, CLOCK_SLACK_MS } = await import("../tgcloud/lib/abilities.js");

const REAL = Date.parse("2026-11-14T23:04:30Z");
const own = (text) => message(text, { id: OWNER });

/**
 * Сердце и сестра, каждая со своими часами. Сестра проверяет вопрос тем же
 * кодом, что и настоящая Юи (`bridge.handle`), и отвечает постом в канал.
 * Вопросы получают номера с 100, ответы — с 200.
 */
function pair({ ahead = 0, overrides = {} } = {}) {
  let tick = 0;
  const hers = () => REAL + (tick += 1);
  const later = (ms) => { tick += ms; };
  const mine = () => hers() + ahead;
  const sister = createBridge({ secret: SECRET, now: hers, capabilities: { call: async () => ({ ok: true, code: "ok", text: "", data: { role: "Создатель", level: 100 } }) } });
  const seen = { asked: [], answers: [] };
  let h = null;
  let question = 100, answerId = 200;
  const api = new Proxy({}, {
    get(_, name) {
      if (name !== "sendMessage") return sdkApi[name];
      return async (params) => {
        if (String(params.chat_id) !== CHANNEL) return sdkApi.sendMessage(params);
        const asked = decodeEnvelope(params.text);
        const id = question++;
        seen.asked.push({ id, envelope: asked });
        const result = await sister.handle(asked, { expect: { actorId: asked.actor, chatId: asked.chat, chatType: asked.chatType } });
        const answer = await sister.sealResult({ id: asked.id, tool: asked.tool, result });
        const post = { message_id: answerId++, date: Math.floor(REAL / 1000), chat: { id: Number(CHANNEL), type: "channel" }, text: encodeEnvelope(answer.envelope, "💬 Ответ") };
        seen.answers.push({ id: post.message_id, result });
        setTimeout(() => { h.onMessage(post, KEY); }, 0);
        return { message_id: id };
      };
    },
  });
  h = heart({ ABILITIES_CHANNEL_ID: CHANNEL, ABILITIES_SECRET: SECRET, ABILITIES_TIMEOUT_MS: 500, ...overrides }, { api, now: mine });
  return { h, seen, later };
}
const deleted = () => calls("deleteMessage").filter(item => String(item.chat_id) === CHANNEL).map(item => item.message_id).sort((a, b) => a - b);

test("часы Аи спешат на три минуты — сестра вопрос принимает, Аи принимает ответ", async () => {
  reset();
  const { h, seen } = pair({ ahead: 180_000 });
  await h.onMessage(own("/status"), KEY);
  assert.match(last(OWNER), /Способности: мост открыт, Юи ответила за \d+ мс/u);
  assert.ok(seen.asked.length >= 1);
  for (const item of seen.asked) assert.equal(item.envelope.ttl, CLOCK_SLACK_MS, "срок вопроса — десять минут, а не одна");
  assert.ok(seen.answers.every(item => item.result.ok === true), "сестра со своими часами вопрос не отклонила");
  // А с прежним сроком в минуту тот же вопрос сестра отклоняла — как на снимке владельца.
  const strict = createBridge({ secret: SECRET, now: () => REAL, capabilities: { call: async () => ({ ok: true }) } });
  const old = await createBridge({ secret: SECRET, now: () => REAL + 180_000, capabilities: { call: async () => ({}) } }).seal({ tool: "__context", actor: "7", chat: "7", chatType: "private", ttl: 60_000 });
  assert.deepEqual(await strict.verify(old.envelope), { ok: false, code: "expired", age: -180_000 });
});

test("прочитанное из канала убирается: свой вопрос и ответ сестры; будильник и чужое — на месте", async () => {
  reset();
  const { h, seen } = pair();
  await h.onMessage(own("/status"), KEY);
  await until(() => deleted().length >= seen.asked.length + seen.answers.length);
  assert.deepEqual(deleted(), [...seen.asked.map(item => item.id), ...seen.answers.map(item => item.id)].sort((a, b) => a - b), "убраны все вопросы и все ответы — и ничего больше");
  // Удар будильника (правка одного и того же поста) и просто пост в канале не удаляются.
  const before = deleted().length;
  await h.onMessage({ message_id: 900, edit_date: 1, chat: { id: Number(CHANNEL), type: "channel" }, text: "тик" }, KEY);
  await h.onMessage({ message_id: 901, chat: { id: Number(CHANNEL), type: "channel" }, text: "заметка владельца" }, KEY);
  // Конверт с чужой подписью — не ей: остаётся в канале как улика.
  const forged = await createBridge({ secret: "f".repeat(32), now: () => REAL, capabilities: { call: async () => ({}) } }).sealResult({ id: "x-1", tool: "__context", result: { ok: true } });
  assert.deepEqual(await h.onMessage({ message_id: 902, chat: { id: Number(CHANNEL), type: "channel" }, text: encodeEnvelope(forged.envelope) }, KEY), { ok: false, code: "not_for_heart" });
  assert.equal(deleted().length, before);
  // Подписанное событие сестры, попавшее в другой канал, обрабатывается, но удалять там нечего:
  // тот же номер сообщения в канале моста — чужой пост.
  const sister = createBridge({ secret: SECRET, now: () => REAL, capabilities: { call: async () => ({}) } });
  const event = await sister.seal({ tool: "__event", args: { kind: "level_up", chatId: -10, name: "Маша", detail: "5" }, actor: null, chat: "-10" });
  await h.onMessage({ message_id: 100, chat: { id: -100777, type: "channel" }, text: encodeEnvelope(event.envelope) }, KEY);
  assert.equal(deleted().length, before, "в чужом канале ничего не удаляется");

  // Выключатель: с `BRIDGE_TIDY: false` канал остаётся как есть.
  reset();
  const kept = pair({ overrides: { BRIDGE_TIDY: false } });
  await kept.h.onMessage(own("/status"), KEY);
  assert.match(last(OWNER), /Юи ответила за \d+ мс/u);
  assert.deepEqual(deleted(), []);
});

test("нет права удалять чужие посты — владелец узнаёт, что дать; часы разошлись больше допуска — узнаёт словами", async () => {
  reset();
  sdk().failing.deleteMessage = Object.assign(new Error("Bad Request: message can't be deleted"), { code: 400 });
  const { h, later } = pair();
  await h.onMessage(own("/status"), KEY);
  later(2 * 60_000); // вести уходят не чаще раза в минуту
  await h.onMessage(own("/status"), KEY);
  await until(() => toOwner().some(item => /Где: Канал моста/u.test(item.text)));
  assert.ok(toOwner().some(item => /^Сбои: Канал моста — не могу убирать прочитанные сообщения Юи/mu.test(item.text)), "и в статусе это видно");
  const notice = toOwner().find(item => /Где: Канал моста/u.test(item.text)).text;
  assert.match(notice, /не могу убирать прочитанные сообщения Юи из канала моста — они будут копиться/u);
  assert.match(notice, /Дайте мне в этом канале право «Удаление сообщений»\. Свои вопросы я убираю и без него\./u);

  // Пятнадцать минут разницы: сестра отвечает «expired», а её ответ не проходит и по часам Аи.
  reset();
  const far = pair({ ahead: 15 * 60_000 });
  await far.h.onMessage(own("/status"), KEY);
  assert.ok(far.seen.answers.every(item => item.result.code === "expired"));
  await until(() => toOwner().some(item => /Где: Мост/u.test(item.text)));
  assert.match(toOwner().find(item => /Где: Мост/u.test(item.text)).text, /ответ Юи не принят: время в нём расходится с моими часами на 9\d\d с — больше допуска в 10 минут/u);
});

test("статус называет сбой: что упало, где и когда — а не одно слово «handler»", async () => {
  reset();
  const h = heart({}, { now: () => REAL });
  function onBusinessMessage() { return null.chat; }
  let crash = null;
  try { onBusinessMessage(); } catch (error) { crash = error; }
  await h.reportCrash(crash, KEY);
  await h.onMessage(own("/status"), KEY);
  const line = last(OWNER).split("\n").find(item => item.startsWith("Сбои:"));
  assert.match(line, /^Сбои: Обработчик — TypeError: Cannot read properties of null \(reading 'chat'\) · onBusinessMessage, bridge\.test\.mjs:\d+ \(02:04\)$/u);
});
