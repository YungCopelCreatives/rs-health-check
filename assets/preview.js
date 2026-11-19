(function () {
  "use strict";
  var S = window.RSScoring;
  var CFG = window.RS_CONFIG || {};
  var chat = document.getElementById("chat");
  var compose = document.getElementById("compose");
  var input = document.getElementById("compose-input");
  var send = document.getElementById("compose-send");
  var sheet = document.getElementById("sheet");
  var sheetList = document.getElementById("sheet-list");
  var sheetTitle = document.getElementById("sheet-title");
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var doctor = { name: "", practice: "", specialty: "" };
  var turnover = "";
  var answers = {};
  var challenge = "";

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function now() { var d = new Date(); return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, reduced ? 0 : ms); }); }
  function scroll() { chat.scrollTop = chat.scrollHeight; }
  function step(name) {
    var li = document.querySelector('#pv-steps [data-s="' + name + '"]');
    if (li) li.classList.add("done");
  }
  function pct(p) { return (Math.round(p * 10) / 10).toFixed(1).replace(/\.0$/, "") + "%"; }
  function color(p) { return S.CLASSIFICATIONS[S.band(p)].hex; }

  function day(text, cls) {
    var d = document.createElement("div");
    d.className = "day" + (cls ? " " + cls : "");
    d.textContent = text;
    chat.appendChild(d); scroll();
  }

  function bubble(dir, html) {
    var m = document.createElement("div");
    m.className = "msg " + dir;
    m.innerHTML = '<div class="bub">' + html + '<span class="time">' + now() + (dir === "out" ? " ✓✓" : "") + "</span></div>";
    chat.appendChild(m); scroll();
    return m;
  }

  async function typing(ms) {
    var t = document.createElement("div");
    t.className = "typing"; t.innerHTML = "<i></i><i></i><i></i>";
    chat.appendChild(t); scroll();
    await sleep(ms || 700);
    t.remove();
  }

  async function rs(html, ms) { await typing(ms); return bubble("in", html); }
  function me(text) { return bubble("out", esc(text)); }

  // Reply buttons (max 3, as on WhatsApp). Resolves with the chosen id.
  function buttons(msg, items) {
    return new Promise(function (resolve) {
      var btns = items.map(function (it) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "qr"; b.textContent = it.label;
        b.addEventListener("click", function () {
          btns.forEach(function (x) { x.disabled = true; });
          me(it.label);
          resolve(it.id);
        });
        msg.appendChild(b);
        return b;
      });
      scroll();
    });
  }

  // Interactive list message: a bubble with a "≡ label" action that opens a sheet of rows.
  function list(msg, actionLabel, title, sections) {
    return new Promise(function (resolve) {
      var bub = msg.querySelector(".bub");
      var a = document.createElement("button");
      a.type = "button"; a.className = "action"; a.innerHTML = "☰ " + esc(actionLabel);
      bub.appendChild(a); scroll();
      a.addEventListener("click", function () {
        openSheet(title, sections, function (row) {
          a.disabled = true;
          me(row.title);
          resolve(row);
        });
      });
    });
  }

  function openSheet(title, sections, onPick) {
    sheetTitle.textContent = title;
    sheetList.innerHTML = "";
    sections.forEach(function (sec) {
      if (sec.title) {
        var h = document.createElement("li"); h.className = "sec"; h.textContent = sec.title; sheetList.appendChild(h);
      }
      sec.rows.forEach(function (row) {
        var li = document.createElement("li");
        var b = document.createElement("button");
        b.type = "button";
        b.innerHTML = "<span>" + esc(row.title) + (row.desc ? "<small>" + esc(row.desc) + "</small>" : "") + "</span>";
        b.addEventListener("click", function () { closeSheet(); onPick(row); });
        li.appendChild(b); sheetList.appendChild(li);
      });
    });
    sheet.hidden = false;
  }
  function closeSheet() { sheet.hidden = true; }
  document.getElementById("sheet-close").addEventListener("click", closeSheet);
  sheet.addEventListener("click", function (e) { if (e.target === sheet) closeSheet(); });

  // Typed reply. Empty send uses the sample, so the preview moves quickly.
  function typed(sample, skipBtn) {
    return new Promise(function (resolve) {
      input.disabled = false; send.disabled = false;
      input.value = ""; input.placeholder = sample ? "e.g. " + sample : "Message";
      compose.classList.add("attn");
      input.focus({ preventScroll: true });
      function done(e) {
        e.preventDefault();
        var v = input.value.trim() || sample || "";
        if (!v) return;
        compose.removeEventListener("submit", done);
        if (skipBtn) skipBtn.disabled = true;
        input.value = ""; input.placeholder = "Message";
        input.disabled = true; send.disabled = true;
        compose.classList.remove("attn");
        me(v);
        resolve(v);
      }
      compose.addEventListener("submit", done);
      if (skipBtn) skipBtn.addEventListener("click", function () {
        compose.removeEventListener("submit", done);
        input.value = ""; input.placeholder = "Message";
        input.disabled = true; send.disabled = true;
        compose.classList.remove("attn");
        skipBtn.disabled = true;
        me("Skip");
        resolve("");
      });
    });
  }

  function answerRows(n) {
    return [{ rows: S.SCALE.slice().reverse().map(function (s) { var p = s.label.split(" / "); return { id: "ANS_Q" + n + "_" + s.value, title: p[0], desc: p[1], value: s.value }; }) }];
  }
  // WhatsApp row titles max out at 24 characters, so the long option gets a description.
  function turnoverRows() {
    return [{ rows: S.TURNOVER.map(function (t) {
      return t.length > 24 ? { id: "T", title: "Prefer to discuss", desc: "During the consultation", value: t } : { id: "T", title: t, value: t };
    }) }];
  }
  function findQ(n) {
    for (var i = 0; i < S.DOMAINS.length; i++) {
      for (var j = 0; j < S.DOMAINS[i].questions.length; j++) {
        if (S.DOMAINS[i].questions[j].n === n) return { d: S.DOMAINS[i], q: S.DOMAINS[i].questions[j] };
      }
    }
  }
  function label(v) { var s = S.SCALE.filter(function (x) { return x.value === v; })[0]; return s ? s.label.split(" / ")[0] : "–"; }

  async function askQuestion(n) {
    var f = findQ(n);
    var m = await rs('<span class="hdr">' + esc(f.d.name) + " · " + n + " of 13</span>" + esc(f.q.text), n === 1 ? 900 : 450);
    var row = await list(m, "Choose answer", "Statement " + n, answerRows(n));
    answers[n] = row.value;
  }

  // ---------- the journey ----------
  async function run() {
    day("TODAY");
    day("This is a preview. The live version runs on RS's WhatsApp Business number.", "sys");
    await sleep(400);

    // 1. Invite template (header, body, footer, 3 quick replies)
    var invite = bubble("in",
      '<span class="hdr">YOUR PATIENTS GET HEALTH CHECKS. DOES YOUR PRACTICE?</span>' +
      "Good day Doctor 👋🏽\n\nYou're invited to experience the <b>RS Practice Health Check™</b>, a complimentary business assessment designed exclusively for doctors in private practice.\n\n" +
      "Discover what's working well, what could work better, and where opportunities may exist to strengthen your practice.\n\nYour practice deserves a second opinion too! 🩺\n\n" +
      "No obligation. No commitment. Just an expert second opinion on your practice.\n\nwww.rsmedicalconsultancy.com" +
      '<span class="ftr">RS Medical Consultancy · Practice • People • Performance</span>');
    step("invite");

    var choice = await buttons(invite, [
      { id: "TESTIMONIALS", label: "See what doctors say" },
      { id: "BROCHURE", label: "View our brochure" },
      { id: "BOOK", label: "Book my assessment" },
    ]);

    // Reviews and brochure loop until the doctor books.
    while (choice !== "BOOK") {
      if (choice === "TESTIMONIALS") {
        var rv = await rs("Here's what doctors we work with say about RS Medical Consultancy ⭐");
        var link = document.createElement(CFG.reviewsUrl ? "a" : "button");
        link.className = "action";
        if (CFG.reviewsUrl) { link.href = CFG.reviewsUrl; link.target = "_blank"; link.rel = "noopener"; link.textContent = "↗ Read our Google reviews"; }
        else { link.disabled = true; link.textContent = "↗ Google reviews (link to come)"; }
        rv.querySelector(".bub").appendChild(link);
      } else {
        var br = await rs('<a class="doc" href="' + esc(CFG.brochureUrl || "/assets/rs-brochure.pdf") + '" target="_blank" rel="noopener"><i>PDF</i><span>RS Medical Consultancy brochure.pdf<small>2 pages · PDF</small></span></a>Who we are, how we help practices, and how to reach us.');
        void br;
      }
      var nxt = await rs("Ready to see how your practice is doing? The Health Check takes about 5 minutes, right here in WhatsApp.", 600);
      var opts = choice === "TESTIMONIALS"
        ? [{ id: "BOOK", label: "Book my assessment" }, { id: "BROCHURE", label: "View our brochure" }]
        : [{ id: "BOOK", label: "Book my assessment" }, { id: "TESTIMONIALS", label: "See what doctors say" }];
      choice = await buttons(nxt, opts);
    }

    // 2. About your practice, typed in the chat
    await rs("Wonderful! 🙌 First, a few details about your practice.\n\nWhat is your name?");
    doctor.name = await typed("Dr Priya Naidoo");
    await rs("And the name of your practice?", 500);
    doctor.practice = await typed("Naidoo Family Practice");
    await rs("What is your medical speciality?", 500);
    doctor.specialty = await typed("General Practitioner");
    step("details");

    // 3. The 13 statements
    await rs("Thank you. Now 13 short statements across six areas of your practice. For each one, tap how much you agree. 👇", 700);
    for (var n = 1; n <= 13; n++) await askQuestion(n);
    var ch = await rs("What is the single biggest frustration or challenge you currently have with your practice? (Type it, or tap Skip.)", 600);
    var skip = document.createElement("button");
    skip.type = "button"; skip.className = "qr"; skip.textContent = "Skip";
    ch.appendChild(skip); scroll();
    challenge = await typed("Medical aid rejections are hurting our cash flow.", skip);
    var tm = await rs("Last one: what is the approximate annual turnover of your practice? This stays confidential and doesn't affect your score.", 600);
    turnover = (await list(tm, "Choose turnover", "Practice turnover", turnoverRows())).value;
    step("questions");

    // 4. Summary with Confirm / Edit, loop on edits
    while (true) {
      var sum = await rs(summaryHtml(), 900);
      var c = await buttons(sum, [{ id: "CONFIRM", label: "Confirm" }, { id: "EDIT", label: "Edit" }]);
      if (c === "CONFIRM") break;
      var em = await rs("Which part would you like to change?", 500);
      var area = await list(em, "Choose area", "Edit an answer", [{
        rows: S.DOMAINS.map(function (d) { return { id: "EDIT_D_" + d.key, title: d.name, d: d }; }).concat([{ id: "EDIT_T", title: "Practice turnover" }]),
      }]);
      if (area.id === "EDIT_T") {
        var tm2 = await rs("Choose your annual turnover.", 400);
        turnover = (await list(tm2, "Choose turnover", "Practice turnover", turnoverRows())).value;
      } else {
        var qm = await rs("Which statement?", 400);
        var qrow = await list(qm, "Choose statement", area.d.name, [{
          rows: area.d.questions.map(function (q) { return { id: "EDIT_Q" + q.n, title: "Q" + q.n + " " + q.short, desc: "Now: " + label(answers[q.n]), n: q.n }; }),
        }]);
        var f = findQ(qrow.n);
        var am = await rs(esc(f.q.text), 400);
        answers[qrow.n] = (await list(am, "Choose answer", "Statement " + qrow.n, answerRows(qrow.n))).value;
      }
      await rs("Updated ✅ Here are your answers again.", 400);
    }
    step("confirm");

    // 5. Result
    var r = S.score(answers);
    var cls = S.CLASSIFICATIONS[r.classification];
    submitPreview(r);
    var res = await rs(
      "Thank you, " + esc(doctor.name) + ". Here is your result 🩺\n\n" +
      "<b>Practice Health Score: " + pct(r.overall) + "</b>  " +
      '<span class="badge" style="background:' + color(r.overall) + '">' + r.classification + "</span>\n" +
      esc(cls.line) +
      '<div class="scorebars">' + r.domains.map(function (d) {
        return "<span>" + esc(d.name) + '</span><span class="bt"><i style="width:' + d.pct.toFixed(1) + "%;background:" + color(d.pct) + '"></i></span><span class="bv">' + pct(d.pct) + "</span>";
      }).join("") + "</div>" +
      "\nBook a complimentary consultation with an RS consultant to go through your results. You'll receive your RS Practice Health Report™ with recommendations afterwards." +
      '<span class="ftr">Based on your own self-assessment, not a verified audit.</span>', 1200);
    step("result");

    // 6. Booking (stand-in for Calendly until RS's calendar is connected)
    var book = document.createElement(CFG.calendlyUrl ? "a" : "button");
    book.className = "action";
    book.textContent = "📅 Book my consultation";
    res.querySelector(".bub").appendChild(book); scroll();
    if (CFG.calendlyUrl) {
      var u = new URL(CFG.calendlyUrl);
      u.searchParams.set("name", doctor.name);
      book.href = u.toString(); book.target = "_blank"; book.rel = "noopener";
      return;
    }
    var slot = await pickSlot(book);
    book.disabled = true;
    await rs("You're booked ✅\n\n<b>Complimentary consultation</b>\n" + esc(slot) + "\nWith an RS consultant, online (link to follow)\n\nWe'll remind you 24 hours and 1 hour before. Reply here any time if you need to reschedule.", 900);
    step("booked");
    await sleep(600);
    day("End of preview. Tap “Start again” to replay.", "sys");
  }

  function summaryHtml() {
    var lines = ["Thank you, " + esc(doctor.name) + ". Here are your answers:\n"];
    lines.push("<b>About your practice</b>\n" + esc(doctor.practice) + " · " + esc(doctor.specialty) + "\n");
    S.DOMAINS.forEach(function (d) {
      lines.push("<b>" + esc(d.name) + "</b>\n" + d.questions.map(function (q) { return "Q" + q.n + " " + esc(q.short) + ": " + label(answers[q.n]); }).join("\n") + "\n");
    });
    lines.push("<b>Biggest challenge</b>\n" + (challenge ? esc(challenge) : "Not provided") + "\n");
    lines.push("<b>Practice turnover</b>\n" + esc(turnover) + "\n");
    lines.push("Is this right?");
    return lines.join("\n");
  }

  function pickSlot(btn) {
    return new Promise(function (resolve) {
      btn.addEventListener("click", function open() {
        var days = [], d = new Date();
        while (days.length < 5) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) days.push(new Date(d)); }
        var times = ["09:00", "10:30", "13:00", "15:30"];
        var chosen = { day: null, time: null };
        var panel = sheet.querySelector(".sheet-panel");
        var original = panel.innerHTML;
        panel.innerHTML =
          '<div class="sheet-head"><button type="button" data-x aria-label="Close">✕</button><b>Book your consultation</b></div>' +
          '<div class="cal"><h3>Complimentary consultation</h3><p>45 minutes · online · with an RS consultant</p>' +
          '<div class="days">' + days.map(function (x, i) {
            return '<button type="button" data-day="' + i + '">' + x.toLocaleDateString("en-ZA", { weekday: "short" }) + "<b>" + x.getDate() + "</b></button>";
          }).join("") + "</div>" +
          '<div class="slots">' + times.map(function (t) { return '<button type="button" data-time="' + t + '">' + t + "</button>"; }).join("") + "</div>" +
          '<button type="button" class="go" disabled>Confirm booking</button></div>';
        sheet.hidden = false;
        var go = panel.querySelector(".go");
        function refresh() { go.disabled = chosen.day === null || !chosen.time; }
        panel.querySelectorAll("[data-day]").forEach(function (b) {
          b.addEventListener("click", function () {
            panel.querySelectorAll("[data-day]").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
            b.setAttribute("aria-pressed", "true"); chosen.day = days[+b.getAttribute("data-day")]; refresh();
          });
        });
        panel.querySelectorAll("[data-time]").forEach(function (b) {
          b.addEventListener("click", function () {
            panel.querySelectorAll("[data-time]").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
            b.setAttribute("aria-pressed", "true"); chosen.time = b.getAttribute("data-time"); refresh();
          });
        });
        function restore() { sheet.hidden = true; panel.innerHTML = original; rebindSheet(); }
        panel.querySelector("[data-x]").addEventListener("click", restore);
        go.addEventListener("click", function () {
          var label = chosen.day.toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" }) + " at " + chosen.time;
          restore();
          btn.removeEventListener("click", open);
          resolve(label);
        });
      });
    });
  }

  function rebindSheet() {
    sheetList = document.getElementById("sheet-list");
    sheetTitle = document.getElementById("sheet-title");
    document.getElementById("sheet-close").addEventListener("click", closeSheet);
  }

  // Sends the preview result to the same endpoint as the live funnel, marked as a preview,
  // so the Make scenario can be tested end to end. Failures are ignored here.
  function submitPreview(r) {
    var a = {}; for (var n = 1; n <= 13; n++) a["q" + n] = answers[n];
    var domains = {}; r.domains.forEach(function (d) { domains[d.name] = Math.round(d.pct * 100) / 100; });
    try {
      fetch("/api/submit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rid: "", src: "preview", preview: true, submittedAt: new Date().toISOString(), scoringVersion: r.version,
          doctor: { name: doctor.name, practice: doctor.practice, specialty: doctor.specialty, whatsapp: "+27000000000", email: "preview@example.com" },
          turnover: turnover, answers: a, challenge: challenge, consent: true,
          scores: { domains: domains, overall: Math.round(r.overall * 100) / 100, classification: r.classification },
        }),
      }).catch(function () {});
    } catch (e) { /* ignore */ }
  }

  document.getElementById("restart").addEventListener("click", function () { window.location.reload(); });
  run();
})();
