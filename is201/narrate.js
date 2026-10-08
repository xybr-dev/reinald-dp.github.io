/* narrate.js — narration with auto-scroll for an IS 201 reading page (topic1.html …).
   Load at the end of <body>, after the page's own script:
     <link rel="stylesheet" href="narrate.css">            (in <head>)
     <script src="narrate.js"></script>                   (before </body>)

   Script: the page's own text. The hero and every <section class="chapter"> are split into
   blocks (headings, paragraphs, list items, definitions, table rows, flows, callouts, quizzes)
   and read in page order. Per block, in the HTML:
     data-say="…"           say this instead of the block's text (e.g. to spell out an acronym)
     data-narrate="skip"    leave the block (and everything inside it) out
     data-nid="name"        a fixed clip key, so a recording survives blocks added above it
   Eyebrows, tags, bylines and "Go deeper" link boxes are skipped.

   Audio: narration/<page>/audio/<key>.mp3, listed in manifest.json ({key: hash of the text it
   was recorded from}); <script data-audio="…/"> moves the folder. A block with no recording, or
   whose text changed since it was recorded, falls back to the browser's voice, so a page works
   before anything is recorded.

   Student side: the floating control (bottom right). ▶ Listen reads from the first block in
   view; the block being read is highlighted and kept on screen. Scrolling yourself stops the
   page following along (Follow brings it back). Clicking a block, or a sidebar link, while
   listening reads from there. A quick check waits for a correct answer (or Continue). With
   Auto off, narration waits at the end of each section. M is play/pause.

   Instructor side: ?record turns the page into a recording booth (Chrome or Edge, served over
   http, e.g. localhost). Choose the page's audio folder; R records/stops a take, T plays it back,
   [ and ] move between clips, clicking a block selects it. Takes are saved as takes/<key>.webm
   with takes.json and steps.json; itec-11's 05-tools/build/narrate.py narration/<page> trims,
   levels and converts them to the MP3s the player uses. */
(function () {
  const params = new URLSearchParams(location.search);
  const RECORD = params.has("record");
  const page = (location.pathname.split("/").pop() || "index").replace(/\.html?$/, "") || "index";
  const AUDIO = document.currentScript?.dataset.audio || `narration/${page}/audio/`;

  // ── The script ──────────────────────────────────────────────────────────────
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  const hash = (s) => {                               // FNV-1a, 32-bit: marks a take stale when its text changes
    let h = 0x811c9dc5;
    for (const c of s) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, "0");
  };

  const BLOCK = "h1, .dek, h2, h3, h4, p, li, blockquote, tr, .col-label, .flow, .callout, .quiz";
  const SKIP = ".eyebrow, .kicker, .tag, .byline, .refbox, thead, [data-narrate='skip'], [hidden]";
  const LETTERS = "ABCDEFGH";

  function textOf(el) {
    if (el.dataset.say) return norm(el.dataset.say);
    if (el.matches(".quiz")) {
      const prompt = norm(el.querySelector(".q-prompt")?.textContent || "").replace(/^\d+\.\s*/, "");
      const opts = [...el.querySelectorAll(".opt")].map((o, i) => `${LETTERS[i]}: ${norm(o.textContent)}.`);
      return norm(`Quick check. ${prompt} ${opts.join(" ")}`).replace(/([.!?])\./g, "$1");
    }
    if (el.matches(".flow")) return [...el.querySelectorAll(".step")].map((s) => norm(s.textContent)).join(", then ") + ".";
    if (el.matches("tr")) {                            // "Morals. Basic Meaning: … Key Question: …"
      const heads = [...(el.closest("table")?.querySelectorAll("thead th") || [])].map((th) => norm(th.textContent));
      const cells = [...el.cells].map((c) => norm(c.textContent));
      return cells.map((c, i) => (i && heads[i] ? `${heads[i]}: ${c}` : c)).map((s) => s.replace(/([^.!?:])$/, "$1.")).join(" ");
    }
    const copy = el.cloneNode(true);
    copy.querySelectorAll(SKIP).forEach((n) => n.remove());
    return norm(copy.textContent);
  }

  const regions = [...document.querySelectorAll("main .hero, main section.chapter")];
  const clips = [];                                   // every block, in page order
  const seen = new Set();
  regions.forEach((sec) => {
    const sid = sec.id || "hero";
    let n = 0;
    sec.querySelectorAll(BLOCK).forEach((el) => {
      if (el.closest(SKIP)) return;
      const outer = el.parentElement.closest(BLOCK);
      if (outer && sec.contains(outer)) return;      // already read as part of a bigger block
      const text = textOf(el);
      if (!text) return;
      let key = el.dataset.nid || (el.matches(".quiz") && el.id) || `${sid}-${n++}`;
      while (seen.has(key)) key += "x";           // keys name the audio files: keep them unique
      seen.add(key);
      clips.push({ key, text, hash: hash(text), el, sec, quiz: el.matches(".quiz") });
    });
  });
  // checkQuiz()'s answers: read whichever one it shows
  const FEEDBACK = {
    correct: { key: "fb-correct", text: "Correct." },
    incorrect: { key: "fb-incorrect", text: "Not quite. Review the section above and try again." },
    neutral: { key: "fb-neutral", text: "Please select an answer first." },
  };
  Object.values(FEEDBACK).forEach((c) => { c.hash = hash(c.text); });
  const feedbackOf = (fb) => FEEDBACK[["correct", "incorrect", "neutral"].find((k) => fb.classList.contains(`feedback-${k}`))];
  const clipOf = (el) => { const b = el.closest(BLOCK); return b && clips.find((c) => c.el === b || c.el.contains(b)); };

  if (!clips.length) return;

  let manifest = {};
  const loaded = fetch(AUDIO + "manifest.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : {})).catch(() => ({}))
    .then((m) => { manifest = m || {}; });
  const recorded = (c) => manifest[c.key] === c.hash;

  const icon = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>',
    replay: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>',
    mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1a7 7 0 0 0 6-6.9z"/></svg>',
  };

  const store = {
    get: (k, d) => { try { const v = localStorage.getItem("narrate." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem("narrate." + k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  const typing = (e) => e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.("input:not([type=radio]), textarea, select, [contenteditable]");
  const dock = document.querySelector(".progress-dock");
  const placeAboveDock = (ui) => {
    const set = () => ui.style.setProperty("--narr-dock", `${dock ? dock.offsetHeight : 0}px`);
    set(); window.addEventListener("resize", set);
  };

  // Keep a block on screen: scroll only when it has left the comfortable middle of the view
  function reveal(el, force) {
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight - (dock ? dock.offsetHeight : 0);
    if (!force && r.top >= vh * 0.12 && r.bottom <= vh * 0.78) return;
    const top = r.height > vh * 0.6 ? r.top - vh * 0.12 : r.top - (vh - r.height) / 2;
    window.scrollTo({ top: window.scrollY + top, behavior: "smooth" });
  }
  let lit = null;
  function light(el) {
    lit?.classList.remove("narr-now");
    lit = el;
    el?.classList.add("narr-now");
  }

  if (RECORD) recorder(); else player();

  // ── Player ──────────────────────────────────────────────────────────────────
  function player() {
    const RATES = [1, 1.25, 1.5, 0.85];
    const st = { on: false, paused: false, waiting: false, follow: true, auto: store.get("auto", true), rate: store.get("rate", 1) };
    let idx = -1, queue = [], cur = null, timer = null, token = 0, chunks = [], chunk = 0, usingSpeech = false;
    const audio = new Audio();
    const pre = new Audio(); pre.preload = "auto";

    const ui = document.createElement("div");
    ui.className = "narr";
    ui.setAttribute("role", "region");
    ui.setAttribute("aria-label", "Narration");
    ui.innerHTML = `
      <div class="narr-bar">
        <span class="narr-more">
          <button type="button" class="narr-stop" title="Stop narration" aria-label="Stop narration">${icon.stop}</button>
          <button type="button" class="narr-auto" title="Go on to the next section by itself">Auto</button>
          <button type="button" class="narr-rate" title="Speed" aria-label="Speed"></button>
          <button type="button" class="narr-prev" title="Previous block" aria-label="Previous block">${icon.prev}</button>
          <button type="button" class="narr-replay" title="Replay this block" aria-label="Replay this block">${icon.replay}</button>
          <button type="button" class="narr-next" title="Next block" aria-label="Next block">${icon.next}</button>
        </span>
        <span class="narr-status" aria-live="polite"></span>
        <button type="button" class="narr-follow" title="Scroll back to the part being read" hidden>Follow</button>
        <button type="button" class="narr-main" aria-keyshortcuts="M"></button>
      </div>`;
    document.body.appendChild(ui);
    placeAboveDock(ui);
    const $ = (s) => ui.querySelector(s);
    ui.addEventListener("click", (e) => { if (e.detail) e.target.closest("button")?.blur(); });

    $(".narr-main").addEventListener("click", toggle);
    $(".narr-replay").addEventListener("click", () => playAt(idx));
    $(".narr-prev").addEventListener("click", () => playAt(Math.max(0, idx - 1)));
    $(".narr-next").addEventListener("click", () => (idx < clips.length - 1 ? playAt(idx + 1) : stop()));
    $(".narr-rate").addEventListener("click", () => {
      st.rate = RATES[(RATES.indexOf(st.rate) + 1) % RATES.length];
      store.set("rate", st.rate);
      audio.playbackRate = st.rate;
      if (usingSpeech && cur && !st.paused) speak(cur, chunk);   // speech rate only applies to new utterances
      render();
    });
    $(".narr-auto").addEventListener("click", () => { st.auto = !st.auto; store.set("auto", st.auto); render(); });
    $(".narr-stop").addEventListener("click", stop);
    $(".narr-follow").addEventListener("click", () => { st.follow = true; if (lit) reveal(lit, true); render(); });
    document.addEventListener("keydown", (e) => {
      if ((e.key === "m" || e.key === "M") && !typing(e)) { e.preventDefault(); toggle(); }
    });

    function render(status) {
      const main = $(".narr-main");
      const playing = st.on && !st.paused && !st.waiting;
      main.innerHTML = playing ? `${icon.pause}<span>Pause</span>`
        : st.on ? `${icon.play}<span>${st.waiting ? "Continue" : "Resume"}</span>`
        : `${icon.play}<span>Listen</span>`;
      main.setAttribute("aria-label", playing ? "Pause narration" : st.waiting ? "Continue narration" : "Play narration");
      ui.classList.toggle("is-on", st.on);
      document.documentElement.classList.toggle("narr-listening", st.on);
      $(".narr-rate").textContent = `${st.rate}×`;
      $(".narr-auto").setAttribute("aria-pressed", String(st.auto));
      $(".narr-follow").hidden = !st.on || st.follow;
      if (status !== undefined) $(".narr-status").textContent = status;
    }

    // Start from the first block in view, so Listen reads what the student is looking at
    function firstInView() {
      const top = window.innerHeight * 0.1;
      const i = clips.findIndex((c) => c.el.getBoundingClientRect().bottom > top);
      return i < 0 ? 0 : i;
    }

    function toggle() {
      if (!st.on) { st.on = true; st.follow = true; loaded.then(() => playAt(firstInView())); }
      else if (st.waiting) { st.waiting = false; advance(); }
      else if (st.paused) resume();
      else pause();
      render();
    }

    function halt() {                       // silence everything without changing the mode
      token++;
      clearTimeout(timer);
      audio.pause(); audio.removeAttribute("src");
      speechSynthesis.cancel();
      queue = []; cur = null;
    }

    function stop() {
      halt();
      st.on = false; st.paused = false; st.waiting = false;
      light(null);
      render("");
    }

    function play(list) {
      halt();
      st.paused = false; st.waiting = false;
      queue = list.filter(Boolean);
      next();
    }

    function playAt(i) {
      if (!st.on || i < 0) return;
      idx = i;
      const c = clips[idx];
      light(c.el);
      if (st.follow) reveal(c.el);
      play([c]);
      prefetch();
    }

    function next() {
      cur = queue.shift() || null;
      if (!cur) { render(""); return stepDone(); }
      render(recorded(cur) ? "" : "browser voice");
      const t = token;
      if (recorded(cur)) {
        usingSpeech = false;
        audio.src = `${AUDIO}${cur.key}.mp3?v=${cur.hash}`;
        audio.playbackRate = st.rate;
        audio.onended = () => { if (t === token) next(); };
        audio.play().catch(() => { if (t === token) speak(cur, 0); });
      } else speak(cur, 0);
    }

    // Browser voice, one sentence at a time: Chrome drops long utterances, and its pause()
    // is unreliable on Android, so pausing cancels and resuming restarts the sentence.
    function speak(clip, from) {
      usingSpeech = true;
      speechSynthesis.cancel();
      const t = ++token;
      chunks = (clip.text.match(/[^.!?]+[.!?]*["”')]?\s*/g) || [clip.text]).reduce((out, s) => {
        if (out.length && /\b(vs|e\.g|i\.e|etc|cf|Dr|Mr|Ms|Mrs|St|No)\.\s*$/i.test(out[out.length - 1])) out[out.length - 1] += s;
        else out.push(s);
        return out;
      }, []);
      chunk = from;
      const say = () => {
        if (t !== token) return;
        if (chunk >= chunks.length) return next();
        const u = new SpeechSynthesisUtterance(chunks[chunk].trim());
        const v = voice();
        if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "en-PH";
        u.rate = st.rate;
        u.onend = () => { if (t === token) { chunk++; say(); } };
        u.onerror = u.onend;
        speechSynthesis.speak(u);
      };
      say();
    }

    function voice() {
      const vs = speechSynthesis.getVoices();
      return vs.find((v) => v.lang === "en-PH") || vs.find((v) => /^en[-_](GB|AU|US)/.test(v.lang) && v.localService)
        || vs.find((v) => v.lang.startsWith("en"));
    }

    function pause() {
      st.paused = true;
      clearTimeout(timer);
      if (!cur) return;                     // paused between blocks: resume() picks it up
      if (usingSpeech) { token++; speechSynthesis.cancel(); } else audio.pause();
    }

    function resume() {
      st.paused = false;
      if (!cur) return stepDone();
      if (usingSpeech) speak(cur, chunk);
      else { const t = token; audio.play().catch(() => { if (t === token) speak(cur, 0); }); }
    }

    function stepDone() {
      if (!st.on || st.paused) return;
      const c = clips[idx];
      if (c.quiz && !c.el.dataset.solved) { st.waiting = true; return render("Answer to go on"); }
      const after = clips[idx + 1];
      if (!after) return stop();
      if (after.sec !== c.sec && !st.auto) { st.waiting = true; return render("End of section"); }
      timer = setTimeout(advance, after.sec !== c.sec ? 900 : 250);
    }

    function advance() {
      if (idx >= clips.length - 1) return stop();
      playAt(idx + 1);
    }

    // Quick checks: say checkQuiz()'s answer; a correct one carries on
    clips.filter((c) => c.quiz).forEach((c) => {
      const fb = c.el.querySelector(".feedback");
      if (!fb) return;
      new MutationObserver(() => {
        const said = fb.classList.contains("show") && feedbackOf(fb);
        if (!st.on || !said || clips[idx] !== c) return;
        play([said]);                       // ends in stepDone(): waits again unless now solved
        render();
      }).observe(fb, { attributes: true, attributeFilter: ["class"] });
    });

    // The student scrolls: stop following until they ask for it again
    const unfollow = () => { if (st.on && st.follow) { st.follow = false; render(); } };
    window.addEventListener("wheel", unfollow, { passive: true });
    window.addEventListener("touchmove", unfollow, { passive: true });
    document.addEventListener("keydown", (e) => {
      if (["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "].includes(e.key) && !typing(e) && !e.target.closest?.(".quiz, .narr")) unfollow();
    });

    // While listening, a click on a block (not on a link or a control) reads from there
    document.querySelector("main").addEventListener("click", (e) => {
      if (!st.on || e.target.closest("a, button, input, label, select, textarea") || getSelection().toString()) return;
      const c = clipOf(e.target);
      if (c) { st.follow = true; playAt(clips.indexOf(c)); render(); }
    });
    // …and so does a sidebar link
    window.addEventListener("hashchange", () => {
      const sec = st.on && document.getElementById(decodeURIComponent(location.hash.slice(1)));
      const i = sec ? clips.findIndex((c) => sec.contains(c.el)) : -1;
      if (i >= 0) { st.follow = true; playAt(i); render(); }
    });

    function prefetch() {
      const after = clips[idx + 1];
      if (after && recorded(after)) pre.src = `${AUDIO}${after.key}.mp3?v=${after.hash}`;
    }

    render("");
  }

  // ── Recorder (?record) ──────────────────────────────────────────────────────
  function recorder() {
    document.documentElement.classList.add("narr-recording");
    const all = [...clips, ...Object.values(FEEDBACK)];
    let dir = null, savedName = "", takesDir = null, takes = {}, sel = 0, rec = null, stream = null, chunksR = [], meterRaf = 0;
    const take = new Audio();

    const ui = document.createElement("div");
    ui.className = "narr-booth";
    ui.innerHTML = `
      <aside class="nb-list" aria-label="Clips"><ol></ol></aside>
      <section class="nb-prompt">
        <div class="nb-head">
          <span class="nb-key"></span><span class="nb-state"></span>
          <span class="nb-count"></span>
          <button type="button" class="nb-folder"></button>
        </div>
        <p class="nb-text"></p>
        <div class="nb-controls">
          <button type="button" class="nb-rec" aria-keyshortcuts="R">${icon.mic}<span>Record</span> <kbd>R</kbd></button>
          <button type="button" class="nb-play" aria-keyshortcuts="T">${icon.play}<span>Play take</span> <kbd>T</kbd></button>
          <button type="button" class="nb-prev">Previous clip <kbd>[</kbd></button>
          <button type="button" class="nb-next">Next clip <kbd>]</kbd></button>
          <span class="nb-meter" aria-hidden="true"><i></i></span>
          <span class="nb-msg" aria-live="polite"></span>
        </div>
      </section>`;
    document.body.appendChild(ui);
    const $ = (s) => ui.querySelector(s);

    const list = $(".nb-list ol");
    all.forEach((c, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<button type="button"><span class="nb-dot"></span><span class="nb-k"></span></button>`;
      li.querySelector(".nb-k").textContent = c.key;
      li.firstChild.addEventListener("click", () => select(i));
      list.appendChild(li);
    });

    const status = (c) => !takes[c.key] ? "missing" : takes[c.key].hash === c.hash ? "done" : "stale";
    const LABEL = { missing: "not recorded", done: "recorded", stale: "text changed: record again" };
    const msg = (t) => { $(".nb-msg").textContent = t; };

    function render() {
      const c = all[sel];
      $(".nb-key").textContent = c.key + (c.el ? "" : "  (quick-check answer)");
      const s = status(c);
      $(".nb-state").textContent = LABEL[s];
      $(".nb-state").dataset.s = s;
      $(".nb-text").textContent = c.text;
      const n = all.filter((x) => status(x) === "done").length;
      const stale = all.filter((x) => status(x) === "stale").length;
      $(".nb-count").textContent = `${n} / ${all.length} recorded${stale ? ` · ${stale} stale` : ""}`;
      $(".nb-folder").textContent = dir ? `Folder: ${dir.name}/` : savedName ? `Reconnect folder: ${savedName}/` : "Choose the audio folder";
      $(".nb-folder").classList.toggle("is-set", !!dir);
      $(".nb-rec").classList.toggle("is-live", !!rec);
      $(".nb-rec span").textContent = rec ? "Stop" : takes[c.key] ? "Record again" : "Record";
      $(".nb-play").disabled = !takes[c.key] || !!rec;
      [...list.children].forEach((li, i) => {
        li.dataset.s = status(all[i]);
        li.classList.toggle("is-sel", i === sel);
      });
      list.children[sel].scrollIntoView({ block: "nearest" });
    }

    function select(i) {
      if (rec) return;
      sel = Math.max(0, Math.min(all.length - 1, i));
      take.pause();
      const el = all[sel].el;
      light(el || null);
      if (el) reveal(el, true);
      render();
    }

    // A click on a block selects its clip
    document.querySelector("main").addEventListener("click", (e) => {
      if (e.target.closest("a, button, input, label")) return;
      const c = clipOf(e.target);
      if (c) select(all.indexOf(c));
    });

    // Folder: picked once, remembered in IndexedDB; Chrome asks again for permission per session
    function idb(handle) {
      return new Promise((res, rej) => {
        const r = indexedDB.open("narrate", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("dirs");
        r.onerror = () => rej(r.error);
        r.onsuccess = () => {
          const os = r.result.transaction("dirs", handle ? "readwrite" : "readonly").objectStore("dirs");
          const q = handle ? os.put(handle, location.pathname) : os.get(location.pathname);
          q.onsuccess = () => res(q.result);
          q.onerror = () => rej(q.error);
        };
      });
    }

    async function connect(handle) {
      if ((await handle.queryPermission({ mode: "readwrite" })) !== "granted"
        && (await handle.requestPermission({ mode: "readwrite" })) !== "granted") return msg("Permission refused: choose the folder again.");
      dir = handle;
      takesDir = await dir.getDirectoryHandle("takes", { create: true });
      try { takes = JSON.parse(await (await (await dir.getFileHandle("takes.json")).getFile()).text()); } catch { takes = {}; }
      await writeJSON("steps.json", all.map(({ key, hash, text }) => ({ key, hash, text })));
      if (dir.name !== "audio") msg(`Heads up: the folder is "${dir.name}", not ${AUDIO}`);
      else msg("");
      render();
    }

    async function writeJSON(name, data) {
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await w.write(JSON.stringify(data, null, 1) + "\n");
      await w.close();
    }

    $(".nb-folder").addEventListener("click", async () => {
      if (!window.showDirectoryPicker) return msg("This browser cannot save to a folder: use Chrome or Edge, over http (localhost).");
      try {
        const saved = await idb().catch(() => null);
        if (saved && !dir) { try { return await connect(saved); } catch { /* fall through to the picker */ } }
        const h = await showDirectoryPicker({ id: "narrate-audio", mode: "readwrite" });
        await idb(h).catch(() => {});
        await connect(h);
      } catch (e) { if (e.name !== "AbortError") msg(e.message); }
    });

    async function toggleRec() {
      if (rec) return rec.stop();
      if (!dir) return msg("Choose the audio folder first.");
      try {
        stream = stream || await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: false },
        });
      } catch (e) { return msg("No microphone: " + e.message); }
      meter(stream);
      take.pause();
      const c = all[sel];
      chunksR = [];
      rec = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 128000 });
      rec.ondataavailable = (e) => e.data.size && chunksR.push(e.data);
      rec.onstop = async () => {
        rec = null;
        try {
          const w = await (await takesDir.getFileHandle(`${c.key}.webm`, { create: true })).createWritable();
          await w.write(new Blob(chunksR, { type: "audio/webm" }));
          await w.close();
          takes[c.key] = { hash: c.hash, at: new Date().toISOString() };
          await writeJSON("takes.json", takes);
          msg(`Saved ${c.key}.`);
          const nextMissing = all.findIndex((x, i) => i > sel && status(x) !== "done");
          select(nextMissing < 0 ? sel : nextMissing);
        } catch (e) { msg("Not saved: " + e.message); render(); }
      };
      rec.start();
      msg("Recording…");
      render();
    }

    async function playTake() {
      const c = all[sel];
      if (!takes[c.key] || rec) return;
      if (!take.paused) return take.pause();
      try {
        const f = await (await takesDir.getFileHandle(`${c.key}.webm`)).getFile();
        if (take.src) URL.revokeObjectURL(take.src);
        take.src = URL.createObjectURL(f);
        take.play();
      } catch (e) { msg("Cannot play: " + e.message); }
    }

    function meter(s) {
      if (meterRaf) return;
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      ctx.createMediaStreamSource(s).connect(an);
      const buf = new Float32Array(an.fftSize);
      const bar = $(".nb-meter i");
      const tick = () => {
        an.getFloatTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v));
        bar.style.width = `${Math.min(100, peak * 100)}%`;
        bar.dataset.clip = peak > 0.95 ? "1" : "";
        meterRaf = requestAnimationFrame(tick);
      };
      tick();
    }

    $(".nb-rec").addEventListener("click", toggleRec);
    $(".nb-play").addEventListener("click", playTake);
    $(".nb-prev").addEventListener("click", () => select(sel - 1));
    $(".nb-next").addEventListener("click", () => select(sel + 1));
    document.addEventListener("keydown", (e) => {
      if (typing(e) || e.repeat) return;
      const act = { r: toggleRec, R: toggleRec, t: playTake, T: playTake, "[": () => select(sel - 1), "]": () => select(sel + 1) }[e.key];
      if (act) { e.preventDefault(); act(); }
    });

    idb().then((h) => { if (h) { savedName = h.name; render(); } }).catch(() => {});
    select(0);
  }
})();
