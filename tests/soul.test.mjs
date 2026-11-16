/**
 * Резервная копия души: файл хозяину, восстановление его же словом.
 * В копию идёт нажитое, а не служебное; из файла берётся только душа.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { heart, message, group, reset, sdk, says, calls, chats, last, KEY, OWNER, BUILD } from "./fixtures/kit.mjs";

const { parseSoul, utf8, SOUL_PREFIXES } = await import("../tgcloud/lib/soul.js");

const NOON = Date.UTC(2026, 10, 12, 13, 0);

test("разбор: копию просят и возвращают словами; байты читаются и без TextDecoder", () => {
  for (const save of ["резервная копия", "Сделай резервную копию души", "копия души", "бэкап", "пришли бэкап души"]) assert.equal(parseSoul(save), "save", save);
  for (const load of ["восстанови душу", "Восстанови из копии!", "загрузи копию души"]) assert.equal(parseSoul(load), "load", load);
  for (const no of ["копия паспорта", "восстанови пароль", "душа болит", "привет"]) assert.equal(parseSoul(no), null, no);
  const text = "Аи помнит: чай 🍵, «ёлка», naïve — 100 ₽";
  const bytes = new TextEncoder().encode(text);
  assert.equal(utf8(bytes), text);
  const Decoder = globalThis.TextDecoder;
  try { globalThis.TextDecoder = undefined; assert.equal(utf8(bytes), text, "своя расшифровка"); } finally { globalThis.TextDecoder = Decoder; }
});

test("копия души: файл получает только хозяин и только в личке; в нём нажитое, без служебного", async () => {
  reset();
  const h = heart({}, { now: () => NOON });
  await h.onMessage(message("запомни, я люблю зелёный чай"), KEY);
  await h.onMessage(message("список покупок: молоко, хлеб"), KEY);
  await h.onMessage(message("привычка: зарядка"), KEY);
  await h.onMessage(group("Аи, счёт: Петя 1, Маша 2"), KEY);
  await h.onMessage(message("правило: отвечай короче", { id: OWNER }), KEY);
  sdk().kv.set("heart:build", JSON.stringify({ build: "0.1.0", at: 1 }));

  // Постороннему и в группе — это просто слова.
  sdk().fetchQueue.push(says("Копию чего?"), says("Не при всех."));
  await h.onMessage(message("резервная копия"), KEY);
  assert.equal(last(), "Копию чего?");
  await h.onMessage(group("Аи, резервная копия", { id: OWNER }), KEY);
  assert.equal(last(-10), "Не при всех.");
  assert.equal(calls("sendDocument").length, 0);

  const done = await h.onMessage(message("резервная копия", { id: OWNER }), KEY);
  assert.equal(done.action, "soul_saved");
  const [sent] = calls("sendDocument");
  assert.equal(sent.chat_id, OWNER);
  assert.equal(sent.document.name, "ai-soul-2026-11-12.json");
  assert.equal(sent.document.type, "application/json");
  assert.match(sent.caption, new RegExp(`^Копия души: записей — ${done.count}, сборка ${BUILD.replaceAll(".", "\\.")}\\. Вернуть — прислать мне этот файл с подписью «восстанови душу»\\.$`, "u"));
  const soul = JSON.parse(utf8(sent.document.bytes));
  assert.deepEqual({ soul: soul.soul, build: soul.build, at: soul.at }, { soul: 1, build: BUILD, at: NOON });
  const keys = Object.keys(soul.keys);
  assert.equal(keys.length, done.count);
  for (const key of keys) assert.ok(SOUL_PREFIXES.some(prefix => key.startsWith(prefix)), key);
  for (const wanted of ["heart:facts:5", "heart:lists:5", "heart:habits:5", "heart:score:-10", "heart:lessons:v1"]) assert.ok(keys.includes(wanted), wanted);
  assert.ok(!keys.includes("heart:build") && !keys.some(key => key.startsWith("heart:pulse:")), "служебное в копию не идёт");
  assert.match(JSON.stringify(soul.keys["heart:facts:5"]), /люблю зелёный чай/u);
  assert.equal(chats().length, 2, "сама копия — без модели");
});

test("восстановление: из файла берётся только душа; чужой файл и просьба без файла — честный отказ", async () => {
  reset();
  const h = heart({}, { now: () => NOON });
  await h.onMessage(message("запомни, я люблю зелёный чай"), KEY);
  await h.onMessage(message("резервная копия", { id: OWNER }), KEY);
  const soul = JSON.parse(utf8(calls("sendDocument")[0].document.bytes));
  // В файл вписали лишнее — оно не должно попасть в базу.
  soul.keys["heart:build"] = { build: "9.9.9", at: 1 };
  soul.keys["heart:quota:2026-11-12:5"] = { n: 0 };
  soul.keys["heart:style:77"] = "не объект";
  const bytes = new TextEncoder().encode(JSON.stringify(soul));

  reset();
  const fresh = heart({}, { now: () => NOON + 86_400_000 });
  await fresh.onMessage(message("восстанови душу", { id: OWNER }), KEY);
  assert.match(last(OWNER), /^Из чего восстановить\? Пришлите файл копии с подписью «восстанови душу»/u);
  // Не хозяин с тем же файлом — это разговор, а не восстановление.
  sdk().apiReplies.getFileContent = bytes;
  sdk().fetchQueue.push(says("Не понимаю."));
  await fresh.onMessage(message(null, { extra: { document: { file_id: "f1", file_name: "ai-soul.json" }, caption: "восстанови душу" } }), KEY);
  assert.equal(last(), "Не понимаю.");
  assert.equal(sdk().kv.has("heart:facts:5"), false);

  await fresh.onMessage(message(null, { id: OWNER, extra: { document: { file_id: "f1", file_name: "ai-soul.json" }, caption: "восстанови душу" } }), KEY);
  assert.match(last(OWNER), /^Восстановила: записей — \d+, пропущено как не относящееся к душе — 3\. Копия от 12\.11\.2026, сборка /u);
  assert.match(sdk().kv.get("heart:facts:5"), /люблю зелёный чай/u);
  assert.equal(sdk().kv.has("heart:quota:2026-11-12:5"), false);
  assert.equal(sdk().kv.has("heart:style:77"), false);
  assert.doesNotMatch(String(sdk().kv.get("heart:build") ?? ""), /9\.9\.9/u, "сборку из файла не берёт");
  // Память вернулась: она снова знает о чае.
  await fresh.onMessage(message("что ты обо мне помнишь"), KEY);
  assert.match(last(), /люблю зелёный чай/u);

  sdk().apiReplies.getFileContent = new TextEncoder().encode("{\"keys\":{}}");
  await fresh.onMessage(message(null, { id: OWNER, extra: { document: { file_id: "f2" }, caption: "восстанови душу" } }), KEY);
  assert.equal(last(OWNER), "Это не копия души: файл не разобрать или он не мой.");
  sdk().failing.getFileContent = new Error("400");
  await fresh.onMessage(message(null, { id: OWNER, extra: { document: { file_id: "f3" }, caption: "восстанови душу" } }), KEY);
  assert.equal(last(OWNER), "Не смогла скачать файл. Пришлите его ещё раз.");
});
