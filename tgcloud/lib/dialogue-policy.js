import { PERSONAS, disposition } from "./ai-character.js";

const DAY = 86_400_000;
export const AFFINITY_COOLING = Object.freeze({ graceDays: 7, pointsPerDay: 1 });
const bounded = x => Math.max(-100, Math.min(100, Number(x) || 0));
/** Pure projection: no retroactive cooling for legacy rows without an anchor. */
export function currentSympathy(row = {}, at = Date.now()) {
  const score = bounded(row.sympathy ?? row.score);
  if (score <= 0 || !Number.isFinite(row.affinityAt) || row.affinityAt < 0 || !Number.isFinite(at)) return score;
  const days = Math.max(0, Math.floor((at - row.affinityAt) / DAY) - AFFINITY_COOLING.graceDays);
  return Math.max(0, score - days * AFFINITY_COOLING.pointsPerDay);
}

/** Durable relationship and invocation settings. No LLM may mutate them. */
export function createDialoguePolicy({ store, ownerId, random = Math.random, now = () => Date.now(), onRelationshipChange = async () => {} } = {}) {
  const isOwner = (id) => ownerId != null && String(id) === String(ownerId);
  const names = (value, defaults) => {
    const list = [...new Set(String(value ?? "").split(",").map(x => x.trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ")).filter(Boolean))];
    if (list.some(x => x.length > 40 || /[\r\n]/u.test(x)) || list.length > 8) return null;
    return list.length ? list : defaults;
  };
  async function read(key) {
    if (store?.getChecked) {
      const result = await store.getChecked(key);
      if (!result.ok) throw Error("dialogue_storage_unavailable");
      return result.value;
    }
    throw Error("dialogue_storage_unavailable");
  }
  async function readAffinity(key) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await read(key);
      if (!row || bounded(row.sympathy ?? row.score) <= 0 || Number.isFinite(row.affinityAt) && row.affinityAt >= 0) return row;
      // Rollout starts on first observation, never retroactively from old activity.
      const next = { ...row, affinityAt: now() };
      if (await store.compareSet(key, row, next)) return next;
    }
    throw Error("affinity_anchor_conflict");
  }
  return Object.freeze({
    async state(userId, { initialize = true } = {}) {
      const row = isOwner(userId) ? { score: 100, sympathy: 100, trust: 100, respect: 100 } : await (initialize ? readAffinity(`ai:relationship:${userId}`) : read(`ai:relationship:${userId}`)) ?? {};
      const score = isOwner(userId) ? 100 : currentSympathy(row, now());
      return { score, sympathy: score, trust: bounded(row.trust), respect: bounded(row.respect), blocked: !isOwner(userId) && (Boolean(row.blocked) || score <= -75), free: score >= 75 };
    },
    async localState(userId, chatId, options = {}) {
      if (String(userId) === String(chatId)) return this.state(userId, options);
      const global = await this.state(userId, options);
      const row = isOwner(userId) ? null : await (options.initialize === false ? read(`ai:relationship:chat:${chatId}:user:${userId}`) : readAffinity(`ai:relationship:chat:${chatId}:user:${userId}`));
      // Group affinity is contextual; global blocks and execution rights are not overridden.
      return row && !isOwner(userId) ? { ...global, ...row, score: currentSympathy(row, now()), sympathy: currentSympathy(row, now()), blocked: global.blocked, free: global.free } : global;
    },
    async setAxes({ actorId, userId, chatId = null, sympathy, trust, respect }) {
      if (!isOwner(actorId) || !/^[1-9]\d*$/.test(String(userId))) return { ok: false, code: "forbidden" };
      if (![sympathy, trust, respect].every(x => Number.isInteger(x) && x >= -100 && x <= 100)) return { ok: false, code: "invalid_axes" };
      if (chatId != null && !/^-\d+$/.test(String(chatId))) return { ok: false, code: "invalid_chat" };
      const k = chatId == null ? `ai:relationship:${userId}` : `ai:relationship:chat:${chatId}:user:${userId}`;
      const before = await read(k);
      const axes = isOwner(userId) ? { sympathy: 100, trust: 100, respect: 100 } : { sympathy, trust, respect };
      const value = { ...before, ...axes, score: axes.sympathy, affinityAt: now() };
      const ok = await (before == null ? store.setIfAbsent(k, value) : store.compareSet(k, before, value));
      let vipRecheckPending = false;
      if (ok) { try { await onRelationshipChange({ userId, chatId }); } catch { vipRecheckPending = true; } }
      return { ok, ...axes, vipRecheckPending };
    },
    async recordCommunication({ userId, chatId }) {
      if (isOwner(userId)) return { ok: true };
      if (!/^[1-9]\d*$/u.test(String(userId)) || !/^-?[1-9]\d*$/u.test(String(chatId))) return { ok: false };
      const keys = [`ai:relationship:${userId}`, ...(String(userId) === String(chatId) ? [] : [`ai:relationship:chat:${chatId}:user:${userId}`])];
      for (const key of keys) {
        let saved = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          const before = await read(key);
          if (!before || bounded(before.sympathy ?? before.score) <= 0) { saved = true; break; }
          const at = now(), score = currentSympathy(before, at);
          // A backwards clock must not move the cooling anchor into the past.
          const next = { ...before, sympathy: score, score, affinityAt: Math.max(at, Number.isFinite(before.affinityAt) ? before.affinityAt : at) };
          if (await store.compareSet(key, before, next)) { saved = true; break; }
        }
        if (!saved) return { ok: false };
      }
      return { ok: true };
    },
    async recoverFromContribution({ actorId, userId, meritId }) {
      if (!isOwner(actorId) || isOwner(userId) || !/^[1-9]\d*$/u.test(String(userId)) || !Number.isSafeInteger(meritId) || meritId < 1) return { ok: false, code: "forbidden" };
      const ledger = await read(`vip:merits:${userId}`);
      const proof = ledger?.items?.find((item, i) => (item.id ?? i + 1) === meritId);
      if (!proof || proof.active === false || !["task", "contribution"].includes(proof.kind)) return { ok: false, code: "unverified_contribution" };
      const key = `ai:relationship:${userId}`;
      for (let attempt = 0; attempt < 3; attempt++) {
        const row = await read(key), at = now();
        if (row?.blocked) return { ok: true, changed: false, code: "review_required" };
        if ((row?.recoveryMeritId ?? 0) >= meritId || Number.isFinite(row?.recoveryAt) && at - row.recoveryAt < DAY) return { ok: true, changed: false, code: "recovery_limited" };
        const score = Math.min(100, currentSympathy(row ?? {}, at) + 2);
        const next = { ...row, score, sympathy: score, affinityAt: at, recoveryAt: at, recoveryMeritId: meritId };
        if (await store.compareSetGuarded(key, row, next, `vip:merits:${userId}`, ledger)) {
          let vipRecheckPending = false;
          try { await onRelationshipChange({ userId, chatId: null }); } catch { vipRecheckPending = true; }
          return { ok: true, changed: true, vipRecheckPending };
        }
      }
      return { ok: false, code: "recovery_conflict" };
    },
    async impression(userId) {
      const key = `ai:impression:${userId}`;
      let value = await read(key);
      if (value == null) {
        const sample = () => { const n = random(); return Number.isFinite(n) ? Math.max(0, Math.min(0.999999, n)) : 0; };
        const candidate = { persona: PERSONAS[Math.floor(sample() * PERSONAS.length)], seed: Math.floor(sample() * 0x7fffffff) };
        if (await store.setIfAbsent(key, candidate)) value = candidate;
        else value = await read(key);
      }
      if (!value || !PERSONAS.includes(value.persona) || !Number.isInteger(value.seed)) throw Error("impression_storage_unavailable");
      return { persona: value.persona, seed: value.seed };
    },
    async shouldIgnore({ userId, chatId, text = "" }) {
      // Only the natural conversation path calls this, after testRun and command gates.
      // Conservative crisis bypass is not a crisis classifier or a guarantee of detection.
      if (isOwner(userId) || /(?:помо[гщ]|опасн|срочн|суицид|самоуб|убить себя|не хочу жить|насили|кров|боль|умира|пожар|издева|травл|без флирта|не флиртуй|без подкол|не называй|хватит)/iu.test(text)) return false;
      const state = await this.localState(userId, chatId);
      if (state.score >= -25 || state.blocked) return false;
      const impression = await this.impression(userId);
      const d = disposition({ ...impression, score: state.score, now: now(), chatId });
      return random() < d.ignoreChance;
    },
    async setRelationship({ actorId, userId, score, blocked }) {
      if (!isOwner(actorId) || !/^\d+$/.test(String(userId))) return { ok: false, code: "forbidden" };
      if (score != null && (!Number.isInteger(Number(score)) || Number(score) < -100 || Number(score) > 100)) return { ok: false, code: "invalid_score" };
      const row = await read(`ai:relationship:${userId}`) ?? {};
      const value = {
        ...row,
        ...(score == null ? {} : { affinityAt: now() }),
        score: isOwner(userId) ? 100 : score == null ? row.sympathy ?? row.score ?? 0 : Number(score),
        sympathy: isOwner(userId) ? 100 : score == null ? row.sympathy ?? row.score ?? 0 : Number(score),
        blocked: isOwner(userId) ? false : blocked == null ? Boolean(row.blocked) : Boolean(blocked),
      };
      const ok = await (Object.keys(row).length ? store.compareSet(`ai:relationship:${userId}`, row, value) : store.setIfAbsent(`ai:relationship:${userId}`, value));
      let vipRecheckPending = false;
      if (ok) { try { await onRelationshipChange({ userId, chatId: null }); } catch { vipRecheckPending = true; } }
      return { ok, ...value, vipRecheckPending };
    },
    async getNames() {
      return {
        primary: names(await read("ai:names:primary"), ["аи", "система"]),
        alternate: names(await read("ai:names:alternate"), ["ассистент", "помощник"]),
      };
    },
    async setNames({ actorId, kind, value }) {
      if (!isOwner(actorId) || !["primary", "alternate"].includes(kind)) return { ok: false, code: "forbidden" };
      const parsed = names(value, kind === "primary" ? ["аи", "система"] : ["ассистент", "помощник"]);
      if (!parsed) return { ok: false, code: "invalid_names" };
      return { ok: await store.set(`ai:names:${kind}`, parsed.join(",")), names: parsed };
    },
    async prompt({ userId, text, chatType, initialize = true }) {
      const state = await this.state(userId, { initialize });
      if (state.blocked) return { allowed: false, reason: "ai_calls_blocked" };
      const config = await this.getNames();
      const allowedNames = [...config.primary, ...(state.free ? config.alternate : [])].sort((a, b) => b.length - a.length);
      const trimmed = String(text).trim();
      const lower = trimmed.toLocaleLowerCase("ru-RU");
      for (const name of allowedNames) {
        if (!lower.startsWith(name)) continue;
        const suffix = trimmed.slice(name.length);
        if (!/^[\s,!:]/u.test(suffix)) continue;
        const prompt = suffix.replace(/^[\s,!:]+/u, "");
        return { allowed: Boolean(prompt), prompt, reason: "empty_ai_prompt" };
      }
      // Never reproduce the source bug that lets high-score users trigger AI
      // on every ordinary group message.
      return chatType === "private" && state.free
        ? { allowed: true, prompt: trimmed }
        : { allowed: false, reason: "invocation_required" };
    },
  });
}
