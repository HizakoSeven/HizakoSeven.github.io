/* Preferencias de interface, guardadas so neste navegador (nao entram no backup dos dados):
   modo compacto, quais secoes recolhiveis estao abertas, e os menus "popover" que abrem por cima da pagina. */
import { wrapArray } from './utils.js';

var CHAVE = 'caderno-ui-v1';
var prefs = { compacto:false, abertos:{} };

function ler(){
  try{
    var raw = localStorage.getItem(CHAVE);
    if(!raw) return;
    var p = JSON.parse(raw);
    if(p && typeof p==='object'){
      prefs.compacto = !!p.compacto;
      prefs.abertos = (p.abertos && typeof p.abertos==='object') ? p.abertos : {};
    }
  }catch(e){ /* armazenamento bloqueado ou corrompido: segue com o padrao */ }
}

function gravar(){
  try{ localStorage.setItem(CHAVE, JSON.stringify(prefs)); }catch(e){}
}

export function aplicarCompacto(valor){
  prefs.compacto = !!valor;
  document.body.classList.toggle('compacto', prefs.compacto);
  var btn = document.getElementById('compactBtn');
  if(btn) btn.setAttribute('aria-pressed', prefs.compacto ? 'true' : 'false');
}

/* secoes que o usuario pode abrir/fechar e que o app lembra */
function secoesRecolhiveis(escopo){
  return wrapArray((escopo || document).querySelectorAll('details.fold, #tab-plano > details'));
}

export function fecharPopovers(exceto){
  wrapArray(document.querySelectorAll('details.popover[open]')).forEach(function(d){
    if(d!==exceto) d.open = false;
  });
}

/* Recolhe tudo na aba atual; se ja estiver tudo recolhido, expande tudo. */
export function alternarSecoesDaAba(){
  var aba = document.querySelector('.tab-panel.active');
  var lista = secoesRecolhiveis(aba);
  if(!lista.length) return;
  var algumaAberta = lista.some(function(d){ return d.open; });
  lista.forEach(function(d){ d.open = !algumaAberta; });
}

export function iniciarUI(){
  ler();
  aplicarCompacto(prefs.compacto);

  var contagemPorAba = {};
  secoesRecolhiveis().forEach(function(d){
    var aba = d.closest('.tab-panel');
    var abaId = aba ? aba.id : 'pagina';
    if(!d.id){
      contagemPorAba[abaId] = (contagemPorAba[abaId]||0) + 1;
      d.id = 'sec-'+abaId+'-'+contagemPorAba[abaId];
    }
    if(Object.prototype.hasOwnProperty.call(prefs.abertos, d.id)) d.open = !!prefs.abertos[d.id];
    d.addEventListener('toggle', function(){ prefs.abertos[d.id] = d.open; gravar(); });
  });

  var compactBtn = document.getElementById('compactBtn');
  if(compactBtn) compactBtn.addEventListener('click', function(){ aplicarCompacto(!prefs.compacto); gravar(); });
  var foldBtn = document.getElementById('foldAllBtn');
  if(foldBtn) foldBtn.addEventListener('click', alternarSecoesDaAba);

  /* menus popover: um aberto por vez; clique fora ou Esc fecham */
  wrapArray(document.querySelectorAll('details.popover')).forEach(function(d){
    d.addEventListener('toggle', function(){ if(d.open) fecharPopovers(d); });
  });
  document.addEventListener('click', function(e){
    wrapArray(document.querySelectorAll('details.popover[open]')).forEach(function(d){
      if(!d.contains(e.target)) d.open = false;
    });
  });
  document.addEventListener('keydown', function(e){
    if(e.key!=='Escape') return;
    var aberto = document.querySelector('details.popover[open]');
    if(!aberto) return;
    aberto.open = false;
    var sum = aberto.querySelector('summary');
    if(sum) sum.focus();
  });
}
