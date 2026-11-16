/**
 * Профиль бота (0.35.0): строка «О себе» и описание на стартовой странице. Слова лежат в коде,
 * умещаются в пределы Telegram, и ставит она их сама — по слову хозяина.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, reset, last, calls, chats, says, sdk, OWNER, KEY } from "./fixtures/kit.mjs";

const { profileWish, PROFILE_ABOUT, PROFILE_TEXT, ABOUT_MAX, TEXT_MAX } = await import("../tgcloud/lib/profile.js");
const own = (text) => message(text, { id: OWNER });

test("профиль: слова умещаются в пределы Telegram; разбор — «оформи профиль», «покажи профиль»", () => {
  assert.ok(PROFILE_ABOUT.length <= ABOUT_MAX, `«О себе» — ${PROFILE_ABOUT.length} знаков`);
  assert.ok(PROFILE_TEXT.length <= TEXT_MAX, `описание — ${PROFILE_TEXT.length} знаков`);
  assert.doesNotMatch(`${PROFILE_ABOUT}\n${PROFILE_TEXT}`, /хозяин/iu, "эти слова читают все");
  for (const said of ["оформи профиль", "Оформи свой профиль!", "обнови описание", "поставь описание бота", "заполни профиль"]) assert.deepEqual(profileWish(said), { set: true }, said);
  for (const said of ["покажи профиль", "покажи описание", "какое у тебя описание?"]) assert.deepEqual(profileWish(said), { show: true }, said);
  for (const said of ["профиль", "оформи заказ", "покажи мой профиль в игре", "обнови описание товара на сайте", "мой профиль"]) assert.equal(profileWish(said), null, said);
});

test("«оформи профиль»: ставит себе «О себе» и описание сама; отказ Telegram — отдаёт слова; гостю и при всех — обычные слова", async () => {
  reset();
  const h = heart({}, { now: () => Date.parse("2026-11-18T09:00:00Z") });
  await h.onMessage(own("оформи профиль"), KEY);
  assert.deepEqual(calls("setMyShortDescription"), [{ short_description: PROFILE_ABOUT }]);
  assert.deepEqual(calls("setMyDescription"), [{ description: PROFILE_TEXT }]);
  assert.match(last(OWNER), /^Готово, хозяин: строка «О себе» и описание на стартовой странице стоят\.\n\nО себе:\n.*Set Welcome Picture/su);
  await h.onMessage(own("покажи профиль"), KEY);
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
