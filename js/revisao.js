/* Revisao espacada dos erros catalogados - modo simples e modo com motor. */
import { classificarLanceCompleto, materialBalance, normalizarAvaliacao, pctBarraDeCp, pvParaSan } from './analysis.js';
import { boardSquaresHTML } from './board.js';
import { avaliarFEN, engineState } from './engine.js';
import { persist } from './persistence.js';
import { renderErros, tipoLabel } from './render-erros.js';
import { renderHeaderStats } from './render-hoje.js';
import { state } from './state.js';
import { escapeHtml, formatPtDate, showToast, todayStr, wrapArray } from './utils.js';

export function sincronizarControlesMotor(){
  var elMulti = document.getElementById('cfgMultiPv');
  var elMove = document.getElementById('cfgMovetime');
  var elHash = document.getElementById('cfgHash');
  var elDepthAnalise = document.getElementById('cfgDepthAnalise');
  if(elMulti) elMulti.value = String(state.motorConfig.multiPv);
  if(elMove) elMove.value = String(state.motorConfig.movetimeMs);
  if(elHash) elHash.value = String(state.motorConfig.hashMb);
  if(elDepthAnalise) elDepthAnalise.value = String(state.motorConfig.depthAnalise);
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

export var REVISAO_ACERTOS_PARA_DOMINAR = 3;

export var ENGINE_PERDA_ACEITAVEL = 80; /* centipawns: ate aqui, conta como acerto */

export function erroTemTabuleiroRevisavel(en){
  if(!en.gameId || !en.ply) return false;
  var g = state.partidas.find(function(x){ return x.id===en.gameId; });
  if(!g || !g.fens || !g.applied) return false;
  return g.fens[en.ply-1]!==undefined && g.fens[en.ply]!==undefined && g.applied[en.ply-1]!==undefined;
}

export function erroPendentesRevisao(){
  return state.erros.filter(function(e){ return !e.resolvido; }).slice().sort(function(a,b){
    var aa = a.acertosSeguidos||0, bb = b.acertosSeguidos||0;
    if(aa!==bb) return aa-bb; /* quem tem menos acertos seguidos entra primeiro */
    var au = a.ultimaRevisaoEm||0, bu = b.ultimaRevisaoEm||0;
    return au-bu; /* nunca revisado (0) antes; depois o revisado há mais tempo */
  });
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
    wrap.innerHTML = '<div class="empty-state">🎉 Você dominou todos os '+state.erros.length+' erros registrados ('+REVISAO_ACERTOS_PARA_DOMINAR+' acertos seguidos em cada). Continue jogando e catalogando — assim que surgir um erro novo, ele entra na fila.</div>';
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
    '<div class="progress-bar" style="margin-bottom:14px;"><div class="progress-fill" style="width:'+Math.round(acertos/REVISAO_ACERTOS_PARA_DOMINAR*100)+'%;"></div></div>';

  var boardHtml = '', navHtml = '';
  if(temTabuleiro){
    if(ri.cursorPly===null || ri.cursorPly===undefined) ri.cursorPly = en.ply-1;
    var maxCursor = revelado ? game.fens.length-1 : en.ply-1;
    var cursor = Math.max(0, Math.min(ri.cursorPly, maxCursor));
    ri.cursorPly = cursor;
    var lastMoveNav = cursor>0 ? game.applied[cursor-1] : null;
    boardHtml = '<div class="board-wrap" style="max-width:420px;margin:0 auto;"><div class="board">'+boardSquaresHTML(game.fens[cursor], lastMoveNav, flipped)+'</div></div>';
    navHtml = navPlyHTML(cursor, maxCursor);
  }

  var avisoMotor = (temTabuleiro && engineState==='falhou') ? '<p class="motor-status">Não consegui carregar o motor de xadrez (confira os arquivos em engine/) — revisão no modo simples.</p>' : '';

  var corpo, hintPares;
  if(!revelado){
    corpo =
      '<div class="erro-top"><span class="erro-date">'+escapeHtml(formatPtDate(en.data))+'</span><span class="badge badge-'+en.tipo+'">'+tipoLabel(en.tipo)+'</span></div>'+
      progressoHtml+avisoMotor+
      (temTabuleiro
        ? '<p class="lede" style="margin-bottom:10px;">É a vez '+(flipped?'das pretas':'das brancas')+'. O que você jogaria aqui — antes de olhar o que rolou de verdade?</p>'+boardHtml+navHtml
        : '<p class="lede" style="margin-bottom:10px;">Lembra por que esse lance foi um erro, e o que você faria diferente hoje?</p>'+
          (en.lance ? '<div class="erro-move">'+escapeHtml(en.lance)+'</div>' : ''))+
      '<div class="btn-row" style="margin-top:14px;justify-content:center;">'+
        '<button class="btn btn-primary btn-sm" id="revRevelarBtn">Revelar</button>'+
        (totalPendentes>1 ? '<button class="btn btn-ghost btn-sm" id="revPularBtn">Pular por agora</button>' : '')+
      '</div>';
    hintPares = temTabuleiro ? [['espaço/enter','revelar'],['←→','navegar'],['p','pular']] : [['espaço/enter','revelar']];
  } else {
    corpo =
      '<div class="erro-top"><span class="erro-date">'+escapeHtml(formatPtDate(en.data))+(en.ritmo?' · '+escapeHtml(en.ritmo):'')+(en.resultado?' · '+escapeHtml(en.resultado):'')+'</span><span class="badge badge-'+en.tipo+'">'+tipoLabel(en.tipo)+'</span></div>'+
      progressoHtml+
      boardHtml+navHtml+
      (en.lance ? '<div class="erro-move" style="margin-top:10px;">O que rolou de verdade: '+escapeHtml(en.lance)+'</div>' : '')+
      (en.contexto ? '<div style="font-family:var(--font-mono);font-size:11.5px;color:var(--ink-soft);margin-top:6px;">'+escapeHtml(en.contexto)+'</div>' : '')+
      (en.motivo ? '<div class="erro-field-label">O que eu devia ter pensado</div><div class="erro-field-val">'+escapeHtml(en.motivo)+'</div>' : '')+
      (en.padrao ? '<div class="erro-field-label">Padrão recorrente</div><div class="erro-field-val">'+escapeHtml(en.padrao)+'</div>' : '')+
      '<p class="lede" style="margin-top:14px;margin-bottom:6px;">Se essa posição caísse numa partida sua hoje, você evitaria esse erro?</p>'+
      '<div class="btn-row" style="justify-content:center;">'+
        '<button class="btn btn-danger btn-sm" id="revErreiBtn">Ainda erraria</button>'+
        '<button class="btn btn-primary btn-sm" id="revAcerteiBtn">Já evito esse erro</button>'+
      '</div>';
    hintPares = temTabuleiro ? [['1','ainda erraria'],['2','já evito'],['←→','navegar']] : [['1','ainda erraria'],['2','já evito']];
  }

  var animarS = ri.animarProximaRenderizacao; ri.animarProximaRenderizacao = false;
  wrap.innerHTML = '<div class="erro-card tipo-'+en.tipo+(animarS?' revisar-anim':'')+'">'+corpo+'</div>'+
    atalhosHintHTML(hintPares)+
    '<p style="font-family:var(--font-mono);font-size:11.5px;color:var(--ink-soft);margin-top:8px;">'+totalPendentes+' pendente'+(totalPendentes===1?'':'s')+' na fila'+(en.vezesRevisado?' · já revisado '+en.vezesRevisado+'x antes':'')+'</p>';

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

export function renderRevisarComMotor(wrap, en, game, totalPendentes){
  var ri = state.revisaoInterativa;
  var acertos = en.acertosSeguidos||0;
  var flipped = game.meuLado==='b';
  var pre = en.ply-1;
  var fenAntes = game.fens[pre];

  if(ri.cursorPly===null || ri.cursorPly===undefined) ri.cursorPly = pre;

  var progressoHtml = '<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--ink-soft);margin-bottom:4px;"><span>Rumo a dominar esse erro</span><span>'+acertos+' / '+REVISAO_ACERTOS_PARA_DOMINAR+' acertos seguidos</span></div>'+
    '<div class="progress-bar" style="margin-bottom:14px;"><div class="progress-fill" style="width:'+Math.round(acertos/REVISAO_ACERTOS_PARA_DOMINAR*100)+'%;"></div></div>';

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
    boardHtml = '<div class="board-wrap" style="max-width:420px;margin:0 auto;"><div class="board'+(interativo?' interativo':'')+'">'+boardSquaresHTML(fenExib, lastMoveExib, flipped, extraClasses)+'</div></div>';
    navHtml = navPlyHTML(cursorA, maxAntes);
  } else {
    if(ri.timeline==='sua'){
      var seqSua = [fenAntes, ri.resultado.fenApos];
      var maxS = 1;
      var cursorS = Math.max(0, Math.min(ri.cursorPly, maxS));
      ri.cursorPly = cursorS;
      var lastMoveS = cursorS===1 ? ri.resultado.lanceUsuario : null;
      boardHtml = '<div class="board-wrap" style="max-width:420px;margin:0 auto;"><div class="board">'+boardSquaresHTML(seqSua[cursorS], lastMoveS, flipped)+'</div></div>';
      navHtml = navPlyHTML(cursorS, maxS);
    } else if(ri.timeline==='motor' && ri.linhaMotor){
      var maxM = ri.linhaMotor.fens.length-1;
      var cursorM = Math.max(0, Math.min(ri.cursorPly, maxM));
      ri.cursorPly = cursorM;
      var ucM = cursorM>0 ? ri.linhaMotor.uci[cursorM-1] : null;
      var lastMoveM = ucM ? {from:ucM.slice(0,2), to:ucM.slice(2,4)} : null;
      boardHtml = '<div class="board-wrap" style="max-width:420px;margin:0 auto;"><div class="board">'+boardSquaresHTML(ri.linhaMotor.fens[cursorM], lastMoveM, flipped)+'</div></div>';
      navHtml = navPlyHTML(cursorM, maxM);
    } else {
      var maxJ = game.fens.length-1;
      var cursorJ = Math.max(0, Math.min(ri.cursorPly, maxJ));
      ri.cursorPly = cursorJ;
      var lastMoveJ = cursorJ>0 ? game.applied[cursorJ-1] : null;
      boardHtml = '<div class="board-wrap" style="max-width:420px;margin:0 auto;"><div class="board">'+boardSquaresHTML(game.fens[cursorJ], lastMoveJ, flipped)+'</div></div>';
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

  var corpo = '<div class="erro-top"><span class="erro-date">'+escapeHtml(formatPtDate(en.data))+'</span><span class="badge badge-'+en.tipo+'">'+tipoLabel(en.tipo)+'</span></div>'+progressoHtml;
  var hintPares;

  if(!ri.resultado){
    corpo += '<p class="lede" style="margin-bottom:6px;">'+(interativo ? ('É a vez '+(flipped?'das pretas':'das brancas')+'. Jogue no tabuleiro o lance que você acha certo.') : 'Olhando um lance anterior — navegue pra voltar à posição do puzzle.')+'</p>'+
      statusHtml+boardHtml+navHtml+promoHtml;
    var botoesExtra = [];
    if(totalPendentes>1 && !ri.avaliando) botoesExtra.push('<button class="btn btn-ghost btn-sm" id="revPularBtn">Pular por agora</button>');
    if(botoesExtra.length) corpo += '<div class="btn-row" style="margin-top:10px;justify-content:center;">'+botoesExtra.join('')+'</div>';
    hintPares = [['←→','navegar'],['p','pular']];
    if(ri.promocaoPendente) hintPares.unshift(['1-4','escolher peça']);
    if(ri.selecionada) hintPares.push(['esc','cancelar seleção']);
  } else {
    var r = ri.resultado;
    var bannerClasse = (r.classe==='otima'||r.classe==='boa'||r.classe==='brilhante'||r.classe==='great') ? 'certo' : (r.classe==='imprecisao' ? 'mediano' : 'errado');
    corpo += '<div class="feedback-banner '+bannerClasse+'">'+escapeHtml(r.texto)+'</div>'+
      '<div class="eval-bar"><div class="eval-bar-fill" style="width:'+r.pctBarra+'%;"></div></div>'+
      '<div class="eval-bar-label">Você jogou '+escapeHtml(r.sanUsuario)+' (avaliação '+escapeHtml(r.avalTexto)+')'+(r.perda>20 && r.bestSan ? ' · motor preferia '+escapeHtml(r.bestSan) : '')+'</div>'+
      '<div class="linha-toggle">'+
        '<button type="button" class="btn btn-ghost'+(ri.timeline==='sua'?' ativa':'')+'" id="revVerSua">Sua tentativa</button>'+
        '<button type="button" class="btn btn-ghost'+(ri.timeline==='jogo'?' ativa':'')+'" id="revVerReal">Partida real</button>'+
        '<button type="button" class="btn btn-ghost'+(ri.timeline==='motor'?' ativa':'')+'" id="revVerMotor">Sugestão do motor</button>'+
      '</div>'+
      boardHtml+navHtml+
      renderLinhasMotorHTML(fenAntes, ri.refLinhas)+
      (en.contexto ? '<div style="font-family:var(--font-mono);font-size:11.5px;color:var(--ink-soft);margin-top:6px;">'+escapeHtml(en.contexto)+'</div>' : '')+
      (en.motivo ? '<div class="erro-field-label">O que eu devia ter pensado</div><div class="erro-field-val">'+escapeHtml(en.motivo)+'</div>' : '')+
      (en.padrao ? '<div class="erro-field-label">Padrão recorrente</div><div class="erro-field-val">'+escapeHtml(en.padrao)+'</div>' : '')+
      '<div class="btn-row" style="margin-top:14px;justify-content:center;">'+
        '<button class="btn btn-ghost btn-sm" id="revTentarDeNovoBtn">Tentar de novo</button>'+
        '<button class="btn btn-primary btn-sm" id="revProximaBtn">Próxima</button>'+
      '</div>';
    hintPares = [['←→','navegar'],['n','próxima'],['r','tentar de novo']];
  }

  var infoMotorRodape = ri.refInfo && ri.refInfo.depth ? (' · Stockfish, profundidade '+ri.refInfo.depth) : ' · Stockfish';
  var animarM = ri.animarProximaRenderizacao; ri.animarProximaRenderizacao = false;
  wrap.innerHTML = '<div class="erro-card tipo-'+en.tipo+(animarM?' revisar-anim':'')+'">'+corpo+'</div>'+
    atalhosHintHTML(hintPares)+
    '<p style="font-family:var(--font-mono);font-size:11.5px;color:var(--ink-soft);margin-top:8px;">'+totalPendentes+' pendente'+(totalPendentes===1?'':'s')+' na fila'+(en.vezesRevisado?' · já revisado '+en.vezesRevisado+'x antes':'')+infoMotorRodape+'</p>';

  var boardEl = wrap.querySelector('.board.interativo');
  if(boardEl){
    boardEl.addEventListener('click', function(ev){
      var sqEl = ev.target.closest('.sq');
      if(!sqEl) return;
      onCliqueCasaRevisao(sqEl.dataset.sq, en, game, fenAntes);
    });
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
  en.vezesRevisado = (en.vezesRevisado||0)+1;
  en.ultimaRevisaoEm = Date.now();
  var dominouAgora = false;
  if(acertou){
    en.acertosSeguidos = (en.acertosSeguidos||0)+1;
    if(en.acertosSeguidos>=REVISAO_ACERTOS_PARA_DOMINAR){ en.resolvido = true; dominouAgora = true; }
  } else {
    en.acertosSeguidos = 0;
  }
  return { en:en, dominouAgora:dominouAgora };
}

export async function graduarRevisao(id, acertou){
  var r = atualizarContadorRevisao(id, acertou);
  if(!r) return;
  if(r.dominouAgora) showToast('Dominado! Esse erro saiu da fila de revisão.');
  else if(acertou) showToast('Mandou bem — mais '+(REVISAO_ACERTOS_PARA_DOMINAR-r.en.acertosSeguidos)+' pra dominar esse.');
  else showToast('Sem problema — ele volta pra fila pra tentar de novo.');
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
  if(r.dominouAgora) showToast('Dominado! Esse erro saiu da fila de revisão.');
  await persist();
  renderErros();
  renderHeaderStats();
}
