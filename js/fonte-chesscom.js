/* Acesso a API publica do Chess.com (api.chess.com/pub). Sem DOM, sem `state`.
   Erros saem com `e.tipo`: naoEncontrado | limite | servidor | rede | resposta. */

var BASE = 'https://api.chess.com/pub';
var RE_ARQUIVO = /^https:\/\/api\.chess\.com\/pub\/player\/[^\/]+\/games\/(\d{4})\/(\d{2})$/;
var ESPERAS_MS = [2000, 5000, 10000];
var TIMEOUT_MS = 15000;

function erro(tipo){
  var e = new Error('chesscom-'+tipo);
  e.tipo = tipo;
  return e;
}

function dormir(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

/* Sem cabecalhos customizados (evita preflight de CORS). Um mes por vez, quem chama cuida disso. */
async function fetchJSON(url){
  for(var t=0; ; t++){
    var ctl = new AbortController();
    var timer = setTimeout(function(){ ctl.abort(); }, TIMEOUT_MS);
    var res;
    try{
      res = await fetch(url, { signal: ctl.signal });
    }catch(e){
      clearTimeout(timer);
      throw erro('rede'); /* offline, DNS, CORS ou timeout */
    }
    try{
      if(res.status===404) throw erro('naoEncontrado');
      if(res.status===429 || res.status>=500){
        if(t<ESPERAS_MS.length){ clearTimeout(timer); await dormir(ESPERAS_MS[t]); continue; }
        throw erro(res.status===429 ? 'limite' : 'servidor');
      }
      if(!res.ok) throw erro('resposta');
      try{ return await res.json(); }
      catch(e){ throw erro(ctl.signal.aborted ? 'rede' : 'resposta'); }
    } finally {
      clearTimeout(timer);
    }
  }
}

/* URLs dos meses com partidas, do mais antigo ao mais novo. */
export async function listarArquivos(nick){
  var u = BASE+'/player/'+encodeURIComponent(String(nick||'').trim().toLowerCase())+'/games/archives';
  var data = await fetchJSON(u);
  if(!data || !Array.isArray(data.archives)) throw erro('resposta');
  return data.archives.filter(function(a){ return typeof a==='string' && RE_ARQUIVO.test(a); }).sort();
}

/* Partidas de um mes. Mes 404 = vazio. */
export async function buscarMes(urlMes){
  if(!RE_ARQUIVO.test(String(urlMes))) throw erro('resposta');
  var data;
  try{ data = await fetchJSON(urlMes); }
  catch(e){ if(e.tipo==='naoEncontrado') return []; throw e; }
  if(!data || !Array.isArray(data.games)) throw erro('resposta');
  return data.games.filter(function(g){ return g && typeof g==='object'; });
}

export function rotuloMes(urlMes){
  var m = String(urlMes).match(RE_ARQUIVO);
  return m ? m[1]+'/'+m[2] : '';
}

/* periodo: numero de dias ou 'tudo'. Retorna ms Unix de inicio (0 = sem limite). */
export function inicioDoPeriodo(periodo, agora){
  if(periodo==='tudo' || !(periodo>0)) return 0;
  return agora - periodo*86400000;
}

/* Meses (URLs) que tocam o periodo. inicioMs 0 = todos. */
export function mesesDoPeriodo(arquivos, inicioMs){
  if(!inicioMs) return arquivos.slice();
  var d = new Date(inicioMs);
  var kIni = d.getUTCFullYear()*12 + d.getUTCMonth();
  return arquivos.filter(function(a){
    var m = a.match(RE_ARQUIVO);
    return m && (parseInt(m[1],10)*12 + parseInt(m[2],10)-1) >= kIni;
  });
}

/* Variantes (chess960 etc.) nunca entram; posicao inicial customizada tambem nao (o importador parte do inicio). */
export function passaNosFiltros(jogo, filtros, inicioMs){
  if(!jogo || typeof jogo!=='object') return false;
  if(jogo.rules!==undefined && jogo.rules!=='chess') return false;
  if(!filtros || !Array.isArray(filtros.modalidades) || filtros.modalidades.indexOf(jogo.time_class)===-1) return false;
  if(typeof jogo.pgn!=='string' || !jogo.pgn.trim()) return false;
  if(/\[SetUp\s+"1"\]/i.test(jogo.pgn)) return false;
  if(inicioMs && typeof jogo.end_time==='number' && jogo.end_time*1000 < inicioMs) return false;
  return true;
}

/* Guarda so o que veio da API. Nada inventado. */
export function montarExtras(jogo){
  var ex = {};
  if(jogo.time_class) ex.modalidade = String(jogo.time_class);
  if(typeof jogo.rated==='boolean') ex.avaliada = jogo.rated;
  if(typeof jogo.url==='string') ex.url = jogo.url;
  if(jogo.uuid) ex.uuid = String(jogo.uuid);
  if(typeof jogo.end_time==='number') ex.fimEm = jogo.end_time*1000;
  function lado(j){
    if(!j || typeof j!=='object') return null;
    var o = {};
    if(j.username) o.usuario = String(j.username);
    if(typeof j.rating==='number') o.rating = j.rating;
    if(j.result) o.resultado = String(j.result);
    return Object.keys(o).length ? o : null;
  }
  var b = lado(jogo.white), p = lado(jogo.black);
  if(b) ex.brancas = b;
  if(p) ex.pretas = p;
  var ac = jogo.accuracies;
  if(ac && typeof ac==='object'){
    var pr = {};
    if(typeof ac.white==='number') pr.w = ac.white;
    if(typeof ac.black==='number') pr.b = ac.black;
    if(Object.keys(pr).length) ex.precisao = pr;
  }
  return ex;
}

/* ---------- Textos ---------- */
var ROTULOS_MODALIDADE = { rapid:'Rapid', blitz:'Blitz', bullet:'Bullet', daily:'Diária' };
export function rotuloModalidade(tc){ return ROTULOS_MODALIDADE[tc] || (tc ? String(tc) : ''); }

var EMPATES = {
  agreed:'Empate por acordo', repetition:'Empate por repetição', stalemate:'Empate por afogamento',
  insufficient:'Empate por material insuficiente', '50move':'Empate pela regra dos 50 lances',
  timevsinsufficient:'Empate (tempo vs material insuficiente)'
};
var DERROTAS = {
  checkmated:'Derrota por xeque-mate', resigned:'Derrota por desistência', timeout:'Derrota por tempo',
  abandoned:'Derrota por abandono', lose:'Derrota'
};
var VITORIAS = {
  checkmated:'Vitória por xeque-mate', resigned:'Vitória — o adversário desistiu', timeout:'Vitória por tempo',
  abandoned:'Vitória — o adversário abandonou a partida'
};

/* Frase do SEU lado. O codigo do adversario explica como voce ganhou; o seu, como perdeu. '' se nao der. */
export function fraseDesfecho(ex, meuLado){
  if(!ex || (meuLado!=='w' && meuLado!=='b')) return '';
  var eu = meuLado==='w' ? ex.brancas : ex.pretas;
  var adv = meuLado==='w' ? ex.pretas : ex.brancas;
  var meu = eu && eu.resultado, dele = adv && adv.resultado;
  if(!meu && !dele) return '';
  if(meu==='win') return VITORIAS[dele] || 'Vitória';
  if(meu && EMPATES[meu]) return EMPATES[meu];
  if(meu && DERROTAS[meu]) return DERROTAS[meu];
  if(!meu && dele){
    if(dele==='win') return 'Derrota';
    if(EMPATES[dele]) return EMPATES[dele];
  }
  return 'Resultado: '+(meu || dele);
}

/* So devolve a URL se for https e do chess.com. */
export function urlChesscomSegura(url){
  try{
    var u = new URL(String(url));
    if(u.protocol!=='https:') return null;
    var h = u.hostname.toLowerCase();
    if(h==='chess.com' || /\.chess\.com$/.test(h)) return u.href;
  }catch(e){}
  return null;
}
