/* Barra de vantagem + setas do melhor lance no viewer da aba Partidas, e o painel "Barra e setas".
   Fonte da avaliacao de cada posicao, em ordem: (1) a analise completa salva na partida (game.analiseMotor.posicoes,
   instantanea); (2) avaliacao AO VIVO do motor (so quando nao ha dado salvo). Nada ao vivo e gravado na partida. */
import { compactarPosicao, pvParaSan } from './analysis.js';
import { setasSVG } from './board.js';
import { detectarPosicaoTerminal, avaliarFEN, engineState, iniciarMotor } from './engine.js';
import { state } from './state.js';
import { COR_SETA_MELHOR, dadosDaBarra, pintarBarra, setaDeUci } from './tabuleiro-ui.js';
import { VIS_PADRAO, aplicarPresetVis, getPrefsVis, restaurarPrefsVis, setPrefsVis } from './ui.js';
import { escapeHtml } from './utils.js';

var LARGURA_SETA = { fina:10, media:16, grossa:22 };
var LIMIAR_DECIDIDA_CP = 500;
var VIVO_DEBOUNCE_MS = 150;
var VIVO_CACHE_MAX = 400;

var vivoCache = new Map(); /* fen|mpv -> posicao compacta (so nesta sessao) */
var tokenVivo = 0;
var timerVivo = null;
var pendente = false;

function jogoAberto(){ return state.partidas.find(function(g){ return g.id===state.openGameId; }) || null; }

function guardarVivo(chave, pos){
  if(vivoCache.has(chave)) vivoCache.delete(chave);
  vivoCache.set(chave, pos);
  if(vivoCache.size>VIVO_CACHE_MAX) vivoCache.delete(vivoCache.keys().next().value);
}

function mpvAoVivo(vis){
  return (vis.setasOn && vis.setaLinhas23) ? Math.max(1, Math.min(3, vis.nLinhas)) : 1;
}

/* Posicao final (mate/empate): resolvida sem motor. */
function posicaoTerminal(fen){
  var t = detectarPosicaoTerminal(fen);
  return t ? { fim: t.terminal==='checkmate' ? 'mate' : 'empate' } : null;
}

function posicaoSalva(game, ply){
  var a = game.analiseMotor;
  return (a && a.posicoes && a.posicoes[ply]) || null;
}

/* Setas da posicao conforme as preferencias (funcao quase pura: so le o jogo e `pos`). */
export function montarSetas(game, ply, fen, pos, vis){
  if(!vis.setasOn || !pos || pos.fim) return [];
  if(vis.escondeDecidida && (pos.mate!==null && pos.mate!==undefined || Math.abs(pos.cp||0)>=LIMIAR_DECIDIDA_CP)) return [];
  var meuLado = game.meuLado;
  if(meuLado && vis.quando!=='sempre'){
    var minhaVez = String(fen).split(' ')[1]===meuLado;
    if(vis.quando==='minhaVez' && !minhaVez) return [];
    if(vis.quando==='vezAdv' && minhaVez) return [];
  }
  if(vis.soErrosCp>0){
    var info = game.analiseMotor && game.analiseMotor.porPly && game.analiseMotor.porPly[ply+1];
    if(info && info.perda<=vis.soErrosCp) return []; /* sem dado do lance seguinte: nao da pra filtrar, mostra */
  }
  var larg = LARGURA_SETA[vis.espessura] || 16;
  var setas = [];
  if(vis.setaLinhas23 && pos.l){
    pos.l.slice(0, Math.max(0, vis.nLinhas-1)).forEach(function(x){
      var s = setaDeUci(x.u, vis.corLinhas, { largura:larg, op:0.6 });
      if(s) setas.push(s);
    });
  }
  var mvReal = game.applied[ply];
  if(vis.setaJogado && mvReal && (mvReal.from+mvReal.to)!==(pos.m||'').slice(0,4)){
    setas.push({ from:mvReal.from, to:mvReal.to, cor:vis.corJogado, largura:larg });
  }
  if(vis.setaMelhor && pos.m){
    var s2 = setaDeUci(pos.m, vis.corMelhor || COR_SETA_MELHOR, { largura:larg });
    if(s2) setas.push(s2); /* por ultimo: fica por cima das outras */
  }
  return setas;
}

function aplicarLayout(vis){
  var col = document.querySelector('.viewer-card .game-board-col');
  if(col) col.classList.toggle('vbar-dir', vis.barraLado==='dir');
}

function desenhar(game, ply, fen, pos, vis){
  var slot = document.getElementById('vbarSlot');
  var setasEl = document.getElementById('setasSlot');
  var lado = state.boardFlipped ? 'b' : 'w';
  var temBarraReal = !!(slot && slot.firstElementChild && !slot.firstElementChild.classList.contains('vazia'));
  if(slot){
    if(!pos && pendente && temBarraReal){
      slot.classList.add('esperando'); /* mantem a barra anterior, esmaecida, ate chegar a nova */
    } else {
      slot.classList.remove('esperando');
      pintarBarra(slot, pos ? dadosDaBarra(pos, lado, fen, vis.barraUnidade) : null, vis);
    }
  }
  if(setasEl){
    var setas = pos ? montarSetas(game, ply, fen, pos, vis) : [];
    setasEl.innerHTML = setasSVG(setas, state.boardFlipped, { opacidade: vis.opacidade/100 });
  }
  var status = document.getElementById('moveStatus');
  if(status && status.dataset.base!==undefined){
    var san = '';
    if(vis.rotuloSan && vis.setasOn && pos && pos.m){ var s = pvParaSan(fen, [pos.m], 1); san = s[0] || ''; }
    status.textContent = status.dataset.base + (san ? '  ·  Melhor: '+san : '');
  }
}

function pedirAoVivo(game, ply, fen, vis, chave){
  clearTimeout(timerVivo);
  var meu = ++tokenVivo;
  if(!vis.aoVivo || (!vis.barraOn && !vis.setasOn) || state.activeTab!=='partidas' || engineState==='falhou' || typeof Chess==='undefined'){
    pendente = false;
    return;
  }
  pendente = true;
  timerVivo = setTimeout(function(){
    if(meu!==tokenVivo) return;
    iniciarMotor();
    avaliarFEN(fen, function(res){
      if(meu!==tokenVivo) return; /* chegou depois de o usuario ja ter ido pra outra posicao */
      pendente = false;
      var linhas = (res && res.linhas) || [];
      var pos = linhas.length ? compactarPosicao(linhas, fen) : null;
      if(pos) guardarVivo(chave, pos);
      if(state.openGameId!==game.id || state.currentPly!==ply) return;
      desenhar(game, ply, fen, pos, getPrefsVis());
    }, { movetimeMs: vis.aoVivoMs, multiPv: mpvAoVivo(vis) });
  }, VIVO_DEBOUNCE_MS);
}

/* Chamado em todo stepTo e quando uma preferencia muda. */
export function atualizarVisualPosicao(game){
  game = game || jogoAberto();
  if(!game) return;
  var vis = getPrefsVis();
  aplicarLayout(vis);
  var ply = state.currentPly, fen = game.fens[ply];
  var pos = posicaoSalva(game, ply) || posicaoTerminal(fen);
  var chave = fen+'|'+mpvAoVivo(vis);
  if(!pos){
    var viva = vivoCache.get(chave);
    if(viva){ guardarVivo(chave, viva); pos = viva; }
  }
  if(pos){
    tokenVivo++; clearTimeout(timerVivo); pendente = false; /* nada mais a esperar: invalida pedido antigo */
    desenhar(game, ply, fen, pos, vis);
    return;
  }
  if(vis.aoVivo && (vis.barraOn || vis.setasOn) && engineState!=='falhou'){
    pendente = true; /* marca antes de desenhar: a barra anterior fica esmaecida em vez de virar fantasma */
    desenhar(game, ply, fen, null, vis);
    pedirAoVivo(game, ply, fen, vis, chave);
  } else {
    tokenVivo++; clearTimeout(timerVivo); pendente = false;
    desenhar(game, ply, fen, null, vis);
  }
}

/* Fechou a partida / trocou de tela: descarta pedido pendente. */
export function cancelarVisual(){
  tokenVivo++;
  clearTimeout(timerVivo);
  pendente = false;
}

/* ---------- Botao "Setas" e painel de opcoes ---------- */
function modoRapido(vis){
  if(!vis.setasOn) return 'off';
  return vis.setaJogado ? 'melhorJogado' : 'melhor';
}
var ROTULO_MODO = { melhor:'Setas: melhor', melhorJogado:'Setas: melhor + jogado', off:'Setas: off' };
var PROXIMO_MODO = { melhor:'melhorJogado', melhorJogado:'off', off:'melhor' };
var PATCH_MODO = {
  melhor: { setasOn:true, setaMelhor:true, setaJogado:false },
  melhorJogado: { setasOn:true, setaMelhor:true, setaJogado:true },
  off: { setasOn:false }
};

function atualizarBotaoSetas(){
  var btn = document.getElementById('setasBtn');
  if(!btn) return;
  var modo = modoRapido(getPrefsVis());
  btn.textContent = '↗ '+ROTULO_MODO[modo];
  btn.title = 'Clique para alternar: melhor lance → melhor + o que você jogou → desligadas. Mais opções em "Barra e setas".';
  btn.setAttribute('aria-pressed', modo==='off' ? 'false' : 'true');
}

var CAMPOS = [
  { sec:'Setas' },
  { k:'setasOn', t:'check', r:'Mostrar setas' },
  { k:'setaMelhor', t:'check', r:'Melhor lance do motor', cor:'corMelhor' },
  { k:'setaJogado', t:'check', r:'Lance jogado na partida (quando difere)', cor:'corJogado' },
  { k:'setaLinhas23', t:'check', r:'2ª e 3ª melhores linhas', cor:'corLinhas' },
  { k:'nLinhas', t:'select', r:'Linhas com seta', op:[[1,'1'],[2,'2'],[3,'3']] },
  { k:'quando', t:'select', r:'Mostrar', op:[['sempre','Sempre'],['minhaVez','Só na minha vez'],['vezAdv','Só na vez do adversário']] },
  { k:'soErrosCp', t:'number', r:'Só se o lance jogado perdeu mais que (cp; 0 = sempre)', min:0, max:2000, step:10 },
  { k:'escondeDecidida', t:'check', r:'Esconder quando a posição já está decidida' },
  { k:'espessura', t:'select', r:'Espessura', op:[['fina','Fina'],['media','Média'],['grossa','Grossa']] },
  { k:'opacidade', t:'range', r:'Opacidade', min:30, max:100, step:5 },
  { k:'rotuloSan', t:'check', r:'Mostrar “Melhor: Cf3” ao lado do lance' },
  { sec:'Barra de vantagem' },
  { k:'barraOn', t:'check', r:'Mostrar a barra' },
  { k:'barraNumero', t:'check', r:'Mostrar o número' },
  { k:'barraUnidade', t:'select', r:'Unidade', op:[['peoes','Peões (+0,4)'],['pct','% de vitória']] },
  { k:'barraLado', t:'select', r:'Lado', op:[['esq','Esquerda'],['dir','Direita']] },
  { k:'barraFina', t:'check', r:'Barra fina' },
  { k:'barraAnimar', t:'check', r:'Animar a mudança' },
  { k:'barraFantasma', t:'check', r:'Contorno transparente antes de ter avaliação' },
  { sec:'Avaliação ao vivo (partida sem análise)' },
  { k:'aoVivo', t:'check', r:'Avaliar a posição na hora' },
  { k:'aoVivoMs', t:'select', r:'Tempo de busca', op:[[300,'0,3 s'],[600,'0,6 s'],[1000,'1 s'],[2000,'2 s']] },
  { sec:'Aba Revisar' },
  { k:'usarNaRevisao', t:'check', r:'Usar as mesmas cores das setas na Revisar' }
];

function campoHTML(c, vis){
  var id = 'vis-'+c.k;
  var v = vis[c.k];
  if(c.sec) return '<h4 class="vis-sec">'+escapeHtml(c.sec)+'</h4>';
  var cor = c.cor ? ' <input type="color" data-vis="'+c.cor+'" value="'+escapeHtml(vis[c.cor])+'" title="Cor" aria-label="Cor: '+escapeHtml(c.r)+'">' : '';
  if(c.t==='check') return '<div class="vis-row"><label for="'+id+'"><input type="checkbox" id="'+id+'" data-vis="'+c.k+'"'+(v?' checked':'')+'> '+escapeHtml(c.r)+'</label>'+cor+'</div>';
  if(c.t==='select') return '<div class="vis-row"><label for="'+id+'">'+escapeHtml(c.r)+'</label><select id="'+id+'" data-vis="'+c.k+'">'+
    c.op.map(function(o){ return '<option value="'+escapeHtml(o[0])+'"'+(String(o[0])===String(v)?' selected':'')+'>'+escapeHtml(o[1])+'</option>'; }).join('')+'</select></div>';
  if(c.t==='range') return '<div class="vis-row"><label for="'+id+'">'+escapeHtml(c.r)+' <span class="vis-val" id="'+id+'-val">'+v+'%</span></label><input type="range" id="'+id+'" data-vis="'+c.k+'" min="'+c.min+'" max="'+c.max+'" step="'+c.step+'" value="'+v+'"></div>';
  return '<div class="vis-row"><label for="'+id+'">'+escapeHtml(c.r)+'</label><input type="number" id="'+id+'" data-vis="'+c.k+'" min="'+c.min+'" max="'+c.max+'" step="'+c.step+'" value="'+v+'"></div>';
}

function renderPainel(painel, aoMudar){
  var vis = getPrefsVis();
  painel.innerHTML =
    '<div class="vis-presets"><span class="vis-lbl">Predefinições</span>'+
      '<button type="button" class="btn btn-ghost btn-sm" data-preset="discreto" title="Só a barra, fina e sem número">Discreto</button>'+
      '<button type="button" class="btn btn-ghost btn-sm" data-preset="completo" title="Barra + 3 linhas do motor + o lance jogado">Completo</button>'+
      '<button type="button" class="btn btn-ghost btn-sm" data-preset="treino" title="Sem barra nem setas: tente achar o lance sozinho">Treino</button>'+
      '<button type="button" class="btn btn-ghost btn-sm" data-preset="padrao">Restaurar padrão</button></div>'+
    CAMPOS.map(function(c){ return campoHTML(c, vis); }).join('')+
    '<p class="ci-sub vis-nota">Fica salvo só neste navegador. A avaliação ao vivo só roda quando a posição não tem análise salva.</p>';

  Array.prototype.forEach.call(painel.querySelectorAll('[data-vis]'), function(el){
    var k = el.dataset.vis;
    function aplicar(){
      var val;
      if(el.type==='checkbox') val = el.checked;
      else if(typeof VIS_PADRAO[k]==='number') val = Number(el.value);
      else val = el.value;
      setPrefsVis((function(o){ o[k]=val; return o; })({}));
      if(k==='opacidade'){ var lab = painel.querySelector('#vis-opacidade-val'); if(lab) lab.textContent = getPrefsVis().opacidade+'%'; }
      aoMudar();
    }
    el.addEventListener(el.type==='range' || el.type==='color' ? 'input' : 'change', aplicar);
  });
  Array.prototype.forEach.call(painel.querySelectorAll('[data-preset]'), function(b){
    b.addEventListener('click', function(){
      if(b.dataset.preset==='padrao') restaurarPrefsVis(); else aplicarPresetVis(b.dataset.preset);
      renderPainel(painel, aoMudar);
      aoMudar();
    });
  });
}

/* Liga o botao "Setas" e o painel (criados em renderViewer). */
export function ligarControlesVis(){
  var aoMudar = function(){ atualizarBotaoSetas(); atualizarVisualPosicao(); };
  var btn = document.getElementById('setasBtn');
  if(btn) btn.addEventListener('click', function(){
    var modo = modoRapido(getPrefsVis());
    setPrefsVis(PATCH_MODO[PROXIMO_MODO[modo]]);
    var painel = document.getElementById('visPainel');
    if(painel && painel.childElementCount) renderPainel(painel, aoMudar); /* mantem o painel coerente se estiver montado */
    aoMudar();
  });
  var painel = document.getElementById('visPainel');
  var pop = document.getElementById('visPopover');
  if(painel && pop){
    renderPainel(painel, aoMudar);
    pop.addEventListener('toggle', function(){ if(pop.open) renderPainel(painel, aoMudar); });
  }
  atualizarBotaoSetas();
}
