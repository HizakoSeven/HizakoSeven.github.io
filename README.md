# Caderno de Xadrez

App gratuito de estudo de xadrez que roda inteiro no navegador: caderno de erros, revisão espaçada, importação de PGN (Chess.com/Lichess), análise completa com Stockfish e gráfico de tempo × erro por lance.

**Use online:** https://hizakoseven.github.io/

## Seus dados
Tudo fica salvo **no seu próprio navegador** (IndexedDB). Nada é enviado a servidor nenhum. Use os botões "Salvar arquivo" / "Carregar arquivo" no topo para fazer backup ou levar seus dados para outro navegador/computador.

## Rodar localmente
Opção 1: qualquer servidor estático na pasta, ex. `python -m http.server 8000`, e abra `http://localhost:8000`. Os dados ficam no navegador (IndexedDB), como no site publicado; use "Baixar/Carregar" para backup.
Opção 2 (Windows, opcional): `iniciar.bat` + `server.ps1`, se você tiver esses arquivos localmente (não estão neste repositório). O app só entra no modo "salvar em `dados.json`" se o servidor responder em `/dados`; caso contrário usa o navegador.

## Estrutura
```
index.html   página única
js/          módulos ES
engine/      Stockfish (stockfish-18-lite-single.js + .wasm)
pieces/      SVGs das peças (wP.svg, bN.svg, ...)
```

## Créditos e licenças
- Motor: [Stockfish](https://stockfishchess.org/) — GPLv3 (código-fonte em https://github.com/official-stockfish/Stockfish).
