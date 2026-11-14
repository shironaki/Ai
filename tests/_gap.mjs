import { createPhrasebook } from "../tgcloud/lib/phrasebook.js";
const book = createPhrasebook();
const list = process.argv.slice(2).join(" ").split("|").map(s => s.trim()).filter(Boolean);
const miss = [], hit = [];
for (const p of list) { const m = book.match(p); (m ? hit : miss).push(m ? `${p}→${m.join("+")}` : p); }
console.log("MISS:", miss.join(" | "));
console.log("HIT:", hit.join(" | "));
