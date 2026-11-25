/**
 * Дом на телефоне (`scripts/phone.sh`): автопубликация и будильник.
 *
 * Настоящей платформы здесь нет: вместо инструмента публикации — запись его
 * вызовов, вместо curl — запись запросов. Проверяется порядок действий и то,
 * что ключи не остаются в файлах и не попадают на экран.
 *
 * Песочница и подставные программы — `tests/fixtures/phone-kit.mjs`; режим `door` (дверь приложения) —
 * `tests/phone-door.test.mjs` (вынесен в 0.54.2: файл шёл дольше двух минут).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { sandbox, sh, skip, TOKEN, KEYS, TEST_LOGS, CLEAN_ENV } from "./fixtures/phone-kit.mjs";

const names = (calls) => calls.map(item => (item.args[0] === "run" ? `run:${item.args[1]}${item.args.includes("{ tick: true, deployed: true }") ? ":deployed" : item.args.includes("{ tick: true }") ? ":tick" : ""}` : item.args.slice(0, 2).join(" ").trim()));

test("первый круг публикует: репетиция → публикация → схема → вебхук → пробуждение, ключи только на время", { skip }, () => {
  const box = sandbox();
  try {
    const first = box.run("once");
    assert.equal(first.code, 0, first.out);
    const calls = box.cli();
    // Первым — малый запрос «есть ли связь»: кода он не несёт и ключей не требует.
    assert.deepEqual(names(calls), ["webhook", "run:handlers/message", "run:handlers/channel_post", "fetch", "push handlers", "migrate --yes", "webhook", "run:handlers/message:deployed"]);
    assert.deepEqual(calls.find(item => item.args[0] === "push").args, ["push", "handlers", "lib", "schema"]);
    assert.ok(calls.every(item => item.token), "токен публикации доходит до инструмента");
    assert.deepEqual([calls[0].where, calls[0].key], ["phone", false], "малый запрос идёт из папки, без ключей");
    const sent = calls.slice(1);
    assert.ok(sent.every(item => item.key && item.giga), "ключ модели и запасной (KEY_GIGACHAT) вписаны на время публикации");
    // В облако уходит копия коммита, а не папка: в ней ключи и нет комментариев.
    assert.ok(sent.every(item => item.where === "stage" && !item.inRepo), "код уходит из копии для облака");
    assert.ok(sent.every(item => item.slim), "и без комментариев");
    assert.match(first.out, /Код для облака: \d+ КБ одним запросом \(с комментариями было бы \d+ КБ\)\./u);
    assert.equal(box.status(), "", "в папке не менялось ничего");
    assert.match(readFileSync(join(box.phone, "tgcloud/handlers/message.js"), "utf8"), /этот комментарий облаку не нужен/u, "в папке комментарии на месте");
    assert.ok(!existsSync(join(box.home, ".heart/stage")), "копии с ключами после публикации нет");
    // Опубликованное стало слепком: тот же код, без комментариев и без ключей.
    const live = join(box.home, ".heart/live");
    assert.ok(!readFileSync(join(live, "tgcloud/handlers/message.js"), "utf8").includes("комментарий"));
    assert.ok(!readFileSync(join(live, "tgcloud/lib/secrets.js"), "utf8").includes(KEYS.model), "ключа в слепке нет");
    assert.ok(!readFileSync(join(box.home, ".heart/live.secrets.js"), "utf8").includes(KEYS.model));
    assert.match(box.state("published"), /^[0-9a-f]{40}\n1\.0\.0\n/u);
    assert.match(first.out, /Сборка 1\.0\.0 опубликована/u);
    for (const secret of [TOKEN, ...Object.values(KEYS)]) assert.ok(!first.out.includes(secret), "ключи не печатаются");
    assert.ok(!box.state("deploy.log").includes("secret.example"), "адрес вебхука в журнал не пишется");
    // Будильник: первое сообщение в канал, затем — правка его же.
    assert.ok(box.curl().some(line => line.includes("sendMessage") && line.includes("chat_id=-100")));
    assert.equal(box.state("alarm.msg").trim(), "77");

    const second = box.run("once");
    assert.equal(second.code, 0, second.out);
    assert.equal(box.cli().length, calls.length, "та же сборка второй раз не публикуется");
    assert.ok(box.curl().at(-1).includes("editMessageText") && box.curl().at(-1).includes("message_id=77"));
  } finally { box.clean(); }
});

// ── мини-приложение «Комната» (0.38.0) ──────────────────────────────────────
const PAGE = "https://app123.tgcloud.ai/";
/** Вызовы инструмента коротко: отправки — со всеми целями, пробуждение — с тем, что ему передали. */
const steps = (calls) => calls.map(item => (item.args[0] === "run" ? `run:${item.args[1]}${item.args.at(-1).includes("deployed: true") ? `:${item.args.at(-1)}` : ""}` : item.args.join(" ")));
const toldOwner = (box) => box.curl().filter(line => line.includes("chat_id=42")).map(line => decodeURIComponent(line));

test("мини-приложение: функция репетируется, уходит с кодом, страница — отдельно, адрес — сердцу с пробуждением", { skip }, () => {
  const box = sandbox({ app: true });
  try {
    const done = box.run("once");
    assert.equal(done.code, 0, done.out);
    const calls = box.cli();
    assert.deepEqual(steps(calls), [
      "webhook", "run:handlers/message", "run:handlers/channel_post", "fetch", "run:endpoints/room",
      "push handlers lib schema endpoints", "migrate --yes", "webhook", "push miniapp",
      `run:handlers/message:{ tick: true, deployed: true, page: "${PAGE}" }`,
    ]);
    const rehearsal = calls.find(item => item.args[1] === "endpoints/room");
    assert.deepEqual(rehearsal.args.slice(2), ['{ do: "look" }', "--ctx", "{ testRun: true }"], "репетиция комнаты ничего не пишет");
    assert.ok(calls.slice(1).every(item => item.where === "stage" && item.key && item.slim), "всё — из копии для облака");
    assert.match(done.out, /✓ Сборка 1\.0\.0 опубликована/u);
    assert.match(done.out, /✓ Мини-приложение «Комната» опубликовано: кнопка под ответом на «зайду к тебе» и в меню бота\./u);
    // Страница уходит без комментариев (0.51.0) — из той же копии, что и код; в папке комментарии на месте.
    assert.equal(calls.find(item => item.args.join(" ") === "push miniapp").page, true, "страница ушла без комментариев");
    assert.match(done.out, /Страница комнаты: \d+ КБ без картинок \(с комментариями было бы \d+ КБ\)\./u);
    assert.match(readFileSync(join(box.phone, "miniapp/app.js"), "utf8"), /этот комментарий платформе не нужен/u);
    assert.deepEqual(toldOwner(box), [], "всё вышло — телефон молчит: о сборке Аи пишет сама");
    assert.equal(box.status(), "", "в папке не менялось ничего");
    // Слепок опубликованного: страница в нём есть, комментариев и ключей — нет.
    const live = join(box.home, ".heart/live");
    assert.ok(existsSync(join(live, "miniapp/index.html")));
    assert.ok(!readFileSync(join(live, "tgcloud/endpoints/room.js"), "utf8").includes("комментарий"), "функция комнаты тоже уходит без комментариев");
    assert.ok(!readFileSync(join(live, "tgcloud/lib/secrets.js"), "utf8").includes(KEYS.model));
    // Обычный удар будильника адреса не несёт: сердце помнит его само.
    box.run("once");
    assert.ok(box.cli().slice(calls.length).every(item => !item.args.join(" ").includes("page:")));
  } finally { box.clean(); }
});

test("мини-приложение — надстройка: отказ платформы на любом его шаге бота не держит, владелец узнаёт причину", { skip }, () => {
  // 1. Функция комнаты не прошла репетицию: код уходит как раньше, страницы нет.
  let box = sandbox({ app: true });
  try {
    const done = box.run("once", { FAKE_FAIL: "run:endpoints/room" });
    const calls = box.cli();
    assert.deepEqual(steps(calls).slice(4), ["run:endpoints/room", "push handlers lib schema", "migrate --yes", "webhook", "run:handlers/message:{ tick: true, deployed: true }"]);
    assert.match(done.out, /Сборка 1\.0\.0 опубликована/u);
    assert.match(done.out, /⚠ Мини-приложение «Комната» не опубликовано: функция комнаты не прошла репетицию в облаке\. Сам бот на сборке 1\.0\.0\. Комната пока отвечает словами\./u);
    assert.match(box.state("published"), /\n1\.0\.0\n/u);
    assert.equal(toldOwner(box).length, 1);
    assert.match(toldOwner(box)[0], /text=⚠️ Телефон: сборка 1\.0\.0 опубликована, но мини-приложение «Комната» — нет: функция комнаты не прошла репетицию в облаке\. Комната пока отвечает словами\. Перешлите эту строку в чат разработки\./u);
    // Та же сборка второй раз не публикуется — и владельцу второй раз не пишут.
    box.run("once");
    assert.equal(toldOwner(box).length, 1);
  } finally { box.clean(); }

  // 2. Платформа не приняла код вместе с функцией: вторая отправка — без неё.
  box = sandbox({ app: true });
  try {
    const done = box.run("once", { FAKE_FAIL: "push:app" });
    assert.deepEqual(steps(box.cli()).slice(5), ["push handlers lib schema endpoints", "push handlers lib schema", "migrate --yes", "webhook", "run:handlers/message:{ tick: true, deployed: true }"]);
    assert.match(done.out, /Сборка 1\.0\.0 опубликована/u);
    assert.match(done.out, /Мини-приложение «Комната» не опубликовано: платформа не приняла функцию комнаты\./u);
    assert.match(box.state("deploy.log"), /== публикация без комнаты ==/u);
  } finally { box.clean(); }

  // 2а. Платформа не терпит саму функцию комнаты — ни в репетиции, ни в копии при отправке бота: функция из копии
  // убирается, и бот уходит как в сборках без комнаты. В папке с Аи при этом ничего не меняется.
  for (const [fatal, why, sent] of [
    ["all", "функция комнаты не прошла репетицию в облаке", ["run:endpoints/room", "push handlers lib schema"]],
    ["push", "платформа не приняла функцию комнаты", ["run:endpoints/room", "push handlers lib schema endpoints", "push handlers lib schema"]],
  ]) {
    box = sandbox({ app: true });
    try {
      const done = box.run("once", { FAKE_ROOM_FATAL: fatal });
      assert.deepEqual(steps(box.cli()).slice(4), [...sent, "migrate --yes", "webhook", "run:handlers/message:{ tick: true, deployed: true }"], fatal);
      assert.match(done.out, /✓ Сборка 1\.0\.0 опубликована/u, fatal);
      assert.ok(done.out.includes(`Мини-приложение «Комната» не опубликовано: ${why}.`), done.out);
      assert.match(box.state("published"), /\n1\.0\.0\n/u);
      assert.ok(!existsSync(join(box.home, ".heart/live/tgcloud/endpoints")), "в слепке опубликованного функции комнаты нет: её не публиковали");
      assert.ok(existsSync(join(box.home, ".heart/live/tgcloud/handlers/message.js")));
      assert.equal(box.status(), "", "в папке не менялось ничего");
      assert.ok(existsSync(join(box.phone, "tgcloud/endpoints/room.js")), "сам файл в папке с Аи цел");
    } finally { box.clean(); }
  }

  // 3. Страницу платформа не приняла: бот опубликован, сердце об адресе не слышит.
  box = sandbox({ app: true });
  try {
    const done = box.run("once", { FAKE_FAIL: "push:page" });
    assert.deepEqual(steps(box.cli()).slice(5), ["push handlers lib schema endpoints", "migrate --yes", "webhook", "push miniapp", "run:handlers/message:{ tick: true, deployed: true }"]);
    assert.match(done.out, /Мини-приложение «Комната» не опубликовано: платформа не приняла страницу комнаты\./u);
    assert.match(box.state("published"), /\n1\.0\.0\n/u);
  } finally { box.clean(); }

  // 4. То же, но прежняя страница жива: сердцу называется её адрес.
  box = sandbox({ app: true });
  try {
    const done = box.run("once", { FAKE_FAIL: "push:page", FAKE_PAGE_LIVE: "1" });
    assert.equal(steps(box.cli()).at(-1), `run:handlers/message:{ tick: true, deployed: true, page: "${PAGE}" }`);
    assert.match(done.out, /платформа не приняла страницу комнаты\. Сам бот на сборке 1\.0\.0\. Кнопки открывают прежнюю страницу\./u);
    assert.match(toldOwner(box).at(-1), /— нет: платформа не приняла страницу комнаты\. Кнопки открывают прежнюю страницу\. Перешлите/u);
  } finally { box.clean(); }

  // 5. Связь оборвалась на странице: шаг повторяется один раз; не вышло — причина названа.
  box = sandbox({ app: true });
  try {
    const done = box.run("once", { FAKE_FAIL: "push:page", FAKE_SAYS: "Error: Could not reach the platform" });
    assert.equal(steps(box.cli()).filter(name => name === "push miniapp").length, 2, "обрыв — один повтор");
    assert.match(done.out, /страница комнаты не отправилась: пропала связь с платформой\./u);
    assert.match(done.out, /Сборка 1\.0\.0 опубликована/u);
  } finally { box.clean(); }
});

test("мини-приложение: обрыв связи на репетиции комнаты — как на любой репетиции; странный адрес сердцу не уходит", { skip }, () => {
  let box = sandbox({ app: true });
  try {
    const done = box.run("once", { FAKE_FAIL: "run:endpoints/room", FAKE_SAYS: "Error: Could not reach the platform" });
    assert.ok(!box.cli().some(item => item.args[0] === "push"), "до публикации дело не дошло");
    assert.equal(box.state("published"), "");
    assert.match(done.out, /не отвечает — публикация подождёт связи\. Бот на прежней сборке\./u);
  } finally { box.clean(); }

  // Адрес уходит сердцу внутри строки настроек: в него попадают только безопасные знаки.
  for (const url of ['https://x.example/" }, evil: { a: "1', "http://app123.tgcloud.ai/", "https://app123.tgcloud.ai/?a=$(id)", ""]) {
    box = sandbox({ app: true });
    try {
      const done = box.run("once", { FAKE_PAGE_URL: url });
      assert.equal(steps(box.cli()).at(-1), "run:handlers/message:{ tick: true, deployed: true }", url);
      assert.match(done.out, /платформа приняла страницу комнаты, но не назвала её адрес/u, url);
      assert.match(done.out, /Сборка 1\.0\.0 опубликована/u);
    } finally { box.clean(); }
  }
});

test("мини-приложение: сборка без него публикуется по-прежнему; настройки без страницы — причина названа", { skip }, () => {
  // Функция есть, а страницы в коммите нет: функция уходит, владелец узнаёт, чего не хватает.
  const box = sandbox({ app: true });
  try {
    sh(box.seed, "git rm -q -r miniapp && git commit -q -m nopage && git push -q origin work");
    const done = box.run("once");
    assert.deepEqual(steps(box.cli()).slice(4), ["run:endpoints/room", "push handlers lib schema endpoints", "migrate --yes", "webhook", "run:handlers/message:{ tick: true, deployed: true }"]);
    assert.match(done.out, /не опубликовано: в коммите нет страницы комнаты \(miniapp\/index\.html и tgcloud\.jsonc\)/u);
  } finally { box.clean(); }
});

test("новый коммит без нового номера сборки ждёт; новый номер публикуется сам", { skip }, () => {
  const box = sandbox();
  try {
    box.run("once");
    const before = box.cli().length;
    const middle = box.commit();
    box.run("once");
    assert.equal(box.head(), middle, "папка идёт за веткой");
    assert.equal(box.cli().length, before, "недоделанное в живого бота не уходит");

    box.commit("1.1.0");
    const done = box.run("once");
    assert.match(done.out, /Сборка 1\.1\.0 опубликована/u);
    assert.match(box.state("published"), /\n1\.1\.0\n/u);

    // «Каждый коммит» — по желанию владельца.
    const count = box.cli().length;
    box.commit();
    box.run("once", { HEART_DEPLOY_ON: "commit" });
    assert.ok(box.cli().length > count);
  } finally { box.clean(); }
});

test("репетиция упала — публикации нет; владелец узнаёт один раз; после трёх попыток — раз в час", { skip }, () => {
  const box = sandbox();
  try {
    const first = box.run("once", { FAKE_FAIL: "run:handlers/channel_post" });
    assert.match(first.out, /Не прошло: репетиция: пост канала — публикации нет, бот на прежней сборке\. Подробности/u);
    assert.ok(!box.cli().some(item => item.args[0] === "push"), "до публикации дело не дошло");
    assert.equal(box.status(), "", "ключи убраны и после неудачи");
    assert.equal(box.state("published"), "");
    const told = () => box.curl().filter(line => line.includes("chat_id=42"));
    assert.equal(told().length, 1);
    // Весть подписана: пишет телефон, а не бот, чьим голосом она пришла.
    assert.match(decodeURIComponent(told()[0]), /text=⚠️ Телефон: сборка 1\.0\.0 не опубликована — репетиция: пост канала\. Аи осталась на прежней сборке\./u);
    // Что ответила платформа — на экране, без похода в журнал.
    assert.match(first.out, /Подробности: \S+deploy\.log\n\d\d\.\d\d \d\d:\d\d {4}✗ boom\n/u);

    box.run("once", { FAKE_FAIL: "run:handlers/channel_post" });
    const third = box.run("once", { FAKE_FAIL: "run:handlers/channel_post" });
    assert.match(third.out, /Три попытки подряд не вышли\. Этот коммит дальше пробую раз в 60 мин; новый коммит — сразу/u);
    assert.equal(told().length, 1, "об одной и той же поломке — одно сообщение");
    const tried = box.cli().length;
    box.run("once");
    assert.equal(box.cli().length, tried, "три неудачи — в ближайший час этот коммит не трогается");
    // Причина бывает временной (связь): через час — ещё попытка, без нового сообщения владельцу.
    const [commit, count] = box.state("failed").split("\n");
    assert.equal(count, "3");
    writeFileSync(join(box.home, ".heart/failed"), `${commit}\n3\n${Math.floor(Date.now() / 1000) - 3700}\n`);
    box.run("once", { FAKE_FAIL: "run:handlers/channel_post" });
    assert.ok(box.cli().length > tried, "час прошёл — попытка повторяется");
    assert.equal(told().length, 1);
    const again = box.cli().length;
    box.run("once");
    assert.equal(box.cli().length, again, "и снова ждёт час");

    box.commit("1.0.1");
    // Токен — частая причина первого запуска: о нём сказано словами, без похода в журнал. Отказ виден уже по малому запросу.
    const before = box.cli().length;
    const rejected = box.run("once", { FAKE_FAIL: "webhook,run:handlers/message", FAKE_SAYS: "Error: TGCLOUD_TOKEN (app123): token is invalid or expired." });
    assert.match(rejected.out, /Публикации нет, бот на прежней сборке\. Причина: платформа не приняла токен публикации\./u);
    assert.deepEqual(names(box.cli().slice(before)), ["webhook"], "с непринятым токеном код в облако не отправляется");
    const later = box.run("once", { FAKE_FAIL: "run:handlers/message", FAKE_SAYS: "Error: TGCLOUD_TOKEN (app123): token is invalid or expired." });
    assert.match(later.out, /Не прошло: репетиция: сообщение — публикации нет, бот на прежней сборке\. Причина: платформа не приняла токен публикации\./u);
    const fixed = box.run("once");
    assert.match(fixed.out, /Сборка 1\.0\.1 опубликована/u);
  } finally { box.clean(); }
});

test("тесты не прошли — в облако ничего не уходит; ключи и настройки дома до тестов не доходят", { skip }, () => {
  const box = sandbox();
  try {
    const done = box.run("once", { HEART_TESTS: "on", FAKE_CI: "1", DOOR_BOT_TOKEN: "777003:door-bot-SECRET-token" });
    assert.match(done.out, /Тесты не прошли/u);
    assert.deepEqual(names(box.cli()), ["webhook"], "в облако ушёл только малый запрос «есть ли связь» — без кода и без ключей");
    assert.ok(!existsSync(join(box.home, ".heart/stage")), "копия для облака и не собиралась");
    // Тестам не нужны ни ключи, ни «за какой веткой следить»: с ними они и текут, и ведут себя иначе.
    const seen = box.ci();
    for (const secret of [TOKEN, ...Object.values(KEYS)]) assert.ok(!seen.includes(secret), "ключи до тестов не доходят");
    assert.doesNotMatch(seen, /^(?:HEART_|ALARM_|TGCLOUD_|KEY_|DOOR_|AI_PROVIDER_KEY=|AI_EXTRA_KEYS=|OWNER_TG_ID=)/mu);
    assert.match(seen, /^FAKE_CI=1$/mu, "остальное окружение — как было");
    assert.match(seen, /^PATH=/mu);

    // Что именно не прошло и почему — на экране, каждая неудача один раз. node
    // пишет журнал в двух видах: 24-й — «✖» с итоговым разделом, 22-й — TAP.
    for (const [kind, text] of Object.entries(TEST_LOGS)) {
      const file = join(box.dir, `${kind}.log`);
      writeFileSync(file, text);
      const out = box.run("once", { HEART_TESTS: "on", FAKE_CI: "1", FAKE_CI_OUT: file }).out;
      const lines = out.split("\n").map(line => line.replace(/^\d\d\.\d\d \d\d:\d\d /u, ""));
      const from = lines.findIndex(line => line.startsWith("✗ Тесты не прошли"));
      const named = kind === "spec";
      assert.deepEqual(lines.slice(from + 1, from + 5), [
        "   ✖ канал: ответ сестры доходит",
        `       ${named ? "TypeError [Error]: " : ""}Cannot read properties of undefined (reading 'text')`,
        "   ✖ канал: опоздавший ответ",
        `       ${named ? "AssertionError [ERR_ASSERTION]: " : ""}ответ снимает молчание`,
      ], kind);
      assert.match(lines[from + 5], /Если дело в самом телефоне/u, kind);
      assert.doesNotMatch(out, /failing tests|not ok|\(\d[\d.]*ms\)/u, kind);
    }

    // Три неудачи подряд уже были: следующая попытка — через час или после перезапуска.
    assert.equal(box.run("once", { HEART_TESTS: "on" }).out, "");
    rmSync(join(box.home, ".heart/failed"));
    const passed = box.run("once", { HEART_TESTS: "on" });
    assert.match(passed.out, /Проверяю сборку тестами/u);
    assert.match(passed.out, /Сборка 1\.0\.0 опубликована/u);
    assert.ok(box.cli().every(item => item.token), "токен — у каждого запроса");
    assert.ok(box.cli().filter(item => item.where === "stage").length > 0 && box.cli().filter(item => item.where === "stage").every(item => item.key), "а публикации ключи достались");
  } finally { box.clean(); }
});

test("без второго бота будильник идёт через платформу; чужая сборка — не удар", { skip }, () => {
  const box = sandbox({ lines: [`TGCLOUD_HEART_TOKEN=${TOKEN}`, `AI_PROVIDER_KEY=${KEYS.model}`, "HEART_BRANCH=work", 'AI_EXTRA_KEYS={"explabs":"xpl_1abcdef"}'] });
  try {
    const done = box.run("once");
    assert.equal(done.code, 0, done.out);
    const calls = box.cli();
    assert.equal(names(calls).at(-1), "run:handlers/message:tick");
    assert.ok(calls.at(-1).key && calls.at(-1).explabs, "удару нужны те же ключи; JSON в файле ключей читается как есть");
    assert.equal(box.curl().length, 0, "второго бота нет — в Telegram никто не ходит");
    assert.equal(box.status(), "");

    const tick = box.run("tick", { FAKE_MISMATCH: "1" });
    assert.equal(tick.code, 1);
    assert.match(tick.out, /другая сборка/u);
  } finally { box.clean(); }
});

test("несохранённые правки в папке не стираются; проверка настройки не показывает ключей", { skip }, () => {
  const box = sandbox();
  try {
    box.run("once");
    const before = box.head();
    writeFileSync(join(box.phone, "package.json"), "{}\n");
    box.commit("2.0.0");
    const done = box.run("once");
    assert.match(done.out, /несохранённые правки/u);
    assert.equal(box.head(), before);
    assert.equal(readFileSync(join(box.phone, "package.json"), "utf8"), "{}\n");

    const check = box.run("check");
    assert.match(check.out, /токен публикации: вид правильный/u);
    assert.match(check.out, /запасные мозги: gigachat/u);
    assert.match(check.out, /от имени @voice_bot, канал «Мост "дом"»/u, "название канала — словом, а не \\u041c…, и с кавычками внутри");
    for (const secret of [TOKEN, ...Object.values(KEYS)]) assert.ok(!check.out.includes(secret), "ключи не печатаются");
    assert.ok(!box.cli().slice(-1)[0].args.includes("push"), "проверка ничего не публикует");
    assert.doesNotMatch(check.out, /дверь приложения|KEY_DOOR/u, "ключа двери нет — о двери ни слова");

    // Ключ двери приложения (0.54.0, docs/DOOR.md) — не «запасной мозг»: о нём своя строка, и вид у него свой.
    const base = ["# ключи", `TGCLOUD_HEART_TOKEN=${TOKEN}`, `AI_PROVIDER_KEY=${KEYS.model}`, "OWNER_TG_ID=42", `KEY_GIGACHAT=${KEYS.giga}`, "HEART_BRANCH=work", `ALARM_BOT_TOKEN=${KEYS.voice}`, "ALARM_CHAT_ID=-100"];
    const DOOR_SECRET = "door-SECRET-0123456789abcdefghijklmnop";
    box.keys([...base, `KEY_DOOR=-1001234567890:${DOOR_SECRET}`]);
    const withDoor = box.run("check");
    assert.match(withDoor.out, /✓ дверь приложения: ключ записан верно; своего бота двери на телефоне нет — проверить её отсюда: bash scripts\/phone\.sh door\n/u);
    // Свой бот двери записан — подсказки нет; записан не так — сказано. Сам токен не печатается.
    box.keys([...base, `KEY_DOOR=-1001234567890:${DOOR_SECRET}`, "DOOR_BOT_TOKEN=777003:door-bot-SECRET-token"]);
    const withBot = box.run("check");
    assert.match(withBot.out, /✓ дверь приложения: ключ записан верно\n/u);
    assert.ok(!withBot.out.includes("door-bot-SECRET-token"));
    box.keys([...base, `KEY_DOOR=-1001234567890:${DOOR_SECRET}`, "DOOR_BOT_TOKEN=это не токен"]);
    assert.match(box.run("check").out, /• DOOR_BOT_TOKEN не похож на токен бота/u);
    assert.match(withDoor.out, /запасные мозги: gigachat\s*\n/u, "среди мозгов двери нет");
    assert.ok(!withDoor.out.includes(DOOR_SECRET) && !withDoor.out.includes("-1001234567890"), "ни секрет, ни номер канала не печатаются");
    box.keys([...base, `KEY_DOOR=${DOOR_SECRET}`]);
    const wrongDoor = box.run("check");
    assert.match(wrongDoor.out, /KEY_DOOR записан не так: нужен вид «номер канала:секрет»/u);
    assert.ok(!wrongDoor.out.includes(DOOR_SECRET));
  } finally { box.clean(); }
});

test("строка-образец вместо ключа в живого бота не уходит", { skip }, () => {
  // Файл ключей заполнен по инструкции, но значения не вписаны.
  const box = sandbox({ lines: [`TGCLOUD_HEART_TOKEN=${TOKEN}`, "AI_PROVIDER_KEY=ключ модели", "OWNER_TG_ID=ваш числовой ID", "KEY_GIGACHAT=Authorization Key из Сбера", "HEART_BRANCH=work"] });
  try {
    const check = box.run("check");
    assert.equal(check.code, 1);
    assert.match(check.out, /✗ AI_PROVIDER_KEY не похож на ключ/u);
    assert.match(check.out, /✗ KEY_GIGACHAT не похож на ключ/u);
    assert.match(check.out, /Сначала поправьте строки с ✗/u);
    assert.ok(!check.out.includes("Сбера") && !check.out.includes("ключ модели"), "значения не печатаются, даже образцы");

    const before = box.cli().length;
    const done = box.run("once");
    assert.match(done.out, /✗ Публикации нет, бот на прежней сборке: AI_PROVIDER_KEY .* не похож на ключ/u);
    assert.equal(box.cli().length, before, "в облако не ушло ничего: ни репетиции, ни публикации, ни удара");
    assert.equal(box.state("published"), "");
    assert.equal(box.status(), "");
    // Нехватка настройки — не попытка: сколько бы кругов ни прошло, исправленный файл публикуется сразу.
    for (let round = 0; round < 4; round += 1) box.run("once");
    assert.equal(box.state("failed"), "", "счёт неудач не тронут");
    assert.equal(box.cli().length, before);
    // Вечный цикл с такими ключами не крутится впустую, а говорит сразу.
    const refused = box.run("run");
    assert.equal(refused.code, 1);
    assert.match(refused.out, /✗ С такими ключами публиковать нельзя: AI_PROVIDER_KEY/u);
    box.keys([`TGCLOUD_HEART_TOKEN=${TOKEN}`, `AI_PROVIDER_KEY=${KEYS.model}`, "HEART_BRANCH=work"]);
    assert.match(box.run("once").out, /Сборка 1\.0\.0 опубликована/u);
  } finally { box.clean(); }

  // Ключ модели настоящий, а запасной и ID — образцы: публикация идёт, образцы в код не попадают.
  const mixed = sandbox({ lines: [`TGCLOUD_HEART_TOKEN=${TOKEN}`, `AI_PROVIDER_KEY=${KEYS.model}`, "OWNER_TG_ID=ваш числовой ID", "KEY_GIGACHAT=Authorization Key из Сбера", "HEART_BRANCH=work"] });
  try {
    const done = mixed.run("once");
    assert.match(done.out, /Сборка 1\.0\.0 опубликована/u);
    const pushed = mixed.cli().find(item => item.args[0] === "push");
    assert.equal(pushed.key, true);
    assert.equal(pushed.giga, false);
    // Что именно вписалось: запасных провайдеров ноль, владельца нет.
    const filled = spawnSync("node", ["scripts/inject-secrets.mjs"], { cwd: mixed.phone, encoding: "utf8", env: { ...CLEAN_ENV, AI_PROVIDER_KEY: KEYS.model, OWNER_TG_ID: "ваш числовой ID", KEY_GIGACHAT: "Authorization Key из Сбера", AI_EXTRA_KEYS: '{"explabs":"ключ из кабинета"}' } });
    assert.match(filled.stdout, /provider key yes, owner no, spare providers 0/u);
    assert.match(filled.stdout, /KEY_GIGACHAT does not look like a key/u);
    assert.ok(!filled.stdout.includes("Authorization Key"), "само значение не печатается");
    const secrets = readFileSync(join(mixed.phone, "tgcloud/lib/secrets.js"), "utf8");
    assert.ok(!/Сбера|числовой|кабинета/u.test(secrets));
    // Строгий режим с образцом вместо ключа — стоп, файл не тронут.
    sh(mixed.phone, "git checkout -q -- tgcloud/lib/secrets.js");
    const strict = spawnSync("node", ["scripts/inject-secrets.mjs", "--require-key"], { cwd: mixed.phone, encoding: "utf8", env: { ...CLEAN_ENV, AI_PROVIDER_KEY: "ключ модели" } });
    assert.equal(strict.status, 1);
    assert.equal(mixed.status(), "");
  } finally { mixed.clean(); }
});

test("старая папка на другой ветке сама переходит на нужную; причина отказа GitHub названа словами", { skip }, () => {
  const box = sandbox();
  try {
    // Папка осталась от прежних попыток: своя ветка, старый коммит.
    sh(box.phone, "git checkout -q -b leftover");
    const fresh = box.commit("1.1.0");
    const check = box.run("check");
    assert.match(check.out, /папка пока на коммите [0-9a-f]{7} — при запуске обновится сама/u);
    const done = box.run("once");
    assert.equal(box.head(), fresh);
    assert.match(done.out, /Сборка 1\.1\.0 опубликована/u);
  } finally { box.clean(); }

  const lost = sandbox({ lines: [`TGCLOUD_HEART_TOKEN=${TOKEN}`, `AI_PROVIDER_KEY=${KEYS.model}`, "HEART_BRANCH=nope"] });
  try {
    const check = lost.run("check");
    assert.equal(check.code, 1);
    assert.match(check.out, /✗ ветки «nope» в GitHub нет — сверьте строку HEART_BRANCH/u);
    const quiet = lost.run("once");
    assert.match(quiet.out, /Новое из GitHub не взять: ветки «nope» в GitHub нет/u);
  } finally { lost.clean(); }
});

test("лишние модули облака: отправка без целей убирает их, страница идёт своим шагом; отказ платформы — её словами на экран и владельцу", { skip }, () => {
  // 1. В облаке лежит то, чего в коде уже нет (прежний словарь): отправка — без целей, она одна убирает лишнее.
  // Настройки проекта на это время из копии убраны (иначе вместе с кодом ушла бы страница) и возвращены на место.
  let box = sandbox({ app: true });
  try {
    const done = box.run("once", { FAKE_CLOUD: "lib/data/phrases.js,lib/old.js" });
    const pushes = box.cli().filter(item => item.args[0] === "push");
    assert.deepEqual(pushes.map(item => item.args.join(" ")), ["push", "push miniapp"], done.out);
    assert.deepEqual(pushes.map(item => item.config), [false, true], "код уходит без настроек проекта, страница — с ними");
    assert.match(done.out, /В облаке модулей: 6, из них лишних \(в коде их уже нет\): 2 — lib\/data\/phrases, lib\/old\. Убираю их этой публикацией\./u);
    assert.match(done.out, /✓ Сборка 1\.0\.0 опубликована/u);
    assert.match(done.out, /✓ Мини-приложение «Комната» опубликовано/u);
    assert.ok(existsSync(join(box.home, ".heart/live/tgcloud.jsonc")), "в слепке опубликованного настройки проекта на месте");
    assert.ok(!existsSync(join(box.home, ".heart/live/tgcloud.jsonc.off")));
    assert.equal(box.status(), "", "в папке не менялось ничего");
  } finally { box.clean(); }

  // 2. Лишнего нет — отправка как всегда, с целями. Функция комнаты, которую скрипт сам убрал из копии (не прошла
  // репетицию), в облаке не «лишняя»: её там не трогают.
  box = sandbox({ app: true });
  try {
    const done = box.run("once", { FAKE_CLOUD: "-" });
    assert.deepEqual(box.cli().filter(item => item.args[0] === "push").map(item => item.args.join(" ")), ["push handlers lib schema endpoints", "push miniapp"]);
    assert.doesNotMatch(done.out, /лишних/u);
  } finally { box.clean(); }
  box = sandbox({ app: true });
  try {
    const done = box.run("once", { FAKE_CLOUD: "-", FAKE_FAIL: "run:endpoints/room" });
    assert.deepEqual(box.cli().filter(item => item.args[0] === "push").map(item => item.args.join(" ")), ["push handlers lib schema"]);
    assert.doesNotMatch(done.out, /лишних/u);
    assert.match(done.out, /✓ Сборка 1\.0\.0 опубликована/u);
  } finally { box.clean(); }

  // 3. Платформа не приняла код: её слова — на экране и в вести владельцу, вместе со счётом модулей. Ключи в них
  // не попадают. Так выглядела бы сборка 0.49.0, будь эта строка в скрипте раньше (сообщение 50).
  box = sandbox({ app: true });
  try {
    const failed = box.run("once", { FAKE_CLOUD: "lib/data/phrases.js", FAKE_FAIL: "push", FAKE_SAYS: `Checking changes...\n  url: https://secret.example/hook\nError: Too many modules (limit: 100) for ${TOKEN}` });
    assert.deepEqual(box.cli().filter(item => item.args[0] === "push").map(item => item.args.join(" ")), ["push", "push handlers lib schema endpoints", "push handlers lib schema"], "запасные пути — прежние: с целями, потом без функции комнаты");
    assert.match(failed.out, /✗ Публикация не прошла: платформа не приняла код\. Подробности: /u);
    assert.match(failed.out, / {3}Error: Too many modules \(limit: 100\) for \*\*\*/u);
    assert.match(failed.out, /Модулей в коммите: 4, в облаке до отправки: 5\./u);
    assert.ok(!failed.out.includes(TOKEN) && !failed.out.includes("secret.example"), "ни ключа, ни адреса на экране");
    assert.equal(toldOwner(box).length, 1);
    assert.match(toldOwner(box)[0], /text=⚠️ Телефон: сборка 1\.0\.0 не опубликована — платформа не приняла код\. Её ответ: «Error: Too many modules \(limit: 100\) for \*\*\*»\. Модулей в коммите: 4, в облаке до отправки: 5\. Перешлите эту строку в чат разработки\. Аи осталась на прежней сборке\./u);
    assert.ok(!toldOwner(box)[0].includes(TOKEN.split(":")[1]), "ключ публикации в весть владельцу не попадает");
    assert.ok(existsSync(join(box.phone, "tgcloud.jsonc")) && !existsSync(join(box.home, ".heart/stage")), "после неудачи копии нет, папка цела");
  } finally { box.clean(); }

  // 3а. Отправку без целей платформа не приняла, а обычную — приняла: бот и страница опубликованы как раньше, лишнее
  // осталось в облаке, владелец узнаёт об этом словами платформы. Хуже, чем до 0.49.1, новая отправка не делает.
  box = sandbox({ app: true });
  try {
    const done = box.run("once", { FAKE_CLOUD: "lib/data/phrases.js", FAKE_FAIL: "push:all", FAKE_SAYS: "Error: Deleting modules is not allowed" });
    const pushes = box.cli().filter(item => item.args[0] === "push");
    assert.deepEqual(pushes.map(item => item.args.join(" ")), ["push", "push handlers lib schema endpoints", "push miniapp"]);
    assert.deepEqual(pushes.map(item => item.config), [false, true, true], "после неудачи настройки проекта на месте");
    assert.match(done.out, /Сборка 1\.0\.0 опубликована, но лишние модули из облака убрать не вышло \(ответ платформы: «Error: Deleting modules is not allowed»\); перешлите эту строку в чат разработки\./u);
    assert.match(done.out, /✓ Мини-приложение «Комната» опубликовано/u);
    assert.match(box.state("published"), /\n1\.0\.0\n/u);
    assert.match(toldOwner(box).at(-1), /сборка 1\.0\.0 опубликована, но лишние модули из облака убрать не вышло \(ответ платформы: «Error: Deleting modules is not allowed»\)/u);
  } finally { box.clean(); }

  // 4. Без слепка облака (инструмент его не оставил) — как раньше: с целями, а об отказе — словами платформы.
  box = sandbox();
  try {
    const failed = box.run("once", { FAKE_FAIL: "push", FAKE_SAYS: "Error: schema.js: unexpected token" });
    assert.deepEqual(box.cli().filter(item => item.args[0] === "push").map(item => item.args.join(" ")), ["push handlers lib schema"]);
    assert.match(failed.out, /✗ Публикация не прошла: платформа не приняла код\./u);
    assert.match(failed.out, / {3}Error: schema\.js: unexpected token/u);
    assert.doesNotMatch(failed.out, /Модулей в коммите/u);
    assert.match(toldOwner(box)[0], /не опубликована — платформа не приняла код\. Её ответ: «Error: schema\.js: unexpected token»\. Перешлите эту строку в чат разработки\. Аи осталась/u);
  } finally { box.clean(); }

  // 5. Связь оборвалась на отправке — это по-прежнему «нет связи», а не «платформа не приняла».
  box = sandbox();
  try {
    const cut = box.run("once", { FAKE_FAIL: "push", FAKE_SAYS: "✗ Could not reach the tgcloud server at https://cloud.telegram.org. Check your connection (or the TG_CLOUD_API_URL setting)." });
    assert.match(cut.out, /✗ Публикация не прошла\. Причина: нет связи с платформой Telegram\. Подробности: /u);
    assert.doesNotMatch(cut.out, /платформа не приняла код/u);
  } finally { box.clean(); }

  // 6. Страницу платформа не приняла: её слова — в строке о мини-приложении и в вести владельцу.
  box = sandbox({ app: true });
  try {
    const done = box.run("once", { FAKE_FAIL: "push:page", FAKE_SAYS: "Error: miniapp/her/big.js (3.1 MB): the server refused the upload as too large (HTTP 413)." });
    assert.match(done.out, /Мини-приложение «Комната» не опубликовано: платформа не приняла страницу комнаты\./u);
    assert.match(done.out, / {3}Ответ платформы: Error: miniapp\/her\/big\.js \(3\.1 MB\): the server refused the upload as too large \(HTTP 413\)\./u);
    assert.match(toldOwner(box).at(-1), /Перешлите эту строку в чат разработки\. Ответ платформы: «Error: miniapp\/her\/big\.js \(3\.1 MB\): the server refused the upload as too large \(HTTP 413\)\.»\./u);
  } finally { box.clean(); }
});

test("удар через платформу идёт опубликованным кодом, а не тем, что лежит в папке", { skip }, () => {
  const lines = [`TGCLOUD_HEART_TOKEN=${TOKEN}`, `AI_PROVIDER_KEY=${KEYS.model}`, "HEART_BRANCH=work"];
  // До первой публикации бить нечем: чужой код в живую базу не ходит.
  const cold = sandbox({ lines });
  try {
    const failed = cold.run("once", { FAKE_FAIL: "push" });
    assert.match(failed.out, /Публикация не прошла/u);
    assert.match(failed.out, /начнёт бить после первой публикации с этого телефона/u);
    assert.ok(!names(cold.cli()).includes("run:handlers/message:tick"), "неопубликованная сборка базу не трогает");
    const tick = cold.run("tick");
    assert.equal(tick.code, 1);
  } finally { cold.clean(); }

  const box = sandbox({ lines });
  try {
    box.run("once");
    const first = box.cli().at(-1);
    assert.deepEqual([names([first])[0], first.inRepo, first.wip, first.key], ["run:handlers/message:tick", false, false, true], "удар — из слепка, с ключом");
    // Пришёл недоделанный коммит: папка ушла за веткой, удар остался на опубликованном.
    const middle = box.commit(null, { wip: true });
    box.run("once");
    assert.equal(box.head(), middle);
    assert.ok(existsSync(join(box.phone, "tgcloud/wip.js")));
    const tick = box.run("tick");
    assert.equal(tick.code, 0, tick.out);
    const beat = box.cli().at(-1);
    assert.deepEqual([names([beat])[0], beat.wip, beat.key], ["run:handlers/message:tick", false, true], "недоделанное в базу не ходит");
    assert.ok(!readFileSync(join(box.home, ".heart/live/tgcloud/lib/secrets.js"), "utf8").includes(KEYS.model), "ключ в слепке — только на время удара");
    // Новый номер сборки: публикуется, и удар переходит на новый код.
    box.commit("1.1.0");
    box.run("once");
    const next = box.run("tick");
    assert.equal(next.code, 0, next.out);
    assert.equal(box.cli().at(-1).wip, true, "после публикации слепок — новая сборка");
    assert.match(readFileSync(join(box.home, ".heart/live/tgcloud/lib/heart.js"), "utf8"), /1\.1\.0/u);
  } finally { box.clean(); }
});

test("первый запуск без файла ключей: проверка создаёт пустой файл с готовыми именами и говорит, что дальше", { skip }, () => {
  const box = sandbox();
  const file = join(box.home, ".heart.env");
  try {
    rmSync(file);
    const first = box.run("check");
    assert.equal(first.code, 1);
    assert.match(first.out, /файла не было, создан пустой/u);
    assert.match(first.out, /Дальше: (?:nano|pkg install -y nano && nano|\S+) \S+\.heart\.env — вписать значения/u);
    const made = readFileSync(file, "utf8");
    assert.match(made, /^TGCLOUD_HEART_TOKEN=$/mu);
    assert.match(made, /^AI_PROVIDER_KEY=$/mu);
    assert.match(made, /^HEART_BRANCH=work$/mu, "ветка — та, с которой склонирована папка");
    assert.match(made, /^# ALARM_BOT_TOKEN=$/mu);
    assert.equal(statSync(file).mode & 0o777, 0o600, "файл ключей закрыт от чужих глаз");
    assert.equal(box.cli().length, 0);

    // Пустой файл — ещё не настройка: ни цикл, ни публикация не начинаются.
    const second = box.run("check");
    assert.match(second.out, /— найден/u);
    assert.match(second.out, /✗ нет TGCLOUD_HEART_TOKEN/u);
    assert.match(second.out, /Сначала поправьте строки с ✗ \(ключи — в \S+\.heart\.env\)/u);
    const idle = box.run("run");
    assert.equal(idle.code, 1);
    assert.match(idle.out, /делать нечего\. Начните с проверки/u);
    assert.equal(box.cli().length, 0);

    // Ключ вставлен отдельной строкой, под именем: названы номера строк, сам текст — нет.
    box.keys(["# ключи", "TGCLOUD_HEART_TOKEN=", TOKEN, "", "AI_PROVIDER_KEY=", "QWxhZGRpbjpvcGVuIHNlc2FtZQ=="]);
    const loose = box.run("check");
    assert.equal(loose.code, 1);
    assert.match(loose.out, /✗ в файле ключей не читаются строки: 3 6 — нужно «ИМЯ=значение» в одной строке/u);
    assert.match(loose.out, /✗ нет TGCLOUD_HEART_TOKEN/u);
    assert.ok(!loose.out.includes(TOKEN) && !loose.out.includes("QWxhZGRp"), "содержимое непонятой строки не печатается");

    // Заполненный файл проверка не трогает никогда.
    box.keys([`TGCLOUD_HEART_TOKEN=${TOKEN}`, `AI_PROVIDER_KEY=${KEYS.model}`]);
    const ready = box.run("check");
    assert.equal(ready.code, 0, ready.out);
    assert.match(ready.out, /Готово к работе: bash scripts\/phone\.sh/u);
    assert.match(readFileSync(file, "utf8"), /^AI_PROVIDER_KEY=gsk-/mu);
  } finally { box.clean(); }
});

test("без строки HEART_BRANCH дом идёт за веткой, с которой склонирована папка", { skip }, () => {
  const box = sandbox({ lines: [`TGCLOUD_HEART_TOKEN=${TOKEN}`, `AI_PROVIDER_KEY=${KEYS.model}`] });
  try {
    assert.match(box.run("check").out, /Ветка:\s+work \(ветка папки\)/u);
    assert.match(box.run("once").out, /Сборка 1\.0\.0 опубликована/u);
    // После первого обновления папка стоит на коммите, а не на ветке: имя помнится.
    const fresh = box.commit("1.1.0");
    assert.match(box.run("once").out, /Сборка 1\.1\.0 опубликована/u);
    assert.equal(box.head(), fresh);
    assert.match(box.run("check").out, /Ветка:\s+work \(ветка папки, как в прошлый раз\)/u);
    box.commit("1.2.0");
    assert.match(box.run("once").out, /Сборка 1\.2\.0 опубликована/u);
  } finally { box.clean(); }
});

test("ветка, где этого скрипта нет (main до слияния): папка туда не уходит и ничего не публикуется", { skip }, () => {
  const box = sandbox({ lines: [`TGCLOUD_HEART_TOKEN=${TOKEN}`, `AI_PROVIDER_KEY=${KEYS.model}`, "HEART_BRANCH=main"] });
  try {
    sh(box.seed, "git checkout -q -b main && git rm -q scripts/phone.sh && git commit -q -m old && git push -q origin main && git checkout -q work");
    const before = box.head();
    const check = box.run("check");
    assert.equal(check.code, 1);
    assert.match(check.out, /✗ в ветке «main» нет scripts\/phone\.sh/u);
    for (const mode of ["once", "deploy"]) {
      const done = box.run(mode);
      assert.match(done.out, /В ветке «main» нет scripts\/phone\.sh — на неё не перехожу и ничего не публикую/u);
      assert.equal(box.head(), before);
      assert.ok(existsSync(join(box.phone, "scripts/phone.sh")), "дом остался на месте");
    }
    assert.equal(box.run("deploy").code, 1);
    assert.deepEqual([...new Set(names(box.cli()))], ["fetch"], "то, что лежит в папке, под именем чужой ветки не публикуется: в облако ходила только проверка токена");
    assert.equal(box.state("published"), "");
  } finally { box.clean(); }
});

test("чужая папка .tgcloud выше по дереву инструмент не уводит; образцы в строках будильника — как пустые", { skip }, () => {
  const box = sandbox({ lines: [`TGCLOUD_HEART_TOKEN=${TOKEN}`, `AI_PROVIDER_KEY=${KEYS.model}`, "HEART_BRANCH=work", "ALARM_BOT_TOKEN=токен тестового бота", "ALARM_CHAT_ID=числовой ID канала «Мост»"] });
  try {
    // Настоящий инструмент работает из ближайшей вверх папки с .tgcloud: такая могла остаться в домашней.
    mkdirSync(join(box.dir, ".tgcloud"));
    mkdirSync(join(box.home, ".tgcloud"));
    const check = box.run("check");
    assert.equal(check.code, 1);
    assert.match(check.out, /✗ ALARM_BOT_TOKEN не похож на токен бота/u);
    assert.match(check.out, /✗ ALARM_CHAT_ID не похож на ID канала/u);
    assert.match(check.out, /✓ платформа: токен принят/u);
    const done = box.run("once");
    assert.match(done.out, /Сборка 1\.0\.0 опубликована/u);
    const calls = box.cli();
    assert.ok(calls.every(item => !item.strayed), "и публикация, и удар идут из своих папок");
    assert.equal(names(calls).at(-1), "run:handlers/message:tick", "с образцом вместо токена будильник не стучится в Telegram, а идёт через платформу");
    assert.equal(calls.at(-1).inRepo, false);
    assert.equal(box.curl().length, 0);
    assert.equal(box.status(), "");
  } finally { box.clean(); }
});

test("проверка в соседнем окне не стирает ключи посреди публикации; второй дом рядом не запускается", { skip }, () => {
  const box = sandbox();
  try {
    const done = box.run("once", { FAKE_MEANWHILE: 'bash scripts/phone.sh check; bash scripts/phone.sh once; echo "код: $?"' });
    assert.match(box.meanwhile(), /Готово к работе/u);
    assert.match(box.meanwhile(), /Дом уже запущен \(процесс \d+\)\. Второй не нужен\./u);
    assert.match(box.meanwhile(), /код: 1/u);
    assert.match(done.out, /Сборка 1\.0\.0 опубликована/u);
    const calls = box.cli();
    const after = calls.slice(calls.findIndex(item => item.args[0] === "push"));
    assert.deepEqual(names(after), ["push handlers", "migrate --yes", "webhook", "run:handlers/message:deployed"]);
    assert.ok(after.every(item => item.key && item.giga), "ключи на месте: бот не уходит в облако пустым");
    assert.equal(box.status(), "");
  } finally { box.clean(); }
});

test("вечный цикл: публикует сразу, прошлые неудачи при запуске не в счёт, по Ctrl+C уходит чисто", { skip }, async () => {
  const box = sandbox();
  try {
    // Прошлый запуск трижды не смог; владелец поправил причину и запустил снова.
    for (let round = 0; round < 3; round += 1) box.run("once", { FAKE_FAIL: "fetch" });
    assert.match(box.state("failed"), /\n3\n/u);
    const done = await box.loop((out) => box.state("published") !== "" && box.state("alarm.msg") !== "" && /Сборка 1\.0\.0 опубликована/u.test(out));
    assert.match(done.out, /Дом запущен: ветка «work»/u);
    assert.match(done.out, /Сборка 1\.0\.0 опубликована/u);
    assert.equal(done.code, 0, "остановка — не ошибка");
    assert.ok(done.presses <= 3, `Ctrl+C останавливает с первого раза, в худшем случае — со второго (понадобилось ${done.presses})`);
    assert.ok(done.ms < 30_000, "и конца минуты не ждёт");
    assert.ok(!existsSync(join(box.home, ".heart/lock")), "замок снят");
    assert.equal(box.status(), "");
    assert.equal(box.run("once").code, 0, "следующему запуску ничто не мешает");
  } finally { box.clean(); }
});

test("секретарь: новые обработчики репетируются перед публикацией; «events» знает, что событие уже слушается", { skip }, () => {
  const box = sandbox();
  try {
    for (const name of ["callback_query", "business_connection", "business_message", "my_chat_member"]) writeFileSync(join(box.seed, `tgcloud/handlers/${name}.js`), "export default async function () {}\n");
    box.commit("1.1.0");
    const SUBSCRIBED = { FAKE_UPDATES: "message, channel_post, callback_query, business_connection, business_message, my_chat_member" };
    const first = box.run("once", SUBSCRIBED);
    assert.equal(first.code, 0, first.out);
    assert.match(first.out, /✓ Сборка 1\.1\.0 опубликована/u);
    assert.doesNotMatch(first.out, /не подписан/u);
    assert.deepEqual(names(box.cli()), [
      "webhook", "run:handlers/message", "run:handlers/channel_post", "run:handlers/callback_query", "run:handlers/business_connection", "run:handlers/business_message", "run:handlers/my_chat_member",
      "fetch", "push handlers", "migrate --yes", "webhook", "run:handlers/message:deployed",
    ]);
    // Репетиция — без побочных действий: обработчикам говорится, что это проба.
    for (const call of box.cli().filter(item => /business_|my_chat_member/u.test(item.args[1] ?? ""))) assert.ok(call.args.includes("{ testRun: true }"), call.args.join(" "));
    // Письмо секретарю на репетиции упало — публикации нет, бот на прежней сборке.
    box.commit("1.2.0");
    const broken = box.run("once", { FAKE_FAIL: "run:handlers/business_message" });
    assert.match(broken.out, /Не прошло: репетиция: письмо секретарю — публикации нет, бот на прежней сборке/u);
    assert.match(box.state("published"), /\n1\.1\.0\n/u);

    // Опубликовано, но подписка бота не обновилась: владелец узнаёт, каких событий нет.
    box.commit("1.3.0");
    const deaf = box.run("once", { FAKE_UPDATES: "message,channel_post,callback_query" });
    assert.match(deaf.out, /⚠ Бот не подписан на события: business_connection business_message my_chat_member — то, что на них держится/u);
    assert.match(box.state("published"), /\n1\.3\.0\n/u, "сборка при этом опубликована");
    assert.ok(box.curl().some(line => /не подписан на события: business_connection business_message my_chat_member/u.test(decodeURIComponent(line))), "и в Telegram владельцу — тоже");
    // Строки о подписке в ответе нет — проверять нечего, тревоги нет.
    box.commit("1.4.0");
    const blind = box.run("once", { FAKE_UPDATES: " " });
    assert.doesNotMatch(blind.out, /не подписан/u);

    // Событие уже слушается: в списке «ещё не написанных» его нет — и это не «платформа не умеет».
    const says = (text) => ({ FAKE_FAIL: "add", FAKE_SAYS: text });
    const listed = box.run("events", says('Error: Specify a name, e.g. "handlers/poll". Available handlers/ types: inline_query, poll.'));
    assert.match(listed.out, /\n {2}inline_query, poll\nСобытие business_message Аи уже слушает: «секретарь» в этой сборке есть\./u);
    assert.doesNotMatch(listed.out, /в списке нет/u);
    const full = box.run("events", says("Error: Every handlers/ module already exists."));
    assert.match(full.out, /Среди них business_message: «секретарь» в этой сборке есть\./u);
  } finally { box.clean(); }
});

test("«events»: спрашивает платформу о событиях, ничего не публикует; ответ — словами, токен не нужен", { skip }, () => {
  // Ответы — как у настоящего инструмента на «add handlers»: список ещё не написанных обработчиков.
  const says = (text) => ({ FAKE_FAIL: "add", FAKE_SAYS: text });
  const box = sandbox();
  try {
    const yes = box.run("events", says('\u001b[31mError: \u001b[39mSpecify a name, e.g. "handlers/business_connection". Available handlers/ types: business_connection, business_message, inline_query.'));
    assert.equal(yes.code, 0);
    assert.match(yes.out, /Платформа отдаёт ещё такие события \(кроме тех, что Аи уже слушает\):\n {2}business_connection, business_message, inline_query\nСобытие business_message есть — за «секретаря» можно браться\.\nПришлите эти строки в чат разработки\./u);
    assert.doesNotMatch(yes.out, /\u001b/u, "цвета терминала в чат не уходят");
    const no = box.run("events", says('Error: Specify a name, e.g. "handlers/inline_query". Available handlers/ types: inline_query, poll.'));
    assert.match(no.out, /\n {2}inline_query, poll\nСобытия business_message в списке нет/u);
    // Похожее имя — не то же самое.
    const near = box.run("events", says('Error: Specify a name, e.g. "handlers/poll". Available handlers/ types: deleted_business_messages, edited_business_message.'));
    assert.match(near.out, /События business_message в списке нет/u);
    const full = box.run("events", says("Error: Every handlers/ module already exists."));
    assert.match(full.out, /только те события, которые Аи уже слушает\. События business_message среди них нет/u);
    const vague = box.run("events", says('Error: Specify a name, e.g. "handlers/<name>".'));
    assert.match(vague.out, /Списка событий платформа не прислала\. Её ответ:\n {2}Error: Specify a name, e\.g\. "handlers\/<name>"\.\nПришлите эти строки/u);
    const calls = box.cli();
    assert.deepEqual(calls.map(item => item.args.join(" ")), Array(5).fill("add handlers"), "только вопрос: ни публикации, ни запуска");
    assert.ok(calls.every(item => !item.key && !item.giga), "ключей в слепке нет");
    assert.equal(box.status(), "");
    assert.ok(!existsSync(join(box.home, ".heart/lock")), "замок не берётся: спрашивать можно рядом с работающим домом");
    assert.doesNotMatch(`${yes.out}${no.out}${near.out}${full.out}${vague.out}`, new RegExp(`${TOKEN.split(":")[1]}|${KEYS.model}`, "u"));
  } finally { box.clean(); }
  // Список у платформы открытый: без токена публикации вопрос тоже задаётся.
  const blind = sandbox({ lines: ["HEART_BRANCH=work"] });
  try {
    const asked = blind.run("events", says('Error: Specify a name, e.g. "handlers/poll". Available handlers/ types: business_message, poll.'));
    assert.equal(asked.code, 0);
    assert.match(asked.out, /Событие business_message есть/u);
    assert.deepEqual(blind.cli().map(item => [item.args.join(" "), item.token]), [["add handlers", false]]);
  } finally { blind.clean(); }
});

test("будильник голосом самой Аи: себя она не услышит — сказано прямо, удар идёт через платформу", { skip }, () => {
  // Номер бота в токене будильника тот же, что в токене публикации (app123): это один бот.
  const box = sandbox({ lines: [`TGCLOUD_HEART_TOKEN=${TOKEN}`, `AI_PROVIDER_KEY=${KEYS.model}`, "HEART_BRANCH=work", "ALARM_BOT_TOKEN=123:OWN-BOT-SECRET", "ALARM_CHAT_ID=-100"] });
  try {
    const check = box.run("check");
    assert.equal(check.code, 1);
    assert.match(check.out, /✗ будильник: @voice_bot — это сама Аи \(тот же бот, что публикуется\): себя она не услышит/u);
    assert.doesNotMatch(check.out, /✓ будильник/u);
    const done = box.run("once");
    assert.match(done.out, /Сборка 1\.0\.0 опубликована/u);
    assert.equal(names(box.cli()).at(-1), "run:handlers/message:tick", "будит платформа, а не канал");
    assert.ok(!box.curl().some(line => /sendMessage|editMessageText/u.test(line) && line.includes("chat_id=-100")), "в канал от её же имени никто не пишет");
    // Другой бот — другое дело: минутный будильник через канал.
    box.keys([`TGCLOUD_HEART_TOKEN=${TOKEN}`, `AI_PROVIDER_KEY=${KEYS.model}`, "HEART_BRANCH=work", `ALARM_BOT_TOKEN=${KEYS.voice}`, "ALARM_CHAT_ID=-100"]);
    assert.match(box.run("check").out, /✓ будильник: раз в 60 с от имени @voice_bot/u);
    box.run("once");
    assert.ok(box.curl().some(line => line.includes("sendMessage") && line.includes("chat_id=-100")));
  } finally { box.clean(); }
});

// ── 0.36.3: код в облако — копией и без комментариев; телефон сам выясняет, что не так ──
// 17.11.2026 сборки 0.36.0–0.36.2 не опубликовались девять раз из девяти: отправка всего кода одним
// запросом обрывалась, телефон говорил «нет связи с платформой», хотя связь была (docs/JOURNAL.md, «Сообщение 31»).
const CUT = "✗ Could not reach the tgcloud server at https://cloud.telegram.org. Check your connection (or the TG_CLOUD_API_URL setting).";
const ticks = (box) => box.curl().filter(line => /sendMessage|editMessageText/u.test(line) && line.includes("chat_id=-100"));

test("сборка без скрипта облегчения (до 0.36.3) публикуется как есть — из копии, с комментариями", { skip }, () => {
  const box = sandbox({ slim: false });
  try {
    const done = box.run("once");
    assert.match(done.out, /Сборка 1\.0\.0 опубликована/u);
    assert.doesNotMatch(done.out, /Код для облака|убрать не вышло/u);
    const sent = box.cli().filter(item => item.where === "stage");
    assert.ok(sent.length >= 5 && sent.every(item => item.key && !item.slim));
    assert.equal(box.status(), "");
  } finally { box.clean(); }
});

test("связи с платформой нет: тесты не гоняются, попытка не считается; владелец узнаёт через четверть часа и один раз", { skip }, () => {
  const box = sandbox();
  try {
    const offline = { FAKE_FAIL: "webhook", FAKE_SAYS: CUT, HEART_TESTS: "on" };
    const first = box.run("once", offline);
    assert.match(first.out, /Платформа Telegram \(cloud\.telegram\.org\) не отвечает — публикация подождёт связи\. Бот на прежней сборке\./u);
    assert.doesNotMatch(first.out, /Публикую|Проверяю сборку тестами|Не прошло/u);
    assert.deepEqual(names(box.cli()), ["webhook"], "ушёл один малый запрос");
    assert.match(box.state("deploy.log"), /Could not reach the tgcloud server/u, "что ответил инструмент — в журнале телефона");
    assert.equal(box.ci(), "", "тесты не запускались");
    assert.equal(box.state("failed"), "", "это не неудача сборки: счёт попыток не тронут");
    const told = () => box.curl().filter(line => line.includes("chat_id=42"));
    assert.equal(told().length, 0, "о минутной заминке владельцу не пишут");
    // Сколько бы раз ни повторилось — счёта нет, и через час ждать не придётся.
    for (let round = 0; round < 4; round += 1) box.run("once", offline);
    assert.equal(box.state("failed"), "");
    assert.equal(told().length, 0);
    // Связи нет уже четверть часа: одна весть — подписанная.
    const [commit] = box.state("waiting").split("\n");
    writeFileSync(join(box.home, ".heart/waiting"), `${commit}\n${Math.floor(Date.now() / 1000) - 1000}\n0\n`);
    box.run("once", offline);
    box.run("once", offline);
    assert.equal(told().length, 1);
    assert.match(decodeURIComponent(told()[0]), /text=⚠️ Телефон: сборку 1\.0\.0 пока не опубликовать — уже четверть часа нет связи с платформой Telegram\. Повторю сам/u);
    // Связь вернулась: публикация идёт, как будто ничего не было.
    const back = box.run("once", { HEART_TESTS: "on" });
    assert.match(back.out, /Проверяю сборку тестами/u);
    assert.match(back.out, /Сборка 1\.0\.0 опубликована/u);
    assert.equal(box.state("waiting"), "");
  } finally { box.clean(); }
});

test("отправка кода оборвалась: телефон сам выясняет — связь это, сама сборка или платформа", { skip }, () => {
  const box = sandbox();
  try {
    // Слепка ещё нет (ничего не публиковалось): малый запрос проходит — значит, связь есть, а код не проходит.
    const cold = box.run("once", { FAKE_FAIL: "run:handlers/message", FAKE_SAYS: CUT });
    assert.match(cold.out, /Не прошло: репетиция: сообщение — публикации нет, бот на прежней сборке\. Причина: связь есть, а отправку кода \(\d+ КБ\) платформа обрывает\. Подробности/u);
    // Обрыв бывает минутным: шаг повторён один раз, потом — малый запрос.
    assert.deepEqual(names(box.cli()), ["webhook", "run:handlers/message", "run:handlers/message", "webhook"]);
    assert.match(box.state("failed"), /\n1\n/u, "это неудача: сама она не пройдёт");
    const told = () => box.curl().filter(line => line.includes("chat_id=42")).map(line => decodeURIComponent(line));
    assert.match(told().at(-1), /Телефон: сборка 1\.0\.0 не опубликована — репетиция: сообщение\. Причина: связь есть, а отправку кода \(\d+ КБ\) платформа обрывает\. Аи осталась на прежней сборке\./u);
    assert.ok(!existsSync(join(box.home, ".heart/stage")), "копия с ключами убрана и после неудачи");

    // Одна сборка опубликована — есть слепок, и есть с чем сравнить.
    assert.match(box.run("deploy").out, /Сборка 1\.0\.0 опубликована/u);
    box.commit("1.1.0");
    let before = box.cli().length;
    // Новая сборка не проходит, а прежняя — проходит: дело в самой сборке.
    const guilty = box.run("once", { FAKE_FAIL: "run:handlers/message", FAKE_FAIL_IN: "stage", FAKE_SAYS: CUT });
    assert.match(guilty.out, /Причина: связь есть, и прежняя сборка в облаке репетируется, а эта \(\d+ КБ\) — нет: дело в самой сборке\./u);
    const probe = box.cli().slice(before);
    assert.deepEqual(names(probe), ["webhook", "run:handlers/message", "run:handlers/message", "webhook", "run:handlers/message"]);
    assert.deepEqual([probe.at(-1).where, probe.at(-1).key, probe.at(-1).args.includes("{ testRun: true }")], ["live", true, true], "контрольная репетиция — опубликованным кодом, с ключами и без побочных действий");
    assert.ok(!readFileSync(join(box.home, ".heart/live/tgcloud/lib/secrets.js"), "utf8").includes(KEYS.model), "ключ в слепке — только на время репетиции");
    assert.match(told().at(-1), /сборка 1\.1\.0 не опубликована — репетиция: сообщение\. Причина: связь есть, и прежняя сборка в облаке репетируется/u);
    assert.match(box.state("published"), /\n1\.0\.0\n/u);

    // Не проходит и прежняя: платформа сейчас не берёт никакой код — сборка ни при чём.
    box.commit("1.2.0");
    const anyone = box.run("once", { FAKE_FAIL: "run:handlers/message", FAKE_SAYS: CUT });
    assert.match(anyone.out, /Причина: связь есть, но платформа сейчас обрывает отправку любого кода — и прежней сборки тоже: дело не в этой сборке\./u);

    // Связь пропала посреди отправки: малый запрос тоже не проходит. Это не неудача сборки — и не повод ждать час.
    box.commit("1.3.0");
    before = box.cli().length;
    const lost = box.run("once", { FAKE_FAIL: "run:handlers/message,webhook", FAKE_FAIL_FROM: String(before + 2), FAKE_SAYS: CUT });
    assert.match(lost.out, /Платформа Telegram \(cloud\.telegram\.org\) не отвечает — публикация подождёт связи/u);
    assert.doesNotMatch(lost.out, /Не прошло/u);
    assert.deepEqual(names(box.cli().slice(before)), ["webhook", "run:handlers/message", "run:handlers/message", "webhook"]);
    assert.doesNotMatch(box.state("failed"), new RegExp(`^${box.head()}`, "u"), "попытка не засчитана");
    assert.match(box.run("once").out, /Сборка 1\.3\.0 опубликована/u);
  } finally { box.clean(); }
});

test("платформа молчит: запрос снимается по сроку, дом не висит; ключи из ответа платформы на экран не попадают", { skip }, () => {
  const box = sandbox();
  try {
    const started = Date.now();
    const hung = box.run("once", { FAKE_HANG: "run:handlers/message", HEART_CALL_LIMIT: "5" });
    const took = Date.now() - started;
    assert.ok(took >= 9_000 && took < 45_000, `два ожидания по пять секунд (шаг и его повтор), а не вечность: ${took} мс`);
    assert.match(box.state("deploy.log"), /✗ Платформа не ответила за 5 с — запрос снят\./u);
    assert.match(hung.out, /Не прошло: репетиция: сообщение — публикации нет, бот на прежней сборке\. Причина: связь есть, а отправку кода \(\d+ КБ\) платформа обрывает\./u);
    assert.ok(!existsSync(join(box.home, ".heart/stage")));
    // Обычная ошибка кода: её строки печатаются, а значения ключей в них заменены.
    rmSync(join(box.home, ".heart/failed"));
    const leaky = box.run("once", { FAKE_FAIL: "run:handlers/channel_post", FAKE_SAYS: `✗ ReferenceError: x is not defined (key ${KEYS.model}, token ${TOKEN}, url https://secret.example/hook)\n✗ Module lib/heart failed with ${KEYS.giga}` });
    assert.match(leaky.out, /✗ Module lib\/heart failed with \*\*\*/u);
    for (const secret of [TOKEN, TOKEN.split(":")[1], ...Object.values(KEYS), "secret.example"]) assert.ok(!leaky.out.includes(secret), secret);
  } finally { box.clean(); }
});

test("тесты одного коммита гоняются один раз: повторная попытка — сразу к отправке", { skip }, () => {
  const box = sandbox();
  try {
    const first = box.run("once", { HEART_TESTS: "on", FAKE_FAIL: "run:handlers/channel_post" });
    assert.match(first.out, /Проверяю сборку тестами/u);
    assert.notEqual(box.ci(), "");
    assert.equal(box.state("tested").trim(), box.head());
    rmSync(`${join(box.dir, "cli.log")}.ci`);
    const second = box.run("once", { HEART_TESTS: "on" });
    assert.match(second.out, /Тесты этой сборки здесь уже прошли — второй раз не гоняю\./u);
    assert.doesNotMatch(second.out, /Проверяю сборку тестами/u);
    assert.equal(box.ci(), "", "тесты второй раз не запускались");
    assert.match(second.out, /Сборка 1\.0\.0 опубликована/u);
    // Новый коммит — новые тесты.
    box.commit("1.1.0");
    assert.match(box.run("once", { HEART_TESTS: "on" }).out, /Проверяю сборку тестами/u);
    // Упавшие тесты отметки не оставляют: следующая попытка гоняет их снова.
    box.commit("1.2.0");
    box.run("once", { HEART_TESTS: "on", FAKE_CI: "1" });
    assert.notEqual(box.state("tested").trim(), box.head());
  } finally { box.clean(); }
});

test("пока идёт публикация, будильник бьёт: удары в канал на это время шлёт помощник", { skip }, () => {
  const box = sandbox();
  try {
    // Публикация длится дольше периода будильника (20 с): внутри неё точно есть начало периода.
    const done = box.run("once", { ALARM_EVERY: "20", FAKE_SLOW: "fetch:21" });
    assert.match(done.out, /Сборка 1\.0\.0 опубликована/u);
    assert.ok(ticks(box).length >= 2, `удар во время публикации и удар после неё: ${ticks(box).length}`);
    assert.equal(box.state("alarm.msg").trim(), "77", "сообщение в канале одно: оно правится");
    // Без второго бота помощника нет: будильник через платформу шлёт весь код, вдвоём с публикацией ему не место.
    const alone = sandbox({ lines: [`TGCLOUD_HEART_TOKEN=${TOKEN}`, `AI_PROVIDER_KEY=${KEYS.model}`, "HEART_BRANCH=work"] });
    try {
      alone.run("once");
      assert.equal(names(alone.cli()).filter(name => name === "run:handlers/message:tick").length, 1, "один удар — после публикации");
    } finally { alone.clean(); }
  } finally { box.clean(); }
});

test("публикация руками держит телефон бодрым: замок от сна берётся и отпускается", { skip }, () => {
  const box = sandbox();
  try {
    const bin = join(box.dir, "bin"), woke = join(box.dir, "wake.log");
    for (const name of ["termux-wake-lock", "termux-wake-unlock"]) {
      writeFileSync(join(bin, name), `#!/usr/bin/env bash\necho ${name} >> "${woke}"\n`);
      chmodSync(join(bin, name), 0o755);
    }
    const done = box.run("deploy");
    assert.match(done.out, /Сборка 1\.0\.0 опубликована/u);
    assert.deepEqual(readFileSync(woke, "utf8").trim().split("\n"), ["termux-wake-lock", "termux-wake-unlock"]);
  } finally { box.clean(); }
});

test("0.67.0: схема базы — шаг повторяется; в вести владельцу — причина, а не одно «не применилась»", { skip }, () => {
  const migrations = (box) => box.cli().filter(item => item.args[0] === "migrate").length;
  // 1. Обрыв связи на шаге схемы дважды, третья попытка проходит: публикация чистая, владельцу — ни слова.
  let box = sandbox();
  try {
    const done = box.run("once", { FAKE_FAIL_TIMES: "migrate:2", FAKE_SAYS: "Error: Could not reach the platform" });
    assert.equal(done.code, 0, done.out);
    assert.equal(migrations(box), 3);
    assert.match(done.out, /✓ Сборка 1\.0\.0 опубликована/u);
    assert.doesNotMatch(done.out, /схем/u);
    assert.equal(toldOwner(box).length, 0);
  } finally { box.clean(); }

  // 2. Платформа отказывает словами: две попытки, в вести — её ответ. Схема в первой публикации — новая.
  box = sandbox();
  try {
    const done = box.run("once", { FAKE_FAIL: "migrate", FAKE_SAYS: "Error: column kv_state.value cannot be altered" });
    assert.equal(done.code, 0, done.out);
    assert.equal(migrations(box), 2);
    assert.match(done.out, /Сборка 1\.0\.0 опубликована, но схема базы не применилась \(ответ платформы: «Error: column kv_state\.value cannot be altered»\); перешлите эту строку в чат разработки\./u);
    assert.equal(toldOwner(box).length, 1);
    assert.match(toldOwner(box)[0], /text=⚠️ Телефон: сборка 1\.0\.0 опубликована, но схема базы не применилась \(ответ платформы: «Error: column kv_state\.value cannot be altered»\)/u);
    assert.match(box.state("published"), /\n1\.0\.0\n/u);
  } finally { box.clean(); }

  // 3. Связи нет все три попытки, а схема та же, что в прежней публикации: слова спокойные — таблицы не менялись.
  box = sandbox();
  try {
    assert.equal(box.run("once").code, 0);
    assert.equal(toldOwner(box).length, 0);
    box.commit("2.0.0");
    const done = box.run("once", { FAKE_FAIL: "migrate", FAKE_SAYS: "Error: Could not reach the platform" });
    assert.equal(done.code, 0, done.out);
    assert.equal(migrations(box), 1 + 3);
    assert.match(done.out, /Сборка 2\.0\.0 опубликована, но схему базы сверить не вышло \(нет связи с платформой, попыток: 3\); таблицы в этой сборке не менялись — бот работает на прежних, следующая публикация сверит снова\./u);
    assert.doesNotMatch(done.out, /не применилась/u);
    assert.equal(toldOwner(box).length, 1);
    assert.match(box.state("published"), /\n2\.0\.0\n/u);
  } finally { box.clean(); }
});
