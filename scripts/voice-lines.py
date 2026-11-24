#!/usr/bin/env python3
"""
Реплики её голосом для комнаты (сборка 0.64.0, идея 211): из записей — модули `miniapp/voice/<имя>.js`.

Голос выбрал владелец на слух (сообщение 80): «голос 06 · высота +1.5 · темп 1.00 · мягкость 3». Голос 06 — один из
голосов средства чата, которым агент записывает речь (`generate_speech`, `voice-06`); в другом чате этого голоса нет,
поэтому новые реплики тем же голосом записать можно только там же. Что здесь делается с записью:

  запись (WAV, по две реплики через пустую строку) → деление по паузе → длина без смены высоты (`wsola`) →
  пересчёт частоты (`resample`: высота и форманты вместе) → полка верхних частот (как `highshelf` браузера) →
  громкость к одному уровню → mp3 (64 кбит/с, моно) → модуль `export default { text, ms, src }`.

Запуск (нужны numpy и lameenc: `pip install --target /tmp/piper/py numpy lameenc`):

  PYTHONPATH=/tmp/piper/py python3 scripts/voice-lines.py [папка с записями] [папка модулей]

По умолчанию записи берутся из `shots/golos/lines/` (в репозиторий не идут), модули пишутся в `miniapp/voice/`.
Что получилось — печатается: длины, тон, вес; замечания — отдельной строкой. Слушать может только человек.
"""
import sys, os, struct, json, base64
import numpy as np
import lameenc

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "shots", "golos", "lines"), "")
OUT = os.path.join(sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "miniapp", "voice"), "")
PITCH, TEMPO, SOFT = 1.5, 1.00, 3.0
RATE = 44100
CLIPS = [
    ("c01", [("morning", "Доброе утро."), ("day", "Добрый день.")]),
    ("c02", [("evening", "Добрый вечер."), ("night", "Доброй ночи.")]),
    ("c03", [("thanks", "Спасибо."), ("nice", "Как приятно.")]),
    ("c04", [("glad", "Я рада."), ("pleased", "Мне очень приятно.")]),
    ("c05", [("tea", "Спасибо за чай."), ("tasty", "Какой вкусный чай.")]),
    ("c06", [("pretty", "Очень красиво."), ("grateful", "Спасибо большое.")]),
    # В этой записи после обращения «Байт,» пауза длиннее, чем между репликами: делится посередине (вторая пауза из трёх).
    ("c07", [("come", "Байт, иди сюда."), ("called", "Байт, тебя зовут.")], [1]),
    ("c08", [("catglad", "Байт доволен."), ("catthanks", "Байт, скажи спасибо.")]),
    ("c09", [("awake", "Я уже не сплю."), ("goodnight", "Спокойной ночи.")]),
    ("c10", [("back", "С возвращением."), ("plant", "Цветок теперь доволен.")]),
]

def read_wav(path):
    data = open(path, "rb").read()
    assert data[:4] == b"RIFF" and data[8:12] == b"WAVE", data[:12]
    at, fmt, pcm = 12, None, None
    while at + 8 <= len(data):
        cid, size = data[at:at + 4], struct.unpack("<I", data[at + 4:at + 8])[0]
        body = data[at + 8:at + 8 + size]
        if cid == b"fmt ":
            tag, ch, rate, _, _, bits = struct.unpack("<HHIIHH", body[:16])
            if tag == 65534: tag = struct.unpack("<H", body[24:26])[0]
            fmt = (tag, ch, rate, bits)
        elif cid == b"data":
            pcm = body if size and size != 0xFFFFFFFF else data[at + 8:]
        at += 8 + size + (size & 1)
    tag, ch, rate, bits = fmt
    if tag == 1 and bits == 16: x = np.frombuffer(pcm[:len(pcm) // 2 * 2], dtype="<i2").astype(np.float64) / 32768
    elif tag == 1 and bits == 24:
        raw = np.frombuffer(pcm[:len(pcm) // 3 * 3], dtype=np.uint8).reshape(-1, 3)
        x = ((raw[:, 0].astype(np.int32) | (raw[:, 1].astype(np.int32) << 8) | (raw[:, 2].astype(np.int8).astype(np.int32) << 16))).astype(np.float64) / 8388608
    elif tag == 1 and bits == 32: x = np.frombuffer(pcm[:len(pcm) // 4 * 4], dtype="<i4").astype(np.float64) / 2147483648
    elif tag == 3 and bits == 32: x = np.frombuffer(pcm[:len(pcm) // 4 * 4], dtype="<f4").astype(np.float64)
    else: raise SystemExit(f"неизвестный формат: {fmt}")
    if ch > 1: x = x[:len(x) // ch * ch].reshape(-1, ch).mean(axis=1)
    return x, rate, fmt

def pitch(x, rate, lo=120, hi=450):
    """Медиана и разброс основного тона по звонким кадрам (автокорреляция)."""
    frame, hop = int(rate * 0.04), int(rate * 0.01)
    out = []
    peak = np.max(np.abs(x)) or 1
    for start in range(0, len(x) - frame, hop):
        seg = x[start:start + frame]
        if np.sqrt(np.mean(seg ** 2)) < 0.04 * peak: continue
        seg = seg - seg.mean()
        ac = np.correlate(seg, seg, "full")[frame - 1:]
        if ac[0] <= 0: continue
        a, b = int(rate / hi), int(rate / lo)
        lag = a + int(np.argmax(ac[a:b]))
        if ac[lag] / ac[0] < 0.45: continue
        out.append(rate / lag)
    return np.array(out)

def resample(x, n_out):
    """Пересчёт на другую длину без наложения частот (через спектр)."""
    n_in = len(x)
    spec = np.fft.rfft(x)
    m = n_out // 2 + 1
    out = np.zeros(m, dtype=complex)
    k = min(len(spec), m)
    out[:k] = spec[:k]
    return np.fft.irfft(out, n_out) * (n_out / n_in)

def wsola(x, speed, rate, frame_ms=40, seek_ms=12):
    """Темп без смены высоты: speed > 1 — быстрее. Склейка окнами с поиском лучшего совпадения."""
    if abs(speed - 1) < 0.01: return x.copy()
    frame = int(rate * frame_ms / 1000) // 2 * 2
    hop_out = frame // 2
    hop_in = hop_out * speed
    seek = int(rate * seek_ms / 1000)
    window = np.hanning(frame + 1)[:frame]
    n_frames = int((len(x) - frame - seek) / hop_in) - 1
    if n_frames < 2: return x.copy()
    y = np.zeros(n_frames * hop_out + frame)
    norm = np.zeros_like(y)
    pos = 0
    y[:frame] += x[:frame] * window
    norm[:frame] += window
    for index in range(1, n_frames):
        want = int(round(index * hop_in))
        natural = x[pos + hop_out:pos + hop_out + frame]          # как звук шёл бы дальше сам
        a, b = max(0, want - seek), min(len(x) - frame, want + seek)
        best, score = want, -1e30
        if len(natural) == frame:
            ref = natural[:hop_out]
            for cand in range(a, b, 2):
                seg = x[cand:cand + hop_out]
                s = float(np.dot(ref, seg)) / (np.sqrt(float(np.dot(seg, seg))) + 1e-9)
                if s > score: best, score = cand, s
        pos = best
        at = index * hop_out
        y[at:at + frame] += x[pos:pos + frame] * window
        norm[at:at + frame] += window
    norm[norm < 1e-3] = 1
    return y / norm

vowels = lambda text: sum(text.lower().count(ch) for ch in "аеёиоуыэюя")
def runs(x, rate, floor=0.025):
    """Отрезки речи и пауз по огибающей: список (громко?, начало, конец) в отсчётах."""
    hop = int(rate * 0.01)
    peak = np.max(np.abs(x)) or 1
    loud = [np.sqrt(np.mean(x[i:i + hop] ** 2)) > floor * peak for i in range(0, len(x) - hop, hop)]
    out, start = [], 0
    for index in range(1, len(loud) + 1):
        if index == len(loud) or loud[index] != loud[start]:
            out.append((loud[start], start * hop, index * hop)); start = index
    return out
def shelf(x, rate, gain_db, f0=3500.0):
    """Полка верхних частот — та же, что `highshelf` браузера (по амплитуде; фаза не трогается)."""
    if not gain_db: return x
    A = 10 ** (gain_db / 40); w0 = 2 * np.pi * f0 / rate; alpha = np.sin(w0) / 2 * np.sqrt(2); c = np.cos(w0); s = 2 * np.sqrt(A) * alpha
    b = [A * ((A + 1) + (A - 1) * c + s), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - s)]
    a = [(A + 1) - (A - 1) * c + s, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - s]
    w = 2 * np.pi * np.fft.rfftfreq(len(x), 1 / rate) / rate
    z = np.exp(-1j * w)
    H = (b[0] + b[1] * z + b[2] * z ** 2) / (a[0] + a[1] * z + a[2] * z ** 2)
    return np.fft.irfft(np.fft.rfft(x) * np.abs(H), len(x))
def mp3(x, rate, kbps=64):
    enc = lameenc.Encoder(); enc.set_bit_rate(kbps); enc.set_in_sample_rate(rate); enc.set_channels(1); enc.set_quality(2)
    return bytes(enc.encode((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes()) + enc.flush())
os.makedirs(OUT, exist_ok=True)
report, bad = [], []
r = 2 ** (PITCH / 12)
# «Как приятно» вышла заметно выше остальных (324 Гц против 222–296): в первый набор не идёт.
SKIP = {"nice"}
for clip, lines, *forced in CLIPS:
    x, rate, fmt = read_wav(f"{SRC}{clip}.wav")
    parts = runs(x, rate)
    # Короткие провалы внутри слова (смычки «п», «т», «к») — не паузы: склеить всё, что короче 120 мс.
    speech = [(a, b) for loud, a, b in parts if loud]
    merged = [list(speech[0])]
    for a, b in speech[1:]:
        if a - merged[-1][1] < int(rate * 0.12): merged[-1][1] = b
        else: merged.append([a, b])
    gaps = sorted(((merged[i + 1][0] - merged[i][1]) / rate, i) for i in range(len(merged) - 1))
    if len(gaps) < len(lines) - 1: bad.append(f"{clip}: пауз {len(gaps)} — меньше, чем нужно"); continue
    cut = forced[0] if forced else sorted(i for _, i in gaps[-(len(lines) - 1):])
    print(f"  {clip}: куски речи {[round((b - a) / rate, 2) for a, b in merged]}, паузы {[round((merged[i + 1][0] - merged[i][1]) / rate, 2) for i in range(len(merged) - 1)]}, деление после куска {cut}")
    longest, second = gaps[-1][0], (gaps[-2][0] if len(gaps) > 1 else 0.0)
    bounds, start = [], 0
    for i in cut + [len(merged) - 1]:
        bounds.append((merged[start][0], merged[i][1])); start = i + 1
    spans = [(b - a) / rate for a, b in bounds]
    per = [span / max(1, vowels(text)) for span, (_, text) in zip(spans, lines)]
    note = ""
    if longest < 0.28: note += " ПАУЗА КОРОТКА"
    if second and longest < 1.6 * second and not forced and len(merged) != 3: note += " ПАУЗЫ ПОХОЖИ"
    if max(per) / min(per) > 1.9: note += " ДЛИНЫ НЕ СХОДЯТСЯ СО СЛОГАМИ"
    if note: bad.append(f"{clip}:{note}")
    for (name, text), (a, b), span in zip(lines, bounds, spans):
        if name in SKIP:
            if os.path.exists(f"{OUT}{name}.js"): os.remove(f"{OUT}{name}.js")
            continue
        seg = x[max(0, a - int(rate * 0.05)):min(len(x), b + int(rate * 0.14))].copy()
        stretched = wsola(seg, TEMPO / r, rate)
        y = resample(stretched, int(round(len(stretched) / r)))
        y = shelf(y, rate, -SOFT)
        if rate != RATE: y = resample(y, int(round(len(y) * RATE / rate)))
        y = y - np.mean(y)
        hop = int(RATE * 0.02)
        frames = np.array([np.sqrt(np.mean(y[i:i + hop] ** 2)) for i in range(0, len(y) - hop, hop)])
        active = float(np.sqrt(np.mean(frames[frames > 0.1 * frames.max()] ** 2)))
        y = y * min(0.11 / active, 0.85 / np.max(np.abs(y)))
        fade_in, fade_out = int(RATE * 0.012), int(RATE * 0.06)
        y[:fade_in] *= np.linspace(0, 1, fade_in); y[-fade_out:] *= np.linspace(1, 0, fade_out)
        data = mp3(y, RATE)
        ms = int(round(len(y) / RATE * 1000))
        f0 = pitch(y, RATE)
        tone = float(np.median(f0)) if len(f0) else 0.0
        open(f"{OUT}{name}.js", "w", encoding="utf-8").write(
            f"// Реплика Аи «{text}»: её голос (сборка 0.64.0), собрана записью и рецептом из docs/JOURNAL.md, раздел «Поиск её голоса». Руками не править.\n"
            f"export default {{ text: {json.dumps(text, ensure_ascii=False)}, ms: {ms}, src: \"data:audio/mpeg;base64,{base64.b64encode(data).decode()}\" }};\n")
        report.append((name, text, clip, round(span, 2), ms, round(tone), len(data), round(float(np.max(np.abs(y))), 2)))
    print(f"{clip}: {fmt[2]} Гц, {len(x) / rate:.2f} с; речь {len(merged)} кусками; паузы: самая длинная {longest:.2f} с, вторая {second:.2f} с; длины {[round(s, 2) for s in spans]}, на слог {[round(p, 3) for p in per]}{note}")
print()
for row in report: print("  %-10s %-26s %s  речь %.2f с  запись %4d мс  тон %3d Гц  mp3 %5d Б  пик %.2f" % row)
print(f"\nреплик {len(report)}; всего mp3 {sum(row[6] for row in report)} Б; модулей {sum(os.path.getsize(OUT + f) for f in os.listdir(OUT))} Б")
print("ЗАМЕЧАНИЯ:", bad if bad else "нет")
