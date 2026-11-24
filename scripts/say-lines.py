#!/usr/bin/env python3
# Строки комнаты её голосом (0.67.0, идея 215; сообщение 82: «нельзя ли… чтоб все реплики словаря она озвучивала
# голосом?», сообщение 83: «платное нам не нужно»). Собирает модули `miniapp/say/`: по модулю на строку словаря и
# указатель `index.js` (какие строки записаны). Запись — средством чата, голос владельца («голос 06 · высота +1.5 ·
# темп 1.00 · мягкость 3»); рецепт — тот же, что у коротких реплик (`scripts/voice-lines.py`, функции берутся оттуда).
#
#   python3 scripts/say-lines.py [папка записей] [папка модулей]
#
# Папка записей (по умолчанию `shots/golos/pilot`, вне репозитория): длинные записи — около двадцати строк подряд — и
# `asr.json`: { "<запись>.wav": [ { "text": строка, "a": начало речи, "b": конец речи (секунды) }, … ] }. Границы даёт
# распознавание речи (`shots/golos/tools/asr82.py`: Vosk, слова со временем, сверка с текстом строк): по паузам
# длинная запись на строки не делится — паузы между строками такие же, как внутри (docs/JOURNAL.md, «Проба деления
# длинной записи (ход 82)»). Разрез — в самом тихом месте между строками.
#
# В модули идут только строки, которые она может сказать вслух: её реплики о занятии в состояниях «дело», «уют»,
# «игра», «устала» (спит, обижена, ревнует — молчит: `voiceFor` в `miniapp/logic.js`). Строка должна слово в слово
# стоять в `PHRASES.txt` — иначе страница её не найдёт: ключ строки считается по её тексту (`keyOf` в `index.js`).
# Нужны numpy и lameenc.
import sys, os, re, io, json, base64
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "shots", "golos", "pilot"), "")
OUT = os.path.join(sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "miniapp", "say"), "")
BUILD = "0.67.0"
KBPS = 48
POOLS = ["+комната:она:дело", "+комната:она:уют", "+комната:она:игра", "+комната:она:устала"]

# Рецепт — из сборщика коротких реплик: его функции и числа (всё, что стоит до разбора записей).
_src = io.open(os.path.join(ROOT, "scripts", "voice-lines.py"), encoding="utf-8").read()
_ns = {"__file__": os.path.join(ROOT, "scripts", "voice-lines.py"), "__name__": "voice_lines"}
_argv, sys.argv = sys.argv, sys.argv[:1]
try: exec(compile(_src[:_src.index("\nSKIP = ")], "voice-lines.py", "exec"), _ns)
finally: sys.argv = _argv
read_wav, pitch, resample, wsola, shelf, mp3 = (_ns[name] for name in ("read_wav", "pitch", "resample", "wsola", "shelf", "mp3"))
PITCH, TEMPO, SOFT, RATE = _ns["PITCH"], _ns["TEMPO"], _ns["SOFT"], _ns["RATE"]

def key_of(text):
    """Ключ строки — тот же счёт, что `keyOf` в `miniapp/say/index.js`: буквы и цифры в нижнем регистре, FNV-1a."""
    plain = re.sub(r"[\W_]+", " ", text.lower().replace("ё", "е")).strip()
    h = 0x811c9dc5
    for ch in plain: h = ((h ^ ord(ch)) * 16777619) & 0xffffffff
    return "l%08x" % h

def allowed():
    """Строки словаря, которые она может сказать вслух: без пометок, оба обращения («ты» и «вы»)."""
    out, pool = set(), None
    for line in io.open(os.path.join(ROOT, "PHRASES.txt"), encoding="utf-8").read().split("\n"):
        m = re.match(r"^== (.+?) ==\s*$", line)
        if m: pool = m.group(1); continue
        if pool not in POOLS or not line.strip() or line.startswith("#"): continue
        text = re.sub(r"^(\[[^\]]+\]\s*)+", "", line)
        for pick in (1, 2): out.add(re.sub(r"\{([^{}|]*)\|([^{}]*)\}", lambda m, pick=pick: m.group(pick), text))
    return out

def quiet(x, rate, t0, t1):
    """Самое тихое место между t0 и t1 (секунды): середина самых тихих 30 мс."""
    a, b = int(max(0, t0) * rate), int(min(len(x) / rate, t1) * rate)
    if b - a < int(rate * 0.04): return (a + b) // 2
    win = int(rate * 0.03)
    e = np.convolve(x[a:b] ** 2, np.ones(win) / win, mode="valid")
    return a + int(np.argmin(e)) + win // 2

def main():
    asr = json.load(io.open(SRC + "asr.json", encoding="utf-8"))
    may, r = allowed(), 2 ** (PITCH / 12)
    os.makedirs(OUT, exist_ok=True)
    for name in os.listdir(OUT):
        if name.endswith(".js"): os.remove(OUT + name)
    index, rows, skipped = {}, [], []
    for clip, lines in asr.items():
        x, rate, _ = read_wav(SRC + os.path.basename(clip))
        cuts = [quiet(x, rate, 0, float(lines[0]["a"]))]
        for i in range(len(lines) - 1): cuts.append(quiet(x, rate, float(lines[i]["b"]), float(lines[i + 1]["a"])))
        cuts.append(quiet(x, rate, float(lines[-1]["b"]) + 0.05, len(x) / rate))
        for i, line in enumerate(lines):
            text = line["text"]
            if text not in may: skipped.append(text); continue
            seg = x[cuts[i]:cuts[i + 1]].copy()
            loud = np.where(np.abs(seg) > 0.02 * np.max(np.abs(seg)))[0]
            seg = seg[max(0, loud[0] - int(rate * 0.04)):min(len(seg), loud[-1] + int(rate * 0.12))]
            stretched = wsola(seg, TEMPO / r, rate)
            y = shelf(resample(stretched, int(round(len(stretched) / r))), rate, -SOFT)
            if rate != RATE: y = resample(y, int(round(len(y) * RATE / rate)))
            y = y - np.mean(y)
            hop = int(RATE * 0.02)
            frames = np.array([np.sqrt(np.mean(y[k:k + hop] ** 2)) for k in range(0, len(y) - hop, hop)])
            active = float(np.sqrt(np.mean(frames[frames > 0.1 * frames.max()] ** 2)))
            y = y * min(0.11 / active, 0.85 / np.max(np.abs(y)))
            fade_in, fade_out = int(RATE * 0.012), int(RATE * 0.06)
            y[:fade_in] *= np.linspace(0, 1, fade_in); y[-fade_out:] *= np.linspace(1, 0, fade_out)
            data, ms, key = mp3(y, RATE, KBPS), int(round(len(y) / RATE * 1000)), key_of(text)
            assert key not in index, f"два текста с одним ключом: {text}"
            f0 = pitch(y, RATE)
            index[key] = ms
            io.open(f"{OUT}{key}.js", "w", encoding="utf-8").write(
                f"// Строка Аи «{text}»: её голос (сборка {BUILD}), собрана командой «python3 scripts/say-lines.py». Руками не править.\n"
                f"export default {{ text: {json.dumps(text, ensure_ascii=False)}, ms: {ms}, src: \"data:audio/mpeg;base64,{base64.b64encode(data).decode()}\" }};\n")
            rows.append((key, ms, round(float(np.median(f0))) if len(f0) else 0, len(data), text))
    table = ", ".join(f"{key}: {ms}" for key, ms in sorted(index.items()))
    io.open(OUT + "index.js", "w", encoding="utf-8").write(
        f"// Строки комнаты её голосом (сборка {BUILD}, идея 215): какие строки записаны и сколько длится каждая, мс. Собран командой «python3 scripts/say-lines.py». Руками не править.\n"
        f"export const SAID = Object.freeze({{ {table} }});\n"
        "/** Ключ строки: буквы и цифры в нижнем регистре, FNV-1a — тот же счёт, что `key_of` в `scripts/say-lines.py`. */\n"
        "export function keyOf(text) {\n"
        "  const plain = String(text ?? \"\").toLowerCase().replace(/ё/gu, \"е\").replace(/[^\\p{L}\\p{N}]+/gu, \" \").trim();\n"
        "  let hash = 0x811c9dc5;\n"
        "  for (let at = 0; at < plain.length; at += 1) hash = Math.imul(hash ^ plain.charCodeAt(at), 16777619) >>> 0;\n"
        "  return `l${hash.toString(16).padStart(8, \"0\")}`;\n"
        "}\n"
        "/** Имя модуля с записью этой строки; записи нет — пустая строка: она промолчит. */\n"
        "export const nameOf = (text) => { const key = keyOf(text); return Object.hasOwn(SAID, key) ? key : \"\"; };\n")
    for row in rows: print("  %s  %5d мс  %3d Гц  mp3 %5d Б  %s" % row)
    print(f"строк {len(rows)}; mp3 {sum(row[3] for row in rows)} Б; модулей {sum(os.path.getsize(OUT + f) for f in os.listdir(OUT))} Б; пропущено (не говорит вслух или нет в словаре): {len(skipped)}")

if __name__ == "__main__": main()
