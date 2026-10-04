/* Sincronizacao com o Chess.com: fluxo de busca, barra da aba Partidas e controles do menu Opcoes.
   So Chess.com por enquanto. A logica de rede fica em fonte-chesscom.js e a de duplicatas em dedupe.js.
   Erros daqui NUNCA viram o banner fatal: tudo e capturado e mostrado no status. */
import { chaveDeUrl, montarMapaPorChave, ordenarPorFim } from './dedupe.js';
import { buscarMes, inicioDoPeriodo, listarArquivos, mesesDoPeriodo, montarExtras, passaNosFiltros, rotuloMes } from './fonte-chesscom.js';
import { renderPartidas } from './partidas.js';
import { autoDetectLado, persist } from './persistence.js';
import { construirPartida, extractHeaders, novoIdPartida } from './pgn.js';
import { renderHeaderStats, renderHoje } from './render-hoje.js';
import { state } from './state.js';
import { addDaysStr, showToast, todayStr } from './utils.js';

var LIMITE_PRIMEIRA_BUSCA = 200;
var INTERVALO_MIN_AUTO_MS = 2*60*1000;
var MODALIDADES = [['rapid','Rapid'], ['blitz','Blitz'], ['bullet','Bullet'], ['daily','Diário']];

var sincronizando = false; /* trava de execucao: so uma sincronizacao por vez */
var progresso = '';

function $(id){ return document.getElementById(id); }

/* ---------- Regras de quando usar o periodo inicial ---------- */
function filtrosIguais(a, b){
  if(!a || !b) return false;
  var ma = (a.modalidades||[]).slice().sort().join(',');
  var mb = (b.modalidades||[]).slice().sort().join(',');
  return ma===mb && a.periodoInicialDias===b.periodoInicialDias;
}

/* Primeira vez, filtros diferentes dos da ultima busca completa, ou outro nick: o incremental (2 meses) nao basta. */
function precisaPeriodoInicial(nick){
  var s = state.sync;
  return !s.primeiraConcluida || s.nickAplicado!==String(nick).toLowerCase() || !filtrosIguais(s.filtros, s.filtrosAplicados);
}

/* ---------- Mensagens ---------- */
function mensagemErro(tipo, nick){
  switch(tipo){
    case 'naoEncontrado': return "Usuário '"+nick+"' não encontrado no Chess.com. Confira o nick em Opções.";
    case 'limite': return 'Chess.com pediu para esperar. Tente de novo em alguns minutos.';
    case 'servidor': return 'O Chess.com está instável agora. Tente de novo mais tarde.';
    case 'rede': return 'Sem conexão com o Chess.com agora.';
    case 'resposta': return 'Resposta inesperada do Chess.com.';
    case 'modalidades': return 'Escolha ao menos uma modalidade em Opções.';
    default: return 'Não consegui sincronizar agora. Tente de novo pelo botão.';
  }
}

function fmtQuando(ms){
  var d = new Date(ms);
  var hm = d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
  var dia = todayStr(d);
  if(dia===todayStr()) return 'hoje '+hm;
  if(dia===addDaysStr(todayStr(), -1)) return 'ontem '+hm;
  return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+' '+hm;
}

function textoResumo(r){
  if(!r) return '';
  var t = r.novas>0 ? (r.novas===1 ? '1 nova' : r.novas+' novas') : 'nenhuma nova';
  if(r.erros>0) t += ' · '+r.erros+(r.erros===1 ? ' mês com erro' : ' meses com erro');
  if(r.limite) t += ' · limite de '+LIMITE_PRIMEIRA_BUSCA+' atingido (use "Buscar mais antigas" em Opções)';
  return t;
}

/* ---------- Barra na aba Partidas ---------- */
export function renderBarraSync(){
  var btn = $('syncBtn'), st = $('syncStatus');
  if(!btn || !st) return;
  var semNick = !(state.meuNick||'').trim();
  btn.disabled = sincronizando || semNick;
  var rotulo = sincronizando ? 'Buscando...' : (semNick ? 'Defina seu nick em Opções' : 'Atualizar do Chess.com');
  var rot = btn.querySelector('.rot-sync');
  if(rot) rot.textContent = ' '+rotulo; /* no topo o texto some (so o icone); o aria-label e o title cobrem */
  btn.classList.toggle('buscando', sincronizando);
  btn.setAttribute('aria-label', rotulo);
  btn.title = semNick ? 'Defina seu nick em Opções' : (sincronizando ? 'Buscando partidas…' : 'Busca partidas novas no Chess.com agora');

  var s = state.sync, texto = '', erro = false;
  if(sincronizando){
    texto = progresso;
  } else if(s.ultimoErro && !semNick){
    texto = mensagemErro(s.ultimoErro.tipo, s.ultimoErro.nick);
    erro = true;
  } else if(s.ultimaSyncEm){
    texto = 'Última atualização: '+fmtQuando(s.ultimaSyncEm)+(s.ultimoResumo ? ' · '+textoResumo(s.ultimoResumo) : '');
  }
  st.textContent = texto;
  st.classList.toggle('erro', erro);
  renderControlesSync();
}

/* ---------- Controles do menu Opcoes ---------- */
export function renderControlesSync(){
  var s = state.sync;
  var auto = $('syncAutoChk');
  if(auto) auto.checked = !!s.auto;
  MODALIDADES.forEach(function(m){
    var c = $('syncMod-'+m[0]);
    if(c) c.checked = s.filtros.modalidades.indexOf(m[0])!==-1;
  });
  var per = $('syncPeriodo');
  if(per) per.value = String(s.filtros.periodoInicialDias);
  var maisAntigas = $('syncMaisAntigasBtn');
  if(maisAntigas) maisAntigas.disabled = sincronizando || !(state.meuNick||'').trim();
}

export function iniciarSync(){
  var btn = $('syncBtn');
  if(btn) btn.addEventListener('click', function(){ sincronizarChesscom({ origem:'botao' }); });

  var auto = $('syncAutoChk');
  if(auto) auto.addEventListener('change', function(){ state.sync.auto = auto.checked; persist(); });

  MODALIDADES.forEach(function(m){
    var c = $('syncMod-'+m[0]);
    if(!c) return;
    c.addEventListener('change', function(){
      state.sync.filtros.modalidades = MODALIDADES.map(function(x){ return x[0]; }).filter(function(k){
        var el = $('syncMod-'+k);
        return el && el.checked;
      });
      persist();
    });
  });

  var per = $('syncPeriodo');
  if(per) per.addEventListener('change', function(){
    state.sync.filtros.periodoInicialDias = per.value==='tudo' ? 'tudo' : (parseInt(per.value, 10) || 30);
    persist();
  });

  var maisAntigas = $('syncMaisAntigasBtn');
  if(maisAntigas) maisAntigas.addEventListener('click', function(){ sincronizarChesscom({ origem:'botao', modo:'periodo' }); });

  var reimportar = $('syncReimportarBtn');
  if(reimportar) reimportar.addEventListener('click', async function(){
    var n = state.sync.ignorados.length;
    state.sync.ignorados = [];
    await persist();
    showToast(n===0 ? 'Nenhuma partida removida na lista.' : n+(n===1 ? ' partida removida poderá' : ' partidas removidas poderão')+' voltar na próxima busca.');
  });

  /* backup carregado: os controles precisam refletir o novo estado */
  document.addEventListener('caderno:estado-carregado', function(){ renderControlesSync(); renderBarraSync(); });
}

/* ---------- Disparo automatico (ao abrir o app, ou ao salvar um nick novo) ---------- */
export function iniciarSyncAutomatico(){
  var s = state.sync;
  var nick = (state.meuNick||'').trim();
  if(!s.auto || !nick || navigator.onLine===false) return;
  /* nick que ja deu 404: nao repete a cada abertura; o status continua explicando (e o botao tenta de novo) */
  if(s.ultimoErro && s.ultimoErro.tipo==='naoEncontrado' && s.ultimoErro.nick===nick){ renderBarraSync(); return; }
  if(!precisaPeriodoInicial(nick) && s.ultimaSyncEm && (Date.now()-s.ultimaSyncEm) < INTERVALO_MIN_AUTO_MS) return;
  sincronizarChesscom({ origem:'auto' }).catch(function(){});
}

/* ---------- Nucleo ---------- */
function registrarErro(tipo, nick, origem){
  state.sync.ultimoErro = { tipo:tipo, nick:nick, em:Date.now() };
  if(tipo==='naoEncontrado') Promise.resolve(persist()).catch(function(){}); /* lembra entre sessoes, pra nao repetir */
  if(origem==='botao') showToast(mensagemErro(tipo, nick));
}

function ladoPorUsername(jogo, nick, headers){
  var n = nick.toLowerCase();
  var w = jogo.white && jogo.white.username ? String(jogo.white.username).toLowerCase() : '';
  var b = jogo.black && jogo.black.username ? String(jogo.black.username).toLowerCase() : '';
  if(w===n) return 'w';
  if(b===n) return 'b';
  return autoDetectLado(headers, nick);
}

function cederATela(){ return new Promise(function(r){ setTimeout(r, 0); }); }

/* opts: { origem:'auto'|'botao', modo:'periodo' (ignora a regra dos 2 meses) } */
export async function sincronizarChesscom(opts){
  opts = opts || {};
  var origem = opts.origem || 'botao';
  if(sincronizando) return null;
  var nick = (state.meuNick||'').trim();
  if(!nick){ renderBarraSync(); return null; }
  if(navigator.onLine===false){
    registrarErro('rede', nick, origem);
    renderBarraSync();
    return null;
  }

  sincronizando = true;
  progresso = 'Buscando...';
  renderBarraSync();
  var resumo = { novas:0, duplicadas:0, filtradas:0, ignoradas:0, preenchidas:0, erros:0, limite:false, em:Date.now() };

  try{
    var filtros = {
      modalidades: state.sync.filtros.modalidades.slice(),
      periodoInicialDias: state.sync.filtros.periodoInicialDias
    };
    if(!filtros.modalidades.length){ var e0 = new Error('modalidades'); e0.tipo = 'modalidades'; throw e0; }

    var arquivos = await listarArquivos(nick);
    var modoInicial = opts.modo==='periodo' || precisaPeriodoInicial(nick);
    var inicioMs = modoInicial ? inicioDoPeriodo(filtros.periodoInicialDias, Date.now()) : 0;
    var meses = modoInicial ? mesesDoPeriodo(arquivos, inicioMs) : arquivos.slice(-2); /* mes atual + anterior */
    meses = meses.slice().reverse(); /* mais novo primeiro: o limite de 200 guarda as mais recentes */
    var limite = modoInicial ? LIMITE_PRIMEIRA_BUSCA : Infinity;

    var mesesOk = 0, ultimoErroMes = null, parar = false;
    var mapa, ign;

    for(var mi=0; mi<meses.length && !parar; mi++){
      progresso = 'Buscando '+rotuloMes(meses[mi])+'...';
      renderBarraSync();
      var jogos;
      try{
        jogos = await buscarMes(meses[mi]);
        mesesOk++;
      }catch(eMes){
        resumo.erros++; /* erro em UM mes nao aborta os outros */
        ultimoErroMes = eMes;
        continue;
      }
      /* houve await (rede): reconstroi o que depende do estado, que pode ter mudado (PGN colado, partida removida) */
      mapa = montarMapaPorChave(state.partidas);
      ign = new Set(state.sync.ignorados);
      jogos = jogos.slice().sort(function(a, b){ return (b.end_time||0)-(a.end_time||0); });
      var mudou = false;

      for(var ji=0; ji<jogos.length; ji++){
        if(ji>0 && ji%10===0){
          progresso = 'Importando '+ji+'/'+jogos.length+'...';
          renderBarraSync();
          await cederATela();
          mapa = montarMapaPorChave(state.partidas);
          ign = new Set(state.sync.ignorados);
        }
        /* daqui ate o unshift NAO ha await: checar e inserir acontecem no mesmo trecho sincrono */
        if(resumo.novas>=limite){ resumo.limite = true; parar = true; break; }
        var jogo = jogos[ji];
        if(!passaNosFiltros(jogo, filtros, inicioMs)){ resumo.filtradas++; continue; }

        var headers = extractHeaders(jogo.pgn);
        var uuid = jogo.uuid ? 'ccu:'+jogo.uuid : null;
        var chave = chaveDeUrl(jogo.url) || chaveDeUrl(headers.Link);
        var built = null;
        if(!chave){ /* sem link: precisa dos lances pra montar a chave de fallback */
          built = construirPartida(jogo.pgn, novoIdPartida());
          if(!built.ok){ resumo.erros++; continue; }
          chave = built.game.fonteId;
        }

        var existente = mapa.get(chave) || (uuid ? mapa.get(uuid) : null);
        if(existente){
          resumo.duplicadas++;
          if(!existente.extras){ existente.extras = montarExtras(jogo); resumo.preenchidas++; mudou = true; } /* so o campo vazio; nada mais e tocado */
          continue;
        }
        if(ign.has(chave)){ resumo.ignoradas++; continue; }

        if(!built) built = construirPartida(jogo.pgn, novoIdPartida());
        if(!built.ok){ resumo.erros++; continue; }

        var game = built.game;
        game.fonte = 'chesscom';
        game.fonteId = chave;
        game.meuLado = ladoPorUsername(jogo, nick, headers);
        game.extras = montarExtras(jogo);
        game.novaEm = Date.now();
        state.partidas.unshift(game);
        mapa.set(chave, game);
        if(uuid) mapa.set(uuid, game);
        resumo.novas++;
        mudou = true;
      }
      if(mudou) await persist(); /* por mes, nao por partida */
    }

    if(mesesOk===0 && meses.length>0) throw ultimoErroMes;

    var sy = state.sync;
    sy.ultimaSyncEm = Date.now();
    if(modoInicial && resumo.erros===0){
      sy.primeiraConcluida = true;
      sy.filtrosAplicados = { modalidades: filtros.modalidades.slice(), periodoInicialDias: filtros.periodoInicialDias };
      sy.nickAplicado = nick.toLowerCase();
    }
    resumo.em = Date.now();
    sy.ultimoResumo = resumo;
    sy.ultimoErro = null;
    state.partidas = ordenarPorFim(state.partidas);
    await persist();
    if(resumo.novas>0 || resumo.preenchidas>0){
      renderPartidas();
      renderHeaderStats();
      renderHoje();
    }

    if(resumo.novas>0){
      showToast((resumo.novas===1 ? '1 partida nova' : resumo.novas+' partidas novas')+' do Chess.com'+(resumo.limite ? ' (limite de '+LIMITE_PRIMEIRA_BUSCA+' atingido)' : ''));
    } else if(origem==='botao'){
      showToast(resumo.limite ? 'Limite de '+LIMITE_PRIMEIRA_BUSCA+' atingido.' : 'Nenhuma partida nova.');
    }
    return resumo;
  }catch(e){
    var tipo = e && e.tipo ? e.tipo : 'outro';
    if(tipo==='outro' && window.console) console.error('Falha na sincronização com o Chess.com:', e);
    registrarErro(tipo, nick, origem);
    return null;
  }finally{
    sincronizando = false;
    progresso = '';
    renderBarraSync();
  }
}
