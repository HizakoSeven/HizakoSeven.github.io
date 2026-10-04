/* Barra de acoes da aba Partidas que "sobe" pra barra do topo quando a toolbar sai da tela.
   Move os PROPRIOS elementos (nao duplica): ids, listeners e o que estiver digitado continuam valendo.
   So vale enquanto a aba Partidas esta ativa. */

var grupo = null, ancora = null, slot = null, toolbar = null, observer = null;
var noTopo = false;

function porId(id){ return document.getElementById(id); }

function abaAtiva(){
  var aba = porId('tab-partidas');
  return !!aba && aba.classList.contains('active');
}

function alturaTopbar(){
  var v = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h'), 10);
  return (v>0 ? v : 52) + 4; /* + a faixa colorida de 3px */
}

function subir(){
  if(noTopo) return;
  /* menu aberto nao viaja junto: fecha antes pra o painel nao "pular" de lugar */
  Array.prototype.forEach.call(grupo.querySelectorAll('details[open]'), function(d){ d.open = false; });
  var ativo = document.activeElement;
  var tinhaFoco = !!ativo && grupo.contains(ativo);
  slot.appendChild(grupo);
  Array.prototype.forEach.call(grupo.querySelectorAll('details.popover'), function(d){ d.classList.add('tb-pop'); });
  grupo.classList.add('em-topo');
  noTopo = true;
  if(tinhaFoco && ativo.focus) ativo.focus({ preventScroll:true });
}

function descer(){
  if(!noTopo) return;
  Array.prototype.forEach.call(grupo.querySelectorAll('details[open]'), function(d){ d.open = false; });
  var ativo = document.activeElement;
  var tinhaFoco = !!ativo && grupo.contains(ativo);
  ancora.after(grupo); /* a ancora ficou exatamente onde o grupo estava */
  Array.prototype.forEach.call(grupo.querySelectorAll('details.popover'), function(d){ d.classList.remove('tb-pop'); });
  grupo.classList.remove('em-topo');
  noTopo = false;
  if(tinhaFoco && ativo.focus) ativo.focus({ preventScroll:true });
}

function aoObservar(entries){
  var e = entries[entries.length-1];
  if(!e) return;
  if(!abaAtiva()){ descer(); return; }
  /* saiu da area visivel POR CIMA (rolou pra baixo): sobe; voltou a aparecer: desce */
  if(!e.isIntersecting && e.boundingClientRect.bottom <= alturaTopbar()) subir();
  else descer();
}

/* Chamado quando troca de aba: fora da aba Partidas os botoes voltam pro lugar; ao entrar, reavalia. */
export function reavaliarBarraTopo(){
  if(!observer) return;
  if(!abaAtiva()){ descer(); return; }
  observer.unobserve(toolbar);
  observer.observe(toolbar); /* dispara uma leitura nova do estado atual */
}

export function devolverBarraTopo(){ descer(); }

export function iniciarBarraTopo(){
  grupo = porId('partidasAcoes');
  ancora = porId('partidasAcoesAncora');
  slot = porId('tbContextual');
  toolbar = porId('partidasToolbar');
  if(!grupo || !ancora || !slot || !toolbar || typeof IntersectionObserver==='undefined') return; /* sem suporte: fica tudo na toolbar, funciona igual */
  observer = new IntersectionObserver(aoObservar, { rootMargin: '-'+alturaTopbar()+'px 0px 0px 0px', threshold:[0] });
  observer.observe(toolbar);
}
