/* Variante (exploracao fora da partida): LOGICA PURA sobre chess.js (global `Chess`), sem DOM e sem `state`.
   Uma variante e linear: { gameId, basePly, fens:[fenBase, ...], lances:[{san,uci,from,to,color}], cursor }.
   fens[0] e a posicao de ruptura (onde a variante saiu da partida); cursor vai de 0 ate lances.length.
   Todas as funcoes devolvem um estado NOVO (nunca alteram o recebido). */
import { numerarSan } from './analise-stats.js';

export function criarVariante(gameId, basePly, fenBase){
  return { gameId:gameId, basePly:basePly, fens:[fenBase], lances:[], cursor:0 };
}

export function fenDaVariante(v){ return v.fens[v.cursor]; }

export function fimDaVariante(v){ return v.cursor>=v.lances.length; }

function copia(v){
  return { gameId:v.gameId, basePly:v.basePly, fens:v.fens.slice(), lances:v.lances.slice(), cursor:v.cursor };
}

/* Joga from->to (promo: 'q','r','b' ou 'n'). Se o cursor nao esta no fim, descarta o que vinha depois (sem aninhar).
   Devolve o estado novo ou null se o lance for ilegal. */
export function jogarLance(v, from, to, promo){
  var c = new Chess(fenDaVariante(v));
  var mv = c.move({ from:from, to:to, promotion:promo || 'q' });
  if(!mv) return null;
  var n = copia(v);
  n.fens = n.fens.slice(0, n.cursor+1);
  n.lances = n.lances.slice(0, n.cursor);
  n.lances.push({ san:mv.san, uci:mv.from+mv.to+(mv.promotion||''), from:mv.from, to:mv.to, color:mv.color });
  n.fens.push(c.fen());
  n.cursor = n.lances.length;
  return n;
}

/* Aplica uma lista de lances UCI a partir do cursor (como "explorar" uma linha do motor). Para no 1o lance ilegal.
   `cursorFinal`: 'primeiro' (padrao: fica depois do 1o lance aplicado) ou 'fim'. */
export function aplicarLinha(v, uciList, cursorFinal){
  var n = copia(v);
  var aplicados = 0;
  (uciList||[]).forEach(function(u){
    if(!u || u.length<4) return;
    var r = jogarLance(n, u.slice(0,2), u.slice(2,4), u.length>4 ? u.slice(4,5) : undefined);
    if(!r) return;
    n = r; aplicados++;
  });
  if(aplicados>0 && cursorFinal!=='fim') n.cursor = Math.min(n.lances.length, v.cursor+1);
  return n;
}

export function irPara(v, i){
  var n = copia(v);
  n.cursor = Math.max(0, Math.min(v.lances.length, i));
  return n;
}

/* Destinos legais da peca em `casa` (so se for do lado que joga): [{to, promotion?}]. */
export function destinosLegais(fen, casa){
  var c = new Chess(fen);
  var p = c.get(casa);
  if(!p || p.color!==c.turn()) return [];
  return c.moves({ square:casa, verbose:true }).map(function(m){ return { to:m.to, promotion:m.promotion }; });
}

/* Mais de um destino igual (q, r, b, n) = promocao: precisa perguntar a peca. */
export function ehPromocao(destinos, para){
  return destinos.filter(function(d){ return d.to===para; }).length>1;
}

/* Tokens numerados, um por lance ("12...Cf6", "13.e5"): o indice i corresponde a lances[i]. */
export function tokensDaLinha(v){
  return numerarSan(v.fens[0], v.lances.map(function(l){ return l.san; })).split(' ').filter(Boolean);
}

/* O lance (from/to/promocao) e o proximo lance REAL da partida (mesmo SAN)? Se for, nao vira variante: so avanca.
   (applied nao guarda a promocao, entao a comparacao e pelo SAN, que a inclui.) */
export function ehProximoLanceReal(game, ply, from, to, promo){
  var real = game.applied[ply];
  if(!real) return false;
  var mv = new Chess(game.fens[ply]).move({ from:from, to:to, promotion:promo || 'q' });
  return !!mv && mv.san===real.san;
}
