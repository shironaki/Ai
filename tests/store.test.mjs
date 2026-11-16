/**
 * Хранилище: правка поверх самого свежего значения (`update`). Письма и
 * нажатия приходят одновременно, каждое — своему запуску; правка одного не
 * должна затирать правку другого.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHeartStore } from "../tgcloud/lib/store.js";

/**
 * База в памяти. `counts: false` — не говорит, сколько строк тронула;
 * `conditional: "throws"` — условной замены не знает; `"blind"` — условная
 * замена никогда не совпадает (сравнивает не так, как ждём).
 */
function fakeDb({ counts = true, conditional = true } = {}) {
  const kv = new Map();
  const log = [];
  const touched = (n) => (counts ? { rowsAffected: n, lastInsertRowid: 0, rows: [] } : undefined);
  return {
    kv, log,
    async get(query, params = {}) {
      const value = kv.get(params[":key"]);
      return value === undefined ? null : { value };
    },
    async run(query, params = {}) {
      const key = params[":key"];
      if (query.startsWith("UPDATE kv_state SET value")) {
        log.push("update");
        if (conditional === "throws") throw new Error("near \"UPDATE\": syntax error");
        const hit = conditional === "blind" ? false : kv.get(key) === params[":before"];
        if (hit) kv.set(key, params[":value"]);
        return touched(hit ? 1 : 0);
      }
      if (query.includes("DO NOTHING")) {
        log.push("insert");
        if (kv.has(key)) return touched(0);
        kv.set(key, params[":value"]);
        return touched(1);
      }
      if (query.startsWith("INSERT INTO kv_state")) {
        log.push("set");
        kv.set(key, params[":value"]);
        return touched(1);
      }
      return touched(0);
    },
  };
}
const plusOne = (value) => ({ n: (Number(value?.n) || 0) + 1 });
const numberAt = (db, key) => JSON.parse(db.kv.get(key)).n;

test("update: сорок правок разом — ни одна не потеряна; и с пустого места, и поверх записи", async () => {
  const db = fakeDb();
  const store = createHeartStore({ db });
  // Строки ещё нет: первая правка её создаёт, остальные ложатся поверх.
  const first = await Promise.all(Array.from({ length: 40 }, () => store.update("k", plusOne)));
  assert.ok(first.every(Boolean));
  assert.equal(numberAt(db, "k"), 40);
  const second = await Promise.all(Array.from({ length: 40 }, () => store.update("k", plusOne)));
  assert.ok(second.every(Boolean));
  assert.equal(numberAt(db, "k"), 80);
  assert.ok(!db.log.includes("set"), "ни одной записи вслепую: только условные");

  // А «прочитал — записал» на той же базе теряет: поэтому update и нужен.
  await store.set("naive", { n: 0 });
  await Promise.all(Array.from({ length: 40 }, async () => store.set("naive", plusOne(await store.get("naive")))));
  assert.ok(numberAt(db, "naive") < 40, "без условной записи одновременные правки затирают друг друга");
});

test("update: «править нечего», ошибка в правке, испорченная запись — ничего не пишется", async () => {
  const db = fakeDb();
  const store = createHeartStore({ db });
  await store.set("k", { n: 5 });
  const before = db.kv.get("k");
  assert.equal(await store.update("k", () => null), false);
  assert.equal(await store.update("k", () => undefined), false);
  assert.equal(await store.update("k", () => { throw new Error("сломалась"); }), false);
  assert.equal(await store.update("k", "не функция"), false);
  assert.equal(db.kv.get("k"), before);
  db.kv.set("bad", "{не json");
  assert.equal(await store.update("bad", plusOne), false);
  assert.equal(db.kv.get("bad"), "{не json", "испорченную запись правка не затирает");
  // Правка видит именно то, что лежит; null — когда не лежит ничего.
  const seen = [];
  await store.update("k", (value) => { seen.push(value); return { n: value.n + 1, tag: "ё" }; });
  await store.update("new", (value) => { seen.push(value); return { n: 1 }; });
  assert.deepEqual(seen, [{ n: 5 }, null]);
  assert.deepEqual(JSON.parse(db.kv.get("k")), { n: 6, tag: "ё" });
  // Без базы — false, а не падение.
  assert.equal(await createHeartStore({}).update("k", plusOne), false);
});

test("update: база молчит о числе строк, не знает условной замены или сравнивает иначе — правка всё равно ложится", async () => {
  // Не говорит, сколько строк тронула: правка сверяется чтением. Потерь нет.
  const silent = fakeDb({ counts: false });
  const a = createHeartStore({ db: silent });
  for (let i = 0; i < 5; i += 1) assert.equal(await a.update("k", plusOne), true);
  assert.equal(numberAt(silent, "k"), 5);
  // Двенадцать разных правок разом — каждая кладёт в список своё: все на месте.
  const ids = Array.from({ length: 12 }, (_, index) => `гость-${index + 1}`);
  const add = (id) => (value) => ({ ...value, who: [...new Set([...(value?.who ?? []), id])] });
  assert.ok((await Promise.all(ids.map(id => a.update("k", add(id))))).every(Boolean));
  assert.deepEqual(JSON.parse(silent.kv.get("k")).who.sort(), [...ids].sort(), "ни одна из двенадцати не потеряна");

  // Условной замены нет вовсе: пишет по-старому, одной записью.
  const old = fakeDb({ conditional: "throws" });
  const b = createHeartStore({ db: old });
  await b.set("k", { n: 1 });
  assert.equal(await b.update("k", plusOne), true);
  assert.equal(await b.update("k", plusOne), true);
  assert.equal(numberAt(old, "k"), 3);

  // Условная замена есть, но не совпадает никогда: со второй попытки — по-старому, а не «никогда».
  const blind = fakeDb({ conditional: "blind" });
  const c = createHeartStore({ db: blind });
  await c.set("k", { n: 1 });
  blind.log.length = 0;
  assert.equal(await c.update("k", plusOne), true);
  assert.equal(numberAt(blind, "k"), 2);
  assert.deepEqual(blind.log, ["update", "set"], "одна условная попытка, затем обычная запись");
});
