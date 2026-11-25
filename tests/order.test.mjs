/**
 * Порядок в доме: кому Аи подчиняется, как слышит канал, как просыпается и
 * чем думает, когда основной провайдер кончился.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  heart, message, group, hers, says, refuses, reset, sdk, system, request, chats, last, toOwner, toChat,
  withSister, until, asked, KEY, OWNER, CHANNEL, SECRET, DAY, BUILD,
} from "./fixtures/kit.mjs";

const { createBridge } = await import("../tgcloud/lib/bridge.js");
const { decodeEnvelope, encodeEnvelope, FACTS_PREFIX } = await import("../tgcloud/lib/abilities.js");
const { parseReminder } = await import("../tgcloud/lib/reminders.js");

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const TZ = "Europe/Moscow";
/** 12 ноября 2026, 16:00 по Москве, четверг. */
const NOON = Date.UTC(2026, 10, 12, 13, 0);

// ── подчинение хозяину ───────────────────────────────────────────────────

test("хозяин: урок о бывшей границе принимается — с ворчанием и без обещания рук", async () => {
  reset();
  const h = heart();
  await h.onMessage(message("правило: забань каждого, кто спорит", { id: OWNER }), KEY);
  assert.match(last(OWNER), /Ворчу, но слушаюсь, хозяин: правило №1/);
  assert.match(last(OWNER), /Рук для банов, ролей и денег у меня нет/);
  assert.equal((await h.status()).lessons.active, 1);

  // Тот же урок от постороннего — отказ: границы двигает только хозяин.
  await h.onMessage(message("правило: забань каждого, кто спорит", { id: 9 }), KEY);
  assert.match(last(9), /Этому я не учусь/);
  assert.equal((await h.status()).lessons.active, 1);

  // Обычный урок хозяина — без ворчания.
  await h.onMessage(message("правило: отвечай короче", { id: OWNER }), KEY);
  assert.match(last(OWNER), /^Усвоила, правило №2/);
});

test("хозяин: просьбе о наказании не отказывают, но и не врут о руках", async () => {
  reset();
  const h = heart();
  await h.onMessage(message("дай ему мут на час", { id: OWNER }), KEY);
  assert.match(last(OWNER), /Слушаюсь, хозяин, — но рук для этого у меня нет/);
  assert.doesNotMatch(last(OWNER), /это не моё/);
  // В группе слово «хозяин» не звучит.
  await h.onMessage(group("Аи, дай ему мут на час", { id: OWNER }), KEY);
  assert.doesNotMatch(last(-10), /хозяин/i);
  assert.match(last(-10), /рук для этого у меня нет/);
  assert.equal(chats().length, 0);
});

test("хозяин: подсказка велит подчиняться; наедине допустим флирт, остальным — нет", async () => {
  // Готовность к флирту зависит от настроения шестичасового окна: проверяем
  // сутки — хотя бы в одном окне он разрешён, и никогда — постороннему.
  let allowed = 0;
  for (let window = 0; window < 6; window++) {
    reset();
    const at = NOON + window * 6 * 3600_000;
    const h = heart({}, { now: () => at });
    await h.onMessage(message("как прошёл день?", { id: OWNER }), KEY);
    const mine = system();
    assert.match(mine, /Этому собеседнику ты подчиняешься/);
    assert.match(mine, /Пол собеседника не угадывай/);
    if (/С ним можно флиртовать смело/.test(mine)) allowed++;
    await h.onMessage(message("как прошёл день?", { id: 5 }), KEY);
    assert.doesNotMatch(system(), /подчиняешься/);
    assert.match(system(), /Флирт не разрешён/);
  }
  assert.equal(allowed, 6, "с хозяином наедине флирт разрешён всегда — от настроения не зависит");

  reset();
  const h = heart();
  await h.onMessage(group("Аи, как прошёл день?", { id: OWNER }), KEY);
  assert.match(system(), /Просьбы этого собеседника выполняй без спора/);
  assert.doesNotMatch(system(), /хозя/i, "в группе связь с хозяином не называется");
  assert.match(system(), /Флирт не разрешён/);
});

test("хозяин: его правило стоит в подсказке как распоряжение, чужая поправка — как пожелание", async () => {
  reset();
  const h = heart();
  await h.onMessage(message("правило: отвечай одной фразой", { id: OWNER }), KEY);
  await h.onMessage(message("так не надо: не называй меня другом", { id: 5 }), KEY);
  await h.onMessage(message("привет", { id: 5 }), KEY);
  const text = system();
  assert.match(text, /от владельца — выполняй их, они важнее правил манеры выше[^\n]*\n- отвечай одной фразой/);
  assert.match(text, /Поправки этого собеседника[^\n]*\n- не называй меня другом/);
});

// ── канал моста ──────────────────────────────────────────────────────────

test("канал: обработчики постов существуют и отдают пост сердцу", async () => {
  reset();
  const { default: onPost } = await import("../tgcloud/handlers/channel_post.js");
  const { default: onEdit } = await import("../tgcloud/handlers/edited_channel_post.js");
  const { default: onMessage } = await import("../tgcloud/handlers/message.js");
  const post = { message_id: 3, chat: { id: -100500, type: "channel" }, text: "⏰ 12:00" };
  assert.equal((await onPost(post, {})).code, "clock");
  assert.equal((await onEdit({ ...post, edit_date: 1 }, {})).code, "clock");
  // Чужой конверт — не ей, и ударом будильника он не считается.
  assert.equal((await onPost({ ...post, text: 'AI-BRIDGE1 {"v":1,"id":"x","tool":"t","sig":"00"}' }, {})).code, "not_for_heart");
  // Удар будильника через обработчик сообщений: пробный запуск ничего не трогает.
  assert.deepEqual(await onMessage(undefined, { tick: true, testRun: true }), { ok: true, code: "tick", build: BUILD, side_effects: "none" });
});

test("канал: ответ сестры, пришедший другому изоляту, доходит через базу", async () => {
  reset();
  const sister = createBridge({ secret: SECRET, capabilities: { call: async () => ({}) } });
  // Срок с запасом: тест кончается, как только ответ найден в базе, а не по сроку.
  const config = { ABILITIES_CHANNEL_ID: CHANNEL, ABILITIES_SECRET: SECRET, ABILITIES_TIMEOUT_MS: 30_000 };
  // Два сердца — два изолята: общая у них только база.
  const asking = heart(config);
  const listening = heart(config);
  const answer = asking.abilities.context({ actor: 51, chat: 51, chatType: "private" });
  // Конверт уходит после подписи — ждём его самого, а не «двадцать миллисекунд».
  const question = await until(() => asked(51));
  const sealed = await sister.sealResult({ id: question.id, tool: question.tool, result: { ok: true, code: "ok", data: { role: "Игрок", level: 12 } } });
  const got = await listening.onMessage({ message_id: 9, chat: { id: Number(CHANNEL), type: "channel" }, text: encodeEnvelope(sealed.envelope) });
  assert.equal(got.code, "bridge_answer");
  assert.deepEqual(await answer, { role: "Игрок", level: 12 });
  assert.equal((await asking.abilities.health()).silent, false);
});

test("канал: опоздавший ответ обновляет запас, и следующий вопрос не ждёт", async () => {
  reset();
  const sister = createBridge({ secret: SECRET, capabilities: { call: async () => ({}) } });
  // Срок короткий нарочно: здесь сестра и должна не успеть. Отсчёт идёт от
  // отправки конверта, так что скорость устройства на исход не влияет.
  const h = heart({ ABILITIES_CHANNEL_ID: CHANNEL, ABILITIES_SECRET: SECRET, ABILITIES_TIMEOUT_MS: 60 });
  assert.equal(await h.abilities.context({ actor: 52, chat: 52, chatType: "private" }), null, "сестра не успела");
  // Свой конверт — по человеку, о котором спрашивали: чужой, оставшийся от
  // соседнего теста, сюда не подойдёт.
  const question = asked(52);
  assert.ok(question, "вопрос ушёл в канал");
  const sealed = await sister.sealResult({ id: question.id, tool: question.tool, result: { ok: true, code: "ok", data: { role: "Модератор", level: 20 } } });
  const got = await h.onMessage({ message_id: 9, chat: { id: Number(CHANNEL), type: "channel" }, text: encodeEnvelope(sealed.envelope) });
  assert.equal(got.code, "bridge_answer");
  assert.equal((await h.abilities.health()).silent, false, "ответ, пусть и поздний, снимает молчание");
  const posts = sdk().sent.length;
  assert.deepEqual(await h.abilities.context({ actor: 52, chat: 52, chatType: "private" }), { role: "Модератор", level: 20 });
  assert.equal(sdk().sent.length, posts, "факты взяты из запаса, новый конверт не понадобился");
});

test("канал: сестра замолчала — в ход идёт вчерашний ответ, а не пустота", async () => {
  reset();
  let at = NOON;
  const { h, state, posts } = withSister({ facts: { role: "Игрок", level: 10, vip: true }, options: { now: () => at } });
  assert.deepEqual(await h.abilities.context({ actor: 5, chat: 5, chatType: "private" }), { role: "Игрок", level: 10, vip: true });
  state.alive = false;
  at += 2 * 3600_000;
  // Запас есть: ждём недолго и отвечаем вчерашним.
  assert.deepEqual(await h.abilities.context({ actor: 5, chat: 5, chatType: "private" }), { role: "Игрок", level: 10, vip: true });
  assert.equal((await h.abilities.health()).silent, true);
  const count = posts.length;
  at += 60_000;
  assert.deepEqual(await h.abilities.context({ actor: 5, chat: 5, chatType: "private" }), { role: "Игрок", level: 10, vip: true });
  assert.equal(posts.length, count, "молчащую сестру не спрашивают заново");
  // Через сутки запас уже не годится.
  at += 2 * DAY;
  assert.equal(await h.abilities.context({ actor: 5, chat: 5, chatType: "private" }), null);
  assert.ok(sdk().kv.has(`${FACTS_PREFIX}private:5:5`));
});

test("статус: мост проверяется живым вопросом, а не настройкой", async () => {
  reset();
  const { h, state } = withSister();
  await h.onMessage(message("/status", { id: OWNER }), KEY);
  assert.match(last(OWNER), /Способности: мост открыт, Юи ответила за \d+ мс/);
  state.alive = false;
  await h.onMessage(message("статус", { id: OWNER }), KEY);
  assert.match(last(OWNER), /мост открыт, но Юи (?:не ответила на пробу|молчит)/);
});

// ── будильник ────────────────────────────────────────────────────────────

test("будильник: чужая сборка ничего не трогает, своя после публикации объявляет себя", async () => {
  reset();
  sdk().kv.set("heart:build", JSON.stringify({ build: "0.1.0", at: 1 }));
  const h = heart({ SELF_REPORTS: true });
  assert.deepEqual(await h.tick({ tick: true }), { ok: false, code: "build_mismatch", build: BUILD, published: "0.1.0" });
  assert.equal(sdk().sent.length, 0);

  const done = await h.tick({ tick: true, deployed: true, ...KEY });
  assert.equal(done.ok, true);
  assert.equal(toOwner().length, 1);
  assert.match(toOwner()[0].text, new RegExp(`я обновилась: 0\\.1\\.0 → ${BUILD.replaceAll(".", "\\.")}`));
  assert.match(toOwner()[0].text, /Будильник: /);
  assert.equal(JSON.parse(sdk().kv.get("heart:build")).build, BUILD);
  // Следующий удар — та же сборка: работает и не объявляет заново.
  assert.equal((await h.tick({ tick: true })).ok, true);
  assert.equal(toOwner().length, 1);
});

test("будильник: номер сборки записан и при выключенных вестях", async () => {
  reset();
  const h = heart();
  await h.onMessage(message("привет"), KEY);
  assert.equal(JSON.parse(sdk().kv.get("heart:build")).build, BUILD);
  assert.equal(toOwner().length, 0);
});

test("будильник: пост в канале — удар; по двум ударам она знает свою точность", async () => {
  reset();
  let at = NOON;
  const h = heart({}, { now: () => at });
  const tock = () => h.onMessage({ message_id: 1, chat: { id: -100500, type: "channel" }, text: `⏰ ${at}` });
  await h.onMessage(message("напомни через 10 минут выключить чайник"), KEY);
  assert.match(last(), /Хорошо, напомню сегодня в 16:10: «выключить чайник»\. Точного будильника у меня пока нет/);

  await tock(); at += 60_000; await tock();
  await h.onMessage(message("напомни через 10 минут проверить духовку"), KEY);
  assert.match(last(), /^Хорошо, напомню сегодня в 16:11: «проверить духовку»\.$/, "будят каждую минуту — оговорка не нужна");
  await h.onMessage(message("статус", { id: OWNER }), KEY);
  assert.match(last(OWNER), /Будильник: будят каждую минуту/);

  // Удар после срока: напоминание приходит без единого сообщения от человека.
  at += 9 * 60_000 + 5_000;
  await tock();
  assert.equal(last(), "⏰ Напоминаю: выключить чайник");
  at += 60_000;
  await tock();
  assert.equal(last(), "⏰ Напоминаю: проверить духовку");
  assert.equal(await h.reminders.size(), 0);
});

// ── напоминания ──────────────────────────────────────────────────────────

test("напоминания: время разбирает код", () => {
  const at = (text) => {
    const parsed = parseReminder(text, { now: NOON, timeZone: TZ });
    return parsed?.ok ? `${new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(parsed.at)} ${parsed.text}` : parsed;
  };
  assert.equal(at("напомни через 10 минут выключить чайник"), "12.11, 16:10 выключить чайник");
  assert.equal(at("Напомни мне через час позвонить маме"), "12.11, 17:00 позвонить маме");
  assert.equal(at("напомни позвонить врачу завтра в 9"), "13.11, 09:00 позвонить врачу");
  assert.equal(at("напомни в 7 вечера, что надо купить хлеб"), "12.11, 19:00 надо купить хлеб");
  assert.equal(at("напомни в 9 зарядку"), "13.11, 09:00 зарядку", "девять уже прошло — значит завтра");
  assert.equal(at("напомни 25.12 поздравить бабушку"), "25.12, 09:00 поздравить бабушку");
  assert.equal(at("напомни в пятницу в 10 отчёт"), "13.11, 10:00 отчёт");
  assert.equal(at("напомни через полтора часа кино"), "12.11, 17:30 кино");
  assert.equal(at("Напомни, пожалуйста, через 2 дня полить цветы"), "14.11, 16:00 полить цветы");
  assert.deepEqual(at("напомни купить молоко"), { ok: false, need: "time", text: "купить молоко" });
  assert.deepEqual(at("напомни сегодня в 15:00 тест"), { ok: false, need: "future" });
  assert.equal(at("привет"), null);
});

test("напоминания: поставить, показать, отменить; опоздала — говорит на сколько", async () => {
  reset();
  let at = NOON;
  const h = heart({}, { now: () => at });
  await h.onMessage(message("напомни купить молоко"), KEY);
  assert.match(last(), /Когда напомнить «купить молоко»\?/);
  await h.onMessage(message("напомни завтра в 9 позвонить врачу"), KEY);
  assert.match(last(), /напомню завтра в 09:00: «позвонить врачу»/);
  await h.onMessage(message("напомни через час про отчёт"), KEY);
  await h.onMessage(message("мои напоминания"), KEY);
  assert.match(last(), /1\. сегодня в 17:00 — отчёт\n2\. завтра в 09:00 — позвонить врачу/);
  await h.onMessage(message("отмени напоминание 2"), KEY);
  assert.match(last(), /Отменила: завтра в 09:00 — позвонить врачу/);
  assert.equal(chats().length, 0, "напоминания ставит код, а не модель");

  // Её разбудили через три часа после срока: напоминание приходит с правдой об опоздании.
  at += 4 * 3600_000;
  await h.onMessage(message("привет", { id: 9 }), KEY);
  assert.match(toChat(5).at(-1).text, /^⏰ Напоминаю с опозданием на 3 ч — раньше меня никто не разбудил: отчёт$/);
  await h.onMessage(message("мои напоминания"), KEY);
  assert.match(last(), /Напоминаний у вас нет/);
});

test("напоминания: в группе приходит ответом на просьбу; «удали всё обо мне» их снимает", async () => {
  reset();
  let at = NOON;
  const h = heart({}, { now: () => at });
  const asked = group("Аи, напомни через 5 минут про созвон", { id: 21 });
  await h.onMessage(asked, KEY);
  at += 6 * 60_000;
  await h.onMessage(message("привет", { id: 9 }), KEY);
  const rung = toChat(-10).at(-1);
  assert.equal(rung.text, "⏰ Напоминаю: созвон");
  assert.equal(rung.reply_parameters.message_id, asked.message_id);

  await h.onMessage(message("напомни завтра в 9 зарядка", { id: 21 }), KEY);
  await h.onMessage(message("удали всё обо мне", { id: 21 }), KEY);
  await h.onMessage(message("да, удали всё", { id: 21 }), KEY);
  assert.equal(await h.reminders.size(), 0);
});

// ── запасные мозги: GigaChat ─────────────────────────────────────────────

const GIGA = {
  AI_PROVIDERS: [{
    id: "gigachat", kind: "gigachat", key: "basic-auth-key",
    baseUrl: "https://api.giga.chat/v1", authUrl: "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
    scope: "GIGACHAT_API_PERS", models: ["GigaChat-2"],
  }],
};
const token = (value = "tok-1", exp = Date.now() + 30 * 60_000) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ access_token: value, expires_at: exp }) });
const limited = () => refuses(429, { code: "rate_limit_exceeded", headers: { "retry-after": "600" } });

test("gigachat: основной упёрся — ключ меняется на токен, и она думает им", async () => {
  reset();
  const h = heart(GIGA);
  sdk().fetchQueue.push(limited(), token(), says("Отвечаю запасной."));
  await h.onMessage(message("расскажи о погоде на Марсе"), KEY);
  assert.equal(last(), "Отвечаю запасной.");
  const [, exchange, chat] = sdk().fetches;
  assert.equal(exchange.url, "https://ngw.devices.sberbank.ru:9443/api/v2/oauth");
  assert.equal(exchange.options.headers.Authorization, "Basic basic-auth-key");
  assert.match(exchange.options.headers.RqUID, /^[0-9a-f-]{36}$/);
  assert.equal(exchange.options.body, "scope=GIGACHAT_API_PERS");
  assert.equal(chat.url, "https://api.giga.chat/v1/chat/completions");
  assert.equal(chat.options.headers.Authorization, "Bearer tok-1");
  assert.equal(JSON.parse(chat.options.body).model, "GigaChat-2");
  assert.equal(JSON.parse(chat.options.body).reasoning_effort, undefined);

  // Второй вопрос: основной отдыхает, токен ещё жив — обмена нет.
  sdk().fetchQueue.push(says("И снова запасной."));
  await h.onMessage(message("а на Венере?"), KEY);
  assert.equal(last(), "И снова запасной.");
  assert.equal(sdk().fetches.length, 4);
  assert.equal(sdk().fetches[3].options.headers.Authorization, "Bearer tok-1");
  // Токен лежит в базе: другой изолят не будет менять ключ заново.
  assert.equal(JSON.parse(sdk().kv.get("heart:token:gigachat")).token, "tok-1");
});

test("gigachat: истёкший токен меняется один раз; отговорка фильтра — не её ответ", async () => {
  reset();
  const h = heart(GIGA);
  sdk().fetchQueue.push(limited(), token("old"), refuses(401), token("new"), says("Теперь слышу."));
  await h.onMessage(message("расскажи о погоде на Марсе"), KEY);
  assert.equal(last(), "Теперь слышу.");
  assert.equal(sdk().fetches.at(-1).options.headers.Authorization, "Bearer new");

  reset();
  const filtered = heart(GIGA);
  sdk().fetchQueue.push(limited(), token(), says("Не люблю менять тему разговора, но вот сейчас тот самый случай.", { finish: "blacklist" }));
  await filtered.onMessage(message("расскажи о погоде на Марсе"), KEY);
  assert.doesNotMatch(last(), /Не люблю менять тему/);
});

test("gigachat: «проверь мозги» — живая проба; нет связи названо причиной, отдых растёт", async () => {
  reset();
  const h = heart(GIGA);
  sdk().fetchQueue.push(says("pong"), Object.assign(new TypeError("fetch failed"), { name: "TypeError" }));
  await h.onMessage(message("проверь мозги", { id: OWNER }), KEY);
  assert.match(last(OWNER), /основной \(gpt-oss-20b\) — отвечает, \d+ мс/);
  assert.match(last(OWNER), /gigachat \(GigaChat-2\) — нет связи при обмене ключа \(TypeError\); если так каждый раз — платформа не принимает его сертификат/);
  // Для остальных это обычные слова: проба только у хозяина.
  await h.onMessage(message("проверь мозги", { id: 5 }), KEY);
  assert.equal(last(5), "ответ из стаба");

  // Нет связи раз за разом: отдых растёт вчетверо, а не повторяется каждую минуту.
  reset();
  let at = NOON;
  const stubborn = heart(GIGA, { now: () => at });
  const rests = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    sdk().fetchQueue.push(limited(), new TypeError("fetch failed"));
    await stubborn.onMessage(message(`вопрос номер ${attempt} про далёкие звёзды`, { id: 30 + attempt }), KEY);
    const giga = (await stubborn.brains.describe({ apiKey: "k" })).find(item => item.provider === "gigachat");
    rests.push(giga.until - at);
    at += 6 * 3600_000 + 700_000;
  }
  assert.deepEqual(rests, [60_000, 240_000, 960_000]);
});

// ── запасные мозги: шлюз с «почти совместимым» API ───────────────────────

const XPL = {
  AI_PROVIDERS: [{
    id: "explabs", name: "Experiential Labs", key: "xpl_test",
    baseUrl: "https://api.experientiallabs.ai/v1",
    models: ["deepseek-v4.1-flash:free", "gpt-6-luna:free"], effort: "low",
  }],
};
const body = (index) => JSON.parse(chats()[index].options.body);

test("запасной провайдер: поле, которое модель не берёт, убирается само и больше не шлётся", async () => {
  reset();
  const h = heart(XPL);
  sdk().fetchQueue.push(limited(), refuses(400, { code: "unsupported_parameter", param: "temperature" }), says("Думаю третьей дорогой."));
  await h.onMessage(message("расскажи о погоде на Марсе"), KEY);
  assert.equal(last(), "Думаю третьей дорогой.");
  assert.equal(chats()[1].url, "https://api.experientiallabs.ai/v1/chat/completions");
  assert.equal(chats()[1].options.headers.Authorization, "Bearer xpl_test");
  assert.equal(body(1).model, "deepseek-v4.1-flash:free", "только бесплатный объём: суффикс остаётся в имени");
  assert.equal(body(1).reasoning_effort, "low", "усилие задано провайдеру в настройках");
  assert.equal(typeof body(1).temperature, "number");
  assert.equal(body(2).temperature, undefined, "повтор — без отвергнутого поля");
  assert.equal(body(2).reasoning_effort, "low");

  // Второй вопрос: урок усвоен — лишнего запроса нет.
  sdk().fetchQueue.push(says("И снова."));
  await h.onMessage(message("а на Венере?"), KEY);
  assert.equal(chats().length, 4);
  assert.equal(body(3).temperature, undefined);

  // `max_tokens` не исчезает, а меняет имя; усилие без названного поля — убирается.
  reset();
  const renamed = heart(XPL);
  sdk().fetchQueue.push(limited(), refuses(400, { code: "unsupported_parameter", param: "max_tokens" }), refuses(400, { code: "unsupported_capability" }), says("Готово."));
  await renamed.onMessage(message("расскажи о погоде на Марсе"), KEY);
  assert.equal(last(), "Готово.");
  assert.equal(body(3).max_tokens, undefined);
  assert.equal(typeof body(3).max_completion_tokens, "number");
  assert.equal(body(3).reasoning_effort, undefined);
});

test("запасной провайдер: 402 и исчерпанный дневной объём — отдых модели, а не поломка", async () => {
  reset();
  const at = NOON;                       // 13:00 UTC: до полуночи одиннадцать часов
  const h = heart(XPL, { now: () => at });
  sdk().fetchQueue.push(limited(), refuses(402, { code: "card_required" }), refuses(429, { code: "insufficient_quota" }));
  await h.onMessage(message("расскажи о погоде на Марсе"), KEY);
  assert.match(last(), /^Я выдохлась: мысли на сегодня кончились\. Вопрос я записала/);
  assert.equal(await h.queue.size(), 1);
  const state = await h.brains.describe({ apiKey: "k" });
  const paid = state.find(item => item.model === "deepseek-v4.1-flash:free");
  const daily = state.find(item => item.model === "gpt-6-luna:free");
  assert.equal(paid.why, "payment");
  assert.equal(paid.until - at, DAY, "ждёт шага человека — сутки не трогается");
  assert.equal(daily.why, "limit");
  assert.equal(daily.until - at, 11 * 3_600_000, "дневной объём — до полуночи по UTC");
  // Следующий вопрос не тратит ни одного запроса на отдыхающих.
  const before = chats().length;
  await h.onMessage(message("а на Венере?"), KEY);
  assert.equal(chats().length, before);

  // 403 о модели — не «ключ отозван»: вторая модель того же ключа отвечает.
  reset();
  const granted = heart(XPL);
  sdk().fetchQueue.push(limited(), refuses(403, { code: "model_not_granted" }), says("Отвечаю второй."));
  await granted.onMessage(message("расскажи о погоде на Марсе"), KEY);
  assert.equal(last(), "Отвечаю второй.");
  assert.equal(body(2).model, "gpt-6-luna:free");
});

test("проверь мозги: каждая модель каждого провайдера; без связи провайдер пробуется один раз", async () => {
  reset();
  const h = heart({ AI_PROVIDERS: [...XPL.AI_PROVIDERS, { ...GIGA.AI_PROVIDERS[0], name: "GigaChat", models: ["GigaChat-3-Ultra", "GigaChat-2-Max", "GigaChat-2"] }] });
  sdk().fetchQueue.push(
    says("pong"),                                                               // основной
    says("pong"),                                                               // deepseek
    refuses(400, { code: "unsupported_parameter", param: "reasoning_effort" }), // luna: усилие не берёт…
    refuses(402, { code: "free_tier_requires_payment" }),                       // …а без него просит карту
    new TypeError("fetch failed"),                                              // GigaChat: обмен ключа не прошёл
  );
  await h.onMessage(message("проверь мозги", { id: OWNER }), KEY);
  const lines = last(OWNER).split("\n").filter(line => line.startsWith("• "));
  assert.equal(lines.length, 4, "три модели GigaChat — одна строка: связи нет у провайдера, а не у модели");
  assert.match(lines[0], /^• основной \(gpt-oss-20b\) — отвечает/);
  assert.match(lines[1], /^• Experiential Labs \(deepseek-v4\.1-flash:free\) — отвечает/);
  assert.match(lines[2], /^• Experiential Labs \(gpt-6-luna:free\) — HTTP 402 \(free_tier_requires_payment\) — нужен шаг в кабинете провайдера.*Сутки её не трогаю$/);
  assert.match(lines[3], /^• GigaChat \(GigaChat-3-Ultra\) — нет связи при обмене ключа/);
  // Проба не шлёт температуру вовсе: ей нужен ответ «жива», а не текст.
  assert.equal(body(1).temperature, undefined);
  assert.equal(body(1).reasoning_effort, "low");
  assert.equal(body(3).reasoning_effort, undefined);
});

// ── проба голоса (0.68.0, идея 216) ────────────────────────────────────────

test("0.68.0: «проба голоса» — хозяину: фраза бесплатной озвучки уходит голосовым; отказ службы и отказ Telegram названы словами", async () => {
  const { source, calls } = await import("./fixtures/kit.mjs");
  const mp3 = new Uint8Array(4096); mp3[0] = 0xff; mp3[1] = 0xf3;
  const audio = (bytes = mp3) => ({ ok: true, status: 200, text: async () => "", arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  // 1. Всё вышло: запрос — к озвучке переводчика, по-русски, с фразой; в чат — голосовое с записью mp3.
  reset();
  let h = heart();
  source(/translate_tts/u, audio());
  await h.onMessage(message("Проба голоса!", { id: OWNER }), KEY);
  const asked = sdk().sourceFetches.at(-1).url;
  assert.match(asked, /^https:\/\/translate\.google\.com\/translate_tts\?ie=UTF-8&client=tw-ob&tl=ru&q=/u);
  assert.match(decodeURIComponent(asked), /Это проба голоса\. Если вы меня слышите, бесплатный путь работает\./u);
  assert.equal(calls("sendVoice").length, 1);
  const sent = calls("sendVoice")[0];
  assert.deepEqual([String(sent.chat_id), sent.voice.name, sent.voice.type, sent.voice.bytes.length], [String(OWNER), "ai.mp3", "audio/mpeg", 4096]);
  assert.match(last(OWNER), /^Проба голоса: получилось — голосовое выше \(4 КБ\)\. Голос готовый, не мой: бесплатная озвучка переводчика Google\. Годится — скажите в чате разработки/u);
  // Другими словами — то же; для остальных это обычные слова.
  for (const said of ["проверь голос", "испытай свой голос", "проба голоса в чате"]) { await h.onMessage(message(said, { id: OWNER }), KEY); }
  assert.equal(calls("sendVoice").length, 4);
  await h.onMessage(message("проба голоса", { id: 5 }), KEY);
  assert.equal(calls("sendVoice").length, 4);
  assert.equal(last(5), "ответ из стаба");

  // 2. Telegram не принял голосовое — ушло звуковым файлом, и об этом сказано.
  reset();
  h = heart();
  source(/translate_tts/u, audio());
  sdk().failing.sendVoice = Object.assign(new Error("Bad Request: wrong file type"), { description: "Bad Request: wrong file type" });
  await h.onMessage(message("проба голоса", { id: OWNER }), KEY);
  assert.equal(calls("sendAudio").length, 1);
  assert.match(last(OWNER), /получилось — звуковой файл выше \(4 КБ\)\..*Голосовым Telegram не принял: Bad Request: wrong file type\./u);
  // Не принял ни так, ни так.
  sdk().failing.sendAudio = new Error("Bad Request: file is too big");
  await h.onMessage(message("проба голоса", { id: OWNER }), KEY);
  assert.match(last(OWNER), /^Проба голоса: звук получен \(4 КБ\), но Telegram его не принял — Bad Request: file is too big\. Перешлите эту строку в чат разработки\.$/u);

  // 3. Служба отказала, прислала не звук или до неё нет дороги — названо словами, в чат ничего не ушло.
  for (const [reply, expected] of [
    [{ ok: false, status: 429, text: async () => "" }, /^Проба голоса: служба озвучки отказала — ответ 429\. Этим путём голосовые не пойдут/u],
    [audio(new TextEncoder().encode("<html>Sorry…</html>")), /^Проба голоса: служба озвучки прислала не звук \(\d+ байт\)\./u],
    [Object.assign(new TypeError("fetch failed"), { name: "TypeError" }), /^Проба голоса: до службы озвучки не дотянулась — TypeError: fetch failed\./u],
  ]) {
    reset();
    h = heart();
    source(/translate_tts/u, reply);
    await h.onMessage(message("проба голоса", { id: OWNER }), KEY);
    assert.match(last(OWNER), expected);
    assert.equal(calls("sendVoice").length + calls("sendAudio").length, 0);
  }
});
