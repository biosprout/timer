(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const STORE_KEY = "ouchi-timer-v1";
  const CIRCUMFERENCE = 2 * Math.PI * 160;
  const modes = ["timer", "stopwatch", "pomodoro"];
  const themes = ["night", "day", "berry"];

  function wholeNumber(value, min, max, fallback) {
    const number = Number(value);
    return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
  }

  function boundedMilliseconds(value, maximum, fallback) {
    return Number.isFinite(value) && value >= 0 && value <= maximum ? value : fallback;
  }

  function validEpoch(value) {
    return Number.isFinite(value) && value > 0 && value < 8640000000000000;
  }

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {}; } catch { /* Storage is optional. */ }

  const settings = {
    timerMinutes: wholeNumber(saved.timerMinutes, 0, 999, 5),
    timerSeconds: wholeNumber(saved.timerSeconds, 0, 59, 0),
    workMinutes: wholeNumber(saved.workMinutes, 1, 180, 25),
    breakMinutes: wholeNumber(saved.breakMinutes, 1, 180, 5),
    autoPomo: saved.autoPomo !== false,
    theme: themes.includes(saved.theme) ? saved.theme : "night",
    keepAwake: saved.keepAwake === true,
  };
  if (settings.timerMinutes === 0 && settings.timerSeconds === 0) settings.timerMinutes = 5;
  const timerDuration = (settings.timerMinutes * 60 + settings.timerSeconds) * 1000;
  const savedTimer = saved.timerState || {};
  const savedWatch = saved.stopwatchState || {};
  const savedPomo = saved.pomoState || {};
  const savedPhase = savedPomo.phase === "break" ? "break" : "work";
  const savedPhaseDuration = (savedPhase === "break" ? settings.breakMinutes : settings.workMinutes) * 60000;

  const state = {
    mode: modes.includes(saved.mode) ? saved.mode : "timer",
    timer: {
      running: savedTimer.running === true && validEpoch(savedTimer.endAt),
      remainingMs: boundedMilliseconds(savedTimer.remainingMs, timerDuration, timerDuration),
      endAt: validEpoch(savedTimer.endAt) ? savedTimer.endAt : 0,
      done: savedTimer.done === true,
    },
    stopwatch: {
      running: savedWatch.running === true && validEpoch(savedWatch.startAt),
      elapsedMs: boundedMilliseconds(savedWatch.elapsedMs, 30 * 86400000, 0),
      startAt: validEpoch(savedWatch.startAt) ? savedWatch.startAt : 0,
    },
    pomo: {
      running: savedPomo.running === true && validEpoch(savedPomo.endAt),
      phase: savedPhase,
      remainingMs: boundedMilliseconds(savedPomo.remainingMs, savedPhaseDuration, savedPhaseDuration),
      endAt: validEpoch(savedPomo.endAt) ? savedPomo.endAt : 0,
      sets: wholeNumber(saved.sets, 0, 999999, 0),
      message: typeof savedPomo.message === "string" ? savedPomo.message : "",
    },
  };

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        ...settings, sets: state.pomo.sets, mode: state.mode,
        timerState: state.timer,
        stopwatchState: state.stopwatch,
        pomoState: state.pomo,
      }));
    } catch { /* The app still works when storage is unavailable. */ }
  }

  function formatCountdown(milliseconds) {
    const seconds = Math.ceil(Math.max(0, milliseconds) / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
    return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }

  function formatElapsed(milliseconds) {
    const tenths = Math.floor(Math.max(0, milliseconds) / 100);
    const hours = Math.floor(tenths / 36000);
    const minutes = Math.floor((tenths % 36000) / 600);
    const seconds = Math.floor((tenths % 600) / 10);
    const decimal = tenths % 10;
    return hours
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${decimal}`
      : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${decimal}`;
  }

  function setRing(id, fraction) {
    $(id).style.strokeDashoffset = String(CIRCUMFERENCE * (1 - Math.max(0, Math.min(1, fraction))));
  }

  let audioContext;
  function unlockSound() {
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioContext.state === "suspended") void audioContext.resume().catch(() => {});
    } catch { /* Some browsers do not offer Web Audio. */ }
  }

  function soundAlarm() {
    if (audioContext) {
      Promise.resolve(audioContext.resume()).then(() => {
        const now = audioContext.currentTime;
        [0, 0.22, 0.44].forEach((offset, index) => {
          const oscillator = audioContext.createOscillator();
          const gain = audioContext.createGain();
          oscillator.type = "sine";
          oscillator.frequency.value = index === 1 ? 880 : 660;
          gain.gain.setValueAtTime(0.0001, now + offset);
          gain.gain.exponentialRampToValueAtTime(0.19, now + offset + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.17);
          oscillator.connect(gain).connect(audioContext.destination);
          oscillator.start(now + offset);
          oscillator.stop(now + offset + 0.18);
        });
      }).catch(() => {});
    }
    if (navigator.vibrate) navigator.vibrate([140, 100, 140]);
    document.title = "時間です！ — おうちタイマー";
  }

  function clearAlertTitle() { document.title = "おうちタイマー"; }

  function applyTheme() {
    document.documentElement.dataset.theme = settings.theme;
    const colors = { night: "#101d34", day: "#f3f6ff", berry: "#251a32" };
    document.querySelector?.('meta[name="theme-color"]')?.setAttribute("content", colors[settings.theme]);
    document.querySelectorAll(".theme-option").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.theme === settings.theme));
    });
  }

  let wakeLock = null;
  let requestingWakeLock = false;
  const anyClockRunning = () => state.timer.running || state.stopwatch.running || state.pomo.running;

  async function syncWakeLock() {
    const wanted = settings.keepAwake && anyClockRunning() && document.visibilityState !== "hidden";
    if (!wanted) {
      if (wakeLock) {
        const current = wakeLock;
        wakeLock = null;
        try { await current.release(); } catch { /* Already released. */ }
      }
      $("wake-status").textContent = !settings.keepAwake ? ""
        : !navigator.wakeLock?.request ? "この端末では画面維持を利用できません"
        : document.visibilityState === "hidden" && anyClockRunning() ? "画面に戻ると維持を再開します"
        : "タイマーを始めると画面を維持します";
      return;
    }
    if (!navigator.wakeLock?.request) {
      $("wake-status").textContent = "この端末では画面維持を利用できません";
      return;
    }
    if (wakeLock || requestingWakeLock) return;
    requestingWakeLock = true;
    try {
      const lock = await navigator.wakeLock.request("screen");
      if (!settings.keepAwake || !anyClockRunning() || document.visibilityState === "hidden") {
        await lock.release();
      } else {
        wakeLock = lock;
        lock.addEventListener("release", () => {
          if (wakeLock === lock) {
            wakeLock = null;
            if (settings.keepAwake && document.visibilityState !== "hidden") $("wake-status").textContent = "画面維持が解除されました";
          }
        });
        $("wake-status").textContent = "画面を点けたままにしています";
      }
    } catch {
      $("wake-status").textContent = "画面維持を開始できませんでした";
    }
    requestingWakeLock = false;
  }

  function advancePomo(now, notify) {
    const pomo = state.pomo;
    if (!pomo.running || now < pomo.endAt) return false;
    const workMs = settings.workMinutes * 60000;
    const breakMs = settings.breakMinutes * 60000;
    if (!settings.autoPomo) {
      pomo.running = false;
      if (pomo.phase === "work") {
        pomo.sets += 1;
        pomo.phase = "break";
        pomo.remainingMs = breakMs;
        pomo.message = "1セット完了！ 休憩しよう";
      } else {
        pomo.phase = "work";
        pomo.remainingMs = workMs;
        pomo.message = "休憩おわり。次のセットへ";
      }
      pomo.endAt = 0;
    } else {
      const nextPhase = pomo.phase === "work" ? "break" : "work";
      if (pomo.phase === "work") pomo.sets += 1;
      const cycleMs = workMs + breakMs;
      const sinceFirstBoundary = now - pomo.endAt;
      const completeCycles = Math.floor(sinceFirstBoundary / cycleMs);
      pomo.sets += completeCycles;
      const cycleStart = pomo.endAt + completeCycles * cycleMs;
      const withinCycle = sinceFirstBoundary - completeCycles * cycleMs;
      const firstPhaseMs = nextPhase === "work" ? workMs : breakMs;
      if (withinCycle >= firstPhaseMs) {
        if (nextPhase === "work") pomo.sets += 1;
        pomo.phase = nextPhase === "work" ? "break" : "work";
        pomo.endAt = cycleStart + firstPhaseMs + (pomo.phase === "work" ? workMs : breakMs);
      } else {
        pomo.phase = nextPhase;
        pomo.endAt = cycleStart + firstPhaseMs;
      }
      pomo.remainingMs = Math.max(0, pomo.endAt - now);
      pomo.message = "";
    }
    save();
    if (notify) soundAlarm();
    void syncWakeLock();
    return true;
  }

  function tick(notify = true) {
    const now = Date.now();
    if (state.timer.running) {
      state.timer.remainingMs = Math.max(0, state.timer.endAt - now);
      if (state.timer.remainingMs === 0) {
        state.timer.running = false;
        state.timer.done = true;
        save();
        if (notify) soundAlarm();
        void syncWakeLock();
      }
    }
    if (state.pomo.running) {
      state.pomo.remainingMs = Math.max(0, state.pomo.endAt - now);
      advancePomo(now, notify);
    }
    render();
  }

  function render() {
    modes.forEach((mode) => {
      const active = state.mode === mode;
      const tab = $(`tab-${mode}`);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      $(`panel-${mode}`).hidden = !active;
    });

    const timer = state.timer;
    $("timer-display").textContent = formatCountdown(timer.remainingMs);
    $("timer-display").classList.toggle("long-time", $("timer-display").textContent.split(":").length > 2);
    $("timer-status").textContent = timer.done ? "時間です！" : timer.running ? "計測中" : timer.remainingMs < (settings.timerMinutes * 60 + settings.timerSeconds) * 1000 ? "一時停止中" : "準備OK";
    $("timer-toggle").textContent = timer.running ? "一時停止" : timer.done ? "もう一度" : timer.remainingMs < (settings.timerMinutes * 60 + settings.timerSeconds) * 1000 ? "再開" : "スタート";
    $("timer-minutes").disabled = timer.running;
    $("timer-seconds").disabled = timer.running;
    setRing("timer-ring", timer.remainingMs / ((settings.timerMinutes * 60 + settings.timerSeconds) * 1000));

    const watch = state.stopwatch;
    const elapsed = watch.elapsedMs + (watch.running ? Math.max(0, Date.now() - watch.startAt) : 0);
    $("stopwatch-display").textContent = formatElapsed(elapsed);
    $("stopwatch-display").classList.toggle("long-time", $("stopwatch-display").textContent.split(":").length > 2);
    $("stopwatch-status").textContent = watch.running ? "計測中" : elapsed ? "一時停止中" : "準備OK";
    $("stopwatch-toggle").textContent = watch.running ? "一時停止" : elapsed ? "再開" : "スタート";
    setRing("stopwatch-ring", (elapsed % 60000) / 60000);

    const pomo = state.pomo;
    const isBreak = pomo.phase === "break";
    const phaseLength = (isBreak ? settings.breakMinutes : settings.workMinutes) * 60000;
    $("panel-pomodoro").classList.toggle("is-rest", isBreak);
    $("pomo-phase").textContent = isBreak ? "休憩" : "集中";
    $("pomo-label").textContent = isBreak ? "休憩の残り時間" : "集中の残り時間";
    $("pomo-display").textContent = formatCountdown(pomo.remainingMs);
    $("pomo-display").classList.toggle("long-time", $("pomo-display").textContent.split(":").length > 2);
    $("pomo-sets").textContent = String(pomo.sets);
    $("pomo-status").textContent = pomo.running ? (isBreak ? "休憩中" : "集中中") : pomo.message || (pomo.remainingMs < phaseLength ? "一時停止中" : "準備OK");
    $("pomo-toggle").textContent = pomo.running ? "一時停止" : pomo.message ? (isBreak ? "休憩を始める" : "集中を始める") : pomo.remainingMs < phaseLength ? "再開" : "スタート";
    $("pomo-work").disabled = pomo.running;
    $("pomo-break").disabled = pomo.running;
    setRing("pomo-ring", pomo.remainingMs / phaseLength);
  }

  function selectMode(mode, focus = false) {
    if (!modes.includes(mode)) return;
    state.mode = mode;
    clearAlertTitle();
    save();
    render();
    if (focus) $(`tab-${mode}`).focus();
  }

  function toggleTimer() {
    const timer = state.timer;
    clearAlertTitle();
    if (timer.running && Date.now() >= timer.endAt) { tick(); return; }
    if (timer.running) {
      timer.remainingMs = Math.max(0, timer.endAt - Date.now());
      timer.running = false;
    } else {
      if (timer.done || timer.remainingMs <= 0) timer.remainingMs = (settings.timerMinutes * 60 + settings.timerSeconds) * 1000;
      timer.done = false;
      timer.endAt = Date.now() + timer.remainingMs;
      timer.running = true;
      unlockSound();
    }
    save();
    void syncWakeLock();
    render();
  }

  function resetTimer() {
    state.timer = { running: false, remainingMs: (settings.timerMinutes * 60 + settings.timerSeconds) * 1000, endAt: 0, done: false };
    clearAlertTitle();
    save();
    void syncWakeLock();
    render();
  }

  function toggleStopwatch() {
    const watch = state.stopwatch;
    if (watch.running) {
      watch.elapsedMs += Math.max(0, Date.now() - watch.startAt);
      watch.running = false;
    } else {
      watch.startAt = Date.now();
      watch.running = true;
    }
    save();
    void syncWakeLock();
    render();
  }

  function resetStopwatch() {
    state.stopwatch = { running: false, elapsedMs: 0, startAt: 0 };
    save();
    void syncWakeLock();
    render();
  }

  function togglePomo() {
    const pomo = state.pomo;
    clearAlertTitle();
    if (pomo.running && Date.now() >= pomo.endAt) { tick(); return; }
    if (pomo.running) {
      pomo.remainingMs = Math.max(0, pomo.endAt - Date.now());
      pomo.running = false;
    } else {
      pomo.message = "";
      pomo.endAt = Date.now() + pomo.remainingMs;
      pomo.running = true;
      unlockSound();
    }
    save();
    void syncWakeLock();
    render();
  }

  function resetPomo() {
    const pomo = state.pomo;
    pomo.running = false;
    pomo.remainingMs = (pomo.phase === "break" ? settings.breakMinutes : settings.workMinutes) * 60000;
    pomo.message = "";
    clearAlertTitle();
    save();
    void syncWakeLock();
    render();
  }

  function configureTimer(minutes, seconds) {
    settings.timerMinutes = minutes;
    settings.timerSeconds = seconds;
    $("timer-minutes").value = String(minutes);
    $("timer-seconds").value = String(seconds);
    resetTimer();
    save();
  }

  function configurePomo(workMinutes, breakMinutes) {
    settings.workMinutes = workMinutes;
    settings.breakMinutes = breakMinutes;
    $("pomo-work").value = String(workMinutes);
    $("pomo-break").value = String(breakMinutes);
    state.pomo.phase = "work";
    resetPomo();
    save();
  }

  $("timer-minutes").value = String(settings.timerMinutes);
  $("timer-seconds").value = String(settings.timerSeconds);
  $("pomo-work").value = String(settings.workMinutes);
  $("pomo-break").value = String(settings.breakMinutes);
  $("pomo-auto").checked = settings.autoPomo;
  $("keep-awake").checked = settings.keepAwake;
  applyTheme();

  document.querySelectorAll(".mode-tab").forEach((tab) => {
    tab.addEventListener("click", () => selectMode(tab.dataset.mode));
    tab.addEventListener("keydown", (event) => {
      const index = modes.indexOf(tab.dataset.mode);
      const next = event.key === "ArrowRight" ? modes[(index + 1) % modes.length]
        : event.key === "ArrowLeft" ? modes[(index + modes.length - 1) % modes.length]
        : event.key === "Home" ? modes[0] : event.key === "End" ? modes[modes.length - 1] : null;
      if (next) { event.preventDefault(); selectMode(next, true); }
    });
  });

  $("timer-toggle").addEventListener("click", toggleTimer);
  $("timer-reset").addEventListener("click", resetTimer);
  $("stopwatch-toggle").addEventListener("click", toggleStopwatch);
  $("stopwatch-reset").addEventListener("click", resetStopwatch);
  $("pomo-toggle").addEventListener("click", togglePomo);
  $("pomo-reset").addEventListener("click", resetPomo);
  $("pomo-clear-sets").addEventListener("click", () => {
    state.pomo.sets = 0;
    save();
    render();
  });
  $("pomo-auto").addEventListener("change", () => {
    tick(false);
    settings.autoPomo = $("pomo-auto").checked;
    save();
    render();
  });
  $("keep-awake").addEventListener("change", () => {
    settings.keepAwake = $("keep-awake").checked;
    save();
    void syncWakeLock();
  });
  document.querySelectorAll(".theme-option").forEach((button) => {
    button.addEventListener("click", () => {
      settings.theme = button.dataset.theme;
      applyTheme();
      save();
    });
  });

  ["timer-minutes", "timer-seconds"].forEach((id) => $(id).addEventListener("change", () => {
    let minutes = wholeNumber($("timer-minutes").value, 0, 999, settings.timerMinutes);
    const seconds = wholeNumber($("timer-seconds").value, 0, 59, settings.timerSeconds);
    if (minutes === 0 && seconds === 0) minutes = 1;
    configureTimer(minutes, seconds);
  }));

  ["pomo-work", "pomo-break"].forEach((id) => $(id).addEventListener("change", () => {
    configurePomo(
      wholeNumber($("pomo-work").value, 1, 180, settings.workMinutes),
      wholeNumber($("pomo-break").value, 1, 180, settings.breakMinutes),
    );
  }));

  // These optional browser tools act through the same functions as the visible controls.
  if (document.modelContext?.registerTool) {
    const register = (tool) => {
      try { void Promise.resolve(document.modelContext.registerTool(tool)).catch(() => {}); } catch { /* Unsupported browser. */ }
    };
    register({
      name: "configure_timer", title: "タイマーの時間を設定", description: "Set the countdown in whole minutes and seconds, then show the timer.",
      inputSchema: { type: "object", properties: { minutes: { type: "integer", minimum: 0, maximum: 999 }, seconds: { type: "integer", minimum: 0, maximum: 59 } }, required: ["minutes", "seconds"], additionalProperties: false },
      annotations: { readOnlyHint: false },
      execute(input) {
        const { minutes, seconds } = input || {};
        if (!Number.isInteger(minutes) || minutes < 0 || minutes > 999 || !Number.isInteger(seconds) || seconds < 0 || seconds > 59 || minutes + seconds === 0) throw new Error("有効な時間を指定してください");
        configureTimer(minutes, seconds); selectMode("timer");
        return { durationSeconds: minutes * 60 + seconds, running: false };
      },
    });
    register({
      name: "configure_pomodoro", title: "ポモドーロの時間を設定", description: "Set work and break durations in whole minutes, then show the pomodoro timer.",
      inputSchema: { type: "object", properties: { workMinutes: { type: "integer", minimum: 1, maximum: 180 }, breakMinutes: { type: "integer", minimum: 1, maximum: 180 } }, required: ["workMinutes", "breakMinutes"], additionalProperties: false },
      annotations: { readOnlyHint: false },
      execute(input) {
        const { workMinutes, breakMinutes } = input || {};
        if (!Number.isInteger(workMinutes) || workMinutes < 1 || workMinutes > 180 || !Number.isInteger(breakMinutes) || breakMinutes < 1 || breakMinutes > 180) throw new Error("1〜180分を指定してください");
        configurePomo(workMinutes, breakMinutes); selectMode("pomodoro");
        return { workMinutes, breakMinutes, completedSets: state.pomo.sets, running: false };
      },
    });
    register({
      name: "control_timer", title: "タイマーを操作", description: "Start, pause, or reset one of the three clocks. Shows the selected clock.",
      inputSchema: { type: "object", properties: { mode: { type: "string", enum: modes }, action: { type: "string", enum: ["start", "pause", "reset"] } }, required: ["mode", "action"], additionalProperties: false },
      annotations: { readOnlyHint: false },
      execute(input) {
        const { mode, action } = input || {};
        if (!modes.includes(mode) || !["start", "pause", "reset"].includes(action)) throw new Error("モードと操作を確認してください");
        const item = mode === "pomodoro" ? state.pomo : state[mode];
        if (action === "start" && !item.running) ({ timer: toggleTimer, stopwatch: toggleStopwatch, pomodoro: togglePomo })[mode]();
        if (action === "pause" && item.running) ({ timer: toggleTimer, stopwatch: toggleStopwatch, pomodoro: togglePomo })[mode]();
        if (action === "reset") ({ timer: resetTimer, stopwatch: resetStopwatch, pomodoro: resetPomo })[mode]();
        selectMode(mode);
        return { mode, running: (mode === "pomodoro" ? state.pomo : state[mode]).running, completedSets: state.pomo.sets };
      },
    });
  }

  document.addEventListener("visibilitychange", () => { tick(); void syncWakeLock(); });
  window.addEventListener?.("pageshow", () => { tick(); void syncWakeLock(); });
  window.setInterval(tick, 100);
  tick(false);
  void syncWakeLock();
})();
