/* Aba "Analise" do viewer de partidas: posicao atual, grafico de avaliacao, resumo por lado, momentos-chave,
   fases, lista de lances marcados e acoes. As contas ficam em analise-stats.js (puras e testaveis). */
import { CLASSES_ORDEM, acplPorLado, contagemPorClasse, faixaDaAvaliacao, fasesDaPartida, momentosChave, numerarSan,
  pontoFraco, precisaoPorLado, serieDeAvaliacao, statsPorFase } from './analise-stats.js';
import { cancelarAnaliseCompleta, clkParaSegundos, iniciarAnaliseCompleta, mapClasseParaTipo, pvParaSan } from './analysis.js';
import { infoPosicaoAtual, registrarObservadorPosicao } from './posicao-visual.js';
import { atualizarRotulosAbas, registrarErroDireto, stepTo } from './partidas.js';
import { ENGINE_PERDA_ACEITAVEL } from './revisao.js';
import { tipoLabel } from './render-erros.js';
import { MOTOR_PRESETS, state } from './state.js';
import { CLASSE_COR, avalCurtoDe } from './tabuleiro-ui.js';
import { calcularPontosTempo } from './tempo.js';
import { ligarRecolhiveis } from './ui.js';
import { escapeHtml } from './utils.js';

var CLASSE_ROTULO = { brilhante:'Brilhante', great:'Ótimo', otima:'Ótima', boa:'Boa', imprecisao:'Imprecisão', erro:'Erro', miss:'Miss', blunder:'Blunder' };
var FASE_ROTULO = { abertura:'Abertura', meio:'Meio-jogo', final:'Final' };
var CLASSES_MARCADAS_GRAFICO = { blunder:true, erro:true, miss:true, brilhante:true, great:true };

/* Filtros da aba (so enquanto a partida estiver aberta; voltam ao padrao ao trocar de partida). */
var filtro = { gameId:null, lado:'ambos', classe:null, ordem:'cron' };

/* Dimensoes do grafico (viewBox) */
var GW = 460, GH = 124, GMESQ = 6, GMDIR = 6, GMTOP = 8, GMBAIXO = 16;
var GPLOT_W = GW-GMESQ-GMDIR, GPLOT_H = GH-GMTOP-GMBAIXO;

function jogoAberto(){ return state.partidas.find(function(g){ return g.id===state.openGameId; }) || null; }
function $(id){ return document.getElementById(id); }

function garantirFiltro(game){
  if(filtro.gameId!==game.id){
    filtro.gameId = game.id;
    filtro.lado = game.meuLado ? 'voce' : 'ambos'; /* nos seus lances por padrao, como sempre foi */
    filtro.classe = null;
    filtro.ordem = 'cron';
  }
  if(!game.meuLado) filtro.lado = 'ambos';
}

function passaNoLado(game, cor){
  if(filtro.lado==='ambos' || !game.meuLado) return true;
  return filtro.lado==='voce' ? cor===game.meuLado : cor!==game.meuLado;
}

function fmtPct(n){ return n.toFixed(1).replace('.', ',')+'%'; }
function fmtPerda(p){ return p>=2000 ? 'decisivo (mate ou quase)' : '~'+Math.round(p)+'cp'; }
function rotuloLance(game, ply){
  var mv = game.applied[ply-1];
  if(!mv) return '';
  var n = Math.floor((ply-1)/2)+1;
  return (mv.color==='w' ? n+'.' : n+'...')+' '+mv.san;
}
function nomeLado(game, cor){
  var h = game.headers || {};
  return (cor==='w' ? h.White : h.Black) || (cor==='w' ? 'Brancas' : 'Pretas');
}

/* posicoes mais recentes: salvas + as que a analise em andamento ja calculou */
function posicoesDisponiveis(game){
  var salvas = (game.analiseMotor && game.analiseMotor.posicoes) || [];
  var a = state.analiseEmAndamento;
  if(!a || a.gameId!==game.id || !a.posicoes) return salvas;
  var out = salvas.slice();
  for(var i=0;i<a.posicoes.length;i++){ if(a.posicoes[i]) out[i] = a.posicoes[i]; }
  return out;
}

/* ---------- Bloco 1: posicao atual (fixo no topo) ---------- */
function blocoAtualHTML(){
  return '<div class="an-atual" id="anAtual" aria-live="polite"></div>';
}

function linhaMotorHTML(rotulo, av, texto){
  return '<div class="an-linha"><span class="an-l-ev">'+escapeHtml(avalCurtoDe(av))+'</span><span class="an-l-rot">'+escapeHtml(rotulo)+'</span><span class="an-l-san">'+escapeHtml(texto)+'</span></div>';
}

function preencherAtual(game){
  var el = $('anAtual');
  if(!el) return;
  var info = infoPosicaoAtual(game);
  var h = '';
  if(info.estado==='ok' && info.pos){
    var pos = info.pos;
    var faixa = faixaDaAvaliacao(pos);
    var grande = pos.fim==='mate' ? '#' : (pos.fim==='empate' ? '=' : avalCurtoDe(pos));
    h = '<div class="an-atual-top"><span class="an-eval">'+escapeHtml(grande)+'</span>'+
      '<span class="an-faixa">'+escapeHtml(faixa)+(info.fonte==='ao vivo' ? ' <small>(ao vivo)</small>' : '')+'</span>'+
      '<button type="button" class="btn btn-ghost btn-sm" id="anVisBtn" title="Personalizar a barra e as setas">⚙</button></div>';
    if(!pos.fim){
      var linhas = '';
      var sans = pos.pv ? pvParaSan(info.fen, pos.pv, 6) : (pos.m ? pvParaSan(info.fen, [pos.m], 1) : []);
      if(sans.length) linhas += linhaMotorHTML('1ª', pos, numerarSan(info.fen, sans));
      (pos.l||[]).forEach(function(x, i){
        var s = x.u ? pvParaSan(info.fen, [x.u], 1) : [];
        if(s.length) linhas += linhaMotorHTML((i+2)+'ª', x, numerarSan(info.fen, s));
      });
      if(linhas) h += '<div class="an-linhas">'+linhas+'</div>';
    }
  } else {
    var msg = info.estado==='esperando' ? 'Avaliando a posição…' :
      info.estado==='falhou' ? 'Motor indisponível — sem avaliação para essa posição.' :
      info.estado==='desligado' ? 'Sem avaliação salva e a avaliação ao vivo está desligada (⚙ Barra e setas).' :
      'Sem avaliação para essa posição.';
    h = '<div class="an-atual-top"><span class="an-eval an-eval-vazio">…</span><span class="an-faixa">'+escapeHtml(msg)+'</span>'+
      '<button type="button" class="btn btn-ghost btn-sm" id="anVisBtn" title="Personalizar a barra e as setas">⚙</button></div>';
  }
  el.innerHTML = h;
  var btn = $('anVisBtn');
  if(btn) btn.addEventListener('click', function(e){
    e.stopPropagation(); /* senao o "clique fora" fecharia o painel na mesma hora */
    var pop = $('visPopover');
    if(pop) pop.open = true;
  });
}

/* ---------- Bloco 2: grafico de avaliacao ---------- */
function xDoGrafico(i, n){ return GMESQ + (n>1 ? i/(n-1) : 0)*GPLOT_W; }
function yDoGrafico(win){ return GMTOP + GPLOT_H - win/100*GPLOT_H; }

function graficoSVG(game, serie, fases){
  var n = serie.length;
  var base = GMTOP+GPLOT_H;
  var runs = [], cur = [];
  serie.forEach(function(s, i){
    if(s) cur.push({ i:i, win:s.win });
    else if(cur.length){ runs.push(cur); cur = []; }
  });
  if(cur.length) runs.push(cur);

  var areas = runs.map(function(r){
    if(r.length<2) return '';
    var pts = [xDoGrafico(r[0].i,n).toFixed(1)+','+base];
    r.forEach(function(p){ pts.push(xDoGrafico(p.i,n).toFixed(1)+','+yDoGrafico(p.win).toFixed(1)); });
    pts.push(xDoGrafico(r[r.length-1].i,n).toFixed(1)+','+base);
    return '<polygon points="'+pts.join(' ')+'" fill="#f2f0e8"/>';
  }).join('');
  var linhas = runs.map(function(r){
    if(r.length<2) return '';
    return '<polyline fill="none" stroke="#b9b6aa" stroke-width="1" points="'+r.map(function(p){ return xDoGrafico(p.i,n).toFixed(1)+','+yDoGrafico(p.win).toFixed(1); }).join(' ')+'"/>';
  }).join('');

  var divisorias = (fases||[]).slice(1).map(function(f){
    var x = xDoGrafico(f.de-0.5, n).toFixed(1);
    return '<line x1="'+x+'" y1="'+GMTOP+'" x2="'+x+'" y2="'+base+'" stroke="#8a8a80" stroke-width="0.8" stroke-dasharray="2,3"/>';
  }).join('');
  var rotulosFase = (fases||[]).map(function(f){
    var x = ((xDoGrafico(f.de-0.5,n)+xDoGrafico(f.ate+0.5>n-1?n-1:f.ate+0.5,n))/2);
    if(f.de===1) x = (xDoGrafico(0,n)+xDoGrafico(f.ate+0.5,n))/2;
    return '<text x="'+x.toFixed(1)+'" y="'+(GH-4)+'" font-size="8.5" text-anchor="middle" fill="var(--ink-soft)">'+escapeHtml(FASE_ROTULO[f.id].toLowerCase())+'</text>';
  }).join('');

  var porPly = (game.analiseMotor && game.analiseMotor.porPly) || {};
  var marcadores = '';
  Object.keys(porPly).forEach(function(k){
    var p = parseInt(k,10), info = porPly[k];
    if(!CLASSES_MARCADAS_GRAFICO[info.classe] || !serie[p]) return;
    var mv = game.applied[p-1];
    if(!mv || !passaNoLado(game, mv.color)) return;
    var cp = serie[p].mate!==null ? 'M'+Math.abs(serie[p].mate) : (serie[p].cp!==null ? (serie[p].cp>=0?'+':'−')+Math.abs(serie[p].cp/100).toFixed(1) : '');
    marcadores += '<circle data-ply="'+p+'" cx="'+xDoGrafico(p,n).toFixed(1)+'" cy="'+yDoGrafico(serie[p].win).toFixed(1)+'" r="3.6" fill="'+(CLASSE_COR[info.classe]||'var(--ink-soft)')+'" stroke="#fff" stroke-width="0.8">'+
      '<title>'+escapeHtml(rotuloLance(game,p)+' '+(cp?'('+cp+') ':'')+'· '+CLASSE_ROTULO[info.classe]+(info.perda?' (perdeu '+fmtPerda(info.perda)+')':''))+'</title></circle>';
  });

  var cx = xDoGrafico(state.currentPly, n).toFixed(1);
  return '<svg id="anGraficoSvg" viewBox="0 0 '+GW+' '+GH+'" style="width:100%;height:auto;display:block;touch-action:none;cursor:pointer;" role="img" aria-label="'+escapeHtml(resumoGrafico(game, serie))+'">'+
    '<rect x="'+GMESQ+'" y="'+GMTOP+'" width="'+GPLOT_W+'" height="'+GPLOT_H+'" fill="#2b2b2b" rx="3"/>'+
    areas+
    '<line x1="'+GMESQ+'" y1="'+yDoGrafico(50).toFixed(1)+'" x2="'+(GMESQ+GPLOT_W)+'" y2="'+yDoGrafico(50).toFixed(1)+'" stroke="#8a8a80" stroke-width="0.8" stroke-dasharray="4,3"/>'+
    linhas+divisorias+marcadores+
    '<line id="anCursor" x1="'+cx+'" y1="'+GMTOP+'" x2="'+cx+'" y2="'+base+'" stroke="var(--brass)" stroke-width="1.6"/>'+
    rotulosFase+
  '</svg>';
}

function resumoGrafico(game, serie){
  var n = serie.filter(Boolean).length;
  var pior = null;
  for(var p=1;p<serie.length;p++){
    if(!serie[p] || !serie[p-1]) continue;
    var cor = game.applied[p-1].color;
    var q = cor==='w' ? serie[p-1].win-serie[p].win : serie[p].win-serie[p-1].win;
    if(!pior || q>pior.q) pior = { p:p, q:q };
  }
  return 'Avaliação ao longo de '+(serie.length-1)+' lances'+(n<serie.length ? ' (parcial)' : '')+(pior && pior.q>5 ? '; maior queda no lance '+Math.ceil(pior.p/2) : '');
}

function moverCursor(game){
  var c = $('anCursor');
  if(!c) return;
  var x = xDoGrafico(state.currentPly, game.fens.length).toFixed(1);
  c.setAttribute('x1', x); c.setAttribute('x2', x);
}

function ligarGrafico(game){
  var svg = $('anGraficoSvg');
  if(!svg) return;
  var arrastando = false;
  var n = game.fens.length;
  function plyDoEvento(e){
    var alvo = e.target && e.target.getAttribute && e.target.getAttribute('data-ply');
    if(alvo && e.type==='pointerdown') return parseInt(alvo, 10);
    var r = svg.getBoundingClientRect();
    if(!r.width) return null;
    var vx = (e.clientX-r.left)/r.width*GW;
    return Math.max(0, Math.min(n-1, Math.round((vx-GMESQ)/GPLOT_W*(n-1))));
  }
  svg.addEventListener('pointerdown', function(e){
    arrastando = true;
    try{ svg.setPointerCapture(e.pointerId); }catch(err){}
    var p = plyDoEvento(e); if(p!==null && p!==state.currentPly) stepTo(p);
  });
  svg.addEventListener('pointermove', function(e){
    if(!arrastando) return;
    var p = plyDoEvento(e); if(p!==null && p!==state.currentPly) stepTo(p);
  });
  function fim(){ arrastando = false; }
  svg.addEventListener('pointerup', fim);
  svg.addEventListener('pointercancel', fim);
}

function chipsLadoHTML(game){
  if(!game.meuLado) return '';
  var opts = [['voce','Você'],['adv','Adversário'],['ambos','Ambos']];
  return '<div class="an-chips" role="group" aria-label="Filtrar por lado">'+opts.map(function(o){
    return '<button type="button" class="an-chip'+(filtro.lado===o[0]?' ativo':'')+'" data-lado="'+o[0]+'" aria-pressed="'+(filtro.lado===o[0])+'">'+o[1]+'</button>';
  }).join('')+'</div>';
}

function blocoGraficoHTML(game, serie, fases, completoSemPosicoes){
  var tem = serie.some(Boolean);
  var corpo;
  if(tem){
    corpo = chipsLadoHTML(game)+graficoSVG(game, serie, fases)+
      '<p class="ci-sub an-legenda">Clique ou arraste para ir ao lance. Alto = vantagem das brancas. Pontos: blunder, erro, miss, brilhante e ótimo.</p>';
  } else {
    corpo = '<p class="ci-sub nota-discreta">'+(completoSemPosicoes
      ? 'Análise antiga: analise de novo para ver o gráfico de avaliação.'
      : 'O gráfico aparece quando a partida for analisada.')+'</p>'+
      '<svg viewBox="0 0 '+GW+' '+GH+'" style="width:100%;height:auto;display:block;opacity:.35;" aria-hidden="true"><rect x="'+GMESQ+'" y="'+GMTOP+'" width="'+GPLOT_W+'" height="'+GPLOT_H+'" fill="none" stroke="var(--line)" stroke-dasharray="4,3" rx="3"/><line x1="'+GMESQ+'" y1="'+yDoGrafico(50)+'" x2="'+(GMESQ+GPLOT_W)+'" y2="'+yDoGrafico(50)+'" stroke="var(--line)" stroke-dasharray="4,3"/></svg>';
  }
  return '<details class="fold an-bloco" id="an-grafico" open><summary>Gráfico de avaliação</summary><div class="details-body" id="anGrafico">'+corpo+'</div></details>';
}

/* ---------- Bloco 3: resumo por lado ---------- */
function blocoResumoHTML(game, serie){
  var corA = game.meuLado || 'w', corB = corA==='w' ? 'b' : 'w';
  var h = game.headers || {};
  function nome(cor){
    var real = nomeLado(game, cor), elo = cor==='w' ? h.WhiteElo : h.BlackElo;
    var rot = game.meuLado ? (cor===game.meuLado ? 'Você' : 'Adversário') : (cor==='w' ? 'Brancas' : 'Pretas');
    return '<span class="an-lado-nome">'+escapeHtml(rot)+'</span><small>'+escapeHtml(real)+(elo ? ' · '+escapeHtml(elo) : '')+'</small>';
  }
  var prec = serie.some(Boolean) ? precisaoPorLado(game, serie) : null;
  var acpl = acplPorLado(game);
  var cont = contagemPorClasse(game);
  var ex = game.extras && game.extras.precisao;

  function celula(txt){ return '<span class="an-cel">'+txt+'</span>'; }
  var linhas = '';
  linhas += '<div class="an-res-linha"><span class="an-res-rot" title="Estimada pela variação da chance de vitória (estilo Lichess); não é a nota do Chess.com">Precisão estimada</span>'+
    celula(prec && prec[corA].acc!==null ? '<strong>'+fmtPct(prec[corA].acc)+'</strong>' : '—')+celula(prec && prec[corB].acc!==null ? '<strong>'+fmtPct(prec[corB].acc)+'</strong>' : '—')+'</div>';
  if(ex && (typeof ex.w==='number' || typeof ex.b==='number')){
    var xa = corA==='w' ? ex.w : ex.b, xb = corB==='w' ? ex.w : ex.b;
    linhas += '<div class="an-res-linha"><span class="an-res-rot">Precisão no Chess.com</span>'+celula(typeof xa==='number' ? fmtPct(xa) : '—')+celula(typeof xb==='number' ? fmtPct(xb) : '—')+'</div>';
  }
  linhas += '<div class="an-res-linha"><span class="an-res-rot" title="Média de centipeões perdidos por lance (mate limitado a 1000)">Perda média por lance</span>'+
    celula(acpl[corA].acpl!==null ? '<strong>'+Math.round(acpl[corA].acpl)+'</strong> cp' : '—')+celula(acpl[corB].acpl!==null ? '<strong>'+Math.round(acpl[corB].acpl)+'</strong> cp' : '—')+'</div>';

  var maxN = 1;
  CLASSES_ORDEM.forEach(function(c){ maxN = Math.max(maxN, cont[corA][c], cont[corB][c]); });
  var barras = CLASSES_ORDEM.map(function(c){
    var a = cont[corA][c], b = cont[corB][c];
    if(!a && !b) return '';
    function barra(n){ return '<span class="an-cel an-barra-cel"><span class="an-barra"><span style="width:'+Math.round(n/maxN*100)+'%;background:'+(CLASSE_COR[c]||'var(--ink-soft)')+';"></span></span><b>'+n+'</b></span>'; }
    return '<div class="an-res-linha"><button type="button" class="an-classe-btn'+(filtro.classe===c?' ativo':'')+'" data-classe="'+c+'" title="Filtrar a lista por '+escapeHtml(CLASSE_ROTULO[c])+'"><span class="an-ponto" style="background:'+(CLASSE_COR[c]||'var(--ink-soft)')+';"></span>'+escapeHtml(CLASSE_ROTULO[c])+'</button>'+barra(a)+barra(b)+'</div>';
  }).join('');

  return '<details class="fold an-bloco" id="an-resumo" open><summary>Resumo por lado</summary><div class="details-body">'+
    '<div class="an-res"><div class="an-res-linha an-res-cab"><span></span><span class="an-cel an-lado">'+nome(corA)+'</span><span class="an-cel an-lado">'+nome(corB)+'</span></div>'+
    linhas+barras+'</div></div></details>';
}

/* ---------- Bloco 4: momentos-chave ---------- */
function momentoHTML(game, titulo, m, classeBadge){
  if(!m) return '';
  var det = (m.antes!==null && m.depois!==null)
    ? 'Chance de vitória de quem jogou: '+Math.round(m.antes)+'% → '+Math.round(m.depois)+'%'+(m.queda>=1 ? ' (−'+Math.round(m.queda)+' pts)' : '')
    : 'Perdeu '+fmtPerda(m.perda);
  var cls = m.classe && CLASSE_COR[m.classe] ? '<span class="an-ponto" style="background:'+CLASSE_COR[m.classe]+';"></span>'+escapeHtml(CLASSE_ROTULO[m.classe])+' · ' : '';
  return '<div class="an-mom"><div class="an-mom-tit">'+escapeHtml(titulo)+'</div>'+
    '<div class="an-mom-lance">'+cls+'<strong>'+escapeHtml(rotuloLance(game, m.ply))+'</strong></div>'+
    '<div class="an-mom-det">'+escapeHtml(det)+'</div>'+
    '<button type="button" class="btn btn-ghost btn-sm" data-ver-ply="'+m.ply+'">Ver</button></div>';
}

function blocoMomentosHTML(game, serie){
  var mk = momentosChave(game, serie);
  var eu = game.meuLado, adv = eu ? (eu==='w' ? 'b' : 'w') : null;
  var cards = [];
  if(eu){
    cards.push(momentoHTML(game, 'Seu maior erro', mk.erroPorLado[eu]));
    cards.push(momentoHTML(game, 'Maior erro do adversário', mk.erroPorLado[adv]));
    cards.push(momentoHTML(game, 'Seu melhor momento', mk.destaquePorLado[eu]));
    cards.push(momentoHTML(game, 'Sua maior chance perdida', mk.missPorLado[eu]));
  } else {
    cards.push(momentoHTML(game, 'Maior erro das brancas', mk.erroPorLado.w));
    cards.push(momentoHTML(game, 'Maior erro das pretas', mk.erroPorLado.b));
    cards.push(momentoHTML(game, 'Melhor momento', mk.destaquePorLado.w || mk.destaquePorLado.b));
  }
  if(mk.virada){
    var para = mk.virada.para==='w' ? 'brancas' : 'pretas';
    var quem = eu ? (mk.virada.para===eu ? 'para você' : 'para o adversário') : 'para as '+para;
    cards.push('<div class="an-mom"><div class="an-mom-tit">A virada</div><div class="an-mom-lance"><strong>'+escapeHtml(rotuloLance(game, mk.virada.ply))+'</strong></div>'+
      '<div class="an-mom-det">A vantagem passou '+escapeHtml(quem)+' e ficou por lá.</div>'+
      '<button type="button" class="btn btn-ghost btn-sm" data-ver-ply="'+mk.virada.ply+'">Ver</button></div>');
  }
  cards = cards.filter(Boolean);
  if(!cards.length) return '';
  return '<details class="fold an-bloco" id="an-momentos" open><summary>Momentos-chave</summary><div class="details-body"><div class="an-moms">'+cards.join('')+'</div></div></details>';
}

/* ---------- Bloco 5: fases ---------- */
function blocoFasesHTML(game){
  var fases = fasesDaPartida(game);
  if(fases.length<2 && !(fases.length===1)) return '';
  var stats = statsPorFase(game, fases);
  var corA = game.meuLado || 'w', corB = corA==='w' ? 'b' : 'w';
  var maxAcpl = 1;
  fases.forEach(function(f){ [corA,corB].forEach(function(c){ var a = stats[f.id][c].acpl; if(a!==null) maxAcpl = Math.max(maxAcpl, a); }); });
  var fraco = pontoFraco(stats, corA);
  var rotA = game.meuLado ? 'Você' : 'Brancas', rotB = game.meuLado ? 'Adversário' : 'Pretas';
  function barra(s){
    if(s.acpl===null) return '<span class="an-fase-cel an-fase-vazia">—</span>';
    return '<span class="an-fase-cel"><span class="an-barra"><span style="width:'+Math.round(Math.min(s.acpl,maxAcpl)/maxAcpl*100)+'%;background:var(--amber);"></span></span><b>'+Math.round(s.acpl)+'</b> cp'+(s.graves ? ' <small>· '+s.graves+(s.graves===1?' grave':' graves')+'</small>' : '')+'</span>';
  }
  var linhas = fases.map(function(f){
    var intervalo = 'lances '+Math.ceil(f.de/2)+'–'+Math.ceil(f.ate/2);
    return '<div class="an-fase'+(fraco && fraco.fase===f.id ? ' fraco' : '')+'"><div class="an-fase-nome">'+escapeHtml(FASE_ROTULO[f.id])+' <small>'+intervalo+'</small></div>'+
      '<div class="an-fase-barras"><span class="an-fase-quem">'+rotA+'</span>'+barra(stats[f.id][corA])+'<span class="an-fase-quem">'+rotB+'</span>'+barra(stats[f.id][corB])+'</div></div>';
  }).join('');
  var nota = game.meuLado
    ? (fraco ? 'Seu ponto fraco nessa partida: <strong>'+escapeHtml(FASE_ROTULO[fraco.fase].toLowerCase())+'</strong> (perda média de '+Math.round(fraco.acpl)+' cp).' : 'Nenhuma fase se destacou como ponto fraco seu nessa partida.')
    : '';
  return '<details class="fold an-bloco" id="an-fases" open><summary>Fases da partida</summary><div class="details-body">'+linhas+(nota ? '<p class="ci-sub" style="margin-top:6px;">'+nota+'</p>' : '')+
    '<p class="ci-sub nota-discreta">Abertura: até o lance 12 · final: pouco material (peças somando até 13 pontos).</p></div></details>';
}

/* ---------- Bloco 6: teaser de tempo ---------- */
function teaserTempoHTML(game){
  var pontos = calcularPontosTempo(game);
  if(!pontos.length) return '';
  var tempos = pontos.map(function(p){ return p.tempo; }).sort(function(a,b){ return a-b; });
  var meio = Math.floor(tempos.length/2);
  var mediana = tempos.length%2 ? tempos[meio] : (tempos[meio-1]+tempos[meio])/2;
  var n = pontos.filter(function(p){ return p.tempo<mediana && p.perda>ENGINE_PERDA_ACEITAVEL; }).length;
  if(!n) return '';
  return '<p class="ci-sub an-tempo-teaser">'+n+(n===1 ? ' lance rápido que ainda assim saiu errado' : ' lances rápidos que ainda assim saíram errados')+
    ' — <button type="button" class="an-link" id="anIrTempo">ver na aba Tempo</button>.</p>';
}

/* ---------- Bloco 7: lista de lances marcados ---------- */
function blocoListaHTML(game){
  var porPly = game.analiseMotor.porPly;
  var jaLogados = {};
  state.erros.forEach(function(e){ if(e.gameId===game.id && e.ply) jaLogados[e.ply] = true; });
  var itens = [], destaques = [], presentes = {};
  Object.keys(porPly).forEach(function(k){
    var ply = parseInt(k,10), info = porPly[k], mv = game.applied[ply-1];
    if(!mv || !passaNoLado(game, mv.color)) return;
    if(info.classe==='otima' || info.classe==='boa') return;
    presentes[info.classe] = true;
    if(filtro.classe && info.classe!==filtro.classe) return;
    (info.classe==='brilhante' || info.classe==='great' ? destaques : itens).push({ ply:ply, info:info, mv:mv });
  });
  var ordC = function(a,b){ return a.ply-b.ply; };
  var ordP = function(a,b){ return (b.info.perda||0)-(a.info.perda||0) || a.ply-b.ply; };
  itens.sort(filtro.ordem==='perda' ? ordP : ordC);
  destaques.sort(ordC);

  var chips = CLASSES_ORDEM.filter(function(c){ return presentes[c]; }).map(function(c){
    return '<button type="button" class="an-chip'+(filtro.classe===c?' ativo':'')+'" data-classe="'+c+'" aria-pressed="'+(filtro.classe===c)+'">'+escapeHtml(CLASSE_ROTULO[c])+'</button>';
  }).join('');
  var topo = '<div class="an-lista-topo">'+(chips ? '<div class="an-chips" role="group" aria-label="Filtrar por classe">'+chips+'</div>' : '')+
    '<label class="an-ordem">Ordem <select id="anOrdem"><option value="cron"'+(filtro.ordem==='cron'?' selected':'')+'>Cronológica</option><option value="perda"'+(filtro.ordem==='perda'?' selected':'')+'>Pela perda</option></select></label></div>';

  function linhaItem(it, ehDestaque){
    var tipo = ehDestaque ? (it.info.classe==='brilhante' ? 'brilliant' : 'great') : mapClasseParaTipo(it.info.classe);
    var label = escapeHtml(rotuloLance(game, it.ply));
    if(ehDestaque){
      return '<div class="analise-item" data-ply="'+it.ply+'"><span class="badge badge-'+tipo+'">'+tipoLabel(tipo)+'</span><span>'+label+'</span>'+
        '<button class="btn btn-ghost btn-sm" data-ver-ply="'+it.ply+'">Ver de novo</button></div>';
    }
    var seg = it.mv.clk ? clkParaSegundos(it.mv.clk) : null;
    var pressao = (seg!==null && seg<30) ? ' · relógio em '+seg+'s' : '';
    var meu = !game.meuLado || it.mv.color===game.meuLado; /* registrar so os SEUS lances */
    var acao = jaLogados[it.ply]
      ? '<span class="flag" title="já registrado">● registrado</span><button class="btn btn-ghost btn-sm" data-ver-ply="'+it.ply+'">Ver</button>'
      : '<button class="btn btn-ghost btn-sm" data-ver-ply="'+it.ply+'">Ver</button>'+(meu ? '<button class="btn btn-primary btn-sm" data-registrar-ply="'+it.ply+'" title="Registra direto no caderno, sem abrir o formulário">Registrar</button>' : '');
    return '<div class="analise-item" data-ply="'+it.ply+'"><span class="badge badge-'+tipo+'">'+tipoLabel(tipo)+'</span><span>'+label+' (perdeu '+fmtPerda(it.info.perda||0)+')'+pressao+'</span>'+acao+'</div>';
  }
  var vazio = '<p class="ci-sub">'+(filtro.classe ? 'Nenhum lance dessa classe com esse filtro.' : 'Nenhum problema encontrado'+(game.meuLado && filtro.lado==='voce' ? ' nos seus lances' : '')+' — mandou bem nessa!')+'</p>';
  var html = (destaques.length ? '<div class="analise-lista" style="margin-bottom:8px;">'+destaques.map(function(d){ return linhaItem(d,true); }).join('')+'</div>' : '')+
    '<div class="analise-lista">'+(itens.length ? itens.map(function(i){ return linhaItem(i,false); }).join('') : (destaques.length ? '' : vazio))+'</div>';
  return '<details class="fold an-bloco" id="an-lista" open><summary>Lances marcados</summary><div class="details-body">'+topo+html+'</div></details>';
}

/* ---------- Acoes ---------- */
function acoesHTML(game){
  var a = game.analiseMotor;
  var texto = a.completo ? 'Análise completa' : (a.faltantes>0 ? 'Análise parcial ('+a.faltantes+(a.faltantes===1?' posição':' posições')+' sem avaliação — tente de novo)' : 'Análise parcial (foi cancelada no meio)');
  var antiga = !(a.posicoes && a.posicoes.length);
  return '<p class="ci-sub an-status">'+escapeHtml(texto)+(a.depthUsado ? ' · profundidade '+a.depthUsado : '')+'</p>'+
    (antiga ? '<p class="ci-sub nota-discreta">Análise antiga: analise de novo para o gráfico, a precisão e a barra valerem em todos os lances.</p>' : '')+
    '<div class="btn-row an-acoes"><button class="btn btn-ghost btn-sm" id="analisarBtn">Analisar de novo</button><button class="btn btn-ghost btn-sm" id="analisarRapidoBtn" title="Profundidade 12 — mais rápido, um pouco menos preciso">⚡ Analisar de novo (rápido)</button></div>';
}

/* ---------- Montagem ---------- */
function ligarEventos(el, game){
  Array.prototype.forEach.call(el.querySelectorAll('[data-ver-ply]'), function(btn){
    btn.addEventListener('click', function(){ stepTo(parseInt(btn.dataset.verPly,10)); });
  });
  Array.prototype.forEach.call(el.querySelectorAll('[data-registrar-ply]'), function(btn){
    btn.addEventListener('click', function(){
      if(btn.disabled) return;
      btn.disabled = true;
      btn.textContent = '✓ registrado';
      registrarErroDireto(game, parseInt(btn.dataset.registrarPly,10));
    });
  });
  Array.prototype.forEach.call(el.querySelectorAll('[data-lado]'), function(b){
    b.addEventListener('click', function(){ filtro.lado = b.dataset.lado; renderAnaliseMotorUI(game); });
  });
  Array.prototype.forEach.call(el.querySelectorAll('.an-classe-btn,.an-chip[data-classe]'), function(b){
    b.addEventListener('click', function(){ filtro.classe = filtro.classe===b.dataset.classe ? null : b.dataset.classe; renderAnaliseMotorUI(game); });
  });
  var ordem = $('anOrdem');
  if(ordem) ordem.addEventListener('change', function(){ filtro.ordem = ordem.value; renderAnaliseMotorUI(game); });
  var ir = $('anIrTempo');
  if(ir) ir.addEventListener('click', function(){ var t = document.querySelector('[data-vtab="tempo"]'); if(t) t.click(); });
  var de = $('analisarBtn');
  if(de) de.addEventListener('click', function(){ iniciarAnaliseCompleta(game); });
  var deR = $('analisarRapidoBtn');
  if(deR) deR.addEventListener('click', function(){ iniciarAnaliseCompleta(game, { depth: MOTOR_PRESETS.rapido.depthAnalise }); });
}

export function renderAnaliseMotorUI(game){
  var el = $('analiseMotorWrap');
  if(!el) return;
  garantirFiltro(game);
  atualizarRotulosAbas(game);

  var emAndamento = state.analiseEmAndamento && state.analiseEmAndamento.gameId===game.id;
  if(emAndamento){
    var a = state.analiseEmAndamento;
    var pct = a.total ? Math.round(a.atual/a.total*100) : 0;
    var serieP = serieDeAvaliacao(game, posicoesDisponiveis(game));
    el.innerHTML = blocoAtualHTML()+
      '<p class="motor-status">Analisando posição '+a.atual+' / '+a.total+'…</p>'+
      '<div class="progress-bar"><div class="progress-fill" style="width:'+pct+'%;"></div></div>'+
      '<div class="btn-row" style="justify-content:center;margin-top:6px;"><button class="btn btn-ghost btn-sm" id="analiseCancelarBtn">Cancelar</button></div>'+
      (serieP.some(Boolean) ? '<div class="an-bloco an-parcial"><div class="an-parcial-tit">O gráfico se preenche conforme a análise avança</div>'+graficoSVG(game, serieP, null)+'</div>' : '');
    var cancelBtn = $('analiseCancelarBtn');
    if(cancelBtn) cancelBtn.addEventListener('click', cancelarAnaliseCompleta);
    ligarGrafico(game);
    preencherAtual(game);
    return;
  }

  if(!game.analiseMotor){
    el.innerHTML = blocoAtualHTML()+
      '<div class="btn-row"><button class="btn btn-primary btn-sm" id="analisarBtn">Analisar partida com o motor</button>'+
      '<button class="btn btn-ghost btn-sm" id="analisarRapidoBtn" title="Profundidade 12 — bem mais rápido, um pouco menos preciso">⚡ Análise rápida</button></div>'+
      '<p class="ci-sub" style="margin-top:6px;">Avalia toda posição da partida e marca imprecisões, erros e blunders — nos seus lances por padrão.</p>'+
      '<p class="ci-sub nota-discreta">Sem análise completa, a barra e as setas usam avaliação ao vivo.</p>'+
      blocoGraficoHTML(game, serieDeAvaliacao(game, []), null, false);
    ligarEventos(el, game);
    ligarRecolhiveis(el);
    preencherAtual(game);
    return;
  }

  var posicoes = posicoesDisponiveis(game);
  var temPosicoes = !!(posicoes && posicoes.some(Boolean));
  var serie = serieDeAvaliacao(game, posicoes);
  var fases = fasesDaPartida(game);
  el.innerHTML = blocoAtualHTML()+
    blocoGraficoHTML(game, serie, fases, !temPosicoes)+
    blocoResumoHTML(game, serie)+
    (temPosicoes ? blocoMomentosHTML(game, serie) : '')+
    blocoFasesHTML(game)+
    teaserTempoHTML(game)+
    blocoListaHTML(game)+
    acoesHTML(game);
  ligarEventos(el, game);
  ligarGrafico(game);
  ligarRecolhiveis(el);
  preencherAtual(game);
  destacarAtualNaLista();
}

function destacarAtualNaLista(){
  Array.prototype.forEach.call(document.querySelectorAll('#analiseMotorWrap .analise-item'), function(it){
    it.classList.toggle('atual', parseInt(it.dataset.ply,10)===state.currentPly);
  });
}

/* Nivel leve: so a posicao atual, a linha do grafico e o destaque da lista (chamado a cada lance). */
export function atualizarAnalisePosicao(game){
  game = game || jogoAberto();
  if(!game || !$('anAtual')) return;
  preencherAtual(game);
  moverCursor(game);
  destacarAtualNaLista();
}

registrarObservadorPosicao(function(game){ atualizarAnalisePosicao(game); });
