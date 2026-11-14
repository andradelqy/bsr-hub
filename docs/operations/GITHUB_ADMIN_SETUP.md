# GitHub do BSR Hub — estado e configuração administrativa

**Repositório:** https://github.com/andradelqy/bsr-hub
**Proprietário:** @andradelqy
**Desenvolvedores:** @Mards2407 e @Wesleyyfer74
**QC / Code Owner:** @paulogleidson

## 1. Estado verificado em 14/11/2026

| Item | Estado |
|---|---|
| Visibilidade | Público |
| Branch padrão | main |
| Branches main e develop | No commit c16d4ebb00abd0ff9937bd645fa3b10673e8d260 |
| Rulesets ativos | Nenhum |
| Proteção de main | Não ativa |
| Proteção de develop | Não ativa |
| CODEOWNERS | Arquivo presente para @paulogleidson |
| CI | Workflow com job Automated tests |

A conta conectada tem permissão administrativa no repositório. A consulta atual confirma que as duas branches ainda estão desprotegidas. A situação precisa ser conferida novamente depois de criar as regras.

## 2. Acesso da equipe

As permissões consultadas em 14/11/2026 foram: **Mards2407 — Write**, **Wesleyyfer74 — Read** e **paulogleidson — Write**. O acesso Read de Wesleyyfer74 não permite enviar branches; se ele também for desenvolver código, o proprietário precisa alterar sua permissão para Write em **Settings → Collaborators**.

O CODEOWNERS registra paulogleidson como responsável pela revisão técnica. Essa exigência só passa a bloquear integrações quando a regra de revisão de Code Owner estiver ativa no ruleset.

## 3. Regras recomendadas para main e develop

Crie um ruleset de qualidade para cada branch em **Settings → Rules → Rulesets**. A configuração deve ser aplicada a `refs/heads/develop` e `refs/heads/main`, com enforcement **Active**.

Em cada ruleset, habilite:

- Exigir Pull Request antes de integrar.
- Exigir pelo menos 1 aprovação.
- Exigir aprovação de Code Owner.
- Descartar aprovações antigas quando novos commits forem enviados.
- Exigir aprovação de alguém diferente de quem fez o último push.
- Exigir resolução das conversas de revisão.
- Exigir o status check **Automated tests**.
- Exigir que a branch esteja atualizada com o destino.
- Bloquear force push e exclusão da branch.
- Não configurar bypass permanente para colaboradores.

O arquivo `.github/CODEOWNERS` define @paulogleidson como responsável pela revisão técnica. O workflow `.github/workflows/quality-checks.yml` publica o check **Automated tests**; mantenha esse nome sincronizado com os rulesets.

### Fluxo de trabalho esperado

1. Cada desenvolvedor cria uma branch de tarefa a partir de develop.
2. Abre Pull Request para develop e descreve as alterações e os testes.
3. O QC revisa o diff e aprova como Code Owner.
4. A CI precisa passar e todas as conversas devem estar resolvidas.
5. O proprietário acompanha a integração em develop.
6. Quando a versão estiver pronta, abre-se um Pull Request de develop para main.

A política escrita não substitui a proteção técnica: enquanto os rulesets não estiverem ativos, o GitHub ainda permite atualizações diretas conforme as permissões dos colaboradores.

## 4. CI e segurança

O workflow roda no Windows com Node 24. O job obrigatório chama-se **Automated tests** e executa os testes de segurança, ratings, conteúdo, telemetria, além das verificações de sintaxe.

A CI não precisa de Master Key, REST API Key, senha Back4App ou credenciais Steam. O arquivo `site/config.js` é local e ignorado pelo Git; o runner usa `site/config.example.js` como referência segura. Nunca coloque credenciais administrativas no site ou no launcher.

## 5. Verificação depois de configurar

Depois de ativar os rulesets, volte a **Settings → Rules → Rulesets** e confirme que os dois aparecem como **Active**. Em seguida, consulte as branches main e develop e confirme que a proteção está aplicada. Faça um Pull Request de teste para verificar se o check **Automated tests** e a revisão de Code Owner são exigidos.\n\n