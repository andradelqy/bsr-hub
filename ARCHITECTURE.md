# BSR Hub — arquitetura atual

O aplicativo principal é uma SPA com navegação horizontal no topo. As sete páginas antigas e os treze scripts/estilos obsoletos foram removidos. O painel administrativo ativo, autenticação Steam, cliente Back4App e imagens compartilhadas continuam necessários.

O início usa uma composição de launcher: imagem de corrida ocupando o fundo, título e ação principal à esquerda, atividade semanal, estatísticas e campeonatos na base. Os cartões são derivados dos dados reais; visitantes veem ações para conectar a conta e explorar o calendário.

O empacotamento usa uma lista explícita de arquivos de runtime, evitando incluir documentação, Cloud Code e arquivos de desenvolvimento. O executável Windows é gerado sem assinatura digital.

## Camadas

- `index.html`: shell do aplicativo e pontos de montagem.
- `app/core.js`: estado compartilhado, cache, normalização e acesso aos dados.
- `app/components.js`: navegação, cards, drawers, modais, busca e notificações.
- `app/views.js`: dashboard, corridas, campeonatos, classificação, carreira, direção de prova e sistema.
- `app/app.js`: inicialização, roteamento, sincronização e integração com Electron.
- `app/app.css`: design system responsivo completo.
- `api.js`: cliente único do Parse/Back4App e gerenciamento de sessão.
- `cloud/main.js`: autoridade de autenticação e operações protegidas.
- `cloud/rating-engine.js`: motor determinístico BSR Rating v2, Safety, confiabilidade, licenças e pontos.

## Fluxo de dados

```text
Back4App / Cloud Code
        ↓
      api.js
        ↓
  estado + cache (core.js)
        ↓
 views e componentes
```

Nenhuma view acessa `config.js` ou monta headers do Parse diretamente. Escritas sensíveis usam Cloud Functions.

O acesso antecipado usa `HubAccessPolicy` e `HubAccessGrant`. Antes do bootstrap, o launcher consulta `getHubAccessStatus`; o Cloud Code reaplica a mesma política nas consultas e operações públicas relevantes. Contas da role `admin` sempre permanecem liberadas.

Resultados oficiais seguem um fluxo versionado: o cliente interpreta os arquivos, o administrador revisa a classificação e o Cloud Code recalcula todas as métricas. `RaceResult` é a fonte recuperável do estado publicado e `RatingLedger` registra cada alteração de forma imutável. Os campos legados `irating` e `safetyRating` continuam sendo atualizados como projeções compatíveis para as telas e integrações existentes.

## Rotas

- `#/dashboard`
- `#/races`
- `#/championships`
- `#/standings`
- `#/career`
- `#/stewarding`
- `#/settings`

## Publicação

Antes de produção, siga `BACK4APP_SETUP.md`, publique o Cloud Code e aplique as CLPs. O frontend pode ser hospedado como site estático e também é carregado pelo Electron.
