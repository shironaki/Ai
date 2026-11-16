/**
 * Документы — часть выпуска.
 *
 * Новый чат разработки начинает с нуля и знает о проекте только то, что написано в
 * репозитории. 16.11.2026, перед слиянием первого чата, нашлось: два файла велели
 * «читать себя первым» и расходились, список открытых вопросов отстал на восемь
 * сборок, а в шапке «что дальше» стояло давно сделанное. Здесь — то, что можно
 * сторожить кодом: документы названы и связаны, ссылки не висят, а шапки, по которым
 * новый чат узнаёт «где мы сейчас», сверены с текущей сборкой.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { BUILD } from "./fixtures/kit.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8");
const DOCS = ["AGENTS.md", "README.md", "PROJECT.md", ...readdirSync(new URL("docs/", ROOT)).filter(name => name.endsWith(".md")).sort().map(name => `docs/${name}`)];
const escaped = BUILD.replaceAll(".", "\\.");

test("документы: ни одна ссылка на файл не висит", () => {
  for (const doc of DOCS) {
    for (const found of read(doc).matchAll(/\]\((?!https?:|mailto:|tg:|#)([^)#\s]+)(?:#[^)]*)?\)/gu)) {
      assert.ok(existsSync(new URL(found[1], new URL(doc, ROOT))), `${doc}: ссылка «${found[1]}» никуда не ведёт`);
    }
  }
});

test("AGENTS.md — точка входа: называет каждый документ, а пути, которые он называет, существуют", () => {
  const agents = read("AGENTS.md");
  for (const doc of DOCS.filter(name => name !== "AGENTS.md")) assert.ok(agents.includes(`(${doc})`), `AGENTS.md не ведёт к ${doc}: новый чат о нём не узнает`);
  for (const name of ["PHRASES.txt", "SKILLS.txt", "scripts/say.mjs", "scripts/verify.sh", "scripts/phone.sh"]) assert.ok(agents.includes(`\`${name}\``), `AGENTS.md не называет ${name}`);
  for (const found of agents.matchAll(/`((?:tgcloud|scripts|tests|docs)\/[A-Za-z0-9_.\/-]+)`/gu)) {
    assert.ok(existsSync(new URL(found[1], ROOT)), `AGENTS.md называет «${found[1]}», а такого пути нет`);
  }
  // Остальные входы ведут к нему же, а не спорят с ним.
  assert.match(read("README.md"), /начать с\n?\s*\[AGENTS\.md\]\(AGENTS\.md\)/u);
  assert.match(read("PROJECT.md"), /начинает не отсюда, а с \[AGENTS\.md\]\(AGENTS\.md\)/u);
  assert.match(read("docs/JOURNAL.md"), /\[AGENTS\.md\]\(\.\.\/AGENTS\.md\)/u);
});

test("«где мы сейчас»: передача в журнале, реестр идей и список живой проверки сверены с этой сборкой", () => {
  const journal = read("docs/JOURNAL.md");
  assert.match(journal, new RegExp(`^## Передача в новый чат \\(состояние на ${escaped}, \\d\\d\\.\\d\\d\\.\\d{4}\\)$`, "mu"), "шапка «Передача в новый чат» в docs/JOURNAL.md называет другую сборку");
  assert.match(journal, new RegExp(`^### Сборка ${escaped} — `, "mu"), "в docs/JOURNAL.md нет раздела об этой сборке");
  assert.match(read("docs/IDEAS.md"), new RegExp(`^Состояние на сборку \\*\\*${escaped}\\*\\*`, "mu"), "шапка docs/IDEAS.md называет другую сборку");
  // Список «что проверить» пишется на сборку X.Y.0; правки X.Y.1 дописываются в него же.
  const minor = BUILD.split(".").slice(0, 2).join("\\.");
  assert.match(read("docs/PHONE.md"), new RegExp(`^\\*\\*Что проверить после ${minor}\\.\\d+\\*\\*`, "mu"), "в docs/PHONE.md нет списка живой проверки для этой сборки");
  // Разделы, на которые ссылается точка входа, на месте — под теми же названиями.
  for (const heading of ["## Владелец и как с ним работать", "## Постоянные решения владельца", "## Хронология", "## Не проверено вживую", "## Уроки: что нельзя повторять"]) assert.ok(journal.includes(`\n${heading}\n`), `в журнале нет раздела «${heading}»`);
  const ideas = read("docs/IDEAS.md");
  for (const heading of ["## Открытые вопросы к владельцу", "## Что из прошлых идей не сделано", "## Порядок следующих блоков"]) assert.ok(ideas.includes(`\n${heading}`), `в реестре идей нет раздела «${heading}»`);
});

test("проба и проверка разработчика лежат в репозитории и названы в package.json", () => {
  const scripts = JSON.parse(read("package.json")).scripts;
  assert.equal(scripts.say, "node scripts/say.mjs");
  assert.equal(scripts.verify, "bash scripts/verify.sh");
  assert.match(read("scripts/verify.sh"), /no-undef/u, "eslint с правилом no-undef — обязательная часть проверки");
});
