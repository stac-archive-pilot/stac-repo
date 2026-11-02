/* Minimal SVG charts with hover tooltips (no library).
 * Horizontal bars for magnitudes by category, a line chart for time series.
 * Colors come from CSS custom properties so both themes work. */
(function () {
  "use strict";
  const STAC = (window.STAC = window.STAC || {});
  const { esc } = STAC;
  const NS = "http://www.w3.org/2000/svg";

  function tooltip(container) {
    let tip = container.querySelector(".tooltip");
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "tooltip";
      tip.hidden = true;
      container.appendChild(tip);
    }
    return {
      show(html, evt) {
        tip.innerHTML = html;
        tip.hidden = false;
        const box = container.getBoundingClientRect();
        let x = evt.clientX - box.left + 12;
        const y = evt.clientY - box.top - 10;
        if (x + tip.offsetWidth > box.width) x = evt.clientX - box.left - tip.offsetWidth - 12;
        tip.style.left = `${Math.max(0, x)}px`;
        tip.style.top = `${Math.max(0, y - tip.offsetHeight)}px`;
      },
      hide() { tip.hidden = true; }
    };
  }

  /** Bar path with 4px rounded data end, square at the baseline. */
  function barPath(x, y, w, h, r = 4) {
    if (w <= 0) return "";
    r = Math.min(r, w, h / 2);
    return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }

  /**
   * Horizontal bar chart.
   * data: [{label, value, color, detail}]  opts: {fmt, labelWidth, barH}
   */
  STAC.hbar = function (container, data, opts = {}) {
    const fmt = opts.fmt || STAC.fmt;
    const labelW = opts.labelWidth || 120;
    const valueW = 64;
    const barH = opts.barH || 18;
    const gap = 8;
    const W = Math.max(320, Math.round(container.clientWidth || 560));
    const plotW = W - labelW - valueW;
    const H = data.length * (barH + gap) + 22;
    const max = niceMax(Math.max(...data.map((d) => d.value), 0));
    const x = (v) => labelW + (v / max) * plotW;

    const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.title || "Bar chart")}">`;
    ticks.forEach((t) => {
      svg += `<line class="grid-line" x1="${x(t)}" x2="${x(t)}" y1="0" y2="${H - 18}"/>`;
      svg += `<text x="${x(t)}" y="${H - 4}" text-anchor="middle">${esc(STAC.fmtCompact(t))}</text>`;
    });
    data.forEach((d, i) => {
      const y = i * (barH + gap);
      const w = x(d.value) - labelW;
      svg += `<g class="mark" data-i="${i}">
        <text class="lbl" x="${labelW - 8}" y="${y + barH / 2 + 4}" text-anchor="end">${esc(d.label)}</text>
        <path d="${barPath(labelW, y, Math.max(w, d.value > 0 ? 2 : 0), barH)}" style="fill:${d.color || "var(--accent)"}"/>
        <text class="lbl" x="${labelW + w + 6}" y="${y + barH / 2 + 4}">${esc(d.valueLabel || fmt(d.value))}</text>
        <rect class="hit" x="0" y="${y - gap / 2}" width="${W}" height="${barH + gap}"/>
      </g>`;
    });
    svg += `<line class="axis" x1="${labelW}" x2="${labelW}" y1="0" y2="${H - 18}"/></svg>`;
    container.innerHTML = svg;
    container.classList.add("chart");

    const tip = tooltip(container.parentElement);
    container.querySelectorAll(".mark").forEach((g) => {
      const d = data[+g.dataset.i];
      g.addEventListener("mousemove", (e) => {
        container.classList.add("hovering");
        g.classList.add("on");
        tip.show(`<b>${esc(d.label)}</b><br>${esc(d.valueLabel || fmt(d.value))}${d.detail ? `<br>${esc(d.detail)}` : ""}`, e);
      });
      g.addEventListener("mouseleave", () => {
        container.classList.remove("hovering");
        g.classList.remove("on");
        tip.hide();
      });
    });
  };

  /**
   * Line chart for daily series.
   * series: [{name, color, values:[number]}], dates: ["YYYY-MM-DD"]
   */
  STAC.line = function (container, dates, series, opts = {}) {
    const W = Math.max(320, Math.round(container.clientWidth || 760)), H = 240, L = 44, R = 12, T = 12, B = 26;
    const pw = W - L - R, ph = H - T - B;
    const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
    const x = (i) => L + (dates.length <= 1 ? 0 : (i / (dates.length - 1)) * pw);
    const y = (v) => T + ph - (v / max) * ph;

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.title || "Line chart")}">`;
    [0, 0.5, 1].forEach((t) => {
      const v = t * max;
      svg += `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`;
      svg += `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${esc(STAC.fmtCompact(v))}</text>`;
    });
    const tickIdx = dates.length ? [0, Math.floor((dates.length - 1) / 2), dates.length - 1] : [];
    tickIdx.forEach((i) => {
      svg += `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === dates.length - 1 ? "end" : "middle"}">${esc(dates[i])}</text>`;
    });
    series.forEach((s) => {
      const d = s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
      const area = `${d}L${x(s.values.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
      if (s.area) svg += `<path d="${area}" style="fill:${s.color}" opacity="0.10"/>`;
      svg += `<path d="${d}" fill="none" style="stroke:${s.color}" stroke-width="2" stroke-linejoin="round"/>`;
      const last = s.values.length - 1;
      if (last >= 0) svg += `<circle cx="${x(last)}" cy="${y(s.values[last])}" r="4" style="fill:${s.color};stroke:var(--surface)" stroke-width="2"/>`;
    });
    svg += `<line class="crosshair" x1="0" x2="0" y1="${T}" y2="${T + ph}" style="stroke:var(--ink-3)" stroke-dasharray="3 3" visibility="hidden"/>`;
    svg += `<rect class="hit" x="${L}" y="${T}" width="${pw}" height="${ph}"/></svg>`;
    container.innerHTML = svg;
    container.classList.add("chart");

    const tip = tooltip(container.parentElement);
    const svgEl = container.querySelector("svg");
    const cross = svgEl.querySelector(".crosshair");
    svgEl.querySelector(".hit").addEventListener("mousemove", (e) => {
      const r = svgEl.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(dates.length - 1, Math.round(((px - L) / pw) * (dates.length - 1))));
      cross.setAttribute("x1", x(i));
      cross.setAttribute("x2", x(i));
      cross.setAttribute("visibility", "visible");
      tip.show(`<b>${esc(dates[i])}</b><br>${series.map((s) => `${esc(s.name)}: ${STAC.fmt(s.values[i])}`).join("<br>")}`, e);
    });
    svgEl.querySelector(".hit").addEventListener("mouseleave", () => { cross.setAttribute("visibility", "hidden"); tip.hide(); });
  };
})();
