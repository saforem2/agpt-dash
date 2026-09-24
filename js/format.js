function fmtStep(s){ return s.toLocaleString(); }
function fmtScore(v){ return (v==null)?"—":(v>=0.0001 ? v.toFixed(4) : v.toExponential(2)); }
function fmtRate(v){ return (v==null)?"—":v.toFixed(2)+"%"; }
