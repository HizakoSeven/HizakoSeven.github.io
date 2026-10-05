/* Pecas visuais compartilhadas entre a aba Partidas e a aba Revisar: cores das setas, barra de avaliacao,
   conversoes de avaliacao. Nao importa partidas.js nem revisao.js (so ui.js e utils.js). */
import { winPctDeCp } from './analise-stats.js';
import { getPrefsVis } from './ui.js';
import { escapeHtml } from './utils.js';

export { winPctDeCp };

/* Cor de cada classe de lance (grafico de tempo, grafico de avaliacao, barras do resumo). */
export var CLASSE_COR = {
  otima: 'var(--good)',
  boa: 'var(--good)',
  imprecisao: 'var(--sage)',
  erro: 'var(--amber)',
  blunder: 'var(--flag-red)',
  miss: '#6B4C7A',
  great: '#2E6E9E',
  brilhante: '#1F7A72'
};

export var COR_SETA_MELHOR = '#3f8f4a';
export var COR_SETA_TENTATIVA = '#e08a1e';
export var COR_SETA_PARTIDA = '#c0392b';

/* Cores das setas na Revisar: as do usuario (se "usar na Revisar" estiver ligado) ou as de fabrica. */
export function coresSetasRevisao(){
  var v = getPrefsVis();
  if(!v.usarNaRevisao) return { melhor:COR_SETA_MELHOR, tentativa:COR_SETA_TENTATIVA, partida:COR_SETA_PARTIDA };
  return { melhor:v.corMelhor, tentativa:COR_SETA_TENTATIVA, partida:v.corJogado };
}

export function setaDeUci(uci, cor, extra){
  if(!uci || uci.length<4) return null;
  var s = { from:uci.slice(0,2), to:uci.slice(2,4), cor:cor };
  if(extra){ if(extra.largura) s.largura = extra.largura; if(extra.op!==undefined) s.op = extra.op; }
  return s;
}

export function avalCurtoDe(norm){
  if(norm.mate!==null && norm.mate!==undefined) return 'M'+Math.abs(norm.mate);
  var v = (norm.cp||0)/100;
  return (v>=0 ? '+' : '−')+Math.abs(v).toFixed(1);
}

/* Mesma convencao da Revisar para a altura da barra em modo "peoes": cp limitado a +-500 -> 5..95%. */
function pctPeoes(cp){
  var c = Math.max(-500, Math.min(500, cp||0));
  return Math.round(50 + (c/500)*45);
}

/* Avaliacao das BRANCAS ({cp, mate} ou {fim}) -> dados da barra. Devolve null sem avaliacao.
   `lado` = quem fica embaixo ('w' ou 'b'); `fen` so e usado em fim de jogo (quem tem a vez foi mateado). */
export function dadosDaBarra(av, lado, fen, unidade){
  if(!av) return null;
  var pctBrancas, curto, texto;
  if(av.fim==='mate'){
    var vez = (fen||'').split(' ')[1];
    pctBrancas = vez==='w' ? 0 : 100; /* o lado que tem a vez foi mateado */
    curto = '#'; texto = 'xeque-mate';
  } else if(av.fim==='empate'){
    pctBrancas = 50; curto = '='; texto = 'posição empatada';
  } else if(av.mate!==null && av.mate!==undefined){
    pctBrancas = av.mate>0 ? 92 : 8;
    curto = 'M'+Math.abs(av.mate);
    texto = 'mate em '+Math.abs(av.mate)+' para as '+(av.mate>0 ? 'brancas' : 'pretas');
  } else {
    var cp = av.cp||0;
    pctBrancas = unidade==='pct' ? Math.round(Math.max(3, Math.min(97, winPctDeCp(cp)))) : pctPeoes(cp);
    curto = unidade==='pct' ? Math.round(winPctDeCp(cp))+'%' : avalCurtoDe({ cp:cp });
    texto = (cp>=0?'+':'−')+Math.abs(cp/100).toFixed(2)+(Math.abs(cp)<30 ? ' (posição igual)' : (cp>0 ? ' (vantagem das brancas)' : ' (vantagem das pretas)'));
  }
  return {
    pctBaixo: lado==='w' ? pctBrancas : 100-pctBrancas,
    texto: texto, curto: curto, corBaixo: lado,
    titulo: 'Avaliação do motor nessa posição'
  };
}

function corFundoFill(corBaixo){
  return corBaixo==='w' ? { fill:'#f2f0e8', fundo:'#2b2b2b' } : { fill:'#2b2b2b', fundo:'#f2f0e8' };
}

/* HTML da barra (Revisar e Partidas). A altura/largura do preenchimento vem da variavel CSS --p,
   o que permite o modo horizontal no celular sem trocar o HTML. */
export function barraAvaliacaoHTML(b, opts){
  opts = opts || {};
  var c = corFundoFill(b.corBaixo);
  var pos = b.pctBaixo>=50 ? 'bottom:3px;' : 'top:3px;';
  return '<div class="vbar'+(opts.fina?' fina':'')+(opts.semAnim?' sem-anim':'')+'" style="background:'+c.fundo+';--p:'+b.pctBaixo+'%;" title="'+escapeHtml(b.titulo)+'" role="img" aria-label="'+escapeHtml(b.titulo+': '+b.texto)+'">'+
    '<div class="vbar-fill" style="background:'+c.fill+';"></div>'+
    (opts.semNumero ? '' : '<div class="vbar-num" style="'+pos+'">'+escapeHtml(b.curto)+'</div>')+
  '</div>';
}

/* Pinta a barra dentro de `slot`. Com `b` null mostra a barra FANTASMA (transparente, so contorno).
   Atualiza o elemento existente em vez de recriar: assim a transicao suave de altura funciona. */
export function pintarBarra(slot, b, vis){
  if(!slot) return;
  if(!vis.barraOn){ slot.innerHTML = ''; return; }
  var el = slot.firstElementChild;
  if(!b){
    if(!vis.barraFantasma){ slot.innerHTML = '<div class="vbar vazia oculta" aria-hidden="true"></div>'; return; }
    if(!el || !el.classList.contains('vazia') || el.classList.contains('oculta')){
      slot.innerHTML = '<div class="vbar vazia'+(vis.barraFina?' fina':'')+'" title="Sem avaliação ainda" aria-hidden="true"></div>';
    }
    return;
  }
  var opts = { fina:vis.barraFina, semAnim:!vis.barraAnimar, semNumero:!vis.barraNumero || vis.barraFina };
  if(!el || el.classList.contains('vazia')){ slot.innerHTML = barraAvaliacaoHTML(b, opts); return; }
  var c = corFundoFill(b.corBaixo);
  el.style.background = c.fundo;
  el.style.setProperty('--p', b.pctBaixo+'%');
  el.classList.toggle('fina', !!opts.fina);
  el.classList.toggle('sem-anim', !!opts.semAnim);
  el.title = b.titulo;
  el.setAttribute('aria-label', b.titulo+': '+b.texto);
  var fill = el.querySelector('.vbar-fill'); if(fill) fill.style.background = c.fill;
  var num = el.querySelector('.vbar-num');
  if(opts.semNumero){ if(num) num.remove(); }
  else {
    if(!num){ num = document.createElement('div'); num.className = 'vbar-num'; el.appendChild(num); }
    num.textContent = b.curto;
    num.style.top = b.pctBaixo>=50 ? '' : '3px';
    num.style.bottom = b.pctBaixo>=50 ? '3px' : '';
  }
}
