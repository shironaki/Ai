/**
 * Услышать простое.
 *
 * 16.11.2026 владелец прислал её список «что ты не поняла?» — 27 коротких фраз,
 * ушедших модели. Среди них не было ничего трудного: «меня зовут Айдина», «я живу
 * в Козельске», «ты же тупая», «да пойдёт», «отвечай ночью за меня», «метод
 * расчёта», «сделай его из лего». Человек представился — и не был услышан.
 * Здесь каждая из этих фраз доходит до своего дела без модели. Тут же — то, что
 * выросло из того же письма: статус без вчерашних страхов, забота на другой день
 * и память о сказанном «к слову».
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BUILD, heart, message, group, reset, last, calls, chats, says, sdk, source, sourced, toChat, toOwner, reactions, withSister, OWNER, KEY } from "./fixtures/kit.mjs";

const { introRequest, addressDrop, formRequest, addressRequest } = await import("../tgcloud/lib/personal.js");
const { selfStatement } = await import("../tgcloud/lib/offers.js");
const { parseSecretary } = await import("../tgcloud/lib/secretary.js");
const { parsePrayer } = await import("../tgcloud/lib/prayer.js");
const { parseIntent } = await import("../tgcloud/lib/intents.js");
const { parseAccent } = await import("../tgcloud/lib/accents.js");
const { parseMedia } = await import("../tgcloud/lib/media.js");
const { subjectOf } = await import("../tgcloud/lib/draw.js");

const NOON = Date.parse("2026-11-18T09:00:00Z");
const HOUR = 3_600_000;
const style = (id = 5) => JSON.parse(sdk().kv.get(`heart:style:${id}`) ?? "{}");
const texts = (id = 5) => toChat(id).map(item => item.text);

test("разбор: знакомство, «не называй так», «не выкай» — и то, что этим не является", () => {
  assert.equal(introRequest("меня зовут айдина"), "Айдина");
  assert.equal(introRequest("Привет, меня зовут Олег!"), "Олег");
  assert.equal(introRequest("моё имя — Анна-Мария."), "Анна-Мария");
  assert.equal(introRequest("зовут меня просто Саша"), "Саша");
  for (const said of ["меня зовут на свадьбу", "меня зовут обедать", "меня зовут Олег, а тебя?", "зови меня Саша", "как меня зовут", "меня зовут"]) assert.equal(introRequest(said), null, said);
  // «Зови меня …» остаётся прежней просьбой.
  assert.equal(addressRequest("зови меня Саша"), "Саша");

  for (const said of ["не называй меня так", "не обращайся так пишу", "Не зови меня так!", "не надо называть меня по имени", "забудь моё имя"]) assert.equal(addressDrop(said), true, said);
  for (const said of ["не называй меня дурой", "не обращайся ко мне", "называй меня так", "не называй его так"]) assert.equal(addressDrop(said), false, said);

  for (const said of ["давай на ты", "не выкай", "не надо мне выкать", "давай без вы", "не будь вежливый раздражение", "не будь такой официальной", "говори проще", "можно попроще"]) assert.equal(formRequest(said), "ты", said);
  for (const said of ["давай на вы", "не тыкай", "повежливее", "будь вежливее", "без фамильярности"]) assert.equal(formRequest(said), "вы", said);
  for (const said of ["не будь дурой", "говори громче", "будь проще и люди потянутся", "вежливость — это важно"]) assert.equal(formRequest(said), null, said);
});

test("разбор: порядок слов у секретаря, «метод расчёта», «почему ты ночью не отвечала», «режим разговора»", () => {
  // Слово о повторе можно сказать и после глагола.
  assert.deepEqual(parseSecretary("отвечай ночью за меня"), parseSecretary("ночью отвечай за меня"));
  assert.ok(parseSecretary("отвечай ночью за меня")?.plan, "это расписание, а не разовая отлучка");
  // «Когда меня нет» — условие, а не слова для людей.
  for (const said of ["отвечай за меня когда меня нет", "отвечай за меня, когда меня нет", "отвечай за меня пока я сплю"]) {
    const asked = parseSecretary(said);
    assert.ok(asked, said);
    assert.equal(asked.words ?? "", "", said);
    assert.equal(asked.plan, undefined, said);
  }
  // Слова для людей — по-прежнему слова.
  assert.equal(parseSecretary("отвечай за меня: я на совещании").words, "я на совещании");

  for (const said of ["метод расчета", "какой у тебя метод расчёта намаза", "способ расчета намазов", "по какому методу ты считаешь", "как ты считаешь намазы"]) assert.deepEqual(parsePrayer(said), { how: true }, said);
  assert.equal(parsePrayer("метод Гаусса"), null);

  for (const said of ["почему ты ночью не отвечала", "почему ты вчера молчала", "почему ты не отвечала ночью", "почему ты мне не ответила", "чего молчишь"]) assert.equal(parseIntent(said)?.intent, "whyquiet", said);

  for (const said of ["режим разговора", "можем изменить режим", "можно сменить режим общения", "какой у тебя режим", "как поменять режим", "какие есть режимы"]) assert.deepEqual(parseAccent(said), { show: true }, said);
  assert.equal(parseAccent("режим дня"), null);
});

test("разбор: «сделай его из лего» — прошлый рисунок в другой манере; «сделай картинку кота» — обычный рисунок", () => {
  for (const [said, style] of Object.entries({
    "сделай его из лего": "из лего", "сделай картинку маслом": "маслом", "сделай фотографию из лего": "из лего", "перерисуй акварелью": "акварелью",
    "нарисуй это в стиле Ван Гога": "в стиле Ван Гога", "сделай то же самое карандашом": "карандашом", "переделай как аниме": "как аниме",
  })) {
    assert.deepEqual(parseMedia(said), { kind: "draw", query: `ещё: ${style}` }, said);
    assert.deepEqual(subjectOf(`ещё: ${style}`), { again: true, style: style.toLowerCase() }, said);
  }
  assert.deepEqual(parseMedia("сделай картинку кота в шляпе"), { kind: "draw", query: "кота в шляпе" });
  assert.deepEqual(parseMedia("нарисуй кота в стиле Ван Гога"), { kind: "draw", query: "кота в стиле Ван Гога" });
  assert.deepEqual(parseMedia("нарисуй картину маслом"), { kind: "draw", query: "картину маслом" });
  assert.deepEqual(subjectOf("ещё"), { again: true });
});

test("«меня зовут Айдина» — имя запомнено сразу и без модели; «не называй меня так» его убирает", async () => {
  reset();
  const h = heart({ PHRASES: true }, { now: () => NOON });
  await h.onMessage(message("меня зовут айдина"), KEY);
  assert.equal(last(), "Приятно познакомиться, Айдина. Так и буду к вам обращаться.");
  assert.equal(style().address, "Айдина");
  await h.onMessage(message("не называй меня так"), KEY);
  assert.match(last(), /^Хорошо, больше так не буду\. Как к вам обращаться\? Скажите: «зови меня …»/u);
  assert.equal(style().address, "");
  // Имени уже нет — отвечает так же вежливо, но без «больше».
  await h.onMessage(message("не обращайся так пишу"), KEY);
  assert.match(last(), /^Хорошо, не буду\./u);
  assert.equal(chats().length, 0, "модель не понадобилась ни разу");
  // «Меня зовут на свадьбу» — не знакомство: это разговор.
  sdk().fetchQueue.push(says("Поздравляю, сходите."));
  await h.onMessage(message("меня зовут на свадьбу"), KEY);
  assert.equal(chats().length, 1);
  assert.equal(style().address, "");
});

test("«не будь такой вежливой» — переход на «ты»; хозяину — по-прежнему «вы»", async () => {
  reset();
  const h = heart({ PHRASES: true }, { now: () => NOON });
  await h.onMessage(message("не будь вежливый раздражение"), KEY);
  assert.equal(last(), "Хорошо, давай на «ты».");
  assert.equal(style().form, "ты");
  await h.onMessage(message("повежливее"), KEY);
  assert.equal(last(), "Хорошо, перехожу на «вы».");
  await h.onMessage(message("не выкай", { id: OWNER }), KEY);
  assert.equal(last(OWNER), "С вами я всегда на «вы», хозяин: так решено — и мне так нравится.");
  assert.equal(chats().length, 0);
});

test("«я живу в Козельске» — город находится со второй пробы справочника, а не уходит модели", async () => {
  reset();
  // Справочник знает только начальную форму — как настоящий.
  source("geocoding-api.open-meteo.com", (url) => (new URL(url).searchParams.get("name") === "козельск"
    ? { results: [{ name: "Козельск", country: "Россия", admin1: "Калужская область", latitude: 54.03, longitude: 35.78, timezone: "Europe/Moscow", feature_code: "PPL" }] }
    : { results: [] }));
  const h = heart({ SOURCES: true, PHRASES: true }, { now: () => NOON });
  await h.onMessage(message("я живу в козельске"), KEY);
  assert.match(last(), /^Запомнила: ваш город — Козельск\./u);
  assert.equal(style().city, "Козельск");
  assert.deepEqual(sourced().map(url => new URL(url).searchParams.get("name")), ["козельске", "козельск"], "вторая проба — начальная форма мужского рода");
  assert.equal(chats().length, 0);
});

test("грубость с частицей («ты же тупая») — её слышит словарь, её задевает; «да пойдёт» — принято, без слов", async () => {
  reset();
  const h = heart({ PHRASES: true }, { now: () => NOON, random: () => 0 });
  const got = await h.onMessage(message("ты же тупая"), KEY);
  assert.equal(got.action, "phrase");
  assert.deepEqual(got.topics, ["оскорбление"]);
  assert.equal(texts().length, 2, "ответ и одна строка о том, что задело");
  // Обида слышна и дальше: на вопрос о ней отвечают строки с пометкой «обижена».
  await h.onMessage(message("ты злишься"), KEY);
  assert.match(last(), /^(?:Обиделась|Немного|Дуюсь)/u, "отвечает задетая, а не «не злюсь»");
  // То же голосовым вводом, с лишними словами в начале.
  reset();
  const other = heart({ PHRASES: true }, { now: () => NOON, random: () => 0 });
  assert.deepEqual((await other.onMessage(message("то что ты меня бесишь"), KEY)).topics, ["оскорбление"]);
  assert.equal(texts().length, 2);

  reset();
  const calm = heart({ PHRASES: true }, { now: () => NOON });
  // Голое «пойдёт» — ответ на «как дела?» (тема словаря «у меня хорошо»); «да пойдёт» — согласие.
  for (const said of ["да пойдет", "да сойдёт", "ну ладно", "лады", "как скажешь"]) {
    const before = texts().length;
    await calm.onMessage(message(said), KEY);
    assert.equal(texts().length, before, `${said}: без слов`);
    assert.equal(reactions().at(-1), "👌", said);
  }
  assert.equal(chats().length, 0);
});

test("забота: вчера болел — сегодня, с первым его словом, она спрашивает сама; один раз и только в личке", async () => {
  reset();
  let at = NOON;
  const h = heart({ PHRASES: true }, { now: () => at, random: () => 0 });
  await h.onMessage(message("я заболел"), KEY);
  assert.equal(JSON.parse(sdk().kv.get("heart:care:5")).kind, "болел");
  // В тот же день — ничего сверх ответа.
  at += HOUR;
  let before = texts().length;
  await h.onMessage(message("привет"), KEY);
  assert.equal(texts().length, before + 1);
  // На другой день — вопрос вдогонку к ответу, и запись снята.
  at += 20 * HOUR;
  before = texts().length;
  await h.onMessage(message("привет"), KEY);
  assert.equal(texts().length, before + 2);
  assert.match(last(), /нездоровилось|получше|самочувствие/u);
  assert.equal(sdk().kv.get("heart:care:5"), undefined);
  at += 24 * HOUR;
  before = texts().length;
  await h.onMessage(message("привет"), KEY);
  assert.equal(texts().length, before + 1, "второй раз не спрашивает");
  // При всех о таком не спрашивают — и не запоминают.
  await h.onMessage(group("Аи, я заболел"), KEY);
  assert.equal(sdk().kv.get("heart:care:5"), undefined);
  assert.equal(chats().length, 0);
});

test("забота 0.43.0: об утрате, о больном близком, о больнице и о выступлении она на другой день спрашивает сама — своими словами для каждого", async () => {
  // Тема словаря → о чём она спросит завтра. Об утрате не спрашивают «тебе получше?», о маме в больнице — «как самочувствие?».
  const cases = [
    ["у меня умер дедушка", "утрата", /помню, что случилось|держи(?:шься|тесь)|я здесь/u],
    ["кота усыпили", "утрата", /помню, что случилось|держи(?:шься|тесь)|я здесь/u],
    ["мама в больнице", "близкий", /близкий человек|[Ее]сть новости|[Кк]ак дома/u],
    ["я лежу в больнице", "болел", /нездоровилось|получше|самочувствие/u],
    ["я боюсь операции", "болел", /нездоровилось|получше|самочувствие/u],
    ["давление скачет", "болел", /нездоровилось|получше|самочувствие/u],
    ["у меня презентация", "удача", /как (?:всё )?прошло|[Пп]олучилось/iu],
    ["меня никто не поздравил", "грустил", /тяжело|легче|настроение/u],
  ];
  for (const [said, kind, asks] of cases) {
    reset();
    let at = NOON;
    const h = heart({ PHRASES: true }, { now: () => at, random: () => 0 });
    await h.onMessage(message(said), KEY);
    assert.equal(JSON.parse(sdk().kv.get("heart:care:5") ?? "{}").kind, kind, said);
    // Сам ответ на тяжёлое — без манер и без Байта.
    if (["утрата", "близкий", "болел"].includes(kind)) assert.doesNotMatch(last(), /мяу|(?:^|[^а-яё])ня(?:[^а-яё]|$)|Байт/iu, said);
    at += 21 * HOUR;
    const before = texts().length;
    await h.onMessage(message("привет"), KEY);
    assert.equal(texts().length, before + 2, `${said}: на другой день — вопрос вдогонку`);
    assert.match(last(), asks, said);
    assert.equal(sdk().kv.get("heart:care:5"), undefined, said);
    assert.equal(chats().length, 0, said);
  }
  // Хозяину — его строки, на «вы».
  reset();
  let at = NOON;
  const h = heart({ PHRASES: true }, { now: () => at, random: () => 0.99 });
  await h.onMessage(message("у меня умерла бабушка", { id: OWNER }), KEY);
  at += 21 * HOUR;
  await h.onMessage(message("привет", { id: OWNER }), KEY);
  assert.match(toChat(OWNER).at(-1).text, /хозяин/u);
  assert.match(toChat(OWNER).at(-1).text, /утрат|рядом/u);
});

test("сказал о себе — она запомнила сама: знак на сообщении, слова один раз, в памяти — его фраза", async () => {
  for (const said of ["я люблю рыбалку и походы", "А я очень люблю кофе", "у меня двое детей", "мою жену зовут Айдина", "мне 34 года", "мой любимый цвет — синий", "я по профессии сварщик", "я не ем мясо", "я замужем"]) assert.equal(selfStatement(said), said.replace(/[.!…]+$/u, ""), said);
  for (const said of ["я люблю тебя", "я боюсь вас потерять", "у меня есть шанс?", "я люблю", "я люблю ли я его", "мне кажется, я люблю рыбалку", "он любит рыбалку", "расскажи, что я люблю"]) assert.equal(selfStatement(said), null, said);

  reset();
  let at = NOON;
  const h = heart({ PHRASES: true }, { now: () => at });
  sdk().fetchQueue.push(says("Рыбалка — это терпение."), says("Двое — это шумно и весело."), says("Список."));
  await h.onMessage(message("я люблю рыбалку и походы"), KEY);
  assert.deepEqual(texts().slice(-2), ["Рыбалка — это терпение.", "Это я о вас запомнила — сама, без слова «запомни». Что помню — «что ты обо мне помнишь»."]);
  assert.equal(reactions().at(-1), "✍");
  // Второй раз — молча: только знак.
  const before = texts().length;
  await h.onMessage(message("у меня двое детей"), KEY);
  assert.equal(texts().length, before + 1);
  await h.onMessage(message("что ты обо мне помнишь"), KEY);
  assert.match(last(), /я люблю рыбалку и походы/u);
  assert.match(last(), /у меня двое детей/u);
  // В группе сказанное к слову в память не идёт.
  reset();
  const loud = heart({ PHRASES: true }, { now: () => at });
  sdk().fetchQueue.push(says("Понятно."));
  await loud.onMessage(group("Аи, я люблю рыбалку и походы"), KEY);
  await loud.onMessage(message("что ты обо мне помнишь"), KEY);
  assert.doesNotMatch(last(), /рыбалку/u);
  // «Удали всё обо мне» стирает и эти записи.
  reset();
  const gone = heart({ PHRASES: true }, { now: () => at });
  sdk().fetchQueue.push(says("Понятно."));
  await gone.onMessage(message("я люблю рыбалку и походы"), KEY);
  await gone.onMessage(message("я заболел"), KEY);
  await gone.onMessage(message("удали всё обо мне"), KEY);
  await gone.onMessage(message("да, удали всё"), KEY);
  assert.deepEqual([...sdk().kv.keys()].filter(key => /^heart:(?:care|selfnote):5$/u.test(key)), []);
});

// ── статус: вчерашнее не выглядит сегодняшним ───────────────────────────────
const ACCOUNT = "0123456789abcdef0123456789abcdef";
const DRAW_ON = { DRAW_KEY: `${ACCOUNT}:cf-token_ABCDEFGH-1234567890xyz`, DRAW_DIRECTOR: false };
const PIXELS = Buffer.from(Array.from({ length: 600 }, (_, index) => index % 251));
const image = () => ({ success: true, result: { image: PIXELS.toString("base64") } });
const cfError = (status, code, text) => ({ ok: false, status, text: async () => JSON.stringify({ success: false, errors: [{ code, message: text }] }) });
const status = () => toOwner().map(item => item.text).filter(text => /Проверка сердца/u.test(text)).at(-1) ?? "";
const lineOf = (text, head) => text.split("\n").find(line => line.startsWith(head)) ?? "";

test("статус: заминка рисования — с днём («вчера в …»), а записанная до публикации этой сборки — не показывается", async () => {
  reset();
  source("flux-1-schnell", (url, options) => (/safe for work/u.test(JSON.parse(options.body).prompt) ? image() : cfError(400, 3030, "Input prompt contains NSFW content.")));
  let at = NOON;
  const h = heart(DRAW_ON, { now: () => at });
  await h.onMessage(message("нарисуй кота", { id: OWNER }), KEY);
  await h.onMessage(message("статус", { id: OWNER }), KEY);
  assert.match(lineOf(status(), "Рисование:"), / · заминка в \d\d:\d\d \(нарисовал FLUX schnell\): /u);
  // На другой день час без дня читался бы как сегодняшний.
  at += 20 * HOUR;
  await h.onMessage(message("статус", { id: OWNER }), KEY);
  assert.match(lineOf(status(), "Рисование:"), / · заминка вчера в \d\d:\d\d \(нарисовал FLUX schnell\): /u);
  // Сборку опубликовали после заминки: запись о прошлом коде в статусе новой не стоит.
  sdk().kv.set("heart:build", JSON.stringify({ build: BUILD, at: at - HOUR }));
  await h.onMessage(message("статус", { id: OWNER }), KEY);
  assert.doesNotMatch(lineOf(status(), "Рисование:"), /заминка|400/u);
  // Запись о другой сборке ничего не прячет: эта ещё не объявилась.
  sdk().kv.set("heart:build", JSON.stringify({ build: "0.1.0", at }));
  await h.onMessage(message("статус", { id: OWNER }), KEY);
  assert.match(lineOf(status(), "Рисование:"), /заминка вчера в/u);
});

test("статус: «Сбои» — то, что было до публикации этой сборки, названо отдельно, а не стоит как свежее", async () => {
  reset();
  const { h } = withSister({ alive: false });
  await h.onMessage(message("статус", { id: OWNER }), KEY);
  assert.match(lineOf(status(), "Сбои:"), /^Сбои: нет · к сведению: Мост — .+ \(\d\d:\d\d\)$/u);
  // Та же запись, но сборка объявилась позже неё.
  sdk().kv.set("heart:build", JSON.stringify({ build: BUILD, at: Date.now() + 1 }));
  await h.onMessage(message("статус", { id: OWNER }), KEY);
  assert.equal(lineOf(status(), "Сбои:"), "Сбои: нет · до обновления было: 1 (к этой сборке не относится)");
});

test("«сделай его из лего» — тот же сюжет в новой манере; манеры не копятся; рисовать нечего — честно", async () => {
  reset();
  source("flux-1-schnell", () => image());
  source("m2m100", () => ({ success: true, result: { translated_text: "a cat made of lego bricks" } }));
  const h = heart(DRAW_ON, { now: () => NOON });
  const drew = () => JSON.parse(sdk().kv.get("heart:drew:5"));
  await h.onMessage(message("нарисуй кота"), KEY);
  await h.onMessage(message("сделай его из лего"), KEY);
  assert.equal(calls("sendPhoto").length, 2);
  assert.equal(drew().q, "кота, из лего");
  assert.equal(drew().base, "кота");
  await h.onMessage(message("сделай картинку маслом"), KEY);
  assert.equal(calls("sendPhoto").length, 3);
  assert.equal(drew().q, "кота, маслом", "прежняя манера заменена, а не дописана");
  // «Ещё» повторяет последний вид — и помнит сюжет.
  await h.onMessage(message("нарисуй ещё"), KEY);
  assert.equal(drew().q, "кота, маслом");
  assert.equal(drew().base, "кота");
  reset();
  const empty = heart(DRAW_ON, { now: () => NOON });
  await empty.onMessage(message("сделай его из лего"), KEY);
  assert.match(last(), /^Перерисовать пока нечего: я здесь ещё ничего не рисовала\./u);
});

test("«отвечай за меня» не от хозяина — честное «секретарём я работаю у хозяина и у тех, кому он разрешил», а не согласие модели", async () => {
  reset();
  const h = heart({ PHRASES: true }, { now: () => NOON });
  for (const said of ["отвечай за меня", "отвечай за меня когда меня нет", "отвечай ночью за меня", "секретарь, отвечай за меня до 18:00", "прикрой меня"]) {
    await h.onMessage(message(said), KEY);
    assert.match(last(), /^(?:Секретарём я работаю у хозяина и у тех, кому он разрешил|В чужие переписки мне хода нет)/u, said);
  }
  // Хозяину при всех — куда с этим идти; слово «хозяин» в группе не звучит.
  await h.onMessage(group("Аи, отвечай за меня", { id: OWNER }), KEY);
  assert.equal(sdk().sent.at(-1).text, "Это — в личке со мной: там скажите «отвечай за меня», и я начну.");
  assert.equal(chats().length, 0, "модель не понадобилась");
  // Похожее, но не просьба о секретаре: «меня нет» от гостя и «ответь за меня на этот вопрос» — разговор.
  sdk().fetchQueue.push(says("Понятно."), says("Хорошо."));
  await h.onMessage(message("меня нет"), KEY);
  await h.onMessage(message("ответь за меня на этот вопрос"), KEY);
  assert.equal(chats().length, 2);
  // Без словаря ответ тот же по смыслу.
  reset();
  const bare = heart({}, { now: () => NOON });
  await bare.onMessage(message("отвечай за меня"), KEY);
  assert.match(last(), /^Секретарём я работаю у хозяина и у тех, кому он разрешил/u);
});

test("вопросы о её характере и чувствах ведут к своим темам, а не к прежним общим", async () => {
  // 0.34.0 добавила темы о характере и чувствах, но их главные вопросы остались за старыми темами
  // («какой у тебя характер» отвечала «о себе», «ты девушка» — «ты бот»): новых строк никто не слышал.
  const home = {
    "какой у тебя характер": "какой у тебя характер", "тебе грустно?": "тебе грустно", "ты плачешь": "ты плачешь", "ты злишься?": "ты злишься",
    "ты скучала?": "ты скучала", "что тебя радует": "что тебя радует", "что тебя злит?": "что тебя злит", "ты девушка?": "ты девушка",
    "будь моей девушкой": "будь моей девушкой", "я тебе нравлюсь?": "я тебе нравлюсь", "ты холодная": "ты холодная", "ты смешная": "ты смешная",
    "я волнуюсь": "я волнуюсь", "меня обидели": "меня обидели", "у меня получилось!": "у меня получилось", "меня никто не понимает": "меня никто не понимает",
    "нет сил": "нет сил", "мне лень": "мне лень", "я не выспался": "я не выспался", "успокой меня": "успокой меня", "выслушай меня": "выслушай меня", "мотивируй меня": "мотивируй меня",
    // Эти остаются за прежними темами намеренно: «прощай» — прощание, «ты спишь?» — «ты тут?», «ты врёшь» — спор с её ответом.
    "прощай": "пока", "ты спишь?": "ты тут", "ты врешь": "ты не права",
  };
  for (const who of [5, OWNER]) {
    for (const [said, topic] of Object.entries(home)) {
      reset();
      const h = heart({ PHRASES: true }, { now: () => NOON });
      const got = await h.onMessage(message(said, { id: who }), KEY);
      assert.deepEqual(got.topics, [topic], `${said} (${who === OWNER ? "хозяин" : "гость"})`);
    }
  }
  // «Успокой меня» — не «пожелай удачи»: на другой день она спросит, как человек, а не «как прошло».
  reset();
  const h = heart({ PHRASES: true }, { now: () => NOON });
  await h.onMessage(message("успокой меня"), KEY);
  assert.equal(JSON.parse(sdk().kv.get("heart:care:5")).kind, "грустил");
});

test("0.35.0: сказал о себе, а ответил словарь — в память идёт так же: «у меня двое детей», «у меня аллергия на кошек»; минутное — нет", async () => {
  reset();
  const h = heart({ PHRASES: true, AI_MODELS: [] }, { now: () => NOON, random: () => 0 });
  const kids = await h.onMessage(message("у меня двое детей"), KEY);
  assert.deepEqual([kids.action, kids.topics], ["phrase", ["у меня дети"]], "ответил словарь, модель не тратилась");
  assert.equal(reactions().at(-1), "✍");
  await h.onMessage(message("у меня аллергия на кошек"), KEY);
  // Минутное состояние — не сведение о человеке: «у меня нет сил» в память не идёт.
  await h.onMessage(message("у меня нет сил"), KEY);
  await h.onMessage(message("что ты обо мне помнишь"), KEY);
  assert.match(last(), /у меня двое детей/u);
  assert.match(last(), /у меня аллергия на кошек/u);
  assert.doesNotMatch(last(), /нет сил/u);
});
