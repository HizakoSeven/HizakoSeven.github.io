/* Preferencias de interface, guardadas so neste navegador (nao entram no backup dos dados):
   modo compacto, quais secoes recolhiveis estao abertas, e os menus "popover" que abrem por cima da pagina. */
import { wrapArray } from './utils.js';

var CHAVE = 'caderno-ui-v1';
var prefs = { compacto:false, abertos:{}, vis:null };
var lido = false;

/* ---------- Barra de vantagem e setas do motor (so neste navegador, fora do backup) ---------- */
export var VIS_PADRAO = {
  setasOn:true, setaMelhor:true, setaJogado:false, setaLinhas23:false,
  quando:'sempre',            /* sempre | minhaVez | vezAdv */
  soErrosCp:0,                /* 0 = sempre; N = so quando o lance jogado perdeu mais que N cp */
  escondeDecidida:false,
  nLinhas:2,                  /* total de linhas com seta (1 a 3), quando "2a e 3a linhas" esta ligado */
  corMelhor:'#3f8f4a', corJogado:'#c0392b', corLinhas:'#7fb88a',
  espessura:'media',          /* fina | media | grossa */
  opacidade:82,               /* 30 a 100 */
  rotuloSan:true,
  barraOn:true, barraNumero:true, barraUnidade:'peoes', /* peoes | pct */
  barraLado:'esq', barraFina:false, barraAnimar:true, barraFantasma:true,
  aoVivo:true, aoVivoMs:600,
  usarNaRevisao:true
};

export var VIS_PRESETS = {
  discreto: { setasOn:false, barraOn:true, barraNumero:false, barraFina:true },
  completo: { setasOn:true, setaMelhor:true, setaJogado:true, setaLinhas23:true, nLinhas:3, barraOn:true, barraNumero:true, barraFina:false },
  treino:   { setasOn:false, barraOn:false, rotuloSan:false }
};

var COR_RE = /^#[0-9a-f]{6}$/i;
var ENUMS = { quando:['sempre','minhaVez','vezAdv'], espessura:['fina','media','grossa'], barraUnidade:['peoes','pct'], barraLado:['esq','dir'] };
var NUMS = { soErrosCp:[0,2000], nLinhas:[1,3], opacidade:[30,100], aoVivoMs:[200,5000] };

/* Aceita so valores validos; o resto cai no padrao (localStorage pode estar velho, editado ou corrompido). */
export function sanearVis(entrada, base){
  var out = Object.assign({}, base || VIS_PADRAO);
  if(!entrada || typeof entrada!=='object') return out;
  Object.keys(VIS_PADRAO).forEach(function(k){
    if(!(k in entrada)) return;
    var v = entrada[k], pad = VIS_PADRAO[k];
    if(typeof pad==='boolean'){ if(typeof v==='boolean') out[k] = v; }
    else if(ENUMS[k]){ if(ENUMS[k].indexOf(v)!==-1) out[k] = v; }
    else if(NUMS[k]){ var n = Number(v); if(isFinite(n)) out[k] = Math.max(NUMS[k][0], Math.min(NUMS[k][1], Math.round(n))); }
    else if(/^cor/.test(k)){ if(typeof v==='string' && COR_RE.test(v)) out[k] = v.toLowerCase(); }
  });
  return out;
}

export function getPrefsVis(){
  if(!lido) ler();
  if(!prefs.vis) prefs.vis = Object.assign({}, VIS_PADRAO);
  return prefs.vis;
}

export function setPrefsVis(patch){
  prefs.vis = sanearVis(Object.assign({}, getPrefsVis(), patch));
  gravar();
  return prefs.vis;
}

export function restaurarPrefsVis(){
  prefs.vis = Object.assign({}, VIS_PADRAO);
  gravar();
  return prefs.vis;
}

export function aplicarPresetVis(nome){
  var p = VIS_PRESETS[nome];
  if(!p) return getPrefsVis();
  return setPrefsVis(p);
}

function ler(){
  lido = true;
  try{
    var raw = localStorage.getItem(CHAVE);
    if(!raw) return;
    var p = JSON.parse(raw);
    if(p && typeof p==='object'){
      prefs.compacto = !!p.compacto;
      prefs.abertos = (p.abertos && typeof p.abertos==='object') ? p.abertos : {};
      prefs.vis = sanearVis(p.vis);
    }
  }catch(e){ /* armazenamento bloqueado ou corrompido: segue com o padrao */ }
}

function gravar(){
  try{ localStorage.setItem(CHAVE, JSON.stringify(prefs)); }catch(e){}
}

export function aplicarCompacto(valor){
  prefs.compacto = !!valor;
  document.body.classList.toggle('compacto', prefs.compacto);
  var btn = document.getElementById('compactBtn');
  if(btn) btn.setAttribute('aria-pressed', prefs.compacto ? 'true' : 'false');
}

/* secoes que o usuario pode abrir/fechar e que o app lembra */
function secoesRecolhiveis(escopo){
  return wrapArray((escopo || document).querySelectorAll('details.fold, #tab-plano > details'));
}

/* Registra <details class="fold" id="..."> criados DEPOIS do carregamento (ex.: blocos da aba Analise, que sao
   redesenhados): restaura aberto/fechado e passa a lembrar. Precisa de id estavel; sem id, ignora. */
export function ligarRecolhiveis(escopo){
  if(!lido) ler();
  secoesRecolhiveis(escopo).forEach(function(d){
    if(!d.id || d.dataset.recolhivel==='1') return;
    d.dataset.recolhivel = '1';
    if(Object.prototype.hasOwnProperty.call(prefs.abertos, d.id)) d.open = !!prefs.abertos[d.id];
    d.addEventListener('toggle', function(){ prefs.abertos[d.id] = d.open; gravar(); });
  });
}

export function fecharPopovers(exceto){
  wrapArray(document.querySelectorAll('details.popover[open]')).forEach(function(d){
    if(d!==exceto) d.open = false;
  });
}

export function iniciarUI(){
  ler();
  aplicarCompacto(prefs.compacto);

  var contagemPorAba = {};
  secoesRecolhiveis().forEach(function(d){
    var aba = d.closest('.tab-panel');
    var abaId = aba ? aba.id : 'pagina';
    if(!d.id){
      contagemPorAba[abaId] = (contagemPorAba[abaId]||0) + 1;
      d.id = 'sec-'+abaId+'-'+contagemPorAba[abaId];
    }
    if(Object.prototype.hasOwnProperty.call(prefs.abertos, d.id)) d.open = !!prefs.abertos[d.id];
    d.addEventListener('toggle', function(){ prefs.abertos[d.id] = d.open; gravar(); });
  });

  var compactBtn = document.getElementById('compactBtn');
  if(compactBtn) compactBtn.addEventListener('click', function(){ aplicarCompacto(!prefs.compacto); gravar(); });

  /* menus popover: um aberto por vez; clique fora ou Esc fecham */
  wrapArray(document.querySelectorAll('details.popover')).forEach(function(d){
    d.addEventListener('toggle', function(){ if(d.open) fecharPopovers(d); });
  });
  document.addEventListener('click', function(e){
    wrapArray(document.querySelectorAll('details.popover[open]')).forEach(function(d){
      if(!d.contains(e.target)) d.open = false;
    });
  });
  document.addEventListener('keydown', function(e){
    if(e.key!=='Escape') return;
    var aberto = document.querySelector('details.popover[open]');
    if(!aberto) return;
    aberto.open = false;
    var sum = aberto.querySelector('summary');
    if(sum) sum.focus();
  });
}
