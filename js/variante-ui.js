/* Modo variante no viewer da aba Partidas: jogar lances diferentes dos da partida (ou seguir uma linha do motor),
   com barra e setas avaliando ao vivo cada posicao. A variante e EFEMERA (state.variante) e SOME ao voltar
   a posicao de ruptura (← no inicio, Home, Esc ou "Voltar a partida"), ao clicar noutro lance da partida,
   ao trocar/fechar a partida. A logica de lances fica em variante.js (pura). */
import { boardSquaresHTML } from './board.js';
import { stepTo } from './partidas.js';
import { atualizarVisualPosicao, fenAtual } from './posicao-visual.js';
import { state } from './state.js';
import { aplicarLinha, criarVariante, destinosLegais, ehPromocao, ehProximoLanceReal, irPara, jogarLance, tokensDaLinha } from './variante.js';
import { escapeHtml, showToast, wrapArray } from './utils.js';

var sel = null;   /* peca selecionada: { from, destinos } */
var promo = null; /* promocao aguardando a escolha da peca: { from, to } */

function $(id){ return document.getElementById(id); }
function jogoAberto(){ return state.partidas.find(function(g){ return g.id===state.openGameId; }) || null; }

export function varianteAtiva(){
  return !!(state.variante && state.variante.gameId===state.openGameId);
}

/* ---------- desenho ---------- */
function pintarTabuleiro(game){
  var boardEl = $('boardEl');
  if(!boardEl) return;
  var emVar = varianteAtiva(), v = state.variante, fen, last;
  if(emVar){ fen = v.fens[v.cursor]; last = v.cursor>0 ? v.lances[v.cursor-1] : null; }
  else { fen = game.fens[state.currentPly]; last = state.currentPly>0 ? game.applied[state.currentPly-1] : null; }
  var extra = {};
  if(sel){ extra[sel.from] = 'selected'; sel.destinos.forEach(function(d){ extra[d.to] = 'legal-move'; }); }
  if(promo) extra[promo.from] = 'selected';
  boardEl.innerHTML = boardSquaresHTML(fen, last, state.boardFlipped, extra);
  boardEl.classList.toggle('em-variante', emVar);
}

function rotuloBase(v){
  var campos = String(v.fens[0]).split(' ');
  var n = parseInt(campos[5], 10) || 1;
  return campos[1]==='b' ? n+'...' : n+'.';
}

function pintarFaixa(){
  var faixa = $('varFaixa'), linha = $('varLinha'), btn = $('varBtn');
  var ativa = varianteAtiva();
  if(btn){ btn.setAttribute('aria-pressed', ativa ? 'true' : 'false'); btn.classList.toggle('ativo', ativa); }
  if(!faixa) return;
  faixa.hidden = !ativa;
  if(!ativa || !linha){ if(linha) linha.innerHTML = ''; return; }
  var v = state.variante;
  if(!v.lances.length){
    linha.innerHTML = '<span class="var-dica">a partir do lance '+escapeHtml(rotuloBase(v))+' — jogue um lance no tabuleiro</span>';
    return;
  }
  var tokens = tokensDaLinha(v);
  linha.innerHTML = '<span class="var-dica">a partir de '+escapeHtml(rotuloBase(v))+':</span>'+tokens.map(function(t, i){
    return '<span class="var-lance'+(v.cursor===i+1 ? ' atual' : '')+'" data-i="'+(i+1)+'" role="button" tabindex="0">'+escapeHtml(t)+'</span>';
  }).join(' '); /* espaco entre os lances: leitores de tela e copiar/colar leem "2.d4 d5" */
}

function pintarPromo(game){
  var el = $('varPromo');
  if(!el) return;
  if(!promo){ el.hidden = true; el.innerHTML = ''; return; }
  var cor = String(fenAtual(game)).split(' ')[1]==='b' ? 'b' : 'w';
  el.hidden = false;
  el.innerHTML = ['q','r','b','n'].map(function(p){
    return '<button type="button" class="btn btn-ghost" data-promo="'+p+'" title="Promover"><img src="pieces/'+cor+p.toUpperCase()+'.svg" alt="'+p+'"></button>';
  }).join('');
}

/* Redesenha tudo da variante (tabuleiro, faixa, texto, barra e setas). */
export function renderVariante(game){
  game = game || jogoAberto();
  if(!game) return;
  pintarTabuleiro(game);
  pintarFaixa();
  pintarPromo(game);
  var status = $('moveStatus');
  if(status){
    var v = state.variante;
    status.dataset.base = varianteAtiva() ? 'Variante · '+(v.cursor>0 ? tokensDaLinha(v)[v.cursor-1] : 'posição de partida') : status.dataset.base;
    status.textContent = status.dataset.base;
  }
  atualizarVisualPosicao(game); /* barra/setas ao vivo na posicao da variante (e avisa a aba Analise) */
}

/* ---------- entrar / sair ---------- */
/* Descarta a variante SEM redesenhar a partida (quem chama cuida do redesenho: stepTo, openGame, closeGame). */
export function descartarVariante(){
  state.variante = null;
  sel = null; promo = null;
  var b = $('boardEl'); if(b) b.classList.remove('em-variante');
  pintarFaixa();
  pintarPromo(null);
}

/* Voltar ao ponto de ruptura: a variante some e a partida real reaparece naquele lance. */
export function sairDaVariante(){
  var base = state.variante ? state.variante.basePly : state.currentPly;
  descartarVariante();
  stepTo(base);
}

export function entrarVarianteVazia(){
  var g = jogoAberto();
  if(!g) return;
  if(varianteAtiva()){ sairDaVariante(); return; } /* o botao alterna */
  state.variante = criarVariante(g.id, state.currentPly, g.fens[state.currentPly]);
  sel = null; promo = null;
  renderVariante(g);
}

/* "▶ explorar": aplica a linha (UCI) a partir da posicao atual (da partida ou do cursor da variante). */
export function explorarLinha(game, uciList){
  game = game || jogoAberto();
  if(!game || !uciList || !uciList.length) return;
  var base = varianteAtiva() ? state.variante : criarVariante(game.id, state.currentPly, game.fens[state.currentPly]);
  var n = aplicarLinha(base, uciList);
  if(n.lances.length===base.lances.length && n.cursor===base.cursor){ showToast('Não consegui aplicar essa linha.'); return; }
  state.variante = n;
  sel = null; promo = null;
  renderVariante(game);
}

/* Teclado e botoes de navegacao. Devolve true se a variante tratou o comando (senao a partida trata). */
export function navegarVariante(acao){
  if(!varianteAtiva()) return false;
  var v = state.variante, g = jogoAberto();
  if(acao==='inicio'){ sairDaVariante(); return true; }
  if(acao==='ant'){
    if(v.cursor===0){ sairDaVariante(); return true; } /* de volta a ruptura: a variante some */
    state.variante = irPara(v, v.cursor-1);
  } else if(acao==='prox'){
    state.variante = irPara(v, v.cursor+1);
  } else if(acao==='fim'){
    state.variante = irPara(v, v.lances.length);
  } else return true;
  sel = null; promo = null;
  renderVariante(g);
  return true;
}

/* ---------- lances no tabuleiro ---------- */
function efetivar(from, to, promocao){
  var g = jogoAberto();
  if(!g) return;
  sel = null; promo = null;
  if(!varianteAtiva()){
    /* na partida: jogar o PROXIMO lance real so avanca; qualquer outro vira variante */
    if(ehProximoLanceReal(g, state.currentPly, from, to, promocao)){ stepTo(state.currentPly+1); return; }
    var nova = jogarLance(criarVariante(g.id, state.currentPly, g.fens[state.currentPly]), from, to, promocao);
    if(!nova){ pintarTabuleiro(g); pintarPromo(g); return; }
    state.variante = nova;
  } else {
    var seg = jogarLance(state.variante, from, to, promocao);
    if(!seg){ pintarTabuleiro(g); pintarPromo(g); return; }
    state.variante = seg;
  }
  renderVariante(g);
}

function tentarLance(from, to, destinos){
  var g = jogoAberto();
  if(!g) return;
  if(ehPromocao(destinos, to)){
    promo = { from:from, to:to };
    sel = null;
    pintarTabuleiro(g); pintarPromo(g);
    return;
  }
  efetivar(from, to, undefined);
}

function aoClicarCasa(sq){
  var g = jogoAberto();
  if(!g) return;
  var fen = fenAtual(g);
  if(sel){
    var alvo = sel.destinos.filter(function(d){ return d.to===sq; });
    if(alvo.length){ tentarLance(sel.from, sq, sel.destinos); return; }
  }
  var ds = destinosLegais(fen, sq);
  sel = ds.length ? { from:sq, destinos:ds } : null;
  pintarTabuleiro(g);
}

function cancelarSelecao(){
  if(!sel && !promo) return;
  sel = null; promo = null;
  var g = jogoAberto();
  if(g){ pintarTabuleiro(g); pintarPromo(g); }
}

/* Limpa selecao/promocao pendentes (o stepTo chama ao trocar de lance). */
export function limparSelecaoTabuleiro(){ sel = null; promo = null; pintarPromo(null); }

/* Clique e arrastar-e-soltar no tabuleiro do viewer (chamado a cada renderViewer: o #boardEl e novo). */
export function ligarTabuleiroInterativo(){
  var boardEl = $('boardEl');
  if(!boardEl) return;
  var drag = null;
  boardEl.addEventListener('dragstart', function(e){ e.preventDefault(); });

  function sqSobPonto(x, y){
    var el = document.elementFromPoint ? document.elementFromPoint(x, y) : null;
    var sqEl = el && el.closest ? el.closest('.sq') : null;
    return (sqEl && boardEl.contains(sqEl)) ? sqEl : null;
  }
  function encerrar(){
    if(drag){
      if(drag.ghost && drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
      if(drag.imgOrig) drag.imgOrig.style.opacity = '';
    }
    boardEl.classList.remove('arrastando');
    wrapArray(boardEl.querySelectorAll('.sq.drag-over')).forEach(function(x){ x.classList.remove('drag-over'); });
    drag = null;
  }

  boardEl.addEventListener('pointerdown', function(ev){
    if(ev.pointerType==='mouse' && ev.button!==0) return;
    var g = jogoAberto();
    if(!g) return;
    if(promo){ cancelarSelecao(); return; } /* clicar no tabuleiro com a escolha de peca aberta cancela */
    var sqEl = ev.target.closest ? ev.target.closest('.sq') : null;
    if(!sqEl) return;
    var destinos = destinosLegais(fenAtual(g), sqEl.dataset.sq);
    drag = { sq:sqEl.dataset.sq, sqEl:sqEl, x0:ev.clientX, y0:ev.clientY, moved:false, destinos:destinos, ghost:null, imgOrig:null, gw:0, gh:0, id:ev.pointerId };
    try{ boardEl.setPointerCapture(ev.pointerId); }catch(e){}
  });

  boardEl.addEventListener('pointermove', function(ev){
    if(!drag || ev.pointerId!==drag.id || !drag.destinos.length) return;
    if(!drag.moved){
      if(Math.abs(ev.clientX-drag.x0)+Math.abs(ev.clientY-drag.y0) < 6) return;
      drag.moved = true;
      var img = drag.sqEl.querySelector('.piece-icon');
      if(img){
        var r = img.getBoundingClientRect();
        var gh = img.cloneNode(true);
        gh.style.cssText = 'position:fixed;left:0;top:0;margin:0;pointer-events:none;z-index:1000;width:'+r.width+'px;height:'+r.height+'px;';
        document.body.appendChild(gh);
        drag.ghost = gh; drag.gw = r.width; drag.gh = r.height;
        img.style.opacity = '0.3'; drag.imgOrig = img;
      }
      wrapArray(boardEl.querySelectorAll('.sq.selected, .sq.legal-move')).forEach(function(el){ el.classList.remove('selected'); el.classList.remove('legal-move'); });
      drag.sqEl.classList.add('selected');
      drag.destinos.forEach(function(d){ var el = boardEl.querySelector('[data-sq="'+d.to+'"]'); if(el) el.classList.add('legal-move'); });
      boardEl.classList.add('arrastando');
    }
    if(drag.ghost) drag.ghost.style.transform = 'translate('+(ev.clientX-drag.gw/2)+'px,'+(ev.clientY-drag.gh/2)+'px)';
    wrapArray(boardEl.querySelectorAll('.sq.drag-over')).forEach(function(x){ x.classList.remove('drag-over'); });
    var alvoEl = sqSobPonto(ev.clientX, ev.clientY);
    if(alvoEl) alvoEl.classList.add('drag-over');
  });

  boardEl.addEventListener('pointerup', function(ev){
    if(!drag || ev.pointerId!==drag.id) return;
    var d = drag;
    var alvoEl = sqSobPonto(ev.clientX, ev.clientY);
    var alvo = alvoEl ? alvoEl.dataset.sq : null;
    encerrar();
    if(!d.moved){ aoClicarCasa(d.sq); return; } /* foi so um clique */
    if(alvo && d.destinos.some(function(x){ return x.to===alvo; })){ tentarLance(d.sq, alvo, d.destinos); return; }
    sel = (alvo===d.sq) ? { from:d.sq, destinos:d.destinos } : null;
    var g = jogoAberto();
    if(g) pintarTabuleiro(g);
  });

  boardEl.addEventListener('pointercancel', function(){
    if(!drag) return;
    encerrar();
    var g = jogoAberto();
    if(g) pintarTabuleiro(g);
  });
}

/* Faixa, botao "Variante" e escolha de peca (criados em renderViewer). */
export function ligarControlesVariante(){
  var sair = $('varSairBtn');
  if(sair) sair.addEventListener('click', function(){ sairDaVariante(); });
  var ant = $('varAntBtn');
  if(ant) ant.addEventListener('click', function(){ navegarVariante('ant'); });
  var prox = $('varProxBtn');
  if(prox) prox.addEventListener('click', function(){ navegarVariante('prox'); });
  var btn = $('varBtn');
  if(btn) btn.addEventListener('click', function(){ entrarVarianteVazia(); });
  var linha = $('varLinha');
  if(linha){
    function irAoLance(el){
      var i = el && el.dataset ? parseInt(el.dataset.i, 10) : NaN;
      if(!isFinite(i) || !varianteAtiva()) return;
      state.variante = irPara(state.variante, i);
      sel = null; promo = null;
      renderVariante();
    }
    linha.addEventListener('click', function(e){ irAoLance(e.target.closest ? e.target.closest('.var-lance') : null); });
    linha.addEventListener('keydown', function(e){
      if(e.key!=='Enter' && e.key!==' ') return;
      var el = e.target.closest ? e.target.closest('.var-lance') : null;
      if(el){ e.preventDefault(); irAoLance(el); }
    });
  }
  var pr = $('varPromo');
  if(pr) pr.addEventListener('click', function(e){
    var b = e.target.closest ? e.target.closest('[data-promo]') : null;
    if(!b || !promo) return;
    efetivar(promo.from, promo.to, b.dataset.promo);
  });
  pintarFaixa();
}
