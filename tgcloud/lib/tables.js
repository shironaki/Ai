/**
 * Игры с сюжетом на кнопках: квиз, «угадаю животное», «угадай животное» и
 * приключение. Столы живут по тем же правилам, что и в `party.js`: запись на
 * сообщение, ход — нажатие, судит код, модель не участвует.
 *
 * Наград и рейтинга нет: очки квиза существуют только за его столом и
 * исчезают вместе с ним. Это черта, проведённая владельцем: ставки и
 * награды — дело сестры.
 */
import { QUIZ } from "./data/quiz.js";
import { TRAITS, ANIMALS } from "./data/animals.js";
import { QUESTS } from "./data/quest.js";
import { fold } from "./sources.js";
import { plural } from "./sibling.js";

export const QUIZ_ROUNDS = 7;
/** Сколько вопросов она задаёт, прежде чем назвать животное, и сколько раз пробует. */
export const MAX_ASK = 12;
const MAX_TRIES = 3;
/** Сколько вопросов и промахов есть у человека, когда загадала она. */
export const HIDE_ASKS = 8;
const HIDE_MISSES = 3;

export const BEASTS = Object.freeze(ANIMALS.map(([emoji, name, traits, forms]) => Object.freeze({
  emoji, name,
  has: new Set(traits.split(" ")),
  forms: (forms.includes("|") ? forms.split("|") : forms.split(" ")).map(form => form.trim()).filter(Boolean),
})));
const TRAIT = TRAITS.map(([key, ask, short]) => ({ key, ask, short }));

/** Какое животное названо в тексте: самое длинное из совпавших имён. Никакое — null. */
export function beastNamed(text) {
  const value = ` ${fold(text).replace(/[^\p{L}\s-]+/gu, " ").replace(/\s+/gu, " ").trim()} `;
  let best = null, size = 0;
  BEASTS.forEach((beast, index) => {
    for (const form of beast.forms) if (form.length > size && value.includes(` ${form} `)) { best = index; size = form.length; }
  });
  return best;
}

/**
 * Кто подходит под ответы. Человек может ошибиться или не знать, поэтому
 * отбор мягкий: остаются те, у кого расхождений с ответами меньше всего.
 * `asked` — пары [номер признака, "y" | "n" | "u"]; `out` — уже названные.
 */
export function beastsLeft(asked = [], out = []) {
  const miss = BEASTS.map((beast, index) => (out.includes(index) ? Infinity
    : asked.reduce((sum, [trait, answer]) => sum + (answer === "u" || beast.has.has(TRAIT[trait]?.key) === (answer === "y") ? 0 : 1), 0)));
  const least = Math.min(...miss);
  return Number.isFinite(least) ? miss.map((value, index) => (value === least ? index : -1)).filter(index => index >= 0) : [];
}

/** Признак, который делит оставшихся ближе всего к «пополам». Делить нечем — -1. */
export function bestTrait(pool, asked = [], pick = (list) => list[0]) {
  const used = new Set(asked.map(item => item[0]));
  let best = [], gap = Infinity;
  TRAIT.forEach((trait, index) => {
    if (used.has(index)) return;
    const yes = pool.filter(beast => BEASTS[beast].has.has(trait.key)).length;
    if (!yes || yes === pool.length) return;
    const off = Math.abs(yes - pool.length / 2);
    if (off < gap) { gap = off; best = [index]; } else if (off === gap) best.push(index);
  });
  return best.length ? pick(best) : -1;
}

export function storyEngines({ btn, esc, pick, same }) {
  const shuffled = (list) => {
    const rest = [...list], out = [];
    while (rest.length) out.push(...rest.splice(rest.indexOf(pick(rest)), 1));
    return out;
  };
  const hostOnly = (record, user, what) => (same(record.host.id, user.id) ? null : { say: `${what} ${record.host.name} — кто начал игру. Свою можно начать словами.` });

  // ── квиз ────────────────────────────────────────────────────────────────
  const quiz = {
    deal(record) {
      record.q = { i: record.left.shift(), order: shuffled([0, 1, 2, 3]) };
      record.n += 1;
      record.tried = [];
      delete record.closed;
    },
    open({ host, solo }) {
      const record = { kind: "quiz", phase: "play", host, players: [host], solo: Boolean(solo), left: shuffled(QUIZ.map((_, index) => index)).slice(0, QUIZ_ROUNDS), n: 0, total: QUIZ_ROUNDS, score: {} };
      this.deal(record);
      return record;
    },
    view(record) {
      if (record.phase === "over") {
        const rows = Object.values(record.score).sort((a, b) => b.n - a.n);
        const body = record.solo ? `Верных ответов: ${rows[0]?.n ?? 0} из ${record.n}.`
          : rows.length ? rows.map((row, index) => `${index + 1}. ${esc(row.name)} — ${row.n}`).join("\n") : "Очков никто не набрал.";
        return { text: `🧠 <b>Квиз окончен</b>\n${body}\n\nОчки — только за этим столом: наград и рейтинга здесь нет.`, keyboard: [[btn("Ещё раз", "again")]] };
      }
      const [question, ...options] = QUIZ[record.q.i];
      const head = `🧠 <b>Квиз</b> · вопрос ${record.n} из ${record.total}\n<b>${esc(question)}</b>`;
      if (record.closed) {
        const who = record.closed.by ? (record.solo ? "Верно!" : `Первый верный ответ: ${esc(record.closed.by.name)}.`) : record.solo ? "Мимо." : "Верного ответа никто не дал.";
        return { text: `${head}\n\n✅ ${esc(options[0])}\n${who}`, keyboard: [[btn(record.left.length ? "Дальше" : "Итоги", "next")]] };
      }
      return {
        text: `${head}${record.solo ? "" : "\n\nОтвечает каждый, по одному разу. Первый верный ответ закрывает вопрос."}`,
        keyboard: [...record.q.order.map((option, place) => [btn(options[option], `a:${place}`)]), ...(record.solo ? [] : [[btn("Пропустить", "next"), btn("Закончить", "stop")]])],
      };
    },
    press(record, { verb, arg, user }) {
      if (verb === "again" && record.phase === "over") {
        const fresh = this.open({ host: record.host, solo: record.solo });
        for (const key of Object.keys(record)) if (!["chat", "at"].includes(key)) delete record[key];
        Object.assign(record, fresh);
        return { changed: true };
      }
      if (record.phase !== "play") return {};
      if (verb === "stop") {
        const refusal = hostOnly(record, user, "Закончить может");
        if (refusal) return refusal;
        record.phase = "over";
        record.n -= record.closed ? 0 : 1;
        return { changed: true };
      }
      if (verb === "next") {
        if (!record.closed) {
          const refusal = hostOnly(record, user, "Пропустить вопрос может");
          if (refusal) return refusal;
          record.closed = { by: null };
          return { changed: true };
        }
        if (record.left.length) this.deal(record); else record.phase = "over";
        return { changed: true };
      }
      if (verb !== "a") return {};
      if (record.closed) return { say: "Вопрос уже закрыт." };
      if (record.tried.some(id => same(id, user.id))) return { say: "На этот вопрос вы уже ответили." };
      const option = record.q.order[Number(arg)];
      if (option == null) return {};
      record.tried.push(user.id);
      if (option === 0) {
        const row = record.score[user.id] ?? { name: user.name, n: 0 };
        record.score[user.id] = { name: user.name, n: row.n + 1 };
        record.closed = { by: user };
        return { changed: true, say: "Верно!" };
      }
      if (record.solo) { record.closed = { by: null }; return { changed: true, say: "Мимо." }; }
      return { changed: true, quiet: true, say: "Мимо. Второй попытки на этот вопрос нет." };
    },
  };

  // ── она угадывает животное ──────────────────────────────────────────────
  const akin = {
    /** Следующий шаг: ещё вопрос — или пора называть. */
    step(record) {
      const pool = beastsLeft(record.asked, record.out);
      const trait = pool.length > 1 && record.asked.length < MAX_ASK ? bestTrait(pool, record.asked, pick) : -1;
      if (trait >= 0) { record.phase = "ask"; record.q = trait; return; }
      if (!pool.length || record.out.length >= MAX_TRIES) { record.phase = "over"; record.won = false; return; }
      record.phase = "guess";
      record.pick = pick(pool);
    },
    open({ host }) {
      const record = { kind: "akin", phase: "ask", host, players: [host], asked: [], out: [] };
      this.step(record);
      return record;
    },
    view(record) {
      const head = "🔮 <b>Угадаю животное</b>";
      const again = [[btn("Ещё раз", "again")]];
      if (record.phase === "ask") {
        return {
          text: `${head}\n${esc(record.host.name)} загадывает животное, я спрашиваю. Отвечать — кнопками.\n\nВопрос ${record.asked.length + 1}: <b>${TRAIT[record.q].ask}</b>`,
          keyboard: [[btn("Да", "y"), btn("Нет", "n")], [btn("Не знаю", "u")]],
        };
      }
      if (record.phase === "guess") {
        const beast = BEASTS[record.pick];
        return { text: `${head}\nВопросов задано: ${record.asked.length}.\n\nЭто <b>${beast.emoji} ${beast.name}</b>?`, keyboard: [[btn("Да, угадала", "y"), btn("Нет", "n")]] };
      }
      if (record.won) {
        const beast = BEASTS[record.pick];
        return { text: `${head}\n${beast.emoji} Это ${beast.name}! Угадала за ${record.asked.length} ${plural(record.asked.length, "вопрос", "вопроса", "вопросов")}.`, keyboard: again };
      }
      return { text: `${head}\nСдаюсь: такого животного я не знаю — или мы где-то запутались в ответах. Победа за ${esc(record.host.name)}.`, keyboard: again };
    },
    press(record, { verb, user }) {
      const refusal = hostOnly(record, user, "Отвечает");
      if (refusal) return refusal;
      if (verb === "again" && record.phase === "over") {
        for (const key of ["asked", "out", "q", "pick", "won"]) delete record[key];
        Object.assign(record, { asked: [], out: [] });
        this.step(record);
        return { changed: true };
      }
      if (record.phase === "ask" && ["y", "n", "u"].includes(verb)) {
        record.asked.push([record.q, verb]);
        this.step(record);
        return { changed: true };
      }
      if (record.phase === "guess" && verb === "y") { record.phase = "over"; record.won = true; return { changed: true, say: "Ура!" }; }
      if (record.phase === "guess" && verb === "n") {
        record.out.push(record.pick);
        this.step(record);
        return { changed: true };
      }
      return {};
    },
  };

  // ── она загадала, человек угадывает ─────────────────────────────────────
  const hide = {
    open({ host }) {
      return { kind: "hide", phase: "play", host, players: [host], animal: BEASTS.indexOf(pick(BEASTS)), asked: [], misses: [] };
    },
    view(record) {
      const beast = BEASTS[record.animal];
      const log = [
        ...record.asked.map(trait => `— ${TRAIT[trait].short} ${beast.has.has(TRAIT[trait].key) ? "Да." : "Нет."}`),
        ...record.misses.map(index => `— Это ${BEASTS[index].name}? Нет.`),
      ].join("\n");
      if (record.phase === "over") {
        const end = record.winner ? `Верно, ${esc(record.winner.name)}: это ${beast.emoji} ${beast.name}!` : `Это было: ${beast.emoji} ${beast.name}.`;
        return { text: `🙈 <b>Угадай животное</b>\n${log ? `${log}\n\n` : ""}${end}`, keyboard: [[btn("Ещё раз", "again")]] };
      }
      const left = HIDE_ASKS - record.asked.length;
      const rest = TRAIT.map((trait, index) => ({ trait, index })).filter(item => !record.asked.includes(item.index));
      const rows = [];
      if (left > 0) for (let at = 0; at < rest.length; at += 2) rows.push(rest.slice(at, at + 2).map(item => btn(item.trait.short, `q:${item.index}`)));
      return {
        text: `🙈 <b>Угадай животное</b>\nЯ загадала животное. ${left > 0 ? `Спрашивайте кнопками — отвечу «да» или «нет»; вопросов осталось: ${left}.` : "Вопросы кончились — пора называть."}\nОтгадка — ответом на это сообщение.${log ? `\n\n${log}` : ""}`,
        keyboard: [...rows, [btn("Сдаюсь", "give")]],
      };
    },
    press(record, { verb, arg, user }) {
      if (verb === "again" && record.phase === "over") {
        Object.assign(record, this.open({ host: record.host }));
        delete record.winner;
        return { changed: true };
      }
      if (record.phase !== "play") return {};
      if (verb === "give") {
        const refusal = hostOnly(record, user, "Сдаться может");
        if (refusal) return refusal;
        record.phase = "over";
        return { changed: true };
      }
      if (verb !== "q") return {};
      const trait = Number(arg);
      if (!Number.isInteger(trait) || !TRAIT[trait] || record.asked.includes(trait)) return {};
      if (record.asked.length >= HIDE_ASKS) return { say: "Вопросы кончились — называйте животное ответом на сообщение." };
      record.asked.push(trait);
      return { changed: true, say: BEASTS[record.animal].has.has(TRAIT[trait].key) ? "Да." : "Нет." };
    },
    /** Отгадка словами — ответом на сообщение стола. */
    guess(record, { text, user }) {
      if (record.phase !== "play") return { result: { idle: true } };
      const named = beastNamed(text);
      if (named == null) return { result: { miss: true } };
      if (named === record.animal) {
        record.phase = "over";
        record.winner = user;
        return { changed: true, result: { won: true } };
      }
      if (!record.misses.includes(named)) record.misses.push(named);
      if (record.misses.length >= HIDE_MISSES) record.phase = "over";
      return { changed: true, result: { miss: true } };
    },
  };

  // ── приключение ─────────────────────────────────────────────────────────
  const allowed = (choice, bag) => {
    const rule = choice[2] ?? {};
    return (!rule.need || bag.includes(rule.need)) && (!rule.lack || !bag.includes(rule.lack));
  };
  const quest = {
    open({ host }) {
      const story = "lighthouse";
      return { kind: "quest", phase: "play", host, players: [host], story, node: QUESTS[story].start, bag: [], steps: 0, note: "" };
    },
    view(record) {
      const story = QUESTS[record.story];
      const node = story.nodes[record.node];
      const bag = record.bag.length ? `\n\n🎒 ${record.bag.map(item => story.items[item] ?? item).join(", ")}` : "";
      const text = `📖 <b>${esc(story.title)}</b>\n\n${record.note ? `${esc(record.note)}\n\n` : ""}${esc(node.text)}${node.end ? "" : bag}`;
      if (node.end) return { text, keyboard: [[btn("Сначала", "again")]] };
      return { text, keyboard: node.to.map((choice, index) => ({ choice, index })).filter(item => allowed(item.choice, record.bag)).map(item => [btn(item.choice[0], `g:${item.index}`)]) };
    },
    press(record, { verb, arg, user }) {
      const refusal = hostOnly(record, user, "Историю ведёт");
      if (refusal) return refusal;
      const story = QUESTS[record.story];
      if (verb === "again") {
        Object.assign(record, { phase: "play", node: story.start, bag: [], steps: 0, note: "" });
        return { changed: true };
      }
      if (verb !== "g" || record.phase !== "play") return {};
      const choice = story.nodes[record.node]?.to?.[Number(arg)];
      if (!choice || !allowed(choice, record.bag)) return { say: "Этот путь уже закрыт." };
      const rule = choice[2] ?? {};
      if (rule.give && !record.bag.includes(rule.give)) record.bag.push(rule.give);
      record.node = choice[1];
      record.note = rule.say ?? "";
      record.steps += 1;
      if (story.nodes[record.node].end) record.phase = "over";
      return { changed: true };
    },
  };

  return { quiz, akin, hide, quest };
}
