/* Importacao de PGN: parsing e wiring do formulario de import. */
import { renderPartidas } from './partidas.js';
import { chavePartida, montarIndice, ordenarPorFim, removerIgnorado } from './dedupe.js';
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
    var clean = it.replace(/[!?]+$/, '').replace(/^\d+\.(\.\.)?/, '');

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

var contadorId = 0;

/* id interno unico, mesmo em lote rapido. A identidade "real" da partida e game.fonteId. */
export function novoIdPartida(){
  contadorId++;
  return 'g'+Date.now()+'_'+contadorId;
}

/* Dado o texto de UMA partida em PGN, devolve { ok:true, game } ou { ok:false, ... }.
   `vazio:true` = nao havia lances. Usada pela importacao manual e pela sincronizacao. */
export function construirPartida(pgnTexto, idUnico){
  var headers = extractHeaders(pgnTexto);
  var tokens = extractSanTokens(extractMovetext(pgnTexto));
  if(tokens.length===0) return { ok:false, vazio:true };
  var built = buildGameFromSan(tokens);
  if(!built.ok){
    return { ok:false, appliedCount:built.appliedCount, failedToken:built.failedToken, error:built.error };
  }
  var game = {
    id: idUnico || novoIdPartida(),
    headers: headers,
    applied: built.applied.map(function(mv){ return { san:mv.san, from:mv.from, to:mv.to, color:mv.color, annotation:mv.annotation||'', clk:mv.clk||null, timestampDs:(mv.timestampDs===undefined?null:mv.timestampDs) }; }),
    fens: built.fens,
    savedAt: Date.now(),
    meuLado: autoDetectLado(headers, state.meuNick)
  };
  game.fonte = 'manual';
  game.fonteId = chavePartida({ headers:headers, applied:game.applied });
  return { ok:true, game:game };
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
  var jaExistiam = 0;
  var lastError = null;
  /* sem `await` dentro do laco: checar o indice e inserir acontecem no mesmo trecho sincrono */
  var indice = montarIndice(state.partidas);
  for(var i=0;i<chunks.length;i++){
    var r = construirPartida(chunks[i], novoIdPartida());
    if(r.vazio) continue;
    if(!r.ok){
      lastError = 'Não consegui ler uma partida a partir do lance '+(r.appliedCount!==undefined ? (r.appliedCount+1) : '?')+' ("'+escapeHtml(r.failedToken||'?')+'"). Confira se o texto foi copiado por inteiro.';
      continue;
    }
    var chave = r.game.fonteId;
    if(indice.has(chave)){ jaExistiam++; continue; }
    state.partidas.push(r.game);
    indice.add(chave);
    removerIgnorado(state.sync.ignorados, chave); /* colou de propósito: não deve ficar na lista de removidas */
    imported++;
  }
  if(imported>0 || jaExistiam>0){
    if(imported>0){
      state.partidas = ordenarPorFim(state.partidas);
      await persist();
    }
    document.getElementById('pgnPaste').value = '';
    var msg = imported===0 ? '' : (imported===1 ? 'Partida importada.' : imported+' partidas importadas.');
    if(jaExistiam>0) msg += (msg?' ':'')+(jaExistiam===1 ? '1 partida já estava no caderno.' : jaExistiam+' partidas já estavam no caderno.');
    showToast(msg);
    if(imported>0){
      renderPartidas();
      renderHeaderStats();
      renderHoje();
    }
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
