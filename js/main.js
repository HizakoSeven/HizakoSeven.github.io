/* Ponto de entrada: listeners globais, troca de abas, inicializacao do app. */
import { renderPartidas, renderViewer } from './partidas.js';
import { APP_STATE_KEY, LOCAL_SERVER_MODE, applyStateBlob, backfillMeuLado, definirModoServidorLocal, detectarServidorLocal, loadFromLocalServer, loadJSON, persist, renderStorageStatus, testStorage } from './persistence.js';
import { openErroForm, renderErros } from './render-erros.js';
import { renderHeaderStats, renderHoje } from './render-hoje.js';
import { renderRevisar, sincronizarControlesMotor } from './revisao.js';
import { MOTOR_PRESETS, state } from './state.js';
import { showToast, todayStr, wrapArray } from './utils.js';
import './pgn.js';

export function showFatalBanner(msg){
  var el = document.getElementById('fatalBanner');
  if(!el){
    el = document.createElement('div');
    el.id = 'fatalBanner';
    el.className = 'fatal-banner';
    document.body.insertBefore(el, document.body.firstChild);
  }
  el.textContent = '⚠ ' + msg;
}

window.addEventListener('error', function(e){
  showFatalBanner('erro no app: ' + (e.message||'erro desconhecido') + '. Recarregue a página; se persistir, anote essa mensagem e abra uma issue no GitHub.');
});

window.addEventListener('unhandledrejection', function(e){
  var reason = e.reason && e.reason.message ? e.reason.message : String(e.reason||'erro desconhecido');
  showFatalBanner('erro no app: ' + reason + '. Recarregue a página; se persistir, anote essa mensagem e abra uma issue no GitHub.');
});

document.getElementById('meuNickInput').addEventListener('change', async function(e){
  state.meuNick = e.target.value.trim();
  backfillMeuLado();
  await persist();
  renderPartidas();
  if(state.openGameId) renderViewer();
  showToast('Nick atualizado.');
});

function selectHTML(campo, rotulo, opcoes){
  return '<div><span class="cfg-label">'+rotulo+'</span><select data-cfg="'+campo+'">'+
    opcoes.map(function(o){ return '<option value="'+o[0]+'">'+o[1]+'</option>'; }).join('')+
  '</select></div>';
}

function motorConfigHTML(){
  var presets = Object.keys(MOTOR_PRESETS).map(function(k){
    return '<button type="button" class="btn btn-ghost btn-sm" data-preset="'+k+'">'+MOTOR_PRESETS[k].rotulo+'</button>';
  }).join('');
  return '<div class="motor-presets"><span class="cfg-label" style="margin:0;">Preset do motor</span>'+presets+
      '<span class="preset-status ci-sub"></span></div>'+
    '<details class="motor-config-details">'+
      '<summary>Config do motor (Stockfish)</summary>'+
      '<div class="details-body"><div class="motor-config-grid">'+
        selectHTML('multiPv','Linhas mostradas',[[1,'1'],[2,'2'],[3,'3'],[4,'4'],[5,'5']])+
        selectHTML('movetimeMs','Tempo de busca (revisão)',[[500,'0.5s'],[1000,'1s'],[1200,'1.2s'],[2000,'2s'],[3000,'3s'],[5000,'5s']])+
        selectHTML('hashMb','Memória (hash)',[[16,'16 MB'],[32,'32 MB'],[64,'64 MB'],[128,'128 MB']])+
        selectHTML('depthAnalise','Profundidade (análise de partida)',[[10,'10'],[12,'12'],[14,'14'],[16,'16'],[18,'18'],[20,'20'],[22,'22'],[25,'25']])+
      '</div>'+
      '<p class="ci-sub" style="margin-top:8px;">Mais linhas e mais tempo deixam a análise mais completa, mas demoram mais por posição. <strong>Rápido</strong> (profundidade 12) analisa uma partida inteira em poucos segundos, com menos precisão; <strong>Profundo</strong> demora mais e acha mais detalhes. As mesmas opções aparecem nas abas Revisar e Partidas.</p>'+
      '</div>'+
    '</details>';
}

function montarConfigMotor(){
  wrapArray(document.querySelectorAll('.motor-config-slot')).forEach(function(slot){
    slot.innerHTML = motorConfigHTML();
  });
  wrapArray(document.querySelectorAll('[data-cfg]')).forEach(function(sel){
    sel.addEventListener('change', async function(){
      state.motorConfig[sel.dataset.cfg] = parseInt(sel.value, 10) || state.motorConfig[sel.dataset.cfg];
      sincronizarControlesMotor();
      await persist();
    });
  });
  wrapArray(document.querySelectorAll('[data-preset]')).forEach(function(btn){
    btn.addEventListener('click', async function(){
      var p = MOTOR_PRESETS[btn.dataset.preset];
      if(!p) return;
      state.motorConfig.multiPv = p.multiPv;
      state.motorConfig.movetimeMs = p.movetimeMs;
      state.motorConfig.hashMb = p.hashMb;
      state.motorConfig.depthAnalise = p.depthAnalise;
      sincronizarControlesMotor();
      await persist();
      showToast('Preset "'+p.rotulo.replace(/^\S+\s/,'')+'" aplicado.');
    });
  });
}

export function switchTab(name){
  state.activeTab = name;
  document.querySelectorAll('.tab-btn').forEach(function(btn){
    btn.classList.toggle('active', btn.dataset.tab===name);
  });
  document.querySelectorAll('.tab-panel').forEach(function(panel){
    panel.classList.toggle('active', panel.id==='tab-'+name);
  });
}

document.querySelectorAll('.tab-btn').forEach(function(btn){
  btn.addEventListener('click', function(){ switchTab(btn.dataset.tab); });
});

export async function initApp(){
  definirModoServidorLocal(await detectarServidorLocal());
  if(LOCAL_SERVER_MODE){
    document.querySelectorAll('.save-bar').forEach(function(el){ el.style.display='none'; });
    var infoEl = document.getElementById('saveBarInfo');
    infoEl.style.display = 'block';
    infoEl.textContent = 'salvando automaticamente em dados.json, na pasta do programa';
    var statusEl = document.getElementById('storageStatus');
    statusEl.style.display = 'block';
    statusEl.className = 'storage-status ok';
    statusEl.textContent = '✓ rodando pelo servidor local — tudo salva sozinho em dados.json.';

    var serverBlob = await loadFromLocalServer();
    if(serverBlob) applyStateBlob(serverBlob);
  } else {
    state.storageOk = await testStorage();
    renderStorageStatus();

    var blob = await loadJSON(APP_STATE_KEY, null);
    if(blob){
      applyStateBlob(blob);
    } else {
      var legacy = await Promise.all([
        loadJSON('caderno_erros', null),
        loadJSON('partidas', null),
        loadJSON('streak_data', null),
        loadJSON('checklist_'+todayStr(), null),
        loadJSON('tactics_progress', null)
      ]);
      if(legacy[0]) state.erros = legacy[0];
      if(legacy[1]) state.partidas = legacy[1];
      if(legacy[2]) state.streak = legacy[2];
      if(legacy[3]) state.checklistByDate[todayStr()] = legacy[3];
      if(legacy[4]) state.tacticsProgress = legacy[4];
      if(legacy.some(Boolean)) await persist();
    }
  }

  backfillMeuLado();
  document.getElementById('meuNickInput').value = state.meuNick || '';
  sincronizarControlesMotor();
  renderHeaderStats();
  renderHoje();
  renderErros();
  renderRevisar();
  renderPartidas();
  openErroForm();

  document.getElementById('loadingOverlay').style.display = 'none';
}

montarConfigMotor();
initApp();
