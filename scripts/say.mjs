#!/usr/bin/env node
/**
 * Проба: сказать сердцу фразу на стабе платформы и увидеть, кто ответил — она сама
 * (словарь, умение, разбор) или модель. Ни Telegram, ни сети, ни ключей не нужно.
 *
 * Зачем: «словарь узнаёт фразу» не значит «фраза до словаря доходит», а команда,
 * которую разбор не узнал, молча уходит модели. Перед тем как править разбор или
 * словарь — и после — фраза говорится здесь. Список «что ты не поняла?» от владельца
 * проверяется так же: `--file`.
 *
 *   node scripts/say.mjs "меня зовут Оля" "я живу в Козельске"
 *   node scripts/say.mjs --owner "статус"             от хозяина (по умолчанию — гость)
 *   node scripts/say.mjs --group "что ты умеешь"      в группе, обращением «Аи, …»
 *   node scripts/say.mjs --flow "я заболел" "привет"  одно сердце на все фразы, по порядку
 *   node scripts/say.mjs --file список.txt            фразы из файла, по одной в строке
 *
 *   --full            ответ целиком (иначе — первые 160 знаков)
 *   --set ИМЯ=знач    настройка сердца: --set SOURCES=true --set TIME_ZONE=Europe/Moscow
 *   --at 2026-11-18T09:00:00Z   который «сейчас» час (по умолчанию — этот)
 *   --step 60         сколько минут проходит между фразами при --flow (по умолчанию — 1)
 *
 * Каждая фраза — в свежем сердце с пустой памятью (кроме --flow). Словарь и манеры
 * включены; источники (города, погода, поиск) на стабе «не отвечают», пока не включены
 * и не подставлены тестом. Что ответила бы модель, здесь не видно: видно, что спросили её.
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const options = { owner: false, group: false, flow: false, full: false, at: "2026-11-18T09:00:00Z", step: 1, settings: { PHRASES: true, MANNERS: true } };
const phrases = [];
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--owner" || arg === "--group" || arg === "--flow" || arg === "--full") options[arg.slice(2)] = true;
  else if (arg === "--at") options.at = args[++i];
  else if (arg === "--step") options.step = Number(args[++i]) || 1;
  else if (arg === "--file") phrases.push(...readFileSync(args[++i], "utf8").split("\n").map(line => line.replace(/^\s*\d+[.)]\s*/u, "").replace(/^[«"]|[»"]$/gu, "").trim()).filter(line => line && !line.startsWith("#")));
  else if (arg === "--set") {
    const [name, ...rest] = String(args[++i] ?? "").split("=");
    const raw = rest.join("=");
    options.settings[name] = raw === "true" ? true : raw === "false" ? false : /^-?\d+(?:\.\d+)?$/u.test(raw) ? Number(raw) : raw;
  } else if (arg === "--help" || arg === "-h") phrases.length = 0;
  else phrases.push(arg);
}
if (!phrases.length) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 26).map(line => line.replace(/^ ?\*\/?\s?/u, "")).join("\n"));
  process.exit(args.length ? 0 : 1);
}

const { heart, message, group, reset, sdk, chats, reactions, OWNER, KEY } = await import("../tests/fixtures/kit.mjs");
let at = Date.parse(options.at);
if (!Number.isFinite(at)) { console.error(`--at: не дата — «${options.at}»`); process.exit(1); }
const who = options.owner ? OWNER : 5;
const QUIET = new Set(["sendMessage", "sendChatAction", "setMessageReaction"]);
let h = null, own = 0, model = 0;
for (const text of phrases) {
  if (!options.flow || !h) { reset(); h = heart(options.settings, { now: () => at, random: () => 0.37 }); }
  const before = { chats: chats().length, sent: sdk().sent.length, marks: reactions().length, calls: sdk().calls.length };
  let got;
  try { got = await h.onMessage(options.group ? group(`Аи, ${text}`, { id: who }) : message(text, { id: who }), KEY); } catch (error) { got = { crashed: String(error?.stack ?? error).split("\n").slice(0, 3).join(" · ") }; }
  const asked = chats().length - before.chats;
  const said = sdk().sent.slice(before.sent).map(item => String(item.text ?? item.caption ?? "")).filter(Boolean);
  const marks = reactions().slice(before.marks).join("");
  const other = [...new Set(sdk().calls.slice(before.calls).map(item => item.method).filter(method => !QUIET.has(method)))];
  const how = got?.crashed ? "УПАЛА" : asked ? "МОДЕЛЬ" : "сама  ";
  const what = [got?.action ?? got?.reason ?? "", Array.isArray(got?.topics) ? `тема: ${got.topics.join(", ")}` : ""].filter(Boolean).join(" · ");
  const reply = got?.crashed ?? said.map(line => line.replace(/\n/gu, " ⏎ ")).map(line => (options.full || line.length <= 160 ? line : `${line.slice(0, 159)}…`)).join("  ‖  ");
  console.log(`${how} ▶ ${text}${what ? `  [${what}]` : ""}${marks ? `  реакция ${marks}` : ""}${other.length ? `  вызовы: ${other.join(", ")}` : ""}${reply ? `\n         ⟶ ${reply}` : ""}`);
  if (asked) model += 1; else own += 1;
  if (options.flow) at += options.step * 60_000;
}
if (phrases.length > 1) console.log(`\nвсего ${phrases.length}: сама — ${own}, к модели — ${model}`);
