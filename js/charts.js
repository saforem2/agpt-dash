function buildChart(el, dataSeries, opts={}){
  const options = Object.assign({
    width: el.clientWidth || 640,
    height: 260,
    series: [{}, ...dataSeries.map((_,i)=>({
      label: dataSeries[i].label,
      stroke: ["#2a9d8f","#e76f51","#e9c46a","#4c78a8","#f4a261","#8884d8","#90be6d","#f9844a","#577590","#43aa8b"][i%10]||"#666",
      width: 2,
      dash: [1,0],
      points:{ show:true, size:2, space:0 },
    }))],
    axes:[{label:"step"},{label: dataSeries[0]?.label||"y"}],
    scales: { x:{time:false}, y:{distr:1} },
    legend: { show:true },
    cursor: { sync:{key:"group"}, focus:{prox:10} },
  }, opts);

  // dataSeries expected array of {label, data:[[step,y],...]}
  const seriesData = dataSeries.map(s => s.data.map(p => p[0]));
  const data = dataSeries.map(s => s.data.map(p => p[1]));

  // prepend series labels in first column if needed; using uPlot format
  // uPlot expects arrays of arrays; first array = x, rest = series y
  const plotData = [seriesData[0] || []];
  for(let i=0;i<dataSeries.length;i++){
    plotData.push(data[i] || []);
  }

  const u = new uPlot(options, plotData, el);
  return u;
}

function focusChart(el, seriesObj){
  // seriesObj: {loss:[...], grad_norm:[...], ...} -> pick first with data
  const entries = Object.entries(seriesObj||{}).filter(([k,v])=>Array.isArray(v)&&v.length>0);
  if(!entries.length) return null;
  const label = "step";
  // Build multi-line data for all series in seriesObj
  const keys = entries.map(([k])=>k);
  const dataArr = entries.map(([k,v])=>v.slice(0, 600)); // downsample for perf
  const maxLen = Math.max(...dataArr.map(a=>a.length));
  const plotData = [dataArr[0].map(p=>p[0])];
  for(let i=0;i<keys.length;i++) plotData.push(dataArr[i].map(p=>p[1]));
  const options = {
    width: el.clientWidth || 640,
    height: 280,
    title: "training metrics (focus)",
    series: [{label:label, stroke:"#555", width:1}, ...keys.map((k,i)=>({
      label: k,
      stroke: ["#2a9d8f","#e76f51","#e9c46a","#4c78a8","#f4a261","#577590","#90be6d","#f9844a"][i%8],
      width: 1.5,
      dash: k.includes("norm")?[2,2]:[1,0],
      points:{show:true, size:1},
    }))],
    axes:[{label:"step"},{label:"value"}],
    scales: { x:{time:false}, y:{} },
    legend: { show:true, live:true, cols:3 },
    cursor: { sync:{key:"group"}, focus:{prox:10} },
  };
  return new uPlot(options, plotData, el);
}

function metricsGrid(el, seriesObj){
  // Small multiples: one mini chart per metric series in seriesObj
  // Just render first 4 metrics as small charts
  el.innerHTML = ""; // we build grid manually
  const keys = Object.keys(seriesObj||{}).filter(k=>Array.isArray(seriesObj[k])&&seriesObj[k].length);
  const grid = document.createElement("div");
  grid.className = "metrics-grid";
  grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;";
  for(const k of keys.slice(0,6)){
    const card = document.createElement("div");
    card.className = "metric-card";
    card.style.cssText = "background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px;";
    const title = document.createElement("h4");
    title.textContent = k;
    title.style.cssText = "margin:0 0 6px;color:var(--fg);font-size:13px;";
    card.appendChild(title);
    const canvas = document.createElement("div");
    canvas.style.height = "150px";
    card.appendChild(canvas);
    grid.appendChild(card);
    setTimeout(()=>{
      const data = seriesObj[k].slice(0,400);
      const opts = {
        width: canvas.clientWidth || 260,
        height: 140,
        series: [{label:k}, {label:k, stroke:["#4c78a8","#e9c46a","#e76f51","#577590","#43aa8b","#90be6d","#f9844a","#8884d8"][keys.indexOf(k)%8], width:2}],
        axes:[{label:"step"},{label:k}],
        legend: {show:false},
        cursor: {focus:{prox:10}},
      };
      new uPlot(opts, [data.map(p=>p[0]), data.map(p=>p[1])], canvas);
    }, 50);
  }
  el.appendChild(grid);
}

function evalChart(el, history){
  const keys = Object.keys(history||{}).filter(k=>Array.isArray(history[k])&&history[k].length);
  if(!keys.length){ el.innerHTML = "<p style='color:var(--muted);font-size:12px;'>No eval history</p>"; return; }
  const maxLen = Math.max(...keys.map(k=>history[k].length));
  const plotData = [history[keys[0]].map(p=>p[0])];
  for(const k of keys){ plotData.push(history[k].map(p=>p[1])); }
  const opts = {
    width: el.clientWidth || 640,
    height: 260,
    title: "benchmark scores over steps",
    series: [{label:"step", stroke:"#888", width:1}, ...keys.map((k, i)=>({
      label: k,
      stroke: ["#2a9d8f","#e76f51","#e9c46a","#4c78a8","#f4a261","#577590","#90be6d","#f9844a","#43aa8b","#577590"][i%10],
      width: 2,
      points:{show:true, size:2},
    }))],
    axes:[{label:"step"},{label:"score"}],
    legend: {show:true, live:true},
    scales: { x:{time:false}, y:{distr:3,range:[0,1]} },
    cursor: {focus:{prox:10}},
  };
  new uPlot(opts, plotData, el);
}
