/**
 * Профиль бота (0.35.0): строка «О себе» и описание на стартовой странице. Слова лежат в коде,
 * умещаются в пределы Telegram, и ставит она их сама — по слову хозяина.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, reset, last, calls, chats, says, sdk, withSister, OWNER, KEY } from "./fixtures/kit.mjs";

const { profileWish, PROFILE_ABOUT, PROFILE_TEXT, ABOUT_MAX, TEXT_MAX } = await import("../tgcloud/lib/profile.js");
const own = (text) => message(text, { id: OWNER });

test("профиль: слова умещаются в пределы Telegram; разбор — «оформи профиль», «покажи свой профиль»", () => {
  assert.ok(PROFILE_ABOUT.length <= ABOUT_MAX, `«О себе» — ${PROFILE_ABOUT.length} знаков`);
  assert.ok(PROFILE_TEXT.length <= TEXT_MAX, `описание — ${PROFILE_TEXT.length} знаков`);
  assert.doesNotMatch(`${PROFILE_ABOUT}\n${PROFILE_TEXT}`, /хозяин/iu, "эти слова читают все");
  for (const said of ["оформи профиль", "Оформи свой профиль!", "обнови описание", "поставь описание бота", "заполни профиль"]) assert.deepEqual(profileWish(said), { set: true }, said);
  for (const said of ["покажи свой профиль", "покажи описание бота", "какое у тебя описание?"]) assert.deepEqual(profileWish(said), { show: true }, said);
  // «Покажи профиль» и «мой профиль» — карточка самого человека (её ведёт сестра): эти слова не о профиле бота.
  for (const said of ["покажи профиль", "покажи мой профиль", "оформи мой профиль", "покажи описание"]) assert.equal(profileWish(said), null, said);
  for (const said of ["профиль", "оформи заказ", "покажи мой профиль в игре", "обнови описание товара на сайте", "мой профиль"]) assert.equal(profileWish(said), null, said);
  // 0.36.0: те же вопросы другими словами; «поменяй описание» и картинки — отдельные ответы, а не модель и не поиск картинок.
  for (const said of ["твой профиль", "что у тебя в профиле?", "что написано в твоём профиле", "профиль бота", "ты оформила профиль?", "профиль оформлен?", "проверь свой профиль"]) assert.deepEqual(profileWish(said), { show: true }, said);
  for (const said of ["оформи себя", "установи описание"]) assert.deepEqual(profileWish(said), { set: true }, said);
  for (const said of ["поменяй описание", "измени свой профиль", "перепиши описание бота"]) assert.deepEqual(profileWish(said), { change: true }, said);
  for (const said of ["поставь аватарку", "смени аву", "поставь стартовую картинку", "покажи приветственную картинку", "поставь картинку профиля", "какая у тебя аватарка?"]) assert.deepEqual(profileWish(said), { picture: true }, said);
  for (const said of ["поставь картинку", "покажи картинку кота", "поменяй описание товара", "где картинка", "смени тему"]) assert.equal(profileWish(said), null, said);
  // «Покажи профиль» без «свой» — двусмысленно: с `loose` разбор его отдаёт, а чьи это слова, решает сердце (0.36.0).
  for (const said of ["покажи профиль", "профиль", "Открой профиль!"]) assert.deepEqual(profileWish(said, { loose: true }), { show: true, loose: true }, said);
  for (const said of ["мой профиль", "покажи мой профиль", "профиль Васи"]) assert.equal(profileWish(said, { loose: true }), null, said);
});

test("«покажи профиль» от хозяина: после слов о её профиле — её профиль; сестры нет или молчит — тоже, а не отказ", async () => {
  // Так было на скриншоте 17.11.2026: «оформи профиль» → «покажи профиль» → «это умение Юи… не выполню».
  reset();
  let at = Date.parse("2026-11-18T09:00:00Z");
  const { h } = withSister({ alive: false, options: { now: () => at } });
  await h.onMessage(own("оформи профиль"), KEY);
  await h.onMessage(own("покажи профиль"), KEY);
  assert.match(last(OWNER), /^О себе:\nАи — собеседница с характером/u, "речь только что шла о её профиле");
  assert.doesNotMatch(last(OWNER), /не выполню|недоступна/u);
  // Через час контекста уже нет, а сестра молчит: хозяин получает профиль Аи со словом о том, чьё это дело.
  at += 3_600_000;
  await h.onMessage(own("покажи профиль"), KEY);
  assert.match(last(OWNER), /^Карточки людей ведёт Юи — здесь её сейчас нет\. А мой профиль — вот\.\n\nО себе:\n/u);
  // «Мой профиль» — карточка человека: без сестры её нет, и это говорится прямо.
  await h.onMessage(own("мой профиль"), KEY);
  assert.doesNotMatch(last(OWNER), /О себе:/u);
  // Гостю «покажи профиль» — по-прежнему умение сестры.
  await h.onMessage(message("покажи профиль"), KEY);
  assert.doesNotMatch(last(), /О себе:/u);
  assert.equal(chats().length, 0, "модель о профиле не спрашивают");

  // Моста нет вовсе — то же самое.
  reset();
  const alone = heart({}, { now: () => at });
  await alone.onMessage(own("покажи профиль"), KEY);
  assert.match(last(OWNER), /^Карточки людей ведёт Юи — здесь её сейчас нет\. А мой профиль — вот\./u);
});

test("сестра на месте, но карточек в этом чате не ведёт — хозяину её профиль, гостю — прежние слова; «покажи свой профиль» говорит, что стоит в Telegram", async () => {
  reset();
  const at = Date.parse("2026-11-18T09:00:00Z");
  const { h, posts } = withSister({ alive: true, options: { now: () => at } });
  await h.onMessage(own("покажи профиль"), KEY);
  assert.deepEqual(posts.map(item => item.tool), ["__catalog"], "сестру спросили, что она здесь умеет");
  assert.match(last(OWNER), /^Карточки людей ведёт Юи — здесь её сейчас нет\. А мой профиль — вот\./u);
  await h.onMessage(message("покажи профиль"), KEY);
  assert.equal(last(), "Профиль умеет Юи, но её нет в этом чате — добавьте её в группу, и всё заработает.");

  reset();
  const alone = heart({}, { now: () => at });
  // Telegram отдаёт то же, что лежит в коде, — «стоит именно это».
  sdk().apiReplies.getMyShortDescription = { short_description: PROFILE_ABOUT };
  sdk().apiReplies.getMyDescription = { description: PROFILE_TEXT };
  await alone.onMessage(own("покажи свой профиль"), KEY);
  assert.match(last(OWNER), /В Telegram сейчас стоит именно это\./u);
  // Там другое — сказано, как поставить.
  sdk().apiReplies.getMyDescription = { description: "Старое описание." };
  await alone.onMessage(own("покажи свой профиль"), KEY);
  assert.match(last(OWNER), /В Telegram сейчас стоит другое\. Поставить эти слова — «оформи профиль»\./u);
  // Пусто.
  sdk().apiReplies.getMyShortDescription = { short_description: "" };
  sdk().apiReplies.getMyDescription = { description: "" };
  await alone.onMessage(own("покажи свой профиль"), KEY);
  assert.match(last(OWNER), /В Telegram сейчас пусто/u);
  // Спросить не вышло — как раньше.
  sdk().failing.getMyDescription = new Error("Bad Request");
  await alone.onMessage(own("покажи свой профиль"), KEY);
  assert.match(last(OWNER), /Поставить — «оформи профиль»\./u);

  // Картинки и сами слова — не её руками: честный ответ, без модели, без поиска картинок и без вызовов Telegram.
  const before = calls("setMyDescription").length;
  await alone.onMessage(own("поставь аватарку"), KEY);
  assert.match(last(OWNER), /^Картинки я себе ставить не умею — это делает человек\. Стартовая \(640×360\): в настройках бота — «Set Welcome Picture»/u);
  await alone.onMessage(own("поменяй описание"), KEY);
  assert.match(last(OWNER), /^Сами слова я менять не умею: они записаны в моём коде.*\n\nО себе:\n/su);
  assert.equal(calls("setMyDescription").length, before);
  assert.equal(chats().length, 0);
});

test("«оформи профиль»: ставит себе «О себе» и описание сама; отказ Telegram — отдаёт слова; гостю и при всех — обычные слова", async () => {
  reset();
  const h = heart({}, { now: () => Date.parse("2026-11-18T09:00:00Z") });
  await h.onMessage(own("оформи профиль"), KEY);
  assert.deepEqual(calls("setMyShortDescription"), [{ short_description: PROFILE_ABOUT }]);
  assert.deepEqual(calls("setMyDescription"), [{ description: PROFILE_TEXT }]);
  assert.match(last(OWNER), /^Готово, хозяин: строка «О себе» и описание на стартовой странице стоят\.\n\nО себе:\n.*Set Welcome Picture/su);
  await h.onMessage(own("покажи свой профиль"), KEY);
  assert.match(last(OWNER), /^О себе:\nАи — собеседница с характером/u);
  assert.equal(calls("setMyDescription").length, 1, "«покажи» ничего не ставит");
  // Telegram отказал — слова отдаются для вставки руками.
  sdk().failing.setMyDescription = new Error("Bad Request: too long");
  await h.onMessage(own("оформи профиль"), KEY);
  assert.match(last(OWNER), /^Не вышло: Telegram отказал \(Bad Request: too long\)\. Слова можно вставить руками/u);
  delete sdk().failing.setMyDescription;
  // Гостю и при всех — обычные слова: решает модель.
  sdk().fetchQueue.push(says("Это не ко мне."), says("Не здесь."));
  await h.onMessage(message("оформи профиль"), KEY);
  assert.equal(last(), "Это не ко мне.");
  await h.onMessage(group("Аи, оформи профиль", { id: OWNER }), KEY);
  assert.equal(chats().length, 2);
  assert.equal(calls("setMyDescription").length, 2);
});
