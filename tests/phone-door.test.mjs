/**
 * Дом на телефоне, режим `door` (`bash scripts/phone.sh door`): дверь приложения одной командой.
 *
 * Бот двери → канал и ключ → сердце с этим ключом → подписка на события → опыт трёх путей → что слышала Аи.
 * С поддельным посредником проверяются порядок шагов и остановки; с настоящим посредником, настоящим сердцем и
 * поддельным Telegram (`tests/fixtures/telegram.mjs`) — команда от начала до конца. Что делает сам посредник —
 * `tests/door.test.mjs`; остальной дом — `tests/phone.test.mjs`; песочница — `tests/fixtures/phone-kit.mjs`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { heart, reset } from "./fixtures/kit.mjs";
import { telegramStub, DOOR_BOT, VOICE_BOT, NEW_BOT, idOf } from "./fixtures/telegram.mjs";
import { sandbox, sh, skip, TOKEN, KEYS } from "./fixtures/phone-kit.mjs";

// ── дверь приложения одной командой (0.54.1) ─────────────────────────────────
// 22.11.2026 владелец выполнил шаги двери пятью отдельными строками: первая не вышла (бот будильника живёт на
// сервере), остальные всё равно отработали — сердце опубликовалось второй раз впустую. «phone.sh door» ведёт те же
// шаги сам и останавливается на том, который не вышел. Что делает сам посредник — tests/door.test.mjs.
const DOOR_TOKEN = "777003:fresh-bot-token-CCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
const doorSteps = (box) => box.door().map(item => item.args.join(" ").replace(DOOR_TOKEN, "<токен>"));
const pushes = (box) => box.cli().filter(item => item.args[0] === "push");
const ONLY_DOOR = { HEART_AFTER_DOOR: "stop" };

test("дверь одной командой: бот двери → канал и ключ → сердце с этим ключом → опыт; второй раз сердце не публикуется", { skip }, () => {
  const box = sandbox({ door: true });
  try {
    box.keys([`TGCLOUD_HEART_TOKEN=${TOKEN}`, `AI_PROVIDER_KEY=${KEYS.model}`, "OWNER_TG_ID=42", "HEART_BRANCH=work", `DOOR_BOT_TOKEN=${DOOR_TOKEN}`]);
    const done = box.run("door", ONLY_DOOR);
    assert.equal(done.code, 0, done.out);
    assert.deepEqual(doorSteps(box), ["bot", "setup --wait=600", "ways --wait=15 --try"]);
    assert.ok(box.door().every(item => item.ai === "123" && item.flow === "1"), "посреднику назван номер бота Аи (начало токена публикации) и что шаги ведёт телефон");
    // Ключ двери появился в файле посреди работы: публикация должна его увидеть, а не то, что было при запуске.
    assert.match(box.envFile(), /^KEY_DOOR=-100555000111:/mu);
    assert.equal(pushes(box).length, 1, "сердце опубликовано один раз");
    assert.ok(pushes(box)[0].door, "и с ключом двери: файл ключей перечитан после настройки");
    assert.equal(box.door().at(-1).key.startsWith("-100555000111:"), true, "опыт идёт с тем же ключом");
    assert.match(done.out, /Дверь приложения: бот двери → канал → ключ → сердце с ключом → опыт\./u);
    assert.match(done.out, /Публикую сердце с ключом двери/u);
    assert.ok(done.out.indexOf("Сборка 1.0.0 опубликована") < done.out.indexOf("посредник: ways"), "сначала сердце, потом опыт");
    // Перед опытом — подписка бота Аи на события: нет события в подписке — запрос до сердца не дойдёт вовсе.
    assert.match(done.out, /✓ Подписка Аи на события Telegram: личные сообщения, посты канала и их правки — на месте\./u);
    assert.ok(done.out.indexOf("Подписка Аи на события") < done.out.indexOf("посредник: ways"), "подписка проверена до опыта");
    assert.doesNotMatch(done.out, /Telegram о доставке событий Аи/u, "опыт прошёл — об очереди Telegram речи нет");
    assert.ok(!done.out.includes("secret.example"), "адрес вебхука на экран не идёт");
    assert.doesNotMatch(done.out, /Дом запущен/u, "HEART_AFTER_DOOR=stop — только дверь");
    assert.ok(!done.out.includes("door-secret") && !done.out.includes(DOOR_TOKEN), "ни ключ двери, ни токен бота на экран не идут");
    const mark = box.state("published").split("\n")[3];
    assert.match(mark, /^\d+-\d+$/u, "с каким ключом двери опубликовано — контрольной суммой, не ключом");
    assert.ok(!box.state("published").includes("door-secret"));
    assert.ok(!existsSync(join(box.home, ".heart/lock")), "замок снят");

    // Второй раз: сердце уже с этим ключом — сразу опыт, без публикации.
    const again = box.run("door", ONLY_DOOR);
    assert.equal(again.code, 0, again.out);
    assert.equal(pushes(box).length, 1, "вторая публикация не нужна");
    assert.deepEqual(doorSteps(box).slice(3), ["bot", "setup --wait=600", "ways --wait=15 --try"]);
    // Метка обманула (сердце публиковали не отсюда, и на вопрос о двери оно не отвечает): дверь молчит — публикация и вторая попытка.
    const OLD_HEART = { FAKE_DOOR_SAYS: "-" };
    const silent = box.run("door", { ...ONLY_DOOR, ...OLD_HEART, FAKE_DOOR: JSON.stringify({ ways: [0, 0, 5, 0] }) });
    assert.equal(silent.code, 0, silent.out);
    assert.match(silent.out, /Публикую сердце заново: в опубликованном, похоже, нет этого ключа двери/u);
    assert.equal(pushes(box).length, 2);
    assert.deepEqual(doorSteps(box).slice(6), ["bot", "setup --wait=600", "ways --wait=15 --try", "ways --wait=15 --try"]);
    // Обычная публикация дома тоже ставит метку: ключ в файле — метка та же.
    assert.equal(box.state("published").split("\n")[3], mark);
    // Сразу после публикации дверь молчит: когда платформа начинает отвечать новым кодом, неизвестно, —
    // первая проба без ответа ещё не итог. Вторая — через паузу; ответила — дверь работает.
    const slow = box.run("door", { ...ONLY_DOOR, ...OLD_HEART, HEART_DOOR_PAUSE: "0", FAKE_DOOR: JSON.stringify({ ways: [0, 0, 5, 0, 5, 5, 0] }) });
    assert.equal(slow.code, 0, slow.out);
    assert.match(slow.out, /Сердце только что опубликовано — возможно, новый код ещё не заработал\. Пробую ещё раз…/u);
    assert.deepEqual(doorSteps(box).slice(10), ["bot", "setup --wait=600", "ways --wait=15 --try", "ways --wait=15 --try", "ways --wait=15"]);
    assert.equal(pushes(box).length, 3, "публикация одна на команду: вторая проба идёт без неё");
    // Молчит и вторая — это итог: код «ответа нет», и говорит о нём уже посредник (без --try — со списком «что проверить»).
    // Заодно — что знает сам Telegram о доставке её событий: очередь и последняя ошибка (сердце о недоставленном не знает).
    const HOOK_MORE = "  pending updates:  3\n  last error:       Wrong response from the webhook: 500 Internal Server Error at https://secret.example/hook (2026-11-22 10:15 UTC)";
    const dead = box.run("door", { ...ONLY_DOOR, ...OLD_HEART, HEART_DOOR_PAUSE: "0", FAKE_HOOK_MORE: HOOK_MORE, FAKE_DOOR: JSON.stringify({ ways: [0, 0, 5, 0, 5, 5, 0, 5, 5, 5] }) });
    assert.equal(dead.code, 5, dead.out);
    assert.deepEqual(doorSteps(box).slice(15), ["bot", "setup --wait=600", "ways --wait=15 --try", "ways --wait=15 --try", "ways --wait=15"]);
    assert.match(dead.out, /Telegram о доставке событий Аи: в очереди — 3; последняя ошибка доставки — «Wrong response from the webhook: 500 Internal Server Error at \(адрес\) \(2026-11-22 10:15 UTC\)»\./u);
    assert.ok(dead.out.indexOf("Что слышала Аи") < dead.out.indexOf("Telegram о доставке"), "сначала слова сердца, потом — Telegram");
    assert.match(dead.out, /Пришлите этот экран целиком в чат разработки: по нему видно, где теряется запрос\.\n$/u);
    assert.ok(!dead.out.includes("secret.example"), "адрес вебхука не выходит на экран и из строки ошибки");
    // Сердце само сказало, что дверь у него открыта (ключ на месте, код новый), а опыт молчит: вторая публикация
    // ничего не изменит — запрос теряется по дороге. Один круг, без публикации; что слышала Аи и что знает Telegram.
    const pushed = pushes(box).length, asked = doorSteps(box).length;
    const calm = box.run("door", { ...ONLY_DOOR, HEART_DOOR_PAUSE: "0", FAKE_HOOK_MORE: "  pending updates:  0", FAKE_DOOR: JSON.stringify({ ways: [5] }) });
    assert.equal(calm.code, 5, calm.out);
    assert.equal(pushes(box).length, pushed, "сердце заново не публикуется");
    assert.doesNotMatch(calm.out, /Публикую сердце/u);
    assert.deepEqual(doorSteps(box).slice(asked), ["bot", "setup --wait=600", "ways --wait=15 --try"], "и второго круга нет");
    // Очередь пуста и ошибок нет — так и сказано: значит, Telegram этих событий ей и не отдавал.
    assert.match(calm.out, /Telegram о доставке событий Аи: в очереди — 0; ошибок доставки нет\.\nПришлите этот экран целиком в чат разработки/u);
    // Ключи разные (7) — другое дело: сердце отвечает, но не тем ключом; публикация с ключом из файла — и опыт снова.
    const foreign = box.run("door", { ...ONLY_DOOR, HEART_DOOR_PAUSE: "0", FAKE_DOOR: JSON.stringify({ ways: Array(doorSteps(box).filter(step => step.startsWith("ways")).length).fill(0).concat([7, 0]) }) });
    assert.equal(foreign.code, 0, foreign.out);
    assert.match(foreign.out, /Публикую сердце заново/u);
    assert.equal(pushes(box).length, pushed + 1);
    // Запрос до сердца дошёл, но «не туда»: ключ у него от другого канала (публиковали не отсюда). Сердце говорит,
    // что дверь открыта, — и всё же публикация нужна: с ключом из файла. Это видно по его же словам после круга.
    const STRAY = "DOOR-SAYS name=ai_heart_bot seq=9 | Что слышала Аи от бота двери за этот опыт: | • личное сообщение бота — не слышала | • правка поста — не слышала | • новый пост — не слышала | • запрос двери пришёл не туда — channel -100777; если это канал — ключ записан на другой | Общение ботов у Аи: включено.";
    const astray = box.run("door", { ...ONLY_DOOR, HEART_DOOR_PAUSE: "0", FAKE_DOOR_SAYS: STRAY, FAKE_DOOR: JSON.stringify({ ways: Array(doorSteps(box).filter(step => step.startsWith("ways")).length).fill(0).concat([5, 0]) }) });
    assert.equal(astray.code, 0, astray.out);
    assert.match(astray.out, /Публикую сердце заново/u);
    assert.equal(pushes(box).length, pushed + 2);
    // В подписке нет нужного события (в песочнице обработчик один — «message»): сказано, какого, и подписка
    // чинится на месте — до опыта. Считаются события, для которых в опубликованном коде есть обработчик.
    const before = box.cli().length;
    const unsubscribed = box.run("door", { ...ONLY_DOOR, FAKE_UPDATES: "channel_post, edited_channel_post", FAKE_UPDATES_SYNCED: "message, channel_post", FAKE_DOOR: JSON.stringify({ ways: [0] }) });
    assert.equal(unsubscribed.code, 0, unsubscribed.out);
    assert.match(unsubscribed.out, /✗ Аи не подписана на события: message — такие запросы Telegram ей не отдаёт вовсе\. Чиню подписку…\n✓ Подписка починена: теперь эти события до Аи доходят\./u);
    assert.ok(box.cli().slice(before).some(item => item.args.join(" ") === "webhook sync"), "подписка чинится командой платформы");
    assert.ok(unsubscribed.out.indexOf("Подписка починена") < unsubscribed.out.indexOf("посредник: ways"), "и только потом — опыт");
    // Не починилась — так и сказано, и опыт всё равно идёт: пути друг от друга не зависят.
    const stuck = box.run("door", { ...ONLY_DOOR, FAKE_UPDATES: "channel_post", FAKE_DOOR: JSON.stringify({ ways: [0] }) });
    assert.equal(stuck.code, 0, stuck.out);
    assert.match(stuck.out, /✗ Подписка не починилась — нет событий: message\. Пришлите этот экран в чат разработки\./u);
    assert.match(stuck.out, /посредник: ways/u);
  } finally { box.clean(); }
});

test("дверь: бот будильника живёт на сервере — шаги дальше не идут и сердце зря не публикуется; токен нового бота — и всё идёт", { skip }, () => {
  const box = sandbox({ door: true });
  try {
    // Как у владельца 22.11.2026: своего бота двери нет; посредник отвечает кодом 3 — «бот живёт на сервере».
    const stuck = box.run("door", { ...ONLY_DOOR, FAKE_DOOR: JSON.stringify({ bot: [3] }) });
    assert.equal(stuck.code, 1, stuck.out);
    assert.deepEqual(doorSteps(box), ["bot"], "настройка и опыт без бота не начинаются");
    assert.equal(box.cli().length, 0, "и сердце не публикуется впустую");
    assert.match(stuck.out, /Когда токен будет: bash scripts\/phone\.sh door <токен нового бота>/u);
    // Токен вставили в ответ на вопрос: записан, шаги идут дальше — уже с ним.
    // Вставлено всё сообщение @BotFather, а не одна строка: токен находится и в нём, лишние строки никуда не утекают.
    const asked = box.run("door", { ...ONLY_DOOR, HEART_DOOR_ASK: "1", FAKE_DOOR: JSON.stringify({ bot: [3, 3, 0] }) }, `Done! Congratulations on your new bot.\nUse this token to access the HTTP API:\n${DOOR_TOKEN}\nKeep your token secure.\n`);
    assert.equal(asked.code, 0, asked.out);
    assert.match(asked.out, /Вставьте сюда токен нового бота \(на экране он не покажется\) и нажмите Enter: \n/u);
    assert.deepEqual(doorSteps(box).slice(1), ["bot", "bot Done! Congratulations on your new bot. Use this token to access the HTTP API: <токен> Keep your token secure.", "setup --wait=600", "ways --wait=15 --try"]);
    assert.match(box.envFile(), new RegExp(`^DOOR_BOT_TOKEN=${DOOR_TOKEN}$`, "mu"));
    assert.equal(box.door().at(-1).bot, DOOR_TOKEN, "после записи посредник работает уже с новым ботом");
    assert.ok(pushes(box).at(-1).door);
    assert.ok(!asked.out.includes(DOOR_TOKEN), "токен на экран не возвращается");
  } finally { box.clean(); }
});

test("дверь: пустой ответ вместо токена, не вышедшая настройка, отказ двери — шаг останавливает остальные; токен можно дать словом команды", { skip }, () => {
  const box = sandbox({ door: true });
  try {
    const empty = box.run("door", { ...ONLY_DOOR, HEART_DOOR_ASK: "1", FAKE_DOOR: JSON.stringify({ bot: [6] }) }, "\n");
    assert.equal(empty.code, 1); assert.match(empty.out, /Токена нет — дверь подождёт/u);
    assert.deepEqual(doorSteps(box), ["bot"]);
    // Токен — вторым словом команды: без вопроса.
    const given = box.run(`door ${DOOR_TOKEN}`, { ...ONLY_DOOR, FAKE_DOOR: JSON.stringify({ setup: [1] }) });
    assert.equal(given.code, 1, given.out);
    assert.deepEqual(doorSteps(box).slice(1), ["bot <токен>", "setup --wait=600"], "настройка не вышла — ни публикации, ни опыта");
    assert.equal(box.cli().length, 0);
    assert.doesNotMatch(given.out, /Вставьте сюда токен/u);
    // Публикация не прошла — опыта нет, причина названа; владельцу уходит и весть от второго бота, как при любой неудаче.
    const broken = box.run("door", { ...ONLY_DOOR, FAKE_FAIL: "push", FAKE_SAYS: "Error: schema.js: unexpected token" });
    assert.equal(broken.code, 1, broken.out);
    assert.match(broken.out, /✗ Сердце с ключом двери не опубликовалось — дверь пока закрыта\. Причина — строками выше\./u);
    assert.deepEqual(doorSteps(box).slice(3), ["bot", "setup --wait=600"], "без сердца с ключом опыт не делается");
    assert.equal(box.state("published"), "");
    assert.match(box.state("failed"), /\n1\n/u, "неудача сосчитана — дом не станет повторять её каждую минуту");
    // Причину убрали — та же команда доводит дело до конца.
    const first = box.run("door", ONLY_DOOR);
    assert.equal(first.code, 0, first.out);
    assert.deepEqual(doorSteps(box).slice(5), ["bot", "setup --wait=600", "ways --wait=15 --try"]);
    // Дверь на месте, но отказала (код 2): публиковать заново незачем — код возвращается как есть.
    const before = pushes(box).length;
    const refused = box.run("door", { ...ONLY_DOOR, FAKE_DOOR: JSON.stringify({ ways: [0, 2] }) });
    assert.equal(refused.code, 2, refused.out);
    assert.equal(pushes(box).length, before);
    // Сборка без посредника (до 0.54.0) и незнакомый режим — словами.
    rmSync(join(box.phone, "scripts/door-client.mjs"));
    assert.match(box.run("door", ONLY_DOOR).out, /В этой сборке двери приложения ещё нет\./u);
    assert.match(box.run("dor").out, /Есть: run, check, deploy, tick, once, events, door\./u);
  } finally { box.clean(); }
});

test("дверь: рядом работает дом — сказано остановить его; после двери дом запускается сам", { skip }, async () => {
  const box = sandbox({ door: true });
  try {
    // Замок держит живой процесс (здесь — сам тест): второй дом рядом не нужен, и дверь с ним не спорит.
    mkdirSync(join(box.home, ".heart/lock"), { recursive: true });
    writeFileSync(join(box.home, ".heart/lock/pid"), `${process.pid}\n`);
    const busy = box.run("door", ONLY_DOOR);
    assert.equal(busy.code, 1);
    assert.match(busy.out, /Дом уже запущен \(процесс \d+\)\. Второй не нужен\./u);
    assert.match(busy.out, /Остановите дом \(Ctrl\+C в его окне\) и повторите: bash scripts\/phone\.sh door/u);
    assert.equal(box.door().length, 0);
    rmSync(join(box.home, ".heart/lock"), { recursive: true, force: true });
    // Без HEART_AFTER_DOOR=stop: дверь сделана — и тот же процесс продолжает домом, второй команды не нужно.
    box.keys([`TGCLOUD_HEART_TOKEN=${TOKEN}`, `AI_PROVIDER_KEY=${KEYS.model}`, "OWNER_TG_ID=42", "HEART_BRANCH=work", `DOOR_BOT_TOKEN=${DOOR_TOKEN}`, `ALARM_BOT_TOKEN=${KEYS.voice}`, "ALARM_CHAT_ID=-100"]);
    const done = await box.loop((out) => /Дом запущен/u.test(out) && box.state("alarm.msg") !== "", {}, ["door"]);
    assert.match(done.out, /посредник: ways --wait=15 --try → 0/u);
    assert.match(done.out, /Дом запущен: ветка «work»/u);
    assert.ok(done.out.indexOf("посредник: ways") < done.out.indexOf("Дом запущен"), "сначала дверь, потом дом");
    assert.equal(pushes(box).length, 1, "дом после двери ту же сборку второй раз не публикует");
    assert.equal(done.code, 0);
    assert.ok(!existsSync(join(box.home, ".heart/lock")), "замок снят");
    // И при неудаче двери дом всё равно запускается: будильник не должен ждать.
    const failed = await box.loop((out) => /Дом запущен/u.test(out), { FAKE_DOOR: JSON.stringify({ bot: [3] }) }, ["door"]);
    assert.match(failed.out, /посредник: bot → 3/u);
    assert.match(failed.out, /Дом запущен: ветка «work»/u);
  } finally { box.clean(); }
});

test("дверь: сначала берёт свежее из ветки — поправка к двери приходит и при остановленном доме; токен после «door» не теряется", { skip }, () => {
  const box = sandbox({ door: true });
  try {
    // Дом стоит; в ветку тем временем пришёл коммит с новым скриптом и новой сборкой.
    writeFileSync(join(box.seed, "scripts/phone.sh"), `${readFileSync(join(box.seed, "scripts/phone.sh"), "utf8")}\n# поправка\n`);
    const fresh = box.commit("1.1.0");
    const done = box.run(`door ${DOOR_TOKEN}`, ONLY_DOOR);
    assert.equal(done.code, 0, done.out);
    assert.equal(box.head(), fresh, "папка перешла на новый коммит");
    assert.match(done.out, /Пришёл коммит [0-9a-f]{7}, сборка 1\.1\.0\./u);
    assert.match(done.out, /Сам скрипт обновился — перезапускаюсь\./u);
    assert.deepEqual(doorSteps(box), ["bot <токен>", "setup --wait=600", "ways --wait=15 --try"], "шаги двери пройдены один раз — уже новым скриптом и с тем же токеном");
    assert.match(done.out, /✓ Сборка 1\.1\.0 опубликована/u);
    assert.ok(pushes(box)[0].door, "новая сборка ушла в облако уже с ключом двери");
    assert.ok(!existsSync(join(box.home, ".heart/lock")), "замок снят");
    // Связи с GitHub нет — дверь работает с тем, что лежит в папке.
    box.commit("1.2.0");
    sh(box.phone, `git remote set-url origin "${join(box.dir, "nowhere")}"`);
    const offline = box.run("door", ONLY_DOOR);
    assert.equal(offline.code, 0, offline.out);
    assert.match(offline.out, /Новое из GitHub не взять: /u);
    assert.equal(box.head(), fresh);
    assert.deepEqual(doorSteps(box).slice(3), ["bot", "setup --wait=600", "ways --wait=15 --try"]);
  } finally { box.clean(); }
});

// Всё вместе: настоящий скрипт, настоящий посредник, настоящее сердце; поддельные — только Telegram и платформа.
// Сердце узнаёт ключ двери так же, как в жизни: из того, что публикация унесла в облако.
test("дверь от начала до конца: как было у владельца 22.11.2026 (бот будильника живёт на сервере) — и как идёт с новым ботом", { skip }, async () => {
  reset();
  const box = sandbox({ door: "real" });
  let h = null, line = "";
  const cloud = () => pushes(box).at(-1)?.doorKey ?? "";
  const hearts = () => {
    const now = cloud();
    if (!now) return null;
    if (now !== line) { line = now; h = heart({ PHRASES: true, ROOM_APP: true, DOOR_KEY: now }, { now: () => Date.now() }); }
    return h;
  };
  const tg = await telegramStub({ ai: 123, hearts });
  try {
    // Платформа поддельная, но сердце на ней настоящее: удар после публикации и вопрос телефона о двери доходят до него.
    const TG = { DOOR_API: tg.api, FAKE_PLATFORM: tg.platform, HEART_AFTER_DOOR: "stop", HEART_DOOR_WAIT: "20", HEART_DOOR_TRY: "4" };
    // Файл ключей как у владельца: второй бот — бот будильника, а он живёт на сервере. Строки OWNER_TG_ID в файле нет
    // («годится, если владелец записан в config.js»): от чьего имени войти, посредник узнаёт из настроек сердца.
    box.keys([`TGCLOUD_HEART_TOKEN=${TOKEN}`, `AI_PROVIDER_KEY=${KEYS.model}`, "HEART_BRANCH=work", `ALARM_BOT_TOKEN=${VOICE_BOT}`, "ALARM_CHAT_ID=-100"]);
    const stuck = await box.start("door", TG);
    assert.equal(stuck.code, 1, stuck.out);
    assert.match(stuck.out, /Бот будильника @voice_bot живёт на сервере \(hook\.example\)/u);
    assert.match(stuck.out, /Двери нужен свой бот: в Telegram — @BotFather → \/newbot \(имя и адрес любые\), он пришлёт токен\.\n/u);
    assert.match(stuck.out, /Когда токен будет: bash scripts\/phone\.sh door <токен нового бота>/u);
    assert.equal(box.cli().length, 0, "сердце впустую не публикуется");
    assert.equal(tg.called("getUpdates"), 0, "бота с вебхуком никто и не пытается спросить");
    assert.equal(tg.called("setWebhook") + tg.called("deleteWebhook"), 0, "чужой вебхук не тронут");
    assert.doesNotMatch(box.envFile(), /KEY_DOOR|DOOR_BOT_TOKEN/u);

    // Новый бот от @BotFather. В канал его добавляют, пока команда ждёт, — она идёт дальше сама.
    setTimeout(() => {
      tg.state.channel.admins.set(idOf(NEW_BOT), { username: "fresh_bot", post: true, erase: true });
      tg.push(NEW_BOT, { my_chat_member: { chat: { id: tg.state.channel.id, title: "Дверь", type: "channel" }, new_chat_member: { status: "administrator" } } });
    }, 1500);
    tg.state.channel.admins.delete(idOf(DOOR_BOT));
    const done = await box.start(`door ${NEW_BOT}`, TG);
    assert.equal(done.code, 0, done.out);
    const order = ["✓ Бот двери: @fresh_bot — токен записан", "Теперь в Telegram — жду 20 с, здесь ничего нажимать не нужно:", "  2. канал → «Администраторы» → добавьте @fresh_bot и Аи", "✓ Канал «Дверь»: бот двери @fresh_bot пишет, Аи (@ai_heart_bot) — администратор.", "✓ Ключ двери придуман и записан", "Публикую сердце с ключом двери", "✓ Сборка 1.0.0 опубликована", "Опыт двери: три пути по очереди — запрос к Аи и её ответ.", "  ✓ личное сообщение бота: ответ за", "  ✓ правка поста в канале: ответ за", "  ✓ новый пост в канале: ответ за", "✓ Дверь работает: путь — личное сообщение бота.", "Что слышала Аи от бота двери за этот опыт:", "• личное сообщение бота — ", "Общение ботов у Аи: включено."];
    const at = order.map(text => done.out.indexOf(text));
    assert.ok(at.every(index => index >= 0), `${JSON.stringify(at)}\n${done.out}`);
    assert.deepEqual([...at].sort((a, b) => a - b), at, "шаги идут по порядку");
    assert.match(done.out, /Комната: сборка \d+\.\d+\.\d+ · хозяин: да · её слова: «.+»/u);
    // Режим общения ботов сердце включило себе само — ударом после публикации; бот двери — своим запросом.
    assert.match(done.out, /• личное сообщение бота — запрос, ответила\n• правка поста — запрос, ответила\n• новый пост — запрос, ответила\n/u);
    assert.equal(tg.called("setMySettings"), 1);
    assert.match(box.envFile(), /^DOOR_WAY=direct$/mu);
    // Ключ, который придумал посредник, — тот же, что ушёл в облако, и сердце с ним пустило.
    const written = box.envFile().match(/^KEY_DOOR=(.+)$/mu)?.[1] ?? "";
    assert.match(written, /^-100900900:[\x21-\x7e]{32,}$/u);
    assert.equal(cloud(), written);
    assert.equal(pushes(box).length, 1, "сердце опубликовано один раз");
    assert.match(box.envFile(), new RegExp(`^DOOR_BOT_TOKEN=${NEW_BOT}$`, "mu"));
    assert.match(box.envFile(), new RegExp(`^ALARM_BOT_TOKEN=${VOICE_BOT}$`, "mu"), "строки будильника целы");
    for (const secret of [NEW_BOT, VOICE_BOT, written.split(":")[1], TOKEN, KEYS.model]) assert.ok(!done.out.includes(secret), "ни токены, ни ключ двери на экран не идут");
    assert.doesNotMatch(done.out, /Дальше: |Затем: /u, "шаги ведёт сама команда — «дальше» и «затем» говорить незачем");
    assert.deepEqual(tg.left(), [], "в канале после опыта пусто");
    assert.equal(tg.called("setWebhook") + tg.called("deleteWebhook"), 0);

    // Второй раз: всё на месте — ни вопросов, ни публикации; ответ за секунды.
    const again = await box.start("door", TG);
    assert.equal(again.code, 0, again.out);
    assert.match(again.out, /✓ Бот двери: @fresh_bot\.\n/u);
    assert.match(again.out, /✓ Ключ двери уже записан/u);
    assert.match(again.out, /✓ Дверь работает: путь — личное сообщение бота\./u);
    assert.equal(pushes(box).length, 1);

    // Как вживую 22.11.2026: новые посты ботов друг до друга не доходят. Два пути из трёх проходят, и видно, что
    // нового поста сердце не слышало вовсе.
    tg.state.botPosts = false;
    const live = await box.start("door", TG);
    assert.equal(live.code, 0, live.out);
    assert.match(live.out, /✓ личное сообщение бота: ответ за [\d.]+ с\n {2}✓ правка поста в канале: ответ за [\d.]+ с \(новый пост Аи до бота двери не дошёл — дошла его правка\)\n {2}✗ новый пост в канале: за 4 с ответа нет — запрос так и лежал в канале \(убрала его\): Аи его не прочла\n✓ Дверь работает: путь — личное сообщение бота\./u);
    assert.match(live.out, /Что слышала Аи от бота двери за этот опыт:\n• личное сообщение бота — запрос, ответила\n• правка поста — запрос, ответила\n• новый пост — не слышала\nОбщение ботов у Аи: включено\./u, "прежний опыт, где пост доходил, в счёт не идёт");
    assert.equal(pushes(box).length, 1, "ответ есть — публиковать заново незачем");

    // Худший случай: ботам канал не провод вовсе (не доходят ни посты, ни правки), а личное сообщение Telegram не
    // пускает. Экран обязан сказать, где потерялось: запрос не ушёл / Аи не слышала / что знает Telegram о доставке.
    // Сердце перед опытом само сказало, что дверь у него открыта, — второй публикации и второго круга нет.
    tg.state.botEdits = false; tg.state.talks = false;
    const none = await box.start("door", { ...TG, FAKE_HOOK_MORE: "  pending updates:  0" });
    assert.equal(none.code, 5, none.out);
    assert.match(none.out, /✓ Подписка Аи на события Telegram: личные сообщения, посты канала и их правки — на месте\.\nОпыт двери: три пути по очереди — запрос к Аи и её ответ\.\n {2}✗ личное сообщение бота: запрос не ушёл — Forbidden: bot can't send messages to bots\n/u);
    assert.match(none.out, /Личное сообщение бота требует режима общения ботов у обоих/u);
    assert.match(none.out, /✗ правка поста в канале: за 4 с ответа нет — запрос так и лежал в канале \(убрала его\): Аи его не прочла\n {2}✗ новый пост в канале: за 4 с ответа нет — запрос так и лежал в канале \(убрала его\): Аи его не прочла\n✗ Ни одним путём ответ не пришёл\.\n/u);
    assert.match(none.out, /Что слышала Аи от бота двери за этот опыт:\n• личное сообщение бота — не слышала\n• правка поста — не слышала\n• новый пост — не слышала\n/u);
    assert.match(none.out, /Telegram о доставке событий Аи: в очереди — 0; ошибок доставки нет\.\nПришлите этот экран целиком в чат разработки: по нему видно, где теряется запрос\.\n$/u);
    assert.doesNotMatch(none.out, /Публикую сердце/u);
    assert.equal(pushes(box).length, 1, "сердце заново не публикуется: ключ у него на месте");
    assert.match(box.envFile(), /^DOOR_WAY=direct$/mu, "прежняя запись о пути не тронута");
    assert.deepEqual(tg.left(), [], "и в этом случае в канале после опыта пусто");
    tg.state.botPosts = true; tg.state.botEdits = true; tg.state.talks = undefined;

    // Сердце опубликовали без ключа не отсюда (метка обманула): дверь молчит — команда публикует сама и пробует снова.
    line = ""; h = null;
    writeFileSync(join(box.dir, "cli.log"), "");
    const healed = await box.start("door", { ...TG, HEART_DOOR_TRY: "3" });
    assert.equal(healed.code, 0, healed.out);
    assert.match(healed.out, /✗ новый пост в канале: за 3 с ответа нет — запрос так и лежал в канале \(убрала его\): Аи его не прочла\n✗ Ни одним путём ответ не пришёл\./u);
    assert.match(healed.out, /Публикую сердце заново: в опубликованном, похоже, нет этого ключа двери/u);
    assert.match(healed.out, /✓ Дверь работает/u);
    assert.equal(cloud(), written);
  } finally { tg.close(); box.clean(); }
});
