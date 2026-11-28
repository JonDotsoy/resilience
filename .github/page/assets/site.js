(function () {
  // --- i18n: the page language comes from <html lang> ---
  var ES = document.documentElement.lang === "es";
  function t(en, es) { return ES ? es : en; }
  var tr = t; // alias for scopes that shadow `t`

  // --- Tiny TypeScript highlighter (no dependencies) ---
  var KW = /^(import|from|export|const|let|var|await|async|function|return|if|else|for|of|in|new|class|extends|constructor|public|readonly|throw|try|catch|typeof|instanceof|type|this|true|false|null|undefined|break|as)$/;
  function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function highlight(src) {
    var re = /(\/\/[^\n]*)|(`(?:\\.|[^`])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\b(\d[\d_]*(?:\.\d+)?)\b|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)/g;
    var out = "", last = 0, m;
    while ((m = re.exec(src))) {
      out += esc(src.slice(last, m.index));
      if (m[1]) out += '<span class="tok-c">' + esc(m[1]) + "</span>";
      else if (m[2]) out += '<span class="tok-s">' + esc(m[2]) + "</span>";
      else if (m[3]) out += '<span class="tok-n">' + m[3] + "</span>";
      else if (m[4]) out += KW.test(m[4]) ? '<span class="tok-k">' + m[4] + "</span>" : '<span class="tok-f">' + m[4] + "</span>";
      else out += KW.test(m[5]) ? '<span class="tok-k">' + m[5] + "</span>" : m[5];
      last = re.lastIndex;
    }
    return out + esc(src.slice(last));
  }
  document.querySelectorAll("pre[data-hl] code").forEach(function (el) {
    el.innerHTML = highlight(el.textContent);
  });

  // --- Copy buttons on code blocks ---
  function copyText(text, btn) {
    var done = function () { btn.textContent = t("Copied ✓", "Copiado ✓"); btn.classList.add("copied"); setTimeout(function () { btn.textContent = t("Copy", "Copiar"); btn.classList.remove("copied"); }, 1400); };
    try {
      navigator.clipboard.writeText(text).then(done, function () { selectFallback(btn); });
    } catch (e) { selectFallback(btn); }
  }
  function selectFallback(btn) {
    var target = btn.parentElement.querySelector("code, pre");
    if (!target) return;
    var r = document.createRange(); r.selectNodeContents(target);
    var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    btn.textContent = t("Press ⌘C", "Pulsa ⌘C");
  }
  var RM = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  function onVisible(el, fn) {
    if (!el || !("IntersectionObserver" in window)) return;
    var io = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { io.disconnect(); fn(); } }, { threshold: 0.45 });
    io.observe(el);
  }
  function restart(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  document.querySelectorAll(".code").forEach(function (box) {
    var b = document.createElement("button");
    b.className = "copy"; b.type = "button"; b.textContent = t("Copy", "Copiar");
    b.addEventListener("click", function () { copyText(box.querySelector("pre").textContent, b); });
    box.appendChild(b);
    var l = document.createElement("span"); l.className = "lang"; l.textContent = "ts"; box.appendChild(l);
  });
  document.querySelectorAll("[data-copy]").forEach(function (b) {
    b.addEventListener("click", function () { copyText(document.querySelector(b.dataset.copy).textContent, b); });
  });

  // --- Colorize glyphs in timeline diagrams ---
  var G = { "●": "g-ok", "✕": "g-fail", "○": "g-rej", "◐": "g-probe", "◷": "g-queue", "◆": "g-hit", "◌": "g-share" };
  document.querySelectorAll("pre[data-glyphs]").forEach(function (el) {
    el.innerHTML = esc(el.textContent).replace(/[●✕○◐◷◆◌]/g, function (c) { return '<span class="' + G[c] + '">' + c + "</span>"; });
  });

  // --- Visual timelines for stateful policies ---
  // Tokens per step: o ok/call, x fail, r rejected, P probe ok, F probe fail, q queued, - running, h hit, s share, S share failed, . empty
  var MK = {
    o: '<i class="mk ok"></i>', x: '<i class="mk fail"></i>', r: '<i class="mk rej"></i>',
    P: '<i class="mk probe sm"></i><i class="mk ok sm"></i>', F: '<i class="mk probe sm"></i><i class="mk fail sm"></i>',
    q: '<i class="mk queue"></i>', "-": '<i class="run"></i>', h: '<i class="mk hit"></i>',
    s: '<i class="mk share"></i>', S: '<i class="mk share sm"></i><i class="mk fail sm"></i>'
  };
  var LEGEND_MK = { o: MK.o, x: MK.x, r: MK.r, p: '<i class="mk probe"></i>', q: MK.q, "-": '<i class="run run-key"></i>', h: MK.h, s: MK.s, S: MK.S };
  var TL = {
    circuit: {
      label: "Circuit breaker timeline shared by consumers A and B",
      phases: [[1, 7, "closed", "closed"], [8, 11, "open", "open · 10 s"], [12, 12, "half", "half"], [13, 15, "open", "open · 10 s"], [16, 16, "half", "half"], [17, 18, "closed", "closed"]],
      rows: [["A", "o.x.x.x.r.r.r.rP.o"], ["B", ".o.o.x.r.r.F.r..o."]],
      meters: [["failures", [0, 0, 1, 0, 1, 2, 3, "", "", "", "", "", "", "", "", "", 0, 0], 3]],
      legend: [["o", "successful call"], ["x", "failed call, counts toward failureThreshold"], ["r", "rejected with CircuitOpenError"], ["p", "probe call in half-open"]]
    },
    bulkhead: {
      label: "Bulkhead timeline shared by consumers A, B and C",
      rows: [["A", "o-...qo-"], ["B", ".qo-...."], ["C", ".r.qo-.."]],
      meters: [["running", [1, 1, 1, 1, 1, 1, 1, 1]], ["queued", ["", 1, "", 1, "", 1, "", ""]]],
      legend: [["o", "starts"], ["-", "running"], ["q", "waits in the queue"], ["r", "rejected with BulkheadRejectedError"]]
    },
    throttle: {
      label: "Throttle timeline shared by consumers A, B and C",
      rows: [["A", "or...o.....o"], ["B", "o.r...o....o"], ["C", "o....o.r...."]],
      meters: [["slots left", [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2, 1]]], window: 5,
      legend: [["o", "allowed"], ["r", "rejected with ThrottleError"]]
    },
    cache: {
      label: "Cache timeline for one key shared by consumers A, B and C",
      rows: [["A", "o-..h....S...h.."], ["B", ".s....h....o-..."], ["C", "..h.....x-..s..."]],
      meters: [["ttl", ["", "", 5, 4, 3, 2, 1, "", "", "", "", "", "", 5, 4, 3]]],
      legend: [["o", "miss, calls the service"], ["-", "waiting for the response"], ["h", "hit"], ["s", "shares the in-flight call"], ["x", "failing miss, not cached"], ["S", "shared call that failed"]]
    },
    dedupe: {
      label: "Dedupe timeline for one key shared by consumers A, B and C",
      rows: [["A", "o-.s....S...."], ["B", ".s...o-...o-."], ["C", "..o-....x-..s"]],
      meters: [["pending", [1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 0]]],
      legend: [["o", "calls the service"], ["-", "waiting for the response"], ["s", "receives the same promise"], ["x", "failing call"], ["S", "shared call that failed"]]
    }
  };
  document.querySelectorAll("figure.tl[data-tl]").forEach(function (fig) {
    var d = TL[fig.dataset.tl]; if (!d) return;
    var n = d.rows[0][1].length, h = "";
    var phaseAt = [];
    if (d.phases) {
      h += '<div class="tl-lbl">state</div>';
      d.phases.forEach(function (p) {
        for (var k = p[0]; k <= p[1]; k++) phaseAt[k] = p[2];
        h += '<div class="tl-phase ph-' + p[2] + '" style="grid-column:' + (p[0] + 1) + " / " + (p[1] + 2) + '">' + p[3] + "</div>";
      });
    }
    d.rows.forEach(function (r) {
      h += '<div class="tl-lbl who">' + r[0] + "</div>";
      for (var i = 0; i < n; i++) h += '<div class="tl-cell" data-c="' + i + '">' + (MK[r[1][i]] || "") + "</div>";
    });
    (d.meters || []).forEach(function (m) {
      h += '<div class="tl-lbl">' + m[0] + "</div>";
      m[1].forEach(function (v, i) { h += '<div class="tl-cell meter' + (m[2] !== undefined && v === m[2] ? " hot" : "") + '" data-c="' + i + '">' + v + "</div>"; });
    });
    h += '<div class="tl-axis">' + t("time", "tiempo") + '</div>';
    var lg = d.legend.map(function (l) { return "<span>" + LEGEND_MK[l[0]] + l[1] + "</span>"; }).join("");
    fig.setAttribute("role", "img"); fig.setAttribute("aria-label", d.label);
    var win = d.window ? '<div class="tl-window" style="opacity:0"><b>window · last ' + d.window + ' steps</b></div>' : "";
    if (d.window) fig.classList.add("tl-figure-anim");
    fig.innerHTML = '<div class="player"><button type="button" class="btn primary p-play">▶ Play</button><button type="button" class="btn p-next">Step →</button><button type="button" class="btn p-all">Show all</button><span class="p-step"></span></div>' +
      '<div class="tl-scroll"><div class="tl-grid" style="--n:' + n + '">' + win + h + '</div></div><p class="player-msg" aria-live="polite"></p><figcaption class="tl-legend">' + lg + "</figcaption>";
    initPlayer(fig, d, n);
  });

  function initPlayer(fig, d, n) {
    var grid = fig.querySelector(".tl-grid"), cells = fig.querySelectorAll("[data-c]"), winEl = fig.querySelector(".tl-window");
    var playBtn = fig.querySelector(".p-play"), msg = fig.querySelector(".player-msg"), lbl = fig.querySelector(".p-step");
    var DESC = {}; d.legend.forEach(function (l) { DESC[l[0]] = l[1]; });
    DESC.P = DESC.p; DESC.F = DESC.p;
    var cur = n, active = false, timer = null;
    function describe(i) {
      var parts = [];
      d.rows.forEach(function (r) { var t = r[1][i]; if (t !== "." && DESC[t]) parts.push(r[0] + ": " + DESC[t]); });
      (d.meters || []).forEach(function (m) { var v = m[1][i]; if (v !== "" && v !== undefined) parts.push(m[0] + " " + v); });
      return parts.length ? parts.join(" · ") : "nothing happens";
    }
    function show(k) {
      cur = k;
      cells.forEach(function (c) { var i = +c.dataset.c; c.classList.toggle("off", active && i >= k); c.classList.toggle("now", active && i === k - 1); });
      grid.classList.toggle("stepped", active);
      lbl.textContent = active ? "step " + k + " / " + n : n + " steps";
      msg.textContent = active ? (k ? "Step " + k + ": " + describe(k - 1) + "." : "Press Play or Step.") : "Press Play to watch it step by step.";
      if (winEl) {
        if (active && k > 0) {
          var a = grid.querySelector('.tl-cell[data-c="' + Math.max(0, k - d.window) + '"]'), b = grid.querySelector('.tl-cell[data-c="' + (k - 1) + '"]');
          winEl.style.left = (a.offsetLeft - 2) + "px"; winEl.style.width = (b.offsetLeft + b.offsetWidth - a.offsetLeft + 4) + "px"; winEl.style.opacity = 1;
        } else winEl.style.opacity = 0;
      }
      var now = grid.querySelector(".tl-cell.now"), sc = grid.parentElement;
      if (now && (now.offsetLeft + now.offsetWidth > sc.scrollLeft + sc.clientWidth || now.offsetLeft < sc.scrollLeft + 92)) sc.scrollLeft = Math.max(0, now.offsetLeft - sc.clientWidth / 2);
      if (!active) sc.scrollLeft = 0;
    }
    function stop() { clearInterval(timer); timer = null; playBtn.textContent = cur >= n ? "↻ Replay" : "▶ Play"; }
    function next() { if (!active || cur >= n) { active = true; show(0); } show(cur + 1); if (cur >= n) stop(); }
    function play() {
      if (timer) { stop(); return; }
      if (!active || cur >= n) { active = true; show(0); }
      playBtn.textContent = "❚❚ Pause";
      timer = setInterval(next, 800);
    }
    playBtn.addEventListener("click", play);
    fig.querySelector(".p-next").addEventListener("click", function () { if (timer) stop(); next(); playBtn.textContent = cur >= n ? "↻ Replay" : "▶ Play"; });
    fig.querySelector(".p-all").addEventListener("click", function () { if (timer) stop(); active = false; show(n); playBtn.textContent = "▶ Play"; });
    show(n);
    if (!RM) onVisible(fig, function () { if (!active) play(); });
  }

  function followNow(g) {
    var sc = g.parentElement, now = g.querySelector(".tl-cell.now");
    sc.scrollLeft = now ? Math.max(0, now.offsetLeft + now.offsetWidth + 24 - sc.clientWidth) : 0;
  }
  // --- Circuit breaker playground ---
  (function () {
    var MAXSTEPS = 30;
    var cfg = { thr: 3, reset: 4, succ: 1 };
    var LIM = { thr: [1, 6], reset: [1, 8], succ: [1, 3] };
    var st;
    var EXAMPLE = [["A","o"],["B","o"],["A","x"],["B","o"],["A","x"],["B","x"],["A","x"],["B","o"],["A","o"],["B","o"],["A","o"],["B","x"],["A","o"],["B","o"],["A","o"],["B","o"],["A","o"],["B","o"],["A","o"]];
    function reset() { st = { t: 0, state: "closed", fails: 0, succ: 0, openedAt: 0, hist: [] }; }
    function step(who, res) {
      st.t++;
      var notes = [];
      if (st.state === "open" && st.t - st.openedAt > cfg.reset) { st.state = "half"; st.succ = 0; notes.push(t("resetTimeout elapsed, the circuit is half-open", "pasó el resetTimeout, el circuito queda semiabierto")); }
      var phase = st.state, row = { A: ".", B: "." };
      if (who) {
        if (st.state === "open") { row[who] = "r"; notes.push(who + t(" is rejected with CircuitOpenError without calling the service", " es rechazado con CircuitOpenError sin llamar al servicio")); }
        else if (st.state === "half") {
          row[who] = res === "o" ? "P" : "F";
          if (res === "o") {
            st.succ++;
            if (st.succ >= cfg.succ) { st.state = "closed"; st.fails = 0; notes.push(t(who + "'s probe succeeds and the circuit closes", "la prueba de " + who + " tiene éxito y el circuito se cierra")); }
            else notes.push(t(who + "'s probe succeeds", "la prueba de " + who + " tiene éxito") + " (" + st.succ + "/" + cfg.succ + ")");
          } else { st.state = "open"; st.openedAt = st.t; notes.push(t(who + "'s probe fails and the circuit opens again", "la prueba de " + who + " falla y el circuito se vuelve a abrir")); }
        } else {
          row[who] = res;
          if (res === "o") { notes.push(who + t(" succeeds", " tiene éxito") + (st.fails ? t(" and resets the counter", " y reinicia el contador") : "")); st.fails = 0; }
          else {
            st.fails++;
            if (st.fails >= cfg.thr) { st.state = "open"; st.openedAt = st.t; notes.push(who + t(" fails: ", " falla: ") + st.fails + t(" in a row, the circuit opens", " seguidos, el circuito se abre")); }
            else notes.push(who + t(" fails (", " falla (") + st.fails + "/" + cfg.thr + ")");
          }
        }
      } else notes.push(t("no calls", "sin llamadas"));
      st.hist.push({ row: row, phase: phase, fails: phase === "closed" ? st.fails : "" });
      if (st.hist.length > MAXSTEPS) st.hist.shift();
      return notes;
    }
    var STATE_TXT = ES
      ? { closed: ["cerrado", "las llamadas pasan"], open: ["abierto", "las llamadas se rechazan"], half: ["semiabierto", "la próxima llamada es una prueba"] }
      : { closed: ["closed", "calls go through"], open: ["open", "calls are rejected"], half: ["half-open", "next call is a probe"] };
    var PH_TXT = ES ? { closed: "cerrado", open: "abierto", half: "semi" } : { closed: "closed", open: "open", half: "half" };
    var PH_CLS = { closed: "ph-closed", open: "ph-open", half: "ph-half" };
    var prevState = null;
    function render(msg, stepped) {
      Object.keys(cfg).forEach(function (k) { document.getElementById("cb-" + k).textContent = cfg[k]; });
      document.querySelectorAll("#cb-sim [data-cb]").forEach(function (b) {
        var k = b.dataset.cb, v = cfg[k] + (+b.dataset.d); b.disabled = v < LIM[k][0] || v > LIM[k][1];
      });
      var stEl = document.getElementById("cb-state"), cur = st.state;
      if (cur === "open" && st.t + 1 - st.openedAt > cfg.reset) cur = "openready";
      var txt = cur === "openready" ? t(["open", "next step goes half-open"], ["abierto", "el próximo paso pasa a semiabierto"]) : STATE_TXT[cur];
      var col = cur === "closed" ? "var(--ok)" : cur === "half" ? "var(--wait)" : "var(--fail)";
      stEl.innerHTML = txt[0] + " <small>" + txt[1] + "</small>";
      stEl.style.color = col; stEl.style.background = "color-mix(in srgb, " + col + " 12%, transparent)";
      if (stepped && prevState !== null && prevState !== st.state) restart(stEl, "pulse");
      prevState = st.state;
      var m = "", lbl = document.getElementById("cb-meter-lbl");
      if (st.state === "closed") { lbl.textContent = t("Consecutive failures", "Fallos consecutivos"); for (var i = 0; i < cfg.thr; i++) m += '<i class="cb-dot' + (i < st.fails ? " on" : "") + (stepped && i === st.fails - 1 ? " fresh" : "") + '"></i>'; m += '<span class="cb-count">' + st.fails + "/" + cfg.thr + "</span>"; }
      else if (st.state === "open") { lbl.textContent = t("Steps until half-open", "Pasos hasta semiabierto"); var left = Math.max(0, cfg.reset - (st.t - st.openedAt)); for (var j = 0; j < cfg.reset; j++) m += '<i class="cb-dot' + (j < left ? " on" : "") + '"></i>'; m += '<span class="cb-count">' + left + "</span>"; }
      else { lbl.textContent = t("Probe successes", "Pruebas exitosas"); for (var k2 = 0; k2 < cfg.succ; k2++) m += '<i class="cb-dot' + (k2 < st.succ ? " ok" : "") + (stepped && k2 === st.succ - 1 ? " fresh" : "") + '"></i>'; m += '<span class="cb-count">' + st.succ + "/" + cfg.succ + "</span>"; }
      document.getElementById("cb-meter").innerHTML = m;
      var n = Math.max(st.hist.length, 10), h = '<div class="tl-lbl">' + t("state", "estado") + "</div>";
      var i0 = 0;
      while (i0 < st.hist.length) {
        var ph = st.hist[i0].phase, i1 = i0;
        while (i1 + 1 < st.hist.length && st.hist[i1 + 1].phase === ph) i1++;
        var span = i1 - i0 + 1, name = PH_TXT[ph];
        if (ph === "open" && span >= 3) name = PH_TXT.open + " · " + span + t(" steps", " pasos");
        h += '<div class="tl-phase ' + PH_CLS[ph] + '" style="grid-column:' + (i0 + 2) + " / " + (i1 + 3) + '">' + name + "</div>";
        i0 = i1 + 1;
      }
      if (st.hist.length < n) h += '<div style="grid-column:' + (st.hist.length + 2) + ' / -1"></div>';
      ["A", "B"].forEach(function (w) {
        h += '<div class="tl-lbl who">' + w + "</div>";
        for (var c = 0; c < n; c++) { var e = st.hist[c]; h += '<div class="tl-cell' + (c === st.hist.length - 1 ? " now" : "") + '">' + (e ? (MK[e.row[w]] || "") : "") + "</div>"; }
      });
      h += '<div class="tl-lbl">' + t("failures", "fallos") + "</div>";
      for (var c2 = 0; c2 < n; c2++) { var e2 = st.hist[c2]; h += '<div class="tl-cell meter' + (e2 && e2.fails !== "" && e2.fails >= cfg.thr ? " hot" : "") + '">' + (e2 ? e2.fails : "") + "</div>"; }
      h += '<div class="tl-axis">' + t("time", "tiempo") + '</div>';
      var g = document.getElementById("cb-grid"); g.style.setProperty("--n", n); g.innerHTML = h; g.classList.toggle("stepped", !!stepped);
      followNow(g);
      document.getElementById("cb-msg").textContent = msg || "";
    }
    function playExample() {
      cfg = { thr: 3, reset: 4, succ: 1 }; reset();
      EXAMPLE.forEach(function (c) { step(c[0], c[1]); });
      render(t("Example: failureThreshold 3, resetTimeout 4 steps. Make calls to continue.", "Ejemplo: failureThreshold 3, resetTimeout 4 pasos. Haz llamadas para continuar."));
    }
    document.querySelectorAll("#cb-sim .call-btn").forEach(function (b) {
      b.addEventListener("click", function () { render(t("Step ", "Paso ") + (st.t + 1) + ": " + step(b.dataset.who, b.dataset.res).join(". ") + ".", true); });
    });
    document.getElementById("cb-wait").addEventListener("click", function () { render(t("Step ", "Paso ") + (st.t + 1) + ": " + step(null).join(". ") + ".", true); });
    document.querySelectorAll("#cb-sim [data-cb]").forEach(function (b) {
      b.addEventListener("click", function () {
        cfg[b.dataset.cb] += +b.dataset.d;
        if (st.state === "closed" && st.fails >= cfg.thr) { st.fails = cfg.thr - 1; }
        render("failureThreshold " + cfg.thr + ", resetTimeout " + cfg.reset + t(" steps", " pasos") + ", successThreshold " + cfg.succ + ".");
      });
    });
    document.getElementById("cb-clear").addEventListener("click", function () { reset(); render(t("Cleared. The circuit starts closed.", "Limpio. El circuito empieza cerrado.")); });
    document.getElementById("cb-example").addEventListener("click", playExample);
    playExample();
  })();

  // --- Bulkhead playground ---
  (function () {
    var DUR = 2, MAXSTEPS = 24;
    var cfg = { slots: 1, queue: 1 };
    var st, pending = {};
    var EXAMPLE = [["A"], ["B", "C"], [], ["C"], [], ["A"], [], []];
    function reset() { st = { t: 0, running: [], queue: [], hist: [] }; pending = {}; }
    function step(arrivals) {
      var row = { A: ".", B: ".", C: "." }, notes = [];
      st.running.forEach(function (r) { r.left--; });
      st.running = st.running.filter(function (r) { if (r.left > 0) { row[r.who] = "-"; return true; } notes.push(r.who + t(" finishes", " termina")); return false; });
      while (st.running.length < cfg.slots && st.queue.length) {
        var w = st.queue.shift(); st.running.push({ who: w, left: DUR }); row[w] = "o"; notes.push(w + t(" leaves the queue and starts", " sale de la cola y empieza"));
      }
      arrivals.forEach(function (w) {
        if (st.running.some(function (r) { return r.who === w; }) || st.queue.indexOf(w) >= 0) { notes.push(w + t(" is already busy", " ya está ocupado")); return; }
        if (st.running.length < cfg.slots) { st.running.push({ who: w, left: DUR }); row[w] = "o"; notes.push(w + t(" starts", " empieza")); }
        else if (st.queue.length < cfg.queue) { st.queue.push(w); row[w] = "q"; notes.push(w + t(" waits in the queue", " espera en la cola")); }
        else { row[w] = "r"; notes.push(w + t(" is rejected with BulkheadRejectedError", " es rechazado con BulkheadRejectedError")); }
      });
      st.t++;
      st.hist.push({ row: row, running: st.running.length, queued: st.queue.length });
      if (st.hist.length > MAXSTEPS) st.hist.shift();
      return notes;
    }
    function render(msg, stepped) {
      document.getElementById("bh-slots").textContent = cfg.slots;
      document.getElementById("bh-queue").textContent = cfg.queue;
      document.querySelectorAll("#bh-sim [data-cfg]").forEach(function (b) {
        var k = b.dataset.cfg, d = +b.dataset.d, v = cfg[k] + d;
        b.disabled = k === "slots" ? (v < 1 || v > 3) : (v < 0 || v > 3);
      });
      var run = "";
      for (var i = 0; i < cfg.slots; i++) {
        var r = st.running[i];
        run += r ? '<div class="box busy' + (stepped && r.left === DUR ? " fresh" : "") + '">' + r.who + '<i style="width:' + ((DUR - r.left + 1) / DUR * 100) + "%;--from:" + (stepped ? (DUR - r.left) / DUR * 100 : (DUR - r.left + 1) / DUR * 100) + '%"></i></div>' : '<div class="box"></div>';
      }
      document.getElementById("bh-run").innerHTML = run;
      var q = "";
      for (var j = 0; j < cfg.queue; j++) q += st.queue[j] ? '<div class="box waiting' + (stepped && st.hist.length && st.hist[st.hist.length - 1].row[st.queue[j]] === "q" ? " fresh" : "") + '">' + st.queue[j] + "</div>" : '<div class="box"></div>';
      document.getElementById("bh-q").innerHTML = q || '<div class="box none">' + t("no queue", "sin cola") + "</div>";
      document.querySelectorAll("#bh-sim .who-btn").forEach(function (b) { b.setAttribute("aria-pressed", String(!!pending[b.dataset.who])); });
      var n = Math.max(st.hist.length, 8), h = "";
      ["A", "B", "C"].forEach(function (w) {
        h += '<div class="tl-lbl who">' + w + "</div>";
        for (var k = 0; k < n; k++) { var e = st.hist[k]; h += '<div class="tl-cell' + (k === st.hist.length - 1 ? " now" : "") + '">' + (e ? (MK[e.row[w]] || "") : "") + "</div>"; }
      });
      [[t("running", "en curso"), "running"], [t("queued", "en cola"), "queued"]].forEach(function (m) {
        h += '<div class="tl-lbl">' + m[0] + "</div>";
        for (var k = 0; k < n; k++) { var e = st.hist[k]; h += '<div class="tl-cell meter">' + (e ? (e[m[1]] || (m[1] === "queued" ? "" : 0)) : "") + "</div>"; }
      });
      h += '<div class="tl-axis">' + t("time", "tiempo") + '</div>';
      var g = document.getElementById("bh-grid");
      g.style.setProperty("--n", n); g.innerHTML = h; g.classList.toggle("stepped", !!stepped);
      followNow(g);
      document.getElementById("bh-msg").textContent = msg || "";
    }
    function playExample() {
      cfg.slots = 1; cfg.queue = 1; reset();
      EXAMPLE.forEach(function (a) { step(a); });
      render(t("Example: maxConcurrent 1, maxQueue 1. Pick who calls and press Next step to continue.", "Ejemplo: maxConcurrent 1, maxQueue 1. Elige quién llama y pulsa Siguiente paso para continuar."));
    }
    document.querySelectorAll("#bh-sim .who-btn").forEach(function (b) {
      b.addEventListener("click", function () { var w = b.dataset.who; if (pending[w]) delete pending[w]; else pending[w] = true; render(document.getElementById("bh-msg").textContent); });
    });
    document.getElementById("bh-step").addEventListener("click", function () {
      var arr = ["A", "B", "C"].filter(function (w) { return pending[w]; });
      pending = {};
      var notes = step(arr);
      var still = st.running.filter(function (r) { return r.left < DUR; }).map(function (r) { return r.who + t(" keeps running", " sigue ejecutándose"); });
      var all = notes.concat(still);
      render(t("Step ", "Paso ") + st.t + ": " + (all.length ? all.join(", ") + "." : t("nothing happens.", "no pasa nada.")), true);
    });
    document.querySelectorAll("#bh-sim [data-cfg]").forEach(function (b) {
      b.addEventListener("click", function () {
        cfg[b.dataset.cfg] += +b.dataset.d;
        while (st.queue.length > cfg.queue) st.queue.pop();
        render("maxConcurrent " + cfg.slots + ", maxQueue " + cfg.queue + t(". New limits apply from the next step.", ". Los nuevos límites aplican desde el siguiente paso."));
      });
    });
    document.getElementById("bh-reset").addEventListener("click", function () { reset(); render(t("Cleared. Pick who calls and press Next step.", "Limpio. Elige quién llama y pulsa Siguiente paso.")); });
    document.getElementById("bh-example").addEventListener("click", playExample);
    playExample();
  })();

  // --- Shared helpers for the policy playgrounds ---
  var WHO = ["A", "B", "C"];
  function drawGrid(g, hist, meters, nMin, stepped) {
    var n = Math.max(hist.length, nMin), h = "";
    WHO.forEach(function (w) {
      h += '<div class="tl-lbl who">' + w + "</div>";
      for (var k = 0; k < n; k++) { var e = hist[k]; h += '<div class="tl-cell' + (k === hist.length - 1 ? " now" : "") + '" data-c="' + k + '">' + (e ? (MK[e.row[w]] || "") : "") + "</div>"; }
    });
    meters.forEach(function (m) {
      h += '<div class="tl-lbl">' + m[0] + "</div>";
      for (var k = 0; k < n; k++) { var e = hist[k], v = e ? e[m[1]] : ""; h += '<div class="tl-cell meter' + (m[2] && e && m[2](v) ? " hot" : "") + '">' + (v === undefined ? "" : v) + "</div>"; }
    });
    h += '<div class="tl-axis">' + t("time", "tiempo") + '</div>';
    g.style.setProperty("--n", n); g.innerHTML = h; g.classList.toggle("stepped", !!stepped);
    followNow(g);
  }
  function pill(el, col, html, stepped, key) {
    el.innerHTML = html; el.style.color = col; el.style.background = "color-mix(in srgb, " + col + " 12%, transparent)";
    if (stepped && el.dataset.key !== undefined && el.dataset.key !== key) restart(el, "pulse");
    el.dataset.key = key;
  }
  function wireSim(pfx, api) {
    var root = document.getElementById(pfx + "-sim"), pending = {};
    function sel() { return WHO.filter(function (w) { return pending[w]; }); }
    root.querySelectorAll(".who-btn").forEach(function (b) {
      b.addEventListener("click", function () { var w = b.dataset.who; if (pending[w]) delete pending[w]; else pending[w] = true; b.setAttribute("aria-pressed", String(!!pending[w])); });
    });
    document.getElementById(pfx + "-step").addEventListener("click", function () {
      var arr = sel(); pending = {};
      root.querySelectorAll(".who-btn").forEach(function (b) { b.setAttribute("aria-pressed", "false"); });
      api.next(arr);
    });
    root.querySelectorAll("[data-" + pfx + "]").forEach(function (b) {
      b.addEventListener("click", function () { api.cfg(b.getAttribute("data-" + pfx), +b.dataset.d); });
    });
    document.getElementById(pfx + "-clear").addEventListener("click", api.clear);
    document.getElementById(pfx + "-example").addEventListener("click", api.example);
    api.example();
  }
  function setStepper(pfx, key, val, lo, hi) {
    document.getElementById(key).textContent = val;
    document.querySelectorAll('[data-' + pfx + '="' + key + '"]').forEach(function (b) { var v = val + (+b.dataset.d); b.disabled = v < lo || v > hi; });
  }

  // --- Throttle playground ---
  (function () {
    if (!document.getElementById("th-sim")) return;
    var cfg = { limit: 3, win: 5 }, LIM = { "th-limit": ["limit", 1, 5], "th-win": ["win", 2, 8] }, MAXSTEPS = 24, st;
    var EXAMPLE = [["A", "B", "C"], ["A"], ["B"], [], [], ["A", "C"], ["B"], ["C"], [], [], [], ["A", "B"]];
    function reset() { st = { t: 0, used: [], hist: [] }; }
    function step(arr) {
      var row = { A: ".", B: ".", C: "." }, notes = [];
      var before = st.used.length;
      st.used = st.used.filter(function (u) { return st.t - u.t < cfg.win; });
      if (st.used.length < before) { var gone = before - st.used.length; notes.push(gone + (ES ? (gone > 1 ? " cupos salen" : " cupo sale") + " de la ventana" : (gone > 1 ? " slots leave" : " slot leaves") + " the window")); }
      arr.forEach(function (w) {
        if (st.used.length < cfg.limit) { st.used.push({ who: w, t: st.t }); row[w] = "o"; notes.push(w + t(" is allowed", " es permitido")); }
        else { var ra = st.used[0].t + cfg.win - st.t; row[w] = "r"; notes.push(w + t(" is rejected with ThrottleError, retryAfter ", " es rechazado con ThrottleError, retryAfter ") + ra + (ra > 1 ? t(" steps", " pasos") : t(" step", " paso"))); }
      });
      st.hist.push({ row: row, left: cfg.limit - st.used.length });
      if (st.hist.length > MAXSTEPS) st.hist.shift();
      st.t++;
      return notes;
    }
    function render(msg, stepped) {
      setStepper("th", "th-limit", cfg.limit, 1, 5); setStepper("th", "th-win", cfg.win, 2, 8);
      document.getElementById("th-win-lbl").textContent = t("Window · last ", "Ventana · últimos ") + cfg.win + t(" steps", " pasos");
      // Slots as they will be seen by the next call.
      var live = st.used.filter(function (u) { return st.t - u.t < cfg.win; }), b = "";
      for (var i = 0; i < cfg.limit; i++) {
        var u = live[i];
        b += u ? '<div class="box busy' + (stepped && u.t === st.t - 1 ? " fresh" : "") + '" title="' + t("frees up in ", "se libera en ") + (u.t + cfg.win - st.t) + t(" steps", " pasos") + '">' + u.who + '<i style="width:' + ((u.t + cfg.win - st.t) / cfg.win * 100) + "%;--from:" + ((u.t + cfg.win - st.t + 1) / cfg.win * 100) + '%"></i></div>' : '<div class="box"></div>';
      }
      document.getElementById("th-slots").innerHTML = b;
      var left = cfg.limit - live.length;
      pill(document.getElementById("th-left"), left ? "var(--ok)" : "var(--fail)", left + " <small>" + t("of ", "de ") + cfg.limit + t(" for the next step", " para el siguiente paso") + "</small>", stepped, String(!!left));
      var g = document.getElementById("th-grid");
      drawGrid(g, st.hist, [[t("slots left", "cupos libres"), "left", function (v) { return v === 0; }]], 12, stepped);
      if (st.hist.length) {
        var k = st.hist.length, a = g.querySelector('.tl-cell[data-c="' + Math.max(0, k - cfg.win) + '"]'), z = g.querySelector('.tl-cell[data-c="' + (k - 1) + '"]');
        var win = document.createElement("div"); win.className = "tl-window";
        win.innerHTML = "<b>" + t("window · ", "ventana · ") + cfg.win + t(" steps", " pasos") + "</b>";
        win.style.left = (a.offsetLeft - 2) + "px"; win.style.width = (z.offsetLeft + z.offsetWidth - a.offsetLeft + 4) + "px";
        g.insertBefore(win, g.firstChild);
      }
      document.getElementById("th-msg").textContent = msg || "";
    }
    wireSim("th", {
      next: function (arr) { var n = step(arr); render(t("Step ", "Paso ") + st.t + ": " + (n.length ? n.join(", ") + "." : t("nothing happens.", "no pasa nada.")), true); },
      cfg: function (key, d) { var c = LIM[key]; cfg[c[0]] += d; render("limit " + cfg.limit + ", interval " + cfg.win + t(" steps. Applies from the next step.", " pasos. Aplica desde el siguiente paso.")); },
      clear: function () { reset(); render(t("Cleared. Pick who calls and press Next step.", "Limpio. Elige quién llama y pulsa Siguiente paso.")); },
      example: function () { cfg = { limit: 3, win: 5 }; reset(); EXAMPLE.forEach(step); render(t("Example: limit 3, interval 5 steps. Pick who calls and press Next step to continue.", "Ejemplo: limit 3, interval 5 pasos. Elige quién llama y pulsa Siguiente paso para continuar.")); }
    });
  })();

  // --- cache and dedupe playgrounds (one key, the service takes 2 steps) ---
  function keyedSim(pfx, isCache, example, ttl0) {
    if (!document.getElementById(pfx + "-sim")) return;
    var DUR = 2, MAXSTEPS = 24, cfg = { ttl: ttl0, fail: false }, st;
    function reset() { st = { t: 0, flight: null, entry: null, hist: [] }; }
    function setFail(f) {
      cfg.fail = f;
      document.querySelectorAll("[data-" + pfx + "-fail]").forEach(function (b) { b.setAttribute("aria-checked", String((b.getAttribute("data-" + pfx + "-fail") === "1") === f)); });
    }
    document.querySelectorAll("[data-" + pfx + "-fail]").forEach(function (b) {
      b.addEventListener("click", function () { setFail(b.getAttribute("data-" + pfx + "-fail") === "1"); });
    });
    function step(arr) {
      var row = { A: ".", B: ".", C: "." }, notes = [];
      if (st.flight && st.t - st.flight.start >= DUR) {
        var f = st.flight; st.flight = null;
        if (f.fail) notes.push(t(f.who + "'s call fails", "la llamada de " + f.who + " falla") + (isCache ? t(", nothing is cached", ", no se guarda nada") : t(" and the key is released", " y la clave se libera")));
        else if (isCache) { st.entry = { exp: st.t + cfg.ttl - 1 }; notes.push(t("the value arrives and is cached for ", "llega el valor y se guarda por ") + cfg.ttl + t(" steps", " pasos")); }
        else notes.push(t(f.who + "'s call resolves and the key is released", "la llamada de " + f.who + " se resuelve y la clave se libera"));
      } else if (st.flight) row[st.flight.who] = "-";
      if (st.entry && st.t > st.entry.exp) { st.entry = null; notes.push(t("the entry expires", "la entrada expira")); }
      arr.forEach(function (w) {
        if (isCache && st.entry) { row[w] = "h"; notes.push(w + t(" hits the cache", " encuentra el valor en la caché")); }
        else if (st.flight) {
          if (st.flight.who === w) { notes.push(w + t(" is already waiting", " ya está esperando")); return; }
          row[w] = st.flight.fail ? "S" : "s"; notes.push(w + t(" gets " + st.flight.who + "'s in-flight promise", " recibe la promesa en curso de " + st.flight.who) + (st.flight.fail ? t(", which will fail", ", que va a fallar") : ""));
        } else {
          st.flight = { who: w, start: st.t, fail: cfg.fail }; row[w] = cfg.fail ? "x" : "o";
          notes.push(w + (isCache ? t(" misses and calls the service", " no está en caché y llama al servicio") : t(" calls the service", " llama al servicio")) + (cfg.fail ? t(" (it will fail)", " (va a fallar)") : ""));
        }
      });
      st.hist.push({ row: row, ttl: isCache && st.entry ? st.entry.exp - st.t + 1 : "", pend: st.flight ? 1 : 0 });
      if (st.hist.length > MAXSTEPS) st.hist.shift();
      st.t++;
      return notes;
    }
    function render(msg, stepped) {
      if (isCache) setStepper(pfx, pfx + "-ttl", cfg.ttl, 2, 8);
      var el = document.getElementById(pfx + "-state"), f = st.flight, e = st.entry && st.t <= st.entry.exp;
      if (f) pill(el, "var(--wait)", t("in flight", "en curso") + " <small>" + t(f.who + "'s call", "llamada de " + f.who) + (f.fail ? t(", will fail", ", va a fallar") : "") + "</small>", stepped, "f");
      else if (e) pill(el, "var(--accent)", (ES ? "en caché <small>" + (st.entry.exp - st.t ? "quedan " + (st.entry.exp - st.t + 1) + " pasos" : "queda 1 paso") : "cached <small>" + (st.entry.exp - st.t + 1) + " step" + (st.entry.exp - st.t ? "s" : "") + " left") + "</small>", stepped, "c");
      else pill(el, "var(--muted)", (isCache ? t("empty", "vacía") : t("free", "libre")) + " <small>" + t("no call in flight", "sin llamada en curso") + "</small>", stepped, "e");
      drawGrid(document.getElementById(pfx + "-grid"), st.hist, isCache ? [["ttl", "ttl"]] : [[t("pending", "pendiente"), "pend"]], isCache ? 16 : 13, stepped);
      document.getElementById(pfx + "-msg").textContent = msg || "";
    }
    if (isCache) document.getElementById("ca-del").addEventListener("click", function () {
      var had = st.entry && st.t <= st.entry.exp; st.entry = null;
      render(had ? t("delete(key): the entry is gone, the next call misses.", "delete(key): la entrada se borró, la próxima llamada no la encuentra.") : t("delete(key): there was no cached entry.", "delete(key): no había ninguna entrada en caché."), true);
    });
    wireSim(pfx, {
      next: function (arr) { var n = step(arr); render(t("Step ", "Paso ") + st.t + ": " + (n.length ? n.join(", ") + "." : t("nothing happens.", "no pasa nada.")), true); },
      cfg: function (key, d) { cfg.ttl += d; render("ttl " + cfg.ttl + t(" steps. Applies to the next value that arrives.", " pasos. Aplica al próximo valor que llegue.")); },
      clear: function () { reset(); setFail(false); render(t("Cleared. Pick who calls and press Next step.", "Limpio. Elige quién llama y pulsa Siguiente paso.")); },
      example: function () {
        cfg.ttl = ttl0; reset();
        example.forEach(function (s) { setFail(!!s[1]); step(s[0]); });
        setFail(false);
        render(t("Example", "Ejemplo") + (isCache ? ": ttl " + ttl0 + t(" steps", " pasos") : "") + t(". Pick who calls and press Next step to continue.", ". Elige quién llama y pulsa Siguiente paso para continuar."));
      }
    });
  }
  keyedSim("ca", true, [[["A"]], [["B"]], [["C"]], [[]], [["A"]], [[]], [["B"]], [[]], [["C", "A"], 1], [[]], [[]], [["B"]], [["C"]], [["A"]], [[]], [[]]], 5);
  keyedSim("dd", false, [[["A"]], [["B"]], [["C"]], [["A"]], [[]], [["B"]], [[]], [[]], [["C", "A"], 1], [[]], [["B"]], [["C"]], [[]]], 0);

  // --- waitForTask behavior explorer ---
  var bx = { limit: "timeout", wait: "true", task: "ok" };
  var ABORT = 38, END = 72;
  function bar(cls, from, to, label) { return '<div class="bx-bar ' + cls + '" style="left:' + from + "%;width:" + (to - from) + '%">' + (label ? "<span>" + label + "</span>" : "") + "</div>"; }
  function pin(cls, at, sym, label, left) {
    return '<i class="bx-pin ' + cls + '" style="left:' + at + '%">' + sym + "</i>" +
      (label ? '<span class="bx-pin-lbl' + (left ? " left" : "") + '" style="left:calc(' + at + "% " + (left ? "- 16px" : "+ 16px") + ')">' + label + "</span>" : "");
  }
  function renderBx() {
    var t = bx.limit === "timeout", w = bx.wait === "true", ok = bx.task === "ok";
    var reason = t ? "TimeoutError" : "signal.reason";
    var abortLbl = t ? tr("timeout expires", "expira el timeout") : tr("signal aborts", "se aborta signal");
    var abortMark = '<div class="bx-abort" style="left:' + ABORT + '%"><b>' + abortLbl + "</b></div>";
    // task lane
    var taskHtml = bar("run", 0, ABORT, tr("running", "en ejecución")) + bar(w ? "run" : "ghost", ABORT, END, w ? tr("finishing", "terminando") : tr("keeps running, ignored", "sigue, se ignora")) +
      pin(w ? (ok ? "ok" : "fail") : "ignored", END, ok ? "✓" : "✕", "") + abortMark;
    // attempt lane
    var settle = w ? END : ABORT, att, verdict, retry, fb, status;
    if (w && ok) { att = pin("ok", settle, "✓", tr("resolves with the value", "resuelve con el valor"), true); verdict = tr("<code>attempt</code> waits for the task and <strong>resolves with its value</strong>.", "<code>attempt</code> espera la tarea y <strong>resuelve con su valor</strong>."); retry = false; fb = false; status = "success"; }
    else if (w && !ok && t) { att = pin("fail", settle, "✕", tr("attempt failed", "intento fallido"), true); verdict = tr("The task's error <strong>counts as a failed attempt</strong>. Another attempt runs, or <code>fallback</code> if attempts run out.", "El error de la tarea <strong>cuenta como un intento fallido</strong>. Se ejecuta otro intento, o <code>fallback</code> si se acaban los intentos."); retry = true; fb = true; status = "failure / fallback"; }
    else if (w && !ok && !t) { att = pin("fail", settle, "✕", tr("rejects with the task's error", "rechaza con el error de la tarea"), true); verdict = tr("<code>attempt</code> waits, then <strong>rejects with the task's error</strong>. No retry and no <code>fallback</code>.", "<code>attempt</code> espera y luego <strong>rechaza con el error de la tarea</strong>. Sin reintento y sin <code>fallback</code>."); retry = false; fb = false; status = "aborted"; }
    else if (t) { att = pin("fail", settle, "✕", tr("rejects with TimeoutError", "rechaza con TimeoutError")); verdict = tr("<code>attempt</code> <strong>fails right away with <code>TimeoutError</code></strong>. The task keeps running and its result is ignored. Another attempt runs, or <code>fallback</code> if attempts run out.", "<code>attempt</code> <strong>falla de inmediato con <code>TimeoutError</code></strong>. La tarea sigue ejecutándose y su resultado se ignora. Se ejecuta otro intento, o <code>fallback</code> si se acaban los intentos."); retry = true; fb = true; status = "failure / fallback"; }
    else { att = pin("fail", settle, "✕", tr("rejects with signal.reason", "rechaza con signal.reason")); verdict = tr("<code>attempt</code> <strong>rejects right away with <code>signal.reason</code></strong>. The task keeps running and its result is ignored. No retry and no <code>fallback</code>.", "<code>attempt</code> <strong>rechaza de inmediato con <code>signal.reason</code></strong>. La tarea sigue ejecutándose y su resultado se ignora. Sin reintento y sin <code>fallback</code>."); retry = false; fb = false; status = "aborted"; }
    var CUR = '<i class="bx-cur"></i>';
    document.getElementById("bx-task").innerHTML = '<div class="bx-layer">' + taskHtml + "</div>" + CUR;
    document.getElementById("bx-att").innerHTML = '<div class="bx-layer">' + att + '<div class="bx-abort" style="left:' + ABORT + '%"></div></div>' + CUR;
    var nx = retry ? bar("next", Math.min(settle + 6, 90), 100, tr("attempt #2 (after delay)", "intento #2 (tras el delay)")) : '<span class="bx-empty">' + tr("no more attempts", "no hay más intentos") + "</span>";
    document.getElementById("bx-next").innerHTML = '<div class="bx-layer">' + nx + "</div>" + CUR;
    document.getElementById("bx-verdict").innerHTML = verdict;
    document.getElementById("bx-chips").innerHTML =
      '<span class="chip ' + (retry ? "yes" : "no") + '">' + tr("retries: ", "reintenta: ") + (retry ? tr("yes", "sí") : "no") + "</span>" +
      '<span class="chip ' + (fb ? "yes" : "no") + '">fallback: ' + (fb ? tr("if attempts run out", "si se acaban los intentos") : "no") + "</span>" +
      '<span class="chip">status: ' + status + "</span>";
  }
  document.querySelectorAll("#bx [data-k]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      bx[btn.dataset.k] = btn.dataset.v;
      document.querySelectorAll('#bx [data-k="' + btn.dataset.k + '"]').forEach(function (b) { b.setAttribute("aria-checked", String(b === btn)); });
      renderBx(); sweepBx();
    });
  });
  var bxStage = document.querySelector("#bx .bx-stage");
  function sweepBx() { if (!RM) restart(bxStage, "sweep"); }
  document.getElementById("bx-replay").addEventListener("click", sweepBx);
  renderBx();
  onVisible(bxStage, sweepBx);

  // --- Lifecycle hooks player ---
  (function () {
    var root = document.getElementById("lc"); if (!root) return;
    var log = document.getElementById("lc-log"), loop = document.getElementById("lc-loop");
    var hooks = {}; root.querySelectorAll("[data-hook]").forEach(function (el) { hooks[el.dataset.hook] = el; });
    var N = 3, kind = "retry", gen = 0;
    function ctx(a) { return "{ attempt: " + a + ", attempts: " + N + " }"; }
    function build(k) {
      var ev = [{ h: "onStart", a: ctx(0) }];
      function att(a, last) { ev.push({ h: "onAttempt", a: "{ attempt: " + a + ", attempts: " + N + ", lastError: " + (last || "undefined") + " }", att: a }); }
      function retry(a, err, ms) { ev.push({ h: "onRetry", a: "{ attempt: " + a + ", attempts: " + N + ", error: " + err + ", delay: " + ms + " }", att: a - 1 }); }
      function error(a, err, will) { ev.push({ h: "onError", a: "(" + err + ", { attempt: " + a + ", attempts: " + N + ", willRetry: " + will + " })", att: a }); }
      if (k === "ok") { att(1); ev.push({ h: "onSuccess", a: "(value, " + ctx(1) + ")" }); ev.push({ h: "onSettled", a: '{ status: "success", attempt: 1, attempts: ' + N + ", value }", end: t("attempt() resolves with value", "attempt() resuelve con value") }); }
      else if (k === "retry" || k === "timeout") {
        att(1);
        var err = k === "timeout" ? "TimeoutError" : "Error";
        if (k === "timeout") ev.push({ h: "onTimeout", a: "{ attempt: 1, attempts: " + N + ", timeout: 2000 }", att: 1 });
        error(1, err, true); retry(2, err, 200); att(2, err);
        ev.push({ h: "onSuccess", a: "(value, " + ctx(2) + ")" });
        ev.push({ h: "onSettled", a: '{ status: "success", attempt: 2, attempts: ' + N + ", value }", end: t("attempt() resolves with value", "attempt() resuelve con value") });
      } else if (k === "fail" || k === "fallback") {
        for (var a = 1; a <= N; a++) { att(a, a > 1 ? "Error" : ""); error(a, "Error", a < N); if (a < N) retry(a + 1, "Error", 200 * Math.pow(2, a - 1)); }
        ev.push({ h: "onFailure", a: "(Error, " + ctx(N) + ")" });
        if (k === "fallback") {
          ev.push({ note: "fallback(Error, " + ctx(N) + ")" + t(" returns cachedData", " devuelve cachedData") });
          ev.push({ h: "onSettled", a: '{ status: "fallback", attempt: ' + N + ", attempts: " + N + ", error, value: cachedData }", end: t("attempt() resolves with cachedData", "attempt() resuelve con cachedData") });
        } else ev.push({ h: "onSettled", a: '{ status: "failure", attempt: ' + N + ", attempts: " + N + ", error }", end: t("attempt() rejects with the last Error", "attempt() rechaza con el último Error") });
      } else {
        att(1);
        ev.push({ note: t("signal.abort() while attempt 1 runs: no onError, no retry", "signal.abort() mientras corre el intento 1: sin onError, sin reintento") });
        ev.push({ h: "onAbort", a: "(reason, " + ctx(1) + ")" });
        ev.push({ h: "onSettled", a: '{ status: "aborted", attempt: 1, attempts: ' + N + ", error }", end: t("attempt() rejects, without fallback", "attempt() rechaza, sin fallback") });
      }
      return ev;
    }
    function clear() {
      Object.keys(hooks).forEach(function (k) { hooks[k].classList.remove("active", "done"); });
      loop.removeAttribute("data-att"); log.innerHTML = "";
    }
    function apply(e, animate) {
      Object.keys(hooks).forEach(function (k) { if (hooks[k].classList.contains("active")) { hooks[k].classList.remove("active"); hooks[k].classList.add("done"); } });
      var li = document.createElement("li");
      if (e.note) li.innerHTML = '<span class="tok-c">// ' + e.note + "</span>";
      else {
        hooks[e.h].classList.add("active");
        li.innerHTML = "<b>" + e.h + "</b>" + (e.a.charAt(0) === "(" ? "" : "(") + e.a.replace(/</g, "&lt;") + (e.a.charAt(0) === "(" ? "" : ")");
      }
      if (e.att) loop.setAttribute("data-att", e.att + "/" + N);
      if (animate) li.className = "new";
      log.appendChild(li);
      if (e.end) { var end = document.createElement("li"); end.className = "end" + (animate ? " new" : ""); end.textContent = "→ " + e.end; log.appendChild(end); }
      log.scrollTop = log.scrollHeight;
    }
    function play() {
      var my = ++gen, ev = build(kind), i = 0;
      clear();
      if (RM) { ev.forEach(function (e) { apply(e, false); }); return; }
      (function tick() {
        if (my !== gen || i >= ev.length) return;
        apply(ev[i++], true);
        setTimeout(tick, 650);
      })();
    }
    root.querySelectorAll("[data-lc]").forEach(function (b) {
      b.addEventListener("click", function () {
        kind = b.dataset.lc;
        root.querySelectorAll("[data-lc]").forEach(function (x) { x.setAttribute("aria-checked", String(x === b)); });
        play();
      });
    });
    document.getElementById("lc-play").addEventListener("click", play);
    // Static readers see the full sequence; it replays when scrolled into view.
    build(kind).forEach(function (e) { apply(e, false); });
    if (!RM) onVisible(root, play);
  })();

  // --- Backoff explorer ---
  (function () {
    var root = document.getElementById("bo"); if (!root) return;
    var o = { fn: "exponential", ms: 200, max: 0, jit: "", att: 6 }, RUN = 300, draws = [];
    var NAME = { fixed: "fixedBackoff", linear: "linearBackoff", exponential: "exponentialBackoff", fibonacci: "fibonacciBackoff" };
    function compute(r) {
      if (o.fn === "fixed") return o.ms;
      if (o.fn === "linear") return o.ms * r;
      if (o.fn === "exponential") return o.ms * Math.pow(2, r - 1);
      var a = 1, b = 1; for (var i = 1; i < r; i++) { var t = a + b; a = b; b = t; } return o.ms * a;
    }
    function fmtMs(v) { return v >= 1000 ? (Math.round(v / 100) / 10) + " s" : Math.round(v) + " ms"; }
    function lit(v) { return v >= 1000 ? String(v).replace(/\B(?=(\d{3})+(?!\d))/g, "_") : String(v); }
    function roll() {
      draws = [];
      for (var r = 1; r < o.att; r++) {
        var raw = compute(r), base = o.max ? Math.min(raw, o.max) : raw;
        var v = o.jit === "full" ? Math.random() * base : o.jit === "equal" ? base / 2 + Math.random() * (base / 2) : base;
        draws.push({ raw: raw, base: base, v: v });
      }
    }
    function render(animate) {
      document.getElementById("bo-att").textContent = o.att;
      root.querySelectorAll("[data-bo-att]").forEach(function (b) { var v = o.att + (+b.dataset.boAtt); b.disabled = v < 2 || v > 8; });
      document.getElementById("bo-roll").hidden = !o.jit;
      var top = Math.max.apply(null, draws.map(function (d) { return d.base; })) || 1;
      var chart = document.getElementById("bo-chart"), x = document.getElementById("bo-x");
      // Reuse columns so heights transition between configurations.
      while (chart.children.length > draws.length) chart.removeChild(chart.lastChild);
      while (chart.children.length < draws.length) {
        var c = document.createElement("div"); c.className = "bo-col";
        c.innerHTML = '<div class="bo-range"></div><div class="bo-fill" style="height:0"><span class="bo-val"></span></div>';
        chart.appendChild(c);
      }
      draws.forEach(function (d, i) {
        var col = chart.children[i], range = col.children[0], fill = col.children[1];
        range.style.height = (o.jit ? d.base / top * 100 : 0) + "%"; range.style.opacity = o.jit ? 1 : 0;
        fill.style.height = Math.max(1.5, d.v / top * 100) + "%";
        fill.classList.toggle("capped", !!o.max && d.raw > o.max);
        fill.firstChild.textContent = fmtMs(d.v);
      });
      x.innerHTML = draws.map(function (d, i) { return "<span><i>" + tr("before ", "antes del ") + "</i>#" + (i + 2) + "</span>"; }).join("");
      chart.setAttribute("aria-label", tr("Delay before each retry: ", "Espera antes de cada reintento: ") + draws.map(function (d) { return fmtMs(d.v); }).join(", "));
      var opts = [];
      if (o.max) opts.push("maxDelay: " + lit(o.max));
      if (o.jit) opts.push('jitter: "' + o.jit + '"');
      var src = "resilience({\n  attempts: " + o.att + ",\n  delay: " + NAME[o.fn] + "(" + o.ms + (opts.length ? ", { " + opts.join(", ") + " }" : "") + "),\n}).attempt(task);";
      document.getElementById("bo-code").innerHTML = highlight(src);
      // Timeline: attempt, wait, attempt, ...
      var total = RUN * o.att + draws.reduce(function (s, d) { return s + d.v; }, 0), t = 0, html = "";
      var speed = 2.6; // seconds for the whole run
      function seg(cls, dur, inner) {
        var w = dur / total * 100, st = "width:" + w + "%;animation-delay:" + (t / total * speed) + "s;animation-duration:" + Math.max(0.12, dur / total * speed) + "s";
        t += dur;
        return '<div class="seg ' + cls + '" style="' + st + '">' + inner + "</div>";
      }
      for (var a = 1; a <= o.att; a++) {
        var last = a === o.att;
        html += seg("att " + (last ? "ok" : "fail"), RUN, (RUN / total > 0.045 ? "#" + a : ""));
        if (!last) { var d = draws[a - 1]; html += seg("gap", d.v, d.v / total > 0.09 ? "<span>" + fmtMs(d.v) + "</span>" : ""); }
      }
      document.getElementById("bo-lane").innerHTML = html;
      document.getElementById("bo-total").textContent = fmtMs(total);
      var waits = total - RUN * o.att;
      document.getElementById("bo-cap").textContent = o.att + tr(" attempts × 300 ms + ", " intentos × 300 ms + ") + (o.att - 1) + tr(" waits (", " esperas (") + fmtMs(waits) + ") ≈ " + fmtMs(total) + tr(" until the last attempt succeeds.", " hasta que el último intento tiene éxito.") + (o.jit ? tr(" Jitter changes the waits on every run.", " El jitter cambia las esperas en cada ejecución.") : "");
      if (animate && !RM) restart(document.getElementById("bo-track"), "play");
    }
    root.querySelectorAll("[data-bo]").forEach(function (b) {
      b.addEventListener("click", function () {
        var k = b.dataset.bo, v = b.dataset.v;
        o[k] = k === "ms" || k === "max" ? +v : v;
        root.querySelectorAll('[data-bo="' + k + '"]').forEach(function (x) { x.setAttribute("aria-checked", String(x === b)); });
        roll(); render(true);
      });
    });
    root.querySelectorAll("[data-bo-att]").forEach(function (b) {
      b.addEventListener("click", function () { o.att += +b.dataset.boAtt; roll(); render(true); });
    });
    document.getElementById("bo-roll").addEventListener("click", function () { roll(); render(true); });
    document.getElementById("bo-play").addEventListener("click", function () { if (o.jit) roll(); render(true); });
    roll(); render(false);
    onVisible(document.getElementById("bo-track"), function () { render(true); });
  })();

  // --- Theme picker: light / dark / system (saved in localStorage) ---
  (function () {
    var html = document.documentElement, btn = document.getElementById("theme-btn"), menu = document.getElementById("theme-menu");
    if (!btn || !menu) return;
    var items = Array.prototype.slice.call(menu.querySelectorAll("[data-theme-set]"));
    var NAMES = { light: t("Light", "Claro"), dark: t("Dark", "Oscuro"), system: t("System", "Sistema") };
    var metas = Array.prototype.slice.call(document.querySelectorAll('meta[name="theme-color"]'));
    metas.forEach(function (m) { m.dataset.auto = m.content; });
    var BAR = { light: "#f6f7f9", dark: "#0e1117" };
    function saved() { try { var v = localStorage.getItem("theme"); return v === "light" || v === "dark" ? v : "system"; } catch (e) { return "system"; } }
    function apply(pref) {
      if (pref === "system") html.removeAttribute("data-theme"); else html.setAttribute("data-theme", pref);
      metas.forEach(function (m) { m.content = pref === "system" ? m.dataset.auto : BAR[pref]; });
      btn.dataset.pref = pref;
      btn.setAttribute("aria-label", t("Theme: ", "Tema: ") + NAMES[pref]);
      btn.title = t("Theme: ", "Tema: ") + NAMES[pref];
      items.forEach(function (i) { i.setAttribute("aria-checked", String(i.dataset.themeSet === pref)); });
    }
    function open(focusItem) {
      menu.hidden = false; btn.setAttribute("aria-expanded", "true");
      if (focusItem) (items.filter(function (i) { return i.getAttribute("aria-checked") === "true"; })[0] || items[0]).focus();
    }
    function close(refocus) { if (menu.hidden) return; menu.hidden = true; btn.setAttribute("aria-expanded", "false"); if (refocus) btn.focus(); }
    btn.addEventListener("click", function () { if (menu.hidden) open(true); else close(false); });
    btn.addEventListener("keydown", function (e) { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); open(true); } });
    items.forEach(function (item, idx) {
      item.addEventListener("click", function () {
        var pref = item.dataset.themeSet;
        try { if (pref === "system") localStorage.removeItem("theme"); else localStorage.setItem("theme", pref); } catch (e) {}
        apply(pref); close(true);
      });
      item.addEventListener("keydown", function (e) {
        var n = items.length, to = -1;
        if (e.key === "ArrowDown") to = (idx + 1) % n; else if (e.key === "ArrowUp") to = (idx - 1 + n) % n;
        else if (e.key === "Home") to = 0; else if (e.key === "End") to = n - 1;
        else if (e.key === "Escape") { e.preventDefault(); close(true); return; }
        else if (e.key === "Tab") { close(false); return; }
        if (to >= 0) { e.preventDefault(); items[to].focus(); }
      });
    });
    document.addEventListener("click", function (e) { if (!menu.hidden && !e.target.closest(".theme-pick")) close(false); });
    // Another tab changed the theme.
    window.addEventListener("storage", function (e) { if (e.key === "theme") apply(saved()); });
    apply(saved());
  })();

  // --- Language switch: keep the current section when changing language ---
  var langBtn = document.getElementById("lang-btn");
  if (langBtn) langBtn.addEventListener("click", function () {
    var base = langBtn.getAttribute("href").split("#")[0];
    if (location.hash) langBtn.setAttribute("href", base + location.hash);
  });

  // --- Mobile contents drawer ---
  var nav = document.getElementById("sidenav"), mb = document.getElementById("menu-btn");
  var backdrop = document.getElementById("nav-backdrop"), menuLabel = document.getElementById("menu-label");
  function setNav(open) {
    nav.classList.toggle("open", open);
    backdrop.hidden = !open;
    document.body.classList.toggle("nav-open", open);
    mb.setAttribute("aria-expanded", String(open));
    if (open) { var act = nav.querySelector("a.active") || nav.querySelector("a"); act.scrollIntoView({ block: "center" }); act.focus({ preventScroll: true }); }
  }
  mb.addEventListener("click", function () { setNav(!nav.classList.contains("open")); });
  document.getElementById("nav-close").addEventListener("click", function () { setNav(false); mb.focus(); });
  backdrop.addEventListener("click", function () { setNav(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && nav.classList.contains("open")) { setNav(false); mb.focus(); } });
  nav.addEventListener("click", function (e) { if (e.target.closest("a")) setNav(false); });

  // --- Scrollspy ---
  var links = Array.prototype.slice.call(nav.querySelectorAll("a"));
  var targets = links.map(function (a) { return document.querySelector(a.getAttribute("href")); });
  function spy() {
    var y = window.scrollY + 120, idx = 0;
    targets.forEach(function (t, i) { if (t && t.getBoundingClientRect().top + window.scrollY <= y) idx = i; });
    links.forEach(function (a, i) { a.classList.toggle("active", i === idx); });
    if (links[idx]) menuLabel.textContent = links[idx].textContent;
  }
  window.addEventListener("scroll", spy, { passive: true }); spy();
})();
