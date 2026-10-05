/* Camada de persistencia: IndexedDB (site publicado), window.storage (artifact) e servidor local (server.ps1), mais backup manual em .json. */
import { renderPartidas } from './partidas.js';
import { renderErros } from './render-erros.js';
import { renderHeaderStats, renderHoje } from './render-hoje.js';
import { renderRevisar, sincronizarControlesMotor } from './revisao.js';
import { state } from './state.js';
import { showToast, todayStr } from './utils.js';

/* Modo "servidor local" (server.ps1 salvando em dados.json). Estar em localhost NAO basta:
   `python -m http.server` tambem e localhost e nao sabe salvar nada. Por isso o modo so e
   ligado depois de detectarServidorLocal() confirmar que /dados responde (initApp chama isso). */
export var LOCAL_SERVER_MODE = false;

export function definirModoServidorLocal(valor){ LOCAL_SERVER_MODE = !!valor; }

function ehLocalhost(){
  return (window.location.protocol === 'http:' || window.location.protocol === 'https:') &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
}

export async function detectarServidorLocal(){
  if(!ehLocalhost()) return false;
  try{
    var res = await fetch('/dados', { cache:'no-store' });
    return res.ok; /* servidor estatico comum responde 404 aqui */
  }catch(e){
    return false;
  }
}

/* O servidor local parou de responder no meio da sessao: volta a mostrar os controles de backup
   e o status do armazenamento do navegador, que o modo servidor tinha escondido. */
async function voltarParaArmazenamentoDoNavegador(){
  LOCAL_SERVER_MODE = false;
  document.querySelectorAll('.save-bar').forEach(function(el){ el.style.display = ''; });
  var infoEl = document.getElementById('saveBarInfo');
  if(infoEl){ infoEl.style.display = 'inline'; infoEl.textContent = ''; }
  state.storageOk = await testStorage();
  renderStorageStatus();
}

export var APP_STATE_KEY = 'app_state';

/* ---------- Armazenamento no navegador ----------
   Prioridade: window.storage (quando roda como artefato no Claude.ai);
   senao, IndexedDB (site publicado: cada visitante guarda os proprios dados
   no proprio navegador, sem servidor). */
export var STORAGE_BACKEND = (typeof window.storage !== 'undefined') ? 'artifact' : 'idb';

var IDB_NAME = 'caderno-de-xadrez';
var IDB_STORE = 'kv';
var idbPromise = null;

function abrirIDB(){
  if(idbPromise) return idbPromise;
  idbPromise = new Promise(function(resolve, reject){
    if(typeof indexedDB === 'undefined'){ reject(new Error('indexeddb-indisponivel')); return; }
    var req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = function(){ req.result.createObjectStore(IDB_STORE); };
    req.onsuccess = function(){ resolve(req.result); };
    req.onerror = function(){ reject(req.error); };
  });
  idbPromise.catch(function(){ idbPromise = null; });
  return idbPromise;
}

function idbOp(modo, fn){
  return abrirIDB().then(function(db){
    return new Promise(function(resolve, reject){
      var tx = db.transaction(IDB_STORE, modo);
      var req = fn(tx.objectStore(IDB_STORE));
      tx.oncomplete = function(){ resolve(req.result); };
      tx.onerror = function(){ reject(tx.error); };
      tx.onabort = function(){ reject(tx.error); };
    });
  });
}

function idbGet(key){ return idbOp('readonly', function(st){ return st.get(key); }); }
function idbSet(key, value){ return idbOp('readwrite', function(st){ return st.put(value, key); }); }
function idbDelete(key){ return idbOp('readwrite', function(st){ return st.delete(key); }); }

export async function loadJSON(key, fallback){
  try{
    var raw;
    if(STORAGE_BACKEND==='artifact'){
      var res = await window.storage.get(key, false);
      raw = res ? res.value : undefined;
    } else {
      raw = await idbGet(key);
    }
    if(raw===undefined || raw===null) return fallback;
    return JSON.parse(raw);
  }catch(e){
    return fallback;
  }
}

export async function saveJSON(key, value){
  try{
    var texto = JSON.stringify(value);
    if(STORAGE_BACKEND==='artifact'){
      var res = await window.storage.set(key, texto, false);
      if(!res){ warnStorageFailure(); return false; }
    } else {
      await idbSet(key, texto);
    }
    return true;
  }catch(e){
    warnStorageFailure();
    return false;
  }
}

export function warnStorageFailure(){
  if(!state.storageWarned){
    state.storageWarned = true;
    showToast('Não consegui salvar — veja o aviso de armazenamento no topo da página.');
  }
}

export async function testStorage(){
  var testKey = '_diag_'+Date.now();
  try{
    if(STORAGE_BACKEND==='artifact'){
      var setRes = await window.storage.set(testKey, JSON.stringify({ok:true}), false);
      if(!setRes) return false;
      var getRes = await window.storage.get(testKey, false);
      if(!getRes || getRes.value===undefined) return false;
      var parsed = JSON.parse(getRes.value);
      if(!parsed || parsed.ok!==true) return false;
      try{ await window.storage.delete(testKey, false); }catch(e){}
      return true;
    }
    await idbSet(testKey, JSON.stringify({ok:true}));
    var lido = await idbGet(testKey);
    try{ await idbDelete(testKey); }catch(e){}
    /* pede ao navegador pra nao apagar esses dados sozinho quando faltar espaco */
    try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(e){}
    return !!lido && JSON.parse(lido).ok===true;
  }catch(e){
    return false;
  }
}

export function renderStorageStatus(){
  var el = document.getElementById('storageStatus');
  el.style.display = 'block';
  if(state.storageOk){
    el.className = 'storage-status ok';
    el.textContent = (STORAGE_BACKEND==='idb')
      ? '✓ Salvamento automático ativo — tudo que você registra já fica salvo neste navegador.'
      : '✓ armazenamento automático ativo — o que você registrar aqui fica salvo.';
  } else {
    el.className = 'storage-status bad';
    el.textContent = '⚠ não consegui usar o armazenamento do navegador (modo anônimo ou bloqueado?). Use "Baixar backup" / "Carregar backup" logo abaixo pra não perder seus dados.';
  }
}

export function currentAppStateBlob(){
  return {
    version: 1,
    exportadoEm: new Date().toISOString(),
    erros: state.erros,
    partidas: state.partidas,
    streak: state.streak,
    checklistByDate: state.checklistByDate,
    tacticsProgress: state.tacticsProgress,
    meuNick: state.meuNick,
    motorConfig: state.motorConfig,
    sync: state.sync
  };
}

export async function saveToLocalServer(){
  try{
    var res = await fetch('/dados', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(currentAppStateBlob())
    });
    return res.ok;
  }catch(e){
    return false;
  }
}

export async function loadFromLocalServer(){
  try{
    var res = await fetch('/dados');
    if(!res.ok) return null;
    var text = await res.text();
    var parsed = JSON.parse(text);
    return parsed && typeof parsed==='object' ? parsed : null;
  }catch(e){
    return null;
  }
}

/* Gravacoes em fila: duas chamadas quase juntas nunca correm em paralelo (no servidor local o pedido mais
   antigo podia chegar depois e sobrescrever o mais novo). O snapshot e tirado quando a vez chega, entao a
   ultima gravacao sempre leva o estado mais recente. */
var filaPersist = Promise.resolve();

export function persist(){
  var p = filaPersist.then(persistirAgora, persistirAgora);
  filaPersist = p.then(function(){}, function(){}); /* a fila nunca fica "rejeitada" */
  return p;
}

async function persistirAgora(){
  if(LOCAL_SERVER_MODE){
    var okLocal = await saveToLocalServer();
    if(okLocal) return true;
    /* nao perde o que o usuario acabou de fazer: grava no navegador e avisa */
    await voltarParaArmazenamentoDoNavegador();
    showToast('O servidor local não respondeu — passei a salvar neste navegador.');
  }
  return await saveJSON(APP_STATE_KEY, currentAppStateBlob());
}

export function downloadJSON(obj, filename){
  var blob = new Blob([JSON.stringify(obj, null, 2)], { type:'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

document.getElementById('saveFileBtn').addEventListener('click', function(){
  downloadJSON(currentAppStateBlob(), 'caderno-de-xadrez-'+todayStr()+'.json');
  var now = new Date();
  document.getElementById('saveBarInfo').textContent = 'backup baixado às '+now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  showToast('Backup baixado. Guarde o arquivo pra carregar depois, se precisar.');
});

document.getElementById('loadFileInput').addEventListener('change', function(e){
  var file = e.target.files[0];
  e.target.value = '';
  if(!file) return;
  if(!confirm('Isso vai substituir os dados atuais do caderno pelos do backup. Continuar?')) return;
  var reader = new FileReader();
  reader.onload = async function(evt){
    try{
      var parsed = JSON.parse(String(evt.target.result||''));
      if(!blobValido(parsed)){ throw new Error('formato inválido'); }
      applyStateBlob(parsed);
      await persist();
      sincronizarControlesMotor();
      renderHeaderStats();
      renderHoje();
      renderErros();
      renderRevisar();
      renderPartidas();
      document.getElementById('saveBarInfo').textContent = 'backup carregado agora';
      document.dispatchEvent(new CustomEvent('caderno:estado-carregado'));
      showToast('Caderno carregado: '+state.erros.length+' erros, '+state.partidas.length+' partidas.');
    }catch(err){
      showToast('Não consegui ler esse backup — confira se é o .json baixado por aqui.');
    }
  };
  reader.readAsText(file);
});

export function autoDetectLado(headers, nick){
  if(!headers || !nick) return null;
  var n = String(nick).trim().toLowerCase();
  if(!n) return null;
  var w = String(headers.White||'').trim().toLowerCase();
  var b = String(headers.Black||'').trim().toLowerCase();
  if(w===n) return 'w';
  if(b===n) return 'b';
  return null;
}

export function backfillMeuLado(){
  if(!state.meuNick) return;
  state.partidas.forEach(function(g){
    if(!g.meuLado){
      var detectado = autoDetectLado(g.headers, state.meuNick);
      if(detectado) g.meuLado = detectado;
    }
  });
}

/* Um JSON qualquer (ou de outro app) nao pode passar por backup: precisa ter cara de caderno. */
export function blobValido(b){
  if(!b || typeof b!=='object' || Array.isArray(b)) return false;
  return Array.isArray(b.erros) || Array.isArray(b.partidas) || (b.version!==undefined && !!(b.streak || b.checklistByDate));
}

export function applyStateBlob(blob){
  if(!blob || typeof blob!=='object') return;
  if(Array.isArray(blob.erros)) state.erros = blob.erros;
  if(Array.isArray(blob.partidas)) state.partidas = blob.partidas;
  if(blob.streak && typeof blob.streak==='object') state.streak = blob.streak;
  if(blob.checklistByDate && typeof blob.checklistByDate==='object') state.checklistByDate = blob.checklistByDate;
  if(blob.tacticsProgress && typeof blob.tacticsProgress==='object') state.tacticsProgress = blob.tacticsProgress;
  if(typeof blob.meuNick==='string') state.meuNick = blob.meuNick; /* aceita nick vazio: restaurar backup sem nick limpa o atual */
  if(blob.motorConfig){
    state.motorConfig.multiPv = blob.motorConfig.multiPv || state.motorConfig.multiPv;
    state.motorConfig.movetimeMs = blob.motorConfig.movetimeMs || state.motorConfig.movetimeMs;
    state.motorConfig.hashMb = blob.motorConfig.hashMb || state.motorConfig.hashMb;
    state.motorConfig.movetimeAnaliseMs = blob.motorConfig.movetimeAnaliseMs || state.motorConfig.movetimeAnaliseMs;
    state.motorConfig.depthAnalise = blob.motorConfig.depthAnalise || state.motorConfig.depthAnalise;
  }
  mesclarSync(blob.sync);
  backfillMeuLado();
}

/* Backup antigo (sem `sync`): fica o padrao. Com `sync`: mescla campo a campo, validando o tipo de cada um. */
function mesclarSync(b){
  if(!b || typeof b!=='object') return;
  var s = state.sync;
  if(typeof b.auto==='boolean') s.auto = b.auto;
  if(typeof b.ultimaSyncEm==='number' || b.ultimaSyncEm===null) s.ultimaSyncEm = b.ultimaSyncEm;
  if(b.ultimoResumo && typeof b.ultimoResumo==='object') s.ultimoResumo = b.ultimoResumo;
  if(typeof b.primeiraConcluida==='boolean') s.primeiraConcluida = b.primeiraConcluida;
  if(b.filtros && typeof b.filtros==='object'){
    if(Array.isArray(b.filtros.modalidades)){
      s.filtros.modalidades = b.filtros.modalidades.filter(function(m){ return ['rapid','blitz','bullet','daily'].indexOf(m)!==-1; });
    }
    var p = b.filtros.periodoInicialDias;
    if(p==='tudo' || [7,30,90].indexOf(p)!==-1) s.filtros.periodoInicialDias = p;
  }
  if(b.filtrosAplicados && typeof b.filtrosAplicados==='object' && Array.isArray(b.filtrosAplicados.modalidades)) s.filtrosAplicados = b.filtrosAplicados;
  if(typeof b.nickAplicado==='string' || b.nickAplicado===null) s.nickAplicado = b.nickAplicado;
  if(b.ultimoErro && typeof b.ultimoErro==='object') s.ultimoErro = b.ultimoErro;
  else if('ultimoErro' in b) s.ultimoErro = null;
  if(Array.isArray(b.ignorados)) s.ignorados = b.ignorados.filter(function(k){ return typeof k==='string'; }).slice(-2000);
}
