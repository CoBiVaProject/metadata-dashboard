/* CESA & CoBiVa metadata dashboard — D3 v7.
 *
 * data.js holds only aggregated counts: one "cell" per corpus × sex ×
 * generation × age band, each with value→count histograms. Any filter
 * selection is answered by summing the matching cells.
 */
(function () {
  "use strict";

  const CELLS = window.CORPUS_CELLS || [];
  const META = window.CORPUS_META || { corpora: [], educationOrder: [], total: 0 };
  const CORPORA = ["CESA", "CoBiVa"];

  const state = { corpus: "both", sex: "all", gen: "all", age: "all", scale: "pct", tableView: {} };
  const chartState = { history: "LH_ageLearn" };

  // ---------- motion ----------
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let animate = !reduceMotion;
  let freshChart = false; // a chart's first draw renders in place; later updates animate
  const tr = (sel) => sel.transition().duration(animate && !freshChart ? 450 : 0).ease(d3.easeCubicOut);

  // ---------- formatting ----------
  const color = (c) => `var(--c-${c})`;
  const isNum = (v) => v != null && !isNaN(v);
  const fmt1 = (v) => (isNum(v) ? (Math.round(v * 10) / 10).toLocaleString() : "—");
  const fmtPct = (v) => (isNum(v) ? `${Math.round(v)}%` : "—");
  const pct = (a, b) => (b ? (100 * a) / b : null);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  // ---------- aggregate helpers ----------
  const total = (cells) => d3.sum(cells, (c) => c.n);
  /** Merge one histogram across cells → Map(value → count). */
  function hist(cells, key) {
    const m = new Map();
    for (const c of cells) for (const [v, n] of c.hist[key] || []) m.set(v, (m.get(v) || 0) + n);
    return m;
  }
  /** n / mean / median / min / max from a numeric histogram. */
  function histStats(m) {
    const e = [...m].sort((a, b) => a[0] - b[0]);
    const n = d3.sum(e, (d) => d[1]);
    if (!n) return { n: 0, mean: null, median: null, min: null, max: null };
    const at = (i) => { let acc = 0; for (const [v, c] of e) if (i < (acc += c)) return v; };
    return {
      n,
      mean: d3.sum(e, ([v, c]) => v * c) / n,
      median: n % 2 ? at((n - 1) / 2) : (at(n / 2 - 1) + at(n / 2)) / 2,
      min: e[0][0], max: e[e.length - 1][0],
    };
  }
  const statsFor = (cells, key) => histStats(hist(cells, key));
  /** Merge (Spanish, English) answer pairs → Map("es|en" → {x, y, n}). */
  function pairs(cells, key) {
    const m = new Map();
    for (const c of cells) for (const [x, y, n] of c.pairs[key] || []) {
      const k = `${x}|${y}`;
      if (!m.has(k)) m.set(k, { x, y, n: 0 });
      m.get(k).n += n;
    }
    return m;
  }

  // ---------- filtering ----------
  const activeCorpora = () => (state.corpus === "both" ? CORPORA : [state.corpus]);
  function filtered() {
    return CELLS.filter((c) =>
      (state.corpus === "both" || c.corpus === state.corpus) &&
      (state.sex === "all" || c.sex === state.sex) &&
      (state.gen === "all" || String(c.gen) === state.gen) &&
      (state.age === "all" || c.ageBand === state.age));
  }
  const byCorpus = (cells) => Object.fromEntries(activeCorpora().map((k) => [k, cells.filter((c) => c.corpus === k)]));

  // ---------- bar paths: 4px rounded data-end, square at the baseline ----------
  // Always emit the same command structure so D3 can interpolate between states.
  function colPath(x, y, w, h, r = 4) {
    w = Math.max(0, w); h = Math.max(0, h); r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  function barPath(x, y, w, h, r = 4) {
    w = Math.max(0, w); h = Math.max(0, h); r = Math.min(r, h / 2, w);
    return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  }

  // ---------- tooltip ----------
  const tip = d3.select("#tooltip");
  function showTip(evt, html) {
    tip.html(html).property("hidden", false);
    const pad = 14, r = tip.node().getBoundingClientRect();
    let x = evt.clientX + pad, y = evt.clientY + pad;
    if (x + r.width > window.innerWidth - 8) x = evt.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = evt.clientY - r.height - pad;
    tip.style("left", `${Math.max(8, x)}px`).style("top", `${Math.max(8, y)}px`);
  }
  const hideTip = () => tip.property("hidden", true);
  const ttTitle = (s) => `<div class="tt-title">${esc(s)}</div>`;
  const ttRow = (c, label, value) =>
    `<div class="tt-row">${c ? `<span class="swatch" style="background:${color(c)}"></span>` : ""}${esc(label)}<b>${esc(value)}</b></div>`;

  /** Hover + keyboard-focus tooltip on a selection; htmlFn receives the datum. */
  function hoverable(sel, htmlFn) {
    sel.attr("tabindex", 0)
      .on("mousemove", (e, d) => showTip(e, htmlFn(d)))
      .on("mouseleave blur", hideTip)
      .on("focus", function (e, d) {
        const b = this.getBoundingClientRect();
        showTip({ clientX: b.right, clientY: b.top }, htmlFn(d));
      });
  }

  // ---------- card scaffolding (built once, updated in place) ----------
  function card(name, { title, desc, legend = "corpora", setupTools }) {
    const root = d3.select(`[data-chart="${name}"]`);
    if (root.select(".card-head").empty()) {
      const head = root.append("div").attr("class", "card-head");
      const txt = head.append("div");
      txt.append("h3").attr("class", "card-title");
      txt.append("p").attr("class", "card-desc");
      const tools = head.append("div").attr("class", "card-tools");
      if (setupTools) tools.call(setupTools);
      tools.append("button").attr("class", "btn").attr("type", "button").attr("data-toggle-table", "")
        .on("click", () => { state.tableView[name] = !state.tableView[name]; renderers[name](); });
      root.append("div").attr("class", "legend");
      root.append("div").attr("class", "chart");
      root.append("div").attr("class", "note");
    }
    const isTable = !!state.tableView[name];
    root.select(".card-title").text(title);
    root.select(".card-desc").text(desc || "").style("display", desc ? null : "none");
    root.select("[data-toggle-table]").text(isTable ? "Show chart" : "Show table");

    const items = legend === "corpora"
      ? (activeCorpora().length > 1 ? activeCorpora().map((c) => ({ id: c, corpus: c, label: c })) : [])
      : legend;
    renderLegend(root.select(".legend"), items);

    const body = root.select(".chart");
    const noteSel = root.select(".note");
    const note = (msg) => noteSel.text(msg || "").style("display", msg ? null : "none");
    note("");
    return { root, body, isTable, note, width: Math.max(280, body.node().clientWidth) };
  }

  function renderLegend(sel, items) {
    sel.style("display", items.length ? null : "none")
      .selectAll(".legend-item")
      .data(items, (d) => d.id)
      .join((enter) => {
        const s = enter.append("span").attr("class", "legend-item");
        s.append("span").attr("class", "legend-mark");
        s.append("span").attr("class", "legend-text");
        return s;
      })
      .order()
      .call((s) => s.select(".legend-mark")
        .attr("class", (d) => `legend-mark ${d.kind === "line" ? "legend-line" : d.kind === "size" ? "legend-size" : "legend-dot"}`)
        .style("background", (d) => (d.corpus ? color(d.corpus) : null)))
      .call((s) => s.select(".legend-text").text((d) => d.label));
  }

  function renderTable(c, columns, rows) {
    hideTip();
    c.body.selectAll("*").remove();
    const t = c.body.append("div").attr("class", "data-table-wrap").append("table").attr("class", "data-table");
    t.append("thead").append("tr").selectAll("th").data(columns).join("th")
      .attr("class", (d) => (d.num ? "num" : null)).text((d) => d.label);
    t.append("tbody").selectAll("tr").data(rows).join("tr")
      .selectAll("td").data((r) => r.map((v, i) => ({ v, num: columns[i].num }))).join("td")
      .attr("class", (d) => (d.num ? "num" : null)).text((d) => d.v ?? "—");
  }
  function renderEmpty(c) {
    hideTip();
    c.body.selectAll("*").remove();
    c.body.append("div").attr("class", "empty").text("No participants match the current filters.");
  }

  /** Get (or create) the card's SVG with a fixed set of named layers. */
  function plot(c, H, m, layers) {
    c.body.selectAll(".data-table-wrap, .empty").remove();
    let svg = c.body.select("svg");
    freshChart = svg.empty();
    if (freshChart) {
      svg = c.body.append("svg").attr("role", "img").attr("height", H).attr("viewBox", `0 0 ${c.width} ${H}`);
      const g = svg.append("g").attr("class", "plot");
      layers.forEach((l) => g.append("g").attr("class", `layer ${l}`));
    }
    tr(svg).attr("height", H).attr("viewBox", `0 0 ${c.width} ${H}`);
    const g = svg.select("g.plot").attr("transform", `translate(${m.l},${m.t})`);
    return { svg, g, L: (name) => g.select(`g.layer.${name}`) };
  }

  // ---------- axes (d3-axis, restyled as recessive gridlines) ----------
  function drawAxis(sel, axis, transform) {
    sel.classed("axis", true);
    const t = tr(sel); // one transition, so position and ticks animate together
    if (transform) t.attr("transform", transform);
    t.call(axis);
    sel.selectAll(".tick line").attr("class", (d) => (d === 0 ? "baseline" : "gridline"));
  }
  const gridAxisLeft = (y, width, fmt, count) => d3.axisLeft(y).ticks(count).tickSize(-width).tickPadding(8).tickFormat(fmt);
  const gridAxisBottom = (x, height, fmt, count) => d3.axisBottom(x).ticks(count).tickSize(-height).tickPadding(6).tickFormat(fmt);

  // ---------- chart: grouped columns ----------
  // cats: [label]; series: [{corpus, values:[number], tip(i)}]
  function groupedColumns(c, { cats, series, valueFmt, tipTitle, ariaLabel }) {
    const H = 230, m = { t: 10, r: 6, b: 32, l: 38 };
    const iw = c.width - m.l - m.r, ih = H - m.t - m.b;
    const { svg, L } = plot(c, H, m, ["yaxis", "xaxis", "hit", "marks"]);
    svg.attr("aria-label", ariaLabel);

    const y = d3.scaleLinear().domain([0, d3.max(series, (s) => d3.max(s.values)) || 1]).nice(4).range([ih, 0]);
    const x = d3.scaleBand().domain(cats).range([0, iw]);
    drawAxis(L("yaxis"), gridAxisLeft(y, iw, valueFmt, 4));
    drawAxis(L("xaxis"), d3.axisBottom(x).tickSize(0).tickPadding(10), `translate(0,${ih})`);

    const n = series.length;
    const groupW = Math.min(x.bandwidth() * 0.72, 30 * n + 2 * (n - 1));
    const bw = (groupW - 2 * (n - 1)) / n;
    const bars = cats.flatMap((cat, i) => series.map((s, j) => ({
      key: `${cat}|${s.corpus}`, corpus: s.corpus, v: s.values[i], bw,
      x: x(cat) + (x.bandwidth() - groupW) / 2 + j * (bw + 2),
    })));

    L("marks").selectAll("path").data(bars, (d) => d.key).join(
      (enter) => enter.append("path").attr("pointer-events", "none").attr("d", (d) => colPath(d.x, ih, d.bw, 0)),
      (update) => update,
      (exit) => tr(exit).attr("d", (d) => colPath(d.x, ih, d.bw, 0)).remove(),
    )
      .style("fill", (d) => color(d.corpus))
      .call((s) => tr(s).attr("d", (d) => colPath(d.x, y(d.v), d.bw, ih - y(d.v))));

    L("hit").selectAll("rect").data(cats, (d) => d).join("rect")
      .attr("class", "hit").attr("rx", 4)
      .attr("x", (d) => x(d)).attr("y", 0).attr("width", x.bandwidth()).attr("height", ih)
      .call(hoverable, (cat) => ttTitle(tipTitle(cat)) +
        series.map((s) => ttRow(s.corpus, s.corpus, s.tip(cats.indexOf(cat)))).join(""));
  }

  // ---------- chart: grouped horizontal bars ----------
  function groupedBars(c, { cats, series, valueFmt, tipTitle, labelW = 170, maxOverride, showValues = false, ariaLabel }) {
    const rowGap = 12, bh = 12, n = series.length;
    const inner = n * bh + (n - 1) * 2, rowH = inner + rowGap;
    const m = { t: 6, r: 44, b: 24, l: labelW };
    const ih = cats.length * rowH, H = m.t + m.b + ih, iw = c.width - m.l - m.r;
    const { svg, L } = plot(c, H, m, ["xaxis", "hit", "labels", "marks", "values"]);
    svg.attr("aria-label", ariaLabel);

    const x = d3.scaleLinear().domain([0, maxOverride || d3.max(series, (s) => d3.max(s.values)) || 1]).range([0, iw]);
    if (!maxOverride) x.nice(4);
    drawAxis(L("xaxis"), gridAxisBottom(x, ih, valueFmt, 4), `translate(0,${ih})`);

    const rowY = (i) => i * rowH;
    const bars = cats.flatMap((cat, i) => series.map((s, j) => ({
      key: `${cat}|${s.corpus}`, corpus: s.corpus, v: s.values[i], y: rowY(i) + rowGap / 2 + j * (bh + 2),
    })));

    L("marks").selectAll("path").data(bars, (d) => d.key).join(
      (enter) => enter.append("path").attr("pointer-events", "none").attr("d", (d) => barPath(0, d.y, 0, bh)),
      (update) => update,
      (exit) => tr(exit).attr("d", (d) => barPath(0, d.y, 0, bh)).remove(),
    )
      .style("fill", (d) => color(d.corpus))
      .call((s) => tr(s).attr("d", (d) => barPath(0, d.y, x(d.v), bh)));

    L("values").selectAll("text").data(showValues ? bars : [], (d) => d.key).join(
      (enter) => enter.append("text").attr("class", "axis-label").attr("pointer-events", "none")
        .attr("x", 5).attr("y", (d) => d.y + bh - 2).style("opacity", 0),
      (update) => update,
      (exit) => exit.remove(),
    )
      .text((d) => valueFmt(d.v))
      .call((s) => tr(s).attr("x", (d) => x(d.v) + 5).attr("y", (d) => d.y + bh - 2).style("opacity", 1));

    L("labels").selectAll("text").data(cats, (d) => d).join("text")
      .attr("class", "row-label").attr("text-anchor", "end").attr("pointer-events", "none")
      .attr("x", -10).text((d) => d)
      .call((s) => tr(s).attr("y", (d, i) => rowY(i) + rowGap / 2 + inner / 2 + 4));

    L("hit").selectAll("rect").data(cats, (d) => d).join("rect")
      .attr("class", "hit").attr("rx", 4)
      .attr("x", -labelW).attr("width", iw + labelW + m.r).attr("y", (d, i) => rowY(i)).attr("height", rowH)
      .call(hoverable, (cat) => ttTitle(tipTitle(cat)) +
        series.map((s) => ttRow(s.corpus, s.corpus, s.tip(cats.indexOf(cat)))).join(""));
  }

  // ---------- chart: dot plot (means per item, grouped rows) ----------
  // groups: [{label, rows:[{label, key}]}]
  function dotStats(groups, cellsByCorpus) {
    return groups.map((g) => ({
      ...g,
      rows: g.rows.map((r) => ({
        ...r, group: g.label,
        stats: Object.entries(cellsByCorpus).map(([corpus, cells]) => ({ corpus, ...statsFor(cells, r.key) })),
      })),
    }));
  }
  function dotPlot(c, { groups, cellsByCorpus, domain, valueFmt, tickFmt, labelW = 190, ariaLabel }) {
    const rowH = 26, groupGap = 14, headH = 18;
    const m = { t: 6, r: 16, b: 26, l: labelW };
    const heads = [], rows = [];
    let yy = 0;
    dotStats(groups, cellsByCorpus).forEach((grp, gi) => {
      if (gi) yy += groupGap;
      heads.push({ label: grp.label, y: yy });
      yy += headH;
      grp.rows.forEach((r) => { rows.push({ ...r, y: yy }); yy += rowH; });
    });
    const ih = yy, H = m.t + m.b + ih, iw = c.width - m.l - m.r;
    const { svg, L } = plot(c, H, m, ["xaxis", "heads", "rows"]);
    svg.attr("aria-label", ariaLabel);

    const x = d3.scaleLinear().domain(domain).range([0, iw]);
    drawAxis(L("xaxis"), d3.axisBottom(x).tickValues(domain[1] === 100 ? [0, 25, 50, 75, 100] : d3.range(domain[0], domain[1] + 1))
      .tickSize(-ih).tickPadding(6).tickFormat(tickFmt), `translate(0,${ih})`);

    L("heads").selectAll("text").data(heads, (d) => d.label).join("text")
      .attr("class", "row-group").attr("x", -labelW).text((d) => d.label)
      .call((s) => tr(s).attr("y", (d) => d.y + 13));

    const cy = rowH / 2;
    const rowSel = L("rows").selectAll("g.row").data(rows, (d) => d.key).join((enter) => {
      const g = enter.append("g").attr("class", "row").attr("transform", (d) => `translate(0,${d.y})`);
      g.append("rect").attr("class", "hit").attr("rx", 4);
      g.append("text").attr("class", "row-label").attr("text-anchor", "end").attr("pointer-events", "none");
      g.append("line").attr("class", "baseline").attr("pointer-events", "none");
      g.append("line").attr("class", "connector").attr("pointer-events", "none");
      return g;
    });
    tr(rowSel).attr("transform", (d) => `translate(0,${d.y})`);

    rowSel.select("rect.hit")
      .attr("x", -labelW).attr("y", 0).attr("width", iw + labelW + m.r).attr("height", rowH)
      .call(hoverable, (d) => ttTitle(`${d.group} — ${d.label}`) +
        d.stats.map((s) => ttRow(s.corpus, `${s.corpus} mean (n=${s.n})`, valueFmt(s.mean))).join("") +
        d.stats.map((s) => ttRow(null, `${s.corpus} median`, valueFmt(s.median))).join(""));
    rowSel.select("text.row-label").attr("x", -10).attr("y", cy + 4).text((d) => d.label);
    rowSel.select("line.baseline").attr("y1", cy).attr("y2", cy).attr("x1", 0)
      .call((s) => tr(s).attr("x2", iw));

    const valid = (d) => d.stats.filter((s) => s.mean != null);
    const conn = rowSel.select("line.connector").attr("y1", cy).attr("y2", cy);
    conn.filter(function () { return !this.hasAttribute("x1"); })
      .attr("x1", (d) => x(valid(d)[0]?.mean ?? 0)).attr("x2", (d) => x(valid(d)[0]?.mean ?? 0));
    tr(conn)
      .style("opacity", (d) => (valid(d).length === 2 ? 1 : 0))
      .attr("x1", (d) => x(valid(d)[0]?.mean ?? 0))
      .attr("x2", (d) => x(valid(d)[valid(d).length - 1]?.mean ?? 0));

    rowSel.selectAll("circle.dot").data(valid, (s) => s.corpus).join(
      (enter) => enter.append("circle").attr("class", "dot").attr("pointer-events", "none")
        .attr("cy", cy).attr("r", 0).attr("cx", (s) => x(s.mean)),
      (update) => update,
      (exit) => tr(exit).attr("r", 0).remove(),
    )
      .style("fill", (s) => color(s.corpus))
      .call((s) => tr(s).attr("cx", (s) => x(s.mean)).attr("r", 6));
  }
  function dotTable(c, groups, cellsByCorpus, valueFmt) {
    const cs = Object.keys(cellsByCorpus);
    const columns = [{ label: "Section" }, { label: "Item" },
      ...cs.flatMap((k) => [{ label: `${k} mean`, num: true }, { label: `${k} median`, num: true }, { label: `${k} n`, num: true }])];
    const rows = dotStats(groups, cellsByCorpus).flatMap((g) => g.rows.map((r) =>
      [g.label, r.label, ...r.stats.flatMap((s) => [valueFmt(s.mean), valueFmt(s.median), s.n])]));
    renderTable(c, columns, rows);
  }

  // ---------- chart: Spanish vs. English bubble scatter ----------
  // points: [{x, y, corpus, n}] — n participants gave this exact answer pair.
  function bubbleScatter(c, { points, xLabel, yLabel }) {
    const W = c.width, H = Math.min(380, Math.max(280, W * 0.4)), m = { t: 10, r: 16, b: 42, l: 50 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const { svg, g, L } = plot(c, H, m, ["yaxis", "xaxis", "ref", "titles", "dots", "overlay"]);
    svg.attr("aria-label", `${yLabel} vs ${xLabel}`);

    const max = Math.max(1, d3.max(points, (p) => Math.max(p.x, p.y)) || 0);
    const x = d3.scaleLinear().domain([0, max]).nice(5).range([0, iw]);
    const y = d3.scaleLinear().domain(x.domain()).range([ih, 0]);
    const r = d3.scaleSqrt().domain([1, Math.max(2, d3.max(points, (p) => p.n))]).range([5, 14]);
    const dmax = x.domain()[1];

    drawAxis(L("yaxis"), gridAxisLeft(y, iw, null, 5));
    drawAxis(L("xaxis"), gridAxisBottom(x, ih, null, 5), `translate(0,${ih})`);

    const ref = L("ref");
    if (ref.select("line").empty()) {
      ref.append("line").attr("class", "ref-line");
      ref.append("text").attr("class", "axis-label").attr("text-anchor", "end").text("equal");
    }
    tr(ref.select("line")).attr("x1", x(0)).attr("y1", y(0)).attr("x2", x(dmax)).attr("y2", y(dmax));
    tr(ref.select("text")).attr("x", x(dmax) - 4).attr("y", y(dmax) + 14);

    L("titles").selectAll("text").data([
      { id: "x", text: xLabel, x: iw / 2, y: ih + 36, rot: 0 },
      { id: "y", text: yLabel, x: -38, y: ih / 2, rot: -90 },
    ], (d) => d.id).join("text")
      .attr("class", "axis-label").attr("text-anchor", "middle")
      .attr("x", (d) => d.x).attr("y", (d) => d.y)
      .attr("transform", (d) => (d.rot ? `rotate(${d.rot} ${d.x} ${d.y})` : null))
      .text((d) => d.text);

    // When both corpora share an answer pair, nudge them apart so each stays visible.
    const at = d3.group(points, (p) => `${p.x}|${p.y}`);
    const placed = points.map((p) => {
      const both = at.get(`${p.x}|${p.y}`).length > 1;
      const dx = both ? (p.corpus === CORPORA[0] ? -3 : 3) : 0;
      return { ...p, key: `${p.corpus}|${p.x}|${p.y}`, px: x(p.x) + dx, py: y(p.y) };
    }).sort((a, b) => b.n - a.n); // big bubbles underneath

    const dots = L("dots").selectAll("circle").data(placed, (d) => d.key).join(
      (enter) => enter.append("circle").attr("class", "scatter-dot")
        .attr("cx", (d) => d.px).attr("cy", (d) => d.py).attr("r", 0),
      (update) => update,
      (exit) => tr(exit).attr("r", 0).remove(),
    )
      .style("fill", (d) => color(d.corpus))
      .order()
      .call((s) => tr(s).attr("cx", (d) => d.px).attr("cy", (d) => d.py).attr("r", (d) => r(d.n)));

    // Nearest-point hover via Delaunay; tooltip lists every corpus at that answer pair.
    const delaunay = d3.Delaunay.from(placed, (d) => d.px, (d) => d.py);
    let overlay = L("overlay").select("rect");
    if (overlay.empty()) overlay = L("overlay").append("rect").attr("fill", "transparent");
    overlay.attr("width", iw).attr("height", ih)
      .on("mousemove", (e) => {
        const [sx, sy] = d3.pointer(e, g.node());
        const i = placed.length ? delaunay.find(sx, sy) : -1;
        const hit = i >= 0 && Math.hypot(placed[i].px - sx, placed[i].py - sy) < 24 ? placed[i] : null;
        dots.classed("active", (d) => !!hit && d.x === hit.x && d.y === hit.y);
        if (!hit) return hideTip();
        const here = at.get(`${hit.x}|${hit.y}`);
        showTip(e, ttTitle(`Spanish ${hit.x} · English ${hit.y}`) +
          here.map((p) => ttRow(p.corpus, p.corpus, `${p.n} participant${p.n === 1 ? "" : "s"}`)).join(""));
      })
      .on("mouseleave", () => { dots.classed("active", false); hideTip(); });
  }

  // ---------- KPIs ----------
  function renderKpis(cells) {
    const bc = byCorpus(cells);
    const years = (cs) => { const s = statsFor(cs, "interviewYear"); return s.n ? `${s.min}–${String(s.max).slice(2)}` : "—"; };
    const female = (cs) => fmtPct(pct(total(cs.filter((c) => c.sex === "Female")), total(cs)));
    const bornUS = (cs) => { const h = hist(cs, "birthCountry"); return fmtPct(pct(h.get("USA") || 0, d3.sum(h.values()))); };
    const tiles = [
      ["Participants", (cs) => total(cs)],
      ["Female", female],
      ["Median age", (cs) => fmt1(statsFor(cs, "age").median)],
      ["Born in the US", bornUS],
      ["Interview years", years],
    ].map(([label, fn]) => ({ label, values: Object.entries(bc).map(([corpus, cs]) => ({ corpus, value: fn(cs) })) }));

    const tile = d3.select("#kpis").selectAll(".kpi").data(tiles, (d) => d.label).join((enter) => {
      const t = enter.append("div").attr("class", "kpi");
      t.append("div").attr("class", "kpi-label");
      t.append("div").attr("class", "kpi-values");
      return t;
    });
    tile.select(".kpi-label").text((d) => d.label);
    tile.select(".kpi-values").selectAll(".kpi-item").data((d) => d.values, (v) => v.corpus).join((enter) => {
      const v = enter.append("div").attr("class", "kpi-item");
      v.append("div").attr("class", "kpi-value");
      const cc = v.append("div").attr("class", "kpi-corpus");
      cc.append("span").attr("class", "swatch").style("background", (d) => color(d.corpus));
      cc.append("span").text((d) => d.corpus);
      return v;
    })
      .order()
      .select(".kpi-value").text((d) => d.value);
  }

  // ---------- categorical distribution helper ----------
  // countsFn(cells) → [count per category] (for one corpus)
  function distribution(cells, cats, countsFn) {
    return Object.entries(byCorpus(cells)).map(([corpus, cs]) => {
      const counts = countsFn(cs);
      const tot = d3.sum(counts);
      const values = counts.map((n) => (state.scale === "pct" ? pct(n, tot) || 0 : n));
      const tip = (i) => `${counts[i]} of ${tot} (${fmtPct(pct(counts[i], tot))})`;
      return { corpus, counts, total: tot, values, tip };
    });
  }
  const scaleFmt = (v) => (state.scale === "pct" ? fmtPct(v) : fmt1(v));
  function distTable(c, cats, series, catLabel) {
    renderTable(c, [{ label: catLabel }, ...series.flatMap((s) => [{ label: `${s.corpus} n`, num: true }, { label: `${s.corpus} %`, num: true }])],
      cats.map((cat, i) => [cat, ...series.flatMap((s) => [s.counts[i], fmtPct(pct(s.counts[i], s.total))])]));
  }

  // ---------- renderers ----------
  const AGE_BINS = [[15, 19], [20, 24], [25, 29], [30, 39], [40, 49], [50, 59], [60, 120]];
  const ageLabel = ([a, b]) => (b > 100 ? `${a}+` : `${a}–${b}`);

  const renderers = {
    age() {
      const cells = filtered();
      const c = card("age", { title: "Age at interview", desc: "Participants per age band" });
      const cats = AGE_BINS.map(ageLabel);
      const series = distribution(cells, cats, (cs) => {
        const h = hist(cs, "age");
        return AGE_BINS.map(([a, z]) => d3.sum([...h].filter(([v]) => v >= a && v <= z), (d) => d[1]));
      });
      if (!total(cells)) return renderEmpty(c);
      if (c.isTable) return distTable(c, cats, series, "Age band");
      groupedColumns(c, { cats, series, valueFmt: scaleFmt, tipTitle: (cat) => `Age ${cat}`, ariaLabel: "Age at interview by corpus" });
      const missing = total(cells) - d3.sum(series, (s) => s.total);
      c.note(missing ? `${missing} participant(s) with no age recorded are not shown.` : "");
    },

    generation() {
      const cells = filtered();
      const c = card("generation", { title: "Generation", desc: "1 = born outside the US · 2 = US-born child of immigrants · 3 = US-born, parents US-born" });
      const cats = ["1st", "2nd", "3rd"];
      const series = distribution(cells, cats, (cs) => [1, 2, 3].map((gen) => total(cs.filter((x) => x.gen === gen))));
      if (!total(cells)) return renderEmpty(c);
      if (c.isTable) return distTable(c, cats, series, "Generation");
      const labels = cats.map((s) => `${s} generation`);
      groupedColumns(c, { cats: labels, series, valueFmt: scaleFmt, tipTitle: (cat) => cat, ariaLabel: "Generation by corpus" });
    },

    education() {
      const cells = filtered();
      const c = card("education", { title: "Education level", desc: "Free-text answers grouped into six levels" });
      const cats = META.educationOrder;
      const series = distribution(cells, cats, (cs) => { const h = hist(cs, "education"); return cats.map((k) => h.get(k) || 0); });
      if (!total(cells)) return renderEmpty(c);
      if (c.isTable) return distTable(c, cats, series, "Education");
      groupedBars(c, { cats, series, valueFmt: scaleFmt, tipTitle: (cat) => cat, labelW: 160, ariaLabel: "Education level by corpus" });
    },

    birthplace() {
      const cells = filtered();
      const c = card("birthplace", { title: "Born in Mexico", desc: "Share of participants, mothers and fathers born in Mexico (of those with a known birthplace)" });
      const who = [["Participant", "birthCountry"], ["Mother", "motherCountry"], ["Father", "fatherCountry"]];
      const bc = byCorpus(cells);
      const series = Object.entries(bc).map(([corpus, cs]) => {
        const info = who.map(([, key]) => {
          const h = hist(cs, key);
          return { known: d3.sum(h.values()), mx: h.get("Mexico") || 0, counts: h };
        });
        return {
          corpus, info,
          values: info.map((d) => pct(d.mx, d.known) || 0),
          tip: (i) => `${info[i].mx} of ${info[i].known} (${fmtPct(pct(info[i].mx, info[i].known))})`,
        };
      });
      if (!total(cells)) return renderEmpty(c);
      if (c.isTable) {
        const countries = [...new Set(series.flatMap((s) => s.info.flatMap((d) => [...d.counts.keys()])))].sort();
        return renderTable(c,
          [{ label: "Corpus" }, { label: "Person" }, ...countries.map((k) => ({ label: k, num: true })), { label: "Unknown", num: true }],
          series.flatMap((s) => who.map(([label], i) =>
            [s.corpus, label, ...countries.map((k) => s.info[i].counts.get(k) || 0), total(bc[s.corpus]) - s.info[i].known])));
      }
      groupedBars(c, {
        cats: who.map((w) => w[0]), series, valueFmt: fmtPct, tipTitle: (cat) => `${cat} born in Mexico`,
        labelW: 90, maxOverride: 100, showValues: true, ariaLabel: "Share born in Mexico by corpus",
      });
    },

    history() {
      const cells = filtered();
      const opts = [
        ["LH_ageLearn", "Age when they learned the language", "Age (years)"],
        ["LH_comfortSpeaking", "Age when they felt comfortable speaking it", "Age (years)"],
        ["LH_yearsCountry", "Years lived where the language is spoken", "Years"],
        ["LH_yearsFamily", "Years speaking the language with family", "Years"],
        ["LH_yearsWork", "Years working in the language", "Years"],
      ];
      const cur = opts.find((o) => o[0] === chartState.history) || opts[0];
      const bc = byCorpus(cells);
      const legend = [
        ...Object.entries(bc).map(([corp, cs]) => ({
          id: corp, corpus: corp,
          label: `${corp}: Spanish mean ${fmt1(statsFor(cs, `${cur[0]}_es`).mean)}, English mean ${fmt1(statsFor(cs, `${cur[0]}_en`).mean)}`,
        })),
        { id: "size", kind: "size", label: "Larger circle = more participants with that answer" },
        { id: "equal", kind: "line", label: "Equal for both languages" },
      ];
      const c = card("history", {
        title: "Spanish vs. English linguistic history",
        desc: "Each circle is one combination of answers. Above the diagonal = more for English; below = more for Spanish.",
        legend,
        setupTools: (tools) => tools.append("select").attr("data-history", "").attr("aria-label", "Linguistic history measure")
          .on("change", (e) => { chartState.history = e.target.value; renderers.history(); })
          .selectAll("option").data(opts).join("option").attr("value", (d) => d[0]).text((d) => d[1]),
      });
      c.root.select("[data-history]").property("value", cur[0]);

      const points = Object.entries(bc).flatMap(([corpus, cs]) =>
        [...pairs(cs, cur[0]).values()].map((p) => ({ ...p, corpus })));
      const shown = d3.sum(points, (p) => p.n);
      if (!shown) return renderEmpty(c);
      if (c.isTable) {
        const cs = Object.keys(bc);
        const byXY = d3.rollup(points, (v) => Object.fromEntries(v.map((p) => [p.corpus, p.n])), (p) => p.x, (p) => p.y);
        const rows = [];
        for (const [xv, ys] of [...byXY].sort((a, b) => a[0] - b[0]))
          for (const [yv, n] of [...ys].sort((a, b) => a[0] - b[0])) rows.push([xv, yv, ...cs.map((k) => n[k] || 0)]);
        return renderTable(c, [{ label: "Spanish", num: true }, { label: "English", num: true }, ...cs.map((k) => ({ label: `${k} participants`, num: true }))], rows);
      }
      bubbleScatter(c, { points, xLabel: `Spanish — ${cur[2].toLowerCase()}`, yLabel: `English — ${cur[2].toLowerCase()}` });
      const dropped = total(cells) - shown;
      c.note(dropped ? `${dropped} participant(s) without numeric answers for both languages are not shown.` : "");
    },

    use() {
      const cells = filtered();
      const c = card("use", { title: "Weekly language use by domain", desc: "Mean percent of time each language is used (participants' own estimates; may not sum to 100)" });
      const domains = [["friends", "With friends"], ["family", "With family"], ["schoolWork", "At school / work"], ["think", "Talking to oneself"], ["math", "Doing math in one's head"]];
      const groups = [
        { label: "Spanish", rows: domains.map(([k, l]) => ({ label: l, key: `LU_${k}_es` })) },
        { label: "English", rows: domains.map(([k, l]) => ({ label: l, key: `LU_${k}_en` })) },
      ];
      if (!total(cells)) return renderEmpty(c);
      if (c.isTable) return dotTable(c, groups, byCorpus(cells), fmtPct);
      dotPlot(c, { groups, cellsByCorpus: byCorpus(cells), domain: [0, 100], valueFmt: fmtPct, tickFmt: (t) => `${t}%`, labelW: 200, ariaLabel: "Weekly language use by domain" });
    },

    competency() {
      const cells = filtered();
      const c = card("competency", { title: "Self-rated competency", desc: "Mean rating, 0 (not at all) – 6 (very well)" });
      const skills = [["speak", "Speak"], ["understand", "Understand"], ["read", "Read"], ["write", "Write"]];
      const groups = [
        { label: "Spanish", rows: skills.map(([k, l]) => ({ label: l, key: `C_${k}_es` })) },
        { label: "English", rows: skills.map(([k, l]) => ({ label: l, key: `C_${k}_en` })) },
      ];
      if (!total(cells)) return renderEmpty(c);
      if (c.isTable) return dotTable(c, groups, byCorpus(cells), fmt1);
      dotPlot(c, { groups, cellsByCorpus: byCorpus(cells), domain: [0, 6], valueFmt: fmt1, tickFmt: String, labelW: 110, ariaLabel: "Self-rated competency" });
    },

    attitudes() {
      const cells = filtered();
      const c = card("attitudes", { title: "Language attitudes", desc: "Mean agreement, 0 (disagree) – 6 (agree)" });
      const items = [["feelMyself", "I feel like myself"], ["identify", "Identify with the culture"], ["nativeSpeaker", "Important to sound native"], ["perceivedNative", "Want to be seen as native"]];
      const groups = [
        { label: "Spanish", rows: items.map(([k, l]) => ({ label: l, key: `A_${k}_es` })) },
        { label: "English", rows: items.map(([k, l]) => ({ label: l, key: `A_${k}_en` })) },
      ];
      if (!total(cells)) return renderEmpty(c);
      if (c.isTable) return dotTable(c, groups, byCorpus(cells), fmt1);
      dotPlot(c, { groups, cellsByCorpus: byCorpus(cells), domain: [0, 6], valueFmt: fmt1, tickFmt: String, labelW: 170, ariaLabel: "Language attitudes" });
    },
  };

  // ---------- wiring ----------
  function renderAll() {
    const cells = filtered();
    d3.select("#f-summary").text(`Showing ${total(cells)} of ${META.total || total(CELLS)} participants`);
    renderKpis(cells);
    Object.values(renderers).forEach((r) => r());
  }
  const FILTERS = [["#f-corpus", "corpus"], ["#f-sex", "sex"], ["#f-gen", "gen"], ["#f-age", "age"], ["#f-scale", "scale"]];
  FILTERS.forEach(([sel, key]) => d3.select(sel).on("change", (e) => { state[key] = e.target.value; renderAll(); }));
  d3.select("#f-reset").on("click", () => {
    Object.assign(state, { corpus: "both", sex: "all", gen: "all", age: "all", scale: "pct" });
    FILTERS.forEach(([sel]) => d3.select(sel).property("selectedIndex", 0));
    renderAll();
  });

  const root = document.documentElement;
  const themeBtn = d3.select("#theme-toggle");
  const isDark = () => root.dataset.theme === "dark" ||
    (!root.dataset.theme && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const syncThemeBtn = () => themeBtn.text(isDark() ? "Light mode" : "Dark mode");
  themeBtn.on("click", () => { root.dataset.theme = isDark() ? "light" : "dark"; syncThemeBtn(); });
  syncThemeBtn();

  let resizeTimer, lastWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      animate = false;            // snap to the new width instead of animating
      renderAll();
      animate = !reduceMotion;
    }, 120);
  });

  renderAll();
})();
