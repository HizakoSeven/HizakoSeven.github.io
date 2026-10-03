/* Estado global compartilhado do app (o objeto `state`) e getters simples sobre ele. */
import { todayStr } from './utils.js';

export var state = {
  erros: [],
  partidas: [],
  streak: { currentStreak:0, longestStreak:0, lastActiveDate:null },
  checklistByDate: {},
  tacticsProgress: { idx:0 },
  meuNick: '',
  openErroBoardId: null,
  openErroBoardPly: 0,
  activeTab: 'hoje',
  editingErroId: null,
  openGameId: null,
  currentPly: 0,
  boardFlipped: false,
  pendingErroPrefill: null,
  storageWarned: false,
  storageOk: false,
  revisao: { atualId:null, revelado:false },
  revisaoInterativa: { selecionada:null, destinos:[], promocaoPendente:null, avaliando:false, refInfo:null, refLinhas:null, refBestUci:null, resultado:null, jaContado:false, cursorPly:null, timeline:'jogo', linhaMotor:null, animarProximaRenderizacao:true },
  analiseEmAndamento: null,
  motorConfig: { multiPv:1, movetimeMs:1200, hashMb:16, movetimeAnaliseMs:400, depthAnalise:20 }
};

export function getTodayChecklist(){
  return state.checklistByDate[todayStr()] || { b1:false, b2:false, b3:false, b4:false };
}

/* Presets de configuracao do motor (aplicam as 4 opcoes de uma vez). */
export var MOTOR_PRESETS = {
  rapido:      { rotulo:'⚡ Rápido',      multiPv:1, movetimeMs:500,  hashMb:16, depthAnalise:12 },
  equilibrado: { rotulo:'⚖ Equilibrado', multiPv:2, movetimeMs:1200, hashMb:32, depthAnalise:16 },
  profundo:    { rotulo:'🔬 Profundo',    multiPv:3, movetimeMs:3000, hashMb:64, depthAnalise:22 }
};

export function presetAtual(){
  var c = state.motorConfig;
  var achado = null;
  Object.keys(MOTOR_PRESETS).forEach(function(k){
    var p = MOTOR_PRESETS[k];
    if(p.multiPv===c.multiPv && p.movetimeMs===c.movetimeMs && p.hashMb===c.hashMb && p.depthAnalise===c.depthAnalise) achado = k;
  });
  return achado;
}
