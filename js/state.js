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
