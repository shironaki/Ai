/**
 * Поддельный Bot API для двери приложения (`docs/DOOR.md`): настоящий `scripts/door-client.mjs` ходит в него по сети
 * (`DOOR_API`), а посты бота двери он отдаёт сердцу со стаба платформы. Им пользуются `tests/door.test.mjs` (посредник
 * сам по себе) и `tests/phone.test.mjs` (вся команда `bash scripts/phone.sh door` от начала до конца).
 *
 * Он ведёт себя так, как написано в исходниках настоящего сервера (github.com/tdlib/telegram-bot-api, `Client.cpp`), а
 * не так, как удобно тесту. В 0.54.0 было наоборот: он отдавал в списке администраторов чужих ботов и не знал о
 * вебхуке — и первый же живой опыт (22.11.2026) упёрся в то, чего тест не видел. Что взято из исходников:
 *   • `getUpdates` у бота с вебхуком — 409 «Conflict: can't use getUpdates method while webhook is active; …»;
 *   • отрицательный `offset` — последние N обновлений без подтверждения; положительный подтверждает всё, что раньше;
 *   • `getChatAdministrators` — люди и сам спросивший; чужие боты — только с `return_bots` (прежние версии его не знают);
 *   • о собственных постах бот обновлений не получает; пост одного бота-администратора канала приходит другому;
 *   • удалённого сообщения нет: «Bad Request: message to delete not found».
 */
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KEY, toChat, calls } from "./kit.mjs";

export const AI_ID = 999, AI_NAME = "ai_heart_bot";
export const DOOR_BOT = "777001:door-bot-token-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
export const VOICE_BOT = "777002:voice-bot-token-BBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
export const NEW_BOT = "777003:fresh-bot-token-CCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
export const idOf = (token) => Number(token.split(":")[0]);

/**
 * @param {object} [options]
 * @param {() => object | null} [options.hearts]  сердце, которому Telegram отдаёт посты канала (нет — «не опубликовано»)
 * @param {number} [options.ahead]  на сколько миллисекунд часы Telegram впереди часов машины
 * @param {boolean} [options.deaf]  ответы сердца до бота двери не доходят
 * @param {string} [options.door]  номер канала двери
 * @param {number} [options.ai]  номер бота Аи
 * @param {() => number} [options.nextId]  свой счётчик номеров сообщений (когда тест сам шлёт сердцу посты рядом)
 * @param {number} [options.owner]  хозяин в настройках сердца (`config.js`); 0 — там пусто, хозяин — строка из ключей
 */
export async function telegramStub({ hearts = () => null, ahead = 0, deaf = false, door = "-100900900", ai = AI_ID, nextId = null, owner = 0 } = {}) {
  const state = {
    log: [], posts: new Map(), served: 0, erased: 0, ahead, deaf, mid: 5000,
    bots: new Map([[DOOR_BOT, { username: "door_bot", hook: "", queue: [] }], [VOICE_BOT, { username: "voice_bot", hook: "https://hook.example/secret-path/7", queue: [] }], [NEW_BOT, { username: "fresh_bot", hook: "", queue: [] }]]),
    // Канал двери: хозяин — человек 1; у ботов права как у администраторов канала.
    channel: { id: Number(door), title: "Дверь", type: "channel", username: "", plain: 0, returnBots: true, blind: false, admins: new Map([[ai, { username: AI_NAME, post: true, erase: true }], [idOf(DOOR_BOT), { username: "door_bot", post: true, erase: true }]]) },
    serial: 0,
  };
  const now = () => Date.now() + state.ahead;
  const next = nextId ?? (() => (state.mid += 1));
  const push = (token, update) => { const bot = state.bots.get(token); if (bot && !bot.hook) bot.queue.push({ update_id: (state.serial += 1), ...update }); };
  const chatOf = () => ({ id: state.channel.id, title: state.channel.title, type: state.channel.type, ...(state.channel.username ? { username: state.channel.username } : {}) });
  const member = (id, rights) => ({ user: { id, is_bot: true, username: rights.username }, status: "administrator", can_post_messages: rights.post, can_delete_messages: rights.erase });
  /** Пост в канале: его получают остальные боты-администраторы без вебхука; сердце — отдельно, оно «на платформе». */
  const publish = (text, by) => {
    const sent = { message_id: next(), date: Math.floor(now() / 1000), chat: chatOf(), text };
    state.posts.set(sent.message_id, { text, by });
    for (const [token] of state.bots) if (token !== by && state.channel.admins.has(idOf(token)) && !(state.deaf && by === "heart")) push(token, { channel_post: sent });
    return sent;
  };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      res.setHeader("content-type", "application/json");
      res.setHeader("date", new Date(now()).toUTCString());
      const reply = (result) => res.end(JSON.stringify({ ok: true, result }));
      const refuse = (code, description) => res.end(JSON.stringify({ ok: false, error_code: code, description }));
      const [, token, method] = /^\/bot([^/]+)\/(\w+)$/u.exec(req.url) ?? [];
      const bot = state.bots.get(token), id = bot ? idOf(token) : 0;
      state.log.push({ token, method });
      if (!bot) return refuse(401, "Unauthorized");
      const params = body ? JSON.parse(body) : {};
      const rights = state.channel.admins.get(id);
      const here = String(params.chat_id) === door;
      if (method === "getMe") return reply({ id, is_bot: true, username: bot.username });
      if (method === "getWebhookInfo") return reply({ url: bot.hook, has_custom_certificate: false, pending_update_count: 0 });
      if (method === "setWebhook" || method === "deleteWebhook") { bot.hook = ""; return reply(true); }
      if (method === "getUpdates") {
        if (bot.hook) return refuse(409, "Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first");
        const from = Number(params.offset) || 0;
        if (from < 0) { bot.queue = bot.queue.slice(from); return reply(bot.queue); }
        if (from > 0) bot.queue = bot.queue.filter(item => item.update_id >= from);
        // Долгий опрос: ждёт обновления, но не дольше названного срока (в тестах — не дольше секунды с лишним).
        const until = Date.now() + Math.min(Number(params.timeout) || 0, 1.2) * 1000;
        while (!bot.queue.length && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 15));
        return reply(bot.queue);
      }
      if (!here || !rights) return refuse(400, method === "getChatAdministrators" || method === "getChatMemberCount" ? "Bad Request: member list is inaccessible" : "Bad Request: chat not found");
      if (method === "getChat") return reply(chatOf());
      if (method === "getChatAdministrators") {
        const bots = [...state.channel.admins].filter(([who]) => who === id || (params.return_bots === true && state.channel.returnBots));
        return reply([{ user: { id: 1, is_bot: false, first_name: "Хозяин" }, status: "creator" }, ...bots.map(([who, item]) => member(who, item))]);
      }
      if (method === "getChatMember") {
        if (state.channel.blind) return refuse(400, "Bad Request: PARTICIPANT_ID_INVALID");
        const asked = state.channel.admins.get(Number(params.user_id));
        return reply(asked ? member(Number(params.user_id), asked) : { user: { id: Number(params.user_id), is_bot: true }, status: "left" });
      }
      if (method === "getChatMemberCount") return reply(1 + state.channel.admins.size + state.channel.plain);
      if (method === "sendMessage") {
        if (!rights.post) return refuse(400, "Bad Request: need administrator rights in the channel chat");
        const sent = publish(params.text, token);
        state.posts.get(sent.message_id).quiet = params.disable_notification === true;
        reply(sent);
        // Пост бота двери Telegram отдаёт сердцу — если Аи в канале; её посты и удаления возвращаются в канал.
        const h = state.channel.admins.has(ai) ? hearts() : null;
        if (h) {
          await h.onMessage(sent, KEY);
          for (const item of toChat(door).slice(state.served)) publish(item.text, "heart");
          state.served = toChat(door).length;
          for (const item of calls("deleteMessage").slice(state.erased)) if (String(item.chat_id) === door) state.posts.delete(item.message_id);
          state.erased = calls("deleteMessage").length;
        }
        return undefined;
      }
      if (method === "deleteMessage") {
        const found = state.posts.get(Number(params.message_id));
        if (!found) return refuse(400, "Bad Request: message to delete not found");
        if (found.by !== token && !rights.erase) return refuse(400, "Bad Request: message can't be deleted");
        state.posts.delete(Number(params.message_id));
        return reply(true);
      }
      return refuse(404, "Not Found");
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const dir = mkdtempSync(join(tmpdir(), "door-env-")), file = join(dir, ".heart.env");
  // Настройки сердца для посредника: у сердца теста хозяин свой, а не тот, что записан в `tgcloud/lib/config.js`.
  const config = join(dir, "config.mjs");
  // `bridge` — канал моста в тех же настройках: дверью он быть не может (посредник смотрит туда же, куда сердце).
  const setOwner = (id, bridge = "") => writeFileSync(config, `export const CONFIG = Object.freeze({ OWNER_TG_ID: ${Number(id) || 0}, ABILITIES_CHANNEL_ID: ${JSON.stringify(String(bridge))} });\n`);
  setOwner(owner);
  const base = { PATH: process.env.PATH, HEART_ENV: file, DOOR_API: `http://127.0.0.1:${server.address().port}`, DOOR_AI_ID: String(ai), DOOR_CONFIG: config };
  return {
    state, file, push, api: base.DOOR_API, config, setOwner,
    keys: (lines) => writeFileSync(file, lines.join("\n")),
    text: () => readFileSync(file, "utf8"),
    /** Что осталось в канале: тексты постов. */
    left: () => [...state.posts.values()].map(item => item.text),
    called: (method) => state.log.filter(item => item.method === method).length,
    run: (args, extra = {}, input = null) => new Promise((resolve) => {
      const child = execFile(process.execPath, ["scripts/door-client.mjs", ...args], { cwd: new URL("../..", import.meta.url), env: { ...base, ...extra }, timeout: 30_000 }, (error, stdout, stderr) => resolve({ code: error ? error.code ?? 1 : 0, out: String(stdout) + String(stderr) }));
      if (input != null) child.stdin.end(input);
    }),
    close: () => { server.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}
