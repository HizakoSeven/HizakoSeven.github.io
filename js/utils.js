/* Utilitarios genericos: datas, escape de HTML, toast. Sem dependencia de `state`. */

export function todayStr(d){
  d = d || new Date();
  var y = d.getFullYear();
  var m = String(d.getMonth()+1).padStart(2,'0');
  var day = String(d.getDate()).padStart(2,'0');
  return y+'-'+m+'-'+day;
}

export function addDaysStr(dateStr, n){
  var parts = dateStr.split('-').map(Number);
  var dt = new Date(parts[0], parts[1]-1, parts[2]);
  dt.setDate(dt.getDate()+n);
  return todayStr(dt);
}

export function formatPtDate(dateStr){
  if(!dateStr) return '';
  var parts = dateStr.split('-');
  if(parts.length!==3) return dateStr;
  return parts[2]+'/'+parts[1]+'/'+parts[0];
}

export function pluralDias(n){ return n===1 ? '1 dia' : n+' dias'; }

export function escapeHtml(str){
  return String(str===undefined||str===null?'':str).replace(/[&<>"']/g, function(ch){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
  });
}

export function wrapArray(nodeList){ return Array.prototype.slice.call(nodeList); }

export var toastTimer = null;

export function showToast(msg){
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ el.hidden = true; }, 2600);
}
