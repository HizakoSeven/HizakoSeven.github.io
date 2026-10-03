/* Sequencia (streak) de dias estudados. Logica pura: sem DOM, sem `state`. */
import { addDaysStr } from './utils.js';

/* O que mostrar na tela: a sequencia so vale se o ultimo dia ativo foi hoje ou ontem.
   Sem isso, 10 dias parado continuava exibindo a sequencia antiga. */
export function streakEfetivo(streak, hoje){
  var s = streak || {};
  if(!s.lastActiveDate) return 0;
  if(s.lastActiveDate===hoje || s.lastActiveDate===addDaysStr(hoje, -1)) return s.currentStreak || 0;
  return 0;
}

/* Atualiza `streak` conforme o checklist de hoje. Retorna true se mudou algo (pra persistir).
   - Algum bloco marcado e hoje ainda nao contado: soma (ou reinicia em 1 se pulou dia).
   - Tudo desmarcado depois de ter contado hoje: desfaz o dia, voltando ao estado de antes. */
export function atualizarStreakDoDia(streak, algumBlocoMarcado, hoje){
  var s = streak;
  if(algumBlocoMarcado){
    if(s.lastActiveDate===hoje) return false;
    s.antesDeHoje = {
      data: hoje,
      currentStreak: s.currentStreak || 0,
      lastActiveDate: s.lastActiveDate || null,
      longestStreak: s.longestStreak || 0
    };
    s.currentStreak = (s.lastActiveDate===addDaysStr(hoje, -1)) ? (s.currentStreak||0)+1 : 1;
    s.lastActiveDate = hoje;
    s.longestStreak = Math.max(s.longestStreak||0, s.currentStreak);
    return true;
  }
  if(s.lastActiveDate!==hoje) return false;
  var antes = s.antesDeHoje && s.antesDeHoje.data===hoje ? s.antesDeHoje : null;
  if(antes){
    s.currentStreak = antes.currentStreak;
    s.lastActiveDate = antes.lastActiveDate;
    s.longestStreak = antes.longestStreak;
  } else {
    /* dado salvo antes do snapshot existir: reconstroi o que da */
    var atual = s.currentStreak || 0;
    if(atual>1){ s.currentStreak = atual-1; s.lastActiveDate = addDaysStr(hoje, -1); }
    else { s.currentStreak = 0; s.lastActiveDate = null; }
  }
  delete s.antesDeHoje;
  return true;
}
