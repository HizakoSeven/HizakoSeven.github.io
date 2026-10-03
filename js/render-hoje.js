/* Aba "Hoje": checklist do dia, streak, tema tatico, tendencia de erros. */
import { switchTab } from './main.js';
import { persist } from './persistence.js';
import { getTodayChecklist, state } from './state.js';
import { atualizarStreakDoDia, streakEfetivo } from './streak.js';
import { addDaysStr, escapeHtml, pluralDias, showToast, todayStr } from './utils.js';

export var WEEKDAY_NAMES = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];

export var WEEKDAY_PLAN = [
  { short:'Revisão da semana', detail:'Releia o caderno de erros inteiro e repita, no Lichess, os puzzles que você errou. Sem tema novo hoje — é dia de fixar o que já apareceu.', link:null, linkLabel:null },
  { short:'Táticas temáticas (bloco)', detail:'Veja o card "Tema tático de hoje" logo abaixo — ele já sabe em qual tema você está.', link:null, linkLabel:null },
  { short:'Finais de peão', detail:'Lichess → Practice → puzzles de Rei+peão vs Rei e oposição básica. Faça um bloco até acertar sem hesitar.', link:'https://lichess.org/practice', linkLabel:'Abrir Lichess Practice' },
  { short:'Aberturas: seu repertório de pretas', detail:'Abra o Analysis Board, jogue a abertura que você usa de pretas e explore a aba Explorer pra ver as respostas brancas mais comuns. Confira se você sabe de cor os primeiros 6-8 lances da sua linha contra cada uma.', link:'https://lichess.org/analysis', linkLabel:'Abrir Analysis + Explorer' },
  { short:'Táticas mistas (bloco)', detail:'Veja o card "Tema tático de hoje" logo abaixo — hoje é pra misturar os temas que você já viu.', link:null, linkLabel:null },
  { short:'Aberturas: seu repertório de brancas', detail:'Escolha uma resposta preta comum ao seu primeiro lance e repasse seu plano contra ela no Explorer.', link:'https://lichess.org/analysis', linkLabel:'Abrir Analysis + Explorer' },
  { short:'Finais de torre', detail:'Lichess → Practice → posições de Lucena e Philidor. Depois, aproveite pra jogar a sessão de partidas mais longa da semana.', link:'https://lichess.org/practice', linkLabel:'Abrir Lichess Practice' }
];

export var TACTICS_THEMES = [
  { slug:'hangingPiece', label:'Peças penduradas', note:'a base de tudo — ache a peça que já está de graça.' },
  { slug:'mateIn1', label:'Mate em 1', note:'treina enxergar o lance final antes de jogar.' },
  { slug:'fork', label:'Garfo', note:'atenção especial ao garfo de cavalo.' },
  { slug:'pin', label:'Cravada', note:'absoluta (contra o rei) e relativa (contra peça valiosa).' },
  { slug:'skewer', label:'Raio-X (skewer)', note:'o inverso da cravada — a peça valiosa é atacada primeiro.' },
  { slug:'discoveredAttack', label:'Ataque descoberto', note:'uma peça se move e libera o ataque de outra.' },
  { slug:'doubleCheck', label:'Xeque duplo', note:'duas peças dão xeque ao mesmo tempo — o rei quase sempre precisa se mover.' },
  { slug:'deflection', label:'Deflexão / sobrecarga', note:'força a peça defensora a sair do lugar certo.' },
  { slug:'attraction', label:'Atração', note:'atrai uma peça pra uma casa ruim, geralmente com sacrifício.' },
  { slug:'kingsideAttack', label:'Ataque ao rei', note:'padrões clássicos tipo Bxh7+, Nxf7.' },
  { slug:'backRankMate', label:'Mate no corredor', note:'o clássico mate na última fileira.' },
  { slug:'anastasiaMate', label:'Padrões de mate', note:'Anastasia — depois disso, procure também arabianMate e smotheredMate.' }
];

export function renderHeaderStats(){
  var s = 'partida'+(state.partidas.length===1?'':'s')+' · '+
          state.erros.length+' erro'+(state.erros.length===1?'':'s')+' catalogado'+(state.erros.length===1?'':'s')+' · sequência de '+pluralDias(streakEfetivo(state.streak, todayStr()));
  document.getElementById('statsMini').textContent = state.partidas.length+' '+s;
}

export function renderHoje(){
  var now = new Date();
  var dow = now.getDay();
  var plan = WEEKDAY_PLAN[dow];
  document.getElementById('hojeDayLabel').textContent = WEEKDAY_NAMES[dow]+' · '+now.toLocaleDateString('pt-BR',{day:'2-digit',month:'long'});
  document.getElementById('hojeFocusTitle').textContent = plan.short;

  var checklist = getTodayChecklist();
  var blocks = [
    { key:'b1', title:'Aquecimento tático', sub:'20 min · Puzzles gerais do Lichess (não precisa escolher tema — é só pra esquentar o olho)' },
    { key:'b2', title:'Estudo dirigido', sub:'35-40 min · '+plan.short },
    { key:'b3', title:'Partidas com atenção total', sub:'45-60 min · Chess.com, 2-3 partidas em 15+10 ou 10+5' },
    { key:'b4', title:'Análise pós-jogo', sub:'20-30 min · Lichess — pelo menos 1 partida analisada a fundo' }
  ];
  var wrap = document.getElementById('checklistWrap');
  wrap.innerHTML = blocks.map(function(b){
    var done = !!checklist[b.key];
    var extra = '';
    if(b.key==='b2'){
      extra = '<div class="ci-sub" style="margin-top:6px;">'+escapeHtml(plan.detail)+'</div>'+
        (plan.link ? '<a class="btn btn-ghost btn-sm" style="display:inline-block;margin-top:6px;text-decoration:none;" href="'+plan.link+'" target="_blank" rel="noopener">'+escapeHtml(plan.linkLabel)+'</a>' : '')+
        (dow===0 ? '<button class="btn btn-primary btn-sm" id="irRevisarBtn" style="display:inline-block;margin-top:6px;margin-left:6px;">Abrir revisão espaçada</button>' : '');
    }
    return '<label class="checklist-item'+(done?' done':'')+'" style="cursor:pointer;">'+
      '<input type="checkbox" data-block="'+b.key+'" '+(done?'checked':'')+'>'+
      '<span class="ci-text"><span class="ci-title">'+escapeHtml(b.title)+'</span>'+
      '<div class="ci-sub">'+escapeHtml(b.sub)+'</div>'+extra+'</span></label>';
  }).join('');

  wrap.querySelectorAll('input[type=checkbox]').forEach(function(cb){
    cb.addEventListener('change', async function(){
      var todayChecklist = getTodayChecklist();
      todayChecklist[cb.dataset.block] = cb.checked;
      state.checklistByDate[todayStr()] = todayChecklist;
      maybeUpdateStreak(); /* ajusta a sequencia (soma ou desfaz o dia) antes de gravar, numa gravacao so */
      await persist();
      renderHoje();
      renderHeaderStats();
    });
  });

  var irRevisarBtn = document.getElementById('irRevisarBtn');
  if(irRevisarBtn) irRevisarBtn.addEventListener('click', function(){ switchTab('revisar'); });

  var doneCount = Object.values(checklist).filter(Boolean).length;
  document.getElementById('hojeProgressFill').style.width = (doneCount/4*100)+'%';
  document.getElementById('hojeProgressText').textContent = doneCount+' de 4 blocos concluídos hoje';

  document.getElementById('statPartidas').textContent = state.partidas.length;
  document.getElementById('statErros').textContent = state.erros.length;
  document.getElementById('statStreak').textContent = streakEfetivo(state.streak, todayStr());

  renderTacticsWidget(dow);
  renderErrorTrend();
}

export var STOPWORDS_PADRAO = ['de','da','do','das','dos','que','uma','um','a','o','e','em','com','pra','para','no','na','os','as','já','mais','vez','vezes','esse','essa','isso','não','nao','me','eu','foi','ser','tem','tinha','the','and','to'];

export function palavraMaisRecorrente(erros){
  var counts = {};
  erros.forEach(function(en){
    if(!en.padrao) return;
    var seen = {};
    var words = en.padrao.toLowerCase().replace(/[.,!?;:()"']/g,' ').split(/\s+/).filter(Boolean);
    words.forEach(function(w){
      if(w.length<4) return;
      if(STOPWORDS_PADRAO.indexOf(w)!==-1) return;
      if(seen[w]) return;
      seen[w] = true;
      counts[w] = (counts[w]||0)+1;
    });
  });
  var best = null;
  Object.keys(counts).forEach(function(w){
    if(counts[w]>=2 && (!best || counts[w]>counts[best])) best = w;
  });
  return best ? { palavra:best, count:counts[best] } : null;
}

export function renderErrorTrend(){
  var wrap = document.getElementById('errorTrendWrap');
  if(!wrap) return;
  var hoje = todayStr();
  var semanaAtualIni = addDaysStr(hoje, -6);
  var semanaAnteriorIni = addDaysStr(hoje, -13);
  var semanaAnteriorFim = addDaysStr(hoje, -7);

  var atual = state.erros.filter(function(en){ return en.tipo==='blunder' && en.data && en.data>=semanaAtualIni; }).length;
  var anterior = state.erros.filter(function(en){ return en.tipo==='blunder' && en.data && en.data>=semanaAnteriorIni && en.data<=semanaAnteriorFim; }).length;
  var maxBar = Math.max(atual, anterior, 1);

  var padrao = palavraMaisRecorrente(state.erros);

  wrap.innerHTML =
    '<div style="margin-bottom:4px;display:flex;justify-content:space-between;font-size:12.5px;color:var(--ink-soft);"><span>Blunders essa semana</span><span>'+atual+'</span></div>'+
    '<div class="progress-bar" style="margin-bottom:10px;"><div class="progress-fill" style="width:'+(atual/maxBar*100)+'%;"></div></div>'+
    '<div style="margin-bottom:4px;display:flex;justify-content:space-between;font-size:12.5px;color:var(--ink-soft);"><span>Blunders semana passada</span><span>'+anterior+'</span></div>'+
    '<div class="progress-bar" style="margin-bottom:12px;"><div class="progress-fill" style="width:'+(anterior/maxBar*100)+'%;background:var(--ink-soft);"></div></div>'+
    (padrao
      ? '<p class="lede" style="margin:0;">Palavra mais mencionada no campo "padrão": <strong>"'+escapeHtml(padrao.palavra)+'"</strong> ('+padrao.count+'x) — vale revisar esse tema de propósito.</p>'
      : '<p class="lede" style="margin:0;">Ainda não há palavra repetida o suficiente no campo "padrão" pra destacar.</p>');
}

export function renderTacticsWidget(dow){
  var card = document.getElementById('tacticsWidgetCard');
  var body = document.getElementById('tacticsWidgetBody');
  if(dow===1){
    var idx = state.tacticsProgress.idx % TACTICS_THEMES.length;
    var t = TACTICS_THEMES[idx];
    card.style.display = 'block';
    body.innerHTML =
      '<p style="margin:0 0 6px;"><strong>'+escapeHtml(t.label)+'</strong> <span style="color:var(--ink-soft);font-family:var(--font-mono);font-size:12.5px;">— tema '+(idx+1)+' de '+TACTICS_THEMES.length+'</span></p>'+
      '<p class="lede" style="margin-bottom:12px;">'+escapeHtml(t.note)+' Faça um bloco de 15-20 puzzles desse tema.</p>'+
      '<div class="btn-row">'+
        '<a class="btn btn-primary btn-sm" style="text-decoration:none;" href="https://lichess.org/training/'+t.slug+'" target="_blank" rel="noopener">Praticar esse tema no Lichess</a>'+
        '<button class="btn btn-ghost btn-sm" id="advanceTacticsBtn">Já sinto confiança — próximo tema</button>'+
      '</div>';
    var btn = document.getElementById('advanceTacticsBtn');
    if(btn) btn.addEventListener('click', async function(){
      state.tacticsProgress.idx = (state.tacticsProgress.idx+1) % TACTICS_THEMES.length;
      await persist();
      showToast('Tema avançado — bom trabalho.');
      renderHoje();
    });
  } else if(dow===4){
    var covered = TACTICS_THEMES.slice(0, (state.tacticsProgress.idx % TACTICS_THEMES.length)+1);
    card.style.display = 'block';
    body.innerHTML =
      '<p class="lede" style="margin-bottom:10px;">Hoje é dia de misturar. Pratique um pouco de cada tema que você já viu até agora (não pule pra frente — só o que já foi coberto na segunda-feira):</p>'+
      '<div style="display:flex;flex-wrap:wrap;gap:6px;">'+
      covered.map(function(th){ return '<a href="https://lichess.org/training/'+th.slug+'" target="_blank" rel="noopener" style="text-decoration:none;"><span class="badge" style="background:var(--board-dark);">'+escapeHtml(th.label)+'</span></a>'; }).join('')+
      '</div>';
  } else {
    card.style.display = 'none';
  }
}

/* Soma ou desfaz o dia de hoje na sequencia, conforme o checklist. Retorna true se mudou. */
export function maybeUpdateStreak(){
  var algumMarcado = Object.values(getTodayChecklist()).some(Boolean);
  return atualizarStreakDoDia(state.streak, algumMarcado, todayStr());
}
