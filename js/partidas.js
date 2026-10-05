/* Visualizador de partidas importadas: tabuleiro, navegacao de lances, painel de erro rapido. */
import { cancelarAnaliseCompleta, clkParaSegundos, iniciarAnaliseCompleta, mapClasseParaTipo } from './analysis.js';
import { boardSquaresHTML } from './board.js';
import { adicionarIgnorado, chavePartida } from './dedupe.js';
import { fraseDesfecho, rotuloModalidade, urlChesscomSegura } from './fonte-chesscom.js';
import { atualizarVisualPosicao, cancelarVisual, ligarControlesVis } from './posicao-visual.js';
import { persist } from './persistence.js';
import { atualizarTelasDeErros, collectErroEditValues, erroEditFieldsHTML, removerErro, renderErros, tipoLabel } from './render-erros.js';
import { renderHeaderStats, renderHoje } from './render-hoje.js';
import { MOTOR_PRESETS, state } from './state.js';
import { parseTimeControlSeconds, renderPainelTempo } from './tempo.js';
import { escapeHtml, formatPtDate, showToast, soltarFocoAposClique, tecladoDeTablist, todayStr } from './utils.js';

/* Qual (partida, lance) o painel de registro rapido esta mostrando. Evita reconstruir o painel
   (e apagar o que a pessoa digitou) quando nada mudou - ex.: ao girar o tabuleiro. */
var painelGameId = null;
var painelPly = null;

var viewerTab = 'lances';
var ultimoTotalPartidas = null;

export function renderPartidas(){
  var wrap = document.getElementById('partidasListWrap');
  /* o menu "Importar PGN" fecha sozinho quando entra partida nova (nao abre sozinho: a troca de aba fecharia) */
  var det = document.getElementById('importPopover');
  var total = state.partidas.length;
  if(det && ultimoTotalPartidas!==null && total>ultimoTotalPartidas) det.open = false;
  ultimoTotalPartidas = total;
  if(state.partidas.length===0){
    wrap.innerHTML = '<div class="empty-state">Nenhuma partida importada ainda.'+
      '<div class="btn-row" style="justify-content:center;margin-top:10px;"><button class="btn btn-primary btn-sm" id="abrirImportarBtn">⬆ Importar partidas</button></div></div>';
    var abrir = document.getElementById('abrirImportarBtn');
    if(abrir) abrir.addEventListener('click', function(e){
      e.stopPropagation(); /* senao o "clique fora" do ui.js fecharia o menu na mesma hora */
      if(det){ det.open = true; var ta = document.getElementById('pgnPaste'); if(ta) setTimeout(function(){ ta.focus(); }, 0); }
    });
    return;
  }
  wrap.innerHTML = state.partidas.map(function(g){
    var h = g.headers||{};
    var ext = extrasResumo(g);
    /* com dados do Chess.com o ritmo vai na linha extra (formatado), pra nao aparecer duas vezes */
    var meta = [h.Date, ext ? '' : h.TimeControl, h.Result, (h.ECO?h.ECO+(h.Opening?' — '+h.Opening:''):h.Opening)].filter(Boolean).join(' · ');
    var novo = g.novaEm && (Date.now()-g.novaEm) < 7*86400000;
    var aberta = state.openGameId===g.id;
    return '<div class="partida-block">'+
      '<div class="partida-card">'+
        '<div class="partida-info">'+
          '<div class="pi-players">'+escapeHtml(h.White||'Brancas')+' vs '+escapeHtml(h.Black||'Pretas')+(novo ? ' <span class="badge-novo">novo</span>' : '')+'</div>'+
          '<div class="pi-meta">'+escapeHtml(meta)+'</div>'+
          (ext ? '<div class="pi-meta">'+ext.partes.join(' · ')+'</div>' : '')+
          (g.notaGeral ? '<div class="pi-meta" style="font-style:italic;margin-top:2px;">"'+escapeHtml(g.notaGeral)+'"</div>' : '')+
        '</div>'+
        '<div class="btn-row">'+
          '<button class="btn '+(aberta?'btn-ghost':'btn-primary')+' btn-sm" data-open="'+g.id+'">'+(aberta?'Fechar':'Abrir')+'</button>'+
          '<button class="btn btn-danger btn-sm" data-delgame="'+g.id+'">Remover</button>'+
        '</div>'+
      '</div>'+
      '<div class="partida-viewer-slot" id="viewerSlot-'+g.id+'"></div>'+
    '</div>';
  }).join('');

  wrap.querySelectorAll('[data-open]').forEach(function(btn){
    btn.addEventListener('click', function(){
      if(state.openGameId===btn.dataset.open){ closeGame(); } else { openGame(btn.dataset.open); }
    });
  });
  wrap.querySelectorAll('[data-delgame]').forEach(function(btn){
    btn.addEventListener('click', async function(){
      if(!confirm('Remover essa partida do caderno?')) return;
      var removida = state.partidas.find(function(x){ return x.id===btn.dataset.delgame; });
      if(removida){ /* tombstone: a sincronizacao nao pode trazer de volta o que voce removeu */
        adicionarIgnorado(state.sync.ignorados, removida.fonteId || chavePartida({ headers:removida.headers, applied:removida.applied }));
      }
      state.partidas = state.partidas.filter(function(x){ return x.id!==btn.dataset.delgame; });
      if(state.openGameId===btn.dataset.delgame){ state.openGameId=null; }
      renderPartidas();
      atualizarTelasDeErros(); /* os erros dessa partida passam a "partida removida" na hora */
      await persist();
    });
  });

  if(state.openGameId && state.partidas.some(function(g){return g.id===state.openGameId;})){
    renderViewer();
  }
}

export function openGame(id){
  state.openGameId = id;
  state.currentPly = 0;
  var g = state.partidas.find(function(x){ return x.id===id; });
  state.boardFlipped = !!(g && g.meuLado==='b'); /* como Lichess/Chess.com: seu lado embaixo */
  if(g && g.novaEm){ delete g.novaEm; persist(); } /* abriu: some o selo "novo" */
  renderPartidas();
  var slot = document.getElementById('viewerSlot-'+id);
  if(slot){
    var reduz = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    slot.scrollIntoView({ block:'start', behavior: reduz ? 'auto' : 'smooth' });
  }
}

export function closeGame(){
  cancelarVisual();
  state.openGameId = null;
  renderPartidas();
}

export function renderViewer(){
  var game = state.partidas.find(function(g){ return g.id===state.openGameId; });
  if(!game) return;
  var wrap = document.getElementById('viewerSlot-'+game.id);
  if(!wrap) return;

  wrap.innerHTML =
    '<div class="card viewer-card">'+
      '<div class="game-layout">'+
        '<div class="game-board-col">'+
          '<div class="player-strip" id="stripTop"></div>'+
          '<div class="board-row">'+
            '<div class="vbar-slot" id="vbarSlot"></div>'+
            '<div class="board-wrap"><div class="board" id="boardEl"></div><div id="setasSlot"></div></div>'+
          '</div>'+
          '<div class="player-strip" id="stripBottom"></div>'+
          '<div class="board-controls">'+
            '<button class="btn btn-ghost btn-sm" id="stepFirst" title="Início (Home)">⏮</button>'+
            '<button class="btn btn-ghost btn-sm" id="stepPrev" title="Lance anterior (←)">◀</button>'+
            '<button class="btn btn-ghost btn-sm" id="stepNext" title="Próximo lance (→)">▶</button>'+
            '<button class="btn btn-ghost btn-sm" id="stepLast" title="Fim (End)">⏭</button>'+
            '<button class="btn btn-ghost btn-sm" id="flipBtn" title="Girar tabuleiro">⇅ Girar</button>'+
            '<button class="btn btn-ghost btn-sm" id="setasBtn" aria-pressed="true"></button>'+
            '<details class="popover" id="visPopover"><summary title="Barra de vantagem e setas: personalizar">⚙ Barra e setas</summary><div class="pop-body vis-pop" id="visPainel"></div></details>'+
          '</div>'+
          '<div class="move-status" id="moveStatus"></div>'+
        '</div>'+
        '<div class="game-side"><div class="game-side-inner">'+
          '<div class="side-tabs" role="tablist" aria-label="Painel da partida">'+
            '<button class="side-tab" data-vtab="lances" role="tab" id="vtab-lances" aria-controls="vpane-lances" aria-selected="false" tabindex="-1">Lances</button>'+
            '<button class="side-tab" data-vtab="analise" role="tab" id="vtab-analise" aria-controls="vpane-analise" aria-selected="false" tabindex="-1">Análise</button>'+
            '<button class="side-tab" data-vtab="erro" role="tab" id="vtab-erro" aria-controls="vpane-erro" aria-selected="false" tabindex="-1">Erro</button>'+
            '<button class="side-tab" data-vtab="tempo" role="tab" id="vtab-tempo" aria-controls="vpane-tempo" aria-selected="false" tabindex="-1">Tempo</button>'+
            '<button class="side-tab" data-vtab="info" role="tab" id="vtab-info" aria-controls="vpane-info" aria-selected="false" tabindex="-1">Info</button>'+
          '</div>'+
          '<div class="side-pane" data-pane="lances" role="tabpanel" id="vpane-lances" aria-labelledby="vtab-lances"><div class="movelist" id="movelistEl"></div></div>'+
          '<div class="side-pane" data-pane="analise" role="tabpanel" id="vpane-analise" aria-labelledby="vtab-analise"><div id="analiseMotorWrap"></div></div>'+
          '<div class="side-pane" data-pane="erro" role="tabpanel" id="vpane-erro" aria-labelledby="vtab-erro"><div class="quick-erro-panel" id="quickErroPanel"></div></div>'+
          '<div class="side-pane" data-pane="tempo" role="tabpanel" id="vpane-tempo" aria-labelledby="vtab-tempo"><div id="tempoAnaliseWrap"></div></div>'+
          '<div class="side-pane info-pane" data-pane="info" role="tabpanel" id="vpane-info" aria-labelledby="vtab-info">'+
            '<div id="ladoPickerWrap"></div>'+
            '<label for="notaGeralInput">Nota geral dessa partida</label>'+
            '<input type="text" id="notaGeralInput" placeholder="ex: senti dificuldade em finais de torre" value="'+escapeHtml(game.notaGeral||'')+'">'+
            infoPartidaHTML(game)+
          '</div>'+
        '</div></div>'+
      '</div>'+
    '</div>';

  document.getElementById('stepFirst').addEventListener('click', function(){ stepTo(0); });
  document.getElementById('stepPrev').addEventListener('click', function(){ stepTo(Math.max(0,state.currentPly-1)); });
  document.getElementById('stepNext').addEventListener('click', function(){ stepTo(Math.min(game.fens.length-1,state.currentPly+1)); });
  document.getElementById('stepLast').addEventListener('click', function(){ stepTo(game.fens.length-1); });
  document.getElementById('flipBtn').addEventListener('click', function(){ state.boardFlipped=!state.boardFlipped; stepTo(state.currentPly,true); });
  document.getElementById('notaGeralInput').addEventListener('blur', async function(e){
    game.notaGeral = e.target.value.trim();
    await persist();
  });
  wrap.querySelectorAll('[data-vtab]').forEach(function(btn){
    btn.addEventListener('click', function(e){ viewerTab = btn.dataset.vtab; aplicarAbaViewer(); soltarFocoAposClique(e); });
  });
  tecladoDeTablist(wrap.querySelector('.side-tabs'), '.side-tab', function(btn){ viewerTab = btn.dataset.vtab; aplicarAbaViewer(); });

  ligarControlesVis();
  renderLadoPicker(game);
  renderMovelist(game);
  renderAnaliseMotorUI(game);
  renderPainelTempo(game);
  painelGameId = null; /* o HTML do viewer acabou de ser recriado: o painel precisa ser pintado */
  aplicarAbaViewer();
  stepTo(state.currentPly, true);
}

/* Dados da partida (aba Info). */
function fmtPct(n){ return n.toFixed(1).replace('.', ','); }

/* Linhas (ja escapadas) com o que veio do Chess.com; null se a partida nao tem `extras`. */
function extrasResumo(game){
  var ex = game.extras;
  if(!ex || typeof ex!=='object') return null;
  var h = game.headers || {};
  var meu = game.meuLado;
  var minha = meu==='w' ? ex.brancas : meu==='b' ? ex.pretas : null;
  var adv = meu==='w' ? ex.pretas : meu==='b' ? ex.brancas : null;
  var r = { partes:[], modalidade:'', ritmo:'', tipo:'', desfecho:'', ratings:'', precisao:'', link:'' };
  r.modalidade = escapeHtml(rotuloModalidade(ex.modalidade));
  r.ritmo = escapeHtml(formatTimeControl(h.TimeControl));
  r.tipo = ex.avaliada===true ? 'avaliada' : (ex.avaliada===false ? 'amistosa' : '');
  r.desfecho = escapeHtml(fraseDesfecho(ex, meu));
  function rt(l){ return l && typeof l.rating==='number' ? l.rating : null; }
  if(minha && adv && rt(minha)!==null && rt(adv)!==null){
    r.ratings = 'Rating: <strong>'+escapeHtml(rt(minha))+'</strong> vs '+escapeHtml(rt(adv));
  } else if(rt(ex.brancas)!==null && rt(ex.pretas)!==null){
    r.ratings = 'Rating: '+escapeHtml(rt(ex.brancas))+' (brancas) / '+escapeHtml(rt(ex.pretas))+' (pretas)';
  }
  var p = ex.precisao;
  if(p && typeof p==='object'){
    var pw = typeof p.w==='number' ? fmtPct(p.w)+'%' : null, pb = typeof p.b==='number' ? fmtPct(p.b)+'%' : null;
    if(meu){
      var pm = meu==='w' ? pw : pb, pa = meu==='w' ? pb : pw;
      var t = [pm ? pm+' você' : null, pa ? pa+' adversário' : null].filter(Boolean).join(' / ');
      if(t) r.precisao = 'Precisão: '+escapeHtml(t);
    } else {
      var t2 = [pw ? pw+' brancas' : null, pb ? pb+' pretas' : null].filter(Boolean).join(' / ');
      if(t2) r.precisao = 'Precisão: '+escapeHtml(t2);
    }
  }
  var u = urlChesscomSegura(ex.url);
  if(u) r.link = '<a href="'+escapeHtml(u)+'" target="_blank" rel="noopener">abrir no Chess.com</a>';
  r.partes = [r.modalidade, r.ritmo, r.tipo, r.desfecho, r.ratings, r.precisao, r.link].filter(Boolean);
  return r.partes.length ? r : null;
}

function infoPartidaHTML(game){
  var h = game.headers || {};
  var linhas = [];
  function add(rotulo, valor){ if(valor) linhas.push('<dt>'+rotulo+'</dt><dd>'+valor+'</dd>'); }
  add('Brancas', escapeHtml((h.White||'') + (h.WhiteElo ? ' ('+h.WhiteElo+')' : '')));
  add('Pretas', escapeHtml((h.Black||'') + (h.BlackElo ? ' ('+h.BlackElo+')' : '')));
  add('Data', escapeHtml(h.Date||''));
  add('Ritmo', escapeHtml(h.TimeControl||''));
  add('Resultado', escapeHtml(h.Result||''));
  add('Abertura', escapeHtml((h.ECO ? h.ECO+' ' : '') + (h.Opening||'')));
  var url = h.Link || h.Site || '';
  if(/^https?:\/\//.test(url)) add('Partida', '<a href="'+escapeHtml(url)+'" target="_blank" rel="noopener">abrir no site</a>');
  var ext = extrasResumo(game);
  if(ext){
    add('Modalidade', [ext.modalidade, ext.tipo].filter(Boolean).join(' · '));
    add('Desfecho', ext.desfecho);
    add('Ratings', ext.ratings.replace(/^Rating: /, ''));
    add('Precisão', ext.precisao.replace(/^Precisão: /, ''));
    if(!/^https?:\/\//.test(url)) add('Partida', ext.link);
  }
  return linhas.length ? '<dl class="game-meta">'+linhas.join('')+'</dl>' : '';
}

/* ---------- Painel lateral em abas ---------- */
function aplicarAbaViewer(){
  document.querySelectorAll('[data-vtab]').forEach(function(b){
    var ativo = b.dataset.vtab===viewerTab;
    b.classList.toggle('active', ativo);
    b.setAttribute('aria-selected', ativo ? 'true' : 'false');
    b.tabIndex = ativo ? 0 : -1;
  });
  document.querySelectorAll('[data-pane]').forEach(function(p){ p.classList.toggle('active', p.dataset.pane===viewerTab); });
  if(viewerTab==='lances') centralizarLanceAtual();
}

/* Marcadores nas abas: erro ja registrado no lance atual, analise feita. */
function atualizarRotulosAbas(game){
  var tErro = document.querySelector('[data-vtab="erro"]');
  if(tErro){
    var ex = state.currentPly>0 && state.erros.some(function(e){ return e.gameId===game.id && e.ply===state.currentPly; });
    tErro.textContent = ex ? 'Erro ●' : 'Erro';
  }
  var tAn = document.querySelector('[data-vtab="analise"]');
  if(tAn) tAn.textContent = game.analiseMotor ? 'Análise ✓' : 'Análise';
  var tInfo = document.querySelector('[data-vtab="info"]');
  if(tInfo){
    tInfo.textContent = game.meuLado ? 'Info' : 'Info ⚠';
    tInfo.title = game.meuLado ? '' : 'Diga de que lado você jogou: o tabuleiro gira e o painel de erro usa isso';
  }
}

/* Mantem o lance atual visivel dentro da lista, rolando so a lista (nunca a pagina). */
function centralizarLanceAtual(){
  var lista = document.getElementById('movelistEl');
  if(!lista || !lista.clientHeight) return;
  var cur = lista.querySelector('.move-btn.current');
  if(!cur) { lista.scrollTop = 0; return; }
  lista.scrollTop = Math.max(0, cur.offsetTop - lista.clientHeight/2 + cur.offsetHeight/2);
}

/* ---------- Faixas de jogador (nome, rating, relogio), como Chess.com ---------- */
function formatarRelogio(seg){
  var hh = Math.floor(seg/3600), mm = Math.floor((seg%3600)/60), ss = Math.floor(seg%60);
  return hh>0 ? hh+':'+String(mm).padStart(2,'0')+':'+String(ss).padStart(2,'0') : mm+':'+String(ss).padStart(2,'0');
}

function relogioDe(game, ply, cor){
  for(var p=ply;p>=1;p--){
    var m = game.applied[p-1];
    if(m && m.color===cor && m.clk){
      var seg = clkParaSegundos(m.clk);
      return seg===null ? '' : formatarRelogio(seg);
    }
  }
  /* esse lado ainda nao jogou: mostra o tempo inicial do controle - mas so se a partida
     tem dado de relogio, senao ficaria um "10:00" parado e enganoso */
  if(!game.applied.some(function(m){ return m.clk; })) return '';
  var tc = parseTimeControlSeconds(game.headers && game.headers.TimeControl);
  return tc ? formatarRelogio(tc.baseSec) : '';
}

function renderStrips(game, ply){
  var h = game.headers||{};
  function html(cor){
    var nome = cor==='w' ? (h.White||'Brancas') : (h.Black||'Pretas');
    var elo = cor==='w' ? h.WhiteElo : h.BlackElo;
    return '<span class="ps-dot ps-'+cor+'"></span><span class="ps-name">'+escapeHtml(nome)+'</span>'+
      (elo && elo!=='?' ? '<span class="ps-elo">('+escapeHtml(elo)+')</span>' : '')+
      (game.meuLado===cor ? '<span class="ps-me">você</span>' : '')+
      '<span class="ps-clock">'+escapeHtml(relogioDe(game, ply, cor))+'</span>';
  }
  var topo = document.getElementById('stripTop'), base = document.getElementById('stripBottom');
  if(topo) topo.innerHTML = html(state.boardFlipped ? 'w' : 'b');
  if(base) base.innerHTML = html(state.boardFlipped ? 'b' : 'w');
}

/* Define de que lado voce jogou: gira o tabuleiro (seu lado embaixo) e repinta tudo que depende disso
   (faixas "voce", painel de erro, grafico de tempo, que so mostra os seus lances). */
function aplicarMeuLado(game, lado){
  game.meuLado = lado;
  if(lado) state.boardFlipped = lado==='b';
  renderLadoPicker(game);
  renderQuickErroPanel(game);
  renderPainelTempo(game);
  stepTo(state.currentPly, true);
  return persist();
}

export function renderLadoPicker(game){
  var wrap = document.getElementById('ladoPickerWrap');
  if(!wrap) return;
  if(game.meuLado){
    wrap.innerHTML = '<p style="font-family:var(--font-mono);font-size:12px;color:var(--ink-soft);margin:4px 0 12px;">Você jogou de: <strong>'+(game.meuLado==='w'?'Brancas':'Pretas')+'</strong> · <a href="#" id="trocarLadoLink" style="color:var(--brass-deep);">trocar</a></p>';
    var link = document.getElementById('trocarLadoLink');
    if(link) link.addEventListener('click', function(e){
      e.preventDefault();
      aplicarMeuLado(game, null);
    });
  } else {
    wrap.innerHTML = '<div class="btn-row" style="margin:4px 0 12px;align-items:center;">'+
      '<span style="font-size:13px;color:var(--ink-soft);">Você jogou de:</span>'+
      '<button class="btn btn-ghost btn-sm" id="ladoBrancasBtn">Brancas</button>'+
      '<button class="btn btn-ghost btn-sm" id="ladoPretasBtn">Pretas</button>'+
    '</div>';
    document.getElementById('ladoBrancasBtn').addEventListener('click', function(){ aplicarMeuLado(game, 'w'); });
    document.getElementById('ladoPretasBtn').addEventListener('click', function(){ aplicarMeuLado(game, 'b'); });
  }
}

/* Registra direto, sem abrir o formulario, o erro apontado pela analise do motor nesse lance.
   Preenche tudo o que da pra deduzir (data, ritmo, resultado, tipo, contexto); o motivo e o padrao
   ficam vazios e podem ser preenchidos depois (Editar, aqui ou na aba Caderno de Erros). */
export async function registrarErroDireto(game, ply){
  var mv = game.applied[ply-1];
  if(!mv) return false;
  var jaExiste = state.erros.some(function(e){ return e.gameId===game.id && e.ply===ply; });
  if(jaExiste){ showToast('Esse lance já está registrado.'); return false; }

  var info = game.analiseMotor && game.analiseMotor.porPly[ply];
  var tipo = (info && mapClasseParaTipo(info.classe)) || 'inaccuracy';
  var h = game.headers||{};
  var dataVal = todayStr();
  if(h.Date && /^\d{4}\.\d{2}\.\d{2}$/.test(h.Date)){ dataVal = h.Date.replace(/\./g,'-'); }
  var moveNum = Math.floor((ply-1)/2)+1;
  var label = (mv.color==='w' ? moveNum+'.' : moveNum+'...')+' '+mv.san;

  state.erros.unshift({
    id: 'e'+Date.now(),
    data: dataVal,
    ritmo: formatTimeControl(h.TimeControl),
    resultado: deriveResultado(game.meuLado, h.Result) || 'Derrota',
    tipo: tipo,
    lance: label,
    motivo: '',
    padrao: '',
    contexto: (h.White||'Brancas')+' vs '+(h.Black||'Pretas')+' · '+(h.TimeControl||'')+' · FEN: '+game.fens[ply],
    gameId: game.id,
    ply: ply,
    criadoEm: Date.now(),
    acertosSeguidos: 0,
    resolvido: false,
    vezesRevisado: 0,
    ultimaRevisaoEm: null
  });
  /* atualiza a tela NA HORA (otimista) e so depois grava; a gravacao pode demorar */
  showToast('Erro registrado: '+label+'.');
  atualizarTelasDeErros();
  await persist();
  return true;
}

export function renderAnaliseMotorUI(game){
  var el = document.getElementById('analiseMotorWrap');
  if(!el) return;
  atualizarRotulosAbas(game);

  var emAndamento = state.analiseEmAndamento && state.analiseEmAndamento.gameId===game.id;
  if(emAndamento){
    var a = state.analiseEmAndamento;
    var pct = a.total ? Math.round(a.atual/a.total*100) : 0;
    el.innerHTML =
      '<p class="motor-status">Analisando posição '+a.atual+' / '+a.total+'…</p>'+
      '<div class="progress-bar"><div class="progress-fill" style="width:'+pct+'%;"></div></div>'+
      '<div class="btn-row" style="justify-content:center;margin-top:6px;"><button class="btn btn-ghost btn-sm" id="analiseCancelarBtn">Cancelar</button></div>';
    var cancelBtn = document.getElementById('analiseCancelarBtn');
    if(cancelBtn) cancelBtn.addEventListener('click', cancelarAnaliseCompleta);
    return;
  }

  if(!game.analiseMotor){
    el.innerHTML = '<div class="btn-row"><button class="btn btn-primary btn-sm" id="analisarBtn">Analisar partida com o motor</button>'+
      '<button class="btn btn-ghost btn-sm" id="analisarRapidoBtn" title="Profundidade 12 — bem mais rápido, um pouco menos preciso">⚡ Análise rápida</button></div>'+
      '<p class="ci-sub" style="margin-top:6px;">Avalia toda posição da partida e marca imprecisões, erros e blunders — nos seus lances por padrão.</p>'+
      '<p class="ci-sub nota-discreta">Sem análise completa, a barra e as setas usam avaliação ao vivo.</p>';
    var btn = document.getElementById('analisarBtn');
    if(btn) btn.addEventListener('click', function(){ iniciarAnaliseCompleta(game); });
    var btnRapido = document.getElementById('analisarRapidoBtn');
    if(btnRapido) btnRapido.addEventListener('click', function(){ iniciarAnaliseCompleta(game, { depth: MOTOR_PRESETS.rapido.depthAnalise }); });
    return;
  }

  var meuLado = game.meuLado;
  var contagem = {imprecisao:0, erro:0, blunder:0, miss:0};
  var itens = [];
  var destaques = [];
  Object.keys(game.analiseMotor.porPly).forEach(function(plyStr){
    var ply = parseInt(plyStr,10);
    var info = game.analiseMotor.porPly[plyStr];
    if(meuLado && info.cor!==meuLado) return;
    if(info.classe==='otima' || info.classe==='boa') return;
    if(info.classe==='brilhante' || info.classe==='great'){ destaques.push({ply:ply, info:info}); return; }
    contagem[info.classe] = (contagem[info.classe]||0)+1;
    itens.push({ply:ply, info:info});
  });
  itens.sort(function(a,b){ return a.ply-b.ply; });
  destaques.sort(function(a,b){ return a.ply-b.ply; });

  var jaLogados = {};
  state.erros.forEach(function(e){ if(e.gameId===game.id && e.ply) jaLogados[e.ply]=true; });

  var nBrilhantes = destaques.filter(function(d){ return d.info.classe==='brilhante'; }).length;
  var nGreat = destaques.filter(function(d){ return d.info.classe==='great'; }).length;
  var textoDestaque = [];
  if(nBrilhantes) textoDestaque.push(nBrilhantes+' brilhante'+(nBrilhantes===1?'':'s'));
  if(nGreat) textoDestaque.push(nGreat+' ótimo'+(nGreat===1?'':'s'));

  var resumo = '<p class="lede" style="margin-bottom:8px;">'+
    (game.analiseMotor.completo?'Análise completa':(game.analiseMotor.faltantes>0?'Análise parcial ('+game.analiseMotor.faltantes+(game.analiseMotor.faltantes===1?' posição':' posições')+' sem avaliação — tente de novo)':'Análise parcial (foi cancelada no meio)'))+(game.analiseMotor.depthUsado?' (profundidade '+game.analiseMotor.depthUsado+')':'')+
    ' · '+contagem.blunder+' blunder'+(contagem.blunder===1?'':'s')+', '+contagem.erro+' erro'+(contagem.erro===1?'':'s')+', '+contagem.imprecisao+' imprecis'+(contagem.imprecisao===1?'ão':'ões')+', '+contagem.miss+' miss'+
    (meuLado ? ' nos seus lances' : '')+'.</p>'+
    (destaques.length ? '<div class="feedback-banner certo">🌟 '+textoDestaque.join(' e ')+' — bons momentos nessa partida!</div>' : '');

  var brilhantesHtml = destaques.length ? '<div class="analise-lista" style="margin-bottom:10px;">'+destaques.map(function(it){
    var moveNum = Math.floor((it.ply-1)/2)+1;
    var mv = game.applied[it.ply-1];
    var label = (mv.color==='w'?moveNum+'.':moveNum+'...')+' '+escapeHtml(mv.san);
    var tipoBadge = it.info.classe==='brilhante' ? 'brilliant' : 'great';
    return '<div class="analise-item">'+
      '<span class="badge badge-'+tipoBadge+'">'+tipoLabel(tipoBadge)+'</span>'+
      '<span>'+label+'</span>'+
      '<button class="btn btn-ghost btn-sm" data-ver-ply="'+it.ply+'">Ver de novo</button>'+
    '</div>';
  }).join('')+'</div>' : '';

  var listaHtml = itens.length ? itens.map(function(it){
    var moveNum = Math.floor((it.ply-1)/2)+1;
    var mv = game.applied[it.ply-1];
    var label = (mv.color==='w'?moveNum+'.':moveNum+'...')+' '+escapeHtml(mv.san);
    var tipo = mapClasseParaTipo(it.info.classe);
    var segRestantes = mv.clk ? clkParaSegundos(mv.clk) : null;
    var pressao = (segRestantes!==null && segRestantes<30) ? ' · relógio em '+segRestantes+'s' : '';
    return '<div class="analise-item">'+
      '<span class="badge badge-'+tipo+'">'+tipoLabel(tipo)+'</span>'+
      '<span>'+label+' (perdeu ~'+it.info.perda+'cp)'+pressao+'</span>'+
      (jaLogados[it.ply]
        ? '<span class="flag" title="já registrado">● registrado</span><button class="btn btn-ghost btn-sm" data-ver-ply="'+it.ply+'">Ver</button>'
        : '<button class="btn btn-ghost btn-sm" data-ver-ply="'+it.ply+'">Ver</button><button class="btn btn-primary btn-sm" data-registrar-ply="'+it.ply+'" title="Registra direto no caderno, sem abrir o formulário">Registrar</button>')+
    '</div>';
  }).join('') : '<p class="ci-sub">Nenhum problema encontrado'+(meuLado?' nos seus lances':'')+' — mandou bem nessa!</p>';

  var notaPosicoes = (game.analiseMotor.posicoes && game.analiseMotor.posicoes.length) ? '' :
    '<p class="ci-sub nota-discreta">Análise antiga: analise de novo para a barra e as setas valerem em todos os lances (por ora usam avaliação ao vivo).</p>';
  el.innerHTML = resumo+brilhantesHtml+'<div class="analise-lista">'+listaHtml+'</div>'+notaPosicoes+
    '<div class="btn-row" style="margin-top:10px;"><button class="btn btn-ghost btn-sm" id="analisarBtn">Analisar de novo</button><button class="btn btn-ghost btn-sm" id="analisarRapidoBtn" title="Profundidade 12 — mais rápido, um pouco menos preciso">⚡ Analisar de novo (rápido)</button></div>';

  el.querySelectorAll('[data-ver-ply]').forEach(function(btn){
    btn.addEventListener('click', function(){ stepTo(parseInt(btn.dataset.verPly,10)); });
  });
  el.querySelectorAll('[data-registrar-ply]').forEach(function(btn){
    btn.addEventListener('click', function(){
      if(btn.disabled) return;
      btn.disabled = true;
      btn.textContent = '✓ registrado';
      registrarErroDireto(game, parseInt(btn.dataset.registrarPly,10));
    });
  });
  var btnDeNovo = document.getElementById('analisarBtn');
  if(btnDeNovo) btnDeNovo.addEventListener('click', function(){ iniciarAnaliseCompleta(game); });
  var btnDeNovoRapido = document.getElementById('analisarRapidoBtn');
  if(btnDeNovoRapido) btnDeNovoRapido.addEventListener('click', function(){ iniciarAnaliseCompleta(game, { depth: MOTOR_PRESETS.rapido.depthAnalise }); });
}

export function moveTimeLabel(mv){
  if(mv.timestampDs===null || mv.timestampDs===undefined) return '';
  var segundos = mv.timestampDs/10;
  var texto = segundos>=10 ? Math.round(segundos)+'s' : segundos.toFixed(1)+'s';
  var lento = segundos>=20;
  return '<span class="move-time'+(lento?' move-time-slow':'')+'" title="tempo pensado nesse lance">'+texto+'</span>';
}

export function motorFlagHTML(game, ply){
  if(!game.analiseMotor || !game.analiseMotor.porPly[ply]) return '';
  var info = game.analiseMotor.porPly[ply];
  var mapa = {
    blunder: {simbolo:'??', classeCss:'blunder', rotulo:'Blunder'},
    erro: {simbolo:'?', classeCss:'mistake', rotulo:'Erro (Mistake)'},
    imprecisao: {simbolo:'?!', classeCss:'inaccuracy', rotulo:'Imprecisão'},
    miss: {simbolo:'×', classeCss:'miss', rotulo:'Miss'},
    great: {simbolo:'!', classeCss:'great', rotulo:'Ótimo'},
    brilhante: {simbolo:'!!', classeCss:'brilliant', rotulo:'Brilhante'}
  };
  var m = mapa[info.classe];
  if(!m) return '';
  return '<span class="flag-motor tipo-'+m.classeCss+'" title="motor: '+m.rotulo+', perdeu ~'+info.perda+'cp">'+m.simbolo+'</span>';
}

export function renderMovelist(game){
  var el = document.getElementById('movelistEl');
  if(!el) return;
  var loggedPlies = {};
  state.erros.forEach(function(e){ if(e.gameId===game.id && e.ply){ loggedPlies[e.ply] = true; } });
  var rows = [];
  for(var i=0;i<game.applied.length;i+=2){
    var num = Math.floor(i/2)+1;
    var w = game.applied[i];
    var b = game.applied[i+1];
    var wPly = i+1, bPly = i+2;
    rows.push(
      '<div class="move-row">'+
        '<div class="move-num">'+num+'.</div>'+
        '<button class="move-btn" data-ply="'+wPly+'">'+escapeHtml(w.san)+(w.annotation?'<span class="flag">'+escapeHtml(w.annotation)+'</span>':'')+motorFlagHTML(game,wPly)+(loggedPlies[wPly]?'<span class="flag" title="erro já registrado">●</span>':'')+moveTimeLabel(w)+'</button>'+
        (b ? '<button class="move-btn" data-ply="'+bPly+'">'+escapeHtml(b.san)+(b.annotation?'<span class="flag">'+escapeHtml(b.annotation)+'</span>':'')+motorFlagHTML(game,bPly)+(loggedPlies[bPly]?'<span class="flag" title="erro já registrado">●</span>':'')+moveTimeLabel(b)+'</button>' : '<div></div>')+
      '</div>'
    );
  }
  el.innerHTML = rows.join('');
  el.querySelectorAll('.move-btn').forEach(function(btn){
    btn.classList.toggle('current', parseInt(btn.dataset.ply,10)===state.currentPly); /* repintar nao pode apagar o destaque */
    btn.addEventListener('click', function(){ stepTo(parseInt(btn.dataset.ply,10)); });
  });
}

export function stepTo(ply, skipRerenderMovelist){
  var game = state.partidas.find(function(g){ return g.id===state.openGameId; });
  if(!game) return;
  ply = Math.max(0, Math.min(game.fens.length-1, ply));
  state.currentPly = ply;
  var fen = game.fens[ply];
  var lastMove = ply>0 ? game.applied[ply-1] : null;

  var boardEl = document.getElementById('boardEl');
  boardEl.innerHTML = boardSquaresHTML(fen, lastMove, state.boardFlipped);

  var status = document.getElementById('moveStatus');
  if(ply===0){
    status.textContent = 'Posição inicial';
  } else {
    var moveNum = Math.floor((ply-1)/2)+1;
    var label = (lastMove.color==='w' ? moveNum+'.' : moveNum+'...')+' '+lastMove.san;
    status.textContent = label + (ply===game.fens.length-1 ? '  ·  (última posição)' : '');
  }

  status.dataset.base = status.textContent; /* a barra/setas acrescentam "Melhor: ..." a esse texto */
  atualizarVisualPosicao(game);

  document.querySelectorAll('.move-btn').forEach(function(btn){
    btn.classList.toggle('current', parseInt(btn.dataset.ply,10)===ply);
  });

  renderStrips(game, ply);
  if(viewerTab==='lances') centralizarLanceAtual();
  atualizarRotulosAbas(game);

  if(painelGameId!==game.id || painelPly!==ply) renderQuickErroPanel(game);
}

export function formatTimeControl(tc){
  if(!tc) return '';
  var m = String(tc).match(/^(\d+)(?:\+(\d+))?$/);
  if(!m) return String(tc);
  var baseSec = parseInt(m[1],10);
  var inc = m[2] ? parseInt(m[2],10) : 0;
  var minutes = Math.round(baseSec/60);
  return minutes+'+'+inc;
}

export function deriveResultado(meuLado, result){
  if(!meuLado || !result) return '';
  if(result==='1/2-1/2') return 'Empate';
  if(result==='1-0') return meuLado==='w' ? 'Vitória' : 'Derrota';
  if(result==='0-1') return meuLado==='b' ? 'Vitória' : 'Derrota';
  return '';
}

export function proximoPlyComErroPendente(game, plyAtual){
  if(!game.analiseMotor) return null;
  var logados = {};
  state.erros.forEach(function(e){ if(e.gameId===game.id && e.ply){ logados[e.ply] = true; } });
  var candidatos = Object.keys(game.analiseMotor.porPly).map(Number).filter(function(p){
    var info = game.analiseMotor.porPly[p];
    if(info.classe==='otima' || info.classe==='boa') return false;
    if(game.meuLado && info.cor!==game.meuLado) return false;
    if(logados[p]) return false;
    return true;
  }).sort(function(a,b){ return a-b; });
  var proximos = candidatos.filter(function(p){ return p>plyAtual; });
  return proximos.length ? proximos[0] : null;
}

export function renderQuickErroPanel(game){
  var panel = document.getElementById('quickErroPanel');
  if(!panel) return;
  atualizarRotulosAbas(game);
  painelGameId = game.id;
  painelPly = state.currentPly;
  var ply = state.currentPly;
  var mv = ply>0 ? game.applied[ply-1] : null;
  var label = '(posição inicial)';
  if(mv){
    var moveNum = Math.floor((ply-1)/2)+1;
    label = (mv.color==='w' ? moveNum+'.' : moveNum+'...')+' '+mv.san;
  }
  var existing = ply>0 ? state.erros.find(function(e){ return e.gameId===game.id && e.ply===ply; }) : null;
  var countThisGame = state.erros.filter(function(e){ return e.gameId===game.id; }).length;
  var countLabel = countThisGame+' erro'+(countThisGame===1?'':'s')+' registrado'+(countThisGame===1?'':'s')+' nesta partida';

  if(existing && state.editingErroId!==existing.id){
    /* MODO: ja existe um erro registrado nesse lance - mostra, edita ou remove */
    panel.innerHTML =
      '<h3 style="margin:0 0 8px;">Erro registrado nesse lance</h3>'+
      '<div class="erro-card tipo-'+existing.tipo+'" style="margin:0;">'+
        '<div class="erro-top"><span class="erro-date">'+escapeHtml(formatPtDate(existing.data))+'</span><span class="badge badge-'+existing.tipo+'">'+tipoLabel(existing.tipo)+'</span></div>'+
        '<div class="erro-move">'+escapeHtml(existing.lance||label)+'</div>'+
        (existing.motivo ? '<div class="erro-field-label">O que eu devia ter pensado</div><div class="erro-field-val">'+escapeHtml(existing.motivo)+'</div>' : '')+
        (existing.padrao ? '<div class="erro-field-label">Padrão recorrente</div><div class="erro-field-val">'+escapeHtml(existing.padrao)+'</div>' : '')+
        '<div class="btn-row" style="margin-top:10px;">'+
          '<button class="btn btn-ghost btn-sm" id="qeEditExistingBtn">Editar</button>'+
          '<button class="btn btn-danger btn-sm" id="qeRemoveExistingBtn">Remover</button>'+
        '</div>'+
      '</div>'+
      '<p style="font-family:var(--font-mono);font-size:12px;color:var(--ink-soft);margin-top:10px;">'+countLabel+'</p>';

    document.getElementById('qeEditExistingBtn').addEventListener('click', function(){
      state.editingErroId = existing.id;
      renderQuickErroPanel(game);
    });
    document.getElementById('qeRemoveExistingBtn').addEventListener('click', async function(){
      if(!confirm('Remover esse erro registrado?')) return;
      removerErro(existing.id);
      showToast('Erro removido.');
      atualizarTelasDeErros(); /* some da lista de lances, do caderno e da fila de revisao na hora */
      await persist();
    });
    return;
  }

  if(existing && state.editingErroId===existing.id){
    /* MODO: editando o erro existente, embutido aqui mesmo, sem sair da partida */
    panel.innerHTML =
      '<h3 style="margin:0 0 8px;">Editando erro desse lance</h3>'+
      erroEditFieldsHTML('qeEditExisting_', existing)+
      '<div class="btn-row">'+
        '<button class="btn btn-primary btn-sm" id="qeSaveEditBtn">Salvar alterações</button>'+
        '<button class="btn btn-ghost btn-sm" id="qeCancelEditBtn">Cancelar</button>'+
      '</div>';
    document.getElementById('qeSaveEditBtn').addEventListener('click', async function(){
      var idx = state.erros.findIndex(function(x){ return x.id===existing.id; });
      if(idx>-1){
        var vals = collectErroEditValues('qeEditExisting_');
        state.erros[idx].data = vals.data;
        state.erros[idx].tipo = vals.tipo;
        state.erros[idx].lance = vals.lance;
        state.erros[idx].motivo = vals.motivo;
        state.erros[idx].padrao = vals.padrao;
        showToast('Alterações salvas.');
      }
      state.editingErroId = null;
      atualizarTelasDeErros();
      if(idx>-1) await persist();
    });
    document.getElementById('qeCancelEditBtn').addEventListener('click', function(){
      state.editingErroId = null;
      renderQuickErroPanel(game);
    });
    return;
  }

  /* MODO: nenhum erro nesse lance ainda - formulario de adicionar */
  var h = game.headers||{};
  var dataVal = todayStr();
  if(h.Date && /^\d{4}\.\d{2}\.\d{2}$/.test(h.Date)){ dataVal = h.Date.replace(/\./g,'-'); }
  var ritmoVal = formatTimeControl(h.TimeControl);
  var resultadoVal = deriveResultado(game.meuLado, h.Result) || 'Derrota';
  var contextoVal = (h.White||'Brancas')+' vs '+(h.Black||'Pretas')+' · '+(h.TimeControl||'')+' · FEN: '+game.fens[ply];

  var infoMotorPly = game.analiseMotor && game.analiseMotor.porPly[ply];
  var tipoSugerido = infoMotorPly ? mapClasseParaTipo(infoMotorPly.classe) : null;
  var hintMotorHtml = '';
  if(infoMotorPly && tipoSugerido){
    var mvAtual = game.applied[ply-1];
    var segRestantes = mvAtual && mvAtual.clk ? clkParaSegundos(mvAtual.clk) : null;
    var pressaoTxt = (segRestantes!==null && segRestantes<30) ? ' Você tinha só '+segRestantes+'s no relógio nesse lance.' : '';
    hintMotorHtml = '<div class="feedback-banner mediano" style="text-align:left;">O motor marcou esse lance como <strong>'+tipoLabel(tipoSugerido)+'</strong> (perdeu ~'+infoMotorPly.perda+'cp).'+pressaoTxt+'</div>';
  }

  panel.innerHTML =
    '<h3 style="margin:0 0 4px;">Registrar erro nesta partida</h3>'+
    '<p class="lede" style="margin-bottom:10px;">Lance atual: <strong>'+escapeHtml(label)+'</strong></p>'+
    hintMotorHtml+
    '<div class="field-row">'+
      '<div><label for="qeData">Data</label><input type="date" id="qeData" value="'+escapeHtml(dataVal)+'"></div>'+
      '<div><label for="qeRitmo">Ritmo</label><input type="text" id="qeRitmo" value="'+escapeHtml(ritmoVal)+'"></div>'+
    '</div>'+
    '<div class="field-row">'+
      '<div><label for="qeResultado">Resultado</label><select id="qeResultado">'+
        ['Vitória','Derrota','Empate'].map(function(o){ return '<option value="'+o+'"'+(o===resultadoVal?' selected':'')+'>'+o+'</option>'; }).join('')+
      '</select></div>'+
      '<div><label for="qeTipo">Tipo de erro</label><select id="qeTipo">'+
        ['blunder','mistake','inaccuracy','miss'].map(function(v){
          return '<option value="'+v+'"'+(tipoSugerido===v?' selected':'')+'>'+tipoLabel(v)+'</option>';
        }).join('')+
      '</select></div>'+
    '</div>'+
    '<label for="qeMotivo">O que eu devia ter pensado</label>'+
    '<textarea id="qeMotivo" placeholder="descreva o raciocínio que faltou nesse momento"></textarea>'+
    '<label for="qePadrao">É um padrão que já se repetiu?</label>'+
    '<textarea id="qePadrao" placeholder="opcional"></textarea>'+
    '<div class="btn-row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;">'+
      '<div class="btn-row">'+
        '<button class="btn btn-primary btn-sm" id="qeSaveNextBtn">'+(game.analiseMotor?'Salvar e próximo erro':'Salvar e próximo lance')+'</button>'+
        '<button class="btn btn-ghost btn-sm" id="qeSaveCloseBtn">Salvar e fechar</button>'+
      '</div>'+
      '<span style="font-family:var(--font-mono);font-size:12px;color:var(--ink-soft);">'+countLabel+'</span>'+
    '</div>';

  function montarEntrySalvar(){
    var entry = {
      id: 'e'+Date.now(),
      data: document.getElementById('qeData').value || todayStr(),
      ritmo: document.getElementById('qeRitmo').value.trim(),
      resultado: document.getElementById('qeResultado').value,
      tipo: document.getElementById('qeTipo').value,
      lance: label,
      motivo: document.getElementById('qeMotivo').value.trim(),
      padrao: document.getElementById('qePadrao').value.trim(),
      contexto: contextoVal,
      gameId: game.id,
      ply: ply,
      criadoEm: Date.now(),
      acertosSeguidos: 0,
      resolvido: false,
      vezesRevisado: 0,
      ultimaRevisaoEm: null
    };
    state.erros.unshift(entry);
    return persist();
  }

  var saveNextBtn = document.getElementById('qeSaveNextBtn');
  if(saveNextBtn) saveNextBtn.addEventListener('click', async function(){
    if(ply===0){ showToast('Ande pelo menos um lance antes de registrar.'); return; }
    var gravando = montarEntrySalvar();
    atualizarTelasDeErros();
    if(game.analiseMotor){
      var proximoPly = proximoPlyComErroPendente(game, ply);
      if(proximoPly!==null){
        showToast('Erro registrado — indo pro próximo problema marcado.');
        stepTo(proximoPly);
      } else {
        showToast('Erro registrado — não sobrou mais nenhum problema marcado nessa partida!');
        renderAnaliseMotorUI(game);
      }
    } else {
      showToast('Erro registrado — indo pro próximo lance.');
      stepTo(Math.min(game.fens.length-1, ply+1));
    }
    await gravando;
  });

  var saveCloseBtn = document.getElementById('qeSaveCloseBtn');
  if(saveCloseBtn) saveCloseBtn.addEventListener('click', async function(){
    if(ply===0){ showToast('Ande pelo menos um lance antes de registrar.'); return; }
    var gravandoFechar = montarEntrySalvar();
    showToast('Erro registrado.');
    atualizarTelasDeErros();
    closeGame();
    await gravandoFechar;
  });
}

/* Teclas de navegacao nao podem agir enquanto a pessoa digita (nota geral, motivo, padrao...)
   nem com modificadores (Alt+Seta e "voltar" do navegador). */
function teclaEmCampoDeTexto(e){
  var t = e.target;
  if(!t || !t.tagName) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.isContentEditable;
}

document.addEventListener('keydown', function(e){
  if(!state.openGameId || state.activeTab!=='partidas') return;
  if(e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
  if(teclaEmCampoDeTexto(e)) return;
  var game = state.partidas.find(function(g){ return g.id===state.openGameId; });
  if(!game) return;
  if(e.key==='ArrowLeft'){ e.preventDefault(); stepTo(Math.max(0,state.currentPly-1)); }
  else if(e.key==='ArrowRight'){ e.preventDefault(); stepTo(Math.min(game.fens.length-1,state.currentPly+1)); }
  else if(e.key==='Home'){ e.preventDefault(); stepTo(0); }
  else if(e.key==='End'){ e.preventDefault(); stepTo(game.fens.length-1); }
});
