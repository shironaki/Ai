/**
 * Силы: когда Аи устала.
 *
 * Слово владельца (16.11.2026): «если лимит запросов подходит к концу, то она
 * говорит, что утомилась или устала, и на последующие запросы отвечает уже
 * запасом или из своего словаря».
 *
 * Усталость — не поза, а счёт провайдера. Причин три:
 *   low   — у основной модели осталась десятая часть дневных запросов;
 *   limit — основная упёрлась в дневной лимит и отдыхает, отвечают запасные;
 *   spent — упёрлись все модели: остаётся словарь, вопросы ложатся в очередь.
 *
 * Что меняется, пока она устала: она говорит об этом (раз на чат за одну
 * усталость), настроение — «уставшее», ответы короче, людям сначала отвечают
 * запасные модели — остаток основной бережётся для хозяина. Хозяину отказа и
 * ожидания нет: его вопрос идёт к основной, пока та жива.
 *
 * Здесь только правила и слова; хранит и применяет сердце.
 */
export const TIRED_KEY = "heart:tired:v1";
/** Доля дневных запросов основной модели, с которой начинается усталость. */
export const LOW_SHARE = 0.1;
/** Сколько длится усталость «на исходе»: запас основной возвращается понемногу, через это время она проверяется заново. */
export const LOW_REST_MS = 3 * 3_600_000;
/** Срок, когда провайдер не сказал, когда лимит вернётся. */
export const UNKNOWN_REST_MS = 3_600_000;
/** Усталость не длится дольше суток, что бы ни сказал провайдер. */
const MAX_REST_MS = 24 * 3_600_000;
const RANK = Object.freeze({ low: 1, limit: 2, spent: 3 });

/** Мало ли осталось у модели: остаток и предел — из заголовков её ответа. */
export function runningLow(remaining, limit) {
  const left = Number(remaining), cap = Number(limit);
  return remaining != null && Number.isFinite(left) && cap > 0 && left / cap <= LOW_SHARE;
}

/** Запись об усталости действует? */
export function tiredNow(state, at = Date.now()) {
  return Boolean(state && RANK[state.why] && Number(state.until) > at);
}

/**
 * Новая запись поверх прежней. Одна усталость — одна запись: начало (`since`)
 * не сдвигается, пока она не отдохнула, иначе «я устала» звучало бы заново при
 * каждом ответе. Причина может только утяжеляться; срок — только расти.
 */
export function tire(before, { why, until = 0, model = "", left = null, cap = null } = {}, at = Date.now()) {
  if (!RANK[why]) return before ?? null;
  const end = Math.min(at + MAX_REST_MS, Number(until) > at ? Number(until) : at + (why === "low" ? LOW_REST_MS : UNKNOWN_REST_MS));
  if (!tiredNow(before, at)) return { why, since: at, until: end, model: String(model ?? ""), left, cap };
  const heavier = RANK[why] > RANK[before.why];
  return {
    ...before,
    why: heavier ? why : before.why,
    until: Math.max(Number(before.until) || 0, end),
    ...(model && heavier ? { model: String(model) } : {}),
    ...(left != null ? { left, cap } : {}),
  };
}

/** Строка для «статус»: что с её силами и до какого часа. */
export function staminaLine(state, { at = Date.now(), clock = (ms) => new Date(ms).toISOString().slice(11, 16) } = {}) {
  if (!tiredNow(state, at)) return "бодра";
  const model = state.model ? ` ${state.model}` : "";
  const left = state.left != null && state.cap ? `: осталось ${state.left} из ${state.cap} запросов` : "";
  const what = state.why === "spent" ? "выдохлась — у всех моделей вышел лимит; отвечаю из словаря, вопросы записываю"
    : state.why === "limit" ? `устала — у основной модели${model} вышел дневной лимит; отвечают запасные`
      : `устала — запас основной модели${model} на исходе${left}; людям отвечают запасные, вам — основная`;
  return `${what} · с ${clock(state.since)}, проверю себя в ${clock(state.until)}`;
}
