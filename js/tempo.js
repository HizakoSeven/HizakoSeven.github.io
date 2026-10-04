/* Painel "onde eu gasto tempo de calculo": cruza o tempo pensado em cada lance
   (do %clk ou %timestamp do PGN) com o quanto esse lance perdeu de avaliacao
   (do resultado da analise completa com o motor). Mostra um grafico de
   dispersao por partida, pra identificar lances rapidos que sairam errado
   (mereciam mais atencao) e lances lentos que sairam bem (tempo bem investido). */
import { clkParaSegundos } from './analysis.js';
import { stepTo } from './partidas.js';
import { ENGINE_PERDA_ACEITAVEL } from './revisao.js';
import { escapeHtml } from './utils.js';

export function parseTimeControlSeconds(tc){
  if(!tc) return null;
  var m = String(tc).match(/^(\d+)(?:\+(\d+))?$/);
  if(!m) return null;
  return { baseSec: parseInt(m[1],10), incSec: m[2] ? parseInt(m[2],10) : 0 };
}

/* tempo gasto (em segundos) no lance `ply` (1-indexado, igual game.applied).
   Prioriza %timestamp (ja vem como tempo gasto direto). Sem isso, calcula a
   diferenca entre o relogio restante desse lance e o relogio restante do
   lance anterior DO MESMO LADO (ou o tempo base do controle, se for o
   primeiro lance desse lado), somando o incremento. Retorna null quando nao
   da pra calcular (sem %clk nem %timestamp, ou sem TimeControl no primeiro
   lance de um lado). */
export function tempoGastoSegundos(game, ply){
  var mv = game.applied[ply-1];
  if(!mv) return null;
  if(mv.timestampDs!==null && mv.timestampDs!==undefined){
    var seg = mv.timestampDs/10;
    return seg>=0 ? seg : null;
  }
  if(!mv.clk) return null;
  var atual = clkParaSegundos(mv.clk);
  if(atual===null) return null;

  var plyAnteriorMesmoLado = ply-2;
  var anteriorClk = null;
  if(plyAnteriorMesmoLado>=1){
    var mvAnterior = game.applied[plyAnteriorMesmoLado-1];
    if(mvAnterior && mvAnterior.clk) anteriorClk = clkParaSegundos(mvAnterior.clk);
  } else {
    var tcBase = parseTimeControlSeconds(game.headers && game.headers.TimeControl);
    if(tcBase) anteriorClk = tcBase.baseSec;
  }
  if(anteriorClk===null) return null;

  var tc = parseTimeControlSeconds(game.headers && game.headers.TimeControl);
  var inc = tc ? tc.incSec : 0;
  var gasto = anteriorClk - atual + inc;
  return gasto>=0 ? gasto : null;
}

/* pontos {ply, san, cor, tempo, perda, classe} pra cada lance com dado de
   tempo E de analise, restrito ao seu lado quando game.meuLado esta definido
   (mesmo criterio ja usado no resto do app). */
export function calcularPontosTempo(game){
  if(!game.analiseMotor) return [];
  var meuLado = game.meuLado;
  var pontos = [];
  for(var ply=1; ply<=game.applied.length; ply++){
    var mv = game.applied[ply-1];
    if(meuLado && mv.color!==meuLado) continue;
    var info = game.analiseMotor.porPly[ply];
    if(!info) continue;
    var tempo = tempoGastoSegundos(game, ply);
    if(tempo===null) continue;
    pontos.push({ ply:ply, san:mv.san, cor:mv.color, tempo:tempo, perda:info.perda, classe:info.classe });
  }
  return pontos;
}

function mediana(valores){
  if(!valores.length) return 0;
  var s = valores.slice().sort(function(a,b){ return a-b; });
  var meio = Math.floor(s.length/2);
  return s.length%2 ? s[meio] : (s[meio-1]+s[meio])/2;
}

var CLASSE_COR = {
  otima: 'var(--good)',
  boa: 'var(--good)',
  imprecisao: 'var(--sage)',
  erro: 'var(--amber)',
  blunder: 'var(--flag-red)',
  miss: '#6B4C7A',
  great: '#2E6E9E',
  brilhante: '#1F7A72'
};

export function renderPainelTempo(game){
  var el = document.getElementById('tempoAnaliseWrap');
  if(!el) return;

  if(!game.analiseMotor){
    el.innerHTML = '';
    return;
  }

  var pontos = calcularPontosTempo(game);
  if(pontos.length===0){
    el.innerHTML = '<div class="card" style="margin-top:12px;">'+
      '<h3 style="margin:0 0 6px;">Tempo de cálculo por lance</h3>'+
      '<p class="ci-sub">Esse PGN não trouxe dado de tempo por lance (relógio/%clk/%timestamp) — não dá pra montar esse gráfico pra essa partida.</p>'+
    '</div>';
    return;
  }

  var temposList = pontos.map(function(p){ return p.tempo; });
  var medianaTempo = mediana(temposList);
  var tempoTeto = Math.max.apply(null, temposList) || 1;
  var PERDA_TETO = 600; /* cp - acima disso ja e "blunder feio", nao precisa mais resolucao no eixo */

  var margemEsq=44, margemTopo=16, margemBaixo=26, margemDir=14;
  var larguraTotal=460, alturaTotal=250;
  var plotW = larguraTotal-margemEsq-margemDir;
  var plotH = alturaTotal-margemTopo-margemBaixo;

  function ex(t){ return margemEsq + Math.min(t,tempoTeto)/tempoTeto*plotW; }
  function ey(p){ return margemTopo + plotH - Math.min(p,PERDA_TETO)/PERDA_TETO*plotH; }

  var rapidoRuim = pontos.filter(function(p){ return p.tempo<medianaTempo && p.perda>ENGINE_PERDA_ACEITAVEL; });
  var lentoBom = pontos.filter(function(p){ return p.tempo>=medianaTempo && p.perda<=ENGINE_PERDA_ACEITAVEL; });

  var pontosSvg = pontos.map(function(p){
    var moveNum = Math.floor((p.ply-1)/2)+1;
    var label = (p.cor==='w'?moveNum+'.':moveNum+'...')+' '+p.san;
    var cor = CLASSE_COR[p.classe] || 'var(--ink-soft)';
    return '<circle data-ply="'+p.ply+'" cx="'+ex(p.tempo).toFixed(1)+'" cy="'+ey(p.perda).toFixed(1)+'" r="5.5" fill="'+cor+'" fill-opacity="0.82" stroke="var(--card)" stroke-width="1">'+
      '<title>'+escapeHtml(label)+' — '+p.tempo.toFixed(1)+'s pensado, perdeu ~'+p.perda+'cp</title>'+
    '</circle>';
  }).join('');

  var xMedianaPx = ex(medianaTempo).toFixed(1);
  var yLimitePx = ey(ENGINE_PERDA_ACEITAVEL).toFixed(1);

  var svg = ''+
    '<svg viewBox="0 0 '+larguraTotal+' '+alturaTotal+'" style="width:100%;height:auto;font-family:var(--font-mono);">'+
      '<line x1="'+margemEsq+'" y1="'+margemTopo+'" x2="'+margemEsq+'" y2="'+(margemTopo+plotH)+'" stroke="var(--line)" stroke-width="1.5"/>'+
      '<line x1="'+margemEsq+'" y1="'+(margemTopo+plotH)+'" x2="'+(margemEsq+plotW)+'" y2="'+(margemTopo+plotH)+'" stroke="var(--line)" stroke-width="1.5"/>'+
      '<line x1="'+xMedianaPx+'" y1="'+margemTopo+'" x2="'+xMedianaPx+'" y2="'+(margemTopo+plotH)+'" stroke="var(--brass)" stroke-width="1" stroke-dasharray="4,3"/>'+
      '<line x1="'+margemEsq+'" y1="'+yLimitePx+'" x2="'+(margemEsq+plotW)+'" y2="'+yLimitePx+'" stroke="var(--brass)" stroke-width="1" stroke-dasharray="4,3"/>'+
      '<text x="'+xMedianaPx+'" y="'+(margemTopo-4)+'" fill="var(--ink-soft)" font-size="9.5" text-anchor="middle">tempo típico ('+medianaTempo.toFixed(0)+'s)</text>'+
      '<text x="'+(margemEsq+plotW)+'" y="'+(parseFloat(yLimitePx)-5)+'" fill="var(--ink-soft)" font-size="9.5" text-anchor="end">limite aceitável ('+ENGINE_PERDA_ACEITAVEL+'cp)</text>'+
      '<text x="'+margemEsq+'" y="'+(alturaTotal-6)+'" fill="var(--ink-soft)" font-size="10">0s</text>'+
      '<text x="'+(margemEsq+plotW)+'" y="'+(alturaTotal-6)+'" fill="var(--ink-soft)" font-size="10" text-anchor="end">'+tempoTeto.toFixed(0)+'s</text>'+
      '<text x="'+(margemEsq-6)+'" y="'+(margemTopo+plotH)+'" fill="var(--ink-soft)" font-size="10" text-anchor="end">0cp</text>'+
      '<text x="'+(margemEsq-6)+'" y="'+(margemTopo+8)+'" fill="var(--ink-soft)" font-size="10" text-anchor="end">'+PERDA_TETO+'cp+</text>'+
      pontosSvg+
    '</svg>';

  var resumoPartes = [];
  if(rapidoRuim.length) resumoPartes.push(rapidoRuim.length+' lance'+(rapidoRuim.length===1?'':'s')+' rápido'+(rapidoRuim.length===1?'':'s')+' que ainda assim saiu errado — candidato a merecer mais tempo.');
  if(lentoBom.length) resumoPartes.push(lentoBom.length+' lance'+(lentoBom.length===1?'':'s')+' em que você pensou mais e acertou — tempo bem investido.');

  el.innerHTML = '<div class="card" style="margin-top:12px;">'+
    '<h3 style="margin:0 0 4px;">Tempo de cálculo por lance</h3>'+
    '<p class="ci-sub" style="margin-bottom:8px;">Horizontal: quanto tempo você pensou. Vertical: quanto essa jogada perdeu de avaliação. As linhas tracejadas marcam seu tempo típico nessa partida e o limite do que o motor considera "jogada aceitável". Clique num ponto pra ver o lance.</p>'+
    svg+
    (resumoPartes.length ? '<p class="ci-sub" style="margin-top:6px;">'+resumoPartes.join(' ')+'</p>' : '')+
  '</div>';

  el.querySelectorAll('circle[data-ply]').forEach(function(c){
    c.style.cursor = 'pointer';
    c.addEventListener('click', function(){ stepTo(parseInt(c.dataset.ply,10)); });
  });
}
