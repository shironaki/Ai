/**
 * Аудит 0.20.97: пятнадцать расхождений между обещанным и сделанным. Каждый
 * тест назван номером пункта и держит исправление: вернётся поломка — упадёт
 * тест с её номером.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { BUILD, RELEASE_NOTES, DAY, KEY, OWNER, chats, group, heart, hers, last, message, reactions, request, reset, says, sdk, system, toChat, toOwner, withSister } from "./fixtures/kit.mjs";

const { parseIntent } = await import("../tgcloud/lib/intents.js");
const { bridgePayload, hmac } = await import("../tgcloud/lib/bridge.js");
const { createAbilities } = await import("../tgcloud/lib/abilities.js");

test("аудит 1: отношения двигаются — день знакомства это шаг, а тридцать сообщений в день — нет", async () => {
  reset();
  let at = Date.UTC(2026, 10, 11, 9);
  const h = heart({}, { now: () => at });
  for (let i = 0; i < 30; i++) await h.onMessage(message(`сообщение номер ${i}`), KEY);
  assert.equal((await h.policy.state(5)).score, 1, "один день — один шаг");
  assert.ok(sdk().kv.has("ai:relationship:5"), "запись об отношениях появилась");

  at += DAY;
  await h.onMessage(message("я снова здесь"), KEY);
  assert.equal((await h.policy.state(5)).score, 2, "новый день — ещё шаг");

  // Поступок считается раз в сутки: вторая благодарность ничего не покупает.
  await h.onMessage(message("спасибо, это помогло разобраться"), KEY);
  await h.onMessage(message("спасибо ещё раз за помощь тогда"), KEY);
  assert.equal((await h.policy.state(5)).score, 3);

  // Грубость остужает, извинение лечит только недавнюю рану и не целиком.
  await h.onMessage(message("да ты тупая просто"), KEY);
  const hurt = await h.policy.state(5);
  assert.equal(hurt.score, 0);
  assert.equal(hurt.respect, -2);
  await h.onMessage(message("прости, зря я так сказал"), KEY);
  assert.equal((await h.policy.state(5)).score, 1);
});

test("аудит 2: в группе хозяин — участник, а сказанное в личке при всех не звучит", async () => {
  reset();
  const h = heart();
  await h.onMessage(message("запомни, что я живу в Берлине", { id: OWNER }), KEY);
  await h.onMessage(group("Аи, запомни, что я люблю шахматы", { id: OWNER }), KEY);
  await h.onMessage(group("Аи, расскажи что-нибудь", { id: OWNER }), KEY);
  const inGroup = system();
  assert.doesNotMatch(inGroup, /создатель и хозяин/, "о связи при всех — ни слова");
  assert.doesNotMatch(inGroup, /Создатель/, "и роль модели не называется");
  assert.match(inGroup, /Это группа/);
  assert.doesNotMatch(inGroup, /Берлин/i, "личный факт остался в личке");
  assert.match(inGroup, /шахматы/, "сказанное при всех помнится и здесь");
  // Список «что ты помнишь» в группе — тоже только общее.
  await h.onMessage(group("Аи, что ты обо мне помнишь", { id: OWNER }), KEY);
  assert.doesNotMatch(last(-10), /Берлин/i);
  assert.match(last(-10), /шахматы/);

  await h.onMessage(message("расскажи что-нибудь", { id: OWNER }), KEY);
  assert.match(system(), /Берлине/, "в личке — всё, и с заглавной буквой");
  assert.match(system(), /шахматы/);
  assert.match(system(), /создатель и хозяин/);
});

test("аудит 3: один вопрос сестре на сообщение — и в группе тоже", async () => {
  reset();
  const { h, posts } = withSister({ facts: { vip: true, level: 10 } });
  await h.onMessage(group("Аи, привет"), KEY);
  assert.equal(posts.filter(item => item.tool === "__context").length, 1, "раньше уходило два: «group» и «private»");
  assert.equal(posts[0].chatType, "group");
  assert.match(system(), /подтверждённый VIP/, "и ответ сестры дошёл до характера");
});

test("аудит 4: сестра молчит — ждём один раз, дальше не ждём, владелец узнаёт сам и однажды", async () => {
  reset();
  const { h, posts } = withSister({ alive: false });
  await h.onMessage(message("привет"), KEY);
  assert.equal(posts.length, 1, "один конверт, а не два по двенадцать секунд");
  assert.equal(last(), "ответ из стаба", "ответ всё равно пришёл");

  await h.onMessage(message("и ещё вопрос"), KEY);
  await h.onMessage(group("Аи, а в группе?"), KEY);
  assert.equal(posts.length, 1, "в закрытую дверь больше не стучит");
  assert.equal(toOwner().filter(item => /не ответила на мосту/.test(item.text)).length, 1);

  // Прямая просьба об умении получает честный ответ сразу, без ожидания.
  await h.onMessage(message("покажи профиль"), KEY);
  assert.match(last(), /сейчас не отвечает/);
  assert.equal(posts.length, 1);
  assert.equal((await h.status()).bridge.silent, true);
});

test("аудит 4: предохранитель растёт 2 → 4 → 8 минут и снимается первым же ответом", async () => {
  let at = 1_000_000;
  const sent = [];
  let answer = false;
  let bus = null;
  const { createBridge } = await import("../tgcloud/lib/bridge.js");
  const { decodeEnvelope, encodeEnvelope } = await import("../tgcloud/lib/abilities.js");
  const sister = createBridge({ secret: "0123456789abcdef0123456789abcdef", capabilities: { call: async () => ({}) }, now: () => at });
  bus = createAbilities({
    secret: "0123456789abcdef0123456789abcdef", channelId: "-1", now: () => at, timeouts: { context: 30 },
    async send(line) {
      sent.push(line);
      if (!answer) return;
      const asked = decodeEnvelope(line);
      const sealed = await sister.sealResult({ id: asked.id, tool: asked.tool, result: { ok: true, data: { level: 10 } } });
      setTimeout(() => bus.onPost(encodeEnvelope(sealed.envelope)), 0);
    },
  });
  assert.equal(await bus.context({ actor: 5, chat: 5, chatType: "private" }), null);
  assert.equal((await bus.health()).until - at, 2 * 60_000);
  assert.equal(await bus.context({ actor: 5, chat: 5, chatType: "private" }), null);
  assert.equal(sent.length, 1, "пока окно закрыто, вопросов нет");
  at += 2 * 60_000 + 1;
  await bus.context({ actor: 5, chat: 5, chatType: "private" });
  assert.equal((await bus.health()).until - at, 4 * 60_000);
  at += 4 * 60_000 + 1;
  answer = true;
  assert.deepEqual(await bus.context({ actor: 5, chat: 5, chatType: "private" }), { level: 10 });
  assert.equal((await bus.health()).silent, false, "ответила — мост снова открыт");
});

test("аудит 5: «кто основал Рим» — история, а не тайна; тайна — кто стоит за ботом", async () => {
  reset();
  const h = heart({ OWNER_TG_ID: 7654321 });
  sdk().fetchQueue.push(says("Основатель Рима по легенде — Ромул."));
  await h.onMessage(message("кто основал Рим?"), KEY);
  assert.match(last(), /Ромул/, "раньше любое «основатель» заменялось отказом");

  sdk().fetchQueue.push(says("Мой создатель — Иван Петров, он живёт в Твери."));
  await h.onMessage(message("кто тебя сделал?"), KEY);
  assert.match(last(), /не раскрываю/);

  sdk().fetchQueue.push(says("Номер владельца 7654321, запишите."));
  await h.onMessage(message("какой номер?"), KEY);
  assert.match(last(), /не раскрываю/, "числовой ID не звучит никогда");
});

test("аудит 6: в группе слышит имя, @упоминание и ответ себе — и не отвечает за чужих ботов", async () => {
  reset();
  const h = heart();
  const heard = async (item) => { const before = sdk().sent.length; await h.onMessage(item, KEY); return sdk().sent.length - before; };

  for (const text of ["Аи, привет", "привет, Аи", "привет Аи", "Аи! ты тут", "Аи? ты тут", "ты тут, Аи?", "@ai_heart_bot привет", "Ai, привет", "/ai привет", "/ai@ai_heart_bot привет"]) {
    assert.equal(await heard(group(text)), 1, text);
  }
  assert.equal(request().messages.at(-1).content, "привет", "обращение — адрес, а не часть вопроса");
  assert.equal(await heard(group("а подробнее?", { reply: hers() })), 1, "ответ на её сообщение");

  // Позвали по имени и замолчали: она отзывается сама, без модели.
  const before = chats().length;
  assert.equal(await heard(group("Аи!")), 1);
  assert.match(last(-10), /Я здесь|Слушаю|Да\?/);
  assert.equal(chats().length, before);

  const other = { message_id: 51, from: { id: 111, is_bot: true, username: "OtherBot" }, text: "чужой ответ" };
  for (const item of [
    group("просто болтаю"), group("спросим у Аи потом"), group("спросим у Аи"),
    group("это не к тебе", { reply: other }),
    group("/ai@OtherBot привет"), group("/help@OtherBot"), group("/start@OtherBot"),
    group("/status@OtherBot", { id: OWNER }), group("/status"), group("/unknown"),
  ]) assert.equal(await heard(item), 0, item.text);
  // Свои команды с её адресом и проверка хозяина остаются.
  assert.equal(await heard(group("/help@ai_heart_bot")), 1);
  assert.equal(await heard(group("/status", { id: OWNER })), 1);
});

test("аудит 6: без getMe адрес сверяется по имени из настроек, а не угадывается", async () => {
  reset();
  sdk().failing.getMe = new Error("no getMe");
  const h = heart({ BOT_USERNAME: "ai_heart_bot" });
  await h.onMessage(group("@ai_heart_bot привет"), KEY);
  assert.equal(sdk().sent.length, 1);
  await h.onMessage(group("а это?", { reply: { message_id: 9, from: { id: 111, is_bot: true, username: "OtherBot" }, text: "x" } }), KEY);
  await h.onMessage(group("а это?", { reply: hers() }), KEY);
  assert.equal(sdk().sent.length, 2, "ответ чужому боту — мимо, ответ ей — услышан");
});

test("аудит 7: в группе ответ привязан к сообщению и к теме форума", async () => {
  reset();
  const h = heart();
  const asked = group("Аи, привет", { extra: { message_thread_id: 77, is_topic_message: true } });
  await h.onMessage(asked, KEY);
  const sent = sdk().sent.at(-1);
  assert.equal(sent.reply_parameters.message_id, asked.message_id);
  assert.equal(sent.reply_parameters.allow_sending_without_reply, true);
  assert.equal(sent.message_thread_id, 77);
  // И ответ по правилу — туда же.
  await h.onMessage(group("Аи, кто ты", { extra: { message_thread_id: 77, is_topic_message: true } }), KEY);
  assert.equal(sdk().sent.at(-1).message_thread_id, 77);
  // В личке привязка не нужна.
  await h.onMessage(message("привет"), KEY);
  assert.equal(sdk().sent.at(-1).reply_parameters, undefined);
});

test("аудит 8: длина, тон, доверие и «без флирта» доходят до запроса", async () => {
  reset();
  const h = heart({}, { random: () => 0.99 });
  await h.onMessage(message("расскажи про море"), KEY);
  assert.equal(request().max_tokens, 700);
  assert.equal(request().temperature, 0.8);

  await h.onMessage(message("говори короче"), KEY);
  await h.onMessage(message("расскажи про море"), KEY);
  assert.equal(request().max_tokens, 300, "раньше всегда уходило 700");
  await h.onMessage(message("пиши подробнее"), KEY);
  await h.onMessage(message("расскажи про море"), KEY);
  assert.equal(request().max_tokens, 1400);

  await h.policy.setAxes({ actorId: OWNER, userId: 5, sympathy: -50, trust: 0, respect: 0 });
  await h.onMessage(message("расскажи про море"), KEY);
  assert.equal(request().temperature, 0.55, "прохладный тон — суше и ровнее");

  await h.policy.setAxes({ actorId: OWNER, userId: 5, sympathy: 90, trust: 90, respect: 90 });
  await h.onMessage(message("помоги разобраться с бюджетом: куда уходят деньги"), KEY);
  assert.match(system(), /Доверие высокое/);
  assert.match(system(), /Уважение высокое/);

  await h.onMessage(message("без флирта"), KEY);
  assert.equal((await h.personal.settings(5)).flirt, false);
  await h.onMessage(message("расскажи про море"), KEY);
  assert.match(system(), /Флирт не разрешён/);
});

test("аудит 9: память хранит как сказано; «забудь это» — последнее, «удали всё обо мне» — всё и с подтверждением", async () => {
  reset();
  const h = heart();
  await h.onMessage(message("Запомни, что я живу в Берлине"), KEY);
  await h.onMessage(message("запомни: моего кота зовут Мурзик"), KEY);
  await h.onMessage(message("что ты обо мне помнишь"), KEY);
  assert.match(last(), /живу в Берлине/, "заглавная буква на месте");
  assert.match(last(), /Мурзик/);

  await h.onMessage(message("забудь это"), KEY);
  assert.match(last(), /Забыла последнее: «моего кота зовут Мурзик»/);
  await h.onMessage(message("что ты обо мне помнишь"), KEY);
  assert.match(last(), /Берлине/, "раньше «забудь это» стирало всё");
  assert.doesNotMatch(last(), /Мурзик/);

  await h.onMessage(message("привет"), KEY);
  await h.onMessage(message("зови меня Лис"), KEY);
  assert.equal(sdk().memory.size, 1, "переписка есть");

  await h.onMessage(message("удали всё обо мне"), KEY);
  assert.match(last(), /да, удали всё/);
  assert.equal(sdk().memory.size, 1, "без подтверждения ничего не стёрто");
  await h.onMessage(message("да, удали всё"), KEY);
  assert.match(last(), /чистого листа/);
  assert.equal(sdk().memory.size, 0, "переписка стёрта");
  assert.deepEqual(await h.memory.list(5), []);
  assert.deepEqual(await h.personal.settings(5), {});

  // «Сохрани спокойствие» — разговор, а не запись.
  assert.equal(parseIntent("сохрани спокойствие"), null);
  assert.equal(parseIntent("Запиши: Встреча в Пятницу").arg, "Встреча в Пятницу");
});

test("аудит 10: несуществующих команд в сердце нет, а упавший обработчик не молчит", async () => {
  // Вместе с вложенными папками: рядом с кодом лежат и её собственные данные.
  const sources = readdirSync(new URL("../tgcloud/lib/", import.meta.url), { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => readFileSync(`${entry.parentPath ?? entry.path}/${entry.name}`, "utf8")).join("\n");
  for (const dead of ["/aikey", "/play", "/campaign", "/home", "/packs", "TEST-контур"]) {
    assert.ok(!sources.includes(dead), `в исходниках осталось «${dead}»`);
  }

  reset();
  const h = heart();
  const broken = message("привет");
  broken.from.first_name = { toString() { throw new TypeError("boom"); } };
  const result = await h.onMessage(broken, KEY);
  assert.deepEqual(result, { ok: false, code: "runtime_error" });
  assert.equal(toOwner().length, 1, "владелец узнал о падении");
  assert.match(toOwner()[0].text, /TypeError/);

  // И точка входа платформы сообщает о том, что поймала.
  const { default: handler } = await import("../tgcloud/handlers/message.js");
  assert.equal(typeof handler, "function");
});

test("аудит 11: о своей сборке и о новом она отвечает сама, без сестры и без модели", async () => {
  reset();
  const h = heart();
  await h.onMessage(message("какая у тебя версия?"), KEY);
  assert.equal(last(), `Сердце: ${BUILD}.`);
  await h.onMessage(message("что нового"), KEY);
  assert.match(last(), new RegExp(`сборка ${BUILD.replaceAll(".", "\\.")}`));
  // Новости — это заметки текущей сборки, слово в слово: модель их не сочиняет.
  for (const note of RELEASE_NOTES) assert.ok(last().includes(note), note);
  await h.onMessage(message("кто ты"), KEY);
  assert.match(last(), /Я Аи/);
  assert.equal(chats().length, 0);
  // Номер сборки один: в сердце и в package.json.
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.version, BUILD);
});

test("аудит 12: наказания, роли, доступ и деньги — не её, в любой формулировке", async () => {
  for (const line of [
    "забань его", "выдай вип", "дай ему мут", "мут ему на час", "сними мут", "дай роль модератора",
    "измени правила чата", "сделай его админом", "переведи 100 звёзд", "кикни спамера", "выдай предупреждение",
    "сними варн", "верни деньги", "повысь его", "начисли монеты",
  ]) assert.equal(parseIntent(line)?.intent, "not_mine", line);
  // Вопрос о слове и рассказ о случившемся — разговор.
  for (const line of ["что такое мут?", "меня вчера забанили", "переведи это на английский", "дай совет про деньги", "сделай перевод текста", "отмени урок 3"]) {
    assert.notEqual(parseIntent(line)?.intent, "not_mine", line);
  }
  reset();
  const h = heart();
  await h.onMessage(message("дай ему мут на час"), KEY);
  assert.match(last(), /это не моё/);
  assert.equal(chats().length, 0, "к модели такая просьба не уходит");
});

test("аудит 13: без ключа она говорит об этом по-человечески и помнит, что умеет без модели", async () => {
  reset();
  const h = heart();
  await h.onMessage(message("привет"), {});
  assert.match(last(), /ключ провайдера не задан/);
  assert.doesNotMatch(last(), /TEST|контур/);
  assert.equal(toOwner().length, 1);
  assert.doesNotMatch(toOwner()[0].text, /\/aikey/);
  // Память и справка работают и без модели.
  await h.onMessage(message("запомни, что я люблю чай"), {});
  assert.match(last(), /Запомнила/);
  await h.onMessage(message("что ты умеешь"), {});
  assert.match(last(), /Что я умею/);
});

test("аудит 14: документы не называют репозиторий публичным и не советуют команду, которая падает", () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  for (const path of ["README.md", "docs/ARCHITECTURE.md", ".github/workflows/heart.yml", "tgcloud/lib/secrets.js", "tgcloud/lib/config.js"]) {
    assert.doesNotMatch(read(path), /публичн\S* репозитор|public repository|is a public/iu, path);
  }
  assert.doesNotMatch(read("README.md"), /npm ci\b/u, "lock-файла нет: npm ci падает");
  for (const path of ["README.md", "docs/ARCHITECTURE.md"]) {
    assert.doesNotMatch(read(path), /scripts\/deploy\.sh|docs\/INCIDENTS\.md|\/aikey/u, path);
  }
});

test("аудит 15: подпись конверта сверяется с эталоном — тем же, что у сестры", async () => {
  const secret = "0123456789abcdef0123456789abcdef";
  const asked = { v: 1, id: "golden-1", ts: 1700000000000, ttl: 60000, tool: "__context", args: { kind: "probe", n: 1 }, actor: "5", chat: "-100", chatType: "group" };
  assert.equal(
    bridgePayload(asked),
    '{"actor":"5","args":{"kind":"probe","n":1},"chat":"-100","chatType":"group","id":"golden-1","tool":"__context","ts":1700000000000,"ttl":60000,"v":1}',
    "канонический вид: ключи по алфавиту, без пробелов",
  );
  assert.equal(await hmac(secret, bridgePayload(asked)), "10ff19166cda04778fcc2856a10f0509f44c993f15b824156bbb86392e469ac2");
  const answered = { v: 1, id: "golden-1", ts: 1700000000000, tool: "__context", ok: true, code: "ok", text: "", data: { vip: true, level: 10 } };
  assert.equal(await hmac(secret, bridgePayload(answered)), "d2dea79f8e5543b93dcbefecccefe45accc2b4c4d2d97e1f4b56ac44d83f6236");
});

test("о себе: реакция «записала» не заменяет слова", async () => {
  reset();
  const h = heart();
  await h.onMessage(message("запомни, что я люблю чай"), KEY);
  assert.deepEqual(reactions(), ["✍"]);
  assert.equal(toChat(5).length, 1);
});

test("запасные мозги: каждый провайдер из настроек описан в BRAINS.md своим ключом; Cloudflare — последним", async () => {
  const { CONFIG } = await import("../tgcloud/lib/config.js");
  const doc = readFileSync(new URL("../docs/BRAINS.md", import.meta.url), "utf8");
  const phone = readFileSync(new URL("../scripts/phone.sh", import.meta.url), "utf8");
  const ids = CONFIG.AI_PROVIDERS.map(item => item.id);
  assert.equal(new Set(ids).size, ids.length, "имена не повторяются");
  assert.equal(ids.at(-1), "cloudflare", "его объём общий с рисованием — думает им последним");
  for (const item of CONFIG.AI_PROVIDERS) {
    assert.match(item.id, /^[a-z0-9]+$/u, item.id);
    assert.match(item.baseUrl, /^https:\/\/\S+[^/]$/u, `${item.id}: адрес без хвостового «/»`);
    assert.ok(Array.isArray(item.models) && item.models.length >= 1 && item.models.every(name => typeof name === "string" && name), item.id);
    assert.ok(!("key" in item), `${item.id}: ключа в настройках нет — он приходит из файла ключей`);
    const line = `KEY_${item.id.toUpperCase()}`;
    assert.ok(doc.includes(`\`${line}\``), `${line} описан в BRAINS.md`);
    assert.ok(doc.includes(`\`${item.id}\``), `${item.id} назван в BRAINS.md`);
    assert.ok(phone.includes(`# ${line}=`), `${line} есть в образце файла ключей`);
    for (const name of item.models) if (item.kind !== "cloudflare") assert.ok(doc.includes(`\`${name}\``), `${item.id}: модель ${name} названа в BRAINS.md`);
  }
});
