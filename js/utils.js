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

/* Navegacao por teclado de um tablist (padrao ARIA): setas/Home/End movem o foco e ativam a aba.
   Para a propagacao de proposito: sem isso o atalho global de setas (navegar lances) dispararia junto. */
export function tecladoDeTablist(tablist, seletorAba, aoAtivar){
  if(!tablist) return;
  tablist.addEventListener('keydown', function(e){
    if(e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    var abas = wrapArray(tablist.querySelectorAll(seletorAba));
    var atual = e.target && e.target.closest ? e.target.closest(seletorAba) : null;
    var i = abas.indexOf(atual);
    if(i===-1) return;
    var n = abas.length, destino;
    if(e.key==='ArrowRight') destino = (i+1)%n;
    else if(e.key==='ArrowLeft') destino = (i-1+n)%n;
    else if(e.key==='Home') destino = 0;
    else if(e.key==='End') destino = n-1;
    else return;
    e.preventDefault();
    e.stopPropagation();
    abas[destino].focus();
    aoAtivar(abas[destino]);
  });
}

/* Depois de clicar numa aba com o mouse, solta o foco: assim as setas voltam a navegar os lances.
   Ativada pelo teclado (detail===0) o foco fica, como manda o padrao ARIA. */
export function soltarFocoAposClique(e){
  if(e && e.detail>0 && e.currentTarget && e.currentTarget.blur) e.currentTarget.blur();
}
