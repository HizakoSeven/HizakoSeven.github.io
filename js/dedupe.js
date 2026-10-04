/* Chave unica por partida, indice de duplicatas e tombstones. LOGICA PURA: sem DOM, sem `state`. */

export var MAX_IGNORADOS = 2000;

/* Chess.com: .../game/live/123, .../live/game/123, .../game/daily/123, .../analysis/game/live/123 (com ou sem www, com ?query) */
var RE_URL_CHESSCOM = /(?:^|[\/.])chess\.com\/(?:analysis\/)?(?:game\/)?(live|daily)\/(?:game\/)?(\d+)/i;

export function chaveDeUrl(url){
  if(!url) return null;
  var m = String(url).match(RE_URL_CHESSCOM);
  return m ? 'cc:'+m[1].toLowerCase()+':'+m[2] : null;
}

function txt(v){ return (v===undefined || v===null) ? '' : String(v).trim(); }

/* 1) URL (campo `url` ou cabecalho [Link]); 2) fallback "fp:" com cabecalhos + numero de lances. */
export function chavePartida(p){
  p = p || {};
  var h = p.headers || {};
  var k = chaveDeUrl(p.url) || chaveDeUrl(h.Link) || chaveDeUrl(h.Site);
  if(k) return k;
  var partes = [h.White, h.Black, h.Date, h.UTCTime || h.StartTime, h.TimeControl, h.Result,
    p.applied ? p.applied.length : ''].map(txt);
  return ('fp:'+partes.join('|')).toLowerCase();
}

/* chave -> partida. Cobre partidas antigas (sem fonteId) e o reforco por uuid ("ccu:<uuid>"). */
export function montarMapaPorChave(partidas){
  var mapa = new Map();
  (partidas || []).forEach(function(g){
    var k = g.fonteId || chavePartida({ headers:g.headers, applied:g.applied });
    mapa.set(k, g);
    if(g.extras && g.extras.uuid) mapa.set('ccu:'+g.extras.uuid, g);
  });
  return mapa;
}

/* Set de chaves (mesma regra de montarMapaPorChave). */
export function montarIndice(partidas){
  return new Set(montarMapaPorChave(partidas).keys());
}

/* ---------- Tombstones (partidas removidas que a sync nao pode trazer de volta) ---------- */
export function adicionarIgnorado(lista, chave){
  if(!chave) return lista;
  if(lista.indexOf(chave)===-1) lista.push(chave);
  while(lista.length>MAX_IGNORADOS) lista.shift();
  return lista;
}

export function removerIgnorado(lista, chave){
  var i = lista.indexOf(chave);
  if(i!==-1) lista.splice(i, 1);
  return lista;
}

/* Mais nova primeiro, pela data de fim (extras.fimEm) ou, sem ela, pelo momento em que foi salva. Estavel. */
export function ordenarPorFim(partidas){
  function fim(g){ return (g.extras && g.extras.fimEm) || g.savedAt || 0; }
  return partidas.map(function(g, i){ return { g:g, i:i }; })
    .sort(function(a, b){ return (fim(b.g)-fim(a.g)) || (a.i-b.i); })
    .map(function(x){ return x.g; });
}
