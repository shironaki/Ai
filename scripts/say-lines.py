#!/usr/bin/env python3
# Строки комнаты её голосом (идея 215; сообщение 82: «нельзя ли… чтоб все реплики словаря она озвучивала голосом?»,
# сообщение 83: «платное нам не нужно»). Собирает модули `miniapp/say/`: по модулю на строку словаря и указатель
# `index.js` (какие строки записаны). Запись — средством чата, голос владельца («голос 06 · высота +1.5 · темп 1.00 ·
# мягкость 3»); рецепт — тот же, что у коротких реплик (`scripts/voice-lines.py`, функции берутся оттуда).
#
#   python3 scripts/say-lines.py [папка записей …]
#   python3 scripts/say-lines.py --prune     убрать модули строк, которых в словаре больше нет (записи не нужны)
#
# Папки записей (по умолчанию `shots/golos/pilot` и `shots/golos/room`, вне репозитория): длинные записи — около
# двадцати строк подряд — и `asr.json`: { "<запись>.wav": [ { "text": строка, "a": начало речи, "b": конец речи
# (секунды) }, … ] }. Границы даёт распознавание речи (`shots/golos/tools/asr82.py`: Vosk, слова со временем, сверка
# с текстом строк): по паузам длинная запись на строки не делится — паузы между строками такие же, как внутри
# (docs/JOURNAL.md, «Проба деления длинной записи (ход 82)»). Разрез — в самом тихом месте между строками.
#
# В модули идут строки комнаты (запасы «+комната:…» в `PHRASES.txt`), кроме тех, что звучат, только когда она спит:
# спящая молчит (`maySay` в `miniapp/logic.js`). Строка должна слово в слово стоять в словаре — иначе страница её не
# найдёт: ключ строки считается по её тексту (`keyOf` в `index.js`). Строка, чья длина не сходится с числом слогов
# (вдвое против соседей), в модули не идёт: лучше промолчать, чем сказать не то. Нужны numpy и lameenc.
import sys, os, re, io, json, base64
from multiprocessing import Pool
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRUNE = "--prune" in sys.argv[1:]
SOURCES = [os.path.join(path, "") for path in ([arg for arg in sys.argv[1:] if arg != "--prune"] or [os.path.join(ROOT, "shots", "golos", "pilot"), os.path.join(ROOT, "shots", "golos", "room")])]
OUT = os.path.join(ROOT, "miniapp", "say", "")
# Число в шапке модулей — с какой сборки идёт их вид, а не «нынешняя сборка»: поменять его — и все записи изменятся
# и уйдут на платформу заново (десятки мегабайт с телефона). Не трогать без нужды.
BUILD = "0.68.0"
KBPS = 48
# Запасы, строки которых звучат, только когда она спит: в модули не идут.
ASLEEP = re.compile(r"^\+комната:(?:она:сон|.*:сон)$")

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
    """Строки комнаты, которые она может сказать вслух: без пометок, оба обращения («ты» и «вы»)."""
    out, pool = set(), None
    for line in io.open(os.path.join(ROOT, "PHRASES.txt"), encoding="utf-8").read().split("\n"):
        m = re.match(r"^== (.+?) ==\s*$", line)
        if m: pool = m.group(1); continue
        if not pool or not pool.startswith("+комната:") or ASLEEP.match(pool) or not line.strip() or line.startswith("#"): continue
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

vowels = lambda text: sum(text.lower().count(ch) for ch in "аеёиоуыэюяaeiouy")

def build(job):
    """Одна запись → её строки: (ключ, текст, мс, тон, mp3) и пропущенные с причиной."""
    path, lines, may = job
    r = 2 ** (PITCH / 12)
    x, rate, _ = read_wav(path)
    cuts = [quiet(x, rate, 0, float(lines[0]["a"]))]
    for i in range(len(lines) - 1): cuts.append(quiet(x, rate, float(lines[i]["b"]), float(lines[i + 1]["a"])))
    cuts.append(quiet(x, rate, float(lines[-1]["b"]) + 0.05, len(x) / rate))
    # Сколько секунд речи приходится на слог: у строки, которой достался чужой кусок записи, мера не сходится.
    per = [(float(line["b"]) - float(line["a"])) / max(1, vowels(line["text"])) for line in lines]
    typical = float(np.median(per))
    done, skipped = [], []
    for i, line in enumerate(lines):
        text = line["text"]
        if text not in may: skipped.append((text, "спящая молчит или строки нет в словаре")); continue
        if not 0.5 * typical < per[i] < 2.0 * typical: skipped.append((text, f"длина не сходится со слогами: {per[i] / typical:.2f} от обычной")); continue
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
        f0 = pitch(y, RATE)
        done.append((key_of(text), text, int(round(len(y) / RATE * 1000)), round(float(np.median(f0))) if len(f0) else 0, mp3(y, RATE, KBPS)))
    return os.path.basename(path), done, skipped

def write_index(index):
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

def prune():
    """Строку словаря изменили или убрали — её запись осталась без текста: модуль прочь, указатель — заново."""
    may, index, gone = allowed(), {}, []
    for name in sorted(os.listdir(OUT)):
        if name == "index.js" or not name.endswith(".js"): continue
        found = re.search(r'text: ("(?:[^"\\]|\\.)*"), ms: (\d+),', io.open(OUT + name, encoding="utf-8").read(400))
        text = json.loads(found.group(1)) if found else ""
        if found and text in may and key_of(text) == name[:-3]: index[name[:-3]] = int(found.group(2))
        else: gone.append(text or name); os.remove(OUT + name)
    write_index(index)
    print(f"строк осталось {len(index)}; убрано {len(gone)}" + "".join(f"\n   убрана: {text[:70]}" for text in gone))

def main():
    may = allowed()
    jobs = []
    for src in SOURCES:
        for clip, lines in json.load(io.open(src + "asr.json", encoding="utf-8")).items(): jobs.append((src + os.path.basename(clip), lines, may))
    with Pool(2) as pool: results = sorted(pool.imap_unordered(build, jobs), key=lambda item: item[0])
    os.makedirs(OUT, exist_ok=True)
    for name in os.listdir(OUT):
        if name.endswith(".js"): os.remove(OUT + name)
    index, total, tones = {}, 0, []
    for clip, done, skipped in results:
        for key, text, ms, tone, data in done:
            if key in index: print(f"  повтор строки, вторая запись не идёт: {text}"); continue
            index[key] = ms; total += len(data); tones.append(tone)
            io.open(f"{OUT}{key}.js", "w", encoding="utf-8").write(
                f"// Строка Аи «{text}»: её голос (сборка {BUILD}), собрана командой «python3 scripts/say-lines.py». Руками не править.\n"
                f"export default {{ text: {json.dumps(text, ensure_ascii=False)}, ms: {ms}, src: \"data:audio/mpeg;base64,{base64.b64encode(data).decode()}\" }};\n")
        print(f"{clip}: строк {len(done)}, пропущено {len(skipped)}")
        for text, why in skipped: print(f"   пропущена ({why}): {text[:70]}")
    write_index(index)
    print(f"строк {len(index)}; звука {sum(index.values()) / 1000:.0f} с; mp3 {total} Б; модулей {sum(os.path.getsize(OUT + f) for f in os.listdir(OUT))} Б; тон {min(tones)}–{max(tones)} Гц, медиана {int(np.median(tones))}")

if __name__ == "__main__": prune() if PRUNE else main()
