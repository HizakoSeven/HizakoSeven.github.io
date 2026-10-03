/* Agenda da revisao espacada (caixas de Leitner, por dia). Logica pura: sem DOM, sem `state`.

   Regras:
   - Erro novo (ou sem agenda) vence na hora.
   - So conta como acerto o que VENCEU. Acertar antes da data e "treino antecipado": nao avanca.
   - Acerto que conta: 1o -> volta em 2 dias; 2o -> volta em 7 dias; 3o -> dominado (sai da fila).
   - Errar zera os acertos seguidos e o erro volta a vencer em 1 dia (mesmo se estava treinando antes da data). */
import { addDaysStr, todayStr } from './utils.js';

export var REVISAO_ACERTOS_PARA_DOMINAR = 3;

export var REVISAO_INTERVALOS_DIAS = [2, 7]; /* depois do 1o e depois do 2o acerto seguido */

export var REVISAO_INTERVALO_APOS_ERRO_DIAS = 1;

function intervaloAposAcerto(acertos){
  var i = Math.min(acertos, REVISAO_INTERVALOS_DIAS.length) - 1;
  return REVISAO_INTERVALOS_DIAS[Math.max(0, i)];
}

/* Data (YYYY-MM-DD) em que o erro volta a vencer, ou null se vence ja / esta dominado.
   Erros antigos, salvos antes da agenda existir, derivam a data da ultima revisao. */
export function proximaRevisaoDe(en){
  if(!en || en.resolvido) return null;
  if(en.proximaRevisaoEm) return en.proximaRevisaoEm;
  var acertos = en.acertosSeguidos || 0;
  if(acertos>0 && en.ultimaRevisaoEm){
    return addDaysStr(todayStr(new Date(en.ultimaRevisaoEm)), intervaloAposAcerto(acertos));
  }
  return null;
}

export function erroVencido(en, hoje){
  if(!en || en.resolvido) return false;
  var p = proximaRevisaoDe(en);
  return !p || p <= hoje;
}

/* Fila de hoje: o mais atrasado primeiro (sem agenda = nunca revisado = mais urgente),
   depois quem tem menos acertos seguidos, depois o revisado ha mais tempo. */
export function ordenarVencidos(erros, hoje){
  return erros.filter(function(e){ return erroVencido(e, hoje); }).sort(function(a, b){
    var pa = proximaRevisaoDe(a) || '', pb = proximaRevisaoDe(b) || '';
    if(pa!==pb) return pa < pb ? -1 : 1;
    var aa = a.acertosSeguidos||0, bb = b.acertosSeguidos||0;
    if(aa!==bb) return aa-bb;
    return (a.ultimaRevisaoEm||0) - (b.ultimaRevisaoEm||0);
  });
}

/* Ainda nao dominados e com data no futuro. */
export function listarAgendados(erros, hoje){
  return erros.filter(function(e){ return !e.resolvido && !erroVencido(e, hoje); });
}

/* Aplica a resposta ao erro (muda `en`). Retorna { contou, dominouAgora, proxima }. */
export function aplicarRespostaRevisao(en, acertou, hoje, agora){
  var venceu = erroVencido(en, hoje);
  en.vezesRevisado = (en.vezesRevisado||0) + 1;
  en.ultimaRevisaoEm = agora;
  var r = { contou:true, dominouAgora:false, proxima:null };
  if(acertou){
    if(!venceu){
      r.contou = false; /* treino antecipado */
      r.proxima = proximaRevisaoDe(en);
      return r;
    }
    en.acertosSeguidos = (en.acertosSeguidos||0) + 1;
    if(en.acertosSeguidos >= REVISAO_ACERTOS_PARA_DOMINAR){
      en.resolvido = true;
      en.proximaRevisaoEm = null;
      r.dominouAgora = true;
    } else {
      en.proximaRevisaoEm = addDaysStr(hoje, intervaloAposAcerto(en.acertosSeguidos));
      r.proxima = en.proximaRevisaoEm;
    }
  } else {
    en.acertosSeguidos = 0;
    en.proximaRevisaoEm = addDaysStr(hoje, REVISAO_INTERVALO_APOS_ERRO_DIAS);
    r.proxima = en.proximaRevisaoEm;
  }
  return r;
}
