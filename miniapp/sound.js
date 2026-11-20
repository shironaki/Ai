/**
 * Звук комнаты (сборки 0.41.0 и 0.44.0): то, что за окном, и отклик на заботу. Файлов со звуком нет: шум и тон делает сам
 * телефон (Web Audio) — страница от этого не тяжелеет, а дождь не повторяется по кругу.
 *
 * Модуль грузится, только когда звук включили: кто его не включал, тот его и не качает. `createSound()` — `null`,
 * если браузер звука не умеет; иначе:
 *   on(sky)    — включить и пустить фон: «rain» — дождь, «storm» — гроза (дождь гуще и дальний гром), «snow» —
 *                тихий ветер, «calm» — сухая погода: тихая комната, еле слышный город; обещание — пошёл ли звук;
 *   off()      — выключить;
 *   play(name) — короткий отклик: purr (мурчание), pour (льётся чай), crunch (корм), drip (вода), toy (игра),
 *                pat (погладили её);
 *   state()    — «running» (звучит), «suspended» (телефон держит звук до нажатия) или «off».
 * Звук начинается только с нажатия человека: так устроены телефоны.
 */
export function createSound() {
  const Engine = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (typeof Engine !== "function") return null;
  let ctx = null, master = null, bed = null;
  const LEVEL = 0.5;

  /** Две секунды шума по кругу: белый (шелест) или «бурый» (низкий гул). */
  const noise = (brown = false) => {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      const white = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * white) / 1.02; data[i] = last * 3.5; } else data[i] = white;
    }
    const node = ctx.createBufferSource();
    node.buffer = buffer; node.loop = true;
    return node;
  };
  const filter = (type, frequency, q = 0.7) => { const node = ctx.createBiquadFilter(); node.type = type; node.frequency.value = frequency; node.Q.value = q; return node; };
  const gain = (value) => { const node = ctx.createGain(); node.gain.value = value; return node; };
  const chain = (...nodes) => { for (let i = 0; i < nodes.length - 1; i += 1) nodes[i].connect(nodes[i + 1]); return nodes[0]; };
  /** Громкость отклика: быстро вверх, подержать, плавно вниз. */
  const shape = (node, at, attack, hold, release, peak) => {
    node.gain.setValueAtTime(0.0001, at);
    node.gain.linearRampToValueAtTime(peak, at + attack);
    node.gain.setValueAtTime(peak, at + attack + hold);
    node.gain.exponentialRampToValueAtTime(0.0001, at + attack + hold + release);
  };
  /** Короткий тон, который скользит от одной высоты к другой: капля, «бульк». */
  const blip = (at, from, to, length, peak) => {
    const tone = ctx.createOscillator(), out = gain(0);
    tone.type = "sine";
    tone.frequency.setValueAtTime(from, at);
    tone.frequency.exponentialRampToValueAtTime(to, at + length);
    chain(tone, out, master);
    shape(out, at, 0.008, 0.01, length, peak);
    tone.start(at); tone.stop(at + length + 0.08);
  };
  /** Короткий всплеск шума в полосе: хруст, шорох. */
  const burst = (at, type, frequency, q, length, peak) => {
    const from = noise(false), out = gain(0);
    chain(from, filter(type, frequency, q), out, master);
    shape(out, at, 0.006, 0.012, length, peak);
    from.start(at); from.stop(at + length + 0.1);
  };

  function ensure() {
    if (ctx) return true;
    try { ctx = new Engine(); } catch { ctx = null; return false; }
    master = gain(0);
    master.connect(ctx.destination);
    return true;
  }
  /**
   * Фон. Дождь — шелест по стеклу, тонкое шипение и гул по крышам; гроза — тот же дождь гуще и гром вдалеке; снег —
   * тихий ветер; сухая погода — тишина комнаты: еле слышный гул города. Громкость медленно «дышит».
   */
  const BEDS = Object.freeze({
    rain: { level: 0.8, sway: [0.11, 0.07], layers: [[false, "bandpass", 2600, 0.35, 0.16], [false, "highpass", 6500, 0.5, 0.045], [true, "lowpass", 520, 0.5, 0.5]] },
    storm: { level: 0.95, sway: [0.16, 0.12], layers: [[false, "bandpass", 2300, 0.3, 0.22], [false, "highpass", 6000, 0.5, 0.06], [true, "lowpass", 480, 0.5, 0.62]] },
    snow: { level: 0.5, sway: [0.07, 0.12], layers: [[true, "lowpass", 420, 0.4, 0.55], [false, "bandpass", 900, 0.3, 0.02]] },
    calm: { level: 0.3, sway: [0.05, 0.08], layers: [[true, "lowpass", 220, 0.4, 0.5], [false, "bandpass", 500, 0.25, 0.008]] },
  });
  /** Гром: низкий раскат, который долго затихает. */
  const thunder = (at) => {
    const from = noise(true), out = gain(0), band = filter("lowpass", 150, 0.6);
    band.frequency.setValueAtTime(260, at);
    band.frequency.exponentialRampToValueAtTime(70, at + 2.6);
    chain(from, band, out, master);
    shape(out, at, 0.12, 0.5, 2.8, 1.3);
    from.start(at); from.stop(at + 3.8);
  };
  function bedOf(sky) {
    const out = gain(0), nodes = [], kind = BEDS[sky];
    out.connect(master);
    for (const [brown, type, frequency, q, level] of kind.layers) nodes.push(chain(noise(brown), filter(type, frequency, q), gain(level), out));
    const sway = ctx.createOscillator(), depth = gain(kind.sway[1]);
    sway.frequency.value = kind.sway[0];
    sway.connect(depth); depth.connect(out.gain);
    nodes.push(sway);
    for (const node of nodes) node.start();
    out.gain.setTargetAtTime(kind.level, ctx.currentTime, 0.8);
    const made = { out, nodes, sky, timer: 0 };
    // Гроза: гром — раз в четверть минуты или реже, не по часам.
    if (sky === "storm") {
      const roll = () => { made.timer = setTimeout(() => { if (ctx.state === "running" && bed === made) thunder(ctx.currentTime + 0.05); roll(); }, 9000 + Math.random() * 16000); };
      roll();
    }
    return made;
  }
  function dropBed() {
    if (!bed) return;
    const old = bed;
    bed = null;
    clearTimeout(old.timer);
    old.out.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
    setTimeout(() => {
      for (const node of old.nodes) { try { node.stop(); } catch { /* уже остановлен */ } }
      try { old.out.disconnect(); } catch { /* уже отключён */ }
    }, 1500);
  }

  const SHOTS = {
    // Мурчание: низкий шум, который «рокочет» двадцать четыре раза в секунду.
    purr(at) {
      const from = noise(true), throb = gain(0.5), out = gain(0), beat = ctx.createOscillator(), depth = gain(0.5);
      beat.type = "sawtooth"; beat.frequency.value = 24;
      chain(from, filter("lowpass", 240, 0.8), throb, out, master);
      beat.connect(depth); depth.connect(throb.gain);
      shape(out, at, 0.25, 1.7, 0.6, 0.9);
      from.start(at); beat.start(at); from.stop(at + 2.8); beat.stop(at + 2.8);
    },
    // Чай льётся в кружку: шум в полосе, которая ползёт вверх, и три «булька».
    pour(at) {
      const from = noise(false), band = filter("bandpass", 700, 2.2), out = gain(0);
      band.frequency.setValueAtTime(700, at);
      band.frequency.exponentialRampToValueAtTime(1900, at + 1.3);
      chain(from, band, out, master);
      shape(out, at, 0.08, 1.0, 0.35, 0.5);
      from.start(at); from.stop(at + 1.7);
      for (const [delay, pitch] of [[0.25, 520], [0.6, 640], [0.95, 760]]) blip(at + delay, pitch, pitch * 1.6, 0.09, 0.12);
    },
    // Корм: четыре коротких хруста.
    crunch(at) { for (const delay of [0, 0.13, 0.27, 0.44]) burst(at + delay, "highpass", 1800, 0.6, 0.05, 0.3); },
    // Вода: три капли.
    drip(at) { for (const [delay, pitch] of [[0, 1500], [0.22, 1250], [0.5, 1700]]) blip(at + delay, pitch, pitch * 0.55, 0.11, 0.2); },
    // Игра: клубок покатился.
    toy(at) { for (const [delay, pitch] of [[0, 520], [0.1, 640], [0.2, 780], [0.32, 620]]) blip(at + delay, pitch, pitch * 1.35, 0.07, 0.14); },
    // Погладили её: два мягких касания.
    pat(at) { for (const delay of [0, 0.16]) blip(at + delay, 210, 130, 0.1, 0.3); },
    // Выключатель лампы (0.46.0): сухой щелчок.
    click(at) { burst(at, "highpass", 2600, 0.8, 0.02, 0.3); blip(at + 0.004, 880, 520, 0.03, 0.14); },
  };

  // Мелодия из колонки (0.46.0): тихий lo-fi — четыре аккорда по кругу (ре минор, соль, до мажор, ля минор), ноты
  // перебором и бас. Играет сам телефон: файлов нет. Ноты ставятся на такт вперёд; следующий такт ставит таймер.
  // Высота — в полутонах от ля малой октавы (220 Гц): [бас, четыре ноты аккорда].
  const CHORDS = [[-7, [5, 8, 12, 15]], [-14, [-2, 2, 5, 8]], [-9, [3, 7, 10, 14]], [-12, [0, 3, 7, 10]]];
  const ORDER = [0, 1, 2, 3, 2, 1, 3, 2];
  const pitchOf = (steps) => 220 * 2 ** (steps / 12);
  let song = null;
  function stopSong() {
    if (!song) return;
    const old = song;
    song = null;
    clearTimeout(old.timer);
    try { old.out.gain.setTargetAtTime(0, ctx.currentTime, 0.2); } catch { /* уже отключён */ }
    setTimeout(() => { try { old.out.disconnect(); } catch { /* уже отключён */ } }, 1500);
  }
  function key(out, at, pitch, length, peak, type) {
    const tone = ctx.createOscillator(), level = gain(0);
    tone.type = type; tone.frequency.value = pitch;
    chain(tone, level, out);
    shape(level, at, 0.02, 0.04, length, peak);
    tone.start(at); tone.stop(at + length + 0.2);
  }
  function startSong(seconds) {
    stopSong();
    const beat = 60 / 72, bar = beat * 4, out = gain(0), end = ctx.currentTime + seconds;
    chain(out, filter("lowpass", 1500, 0.5), master);
    out.gain.setTargetAtTime(1, ctx.currentTime, 0.4);
    const made = { out, timer: 0 };
    let index = 0, next = ctx.currentTime + 0.1;
    const step = () => {
      if (song !== made || ctx.state !== "running") return;
      // Таймер опоздал (страницу сворачивали): пропущенные такты не доигрываются разом — дальше с ближайшего такта.
      if (next < ctx.currentTime) { const missed = Math.ceil((ctx.currentTime + 0.05 - next) / bar); index += missed; next += missed * bar; }
      while (next < ctx.currentTime + bar && next < end) {
        const [bass, notes] = CHORDS[index % CHORDS.length];
        key(out, next, pitchOf(bass), bar * 0.9, 0.22, "sine");
        for (const [slot, which] of ORDER.entries()) key(out, next + slot * beat / 2, pitchOf(notes[which]), beat * 1.4, slot % 2 ? 0.07 : 0.1, "triangle");
        index += 1; next += bar;
      }
      made.timer = next < end ? setTimeout(step, 900) : 0;
    };
    song = made;
    step();
  }

  return Object.freeze({
    /** Включить. Зовётся из обработчика нажатия: иначе телефон звука не даст. */
    async on(sky = "rain") {
      if (!ensure()) return false;
      try { if (ctx.state !== "running") await ctx.resume(); } catch { return false; }
      master.gain.setTargetAtTime(LEVEL, ctx.currentTime, 0.2);
      // Незнакомое слово — дождь: так было всегда (прежняя страница знает только дождь и снег).
      const wanted = Object.hasOwn(BEDS, sky) ? sky : "rain";
      if (!bed || bed.sky !== wanted) { dropBed(); bed = bedOf(wanted); }
      return ctx.state === "running";
    },
    off() {
      if (!ctx) return;
      stopSong();
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      dropBed();
      setTimeout(() => { if (!bed) ctx.suspend().catch(() => {}); }, 900);
    },
    play(name) {
      if (!ctx || ctx.state !== "running" || !bed || !Object.hasOwn(SHOTS, name)) return false;
      SHOTS[name](ctx.currentTime + 0.02);
      return true;
    },
    /** Мелодия из колонки: играть `seconds` секунд (звук должен быть включён). `hush` — оборвать. */
    tune(seconds = 180) {
      if (!ctx || ctx.state !== "running" || !bed || !(seconds > 0)) return false;
      startSong(Math.min(600, seconds));
      return true;
    },
    hush() { stopSong(); },
    state: () => (!ctx || !bed ? "off" : ctx.state),
    sky: () => bed?.sky ?? "",
  });
}
