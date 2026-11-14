import { heart, message, reset, last, sdk, KEY, calls } from "./fixtures/kit.mjs";
const list = process.argv.slice(2).join(" ").split("|").map(s => s.trim()).filter(Boolean);
for (const p of list) {
  reset();
  const h = heart({ PHRASES: false });
  let r; try { r = await h.onMessage(message(p), KEY); } catch (e) { r = { err: String(e).slice(0, 80) }; }
  const fetched = sdk().fetches.length;
  console.log(`${p} → action=${r?.action ?? r?.code ?? JSON.stringify(r).slice(0,60)} model=${fetched} react=${calls("setMessageReaction").length} :: ${String(last()).replace(/\n/g, " ").slice(0, 90)}`);
}
