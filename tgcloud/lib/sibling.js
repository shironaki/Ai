/**
 * The sister: the bot that actually *does* things.
 *
 * The heart talks; moderation, games, quests and profiles live in a second
 * deployment. Two questions follow, and both are answered here rather than by
 * the model, because a model asked "can you ban?" will invent an answer:
 *
 *   1. Is she reachable at all?      — bridge configured, channel, secret.
 *   2. Is she in *this* chat?        — her catalogue is non-empty for this role.
 *
 * When the answer is no, the heart says so and offers the one useful next step:
 * an invitation link. It never pretends the action happened and never asks the
 * person to type a command that does not exist.
 */

export function inviteUrl(username, { startGroup = true } = {}) {
  const name = String(username ?? "").trim().replace(/^@/, "");
  if (!name) return "";
  return `https://t.me/${name}${startGroup ? "?startgroup=true" : ""}`;
}

/**
 * One sentence about a missing ability, and — where it helps — a way to fix it.
 * `where` is "private" or a group type: the wording differs because in a group
 * the reader may not be the one who can add a bot.
 */
export function missingAbilityText({ tool = null, name = "Аи", sister = "Юи", username = "", chatType = "private", reason = "not_in_chat" } = {}) {
  const link = inviteUrl(username);
  const ability = TOOL_NAMES[tool] ?? "это";
  const byGroup = ["group", "supergroup"].includes(chatType);

  if (reason === "bridge_closed") {
    return `${name}: ${ability} не входит в мои умения — этим занимается ${sister}, а её здесь нет.`;
  }
  if (reason === "module_disabled") {
    return `${ability[0].toUpperCase()}${ability.slice(1)} выключено в этом чате. Владелец включает: /packs.`;
  }
  if (!link) {
    return byGroup
      ? `${ability[0].toUpperCase()}${ability.slice(1)} умеет ${sister}, но её нет в этом чате. Администратор может её добавить.`
      : `${ability[0].toUpperCase()}${ability.slice(1)} умеет ${sister}, но её нет в этом чате — добавьте её в группу, и всё заработает.`;
  }
  return byGroup
    ? `${ability[0].toUpperCase()}${ability.slice(1)} умеет ${sister}, но её нет в этом чате. Администратор может добавить: ${link}`
    : `${ability[0].toUpperCase()}${ability.slice(1)} умеет ${sister} — добавьте её в группу, и всё заработает: ${link}`;
}

/** Plain-language names, so the refusal reads like a sentence and not a code. */
export const TOOL_NAMES = Object.freeze({
  profile: "профиль",
  info: "справка об участнике",
  quests: "задания",
  play: "игры",
  warns: "предупреждения",
  report: "обращение к модерации",
  mute: "мут",
  ban: "бан",
  warn: "предупреждение",
  award: "награды",
  campaign: "совместная история",
});

export function toolName(tool) {
  return TOOL_NAMES[tool] ?? "это";
}

/**
 * Everything the heart knows about her sister's presence, in one object, so
 * `/start`, a refusal and a diagnostic cannot disagree with each other.
 */
export function describeSister({ open = false, tools = [], username = "", sister = "Юи" } = {}) {
  if (!open) return { here: false, reason: "bridge_closed", text: `${sister} не подключена — работаю одна.` };
  if (!tools.length) return { here: false, reason: "not_in_chat", text: `${sister} подключена, но в этом чате её нет.` };
  return { here: true, reason: "ok", text: `${sister} здесь: ${tools.length} ${plural(tools.length, "умение", "умения", "умений")}.` };
}

export function plural(count, one, few, many) {
  const value = Math.abs(Number(count) || 0) % 100;
  const last = value % 10;
  if (value > 10 && value < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}
