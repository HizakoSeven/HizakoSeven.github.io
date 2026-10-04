/* Integracao com o motor Stockfish (Web Worker / UCI) + cache de avaliacoes por FEN.

   Como as buscas sao organizadas (corrige a "corrida no motor"):
   - Existe UM worker e UMA busca por vez (`emBusca`). Um pedido novo nunca e
     enviado ao motor enquanto a busca anterior nao terminou, entao cada
     `bestmove` recebido pertence, sem ambiguidade, ao pedido que esta em `emBusca`.
   - Pedidos "interativos" (revisao, navegacao) substituem outros interativos:
     o mais antigo e descartado (o callback dele NAO e chamado) e, se ja estiver
     rodando, recebe `stop`. Quem chama ja ignora respostas velhas (ex.: revisao
     confere state.revisao.atualId).
   - Pedidos `segundoPlano:true` (analise completa de partida) nunca sao
     descartados: entram no fim da fila, interativos furam a frente deles, e o
     callback sempre e chamado - com `falhou:true` se o motor cair, ou
     `parcial:true` se a busca foi interrompida (resultado raso, nao vai pro cache).
   - Um watchdog manda `stop` se a busca passar muito do tempo e, se mesmo assim
     nao vier resposta, marca o motor como falho em vez de travar pra sempre. */
import { renderRevisar } from './revisao.js';
import { state } from './state.js';

export var ENGINE_JS_PATH = 'engine/stockfish-18-lite-single.js';

export var engineWorker = null;

export var engineState = 'nao-iniciado'; /* nao-iniciado | carregando | pronto | falhou */

export var engineFilaPronto = [];

export var engineInfoPorLinha = {};

export var engineMultiPvAplicado = 1;

export var engineHashAplicado = 16;

var emBusca = null;          /* pedido que o motor esta executando agora */
var fila = [];               /* pedidos esperando (interativos primeiro, depois segundo plano) */
var novoJogoPendente = false;
var watchdogTimer = null;
var watchdogStopTimer = null;

export function iniciarMotor(){
  if(engineState==='pronto' || engineState==='carregando') return;
  engineState = 'carregando';
  /* worker novo nasce com as opcoes de fabrica do Stockfish (MultiPV 1, Hash 16): sem isto, depois de uma
     queda o app achava que o MultiPV/hash antigos ainda valiam e nunca reenviava o setoption */
  engineMultiPvAplicado = 1;
  engineHashAplicado = 16;
  novoJogoPendente = true;
  try{
    engineWorker = new Worker(ENGINE_JS_PATH);
  }catch(e){
    motorFalhou();
    return;
  }
  var meuWorker = engineWorker;
  engineWorker.onmessage = function(ev){
    if(meuWorker!==engineWorker) return; /* mensagem de um worker antigo, ja descartado */
    var linha = typeof ev.data === 'string' ? ev.data : (ev.data && ev.data.toString) ? ev.data.toString() : '';
    if(!linha) return;
    if(linha==='uciok'){ engineWorker.postMessage('isready'); return; }
    if(linha==='readyok'){
      if(engineState!=='pronto'){
        engineState = 'pronto';
        var prontos = engineFilaPronto; engineFilaPronto = [];
        prontos.forEach(function(fn){ fn(); });
      }
      despachar();
      return;
    }
    if(linha.indexOf('info ')===0 && linha.indexOf(' pv ')!==-1){
      if(!emBusca || emBusca.descartado) return;
      /* linhas "lowerbound/upperbound" sao tentativas de janela, nao a avaliacao final */
      if(/\b(lowerbound|upperbound)\b/.test(linha)) return;
      var infoParsed = parseInfoUCI(linha);
      engineInfoPorLinha[infoParsed.multipv] = infoParsed;
      return;
    }
    if(linha.indexOf('bestmove')===0){
      var req = emBusca; emBusca = null;
      limparWatchdog();
      if(req && !req.descartado){
        var partes = linha.split(' ');
        var linhas = [];
        for(var k=1;k<=req.multiPv;k++){
          if(engineInfoPorLinha[k]) linhas.push(engineInfoPorLinha[k]);
        }
        if(linhas.length===0 && engineInfoPorLinha[1]) linhas.push(engineInfoPorLinha[1]);
        var res = { linhas: linhas, bestmove: (partes[1]==='(none)'?null:partes[1]) };
        if(req.parcial){
          res.parcial = true; /* interrompida: resultado raso, nao vai pro cache */
        } else {
          guardarNoCache(req.chave, res);
        }
        chamarCallback(req, res);
      }
      despachar();
      return;
    }
  };
  engineWorker.onerror = function(){
    if(meuWorker!==engineWorker) return;
    motorFalhou();
  };
  engineWorker.postMessage('uci');
}

function chamarCallback(req, res){
  try{ req.cb(res); }
  catch(e){ setTimeout(function(){ throw e; }, 0); } /* nao deixa um erro do chamador travar a fila, mas ainda aparece no banner de erro */
}

function limparWatchdog(){
  clearTimeout(watchdogTimer);
  clearTimeout(watchdogStopTimer);
  watchdogTimer = null;
  watchdogStopTimer = null;
}

function armarWatchdog(req){
  limparWatchdog();
  var limite = req.profundidade ? 90000 : ((req.movetime||1200) + 8000);
  watchdogTimer = setTimeout(function(){
    if(emBusca!==req) return;
    req.parcial = true;
    try{ engineWorker.postMessage('stop'); }catch(e){}
    watchdogStopTimer = setTimeout(function(){
      if(emBusca===req) motorFalhou(); /* nem o stop foi atendido: motor travado */
    }, 5000);
  }, limite);
}

/* O motor caiu (ou nao carregou): encerra o worker e responde a todo mundo que estava esperando,
   pra nada ficar pendurado. Pedidos interativos nao recebem callback (a tela cai pro modo simples
   via renderRevisar); os de segundo plano recebem { falhou:true }. */
function motorFalhou(){
  engineState = 'falhou';
  limparWatchdog();
  var w = engineWorker;
  engineWorker = null;
  try{ if(w) w.terminate(); }catch(e){}
  var afetados = [];
  if(emBusca) afetados.push(emBusca);
  afetados = afetados.concat(fila);
  emBusca = null;
  fila = [];
  engineFilaPronto = [];
  afetados.forEach(function(r){
    if(r.descartado) return;
    if(r.segundoPlano) chamarCallback(r, { linhas: [], bestmove: null, falhou: true });
  });
  renderRevisar();
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

/* Envia ao motor o proximo pedido da fila, se ele estiver livre e pronto. */
function despachar(){
  if(emBusca || engineState!=='pronto' || !engineWorker) return;
  while(fila.length){
    var req = fila.shift();
    if(req.descartado) continue;
    emBusca = req;
    engineInfoPorLinha = {};
    if(novoJogoPendente){
      engineWorker.postMessage('ucinewgame');
      novoJogoPendente = false;
    }
    garantirOpcoesMotor(req.multiPv);
    engineWorker.postMessage('position fen '+req.fen);
    if(req.profundidade){
      engineWorker.postMessage('go depth '+req.profundidade);
    } else {
      engineWorker.postMessage('go movetime '+req.movetime);
    }
    armarWatchdog(req);
    return;
  }
}

/* Pede ao motor pra zerar o hash antes da proxima busca (usado no inicio de uma analise completa).
   Fica pendente se houver busca em andamento - nunca e enviado no meio de uma. */
export function reiniciarHashMotor(){
  novoJogoPendente = true;
}

/* Interrompe a busca de segundo plano em andamento (botao "Cancelar" da analise).
   O resultado volta com parcial:true. */
export function interromperBuscaSegundoPlano(){
  if(emBusca && emBusca.segundoPlano && !emBusca.descartado){
    emBusca.parcial = true;
    try{ engineWorker.postMessage('stop'); }catch(e){}
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

/* ---------- Cache de avaliacoes por FEN ----------
   A mesma posicao volta a aparecer com frequencia (revisao espacada
   reabre o mesmo erro varias vezes; navegar pra tras/frente numa
   partida ja analisada tambem repete FEN). Guardamos o resultado do
   motor por FEN + parametros (multiPV e profundidade/movetime, que
   mudam a qualidade da resposta) pra nao esperar o motor de novo.
   Tamanho limitado (LRU: a leitura reinsere a entrada como mais recente)
   pra nao crescer sem fim numa sessao longa.
   Resultados interrompidos (parcial) nunca entram aqui. */
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

/* opcoes: { depth, movetimeMs, multiPv, segundoPlano }
   O callback recebe { linhas, bestmove } (mais terminal:true em posicao final,
   parcial:true se interrompido, falhou:true se o motor caiu - esses dois ultimos so em segundoPlano). */
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
    guardarNoCache(chave, emCache); /* marca como recente */
    /* mesma FEN + mesmos parametros ja avaliados antes: devolve sem
       reconsultar o motor. Ainda assim assincrono (microtask), pra
       manter o mesmo contrato de "sempre chama onResultado depois",
       igual todo mundo que usa avaliarFEN ja espera. */
    Promise.resolve().then(function(){ onResultado(emCache); });
    return;
  }

  var req = {
    fen: fen, multiPv: multiPv, profundidade: profundidade, movetime: movetime, chave: chave,
    cb: onResultado, segundoPlano: !!opcoes.segundoPlano, descartado: false, parcial: false
  };

  if(req.segundoPlano){
    fila.push(req);
  } else {
    /* um pedido interativo novo torna obsoletos os interativos anteriores */
    fila = fila.filter(function(r){
      if(r.segundoPlano) return true;
      r.descartado = true;
      return false;
    });
    fila.unshift(req); /* fura a frente dos de segundo plano */
    if(emBusca && !emBusca.segundoPlano && !emBusca.descartado){
      emBusca.descartado = true;
      try{ engineWorker.postMessage('stop'); }catch(e){} /* acelera o fim; o bestmove dela e ignorado */
    }
  }

  iniciarMotor();
  despachar();
}
