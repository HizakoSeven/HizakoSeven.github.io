/* Renderizacao do tabuleiro (casas, pecas, FEN -> HTML). */

export var FILES = ['a','b','c','d','e','f','g','h'];

export var PIECE_SHAPES = {
  p:'<circle class="pc-body" cx="22.5" cy="11" r="6.2"/><path class="pc-body" d="M17 19 Q22.5 15 28 19 L31 33 Q31 35 29 35 H16 Q14 35 14 33 Z"/><rect class="pc-body" x="12" y="35" width="21" height="5" rx="1.5"/>',
  r:'<path class="pc-body" d="M11 39 L12.5 34 L15 16 H12 V8 H16 V11 H19 V8 H26 V11 H29 V8 H33 V16 H30 L32.5 34 L34 39 Z"/>',
  b:'<circle class="pc-body" cx="22.5" cy="7" r="2.2"/><path class="pc-body" d="M22.5 11 L20.5 15 Q14 20 14 27 Q14 32 18 34 L14 38 L31 38 L27 34 Q31 32 31 27 Q31 20 24.5 15 Z"/><line class="pc-detail" x1="19" y1="24" x2="26" y2="24" stroke-width="1.8"/><rect class="pc-body" x="12.5" y="38" width="20" height="4.5" rx="1.3"/>',
  n:'<path class="pc-body" d="M12 39 L12.6 34.5 Q12.9 33 14 32 Q14.5 26 20 23 L16.5 21 Q15.5 18.5 16.8 16.5 Q19 17.5 20 19.5 L21.5 18.5 Q19.5 15.5 21 13 Q23.5 14 24.8 17 Q29 16.3 32 19 Q35 21.7 34.7 26.5 Q34.5 29.5 32 30.5 Q31 30.9 30.6 29.8 Q30.3 28.7 31.3 28.2 Q32.2 27.6 31.6 26.5 Q30.8 25.3 29.3 26.3 Q27.8 27.3 28.5 29.3 L30 32.5 Q31.1 33 31.4 34.5 L32 39 Z"/><circle class="pc-detail" cx="19.6" cy="20.3" r="1"/><rect class="pc-body" x="10.5" y="39" width="24" height="4" rx="1.3"/>',
  q:'<circle class="pc-body" cx="9.5" cy="10" r="2.3"/><circle class="pc-body" cx="18" cy="6.5" r="2.3"/><circle class="pc-body" cx="22.5" cy="5" r="2.5"/><circle class="pc-body" cx="27" cy="6.5" r="2.3"/><circle class="pc-body" cx="35.5" cy="10" r="2.3"/><path class="pc-body" d="M9.5 12 L11.5 25 Q11 27 13 27 H32 Q34 27 33.5 25 L35.5 12 L27 9 L24 16 L22.5 8.5 L21 16 L18 9 Z"/><path class="pc-body" d="M13.5 28 Q22.5 31 31.5 28 L33 33 Q22.5 36.5 12 33 Z"/><rect class="pc-body" x="12" y="36" width="21" height="4.5" rx="1.3"/>',
  k:'<line class="pc-detail" x1="22.5" y1="2.5" x2="22.5" y2="10" stroke-width="1.8"/><line class="pc-detail" x1="19" y1="6" x2="26" y2="6" stroke-width="1.8"/><path class="pc-body" d="M14 14 Q14 10.5 17.5 10.5 Q19.5 10.5 20.5 12 Q21.5 10 22.5 10 Q23.5 10 24.5 12 Q25.5 10.5 27.5 10.5 Q31 10.5 31 14 L33 26 Q33.5 28 31.5 28 H13.5 Q11.5 28 12 26 Z"/><path class="pc-body" d="M13 29 Q22.5 32.5 32 29 L33.5 34 Q22.5 37.5 11.5 34 Z"/><rect class="pc-body" x="11.5" y="37" width="22" height="4.5" rx="1.3"/>'
};

export function fenToBoard(fen){
  var placement = fen.split(' ')[0];
  var rows = placement.split('/');
  var board = {};
  rows.forEach(function(row, rIdx){
    var rank = 8-rIdx;
    var file = 0;
    for(var i=0;i<row.length;i++){
      var ch = row[i];
      if(/\d/.test(ch)){
        file += parseInt(ch,10);
      } else {
        var color = ch===ch.toUpperCase() ? 'w' : 'b';
        var type = ch.toLowerCase();
        board[FILES[file]+rank] = { type:type, color:color };
        file += 1;
      }
    }
  });
  return board;
}

/* Os gradientes das pecas de reserva (fallback em SVG) ficam num unico <defs> escondido na pagina, criado uma vez.
   Antes cada peca repetia os mesmos ids (gw/gb) e o fill:url(#gw) dependia do primeiro da pagina. Fica com tamanho 0
   (e nao display:none, que faria o gradiente nao renderizar). */
function garantirGradientesPecas(){
  if(document.getElementById('pieceGradDefs')) return;
  var holder = document.createElement('div');
  holder.innerHTML = '<svg id="pieceGradDefs" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden;" aria-hidden="true" focusable="false"><defs>'+
    '<linearGradient id="gw" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#FFFFFF"/><stop offset="60%" stop-color="#F7F7F2"/><stop offset="100%" stop-color="#E2E2D8"/></linearGradient>'+
    '<linearGradient id="gb" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#4a4a4a"/><stop offset="55%" stop-color="#262626"/><stop offset="100%" stop-color="#121212"/></linearGradient>'+
    '</defs></svg>';
  document.body.appendChild(holder.firstChild);
}

window.handlePieceImgError = function(imgEl, type, color){
  try{
    garantirGradientesPecas();
    var svgHtml = '<svg class="piece-icon piece-'+color+'" viewBox="0 0 45 45">'+PIECE_SHAPES[type]+'</svg>';
    imgEl.outerHTML = svgHtml;
  }catch(e){ /* se ate isso falhar, so deixa o alt-text do img aparecer */ }
};

export function boardSquaresHTML(fen, lastMove, flipped, extraClasses){
  extraClasses = extraClasses || {};
  var board = fenToBoard(fen);
  var ranks = flipped ? [1,2,3,4,5,6,7,8] : [8,7,6,5,4,3,2,1];
  var files = flipped ? FILES.slice().reverse() : FILES;
  var html = '';
  ranks.forEach(function(rank, rIdx){
    files.forEach(function(file, fIdx){
      var sqName = file+rank;
      var fileIdx = FILES.indexOf(file);
      var isLight = (fileIdx+rank)%2===0;
      var piece = board[sqName];
      var hl = lastMove && (lastMove.from===sqName || lastMove.to===sqName);
      var pieceHtml = '';
      if(piece){
        var pieceFileMap = {p:'P',n:'N',b:'B',r:'R',q:'Q',k:'K'};
        var pieceUrl = 'pieces/' + (piece.color==='w'?'w':'b') + pieceFileMap[piece.type] + '.svg';
        pieceHtml = '<img class="piece-icon" src="'+pieceUrl+'" alt="'+piece.type+'" '+
          'onerror="window.handlePieceImgError(this,\''+piece.type+'\',\''+piece.color+'\')">';
      }
      var coordColor = isLight ? 'var(--sq-dark)' : 'var(--sq-light)';
      var coordHtml = '';
      if(rIdx===7){ coordHtml += '<span class="coord coord-file" style="color:'+coordColor+';">'+file+'</span>'; }
      if(fIdx===0){ coordHtml += '<span class="coord coord-rank" style="color:'+coordColor+';">'+rank+'</span>'; }
      var extra = extraClasses[sqName] ? ' '+extraClasses[sqName] : '';
      var pieceMarker = piece ? ' has-piece' : '';
      html += '<div class="sq '+(isLight?'light':'dark')+(hl?' hl':'')+extra+pieceMarker+'" data-sq="'+sqName+'">'+pieceHtml+coordHtml+'</div>';
    });
  });
  return html;
}

/* Setas (SVG) sobre o tabuleiro. `setas` = [{from:'e2', to:'e4', cor:'#3f8f4a'}].
   O SVG usa um viewBox 800x800 (cada casa = 100x100) e respeita o tabuleiro invertido. */
export function setasSVG(setas, flipped){
  setas = (setas||[]).filter(Boolean);
  if(!setas.length) return '';
  function centro(sq){
    var f = FILES.indexOf(sq.charAt(0));
    var r = parseInt(sq.charAt(1), 10);
    return { x:(flipped ? 7-f : f)*100+50, y:(flipped ? r-1 : 8-r)*100+50 };
  }
  var corpo = setas.map(function(s){
    var a = centro(s.from), t = centro(s.to);
    var dx = t.x-a.x, dy = t.y-a.y;
    var len = Math.sqrt(dx*dx+dy*dy);
    if(!len) return '';
    var ux = dx/len, uy = dy/len, px = -uy, py = ux;
    var ponta = { x:t.x-ux*8, y:t.y-uy*8 };
    var cabeca = 38, larg = 24;
    var base = { x:ponta.x-ux*cabeca, y:ponta.y-uy*cabeca };
    var ini = { x:a.x+ux*20, y:a.y+uy*20 };
    return '<g fill="'+s.cor+'" stroke="'+s.cor+'">'+
      '<line x1="'+ini.x.toFixed(1)+'" y1="'+ini.y.toFixed(1)+'" x2="'+base.x.toFixed(1)+'" y2="'+base.y.toFixed(1)+'" stroke-width="16"/>'+
      '<polygon stroke="none" points="'+ponta.x.toFixed(1)+','+ponta.y.toFixed(1)+' '+
        (base.x+px*larg).toFixed(1)+','+(base.y+py*larg).toFixed(1)+' '+
        (base.x-px*larg).toFixed(1)+','+(base.y-py*larg).toFixed(1)+'"/>'+
    '</g>';
  }).join('');
  return '<svg class="board-setas" viewBox="0 0 800 800" aria-hidden="true"><g opacity="0.82">'+corpo+'</g></svg>';
}
