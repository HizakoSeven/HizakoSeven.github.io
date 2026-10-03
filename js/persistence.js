/* Camada de persistencia: window.storage (artifact), servidor local (server.ps1) e File System Access API. */
import { renderPartidas } from './partidas.js';
import { renderErros } from './render-erros.js';
import { renderHeaderStats, renderHoje } from './render-hoje.js';
import { renderRevisar, sincronizarControlesMotor } from './revisao.js';
import { state } from './state.js';
import { showToast, todayStr } from './utils.js';

export var LOCAL_SERVER_MODE = (window.location.protocol === 'http:' || window.location.protocol === 'https:') &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

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
      ? '✓ salvando automaticamente neste navegador (só você vê esses dados). Pra não perder nada, use "Salvar arquivo" de vez em quando como backup.'
      : '✓ armazenamento automático ativo — o que você registrar aqui fica salvo.';
  } else {
    el.className = 'storage-status bad';
    el.textContent = '⚠ não consegui usar o armazenamento do navegador (modo anônimo ou bloqueado?). Use os botões "Salvar arquivo" / "Carregar arquivo" logo abaixo — funcionam em qualquer navegador.';
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
    motorConfig: state.motorConfig
  };
}

export var fsHandle = null;

export async function writeToHandle(){
  if(!fsHandle) return false;
  try{
    var writable = await fsHandle.createWritable();
    await writable.write(JSON.stringify(currentAppStateBlob(), null, 2));
    await writable.close();
    return true;
  }catch(err){
    showToast('Falha ao salvar no arquivo automático — use "Salvar arquivo" manualmente por enquanto.');
    fsHandle = null;
    document.getElementById('saveBarInfo').textContent = 'nenhum arquivo conectado ainda';
    return false;
  }
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

export async function persist(){
  if(LOCAL_SERVER_MODE){
    var okLocal = await saveToLocalServer();
    if(!okLocal){ warnStorageFailure(); }
    return okLocal;
  }
  var ok = await saveJSON(APP_STATE_KEY, currentAppStateBlob());
  if(fsHandle){ await writeToHandle(); }
  return ok;
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

export var fsSupported = ('showOpenFilePicker' in window) && ('showSaveFilePicker' in window);

if(!fsSupported){
  document.getElementById('fsOpenBtn').disabled = true;
  document.getElementById('fsCreateBtn').disabled = true;
  document.getElementById('fsUnsupportedNote').style.display = 'block';
}

document.getElementById('fsOpenBtn').addEventListener('click', async function(){
  try{
    var handles = await window.showOpenFilePicker({
      types: [{ description:'Caderno de Xadrez (JSON)', accept:{'application/json':['.json']} }],
      excludeAcceptAllOption:false, multiple:false
    });
    var handle = handles[0];
    var file = await handle.getFile();
    var text = await file.text();
    var parsed = JSON.parse(text);
    applyStateBlob(parsed);
    fsHandle = handle;
    await persist();
    sincronizarControlesMotor();
    renderHeaderStats(); renderHoje(); renderErros(); renderRevisar(); renderPartidas();
    document.getElementById('saveBarInfo').textContent = 'salvando automaticamente em "'+handle.name+'"';
    showToast('Arquivo conectado — a partir de agora, cada mudança salva sozinha nele.');
  }catch(err){
    if(err && err.name !== 'AbortError'){ showToast('Não consegui abrir esse arquivo.'); }
  }
});

document.getElementById('fsCreateBtn').addEventListener('click', async function(){
  try{
    var handle = await window.showSaveFilePicker({
      suggestedName: 'caderno-de-xadrez.json',
      types: [{ description:'Caderno de Xadrez (JSON)', accept:{'application/json':['.json']} }]
    });
    fsHandle = handle;
    await persist();
    document.getElementById('saveBarInfo').textContent = 'salvando automaticamente em "'+handle.name+'"';
    showToast('Arquivo criado — a partir de agora, cada mudança salva sozinha nele.');
  }catch(err){
    if(err && err.name !== 'AbortError'){ showToast('Não consegui criar o arquivo.'); }
  }
});

document.getElementById('saveFileBtn').addEventListener('click', function(){
  downloadJSON(currentAppStateBlob(), 'caderno-de-xadrez-'+todayStr()+'.json');
  var now = new Date();
  document.getElementById('saveBarInfo').textContent = 'salvo agora, '+now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  showToast('Arquivo salvo. Guarde-o pra carregar na próxima vez.');
});

document.getElementById('loadFileInput').addEventListener('change', function(e){
  var file = e.target.files[0];
  e.target.value = '';
  if(!file) return;
  if(!confirm('Isso vai substituir os dados atuais do caderno pelos dados desse arquivo. Continuar?')) return;
  var reader = new FileReader();
  reader.onload = async function(evt){
    try{
      var parsed = JSON.parse(String(evt.target.result||''));
      if(!parsed || typeof parsed !== 'object'){ throw new Error('formato inválido'); }
      applyStateBlob(parsed);
      await persist();
      sincronizarControlesMotor();
      renderHeaderStats();
      renderHoje();
      renderErros();
      renderRevisar();
      renderPartidas();
      document.getElementById('saveBarInfo').textContent = 'carregado de arquivo agora';
      showToast('Caderno carregado: '+state.erros.length+' erros, '+state.partidas.length+' partidas.');
    }catch(err){
      showToast('Não consegui ler esse arquivo — confira se é o .json exportado por aqui.');
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

export function applyStateBlob(blob){
  if(!blob) return;
  state.erros = blob.erros || state.erros;
  state.partidas = blob.partidas || state.partidas;
  state.streak = blob.streak || state.streak;
  state.checklistByDate = blob.checklistByDate || state.checklistByDate;
  state.tacticsProgress = blob.tacticsProgress || state.tacticsProgress;
  state.meuNick = blob.meuNick || state.meuNick;
  if(blob.motorConfig){
    state.motorConfig.multiPv = blob.motorConfig.multiPv || state.motorConfig.multiPv;
    state.motorConfig.movetimeMs = blob.motorConfig.movetimeMs || state.motorConfig.movetimeMs;
    state.motorConfig.hashMb = blob.motorConfig.hashMb || state.motorConfig.hashMb;
    state.motorConfig.movetimeAnaliseMs = blob.motorConfig.movetimeAnaliseMs || state.motorConfig.movetimeAnaliseMs;
    state.motorConfig.depthAnalise = blob.motorConfig.depthAnalise || state.motorConfig.depthAnalise;
  }
  backfillMeuLado();
}
