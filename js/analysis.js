/* Classificacao de lances (blunder/erro/imprecisao/brilhante/miss) e analise completa de partida. */
import { fenToBoard } from './board.js';
import { avaliarFEN, engineState, engineWorker, iniciarMotor } from './engine.js';
import { renderAnaliseMotorUI, renderMovelist } from './partidas.js';
import { persist } from './persistence.js';
import { ENGINE_PERDA_ACEITAVEL } from './revisao.js';
import { state } from './state.js';
import { renderPainelTempo } from './tempo.js';
import { showToast } from './utils.js';

export function clkParaSegundos(clk){
  if(!clk) return null;
  var partes = String(clk).split(':').map(Number);
  if(partes.some(isNaN)) return null;
  if(partes.length===3) return partes[0]*3600+partes[1]*60+partes[2];
  if(partes.length===2) return partes[0]*60+partes[1];
  return null;
}

export function mapClasseParaTipo(classe){
  if(classe==='blunder') return 'blunder';
  if(classe==='erro') return 'mistake';
  if(classe==='imprecisao') return 'inaccuracy';
  if(classe==='miss') return 'miss';
  return null; /* 'otima'/'boa'/'brilhante'/'great' nao viram erro pra registrar */
}

export function cancelarAnaliseCompleta(){
  if(state.analiseEmAndamento) state.analiseEmAndamento.cancelado = true;
}

export function derivarClassificacoesPorPly(todasLinhas, applied, porPlyExistente, fens){
  var porPly = porPlyExistente || {};
  for(var p=1;p<todasLinhas.length;p++){
    if(todasLinhas[p-1]===undefined || todasLinhas[p]===undefined) continue;
    var linhasAntes = todasLinhas[p-1];
    var linhasDepois = todasLinhas[p];
    var refN = normalizarAvaliacao(linhasAntes[0], false);
    var aposN = normalizarAvaliacao(linhasDepois[0], true);
    var perda = Math.max(0, refN.valorComparavel - aposN.valorComparavel);
    var mv = applied[p-1];

    var quantoSacrificou = 0;
    if(fens && mv && fens[p-1] && fens[p+1]){
      try{
        var balAntes = materialBalance(fens[p-1], mv.color);
        var balDepois = materialBalance(fens[p+1], mv.color);
        quantoSacrificou = balAntes - balDepois;
      }catch(e){}
    }

    /* sinal de "presente fresco": o adversario acabou de dar uma vantagem grande 2 plies atras? */
    var ganhoRecente = null;
    if(p>=2 && todasLinhas[p-2]!==undefined){
      var antesDoGiftoN = normalizarAvaliacao(todasLinhas[p-2][0], true);
      ganhoRecente = refN.valorComparavel - antesDoGiftoN.valorComparavel;
    }

    var cls = classificarLanceCompleto(perda, linhasAntes[0], linhasAntes, quantoSacrificou, aposN.valorComparavel, ganhoRecente);
    porPly[p] = { classe: cls.classe, perda: Math.round(perda), cor: mv?mv.color:null };
  }
  return porPly;
}

export async function iniciarAnaliseCompleta(game){
  if(state.analiseEmAndamento && !state.analiseEmAndamento.cancelado) return;
  var total = game.fens.length;
  state.analiseEmAndamento = { gameId: game.id, atual: 0, total: total, cancelado: false };
  renderAnaliseMotorUI(game);

  iniciarMotor();
  var statusMotor = await new Promise(function(resolve){
    if(engineState==='pronto'){ resolve('pronto'); return; }
    if(engineState==='falhou'){ resolve('falhou'); return; }
    var tentativas = 0;
    var checar = setInterval(function(){
      tentativas++;
      if(engineState==='pronto'){ clearInterval(checar); resolve('pronto'); }
      else if(engineState==='falhou'){ clearInterval(checar); resolve('falhou'); }
      else if(tentativas>200){ clearInterval(checar); resolve('falhou'); } /* seguranca: ~10s sem resposta */
    }, 50);
  });
  if(statusMotor==='falhou'){
    state.analiseEmAndamento = null;
    showToast('Não consegui carregar o motor de xadrez — confira os arquivos em engine/.');
    renderAnaliseMotorUI(game);
    return;
  }
  engineWorker.postMessage('ucinewgame'); /* zera o hash: cada analise completa parte do mesmo estado */

  var todasLinhas = new Array(total);
  var depthAnalise = state.motorConfig.depthAnalise || 20;
  var multiPvAnalise = Math.max(2, state.motorConfig.multiPv || 1); /* Great precisa comparar a 1a com a 2a linha */

  function avaliarIndice(idx){
    return new Promise(function(resolve){
      avaliarFEN(game.fens[idx], function(res){
        var linhas = (res && res.linhas) || [];
        todasLinhas[idx] = linhas.length ? linhas : [{cp:0, mate:null, pv:[]}];
        state.analiseEmAndamento.atual = idx+1;
        renderAnaliseMotorUI(game);
        resolve();
      }, { depth: depthAnalise, multiPv: multiPvAnalise });
    });
  }

  for(var i=0;i<total;i++){
    if(state.analiseEmAndamento.cancelado) break;
    await avaliarIndice(i);
  }

  var completo = !state.analiseEmAndamento.cancelado;
  var porPlyExistente = (game.analiseMotor && game.analiseMotor.porPly) || {};
  var porPly = derivarClassificacoesPorPly(todasLinhas, game.applied, porPlyExistente, game.fens);
  game.analiseMotor = { porPly: porPly, feitoEm: Date.now(), completo: completo, depthUsado: depthAnalise };
  state.analiseEmAndamento = null;
  await persist();
  renderAnaliseMotorUI(game);
  renderMovelist(game);
  renderPainelTempo(game);
  showToast(completo ? 'Análise completa!' : 'Análise cancelada — o que já tinha sido calculado foi mantido.');
}

export function normalizarAvaliacao(info, inverterPerspectiva){
  info = info || {};
  var sinal = inverterPerspectiva ? -1 : 1;
  if(info.mate!==null && info.mate!==undefined){
    var mateAjustado = sinal*info.mate;
    return {
      mate: mateAjustado, cp: null,
      valorComparavel: mateAjustado>0 ? (100000-mateAjustado) : (-100000-mateAjustado),
      texto: mateAjustado>0 ? ('mate em '+mateAjustado) : ('mate em '+Math.abs(mateAjustado)+' contra você')
    };
  }
  var cpAjustado = sinal*(info.cp||0);
  return {
    mate: null, cp: cpAjustado,
    valorComparavel: cpAjustado,
    texto: (cpAjustado>=0?'+':'')+(cpAjustado/100).toFixed(2)
  };
}

export function classificarPerda(perda){
  if(perda<=20) return {classe:'otima', texto:'Ótima jogada!'};
  if(perda<=ENGINE_PERDA_ACEITAVEL) return {classe:'boa', texto:'Boa jogada — dá pra melhorar um pouco.'};
  if(perda<=200) return {classe:'imprecisao', texto:'Imprecisão — havia algo melhor.'};
  if(perda<=450) return {classe:'erro', texto:'Isso é um erro (mistake) pelo motor.'};
  return {classe:'blunder', texto:'Isso é um blunder pelo motor.'};
}

export var VALOR_PECA = { p:1, n:3, b:3, r:5, q:9, k:0 };

export var LIMIAR_JA_DECISIVO = 500; /* a partir daqui, a posicao ja e "ganha" objetivamente */

export function materialBalance(fen, corDoMovedor){
  var board = fenToBoard(fen);
  var total = { w:0, b:0 };
  Object.keys(board).forEach(function(sq){
    var p = board[sq];
    total[p.color] += (VALOR_PECA[p.type]||0);
  });
  var adversario = corDoMovedor==='w' ? 'b' : 'w';
  return total[corDoMovedor] - total[adversario];
}

export function posicaoJaDecisiva(infoOuValor){
  if(infoOuValor && typeof infoOuValor==='object' && 'mate' in infoOuValor){
    if(infoOuValor.mate!==null && infoOuValor.mate!==undefined && infoOuValor.mate>0) return true;
    return (infoOuValor.cp||0) >= LIMIAR_JA_DECISIVO;
  }
  return (infoOuValor||0) >= LIMIAR_JA_DECISIVO;
}

export var GAP_LANCE_UNICO = 150; /* centipawns de folga entre a 1a e a 2a linha do motor pra considerar "so esse lance resolve" */

export var GANHO_MINIMO_PARA_PRESENTE = 300; /* quanto o adversario precisa ter piorado a propria posicao no lance anterior pra contar como "presente fresco" */

export var LIMIAR_SACRIFICIO_MINIMO = 2; /* pontos de material cedidos de verdade (peao=1) - abaixo disso e so uma troca, nao sacrificio */

export var LIMIAR_VANTAGEM_BRILHANTE = 300; /* depois do sacrificio, precisa abrir vantagem clara - nao so "nao ficar pior" */

export function classificarLanceCompleto(perda, refInfoAntes, refLinhasAntes, quantoSacrificou, valorDepoisDoMovedor, ganhoRecenteDoMovedor){
  var base = classificarPerda(perda);
  var jaEraDecisivoAntes = posicaoJaDecisiva(refInfoAntes);

  var ehLanceUnico = false;
  if(refLinhasAntes && refLinhasAntes.length>=2){
    var n0 = normalizarAvaliacao(refLinhasAntes[0], false);
    var n1 = normalizarAvaliacao(refLinhasAntes[1], false);
    ehLanceUnico = (n0.valorComparavel - n1.valorComparavel) >= GAP_LANCE_UNICO;
  }

  var ehSacrificioReal = (quantoSacrificou||0) >= LIMIAR_SACRIFICIO_MINIMO;

  if(!jaEraDecisivoAntes && perda<=20 && ehSacrificioReal && valorDepoisDoMovedor>=LIMIAR_VANTAGEM_BRILHANTE){
    return { classe:'brilhante', texto:'Brilhante! Sacrifício de pelo menos '+LIMIAR_SACRIFICIO_MINIMO+' pontos de material que abre vantagem clara.' };
  }
  if(!jaEraDecisivoAntes && perda<=20 && ehLanceUnico){
    return { classe:'great', texto:'Ótimo! Foi praticamente o único lance que resolvia a posição.' };
  }

  /* sem dado de 2-plies-atras (ex: puzzle avulso), usa so o criterio de "ja decisivo";
     com o dado (analise em massa), exige que o presente tenha sido fresco (do lance anterior do adversario) */
  var foiPresenteFresco = (ganhoRecenteDoMovedor===undefined || ganhoRecenteDoMovedor===null)
    ? true
    : ganhoRecenteDoMovedor >= GANHO_MINIMO_PARA_PRESENTE;

  if(jaEraDecisivoAntes && foiPresenteFresco && perda>ENGINE_PERDA_ACEITAVEL){
    return { classe:'miss', texto:'Seu adversário te deu uma chance decisiva e você não converteu — um Miss.' };
  }
  return base;
}

export function pctBarraDeCp(cp){
  var c = Math.max(-500, Math.min(500, cp||0));
  return Math.round(50 + (c/500)*45);
}

export function pvParaSan(fen, pvUci, maxLances){
  var sans = [];
  try{
    var c = new Chess(fen);
    var limite = Math.min((pvUci||[]).length, maxLances||6);
    for(var i=0;i<limite;i++){
      var uci = pvUci[i];
      if(!uci || uci.length<4) break;
      var mv = c.move({ from: uci.slice(0,2), to: uci.slice(2,4), promotion: uci.length>4?uci.slice(4,5):undefined });
      if(!mv) break;
      sans.push(mv.san);
    }
  }catch(e){ /* silencioso: so nao mostra a linha */ }
  return sans;
}
