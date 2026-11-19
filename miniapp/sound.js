/**
 * Звук комнаты (сборка 0.41.0): дождь за окном и отклик на заботу. Файлов со звуком нет: шум и тон делает сам
 * телефон (Web Audio) — страница от этого не тяжелеет, а дождь не повторяется по кругу.
 *
 * Модуль грузится, только когда звук включили: кто его не включал, тот его и не качает. `createSound()` — `null`,
 * если браузер звука не умеет; иначе:
 *   on(sky)    — включить и пустить фон: «rain» — дождь, «snow» — тихий ветер; обещание — пошёл ли звук;
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
  /** Фон. Дождь — шелест по стеклу, тонкое шипение и гул по крышам; снег — тихий ветер. Громкость медленно «дышит». */
  function bedOf(sky) {
    const out = gain(0), nodes = [];
    out.connect(master);
    const layer = (brown, type, frequency, q, level) => { nodes.push(chain(noise(brown), filter(type, frequency, q), gain(level), out)); };
    if (sky === "snow") { layer(true, "lowpass", 420, 0.4, 0.55); layer(false, "bandpass", 900, 0.3, 0.02); }
    else { layer(false, "bandpass", 2600, 0.35, 0.16); layer(false, "highpass", 6500, 0.5, 0.045); layer(true, "lowpass", 520, 0.5, 0.5); }
    const sway = ctx.createOscillator(), depth = gain(sky === "snow" ? 0.12 : 0.07);
    sway.frequency.value = sky === "snow" ? 0.07 : 0.11;
    sway.connect(depth); depth.connect(out.gain);
    nodes.push(sway);
    for (const node of nodes) node.start();
    out.gain.setTargetAtTime(sky === "snow" ? 0.5 : 0.8, ctx.currentTime, 0.8);
    return { out, nodes, sky };
  }
  function dropBed() {
    if (!bed) return;
    const old = bed;
    bed = null;
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
  };

  return Object.freeze({
    /** Включить. Зовётся из обработчика нажатия: иначе телефон звука не даст. */
    async on(sky = "rain") {
      if (!ensure()) return false;
      try { if (ctx.state !== "running") await ctx.resume(); } catch { return false; }
      master.gain.setTargetAtTime(LEVEL, ctx.currentTime, 0.2);
      const wanted = sky === "snow" ? "snow" : "rain";
      if (!bed || bed.sky !== wanted) { dropBed(); bed = bedOf(wanted); }
      return ctx.state === "running";
    },
    off() {
      if (!ctx) return;
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      dropBed();
      setTimeout(() => { if (!bed) ctx.suspend().catch(() => {}); }, 900);
    },
    play(name) {
      if (!ctx || ctx.state !== "running" || !bed || !Object.hasOwn(SHOTS, name)) return false;
      SHOTS[name](ctx.currentTime + 0.02);
      return true;
    },
    state: () => (!ctx || !bed ? "off" : ctx.state),
    sky: () => bed?.sky ?? "",
  });
}
