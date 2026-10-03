/* Integracao com o motor Stockfish (Web Worker / UCI) + cache de avaliacoes por FEN. */
import { renderRevisar } from './revisao.js';
import { state } from './state.js';

export var ENGINE_JS_PATH = 'engine/stockfish-18-lite-single.js';

export var engineWorker = null;

export var engineState = 'nao-iniciado'; /* nao-iniciado | carregando | pronto | falhou */

export var engineFilaPronto = [];

export var engineCallbackAtivo = null;

export var engineInfoPorLinha = {};

export var engineMultiPvAplicado = 1;

export var engineHashAplicado = 16;

export function iniciarMotor(){
  if(engineState==='pronto' || engineState==='carregando') return;
  engineState = 'carregando';
  try{
    engineWorker = new Worker(ENGINE_JS_PATH);
  }catch(e){
    engineState = 'falhou';
    renderRevisar();
    return;
  }
  engineWorker.onmessage = function(ev){
    var linha = typeof ev.data === 'string' ? ev.data : (ev.data && ev.data.toString) ? ev.data.toString() : '';
    if(!linha) return;
    if(linha==='uciok'){ engineWorker.postMessage('isready'); return; }
    if(linha==='readyok'){
      engineState = 'pronto';
      var fila = engineFilaPronto; engineFilaPronto = [];
      fila.forEach(function(fn){ fn(); });
      return;
    }
    if(linha.indexOf('info ')===0 && linha.indexOf(' pv ')!==-1){
      var infoParsed = parseInfoUCI(linha);
      engineInfoPorLinha[infoParsed.multipv] = infoParsed;
      return;
    }
    if(linha.indexOf('bestmove')===0){
      var partes = linha.split(' ');
      var cb = engineCallbackAtivo; engineCallbackAtivo = null;
      var linhas = [];
      for(var k=1;k<=(engineMultiPvRequisitado||1);k++){
        if(engineInfoPorLinha[k]) linhas.push(engineInfoPorLinha[k]);
      }
      if(linhas.length===0 && engineInfoPorLinha[1]) linhas.push(engineInfoPorLinha[1]);
      if(cb) cb({ linhas: linhas, bestmove: (partes[1]==='(none)'?null:partes[1]) });
      return;
    }
  };
  engineWorker.onerror = function(){
    engineState = 'falhou';
    engineFilaPronto = [];
    renderRevisar();
  };
  engineWorker.postMessage('uci');
}

export function quandoMotorPronto(fn){
  iniciarMotor();
  if(engineState==='pronto'){ fn(); }
  else if(engineState!=='falhou'){ engineFilaPronto.push(fn); }
}

export function garantirOpcoesMotor(multiPvDesejado){
  multiPvDesejado = multiPvDesejado || state.motorConfig.multiPv || 1;
  var hashDesejado = state.motorConfig.hashMb||16;
  if(multiPvDesejado!==engineMultiPvAplicado){
    engineWorker.postMessage('setoption name MultiPV value '+multiPvDesejado);
    engineMultiPvAplicado = multiPvDesejado;
  }
  if(hashDesejado!==engineHashAplicado){
    engineWorker.postMessage('setoption name Hash value '+hashDesejado);
    engineHashAplicado = hashDesejado;
  }
}

export function parseInfoUCI(linha){
  var depthM = linha.match(/\bdepth (\d+)/);
  var cpM = linha.match(/\bscore cp (-?\d+)/);
  var mateM = linha.match(/\bscore mate (-?\d+)/);
  var pvM = linha.match(/\bpv (.+)$/);
  var multipvM = linha.match(/\bmultipv (\d+)/);
  return {
    depth: depthM ? parseInt(depthM[1],10) : null,
    cp: cpM ? parseInt(cpM[1],10) : null,
    mate: mateM ? parseInt(mateM[1],10) : null,
    pv: pvM ? pvM[1].trim().split(/\s+/) : [],
    multipv: multipvM ? parseInt(multipvM[1],10) : 1
  };
}

export function detectarPosicaoTerminal(fen){
  try{
    var c = new Chess(fen);
    if(c.in_checkmate()){
      /* lado a mover ja foi mateado: pior avaliacao possivel PRA ELE.
         Uso cp (nao mate) porque mate:0 nao tem sinal - sinal*0 da 0 nos dois sentidos,
         entao inverter perspectiva nao inverteria nada. cp:-100000 inverte corretamente. */
      return { cp:-100000, mate:null, pv:[], depth:0, terminal:'checkmate' };
    }
    if(c.in_stalemate() || c.insufficient_material()){
      /* posicao morta/empatada: equilibrada por definicao */
      return { cp:0, mate:null, pv:[], depth:0, terminal:'draw' };
    }
  }catch(e){ /* fen invalido ou chess.js indisponivel: deixa o motor tentar normalmente */ }
  return null;
}

export var engineReqId = 0;

export var engineMultiPvRequisitado = 1;

/* ---------- Cache de avaliacoes por FEN ----------
   A mesma posicao volta a aparecer com frequencia (revisao espacada
   reabre o mesmo erro varias vezes; navegar pra tras/frente numa
   partida ja analisada tambem repete FEN). Guardamos o resultado do
   motor por FEN + parametros (multiPV e profundidade/movetime, que
   mudam a qualidade da resposta) pra nao esperar o motor de novo.
   Tamanho limitado (LRU simples via ordem de insercao do Map) pra
   nao crescer sem fim numa sessao longa. */
var CACHE_MAX_ENTRADAS = 500;
var engineCache = new Map();

function chaveCache(fen, multiPv, profundidade, movetime){
  return fen + '|mpv' + multiPv + '|' + (profundidade ? ('d' + profundidade) : ('mt' + movetime));
}

function guardarNoCache(chave, resultado){
  if(engineCache.has(chave)) engineCache.delete(chave); /* reinsere no fim = mais recente */
  engineCache.set(chave, resultado);
  if(engineCache.size > CACHE_MAX_ENTRADAS){
    var chaveMaisAntiga = engineCache.keys().next().value;
    engineCache.delete(chaveMaisAntiga);
  }
}

export function limparCacheMotor(){
  engineCache.clear();
}

export function avaliarFEN(fen, onResultado, opcoes){
  var infoTerminal = detectarPosicaoTerminal(fen);
  if(infoTerminal){
    onResultado({ linhas:[infoTerminal], bestmove:null, terminal:true });
    return;
  }
  opcoes = opcoes || {};
  var profundidade = opcoes.depth || null;
  var movetime = opcoes.movetimeMs || (profundidade ? null : (state.motorConfig.movetimeMs || 1200));
  var multiPv = opcoes.multiPv || state.motorConfig.multiPv || 1;

  var chave = chaveCache(fen, multiPv, profundidade, movetime);
  var emCache = engineCache.get(chave);
  if(emCache){
    /* mesma FEN + mesmos parametros ja avaliados antes: devolve sem
       reconsultar o motor. Ainda assim assincrono (microtask), pra
       manter o mesmo contrato de "sempre chama onResultado depois",
       igual todo mundo que usa avaliarFEN ja espera. */
    Promise.resolve().then(function(){ onResultado(emCache); });
    return;
  }

  engineReqId++;
  var meuId = engineReqId;
  engineInfoPorLinha = {};
  engineCallbackAtivo = function(res){
    if(meuId!==engineReqId) return;
    guardarNoCache(chave, res);
    onResultado(res);
  };
  quandoMotorPronto(function(){
    if(meuId!==engineReqId) return;
    engineMultiPvRequisitado = multiPv;
    garantirOpcoesMotor(multiPv);
    engineWorker.postMessage('position fen '+fen);
    if(profundidade){
      engineWorker.postMessage('go depth '+profundidade);
    } else {
      engineWorker.postMessage('go movetime '+movetime);
    }
  });
}
