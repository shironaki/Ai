/**
 * Мозги: ответила запасная модель — что об этом узнаёт хозяин.
 *
 * 15.11.2026 хозяин получил весть «△ у меня это работает хуже · основная модель
 * недоступна — думаю запасной (gpt-oss-120b) · лимит вернётся сам» и спросил, что
 * это за ошибка. Ошибки не было: основная упёрлась в лимит бесплатного плана,
 * запасная ответила. Весть не называла ни причины, ни срока, а совет был один
 * на всё — и на отозванный ключ тоже. Здесь проверяется, что теперь:
 * короткий лимит — только счёт; надолго или без хозяина не решится — весть
 * с настоящей причиной, сроком и советом по этой причине.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, reset, last, chats, says, refuses, sdk, toChat, toOwner, OWNER, KEY, BUILD, DAY } from "./fixtures/kit.mjs";

const { createAiService, limitScope, stumbleOf } = await import("../tgcloud/lib/ai-service.js");
const { createBrains, switchKind, restOf, limitWords, LONG_REST_MS } = await import("../tgcloud/lib/brains.js");
const { createPulse } = await import("../tgcloud/lib/pulse.js");
const { createNotices, incidentText } = await import("../tgcloud/lib/notices.js");

const MODELS = { AI_MODELS: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"] };
// 12:00 по Москве.
const NOON = Date.UTC(2026, 10, 18, 9);
const models = () => chats().map(item => JSON.parse(item.options.body).model);
/** Слова Groq о лимите — так, как он их пишет: вид лимита в скобках и три числа. */
const groq = (scope, numbers) => `Rate limit reached for model \`openai/gpt-oss-20b\` in organization \`org_01secretname\` service tier \`on_demand\` on ${scope}: ${numbers}. Please try again in 7.2s. Need more tokens? Upgrade to Dev Tier today.`;
const TPM = groq("tokens per minute (TPM)", "Limit 8000, Used 7421, Requested 1083");
const TPD = groq("tokens per day (TPD)", "Limit 200000, Used 199711, Requested 1322");
const limit = (seconds, words = "") => refuses(429, { code: "rate_limit_exceeded", headers: { "retry-after": String(seconds) }, message: words });
const status = async (h) => { await h.onMessage(message("статус", { id: OWNER }), KEY); return last(OWNER); };
const lineOf = (text, head) => text.split("\n").find(line => line.startsWith(head)) ?? "";
/** Вести о поломках и «к сведению» — без ответов на «статус», которые тоже идут хозяину. */
const alerts = () => toOwner().filter(item => /Хозяин, (?:у меня|к сведению)/u.test(item.text));

test("вид лимита читается из слов провайдера, а сами слова никуда не идут", () => {
  assert.deepEqual(limitScope(TPM), { scope: "tpm", limit: 8000, used: 7421, requested: 1083 });
  assert.deepEqual(limitScope(TPD), { scope: "tpd", limit: 200000, used: 199711, requested: 1322 });
  assert.equal(limitScope(groq("requests per minute (RPM)", "Limit 30, Used 30, Requested 1")).scope, "rpm");
  assert.equal(limitScope(groq("requests per day (RPD)", "Limit 1000, Used 1000, Requested 1")).scope, "rpd");
  // «Запрос слишком большой»: занятого нет, предел и запрос есть.
  assert.deepEqual(limitScope("Request too large for model `x` on tokens per minute (TPM): Limit 8000, Requested 9959, please reduce your message size."), { scope: "tpm", limit: 8000, used: null, requested: 9959 });
  // Другой провайдер пишет иначе — вид лимита узнаётся и без скобок.
  assert.equal(limitScope("Quota exceeded for quota metric GenerateRequestsPerDayPerProjectPerModel-FreeTier").scope, "rpd");
  // Непонятное — пусто, а не догадка.
  for (const words of ["Requests rate limit exceeded", "", null, undefined, 42, {}]) assert.deepEqual(limitScope(words), { scope: "", limit: null, used: null, requested: null });
  // В ответе функции нет ни одной строки длиннее трёх букв: текст провайдера не утекает.
  assert.deepEqual(Object.values(limitScope(TPM)).filter(value => typeof value === "string"), ["tpm"]);

  assert.equal(stumbleOf({ limited: true, status: 429 }), "limit");
  assert.equal(stumbleOf({ gone: true, status: 404 }), "gone");
  assert.equal(stumbleOf({ unpaid: true, status: 402 }), "payment");
  assert.equal(stumbleOf({ keyRejected: true, status: 401 }), "key");
  assert.equal(stumbleOf({ code: "provider_network_error" }), "network");
  assert.equal(stumbleOf({ code: "provider_http_error", status: 503 }), "down");
  assert.equal(stumbleOf({ code: "empty_response" }), "empty");
  assert.equal(stumbleOf({ code: "filtered" }), "filtered");
  assert.equal(stumbleOf({ code: "provider_invalid_response", status: 200 }), "error");

  assert.equal(limitWords("tpm"), "лимит токенов в минуту");
  assert.equal(limitWords("rpd"), "дневной лимит запросов");
  assert.equal(limitWords(""), "лимит");
  // Короткий лимит и долгий: дневной — по слову провайдера, даже если ждать недолго; без слова — по сроку.
  assert.equal(switchKind({ why: "limit", scope: "tpm", until: NOON + 7000 }, NOON), "short");
  assert.equal(switchKind({ why: "limit", scope: "tpd", until: NOON + 7000 }, NOON), "long");
  assert.equal(switchKind({ why: "limit", scope: "", until: NOON + LONG_REST_MS - 1 }, NOON), "short");
  assert.equal(switchKind({ why: "limit", scope: "", until: NOON + LONG_REST_MS }, NOON), "long");
  assert.equal(switchKind({ why: "network", until: NOON + 3_600_000 }, NOON), "network");
  assert.equal(switchKind({}, NOON), "rest");
  // Срок считается от начала отдыха: часовой лимит остаётся долгим и за пять минут до конца.
  const hour = { why: "limit", scope: "", since: NOON, until: NOON + 3_600_000 };
  assert.equal(restOf(hour, NOON + 55 * 60_000), 3_600_000);
  assert.equal(switchKind(hour, NOON + 55 * 60_000), "long");
  assert.equal(restOf({ until: 0 }, NOON), 0);
  assert.equal(restOf({ until: NOON + 7000 }, NOON), 7000, "начало не записано — от сейчас");
});

test("цепочка помнит, какой лимит упёрся, и возвращает час, до которого модель отдыхает", async () => {
  let at = NOON;
  const brains = createBrains({ now: () => at, primary: "a", fallbacks: ["b"], baseUrl: "https://x.example/v1" });
  assert.equal(await brains.rest("main:a", { ms: 7000, why: "limit", scope: "tpm" }), NOON + 7000);
  let [first] = await brains.describe({ apiKey: "k" });
  assert.deepEqual({ ok: first.ok, why: first.why, scope: first.scope, until: first.until, since: first.since }, { ok: false, why: "limit", scope: "tpm", until: NOON + 7000, since: NOON });
  // Отдых кончился — причины и вида лимита в описании больше нет.
  at += 7001;
  [first] = await brains.describe({ apiKey: "k" });
  assert.deepEqual({ ok: first.ok, why: first.why, scope: first.scope, fails: first.fails }, { ok: true, why: "", scope: "", fails: 0 });
  // Нет связи раз за разом: отдых растёт, и счёт подряд виден.
  assert.equal(await brains.rest("main:a", { why: "network" }), at + 60_000);
  at += 60_001;
  assert.equal(await brains.rest("main:a", { why: "network" }), at + 240_000);
  [first] = await brains.describe({ apiKey: "k" });
  assert.equal(first.fails, 2);
  assert.equal(first.scope, "", "вид лимита к обрыву связи не относится");
  assert.equal(await brains.retire("main:b", { why: "gone" }), at + 86_400_000);
  // Ответила — всё забыто.
  await brains.healthy("main:a");
  assert.equal((await brains.describe({ apiKey: "k" }))[0].ok, true);
});

test("сервис называет, почему ответила не основная: её отказ, её отдых — или так и задумано", async () => {
  let at = NOON;
  const replies = [];
  const asked = [];
  const fetchImpl = async (url, options) => {
    asked.push(JSON.parse(options.body).model);
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return next ?? says("ответ");
  };
  const brains = createBrains({ now: () => at, primary: "a", fallbacks: ["b", "c"], baseUrl: "https://x.example/v1" });
  const ai = createAiService({ fetchImpl, getApiKey: () => "k", getModel: () => "a", providerBaseUrl: "https://x.example/v1", brains, now: () => at, minimumIntervalMs: 0 });
  const ask = (extra = {}) => ai.generateReply({ userId: 1, chatId: 1, prompt: "вопрос", ...extra });

  // Основная ответила сама: причины нет вовсе.
  let answer = await ask();
  assert.equal(answer.switched, false);
  assert.equal("cause" in answer, false);

  // Отказ в этом же запросе: причина, вид лимита, числа провайдера и час возврата.
  replies.push(limit(7, TPM));
  answer = await ask();
  assert.equal(answer.model, "b");
  assert.deepEqual(answer.cause, { model: "a", why: "limit", until: NOON + 7000, since: NOON, status: 429, scope: "tpm", limit: 8000, used: 7421, requested: 1083, fails: 0, fresh: true });

  // Основная ещё отдыхает: отказа в этом запросе не было — причина та же, чисел уже нет.
  at += 2000;
  answer = await ask();
  assert.deepEqual(answer.cause, { model: "a", why: "limit", until: NOON + 7000, since: NOON, status: null, scope: "tpm", limit: null, used: null, requested: null, fails: 0, fresh: false });

  // Вернулась — и снова причины нет.
  at += 6000;
  answer = await ask();
  assert.equal(answer.model, "a");
  assert.equal(answer.switched, false);

  // Перепроверка «не этой моделью»: основная в строю, это выбор, а не запинка.
  asked.length = 0;
  answer = await ask({ avoidModel: "a" });
  assert.deepEqual(asked, ["b"]);
  assert.equal(answer.switched, true);
  assert.equal(answer.cause.why, "choice");
  // Обе перепроверяющие не ответили — вернулись к основной: это тоже не её запинка.
  replies.push(refuses(503), refuses(503));
  answer = await ask({ avoidModel: "a" });
  assert.equal(answer.model, "a");
  assert.equal(answer.switched, true);
  assert.equal(answer.cause.why, "choice");

  // Обрыв связи, пустой ответ и снятая модель — каждое своим словом; пустой ответ отдыха не даёт.
  at += 120_000;
  replies.push(Error("network is down"));
  answer = await ask();
  assert.deepEqual({ why: answer.cause.why, until: answer.cause.until, fails: answer.cause.fails, fresh: answer.cause.fresh }, { why: "network", until: at + 60_000, fails: 1, fresh: true });
  at += 61_000;
  replies.push(says(""));
  answer = await ask();
  assert.deepEqual({ why: answer.cause.why, until: answer.cause.until, fresh: answer.cause.fresh }, { why: "empty", until: 0, fresh: true });
  replies.push(refuses(404, { code: "model_not_found" }));
  answer = await ask();
  assert.deepEqual({ why: answer.cause.why, until: answer.cause.until, status: answer.cause.status }, { why: "gone", until: at + 86_400_000, status: 404 });
  // Ни в одной причине нет внутреннего имени записи цепочки и слов провайдера.
  assert.equal("id" in answer.cause, false);
  assert.doesNotMatch(JSON.stringify(answer.cause), /org_|Rate limit|Upgrade/u);
});

test("короткий лимит: запасная ответила — хозяину не пишется ничего, а причина видна в «статусе»", async () => {
  reset();
  let at = NOON;
  const h = heart(MODELS, { now: () => at });
  sdk().fetchQueue.push(limit(7, TPM), says("ответ запасной"));
  await h.onMessage(message("расскажи что-нибудь"), KEY);
  assert.equal(last(), "ответ запасной", "человек получил ответ");
  assert.deepEqual(models(), ["openai/gpt-oss-20b", "openai/gpt-oss-120b"]);
  assert.equal(toOwner().length, 0, "лимит на семь секунд — не весть");

  // Пока основная отдыхает, отвечает запасная — и это тоже не весть.
  at += 3000;
  sdk().fetchQueue.push(says("ещё ответ"));
  await h.onMessage(message("а ещё что-нибудь"), KEY);
  assert.equal(models().at(-1), "openai/gpt-oss-120b");
  assert.equal(toOwner().length, 0);

  const text = await status(h);
  assert.equal(lineOf(text, "Мозги:"), "Мозги: gpt-oss-20b (осн.) — лимит токенов в минуту до 12:00 · gpt-oss-120b · llama-3.3-70b-versatile");
  // Запинка записана один раз — когда случилась, с числами провайдера; второй ответ запасной её не переписал.
  assert.equal(lineOf(text, "Запинка"), "Запинка основной (gpt-oss-20b): 12:00 — лимит токенов в минуту (HTTP 429, предел 8 000, занято 7 421, запрос 1 083), отдых 7 с; ответила gpt-oss-120b");
  assert.match(lineOf(text, "Сегодня:"), /Лимит: думала запасной: 2 \(короткий лимит 2\)/u);
  assert.doesNotMatch(text, /org_01secretname|Upgrade|Rate limit reached/u, "слова провайдера в статус не попадают");
  assert.doesNotMatch(lineOf(text, "Сбои:"), /Модели|brains/u, "и в сбоях этого нет");

  // Семь секунд прошло — основная вернулась сама.
  at += 5000;
  sdk().fetchQueue.push(says("снова основная"));
  await h.onMessage(message("а сейчас?"), KEY);
  assert.equal(models().at(-1), "openai/gpt-oss-20b");
  assert.equal((await h.status()).today.switched, 2);
  assert.equal(alerts().length, 0);
});

test("дневной лимит: одна весть в сутки — с причиной, сроком и без слова «недоступна»", async () => {
  reset();
  let at = NOON;
  const h = heart(MODELS, { now: () => at });
  // Дневное окно у провайдера скользящее: ждать он просит пять минут, но лимит — дневной.
  sdk().fetchQueue.push(limit(300, TPD), says("ответ запасной"));
  await h.onMessage(message("расскажи что-нибудь"), KEY);
  assert.equal(last(), "ответ запасной\n\nЯ сегодня утомилась: дальше отвечу короче.");
  assert.equal(toOwner().length, 1);
  assert.equal(toOwner()[0].text, [
    "ℹ️ Хозяин, к сведению — это не поломка",
    "━━━━━━━━━━━━━━━━━━━━",
    "Где: Модели",
    "Что: у основной модели gpt-oss-20b вышел дневной лимит токенов — отвечаю запасной (gpt-oss-120b); основную попробую снова в 12:05",
    "Что делать: Ничего: запасная отвечает так же, лимит вернётся сам. Упрутся и запасные — скажу отдельно.",
    "Код: brains:limit",
  ].join("\n"));

  // Тот же день, запасная отвечает дальше — второй вести нет.
  for (let i = 0; i < 3; i++) {
    at += 60_000;
    sdk().fetchQueue.push(says(`ответ ${i}`));
    await h.onMessage(message(`вопрос номер ${i} о чём-нибудь`), KEY);
  }
  assert.equal(alerts().length, 1);
  const text = await status(h);
  assert.match(lineOf(text, "Сегодня:"), /думала запасной: 4 \(долгий лимит 4\)/u);
  // В «статусе» это не сбой, а «к сведению»: сбоев нет.
  assert.match(lineOf(text, "Сбои:"), /^Сбои: нет · к сведению: Модели — у основной модели gpt-oss-20b вышел дневной лимит токенов — отвечаю запасной \(gpt-oss-120b\); основную попробую снова в 12:0\d \(12:03, 4 раза\)$/u);

  // Провайдер вида лимита не назвал, но ждать просит час — это тоже надолго.
  reset();
  const other = heart(MODELS, { now: () => NOON });
  sdk().fetchQueue.push(limit(3600), says("ответ запасной"));
  await other.onMessage(message("расскажи что-нибудь"), KEY);
  assert.match(toOwner()[0].text, /Что: у основной модели gpt-oss-20b вышел лимит — отвечаю запасной \(gpt-oss-120b\); основную попробую снова в 13:00\n/u);
  assert.match(toOwner()[0].text, /Код: brains:limit$/u);

  // Срок отдыха и час возврата сходятся: полтора часа — это «1 ч 30 мин», а не «2 ч».
  reset();
  const long = heart(MODELS, { now: () => NOON });
  sdk().fetchQueue.push(limit(5400, TPD), says("ответ запасной"));
  await long.onMessage(message("расскажи что-нибудь"), KEY);
  assert.match(toOwner()[0].text, /основную попробую снова в 13:30\n/u);
  assert.match(lineOf(await status(long), "Запинка"), /, отдых 1 ч 30 мин; ответила gpt-oss-120b$/u);
});

test("модель снята, провайдер ждёт оплаты, ключ не принят — весть сразу и с советом по этой причине", async () => {
  reset();
  let h = heart(MODELS, { now: () => NOON });
  sdk().fetchQueue.push(refuses(404, { code: "model_not_found" }), says("жива"));
  await h.onMessage(message("расскажи что-нибудь"), KEY);
  assert.equal(last(), "жива");
  assert.equal(toOwner().length, 1);
  assert.match(toOwner()[0].text, /^△ Хозяин, у меня это работает хуже\n/u);
  assert.match(toOwner()[0].text, /Что: основная модель gpt-oss-20b закрыта или снята у провайдера \(HTTP 404\) — отвечаю запасной \(gpt-oss-120b\)\nЧто делать: Имя основной модели пора заменить в настройках: напишите об этом в рабочий чат\. До тех пор отвечаю запасными\.\nКод: brains:gone$/u);
  assert.doesNotMatch(toOwner()[0].text, /лимит вернётся/u, "совет «лимит вернётся сам» здесь был бы неправдой");

  reset();
  h = heart(MODELS, { now: () => NOON });
  sdk().fetchQueue.push(refuses(402, { code: "payment_required" }), says("жива"));
  await h.onMessage(message("расскажи что-нибудь"), KEY);
  assert.match(toOwner()[0].text, /Что: провайдер основной модели gpt-oss-20b ждёт шага в кабинете \(HTTP 402\) — отвечаю запасной \(gpt-oss-120b\)\nЧто делать: Загляните в кабинет провайдера[^\n]+\nКод: brains:payment$/u);

  // Ключ основного провайдера отозван, выручил другой провайдер: это поломка, и лимит тут ни при чём.
  reset();
  h = heart({ AI_PROVIDERS: [{ id: "spare", baseUrl: "https://spare.example/v1", models: ["spare-1"], key: "spare-key" }] }, { now: () => NOON });
  sdk().fetchQueue.push(refuses(401, { code: "invalid_api_key" }), says("ответ запасного провайдера"));
  await h.onMessage(message("расскажи что-нибудь"), KEY);
  assert.equal(last(), "ответ запасного провайдера");
  assert.equal(toOwner().length, 1);
  assert.equal(toOwner()[0].text, [
    "🚨 Хозяин, у меня это сломалось",
    "━━━━━━━━━━━━━━━━━━━━",
    "Где: Модели",
    "Что: ключ основного провайдера не принят (HTTP 401) — отвечает запасной провайдер (spare-1)",
    "Что делать: Проверьте строку AI_PROVIDER_KEY в файле ~/.heart.env и опубликуйте заново: bash scripts/phone.sh deploy.",
    "Код: brains:key",
  ].join("\n"));
});

test("запасная, которой больше нет: владелец узнаёт об этом, а не через три месяца", async () => {
  // Основная упёрлась в минутный лимит, первая запасная закрыта для ключа, ответила вторая.
  reset();
  let at = NOON;
  let h = heart({ AI_MODELS: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"] }, { now: () => at });
  sdk().fetchQueue.push(limit(7, TPM), refuses(403, { code: "model_permission_denied" }), says("думаю третьей"));
  await h.onMessage(message("расскажи что-нибудь"), KEY);
  assert.equal(last(), "думаю третьей");
  assert.equal(alerts().length, 1, "короткий лимит — не весть, а закрытая запасная — весть");
  assert.equal(alerts()[0].text, [
    "△ Хозяин, у меня это работает хуже",
    "━━━━━━━━━━━━━━━━━━━━",
    "Где: Модели",
    "Что: запасная модель llama-3.3-70b-versatile закрыта или снята у провайдера (HTTP 403) — сутки её не трогаю",
    "Что делать: Имя запасной модели пора заменить в настройках: напишите об этом в рабочий чат. Остальные модели отвечают.",
    "Код: brains:spare_gone:llama-3.3-70b-versatile",
  ].join("\n"));
  // Сутки её не спрашивают — и второй вести за эти сутки нет.
  at += 3_600_000;
  sdk().fetchQueue.push(limit(7, TPM), says("снова третьей"));
  await h.onMessage(message("расскажи ещё что-нибудь"), KEY);
  assert.deepEqual(models().slice(-2), ["openai/gpt-oss-20b", "openai/gpt-oss-120b"]);
  assert.equal(alerts().length, 1);

  // То же в экзамене: вопрос без собеседника тоже находит мёртвую запасную.
  reset();
  h = heart({ AI_MODELS: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"] }, { now: () => NOON });
  sdk().fetchQueue.push(limit(7, TPM), refuses(404, { code: "model_not_found" }), says("а"), says("б"), says("в"));
  await h.onMessage(message("экзамен", { id: OWNER }), KEY);
  assert.equal(alerts().length, 1);
  assert.match(alerts()[0].text, /Что: запасная модель llama-3\.3-70b-versatile закрыта или снята у провайдера \(HTTP 404\)/u);

  // Модель, которую сердце само нашло в списке провайдера, в настройках не записана: менять нечего — вести нет.
  reset();
  at = NOON;
  h = heart({ AI_MODELS: [] }, { now: () => at });
  sdk().fetchQueue.push(limit(600, TPM));
  await h.onMessage(message("расскажи что-нибудь"), KEY);
  assert.match(last(), /Вопрос я записала/u);
  const before = alerts().length;
  // Знакомых моделей нет: спрошен список провайдера, в нём нашлась ещё одна — и она закрыта для ключа.
  at += 60_000;
  sdk().fetchQueue.push(
    { ok: true, status: 200, json: async () => ({ data: [{ id: "openai/gpt-oss-20b" }, { id: "llama-9-found" }, { id: "whisper-large-v3" }] }) },
    refuses(403, { code: "model_permission_denied" }),
  );
  await h.onMessage(message("расскажи ещё что-нибудь", { id: 9 }), KEY);
  assert.equal(models().at(-1), "llama-9-found", "найденная модель спрошена");
  assert.equal(alerts().slice(before).filter(item => /spare_gone/u.test(item.text)).length, 0);
});

test("все упёрлись, а в конце цепочки — мёртвая модель: вопрос записан, а не потерян", async () => {
  // Так стояло вживую: две модели в лимите, третья отключена провайдером три месяца назад.
  // Итогом запроса был её отказ — «поломка»: человек слышал «неполадка на моей стороне», вопрос пропадал.
  reset();
  let at = NOON;
  const h = heart({ AI_MODELS: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"] }, { now: () => at });
  sdk().fetchQueue.push(limit(1800, TPD), limit(1200, TPD), refuses(400, { code: "model_decommissioned" }));
  const asked = message("сколько планет в Солнечной системе?");
  await h.onMessage(asked, KEY);
  assert.deepEqual(models(), ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "llama-3.3-70b-versatile"]);
  assert.match(last(), /^Я выдохлась: мысли на сегодня кончились\. Вопрос я записала и отвечу сама, как только отдохну — примерно после 12:20\.$/u);
  assert.doesNotMatch(last(), /неполадка/u);
  assert.equal((await h.status()).queue, 1, "вопрос в очереди");
  const codes = alerts().map(item => item.text.split("\n").at(-1));
  assert.deepEqual(codes, ["Код: brains:spare_gone:llama-3.3-70b-versatile", "Код: brains:exhausted"]);
  assert.equal(alerts().some(item => /сломалось/u.test(item.text)), false, "лимит — не поломка");

  // Лимит вернулся — она отвечает сама, ответом на тот самый вопрос.
  at += 1201_000;
  sdk().fetchQueue.push(says("Планет восемь."));
  await h.onMessage(message("кто ты", { id: 9 }), KEY);
  assert.equal((await h.status()).queue, 0);
  const late = toChat(5).at(-1);
  assert.equal(late.text, "Планет восемь.");
  assert.equal(late.reply_parameters.message_id, asked.message_id, "ответ привязан к вопросу");

  // Остальные уже отдыхали по лимиту, а спросить в этом запросе удалось только мёртвую — это тоже «лимит».
  reset();
  at = NOON;
  const other = heart({ AI_MODELS: ["llama-3.3-70b-versatile"] }, { now: () => at });
  sdk().fetchQueue.push(limit(1800, TPD), says("ответ запасной"));
  await other.onMessage(message("расскажи что-нибудь"), KEY);
  assert.equal(last(), "ответ запасной\n\nЯ сегодня утомилась: дальше отвечу короче.");
  at += 60_000;
  sdk().fetchQueue.push(refuses(404, { code: "model_not_found" }));
  await other.onMessage(message("а теперь расскажи другое", { id: 9 }), KEY);
  assert.match(last(9), /Вопрос я записала и отвечу сама/u);
  assert.equal((await other.status()).queue, 1);
});

test("запасной провайдер: ключ не принят или ждёт оплаты — названа его строка в файле ключей", async () => {
  const spare = { AI_MODELS: [], AI_PROVIDERS: [
    { id: "mistral", name: "Mistral", baseUrl: "https://mistral.example/v1", models: ["mistral-small-latest"], key: "m-key" },
    { id: "spare", baseUrl: "https://spare.example/v1", models: ["spare-1"], key: "spare-key" },
  ] };
  reset();
  let h = heart(spare, { now: () => NOON });
  sdk().fetchQueue.push(limit(7, TPM), refuses(401, { code: "invalid_api_key" }), says("ответ второго запасного"));
  await h.onMessage(message("расскажи что-нибудь"), KEY);
  assert.equal(last(), "ответ второго запасного");
  assert.equal(alerts().length, 1);
  assert.equal(alerts()[0].text, [
    "△ Хозяин, у меня это работает хуже",
    "━━━━━━━━━━━━━━━━━━━━",
    "Где: Модели",
    "Что: ключ запасного провайдера Mistral не принят (HTTP 401)",
    "Что делать: Проверьте строку KEY_MISTRAL в файле ~/.heart.env и опубликуйте заново: bash scripts/phone.sh deploy.",
    "Код: brains:spare_key:mistral",
  ].join("\n"));

  reset();
  h = heart(spare, { now: () => NOON });
  sdk().fetchQueue.push(limit(7, TPM), refuses(402, { code: "payment_required" }), says("ответ второго запасного"));
  await h.onMessage(message("расскажи что-нибудь"), KEY);
  assert.equal(last(), "ответ второго запасного");
  assert.equal(alerts().length, 1);
  assert.match(alerts()[0].text, /Что: запасной провайдер Mistral ждёт шага в кабинете \(HTTP 402\) — его модель mistral-small-latest сутки не трогаю\nЧто делать: Загляните в кабинет провайдера[^\n]+\nКод: brains:spare_payment:mistral$/u);
});

test("ключ основного провайдера не принят и выручить некому — одна весть о поломке, с советом для телефона", async () => {
  reset();
  const h = heart(MODELS, { now: () => NOON });
  sdk().fetchQueue.push(refuses(401, { code: "invalid_api_key" }));
  await h.onMessage(message("расскажи что-нибудь"), KEY);
  assert.equal(chats().length, 1, "тот же ключ на другой модели не поможет");
  assert.match(last(), /неполадка на моей стороне/u);
  assert.equal(alerts().length, 1, "одна весть, а не две об одном");
  assert.equal(alerts()[0].text, [
    "🚨 Хозяин, у меня это сломалось",
    "━━━━━━━━━━━━━━━━━━━━",
    "Где: Модели",
    "Что: ключ основного провайдера не принят (HTTP 401) — ответить не вышло",
    "Что делать: Проверьте строку AI_PROVIDER_KEY в файле ~/.heart.env и опубликуйте заново: bash scripts/phone.sh deploy.",
    "Код: brains:key",
  ].join("\n"));
  assert.doesNotMatch(alerts()[0].text, /Heart → deploy|секрет/u, "кнопкой в Actions владелец не пользуется");

  // Нет связи с провайдером: вопрос записан, совет — переждать, а не проверять ключ.
  reset();
  const down = heart({ AI_MODELS: [] }, { now: () => NOON });
  sdk().fetchQueue.push(Error("network is down"));
  await down.onMessage(message("расскажи что-нибудь"), KEY);
  assert.match(last(), /Вопрос я записала и отвечу сама, как только связь вернётся/u);
  assert.equal(alerts().length, 1);
  assert.match(alerts()[0].text, /Где: Провайдер моделей\n/u);
  assert.match(alerts()[0].text, /Что делать: Обычно это сбой у провайдера и проходит само\. Держится дольше часа — скажите мне «проверь мозги» и перешлите ответ в рабочий чат\.\nКод: provider:provider_network_error$/u);
});

test("цепочка основного ключа: отключённых провайдером моделей в ней нет, а Qwen отвечает без раздумий", async () => {
  // 16.08.2026 провайдер отключил на бесплатном плане обе модели llama; три месяца они стояли в списке
  // запасных мёртвыми, и основной ключ на деле держался на двух моделях. Имена — со страницы «Deprecations».
  const { CONFIG } = await import("../tgcloud/lib/config.js");
  const retired = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "qwen/qwen3.6-27b", "qwen/qwen3-32b", "meta-llama/llama-4-scout-17b-16e-instruct", "moonshotai/kimi-k2-instruct-0905"];
  const chain = [CONFIG.AI_MODEL, ...CONFIG.AI_MODELS];
  for (const name of retired) assert.equal(chain.includes(name), false, `${name} отключена провайдером`);
  assert.equal(new Set(chain).size, chain.length, "без повторов");
  assert.ok(CONFIG.AI_MODELS.length >= 2, "запасных на основном ключе — не меньше двух");

  // Qwen 3 на основном ключе: раздумья выключены — иначе до первого слова уходят сотни токенов.
  reset();
  const h = heart({ AI_MODELS: ["qwen/qwen3.8-27b"] }, { now: () => NOON });
  sdk().fetchQueue.push(limit(7, TPM), says("ответ третьей"));
  await h.onMessage(message("расскажи что-нибудь"), KEY);
  assert.equal(last(), "ответ третьей");
  const bodies = chats().map(item => JSON.parse(item.options.body));
  assert.deepEqual(bodies.map(body => [body.model, body.reasoning_effort]), [["openai/gpt-oss-20b", "low"], ["qwen/qwen3.8-27b", "none"]]);
  // У другого провайдера то же имя ничего не значит: усилие задаёт его строка в настройках.
  reset();
  const other = heart({ AI_MODELS: [], AI_PROVIDERS: [{ id: "spare", baseUrl: "https://spare.example/v1", models: ["qwen-3.8-27b"], key: "k" }] }, { now: () => NOON });
  sdk().fetchQueue.push(limit(7, TPM), says("ответ чужой"));
  await other.onMessage(message("расскажи что-нибудь"), KEY);
  assert.equal(JSON.parse(chats().at(-1).options.body).reasoning_effort, undefined);
});

test("нет связи: раз и два — только счёт; третий раз подряд — весть со сроком", async () => {
  reset();
  let at = NOON;
  const h = heart(MODELS, { now: () => at });
  const drop = async (text) => {
    sdk().fetchQueue.push(Error("network is down"), says("ответ запасной"));
    await h.onMessage(message(text), KEY);
    assert.equal(last(), "ответ запасной");
  };
  await drop("расскажи что-нибудь");
  assert.equal(toOwner().length, 0, "один обрыв связи — не весть");
  at += 61_000;
  await drop("расскажи ещё что-нибудь");
  assert.equal(toOwner().length, 0);
  // Третий обрыв подряд: основная уходит на шестнадцать минут — это уже надолго.
  at += 241_000;
  await drop("и ещё что-нибудь расскажи");
  assert.equal(toOwner().length, 1);
  assert.match(toOwner()[0].text, /△ Хозяин, у меня это работает хуже/u);
  assert.match(toOwner()[0].text, /Что: с основной моделью gpt-oss-20b нет связи 3 раза подряд — отвечаю запасной \(gpt-oss-120b\); основную попробую снова в 12:21\nЧто делать: Обычно это сбой у провайдера и проходит само\. Держится дольше суток — скажите мне «проверь мозги» и перешлите ответ в рабочий чат\.\nКод: brains:offline$/u);
  const text = await status(h);
  assert.equal(lineOf(text, "Запинка"), "Запинка основной (gpt-oss-20b): 12:05 — нет связи (3 раза подряд), отдых 16 мин; ответила gpt-oss-120b");
  assert.match(lineOf(text, "Сегодня:"), /думала запасной: 3 \(нет связи 3\)/u);
});

test("пустой ответ и сбой у провайдера: разовое — счёт; десятый раз за день — одна весть с разбивкой", async () => {
  reset();
  let at = NOON;
  const h = heart(MODELS, { now: () => at });
  // Основная вернула пустой ответ: спрошена следующая, хозяину — ничего.
  sdk().fetchQueue.push(says(""), says("ответ запасной"));
  await h.onMessage(message("расскажи что-нибудь"), KEY);
  assert.equal(last(), "ответ запасной");
  assert.equal(toOwner().length, 0);
  assert.equal(lineOf(await status(h), "Запинка"), "Запинка основной (gpt-oss-20b): 12:00 — пустой ответ; ответила gpt-oss-120b");

  // Сбой у провайдера: каждый раз основная отдыхает минуту, отвечает запасная.
  for (let i = 0; i < 8; i++) {
    at += 61_000;
    sdk().fetchQueue.push(refuses(503, { code: "service_unavailable" }), says(`ответ ${i}`));
    await h.onMessage(message(`вопрос номер ${i} о чём-нибудь`), KEY);
  }
  assert.equal(alerts().length, 0, "девять раз за день — ещё не весть");
  at += 61_000;
  sdk().fetchQueue.push(refuses(503, { code: "service_unavailable" }), says("десятый"));
  await h.onMessage(message("и ещё один вопрос о чём-нибудь"), KEY);
  assert.equal(last(), "десятый");
  assert.equal(alerts().length, 1);
  assert.match(alerts()[0].text, /Что: основная модель gpt-oss-20b сегодня подвела 10 раз \(сбой у провайдера 9, пустой ответ 1\) — отвечала запасная \(gpt-oss-120b\)\nЧто делать: Запасные справляются\. Если так и завтра — скажите мне «проверь мозги» и перешлите ответ в рабочий чат\.\nКод: brains:shaky$/u);
  // Одиннадцатый — без второй вести.
  at += 61_000;
  sdk().fetchQueue.push(refuses(503, { code: "service_unavailable" }), says("одиннадцатый"));
  await h.onMessage(message("и последний вопрос о чём-нибудь"), KEY);
  assert.equal(alerts().length, 1);
});

test("отдых начался не в разговоре (экзамен): запинка всё равно записана, а перепроверка другой моделью — не запинка", async () => {
  reset();
  let at = NOON;
  const h = heart(MODELS, { now: () => at });
  // Экзамен: первый же вопрос упёрся в минутный лимит основной — на вопросы ответила запасная.
  sdk().fetchQueue.push(limit(40, TPM), says("а"), says("б"), says("в"));
  await h.onMessage(message("экзамен", { id: OWNER }), KEY);
  assert.deepEqual(models(), ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "openai/gpt-oss-120b", "openai/gpt-oss-120b"]);
  assert.equal(alerts().length, 0);
  // Разговор, пока основная отдыхает: числа провайдера остались в экзамене, причина и вид лимита — известны.
  at += 10_000;
  sdk().fetchQueue.push(says("ответ запасной"));
  await h.onMessage(message("расскажи что-нибудь"), KEY);
  assert.equal(last(), "ответ запасной");
  assert.equal(lineOf(await status(h), "Запинка"), "Запинка основной (gpt-oss-20b): 12:00 — лимит токенов в минуту, отдых 40 с; ответила gpt-oss-120b");
  assert.equal((await h.status()).today.switched, 1);
  assert.equal(alerts().length, 0);

  // «Ты уверена?» спрашивает другую модель нарочно: основная в строю, считать и писать нечего.
  reset();
  const sure = heart(MODELS, { now: () => NOON });
  sdk().fetchQueue.push(says("Столица Австралии — Сидней."));
  await sure.onMessage(message("какая столица Австралии?"), KEY);
  sdk().fetchQueue.push(says("Нет: Канберра."));
  await sure.onMessage(message("ты уверена?"), KEY);
  assert.deepEqual(models(), ["openai/gpt-oss-20b", "openai/gpt-oss-120b"]);
  assert.match(last(), /Перепроверила другой моделью/u);
  assert.equal((await sure.status()).today.switched, undefined);
  assert.equal(toOwner().length, 0);
  assert.equal(lineOf(await status(sure), "Запинка"), "");
});

test("«лимит на исходе» и «все модели упёрлись» — с названием, сроком и своим советом", async () => {
  reset();
  let h = heart({}, { now: () => NOON });
  sdk().fetchQueue.push(says("ответ", { headers: { "x-ratelimit-remaining-requests": "40", "x-ratelimit-limit-requests": "1000" } }));
  await h.onMessage(message("расскажи что-нибудь"), KEY);
  assert.equal(toOwner()[0].text, [
    "ℹ️ Хозяин, к сведению — это не поломка",
    "━━━━━━━━━━━━━━━━━━━━",
    "Где: Модели",
    "Что: лимит модели gpt-oss-20b на исходе: осталось 40 из 1000 запросов до сброса",
    "Что делать: Ничего: людям я скажу, что устала, и отвечать им будут запасные модели; остаток основной берегу для вас. Лимит вернётся сам.",
    "Код: brains:low",
  ].join("\n"));

  reset();
  h = heart({}, { now: () => NOON });
  sdk().fetchQueue.push(limit(1800, TPD));
  await h.onMessage(message("сколько планет в Солнечной системе?"), KEY);
  assert.match(last(), /Вопрос я записала и отвечу сама/u);
  assert.equal(toOwner()[0].text, [
    "△ Хозяин, у меня это работает хуже",
    "━━━━━━━━━━━━━━━━━━━━",
    "Где: Модели",
    "Что: все модели упёрлись в лимит — вопросы записываю и отвечу сама, примерно после 12:30",
    "Что делать: Лимит вернётся сам, вопросы не пропадут. Чтобы так не было — ключ ещё одного провайдера в файле ~/.heart.env: список в docs/BRAINS.md.",
    "Код: brains:exhausted",
  ].join("\n"));
});

test("утренняя сводка: день на запасной из-за лимита — это не сбой, и причины названы числами", async () => {
  reset();
  let at = NOON;
  const h = heart({ SELF_REPORTS: true, ...MODELS }, { now: () => at });
  sdk().kv.set("heart:build", JSON.stringify({ build: BUILD, at }));
  // Минутный лимит дважды за день и дневной — под вечер.
  sdk().fetchQueue.push(limit(7, TPM), says("раз"));
  await h.onMessage(message("расскажи что-нибудь"), KEY);
  at += 3_600_000;
  sdk().fetchQueue.push(limit(9, TPM), says("два"));
  await h.onMessage(message("расскажи ещё что-нибудь"), KEY);
  assert.equal(alerts().length, 0);
  at += 3_600_000;
  sdk().fetchQueue.push(limit(900, TPD), says("три"));
  await h.onMessage(message("и ещё что-нибудь расскажи"), KEY);
  assert.equal(alerts().length, 1);
  assert.match(alerts()[0].text, /^ℹ️ Хозяин, к сведению — это не поломка\n/u);

  at += DAY;
  sdk().fetchQueue.push(says("доброе"));
  await h.onMessage(message("доброе утро, как спалось?"), KEY);
  const digest = toOwner().find(item => /вот мой вчерашний день/u.test(item.text));
  assert.ok(digest, "сводка пришла");
  assert.match(digest.text, /\nЛимит: думала запасной: 3 \(короткий лимит 2, долгий лимит 1\)\n/u);
  assert.match(digest.text, /\nСбои: нет$/u, "«к сведению» в сбои не попадает");
});

test("«к сведению» — третий тон вести: не поломка и не «работает хуже»", async () => {
  assert.match(incidentText({ title: "Модели", detail: "дневной лимит вышел", severity: "info" }), /^ℹ️ Хозяин, к сведению — это не поломка\n/u);
  assert.match(incidentText({ title: "Модели", detail: "нет связи", severity: "degraded" }), /^△ Хозяин, у меня это работает хуже\n/u);
  // Незнакомый тон — поломка: лучше встревожить зря, чем промолчать о сломанном.
  assert.match(incidentText({ title: "Модели", detail: "что-то", severity: "новый" }), /^🚨 Хозяин, у меня это сломалось\n/u);
  assert.match(incidentText({ title: "Модели", detail: "что-то" }), /^🚨 Хозяин, у меня это сломалось\n/u);

  const sent = [];
  const notices = createNotices({ ownerId: 7, now: () => NOON, send: async (id, text) => { sent.push(text); return {}; } });
  await notices.report({ component: "brains", code: "limit", title: "Модели", severity: "info", detail: "дневной лимит вышел", hint: "Ничего." });
  assert.equal(sent.length, 1);
  assert.equal(sent[0], "ℹ️ Хозяин, к сведению — это не поломка\n━━━━━━━━━━━━━━━━━━━━\nГде: Модели\nЧто: дневной лимит вышел\nЧто делать: Ничего.\nКод: brains:limit");
  assert.equal((await notices.list())[0].severity, "info");
  assert.equal(await notices.text(), "Сбои (за сутки):\nℹ️ Модели: дневной лимит вышел");
  // Тот же день — второй раз не пишется, как и любая весть.
  await notices.report({ component: "brains", code: "limit", title: "Модели", severity: "info", detail: "дневной лимит вышел" });
  assert.equal(sent.length, 1);
  // Причина, две модели и срок — длиннее 160 знаков: срок стоит в конце, и резать его нельзя.
  const long = "основная модель gpt-oss-20b сегодня подвела 10 раз (нет связи 3, сбой у провайдера 4, пустой ответ 2, фильтр провайдера 1) — отвечала запасная (mistral-small-latest); основную попробую снова в 14:30";
  assert.ok(long.length > 160 && long.length < 240);
  await notices.report({ component: "brains", code: "shaky", title: "Модели", severity: "degraded", detail: long });
  assert.ok(sent[1].includes(`Что: ${long}\n`), "весть не обрезана");
  // А предел всё же есть: 240 знаков.
  await notices.report({ component: "brains", code: "other", title: "Модели", detail: "я ".repeat(200) });
  assert.equal(sent[2].split("\n").find(line => line.startsWith("Что: ")).length, "Что: ".length + 240);
});

test("сводка дня называет, почему отвечала запасная; старые счётчики без причин читаются как раньше", () => {
  const pulse = createPulse({});
  const line = (counters) => pulse.lines(counters).find(item => item.startsWith("Лимит:")) ?? "";
  assert.equal(line({ switched: 37, "switched:short": 30, "switched:long": 5, "switched:network": 2 }), "Лимит: думала запасной: 37 (короткий лимит 30, долгий лимит 5, нет связи 2)");
  assert.equal(line({ switched: 3, "switched:empty": 1, "switched:down": 2 }), "Лимит: думала запасной: 3 (сбой у провайдера 2, пустой ответ 1)");
  // День, записанный сборкой до 0.32.1: причин нет — скобок нет.
  assert.equal(line({ switched: 4 }), "Лимит: думала запасной: 4");
  assert.equal(line({ replies: 5 }), "");
});

test("расход виден целиком: экзамен и служебные вопросы — в счёте; токены из кэша провайдера названы отдельно", async () => {
  reset();
  const h = heart({}, { now: () => NOON });
  // Обычный ответ: провайдер узнал начало запроса и взял его из кэша — в лимит эти токены не идут.
  sdk().fetchQueue.push(says("ответ", { usage: { prompt_tokens: 1400, completion_tokens: 40, total_tokens: 1440, prompt_tokens_details: { cached_tokens: 1024 } } }));
  await h.onMessage(message("расскажи что-нибудь"), KEY);
  let today = lineOf(await status(h), "Сегодня:");
  assert.match(today, /Мысли: 1\s440 токенов \(gpt-oss-20b ×1\); из кэша провайдера — 1\s024, в лимит не идут/u);

  // Экзамен: вопросы самой себе — раньше их токены в «статус» не попадали.
  const before = chats().length;
  await h.onMessage(message("экзамен", { id: OWNER }), KEY);
  const asked = chats().length - before;
  assert.ok(asked >= 1, "экзамен спросил модель");
  today = lineOf(await status(h), "Сегодня:");
  // Ответ стаба без счёта токенов: число ответов выросло, токены — нет.
  assert.match(today, new RegExp(`gpt-oss-20b ×${1 + asked}\\)`, "u"));

  // Провайдер кэша не называет — строки о нём нет.
  reset();
  const plain = heart({}, { now: () => NOON });
  sdk().fetchQueue.push(says("ответ"));
  await plain.onMessage(message("расскажи что-нибудь"), KEY);
  today = lineOf(await status(plain), "Сегодня:");
  assert.match(today, /Мысли: 30 токенов \(gpt-oss-20b ×1\)/u);
  assert.doesNotMatch(today, /кэш/u);
});
