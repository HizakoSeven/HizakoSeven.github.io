/* Ponto de entrada: listeners globais, troca de abas, inicializacao do app. */
import { renderPartidas, renderViewer } from './partidas.js';
import { APP_STATE_KEY, LOCAL_SERVER_MODE, applyStateBlob, backfillMeuLado, loadFromLocalServer, loadJSON, persist, renderStorageStatus, testStorage } from './persistence.js';
import { openErroForm, renderErros } from './render-erros.js';
import { renderHeaderStats, renderHoje } from './render-hoje.js';
import { renderRevisar, sincronizarControlesMotor } from './revisao.js';
import { state } from './state.js';
import { showToast, todayStr } from './utils.js';
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

document.getElementById('cfgMultiPv').addEventListener('change', async function(e){
  state.motorConfig.multiPv = parseInt(e.target.value, 10) || 1;
  await persist();
});

document.getElementById('cfgMovetime').addEventListener('change', async function(e){
  state.motorConfig.movetimeMs = parseInt(e.target.value, 10) || 1200;
  await persist();
});

document.getElementById('cfgHash').addEventListener('change', async function(e){
  state.motorConfig.hashMb = parseInt(e.target.value, 10) || 16;
  await persist();
});

document.getElementById('cfgDepthAnalise').addEventListener('change', async function(e){
  state.motorConfig.depthAnalise = parseInt(e.target.value, 10) || 20;
  await persist();
});

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
  if(LOCAL_SERVER_MODE){
    document.querySelectorAll('.save-bar').forEach(function(el){ el.style.display='none'; });
    var noteEl = document.getElementById('fsUnsupportedNote'); if(noteEl) noteEl.style.display='none';
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

initApp();
