const CHART_COLORS_LIGHT = ["#4c78a8","#e45756","#54a24b","#f58518","#8f6db0","#72b7b2","#d45087","#9d755d","#6b778d","#c49a00","#7a5195","#2f8f83"];
const CHART_COLORS_DARK = ["#6ea8dc","#ff7b7b","#7bc96f","#ffa94d","#b99add","#75d5ce","#ff87b2","#d0a275","#a6b0c3","#f0c84b","#c7a0dc","#5fd0c8"];

const chartDark = () => document.body.classList.contains("dark");
const chartColor = index => (chartDark() ? CHART_COLORS_DARK : CHART_COLORS_LIGHT)[index % CHART_COLORS_LIGHT.length];
const chartAxis = label => ({
  label,
  stroke: chartDark() ? "#aeb4bf" : "#5d626c",
  grid:{stroke:chartDark() ? "#2c313a" : "#e3e6eb"},
  ticks:{stroke:chartDark() ? "#3a3f49" : "#c7ccd4"},
});

function percentileRange(columns){
  const values = columns.flatMap(column=>column.filter(value=>value != null && Number.isFinite(value))).sort((a,b)=>a-b);
  if(values.length < 20) return null;
  const low = values[Math.floor(values.length*.01)], high = values[Math.floor(values.length*.99)];
  if(!(high > low)) return null;
  const pad = (high-low)*.05;
  return [low-pad, high+pad];
}

function scoreRange(columns){
  const values = columns.flatMap(column=>column.filter(value=>value != null && Number.isFinite(value)));
  if(!values.length) return [0,1];
  const dataLow=Math.min(...values), dataHigh=Math.max(...values);
  const span=Math.max(.05,(dataHigh-dataLow)*1.2), middle=(dataLow+dataHigh)/2;
  let low=middle-span/2, high=middle+span/2;
  if(low<0){high-=low;low=0;} if(high>1){low-=high-1;high=1;}
  return [Math.max(0,low),Math.min(1,high)];
}

function multiSeriesChart(el, label, items, options={}){
  const prepared=(items||[]).filter(item=>Array.isArray(item.data)&&item.data.length>1);
  el.innerHTML="";
  if(!prepared.length){el.innerHTML='<div class="empty-state">No data available.</div>';return null;}
  const steps=[...new Set(prepared.flatMap(item=>item.data.map(point=>point[0])))].sort((a,b)=>a-b);
  const columns=[steps];
  for(const item of prepared){
    const values=new Map(item.data);
    columns.push(steps.map(step=>{
      const value=values.has(step)?values.get(step):null;
      return options.logY && !(value>0) ? null : value;
    }));
  }
  const clipped=options.clip ? percentileRange(columns.slice(1)) : null;
  const fixed=typeof options.range==="function" ? options.range(columns.slice(1)) : options.range;
  const xLabel=options.progressAxis ? "run progress (%)" : options.tokensAxis ? "tokens seen (billions)" : "training step (cumulative)";
  let tooltip=null;
  const showTooltip=(u,seriesIndex,dataIndex)=>{
    if(!options.tooltip||seriesIndex<1||dataIndex==null||columns[seriesIndex]?.[dataIndex]==null){if(tooltip)tooltip.hidden=true;return;}
    const item=prepared[seriesIndex-1],x=columns[0][dataIndex],value=columns[seriesIndex][dataIndex];
    if(!tooltip){tooltip=document.createElement("div");tooltip.className="chart-tooltip";tooltip.hidden=true;el.appendChild(tooltip);}
    tooltip.innerHTML=options.tooltip(item,x,value);
    tooltip.hidden=false;
    const left=Math.min(el.clientWidth-tooltip.offsetWidth-8,Math.max(8,u.cursor.left+12));
    const top=Math.min(el.clientHeight-tooltip.offsetHeight-8,Math.max(8,u.cursor.top+12));
    tooltip.style.left=`${left}px`;tooltip.style.top=`${top}px`;
  };
  return new uPlot({
    width:Math.max(260,Math.floor(options.width||el.clientWidth||640)),
    height:options.height||320,
    title:options.title||label,
    series:[{label:xLabel},...prepared.map(item=>({
      label:item.label, stroke:item.color, width:item.live?2.6:1.6,
      alpha:item.live?1:.68, spanGaps:true, points:{show:!!options.points,size:4},
    }))],
    axes:[
      {...chartAxis(options.compact?"":xLabel),size:options.compact?30:50},
      {...chartAxis(options.compact?"":label),...(options.scientific?{values:(u,ticks)=>ticks.map(value=>value==null?"":value.toExponential(2)),size:62}:{})},
    ],
    scales:{x:{time:false},y:{distr:options.logY?3:1,...((fixed||clipped)?{range:fixed||clipped}:{})}},
    legend:{show:false}, cursor:{focus:{prox:10}},
    hooks:{setCursor:[u=>{
      if(!options.tooltip)return;
      let closest=-1,distance=Infinity;
      for(let i=1;i<u.series.length;i++){
        const idx=u.cursor.idx,value=idx==null?null:columns[i]?.[idx];
        if(value==null)continue;
        const y=u.valToPos(value,"y"),delta=Math.abs(y-u.cursor.top);
        if(delta<distance){distance=delta;closest=i;}
      }
      showTooltip(u,closest,u.cursor.idx);
    }]},
  },columns,el);
}
