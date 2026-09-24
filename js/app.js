// agpt-dash app shell: multi-view, theme, status pill, modal, charts, board
(function(){
  "use strict";
  let data = {};
  let focusChartInstance = null;
  let pollTimer = null;

  function $id(id){ return document.getElementById(id); }

  // Theme toggle
  window.toggleTheme = function(){
    document.body.classList.toggle("dark");
    document.documentElement.classList.toggle("dark");
    const dark = document.body.classList.contains("dark");
    document.documentElement.style.setProperty("--bg", dark ? "#0f1115" : "#f6f7f9");
    document.documentElement.style.setProperty("--fg", dark ? "#e8e6e3" : "#1a1b1f");
    document.documentElement.style.setProperty("--muted", dark ? "#8a8f98" : "#6b6f78");
    document.documentElement.style.setProperty("--line", dark ? "#252830" : "#dde0e6");
    document.documentElement.style.setProperty("--panel", dark ? "#171a1f" : "#ffffff");
    document.documentElement.style.setProperty("--card", dark ? "#1b1e24" : "#fff");
  };

  // Multi-view switcher
  window.switchView = function(name){
    document.querySelectorAll(".tabs a").forEach(a=>a.classList.remove("active"));
    document.querySelectorAll(".view").forEach(s=>s.classList.remove("active"));
    document.querySelector(`.tabs a[data-view="${name}"]`).classList.add("active");
    document.getElementById("view-"+name).classList.add("active");
    if(name==="metrics" && data.chains) renderMetrics();
  };

  // Status pill
  function setStatus(text, live){
    const pill = $id("status-pill");
    pill.textContent = text;
    pill.classList.remove("live","stale");
    pill.classList.add(live ? "live" : "stale");
  }

  // Build legend for focus chart
  function buildLegend(seriesKeys){
    const colors = ["#2a9d8f","#e76f51","#e9c46a","#4c78a8","#f4a261","#577590","#90be6d","#f9844a","#43aa8b","#577590"];
    const html = seriesKeys.map((k,i)=>{
      const c = colors[i%colors.length];
      return `<span><span class="dot" style="background:${c}"></span>${k}</span>`;
    }).join("");
    $id("legend").innerHTML = html;
  }

  // Board table
  function renderBoard(chains){
    const tbody = document.querySelector("#board-table tbody");
    if(!tbody) return;
    tbody.innerHTML = "";
    for(const [key, info] of Object.entries(chains||{})){
      const tr = document.createElement("tr");
      const step = info?.evals?.step ?? (info?.live_tip?.step ?? "—");
      const label = info?.label || key;
      const model = info?.model || "—";
      const nodes = info?.num_nodes != null ? info.num_nodes : "—";
      tr.innerHTML = `<td><a href="#" onclick="openModal('${key}');return false;">${key}</a></td><td>${model}</td><td>${nodes}</td><td>${step}</td><td><span class="pill ${step ? 'live' : 'stale'}">${step ? 'live' : 'offline'}</span></td><td><button onclick="openModal('${key}')">details</button></td>`;
      tbody.appendChild(tr);
    }
  }

  // Focus chart (training series from first chain with series)
  function renderFocus(chains){
    const el = $id("focus-chart");
    if(!chains) return;
    const first = Object.values(chains||{}).find(c=>c?.series && Object.keys(c.series).length);
    if(!first || !first.series) return;
    if(focusChartInstance && typeof focusChartInstance.destroy === "function") focusChartInstance.destroy();
    const keys = Object.keys(first.series);
    buildLegend(keys);
    focusChartInstance = focusChart(el, first.series);
  }

  // Metrics grid
  function renderMetrics(){
    const chains = data.chains || {};
    const el = $id("metrics-grid");
    if(!el) return;
    el.innerHTML = "";
    // Small multiples per chain, limited to first 6 series per chain
    for(const [key, info] of Object.entries(chains).slice(0, 6)){
      const seriesObj = info?.series || {};
      const keys = Object.keys(seriesObj).slice(0, 4);
      const card = document.createElement("div");
      card.className = "panel";
      card.innerHTML = `<h3>${info?.label||key}</h3>`;
      const grid = document.createElement("div");
      grid.className = "metrics-grid-wrap";
      for(const k of keys){
        const inner = document.createElement("div");
        inner.className = "metric-card";
        inner.innerHTML = `<h4>${k}</h4><div style="height:140px;"></div>`;
        grid.appendChild(inner);
        const dataArr = seriesObj[k] || [];
        const plotData = [dataArr.map(p=>p[0]||p.step||0), dataArr.map(p=>p[1]||0)];
        const opts = {
          width: 260, height: 130, series:[{label:k, width:1.5}], axes:[{label:"step"},{label:k}], legend:{show:false}, cursor:{focus:{prox:10}},
        };
        setTimeout(()=>{ try{ new uPlot(opts, plotData, inner.querySelector("div")); }catch(e){} }, 20);
      }
      card.appendChild(grid);
      el.appendChild(card);
    }
  }

  // Evals chart
  function renderEvals(chains){
    const el = $id("eval-chart");
    if(!el) return;
    const first = Object.values(chains||{}).find(c=>c?.evals?.history && Object.keys(c.evals.history).length);
    if(first && first.evals && first.evals.history) evalChart(el, first.evals.history);
    else el.innerHTML = "<p style='color:var(--muted);font-size:12px;'>No eval history available</p>";
  }

  // About info
  function renderAbout(){
    const upstream = data.cached_from || "—";
    const timeStr = data.cached_at ? new Date(data.cached_at*1000).toISOString() : "—";
    $id("upstream-src").textContent = upstream;
    $id("cache-time").textContent = timeStr;
    $id("stale-info").textContent = data.stale ? "stale (" + (data.stale_reason || "offline") + ")" : "fresh";
    const liveTip = data.chains ? Object.values(data.chains).map(c=>c?.live_tip?.step || (c?.evals?.step || "—")).join(", ") : "—";
    $id("live-tip").textContent = liveTip;
  }

  // Meta row on hero
  function renderHeroMeta(){
    const meta = $id("meta-row");
    if(!meta) return;
    const count = data.chains ? Object.keys(data.chains).length : 0;
    meta.innerHTML = `<span>chains: <strong>${count}</strong></span> <span>cached: <strong>${data.cached_at ? new Date(data.cached_at*1000).toLocaleString() : "—"}</strong></span> <span>stale: <strong>${data.stale ? "yes" : "no"}</strong></span>`;
  }

  // Modal
  window.openModal = function(keyOrType){
    const modal = $id("modal");
    const title = $id("modal-title");
    const body = $id("modal-body");
    if(typeof keyOrType === "string" && data.chains && data.chains[keyOrType]){
      const c = data.chains[keyOrType];
      title.textContent = (c.label || keyOrType) + " (" + (c.model||"?") + " · " + (c.num_nodes||"?") + " nodes)";
      body.innerHTML = `
        <div class="about-dl">
          <dt>step</dt><dd>${c.evals?.step || c.live_tip?.step || "—"}</dd>
          <dt>label</dt><dd>${c.label || "—"}</dd>
          <dt>model</dt><dd>${c.model || "—"}</dd>
          <dt>nodes</dt><dd>${c.num_nodes != null ? c.num_nodes : "—"}</dd>
        </div>` + (c.evals?.scores ? `
        <h4 style="margin-top:10px;">latest scores</h4>
        <table class="board-table" style="font-size:11px;"><thead><tr><th>benchmark</th><th>score</th></tr></thead><tbody>
        ${Object.entries(c.evals.scores).map(([k,v])=>`<tr><td>${k}</td><td>${fmtScore(v)}</td></tr>`).join("")}
        </tbody></table>` : "");
    } else if(keyOrType === "upstream"){
      title.textContent = "upstream source";
      body.textContent = data.cached_from || "—";
    } else if(keyOrType === "metrics"){
      title.textContent = "metrics";
      body.innerHTML = "<p>Training series charts drawn from live payload: loss, grad_norm, tps, tflops, mfu, lr.</p>";
    } else {
      title.textContent = keyOrType || "details";
      body.textContent = JSON.stringify(data, null, 2).slice(0, 600);
    }
    modal.classList.add("active");
  };
  window.closeModal = function(){ $id("modal").classList.remove("active"); };
  document.addEventListener("keydown", e=>{ if(e.key==="Escape") closeModal(); });

  // Main load
  function load(){
    fetch("/api/backbone")
      .then(r=>r.json())
      .then(d=>{
        data = d;
        renderHeroMeta();
        renderBoard(d.chains);
        renderFocus(d.chains);
        renderEvals(d.chains);
        renderAbout();
        setStatus(d.stale ? "stale" : "live", !d.stale);
        $id("foot-stream").textContent = d.stale ? "stale" : "live";
        if(window.location.hash.includes("metrics")) renderMetrics();
      })
      .catch(err=>{
        console.error(err);
        setStatus("reconnecting…", false);
        $id("view-overview").innerHTML = `<div class="panel"><p>fetch error: ${err}</p></div>`;
      });
  }

  // Poll
  load();
  pollTimer = setInterval(()=>{ if(!document.hidden) load(); }, 20000);
})();
