/* Caderno de erros: formulario, filtros, listagem. */
import { boardSquaresHTML } from './board.js';
import { switchTab } from './main.js';
import { persist } from './persistence.js';
import { renderHeaderStats, renderHoje } from './render-hoje.js';
import { REVISAO_ACERTOS_PARA_DOMINAR, renderRevisar, resetRevisaoInterativa } from './revisao.js';
import { proximaRevisaoDe } from './revisao-agenda.js';
import { state } from './state.js';
import { addDaysStr, escapeHtml, formatPtDate, showToast, todayStr } from './utils.js';

export var erroForm = document.getElementById('erroForm');

document.getElementById('erroData').value = todayStr();

export function erroEditFieldsHTML(prefix, en){
  return '<div class="field-row">'+
      '<div><label for="'+prefix+'Data">Data</label><input type="date" id="'+prefix+'Data" value="'+escapeHtml(en.data||todayStr())+'"></div>'+
      '<div><label for="'+prefix+'Tipo">Tipo de erro</label><select id="'+prefix+'Tipo">'+
        ['blunder','mistake','inaccuracy','miss'].map(function(t){ return '<option value="'+t+'"'+(t===en.tipo?' selected':'')+'>'+tipoLabel(t)+'</option>'; }).join('')+
      '</select></div>'+
    '</div>'+
    '<label for="'+prefix+'Lance">Lance do erro</label>'+
    '<input type="text" id="'+prefix+'Lance" value="'+escapeHtml(en.lance||'')+'">'+
    '<label for="'+prefix+'Motivo">O que eu devia ter pensado</label>'+
    '<textarea id="'+prefix+'Motivo">'+escapeHtml(en.motivo||'')+'</textarea>'+
    '<label for="'+prefix+'Padrao">É um padrão que já se repetiu?</label>'+
    '<textarea id="'+prefix+'Padrao">'+escapeHtml(en.padrao||'')+'</textarea>';
}

export function collectErroEditValues(prefix){
  return {
    data: document.getElementById(prefix+'Data').value || todayStr(),
    tipo: document.getElementById(prefix+'Tipo').value,
    lance: document.getElementById(prefix+'Lance').value.trim(),
    motivo: document.getElementById(prefix+'Motivo').value.trim(),
    padrao: document.getElementById(prefix+'Padrao').value.trim()
  };
}

export function openErroForm(){
  document.getElementById('erroId').value = '';
  document.getElementById('erroRitmoHidden').value = '';
  document.getElementById('erroResultadoHidden').value = '';
  document.getElementById('erroData').value = todayStr();
  document.getElementById('erroTipo').value = 'blunder';
  document.getElementById('erroLance').value = '';
  document.getElementById('erroMotivo').value = '';
  document.getElementById('erroPadrao').value = '';
  document.getElementById('erroContexto').style.display = 'none';
  document.getElementById('erroSubmitBtn').textContent = 'Adicionar ao caderno';
  document.getElementById('erroCancelBtn').style.display = 'none';
}

document.getElementById('erroCancelBtn').addEventListener('click', function(){ openErroForm(); });

erroForm.addEventListener('submit', async function(e){
  e.preventDefault();
  var entry = {
    id: 'e'+Date.now(),
    data: document.getElementById('erroData').value || todayStr(),
    ritmo: '',
    resultado: '',
    tipo: document.getElementById('erroTipo').value,
    lance: document.getElementById('erroLance').value.trim(),
    motivo: document.getElementById('erroMotivo').value.trim(),
    padrao: document.getElementById('erroPadrao').value.trim(),
    contexto: '',
    criadoEm: Date.now(),
    acertosSeguidos: 0,
    resolvido: false,
    vezesRevisado: 0,
    ultimaRevisaoEm: null
  };
  state.erros.unshift(entry);
  await persist();
  showToast('Erro adicionado ao caderno.');
  openErroForm();
  renderErros();
  renderHeaderStats();
  renderHoje();
});

export function renderErroBoardHTML(en, game){
  var ply = state.openErroBoardPly;
  if(ply===undefined || ply===null) ply = en.ply||0;
  ply = Math.max(0, Math.min(game.fens.length-1, ply));
  var lastMove = ply>0 ? game.applied[ply-1] : null;
  var label = 'Posição inicial';
  if(lastMove){
    var moveNum = Math.floor((ply-1)/2)+1;
    label = (lastMove.color==='w' ? moveNum+'.' : moveNum+'...')+' '+lastMove.san;
  }
  return '<div class="erro-mini-board">'+
    '<div class="board">'+boardSquaresHTML(game.fens[ply], lastMove, false)+'</div>'+
    '<div class="board-controls">'+
      '<button class="btn btn-ghost btn-sm" data-eb-prev="'+en.id+'">◀</button>'+
      '<button class="btn btn-ghost btn-sm" data-eb-next="'+en.id+'">▶</button>'+
      '<button class="btn btn-ghost btn-sm" data-eb-reset="'+en.id+'">Voltar ao lance do erro</button>'+
    '</div>'+
    '<div class="move-status">'+escapeHtml(label)+'</div>'+
  '</div>';
}

/* Linha de status da revisao espacada no card: acertos e quando o erro volta a vencer. */
export function revisaoStatusHTML(en){
  if(en.resolvido) return '<div style="font-size:12px;color:var(--sage);margin:0 0 6px;">✓ Dominado na revisão espaçada</div>';
  var hoje = todayStr();
  var acertos = en.acertosSeguidos||0;
  var p = proximaRevisaoDe(en);
  var venceHoje = !p || p<=hoje;
  if(acertos===0 && venceHoje) return '';
  return '<div style="font-size:12px;color:var(--ink-soft);margin:0 0 6px;">Revisão: '+acertos+'/'+REVISAO_ACERTOS_PARA_DOMINAR+' acertos seguidos · '+(venceHoje ? 'vence hoje' : 'próxima em '+escapeHtml(formatPtDate(p)))+'</div>';
}

export function tipoLabel(tipo){
  if(tipo==='blunder') return 'Blunder';
  if(tipo==='mistake') return 'Erro (Mistake)';
  if(tipo==='inaccuracy') return 'Imprecisão';
  if(tipo==='miss') return 'Miss';
  if(tipo==='brilliant') return 'Brilhante';
  if(tipo==='great') return 'Ótimo';
  return 'Imprecisão';
}

export function getErroFiltros(){
  return {
    texto: (document.getElementById('erroFiltroTexto').value||'').trim().toLowerCase(),
    tipo: document.getElementById('erroFiltroTipo').value||'',
    periodo: document.getElementById('erroFiltroPeriodo').value||'',
    partida: document.getElementById('erroFiltroPartida').value||''
  };
}

['erroFiltroTexto','erroFiltroTipo','erroFiltroPeriodo','erroFiltroPartida'].forEach(function(id){
  var el = document.getElementById(id);
  var evt = (id==='erroFiltroTexto') ? 'input' : 'change';
  el.addEventListener(evt, function(){ renderErros(); });
});

export function populateErroPartidaFilter(){
  var sel = document.getElementById('erroFiltroPartida');
  var valorAtual = sel.value;
  var idsComErro = {};
  var temAvulso = false;
  state.erros.forEach(function(en){
    if(en.gameId) idsComErro[en.gameId] = (idsComErro[en.gameId]||0)+1;
    else temAvulso = true;
  });
  var opts = ['<option value="">Todas as partidas</option>'];
  Object.keys(idsComErro).forEach(function(gid){
    var g = state.partidas.find(function(x){ return x.id===gid; });
    var count = idsComErro[gid];
    var label;
    if(g){
      var h = g.headers||{};
      var dataLabel = h.Date && /^\d{4}\.\d{2}\.\d{2}$/.test(h.Date) ? (' · '+formatPtDate(h.Date.replace(/\./g,'-'))) : '';
      label = (h.White||'Brancas')+' vs '+(h.Black||'Pretas')+dataLabel;
    } else {
      label = 'Partida removida';
    }
    label += ' ('+count+' erro'+(count===1?'':'s')+')';
    opts.push('<option value="'+gid+'">'+escapeHtml(label)+'</option>');
  });
  if(temAvulso){
    opts.push('<option value="__standalone__">Sem partida vinculada</option>');
  }
  sel.innerHTML = opts.join('');
  if(opts.some(function(o){ return o.indexOf('value="'+valorAtual+'"')!==-1; })){
    sel.value = valorAtual;
  }
}

export function renderErros(){
  var wrap = document.getElementById('errosListWrap');
  populateErroPartidaFilter();
  if(state.erros.length===0){
    wrap.innerHTML = '<div class="empty-state">Nenhum erro registrado ainda. Abra uma partida na aba Partidas e registre por lá, ou use o formulário acima.</div>';
    return;
  }
  var filtros = getErroFiltros();
  var hoje = todayStr();
  var filtered = state.erros.filter(function(en){
    if(filtros.tipo && en.tipo!==filtros.tipo) return false;
    if(filtros.periodo){
      var limite = addDaysStr(hoje, -parseInt(filtros.periodo,10));
      if(!en.data || en.data < limite) return false;
    }
    if(filtros.partida){
      if(filtros.partida==='__standalone__'){ if(en.gameId) return false; }
      else if(en.gameId!==filtros.partida) return false;
    }
    if(filtros.texto){
      var blob = ((en.lance||'')+' '+(en.motivo||'')+' '+(en.padrao||'')).toLowerCase();
      if(blob.indexOf(filtros.texto)===-1) return false;
    }
    return true;
  });

  if(filtered.length===0){
    wrap.innerHTML = '<div class="empty-state">Nenhum erro corresponde a esse filtro.</div>';
    return;
  }

  var sorted = filtered.slice().sort(function(a,b){ return (b.criadoEm||0)-(a.criadoEm||0); });
  wrap.innerHTML = sorted.map(function(en){
    var gameRef = en.gameId ? state.partidas.find(function(g){return g.id===en.gameId;}) : null;
    var tempoInfo = '';
    if(gameRef && en.ply && gameRef.applied[en.ply-1]){
      var mvRef = gameRef.applied[en.ply-1];
      if(mvRef.timestampDs!==null && mvRef.timestampDs!==undefined){
        var seg = mvRef.timestampDs/10;
        tempoInfo = ' · pensou '+(seg>=10?Math.round(seg)+'s':seg.toFixed(1)+'s')+' nesse lance';
      }
    }
    var boardAberto = state.openErroBoardId===en.id && gameRef;
    var editando = state.editingErroId===en.id;

    var corpo;
    if(editando){
      corpo = '<div class="erro-top"><span class="erro-date">'+escapeHtml(formatPtDate(en.data))+'</span><span class="badge badge-'+en.tipo+'">'+tipoLabel(en.tipo)+'</span></div>'+
        erroEditFieldsHTML('cardEdit_'+en.id+'_', en)+
        '<div class="btn-row">'+
          '<button class="btn btn-primary btn-sm" data-save-inline="'+en.id+'">Salvar alterações</button>'+
          '<button class="btn btn-ghost btn-sm" data-cancel-inline="'+en.id+'">Cancelar</button>'+
        '</div>';
    } else {
      corpo = '<div class="erro-top">'+
          '<span class="erro-date">'+escapeHtml(formatPtDate(en.data))+(en.ritmo?' · '+escapeHtml(en.ritmo):'')+(en.resultado?' · '+escapeHtml(en.resultado):'')+'</span>'+
          '<span class="badge badge-'+en.tipo+'">'+tipoLabel(en.tipo)+'</span>'+
        '</div>'+
        revisaoStatusHTML(en)+
        (en.lance ? '<div class="erro-move">'+escapeHtml(en.lance)+escapeHtml(tempoInfo)+'</div>' : '')+
        (en.contexto ? '<div style="font-family:var(--font-mono);font-size:11.5px;color:var(--ink-soft);">'+escapeHtml(en.contexto)+'</div>' : '')+
        (gameRef && gameRef.notaGeral ? '<div style="font-size:12.5px;color:var(--ink-soft);font-style:italic;margin-top:2px;">Nota da partida: "'+escapeHtml(gameRef.notaGeral)+'"</div>' : '')+
        (en.motivo ? '<div class="erro-field-label">O que eu devia ter pensado</div><div class="erro-field-val">'+escapeHtml(en.motivo)+'</div>' : '')+
        (en.padrao ? '<div class="erro-field-label">Padrão recorrente</div><div class="erro-field-val">'+escapeHtml(en.padrao)+'</div>' : '')+
        '<div class="btn-row" style="margin-top:10px;">'+
          (!en.resolvido ? '<button class="btn btn-primary btn-sm" data-revisaragora="'+en.id+'">Revisar agora</button>' : '')+
          (gameRef ? '<button class="btn btn-ghost btn-sm" data-toggleboard="'+en.id+'">'+(boardAberto?'Fechar tabuleiro':'Ver no tabuleiro')+'</button>' : '')+
          '<button class="btn btn-ghost btn-sm" data-edit="'+en.id+'">Editar</button>'+
          '<button class="btn btn-danger btn-sm" data-del="'+en.id+'">Remover</button>'+
        '</div>'+
        (boardAberto ? renderErroBoardHTML(en, gameRef) : '');
    }
    return '<div class="erro-card tipo-'+en.tipo+'" id="errocard-'+en.id+'">'+corpo+'</div>';
  }).join('');

  wrap.querySelectorAll('[data-revisaragora]').forEach(function(btn){
    btn.addEventListener('click', function(){
      state.revisao.atualId = btn.dataset.revisaragora;
      state.revisao.revelado = false;
      resetRevisaoInterativa();
      switchTab('revisar');
      renderRevisar();
    });
  });
  wrap.querySelectorAll('[data-toggleboard]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var erroId = btn.dataset.toggleboard;
      if(state.openErroBoardId===erroId){
        state.openErroBoardId = null;
      } else {
        var en = state.erros.find(function(e){ return e.id===erroId; });
        state.openErroBoardId = erroId;
        state.openErroBoardPly = en ? (en.ply||0) : 0;
      }
      renderErros();
    });
  });
  wrap.querySelectorAll('[data-eb-prev]').forEach(function(btn){
    btn.addEventListener('click', function(){ state.openErroBoardPly = Math.max(0,(state.openErroBoardPly||0)-1); renderErros(); });
  });
  wrap.querySelectorAll('[data-eb-next]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var en = state.erros.find(function(e){ return e.id===btn.dataset.ebNext; });
      var g = en && state.partidas.find(function(x){ return x.id===en.gameId; });
      if(g) state.openErroBoardPly = Math.min(g.fens.length-1, (state.openErroBoardPly||0)+1);
      renderErros();
    });
  });
  wrap.querySelectorAll('[data-eb-reset]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var en = state.erros.find(function(e){ return e.id===btn.dataset.ebReset; });
      state.openErroBoardPly = en ? (en.ply||0) : 0;
      renderErros();
    });
  });

  wrap.querySelectorAll('[data-edit]').forEach(function(btn){
    btn.addEventListener('click', function(){
      state.editingErroId = btn.dataset.edit;
      renderErros();
    });
  });
  wrap.querySelectorAll('[data-cancel-inline]').forEach(function(btn){
    btn.addEventListener('click', function(){
      state.editingErroId = null;
      renderErros();
    });
  });
  wrap.querySelectorAll('[data-save-inline]').forEach(function(btn){
    btn.addEventListener('click', async function(){
      var id = btn.dataset.saveInline;
      var idx = state.erros.findIndex(function(x){ return x.id===id; });
      if(idx>-1){
        var vals = collectErroEditValues('cardEdit_'+id+'_');
        state.erros[idx].data = vals.data;
        state.erros[idx].tipo = vals.tipo;
        state.erros[idx].lance = vals.lance;
        state.erros[idx].motivo = vals.motivo;
        state.erros[idx].padrao = vals.padrao;
        /* criadoEm nao muda - mantem a posicao na lista, ordenada por quando foi criado */
        await persist();
        showToast('Alterações salvas.');
      }
      state.editingErroId = null;
      renderErros();
      renderHeaderStats();
      renderHoje();
    });
  });
  wrap.querySelectorAll('[data-del]').forEach(function(btn){
    btn.addEventListener('click', async function(){
      if(!confirm('Remover esse registro do caderno de erros?')) return;
      state.erros = state.erros.filter(function(x){ return x.id!==btn.dataset.del; });
      await persist();
      renderErros();
      renderHeaderStats();
      renderHoje();
    });
  });
}
