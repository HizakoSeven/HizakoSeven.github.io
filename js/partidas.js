/* Visualizador de partidas importadas: tabuleiro, navegacao de lances, painel de erro rapido. */
import { cancelarAnaliseCompleta, clkParaSegundos, iniciarAnaliseCompleta, mapClasseParaTipo } from './analysis.js';
import { boardSquaresHTML } from './board.js';
import { persist } from './persistence.js';
import { collectErroEditValues, erroEditFieldsHTML, renderErros, tipoLabel } from './render-erros.js';
import { renderHeaderStats, renderHoje } from './render-hoje.js';
import { MOTOR_PRESETS, state } from './state.js';
import { renderPainelTempo } from './tempo.js';
import { escapeHtml, formatPtDate, showToast, todayStr } from './utils.js';

export function renderPartidas(){
  var wrap = document.getElementById('partidasListWrap');
  if(state.partidas.length===0){
    wrap.innerHTML = '<div class="empty-state">Nenhuma partida importada ainda.</div>';
    return;
  }
  wrap.innerHTML = state.partidas.map(function(g){
    var h = g.headers||{};
    var meta = [h.Date, h.TimeControl, h.Result, (h.ECO?h.ECO+(h.Opening?' — '+h.Opening:''):h.Opening)].filter(Boolean).join(' · ');
    var aberta = state.openGameId===g.id;
    return '<div class="partida-block">'+
      '<div class="partida-card">'+
        '<div class="partida-info">'+
          '<div class="pi-players">'+escapeHtml(h.White||'Brancas')+' vs '+escapeHtml(h.Black||'Pretas')+'</div>'+
          '<div class="pi-meta">'+escapeHtml(meta)+'</div>'+
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
      state.partidas = state.partidas.filter(function(x){ return x.id!==btn.dataset.delgame; });
      if(state.openGameId===btn.dataset.delgame){ state.openGameId=null; }
      await persist();
      renderPartidas();
      renderHeaderStats();
      renderHoje();
    });
  });

  if(state.openGameId && state.partidas.some(function(g){return g.id===state.openGameId;})){
    renderViewer();
  }
}

export function openGame(id){
  state.openGameId = id;
  state.currentPly = 0;
  state.boardFlipped = false;
  renderPartidas();
}

export function closeGame(){
  state.openGameId = null;
  renderPartidas();
}

export function renderViewer(){
  var game = state.partidas.find(function(g){ return g.id===state.openGameId; });
  if(!game) return;
  var wrap = document.getElementById('viewerSlot-'+game.id);
  if(!wrap) return;

  var h = game.headers||{};
  wrap.innerHTML =
    '<div class="card">'+
      '<div id="ladoPickerWrap"></div>'+
      '<label for="notaGeralInput">Nota geral dessa partida</label>'+
      '<textarea id="notaGeralInput" placeholder="ex: senti dificuldade em finais de torre" style="min-height:50px;">'+escapeHtml(game.notaGeral||'')+'</textarea>'+
      '<div class="viewer">'+
        '<div class="board-wrap">'+
          '<div class="board" id="boardEl"></div>'+
          '<div class="board-controls">'+
            '<button class="btn btn-ghost btn-sm" id="stepFirst">⏮</button>'+
            '<button class="btn btn-ghost btn-sm" id="stepPrev">◀</button>'+
            '<button class="btn btn-ghost btn-sm" id="stepNext">▶</button>'+
            '<button class="btn btn-ghost btn-sm" id="stepLast">⏭</button>'+
            '<button class="btn btn-ghost btn-sm" id="flipBtn">Girar tabuleiro</button>'+
          '</div>'+
          '<div class="move-status" id="moveStatus"></div>'+
        '</div>'+
        '<div class="viewer-side">'+
          '<div class="movelist" id="movelistEl"></div>'+
          '<div id="analiseMotorWrap"></div>'+
          '<div class="quick-erro-panel" id="quickErroPanel"></div>'+
        '</div>'+
      '</div>'+
      '<div id="tempoAnaliseWrap"></div>'+
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

  renderLadoPicker(game);
  renderMovelist(game);
  renderAnaliseMotorUI(game);
  renderPainelTempo(game);
  stepTo(state.currentPly, true);
}

export function renderLadoPicker(game){
  var wrap = document.getElementById('ladoPickerWrap');
  if(!wrap) return;
  if(game.meuLado){
    wrap.innerHTML = '<p style="font-family:var(--font-mono);font-size:12px;color:var(--ink-soft);margin:4px 0 12px;">Você jogou de: <strong>'+(game.meuLado==='w'?'Brancas':'Pretas')+'</strong> · <a href="#" id="trocarLadoLink" style="color:var(--brass-deep);">trocar</a></p>';
    var link = document.getElementById('trocarLadoLink');
    if(link) link.addEventListener('click', function(e){
      e.preventDefault();
      game.meuLado = null;
      persist();
      renderLadoPicker(game);
      renderQuickErroPanel(game);
    });
  } else {
    wrap.innerHTML = '<div class="btn-row" style="margin:4px 0 12px;align-items:center;">'+
      '<span style="font-size:13px;color:var(--ink-soft);">Você jogou de:</span>'+
      '<button class="btn btn-ghost btn-sm" id="ladoBrancasBtn">Brancas</button>'+
      '<button class="btn btn-ghost btn-sm" id="ladoPretasBtn">Pretas</button>'+
    '</div>';
    document.getElementById('ladoBrancasBtn').addEventListener('click', async function(){
      game.meuLado = 'w'; await persist(); renderLadoPicker(game); renderQuickErroPanel(game);
    });
    document.getElementById('ladoPretasBtn').addEventListener('click', async function(){
      game.meuLado = 'b'; await persist(); renderLadoPicker(game); renderQuickErroPanel(game);
    });
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
  await persist();
  showToast('Erro registrado: '+label+'.');
  renderErros();
  renderHeaderStats();
  renderHoje();
  renderMovelist(game);
  renderAnaliseMotorUI(game);
  renderQuickErroPanel(game);
  return true;
}

export function renderAnaliseMotorUI(game){
  var el = document.getElementById('analiseMotorWrap');
  if(!el) return;

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
      '<p class="ci-sub" style="margin-top:6px;">Avalia toda posição da partida e marca imprecisões, erros e blunders — nos seus lances por padrão.</p>';
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
    (game.analiseMotor.completo?'Análise completa':'Análise parcial (foi cancelada no meio)')+(game.analiseMotor.depthUsado?' (profundidade '+game.analiseMotor.depthUsado+')':'')+
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

  el.innerHTML = resumo+brilhantesHtml+'<div class="analise-lista">'+listaHtml+'</div>'+
    '<div class="btn-row" style="margin-top:10px;"><button class="btn btn-ghost btn-sm" id="analisarBtn">Analisar de novo</button><button class="btn btn-ghost btn-sm" id="analisarRapidoBtn" title="Profundidade 12 — mais rápido, um pouco menos preciso">⚡ Analisar de novo (rápido)</button></div>';

  el.querySelectorAll('[data-ver-ply]').forEach(function(btn){
    btn.addEventListener('click', function(){ stepTo(parseInt(btn.dataset.verPly,10)); });
  });
  el.querySelectorAll('[data-registrar-ply]').forEach(function(btn){
    btn.addEventListener('click', function(){
      btn.disabled = true;
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

  document.querySelectorAll('.move-btn').forEach(function(btn){
    btn.classList.toggle('current', parseInt(btn.dataset.ply,10)===ply);
  });

  renderQuickErroPanel(game);
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
      state.erros = state.erros.filter(function(x){ return x.id!==existing.id; });
      await persist();
      showToast('Erro removido.');
      renderErros();
      renderHeaderStats();
      renderHoje();
      renderMovelist(game);
      renderQuickErroPanel(game);
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
        await persist();
        showToast('Alterações salvas.');
      }
      state.editingErroId = null;
      renderErros();
      renderHeaderStats();
      renderHoje();
      renderMovelist(game);
      renderQuickErroPanel(game);
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
    await montarEntrySalvar();
    renderErros();
    renderHeaderStats();
    renderHoje();
    renderMovelist(game);
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
  });

  var saveCloseBtn = document.getElementById('qeSaveCloseBtn');
  if(saveCloseBtn) saveCloseBtn.addEventListener('click', async function(){
    if(ply===0){ showToast('Ande pelo menos um lance antes de registrar.'); return; }
    await montarEntrySalvar();
    showToast('Erro registrado.');
    renderErros();
    renderHeaderStats();
    renderHoje();
    closeGame();
  });
}

document.addEventListener('keydown', function(e){
  if(!state.openGameId || state.activeTab!=='partidas') return;
  var game = state.partidas.find(function(g){ return g.id===state.openGameId; });
  if(!game) return;
  if(e.key==='ArrowLeft'){ stepTo(Math.max(0,state.currentPly-1)); }
  else if(e.key==='ArrowRight'){ stepTo(Math.min(game.fens.length-1,state.currentPly+1)); }
  else if(e.key==='Home'){ stepTo(0); }
  else if(e.key==='End'){ stepTo(game.fens.length-1); }
});
