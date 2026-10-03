# Caderno de Xadrez

App gratuito de estudo de xadrez que roda inteiro no navegador: caderno de erros, revisão espaçada, importação de PGN (Chess.com/Lichess), análise completa com Stockfish e gráfico de tempo × erro por lance.

**Use online:** https://hizakoseven.github.io/

## Seus dados
Tudo fica salvo **no seu próprio navegador** (IndexedDB). Nada é enviado a servidor nenhum. Use os botões "Salvar arquivo" / "Carregar arquivo" no topo para fazer backup ou levar seus dados para outro navegador/computador.

## Rodar localmente
Opção 1 (Windows): `iniciar.bat` + `server.ps1` (versão original, salva em `dados.json`).
Opção 2: qualquer servidor estático na pasta, ex. `python -m http.server 8000` e abra `http://localhost:8000`.

## Estrutura
```
index.html   página única
js/          módulos ES
engine/      Stockfish (stockfish-18-lite-single.js + .wasm)
pieces/      SVGs das peças (wP.svg, bN.svg, ...)
```

## Créditos e licenças
- Motor: [Stockfish](https://stockfishchess.org/) — GPLv3 (código-fonte em https://github.com/official-stockfish/Stockfish).
- Regras de xadrez: [chess.js](https://github.com/jhlywa/chess.js) (BSD-2).
- Peças SVG: indique aqui o autor e a licença do conjunto que você usa.
- Código deste projeto: defina a licença que preferir (ex.: GPLv3, por conter o Stockfish).
