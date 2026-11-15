(function () {
  "use strict";
  var S = window.RSScoring;
  var CFG = window.RS_CONFIG || {};
  var panel = document.getElementById("panel");
  var STORE_KEY = "rs-health-check-v1";

  // ---- State -------------------------------------------------------------
  var params = new URLSearchParams(window.location.search);
  var state = load() || {
    step: 0,
    details: { name: "", practice: "", specialty: "", address: "", whatsapp: "", email: "" },
    turnover: "",
    answers: {},
    challenge: "",
    consent: false,
  };
  // Tracking from the invite link always wins over saved values.
  state.rid = params.get("rid") || state.rid || "";
  state.src = params.get("src") || state.src || "web";
  ["name", "email"].forEach(function (k) { if (params.get(k)) state.details[k] = params.get(k); });
  if (params.get("phone")) state.details.whatsapp = params.get("phone");

  function load() {
    try { var s = localStorage.getItem(STORE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
  }
  function clear() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* storage unavailable */ }
  }

  // ---- Steps -------------------------------------------------------------
  // 0 details, 1 turnover, 2..7 domains, 8 challenge, 9 review, 10 result
  var D0 = 2, CHALLENGE = 2 + S.DOMAINS.length, REVIEW = CHALLENGE + 1, RESULT = REVIEW + 1;
  var editingFromReview = false;
  if (state.step >= RESULT) state.step = REVIEW;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmt(p) { return (Math.round(p * 10) / 10).toFixed(1).replace(/\.0$/, "") + "%"; }

  function setProgress(step) {
    var wrap = document.getElementById("progress-wrap");
    if (step >= RESULT) { wrap.classList.add("hidden"); return; }
    wrap.classList.remove("hidden");
    var pct = Math.round((step / RESULT) * 100);
    document.getElementById("progress-bar").style.width = pct + "%";
    var label = step === 0 ? "Your details" : step === 1 ? "Your practice" :
      step < CHALLENGE ? S.DOMAINS[step - D0].name : step === CHALLENGE ? "Your biggest challenge" : "Check your answers";
    document.getElementById("progress-step").textContent = "Step " + (step + 1) + " of " + RESULT + " · " + label;
    var left = Math.max(1, Math.round(((RESULT - step) / RESULT) * 3));
    document.getElementById("progress-time").textContent = step < REVIEW ? "About " + left + " min left" : "";
  }

  function go(step) {
    state.step = step;
    save();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function navHtml(opts) {
    opts = opts || {};
    var back = state.step > 0 ? '<button class="btn btn-ghost" type="button" data-back>Back</button>' : "<span></span>";
    if (editingFromReview && state.step < REVIEW) back = '<span></span>';
    var nextLabel = editingFromReview && state.step < REVIEW ? "Save and review" : (opts.next || "Continue");
    return '<div class="nav">' + back + '<button class="btn btn-primary" type="submit">' + esc(nextLabel) + "</button></div>";
  }

  function nextStep() {
    if (editingFromReview) { editingFromReview = false; go(REVIEW); }
    else go(state.step + 1);
  }

  // ---- Renderers -----------------------------------------------------------
  function render() {
    setProgress(state.step);
    var s = state.step;
    if (s === 0) return renderDetails();
    if (s === 1) return renderTurnover();
    if (s < CHALLENGE) return renderDomain(S.DOMAINS[s - D0]);
    if (s === CHALLENGE) return renderChallenge();
    if (s === REVIEW) return renderReview();
    return renderResult();
  }

  function field(id, label, value, type, hint, extra) {
    return '<div class="field" data-field="' + id + '"><label for="f-' + id + '">' + label + "</label>" +
      '<input id="f-' + id + '" name="' + id + '" type="' + (type || "text") + '" value="' + esc(value) + '" ' + (extra || "") + ">" +
      (hint ? '<div class="hint">' + hint + "</div>" : "") +
      '<div class="err">Please fill this in.</div></div>';
  }

  function renderDetails() {
    var d = state.details;
    panel.innerHTML =
      "<h1>Let's start with <em class=\"accent\">you</em></h1>" +
      '<p class="intro">So we can send your results and prepare for your consultation.</p>' +
      '<form novalidate id="form">' +
      field("name", "Your name", d.name, "text", "", 'autocomplete="name" placeholder="Dr. Thandi Nkosi"') +
      field("practice", "Practice name", d.practice, "text", "", 'autocomplete="organization"') +
      field("specialty", "Medical specialty", d.specialty, "text", "", 'list="specialties"') +
      field("address", "Practice address", d.address, "text", "", 'autocomplete="street-address"') +
      field("whatsapp", "WhatsApp number", d.whatsapp, "tel", "We'll send your results here.", 'autocomplete="tel" inputmode="tel" placeholder="082 555 0142"') +
      field("email", "Email", d.email, "email", "", 'autocomplete="email"') +
      '<datalist id="specialties">' + ["General Practitioner", "Paediatrician", "Gynaecologist", "Physician", "Surgeon", "Orthopaedic Surgeon", "Dermatologist", "Psychiatrist", "Cardiologist", "Radiologist", "Anaesthetist", "Dentist", "Physiotherapist"].map(function (x) { return '<option value="' + x + '">'; }).join("") + "</datalist>" +
      navHtml() + "</form>";
    bindForm(function (form) {
      var ok = true;
      Object.keys(d).forEach(function (k) {
        var v = form.elements[k].value.trim();
        d[k] = v;
        var bad = !v || (k === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) || (k === "whatsapp" && normalisePhone(v).length < 11);
        form.querySelector('[data-field="' + k + '"]').classList.toggle("invalid", bad);
        if (bad) {
          ok = false;
          var err = form.querySelector('[data-field="' + k + '"] .err');
          err.textContent = !v ? "Please fill this in." : k === "email" ? "Please check this email address." : "Please check this number.";
        }
      });
      if (!ok) { var first = form.querySelector(".invalid input"); if (first) first.focus(); return; }
      nextStep();
    });
  }

  // South African numbers to E.164 (+27...). Other countries kept if they start with +.
  function normalisePhone(v) {
    var digits = String(v).replace(/[^\d+]/g, "");
    if (digits.indexOf("+") === 0) return "+" + digits.slice(1).replace(/\+/g, "");
    digits = digits.replace(/\+/g, "");
    if (digits.indexOf("00") === 0) return "+" + digits.slice(2);
    if (digits.indexOf("27") === 0) return "+" + digits;
    if (digits.indexOf("0") === 0) return "+27" + digits.slice(1);
    return "+27" + digits;
  }

  function optionsHtml(name, items, selected) {
    return '<div class="options" role="radiogroup">' + items.map(function (it) {
      var checked = String(selected) === String(it.value) ? " checked" : "";
      return '<label class="option"><input type="radio" name="' + name + '" value="' + esc(it.value) + '"' + checked + "><span>" + esc(it.label) + "</span></label>";
    }).join("") + "</div>";
  }

  function renderTurnover() {
    panel.innerHTML =
      "<h1>About your <em class=\"accent\">practice</em></h1>" +
      '<p class="intro">This helps us prepare for your consultation. It does not affect your score.</p>' +
      '<form novalidate id="form"><div class="question" data-q="turnover"><div class="qt">What is your practice\'s annual turnover?</div>' +
      optionsHtml("turnover", S.TURNOVER.map(function (t) { return { value: t, label: t }; }), state.turnover) +
      "</div>" + navHtml() + "</form>";
    bindForm(function (form) {
      var v = form.querySelector('input[name="turnover"]:checked');
      if (!v) { form.querySelector('[data-q="turnover"]').classList.add("missing"); return; }
      state.turnover = v.value;
      nextStep();
    });
  }

  function renderDomain(d) {
    var idx = S.DOMAINS.indexOf(d) + 1;
    panel.innerHTML =
      '<p class="eyebrow">Area ' + idx + " of " + S.DOMAINS.length + "</p>" +
      "<h1>" + esc(d.name) + "</h1>" +
      '<p class="intro">How much do you agree with each statement?</p>' +
      '<form novalidate id="form">' +
      d.questions.map(function (q) {
        return '<div class="question" data-q="' + q.n + '"><div class="qn">STATEMENT ' + q.n + " OF 13</div>" +
          '<div class="qt">' + esc(q.text) + "</div>" + optionsHtml("q" + q.n, S.SCALE, state.answers[q.n]) + "</div>";
      }).join("") + navHtml() + "</form>";
    bindForm(function (form) {
      var ok = true;
      d.questions.forEach(function (q) {
        var v = form.querySelector('input[name="q' + q.n + '"]:checked');
        form.querySelector('[data-q="' + q.n + '"]').classList.toggle("missing", !v);
        if (v) state.answers[q.n] = parseInt(v.value, 10); else ok = false;
      });
      save();
      if (!ok) { var m = form.querySelector(".missing"); if (m) m.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
      nextStep();
    });
    // Save each tap as it happens, so a refresh keeps the answers.
    panel.querySelectorAll('input[type="radio"]').forEach(function (r) {
      r.addEventListener("change", function () {
        state.answers[parseInt(r.name.slice(1), 10)] = parseInt(r.value, 10);
        r.closest(".question").classList.remove("missing");
        save();
      });
    });
  }

  function renderChallenge() {
    panel.innerHTML =
      "<h1>Your biggest <em class=\"accent\">challenge</em></h1>" +
      '<p class="intro">In a sentence or two, what is the biggest challenge in your practice right now? It does not affect your score, and we will discuss it in your consultation.</p>' +
      '<form novalidate id="form"><div class="field"><label for="f-challenge">Biggest challenge (optional)</label>' +
      '<textarea id="f-challenge" name="challenge" maxlength="1500">' + esc(state.challenge) + "</textarea></div>" +
      navHtml({ next: "Review my answers" }) + "</form>";
    bindForm(function (form) {
      state.challenge = form.elements.challenge.value.trim();
      nextStep();
    });
  }

  function labelFor(v) {
    var s = S.SCALE.filter(function (x) { return x.value === v; })[0];
    return s ? s.label : "Not answered";
  }

  function renderReview() {
    var d = state.details;
    var html =
      "<h1>Is this <em class=\"accent\">right?</em></h1>" +
      '<p class="intro">Check your answers. Tap Edit to change anything, then confirm to see your score.</p>' +
      group("Your details", 0, [
        ["Name", d.name], ["Practice", d.practice], ["Specialty", d.specialty],
        ["Address", d.address], ["WhatsApp", d.whatsapp], ["Email", d.email],
      ]) +
      group("Annual turnover", 1, [["Turnover", state.turnover]]) +
      S.DOMAINS.map(function (dom, i) {
        return group(dom.name, D0 + i, dom.questions.map(function (q) { return ["Q" + q.n + " " + q.short, labelFor(state.answers[q.n])]; }));
      }).join("") +
      group("Biggest challenge", CHALLENGE, [["", state.challenge || "Not provided"]]) +
      '<form novalidate id="form">' +
      '<label class="consent"><input type="checkbox" name="consent"' + (state.consent ? " checked" : "") + "> " +
      "<span>I agree that RS Medical Consultancy may use these answers to prepare my results and consultation, and contact me about them on WhatsApp and email.</span></label>" +
      '<div id="submit-error" class="notice error hidden"></div>' +
      '<div class="nav"><button class="btn btn-ghost" type="button" data-back>Back</button>' +
      '<button class="btn btn-primary" type="submit" id="confirm-btn">Confirm and see my score</button></div></form>';
    panel.innerHTML = html;

    panel.querySelectorAll("[data-edit]").forEach(function (b) {
      b.addEventListener("click", function () { editingFromReview = true; go(parseInt(b.getAttribute("data-edit"), 10)); });
    });
    var form = document.getElementById("form");
    var btn = document.getElementById("confirm-btn");
    var sync = function () { btn.disabled = !form.elements.consent.checked; };
    form.elements.consent.addEventListener("change", function () { state.consent = form.elements.consent.checked; save(); sync(); });
    sync();
    bindForm(function () {
      var result = S.score(state.answers);
      if (!result.complete) {
        for (var n = 1; n <= 13; n++) if (!state.answers[n]) {
          var di = S.DOMAINS.findIndex(function (dd) { return dd.questions.some(function (q) { return q.n === n; }); });
          editingFromReview = true; return go(D0 + di);
        }
      }
      submit(result, btn);
    });
  }

  function group(title, step, rows) {
    return '<div class="review-group"><header><h3>' + esc(title) + '</h3><button class="link" type="button" data-edit="' + step + '">Edit</button></header>' +
      rows.map(function (r) {
        return '<div class="review-row"><span class="q">' + esc(r[0]) + '</span><span class="a">' + esc(r[1]) + "</span></div>";
      }).join("") + "</div>";
  }

  function buildPayload(result) {
    var d = state.details;
    var answers = {};
    for (var n = 1; n <= 13; n++) answers["q" + n] = state.answers[n];
    var domains = {};
    result.domains.forEach(function (x) { domains[x.name] = Math.round(x.pct * 100) / 100; });
    return {
      rid: state.rid,
      src: state.src,
      submittedAt: new Date().toISOString(),
      scoringVersion: result.version,
      doctor: {
        name: d.name, practice: d.practice, specialty: d.specialty, address: d.address,
        whatsapp: normalisePhone(d.whatsapp), email: d.email,
      },
      turnover: state.turnover,
      answers: answers,
      challenge: state.challenge,
      consent: state.consent,
      // Shown to the doctor; Airtable formulas stay the record of truth.
      scores: { domains: domains, overall: Math.round(result.overall * 100) / 100, classification: result.classification },
    };
  }

  function submit(result, btn) {
    var errBox = document.getElementById("submit-error");
    btn.disabled = true;
    btn.textContent = "Sending…";
    errBox.classList.add("hidden");
    fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload(result)),
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      state.result = result;
      state.step = RESULT;
      clear();
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }).catch(function () {
      btn.disabled = false;
      btn.textContent = "Try again";
      errBox.textContent = "We couldn't send your answers just now. Please check your connection and try again. Your answers are saved on this device.";
      errBox.classList.remove("hidden");
    });
  }

  function renderResult() {
    var r = state.result;
    var c = S.CLASSIFICATIONS[r.classification];
    var first = (state.details.name || "").trim();
    var booking = "";
    if (CFG.calendlyUrl) {
      var u = new URL(CFG.calendlyUrl);
      u.searchParams.set("name", state.details.name);
      u.searchParams.set("email", state.details.email);
      if (state.rid) u.searchParams.set("utm_content", state.rid);
      u.searchParams.set("utm_source", state.src);
      booking = '<a class="btn btn-primary" href="' + esc(u.toString()) + '" target="_blank" rel="noopener">Book my complimentary consultation</a>';
    }
    panel.innerHTML =
      '<p class="eyebrow">Your result</p>' +
      "<h1>Thank you" + (first ? ", " + esc(first) : "") + "</h1>" +
      '<p class="intro">Here is your Practice Health Score. ' + (state.src === "email" ? "We've also sent it to your inbox." : "We've also sent it to you on WhatsApp.") + "</p>" +
      '<div class="score-card"><div class="score-top">' +
      '<div class="score-ring" style="--p:' + r.overall.toFixed(1) + ";--c:" + c.color + '"><div>' + fmt(r.overall) + "</div></div>" +
      '<div><span class="class-badge" style="background:' + c.color + '">' + r.classification + "</span><p>" + esc(c.line) + "</p></div></div>" +
      '<div class="bars">' + r.domains.map(function (d) {
        return '<div><div class="bar-label"><b>' + esc(d.name) + "</b><span>" + fmt(d.pct) + '</span></div><div class="bar"><span data-w="' + d.pct.toFixed(1) + '" style="background:' + barColor(d.pct) + '"></span></div></div>';
      }).join("") + "</div>" +
      '<p class="disclaimer">These results are based on your own self-assessment and are not a verified operational or financial audit.</p></div>' +
      "<h2 style=\"margin:32px 0 8px\">What happens next</h2>" +
      '<p class="intro">Book a complimentary consultation with an RS consultant. We\'ll go through your results together, and you\'ll receive your RS Practice Health Report™ with recommendations afterwards.</p>' +
      '<div class="btn-row">' + (booking || '<p class="intro">An RS consultant will be in touch to arrange your complimentary consultation.</p>') + "</div>";
    requestAnimationFrame(function () {
      panel.querySelectorAll(".bar span").forEach(function (s) { s.style.width = s.getAttribute("data-w") + "%"; });
    });
  }

  function barColor(p) {
    return p >= 85 ? "var(--thriving)" : p >= 70 ? "var(--healthy)" : p >= 50 ? "var(--opportunity)" : "var(--priority)";
  }

  function bindForm(onSubmit) {
    var form = document.getElementById("form");
    form.addEventListener("submit", function (e) { e.preventDefault(); onSubmit(form); });
    var back = panel.querySelector("[data-back]");
    if (back) back.addEventListener("click", function () { go(state.step - 1); });
  }

  render();
})();
