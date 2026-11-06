# GitHub do BSR Hub — estado e configuração administrativa

**Repositório:** https://github.com/andradelqy/bsr-hub
**Proprietário:** @andradelqy
**Desenvolvedores:** @Mards2407 e @Wesleyyfer74
**QC:** @paulogleidson

## 1. Estado confirmado em 06/11/2026

| Item | Estado |
|---|---|
| Visibilidade do repositório | Privado |
| Forks públicos antes da mudança | Nenhum |
| Branch padrão | main |
| Branches main e develop | Atualizadas para o commit inicial 1.6.22 |
| Convite Mards2407 | Write — enviado, aguarda aceite |
| Convite Wesleyyfer74 | Write — enviado, aguarda aceite |
| Convite paulogleidson | Write — enviado, aguarda aceite |
| CODEOWNERS | Criado para @paulogleidson |
| GitHub Actions | Workflow criado e executado |
| Proteção de main/develop | Ainda não ativa: GitHub Free não oferece branch protection/rulesets para repositórios privados |

O primeiro commit de importação do código local para main foi feito com autorização expressa do proprietário. Esse foi um bootstrap inicial. O processo normal, daqui em diante, deve usar Pull Requests.

## 2. O que cada integrante deve fazer agora

Cada colaborador precisa aceitar o convite de acesso enviado pelo GitHub. O convite aparece em Notifications e também é enviado ao e-mail associado à conta.

Depois de aceitar, o proprietário deve conferir em **Settings → Collaborators** que os três aparecem com a permissão Write. Até o aceite, a API do GitHub mostra os convites como pendentes e não como colaboradores ativos.

## 3. Por que ainda não há proteção de branches

O repositório foi tornado privado, conforme decisão do proprietário. A API oficial do GitHub retornou:

> Upgrade to GitHub Pro or make this repository public to enable this feature.

A mensagem apareceu nas consultas de branch protection e repository rulesets. Portanto, não é falta de permissão do token conectado: é uma limitação do plano atual para este repositório privado.

**Não tornar o repositório público para contornar a limitação.** A escolha aprovada é manter o código privado. Para aplicar regras obrigatórias, o proprietário precisa contratar/ativar GitHub Pro na conta pessoal ou migrar o repositório para um plano/organização que ofereça as regras para repositórios privados.

Sem proteção de branch, Write permite que um colaborador envie commits diretamente para branches do repositório. CODEOWNERS e GitHub Actions, isoladamente, não bloqueiam esse envio nem obrigam a revisão. Não trate a política escrita como uma barreira técnica enquanto os Rulesets não estiverem ativos.

## 4. Configuração recomendada depois de ativar GitHub Pro

Abra **Settings → Rules → Rulesets**. Crie quatro rulesets ativos, dois para cada branch. Separar as regras de atualização das regras de qualidade evita que a permissão de integração permita contornar os testes ou a revisão.

### A. BSR - develop - Update gate

- Target: Branch.
- Include: **refs/heads/develop**.
- Regra: **Restrict updates**.
- Bypass actors: @paulogleidson e @andradelqy.
- Bypass mode: **For pull requests only**.
- Não conceder bypass permanente (Always).

Resultado: desenvolvedores podem enviar suas próprias branches e abrir PRs, mas só QC/proprietário conseguem integrar mudanças em develop, e somente pela via de Pull Request.

### B. BSR - develop - Quality

- Target: Branch.
- Include: **refs/heads/develop**.
- Regra: exigir Pull Request.
- Aprovações obrigatórias: 1.
- Exigir aprovação de Code Owner.
- Descartar aprovações antigas quando novos commits forem enviados.
- Exigir aprovação de alguém diferente de quem fez o último push.
- Exigir resolução de todas as conversas de revisão.
- Exigir o status check **Automated tests**.
- Exigir que a branch esteja atualizada com o destino antes da integração.
- Permitir Squash ou Rebase.
- Bloquear force push e exclusão.
- Não adicionar bypass actors neste ruleset.

Resultado: o QC (Code Owner) precisa validar tecnicamente o PR; a CI também precisa passar.

### C. BSR - main - Update gate

- Target: Branch.
- Include: **refs/heads/main**.
- Regra: **Restrict updates**.
- Bypass actor: somente @andradelqy.
- Bypass mode: **For pull requests only**.
- Não conceder bypass permanente.

Resultado: somente o proprietário consegue integrar uma versão em main, sempre por Pull Request. Desenvolvedores e QC não podem atualizar main.

### D. BSR - main - Quality

- Target: Branch.
- Include: **refs/heads/main**.
- Exigir Pull Request.
- Exigir 1 aprovação de Code Owner.
- Descartar aprovação antiga quando houver novos commits.
- Exigir aprovação de alguém diferente de quem fez o último push.
- Exigir resolução das conversas.
- Exigir o status check **Automated tests**, com branch atualizada.
- Permitir Squash ou Rebase.
- Bloquear force push e exclusão.
- Não adicionar bypass actors neste ruleset.

Resultado: o proprietário abre o PR de develop para main; o QC revisa como Code Owner; o proprietário toma a decisão e integra. Mesmo o proprietário continua sujeito às exigências de qualidade.

## 5. Como CODEOWNERS e CI se encaixam

O arquivo .github/CODEOWNERS registra @paulogleidson como revisor de código responsável. Nos rulesets de qualidade, habilite **Require review from Code Owners**.

A workflow .github/workflows/quality-checks.yml roda no Windows com Node 24 e executa o job chamado **Automated tests**. Esse é o nome exato do status check que deve ser selecionado nas regras.

O workflow executa:
- npm ci
- npm run test:security
- npm run test:ratings
- npm run test:content
- npm run test:stewarding
- npm run test:telemetry
- verificações de sintaxe JavaScript

A CI não recebe Master Key, REST API Key, senha Back4App ou credenciais Steam. O job tem contents: read.

### Atenção à configuração local

config.js é ignorado pelo Git e não deve ser enviado ao repositório. O teste de segurança usa o arquivo local quando existe e recorre a config.example.js no runner limpo do GitHub Actions. O exemplo contém apenas placeholders.

O build do site também espera config.js. Antes de ativar um deploy automático do Netlify, configure variáveis próprias no ambiente de build para gerar essa configuração de cliente; não coloque segredos de servidor no frontend.

## 6. Rotina diária depois da proteção

**Desenvolvedor**
1. Atualiza develop.
2. Cria feature/... ou fix/....
3. Faz alterações e executa os testes aplicáveis.
4. Envia somente sua branch.
5. Abre PR para develop, descreve testes e pede revisão ao QC.

**QC**
1. Confere Issue, escopo e diff.
2. Espera os checks.
3. Testa comportamento e regressões.
4. Aprova ou pede alterações.
5. Integra PR aprovado em develop.
6. Prepara o relatório QC e, quando a entrega estiver pronta, informa o proprietário.

**Proprietário**
1. Define prioridades.
2. Revisa a entrega validada.
3. Abre PR de develop para main.
4. Aguarda a revisão técnica do QC e checks verdes.
5. Decide se integra em main e autoriza a publicação.

## 7. Verificação final depois de configurar

- [ ] Repositório permanece privado.
- [ ] Três convites foram aceitos e aparecem como Write.
- [ ] develop tem os dois rulesets ativos.
- [ ] main tem os dois rulesets ativos.
- [ ] CODEOWNERS é exigido nos dois branches.
- [ ] Automated tests é status check obrigatório.
- [ ] Teste de PR para develop é aprovado/reprovado conforme checks e QC.
- [ ] Desenvolvedor não consegue integrar PR em develop.
- [ ] QC consegue integrar PR aprovado em develop.
- [ ] QC não consegue integrar PR em main.
- [ ] Proprietário consegue integrar PR em main somente depois da revisão do QC e CI verde.
- [ ] Push direto e force push são bloqueados.

## 8. Links do repositório

- [Settings](https://github.com/andradelqy/bsr-hub/settings)
- [Collaborators](https://github.com/andradelqy/bsr-hub/settings/access)
- [Rulesets](https://github.com/andradelqy/bsr-hub/settings/rules)
- [Actions](https://github.com/andradelqy/bsr-hub/actions)
- [Guia do código](../architecture/CODEBASE_GUIDE.md)
- [Passo a passo da equipe](TEAM_QUICKSTART.md)
- [Processo de desenvolvimento, QC e produção](TEAM_WORKFLOW_QC.md)

**Regra de operação:** desenvolvedores criam; QC valida; proprietário autoriza a produção. Essa regra só fica tecnicamente obrigatória quando os rulesets estiverem ativos no plano compatível.
