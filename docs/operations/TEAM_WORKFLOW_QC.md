# Processo de desenvolvimento, QC e produção — BSR Hub

**Versão do processo:** 1.0
**Equipe:** 1 proprietário, 2 desenvolvedores e 1 responsável por Quality Control (QC)

## 1. Objetivo

Este documento define como a equipe modifica, revisa, testa e publica o BSR Hub. A regra central é:

**Os desenvolvedores constroem. O QC verifica. O proprietário decide e autoriza a produção.**

Nenhuma pessoa além do proprietário pode autorizar uma publicação oficial. A aprovação técnica do QC não equivale a autorização de produção.

## 2. Papéis e responsabilidades

| Papel | Responsabilidades | Não deve fazer |
|---|---|---|
| Proprietário / Product Owner / Release Manager (@andradelqy) | Define prioridades e escopo; decide o que será aceito; aprova a integração em main; autoriza publicação; controla credenciais e acessos administrativos. | Delegar a decisão final de produção sem uma autorização explícita. |
| Desenvolvedor 1 (@Mards2407) | Implementa tarefas, corrige bugs, escreve/atualiza testes, documenta mudanças e abre Pull Requests. | Enviar código diretamente para main ou develop. |
| Desenvolvedor 2 (@Wesleyyfer74) | Mesmas responsabilidades do Desenvolvedor 1; pode revisar tecnicamente uma mudança quando solicitado. | Enviar código diretamente para main ou develop. |
| QC / Code Reviewer (@paulogleidson) | Revisa o diff, executa os testes, valida o comportamento, registra evidências e classifica problemas. Pode corrigir ajustes pequenos e de baixo risco. | Aprovar o próprio Pull Request ou publicar em produção. |

### Limites de autonomia do QC

- **Pode corrigir:** texto, rótulos, mensagens, pequenos ajustes visuais, validações simples e correções localizadas cujo comportamento esperado já esteja claro.
- **Deve devolver ao desenvolvedor:** mudanças de lógica de negócio, arquitetura, banco de dados, autenticação, permissões, pagamentos, integração Steam, segurança, migrações ou alterações com impacto amplo.
- **Deve escalar ao proprietário:** requisito ambíguo, mudança de escopo, risco de dados, impacto em produção, necessidade de credenciais ou decisão que altere o comportamento esperado do produto.
- Toda correção do QC deve estar registrada em um branch e em um Pull Request. Não se aceita correção informal sem histórico.

Se o QC for o autor de um Pull Request, outra pessoa deve revisar. Ninguém aprova o próprio trabalho.

## 3. Níveis de acesso

Conceder somente o acesso necessário:

| Pessoa | Papel recomendado no repositório |
|---|---|
| Proprietário | Admin |
| Desenvolvedor 1 | Write |
| Desenvolvedor 2 | Write |
| QC | Write |

Os três colaboradores não precisam ser administradores. Não conceder ao QC ou aos desenvolvedores acesso administrativo ao Netlify, Back4App, Steam ou aos segredos de produção.

A permissão Write permite trabalhar com branches e Pull Requests; ela não deve ser confundida com autorização para publicar. A restrição real de integração precisa ser configurada nas regras do repositório.

## 4. Branches e fluxo de código

Branches principais:

- **main:** código aprovado para a versão oficial. Só recebe uma entrega autorizada pelo proprietário.
- **develop:** integração das tarefas aprovadas pelo QC. É a base para homologação.
- **feature/nome-da-tarefa:** nova funcionalidade.
- **fix/nome-do-problema:** correção de bug.
- **docs/nome-do-assunto:** documentação.
- **hotfix/nome-do-problema:** correção urgente; ainda exige QC e autorização do proprietário antes da publicação.

Fluxo normal:

1. O desenvolvedor atualiza seu clone a partir de develop.
2. Cria um branch próprio a partir de develop.
3. Implementa uma única tarefa ou conjunto pequeno e coerente.
4. Executa os testes aplicáveis localmente.
5. Abre um Pull Request com destino a develop e preenche o modelo do repositório.
6. O QC revisa o código e testa os cenários relevantes.
7. Se houver ajuste pequeno, o QC registra a correção no próprio branch do Pull Request e testa novamente. Mudanças maiores voltam ao desenvolvedor.
8. Com a revisão aprovada e os testes verdes, o QC integra o Pull Request em develop.
9. A equipe valida a integração em homologação.
10. Quando houver uma entrega pronta, o QC abre um Pull Request de develop para main e anexa o relatório de validação.
11. O proprietário revisa a entrega, decide aprovar ou rejeitar e, se aprovada, faz a integração em main e autoriza a publicação.

Não trabalhar diretamente em main. Não usar force-push. Não apagar branches de outras pessoas sem verificar se o trabalho foi integrado.

## 5. Como o desenvolvedor começa uma tarefa

Antes de escrever código, deve existir uma Issue com objetivo, contexto, critérios de aceite e responsável.

Na máquina do desenvolvedor:

1. Clonar o repositório oficial uma única vez.
2. Instalar a versão de Node indicada pelo projeto e executar npm ci.
3. Criar o branch de trabalho a partir de develop.
4. Fazer commits pequenos e com mensagens claras.
5. Enviar somente o branch da tarefa para o GitHub.
6. Abrir Pull Request para develop.

Padrão sugerido para nomes de branch:

    feature/painel-de-campeonato
    fix/erro-central-esportiva
    docs/manual-do-staff
    refactor/servico-de-autenticacao

Não incluir config.js, .env, tokens, chaves privadas, dados pessoais ou dumps de produção nos commits.

## 6. Como o QC deve revisar

O QC deve avaliar a alteração, não apenas a descrição do desenvolvedor.

### Checklist obrigatório

- [ ] O código atende aos critérios de aceite da Issue.
- [ ] O diff contém apenas mudanças relacionadas à tarefa.
- [ ] A implementação não introduz erros de sintaxe ou de execução.
- [ ] Os testes automatizados aplicáveis passaram.
- [ ] O fluxo principal e os cenários de erro foram testados.
- [ ] Funcionalidades relacionadas não foram quebradas.
- [ ] Não foram adicionados segredos, credenciais ou dados privados.
- [ ] Mudanças de banco, autenticação, autorização ou integração externa foram destacadas.
- [ ] A documentação foi atualizada quando necessário.
- [ ] Evidências, limitações e riscos foram registrados no Pull Request.

### Classificação dos achados

- **Bloqueador:** risco de segurança, perda/corrupção de dados, autenticação quebrada, falha que impede uso ou publicação incorreta. Reprovar e avisar o proprietário imediatamente.
- **Alto:** funcionalidade principal incorreta ou regressão importante. Devolver ao desenvolvedor.
- **Médio:** comportamento incompleto ou cenário relevante não tratado. Devolver ao desenvolvedor, salvo ajuste muito localizado e autorizado.
- **Baixo:** texto, alinhamento, rótulo ou correção pequena e sem impacto de regra de negócio. QC pode corrigir, registrar e retestar.
- **Melhoria futura:** não bloqueia a entrega; registrar como Issue separada.

O QC não deve ampliar o escopo da tarefa por iniciativa própria. Melhorias não solicitadas viram Issues separadas.

## 7. Testes do projeto

A automação inicial deve executar no Windows os testes abaixo, sem precisar de credenciais de produção:

    npm ci
    npm run test:security
    npm run test:ratings
    npm run test:content
    npm run test:stewarding
    npm run test:telemetry

Estes comandos foram executados na cópia local durante a preparação deste processo e passaram em conjunto.

Testes adicionais devem ser executados quando a área for afetada:

- Interface Electron: npm run test:ratings-ui e npm run test:launcher.
- Ponte AcTools: npm run test:actools e, quando necessário, npm run build:actools.
- Pacote web: npm run build:web.
- Pacotes finais: npm run build:win e npm run stage:cloud.

A CI não deve receber Master Key, REST API Key, tokens Steam ou credenciais de produção. Testes que precisem de serviços externos devem usar contas e dados de homologação.

## 8. Homologação e produção

Manter ambientes separados:

| Ambiente | Uso | Dados |
|---|---|---|
| Desenvolvimento | Trabalho individual | Dados locais ou fictícios |
| Homologação / Staging | Testes integrados do QC e do proprietário | Projeto Back4App e integrações de teste, separados da produção |
| Produção | Operação real do BSR Hub | Dados reais; acesso restrito |

Antes de solicitar produção, o QC deve confirmar:
- versão e escopo da entrega;
- Pull Requests incluídos;
- resultado dos testes automatizados;
- resultado dos testes manuais;
- limitações e problemas conhecidos;
- plano de rollback ou recuperação;
- artefatos que serão publicados.

O proprietário é o único responsável por autorizar a publicação. A publicação deve ser registrada com data, versão, responsável e links dos Pull Requests.

## 9. Regras de segurança

1. Cada pessoa usa sua própria conta GitHub e autenticação em dois fatores.
2. Não compartilhar senhas, tokens ou sessões.
3. config.js, .env e arquivos com segredos ficam fora do Git.
4. Usar variáveis de ambiente/segredos próprios para homologação e produção.
5. Não copiar dados reais de pilotos para testes sem necessidade e autorização.
6. Não executar scripts desconhecidos com acesso a credenciais ou banco.
7. Não alterar regras de acesso, autenticação, banco ou integração Steam sem revisão reforçada.
8. Em caso de vazamento, revogar/rotacionar a credencial imediatamente e avisar o proprietário.

## 10. Como configurar as regras no GitHub

A configuração remota ainda depende da conta, plano e identificadores reais dos usuários. Não basta criar arquivos no projeto: as regras precisam ser ativadas nas configurações do repositório.

No repositório, abra **Settings → Rules → Rulesets** (ou Branches / Branch protection rules, conforme a interface disponível) e crie regras para develop e main.

### Regra de develop

- Aplicar ao branch develop.
- Exigir Pull Request antes de integrar.
- Exigir pelo menos 1 aprovação do QC.
- Descartar aprovações antigas quando novos commits alterarem o Pull Request.
- Exigir resolução das conversas.
- Criar um ruleset de restrição de atualização: somente QC e proprietário podem atualizar `develop`, ambos com bypass **For pull requests only**. Desenvolvedores continuam podendo enviar branches de tarefa.
- Em um ruleset separado, exigir Pull Request, 1 aprovação de Code Owner (QC), checks da automação e resolução de conversas. Não conceder bypass deste ruleset.
- Bloquear force-push e exclusão.
- Assim, o QC ou o proprietário pode integrar um PR aprovado; desenvolvedores não atualizam `develop` diretamente.

### Regra de main

- Criar um ruleset de restrição de atualização: somente o proprietário pode atualizar `main`, com bypass **For pull requests only**. Isso impede push direto e impede QC/desenvolvedores de integrar em main.
- Em outro ruleset, exigir Pull Request, 1 aprovação de Code Owner (QC), checks da automação e resolução de conversas. Não conceder bypass deste ruleset: a aprovação do QC e os checks continuam obrigatórios mesmo para o proprietário.
- Bloquear force-push e exclusão.
- O proprietário abre o PR de `develop` para `main`; o QC revisa e aprova como Code Owner; depois o proprietário decide se integra. QC não deve abrir o PR de release, pois não pode aprovar o próprio PR.

### Plano do GitHub

Proteção de branches e rulesets estão disponíveis no GitHub Free para repositórios públicos; para repositórios privados, é necessário GitHub Pro, Team ou Enterprise, conforme a modalidade. O repositório atual pertence a uma conta pessoal, então confirme no próprio GitHub quais opções de restrição e bypass estão disponíveis. **Não mantenha o código público apenas para obter proteção; prefira atualizar o plano se a privacidade for necessária.**

O QC oficial do BSR Hub é **@paulogleidson**. O arquivo `.github/CODEOWNERS` já foi criado com esse usuário como responsável pela revisão de todo o código. Depois que o arquivo chegar ao GitHub, habilite **Require review from Code Owners** nos rulesets de `develop` e `main`. O PR de release deve ser aberto pelo proprietário para que o QC possa aprovar a revisão técnica sem aprovar o próprio trabalho.

## 11. Rotina de trabalho

### Início do dia
- Cada desenvolvedor verifica Issues atribuídas e atualiza o status.
- O QC verifica Pull Requests abertos, prioriza bloqueadores e confirma quais entregas serão testadas.
- O proprietário define prioridades e esclarece dúvidas de produto.

### Durante o desenvolvimento
- Uma Issue deve ter um responsável principal.
- Informar bloqueios assim que aparecerem.
- Evitar dois desenvolvedores modificando o mesmo módulo sem combinar antes.
- Atualizar a Issue e o Pull Request com decisões importantes.

### Antes de encerrar uma tarefa
- Desenvolvedor informa o que mudou e como testou.
- QC registra aprovado/reprovado, evidências e pendências.
- Proprietário recebe somente entregas com relatório de QC completo.

## 12. Critérios de conclusão (Definition of Done)

Uma tarefa só está concluída quando:
1. Os critérios de aceite foram atendidos.
2. O código está em Pull Request e passou pela revisão.
3. Os testes aplicáveis passaram.
4. A homologação foi concluída quando necessária.
5. A documentação foi atualizada quando necessária.
6. O QC registrou o resultado.
7. O proprietário aprovou a inclusão na versão oficial, quando a tarefa fizer parte de um release.

**Aprovado pelo QC não significa publicado. Produção só acontece após decisão explícita do proprietário.**

## 13. Links oficiais úteis

- GitHub — Proteção de branches: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches
- GitHub — Regras disponíveis em rulesets: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- GitHub — Planos: https://github.com/pricing
- Documentação de CI do projeto: .github/workflows/quality-checks.yml
- Modelo de Pull Request: .github/PULL_REQUEST_TEMPLATE.md
- Modelo de relatório QC: docs/templates/QC_REPORT.md
