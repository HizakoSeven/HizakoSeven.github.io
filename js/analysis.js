/* Classificacao de lances (blunder/erro/imprecisao/brilhante/miss) e analise completa de partida. */
import { fenToBoard } from './board.js';
import { avaliarFEN, engineState, iniciarMotor, interromperBuscaSegundoPlano, reiniciarHashMotor } from './engine.js';
import { renderAnaliseMotorUI } from './analise-ui.js';
import { renderMovelist } from './partidas.js';
import { persist } from './persistence.js';
import { atualizarVisualPosicao } from './posicao-visual.js';
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

/* Avaliacao do motor (do ponto de vista de QUEM TEM A VEZ, como o UCI devolve) -> ponto de vista das BRANCAS. */
export function avaliacaoParaBrancas(info, fen){
  info = info || {};
  var sinal = (String(fen||'').split(' ')[1]==='b') ? -1 : 1;
  if(info.mate!==null && info.mate!==undefined) return { cp:null, mate:sinal*info.mate };
  return { cp:sinal*(info.cp||0), mate:null };
}

/* Versao compacta (pra guardar na partida) das linhas de uma posicao:
   { cp, mate, m:'e2e4', pv:[ate 6 lances], l:[{cp,mate,u}] (linhas 2 e 3) } ou { fim:'mate'|'empate' } em posicao final. */
export function compactarPosicao(linhas, fen){
  if(!linhas || !linhas.length) return null;
  var l0 = linhas[0];
  if(l0.terminal) return { fim: l0.terminal==='checkmate' ? 'mate' : 'empate' };
  var base = avaliacaoParaBrancas(l0, fen);
  var pos = { cp:base.cp, mate:base.mate };
  var pv = (l0.pv||[]).slice(0,6);
  if(pv.length){ pos.m = pv[0]; pos.pv = pv; }
  var extras = linhas.slice(1,3).filter(function(x){ return x && !x.terminal; }).map(function(x){
    var a = avaliacaoParaBrancas(x, fen);
    var o = { cp:a.cp, mate:a.mate };
    if(x.pv && x.pv[0]) o.u = x.pv[0];
    return o;
  });
  if(extras.length) pos.l = extras;
  return pos;
}

export function mapClasseParaTipo(classe){
  if(classe==='blunder') return 'blunder';
  if(classe==='erro') return 'mistake';
  if(classe==='imprecisao') return 'inaccuracy';
  if(classe==='miss') return 'miss';
  return null; /* 'otima'/'boa'/'brilhante'/'great' nao viram erro pra registrar */
}

export function cancelarAnaliseCompleta(){
  if(state.analiseEmAndamento){
    state.analiseEmAndamento.cancelado = true;
    interromperBuscaSegundoPlano(); /* nao espera a posicao atual terminar a busca */
  }
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
    /* compara com a posicao DEPOIS do proximo lance de quem jogou (p+2), nao so depois da resposta do adversario (p+1):
       uma troca em que voce recaptura logo em seguida fica material-neutra e nao conta como sacrificio.
       Sem p+2 (fim da partida), cai pro p+1. */
    var idxDepois = (fens && fens[p+2]) ? p+2 : p+1;
    if(fens && mv && fens[p-1] && fens[idxDepois]){
      try{
        var balAntes = materialBalance(fens[p-1], mv.color);
        var balDepois = materialBalance(fens[idxDepois], mv.color);
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

var loopAnaliseAtivo = false; /* true enquanto um laco de analise ainda esta rodando (inclusive terminando de cancelar) */

export async function iniciarAnaliseCompleta(game, opcoes){
  opcoes = opcoes || {};
  if(loopAnaliseAtivo){
    /* cancelar e comecar outra na hora sobreporia os dois lacos: espera o anterior encerrar */
    if(state.analiseEmAndamento && state.analiseEmAndamento.cancelado) showToast('Aguarde um instante: a análise anterior ainda está encerrando.');
    return;
  }
  loopAnaliseAtivo = true;
  var total = game.fens.length;
  /* referencia LOCAL: este laco so le/escreve o proprio objeto, nunca o state.analiseEmAndamento de outra analise */
  var minha = { gameId: game.id, atual: 0, total: total, cancelado: false };
  state.analiseEmAndamento = minha;
  try{
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
      showToast('Não consegui carregar o motor de xadrez — confira os arquivos em engine/.');
      return;
    }
    reiniciarHashMotor(); /* zera o hash antes da 1a busca: cada analise completa parte do mesmo estado */

    var todasLinhas = new Array(total);
    var posicoesNovas = new Array(total); /* avaliacao compacta por posicao (barra e setas na aba Partidas) */
    minha.posicoes = posicoesNovas; /* a aba Analise desenha o grafico aos poucos, conforme as posicoes ficam prontas */
    var depthAnalise = opcoes.depth || state.motorConfig.depthAnalise || 20;
    var depthReserva = Math.max(10, depthAnalise-6); /* 2a tentativa quando uma posicao estoura o tempo */
    var multiPvAnalise = Math.max(2, state.motorConfig.multiPv || 1); /* Great precisa comparar a 1a com a 2a linha */

    var motorCaiu = false;
    var semResultado = 0; /* posicoes que NAO foram avaliadas (sem ser por cancelamento) */

    function avaliarIndice(idx, depth){
      return new Promise(function(resolve){
        avaliarFEN(game.fens[idx], function(res){
          if(res && res.falhou){ motorCaiu = true; resolve('falhou'); return; }
          if(res && res.parcial){ resolve('parcial'); return; } /* busca interrompida (cancelar ou tempo estourado): resultado raso, descarta */
          var linhas = (res && res.linhas) || [];
          todasLinhas[idx] = linhas.length ? linhas : [{cp:0, mate:null, pv:[]}];
          posicoesNovas[idx] = compactarPosicao(todasLinhas[idx], game.fens[idx]);
          minha.atual = idx+1;
          renderAnaliseMotorUI(game);
          resolve('ok');
        }, { depth: depth, multiPv: multiPvAnalise, segundoPlano: true });
      });
    }

    for(var i=0;i<total;i++){
      if(minha.cancelado || motorCaiu) break;
      var r = await avaliarIndice(i, depthAnalise);
      if(r==='parcial' && !minha.cancelado && !motorCaiu){
        /* estourou o tempo (watchdog): tenta uma vez mais com profundidade menor antes de desistir da posicao */
        r = await avaliarIndice(i, depthReserva);
        if(r!=='ok' && !minha.cancelado && !motorCaiu) semResultado++;
      }
    }

    /* "completo" so se TODAS as posicoes foram avaliadas: um estouro de tempo nao pode passar por analise completa */
    var completo = !minha.cancelado && !motorCaiu && semResultado===0;
    var porPlyExistente = (game.analiseMotor && game.analiseMotor.porPly) || {};
    var porPly = derivarClassificacoesPorPly(todasLinhas, game.applied, porPlyExistente, game.fens);
    /* mescla por indice: uma analise parcial/cancelada nao apaga o que uma anterior ja tinha calculado */
    var posicoes = ((game.analiseMotor && game.analiseMotor.posicoes) || []).slice();
    for(var pi=0; pi<total; pi++){ if(posicoesNovas[pi]) posicoes[pi] = posicoesNovas[pi]; }
    game.analiseMotor = { porPly: porPly, feitoEm: Date.now(), completo: completo, depthUsado: depthAnalise, faltantes: semResultado, posicoes: posicoes, versao: 2 };
    await persist();
    renderMovelist(game);
    renderPainelTempo(game);
    showToast(completo ? 'Análise completa!' : (motorCaiu
      ? 'O motor parou de responder — o que já tinha sido calculado foi mantido.'
      : (minha.cancelado
        ? 'Análise cancelada — o que já tinha sido calculado foi mantido.'
        : semResultado+(semResultado===1 ? ' posição não foi avaliada (tempo esgotado)' : ' posições não foram avaliadas (tempo esgotado)')+' — o resto foi mantido; tente analisar de novo.')));
  } finally {
    if(state.analiseEmAndamento===minha) state.analiseEmAndamento = null; /* nunca apaga a analise de outra */
    loopAnaliseAtivo = false;
    renderAnaliseMotorUI(game);
    if(state.openGameId===game.id) atualizarVisualPosicao(game); /* passa a usar a analise salva */
  }
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
