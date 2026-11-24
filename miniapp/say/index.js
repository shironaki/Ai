// Строки комнаты её голосом (сборка 0.67.0, идея 215): какие строки записаны и сколько длится каждая, мс. Собран командой «python3 scripts/say-lines.py». Руками не править.
export const SAID = Object.freeze({ l0acc3b80: 6511, l1314cbc6: 4292, l1e465982: 4860, l3a9ac141: 4622, l423216b9: 5539, l4ee724af: 4292, l56211f48: 4970, l639f9941: 3815, l670365ed: 5575, l6d8bbf7b: 3705, l777ca3ff: 3888, lb1d9f0ee: 2824, lbbeb4804: 5630, lbed60a95: 6107, lc397621a: 6951, lcd40d02e: 5649, ld3aa8956: 3008, ldef12fdc: 4897, ledb68f05: 3888 });
/** Ключ строки: буквы и цифры в нижнем регистре, FNV-1a — тот же счёт, что `key_of` в `scripts/say-lines.py`. */
export function keyOf(text) {
  const plain = String(text ?? "").toLowerCase().replace(/ё/gu, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  let hash = 0x811c9dc5;
  for (let at = 0; at < plain.length; at += 1) hash = Math.imul(hash ^ plain.charCodeAt(at), 16777619) >>> 0;
  return `l${hash.toString(16).padStart(8, "0")}`;
}
/** Имя модуля с записью этой строки; записи нет — пустая строка: она промолчит. */
export const nameOf = (text) => { const key = keyOf(text); return Object.hasOwn(SAID, key) ? key : ""; };
