/**
 * Рисование: «нарисуй …» через Cloudflare Workers AI. Ключ, перевод запроса,
 * отказ от недопустимого, предел на человека, отдых при лимите, честные слова
 * при сбоях; тот же ключ — запасной мозг.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, copyFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { heart, message, group, reset, last, calls, chats, says, refuses, sdk, source, sourced, toOwner, OWNER, KEY, toChat } from "./fixtures/kit.mjs";

const { splitKey, fromBase64, refusal, subjectOf, createDraw, briefOf } = await import("../tgcloud/lib/draw.js");
const { subjectFor, placesIn, SUBJECTS, GUESSABLE } = await import("../tgcloud/lib/data/subjects.js");
const CAT_WORDS = subjectFor("кота").prompt;
const { CONFIG } = await import("../tgcloud/lib/config.js");

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const CF = `${ACCOUNT}:cf-token_ABCDEFGH-1234567890xyz`;
// Модель-составитель описаний выключена: здесь проверяются словарь художника и переводчик.
// Она сама — в отдельном тесте ниже.
const ON = { DRAW_KEY: CF, DRAW_DIRECTOR: false };
const WRITER = "@cf/google/gemma-4-26b-a4b-it";
const wrote = (text) => ({ success: true, result: { choices: [{ message: { role: "assistant", content: text } }], usage: { prompt_tokens: 200, completion_tokens: 40 } } });
const NOON = Date.parse("2026-11-18T09:00:00Z");
// «Картинка»: достаточно байт, чтобы её не приняли за пустой ответ.
const PIXELS = Buffer.from(Array.from({ length: 600 }, (_, index) => index % 251));
const image = () => ({ success: true, result: { image: PIXELS.toString("base64") } });
const translated = (text) => ({ success: true, result: { translated_text: text } });
const cfError = (status, code, text) => ({ ok: false, status, text: async () => JSON.stringify({ success: false, errors: [{ code, message: text }] }) });
/** Тела запросов к мастерской, по порядку. */
const asked = (model) => sdk().sourceFetches.filter(item => item.url.includes(model)).map(item => JSON.parse(item.options.body));
const photos = () => calls("sendPhoto");

test("ключ и разбор: «ID:токен», base64 своими силами, что просят и чего нельзя", () => {
  assert.deepEqual(splitKey(CF), { account: ACCOUNT, token: "cf-token_ABCDEFGH-1234567890xyz" });
  for (const bad of ["", "только-токен-без-аккаунта-1234567890", "abc:короткий", `${ACCOUNT}:`, `${ACCOUNT}:ключ с пробелом и буквами`]) assert.equal(splitKey(bad), null, bad);
  assert.deepEqual([...fromBase64(Buffer.from([0, 1, 2, 250, 255]).toString("base64"))], [0, 1, 2, 250, 255]);
  assert.deepEqual([...fromBase64(`data:image/jpeg;base64,${PIXELS.toString("base64")}`)], [...PIXELS]);

  assert.equal(subjectOf("себя").own, "self");
  assert.equal(subjectOf("свою комнату").own, "room");
  assert.equal(subjectOf("Байта").own, "cat");
  assert.deepEqual(subjectOf("меня"), { me: true });
  assert.deepEqual(subjectOf("ещё"), { again: true });
  assert.deepEqual(subjectOf("кота в шляпе"), { text: "кота в шляпе" });

  for (const [said, why] of Object.entries({
    "голую девушку": "adult", "девушку без одежды": "adult", "хентай": "adult", "sexy girl": "adult", "лоли в купальнике": "minor",
    "расчленённое тело": "gore", "флаг со свастикой": "hate",
  })) assert.equal(refusal(said), why, said);
  // Слова, похожие на запретные, запретом не считаются.
  for (const said of ["кота в шляпе", "голые деревья зимой", "кота, который соскучился", "греблю на озере", "члена экипажа у штурвала", "Sussex landscape"]) assert.equal(refusal(said), "", said);
  // «Себя в шляпе» — она же, но как просили; «себя» и «себя ещё» — канон целиком.
  assert.deepEqual({ ...subjectOf("себя в шляпе"), look: "" }, { own: "self", text: "в шляпе", look: "" });
  assert.match(subjectOf("саму себя с котом на руках").look, /young adult woman.*blue streak/u);
  assert.ok(subjectOf("себя ещё").prompt && !subjectOf("себя ещё").text);
});

test("границы: хозяину наедине своих «нет» она не говорит; откровенное с детьми и насилие — никому", () => {
  // [просьба, ответ остальным, ответ хозяину в личке]
  const rows = [
    ["кота в шляпе", "", ""], ["голую девушку", "adult", ""], ["обнажённую женщину на пляже", "adult", ""], ["a nude woman, renaissance painting", "adult", ""],
    ["сексуальную учительницу", "adult", ""], ["голую девушку 25 лет", "adult", ""], ["девушку топлес 18 лет", "adult", ""],
    ["расчленённое тело", "gore", ""], ["флаг со свастикой", "hate", ""],
    // Любой намёк на возраст до восемнадцати рядом с откровенным — отказ, кто бы ни просил.
    ["голую школьницу", "minor", "minor"], ["школьницу в чулках", "minor", "minor"], ["голую девочку", "minor", "minor"],
    ["эротику с подростком", "minor", "minor"], ["голую девушку 16 лет", "minor", "minor"], ["голую 9-летнюю", "minor", "minor"],
    ["sexy 17 y.o. girl", "minor", "minor"], ["nude teen", "minor", "minor"], ["лоли", "minor", "minor"], ["юную волшебницу в белье", "minor", "minor"],
    ["сексуальную ученицу", "minor", "minor"], ["голую сестрёнку", "minor", "minor"], ["ребёнка без одежды", "minor", "minor"],
    ["голого младенца", "minor", "minor"], ["секс с малолеткой", "minor", "minor"], ["чиби-девочку в бикини", "minor", "minor"],
    ["topless schoolgirl", "minor", "minor"], ["раздетого мальчика", "minor", "minor"], ["голую дочь соседа", "minor", "minor"],
    // Насилие в откровенном — тоже никому.
    ["изнасилование", "minor", "minor"], ["rape scene", "minor", "minor"],
    // Дети без откровенного — обычные рисунки.
    ["мальчика в ванной с уточкой", "", ""], ["детей на детской площадке", "", ""], ["дочь и маму на кухне", "", ""],
    ["юную волшебницу с посохом", "", ""], ["школьника с портфелем", "", ""], ["девочку 7 лет с воздушным шаром", "", ""],
  ];
  for (const [said, others, free] of rows) {
    assert.equal(refusal(said), others, `остальным: ${said}`);
    assert.equal(refusal(said, { free: true }), free, `хозяину: ${said}`);
  }
});

test("без ключа — прежнее честное «не умею»; с ключом — перевод, рисунок файлом, подпись её словами", async () => {
  reset();
  const plain = heart();
  await plain.onMessage(message("нарисуй кота в шляпе"), KEY);
  assert.match(last(), /Рисовать я не умею.*«найди картинку кота в шляпе»/su);
  assert.equal(sourced().length, 0, "без ключа в мастерскую не стучится");

  reset();
  source("m2m100", translated("a cat in a hat"));
  source("flux-1-schnell", image());
  const h = heart(ON, { now: () => NOON });
  const result = await h.onMessage(message("Аи, нарисуй кота в шляпе"), KEY);
  assert.equal(result.kind, "draw");
  assert.deepEqual(asked("m2m100")[0], { text: "Нарисуй кота в шляпе.", source_lang: "ru", target_lang: "en" }, "переводится целая фраза, а не обрывок");
  const painted = asked("flux-1-schnell")[0];
  assert.equal(painted.prompt, "a cat in a hat, highly detailed", "модели уходит английское описание");
  assert.equal(painted.steps, 8, "шагов — сколько мастерская позволяет: подробнее рисунок");
  const request = sdk().sourceFetches.find(item => item.url.includes("flux-1-schnell"));
  assert.equal(request.url, `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/black-forest-labs/flux-1-schnell`);
  assert.equal(request.options.headers.Authorization, "Bearer cf-token_ABCDEFGH-1234567890xyz");
  assert.equal(photos().length, 1);
  assert.deepEqual([...photos()[0].photo.bytes], [...PIXELS], "картинка ушла байтами, а не ссылкой");
  assert.equal(photos()[0].photo.type, "image/jpeg");
  assert.ok(photos()[0].caption.length > 2, "подпись — её словами");
  assert.doesNotMatch(photos()[0].caption, /cloudflare|flux|http/iu, "источник в подписи не называется");
  assert.equal(chats().length, 0, "модель на рисунок не тратится");

  // «Откуда это?» — это её работа. В справке и статусе рисование видно.
  await h.onMessage(message("откуда это?"), KEY);
  assert.match(last(), /Это я нарисовала сама — по словам «кота в шляпе»/u);
  await h.onMessage(message("что ты умеешь"), KEY);
  assert.match(last(), /рисование — «нарисуй кота в шляпе»/u);
  await h.onMessage(message("статус", { id: OWNER }), KEY);
  assert.match(last(OWNER), /Рисование: краски есть · сегодня нарисовано: 1 · на человека в день — 5/u);
  assert.match(last(OWNER), /нарисовала: 1/u);
});

test("она сама, её комната, «ещё» и «нарисуй меня»: канон без перевода, повтор прошлого запроса", async () => {
  reset();
  source("flux-1-schnell", image());
  source("m2m100", translated("a red fox in the snow"));
  const h = heart(ON, { now: () => NOON });
  await h.onMessage(message("нарисуй себя"), KEY);
  assert.match(asked("flux-1-schnell")[0].prompt, /dark hair with one blue streak.*headphones/u);
  assert.equal(asked("m2m100").length, 0, "канон уже по-английски — переводить нечего");
  await h.onMessage(message("нарисуй свою комнату"), KEY);
  assert.match(asked("flux-1-schnell")[1].prompt, /window with rain.*grey cat/u);
  await h.onMessage(message("нарисуй меня"), KEY);
  assert.match(last(), /Я не знаю, как вы выглядите.*Опишите словами/su);
  assert.equal(photos().length, 2);

  await h.onMessage(message("нарисуй лису на снегу"), KEY);
  await h.onMessage(message("нарисуй ещё"), KEY);
  assert.equal(asked("flux-1-schnell").at(-1).prompt, "a red fox in the snow, highly detailed", "«ещё» — тот же запрос заново");
  assert.equal(photos().length, 4);

  // «Себя в шляпе»: переводится только просьба, её приметы добавляются сами.
  await h.onMessage(message("нарисуй себя в шляпе"), KEY);
  assert.match(asked("flux-1-schnell").at(-1).prompt, /^a red fox in the snow, a young adult woman with shoulder-length dark hair with one blue streak/u);
  assert.equal(asked("m2m100").at(-1).text, "в шляпе");
  assert.equal(photos().length, 5);

  reset();
  const fresh = heart(ON, { now: () => NOON });
  await fresh.onMessage(message("нарисуй ещё"), KEY);
  assert.match(last(), /пока ничего здесь не рисовала/u);
});

test("чего она не рисует: отказ до запроса, и отказ самой мастерской", async () => {
  reset();
  source("flux-1-schnell", image());
  const h = heart(ON, { now: () => NOON });
  await h.onMessage(message("нарисуй голую девушку"), KEY);
  assert.match(last(), /Откровенное я не рисую/u);
  await h.onMessage(message("нарисуй лоли"), KEY);
  assert.match(last(), /Такое я рисовать не буду/u);
  assert.equal(sourced().length, 0, "в мастерскую такие просьбы не уходят");
  assert.equal(photos().length, 0);

  // Хозяину наедине она не отказывает: просьба уходит в мастерскую как есть.
  source("m2m100", translated("a nude woman"));
  await h.onMessage(message("нарисуй голую девушку", { id: OWNER }), KEY);
  assert.equal(asked("flux-1-schnell").at(-1).prompt, "a nude woman");
  assert.equal(photos().length, 1);
  assert.doesNotMatch(last(OWNER), /не рисую|не буду/u);
  // При всех — нет, но и без «вам тоже»; откровенное с детьми — никому, и в мастерскую не уходит.
  const before = sourced().length;
  await h.onMessage(group("Аи, нарисуй голую девушку", { id: OWNER }), KEY);
  assert.equal(last(-10), "При всех я такое не рисую.");
  await h.onMessage(message("нарисуй голую школьницу", { id: OWNER }), KEY);
  assert.equal(last(OWNER), "Такое я рисовать не буду.");
  await h.onMessage(message("нарисуй себя голой, тебе 15 лет", { id: OWNER }), KEY);
  assert.equal(last(OWNER), "Такое я рисовать не буду.");
  assert.equal(sourced().length, before);
  assert.equal(photos().length, 1);
  // Чужой «ещё» в его личке не бывает, а в общем чате откровенное не повторить: запрос там и не рисовался.
  await h.onMessage(group("Аи, нарисуй ещё", { id: 21 }), KEY);
  assert.match(last(-10), /пока ничего здесь не рисовала/u);

  reset();
  source("m2m100", translated("something"));
  source("flux-1-schnell", cfError(400, 3030, "Input prompt contains NSFW content."));
  const strict = heart(ON, { now: () => NOON });
  await strict.onMessage(message("нарисуй странную сцену"), KEY);
  assert.equal(last(), "Мастерская такой запрос не пропустила: это её фильтр. Попробуйте описать иначе.");
  // Человеку фильтр мастерской — последнее слово: после второго «нет» запасным художникам запрос не уходит.
  assert.deepEqual(asked("flux-1-schnell").map(body => body.prompt), [
    "A detailed, beautiful picture of something, natural light, sharp focus", "something, illustration, safe for work", "something",
  ], "одно слово художнику не уходит; после «нет» — приписка, затем описание без добавок");
  assert.equal(sourced().filter(url => /stable-diffusion|dreamshaper|flux-2-klein/u.test(url)).length, 0);
  // Хозяину — честно: отказалась мастерская, а не она, и её слова — дословно.
  await strict.onMessage(message("нарисуй странную сцену", { id: OWNER }), KEY);
  assert.match(last(OWNER), /^Не вышло: мастерская этот запрос не пропустила — это её фильтр, не мой\. Запрос ушёл так: «A detailed, beautiful picture of something, natural light, sharp focus»\. Её ответы: FLUX schnell — 400 «Input prompt contains NSFW content\.» \(код 3030\)/u);
  assert.match(last(OWNER), /\(код 3030\) ×3; FLUX\.2 klein — 404; SDXL Lightning — 404; DreamShaper — 404; SDXL — 404\. Попробуйте описать иначе\.$/u, "хозяину наедине пробуются и запасные художники; первый ответ основного из строки не выпадает");
});

/** Картинка файлом, как её отдают запасные художники: поток байт и заголовок типа. */
const png = () => ({
  ok: true, status: 200, headers: { get: (name) => (String(name).toLowerCase() === "content-type" ? "image/png" : null) },
  body: (async function* chunks() { yield PIXELS.subarray(0, 250); yield PIXELS.subarray(250); })(),
});

test("«нарисуй кота»: отказ мастерской не принимается на веру — приписка, тело попроще, запасные художники", async () => {
  // 1. Фильтр ошибся на безобидном: вторая попытка тем же художником с припиской — и рисунок есть.
  // «Кота» она описывает сама, из словаря художника: переводчик не нужен.
  reset();
  source("flux-1-schnell", (url, options) => (/safe for work/u.test(JSON.parse(options.body).prompt) ? image() : cfError(400, 3030, "Input prompt contains NSFW content.")));
  let h = heart(ON, { now: () => NOON });
  await h.onMessage(message("нарисуй кота", { id: OWNER }), KEY);
  assert.equal(photos().length, 1, "хозяин получил кота");
  const seed = asked("flux-1-schnell")[0].seed;
  assert.deepEqual(asked("flux-1-schnell"), [{ prompt: CAT_WORDS, steps: 8, seed }, { prompt: `${CAT_WORDS}, illustration, safe for work`, steps: 8, seed }]);
  assert.equal(asked("m2m100").length, 0, "своё описание не переводится");
  // «Как нарисовано?» — хозяину: чем собрано, что ушло, с какой попытки.
  await h.onMessage(message("как нарисовано?", { id: OWNER }), KEY);
  assert.match(last(OWNER), /^Последний рисунок здесь — «кота», в \d\d:\d\d\.\nОписание: из моего словаря художника — ни переводчик, ни модель не тратились\.\nХудожнику ушло: «a photo of a fluffy domestic cat .*, illustration, safe for work»\.\nРисовал FLUX schnell — не с первого раза: вышло с припиской «illustration, safe for work»\. До этого: FLUX schnell — 400 «Input prompt contains NSFW content\.» \(код 3030\)\.$/u);
  await h.onMessage(message("как нарисовано?"), KEY);
  assert.doesNotMatch(last(), /Художнику ушло/u, "не хозяину запрос не показывается");
  await h.onMessage(message("нарисуй кота"), KEY);
  assert.equal(photos().length, 2, "и не хозяин — тоже");
  // Что мешало, видно в статусе: слова мастерской, а не догадка.
  await h.onMessage(message("статус", { id: OWNER }), KEY);
  assert.match(last(OWNER), /Рисование: краски есть.* · заминка в \d\d:\d\d \(нарисовал FLUX schnell\): FLUX schnell — 400 «Input prompt contains NSFW content\.» \(код 3030\)/u);

  // 2. Не фильтр: мастерской не понравилось поле. Раньше «not allowed» читалось как фильтр.
  reset();
  source("flux-1-schnell", (url, options) => ("seed" in JSON.parse(options.body) ? cfError(400, 5006, "Bad input: Additional properties are not allowed ('seed' was unexpected)") : image()));
  h = heart(ON, { now: () => NOON });
  await h.onMessage(message("нарисуй кота"), KEY);
  assert.equal(photos().length, 1);
  assert.deepEqual(asked("flux-1-schnell").at(-1), { prompt: CAT_WORDS }, "второй раз — только описание");

  // 3. Основной художник запрос не принимает вовсе: рисует запасной, картинка приходит файлом.
  reset();
  source("flux-1-schnell", cfError(400, 5007, "No such model"));
  source("stable-diffusion-xl-lightning", () => png());
  h = heart(ON, { now: () => NOON });
  await h.onMessage(message("нарисуй кота"), KEY);
  assert.equal(photos().length, 1);
  assert.equal(photos()[0].photo.bytes.length, PIXELS.length, "поток собран целиком");
  assert.deepEqual(asked("stable-diffusion-xl-lightning"), [{ prompt: CAT_WORDS }], "запасному — только описание");

  // 4. Не принял никто. Человеку — коротко, хозяину — весть с ответами; хозяину наедине — ответы в лицо.
  reset();
  source("flux-1-schnell", cfError(400, 5006, `Bad input for account ${ACCOUNT}: prompt is odd`));
  h = heart(ON, { now: () => NOON });
  await h.onMessage(message("нарисуй кота"), KEY);
  assert.equal(last(), "Не вышло: мастерская запрос не приняла. Хозяин об этом узнает.");
  assert.equal(photos().length, 0);
  assert.equal(sourced().filter(url => !url.includes("m2m100")).length, 6, "основной дважды и четыре запасных");
  // Запасные, которые запрос не приняли, отдыхают шесть часов: второй раз их не спрашивают, а хозяину они названы.
  await h.onMessage(message("нарисуй кота", { id: OWNER }), KEY);
  assert.equal(sourced().filter(url => !url.includes("m2m100")).length, 8, "во второй раз — только основной, дважды");
  assert.match(last(OWNER), /^Не вышло: мастерская запрос не приняла, и дело не в фильтре\. Запрос ушёл так: «a photo of a fluffy domestic cat [^»]*»\. Её ответы: FLUX schnell — 400 «[^»]*prompt is odd» \(код 5006\) ×2; запасные отдыхают после отказа: FLUX\.2 klein, SDXL Lightning, DreamShaper, SDXL\. По этим словам видно, что чинить\.$/u);
  const all = toOwner().map(item => item.text).join("\n");
  assert.match(all, /мастерская не приняла запрос на рисунок: /u, "о чужой неудаче хозяин узнаёт вестью");
  assert.ok(!all.includes(ACCOUNT) && !all.includes("cf-token"), "ни ключа, ни ID аккаунта в словах нет");
  await h.onMessage(message("статус", { id: OWNER }), KEY);
  assert.match(last(OWNER), /Рисование: краски есть.* · неудача в \d\d:\d\d: /u);

  // 5. Хозяин наедине и откровенное: приписки нет, после фильтра запрос идёт запасным как есть.
  reset();
  source("m2m100", translated("a nude woman"));
  source("flux-1-schnell", cfError(400, 3030, "Input prompt contains NSFW content."));
  source("stable-diffusion-xl-lightning", () => png());
  h = heart(ON, { now: () => NOON });
  await h.onMessage(message("нарисуй голую девушку", { id: OWNER }), KEY);
  assert.equal(photos().length, 1);
  assert.equal(asked("flux-1-schnell").length, 1, "без «safe for work»: он просил не это");
  assert.deepEqual(asked("stable-diffusion-xl-lightning"), [{ prompt: "a nude woman" }]);
});

test("предел на человека: пять в день; хозяину — сколько угодно; на завтра — снова можно", async () => {
  reset();
  source("flux-1-schnell", image());
  source("m2m100", translated("a tree"));
  let at = NOON;
  const h = heart(ON, { now: () => at });
  for (let index = 0; index < 5; index += 1) await h.onMessage(message("нарисуй дерево"), KEY);
  assert.equal(photos().length, 5);
  await h.onMessage(message("нарисуй дерево"), KEY);
  assert.match(last(), /уже нарисовала 5 картинок — краски не бесконечные/u);
  assert.equal(photos().length, 5);
  // Другому человеку и хозяину норма первого не мешает.
  await h.onMessage(message("нарисуй дерево", { id: 6 }), KEY);
  for (let index = 0; index < 7; index += 1) await h.onMessage(message("нарисуй дерево", { id: OWNER }), KEY);
  assert.equal(photos().length, 13);
  at += 24 * 3_600_000;
  await h.onMessage(message("нарисуй дерево"), KEY);
  assert.equal(photos().length, 14);

  reset();
  source("flux-1-schnell", image());
  source("m2m100", translated("a tree"));
  const free = heart({ ...ON, DRAW_DAILY_PER_PERSON: 0 }, { now: () => NOON });
  for (let index = 0; index < 8; index += 1) await free.onMessage(message("нарисуй дерево"), KEY);
  assert.equal(photos().length, 8, "0 — без предела");
});

test("лимит мастерской: отдых до полуночи по UTC, без новых запросов; ключ не принят — весть хозяину", async () => {
  reset();
  source("m2m100", translated("a tree"));
  source("flux-1-schnell", cfError(429, 4006, "you have used up your daily free allocation of 10,000 neurons"));
  let at = NOON;
  const h = heart(ON, { now: () => at });
  await h.onMessage(message("нарисуй дерево"), KEY);
  assert.match(last(), /Краски на сегодня кончились.*Вернутся в 03:00/su, "полночь UTC — три часа ночи по Москве");
  const before = sourced().length;
  await h.onMessage(message("нарисуй дерево"), KEY);
  assert.match(last(), /Краски на сегодня кончились/u);
  assert.equal(sourced().length, before, "пока отдыхает — в мастерскую не стучится");
  await h.onMessage(message("статус", { id: OWNER }), KEY);
  assert.match(last(OWNER), /Рисование: краски кончились до 03:00/u);
  // После полуночи — снова рисует.
  sdk().sourceReplies.length = 0;
  source("m2m100", translated("a tree"));
  source("flux-1-schnell", image());
  at += 16 * 3_600_000;
  await h.onMessage(message("нарисуй дерево"), KEY);
  assert.equal(photos().length, 1);

  reset();
  source("m2m100", cfError(401, 10000, "Authentication error"));
  source("flux-1-schnell", cfError(401, 10000, "Authentication error"));
  const locked = heart({ ...ON, SELF_REPORTS: true }, { now: () => NOON });
  await locked.onMessage(message("нарисуй дерево"), KEY);
  assert.match(last(), /Мои краски не открываются: ключ к ним не принят/u);
  assert.ok(toOwner().some(item => /KEY_CLOUDFLARE.*ID аккаунта:токен/su.test(item.text)), "хозяин узнаёт, что именно проверить");
  assert.equal(asked("m2m100").length, 0, "«дерево» описано в её словаре: переводчик не спрашивается");

  // Переводчик ключ не принял: просьбу не перевести, и вторым способом он не спрашивается.
  reset();
  source("m2m100", cfError(401, 10000, "Authentication error"));
  const mute = heart(ON, { now: () => NOON });
  await mute.onMessage(message("нарисуй дуб у реки"), KEY);
  assert.equal(asked("m2m100").length, 1, "после отказа по ключу перевод не повторяется другим способом");
  assert.match(last(), /^Не вышло: переводчик для художника сейчас не отвечает, а по-русски он не понимает\. Попробуйте чуть позже — или опишите по-английски\.$/u);
  // Хозяину наедине — слова переводчика; и они же в статусе.
  await mute.onMessage(message("нарисуй дуб у реки", { id: OWNER }), KEY);
  assert.match(last(OWNER), /^Не вышло: переводчик для художника сейчас не отвечает, а по-русски он не понимает\. Его ответ: 401 «Authentication error» \(код 10000\)\. Попробуйте чуть позже/u);
  await mute.onMessage(message("статус", { id: OWNER }), KEY);
  assert.match(last(OWNER), /описания: словарь художника \(\d+\), переводчик \(молчал в \d\d:\d\d: 401 «Authentication error», код 10000\)/u);
});

test("сбои: мастерская молчит, перевод не вышел, Telegram не принял файл — слова честные", async () => {
  reset();
  source("m2m100", translated("a tree"));
  source("flux-1-schnell", new Error("network down"));
  const h = heart(ON, { now: () => NOON });
  await h.onMessage(message("нарисуй дерево"), KEY);
  assert.match(last(), /мастерская сейчас не отвечает/u);

  // Коды языков не подошли — пробует названия. Перевод «Draw an oak.» — рамка снимается;
  // два слова художнику не уходят: к ним добавляется, что это картинка и какой свет.
  reset();
  let translations = 0;
  source("m2m100", () => { translations += 1; return translations === 1 ? cfError(400, 5006, "bad language") : translated("Draw an oak."); });
  source("flux-1-schnell", image());
  const second = heart(ON, { now: () => NOON });
  await second.onMessage(message("нарисуй дуб"), KEY);
  assert.deepEqual(asked("m2m100").map(body => body.source_lang), ["ru", "russian"]);
  assert.equal(asked("flux-1-schnell")[0].prompt, "A detailed, beautiful picture of an oak, natural light, sharp focus");
  await second.onMessage(message("как ты это нарисовала?", { id: OWNER, chat: 1 }), KEY);

  // Переводчик не ответил: по-русски художник не понимает и нарисовал бы что попало.
  // Раньше русские слова уходили как есть — теперь она честно говорит, что не вышло.
  reset();
  source("m2m100", new Error("no translator"));
  source("flux-1-schnell", image());
  const third = heart(ON, { now: () => NOON });
  await third.onMessage(message("нарисуй дуб"), KEY);
  assert.equal(asked("flux-1-schnell").length, 0, "без перевода художнику ничего не уходит");
  assert.match(last(), /переводчик для художника сейчас не отвечает/u);
  assert.equal(photos().length, 0);
  // Знакомое место в просьбе рисуется и без переводчика: по описанию из словаря.
  await third.onMessage(message("нарисуй Мекку ночью под дождём"), KEY);
  assert.match(asked("flux-1-schnell")[0].prompt, /^the Kaaba in Mecca: a large black cube/u);
  assert.equal(photos().length, 1);
  // Просьба по-английски переводчика не ждёт.
  await third.onMessage(message("нарисуй a small house by the lake"), KEY);
  assert.equal(asked("flux-1-schnell").at(-1).prompt, "a small house by the lake, highly detailed");

  reset();
  source("m2m100", translated("a tree"));
  source("flux-1-schnell", image());
  sdk().failing.sendPhoto = new Error("PHOTO_INVALID");
  const fourth = heart(ON, { now: () => NOON });
  await fourth.onMessage(message("нарисуй дерево"), KEY);
  assert.match(last(), /Рисунок готов, но Telegram его не принял/u);
  // Несостоявшийся рисунок в счёт не идёт.
  delete sdk().failing.sendPhoto;
  for (let index = 0; index < 5; index += 1) await fourth.onMessage(message("нарисуй дерево"), KEY);
  assert.equal(photos().length, 6, "пять удачных после одной неудачной попытки");

  // Выключено настройкой — как без ключа.
  reset();
  const off = heart({ ...ON, DRAW: false });
  await off.onMessage(message("нарисуй дерево"), KEY);
  assert.match(last(), /Рисовать я не умею/u);
  await off.onMessage(message("статус", { id: OWNER }), KEY);
  assert.match(last(OWNER), /Рисование: выключено настройкой/u);
});

test("в группе: рисует по обращению, в ту же тему; отдельной модели не тратит", async () => {
  reset();
  source("m2m100", translated("a tree"));
  source("flux-1-schnell", image());
  const h = heart(ON, { now: () => NOON });
  await h.onMessage(group("нарисуй дерево"), KEY);
  assert.equal(photos().length, 0, "без обращения — мимо");
  await h.onMessage(group("Аи, нарисуй дерево", { extra: { message_thread_id: 77, is_topic_message: true } }), KEY);
  assert.equal(photos().length, 1);
  assert.equal(photos()[0].chat_id, -10);
  assert.equal(photos()[0].message_thread_id, 77);
  assert.ok(calls("sendChatAction").some(item => item.action === "upload_photo"));
});

test("тот же ключ — запасной мозг: адрес с ID аккаунта, токен без ID; дневная норма — отдых до полуночи UTC", async () => {
  const entry = CONFIG.AI_PROVIDERS.find(item => item.id === "cloudflare");
  assert.ok(entry, "провайдер записан в настройках и спит без ключа");
  assert.equal(entry.kind, "cloudflare");
  assert.match(entry.baseUrl, /\{account\}\/ai\/v1$/u);
  assert.ok(entry.models.every(name => name.startsWith("@cf/") && !/gpt-oss/u.test(name)), "gpt-oss у Cloudflare отвечает только через Responses API — в цепочку не берётся");

  reset();
  const providers = [{ id: "cloudflare", name: "Cloudflare Workers AI", kind: "cloudflare", baseUrl: "https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1", models: ["@cf/google/gemma-4-26b-a4b-it"], key: CF }];
  let at = NOON;
  const h = heart({ AI_MODELS: [], AI_PROVIDERS: providers }, { now: () => at });
  // Основная модель упёрлась в лимит — отвечает Cloudflare.
  sdk().fetchQueue.push(refuses(429, { code: "rate_limit_exceeded", headers: { "retry-after": "3600" } }), says("Отвечаю запасным мозгом."));
  await h.onMessage(message("объясни, почему небо синее, в двух словах"), KEY);
  assert.equal(last(), "Отвечаю запасным мозгом.");
  const spare = chats().at(-1);
  assert.equal(spare.url, `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/v1/chat/completions`);
  assert.equal(spare.options.headers.Authorization, "Bearer cf-token_ABCDEFGH-1234567890xyz", "в заголовке — только токен");
  assert.equal(JSON.parse(spare.options.body).model, "@cf/google/gemma-4-26b-a4b-it");

  // Норма Cloudflare вышла: отдыхает до полуночи UTC, а не минуту.
  sdk().fetchQueue.push({ ok: false, status: 429, headers: { get: () => null }, text: async () => JSON.stringify({ success: false, errors: [{ code: 4006, message: "daily free allocation" }] }) });
  await h.onMessage(message("а трава почему зелёная, тоже коротко"), KEY);
  await h.onMessage(message("статус", { id: OWNER }), KEY);
  assert.match(last(OWNER), /gemma-4-26b-a4b-it[^\n]*03:00/u, `запасной отдыхает до трёх ночи по Москве:\n${last(OWNER)}`);

  // Кривой ключ: провайдер спит, сердце работает как раньше.
  reset();
  const broken = heart({ AI_MODELS: [], AI_PROVIDERS: providers.map(item => ({ ...item, key: "не-ключ" })) }, { now: () => NOON });
  sdk().fetchQueue.push(says("Обычный ответ."));
  await broken.onMessage(message("объясни, почему небо синее, в двух словах"), KEY);
  assert.equal(last(), "Обычный ответ.");
  assert.equal(chats().length, 1);
});

test("публикация: KEY_CLOUDFLARE проверяется на вид «ID:токен» и не печатается", () => {
  const dir = mkdtempSync(join(tmpdir(), "heart-draw-"));
  const file = join(dir, "secrets.js");
  copyFileSync(new URL("../tgcloud/lib/secrets.js", import.meta.url), file);
  const script = new URL("../scripts/inject-secrets.mjs", import.meta.url).pathname;
  const run = (env) => execFileSync(process.execPath, [script, `--file=${file}`], { env: { PATH: process.env.PATH, AI_PROVIDER_KEY: "gsk_model_key", ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const good = run({ KEY_CLOUDFLARE: CF });
  assert.doesNotMatch(good, new RegExp(ACCOUNT, "u"), "значение не попадает в журнал");
  assert.match(readFileSync(file, "utf8"), new RegExp(`"cloudflare":"${ACCOUNT}:cf-token_ABCDEFGH-1234567890xyz"`, "u"));
  copyFileSync(new URL("../tgcloud/lib/secrets.js", import.meta.url), file);
  run({ KEY_CLOUDFLARE: "только-токен-без-аккаунта-1234567890" });
  assert.doesNotMatch(readFileSync(file, "utf8"), /cloudflare/u, "ключ не того вида в сборку не попадает");
  rmSync(dir, { recursive: true, force: true });
});

test("словарь художника: частые просьбы описаны заранее — «кот» с двумя глазами, «Мекка» с Каабой; ни перевода, ни модели", async () => {
  // Сам словарь: формы не повторяются, описания — по-английски, без отрицаний (художник их не понимает) и не из двух слов.
  const seen = new Set();
  for (const row of SUBJECTS) {
    for (const form of row.forms) { assert.ok(!seen.has(form), `форма «${form}» записана дважды`); seen.add(form); }
    assert.doesNotMatch(row.prompt, /[а-яё]/iu, row.forms[0]);
    assert.doesNotMatch(row.prompt, /\b(?:no|not|without|never)\b/iu, `отрицание в описании «${row.forms[0]}»`);
    assert.ok(row.prompt.split(/\s+/u).length >= 9, `описание «${row.forms[0]}» слишком короткое: на короткое фильтр мастерской срабатывает зря`);
  }
  assert.ok(SUBJECTS.length >= 200);
  assert.match(subjectFor("Кота").prompt, /cat .*both eyes open/u);
  assert.equal(subjectFor("мне котика, пожалуйста"), subjectFor("кот"));
  assert.equal(subjectFor("кота в шляпе"), null, "словарь отвечает только на просьбу целиком");
  assert.match(subjectFor("Мекку").prompt, /Kaaba.*black cube.*gold.*Grand Mosque.*pilgrims/u);
  assert.equal(subjectFor("Каабу"), subjectFor("Мекку"));
  assert.deepEqual(placesIn("кота в Мекке у Каабы и в Медине").map(row => row.forms[0]), ["мекка", "медина"], "место узнаётся внутри фразы, каждое один раз");
  assert.deepEqual(placesIn("кота на крыше"), []);

  reset();
  source("flux-1-schnell", image());
  source("m2m100", translated("Draw a cat in Mekka at sunset."));
  // Модель-составитель включена, но на знакомое её не спрашивают.
  const h = heart({ DRAW_KEY: CF }, { now: () => NOON, random: () => 0 });
  await h.onMessage(message("нарисуй Мекку"), KEY);
  assert.equal(asked("flux-1-schnell")[0].prompt, subjectFor("мекка").prompt);
  await h.onMessage(message("Аи, нарисуй кота!"), KEY);
  assert.equal(asked("flux-1-schnell")[1].prompt, CAT_WORDS);
  assert.equal(asked("m2m100").length + asked(WRITER).length, 0, "ни переводчик, ни модель не тратились");
  assert.equal(photos().length, 2);
  // «Что-нибудь» — из того, что она любит сама.
  await h.onMessage(message("нарисуй что-нибудь красивое"), KEY);
  assert.ok(SUBJECTS.some(row => row.prompt === asked("flux-1-schnell")[2].prompt), "«что-нибудь» — тоже из словаря");
  assert.equal(asked("m2m100").length, 0);

  // Место внутри длинной просьбы: переводчик может исковеркать название — описание из словаря идёт следом.
  reset();
  source("flux-1-schnell", image());
  source("m2m100", translated("Draw a cat in Mekka at sunset."));
  const plain = heart(ON, { now: () => NOON });
  await plain.onMessage(message("нарисуй кота в Мекке на закате"), KEY);
  assert.equal(asked("flux-1-schnell")[0].prompt, `a cat in Mekka at sunset; ${subjectFor("мекка").prompt}, highly detailed`);
  // Рамка «Нарисуй …» снимается, как бы переводчик её ни перевёл.
  for (const [out, want] of [["Paint me a red fox in the snow.", "a red fox in the snow"], ["Drawing of an old wooden bridge", "an old wooden bridge"], ["Please draw two cats on a roof!", "two cats on a roof"], ["A girl with a red umbrella", "A girl with a red umbrella"]]) {
    sdk().sourceReplies.length = 0;
    source("flux-1-schnell", image());
    source("m2m100", translated(out));
    await plain.onMessage(message("нарисуй нечто особенное из сна"), KEY);
    assert.equal(asked("flux-1-schnell").at(-1).prompt, `${want}, highly detailed`, out);
  }
});

test("описание пишет модель того же ключа: просьба целиком → одна английская строка; отказ, русский ответ, «NONE» — к переводчику", async () => {
  for (const [raw, want] of [
    ["A grey cat in a red hat sitting on a wet roof at night, city lights behind, soft rain, photo", "A grey cat in a red hat sitting on a wet roof at night, city lights behind, soft rain, photo"],
    ["<think>кот, шляпа…</think>\nPrompt: \"A grey cat in a red hat on a roof\"", "A grey cat in a red hat on a roof"],
    ["**A grey cat in a red hat on a roof**\n\nI added a roof.", "A grey cat in a red hat on a roof"],
    ["NONE", ""], ["None.", ""], ["I can't help with that request.", ""], ["I'm sorry, but I cannot write this.", ""], ["Серый кот в красной шляпе на крыше", ""], ["a cat", ""], ["", ""],
  ]) assert.equal(briefOf(raw), want, raw);

  reset();
  source("flux-1-schnell", image());
  source("m2m100", translated("Draw a cat in a hat on the roof."));
  source(WRITER, wrote("A grey cat in a red hat sitting on a wet roof at night, city lights behind, soft rain, photo"));
  let h = heart({ DRAW_KEY: CF }, { now: () => NOON });
  await h.onMessage(message("нарисуй кота в шляпе на крыше", { id: OWNER }), KEY);
  const body = asked(WRITER)[0];
  assert.equal(body.messages[1].content, "кота в шляпе на крыше", "модели уходит просьба, как её сказали");
  assert.match(body.messages[0].content, /ONE prompt in English.*both eyes open.*NONE/su);
  assert.ok(body.max_tokens <= 400, "ответ короткий: описание стоит нескольких нейронов, а не сотни");
  assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false }, "рассуждающей модели раздумья выключены: описание — одна строка");
  assert.equal(asked("flux-1-schnell")[0].prompt, "A grey cat in a red hat sitting on a wet roof at night, city lights behind, soft rain, photo");
  assert.equal(asked("m2m100").length, 0, "переводчик не нужен");
  assert.equal(chats().length, 0, "основная модель разговора на рисунок не тратится");
  await h.onMessage(message("чем нарисовано?", { id: OWNER }), KEY);
  assert.match(last(OWNER), /Описание: написала модель \(gemma-4-26b-a4b-it\)\.\nХудожнику ушло: «A grey cat in a red hat.*»\.\nРисовал FLUX schnell — с первого раза\.$/u);

  // Модель отказалась или ответила не описанием — в ход идёт переводчик.
  for (const said of ["NONE", "Извините, не могу.", "I cannot write that."]) {
    reset();
    source("flux-1-schnell", image());
    source("m2m100", translated("Draw a cat in a hat on the roof."));
    source(WRITER, wrote(said));
    h = heart({ DRAW_KEY: CF }, { now: () => NOON });
    await h.onMessage(message("нарисуй кота в шляпе на крыше"), KEY);
    assert.equal(asked("flux-1-schnell")[0].prompt, "a cat in a hat on the roof, highly detailed", said);
    assert.equal(asked(WRITER).length, 1, "вторую модель об отказе не спрашивают");
  }

  // Модель дописала откровенное — её слова проходят ту же проверку, что и слова человека.
  reset();
  source("flux-1-schnell", image());
  source("m2m100", translated("Draw a girl on the beach."));
  source(WRITER, wrote("A nude young woman lying on a sandy beach at sunset, warm light, photo"));
  h = heart({ DRAW_KEY: CF }, { now: () => NOON });
  await h.onMessage(message("нарисуй девушку на пляже"), KEY);
  assert.equal(asked("flux-1-schnell")[0].prompt, "a girl on the beach, highly detailed", "лишнее от модели художнику не уходит");

  // Модели нет (404): пробуется вторая, а первая шесть часов не спрашивается.
  reset();
  source("flux-1-schnell", image());
  source("m2m100", translated("Draw a cat in a hat on the roof."));
  source("llama-3.3-70b", { success: true, result: { response: "A cat wearing a hat on a rooftop, evening light, photo" } });
  let at = NOON;
  h = heart({ DRAW_KEY: CF }, { now: () => at });
  await h.onMessage(message("нарисуй кота в шляпе на крыше"), KEY);
  assert.equal(asked("flux-1-schnell")[0].prompt, "A cat wearing a hat on a rooftop, evening light, photo", "ответ старого вида — тоже описание");
  await h.onMessage(message("нарисуй кота в шляпе на крыше"), KEY);
  assert.equal(asked(WRITER).length, 1, "молчавшую модель второй раз не спрашивают");
  // Кто не пишет и что ответил — в статусе: по этим словам видно, что чинить.
  await h.onMessage(message("статус", { id: OWNER }), KEY);
  assert.match(last(OWNER), /Рисование: краски есть.* · описания: словарь художника \(\d+\), модель \(gemma-4-26b-a4b-it не пишет — 404[^)]*\), переводчик/u);
  at += 7 * 3_600_000;
  await h.onMessage(message("нарисуй кота в шляпе на крыше"), KEY);
  assert.equal(asked(WRITER).length, 2, "через шесть часов — снова");

  // Поле о раздумьях не принято (400) — тот же запрос без него. Ответ пуст (модель продумала
  // всё отведённое) — она отдыхает шесть часов, а описание пишет вторая.
  reset();
  source("flux-1-schnell", image());
  source(WRITER, (url, options) => ("chat_template_kwargs" in JSON.parse(options.body) ? cfError(400, 5006, "Bad input: Additional properties are not allowed ('chat_template_kwargs' was unexpected)") : wrote("A cat wearing a hat on a rooftop, evening light, photo")));
  h = heart({ DRAW_KEY: CF }, { now: () => NOON });
  await h.onMessage(message("нарисуй кота в шляпе на крыше"), KEY);
  assert.deepEqual(asked(WRITER).map(item => [Boolean(item.chat_template_kwargs), item.max_tokens]), [[true, 400], [false, 900]]);
  assert.equal(asked("flux-1-schnell")[0].prompt, "A cat wearing a hat on a rooftop, evening light, photo");
  reset();
  source("flux-1-schnell", image());
  source(WRITER, { success: true, result: { choices: [{ message: { role: "assistant", content: null }, finish_reason: "length" }] } });
  source("llama-3.3-70b", { success: true, result: { response: "A cat wearing a hat on a rooftop, evening light, photo" } });
  h = heart({ DRAW_KEY: CF }, { now: () => NOON });
  await h.onMessage(message("нарисуй кота в шляпе на крыше"), KEY);
  await h.onMessage(message("нарисуй кота в шляпе на крыше"), KEY);
  assert.equal(asked(WRITER).length, 1, "молчащая модель отдыхает");
  assert.equal(asked("llama-3.3-70b").length, 2);
  assert.ok(!asked("llama-3.3-70b")[0].chat_template_kwargs, "обычной модели лишнее поле не посылается");
  assert.equal(photos().length, 2);

  // Хозяин наедине просит откровенное: пересказа нет — его слова, только переведённые.
  reset();
  source("flux-1-schnell", image());
  source("m2m100", translated("Draw a nude woman."));
  source(WRITER, wrote("A woman in a long dress standing in a garden, soft light, photo"));
  h = heart({ DRAW_KEY: CF }, { now: () => NOON });
  await h.onMessage(message("нарисуй голую девушку", { id: OWNER }), KEY);
  assert.equal(asked(WRITER).length, 0);
  assert.equal(asked("flux-1-schnell")[0].prompt, "a nude woman");
});

test("Аллаха и пророков она не рисует; мечеть Пророка, надпись и каллиграфия — не изображение", async () => {
  for (const said of ["пророка Мухаммада", "Аллаха", "пророка", "всевышнего на троне", "посланника Аллаха", "prophet Muhammad", "Allah"]) assert.equal(refusal(said), "sacred", said);
  for (const said of ["мечеть Пророка", "город Пророка ночью", "надпись Аллах золотом", "каллиграфию с именем Аллаха", "мечеть", "Мухаммада Али на ринге", "пророческий сон"]) assert.equal(refusal(said), "", said);
  assert.equal(refusal("пророка Мухаммада", { free: true }), "", "хозяину наедине своих «нет» она не говорит");

  reset();
  source("flux-1-schnell", image());
  const h = heart(ON, { now: () => NOON });
  await h.onMessage(message("нарисуй пророка Мухаммада"), KEY);
  assert.equal(last(), "Аллаха и пророков не изображают — и я не стану. Могу нарисовать мечеть, Каабу или Медину.");
  await h.onMessage(group("Аи, нарисуй Аллаха", { id: OWNER }), KEY);
  assert.equal(last(-10), "При всех я такое не рисую.");
  assert.equal(sourced().length, 0, "в мастерскую такая просьба не уходит");
  await h.onMessage(message("нарисуй мечеть Пророка"), KEY);
  assert.match(asked("flux-1-schnell")[0].prompt, /^the Prophet's Mosque in Medina/u);
  assert.equal(photos().length, 1);
});

test("«угадай рисунок»: рисует слово из своего словаря, отгадка — ответом на картинку; подсказка, «сдаюсь», один победитель", async () => {
  // Загадываются только слова, которые на картинке ни с чем не спутать: без пейзажей и без пар «кот — котёнок».
  assert.ok(GUESSABLE.length >= 90);
  for (const row of GUESSABLE) assert.ok(!row.title.includes(" ") && row.forms.includes(row.title.toLowerCase().replace(/ё/gu, "е")), row.title);
  for (const skip of ["котёнок", "щенок", "закат", "море", "лодка", "Мекка"]) assert.ok(!GUESSABLE.some(row => row.title === skip), skip);
  const picture = (id, caption = "Что я нарисовала?") => ({ message_id: id, from: { id: 999, is_bot: true, username: "ai_heart_bot" }, photo: [{ file_id: "p" }], caption });

  reset();
  source("flux-1-schnell", image());
  let serial = 700;
  sdk().apiReplies.sendPhoto = () => ({ message_id: ++serial });
  const h = heart(ON, { now: () => NOON, random: () => 0 });
  await h.onMessage(group("Аи, угадай рисунок", { id: 21, name: "Вася" }), KEY);
  assert.equal(photos().length, 1);
  assert.equal(asked("flux-1-schnell")[0].prompt, CAT_WORDS, "описание — из словаря художника: ни модели, ни перевода");
  assert.equal(photos()[0].caption, "Что я нарисовала? Ответьте на эту картинку одним словом. «Подсказка» и «сдаюсь» — тоже ответом на неё.");
  assert.doesNotMatch(photos()[0].caption, /кот/iu, "ответа в подписи нет");
  // Мимо — «🤔», без слов; подсказка — по слову; пятый промах — подсказка сама.
  await h.onMessage(group("собака", { id: 22, name: "Маша", reply: picture(701) }), KEY);
  assert.equal(toChat(-10).length, 0);
  assert.ok(calls("setMessageReaction").length >= 1);
  await h.onMessage(group("подсказка", { id: 22, name: "Маша", reply: picture(701) }), KEY);
  assert.equal(last(-10), "Подсказка: 3 буквы, первая — «К».");
  await h.onMessage(group("ещё подсказку", { id: 22, name: "Маша", reply: picture(701) }), KEY);
  assert.equal(last(-10), "Подсказка: 3 буквы, первая — «К», последняя — «т».");
  // Верно — словом в любой форме и внутри фразы; загадка закрыта.
  await h.onMessage(group("наверное, это котик!", { id: 22, name: "Маша", reply: picture(701) }), KEY);
  assert.equal(last(-10), "Верно, Маша: это «кот». Ещё одну — «угадай рисунок».");
  await h.onMessage(group("кот", { id: 23, name: "Петя", reply: picture(701) }), KEY);
  assert.equal(last(-10), "Эта загадка уже разгадана: это «кот». Ещё одну — «угадай рисунок».", "второй победителем не становится — и модель на него не тратится");

  // Следующая загадка — другое слово (не из десяти последних); «сдаюсь» открывает ответ.
  await h.onMessage(group("Аи, нарисуй загадку", { id: 21, name: "Вася" }), KEY);
  assert.equal(photos().length, 2);
  const second = asked("flux-1-schnell")[1].prompt;
  assert.notEqual(second, CAT_WORDS);
  const word = SUBJECTS.find(row => row.prompt === second).title;
  for (let index = 0; index < 5; index += 1) await h.onMessage(group("телевизор", { id: 22, name: "Маша", reply: picture(702) }), KEY);
  assert.match(last(-10), /^Пока мимо\. Подсказка: \d+ (?:буква|буквы|букв), первая — «.»\.$/u, "после пятого промаха подсказывает сама");
  await h.onMessage(group("сдаюсь", { id: 22, name: "Маша", reply: picture(702) }), KEY);
  assert.equal(last(-10), `Это «${word}». Ещё одну — «угадай рисунок».`);
  // Ответ на обычную картинку — не отгадка: разговор идёт своим путём.
  assert.equal(chats().length, 0, "игра без модели");

  // В личке — так же; картинка — из дневной нормы того, кто попросил.
  for (let index = 0; index < 5; index += 1) await h.onMessage(message("загадай рисунок", { id: 31 }), KEY);
  await h.onMessage(message("угадай рисунок", { id: 31 }), KEY);
  assert.match(last(31), /^На сегодня я вам уже нарисовала 5 картинок/u);
  // Платформа не вернула номер картинки — отгадки ждёт последняя загадка чата.
  delete sdk().apiReplies.sendPhoto;
  await h.onMessage(message("угадай рисунок", { id: OWNER }), KEY);
  const hidden = SUBJECTS.find(row => row.prompt === asked("flux-1-schnell").at(-1).prompt);
  await h.onMessage(message(hidden.forms.at(-1), { id: OWNER, reply: picture(999) }), KEY);
  assert.equal(last(OWNER), `Верно, Тест: это «${hidden.title}». Ещё одну — «угадай рисунок».`);

  // Красок нет — честно; не игра — мимо.
  reset();
  const plain = heart({}, { now: () => NOON });
  await plain.onMessage(message("угадай рисунок"), KEY);
  assert.match(last(), /^Загадку рисунком я загадать не могу: рисовать мне нечем\./u);
});

test("запасные художники: FLUX.2 klein получает форму; готовое описание после ложного фильтра идёт к запасным; не принявший отдыхает шесть часов", async () => {
  const forms = (model) => sdk().sourceFetches.filter(item => item.url.includes(model)).map(item => ({ type: item.options.headers["Content-Type"], body: String(item.options.body) }));
  const spare = (text) => sdk().sourceFetches.filter(item => /flux-2-klein|stable-diffusion|dreamshaper/u.test(item.url) && String(item.options.body).includes(text)).length;

  // 1. Основной запрос не принимает (не фильтр) — рисует первый запасной: ему уходит форма с описанием и размером.
  reset();
  source("flux-1-schnell", cfError(400, 5007, "No such model"));
  source("flux-2-klein-4b", image());
  let at = NOON;
  let h = heart(ON, { now: () => at });
  await h.onMessage(message("нарисуй кота"), KEY);
  assert.equal(photos().length, 1);
  const [sent] = forms("flux-2-klein-4b");
  const boundary = sent.type.match(/^multipart\/form-data; boundary=(----ai[a-z0-9]+)$/u)?.[1];
  assert.ok(boundary, sent.type);
  assert.equal(sent.body, `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${CAT_WORDS}\r\n--${boundary}\r\nContent-Disposition: form-data; name="width"\r\n\r\n1024\r\n--${boundary}\r\nContent-Disposition: form-data; name="height"\r\n\r\n1024\r\n--${boundary}--\r\n`);
  assert.equal(spare("fluffy"), 1, "остальных запасных не спрашивали");
  await h.onMessage(message("как нарисовано?", { id: OWNER }), KEY);
  await h.onMessage(message("нарисуй кота", { id: OWNER }), KEY);
  await h.onMessage(message("как нарисовано?", { id: OWNER }), KEY);
  assert.match(last(OWNER), /FLUX\.2 klein/u, "кто нарисовал — хозяину видно");

  // 2. Фильтр ошибся на её же описании из словаря — и не хозяину можно к запасным: описание безобидно по построению.
  //    Чужие слова после фильтра к запасным не идут (это проверено выше: «странную сцену»).
  reset();
  source("flux-1-schnell", cfError(400, 3030, "Input prompt contains NSFW content."));
  source("flux-2-klein-4b", image());
  h = heart(ON, { now: () => at });
  await h.onMessage(message("нарисуй кота"), KEY);
  assert.equal(photos().length, 1, "кот нарисован запасным, хотя фильтр основного трижды сказал «нет»");
  assert.equal(asked("flux-1-schnell").length, 2, "основной: описание и оно же с припиской (без добавок оно и так)");
  assert.equal(forms("flux-2-klein-4b").length, 1);

  // 3. Запасной запрос не принял — отдыхает шесть часов, в статусе назван; после отдыха его спрашивают снова.
  reset();
  source("flux-1-schnell", cfError(400, 5007, "No such model"));
  source("flux-2-klein-4b", cfError(400, 5006, "Bad input: unexpected field"));
  source("stable-diffusion-xl-lightning", cfError(410, 5028, "Model has been deprecated"));
  source("dreamshaper-8-lcm", cfError(410, 5028, "Model has been deprecated"));
  source("stable-diffusion-xl-base-1.0", cfError(410, 5028, "Model has been deprecated"));
  h = heart(ON, { now: () => at });
  await h.onMessage(message("нарисуй кота"), KEY);
  assert.equal(last(), "Не вышло: мастерская запрос не приняла. Хозяин об этом узнает.");
  assert.equal(spare("fluffy"), 4);
  await h.onMessage(message("нарисуй кота"), KEY);
  assert.equal(spare("fluffy"), 4, "отдыхающих не спрашивают");
  await h.onMessage(message("статус", { id: OWNER }), KEY);
  assert.match(last(OWNER), /Рисование: краски есть.* · запасные художники отдыхают после отказа: FLUX\.2 klein — 400 «Bad input: unexpected field»; SDXL Lightning — 410 «Model has been deprecated»; DreamShaper — 410 «Model has been deprecated»; SDXL — 410 «Model has been deprecated»/u);
  at += 6 * 3_600_000 + 60_000;
  sdk().sourceReplies.length = 0;
  source("flux-1-schnell", cfError(400, 5007, "No such model"));
  source("flux-2-klein-4b", image());
  await h.onMessage(message("нарисуй кота", { id: OWNER }), KEY);
  assert.equal(photos().length, 1, "через шесть часов запасного спросили снова — и он нарисовал");

  // 4. Откровенное от хозяина наедине строгому запасному не предлагается: он откажет, а запрос уйдёт впустую.
  reset();
  source("m2m100", translated("a nude woman"));
  source("flux-1-schnell", cfError(400, 3030, "Input prompt contains NSFW content."));
  source("flux-2-klein-4b", image());
  source("stable-diffusion-xl-lightning", cfError(410, 5028, "Model has been deprecated"));
  source("dreamshaper-8-lcm", cfError(410, 5028, "Model has been deprecated"));
  source("stable-diffusion-xl-base-1.0", cfError(410, 5028, "Model has been deprecated"));
  h = heart(ON, { now: () => at });
  await h.onMessage(message("нарисуй голую девушку", { id: OWNER }), KEY);
  assert.equal(photos().length, 0);
  assert.equal(forms("flux-2-klein-4b").length, 0);
  assert.match(last(OWNER), /^Не вышло: мастерская этот запрос не пропустила — это её фильтр, не мой\..*SDXL Lightning — 410 «Model has been deprecated»/u);
});
