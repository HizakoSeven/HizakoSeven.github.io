/* Revisao espacada dos erros catalogados - modo simples e modo com motor. */
import { classificarLanceCompleto, materialBalance, normalizarAvaliacao, pctBarraDeCp, pvParaSan } from './analysis.js';
import { boardSquaresHTML, setasSVG } from './board.js';
import { avaliarFEN, engineState } from './engine.js';
import { persist } from './persistence.js';
import { renderErros, tipoLabel } from './render-erros.js';
import { renderHeaderStats } from './render-hoje.js';
import { REVISAO_ACERTOS_PARA_DOMINAR, aplicarRespostaRevisao, listarAgendados, ordenarVencidos, proximaRevisaoDe } from './revisao-agenda.js';
import { presetAtual, state } from './state.js';
import { escapeHtml, formatPtDate, showToast, todayStr, wrapArray } from './utils.js';

export function sincronizarControlesMotor(){
  var mapa = { multiPv:'multiPv', movetimeMs:'movetimeMs', hashMb:'hashMb', depthAnalise:'depthAnalise' };
  wrapArray(document.querySelectorAll('[data-cfg]')).forEach(function(sel){
    var valor = state.motorConfig[mapa[sel.dataset.cfg]];
    if(valor!==undefined && valor!==null) sel.value = String(valor);
  });
  var ativo = presetAtual();
  wrapArray(document.querySelectorAll('[data-preset]')).forEach(function(btn){
    var on = btn.dataset.preset===ativo;
    btn.classList.toggle('btn-primary', on);
    btn.classList.toggle('btn-ghost', !on);
  });
  wrapArray(document.querySelectorAll('.preset-status')).forEach(function(el){
    el.textContent = ativo ? '' : 'personalizado';
  });
}

export function aoTeclaRevisao(e){
  if(state.activeTab!=='revisar') return;
  var alvo = document.activeElement;
  if(alvo && ['INPUT','TEXTAREA','SELECT'].indexOf(alvo.tagName)!==-1) return;

  var btnAnt = document.getElementById('revNavAnt');
  var btnProx = document.getElementById('revNavProx');
  var btnRevelar = document.getElementById('revRevelarBtn');
  var btnPular = document.getElementById('revPularBtn');
  var btnErrei = document.getElementById('revErreiBtn');
  var btnAcertei = document.getElementById('revAcerteiBtn');
  var btnTentarDeNovo = document.getElementById('revTentarDeNovoBtn');
  var btnProxima = document.getElementById('revProximaBtn');
  var botoesPromo = wrapArray(document.querySelectorAll('[data-promo]'));

  if(e.key==='ArrowLeft'){ if(btnAnt && !btnAnt.disabled){ e.preventDefault(); btnAnt.click(); } return; }
  if(e.key==='ArrowRight'){ if(btnProx && !btnProx.disabled){ e.preventDefault(); btnProx.click(); } return; }
  if(e.key===' '||e.key==='Enter'){ if(btnRevelar){ e.preventDefault(); btnRevelar.click(); } return; }
  if(e.key==='n'||e.key==='N'){ if(btnProxima){ e.preventDefault(); btnProxima.click(); } return; }
  if(e.key==='r'||e.key==='R'){ if(btnTentarDeNovo){ e.preventDefault(); btnTentarDeNovo.click(); } return; }
  if(e.key==='p'||e.key==='P'){ if(btnPular){ e.preventDefault(); btnPular.click(); } return; }
  if(e.key==='Escape'){
    var ri = state.revisaoInterativa;
    if(ri.promocaoPendente || ri.selecionada){
      ri.promocaoPendente = null; ri.selecionada = null; ri.destinos = [];
      renderRevisar();
    }
    return;
  }
  if(e.key==='1'){
    if(botoesPromo.length){ e.preventDefault(); botoesPromo[0].click(); }
    else if(btnErrei){ e.preventDefault(); btnErrei.click(); }
    return;
  }
  if(e.key==='2'){
    if(botoesPromo.length>1){ e.preventDefault(); botoesPromo[1].click(); }
    else if(btnAcertei){ e.preventDefault(); btnAcertei.click(); }
    return;
  }
  if(e.key==='3'){ if(botoesPromo.length>2){ e.preventDefault(); botoesPromo[2].click(); } return; }
  if(e.key==='4'){ if(botoesPromo.length>3){ e.preventDefault(); botoesPromo[3].click(); } return; }
}

window.addEventListener('keydown', aoTeclaRevisao);

export { REVISAO_ACERTOS_PARA_DOMINAR }; /* definido em revisao-agenda.js */

export var ENGINE_PERDA_ACEITAVEL = 80; /* centipawns: ate aqui, conta como acerto */

export function erroTemTabuleiroRevisavel(en){
  if(!en.gameId || !en.ply) return false;
  var g = state.partidas.find(function(x){ return x.id===en.gameId; });
  if(!g || !g.fens || !g.applied) return false;
  return g.fens[en.ply-1]!==undefined && g.fens[en.ply]!==undefined && g.applied[en.ply-1]!==undefined;
}

/* Fila de hoje: so os erros que venceram (ver revisao-agenda.js). */
export function erroPendentesRevisao(){
  return ordenarVencidos(state.erros, todayStr());
}

/* Erros ainda nao dominados cuja proxima revisao esta no futuro. */
export function erroAgendados(){
  return listarAgendados(state.erros, todayStr());
}

function filaResumoTexto(totalVencidos){
  var ag = erroAgendados().length;
  return totalVencidos+' para revisar hoje'+(ag ? ' · '+ag+' agendado'+(ag===1?'':'s') : '');
}

/* Aviso quando o erro mostrado ainda nao venceu: acertar nao avanca o contador. */
function avisoAntecipadoHTML(en, resultado){
  var p = proximaRevisaoDe(en);
  if(resultado || en.resolvido || !p || p<=todayStr()) return '';
  return '<p class="ci-sub" style="margin:-6px 0 12px;">Treino antecipado: esse erro só vence em '+escapeHtml(formatPtDate(p))+'. Acertar agora não avança o contador.</p>';
}

export function escolherProximaRevisao(excluirId){
  var lista = erroPendentesRevisao();
  if(lista.length===0) return null;
  if(excluirId && lista.length>1){
    var semAtual = lista.filter(function(e){ return e.id!==excluirId; });
    if(semAtual.length>0) return semAtual[0].id;
  }
  return lista[0].id;
}

export function resetRevisaoInterativa(){
  state.revisaoInterativa = { selecionada:null, destinos:[], promocaoPendente:null, avaliando:false, refInfo:null, refLinhas:null, refBestUci:null, resultado:null, jaContado:false, cursorPly:null, timeline:'jogo', linhaMotor:null, animarProximaRenderizacao:true };
}

export function resetTentativaRevisao(){
  var ri = state.revisaoInterativa;
  ri.selecionada=null; ri.destinos=[]; ri.promocaoPendente=null; ri.avaliando=false;
  ri.refInfo=null; ri.refLinhas=null; ri.refBestUci=null; ri.resultado=null;
  ri.cursorPly=null; ri.timeline='jogo'; ri.linhaMotor=null;
  ri.animarProximaRenderizacao = true;
  /* jaContado NAO reseta aqui: tentativa extra na mesma visita nao conta de novo pro streak */
}

export function renderRevisar(){
  var wrap = document.getElementById('revisarWrap');
  if(!wrap) return;

  var pendentes = erroPendentesRevisao();
  var dominados = state.erros.filter(function(e){ return e.resolvido; }).length;
  var hojeStr = todayStr();
  var revisadoHoje = state.erros.filter(function(e){
    return e.ultimaRevisaoEm && todayStr(new Date(e.ultimaRevisaoEm))===hojeStr;
  }).length;

  var elPend = document.getElementById('revPendentes');
  var elDom = document.getElementById('revDominados');
  var elHoje = document.getElementById('revHoje');
  if(elPend) elPend.textContent = pendentes.length;
  if(elDom) elDom.textContent = dominados;
  if(elHoje) elHoje.textContent = revisadoHoje;

  if(state.erros.length===0){
    wrap.innerHTML = '<div class="empty-state">Você ainda não tem erros catalogados. Registre alguns na aba Caderno de Erros ou direto numa partida — assim que tiver, eles entram automaticamente na fila de revisão.</div>';
    return;
  }

  var atualExiste = state.revisao.atualId && state.erros.some(function(e){ return e.id===state.revisao.atualId; });
  if(!atualExiste){
    state.revisao.atualId = escolherProximaRevisao(null);
    state.revisao.revelado = false;
    resetRevisaoInterativa();
  }

  if(!state.revisao.atualId){
    var naoResolvidos = state.erros.filter(function(e){ return !e.resolvido; });
    if(naoResolvidos.length===0){
      wrap.innerHTML = '<div class="empty-state">🎉 Você dominou todos os '+state.erros.length+' erros registrados ('+REVISAO_ACERTOS_PARA_DOMINAR+' acertos seguidos em cada). Continue jogando e catalogando — assim que surgir um erro novo, ele entra na fila.</div>';
      return;
    }
    var agendados = erroAgendados().sort(function(a, b){ return proximaRevisaoDe(a) < proximaRevisaoDe(b) ? -1 : 1; });
    wrap.innerHTML = '<div class="empty-state">✅ Nada vence hoje. '+agendados.length+' erro'+(agendados.length===1?'':'s')+' agendado'+(agendados.length===1?'':'s')+' — o próximo volta em '+escapeHtml(formatPtDate(proximaRevisaoDe(agendados[0])))+'. Na repetição espaçada, acerto só conta quando o erro vence; treinar antes serve de prática, mas não avança.</div>'+
      '<div class="btn-row" style="justify-content:center;margin-top:10px;"><button class="btn btn-ghost btn-sm" id="revTreinarAntecipadoBtn">Treinar mesmo assim</button></div>';
    var treinarBtn = document.getElementById('revTreinarAntecipadoBtn');
    if(treinarBtn) treinarBtn.addEventListener('click', function(){
      state.revisao.atualId = agendados[0].id;
      state.revisao.revelado = false;
      resetRevisaoInterativa();
      renderRevisar();
    });
    return;
  }

  var en = state.erros.find(function(e){ return e.id===state.revisao.atualId; });
  var game = en.gameId ? state.partidas.find(function(g){ return g.id===en.gameId; }) : null;
  var temTabuleiro = erroTemTabuleiroRevisavel(en);
  var usarMotor = temTabuleiro && engineState!=='falhou';

  if(usarMotor) renderRevisarComMotor(wrap, en, game, pendentes.length);
  else renderRevisarSimples(wrap, en, game, temTabuleiro, pendentes.length);
}

export function construirLinhaMotor(fenBase, pvUci){
  var fens = [fenBase], sans = [], ucis = [];
  try{
    var c = new Chess(fenBase);
    var limite = Math.min((pvUci||[]).length, 8);
    for(var i=0;i<limite;i++){
      var uci = pvUci[i];
      if(!uci||uci.length<4) break;
      var mv = c.move({from:uci.slice(0,2), to:uci.slice(2,4), promotion: uci.length>4?uci.slice(4,5):undefined});
      if(!mv) break;
      sans.push(mv.san); ucis.push(uci); fens.push(c.fen());
    }
  }catch(e){}
  return { fens:fens, sans:sans, uci:ucis };
}

export function renderLinhasMotorHTML(fenAntes, linhas){
  if(!linhas || linhas.length<=1) return '';
  var itens = linhas.map(function(info){
    var norm = normalizarAvaliacao(info, false);
    var sans = pvParaSan(fenAntes, info.pv||[], 5);
    return '<div class="multipv-item"><span class="mpv-eval">'+escapeHtml(norm.texto)+'</span><span>'+escapeHtml(sans.join(' '))+'</span></div>';
  }).join('');
  return '<div class="multipv-list">'+itens+'</div>';
}

export function atalhosHintHTML(pares){
  return '<p class="atalhos-hint">atalhos: '+pares.map(function(p){ return '<kbd>'+p[0]+'</kbd> '+p[1]; }).join(' &middot; ')+'</p>';
}

export function navPlyHTML(idx, max){
  return '<div class="nav-ply">'+
    '<button type="button" id="revNavAnt" '+(idx<=0?'disabled':'')+' aria-label="Lance anterior">◀</button>'+
    '<span class="nav-ply-label">lance '+idx+' / '+max+'</span>'+
    '<button type="button" id="revNavProx" '+(idx>=max?'disabled':'')+' aria-label="Próximo lance">▶</button>'+
  '</div>';
}

export function renderRevisarSimples(wrap, en, game, temTabuleiro, totalPendentes){
  var ri = state.revisaoInterativa;
  var acertos = en.acertosSeguidos||0;
  var revelado = !!state.revisao.revelado;
  var flipped = game && game.meuLado==='b';

  var progressoHtml = '<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--ink-soft);margin-bottom:4px;"><span>Rumo a dominar esse erro</span><span>'+acertos+' / '+REVISAO_ACERTOS_PARA_DOMINAR+' acertos seguidos</span></div>'+
    '<div class="progress-bar" style="margin-bottom:14px;"><div class="progress-fill" style="width:'+Math.round(acertos/REVISAO_ACERTOS_PARA_DOMINAR*100)+'%;"></div></div>'+avisoAntecipadoHTML(en, null);

  var boardHtml = '', navHtml = '';
  if(temTabuleiro){
    if(ri.cursorPly===null || ri.cursorPly===undefined) ri.cursorPly = en.ply-1;
    var maxCursor = revelado ? game.fens.length-1 : en.ply-1;
    var cursor = Math.max(0, Math.min(ri.cursorPly, maxCursor));
    ri.cursorPly = cursor;
    var lastMoveNav = cursor>0 ? game.applied[cursor-1] : null;
    boardHtml = blocoTabuleiro('', boardSquaresHTML(game.fens[cursor], lastMoveNav, flipped), null, null, flipped);
    navHtml = navPlyHTML(cursor, maxCursor);
  }

  var avisoMotor = (temTabuleiro && engineState==='falhou') ? '<p class="motor-status">Não consegui carregar o motor de xadrez (confira os arquivos em engine/) — revisão no modo simples.</p>' : '';

  var sideHtml, acoesHtml, hintPares;
  var colHtml = temTabuleiro ? boardHtml+navHtml : '';
  if(!revelado){
    sideHtml =
      '<div class="erro-top"><span class="erro-date">'+escapeHtml(formatPtDate(en.data))+'</span><span class="badge badge-'+en.tipo+'">'+tipoLabel(en.tipo)+'</span></div>'+
      progressoHtml+avisoMotor+
      (temTabuleiro
        ? '<p class="lede" style="margin-bottom:10px;">É a vez '+(flipped?'das pretas':'das brancas')+'. O que você jogaria aqui — antes de olhar o que rolou de verdade?</p>'
        : '<p class="lede" style="margin-bottom:10px;">Lembra por que esse lance foi um erro, e o que você faria diferente hoje?</p>'+
          (en.lance ? '<div class="erro-move">'+escapeHtml(en.lance)+'</div>' : ''));
    acoesHtml =
      '<button class="btn btn-primary btn-sm" id="revRevelarBtn">Revelar</button>'+
      (totalPendentes>1 ? '<button class="btn btn-ghost btn-sm" id="revPularBtn">Pular por agora</button>' : '');
    hintPares = temTabuleiro ? [['espaço/enter','revelar'],['←→','navegar'],['p','pular']] : [['espaço/enter','revelar']];
  } else {
    sideHtml =
      '<div class="erro-top"><span class="erro-date">'+escapeHtml(formatPtDate(en.data))+(en.ritmo?' · '+escapeHtml(en.ritmo):'')+(en.resultado?' · '+escapeHtml(en.resultado):'')+'</span><span class="badge badge-'+en.tipo+'">'+tipoLabel(en.tipo)+'</span></div>'+
      progressoHtml+
      (en.lance ? '<div class="erro-move">O que rolou de verdade: '+escapeHtml(en.lance)+'</div>' : '')+
      (en.contexto ? '<div style="font-family:var(--font-mono);font-size:11.5px;color:var(--ink-soft);margin-top:6px;">'+escapeHtml(en.contexto)+'</div>' : '')+
      (en.motivo ? '<div class="erro-field-label">O que eu devia ter pensado</div><div class="erro-field-val">'+escapeHtml(en.motivo)+'</div>' : '')+
      (en.padrao ? '<div class="erro-field-label">Padrão recorrente</div><div class="erro-field-val">'+escapeHtml(en.padrao)+'</div>' : '')+
      '<p class="lede" style="margin-top:14px;margin-bottom:0;">Se essa posição caísse numa partida sua hoje, você evitaria esse erro?</p>';
    acoesHtml =
      '<button class="btn btn-danger btn-sm" id="revErreiBtn">Ainda erraria</button>'+
      '<button class="btn btn-primary btn-sm" id="revAcerteiBtn">Já evito esse erro</button>';
    hintPares = temTabuleiro ? [['1','ainda erraria'],['2','já evito'],['←→','navegar']] : [['1','ainda erraria'],['2','já evito']];
  }

  var animarS = ri.animarProximaRenderizacao; ri.animarProximaRenderizacao = false;
  wrap.innerHTML = '<div class="erro-card rev-card tipo-'+en.tipo+(animarS?' revisar-anim':'')+'">'+layoutRevisaoHTML(colHtml, sideHtml, acoesHtml)+'</div>'+
    atalhosHintHTML(hintPares)+
    '<p style="font-family:var(--font-mono);font-size:11.5px;color:var(--ink-soft);margin-top:8px;">'+filaResumoTexto(totalPendentes)+(en.vezesRevisado?' · já revisado '+en.vezesRevisado+'x antes':'')+'</p>';

  var navAnt = document.getElementById('revNavAnt');
  if(navAnt) navAnt.addEventListener('click', function(){ ri.cursorPly = Math.max(0, ri.cursorPly-1); renderRevisar(); });
  var navProx = document.getElementById('revNavProx');
  if(navProx) navProx.addEventListener('click', function(){ ri.cursorPly = ri.cursorPly+1; renderRevisar(); });
  var revelarBtn = document.getElementById('revRevelarBtn');
  if(revelarBtn) revelarBtn.addEventListener('click', function(){
    state.revisao.revelado = true;
    ri.animarProximaRenderizacao = true;
    renderRevisar();
  });
  var pularBtn = document.getElementById('revPularBtn');
  if(pularBtn) pularBtn.addEventListener('click', function(){
    state.revisao.atualId = escolherProximaRevisao(en.id);
    state.revisao.revelado = false;
    resetRevisaoInterativa();
    renderRevisar();
  });
  var erreiBtn = document.getElementById('revErreiBtn');
  if(erreiBtn) erreiBtn.addEventListener('click', function(){ graduarRevisao(en.id, false); });
  var acerteiBtn = document.getElementById('revAcerteiBtn');
  if(acerteiBtn) acerteiBtn.addEventListener('click', function(){ graduarRevisao(en.id, true); });
}

/* ---------- Tabuleiro da revisao: barra de avaliacao, setas e arrastar-e-soltar ---------- */
var COR_SETA_MELHOR = '#3f8f4a';
var COR_SETA_TENTATIVA = '#e08a1e';
var COR_SETA_PARTIDA = '#c0392b';

function avalCurtoDe(norm){
  if(norm.mate!==null && norm.mate!==undefined) return 'M'+Math.abs(norm.mate);
  var v = (norm.cp||0)/100;
  return (v>=0 ? '+' : '−')+Math.abs(v).toFixed(1);
}

function setaDeUci(uci, cor){
  return (uci && uci.length>=4) ? { from:uci.slice(0,2), to:uci.slice(2,4), cor:cor } : null;
}

function barraAvaliacaoHTML(b){
  var fillCor = b.corBaixo==='w' ? '#f2f0e8' : '#2b2b2b';
  var fundo = b.corBaixo==='w' ? '#2b2b2b' : '#f2f0e8';
  var pos = b.pctBaixo>=50 ? 'bottom:3px;' : 'top:3px;';
  return '<div class="vbar" style="background:'+fundo+';" title="'+escapeHtml(b.titulo)+'" role="img" aria-label="'+escapeHtml(b.titulo+': '+b.texto)+'">'+
    '<div class="vbar-fill" style="height:'+b.pctBaixo+'%;background:'+fillCor+';"></div>'+
    '<div class="vbar-num" style="'+pos+'">'+escapeHtml(b.curto)+'</div>'+
  '</div>';
}

/* Faixa do jogador acima/abaixo do tabuleiro (igual a da aba Partidas). Mesmo sem partida vinculada ela
   ocupa o espaco, pra o tabuleiro ficar exatamente no mesmo lugar nas duas telas. */
function faixaRevisaoHTML(cor){
  var en = state.erros.find(function(e){ return e.id===state.revisao.atualId; });
  var game = en && en.gameId ? state.partidas.find(function(g){ return g.id===en.gameId; }) : null;
  if(!game) return '<div class="player-strip"></div>';
  var h = game.headers || {};
  var nome = (cor==='w' ? h.White : h.Black) || (cor==='w' ? 'Brancas' : 'Pretas');
  var elo = cor==='w' ? h.WhiteElo : h.BlackElo;
  return '<div class="player-strip"><span class="ps-dot ps-'+cor+'"></span><span class="ps-name">'+escapeHtml(nome)+'</span>'+
    (elo ? '<span class="ps-elo">'+escapeHtml(elo)+'</span>' : '')+
    (game.meuLado===cor ? '<span class="ps-me">você</span>' : '')+'</div>';
}

function blocoTabuleiro(classeExtra, squaresHtml, setas, barra, flipped){
  /* a barra de avaliacao aparece so depois da tentativa; o espaco dela e sempre reservado
     pra o tabuleiro nao mudar de tamanho nem de lugar */
  return faixaRevisaoHTML(flipped ? 'w' : 'b')+
    '<div class="board-row">'+
      (barra ? barraAvaliacaoHTML(barra) : '<div class="vbar-ph"></div>')+
      '<div class="board-wrap"><div class="board'+classeExtra+'">'+squaresHtml+'</div>'+setasSVG(setas, flipped)+'</div>'+
    '</div>'+
    faixaRevisaoHTML(flipped ? 'b' : 'w');
}

/* Estrutura comum: [tabuleiro | painel com rolagem interna + botoes de acao fixos no fundo] */
function layoutRevisaoHTML(colHtml, sideHtml, acoesHtml){
  return '<div class="game-layout rev-layout'+(colHtml?'':' sem-board')+'">'+
    (colHtml ? '<div class="game-board-col">'+colHtml+'</div>' : '')+
    '<div class="game-side"><div class="game-side-inner">'+
      '<div class="side-scroll">'+sideHtml+'</div>'+
      (acoesHtml ? '<div class="side-actions">'+acoesHtml+'</div>' : '')+
    '</div></div>'+
  '</div>';
}

/* Arrastar e soltar (mouse e toque) + clique. Nao re-renderiza durante o arraste. */
function ligarArrastarSoltar(boardEl, en, game, fenAntes){
  var ri = state.revisaoInterativa;
  var drag = null;

  boardEl.addEventListener('dragstart', function(e){ e.preventDefault(); });

  function sqSobPonto(x, y){
    var el = document.elementFromPoint(x, y);
    var sqEl = el && el.closest ? el.closest('.sq') : null;
    return (sqEl && boardEl.contains(sqEl)) ? sqEl : null;
  }
  function limparMarcas(){
    wrapArray(boardEl.querySelectorAll('.sq.selected, .sq.legal-move, .sq.drag-over')).forEach(function(el){
      el.classList.remove('selected'); el.classList.remove('legal-move'); el.classList.remove('drag-over');
    });
  }
  function encerrar(){
    if(drag){
      if(drag.ghost && drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
      if(drag.imgOrig) drag.imgOrig.style.opacity = '';
    }
    boardEl.classList.remove('arrastando');
    drag = null;
  }
  function destinosDe(legais){ return legais.map(function(m){ return { to:m.to, promotion:m.promotion }; }); }

  boardEl.addEventListener('pointerdown', function(ev){
    if(ev.pointerType==='mouse' && ev.button!==0) return;
    if(ri.avaliando || ri.resultado || ri.promocaoPendente || !ri.refInfo) return;
    var sqEl = ev.target.closest('.sq');
    if(!sqEl) return;
    var c = new Chess(fenAntes);
    var peca = c.get(sqEl.dataset.sq);
    var propria = !!(peca && peca.color===c.turn());
    drag = {
      sq: sqEl.dataset.sq, sqEl: sqEl, x0: ev.clientX, y0: ev.clientY, moved: false,
      propria: propria, legais: propria ? c.moves({ square:sqEl.dataset.sq, verbose:true }) : [],
      ghost: null, imgOrig: null, gw: 0, gh: 0, id: ev.pointerId
    };
    try{ boardEl.setPointerCapture(ev.pointerId); }catch(e){}
  });

  boardEl.addEventListener('pointermove', function(ev){
    if(!drag || ev.pointerId!==drag.id) return;
    if(!drag.propria || !drag.legais.length) return;
    if(!drag.moved){
      if(Math.abs(ev.clientX-drag.x0)+Math.abs(ev.clientY-drag.y0) < 6) return;
      drag.moved = true;
      var img = drag.sqEl.querySelector('.piece-icon');
      if(img){
        var r = img.getBoundingClientRect();
        var g = img.cloneNode(true);
        g.style.cssText = 'position:fixed;left:0;top:0;margin:0;pointer-events:none;z-index:1000;width:'+r.width+'px;height:'+r.height+'px;';
        document.body.appendChild(g);
        drag.ghost = g; drag.gw = r.width; drag.gh = r.height;
        img.style.opacity = '0.3'; drag.imgOrig = img;
      }
      limparMarcas();
      drag.sqEl.classList.add('selected');
      drag.legais.forEach(function(m){
        var el = boardEl.querySelector('[data-sq="'+m.to+'"]');
        if(el) el.classList.add('legal-move');
      });
      boardEl.classList.add('arrastando');
    }
    if(drag.ghost) drag.ghost.style.transform = 'translate('+(ev.clientX-drag.gw/2)+'px,'+(ev.clientY-drag.gh/2)+'px)';
    wrapArray(boardEl.querySelectorAll('.sq.drag-over')).forEach(function(x){ x.classList.remove('drag-over'); });
    var alvo = sqSobPonto(ev.clientX, ev.clientY);
    if(alvo) alvo.classList.add('drag-over');
  });

  boardEl.addEventListener('pointerup', function(ev){
    if(!drag || ev.pointerId!==drag.id) return;
    var d = drag;
    var alvoEl = sqSobPonto(ev.clientX, ev.clientY);
    var alvo = alvoEl ? alvoEl.dataset.sq : null;
    encerrar();
    if(!d.moved){ onCliqueCasaRevisao(d.sq, en, game, fenAntes); return; } /* foi so um clique */
    var legalAlvo = alvo ? d.legais.filter(function(m){ return m.to===alvo; }) : [];
    if(legalAlvo.length){
      ri.selecionada = d.sq;
      ri.destinos = destinosDe(d.legais);
      onCliqueCasaRevisao(alvo, en, game, fenAntes); /* cuida de promocao e de efetivar o lance */
    } else if(alvo===d.sq){
      ri.selecionada = d.sq;
      ri.destinos = destinosDe(d.legais);
      renderRevisar();
    } else {
      ri.selecionada = null; ri.destinos = [];
      renderRevisar();
    }
  });

  boardEl.addEventListener('pointercancel', function(){
    if(!drag) return;
    encerrar();
    renderRevisar();
  });
}

export function renderRevisarComMotor(wrap, en, game, totalPendentes){
  var ri = state.revisaoInterativa;
  var acertos = en.acertosSeguidos||0;
  var flipped = game.meuLado==='b';
  var pre = en.ply-1;
  var fenAntes = game.fens[pre];

  if(ri.cursorPly===null || ri.cursorPly===undefined) ri.cursorPly = pre;

  var progressoHtml = '<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--ink-soft);margin-bottom:4px;"><span>Rumo a dominar esse erro</span><span>'+acertos+' / '+REVISAO_ACERTOS_PARA_DOMINAR+' acertos seguidos</span></div>'+
    '<div class="progress-bar" style="margin-bottom:14px;"><div class="progress-fill" style="width:'+Math.round(acertos/REVISAO_ACERTOS_PARA_DOMINAR*100)+'%;"></div></div>'+avisoAntecipadoHTML(en, ri.resultado);

  if(!ri.refInfo && !ri.avaliando && !ri.resultado){
    ri.avaliando = true;
    var idAlvoRef = en.id;
    avaliarFEN(fenAntes, function(res){
      if(state.revisao.atualId!==idAlvoRef) return;
      ri.avaliando = false;
      var linhas = (res && res.linhas) || [];
      ri.refInfo = linhas[0] || {cp:0,pv:[]};
      ri.refLinhas = linhas;
      ri.refBestUci = res && res.bestmove;
      renderRevisar();
    }, { multiPv: Math.max(2, state.motorConfig.multiPv||1) });
  }

  var boardHtml, navHtml = '', cursorInfo;
  var interativo = false;
  var legendaSetas = '';

  var melhorUci = null, barraRef = null, barraSua = null;
  if(ri.resultado){
    melhorUci = ri.refBestUci || (ri.refInfo && ri.refInfo.pv && ri.refInfo.pv[0]) || null;
    var moverCor = new Chess(fenAntes).turn();
    var corBaixo = flipped ? 'b' : 'w';
    var paraBaixo = function(pctMover){
      var pctBranco = moverCor==='w' ? pctMover : 100-pctMover;
      return corBaixo==='w' ? pctBranco : 100-pctBranco;
    };
    var refNormB = normalizarAvaliacao(ri.refInfo, false);
    var refPctB = refNormB.mate!==null ? (refNormB.mate>0 ? 92 : 8) : pctBarraDeCp(refNormB.cp);
    barraRef = { pctBaixo:paraBaixo(refPctB), texto:refNormB.texto, curto:avalCurtoDe(refNormB), corBaixo:corBaixo, titulo:'Avaliação da posição com o melhor jogo' };
    barraSua = { pctBaixo:paraBaixo(ri.resultado.pctBarra), texto:ri.resultado.avalTexto, curto:ri.resultado.avalCurto || '', corBaixo:corBaixo, titulo:'Avaliação depois do seu lance' };
  }

  if(!ri.resultado){
    var maxAntes = pre;
    var cursorA = Math.max(0, Math.min(ri.cursorPly, maxAntes));
    ri.cursorPly = cursorA;
    interativo = (cursorA===pre);
    var extraClasses = {};
    var fenExib = game.fens[cursorA];
    var lastMoveExib = cursorA>0 ? game.applied[cursorA-1] : null;
    if(interativo){
      if(ri.promocaoPendente){ extraClasses[ri.promocaoPendente.from] = 'selected'; }
      else if(ri.selecionada){
        extraClasses[ri.selecionada] = 'selected';
        ri.destinos.forEach(function(d){ extraClasses[d.to] = 'legal-move'; });
      }
    }
    boardHtml = blocoTabuleiro(interativo?' interativo':'', boardSquaresHTML(fenExib, lastMoveExib, flipped, extraClasses), null, null, flipped);
    navHtml = navPlyHTML(cursorA, maxAntes);
  } else {
    if(ri.timeline==='sua'){
      var seqSua = [fenAntes, ri.resultado.fenApos];
      var maxS = 1;
      var cursorS = Math.max(0, Math.min(ri.cursorPly, maxS));
      ri.cursorPly = cursorS;
      var lastMoveS = cursorS===1 ? ri.resultado.lanceUsuario : null;
      var setasS = [];
      if(cursorS===0){
        var lu = ri.resultado.lanceUsuario;
        setasS.push(setaDeUci(melhorUci, COR_SETA_MELHOR));
        if(lu && (lu.from+lu.to)!==(melhorUci||'').slice(0,4)) setasS.push({ from:lu.from, to:lu.to, cor:COR_SETA_TENTATIVA });
        legendaSetas = 'Seta verde: melhor lance do motor · laranja: a sua tentativa.';
      }
      boardHtml = blocoTabuleiro('', boardSquaresHTML(seqSua[cursorS], lastMoveS, flipped), setasS, cursorS===1 ? barraSua : barraRef, flipped);
      navHtml = navPlyHTML(cursorS, maxS);
    } else if(ri.timeline==='motor' && ri.linhaMotor){
      var maxM = ri.linhaMotor.fens.length-1;
      var cursorM = Math.max(0, Math.min(ri.cursorPly, maxM));
      ri.cursorPly = cursorM;
      var ucM = cursorM>0 ? ri.linhaMotor.uci[cursorM-1] : null;
      var lastMoveM = ucM ? {from:ucM.slice(0,2), to:ucM.slice(2,4)} : null;
      var setaM = setaDeUci(ri.linhaMotor.uci[cursorM], COR_SETA_MELHOR);
      if(setaM) legendaSetas = 'Seta verde: próximo lance da sugestão do motor.';
      boardHtml = blocoTabuleiro('', boardSquaresHTML(ri.linhaMotor.fens[cursorM], lastMoveM, flipped), [setaM], barraRef, flipped);
      navHtml = navPlyHTML(cursorM, maxM);
    } else {
      var maxJ = game.fens.length-1;
      var cursorJ = Math.max(0, Math.min(ri.cursorPly, maxJ));
      ri.cursorPly = cursorJ;
      var lastMoveJ = cursorJ>0 ? game.applied[cursorJ-1] : null;
      var setasJ = [];
      if(cursorJ===pre){
        var mvReal = game.applied[pre];
        setasJ.push(setaDeUci(melhorUci, COR_SETA_MELHOR));
        if(mvReal && (mvReal.from+mvReal.to)!==(melhorUci||'').slice(0,4)) setasJ.push({ from:mvReal.from, to:mvReal.to, cor:COR_SETA_PARTIDA });
        legendaSetas = 'Seta verde: melhor lance do motor · vermelha: o que você jogou na partida.';
      }
      boardHtml = blocoTabuleiro('', boardSquaresHTML(game.fens[cursorJ], lastMoveJ, flipped), setasJ, barraRef, flipped);
      navHtml = navPlyHTML(cursorJ, maxJ);
    }
  }

  var statusHtml = '';
  if(ri.avaliando) statusHtml = '<p class="motor-status">'+(!ri.refInfo ? 'Carregando motor…' : 'Motor pensando…')+'</p>';

  var promoHtml = '';
  if(ri.promocaoPendente){
    var c2 = new Chess(fenAntes);
    var corPromo = c2.turn()==='w' ? 'w' : 'b';
    promoHtml = '<div class="promo-picker">'+['q','r','b','n'].map(function(p){
      var arq = corPromo + p.toUpperCase() + '.svg';
      return '<button type="button" class="btn btn-ghost" data-promo="'+p+'"><img src="pieces/'+arq+'" alt="'+p+'"></button>';
    }).join('')+'</div>';
  }

  var cabecalho = '<div class="erro-top"><span class="erro-date">'+escapeHtml(formatPtDate(en.data))+'</span><span class="badge badge-'+en.tipo+'">'+tipoLabel(en.tipo)+'</span></div>'+progressoHtml;
  var colHtml = boardHtml+navHtml, sideHtml, acoesHtml = '', hintPares;

  if(!ri.resultado){
    colHtml += promoHtml;
    sideHtml = cabecalho+
      '<p class="lede" style="margin-bottom:6px;">'+(interativo ? ('É a vez '+(flipped?'das pretas':'das brancas')+'. Jogue no tabuleiro o lance que você acha certo.') : 'Olhando um lance anterior — navegue pra voltar à posição do puzzle.')+'</p>'+
      statusHtml;
    if(totalPendentes>1 && !ri.avaliando) acoesHtml = '<button class="btn btn-ghost btn-sm" id="revPularBtn">Pular por agora</button>';
    hintPares = [['←→','navegar'],['p','pular']];
    if(ri.promocaoPendente) hintPares.unshift(['1-4','escolher peça']);
    if(ri.selecionada) hintPares.push(['esc','cancelar seleção']);
  } else {
    var r = ri.resultado;
    var bannerClasse = (r.classe==='otima'||r.classe==='boa'||r.classe==='brilhante'||r.classe==='great') ? 'certo' : (r.classe==='imprecisao' ? 'mediano' : 'errado');
    sideHtml = cabecalho+
      '<div class="feedback-banner '+bannerClasse+'">'+escapeHtml(r.texto)+'</div>'+
      '<div class="eval-bar-label">Você jogou '+escapeHtml(r.sanUsuario)+' (avaliação '+escapeHtml(r.avalTexto)+')'+(r.perda>20 && r.bestSan ? ' · motor preferia '+escapeHtml(r.bestSan) : '')+'</div>'+
      '<div class="linha-toggle">'+
        '<button type="button" class="btn btn-ghost btn-sm'+(ri.timeline==='sua'?' ativa':'')+'" id="revVerSua">Sua tentativa</button>'+
        '<button type="button" class="btn btn-ghost btn-sm'+(ri.timeline==='jogo'?' ativa':'')+'" id="revVerReal">Partida real</button>'+
        '<button type="button" class="btn btn-ghost btn-sm'+(ri.timeline==='motor'?' ativa':'')+'" id="revVerMotor">Sugestão do motor</button>'+
      '</div>'+
      (legendaSetas ? '<div class="eval-bar-label" style="margin-bottom:6px;">'+escapeHtml(legendaSetas)+'</div>' : '')+
      renderLinhasMotorHTML(fenAntes, ri.refLinhas)+
      (en.contexto ? '<div style="font-family:var(--font-mono);font-size:11.5px;color:var(--ink-soft);margin-top:6px;">'+escapeHtml(en.contexto)+'</div>' : '')+
      (en.motivo ? '<div class="erro-field-label">O que eu devia ter pensado</div><div class="erro-field-val">'+escapeHtml(en.motivo)+'</div>' : '')+
      (en.padrao ? '<div class="erro-field-label">Padrão recorrente</div><div class="erro-field-val">'+escapeHtml(en.padrao)+'</div>' : '');
    acoesHtml =
      '<button class="btn btn-ghost btn-sm" id="revTentarDeNovoBtn">Tentar de novo</button>'+
      '<button class="btn btn-primary btn-sm" id="revProximaBtn">Próxima</button>';
    hintPares = [['←→','navegar'],['n','próxima'],['r','tentar de novo']];
  }

  var infoMotorRodape = ri.refInfo && ri.refInfo.depth ? (' · Stockfish, profundidade '+ri.refInfo.depth) : ' · Stockfish';
  var animarM = ri.animarProximaRenderizacao; ri.animarProximaRenderizacao = false;
  wrap.innerHTML = '<div class="erro-card rev-card tipo-'+en.tipo+(animarM?' revisar-anim':'')+'">'+layoutRevisaoHTML(colHtml, sideHtml, acoesHtml)+'</div>'+
    atalhosHintHTML(hintPares)+
    '<p style="font-family:var(--font-mono);font-size:11.5px;color:var(--ink-soft);margin-top:8px;">'+filaResumoTexto(totalPendentes)+(en.vezesRevisado?' · já revisado '+en.vezesRevisado+'x antes':'')+infoMotorRodape+'</p>';

  var boardEl = wrap.querySelector('.board.interativo');
  if(boardEl){
    ligarArrastarSoltar(boardEl, en, game, fenAntes);
  }
  wrap.querySelectorAll('[data-promo]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var p = btn.dataset.promo;
      var de = ri.promocaoPendente.from, para = ri.promocaoPendente.to;
      ri.promocaoPendente = null;
      efetivarLanceRevisao(de, para, p, en, game, fenAntes);
    });
  });
  var navAnt = document.getElementById('revNavAnt');
  if(navAnt) navAnt.addEventListener('click', function(){ ri.cursorPly = ri.cursorPly-1; renderRevisar(); });
  var navProx = document.getElementById('revNavProx');
  if(navProx) navProx.addEventListener('click', function(){ ri.cursorPly = ri.cursorPly+1; renderRevisar(); });
  var pularBtn = document.getElementById('revPularBtn');
  if(pularBtn) pularBtn.addEventListener('click', function(){
    state.revisao.atualId = escolherProximaRevisao(en.id);
    resetRevisaoInterativa();
    renderRevisar();
  });
  var verSuaBtn = document.getElementById('revVerSua');
  if(verSuaBtn) verSuaBtn.addEventListener('click', function(){
    ri.timeline = 'sua';
    ri.cursorPly = 1;
    renderRevisar();
  });
  var verRealBtn = document.getElementById('revVerReal');
  if(verRealBtn) verRealBtn.addEventListener('click', function(){
    ri.timeline = 'jogo';
    ri.cursorPly = pre;
    renderRevisar();
  });
  var verMotorBtn = document.getElementById('revVerMotor');
  if(verMotorBtn) verMotorBtn.addEventListener('click', function(){
    ri.timeline = 'motor';
    if(!ri.linhaMotor) ri.linhaMotor = construirLinhaMotor(fenAntes, (ri.refInfo&&ri.refInfo.pv)||[]);
    ri.cursorPly = 0;
    renderRevisar();
  });
  var tentarDeNovoBtn = document.getElementById('revTentarDeNovoBtn');
  if(tentarDeNovoBtn) tentarDeNovoBtn.addEventListener('click', function(){
    resetTentativaRevisao();
    renderRevisar();
  });
  var proximaBtn = document.getElementById('revProximaBtn');
  if(proximaBtn) proximaBtn.addEventListener('click', function(){
    state.revisao.atualId = escolherProximaRevisao(en.id);
    resetRevisaoInterativa();
    renderRevisar();
  });
}

export function onCliqueCasaRevisao(sqName, en, game, fenAntes){
  var ri = state.revisaoInterativa;
  if(ri.avaliando || ri.resultado || ri.promocaoPendente || !ri.refInfo) return;
  if(ri.cursorPly!==en.ply-1) return; /* so aceita lance na posicao do puzzle, nao enquanto navega pelo historico */
  var c = new Chess(fenAntes);
  if(ri.selecionada){
    var alvo = ri.destinos.filter(function(d){ return d.to===sqName; });
    if(alvo.length>1){
      ri.promocaoPendente = { from: ri.selecionada, to: sqName };
      ri.selecionada = null; ri.destinos = [];
      renderRevisar();
      return;
    }
    if(alvo.length===1){
      var de = ri.selecionada;
      ri.selecionada = null; ri.destinos = [];
      efetivarLanceRevisao(de, sqName, alvo[0].promotion, en, game, fenAntes);
      return;
    }
    var pecaAlvo = c.get(sqName);
    if(pecaAlvo && pecaAlvo.color===c.turn()){
      var legais2 = c.moves({square:sqName, verbose:true});
      ri.selecionada = sqName;
      ri.destinos = legais2.map(function(m){ return {to:m.to, promotion:m.promotion}; });
    } else {
      ri.selecionada = null; ri.destinos = [];
    }
    renderRevisar();
    return;
  }
  var peca = c.get(sqName);
  if(peca && peca.color===c.turn()){
    var legais = c.moves({square:sqName, verbose:true});
    if(legais.length){
      ri.selecionada = sqName;
      ri.destinos = legais.map(function(m){ return {to:m.to, promotion:m.promotion}; });
      renderRevisar();
    }
  }
}

export function efetivarLanceRevisao(de, para, promocao, en, game, fenAntes){
  var ri = state.revisaoInterativa;
  var c = new Chess(fenAntes);
  var mv = c.move({from:de, to:para, promotion:promocao||'q'});
  if(!mv) return;
  var fenApos = c.fen();

  ri.avaliando = true;
  renderRevisar();

  var idAlvo = en.id;
  avaliarFEN(fenApos, function(res){
    if(state.revisao.atualId!==idAlvo) return;
    ri.avaliando = false;

    var linhasApos = (res && res.linhas) || [];
    var infoApos = linhasApos[0] || {cp:0,pv:[]};
    var refNorm = normalizarAvaliacao(ri.refInfo, false);
    var aposNorm = normalizarAvaliacao(infoApos, true);
    var perda = Math.max(0, refNorm.valorComparavel - aposNorm.valorComparavel);

    var quantoSacrificou = 0;
    if(infoApos.pv && infoApos.pv[0]){
      try{
        var cReply = new Chess(fenApos);
        var uciReply = infoApos.pv[0];
        var mvReply = cReply.move({from:uciReply.slice(0,2), to:uciReply.slice(2,4), promotion: uciReply.length>4?uciReply.slice(4,5):undefined});
        if(mvReply){
          var balAntes = materialBalance(fenAntes, mv.color);
          var balDepois = materialBalance(cReply.fen(), mv.color);
          quantoSacrificou = balAntes - balDepois;
        }
      }catch(e){}
    }
    var cls = classificarLanceCompleto(perda, ri.refInfo, ri.refLinhas, quantoSacrificou, aposNorm.valorComparavel, null);

    var bestSan = null;
    if(ri.refBestUci){
      var sansBest = pvParaSan(fenAntes, [ri.refBestUci], 1);
      bestSan = sansBest[0]||null;
    }

    ri.resultado = {
      sanUsuario: mv.san,
      fenApos: fenApos,
      lanceUsuario: {from:de, to:para},
      perda: perda,
      classe: cls.classe,
      texto: cls.texto,
      bestSan: bestSan,
      avalTexto: aposNorm.texto,
      avalCurto: avalCurtoDe(aposNorm),
      pctBarra: aposNorm.mate!==null ? (aposNorm.mate>0?92:8) : pctBarraDeCp(aposNorm.cp)
    };
    ri.timeline = 'sua';
    ri.cursorPly = 1;
    ri.animarProximaRenderizacao = true;

    if(!ri.jaContado){
      ri.jaContado = true;
      aplicarResultadoRevisao(en.id, perda<=ENGINE_PERDA_ACEITAVEL);
    }
    renderRevisar();
  });
}

export function atualizarContadorRevisao(id, acertou){
  var idx = state.erros.findIndex(function(e){ return e.id===id; });
  if(idx===-1) return null;
  var en = state.erros[idx];
  var r = aplicarRespostaRevisao(en, acertou, todayStr(), Date.now());
  return { en:en, dominouAgora:r.dominouAgora, contou:r.contou, proxima:r.proxima };
}

function avisarResultadoRevisao(r, acertou){
  var quando = r.proxima ? formatPtDate(r.proxima) : '';
  if(r.dominouAgora) showToast('Dominado! Esse erro saiu da fila de revisão.');
  else if(!acertou) showToast('Sem problema — ele volta a vencer em '+quando+'.');
  else if(!r.contou) showToast('Bom treino! Esse erro só avança a partir de '+quando+'.');
  else showToast('Mandou bem — próxima revisão em '+quando+' (faltam '+(REVISAO_ACERTOS_PARA_DOMINAR-r.en.acertosSeguidos)+' acertos).');
}

export async function graduarRevisao(id, acertou){
  var r = atualizarContadorRevisao(id, acertou);
  if(!r) return;
  avisarResultadoRevisao(r, acertou);
  await persist();
  state.revisao.atualId = escolherProximaRevisao(id);
  state.revisao.revelado = false;
  resetRevisaoInterativa();
  renderRevisar();
  renderErros();
  renderHeaderStats();
}

export async function aplicarResultadoRevisao(id, acertou){
  var r = atualizarContadorRevisao(id, acertou);
  if(!r) return;
  avisarResultadoRevisao(r, acertou);
  await persist();
  renderErros();
  renderHeaderStats();
}
