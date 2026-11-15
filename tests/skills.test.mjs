/**
 * Список умений (SKILLS.txt): он собран, сверен с этой сборкой, называет каждый разбор,
 * который есть в коде, и не врёт — каждый цельный пример из него сердце понимает без модели.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { heart, message, group, reset, last, chats, sdk, toChat, OWNER, KEY, BUILD } from "./fixtures/kit.mjs";

const { build, sameText, SOURCE, TARGET } = await import("../scripts/skills.mjs");
const { parseSkills, parseSkillAsk, findSkill, examplesOf, skillsList, skillText } = await import("../tgcloud/lib/skills.js");
const { SKILLS, SKILLS_BUILD, SKILLS_SERVICE } = await import("../tgcloud/lib/data/skills.js");
const { INTENTS } = await import("../tgcloud/lib/intents.js");

const LIB = join(dirname(fileURLToPath(import.meta.url)), "..", "tgcloud", "lib");
const NOON = Date.parse("2026-11-18T09:00:00Z");
const DRAW = { DRAW_KEY: "0123456789abcdef0123456789abcdef:cf-token_ABCDEFGH-1234567890xyz", DRAW_DIRECTOR: false };

test("список умений собран, сверен с этой сборкой, и в нём назван каждый разбор из кода", () => {
  assert.ok(sameText(build(readFileSync(SOURCE, "utf8")), readFileSync(TARGET, "utf8")), "SKILLS.txt изменён — запустите «npm run skills»");
  // Выпуск без правки списка не пройдёт: сначала вписать новое в SKILLS.txt, потом поставить там номер сборки.
  assert.equal(SKILLS_BUILD, BUILD, `SKILLS.txt сверен для ${SKILLS_BUILD}, а сборка — ${BUILD}: впишите в список новое и поставьте в нём «сборка: ${BUILD}»`);

  // Всё, что код умеет разбирать: вынесенные наружу parse… и намерения.
  const parsers = new Map();
  for (const file of readdirSync(LIB).filter(name => name.endsWith(".js"))) {
    for (const found of readFileSync(join(LIB, file), "utf8").matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+(parse[A-Z]\w*)/gmu)) parsers.set(found[1], file);
  }
  assert.ok(parsers.size > 50 && parsers.has("parseStickerAsk"), "разборы найдены");
  const covered = new Set([...SKILLS_SERVICE, ...SKILLS.flatMap(section => section.covers)]);
  const missing = [...parsers.keys(), ...INTENTS].filter(name => !covered.has(name));
  assert.deepEqual(missing, [], `в SKILLS.txt не вписано (строка «разбор:» раздела или «служебное:»): ${missing.map(name => `${name}${parsers.has(name) ? ` (${parsers.get(name)})` : ""}`).join(", ")}`);
  const stale = [...covered].filter(name => !parsers.has(name) && !INTENTS.includes(name));
  assert.deepEqual(stale, [], `в SKILLS.txt названо то, чего в коде уже нет: ${stale.join(", ")}`);
  // Раздел без разбора — описание без опоры.
  assert.deepEqual(SKILLS.filter(section => !section.covers.length).map(section => section.name), []);
  assert.ok(SKILLS.length >= 10 && SKILLS.length <= 16, "разделов — около десятка, а не простыня");
  for (const section of SKILLS) assert.ok(section.short.length <= 140, `«коротко» раздела «${section.name}» — одна строка`);
});

test("документ: ошибки названы по-русски и с номером строки", () => {
  const good = "сборка: 1.2.3\n== игры ==\nслова: игр*\nкоротко: «города»\nразбор: parseGame\n[чат] «города» — играю;\n";
  assert.deepEqual(parseSkills(good).errors, []);
  assert.deepEqual(parseSkills(good).sections[0], { name: "игры", tags: [], words: ["игр*"], short: "«города»", covers: ["parseGame"], lines: [{ text: "«города» — играю;", tags: ["чат"] }] });
  assert.match(parseSkills("== игры ==\nкоротко: а\nб").errors.join("\n"), /нет строки «сборка: X\.Y\.Z»/u);
  assert.match(parseSkills("сборка: 1.2.3\nстрока без раздела").errors.join("\n"), /строка 2: строка вне раздела/u);
  assert.match(parseSkills("сборка: 1.2.3\n== а ==\nкоротко: а\n[ой] б").errors.join("\n"), /строка 4: незнакомая пометка \[ой\]/u);
  assert.match(parseSkills("сборка: 1.2.3\n== а ==\nб").errors.join("\n"), /раздел «а»: нет строки «коротко:»/u);
  assert.match(parseSkills("сборка: 1.2.3\n== а ==\nкоротко: а").errors.join("\n"), /раздел «а»: пуст/u);
  assert.match(parseSkills("сборка: 1.2.3\n== а ==\nкоротко: а\nб\n== А ==\nкоротко: а\nб").errors.join("\n"), /строка 5: раздел «А» уже есть/u);
  assert.match(parseSkills("сборка: 1.2.3\n== а ==\nслова: игры\nкоротко: а\nб\n== в ==\nслова: игры\nкоротко: а\nб").errors.join("\n"), /слово «игры» — и у раздела «а», и у «в»/u);
  assert.throws(() => build("== а ==\nкоротко: а\nб"), /В SKILLS\.txt есть ошибки:\n {2}• /u);
  assert.deepEqual(examplesOf("«города», «напомни через час …», «5 букв» и «a»"), ["города", "5 букв"]);

  // Просьба раскрыть раздел: название, слово из списка, начало слова; чужое — мимо.
  for (const [said, name] of Object.entries({
    "что ты умеешь: игры": "игры", "Что ты умеешь в играх?": "игры", "что умеешь — напоминания": "напоминания", "помощь по напоминаниям": null, "справка игры": "игры",
    "а что ты ещё умеешь: стикеры": "картинки и стикеры", "твои возможности: намаз": "намаз и праздники", "что вы умеете в группе": "группа", "помощь: секретарь": "хозяину",
    "что ты умеешь": null, "что ты умеешь делать": null, "что ты умеешь готовить": null, "помощь нужна срочно": null, "справка из поликлиники": null, "игры": null,
  })) assert.equal(parseSkillAsk(said, SKILLS), name, said);
  assert.equal(findSkill(SKILLS, "Игры.")?.name, "игры");
  assert.equal(findSkill(SKILLS, "ничего такого"), null);
});

test("каждый цельный пример из списка умений сердце понимает без модели", async () => {
  const failed = [];
  let checked = 0;
  for (const section of SKILLS) {
    for (const line of section.lines) {
      const tags = [...section.tags, ...line.tags];
      if (tags.some(tag => ["модель", "ответом", "состояние", "источник"].includes(tag))) continue;
      for (const said of examplesOf(line.text)) {
        reset();
        // Как на живом боте: словарь, манеры, память чата и «пишу первой» включены (в остальных тестах они выключены).
        const h = heart({ PHRASES: true, MANNERS: true, CHAT_MEMORY: true, GREET: true, ...(tags.includes("краски") ? DRAW : {}) }, { now: () => NOON });
        const from = tags.includes("хозяин") || tags.includes("админ") ? { id: OWNER } : {};
        try {
          await h.onMessage(tags.includes("чат") || tags.includes("группа") ? group(`Аи, ${said}`, from) : message(said, from), KEY);
        } catch (error) { failed.push(`«${said}» [${section.name}]: исключение ${error?.message}`); continue; }
        checked += 1;
        if (chats().length) failed.push(`«${said}» [${section.name}]: ушло к модели`);
        else if (!sdk().sent.length && !sdk().calls.length) failed.push(`«${said}» [${section.name}]: ответа нет`);
      }
    }
  }
  assert.deepEqual(failed, [], `примеры из SKILLS.txt, которые сердце не поняло само:\n${failed.join("\n")}`);
  assert.ok(checked > 150, `проверено примеров: ${checked}`);
});

test("«что ты умеешь» — разделы по строке; «что ты умеешь: игры» — раздел целиком; чужое не открывается", async () => {
  reset();
  const h = heart({}, { now: () => NOON });
  await h.onMessage(message("что ты умеешь"), KEY);
  const list = last();
  const rows = list.split("\n").filter(line => line.startsWith("• "));
  assert.ok(rows.length >= 10 && rows.length <= 13, `строк в общем списке: ${rows.length}`);
  assert.ok(list.length < 1800, `общий список короткий: ${list.length} знаков`);
  assert.match(list, /^Аи\. Что я умею:\n\n• разговор — пишите как есть, без команд;/u);
  assert.match(list, /\n• игры — «давай сыграем», «города», «виселица», «квиз», «крестики-нолики»\n/u);
  assert.match(list, /\n\nПодробно о любом — «что ты умеешь: игры» \(название из списка\)\.$/u);
  assert.doesNotMatch(list, /хозяину|секретарь|рисование|сестра/u, "чужому — без хозяйского; без художника — без рисования");
  assert.equal(chats().length, 0);

  await h.onMessage(message("что ты умеешь: игры"), KEY);
  assert.match(last(), /^Игры:\n\n• список игр — «давай сыграем»;\n/u);
  assert.match(last(), /\n• компанией — «крестики-нолики», «крокодил», «правда или действие», «бутылочка», «кнб вдвоём»;\n/u);
  assert.match(last(), /\n\nВесь список — «что ты умеешь»\.$/u);
  assert.doesNotMatch(last(), /\[|\]|разбор:|parse/u, "пометки и служебные строки человеку не показываются");
  await h.onMessage(message("/help напоминания"), KEY);
  assert.match(last(), /^Напоминания:\n\n• один раз — «напомни через час позвонить маме»/u);
  // Раздел хозяина чужому не открывается: вместо него — общий список.
  await h.onMessage(message("что ты умеешь: секретарь"), KEY);
  assert.equal(last(), list);
  await h.onMessage(message("что ты умеешь: рисование"), KEY);
  assert.equal(last(), list, "художника нет — раздела нет");
  // Стикер из готовой картинки красок не требует, а «нарисуй стикер» — требует.
  await h.onMessage(message("что ты умеешь: стикеры"), KEY);
  assert.match(last(), /• стикер из картинки — «сделай стикер» ответом на картинку.*положу в ваш набор;/u);
  assert.doesNotMatch(last(), /нарисуй стикер/u);
  assert.equal(chats().length, 0, "модель не понадобилась ни разу");

  // Хозяину в личке — его раздел; при всех — нет.
  await h.onMessage(message("что ты умеешь", { id: OWNER }), KEY);
  assert.match(last(OWNER), /\n• хозяину — «статус», «покажи уроки», «секретарь», «экзамен», «проверь мозги»\n/u);
  await h.onMessage(message("что ты умеешь: секретарь", { id: OWNER }), KEY);
  assert.match(last(OWNER), /^Хозяину:\n\n• состояние — «статус» \(он же \/status\), «проверь мозги»: спрашиваю каждую модель/u);
  assert.match(last(OWNER), /• секретарь — «секретарь» \(что с ним и как подключить\), «отвечай за меня»/u);
  await h.onMessage(group("Аи, что ты умеешь", { id: OWNER }), KEY);
  assert.doesNotMatch(toChat(-10).at(-1).text, /хозяину/u);
  assert.match(toChat(-10).at(-1).text, /\nВ группе зовите меня по имени, @упоминанием или ответом на моё сообщение\.$/u);

  // С художником — раздел «рисование»; выключенное настройкой из списка уходит.
  reset();
  const painter = heart({ ...DRAW, STICKERS: false }, { now: () => NOON });
  await painter.onMessage(message("что ты умеешь"), KEY);
  assert.match(last(), /\n• рисование — «нарисуй кота в шляпе», «нарисуй себя», «мои рисунки», «нарисуй стикер: …»\n/u);
  await painter.onMessage(message("что ты умеешь: стикеры"), KEY);
  assert.doesNotMatch(last(), /сделай стикер|мои стикеры/u, "стикеры выключены — о них ни слова");
  assert.match(last(), /• показать — «покажи котика»/u);

  // На «ты» — те же строки близкими словами.
  const flags = { "личка": true, setting: () => true };
  assert.match(skillsList(SKILLS, flags, { formal: false }), /• разговор — пиши как есть, без команд;/u);
  assert.match(skillText(findSkill(SKILLS, "стикеры"), flags, { formal: false }), /положу в твой набор;/u);
  assert.match(skillsList(SKILLS, { ...flags, "группа": true }, { formal: false }), /\nВ группе зови меня по имени/u);
});
