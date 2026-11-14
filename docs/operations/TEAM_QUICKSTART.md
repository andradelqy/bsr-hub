# BSR Hub — passo a passo da equipe

Este documento é o roteiro operacional para os dois desenvolvedores, o QC e o proprietário. Leia-o antes de abrir o primeiro Pull Request.

## 1. Quem faz o quê

| Integrante | Conta GitHub | Responsabilidade |
|---|---|---|
| Proprietário / Release Manager | andradelqy | Prioridade, acesso administrativo, aprovação de release e produção. |
| Desenvolvedor 1 | Mards2407 | Implementação, correções, testes e Pull Requests. |
| Desenvolvedor 2 | Wesleyyfer74 | Implementação, correções, testes e Pull Requests. |
| QC / Code Reviewer | paulogleidson | Revisão técnica, testes, relatório QC e integração em develop. |

O proprietário continua sendo o único responsável pela publicação oficial. A aprovação do QC não significa autorização para produção.

## 2. Antes de começar

Cada integrante precisa:
- Ter sua própria conta GitHub e autenticação em dois fatores.
- Receber acesso ao repositório BSR Hub.
- Instalar Git, Node.js 24 e um editor (por exemplo, VS Code).
- Ter acesso às configurações locais necessárias para executar o projeto.
- Não compartilhar credenciais, arquivos site/config.js ou tokens.

Repositório: https://github.com/andradelqy/bsr-hub

O proprietário deve fornecer as configurações de desenvolvimento por um canal seguro. Não use a configuração de produção sem autorização.

## 3. Preparar a máquina pela primeira vez

Abra PowerShell e execute:

    git clone --recurse-submodules https://github.com/andradelqy/bsr-hub.git
    cd bsr-hub
    Copy-Item site/config.example.js site/config.js
    npm ci

Depois:
1. Abra site/config.js e preencha os valores de cliente Back4App fornecidos para desenvolvimento.
2. Nunca coloque Master Key ou REST API Key nesse arquivo.
3. Para desenvolvimento da integração nativa, execute npm run build:actools.
4. Inicie o launcher com npm start.

Se o integrante trabalhar somente em partes web que não dependam do Electron, ainda deve respeitar o fluxo de branches e os testes aplicáveis.

## 4. Começar uma tarefa

Toda tarefa deve ter uma Issue ou instrução aprovada com:
- O problema ou objetivo.
- O comportamento esperado.
- Critérios objetivos de aceite.
- Áreas do sistema que podem ser afetadas.
- Responsável principal.

Atualize seu clone e crie um branch próprio a partir de develop:

    git switch develop
    git pull --ff-only origin develop
    git switch -c feature/nome-da-tarefa

Exemplos:
- feature/filtro-de-campeonato
- fix/reserva-de-carro
- docs/manual-do-piloto
- refactor/cliente-parse

Para correção de problema, use fix/; para documentação, docs/; para funcionalidade, feature/. Não faça trabalho diretamente em main ou develop.

## 5. Durante o desenvolvimento

1. Procure primeiro o módulo responsável no [Guia do código](../architecture/CODEBASE_GUIDE.md).
2. Leia os testes relacionados antes de alterar uma regra.
3. Faça mudanças pequenas e relacionadas à Issue.
4. Não remova código ou documentos sem entender se ainda são usados.
5. Não inclua node_modules, dist, web-dist, site/config.js, .env, cache, dados reais ou binários gerados.
6. Faça commits curtos e descritivos.

Exemplo:

    git status
    git diff
    git add site/app/views.js tests/ratings-ui.cjs
    git commit -m "feat: adiciona filtro de campeonato"

Antes de enviar, execute os testes aplicáveis. Para uma revisão ampla, rode:

    npm run test:security
    npm run test:ratings
    npm run test:content
    npm run test:stewarding
    npm run test:telemetry
    npm run test:actools
    npm run test:production

Envie somente sua branch:

    git push -u origin feature/nome-da-tarefa

## 6. Abrir Pull Request

No GitHub:
1. Abra Pull requests → New pull request.
2. Escolha sua branch como origem (compare).
3. Escolha develop como destino (base).
4. Preencha o modelo que aparece automaticamente.
5. Vincule a Issue.
6. Descreva o que mudou, como testar, riscos, arquivos sensíveis e plano de reversão.
7. Solicite revisão do QC.

Não abra PR diretamente para main. Não marque como pronto se os testes ainda estiverem rodando ou houver risco conhecido sem explicação.

## 7. O que o QC faz

O QC deve:
1. Confirmar que o PR tem Issue, escopo e critérios de aceite.
2. Ler o diff completo, inclusive exclusões e arquivos novos.
3. Conferir se não há site/config.js, .env, credenciais, dados reais ou arquivos gerados.
4. Rodar a CI e os testes locais adequados.
5. Testar o comportamento principal e os cenários de erro/regressão.
6. Revisar autorização, validação e impacto no banco quando houver Cloud Code.
7. Registrar achados por severidade: Bloqueador, Alto, Médio, Baixo ou Melhoria futura.
8. Preencher docs/templates/QC_REPORT.md ou registrar os mesmos dados no PR.
9. Aprovar somente quando os critérios forem satisfeitos.

Se reprovar, escolha Request changes e diga exatamente o que precisa mudar, em qual arquivo e como reproduzir. O desenvolvedor atualiza o mesmo branch; o PR recebe os novos commits automaticamente.

Correção pequena pelo QC:
- Só corrigir quando o escopo e resultado esperado forem claros.
- Fazer commit no branch do PR, nunca em main/develop.
- Explicar a correção no PR e repetir os testes.
- Se o PR não permitir edição por mantenedores, pedir ao desenvolvedor que aplique a correção.

Mudanças de arquitetura, autenticação, autorização, banco, rating ou segurança voltam ao desenvolvedor e/ou são escaladas ao proprietário. O QC não aprova o próprio PR.

## 8. Como uma tarefa chega a develop

Quando todos os checks passarem e o QC aprovar:
- O QC integra o PR em develop, conforme a regra de proteção do GitHub.
- A equipe testa a integração em homologação.
- O QC registra a versão, os cenários, o resultado e os riscos conhecidos.
- Problemas encontrados após a integração viram Issues/PRs de correção; não se corrige diretamente develop.

## 9. Como preparar uma versão para produção

Quando houver um conjunto de mudanças pronto:
1. O QC verifica os PRs que entraram em develop.
2. O QC executa testes de regressão e validação funcional.
3. O QC prepara um relatório com versão, escopo, PRs, testes, evidências, riscos e rollback.
4. O proprietário abre um PR de develop para main.
5. O QC revisa o PR de release como Code Owner.
6. O proprietário lê o relatório e o diff e decide aprovar ou rejeitar.
7. Somente o proprietário integra em main e autoriza a publicação.

A proteção deve impedir que desenvolvedores ou QC façam push direto em main. A proteção deve também impedir que a aprovação do QC seja confundida com autorização de release.

## 10. Publicação: o que cada comando faz

| Comando | Resultado | Quem deve executar |
|---|---|---|
| npm start | Abre o launcher local para desenvolvimento. | Desenvolvedores/QC. |
| npm run test:security | Testes de autenticação, sessão e callback Steam. | Desenvolvedores/QC. |
| npm run test:ratings | Testes de rating, processamento, política e publicação. | Desenvolvedores/QC. |
| npm run test:content | Testes de segurança e ciclo de vida do conteúdo. | Desenvolvedores/QC. |
| npm run test:stewarding | Testes do formulário/relatórios de direção de prova. | Desenvolvedores/QC. |
| npm run test:telemetry | Testes de protocolo, incidentes e upload. | Desenvolvedores/QC. |
| npm run test:actools | Testes IPC e integração do bridge; exige o binário de teste disponível. | Desenvolvedores/QC. |
| npm run test:production | Smoke tests do comportamento integrado do backend. | QC, antes de release. |
| npm run build:web | Valida configuração cliente e gera web-dist para o site. | Proprietário/Release Manager após QC. |
| npm run stage:cloud | Copia Cloud Code para deploy/cloud-code/current. Não publica sozinho. | Proprietário/Release Manager. |
| npm run build:actools | Compila a ponte nativa. | Desenvolvedor responsável pela integração nativa. |
| npm run build:win | Gera instalador Windows em dist/desktop. | Proprietário/Release Manager. |

Os artefatos preparados precisam ser conferidos. Site, Cloud Code e instalador são componentes distintos: publicar um não atualiza automaticamente os outros.

## 11. Regras de segurança que não podem ser ignoradas

- Não versionar site/config.js ou .env.
- Não incluir Master Key, REST API Key, chave Steam ou senhas em código distribuído.
- Não compartilhar tokens no Discord, Issues, Pull Requests ou chat.
- Não testar com dados reais de pilotos sem necessidade/autorização.
- Não alterar CLPs, roles, funções, sessões ou credenciais sem revisão reforçada.
- Não enviar replay, log ou dump contendo dados pessoais sem verificar escopo e necessidade.
- Não desativar uma validação de segurança apenas para fazer um teste passar.
- Se uma chave vazar, avisar o proprietário e revogar/rotacionar imediatamente.

## 12. Regras GitHub que o proprietário deve ativar

Os arquivos locais não ativam proteção sozinhos. Em Settings → Rules → Rulesets, crie regras separadas para develop e main. O repositório atual é público; depois de criar as regras, confirme que os rulesets de main e develop aparecem como Active.

**develop**
- Pull Request obrigatório.
- Uma aprovação de Code Owner (QC).
- Checks da workflow BSR Hub Quality Checks obrigatórios.
- Conversas resolvidas.
- Rejeitar force push e exclusão.
- Restringir atualização para QC/proprietário; desenvolvedores enviam branches de tarefa e PRs.

**main**
- Pull Request obrigatório.
- Aprovação do QC como Code Owner.
- Checks da workflow obrigatórios.
- Conversas resolvidas.
- Rejeitar force push e exclusão.
- Restrição de atualização para o proprietário.
- Não permitir que bypass dispense a revisão técnica do QC.

O arquivo .github/CODEOWNERS marca o QC como responsável pela revisão de código. Ruleset e branch protection são configurações remotas: confirme no GitHub que estão ativos e em modo Active/Enforced.

## 13. Links e leitura obrigatória

1. [Guia do código](../architecture/CODEBASE_GUIDE.md) — onde cada parte funciona e por onde investigar.
2. [Processo de desenvolvimento, QC e produção](TEAM_WORKFLOW_QC.md) — papéis e política.
3. [Modelo de Pull Request](../../.github/PULL_REQUEST_TEMPLATE.md).
4. [Modelo de relatório QC](../templates/QC_REPORT.md).
5. [Índice técnico](../README.md).

Regra final: **desenvolvedores constroem; QC revisa e valida; proprietário decide e autoriza a produção.**
