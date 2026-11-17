/**
 * Список «что ты не поняла?» — правда на сегодня (0.36.1).
 *
 * 17.11.2026 владелец прислал скриншот: список из 30 строк, «предложи ответы», «забудь непонятное».
 * Подсказка под списком говорила «забудь непонятое», он написал «непонятное» — и очистка не сработала;
 * «что не понятно?» ушло модели; в списке стояло и давно понятое («меня зовут айдина», «сделай его из
 * лего»), и то, что словарю знать не положено («если отказывается», «состав водородной бомбы»); а
 * предложенные ответы были эхом («го встр» → «Го встр...»). Здесь — всё это по порядку.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { heart, message, group, reset, last, chats, says, sdk, toOwner, OWNER, KEY } from "./fixtures/kit.mjs";

const { parseTeach, clearsShownList, notForDictionary, createTaught, UNHEARD_KEY, TAUGHT_KEY } = await import("../tgcloud/lib/taught.js");
const { introRequest, nameReply, ASKS_NAME } = await import("../tgcloud/lib/personal.js");
const { clean } = await import("../tgcloud/lib/catalogue.js");
const { createPhrasebook } = await import("../tgcloud/lib/phrasebook.js");

const ON = { PHRASES: true };
const NOON = Date.parse("2026-11-18T09:00:00Z");
const own = (text) => message(text, { id: OWNER });
const book = createPhrasebook({ random: () => 0 });
/** Список владельца со скриншота: 30 строк и «что не понятно», которое легло в него на глазах. */
const HIS = ["что не понятно", "алиса давай", "давай я тебе имя дам", "кто писал", "аххахаха", "оке", "хаахахахха", "ахаххахахахахахха", "го встречается", "го встр",
  "что делаеш", "халь гитлер", "скучаешь", "почему ты ночью не отвечала", "отвечай ночью за меня", "если отказывается", "он игнорирует",
  "на что действует правое полушарие мозга", "состав водородной бомбы", "сделай картинку маслом", "сделай фотографию из лего", "сделай его из лего",
  "не будь вежливый раздражение", "просто айдина", "не обращайся так пишу", "ок", "меня зовут айдина", "юи кто", "юи", "метод расчета", "я живу в козельске"];
const seed = (list, { n = 1 } = {}) => {
  const map = {};
  list.forEach((text, index) => { map[text] = { n, at: NOON - index * 1000 }; });
  sdk().kv.set(UNHEARD_KEY, JSON.stringify({ map, since: NOON - 86_400_000, at: NOON }));
};
const left = () => Object.keys(JSON.parse(sdk().kv.get(UNHEARD_KEY) ?? "{\"map\":{}}").map).sort();

test("разбор: список зовут и чистят теми словами, какие человек напишет сам — «что не понятно?», «забудь непонятное»", () => {
  for (const said of ["что не поняла?", "Что ты не поняла", "что не понятно?", "Что непонятно?", "что тебе непонятно", "что было не понятно", "что непонятного", "чего не понимаешь",
    "что ты не понимаешь", "что ты не смогла понять", "какие фразы ты не поняла", "какие слова не поняла", "покажи непонятное", "покажи непонятое", "список непонятого",
    "покажи список непонятных фраз", "непонятное", "непонятые фразы", "что ушло модели", "что отдала модели", "чего не хватает в словаре", "что не поняла сегодня"]) {
    assert.deepEqual(parseTeach(said), { unheard: true }, said);
  }
  // «Непонятое» стояло в подсказке, «непонятное» написал человек: годятся оба — и родня.
  for (const said of ["забудь непонятное", "Забудь непонятое.", "забудь непонятные фразы", "забудь всё непонятное", "очисти непонятное", "очисти список непонятого",
    "удали непонятное", "убери непонятные фразы", "сбрось непонятное", "сотри список непонятных фраз"]) {
    assert.deepEqual(parseTeach(said), { unheardClear: true }, said);
  }
  // Без слова «непонятное» — её слова о списке это, только когда список показан: разбор их сам не берёт.
  for (const said of ["очисти список", "забудь список", "сотри список", "удали список", "сбрось список", "забудь всё", "Забудь это всё.", "очисти", "очистить", "удали их"]) {
    assert.equal(parseTeach(said), null, said);
    assert.equal(clearsShownList(said), true, said);
  }
  for (const said of ["забудь это", "очисти список покупок", "забудь фразу 2", "забудь меня", "очисти память", "удали заметку", "забудь"]) assert.equal(clearsShownList(said), false, said);
  // Похожее по виду — не о списке.
  for (const said of ["что ты не поняла в этой задаче", "что не понятно в задаче", "непонятно", "мне непонятно", "что тут непонятного", "я не поняла", "что я не понял",
    "что ты не знаешь", "чего ты не знала", "покажи список"]) {
    assert.equal(parseTeach(said), null, said);
  }
});

test("разбор: учить можно без «ёлочек» — с двоеточием; без знака она не угадывает, где кончается фраза", () => {
  const add = { add: { when: "го встр", say: "давай встретимся" } };
  for (const said of ["на «го встр» отвечай «давай встретимся»", "на \"го встр\" отвечай \"давай встретимся\"", "на го встр отвечай: давай встретимся", "на го встр отвечай — давай встретимся",
    "На го встр говори: давай встретимся"]) {
    assert.deepEqual(parseTeach(said), add, said);
  }
  assert.deepEqual(parseTeach("на го встр отвечай давай встретимся"), { hint: { when: "го встр", say: "давай встретимся" } });
  // Пожелание о манере — не урок и не подсказка.
  for (const said of ["на вопросы отвечай коротко", "на это не отвечай", "на грубость отвечай грубостью", "на что ты отвечаешь", "отвечай быстрее", "на звонки не отвечай никому"]) {
    assert.equal(parseTeach(said), null, said);
  }
});

test("что словарю знать не положено: продолжение разговора и вопрос на знание в список не ложатся", () => {
  const taught = createTaught({ store: { available: true, get: async () => null, set: async () => true } });
  const talk = ["если отказывается", "он игнорирует", "просто айдина", "они молодцы", "потому что устал", "но это не точно", "тогда завтра", "значит не судьба"];
  const world = ["на что действует правое полушарие мозга", "состав водородной бомбы", "столица франции", "курс доллара", "как пройти в библиотеку", "из чего делают бумагу в китае"];
  for (const said of talk) assert.equal(notForDictionary(clean(said)), "talk", said);
  for (const said of world) assert.equal(notForDictionary(clean(said)), "world", said);
  for (const said of [...talk, ...world]) assert.equal(taught.worth(said), "", said);
  // К ней, о себе, про «сегодня» и короткое — в списке остаётся: это и есть пробелы словаря и умений.
  for (const said of ["кек чебурек", "ну ты и булка", "алиса давай", "кто писал", "что делаеш", "почему ты ночью не отвечала", "но ты же обещала", "она лучше тебя",
    "какой сегодня день недели", "сколько сейчас времени", "что мне делать", "а ты кто", "вот это да", "когда я родился"]) {
    assert.equal(notForDictionary(clean(said)), "", said);
    assert.equal(taught.worth(said), clean(said), said);
  }
});

test("живой ход: длинный ответ модели — вопрос на знание, в список не идёт; короткий — идёт; обрывок разговора — нет", async () => {
  reset();
  const h = heart(ON, { now: () => NOON });
  sdk().fetchQueue.push(says(`${"Полушария работают вместе. ".repeat(14)}`), says("Коротко."), says("Бывает."));
  for (const said of ["мозг и полушария", "кек чебурек", "он игнорирует"]) await h.onMessage(message(said), KEY);
  assert.equal(chats().length, 3);
  assert.deepEqual(left(), ["кек чебурек"]);
});

test("скриншот 17.11.2026: из 31 строки не остаётся ни одной — 26 она понимает сама, 5 — не дело словаря", async () => {
  reset();
  seed(HIS);
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  await h.onMessage(own("Что не поняла?"), KEY);
  assert.equal(last(OWNER), "Из списка ушла 31 реплика: 26 я теперь понимаю сама, ещё 5 — продолжения разговора и вопросы на знание: на них и должна отвечать модель. Больше показать нечего.");
  assert.deepEqual(left(), []);
  assert.equal(chats().length, 0);
  assert.equal(toOwner().length, 1, "репетиция ничего не отправляет");
  // Дальше — его же слова со скриншота, по порядку.
  await h.onMessage(own("Предложи ответы"), KEY);
  assert.equal(last(OWNER), "Предлагать не к чему: короткого, чего я не узнала бы, пока нет.");
  await h.onMessage(own("Забудь непонятное"), KEY);
  assert.equal(last(OWNER), "Список непонятного очищен. Начинаю считать заново.");
  await h.onMessage(own("Что не понятно?"), KEY);
  assert.equal(last(OWNER), "Пока нечего показать: короткого, чего я не узнала бы, не было.");
  assert.equal(chats().length, 0, "модель не спрошена ни разу");
  assert.deepEqual(left(), [], "и сами эти слова в список не легли");
});

test("сверка — репетицией настоящего разбора: «сделай его из лего», «метод расчета», «я живу в козельске» уходят; счётчики дня репетиция не трогает", async () => {
  reset();
  seed(["сделай его из лего", "метод расчета", "я живу в козельске", "сделай картинку маслом", "тыква на подоконнике"]);
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  const sent = sdk().sent.length;
  await h.onMessage(own("что не понятно"), KEY);
  assert.match(last(OWNER), /^Короткое, чего я не узнала и отдала модели \(1\):\n1\. «тыква на подоконнике»\n\nИз списка ушли 4 реплики: теперь я понимаю их сама\.\n\nНаучить сразу: на «фраза» отвечай «ответ»\. Без кавычек — с двоеточием: на привет отвечай: здравствуй\./u);
  assert.match(last(OWNER), /Очистить — «забудь непонятное»\./u, "в подсказке — слово, которое человек напишет сам");
  assert.deepEqual(left(), ["тыква на подоконнике"]);
  assert.equal(sdk().sent.length, sent + 1);
  assert.deepEqual(JSON.parse(sdk().kv.get("heart:pulse:2026-11-18")), { ruled: 1 }, "восемь репетиций — не восемь ответов за день");
  assert.equal(sdk().fetches.length, 0);
});

test("репетиция ничего не трогает: все примеры умений, от гостя и от хозяина, — ни Telegram, ни сеть, ни хранилище", async () => {
  const examples = [...new Set([...readFileSync(new URL("../SKILLS.txt", import.meta.url), "utf8").matchAll(/«([^«»\n]{2,80})»/gu)].map(found => found[1].replace(/…/gu, "кота").trim()))];
  assert.ok(examples.length > 250, `примеров — ${examples.length}`);
  reset();
  const h = heart({ PHRASES: true, MANNERS: true }, { now: () => NOON, random: () => 0 });
  const kv = () => JSON.stringify([...sdk().kv.entries()].sort());
  const before = kv();
  const touched = [];
  for (const text of examples) {
    for (const who of [1, OWNER]) {
      const mark = [sdk().calls.length, sdk().sent.length, sdk().fetches.length];
      const got = await h.onMessage({ chat: { id: who, type: "private" }, from: { id: who, first_name: "", is_bot: false }, text }, { testRun: true });
      if (got?.ok === false || sdk().calls.length !== mark[0] || sdk().sent.length !== mark[1] || sdk().fetches.length !== mark[2]) touched.push(`${who === OWNER ? "хозяин" : "гость"}: «${text}»`);
    }
  }
  assert.deepEqual(touched, []);
  assert.equal(kv(), before, "хранилище не изменилось");
});

test("«забудь всё», «очисти список» сразу после списка — о нём; без показанного списка и через десять минут — как прежде, о памяти", async () => {
  reset();
  seed(["кек чебурек", "ну ты и булка"]);
  let at = NOON;
  const h = heart(ON, { now: () => at, random: () => 0 });
  // Список не показан — «забудь всё» о записях памяти, как и было.
  await h.onMessage(own("запомни: я люблю чай"), KEY);
  await h.onMessage(own("забудь всё"), KEY);
  assert.match(last(OWNER), /^Забыла все записи \(1\)\./u);
  assert.deepEqual(left(), ["кек чебурек", "ну ты и булка"]);
  // Показан — и «забудь всё» чистит его, а не память.
  await h.onMessage(own("запомни: я люблю чай"), KEY);
  await h.onMessage(own("что не поняла?"), KEY);
  assert.match(last(OWNER), /\(2\):\n1\. «кек чебурек»\n2\. «ну ты и булка»/u);
  await h.onMessage(own("Забудь всё"), KEY);
  assert.equal(last(OWNER), "Список непонятного очищен: начинаю считать заново. Мою память о вас не трогала — для неё есть «очисти память».");
  assert.deepEqual(left(), []);
  await h.onMessage(own("что ты обо мне помнишь"), KEY);
  assert.match(last(OWNER), /я люблю чай/u, "запись памяти цела");
  // Контекст кончился вместе со списком: второе «забудь всё» — снова о памяти.
  await h.onMessage(own("забудь всё"), KEY);
  assert.match(last(OWNER), /^Забыла все записи \(1\)\./u);
  // «Очисти список» — тоже; через десять минут после показа — уже нет.
  seed(["кек чебурек"]);
  await h.onMessage(own("что не понятно?"), KEY);
  await h.onMessage(own("очисти список"), KEY);
  assert.match(last(OWNER), /^Список непонятного очищен: начинаю считать заново\./u);
  seed(["кек чебурек"]);
  await h.onMessage(own("что не понятно?"), KEY);
  at += 11 * 60_000;
  sdk().fetchQueue.push(says("Какой список?"));
  await h.onMessage(own("очисти список"), KEY);
  assert.equal(last(OWNER), "Какой список?");
  assert.deepEqual(left(), ["кек чебурек"]);
  // Гостю ни список, ни очистка не положены.
  sdk().fetchQueue.push(says("О чём вы?"), says("Не понимаю."));
  await h.onMessage(message("что не понятно?"), KEY);
  assert.equal(last(), "О чём вы?");
  await h.onMessage(message("забудь непонятное"), KEY);
  assert.deepEqual(left(), ["кек чебурек"], "чужое слово список не чистит");
});

test("«предложи ответы»: прочерк, эхо и штамп помощника в предложение не идут; «не беру» закрывает его", async () => {
  reset();
  seed(["кек чебурек", "ну ты и булка", "тыква на подоконнике", "бубль гум", "вот это номер был"], { n: 2 });
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  // Так отвечала модель на скриншоте: эхо («Го встр...»), штамп («чем могу помочь?»), не её голос («виртуальный собеседник»).
  sdk().fetchQueue.push(says("1. Чебурек кек — и точка.\n2. Здравствуй, чем могу помочь?\n3. —\n4. Бубль гум...\n5. Я – ваш виртуальный собеседник."));
  await h.onMessage(own("предложи варианты ответов"), KEY);
  assert.equal(last(OWNER), "Вот что я бы отвечала (1):\n1. «кек чебурек» → «Чебурек кек — и точка.»\n\nК 4 репликам годного ответа не нашлось — они остались без него.\n\nВзять — одним сообщением: «беру 1 3» или «беру все»; не брать — «не беру». Не нравится ответ — научите своим: на «фраза» отвечай «ответ». В словарь без вашего слова ничего не кладу.");
  const asked = JSON.parse(chats().at(-1).options.body).messages.at(-1).content;
  assert.match(asked, /Отвечай на смысл реплики, а не повторяй её\..*вместо ответа поставь прочерк: «—»\./su);
  await h.onMessage(own("не беру"), KEY);
  assert.equal(last(OWNER), "Хорошо: в словарь ничего не кладу. Свои ответы — на «фраза» отвечай «ответ»; очистить список — «забудь непонятное».");
  assert.equal(sdk().kv.get(TAUGHT_KEY) ?? null, null);
  // Предложения больше нет: «беру все» и «не беру» — обычные слова.
  sdk().fetchQueue.push(says("Что берёте?"), says("Ладно."));
  await h.onMessage(own("беру все"), KEY);
  assert.equal(last(OWNER), "Что берёте?");
  await h.onMessage(own("не беру"), KEY);
  assert.equal(last(OWNER), "Ладно.");
  // Годного нет совсем — так и сказано; просят теми же словами по-разному.
  sdk().fetchQueue.length = 0;
  sdk().fetchQueue.push(says("1. —\n2. —\n3. —\n4. —\n5. —"));
  await h.onMessage(own("предложи ответы на них"), KEY);
  assert.equal(last(OWNER), "Годных ответов не вышло: эти реплики модель и сама не поняла. Научить можно словами — на «фраза» отвечай «ответ»; очистить список — «забудь непонятное».");
  for (const said of ["предложи ответ", "предложи свои ответы", "придумай сама", "ответь на них сама", "сама предложи", "дополни словарь"]) {
    sdk().fetchQueue.length = 0;
    sdk().fetchQueue.push(says("1. Чебурек кек."));
    await h.onMessage(own(said), KEY);
    assert.match(last(OWNER), /^Вот что я бы отвечала \(1\):/u, said);
  }
  // «Придумай сама» — о списке, только пока он перед глазами: через час это слова о чём угодно.
  const later = heart(ON, { now: () => NOON + 3_600_000, random: () => 0 });
  sdk().fetchQueue.length = 0;
  sdk().fetchQueue.push(says("Что придумать?"));
  await later.onMessage(own("придумай сама"), KEY);
  assert.equal(last(OWNER), "Что придумать?");
  // «Не надо» — отказ, только пока предложение перед глазами.
  await h.onMessage(own("не надо"), KEY);
  assert.match(last(OWNER), /^Хорошо: в словарь ничего не кладу\./u);
});

test("учит без кавычек: с двоеточием — запоминает; без знака — по списку непонятного знает, где кончается фраза; иначе не гадает", async () => {
  reset();
  seed(["кек чебурек", "ну ты и булка"]);
  let at = NOON;
  const h = heart(ON, { now: () => at, random: () => 0 });
  // Фраза стоит в списке непонятного — граница известна: урок принят и без знака.
  await h.onMessage(own("на кек чебурек отвечай чебурек кек"), KEY);
  assert.equal(last(OWNER), "Запомнила: на «кек чебурек» отвечаю «чебурек кек». Забыть — «забудь фразу 1».");
  assert.deepEqual(left(), ["ну ты и булка"], "выученное из списка ушло");
  await h.onMessage(message("кек чебурек"), KEY);
  assert.equal(last(), "чебурек кек");
  // Фразы в списке нет, но список только что показан — подсказка, как сказать; в словарь ничего не идёт.
  await h.onMessage(own("что не понятно?"), KEY);
  await h.onMessage(own("на тыква отвечай подоконник"), KEY);
  assert.equal(last(OWNER), "Похоже, вы учите меня фразе, но без знака мне не видно, где кончается фраза и начинается ответ. Поставьте двоеточие — и я запомню:\n\nна тыква отвечай: подоконник");
  assert.equal(JSON.parse(sdk().kv.get(TAUGHT_KEY)).items.length, 1);
  await h.onMessage(own("на тыква отвечай: подоконник"), KEY);
  assert.equal(last(OWNER), "Запомнила: на «тыква» отвечаю «подоконник». Забыть — «забудь фразу 2».");
  assert.equal(chats().length, 0);
  // Ни списка, ни фразы в нём — обычные слова: «на английском отвечай по-английски» уроком не становится.
  at += 3_600_000;
  sdk().fetchQueue.push(says("Хорошо, хозяин."));
  await h.onMessage(own("на английском отвечай по-английски"), KEY);
  assert.equal(last(OWNER), "Хорошо, хозяин.");
  assert.equal(JSON.parse(sdk().kv.get(TAUGHT_KEY)).items.length, 2);
  // Гостю подсказка не положена: учит только хозяин.
  sdk().fetchQueue.push(says("Хорошо."));
  await h.onMessage(message("на привет отвечай здравствуй"), KEY);
  assert.equal(last(), "Хорошо.");
});

test("имя ответом на её вопрос: «просто Айдина» сразу после «как к вам обращаться?» — имя; «потом», слово словаря, слово без вопроса — нет", async () => {
  assert.equal(nameReply("просто айдина"), "Айдина");
  assert.equal(nameReply("Айдина"), "Айдина");
  assert.equal(nameReply("можно просто Марьям"), "Марьям");
  assert.equal(nameReply("я Айдина"), "Айдина");
  for (const said of ["потом", "неважно", "зачем", "никак", "хозяин", "ладно", "я дома", "я спать", "не скажу", "айдина ахмедова", "привет", "занята"]) assert.equal(nameReply(said), null, said);
  for (const said of ["Как к вам обращаться? Скажите: «зови меня …».", "Теперь ваша очередь: «меня зовут …».", "А тебя как зовут?", "Как вас зовут?"]) assert.ok(ASKS_NAME.test(said), said);
  for (const said of ["Меня зовут Аи.", "Приятно познакомиться, Айдина. Так и буду к вам обращаться."]) assert.ok(!ASKS_NAME.test(said), said);
  assert.equal(introRequest("меня айдина зовут"), "Айдина");
  assert.equal(introRequest("Айдина меня зовут"), "Айдина");
  for (const said of ["меня часто зовут", "меня так зовут", "все меня зовут", "друзья меня зовут"]) assert.equal(introRequest(said), null, said);

  reset();
  let at = NOON;
  const h = heart(ON, { now: () => at, random: () => 0 });
  // В личке номера сообщений идут подряд у обеих сторон: ответ человека — сразу за её вопросом.
  const waited = () => JSON.parse(sdk().kv.get("heart:askname:5") ?? "null");
  const say = (text, id) => h.onMessage({ message_id: id, chat: { id: 5, type: "private" }, from: { id: 5, first_name: "Тест", is_bot: false }, text }, KEY);
  const nameOf = () => JSON.parse(sdk().kv.get("heart:style:5") ?? "{}").address ?? null;
  // Так было у владельца: «не обращайся так» → её вопрос → «просто айдина» ушло модели.
  await say("не называй меня так", 50);
  assert.match(last(), /Как к вам обращаться\?/u);
  await say("просто айдина", waited().mid + 1);
  assert.equal(last(), "Приятно познакомиться, Айдина. Так и буду к вам обращаться.");
  assert.equal(nameOf(), "Айдина");
  assert.equal(waited(), null, "вопрос закрыт");
  assert.equal(chats().length, 0);
  // Вопрос из словаря — «давай знакомиться»; «потом» — не имя, а имя следом — ещё ответ на тот же вопрос.
  await say("давай знакомиться", 60);
  sdk().fetchQueue.push(says("Хорошо, потом."));
  await say("потом", waited().mid + 1);
  assert.equal(last(), "Хорошо, потом.");
  await say("Марьям", waited().mid + 3);
  assert.equal(last(), "Приятно познакомиться, Марьям. Так и буду к вам обращаться.");
  // Слово словаря после вопроса — слово словаря.
  await say("давай знакомиться", 70);
  await say("привет", waited().mid + 1);
  assert.equal(last(), "Привет.");
  assert.equal(nameOf(), "Марьям");
  // Вопрос был давно или не был вовсе — одно слово остаётся разговором.
  await say("давай знакомиться", 80);
  at += 6 * 60_000;
  sdk().fetchQueue.push(says("Кто это?"), says("А это кто?"));
  await say("Фатима", waited().mid + 1);
  assert.equal(last(), "Кто это?");
  reset();
  const fresh = heart(ON, { now: () => NOON, random: () => 0 });
  sdk().fetchQueue.push(says("А это кто?"));
  await fresh.onMessage(message("Фатима"), KEY);
  assert.equal(last(), "А это кто?");
  assert.equal(sdk().kv.get("heart:style:5") ?? null, null);
});

test("словарь: её назвали чужим именем («алиса давай») и хотят дать имя («давай я тебе имя дам») — отвечает сама", async () => {
  for (const said of ["алиса давай", "Алиса, включи музыку", "сири привет", "окей алиса", "маруся ты тут", "алиса который час"]) assert.deepEqual(book.match(said), ["назвали чужим именем"], said);
  for (const said of ["давай я тебе имя дам", "хочу дать тебе имя", "можно я буду звать тебя по-другому", "поменяй имя", "придумаю тебе прозвище"]) assert.deepEqual(book.match(said), ["дам тебе имя"], said);
  // О другой помощнице — прежние темы и ревность, а не «я не Алиса».
  assert.deepEqual(book.match("алиса лучше тебя"), ["алиса лучше тебя"]);
  assert.equal(book.match("алиса сказала что будет дождь"), null);
  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  await h.onMessage(message("алиса давай"), KEY);
  assert.equal(last(), "Я Аи. Та, кого вы зовёте, живёт в колонке.");
  await h.onMessage(message("давай я тебе имя дам"), KEY);
  assert.equal(last(), "Имя у меня уже есть — Аи. Менять не стану: оно мне по душе.");
  await h.onMessage(group("Аи, алиса давай"), KEY);
  assert.equal(chats().length, 0);
});

test("«как меня зовут?» — её ответ, а не догадка модели: имя, которое человек назвал сам; хозяину — «хозяин» наедине, имя — при всех", async () => {
  const { nameQuestion, addressRequest } = await import("../tgcloud/lib/personal.js");
  for (const said of ["как меня зовут?", "А как меня зовут", "ты помнишь, как меня зовут?", "ты знаешь моё имя?", "как ты меня называешь", "кто я?", "ты знаешь, кто я", "назови моё имя"]) assert.equal(nameQuestion(said), "who", said);
  for (const said of ["зови меня по имени", "называй меня просто по имени", "обращайся ко мне по имени"]) assert.equal(nameQuestion(said), "by", said);
  for (const said of ["кто я для тебя", "как меня зовут друзья знаешь", "как зовут твою сестру", "кто я такой чтобы судить", "как тебя зовут"]) assert.equal(nameQuestion(said), null, said);
  // «Зови меня по имени» раньше становилось именем «по имени».
  for (const said of ["зови меня по имени", "называй меня как хочешь", "зови меня по-другому"]) assert.equal(addressRequest(said), null, said);
  assert.equal(addressRequest("зови меня Али"), "Али");

  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  await h.onMessage(message("как меня зовут?"), KEY);
  assert.equal(last(), "В Telegram вы — Тест. А как вас звать? Скажите «меня зовут …» — запомню.");
  // Её ответ сам спрашивает имя — и слово следом становится именем.
  const waited = JSON.parse(sdk().kv.get("heart:askname:5"));
  await h.onMessage({ message_id: waited.mid + 1, chat: { id: 5, type: "private" }, from: { id: 5, first_name: "Тест", is_bot: false }, text: "Айдина" }, KEY);
  assert.equal(last(), "Приятно познакомиться, Айдина. Так и буду к вам обращаться.");
  await h.onMessage(message("ты помнишь, как меня зовут?"), KEY);
  assert.equal(last(), "Айдина. Так вы просили вас называть.");
  await h.onMessage(message("зови меня по имени"), KEY);
  assert.equal(last(), "Так и зову: Айдина.");
  // Хозяин: наедине — «хозяин»; при всех это слово не звучит.
  await h.onMessage(own("как меня зовут"), KEY);
  assert.equal(last(OWNER), "Вы — мой хозяин. Имени вы мне не называли. Скажите «меня зовут …» — запомню.");
  await h.onMessage(own("меня зовут Али"), KEY);
  await h.onMessage(own("кто я?"), KEY);
  assert.equal(last(OWNER), "Вы — мой хозяин. А по имени — Али.");
  const before = sdk().sent.length;
  await h.onMessage(group("Аи, как меня зовут?", { id: OWNER }), KEY);
  assert.equal(sdk().sent.at(-1).text, "Али. Так вы просили вас называть.");
  assert.equal(sdk().sent.length, before + 1);
  // «Хозяин» — слово занятое: гостю оно не достаётся, хозяину менять нечего.
  await h.onMessage(message("зови меня хозяин"), KEY);
  assert.equal(last(), "Хозяин у меня один, и это слово — его. Назовите имя: «зови меня …» — буду звать по имени.");
  assert.equal(JSON.parse(sdk().kv.get("heart:style:5")).address, "Айдина", "обращение не тронуто");
  await h.onMessage(own("зови меня хозяин"), KEY);
  assert.equal(last(OWNER), "Я и так зову вас хозяином. Другого слова для вас у меня нет.");
  assert.equal(chats().length, 0);
});

test("память теми словами, какими спрашивают: «что ты знаешь обо мне», «покажи память», «сотри память», «не запоминай это»", async () => {
  const { parseIntent } = await import("../tgcloud/lib/intents.js");
  const { parseAsked } = await import("../tgcloud/lib/asked.js");
  for (const said of ["что ты знаешь обо мне", "что ты помнишь про меня", "что обо мне помнишь", "покажи память", "покажи мои записи", "что ты запомнила", "покажи, что помнишь"]) assert.equal(parseIntent(said)?.intent, "memories", said);
  for (const said of ["сотри память", "очисти память", "обнули память", "сбрось всю память"]) assert.deepEqual(parseIntent(said)?.arg, { mode: "all" }, said);
  for (const said of ["не запоминай это", "не запоминай", "это не запоминай", "не надо это запоминать", "не записывай это"]) assert.deepEqual(parseIntent(said)?.arg, { mode: "last" }, said);
  assert.equal(parseIntent("не запоминай чат"), null, "это слово админа о памяти чата — не о записях человека");
  for (const said of ["что ты не знаешь?", "чего не знаешь", "чего ты не знала?"]) assert.deepEqual(parseAsked(said), { list: true }, said);

  reset();
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  await h.onMessage(message("запомни: я люблю чай"), KEY);
  await h.onMessage(message("что ты знаешь обо мне?"), KEY);
  assert.match(last(), /я люблю чай/u);
  await h.onMessage(message("не запоминай это"), KEY);
  assert.equal(last(), "Забыла последнее: «я люблю чай». Осталось 0.");
  assert.equal(chats().length, 0);
});

test("словарь: кто дал ей имя, нравится ли оно ей, «буду звать тебя Луна» — имя остаётся её", () => {
  assert.deepEqual(book.match("кто дал тебе имя?"), ["кто дал тебе имя"]);
  assert.deepEqual(book.match("тебе нравится твоё имя?"), ["тебе нравится твое имя"]);
  for (const said of ["буду звать тебя Луна", "можно я буду называть тебя Солнышко", "твоё новое имя Ася", "назову тебя Звёздочка"]) assert.deepEqual(book.match(said), ["дам тебе имя"], said);
  assert.deepEqual(book.match("как мне тебя называть"), ["как тебя зовут"]);
});
