/* Importacao de PGN: parsing e wiring do formulario de import. */
import { renderPartidas } from './partidas.js';
import { autoDetectLado, persist } from './persistence.js';
import { renderHeaderStats, renderHoje } from './render-hoje.js';
import { state } from './state.js';
import { escapeHtml, showToast } from './utils.js';

export function extractHeaders(chunk){
  var headers = {};
  var re = /\[(\w+)\s+"([^"]*)"\]/g;
  var m;
  while((m = re.exec(chunk))){ headers[m[1]] = m[2]; }
  return headers;
}

export function extractMovetext(chunk){
  return chunk.replace(/^\s*\[.*\]\s*$/gm, '').trim();
}

export function extractSanTokens(movetext){
  var t = movetext;
  t = t.replace(/\$\d+/g, ' ');
  var prevLen;
  do{ prevLen = t.length; t = t.replace(/\([^()]*\)/g, ' '); }while(t.length!==prevLen);

  var items = t.match(/\{[^}]*\}|\S+/g) || [];
  var out = [];
  for(var i=0;i<items.length;i++){
    var it = items[i];
    if(/^\{/.test(it)) continue;
    if(/^\d+\.(\.\.)?$/.test(it)) continue;
    if(/^(1-0|0-1|1\/2-1\/2|\*)$/.test(it)) continue;

    var annMatch = it.match(/[!?]+$/);
    var annotation = annMatch ? annMatch[0] : '';
    var clean = it.replace(/[!?]+$/, '');

    var clk = null, timestampDs = null;
    var next = items[i+1];
    if(next && /^\{/.test(next)){
      var clkMatch = next.match(/%clk\s+([0-9:.]+)/);
      var tsMatch = next.match(/%timestamp\s+(-?\d+)/);
      if(clkMatch) clk = clkMatch[1];
      if(tsMatch) timestampDs = parseInt(tsMatch[1],10);
      i++;
    }
    out.push({ raw:it, clean:clean, annotation:annotation, clk:clk, timestampDs:timestampDs });
  }
  return out;
}

export function buildGameFromSan(tokens){
  if(typeof Chess === 'undefined'){
    return { ok:false, error:'engine-unavailable' };
  }
  var g = new Chess();
  var applied = [];
  var fens = [g.fen()];
  for(var i=0;i<tokens.length;i++){
    var tok = tokens[i];
    if(!tok.clean) continue;
    var mv = g.move(tok.clean, { sloppy:true });
    if(!mv){
      return { ok:false, appliedCount:applied.length, failedToken:tok.raw, applied:applied, fens:fens };
    }
    mv.annotation = tok.annotation;
    mv.clk = tok.clk;
    mv.timestampDs = tok.timestampDs;
    applied.push(mv);
    fens.push(g.fen());
  }
  return { ok:true, applied:applied, fens:fens };
}

export function splitMultiPgn(raw){
  var trimmed = raw.trim();
  if(!trimmed) return [];
  var parts = trimmed.split(/(?=^\[Event\s)/m).map(function(s){ return s.trim(); }).filter(Boolean);
  return parts.length ? parts : [trimmed];
}

export async function importPgnText(raw){
  var errEl = document.getElementById('importError');
  errEl.style.display = 'none';
  if(!raw || !raw.trim()){
    errEl.textContent = 'Cole ou envie um PGN primeiro.';
    errEl.style.display = 'block';
    return;
  }
  if(typeof Chess === 'undefined'){
    errEl.textContent = 'O motor de xadrez não carregou nesta sessão — tente recarregar a página.';
    errEl.style.display = 'block';
    return;
  }
  var chunks = splitMultiPgn(raw);
  var imported = 0;
  var lastError = null;
  for(var i=0;i<chunks.length;i++){
    var headers = extractHeaders(chunks[i]);
    var movetext = extractMovetext(chunks[i]);
    var tokens = extractSanTokens(movetext);
    if(tokens.length===0) continue;
    var built = buildGameFromSan(tokens);
    if(!built.ok){
      lastError = 'Não consegui ler uma partida a partir do lance '+(built.appliedCount!==undefined ? (built.appliedCount+1) : '?')+' ("'+escapeHtml(built.failedToken||'?')+'"). Confira se o texto foi copiado por inteiro.';
      continue;
    }
    var game = {
      id: 'g'+Date.now()+'_'+i,
      headers: headers,
      applied: built.applied.map(function(mv){ return { san:mv.san, from:mv.from, to:mv.to, color:mv.color, annotation:mv.annotation||'', clk:mv.clk||null, timestampDs:(mv.timestampDs===undefined?null:mv.timestampDs) }; }),
      fens: built.fens,
      savedAt: Date.now(),
      meuLado: autoDetectLado(headers, state.meuNick)
    };
    state.partidas.unshift(game);
    imported++;
  }
  if(imported>0){
    await persist();
    document.getElementById('pgnPaste').value = '';
    showToast(imported===1 ? 'Partida importada.' : imported+' partidas importadas.');
    renderPartidas();
    renderHeaderStats();
    renderHoje();
  }
  if(lastError){
    errEl.textContent = lastError;
    errEl.style.display = 'block';
  }
}

document.getElementById('importBtn').addEventListener('click', function(){
  importPgnText(document.getElementById('pgnPaste').value);
});

document.getElementById('pgnPaste').addEventListener('paste', function(e){
  var clip = e.clipboardData || window.clipboardData;
  var pasted = clip ? clip.getData('text') : '';
  if(pasted && pasted.trim() && pasted.indexOf('[Event')!==-1){
    setTimeout(function(){ importPgnText(pasted); }, 30);
  }
});

export var dropZone = document.getElementById('importDropZone');

['dragenter','dragover'].forEach(function(evt){
  dropZone.addEventListener(evt, function(e){ e.preventDefault(); e.stopPropagation(); dropZone.classList.add('dragover'); });
});

['dragleave','drop'].forEach(function(evt){
  dropZone.addEventListener(evt, function(e){ e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('dragover'); });
});

dropZone.addEventListener('drop', function(e){
  var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if(!file) return;
  var reader = new FileReader();
  reader.onload = function(evt){ importPgnText(String(evt.target.result||'')); };
  reader.readAsText(file);
});

document.getElementById('pgnFile').addEventListener('change', function(e){
  var file = e.target.files[0];
  if(!file) return;
  var reader = new FileReader();
  reader.onload = function(evt){ importPgnText(String(evt.target.result||'')); };
  reader.readAsText(file);
  e.target.value = '';
});
