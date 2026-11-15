/**
 * Платформа: то, чего в её рантайме нет.
 *
 * 16.11.2026 владелец прислал статус со строкой «Сбои: Обработчик —
 * ReferenceError: setTimeout is not defined». Таймеров на платформе нет вовсе, а
 * мост к сестре с первой сборки ждал ответа через `setTimeout`: вопрос уходил в
 * канал, обращение падало, вопрос оставался в канале навсегда, а предохранитель
 * «сестра молчит» не срабатывал ни разу. Тесты этого не видели: в Node таймеры
 * есть. Здесь сердце работает без них.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { heart, message, group, reset, last, chats, says, refuses, sdk, system, toOwner, OWNER, KEY, SECRET, CHANNEL } from "./fixtures/kit.mjs";
import { api as sdkApi } from "./fixtures/sdk-stub.mjs";

const { ANSWER_PREFIX, LATE_OK_MS, POLLS_WITHOUT_TIMERS, decodeEnvelope, encodeEnvelope } = await import("../tgcloud/lib/abilities.js");
const { createBridge } = await import("../tgcloud/lib/bridge.js");
const { hasTimers, later, cancel, sleep } = await import("../tgcloud/lib/timers.js");

const NAMES = ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate"];

/** Выполнить `run` так, как это было бы на платформе: без единого таймера. */
async function withoutTimers(run) {
  const saved = Object.fromEntries(NAMES.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of NAMES) delete globalThis[name];
  try {
    assert.equal(typeof globalThis.setTimeout, "undefined", "таймеры убраны");
    return await run();
  } finally {
    for (const name of NAMES) if (saved[name]) Object.defineProperty(globalThis, name, saved[name]);
  }
}

/**
 * Сердце с открытым мостом. `answer(asked)` решает, что сделает сестра с вопросом:
 * вернёт данные — ответ ляжет в базу раньше, чем сердце туда заглянет (так
 * бывает, когда пост канала обработал другой изолят); вернёт null — промолчит.
 */
function bridged({ answer = () => null, now = () => Date.now(), overrides = {} } = {}) {
  const sister = createBridge({ secret: SECRET, capabilities: { call: async () => ({}) }, now });
  const posts = [];
  const removed = [];
  const box = { h: null, other: null };
  const api = new Proxy({}, {
    get(_, name) {
      if (name === "deleteMessage") return async (params) => { if (String(params.chat_id) === CHANNEL) removed.push(params.message_id); return true; };
      if (name !== "sendMessage") return sdkApi[name];
      return async (params) => {
        if (String(params.chat_id) !== CHANNEL) return sdkApi.sendMessage(params);
        const asked = decodeEnvelope(params.text);
        posts.push(asked);
        const data = answer(asked);
        if (data) {
          const sealed = await sister.sealResult({ id: asked.id, tool: asked.tool, result: { ok: true, code: "ok", text: "", data } });
          // Пост сестры получает другой изолят: у него нет ожидающего, и ответ ложится в базу.
          await box.other.onMessage({ message_id: 900 + posts.length, chat: { id: Number(CHANNEL), type: "channel" }, text: encodeEnvelope(sealed.envelope) });
        }
        return { message_id: 500 + posts.length };
      };
    },
  });
  const settings = { ABILITIES_CHANNEL_ID: CHANNEL, ABILITIES_SECRET: SECRET, ...overrides };
  box.h = heart(settings, { api, now });
  box.other = heart(settings, { api, now });
  /** Ответ сестры на вопрос, который уже перестали ждать: приходит отдельным обновлением. */
  const late = async (asked, data) => {
    const sealed = await sister.sealResult({ id: asked.id, tool: asked.tool, result: { ok: true, code: "ok", text: "", data } });
    return box.other.onMessage({ message_id: 990, chat: { id: Number(CHANNEL), type: "channel" }, text: encodeEnvelope(sealed.envelope) });
  };
  return { h: box.h, posts, removed, late };
}

test("в коде платформы нет таймеров мимо lib/timers.js", () => {
  const root = fileURLToPath(new URL("../tgcloud/", import.meta.url));
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (entry.name.endsWith(".js")) files.push(join(dir, entry.name));
    }
  };
  walk(root);
  assert.ok(files.length > 40, `файлов: ${files.length}`);
  const found = [];
  for (const file of files) {
    if (file.endsWith(join("lib", "timers.js"))) continue;
    readFileSync(file, "utf8").split("\n").forEach((line, index) => {
      const code = line.replace(/^\s*(?:\/\/|\*|\/\*).*$/u, "").replace(/\/\/.*$/u, "").replace(/`[^`]*`|"[^"]*"|'[^']*'/gu, "");
      if (/\b(?:setTimeout|clearTimeout|setInterval|clearInterval|setImmediate|clearImmediate)\b/u.test(code)) found.push(`${file.slice(root.length)}:${index + 1}`);
    });
  }
  assert.deepEqual(found, [], "на платформе таймеров нет: только через lib/timers.js");
});

test("lib/timers.js: без таймеров — не падает и не ждёт", async () => {
  assert.equal(hasTimers(), true);
  let called = 0;
  const handle = later(() => { called += 1; }, 5);
  cancel(handle);
  await sleep(20);
  assert.equal(called, 0, "отменённое не зовётся");
  await withoutTimers(async () => {
    assert.equal(hasTimers(), false);
    assert.equal(later(() => { called += 1; }, 0), null);
    cancel(null);
    cancel(42);
    await sleep(1000);
  });
  assert.equal(called, 0);
  assert.equal(hasTimers(), true, "таймеры возвращены тестам");
});

test("мост без таймеров: сестра молчит — ни падения, ни вопросов без конца, ни мусора в канале", async () => {
  reset();
  let at = Date.UTC(2026, 10, 18, 9);
  const { h, posts, removed } = bridged({ now: () => at });
  await withoutTimers(async () => {
    await h.onMessage(message("привет, расскажи что-нибудь"), KEY);
    assert.equal(last(), "ответ из стаба");
    assert.equal(posts.length, 1, "один вопрос: раньше их было два на каждую реплику, и из канала их никто не убирал");
    assert.deepEqual(removed, [501], "и он убран из канала сразу");
    // Просьба об умении сестры: раньше — ReferenceError, запись в «Сбои» и ни слова человеку.
    const asked = await h.onMessage(message("профиль"), KEY);
    assert.equal(asked.ok, true);
    assert.equal(last(), "Аи: это умение Юи, а она сейчас не отвечает. Без неё я его не выполню.");

    // Вопрос «в пути»: пока ждём опоздавший ответ, новых не задаём.
    at += 2_000;
    await h.onMessage(message("и ещё расскажи что-нибудь"), KEY);
    await h.onMessage(group("Аи, а в группе расскажешь?"), KEY);
    assert.equal(posts.length, 1);
    assert.equal(toOwner().length, 0, "ещё не молчание");

    // Срок вышел, ответа нет — это молчание: одна весть, тоном «к сведению», и мост закрыт на две минуты.
    at += LATE_OK_MS;
    await h.onMessage(message("а теперь расскажи другое"), KEY);
    assert.equal(posts.length, 1, "в закрытую дверь не стучит");
    assert.equal(toOwner().length, 1);
    assert.match(toOwner()[0].text, /^ℹ️ Хозяин, к сведению — это не поломка\n/u);
    assert.match(toOwner()[0].text, /Где: Мост\nЧто: Юи не ответила на мосту — отвечаю сама, её не жду; спрошу снова после \d\d:\d\d\n/u);
    assert.equal((await h.status()).bridge.silent, true);

    // Прямая просьба об её умении — честный ответ, а не падение.
    await h.onMessage(message("покажи профиль"), KEY);
    assert.match(last(), /сейчас не отвечает/u);

    // Две минуты прошли — спрашивает снова; опять тишина — мост закрыт на четыре, а второй вести нет.
    at += 121_000;
    await h.onMessage(message("расскажи ещё одну историю"), KEY);
    assert.equal(posts.length, 2);
    at += LATE_OK_MS + 1;
    await h.onMessage(message("и ещё одну историю расскажи"), KEY);
    assert.equal(posts.length, 2);
    assert.equal(toOwner().length, 1, "о том же молчании второй раз не пишет");
    assert.equal(chats().length, 6, "на каждую реплику ответила модель");
  });
  assert.equal(toOwner().some(item => /ReferenceError|сломалось/u.test(item.text)), false);
});

test("мост без таймеров: ответ сестры приходит позже — следующая реплика уже знает", async () => {
  reset();
  let at = Date.UTC(2026, 10, 18, 9);
  const { h, posts, late } = bridged({ now: () => at });
  await withoutTimers(async () => {
    await h.onMessage(message("привет, расскажи что-нибудь"), KEY);
    assert.equal(posts.length, 1);
    assert.doesNotMatch(system(), /подтверждённый VIP/u, "в первой реплике фактов сестры ещё нет");

    // Через секунду сестра ответила: пост канала — отдельное обновление.
    at += 1_000;
    await late(posts[0], { vip: true, level: 10 });
    at += 1_000;
    await h.onMessage(message("и ещё расскажи что-нибудь"), KEY);
    assert.match(system(), /подтверждённый VIP/u, "факты сестры дошли до характера");
    assert.equal(posts.length, 1, "и новый вопрос не понадобился");
    assert.equal((await h.status()).bridge.silent, false);
    assert.equal(toOwner().length, 0, "сестра жива: вестей нет");
  });
});

test("мост без таймеров: ответ уже в базе — берётся в том же обращении", async () => {
  reset();
  const { h, posts } = bridged({ answer: (asked) => (asked.tool === "__context" ? { vip: true, level: 10 } : []) });
  await withoutTimers(async () => {
    await h.onMessage(message("привет, расскажи что-нибудь"), KEY);
    assert.equal(posts.length, 1);
    assert.match(system(), /подтверждённый VIP/u);
    assert.equal(last(), "ответ из стаба");
  });
  assert.ok(POLLS_WITHOUT_TIMERS >= 10 && POLLS_WITHOUT_TIMERS <= 100, "опрос базы ограничен");
  assert.ok(ANSWER_PREFIX.endsWith(":"));
});

test("без таймеров: короткий лимит, статус и напоминания работают как обычно", async () => {
  reset();
  const h = heart({ AI_MODELS: ["openai/gpt-oss-120b"] }, { now: () => Date.UTC(2026, 10, 18, 9) });
  await withoutTimers(async () => {
    // «Повторите через секунду»: ждать нечем — повтор сразу, без падения.
    sdk().fetchQueue.push(refuses(429, { code: "rate_limit_exceeded", headers: { "retry-after": "1" } }), says("со второй попытки"));
    await h.onMessage(message("расскажи что-нибудь"), KEY);
    assert.equal(last(), "со второй попытки");
    await h.onMessage(message("статус", { id: OWNER }), KEY);
    assert.match(last(OWNER), /^🧪 Проверка сердца\n/u);
    await h.onMessage(message("напомни через 5 минут выпить воды"), KEY);
    assert.match(last(), /напомню/iu);
    await h.tick(KEY);
  });
  assert.equal(toOwner().some(item => /ReferenceError|сломалось/u.test(item.text)), false);
});
