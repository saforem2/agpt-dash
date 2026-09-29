// agpt-dash application shell and production telemetry views.
(function(){
  "use strict";
  const METRICS=[["loss","loss (global avg)"],["grad_norm","grad norm"],["tps","tokens / sec / GPU"],["tflops","TFLOPs"],["mfu","MFU (%)"],["lr","learning rate"]];
  const EVAL_ORDER=["hellaswag","arc_challenge","arc_easy","mmlu","gsm8k","winogrande","piqa"];
  const STALE_STATES=new Set(["stale","Q","H","E"]);
  let data={}, metric="loss", hidden=new Set(), focusPlot=null, focusItems=[], focusLabel="loss", metricPlots=[], expandedPanel=null;
  let loading=false, renderedRevision=null, resizeTimer=null, urlRuns=null;
  const $id=id=>document.getElementById(id);
  const escapeHtml=value=>String(value??"—").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]);
  const finite=value=>Number.isFinite(Number(value))?Number(value):null;
  const relativeAge=seconds=>seconds==null?"never":seconds<5?"just now":seconds<60?`${Math.floor(seconds)}s ago`:seconds<3600?`${Math.floor(seconds/60)}m ago`:seconds<86400?`${Math.floor(seconds/3600)}h ago`:`${Math.floor(seconds/86400)}d ago`;
  const dateTime=timestamp=>timestamp?new Date(timestamp*1000).toLocaleString():"—";
  const cacheAge=()=>{const local=data.cache_age_seconds??(data.cached_at?Math.max(0,Date.now()/1000-data.cached_at):null);return data.stale&&data.built_age!=null?Math.max(local??0,data.built_age):local;};
  const chainStep=chain=>finite(chain?.live_tip?.step??chain?.latest_step??chain?.series?.loss?.at(-1)?.[0]??chain?.curve?.at(-1)?.[0]);
  const chainLoss=chain=>finite(chain?.live_tip?.loss??chain?.latest_loss??chain?.series?.loss?.at(-1)?.[1]??chain?.curve?.at(-1)?.[1]);
  // Cached telemetry keeps ageing after the snapshot was taken, so every age is
  // advanced by the time elapsed locally since the cache was written.
  const sourceElapsed=()=>{const at=finite(data.cached_at);return at==null?0:Math.max(0,Date.now()/1000-at);};
  // finite(null) is 0 because Number(null)===0, so null/undefined must be
  // rejected BEFORE coercion or a chain with no age reads as age zero.
  const agedSeconds=value=>{if(value==null)return null;const base=finite(value);return base==null?null:base+sourceElapsed();};
  const isLive=chain=>{
    if(data.stale||["error","empty","stale"].includes(data.cache_status)) return false;
    if(STALE_STATES.has(chain?.queue_state)) return false;
    const window=finite(data.live_window)??300;
    if(chain?.queue_state==="R"){const tip=agedSeconds(chain.live_tip?.age);return tip==null?sourceElapsed()<=window:tip<=window;}
    if(chain?.queue_state==null) return false;
    const logAge=agedSeconds(chain?.log_age);
    return logAge!=null&&logAge<=window;
  };
  const chainOrder=()=>Object.keys(data.chains||{}).sort((a,b)=>{
    const A=data.chains[a],B=data.chains[b],ac=A.kind!=="canonical",bc=B.kind!=="canonical";
    if(ac!==bc)return ac-bc;if((A.model||"z")!==(B.model||"z"))return (A.model||"z").localeCompare(B.model||"z");
    if((A.num_nodes||0)!==(B.num_nodes||0))return (B.num_nodes||0)-(A.num_nodes||0);return a.localeCompare(b);
  });
  const colorFor=key=>chartColor(chainOrder().indexOf(key));
  try{hidden=new Set(JSON.parse(localStorage.getItem("agpt-hidden-runs")||"[]"));}catch{hidden=new Set();}
  const saveHidden=()=>localStorage.setItem("agpt-hidden-runs",JSON.stringify([...hidden]));
  const params=new URLSearchParams(location.search);
  if(METRICS.some(([key])=>key===params.get("metric")))metric=params.get("metric");
  urlRuns=params.has("runs")?new Set(params.get("runs").split(",").filter(Boolean)):null;

  function applyTheme(dark){
    document.body.classList.toggle("dark",dark);document.documentElement.classList.toggle("dark",dark);
    const vars=dark?{"--bg":"#0f1115","--bg-rgb":"15,17,21","--fg":"#e8e6e3","--muted":"#8a8f98","--line":"#3a3f49","--panel":"#171a1f","--card":"#1b1e24","--control":"#20242b"}:{"--bg":"#f6f7f9","--bg-rgb":"246,247,249","--fg":"#1a1b1f","--muted":"#5d626c","--line":"#aeb4bf","--panel":"#fff","--card":"#fff","--control":"#fff"};
    for(const [key,value] of Object.entries(vars))document.documentElement.style.setProperty(key,value);
  }
  const savedTheme=localStorage.getItem("agpt-theme");applyTheme(savedTheme?savedTheme==="dark":matchMedia("(prefers-color-scheme:dark)").matches);
  $id("tokens-axis").checked=params.get("x")==="tokens";
  $id("progress-axis").checked=params.get("x")==="progress";
  $id("log-y").checked=params.get("log")==="1";
  $id("clip-outliers").checked=params.get("clip")==="1";
  function syncOptionControls(){for(const name of ["tokens","progress","log","clip"]){const source=document.querySelector(`[data-chart-option="${name}"]`);document.querySelectorAll(`[data-chart-option="${name}"]`).forEach(input=>input.checked=source.checked);}}
  syncOptionControls();
  window.toggleTheme=()=>{const dark=!document.body.classList.contains("dark");applyTheme(dark);localStorage.setItem("agpt-theme",dark?"dark":"light");renderCharts();renderLegend();};
  window.switchView=(name,updateHash=true)=>{if(!$id("view-"+name))name="overview";document.querySelectorAll(".tabs a").forEach(a=>a.classList.toggle("active",a.dataset.view===name));document.querySelectorAll(".view").forEach(section=>section.classList.toggle("active",section.id==="view-"+name));if(updateHash){const url=new URL(location.href);url.hash=name;history.replaceState(null,"",url);}if(name==="metrics"&&data.chains)renderMetrics();};

  function syncUrl(){
    if(!data.chains)return;const url=new URL(location.href),query=url.searchParams;
    metric==="loss"?query.delete("metric"):query.set("metric",metric);
    const axis=$id("progress-axis").checked?"progress":$id("tokens-axis").checked?"tokens":"step";
    axis==="step"?query.delete("x"):query.set("x",axis);
    $id("log-y").checked?query.set("log","1"):query.delete("log");
    $id("clip-outliers").checked?query.set("clip","1"):query.delete("clip");
    const visible=chainOrder().filter(key=>!hidden.has(key));
    visible.length===chainOrder().length?query.delete("runs"):query.set("runs",visible.join(","));
    history.replaceState(null,"",url);
  }

  function setStatus(){
    const status=data.cache_status||(data.stale?"stale":"fresh"),pill=$id("status-pill");
    const sourceAge=data.built_age!=null?relativeAge(data.built_age).replace(" ago"," old"):null;
    const labels={fresh:"live",refreshing:"refreshing…",error:"offline · cached",empty:"waiting for data"};
    pill.textContent=status==="stale"&&sourceAge?`cached · ${sourceAge}`:(labels[status]||status);
    pill.classList.toggle("live",status==="fresh"||status==="refreshing");pill.classList.toggle("stale",!["fresh","refreshing"].includes(status));
    pill.title=data.cache_error||data.stale_reason||(status==="stale"&&sourceAge?`Aurora backbone is ${sourceAge}; rebuild requested automatically.`:`Data is ${relativeAge(cacheAge())}`);
    $id("foot-stream").textContent=pill.textContent;
    const banner=$id("stale-banner");banner.hidden=!data.stale;
    if(data.stale)banner.textContent=`Showing cached Aurora backbone data from ${relativeAge(cacheAge())}. Live-state indicators may not be current.${data.stale_reason?` ${data.stale_reason}`:""}`;
  }
  function renderSummary(){const values=Object.values(data.chains||{}),steps=values.map(chainStep).filter(v=>v!=null),nodes=values.map(c=>finite(c.num_nodes)).filter(v=>v!=null).reduce((a,b)=>a+b,0);$id("summary-runs").textContent=values.length.toLocaleString();$id("summary-step").textContent=steps.length?Math.max(...steps).toLocaleString():"—";$id("summary-nodes").textContent=nodes?nodes.toLocaleString():"—";$id("summary-age").textContent=relativeAge(cacheAge());}

  const axisMode=()=>$id("progress-axis").checked?"progress":$id("tokens-axis").checked?"tokens":"step";
  function transformSeries(chain,series){
    const mode=axisMode();if(mode==="step")return series;
    const perStep=(chain.gbs||0)*(chain.seq_len||0);if(!perStep)return null;
    if(mode==="tokens"){const prior=(chain.prior_tokens||0)/1e9;return series.map(point=>[prior+point[0]*perStep/1e9,point[1]]);}
    if(!chain.token_target)return null;return series.map(point=>[point[0]*perStep/chain.token_target*100,point[1]]);
  }
  function seriesFor(key,chain,metricKey=metric){
    let series=((chain.series||{})[metricKey]||[]).slice();const tip=chain.live_tip;
    if(tip&&tip[metricKey]!=null&&tip.step!=null&&(!series.length||tip.step>series.at(-1)[0]))series.push([tip.step,tip[metricKey]]);
    if(!series.length)return null;
    return transformSeries(chain,series);
  }
  function evalSeriesFor(chain,task){const series=chain.evals?.history?.[task];return series?.length?transformSeries(chain,series.slice()):null;}
  function chartItems(getter,itemMetric=focusLabel){return chainOrder().filter(key=>!hidden.has(key)).map(key=>{const chain=data.chains[key];return {key,chain,metricLabel:itemMetric,label:chain.label||key,data:getter(key,chain),color:colorFor(key),live:isLive(chain)};}).filter(item=>item.data?.length);}
  function chartOptions(extra={}){return {axisMode:axisMode(),tokensAxis:$id("tokens-axis").checked,progressAxis:$id("progress-axis").checked,logY:$id("log-y").checked,clip:$id("clip-outliers").checked,tooltip:tooltipHtml,...extra};}
  function rawStep(item,x){const chain=item.chain,perStep=(chain.gbs||0)*(chain.seq_len||0),mode=axisMode();if(mode==="step")return Math.round(x);if(!perStep)return null;if(mode==="tokens")return Math.round((x*1e9-(chain.prior_tokens||0))/perStep);return chain.token_target?Math.round(x/100*chain.token_target/perStep):null;}
  function tooltipHtml(item,x,value){const chain=item.chain,step=rawStep(item,x),perStep=(chain.gbs||0)*(chain.seq_len||0),tokens=step==null||!perStep?null:((chain.prior_tokens||0)+step*perStep)/1e9,updated=chain.updated_ts||chain.wb_ts,age=updated?Math.max(0,Date.now()/1000-updated):null;return `<strong style="color:${item.color}">${escapeHtml(item.label)}</strong><div class="chart-tooltip-row"><span>${axisMode()==="progress"?"progress":axisMode()==="tokens"?"tokens":"step"}</span><b>${axisMode()==="progress"?x.toFixed(1)+"%":axisMode()==="tokens"?x.toFixed(1)+"B":step?.toLocaleString()||"—"}</b></div><div class="chart-tooltip-row"><span>${escapeHtml(item.metricLabel||focusLabel)}</span><b>${Number(value).toPrecision(5)}</b></div><div class="chart-tooltip-row"><span>step</span><b>${step?.toLocaleString()||"—"}</b></div><div class="chart-tooltip-row"><span>tokens</span><b>${tokens==null?"—":tokens.toFixed(1)+"B"}</b></div><div class="chart-tooltip-row"><span>throughput</span><b>${finite(chain.live_tip?.tps??chain.wb_tps)?.toFixed(0)??"—"} tok/s/GPU</b></div><div class="chart-tooltip-row"><span>run updated</span><b>${age==null?"reference":relativeAge(age)}</b></div>`;}
  function renderFocus(){if(focusPlot)focusPlot.destroy();focusLabel=METRICS.find(item=>item[0]===metric)?.[1]||metric;focusItems=chartItems((key,chain)=>seriesFor(key,chain),focusLabel);focusPlot=multiSeriesChart($id("focus-chart"),focusLabel,focusItems,chartOptions({height:360,scientific:metric==="lr",title:`${focusLabel} · all chains`}));}
  function renderTabs(){const el=$id("metric-tabs");el.innerHTML="";for(const [key,label] of METRICS){const button=document.createElement("button");button.type="button";button.textContent=label;button.setAttribute("aria-selected",String(key===metric));button.onclick=()=>{metric=key;syncUrl();renderTabs();renderFocus();};el.appendChild(button);}}
  function runAge(chain){const tipAge=agedSeconds(chain.live_tip?.age);if(isLive(chain)&&tipAge!=null)return relativeAge(tipAge);const stamp=finite(chain.updated_ts)??finite(chain.wb_ts);if(stamp)return relativeAge(Math.max(0,Date.now()/1000-stamp));const logAge=agedSeconds(chain.log_age);if(logAge!=null)return relativeAge(logAge);return "reference";}
  function filteredKeys(){const query=($id("run-search")?.value||"").trim().toLowerCase(),model=$id("run-model")?.value||"",nodes=$id("run-nodes")?.value||"",status=$id("run-status")?.value||"";return chainOrder().filter(key=>{const chain=data.chains[key],live=isLive(chain);return (!query||`${key} ${chain.label||""}`.toLowerCase().includes(query))&&(!model||chain.model===model)&&(!nodes||String(chain.num_nodes)===nodes)&&(!status||(status==="live")===live);});}
  function renderRunButtons(el){
    if(!el)return;el.innerHTML="";
    const keys=el.id==="metrics-run-filter"?filteredKeys():chainOrder();
    for(const key of keys){
      const chain=data.chains[key],button=document.createElement("button");button.type="button";button.className=hidden.has(key)?"off":"";button.setAttribute("aria-pressed",String(!hidden.has(key)));button.title=`${hidden.has(key)?"Show":"Hide"} ${chain.label||key}`;button.innerHTML=`<span class="dot" style="background:${colorFor(key)}"></span><span class="name">${escapeHtml(chain.label||key)}</span>${isLive(chain)?'<span class="live-mark">live</span>':""}`;
      button.innerHTML+=`<span class="run-age">${escapeHtml(runAge(chain))}</span>`;
      const toggle=solo=>{if(solo)hidden=new Set(chainOrder().filter(candidate=>candidate!==key));else hidden.has(key)?hidden.delete(key):hidden.add(key);saveHidden();syncUrl();renderLegend();renderCharts();};
      button.onclick=event=>toggle(event.altKey||event.metaKey);button.ondblclick=event=>{event.preventDefault();toggle(true);};el.appendChild(button);
    }
    if(!keys.length)el.innerHTML='<div class="empty-state">No runs match these filters.</div>';
  }
  function renderLegend(){renderRunButtons($id("legend"));renderRunButtons($id("metrics-run-filter"));const count=$id("metrics-run-count"),matching=filteredKeys(),visible=matching.filter(key=>!hidden.has(key)).length;if(count)count.textContent=`${visible} of ${matching.length} matching selected · ${chainOrder().length-hidden.size} total visible`;}
  function populateFilters(){for(const [id,values,suffix] of [["run-model",[...new Set(chainOrder().map(key=>data.chains[key].model))].sort(),""],["run-nodes",[...new Set(chainOrder().map(key=>data.chains[key].num_nodes))].sort((a,b)=>a-b)," nodes"]]){const select=$id(id),current=select.value;while(select.options.length>1)select.remove(1);for(const value of values){const option=document.createElement("option");option.value=value;option.textContent=`${value}${suffix}`;select.appendChild(option);}select.value=current;}}

  function renderBoard(){const tbody=document.querySelector("#board-table tbody");tbody.innerHTML="";for(const key of chainOrder()){const chain=data.chains[key],step=chainStep(chain),loss=chainLoss(chain),live=isLive(chain),tr=document.createElement("tr"),button=document.createElement("button");button.textContent="details";button.onclick=()=>openModal(key);tr.innerHTML=`<td><a href="#">${escapeHtml(chain.label||key)}</a></td><td>${step==null?"—":step.toLocaleString()}</td><td>${loss==null?"—":loss.toFixed(4)}</td><td>${chain.pct_target==null?"—":Number(chain.pct_target).toFixed(1)+"%"}</td><td>${finite(chain.live_tip?.tps??chain.wb_tps)?.toFixed(0)??"—"}</td><td><span class="pill ${live?"live":"stale"}">${escapeHtml(live?"live":(chain.queue_state||"idle"))}</span></td><td></td>`;tr.querySelector("a").onclick=event=>{event.preventDefault();openModal(key);};tr.lastElementChild.appendChild(button);tbody.appendChild(tr);}}
  function renderEvalTable(){const body=$id("eval-score-table").querySelector("tbody"),scored=chainOrder().map(key=>[key,data.chains[key]]).filter(([,chain])=>Object.keys(chain.evals?.scores||{}).length);if(!scored.length){body.innerHTML='<tr><td class="empty-state">No evaluated checkpoints yet.</td></tr>';return;}const seen=[];scored.forEach(([,chain])=>Object.keys(chain.evals.scores).forEach(task=>{if(!seen.includes(task))seen.push(task);}));const tasks=EVAL_ORDER.filter(t=>seen.includes(t)).concat(seen.filter(t=>!EVAL_ORDER.includes(t)));body.innerHTML=`<tr><th>chain</th><th>step</th>${tasks.map(t=>`<th>${escapeHtml(t)}</th>`).join("")}</tr>`+scored.map(([key,chain])=>`<tr><td>${escapeHtml(chain.label||key)}</td><td>${chain.evals.step?.toLocaleString()||"—"}</td>${tasks.map(t=>`<td>${chain.evals.scores[t]==null?"—":Number(chain.evals.scores[t]).toFixed(3)}</td>`).join("")}</tr>`).join("");}

  function makeChartCard(container,title,panelKey){const card=document.createElement("div"),heading=document.createElement("h4"),name=document.createElement("span"),button=document.createElement("button"),plot=document.createElement("div"),expanded=expandedPanel===panelKey;card.className=`metric-card${expanded?" expanded":""}`;name.textContent=title;button.className="chart-expand";button.type="button";button.textContent=expanded?"×":"⛶";button.title=expanded?"Restore chart (Esc)":"Maximize chart";button.onclick=()=>{expandedPanel=expanded?null:panelKey;document.body.classList.toggle("chart-expanded",!!expandedPanel);renderMetrics();};heading.append(name,button);card.append(heading,plot);container.appendChild(card);return {plot,expanded};}
  function renderMetrics(){metricPlots.forEach(plot=>plot?.destroy());metricPlots=[];const grid=$id("metrics-grid"),evalGrid=$id("eval-grid");grid.innerHTML="";evalGrid.innerHTML="";for(const [key,label] of METRICS){const card=makeChartCard(grid,label,`metric:${key}`);const plot=multiSeriesChart(card.plot,label,chartItems((chainKey,chain)=>seriesFor(chainKey,chain,key),label),chartOptions({width:card.plot.clientWidth,height:card.expanded?innerHeight-90:210,compact:!card.expanded,scientific:key==="lr",title:""}));if(plot)metricPlots.push(plot);}const tasks=[];for(const chain of Object.values(data.chains||{}))for(const task of Object.keys(chain.evals?.history||{}))if(!tasks.includes(task))tasks.push(task);const ordered=EVAL_ORDER.filter(t=>tasks.includes(t)).concat(tasks.filter(t=>!EVAL_ORDER.includes(t)));$id("eval-heading").hidden=!ordered.length;for(const task of ordered){const card=makeChartCard(evalGrid,task,`eval:${task}`);const plot=multiSeriesChart(card.plot,task,chartItems((key,chain)=>evalSeriesFor(chain,task),task),chartOptions({width:card.plot.clientWidth,height:card.expanded?innerHeight-90:210,compact:!card.expanded,points:true,logY:false,clip:false,range:scoreRange,title:""}));if(plot)metricPlots.push(plot);}}
  function renderCharts(){renderFocus();if(location.hash==="#metrics")renderMetrics();}
  function renderMeta(){const count=Object.keys(data.chains||{}).length;$id("meta-row").innerHTML=`<span>runs: <strong>${count}</strong></span><span>updated: <strong>${relativeAge(cacheAge())}</strong></span><span>source: <strong>${data.stale?"local cache":"Aurora"}</strong></span>`;$id("upstream-src").textContent=data.cached_from||"—";$id("cache-time").textContent=dateTime(data.cached_at);if($id("attempt-time"))$id("attempt-time").textContent=dateTime(data.last_attempt_at);if($id("refresh-cadence"))$id("refresh-cadence").textContent=data.refresh_interval_seconds?`${data.refresh_interval_seconds}s`:"—";$id("stale-info").textContent=data.stale?`yes${data.stale_reason?` — ${data.stale_reason}`:""}`:"no";$id("live-tip").textContent=Object.values(data.chains||{}).map(chainStep).filter(v=>v!=null).map(v=>v.toLocaleString()).join(", ")||"—";}
  function renderAll(){if(urlRuns){hidden=new Set(chainOrder().filter(key=>!urlRuns.has(key)));urlRuns=null;saveHidden();}populateFilters();renderSummary();renderTabs();renderLegend();renderBoard();renderEvalTable();renderCharts();renderMeta();setStatus();}

  window.openModal=key=>{const chain=data.chains?.[key],title=$id("modal-title"),body=$id("modal-body");if(chain){title.textContent=chain.label||key;body.innerHTML=`<div class="about-dl"><dt>step</dt><dd>${chainStep(chain)?.toLocaleString()||"—"}</dd><dt>loss</dt><dd>${chainLoss(chain)?.toFixed(4)||"—"}</dd><dt>model</dt><dd>${escapeHtml(chain.model)}</dd><dt>nodes</dt><dd>${escapeHtml(chain.num_nodes)}</dd><dt>target</dt><dd>${chain.pct_target==null?"—":Number(chain.pct_target).toFixed(1)+"%"}</dd></div>`;}else if(key==="upstream"){title.textContent="upstream source";body.textContent=data.cached_from||"—";}else{title.textContent="metrics";body.textContent="Training and evaluation series from the latest locally cached Aurora snapshot.";}$id("modal").classList.add("active");};
  window.closeModal=()=>$id("modal").classList.remove("active");
  document.addEventListener("keydown",event=>{if(event.key!=="Escape")return;if(expandedPanel){expandedPanel=null;document.body.classList.remove("chart-expanded");renderMetrics();}else closeModal();});
  document.querySelectorAll("[data-chart-option]").forEach(input=>input.onchange=event=>{const option=event.target.dataset.chartOption;document.querySelectorAll(`[data-chart-option="${option}"]`).forEach(peer=>peer.checked=event.target.checked);if(option==="tokens"&&event.target.checked)document.querySelectorAll('[data-chart-option="progress"]').forEach(peer=>peer.checked=false);if(option==="progress"&&event.target.checked)document.querySelectorAll('[data-chart-option="tokens"]').forEach(peer=>peer.checked=false);syncUrl();renderCharts();});
  for(const id of ["run-search","run-model","run-nodes","run-status"]){const el=$id(id);el.addEventListener(id==="run-search"?"input":"change",renderLegend);}
  document.querySelectorAll("[data-run-filter]").forEach(button=>button.onclick=()=>{
    const mode=button.dataset.runFilter,keys=filteredKeys();
    if(mode==="all")keys.forEach(key=>hidden.delete(key));
    if(mode==="none")keys.forEach(key=>hidden.add(key));
    if(mode==="live")keys.forEach(key=>isLive(data.chains[key])?hidden.delete(key):hidden.add(key));
    saveHidden();syncUrl();renderLegend();renderCharts();
  });

  function download(blob,name){const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  // Upstream labels reach a spreadsheet, so neutralize leading formula triggers.
  const csvCell=value=>{const text=String(value??"");return `"${(/^[=+\-@\t\r]/.test(text)?`'${text}`:text).replaceAll('"','""')}"`;};
  function exportCsv(){const rows=[["run","metric","axis","x","step","tokens_billions","value","run_updated_at"]];for(const item of focusItems){for(const [x,value] of item.data){const step=rawStep(item,x),perStep=(item.chain.gbs||0)*(item.chain.seq_len||0),tokens=step==null||!perStep?"":((item.chain.prior_tokens||0)+step*perStep)/1e9;rows.push([item.label,metric,axisMode(),x,step??"",tokens,value,item.chain.updated_ts||item.chain.wb_ts||""]);}}const text=rows.map(row=>row.map(csvCell).join(",")).join("\n");download(new Blob([text],{type:"text/csv"}),`agpt-${metric}.csv`);}
  function exportPng(){const canvases=[...$id("focus-chart").querySelectorAll("canvas")];if(!canvases.length)return;const rect=$id("focus-chart").getBoundingClientRect(),scale=devicePixelRatio||1,out=document.createElement("canvas");out.width=Math.round(rect.width*scale);out.height=Math.round(rect.height*scale);const context=out.getContext("2d");context.fillStyle=getComputedStyle(document.body).getPropertyValue("--panel");context.fillRect(0,0,out.width,out.height);for(const canvas of canvases){const r=canvas.getBoundingClientRect();context.drawImage(canvas,Math.round((r.left-rect.left)*scale),Math.round((r.top-rect.top)*scale));}out.toBlob(blob=>download(blob,`agpt-${metric}.png`),"image/png");}
  function exportSvg(){if(!focusItems.length)return;const width=1200,height=650,pad=70,xs=focusItems.flatMap(item=>item.data.map(p=>p[0])),ys=focusItems.flatMap(item=>item.data.map(p=>p[1])).filter(v=>v>0||!$id("log-y").checked),xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys),xp=x=>pad+(x-xmin)/(xmax-xmin)*(width-2*pad),yp=y=>height-pad-(($id("log-y").checked?Math.log(y)-Math.log(ymin):y-ymin)/($id("log-y").checked?Math.log(ymax)-Math.log(ymin):ymax-ymin))*(height-2*pad);const paths=focusItems.map(item=>`<path d="${item.data.filter(p=>!$id("log-y").checked||p[1]>0).map((p,i)=>`${i?'L':'M'}${xp(p[0]).toFixed(1)},${yp(p[1]).toFixed(1)}`).join(' ')}" fill="none" stroke="${item.color}" stroke-width="2"/>`).join("");const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${chartDark()?'#171a1f':'#fff'}"/><text x="${width/2}" y="35" text-anchor="middle" fill="${chartDark()?'#e8e6e3':'#1a1b1f'}" font-family="monospace" font-size="20">${escapeHtml(focusLabel)}</text>${paths}</svg>`;download(new Blob([svg],{type:"image/svg+xml"}),`agpt-${metric}.svg`);}
  document.querySelectorAll("[data-export]").forEach(button=>button.onclick=()=>({csv:exportCsv,png:exportPng,svg:exportSvg}[button.dataset.export])());

  async function load(){if(loading)return;loading=true;try{const url=data.chains?"/api/status":"/api/backbone",response=await fetch(url,{cache:"no-store"});if(!response.ok)throw new Error(`HTTP ${response.status}`);const incoming=await response.json();if(!data.chains||incoming.cache_revision!==renderedRevision){const full=data.chains?await fetch("/api/backbone",{cache:"no-store"}):null;if(full&&!full.ok)throw new Error(`HTTP ${full.status}`);data=full?await full.json():incoming;renderedRevision=data.cache_revision;renderAll();}else{Object.assign(data,incoming);renderSummary();renderMeta();setStatus();}}catch(error){$id("status-pill").textContent="server unavailable";$id("status-pill").className="pill stale";console.error(error);}finally{loading=false;}}
  $id("refresh-button").onclick=async function(){this.disabled=true;this.textContent="↻ refreshing…";try{await fetch("/api/refresh",{method:"POST"});setTimeout(load,700);}finally{setTimeout(()=>{this.disabled=false;this.innerHTML='<span aria-hidden="true">↻</span><span class="refresh-label"> refresh</span>';},1200);}};
  addEventListener("hashchange",()=>switchView(location.hash.slice(1),false));addEventListener("resize",()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(renderCharts,140);});document.addEventListener("visibilitychange",()=>{if(!document.hidden)load();});switchView(location.hash.slice(1)||"overview",false);load();setInterval(()=>{if(!document.hidden)load();},10000);
})();
