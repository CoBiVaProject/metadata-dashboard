/* CESA & CoBiVa metadata dashboard — vanilla JS + SVG, no dependencies. */
(function () {
  "use strict";

  const DATA = window.CORPUS_DATA || [];
  const META = window.CORPUS_META || { corpora: [], educationOrder: [] };
  const CORPORA = ["CESA", "CoBiVa"];
  const SVG_NS = "http://www.w3.org/2000/svg";

  const state = { corpus: "both", sex: "all", gen: "all", age: "all", scale: "pct", tableView: {} };
  const chartState = { history: "LH_ageLearn", participantsSort: { key: "id", dir: 1 }, participantsQuery: "" };

  // ---------- helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const color = (c) => `var(--c-${c})`;
  const fmt1 = (v) => (v == null || isNaN(v) ? "—" : (Math.round(v * 10) / 10).toLocaleString());
  const fmtPct = (v) => (v == null || isNaN(v) ? "—" : `${Math.round(v)}%`);
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  const median = (a) => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const nums = (rows, key) => rows.map((r) => r[key]).filter((v) => typeof v === "number" && !isNaN(v));
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function svgEl(tag, attrs = {}, parent) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  }
  function text(parent, x, y, str, attrs = {}) {
    const t = svgEl("text", { x, y, ...attrs }, parent);
    t.textContent = str;
    return t;
  }
  const linear = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }
  function ticks(max, count = 4) {
    const raw = max / count, p = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((v) => v >= raw);
    const out = [];
    for (let v = 0; v <= max + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
    return out;
  }
  // Bar paths: 4px rounded data-end, square at the baseline.
  function colPath(x, y, w, h, r = 4) {
    if (h <= 0) return "";
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  function barPath(x, y, w, h, r = 4) {
    if (w <= 0) return "";
    r = Math.min(r, h / 2, w);
    return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  }

  // ---------- tooltip ----------
  const tip = $("#tooltip");
  function showTip(evt, html) {
    tip.innerHTML = html;
    tip.hidden = false;
    const pad = 14, r = tip.getBoundingClientRect();
    let x = evt.clientX + pad, y = evt.clientY + pad;
    if (x + r.width > window.innerWidth - 8) x = evt.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = evt.clientY - r.height - pad;
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${Math.max(8, y)}px`;
  }
  const hideTip = () => { tip.hidden = true; };
  const ttRow = (c, label, value) =>
    `<div class="tt-row">${c ? `<span class="swatch" style="background:${color(c)}"></span>` : ""}${esc(label)}<b>${esc(value)}</b></div>`;

  function bindHover(node, htmlFn) {
    node.setAttribute("tabindex", "0");
    node.addEventListener("mousemove", (e) => showTip(e, htmlFn()));
    node.addEventListener("mouseleave", hideTip);
    node.addEventListener("focus", () => {
      const b = node.getBoundingClientRect();
      showTip({ clientX: b.right, clientY: b.top }, htmlFn());
    });
    node.addEventListener("blur", hideTip);
  }

  // ---------- filtering ----------
  function activeCorpora() { return state.corpus === "both" ? CORPORA : [state.corpus]; }
  function filtered() {
    const [a0, a1] = state.age === "all" ? [null, null] : state.age.split("-").map(Number);
    return DATA.filter((p) =>
      (state.corpus === "both" || p.corpus === state.corpus) &&
      (state.sex === "all" || p.sex === state.sex) &&
      (state.gen === "all" || String(p.generation) === state.gen) &&
      (a0 == null || (p.age != null && p.age >= a0 && p.age <= a1)));
  }
  const byCorpus = (rows) => Object.fromEntries(activeCorpora().map((c) => [c, rows.filter((r) => r.corpus === c)]));

  // ---------- card scaffolding ----------
  function card(name, { title, desc, legend = "corpora", tools = "" }) {
    const root = $(`[data-chart="${name}"]`);
    const isTable = !!state.tableView[name];
    root.innerHTML = `
      <div class="card-head">
        <div><h3 class="card-title">${title}</h3>${desc ? `<p class="card-desc">${desc}</p>` : ""}</div>
        <div class="card-tools">${tools}<button class="btn" type="button" data-toggle-table>${isTable ? "Show chart" : "Show table"}</button></div>
      </div>
      ${legend === "corpora" && activeCorpora().length > 1 ? legendHtml() : ""}
      <div class="chart"></div>`;
    root.querySelector("[data-toggle-table]").addEventListener("click", () => {
      state.tableView[name] = !isTable;
      renderers[name]();
    });
    return { root, body: root.querySelector(".chart"), isTable, width: Math.max(280, root.querySelector(".chart").clientWidth) };
  }
  function legendHtml(extra = "") {
    return `<div class="legend">${activeCorpora().map((c) =>
      `<span class="legend-item"><span class="legend-dot" style="background:${color(c)}"></span>${c}</span>`).join("")}${extra}</div>`;
  }
  function tableHtml(columns, rows) {
    return `<div class="data-table-wrap"><table class="data-table"><thead><tr>${columns.map((c) =>
      `<th class="${c.num ? "num" : ""}">${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) =>
      `<tr>${columns.map((c, i) => `<td class="${c.num ? "num" : ""}">${esc(r[i])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  const emptyHtml = '<div class="empty">No participants match the current filters.</div>';

  // ---------- chart: grouped columns ----------
  // cats: [label]; series: [{corpus, values:[number], counts:[n], total}]
  function groupedColumns(container, width, { cats, series, valueFmt, tipTitle }) {
    const H = 230, m = { t: 10, r: 6, b: 32, l: 38 };
    const iw = width - m.l - m.r, ih = H - m.t - m.b;
    const svg = svgEl("svg", { viewBox: `0 0 ${width} ${H}`, height: H, role: "img" }, container);
    const max = niceMax(Math.max(1e-9, ...series.flatMap((s) => s.values)));
    const y = linear(0, max, ih, 0);
    const g = svgEl("g", { transform: `translate(${m.l},${m.t})` }, svg);
    for (const t of ticks(max)) {
      svgEl("line", { class: t === 0 ? "baseline" : "gridline", x1: 0, x2: iw, y1: y(t), y2: y(t) }, g);
      text(g, -8, y(t) + 4, valueFmt(t), { class: "tick axis-label", "text-anchor": "end" });
    }
    const band = iw / cats.length, groupW = Math.min(band * 0.72, 30 * series.length + 2 * (series.length - 1));
    const bw = (groupW - 2 * (series.length - 1)) / series.length;
    cats.forEach((cat, i) => {
      const x0 = i * band + (band - groupW) / 2;
      const hit = svgEl("rect", { class: "hit", x: i * band, y: 0, width: band, height: ih, rx: 4 }, g);
      series.forEach((s, j) => {
        const v = s.values[i];
        svgEl("path", { d: colPath(x0 + j * (bw + 2), y(v), bw, ih - y(v)), style: `fill:${color(s.corpus)}`, "pointer-events": "none" }, g);
      });
      text(g, i * band + band / 2, ih + 18, cat, { class: "tick axis-label", "text-anchor": "middle" });
      bindHover(hit, () => `<div class="tt-title">${esc(tipTitle(cat))}</div>` +
        series.map((s) => ttRow(s.corpus, s.corpus, s.tip(i))).join(""));
    });
    svg.setAttribute("aria-label", `${tipTitle("")} by corpus`);
  }

  // ---------- chart: grouped horizontal bars ----------
  function groupedBars(container, width, { cats, series, valueFmt, tipTitle, labelW = 170, maxOverride, showValues = false }) {
    const rowGap = 12, bh = 12, n = series.length;
    const rowH = n * bh + (n - 1) * 2 + rowGap;
    const m = { t: 6, r: 44, b: 24, l: labelW };
    const H = m.t + m.b + cats.length * rowH;
    const iw = width - m.l - m.r;
    const svg = svgEl("svg", { viewBox: `0 0 ${width} ${H}`, height: H, role: "img" }, container);
    const max = maxOverride || niceMax(Math.max(1e-9, ...series.flatMap((s) => s.values)));
    const x = linear(0, max, 0, iw);
    const g = svgEl("g", { transform: `translate(${m.l},${m.t})` }, svg);
    const ih = cats.length * rowH;
    for (const t of ticks(max)) {
      svgEl("line", { class: t === 0 ? "baseline" : "gridline", x1: x(t), x2: x(t), y1: 0, y2: ih }, g);
      text(g, x(t), ih + 16, valueFmt(t), { class: "tick axis-label", "text-anchor": "middle" });
    }
    cats.forEach((cat, i) => {
      const y0 = i * rowH + rowGap / 2;
      const hit = svgEl("rect", { class: "hit", x: -labelW, y: i * rowH, width: iw + labelW + m.r, height: rowH, rx: 4 }, g);
      text(g, -10, y0 + (n * bh + (n - 1) * 2) / 2 + 4, cat, { class: "row-label", "text-anchor": "end" });
      series.forEach((s, j) => {
        const v = s.values[i], yy = y0 + j * (bh + 2);
        svgEl("path", { d: barPath(0, yy, x(v), bh), style: `fill:${color(s.corpus)}`, "pointer-events": "none" }, g);
        if (showValues) text(g, x(v) + 5, yy + bh - 2, valueFmt(v), { class: "tick axis-label", "pointer-events": "none" });
      });
      bindHover(hit, () => `<div class="tt-title">${esc(tipTitle(cat))}</div>` +
        series.map((s) => ttRow(s.corpus, s.corpus, s.tip ? s.tip(i) : valueFmt(s.values[i]))).join(""));
    });
  }

  // ---------- chart: dot plot (means per item, grouped rows) ----------
  // groups: [{label, rows:[{label, key}]}]; value = mean of key per corpus
  function dotPlot(container, width, { groups, rowsByCorpus, domain, valueFmt, tickFmt, labelW = 190 }) {
    const rowH = 26, groupGap = 14;
    const m = { t: 6, r: 16, b: 26, l: labelW };
    const nRows = groups.reduce((s, g) => s + g.rows.length, 0);
    const H = m.t + m.b + nRows * rowH + (groups.length - 1) * groupGap + groups.length * 18;
    const iw = width - m.l - m.r;
    const svg = svgEl("svg", { viewBox: `0 0 ${width} ${H}`, height: H, role: "img" }, container);
    const x = linear(domain[0], domain[1], 0, iw);
    const g = svgEl("g", { transform: `translate(${m.l},${m.t})` }, svg);
    const ih = H - m.t - m.b;
    const tickVals = domain[1] === 100 ? [0, 25, 50, 75, 100] : [0, 1, 2, 3, 4, 5, 6];
    for (const t of tickVals) {
      svgEl("line", { class: "gridline", x1: x(t), x2: x(t), y1: 0, y2: ih }, g);
      text(g, x(t), ih + 16, tickFmt(t), { class: "tick axis-label", "text-anchor": "middle" });
    }
    let yy = 0;
    groups.forEach((grp, gi) => {
      if (gi) yy += groupGap;
      text(g, -labelW, yy + 13, grp.label, { class: "row-group" });
      yy += 18;
      grp.rows.forEach((row) => {
        const cy = yy + rowH / 2;
        const stats = Object.entries(rowsByCorpus).map(([c, rows]) => {
          const vals = nums(rows, row.key);
          return { corpus: c, mean: mean(vals), n: vals.length, med: median(vals) };
        });
        const hit = svgEl("rect", { class: "hit", x: -labelW, y: yy, width: iw + labelW + m.r, height: rowH, rx: 4 }, g);
        text(g, -10, cy + 4, row.label, { class: "row-label", "text-anchor": "end" });
        svgEl("line", { class: "baseline", x1: 0, x2: iw, y1: cy, y2: cy, "pointer-events": "none" }, g);
        const valid = stats.filter((s) => s.mean != null);
        if (valid.length === 2) {
          svgEl("line", { class: "connector", x1: x(valid[0].mean), x2: x(valid[1].mean), y1: cy, y2: cy, "pointer-events": "none" }, g);
        }
        valid.forEach((s) => svgEl("circle", { class: "dot", cx: x(s.mean), cy, r: 6, style: `fill:${color(s.corpus)}`, "pointer-events": "none" }, g));
        bindHover(hit, () => `<div class="tt-title">${esc(grp.label)} — ${esc(row.label)}</div>` +
          stats.map((s) => ttRow(s.corpus, `${s.corpus} mean (n=${s.n})`, valueFmt(s.mean))).join("") +
          stats.map((s) => ttRow(null, `${s.corpus} median`, valueFmt(s.med))).join(""));
        yy += rowH;
      });
    });
  }
  function dotTable(groups, rowsByCorpus, valueFmt) {
    const cs = Object.keys(rowsByCorpus);
    const columns = [{ label: "Section" }, { label: "Item" }, ...cs.flatMap((c) => [{ label: `${c} mean`, num: true }, { label: `${c} n`, num: true }])];
    const rows = [];
    for (const g of groups) for (const r of g.rows) {
      rows.push([g.label, r.label, ...cs.flatMap((c) => { const v = nums(rowsByCorpus[c], r.key); return [valueFmt(mean(v)), v.length]; })]);
    }
    return tableHtml(columns, rows);
  }

  // ---------- chart: scatter ----------
  function scatter(container, width, { points, xLabel, yLabel, tipFn }) {
    const H = Math.min(380, Math.max(280, width * 0.4)), m = { t: 10, r: 16, b: 42, l: 50 };
    const iw = width - m.l - m.r, ih = H - m.t - m.b;
    const max = niceMax(Math.max(1, ...points.flatMap((p) => [p.x, p.y])));
    const x = linear(0, max, 0, iw), y = linear(0, max, ih, 0);
    const svg = svgEl("svg", { viewBox: `0 0 ${width} ${H}`, height: H, role: "img", "aria-label": `${yLabel} vs ${xLabel}` }, container);
    const g = svgEl("g", { transform: `translate(${m.l},${m.t})` }, svg);
    for (const t of ticks(max, 5)) {
      svgEl("line", { class: t === 0 ? "baseline" : "gridline", x1: 0, x2: iw, y1: y(t), y2: y(t) }, g);
      svgEl("line", { class: t === 0 ? "baseline" : "gridline", x1: x(t), x2: x(t), y1: 0, y2: ih }, g);
      text(g, -8, y(t) + 4, t, { class: "tick axis-label", "text-anchor": "end" });
      text(g, x(t), ih + 16, t, { class: "tick axis-label", "text-anchor": "middle" });
    }
    svgEl("line", { class: "ref-line", x1: x(0), y1: y(0), x2: x(max), y2: y(max) }, g);
    text(g, x(max) - 4, y(max) + 14, "equal", { class: "tick axis-label", "text-anchor": "end" });
    text(g, iw / 2, ih + 36, xLabel, { class: "axis-label", "text-anchor": "middle" });
    text(g, -38, ih / 2, yLabel, { class: "axis-label", "text-anchor": "middle", transform: `rotate(-90 ${-38} ${ih / 2})` });
    // jitter identical coordinates slightly so stacked answers stay visible
    const seen = {};
    const placed = points.map((p) => {
      const k = `${p.x}|${p.y}`, i = (seen[k] = (seen[k] || 0) + 1) - 1;
      const ang = i * 2.4, rad = i ? 3 + i * 0.9 : 0;
      return { ...p, px: x(p.x) + Math.cos(ang) * rad, py: y(p.y) + Math.sin(ang) * rad };
    });
    const dots = placed.map((p) => svgEl("circle", { class: "scatter-dot", cx: p.px, cy: p.py, r: 5, style: `fill:${color(p.corpus)}` }, g));
    const overlay = svgEl("rect", { x: 0, y: 0, width: iw, height: ih, fill: "transparent" }, g);
    let active = null;
    overlay.addEventListener("mousemove", (e) => {
      const b = overlay.getBoundingClientRect();
      const sx = ((e.clientX - b.left) / b.width) * iw, sy = ((e.clientY - b.top) / b.height) * ih;
      let best = -1, bd = 24 * 24;
      placed.forEach((p, i) => { const d = (p.px - sx) ** 2 + (p.py - sy) ** 2; if (d < bd) { bd = d; best = i; } });
      if (active != null) dots[active].classList.remove("active");
      active = best >= 0 ? best : null;
      if (active == null) return hideTip();
      dots[active].classList.add("active");
      showTip(e, tipFn(placed[active]));
    });
    overlay.addEventListener("mouseleave", () => { if (active != null) dots[active].classList.remove("active"); active = null; hideTip(); });
  }

  // ---------- KPIs ----------
  function renderKpis(rows) {
    const bc = byCorpus(rows);
    const tile = (label, fn) => `<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-values">${
      Object.entries(bc).map(([c, r]) => `<div><div class="kpi-value">${fn(r)}</div><div class="kpi-corpus"><span class="swatch" style="background:${color(c)}"></span>${c}</div></div>`).join("")}</div></div>`;
    const years = (r) => { const v = nums(r, "interviewYear"); return v.length ? `${Math.min(...v)}–${String(Math.max(...v)).slice(2)}` : "—"; };
    $("#kpis").innerHTML =
      tile("Participants", (r) => r.length) +
      tile("Female", (r) => fmtPct(r.length ? (100 * r.filter((p) => p.sex === "Female").length) / r.length : null)) +
      tile("Median age", (r) => fmt1(median(nums(r, "age")))) +
      tile("Born in the US", (r) => { const k = r.filter((p) => p.birthCountry); return fmtPct(k.length ? (100 * k.filter((p) => p.birthCountry === "USA").length) / k.length : null); }) +
      tile("Interview years", years);
  }

  // ---------- categorical distribution helper ----------
  function distribution(rows, cats, getCat) {
    const bc = byCorpus(rows);
    return Object.entries(bc).map(([c, r]) => {
      const counts = cats.map((cat) => r.filter((p) => getCat(p) === cat).length);
      const total = r.filter((p) => getCat(p) != null).length;
      const values = counts.map((n) => (state.scale === "pct" ? (total ? (100 * n) / total : 0) : n));
      const tip = (i) => `${counts[i]} of ${total} (${fmtPct(total ? (100 * counts[i]) / total : null)})`;
      return { corpus: c, counts, total, values, tip };
    });
  }
  const scaleFmt = (v) => (state.scale === "pct" ? fmtPct(v) : fmt1(v));
  function distTable(cats, series, catLabel) {
    return tableHtml([{ label: catLabel }, ...series.flatMap((s) => [{ label: `${s.corpus} n`, num: true }, { label: `${s.corpus} %`, num: true }])],
      cats.map((cat, i) => [cat, ...series.flatMap((s) => [s.counts[i], fmtPct(s.total ? (100 * s.counts[i]) / s.total : null)])]));
  }

  // ---------- renderers ----------
  const AGE_BINS = [[15, 19], [20, 24], [25, 29], [30, 39], [40, 49], [50, 59], [60, 120]];
  const ageLabel = ([a, b]) => (b > 100 ? `${a}+` : `${a}–${b}`);

  const renderers = {
    age() {
      const rows = filtered();
      const c = card("age", { title: "Age at interview", desc: "Participants per age band" });
      const cats = AGE_BINS.map(ageLabel);
      const binOf = (p) => { if (p.age == null) return null; const b = AGE_BINS.find(([a, z]) => p.age >= a && p.age <= z); return b ? ageLabel(b) : null; };
      const series = distribution(rows, cats, binOf);
      if (!rows.length) return (c.body.innerHTML = emptyHtml);
      if (c.isTable) return (c.body.innerHTML = distTable(cats, series, "Age band"));
      groupedColumns(c.body, c.width, { cats, series, valueFmt: scaleFmt, tipTitle: (cat) => `Age ${cat}` });
      const missing = rows.filter((p) => p.age == null).length;
      if (missing) c.body.insertAdjacentHTML("beforeend", `<div class="note">${missing} participant(s) with no age recorded are not shown.</div>`);
    },

    generation() {
      const rows = filtered();
      const c = card("generation", { title: "Generation", desc: "1 = born outside the US · 2 = US-born child of immigrants · 3 = US-born, parents US-born" });
      const cats = ["1st", "2nd", "3rd"];
      const series = distribution(rows, cats, (p) => (p.generation ? cats[p.generation - 1] : null));
      if (!rows.length) return (c.body.innerHTML = emptyHtml);
      if (c.isTable) return (c.body.innerHTML = distTable(cats, series, "Generation"));
      groupedColumns(c.body, c.width, { cats: cats.map((s) => `${s} generation`), series, valueFmt: scaleFmt, tipTitle: (cat) => cat || "Generation" });
    },

    education() {
      const rows = filtered();
      const c = card("education", { title: "Education level", desc: "Free-text answers grouped into six levels (original wording in the table below)" });
      const cats = META.educationOrder;
      const series = distribution(rows, cats, (p) => p.education);
      if (!rows.length) return (c.body.innerHTML = emptyHtml);
      if (c.isTable) return (c.body.innerHTML = distTable(cats, series, "Education"));
      groupedBars(c.body, c.width, { cats, series, valueFmt: scaleFmt, tipTitle: (cat) => cat, labelW: 160 });
    },

    birthplace() {
      const rows = filtered();
      const c = card("birthplace", { title: "Born in Mexico", desc: "Share of participants, mothers and fathers born in Mexico (of those with a known birthplace)" });
      const who = [["Participant", "birthCountry"], ["Mother", "motherCountry"], ["Father", "fatherCountry"]];
      const bc = byCorpus(rows);
      const series = Object.entries(bc).map(([corpus, r]) => {
        const info = who.map(([, key]) => {
          const known = r.filter((p) => p[key]);
          const counts = {};
          known.forEach((p) => (counts[p[key]] = (counts[p[key]] || 0) + 1));
          return { known: known.length, mx: counts.Mexico || 0, counts };
        });
        return {
          corpus, info,
          values: info.map((d) => (d.known ? (100 * d.mx) / d.known : 0)),
          tip: (i) => `${info[i].mx} of ${info[i].known} (${fmtPct(info[i].known ? (100 * info[i].mx) / info[i].known : null)})`,
        };
      });
      if (!rows.length) return (c.body.innerHTML = emptyHtml);
      if (c.isTable) {
        const countries = [...new Set(series.flatMap((s) => s.info.flatMap((d) => Object.keys(d.counts))))].sort();
        return (c.body.innerHTML = tableHtml(
          [{ label: "Corpus" }, { label: "Person" }, ...countries.map((k) => ({ label: k, num: true })), { label: "Unknown", num: true }],
          series.flatMap((s) => who.map(([label], i) => [s.corpus, label, ...countries.map((k) => s.info[i].counts[k] || 0), bc[s.corpus].length - s.info[i].known]))));
      }
      groupedBars(c.body, c.width, { cats: who.map((w) => w[0]), series, valueFmt: fmtPct, tipTitle: (cat) => `${cat} born in Mexico`, labelW: 90, maxOverride: 100, showValues: true });
    },

    history() {
      const rows = filtered();
      const opts = [
        ["LH_ageLearn", "Age when they learned the language", "Age (years)"],
        ["LH_comfortSpeaking", "Age when they felt comfortable speaking it", "Age (years)"],
        ["LH_yearsCountry", "Years lived where the language is spoken", "Years"],
        ["LH_yearsFamily", "Years speaking the language with family", "Years"],
        ["LH_yearsWork", "Years working in the language", "Years"],
      ];
      const cur = opts.find((o) => o[0] === chartState.history) || opts[0];
      const tools = `<select data-history aria-label="Linguistic history measure">${opts.map((o) =>
        `<option value="${o[0]}" ${o[0] === cur[0] ? "selected" : ""}>${o[1]}</option>`).join("")}</select>`;
      const c = card("history", {
        title: "Spanish vs. English linguistic history",
        desc: "Each dot is one participant. Above the diagonal = more for English; below = more for Spanish.",
        tools, legend: "none",
      });
      c.root.querySelector("[data-history]").addEventListener("change", (e) => { chartState.history = e.target.value; renderers.history(); });
      const ke = `${cur[0]}_es`, kn = `${cur[0]}_en`;
      const pts = rows.filter((p) => typeof p[ke] === "number" && typeof p[kn] === "number")
        .map((p) => ({ x: p[ke], y: p[kn], corpus: p.corpus, p }));
      const bc = byCorpus(rows);
      const summary = Object.entries(bc).map(([corp, r]) => {
        const es = nums(r, ke), en = nums(r, kn);
        return `<span class="legend-item"><span class="legend-dot" style="background:${color(corp)}"></span>${corp}: Spanish mean ${fmt1(mean(es))}, English mean ${fmt1(mean(en))}</span>`;
      }).join("");
      c.body.insertAdjacentHTML("beforebegin", `<div class="legend">${summary}<span class="legend-item"><span class="legend-line"></span>Equal for both languages</span></div>`);
      if (!pts.length) return (c.body.innerHTML = emptyHtml);
      if (c.isTable) {
        return (c.body.innerHTML = tableHtml([{ label: "Participant" }, { label: "Corpus" }, { label: "Spanish", num: true }, { label: "English", num: true }],
          pts.map((d) => [d.p.id, d.corpus, d.x, d.y])));
      }
      scatter(c.body, c.width, {
        points: pts, xLabel: `Spanish — ${cur[2].toLowerCase()}`, yLabel: `English — ${cur[2].toLowerCase()}`,
        tipFn: (d) => `<div class="tt-title">${esc(d.p.id)}</div>` + ttRow(d.corpus, "Corpus", d.corpus) +
          ttRow(null, "Spanish", d.x) + ttRow(null, "English", d.y) + ttRow(null, "Age", d.p.age ?? "—") + ttRow(null, "Generation", d.p.generation ?? "—"),
      });
      const dropped = rows.length - pts.length;
      if (dropped) c.body.insertAdjacentHTML("beforeend", `<div class="note">${dropped} participant(s) without numeric answers for both languages are not shown.</div>`);
    },

    use() {
      const rows = filtered();
      const c = card("use", { title: "Weekly language use by domain", desc: "Mean percent of time each language is used (participants' own estimates; may not sum to 100)" });
      const domains = [["friends", "With friends"], ["family", "With family"], ["schoolWork", "At school / work"], ["think", "Talking to oneself"], ["math", "Doing math in one's head"]];
      const groups = [
        { label: "Spanish", rows: domains.map(([k, l]) => ({ label: l, key: `LU_${k}_es` })) },
        { label: "English", rows: domains.map(([k, l]) => ({ label: l, key: `LU_${k}_en` })) },
      ];
      if (!rows.length) return (c.body.innerHTML = emptyHtml);
      if (c.isTable) return (c.body.innerHTML = dotTable(groups, byCorpus(rows), fmtPct));
      dotPlot(c.body, c.width, { groups, rowsByCorpus: byCorpus(rows), domain: [0, 100], valueFmt: fmtPct, tickFmt: (t) => `${t}%`, labelW: 200 });
    },

    competency() {
      const rows = filtered();
      const c = card("competency", { title: "Self-rated competency", desc: "Mean rating, 0 (not at all) – 6 (very well)" });
      const skills = [["speak", "Speak"], ["understand", "Understand"], ["read", "Read"], ["write", "Write"]];
      const groups = [
        { label: "Spanish", rows: skills.map(([k, l]) => ({ label: l, key: `C_${k}_es` })) },
        { label: "English", rows: skills.map(([k, l]) => ({ label: l, key: `C_${k}_en` })) },
      ];
      if (!rows.length) return (c.body.innerHTML = emptyHtml);
      if (c.isTable) return (c.body.innerHTML = dotTable(groups, byCorpus(rows), fmt1));
      dotPlot(c.body, c.width, { groups, rowsByCorpus: byCorpus(rows), domain: [0, 6], valueFmt: fmt1, tickFmt: String, labelW: 110 });
    },

    attitudes() {
      const rows = filtered();
      const c = card("attitudes", { title: "Language attitudes", desc: "Mean agreement, 0 (disagree) – 6 (agree)" });
      const items = [["feelMyself", "I feel like myself"], ["identify", "Identify with the culture"], ["nativeSpeaker", "Important to sound native"], ["perceivedNative", "Want to be seen as native"]];
      const groups = [
        { label: "Spanish", rows: items.map(([k, l]) => ({ label: l, key: `A_${k}_es` })) },
        { label: "English", rows: items.map(([k, l]) => ({ label: l, key: `A_${k}_en` })) },
      ];
      if (!rows.length) return (c.body.innerHTML = emptyHtml);
      if (c.isTable) return (c.body.innerHTML = dotTable(groups, byCorpus(rows), fmt1));
      dotPlot(c.body, c.width, { groups, rowsByCorpus: byCorpus(rows), domain: [0, 6], valueFmt: fmt1, tickFmt: String, labelW: 170 });
    },
  };

  // ---------- participants table ----------
  const P_COLS = [
    ["id", "ID"], ["corpus", "Corpus"], ["sex", "Sex"], ["age", "Age", true], ["interviewYear", "Interviewed", true],
    ["generation", "Gen.", true], ["educationRaw", "Education (as reported)"], ["birthCity", "Birthplace"],
    ["birthCountry", "Country"], ["residence", "Lives in"], ["yearsUS", "Years in US", true],
    ["LH_ageLearn_es", "Age learned Sp.", true], ["LH_ageLearn_en", "Age learned En.", true],
    ["C_speak_es", "Speaks Sp. (0–6)", true], ["C_speak_en", "Speaks En. (0–6)", true],
  ];
  function renderParticipants() {
    const root = $("#participants");
    const q = chartState.participantsQuery.toLowerCase();
    const { key, dir } = chartState.participantsSort;
    const rows = filtered().filter((p) => !q || P_COLS.some(([k]) => String(p[k] ?? "").toLowerCase().includes(q)))
      .sort((a, b) => {
        const x = a[key], y = b[key];
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * dir;
      });
    const hadFocus = document.activeElement && document.activeElement.matches("[data-psearch]");
    root.innerHTML = `
      <div class="card-head">
        <div><h3 class="card-title">Participant list</h3><p class="card-desc">${rows.length} participant(s) — click a column header to sort</p></div>
        <div class="card-tools"><input class="table-search" data-psearch type="search" placeholder="Search…" value="${esc(chartState.participantsQuery)}" aria-label="Search participants"></div>
      </div>
      <div class="data-table-wrap"><table class="data-table"><thead><tr>${P_COLS.map(([k, l, n]) =>
        `<th class="sortable ${n ? "num" : ""}" data-sort="${k}" aria-sort="${k === key ? (dir > 0 ? "ascending" : "descending") : "none"}">${esc(l)}${k === key ? (dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((p) => `<tr>${P_COLS.map(([k, , n]) => `<td class="${n ? "num" : ""}">${k === "corpus" ? `<span class="swatch" style="background:${color(p.corpus)}"></span>` : ""}${esc(p[k] ?? "—")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    root.querySelectorAll("[data-sort]").forEach((th) => th.addEventListener("click", () => {
      const k = th.dataset.sort;
      chartState.participantsSort = { key: k, dir: k === key ? -dir : 1 };
      renderParticipants();
    }));
    const input = root.querySelector("[data-psearch]");
    input.addEventListener("input", (e) => { chartState.participantsQuery = e.target.value; renderParticipants(); });
    if (hadFocus) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  }

  // ---------- wiring ----------
  function renderAll() {
    const rows = filtered();
    $("#f-summary").textContent = `Showing ${rows.length} of ${DATA.length} participants`;
    renderKpis(rows);
    Object.values(renderers).forEach((r) => r());
    renderParticipants();
  }
  [["#f-corpus", "corpus"], ["#f-sex", "sex"], ["#f-gen", "gen"], ["#f-age", "age"], ["#f-scale", "scale"]].forEach(([sel, key]) =>
    $(sel).addEventListener("change", (e) => { state[key] = e.target.value; renderAll(); }));
  $("#f-reset").addEventListener("click", () => {
    Object.assign(state, { corpus: "both", sex: "all", gen: "all", age: "all", scale: "pct" });
    ["#f-corpus", "#f-sex", "#f-gen", "#f-age", "#f-scale"].forEach((s) => ($(s).selectedIndex = 0));
    chartState.participantsQuery = "";
    renderAll();
  });

  const themeBtn = $("#theme-toggle");
  const isDark = () => document.documentElement.dataset.theme === "dark" ||
    (!document.documentElement.dataset.theme && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const syncThemeBtn = () => (themeBtn.textContent = isDark() ? "Light mode" : "Dark mode");
  themeBtn.addEventListener("click", () => { document.documentElement.dataset.theme = isDark() ? "light" : "dark"; syncThemeBtn(); });
  syncThemeBtn();

  let resizeTimer;
  let lastWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderAll, 120);
  });

  renderAll();
})();
