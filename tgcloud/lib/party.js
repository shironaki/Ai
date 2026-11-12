/**
 * Игры с кнопками: вдвоём и компанией.
 *
 * В игре только тот, кто сам нажал кнопку: позвать человека в «бутылочку»
 * за него нельзя. Нажатие и есть согласие — поэтому второго игрока никто не
 * спрашивает отдельно, и выйти можно такой же кнопкой.
 *
 * Здесь нет ставок, наград и рейтинга: это дело сестры. Судит код, модель в
 * играх не участвует — они идут и тогда, когда думать нечем.
 *
 * Стол — одна запись на сообщение с игрой. В чате может идти несколько
 * столов сразу; брошенный стол забывается через шесть часов.
 */
import { FIVE_LETTER, LONG_WORDS } from "./data/words.js";
import { TRUTHS, DARES, BOTTLE_FRIENDLY, BOTTLE_WARM } from "./data/party.js";
import { ACTIONS, lineFor, accusative } from "./rp.js";
import { fold } from "./sources.js";
import { safeName } from "./address.js";

export const PARTY_PREFIX = "heart:party:";
export const PARTY_KEY = (chatId, messageId) => `${PARTY_PREFIX}${chatId}:${messageId}`;
export const PARTY_TTL_MS = 6 * 3_600_000;
const MAX_PLAYERS = 20;

/** Что есть: имя для кода, название, как позвать, годится ли для лички. */
export const PARTY_GAMES = Object.freeze([
  ["ttt", "крестики-нолики", "«крестики-нолики»", true],
  ["rps", "камень-ножницы-бумага вдвоём", "«кнб вдвоём»", false],
  ["croc", "крокодил", "«крокодил»", false],
  ["tod", "правда или действие", "«правда или действие»", false],
  ["bottle", "бутылочка", "«бутылочка»", false],
]);

const LEAD = "(?:(?:а|ну)\\s+)?(?:(?:давай(?:те)?|го|хочу|может|пошли|погнали)\\s+)?(?:(?:сыграем|поиграем|сыграть|поиграть|играем|играть|запусти|начни|устрой|крутим|покрутим|крути)\\s+)?(?:в\\s+)?";
const NAMED = [
  ["ttt", "крестики[\\s-]+нолики|крестики"],
  ["tod", "правд[ау]\\s+или\\s+действие"],
  ["bottle", "бутылочк[ауи]"],
  ["croc", "крокодил[а]?"],
  ["rps", "(?:камень[\\s,-]+ножницы[\\s,-]+бумаг[ау]|кнб|цу[\\s-]?е[\\s-]?фа)\\s+(?:вдвоем|на\\s+двоих|с\\s+кем[\\s-]?(?:нибудь|то)|друг\\s+с\\s+другом|кнопками)"],
].map(([kind, body]) => [kind, new RegExp(`^${LEAD}(?:${body})$`, "u")]);

/** «Сыграем в крокодила» → "croc". Не игра с кнопками — null. */
export function parseParty(text) {
  const value = fold(text).replace(/[.!?…]+$/u, "").replace(/\s+/gu, " ").trim();
  if (!value || value.length > 60) return null;
  for (const [kind, pattern] of NAMED) if (pattern.test(value)) return kind;
  return null;
}

const esc = (value) => String(value ?? "").replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
const btn = (text, data) => ({ text, callback_data: `p:${data}` });
const AI = Object.freeze({ id: 0, name: "Аи", bot: true });
const same = (a, b) => String(a) === String(b);

// ── крестики-нолики ───────────────────────────────────────────────────────
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const MARK = { x: "❌", o: "⭕", "": "⬜" };

/** "x", "o", "draw" или null — игра идёт. */
export function boardResult(board) {
  for (const [a, b, c] of LINES) if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  return board.every(Boolean) ? "draw" : null;
}

/** Её ход. Играет хорошо, но не безупречно: иногда ошибается — иначе с ней скучно. */
export function boardMove(board, me, random = Math.random) {
  const free = board.map((cell, index) => (cell ? -1 : index)).filter(index => index >= 0);
  if (!free.length) return -1;
  const pick = (list) => list[Math.min(list.length - 1, Math.floor(random() * list.length))];
  if (free.length === 9) return pick([0, 2, 4, 6, 8]);
  const other = me === "x" ? "o" : "x";
  const wins = (who) => free.find(index => { board[index] = who; const won = boardResult(board) === who; board[index] = ""; return won; });
  // Победу и явную угрозу она видит всегда; ошибается — в остальном.
  const win = wins(me);
  if (win != null) return win;
  const block = wins(other);
  if (block != null) return block;
  if (random() < 0.3) return pick(free);
  const score = (turn, depth) => {
    const result = boardResult(board);
    if (result === me) return 10 - depth;
    if (result === other) return depth - 10;
    if (result === "draw") return 0;
    let best = turn === me ? -Infinity : Infinity;
    for (let index = 0; index < 9; index++) {
      if (board[index]) continue;
      board[index] = turn;
      const value = score(turn === "x" ? "o" : "x", depth + 1);
      board[index] = "";
      best = turn === me ? Math.max(best, value) : Math.min(best, value);
    }
    return best;
  };
  let top = -Infinity, best = [];
  for (const index of free) {
    board[index] = me;
    const value = score(other, 1);
    board[index] = "";
    if (value > top) { top = value; best = [index]; } else if (value === top) best.push(index);
  }
  return pick(best);
}

// ── камень, ножницы, бумага ───────────────────────────────────────────────
const RPS = { r: ["✊", "камень"], s: ["✌️", "ножницы"], p: ["✋", "бумага"] };
const BEATS = { r: "s", s: "p", p: "r" };
const WHY = { r: "камень ломает ножницы", s: "ножницы режут бумагу", p: "бумага накрывает камень" };

const ACTION = Object.fromEntries(ACTIONS.map(item => [item.key, item]));

export function createParty({
  api = null, store = null, random = Math.random, now = () => Date.now(), has = () => false,
  pulse = null, isMinor = async () => false,
} = {}) {
  const pick = (list) => list[Math.min(list.length - 1, Math.floor(random() * list.length))];
  const WORDS = [...LONG_WORDS, ...FIVE_LETTER];

  /** Не повторять вопрос, пока не кончится колода. */
  function draw(record, name, list) {
    record.seen ??= {};
    let seen = Array.isArray(record.seen[name]) ? record.seen[name] : [];
    if (seen.length >= list.length) seen = [];
    const left = list.map((_, index) => index).filter(index => !seen.includes(index));
    const index = pick(left);
    record.seen[name] = [...seen, index];
    return list[index];
  }

  const roster = (record) => `В игре (${record.players.length}): ${record.players.map(item => esc(item.name)).join(", ") || "пока никого"}`;
  const inGame = (record, user) => record.players.some(item => same(item.id, user.id));
  const lobbyRow = [btn("Я в игре", "join"), btn("Выйти", "leave")];

  // ── столы ───────────────────────────────────────────────────────────────
  const ENGINE = {
    ttt: {
      open({ host, solo }) {
        const record = { kind: "ttt", phase: "lobby", host, players: [host], board: Array(9).fill(""), turn: 0 };
        if (solo) { record.players.push(AI); record.phase = "play"; }
        return record;
      },
      view(record) {
        const [x, o] = record.players;
        const cells = (data) => [0, 1, 2].map(row => [0, 1, 2].map(col => btn(MARK[record.board[row * 3 + col]], data(row * 3 + col))));
        if (record.phase === "lobby") {
          return {
            text: `❌⭕ <b>Крестики-нолики</b>\n${esc(x.name)} ждёт соперника. Кто нажмёт «Играть» — тот и в игре.`,
            keyboard: [[btn("Играть", "join")], [btn("Сыграть с Аи", "ai")]],
          };
        }
        const head = `❌ ${esc(x.name)} — ⭕ ${esc(o.name)}`;
        if (record.phase === "play") {
          const who = record.players[record.turn];
          return { text: `${head}\nХодит: ${esc(who.name)} ${record.turn === 0 ? MARK.x : MARK.o}`, keyboard: cells(index => `m:${index}`) };
        }
        const won = record.result === "draw" ? "Ничья." : `🏆 Победа: ${esc(record.players[record.result === "x" ? 0 : 1].name)} ${MARK[record.result]}`;
        return { text: `${head}\n${won}`, keyboard: [...cells(() => "noop"), [btn("Ещё раз", "again")]] };
      },
      /** Её ход, если очередь за ней. */
      reply(record) {
        if (record.phase !== "play" || record.players[record.turn]?.bot !== true) return;
        const mark = record.turn === 0 ? "x" : "o";
        const index = boardMove(record.board, mark, random);
        if (index < 0) return;
        record.board[index] = mark;
        this.settle(record);
      },
      settle(record) {
        const result = boardResult(record.board);
        if (result) { record.phase = "over"; record.result = result; } else record.turn = 1 - record.turn;
      },
      press(record, { verb, arg, user }) {
        if (record.phase === "lobby") {
          if (verb === "join") {
            if (same(user.id, record.host.id)) return { say: "Вы уже в игре. Нужен соперник — или сыграйте со мной." };
            record.players.push(user);
            record.phase = "play";
            return { changed: true, say: "Вы играете ноликами. Первый ход — у крестиков." };
          }
          if (verb === "ai") {
            if (!same(user.id, record.host.id)) return { say: "Со мной играет тот, кто начал игру. Вы можете нажать «Играть»." };
            record.players.push(AI);
            record.phase = "play";
            return { changed: true, say: "Играю ноликами. Ваш ход." };
          }
          return {};
        }
        if (verb === "again" && record.phase === "over") {
          if (!inGame(record, user)) return { say: "Переиграть могут те, кто играл." };
          // Стороны меняются: кто ходил вторым, ходит первым.
          record.players.reverse();
          record.board = Array(9).fill("");
          record.turn = 0;
          record.phase = "play";
          delete record.result;
          this.reply(record);
          return { changed: true };
        }
        if (verb !== "m" || record.phase !== "play") return {};
        const who = record.players[record.turn];
        if (!inGame(record, user)) return { say: "За этим столом играют двое. Свой можно начать словами: «крестики-нолики»." };
        if (!same(who.id, user.id)) return { say: `Сейчас ходит ${who.name}.` };
        const index = Number(arg);
        if (!Number.isInteger(index) || index < 0 || index > 8) return {};
        if (record.board[index]) return { say: "Эта клетка занята." };
        record.board[index] = record.turn === 0 ? "x" : "o";
        this.settle(record);
        this.reply(record);
        return { changed: true };
      },
    },

    rps: {
      open: ({ host }) => ({ kind: "rps", phase: "pick", host, players: [], picks: [] }),
      view(record) {
        const buttons = [Object.entries(RPS).map(([key, [emoji]]) => btn(emoji, `c:${key}`))];
        if (record.phase === "pick") {
          const waiting = record.picks.length === 1 ? `\n\n${esc(record.picks[0].name)} уже в игре. Кто второй?` : "";
          return { text: `✊✌️✋ <b>Камень, ножницы, бумага</b>\nНужны двое. Выбор скрыт, пока не выберут оба.${waiting}`, keyboard: buttons };
        }
        const [a, b] = record.picks;
        const line = `${esc(a.name)} ${RPS[a.c][0]} — ${RPS[b.c][0]} ${esc(b.name)}`;
        const outcome = a.c === b.c ? "Ничья." : `🏆 ${esc((BEATS[a.c] === b.c ? a : b).name)}: ${WHY[BEATS[a.c] === b.c ? a.c : b.c]}.`;
        return { text: `${line}\n${outcome}`, keyboard: [[btn("Ещё раз", "again")]] };
      },
      press(record, { verb, arg, user }) {
        if (verb === "again" && record.phase === "over") {
          record.phase = "pick";
          record.picks = [];
          return { changed: true };
        }
        if (verb !== "c" || record.phase !== "pick" || !RPS[arg]) return {};
        const mine = record.picks.find(item => same(item.id, user.id));
        if (mine) {
          mine.c = arg;
          return { changed: true, quiet: true, say: `Выбор изменён: ${RPS[arg][1]}. Ждём второго.` };
        }
        record.picks.push({ ...user, c: arg });
        if (record.picks.length === 2) { record.phase = "over"; return { changed: true, say: `Вы выбрали: ${RPS[arg][1]}.` }; }
        return { changed: true, say: `Вы выбрали: ${RPS[arg][1]}. Ждём второго.` };
      },
    },

    croc: {
      open: ({ host }) => ({ kind: "croc", phase: "play", host, players: [host], word: pick(WORDS) }),
      view(record) {
        if (record.phase === "won") {
          return {
            text: `🐊 ${esc(record.winner.name)} угадывает: это «${esc(record.last)}».\n\nКто ведущий дальше? Нажавший и объясняет.`,
            keyboard: [[btn("Я ведущий", "host")]],
          };
        }
        return {
          text: `🐊 <b>Крокодил</b>\nВедущий: ${esc(record.host.name)}. Он объясняет слово, не называя ни его, ни однокоренных.\n\nОтгадки — ответом на это сообщение.`,
          keyboard: [[btn("Посмотреть слово", "word")], [btn("Другое слово", "skip"), btn("Закончить", "stop")]],
        };
      },
      press(record, { verb, user }) {
        if (verb === "host" && record.phase === "won") {
          record.host = user;
          record.players = [user];
          record.word = pick(WORDS.filter(word => word !== record.last));
          record.phase = "play";
          return { changed: true, say: `Ваше слово: ${record.word}`, alert: true };
        }
        if (record.phase !== "play") return {};
        const mine = same(user.id, record.host.id);
        if (verb === "word") return mine ? { say: `Ваше слово: ${record.word}`, alert: true } : { say: "Слово видит только ведущий. Отгадывайте ответом на сообщение." };
        if (verb === "skip") {
          if (!mine) return { say: "Сменить слово может только ведущий." };
          record.word = pick(WORDS.filter(word => word !== record.word));
          return { changed: true, quiet: true, say: `Новое слово: ${record.word}`, alert: true };
        }
        if (verb === "stop") {
          if (!mine) return { say: "Закончить может ведущий." };
          return { changed: true, drop: true, final: `🐊 Игра закончена. Слово было «${esc(record.word)}».` };
        }
        return {};
      },
    },

    tod: {
      open: ({ host }) => ({ kind: "tod", phase: "lobby", host, players: [host] }),
      view(record) {
        const rows = (first) => [first, lobbyRow, [btn("Закончить", "stop")]];
        if (record.phase === "lobby") {
          return { text: `🎭 <b>Правда или действие</b>\n${roster(record)}\n\nВ игру входят кнопкой: каждый решает сам. Соберётесь — «Начать».`, keyboard: rows([btn("Начать", "go")]) };
        }
        const who = record.players.find(item => same(item.id, record.turn)) ?? { name: "Игрок" };
        if (record.phase === "turn") {
          return { text: `🎭 ${esc(who.name)}, правда или действие?\n\n${roster(record)}`, keyboard: rows([btn("Правда", "t"), btn("Действие", "d")]) };
        }
        return { text: `🎭 ${esc(who.name)} — ${record.task.type === "t" ? "правда" : "действие"}:\n<b>${esc(record.task.text)}</b>\n\n${roster(record)}`, keyboard: rows([btn("Дальше", "go")]) };
      },
      press(record, { verb, user }) {
        if (verb === "go" && record.phase !== "turn") {
          if (!inGame(record, user)) return { say: "Сначала войдите в игру — «Я в игре»." };
          if (record.players.length < 2) return { say: "Нужно хотя бы двое. Пусть кто-нибудь нажмёт «Я в игре»." };
          const others = record.players.filter(item => !same(item.id, record.turn));
          record.turn = pick(others.length ? others : record.players).id;
          record.phase = "turn";
          delete record.task;
          return { changed: true };
        }
        if ((verb === "t" || verb === "d") && record.phase === "turn") {
          if (!same(user.id, record.turn)) return { say: "Выбирает тот, чья очередь." };
          record.task = { type: verb, text: draw(record, verb, verb === "t" ? TRUTHS : DARES) };
          record.phase = "task";
          return { changed: true };
        }
        return {};
      },
      /** Ушёл тот, чья очередь: ход возвращается в круг. */
      left(record, user) {
        if (same(record.turn, user.id) && record.phase !== "lobby") { record.phase = "lobby"; delete record.turn; delete record.task; }
      },
    },

    bottle: {
      open: ({ host }) => ({ kind: "bottle", phase: "lobby", host, players: [host] }),
      view(record) {
        const head = record.phase === "spun"
          ? `🍾 Бутылочка крутится… и показывает на ${esc(accusative(record.pair[1].name))}!\n${record.line}`
          : "🍾 <b>Бутылочка</b>\nКрутит любой, кто в игре; на кого покажет — тому и достанется. Ничего смелее щеки тут не выпадает.";
        return { text: `${head}\n\n${roster(record)}\n\nВ игру входят кнопкой: каждый решает сам.`, keyboard: [[btn("Крутить", "spin")], lobbyRow, [btn("Закончить", "stop")]] };
      },
      async press(record, { verb, user }) {
        if (verb !== "spin") return {};
        if (!inGame(record, user)) return { say: "Сначала войдите в игру — «Я в игре»." };
        const others = record.players.filter(item => !same(item.id, user.id));
        if (!others.length) return { say: "Нужно хотя бы двое. Пусть кто-нибудь нажмёт «Я в игре»." };
        const partner = pick(others);
        // Назвал себя младше восемнадцати хотя бы один — только дружеское.
        const young = (await isMinor(user.id).catch(() => true)) || (await isMinor(partner.id).catch(() => true));
        const key = draw(record, young ? "friendly" : "all", young ? BOTTLE_FRIENDLY : [...BOTTLE_FRIENDLY, ...BOTTLE_WARM]);
        record.pair = [user, partner];
        record.line = lineFor(ACTION[key], esc(user.name), esc(partner.name), { bName: esc(partner.name) });
        record.phase = "spun";
        return { changed: true };
      },
      left(record, user) {
        if (record.phase === "spun" && record.pair?.some(item => same(item.id, user.id))) { record.phase = "lobby"; delete record.pair; delete record.line; }
      },
    },
  };

  /** Общее для столов с кругом игроков: войти, выйти, закончить. */
  function lobby(record, { verb, user }) {
    if (!["tod", "bottle"].includes(record.kind)) return null;
    if (verb === "join") {
      if (inGame(record, user)) return { say: "Вы уже в игре." };
      if (record.players.length >= MAX_PLAYERS) return { say: `За столом уже ${MAX_PLAYERS} человек — больше не поместится.` };
      record.players.push(user);
      return { changed: true, say: "Вы в игре." };
    }
    if (verb === "leave") {
      if (!inGame(record, user)) return { say: "Вас и так нет в игре." };
      record.players = record.players.filter(item => !same(item.id, user.id));
      ENGINE[record.kind].left?.(record, user);
      if (!record.players.length) return { changed: true, drop: true, final: "Игра закончена: все вышли." };
      if (same(record.host.id, user.id)) record.host = record.players[0];
      return { changed: true, say: "Вы вышли из игры." };
    }
    if (verb === "stop") {
      if (!same(record.host.id, user.id)) return { say: `Закончить может ${record.host.name} — кто начал игру.` };
      return { changed: true, drop: true, final: "Игра закончена. Спасибо всем." };
    }
    return null;
  }

  const markup = (keyboard) => ({ inline_keyboard: keyboard });
  async function redraw(chatId, messageId, record, final = "") {
    const view = final ? { text: final, keyboard: [] } : ENGINE[record.kind].view(record);
    try {
      await api.editMessageText({ chat_id: chatId, message_id: messageId, text: view.text, parse_mode: "HTML", reply_markup: markup(view.keyboard) });
      return true;
    } catch { return false; } // «не изменилось» или сообщение удалено — не поломка
  }

  /** Меню игр с кнопками — строкой для общего списка игр. */
  const menu = ({ inGroup = true } = {}) => PARTY_GAMES.filter(item => inGroup || item[3]).map(item => item[1]).join(", ");

  /**
   * Начать игру словами. Возвращает результат или null — «это не игра с
   * кнопками». В личке компании нет: там только крестики-нолики, с ней самой.
   */
  async function begin(turn, prompt, { say }) {
    const kind = parseParty(prompt);
    if (!kind) return null;
    if (turn.dry) return say(turn, "Разобрала бы это как игру с кнопками — репетиция, стол не открываю.");
    const title = PARTY_GAMES.find(item => item[0] === kind)[1];
    if (turn.isPrivate && kind !== "ttt") {
      return say(turn, kind === "rps"
        ? "Вдвоём — это в группе. Здесь сыграю сама: «камень, ножницы, бумага»."
        : `«${title[0].toUpperCase()}${title.slice(1)}» — игра для компании. Позовите меня в группу и скажите там: «Аи, ${title}».`);
    }
    if (!store?.available || !has("editMessageText")) return say(turn, "Игры с кнопками мне сейчас недоступны: хранилище не отвечает.");
    const host = { id: turn.actorId, name: safeName(turn.name) || "Игрок" };
    const record = { ...ENGINE[kind].open({ host, solo: turn.isPrivate }), chat: turn.chatId, at: now() };
    const view = ENGINE[kind].view(record);
    const thread = turn.extra?.message_thread_id != null ? { message_thread_id: turn.extra.message_thread_id } : {};
    let sent = null;
    try {
      sent = await api.sendMessage({ chat_id: turn.chatId, text: view.text, parse_mode: "HTML", reply_markup: markup(view.keyboard), ...thread });
    } catch { sent = null; }
    if (sent?.message_id == null) return { ok: false, code: "send_failed" };
    turn.delivered = true;
    await store.set(PARTY_KEY(turn.chatId, sent.message_id), record);
    pulse?.bump("games");
    return { ok: true, action: "party", kind, messageId: sent.message_id };
  }

  /** Нажатие кнопки. Отвечает на него всегда: иначе у человека крутится «часики». */
  async function press(query) {
    const from = query?.from, message = query?.message;
    const [, verb = "", arg = ""] = String(query?.data ?? "").split(":");
    const answer = async (text = "", alert = false) => {
      try { await api.answerCallbackQuery({ callback_query_id: query?.id, ...(text ? { text: String(text).slice(0, 190), show_alert: alert } : {}) }); } catch { /* ответ на нажатие не важнее игры */ }
    };
    if (from?.id == null || message?.chat?.id == null || message.message_id == null) { await answer(); return { ignored: true }; }
    if (verb === "noop" || !store?.available) { await answer(); return { ok: true, action: "party", verb: "noop" }; }
    const key = PARTY_KEY(message.chat.id, message.message_id);
    const user = { id: from.id, name: safeName(from.first_name) || "Игрок" };
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await store.get(key).catch(() => null);
      if (!before || !ENGINE[before.kind] || now() - Number(before.at) > PARTY_TTL_MS) {
        await answer("Эта игра уже закончилась. Новую можно начать словами.");
        return { ok: true, action: "party", stale: true };
      }
      const record = JSON.parse(JSON.stringify(before));
      const out = lobby(record, { verb, arg, user }) ?? await ENGINE[record.kind].press(record, { verb, arg, user });
      if (out.changed) {
        record.at = now();
        if (out.drop) await store.remove(key).catch(() => false);
        // Двое нажали разом: кто не успел записать — пересчитывается заново.
        else if (!(await store.compareSet(key, before, record))) continue;
        if (!out.quiet) await redraw(message.chat.id, message.message_id, record, out.final);
      }
      await answer(out.say, out.alert);
      return { ok: true, action: "party", kind: record.kind, verb, changed: Boolean(out.changed) };
    }
    await answer("Слишком много нажатий сразу. Ещё раз, пожалуйста.");
    return { ok: false, code: "busy" };
  }

  /**
   * Отгадка в «крокодиле»: ответ на сообщение стола. Возвращает результат или
   * null — «это сообщение не стол крокодила».
   */
  async function guess(turn, text, messageId) {
    if (!store?.available || messageId == null) return null;
    const key = PARTY_KEY(turn.chatId, messageId);
    const before = await store.get(key).catch(() => null);
    if (!before || before.kind !== "croc" || now() - Number(before.at) > PARTY_TTL_MS) return null;
    if (before.phase !== "play") return { ok: true, action: "party", kind: "croc", idle: true };
    // Ведущий отвечает на стол — это подсказка, а не отгадка.
    if (same(before.host.id, turn.actorId)) return { ok: true, action: "party", kind: "croc", host: true };
    const words = fold(text).replace(/[^\p{L}\s-]+/gu, " ").split(/\s+/u).filter(Boolean);
    if (!words.includes(fold(before.word))) return { ok: true, action: "party", kind: "croc", miss: true };
    const record = { ...before, phase: "won", last: before.word, winner: { id: turn.actorId, name: safeName(turn.name) || "Игрок" }, at: now() };
    delete record.word;
    if (!(await store.compareSet(key, before, record))) return { ok: true, action: "party", kind: "croc", late: true };
    await redraw(turn.chatId, messageId, record);
    return { ok: true, action: "party", kind: "croc", won: true, word: before.word };
  }

  return Object.freeze({ begin, press, guess, menu });
}
