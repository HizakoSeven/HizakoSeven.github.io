/* Contas da aba Analise: precisao estimada, perda media, fases, momentos-chave, serie de avaliacao.
   LOGICA PURA (sem DOM, sem `state`, sem imports): testavel em Node. Tudo parte de
   game.fens / game.applied / game.analiseMotor.{porPly, posicoes}. */

export var CLASSES_ORDEM = ['brilhante','great','otima','boa','imprecisao','erro','miss','blunder'];
export var PERDA_TETO_CP = 1000;          /* um mate nao pode valer 100000 cp na media */
export var FASE_ABERTURA_PLIES = 24;      /* abertura = ate o lance 12 (24 plies) */
export var FASE_FINAL_MATERIAL = 13;      /* final = material "nao-peao" somado dos dois lados <= 13 (pecas: 3,3,5,9) */
export var FASE_MIN_LANCES = 3;           /* fase com menos lances de um lado nao entra no "ponto fraco" */
export var FASE_FRACA_ACPL_MIN = 25;      /* abaixo disso nao ha ponto fraco que valha destacar */
export var VIRADA_PERSISTE_PLIES = 3;
export var VIRADA_MARGEM = 10;            /* pontos de % de vitoria alem de 50 pra a virada valer */
var CLASSES_GRAVES = { erro:true, blunder:true, miss:true };

/* Probabilidade de vitoria das brancas (0..100), formula do Lichess. */
export function winPctDeCp(cp){
  return 50 + 50*(2/(1+Math.exp(-0.00368208*cp)) - 1);
}

/* {cp, mate, fim} (ponto de vista das BRANCAS) -> % de vitoria das brancas, ou null sem dado. */
export function winPctBrancas(pos, fen){
  if(!pos) return null;
  if(pos.fim==='empate') return 50;
  if(pos.fim==='mate') return String(fen||'').split(' ')[1]==='w' ? 0 : 100; /* quem tem a vez foi mateado */
  if(pos.mate!==null && pos.mate!==undefined) return winPctDeCp(pos.mate>0 ? 1000 : -1000);
  if(typeof pos.cp==='number') return winPctDeCp(pos.cp);
  return null;
}

/* Um item por posicao (indice = ply): { win, cp, mate, fim } ou null (sem dado: buraco). */
export function serieDeAvaliacao(game, posicoes){
  var pos = posicoes || (game.analiseMotor && game.analiseMotor.posicoes) || [];
  var out = [];
  for(var i=0;i<game.fens.length;i++){
    var p = pos[i];
    var w = p ? winPctBrancas(p, game.fens[i]) : null;
    out.push(w===null ? null : { win:w, cp:p.cp===undefined?null:p.cp, mate:p.mate===undefined?null:p.mate, fim:p.fim||null });
  }
  return out;
}

/* Precisao de UM lance (0..100) pela queda de % de vitoria de quem jogou. */
export function precisaoDoLance(winAntes, winDepois){
  var queda = Math.max(0, winAntes - winDepois);
  var acc = 103.1668*Math.exp(-0.04354*queda) - 3.1669;
  return Math.max(0, Math.min(100, acc));
}

function mediaDosDois(lista){
  if(!lista.length) return null;
  var soma = 0, somaInv = 0;
  lista.forEach(function(a){ soma += a; somaInv += 1/Math.max(a, 1); });
  var aritmetica = soma/lista.length;
  var harmonica = lista.length/somaInv; /* penaliza desastres isolados */
  return (aritmetica+harmonica)/2;
}

/* { w:{acc, n}, b:{acc, n} }: precisao ESTIMADA (estilo Lichess; nao e a do Chess.com). acc null sem dado. */
export function precisaoPorLado(game, serie){
  var porLado = { w:[], b:[] };
  for(var p=1;p<=game.applied.length;p++){
    var a = serie[p-1], b = serie[p];
    if(!a || !b) continue;
    var cor = game.applied[p-1].color;
    var antes = cor==='w' ? a.win : 100-a.win;
    var depois = cor==='w' ? b.win : 100-b.win;
    porLado[cor].push(precisaoDoLance(antes, depois));
  }
  return { w:{ acc:mediaDosDois(porLado.w), n:porLado.w.length }, b:{ acc:mediaDosDois(porLado.b), n:porLado.b.length } };
}

function perdaLimitada(info){ return Math.min(PERDA_TETO_CP, Math.max(0, info.perda||0)); }

/* { w:{acpl, n}, b:{acpl, n} }: perda media por lance em centipeoes (mate limitado a PERDA_TETO_CP). */
export function acplPorLado(game){
  var soma = { w:0, b:0 }, n = { w:0, b:0 };
  var porPly = (game.analiseMotor && game.analiseMotor.porPly) || {};
  Object.keys(porPly).forEach(function(k){
    var p = parseInt(k, 10);
    var mv = game.applied[p-1];
    if(!mv) return;
    soma[mv.color] += perdaLimitada(porPly[k]);
    n[mv.color]++;
  });
  return { w:{ acpl:n.w ? soma.w/n.w : null, n:n.w }, b:{ acpl:n.b ? soma.b/n.b : null, n:n.b } };
}

/* { w:{classe:n}, b:{classe:n} } */
export function contagemPorClasse(game){
  var out = { w:{}, b:{} };
  CLASSES_ORDEM.forEach(function(c){ out.w[c] = 0; out.b[c] = 0; });
  var porPly = (game.analiseMotor && game.analiseMotor.porPly) || {};
  Object.keys(porPly).forEach(function(k){
    var mv = game.applied[parseInt(k,10)-1];
    var c = porPly[k].classe;
    if(mv && out[mv.color][c]!==undefined) out[mv.color][c]++;
  });
  return out;
}

/* Material "nao-peao" (cavalos, bispos, torres, damas) dos dois lados somados, a partir do FEN. */
export function materialSemPeoes(fen){
  var placement = String(fen||'').split(' ')[0];
  var valor = { n:3, b:3, r:5, q:9 }, total = 0;
  for(var i=0;i<placement.length;i++){ total += valor[placement.charAt(i).toLowerCase()] || 0; }
  return total;
}

/* [{id:'abertura'|'meio'|'final', de, ate}] em plies (1 = primeiro lance), sem fases vazias. */
export function fasesDaPartida(game){
  var n = game.applied.length;
  var finalIni = null;
  for(var i=1;i<=n;i++){ if(materialSemPeoes(game.fens[i])<=FASE_FINAL_MATERIAL){ finalIni = i; break; } }
  var abEnd = Math.min(FASE_ABERTURA_PLIES, n);
  var finalDe = finalIni!==null ? Math.max(finalIni, abEnd+1) : n+1;
  return [
    { id:'abertura', de:1, ate:abEnd },
    { id:'meio', de:abEnd+1, ate:finalDe-1 },
    { id:'final', de:finalDe, ate:n }
  ].filter(function(f){ return f.de<=f.ate; });
}

/* { abertura:{w:{n, acpl, graves}, b:{...}}, ... } so com lances que tem classificacao. */
export function statsPorFase(game, fases){
  var porPly = (game.analiseMotor && game.analiseMotor.porPly) || {};
  var out = {};
  fases.forEach(function(f){
    var acc = { w:{ n:0, soma:0, graves:0 }, b:{ n:0, soma:0, graves:0 } };
    for(var p=f.de;p<=f.ate;p++){
      var info = porPly[p], mv = game.applied[p-1];
      if(!info || !mv) continue;
      var s = acc[mv.color];
      s.n++; s.soma += perdaLimitada(info);
      if(CLASSES_GRAVES[info.classe]) s.graves++;
    }
    out[f.id] = {
      w:{ n:acc.w.n, acpl:acc.w.n ? acc.w.soma/acc.w.n : null, graves:acc.w.graves },
      b:{ n:acc.b.n, acpl:acc.b.n ? acc.b.soma/acc.b.n : null, graves:acc.b.graves }
    };
  });
  return out;
}

/* Fase em que o lado mais perdeu ({fase, acpl}) ou null se nao ha ponto fraco claro. */
export function pontoFraco(stats, lado){
  var melhor = null;
  Object.keys(stats).forEach(function(id){
    var s = stats[id][lado];
    if(!s || s.n<FASE_MIN_LANCES || s.acpl===null) return;
    if(!melhor || s.acpl>melhor.acpl) melhor = { fase:id, acpl:s.acpl };
  });
  if(!melhor || melhor.acpl<FASE_FRACA_ACPL_MIN) return null;
  return melhor;
}

function winDoMover(serie, p, cor){
  var a = serie[p-1], b = serie[p];
  if(!a || !b) return null;
  return { antes: cor==='w' ? a.win : 100-a.win, depois: cor==='w' ? b.win : 100-b.win };
}

/* Momentos-chave. Cada item: { ply, cor, classe, perda, antes, depois, queda } (antes/depois/queda = % de vitoria de quem jogou, ou null).
   erroPorLado: o pior lance (por queda de %, ou por perda em cp sem serie); destaquePorLado: brilhante (senao great);
   missPorLado: a maior chance perdida; virada: { ply, para:'w'|'b' } ou null. */
export function momentosChave(game, serie){
  var porPly = (game.analiseMotor && game.analiseMotor.porPly) || {};
  var out = { erroPorLado:{ w:null, b:null }, destaquePorLado:{ w:null, b:null }, missPorLado:{ w:null, b:null }, virada:null };
  function item(p, info, mv){
    var w = winDoMover(serie, p, mv.color);
    return { ply:p, cor:mv.color, classe:info.classe, perda:info.perda||0,
      antes: w ? w.antes : null, depois: w ? w.depois : null, queda: w ? Math.max(0, w.antes-w.depois) : null };
  }
  function pesoErro(it){ return it.queda!==null ? it.queda : perdaLimitada({perda:it.perda})/20; }
  Object.keys(porPly).map(function(k){ return parseInt(k,10); }).sort(function(a,b){ return a-b; }).forEach(function(p){
    var info = porPly[p], mv = game.applied[p-1];
    if(!mv) return;
    var it = item(p, info, mv), c = mv.color;
    if(CLASSES_GRAVES[info.classe] || info.classe==='imprecisao'){
      var atual = out.erroPorLado[c];
      var grave = CLASSES_GRAVES[info.classe] ? 1 : 0, grAtual = atual ? (CLASSES_GRAVES[atual.classe] ? 1 : 0) : -1;
      if(!atual || grave>grAtual || (grave===grAtual && pesoErro(it)>pesoErro(atual))) out.erroPorLado[c] = it;
    }
    if(info.classe==='miss'){
      var m = out.missPorLado[c];
      if(!m || pesoErro(it)>pesoErro(m)) out.missPorLado[c] = it;
    }
    if(info.classe==='brilhante' || info.classe==='great'){
      var d = out.destaquePorLado[c];
      if(!d || (info.classe==='brilhante' && d.classe!=='brilhante')) out.destaquePorLado[c] = it;
    }
  });
  /* virada: a vantagem muda de lado (com margem) e fica la por alguns lances */
  function ladoDe(i){ var s = serie[i]; if(!s) return null; if(s.win>=50+VIRADA_MARGEM) return 'w'; if(s.win<=50-VIRADA_MARGEM) return 'b'; return null; }
  var ladoAtual = null;
  for(var i=0;i<serie.length;i++){
    var l = ladoDe(i);
    if(l===null) continue;
    if(ladoAtual===null){ ladoAtual = l; continue; }
    if(l!==ladoAtual){
      var persiste = true;
      for(var j=i; j<Math.min(serie.length, i+VIRADA_PERSISTE_PLIES); j++){
        var lj = ladoDe(j);
        if(lj===ladoAtual){ persiste = false; break; }
      }
      if(persiste){ out.virada = { ply:i, para:l }; break; }
    }
  }
  return out;
}

/* "1.e4 e5 2.Nf3" a partir de um FEN e uma lista de SAN (numeracao certa mesmo comecando com lance das pretas). */
export function numerarSan(fen, sans){
  var campos = String(fen||'').split(' ');
  var turno = campos[1]==='b' ? 'b' : 'w';
  var num = parseInt(campos[5], 10) || 1;
  var partes = [];
  (sans||[]).forEach(function(s, i){
    if(turno==='w'){ partes.push(num+'.'+s); }
    else { partes.push(i===0 ? num+'...'+s : s); num++; }
    turno = turno==='w' ? 'b' : 'w';
  });
  return partes.join(' ');
}

/* Faixa em palavras. */
export function faixaDaAvaliacao(pos){
  if(!pos) return '';
  if(pos.fim==='mate') return 'xeque-mate';
  if(pos.fim==='empate') return 'posição empatada';
  if(pos.mate!==null && pos.mate!==undefined) return 'mate forçado das '+(pos.mate>0 ? 'brancas' : 'pretas');
  var cp = pos.cp||0, a = Math.abs(cp);
  if(a<30) return 'posição igual';
  var grau = a<100 ? 'vantagem pequena' : (a<300 ? 'vantagem clara' : 'vantagem decisiva');
  return grau+' das '+(cp>0 ? 'brancas' : 'pretas');
}
