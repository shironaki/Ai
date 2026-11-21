/**
 * Дверь мини-приложения «Комната»: функция `onRoom` — то, что страница `miniapp/` спрашивает у сердца
 * (`tgcloud/endpoints/room.js`). До 0.49.0 жила внутри `heart.js`; вынесена, когда сердце подошло к пределу веса
 * модуля (640 000 байт после облегчения, `tests/upload.test.mjs`). Это перенос, а не переделка: тело функции то же.
 *
 * Всё, что двери нужно от сердца, приходит одним объектом (`deps`) — имена те же, что в сердце. Сердце собирает
 * дверь при первом заходе в комнату: к этому времени всё названное уже создано. Правило для правок: понадобилось
 * новое имя из сердца — добавить его в оба списка (здесь и в `heart.js`, у `createRoomDoor`); eslint назовёт
 * забытое («is not defined»), а тест `tests/sturdy.test.mjs` сверяет списки между собой.
 */
export function createRoomDoor(deps) {
  const {
    agoWords, airNow, ALBUM_KEY, AWAY_MS, brewOf, BREWS, BUILD, calendarDate, captionOf, carePool, CAT_STEP_MS,
    CAT_STILL, catAfter, catFits, catGift, catKey, catPose, colourHex, dateWords, dayNo, dayOf, days, dressHer,
    eventFor, eventNow, feelFor, feelingNow, fill, GIFT_EVERY_MS, GIFT_POOL, GIFT_SAID, GIFTS, giftsShown, HER_CALM,
    herState, herStep, keepsakes, keepThread, lightAt, lineAt, LISTED_EVERY_MS, localParts, mannerFor, MILESTONES,
    minutesNow, missedEvents, MUSIC_MS, musicNow, now, OOPS_EVERY_MS, OOPS_KEEP, owner, ownThings, partOfDay,
    PHRASES, plantState, QUIET_MS, quietLeft, RECENT_MAX, reportCrash, room, ROOM_APP, ROOM_FRESH_MS, ROOM_ITEMS,
    ROOM_NOTES, ROOM_OOPS_KEY, ROOM_POOL, ROOM_RECENT_KEY, ROOM_SAID, roomBox, roomCared, roomLine, roomLines,
    roomSeed, roomSky, roomThings, sceneByKey, sceneLook, stageLine, stageNow, store, tidyNote, voiceCtx, voiced,
    WEAR_WORD, wearNow, WINDOW_WATCH_MS, windowLine, wornNow, zoneOf,
  } = deps;

  /**
   * Мини-приложение «Комната» (страница `miniapp/`, функция `endpoints/room`): то же, что `roomWords`, но для
   * картинки. Кто зашёл — `ctx.initData.user`: его проверяет платформа, без верных данных функция не запускается.
   * `input.do`: look — зайти и получить всё, что видно; pet, feed, play, tea, water — забота; pick — выбор в сценке
   * дня (`key`, `pick`). Ответ — всегда объект: отказ — тоже ответ (`ok: false`, `code`, `text`), страница скажет
   * его словами. Правила — те же, что в чате (`room.js`): забота двигает отношения раз в день, сценка играется раз.
   */
  async function onRoom(input, ctx = {}) {
    const op = String(input?.do ?? "look").slice(0, 16);
    if (ctx?.testRun === true) return { ok: true, route: "room", do: op, build: BUILD, side_effects: "none" };
    const refuse = (code, text) => ({ ok: false, code, text, build: BUILD });
    try {
      const parsed = (value) => { if (typeof value !== "string") return value; try { return JSON.parse(value); } catch { return null; } };
      const user = parsed(parsed(ctx?.initData)?.user);
      const userId = Number(user?.id);
      if (!Number.isSafeInteger(userId) || userId <= 0 || user?.is_bot === true) return refuse("auth", "Не вижу, кто зашёл. Откройте комнату кнопкой в чате со мной.");
      if (!ROOM_APP || !PHRASES) return refuse("off", "Комната сейчас закрыта.");
      if (!store.available) return refuse("storage", "Память сейчас недоступна — загляните чуть позже.");
      const manner = await mannerFor(userId).catch(() => null);
      if (manner?.blocked) return refuse("closed", "Дверь закрыта. Это решение можно обсудить с владельцем.");
      // Мини-приложение открывается только в личке: здесь можно всё, что можно наедине.
      const turn = { actorId: userId, chatId: userId, isPrivate: true, inGroup: false, manner, extra: {}, app: true };
      const zone = zoneOf(turn);
      const today = calendarDate(now(), zone);
      const feel = await feelFor(turn).catch(() => null) ?? feelingNow({ now: now(), timeZone: zone, userId });
      const formal = owner(userId) ? true : manner?.formal !== false;
      const spoken = (raw) => (raw ? voiced(turn, raw) : "");
      // Небо — первым: от него зависят слова об окне и все строки с пометками погоды.
      const sky = await roomSky(turn);
      // 0.49.0. Номер действия от страницы: тот же номер второй раз ничего не меняет (ответ не дошёл — страница
      // повторила запрос). И предел частоты: действия идут через `room.act`.
      const once = { day: today, id: typeof input?.id === "string" && /^[a-z0-9]{6,20}$/u.test(input.id) ? input.id : "", limit: true };
      const MEMORY_DOWN = "Память комнаты сейчас не отвечает. Загляните чуть позже — здесь всё останется как было.";
      const NOT_KEPT = "Это не запомнилось: память комнаты сейчас не отвечает. Попробуйте ещё раз чуть позже.";
      /** Что сценка дня меняет на рисунке сейчас (`sceneLook`): Байт, она, сама комната. */
      const staged = (state) => sceneLook(state?.scene, { today, at: now() });
      /** Распорядок Байта: реплики его состояния — каждая со своей картинкой. Спит или прячется — с места не ходит. */
      const catBeats = (key) => (CAT_STILL.includes(key) ? [] : roomLines(turn, `байт:${key}`).map(line => ({ ...catPose(line, key), line })));
      /**
       * Байт и Колючка сейчас. `after` — забота, которую только что сделали: погладили, покормили, поиграли — Байт
       * занят этим; `line` — слова о нём из самого ответа: где он и какой, решают они («перевернулся на спину» —
       * значит, лежит на спине), и только у слов без примет — таблица `catAfter`. Чай и вода его не касаются.
       * Сценка дня держит Байта там, где сказано в ней, — пока после неё о нём не позаботились.
       */
      /** Что с Байтом сейчас: его состояние; держит ли его сценка дня (`held`); прячется ли он от грозы (`storm`). */
      const catMood = (state) => {
        const key = catKey(turn, state, feel, today);
        const scene = staged(state);
        // Несыгранная сценка держит его весь день (её слова — на странице); исход — пока после него о Байте не позаботились.
        const caredAfter = Boolean(state.last) && Number(state.lastAt) > (scene?.since ?? 0) && now() - Number(state.lastAt) < ROOM_FRESH_MS;
        const held = scene?.cat && (scene.since === 0 || !caredAfter) ? scene.cat : null;
        // Гроза (идея 160, 0.46.0): гром — и Байт под пледом, наружу один хвост; с места не ходит. О нём только что
        // позаботились (погладили, покормили, поиграли) — он при людях, а не под пледом. Обиженный уже спрятался —
        // под кресло; сценка дня держит его там, где сказано в ней (`held` проверяется раньше, чем гроза).
        const comforted = Boolean(state.last) && state.last !== "hurt" && now() - Number(state.lastAt) >= 0 && now() - Number(state.lastAt) < ROOM_FRESH_MS;
        // Тихий час (0.47.0): Байт спит на своей подушке — если не обижен (тогда он под креслом).
        return { key, held, storm: sky === "storm" && !comforted && key !== "обижен", quiet: quietLeft(state, now()) > 0 && key !== "обижен" };
      };
      const picture = (state, { after = null, again = false, line = "" } = {}) => {
        const { key, held, storm, quiet } = catMood(state);
        const hides = storm && !after;
        // Спит в тихий час — пока о нём не позаботились и пока его не держит сценка или гроза.
        const naps = quiet && !after && !held && !hides;
        // 0.48.0. Байт — при её занятии: она насыпает корм — он ест рядом, прямо из-под пакета; она спит ночью — он
        // спит у неё под боком. И место он меняет раз в семь минут (`CAT_STEP_MS`), а не раз в полминуты: реплика
        // считается из времени — та же при повторном вопросе и в чате.
        const she = herStep(turn, feel, state, today);
        const free = !after && !held && !hides && !naps && key !== "обижен";
        const eats = free && she.pose === "feed", beside = free && !eats && she.key === "сон" && key === "спит";
        const count = Math.floor(now() / CAT_STEP_MS) + roomSeed(userId, today);
        // 0.49.0 (сообщение 48: «Байт не должен быть просто генератором случайных действий… его поведение должно
        // учитывать состояние Аи и происходящее в комнате»). По старшинству: шалость — событие её дня; только что
        // открыли окно — он уже на подоконнике; вечером приносит ей добычу; она сидит — приходит к ней (ложится у ног,
        // просится на руки). Она спит или клюёт носом — шумного он не затевает; спит сам — там, где сейчас уместно.
        const minute = minutesNow(turn), sheSleeps = she.key === "сон", awake = free && !eats && !beside && key !== "спит";
        const event = eventNow(today, minute), bring = catGift(today);
        const prank = awake && !sheSleeps && event?.key === "prank";
        const airy = awake && !prank && airNow(state, now()) && now() - Number(state.open) < WINDOW_WATCH_MS;
        const gift = awake && !prank && !airy && !sheSleeps && Boolean(bring) && minute >= bring.from && minute < bring.to;
        const seated = she.pose === "chair" || she.pose === "read";
        const comes = awake && !prank && !airy && !gift && seated && HER_CALM.includes(she.key) && ["сыт", "ласка", "шалит"].includes(key) && count % 3 === 1;
        const fits = { asleep: sheSleeps || she.face === "drowsy", seated, sunny: (sky === "clear" || sky === "clouds") && ["утро", "день"].includes(turn.light || partOfDay(feel.hour)) };
        const special = prank ? `событие:${event.pool}` : airy ? "байт:окно" : gift ? "байт:добыча" : comes ? "байт:к ней" : "";
        const beats = held || hides || naps || eats || beside || special ? [] : catBeats(key).filter(item => catFits(item.line, fits));
        const from = beats.length ? count % beats.length : 0, beat = beats[from] ?? null;
        // Распорядок — по порядку от нынешней реплики: прежняя страница идёт по нему сама, нынешняя (`steady`) — нет.
        const order = [...beats.slice(from), ...beats.slice(0, from)];
        // С места не ходит (спит) — реплика из тех, что сейчас уместны: «на солнце» — в солнечный день, «у ног» — когда она сидит.
        const settledLine = () => { const lines = roomLines(turn, `байт:${key}`).filter(item => catFits(item, fits)); return lines.length ? lines[count % lines.length] : lineAt(turn, `байт:${key}`, count); };
        const raw = after || held ? "" : eats ? lineAt(turn, "байт:завтрак", count) : beside ? lineAt(turn, "байт:ночь", count)
          : hides ? lineAt(turn, "байт:гроза", count) : naps ? lineAt(turn, "байт:тихий час", count)
            // Шалость — по дню (у всех одна); «к ней» приходится на каждый третий шаг — счёт по тройкам, иначе реплика была бы всегда одна.
            : special ? lineAt(turn, special, prank ? dayNo(today) : comes ? Math.floor(count / 3) : count) : beat ? beat.line : settledLine();
        const moved = after ? catAfter(after, { again }) : null;
        const cat = after
          ? (moved ? { key, ...catPose(line, key, moved), beats: order, still: order.length < 2, steady: true } : null)
          : held ? { key, ...held, line: "", beats: [], still: true }
            : hides ? { key, shape: "tail", place: "plaid", line: raw, beats: [], still: true }
              : naps ? { key: "спит", shape: "curl", place: "pillow", line: raw, beats: [], still: true }
                : eats ? { key, shape: "eat", place: "near", line: raw, beats: [], still: true }
                  : beside ? { key, shape: "curl", place: "near", line: raw, beats: [], still: true }
                    // Особый случай (0.49.0): где он и какой — по словам о нём, как и всегда; `prank` и `gift` — отметки для альбома.
                    : special ? { key, ...catPose(raw, key), line: raw, beats: [], still: true, steady: true, ...(prank ? { prank: true } : gift ? { gift: true } : {}) }
                      : { key, ...catPose(raw, key), line: raw, beats: order, still: order.length < 2, steady: true };
        return {
          ...(cat ? { cat } : {}),
          plant: { state: plantState({ water: state.water, at: now() }) === "полита" ? "wet" : "dry" },
          done: Object.fromEntries(Object.keys(ROOM_POOL).map(name => [name, Number(state.done?.[name]) || 0])),
          cared: state.cared === today,
        };
      };
      const sceneOf = (state) => {
        const record = state?.scene;
        const scene = record?.day === today ? sceneByKey(record.key) : null;
        if (!scene) return null;
        const pick = record.pick === 0 || record.pick === 1 ? record.pick : null;
        const look = staged(state);
        return {
          key: scene.key, text: fill(scene.text, { formal }), options: scene.options.map(([label]) => label), pick, outcome: pick == null ? null : fill(scene.options[pick][1], { formal }),
          // Что сценка меняет в самой комнате (окно открыто, шторы задёрнуты…). Где при этом она сама — в `her`.
          fx: look?.fx ?? [],
        };
      };
      /** Отношения перешли на другую ступень — она говорит об этом и здесь. */
      const stageNote = () => { if (!turn.stageMoved) return {}; const note = stageLine(turn, turn.stageMoved); turn.stageMoved = null; return note ? { note } : {}; };
      /**
       * Она сейчас: чем занята (`key`), где (`pose`) и что говорит (`line`) — шаг её дня (`herStep`). `steady`
       * (0.48.0): страница не водит её по кругу сама, а спрашивает комнату заново, когда шаг сменится (`left`, мс).
       * `beats` — шаги занятия по порядку, первый — нынешний: прежняя страница идёт по ним, как раньше. `plan` — её
       * слова о том, что было и что дальше; `face` — мимика (drowsy — клюёт носом); `wear` — наряд: по просьбе или её
       * собственный, по дню и погоде.
       */
      const herNow = (state = null) => {
        const step = herStep(turn, feel, state, today);
        return {
          key: step.key, pose: step.pose, line: step.line, beats: step.beats, steady: true, left: step.left, stage: step.stage,
          ...(step.plan ? { plan: step.plan } : {}), ...(step.face ? { face: step.face } : {}), ...(step.event ? { event: step.event } : {}), wear: wearNow(state, now()) ?? wornNow(turn, state, today),
        };
      };
      /** Поставила ли её сценка дня: тогда ответ на выбор несёт её заново — как ответ на чай. */
      const herPut = (state) => Boolean(herState(turn, feel, state, today).put);
      /**
       * Часы человека для страницы: час, часть суток и сколько осталось до следующей (`left`, мс) — открытая страница
       * сама спросит комнату заново, когда утро сменится днём, а день — вечером. `wardrobe` — её слова, когда она при
       * этом переодевается: перед уходом к шкафу и по возвращении.
       */
      const clockNow = (state = null, lefts = []) => {
        const local = localParts(now(), zone), part = partOfDay(feel.hour);
        const edge = [5, 12, 18, 23].find(hour => hour > local.hh) ?? 29;
        // Слова у шкафа — по тому, во что она переоделась: наряд идёт за её днём и погодой (0.48.0), а не за часом.
        const wear = (wearNow(state, now()) ?? wornNow(turn, state, today)) === "home" ? "вечер" : "утро";
        const byClock = ((edge - local.hh) * 60 - local.mm) * 60_000 - (now() % 60_000);
        // Свет — по солнцу города (идея 164, 0.47.0): `light` — каким светом красить рисунок; страница спросит
        // комнату заново и к перемене часа, и к рассвету с закатом. Солнца не знаем — поля нет: свет по часам.
        const sun = lightAt(now(), turn.sun);
        // `step` (0.48.0) — через сколько миллисекунд сменится шаг её дня или место Байта: страница спросит комнату
        // и тогда. Отдельным полем ответа: прежняя страница знает только `clock.left` и сверяется раз в десять минут.
        const step = Math.max(30_000, Math.min(CAT_STEP_MS - (now() % CAT_STEP_MS), ...lefts.filter(value => Number.isFinite(value) && value > 0)));
        // `lightLeft` (0.49.0, «более живая погода») — через сколько сменится свет за окном: в последние минуты перед
        // переменой страница понемногу подмешивает следующий свет — зарю, закат, синеву ночи.
        return {
          step,
          clock: { hour: feel.hour, part, day: today, left: Math.max(30_000, Math.min(byClock, sun?.left ?? byClock)), lightLeft: Math.max(30_000, sun?.left ?? byClock), ...(sun ? { light: sun.light } : {}) },
          wardrobe: { leave: roomLine(turn, `шкаф:${wear}`), back: roomLine(turn, `переоделась:${wear}`) },
        };
      };

      // `again` — страница уже открыта и спрашивает заново (сменился час, прошло время): это не новый заход — счёт
      // заходов, новости о вещах и приветствие не трогаются. `repeat` (0.49.0) — это ответ на повтор уже сделанного
      // действия: вместо второго раза страница получает комнату как она есть.
      const looking = async ({ again = false, repeat = false } = {}) => {
        const before = await room.read(userId, today);
        if (before.lost) return refuse("storage", MEMORY_DOWN);
        const things = await roomThings(turn, before);
        const visit = again ? { state: before, fresh: [], first: false, saved: true } : await room.visit(userId, { day: today, keys: things.keys, scenes: true, sky });
        if (visit.lost) return refuse("storage", MEMORY_DOWN);
        const next = ROOM_ITEMS.find(item => item.days && item.days > things.days);
        const she = herNow(visit.state);
        // Долго не был (0.48.0): три дня без захода — она встречает другими словами, с числом дней.
        const away = !again && Number(before.near) > 0 ? now() - Number(before.near) : 0;
        const greet = again ? "" : (away >= AWAY_MS ? roomLine(turn, "зайти:давно", { "дней": days(Math.floor(away / 86_400_000)) }) : "") || roomLine(turn, "зайти");
        // Она сама предлагает чай (0.48.0): в начале своего чайного перерыва, пока ей ещё не налили. `id` — чтобы
        // страница спросила один раз, а не при каждой сверке.
        const stage = stageNow(turn, today), sinceStage = (minutesNow(turn) - stage.from) * 60_000;
        const asks = stage.name === "чай" && she.stage === "чай" && she.key === "уют" && herStep(turn, feel, visit.state, today).onPlan && sinceStage < 25 * 60_000 && !(Number(visit.state.tea) >= now() - sinceStage);
        // 0.49.0 (сообщение 48) — альбом воспоминаний, её вещи, подарки, встреча после отлучки. В альбом ложится то, что
        // было при человеке или что она ему рассказала: первый заход, памятные даты, событие её дня, добыча Байта.
        // Альбом — не главное: его сбой комнату не роняет.
        const minute = minutesNow(turn), shown = picture(visit.state), happened = eventFor(today);
        const album = await keepsakes.read(userId);
        const entries = [];
        if (visit.first) entries.push({ k: "first", key: "visit", day: today, at: now() });
        for (const mark of MILESTONES) if (things.days >= mark) entries.push({ k: "date", key: String(mark), day: dayOf(dayNo(today) - (things.days - mark)), at: now() });
        if (happened && minute >= happened.from) entries.push({ k: "event", key: happened.key, day: today, at: now() });
        if (shown.cat?.gift) entries.push({ k: "cat", key: "gift", day: today, at: now() });
        // Долго не был: два последних события без него — о них она расскажет сценкой, и они тоже ложатся в альбом.
        const lastDay = Number(before.near) > 0 ? calendarDate(Number(before.near), zoneOf(turn)) : "";
        const missed = !again && lastDay && away >= AWAY_MS ? missedEvents(lastDay, today).slice(-2) : [];
        for (const past of missed) entries.push({ k: "event", key: past.key, day: past.day, at: now(), told: true });
        const fresh = album.lost ? [] : (await keepsakes.add(userId, entries, album).catch(() => ({ added: [] }))).added;
        // Встреча-сценка: «чем занималась, что произошло, что хочет рассказать» — шаги с её местом (или местом Байта).
        // Первая реплика запаса «было:…» начинает рассказ («Пока вас не было…»), вторая продолжает («Ещё: …»).
        const story = missed.map((past, index) => {
          const told = lineAt(turn, `было:${past.pool}`, index, { "когда": agoWords(dayNo(today) - dayNo(past.day)) });
          return told ? { line: spoken(told), ...(past.pose ? { her: { key: past.her, pose: past.pose } } : { cat: catPose(told, "шалит") }) } : null;
        }).filter(Boolean);
        if (story.length) story.push({ line: spoken(roomLine(turn, "встреча:конец") || "Вот так. Остальное — в альбоме.") });
        const own = ownThings(today, minute);
        // Кто заходит — попадает в список «бывает в комнате» (0.49.0): по нему она находит, кому написать о событии
        // своего дня. Отметка — раз в шесть часов, а не при каждом заходе.
        if (!again && ROOM_NOTES && !(now() - Number(visit.state.listed) < LISTED_EVERY_MS)) {
          try {
            await store.update(ROOM_RECENT_KEY, (saved) => {
              const users = { ...(saved?.users && typeof saved.users === "object" ? saved.users : {}), [String(userId)]: now() };
              return { users: Object.fromEntries(Object.entries(users).sort((one, two) => Number(two[1]) - Number(one[1])).slice(0, RECENT_MAX)), at: now() };
            });
            await room.amend(userId, today, (state) => ({ ...state, listed: now() }));
          } catch { /* список подождёт следующего захода */ }
        }
        return {
          // `once` (0.49.0): это сердце помнит номера действий — страница может сама повторить запрос, не дошедший за срок.
          ok: true, do: "look", build: BUILD, formal, once: true, ...(again ? { again: true } : {}), ...(repeat ? { repeat: true } : {}),
          ...clockNow(visit.state, [she.left]),
          greet: spoken(greet), window: windowLine(turn, sky), sky, city: turn.skyReal === true,
          box: roomBox(turn, visit.state), patted: (Number(visit.state.done?.pat) || 0) > 0,
          her: she,
          ...shown,
          // 0.49.0. Её вещи — следы её событий (наброски на стекле, найденная книга, открытка); подарки человека,
          // что сейчас стоят в комнате; альбом — сколько записей и сколько новых; идёт ли событие; сценка встречи.
          own: { sketches: own.sketches.length, book: Boolean(own.book), card: Boolean(own.card) },
          gifts: giftsShown([...album.items, ...fresh], now()), album: { count: album.items.length + fresh.length, fresh: fresh.length },
          ...(she.event || shown.cat?.prank ? { event: she.event || "prank" } : {}), ...(story.length ? { story } : {}),
          // 0.48.0. Кнопки под рисунком (тихий час, наряд, чай) — хозяину: остальным те же дела доступны на самом
          // рисунке и её собственной волей. Окно открыто (час после нажатия). Чай: какой наливают и какие есть.
          owner: owner(userId), open: airNow(visit.state, now()), kind: brewOf(visit.state), kinds: [...BREWS],
          ...(asks ? { offer: { id: `${today}:чай`, kind: "tea", text: spoken(lineAt(turn, "чай:предложить", stage.from)) } } : {}),
          // 0.46.0. Лампа погашена (горит гирлянда); сколько ещё играет колонка, мс (0 — молчит).
          dark: visit.state.dark === true, music: musicNow(visit.state, now()) ? Math.max(1000, MUSIC_MS - (now() - Number(visit.state.music))) : 0,
          // 0.47.0. Какой чай ей наливают (жасмин, улун, мята). По этому полю страница 0.47.0 узнаёт сердце, которое
          // умеет «переодеться» и «выбрать чай», и показывает кнопки под рисунком. С 0.48.0 кнопки — хозяину, поэтому
          // и поле — ему: прежняя страница у гостя кнопок не покажет. Новая берёт чай из `kind`.
          ...(owner(userId) ? { brew: brewOf(visit.state) } : {}),
          // Тихий час (0.47.0): сколько ещё идёт, мс (0 — не идёт), и её слова, когда время выйдет.
          quiet: quietLeft(visit.state, now()), ...(quietLeft(visit.state, now()) > 0 ? { quietEnd: spoken(roomLine(turn, "тихий час:конец")) } : {}),
          things: ROOM_ITEMS.filter(item => things.keys.includes(item.key)).map(item => ({ key: item.key, title: item.title, line: roomLine(turn, `вещь:${item.key}`, things.vars) })),
          lamp: things.keys.includes("абажур") ? colourHex(things.vars["цвет"]) : "",
          drawing: things.keys.includes("рисунок") ? things.drawing : "",
          fresh: visit.fresh,
          next: next ? { days: next.days - things.days } : null,
          scene: visit.saved === false ? null : sceneOf(visit.state),
          first: visit.first,
        };
      };
      /**
       * Что ответить вместо обычного ответа (0.49.0): повтор уже сделанного — комната как она есть; запись не легла
       * или память не ответила — отказ словами (до 0.49.0 забота отвечала «сделано», даже когда не запомнилась);
       * слишком часто — тоже отказ. `null` — всё в порядке.
       */
      const instead = async (done) => (done?.repeat ? looking({ again: true, repeat: true })
        : done?.lost || done?.saved === false ? refuse("storage", NOT_KEPT)
          : done?.slow ? refuse("slow", "Не так быстро: я не успеваю. Подождите несколько секунд.") : null);
      /**
       * Первый раз (0.49.0): запись в альбом — одна на человека и действие. Отметка «уже было» — в записи комнаты,
       * чтобы не читать альбом при каждом нажатии. Альбом — не главное: его сбой действие не роняет.
       */
      const firstTime = async (state, name) => {
        if (Array.isArray(state?.firsts) && state.firsts.includes(name)) return;
        try {
          await keepsakes.add(userId, [{ k: "first", key: name, day: today, at: now() }]);
          await room.amend(userId, today, (fresh) => (Array.isArray(fresh.firsts) && fresh.firsts.includes(name) ? null : { ...fresh, firsts: [...(Array.isArray(fresh.firsts) ? fresh.firsts : []), name].slice(-24) }));
        } catch { /* альбом подождёт */ }
      };
      // `await` — чтобы поломка внутри попала в общий `catch` ниже, а не ушла наружу отказом обещания.
      if (op === "look") return await looking({ again: input?.again === true });
      if (ROOM_POOL[op]) {
        // Чай на выбор — у чайника (0.48.0): страница спрашивает, какой налить, и шлёт его вместе с заботой.
        if (op === "tea" && BREWS.includes(String(input?.kind ?? ""))) await room.brew(userId, { day: today, kind: String(input.kind) });
        const done = await room.care(userId, op, once);
        { const other = await instead(done); if (other) return other; }
        const raw = roomLine(turn, carePool(op, done)) || "Спасибо.";
        if (done.first) await roomCared(userId, turn);
        // Первая такая забота за день остаётся в переписке: на «он наелся?» модель ответит, зная, что его кормили.
        if (!done.again && !done.early) await keepThread(turn, ROOM_SAID[op], raw);
        if (!done.early) await firstTime(done.state, op);
        return {
          ok: true, do: op, build: BUILD, line: spoken(raw), again: Boolean(done.again), early: Boolean(done.early), peace: Boolean(done.peace), counted: Boolean(done.first),
          // Налили чай — она берёт кружку: страница получает её заново (чем занята, где, распорядок).
          ...(op === "tea" ? { her: herNow(done.state), kind: brewOf(done.state), ...(owner(userId) ? { brew: brewOf(done.state) } : {}) } : {}),
          ...picture(done.state, { after: done.peace ? "pet" : op, again: Boolean(done.again), line: raw }), ...stageNote(),
        };
      }
      if (op === "pat") {
        // Погладить её по голове. Едва знакомому и тому, с кем она в ссоре, она не даётся — и в отношения это не
        // идёт; остальным — смутится, и раз в день это шаг в отношениях, как ласка в чате.
        const who = voiceCtx(turn);
        if (!who.owner && (who.level === "first" || who.level === "cold")) {
          return { ok: true, do: op, build: BUILD, line: spoken(roomLine(turn, "она:погладить:рано") || "Не так быстро. Сначала — чай и пара хороших разговоров."), again: false, shy: true, counted: false };
        }
        const done = await room.care(userId, "pat", once);
        { const other = await instead(done); if (other) return other; }
        const raw = roomLine(turn, `она:погладить${done.again ? ":ещё" : ""}`) || "…Ладно. Мне нравится.";
        if (done.first) await roomCared(userId, turn);
        if (!done.again) await keepThread(turn, "погладить тебя по голове", raw);
        await firstTime(done.state, "pat");
        return { ok: true, do: op, build: BUILD, line: spoken(raw), again: Boolean(done.again), shy: false, counted: Boolean(done.first), ...stageNote() };
      }
      if (op === "book") {
        // Полка с книгами (идея 167, 0.45.0): она берёт книгу и садится читать — на полчаса или пока не нальют чай.
        // Когда ей не до книг (обида, ревность, усталость, сон), она так и говорит, и книга остаётся на полке.
        const before = await room.read(userId, today);
        if (before.lost) return refuse("storage", MEMORY_DOWN);
        const mood = herState(turn, feel, before, today).key;
        if (!HER_CALM.includes(mood)) return { ok: true, do: op, build: BUILD, line: spoken(roomLine(turn, `полка:${mood}`) || "Не сейчас. Книга подождёт."), taken: false };
        const done = await room.book(userId, once);
        { const other = await instead(done); if (other) return other; }
        const raw = roomLine(turn, done.again ? "полка:ещё" : "полка") || "Возьму книгу.";
        if (!done.again) await keepThread(turn, "[в комнате] предложил тебе почитать", raw);
        await firstTime(done.state, "book");
        return { ok: true, do: op, build: BUILD, line: spoken(raw), taken: true, again: Boolean(done.again), her: herNow(done.state), ...stageNote() };
      }
      if (op === "quiet") {
        // Посидеть рядом (идея 161, 0.47.0): тихий час — двадцать пять минут она читает в кресле, Байт спит на
        // подушке, под рисунком идёт отсчёт; нажали ещё раз — закончили раньше. Когда ей не до книг (сон, обида,
        // усталость), она остаётся как была, а время идёт. `end` — её слова, когда время выйдет: страница скажет
        // их сама, без связи. В отношения не идёт.
        const done = await room.quiet(userId, once);
        { const other = await instead(done); if (other) return other; }
        const raw = roomLine(turn, done.on ? "тихий час" : "тихий час:стоп") || (done.on ? "Сажусь рядом." : "Хорошо, хватит.");
        if (done.on) await keepThread(turn, "[в комнате] сел рядом поработать в тишине", raw);
        if (done.on) await firstTime(done.state, "quiet");
        const shown = picture(done.state);
        return { ok: true, do: op, build: BUILD, line: spoken(raw), on: done.on, left: done.on ? QUIET_MS : 0, end: done.on ? spoken(roomLine(turn, "тихий час:конец")) : "", her: herNow(done.state), ...(shown.cat ? { cat: shown.cat } : {}) };
      }
      if (op === "wear") {
        // Наряд по просьбе (идея 157, 0.47.0): из нарисованных — куртка и свитер. Без названия — другой, не тот,
        // что на ней. Держится, пока она не переоденется сама (в пять, в шесть вечера, перед сном). Страница играет
        // ту же сцену у шкафа, что при смене часа: `line` — слова на пути к шкафу, `back` — по возвращении.
        const done = await dressHer(turn, feel, today, String(input?.wear ?? ""), once);
        { const other = await instead(done); if (other) return other; }
        const word = WEAR_WORD[done.name];
        if (done.asleep || done.same) return { ok: true, do: op, build: BUILD, line: spoken(roomLine(turn, done.asleep ? "наряд:сон" : `наряд:${word}:уже`) || "Не сейчас."), wear: done.name, changed: false };
        const back = roomLine(turn, `наряд:${word}:готово`) || "Вот.";
        await keepThread(turn, `[в комнате] попросил тебя надеть ${word === "свитер" ? "свитер" : "куртку"}`, back);
        return { ok: true, do: op, build: BUILD, line: spoken(roomLine(turn, `наряд:${word}`) || "Сейчас переоденусь."), back: spoken(back), wear: done.name, changed: true, her: herNow(done.state) };
      }
      if (op === "brew") {
        // Чай на выбор (идея 166, 0.47.0): жасмин, улун или мята — что ей наливать; запоминается. Без названия —
        // следующий по кругу. Сам чай наливает кнопка «Чай»: её слова тогда — о том чае, что выбран.
        const done = await room.brew(userId, { ...once, kind: String(input?.kind ?? "") });
        { const other = await instead(done); if (other) return other; }
        return { ok: true, do: op, build: BUILD, brew: done.kind, line: spoken(roomLine(turn, `заварка:${done.kind}`) || `Теперь — ${done.kind}.`) };
      }
      if (op === "call") {
        // Позвать Байта (идея 162, 0.47.0): нажали на ковёр — он подходит и садится рядом; позвали ещё раз, пока он
        // тут (полминуты), — удирает под кресло бегом (`run`): кот. Спит, обижен, прячется от грозы или занят в
        // сценке дня — не идёт, и она говорит почему. В отношения не идёт: это не забота.
        const before = await room.read(userId, today);
        if (before.lost) return refuse("storage", MEMORY_DOWN);
        const mood = catMood(before);
        const why = mood.key === "спит" ? "спит" : mood.key === "обижен" || mood.held || mood.storm ? "нет" : mood.quiet ? "спит" : "";
        if (why) return { ok: true, do: op, build: BUILD, line: spoken(roomLine(turn, `байт:позвать:${why}`) || "Байт не идёт."), came: false, fled: false };
        const done = await room.call(userId, once);
        { const other = await instead(done); if (other) return other; }
        const raw = roomLine(turn, done.again ? "байт:позвать:ещё" : "байт:позвать") || (done.again ? "Байт удрал под кресло." : "Байт подошёл.");
        if (!done.again) await firstTime(done.state, "call");
        const shown = picture(done.state, { after: "call", again: done.again, line: raw });
        return { ok: true, do: op, build: BUILD, line: spoken(raw), came: !done.again, fled: Boolean(done.again), ...(shown.cat ? { cat: { ...shown.cat, ...(done.again ? { run: true } : {}) } } : {}), ...stageNote() };
      }
      if (op === "window") {
        // Окно (0.48.0, сообщение 47: «чтоб окно открывалось и тогда уже слышны звуки улицы, а так звуки дома»):
        // нажали — открыла, слышна улица; ещё раз — закрыла; сама закрывает через час. Спит — окно открывают и
        // закрывают без неё, и слова её сонные. В отношения не идёт: это не забота.
        const done = await room.air(userId, once);
        { const other = await instead(done); if (other) return other; }
        const asleep = herState(turn, feel, done.state, today).key === "сон";
        const raw = roomLine(turn, `створка:${done.open ? "открыть" : "закрыть"}${asleep ? ":сон" : ""}`) || (done.open ? "Открыла окно." : "Закрыла окно.");
        if (done.open) await firstTime(done.state, "window");
        return { ok: true, do: op, build: BUILD, line: spoken(raw), open: done.open, window: windowLine(turn, sky) };
      }
      if (op === "lamp") {
        // Лампа (идея 158, 0.46.0): нажали — свет гаснет (остаётся гирлянда) или загорается; так и остаётся, пока не
        // нажмут снова. Пока за окном светло, лампа не горит и так: она это и говорит, а выключатель остаётся как
        // был. Светло или нет — по тому же свету, каким нарисована комната: по солнцу города, а без него по часам.
        const part = turn.light || partOfDay(feel.hour);
        if (part !== "вечер" && part !== "ночь") {
          const before = await room.read(userId, today);
          if (before.lost) return refuse("storage", MEMORY_DOWN);
          return { ok: true, do: op, build: BUILD, line: spoken(roomLine(turn, "свет:день") || "Пока светло, лампа отдыхает."), dark: before.dark === true, changed: false };
        }
        const done = await room.lamp(userId, once);
        { const other = await instead(done); if (other) return other; }
        const asleep = herState(turn, feel, done.state, today).key === "сон";
        const raw = roomLine(turn, `свет:${done.dark ? "выкл" : "вкл"}${asleep ? ":сон" : ""}`) || (done.dark ? "Погасила." : "Включила.");
        return { ok: true, do: op, build: BUILD, line: spoken(raw), dark: done.dark, changed: true };
      }
      if (op === "music") {
        // Колонка (идея 159, 0.46.0): три минуты играет тихая мелодия (её играет сам телефон), и она танцует;
        // нажали, пока играет, — выключили. Когда ей не до танцев (сон, обида, ревность, усталость), колонка молчит.
        const before = await room.read(userId, today);
        if (before.lost) return refuse("storage", MEMORY_DOWN);
        const mood = herState(turn, feel, before, today).key;
        if (!musicNow(before, now()) && !HER_CALM.includes(mood)) return { ok: true, do: op, build: BUILD, line: spoken(roomLine(turn, mood === "сон" ? "колонка:сон" : "колонка:нет") || "Не сейчас."), on: false, left: 0 };
        const done = await room.music(userId, once);
        { const other = await instead(done); if (other) return other; }
        const raw = roomLine(turn, done.on ? "колонка" : "колонка:стоп") || (done.on ? "Включаю." : "Выключила.");
        if (done.on) await keepThread(turn, "[в комнате] включил тебе музыку", raw);
        if (done.on) await firstTime(done.state, "music");
        return { ok: true, do: op, build: BUILD, line: spoken(raw), on: done.on, left: done.on ? MUSIC_MS : 0, her: herNow(done.state), ...stageNote() };
      }
      if (op === "pick") {
        const picked = await room.choose(userId, String(input?.key ?? "").slice(0, 24), Number(input?.pick), once);
        if (picked.repeat) return await looking({ again: true, repeat: true });
        if (!picked.ok) return refuse(picked.code, picked.code === "played" ? "Эта сценка уже сыграна." : picked.code === "storage" ? "Память сейчас недоступна — выбор не записался." : picked.code === "slow" ? "Не так быстро: я не успеваю. Подождите несколько секунд." : "Этой сценки уже нет: её день прошёл.");
        if (picked.first) await roomCared(userId, turn);
        const outcome = fill(picked.outcome, { formal });
        await keepThread(turn, `[выбор в сценке] ${picked.label}`, outcome);
        // Сыгранная сценка — в альбом (0.49.0): с днём, а не только трофеем в коробке.
        await firstTime(picked.state, "scene");
        await keepsakes.add(userId, [{ k: "scene", key: picked.scene.key, day: today, at: now() }]).catch(() => null);
        // Рисунок идёт за словами исхода: Байт — туда, где сказано, комната — такой, как сказано.
        const shown = picture(picked.state);
        return {
          ok: true, do: op, build: BUILD, line: spoken(outcome), counted: Boolean(picked.first), scene: sceneOf(picked.state), ...(shown.cat ? { cat: shown.cat } : {}),
          // Исход поставил её саму («значит, манга» — она в кресле с кружкой): страница получает её заново.
          ...(herPut(picked.state) ? { her: herNow(picked.state) } : {}),
          cared: picked.state.cared === today, box: roomBox(turn, picked.state), ...stageNote(),
        };
      }
      if (op === "album") {
        // Альбом воспоминаний (0.49.0): записи альбома и её рисунки для человека — по дням, новые сверху. Подпись —
        // не её речь, а подпись; у снимка — комната той минуты (`view`): страница рисует её заново. `gift` — можно ли
        // сейчас подарить (раз в неделю) и через сколько дней.
        const album = await keepsakes.read(userId);
        if (album.lost) return refuse("storage", MEMORY_DOWN);
        const zone = zoneOf(turn), drawn = await store.get(ALBUM_KEY(userId)).catch(() => null);
        const items = [
          ...album.items.map((item, index) => ({ n: index, k: item.k, key: String(item.key ?? ""), day: item.day || calendarDate(Number(item.at) || now(), zone), title: fill(captionOf(item), { formal }), ...(item.k === "snap" && item.view ? { view: item.view, line: String(item.line ?? "") } : {}), ...(item.told ? { told: true } : {}) })),
          ...(Array.isArray(drawn?.items) ? drawn.items : []).filter(item => item?.q && Number(item.at) > 0).slice(-6).map((item, index) => ({ n: -1 - index, k: "draw", key: "", day: calendarDate(Number(item.at), zone), title: `Рисунок: «${String(item.q).replace(/\s+/gu, " ").trim().slice(0, 60)}»` })),
        ].sort((one, two) => (one.day < two.day ? 1 : one.day > two.day ? -1 : two.n - one.n)).slice(0, 40).map(({ n: _order, ...item }) => ({ ...item, date: dateWords(item.day, today) }));
        const wait = album.gift > 0 ? GIFT_EVERY_MS - (now() - album.gift) : 0;
        return {
          ok: true, do: op, build: BUILD, items, line: spoken(roomLine(turn, items.length ? "альбом" : "альбом:пусто") || (items.length ? "Вот что я сохранила." : "Альбом пока пуст.")),
          gift: { ok: wait <= 0, days: wait > 0 ? Math.ceil(wait / 86_400_000) : 0 }, kinds: [...GIFTS], gifts: giftsShown(album.items, now()),
        };
      }
      if (op === "gift") {
        // Подарок (идея 163, 0.49.0): цветок, книга, игрушка Байту — остаётся в комнате и в альбоме с датой; не чаще
        // раза в неделю. Подарок — забота дня, как чай: в отношения идёт раз в день.
        const kind = String(input?.kind ?? "");
        if (!GIFTS.includes(kind)) return refuse("unknown", "Такого подарка у меня в списке нет.");
        const done = await keepsakes.gift(userId, kind, { day: today });
        if (!done.ok) return refuse("storage", NOT_KEPT);
        const wait = Math.ceil((done.left ?? 0) / 86_400_000);
        if (done.early) return { ok: true, do: op, build: BUILD, taken: false, days: wait, gifts: giftsShown(done.album.items, now()), line: spoken(roomLine(turn, "подарок:рано", { "дней": days(wait) }) || `Подарки — не чаще раза в неделю. Следующий — через ${days(wait)}.`) };
        const raw = roomLine(turn, `подарок:${GIFT_POOL[kind]}`) || "Спасибо. Это останется у меня.";
        await keepThread(turn, `[в комнате] подарил тебе ${GIFT_SAID[kind]}`, raw);
        let counted = false;
        const cared = await room.amend(userId, today, (state) => { counted = state.cared !== today; return counted ? { ...state, cared: today, care: (Number(state.care) || 0) + 1, near: now() } : null; });
        if (counted && cared.saved) await roomCared(userId, turn);
        return { ok: true, do: op, build: BUILD, taken: true, days: 7, gifts: giftsShown(done.album.items, now()), line: spoken(raw), counted: counted && cared.saved, ...stageNote() };
      }
      if (op === "snap") {
        // Снимок на память (идея 165, 0.49.0): комната этой минуты ложится в альбом — её собирает сердце, а не
        // страница, и страница потом рисует её заново. Не чаще раза в десять минут, не больше восьми.
        const seen = await looking({ again: true });
        if (seen.ok !== true) return seen;
        const view = {
          part: seen.clock.part, ...(seen.clock.light ? { light: seen.clock.light } : {}), sky: seen.sky,
          her: { key: seen.her.key, pose: seen.her.pose, wear: seen.her.wear }, ...(seen.cat ? { cat: { shape: seen.cat.shape, place: seen.cat.place, key: seen.cat.key } } : {}),
          things: seen.things.map(item => item.key), plant: seen.plant.state, lamp: seen.lamp, dark: seen.dark, open: seen.open, fed: seen.done.feed > 0, tea: seen.done.tea > 0, own: seen.own, gifts: seen.gifts,
        };
        const done = await keepsakes.snap(userId, view, seen.her.line, { day: today });
        if (!done.ok) return refuse("storage", NOT_KEPT);
        return { ok: true, do: op, build: BUILD, taken: !done.early, line: spoken(roomLine(turn, done.early ? "снимок:рано" : "снимок") || (done.early ? "Снимок уже есть — следующий чуть позже." : "Запомнила этот момент.")) };
      }
      if (op === "oops") {
        // Журнал ошибок страницы (0.49.0): три последние записи за заход — место, код и короткий текст. Кто зашёл, не
        // пишется: только «хозяин или гость». Не чаще раза в десять минут от человека; хранится тридцать записей.
        const items = (Array.isArray(input?.items) ? input.items : []).slice(0, 3)
          .map(item => ({ where: tidyNote(item?.where, 24), code: tidyNote(item?.code, 32), text: tidyNote(item?.text, 140) })).filter(item => item.code || item.text);
        if (!items.length) return { ok: true, do: op, build: BUILD, kept: 0 };
        let fresh = false;
        const mark = await room.amend(userId, today, (state) => { fresh = !(now() - Number(state.oops) < OOPS_EVERY_MS); return fresh ? { ...state, oops: now() } : null; });
        if (!fresh || mark.lost || !mark.saved) return { ok: true, do: op, build: BUILD, kept: 0 };
        const page = tidyNote(input?.page, 6), mine = owner(userId);
        const kept = await store.update(ROOM_OOPS_KEY, (before) => [...(Array.isArray(before) ? before : []), ...items.map(item => ({ ...item, at: now(), build: BUILD, page, owner: mine }))].slice(-OOPS_KEEP)).catch(() => false);
        return { ok: true, do: op, build: BUILD, kept: kept ? items.length : 0 };
      }
      return refuse("unknown", "Такого в комнате не делают.");
    } catch (error) {
      try { await reportCrash(error, ctx); } catch { /* отчёт не должен стать второй поломкой */ }
      return refuse("runtime_error", "Что-то сломалось. Хозяин уже знает — загляните чуть позже.");
    }
  }
  return onRoom;
}
