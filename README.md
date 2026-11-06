# BSR Racing Hub

**Versão atual do aplicativo:** 1.6.23

Repositório de desenvolvimento do BSR Racing Hub, plataforma da Brasil Sim Racing. O projeto reúne o launcher Electron, a interface web, o Cloud Code do Back4App, o motor de ratings, o processador de resultados, a telemetria e a ponte nativa baseada em AcTools.

Para uma visão completa da arquitetura, dos módulos, do processo de contribuição e da publicação, consulte o [Manual Técnico e Operacional](docs/BSR_HUB_MANUAL_TECNICO_E_OPERACIONAL.pdf).

## Preparação local

```powershell
git clone --recurse-submodules https://github.com/andradelqy/bsr-hub.git
cd bsr-hub
Copy-Item config.example.js config.js
npm ci
npm run build:actools
npm start
```

Preencha `config.js` localmente com os identificadores e as chaves de cliente do ambiente de desenvolvimento, conforme `config.example.js`. Esse arquivo é ignorado pelo Git e nunca deve ser enviado. Não coloque nele Master Key, senhas administrativas, Steam Web API Key ou segredos de servidor.

## Comandos principais

```powershell
npm run test:security
npm run test:ratings
npm run test:content
npm run test:actools
npm run test:ratings-ui
npm run build:web
npm run stage:cloud
npm run build:win
```

`npm run build:actools` compila a ponte nativa `bsr-actools-bridge` a partir do submódulo AcTools. Os binários de distribuição, instaladores, arquivos baixados e pacotes de publicação são gerados localmente e não entram no Git. O instalador Windows fica em dist/desktop/; o ZIP web fica em dist/web/.

## Estrutura

- `app/`: interface e fluxos do launcher;
- `assets/`: imagens, ícones e mídia da aplicação;
- `cloud/`: Cloud Code do Back4App;
- `native/bsr-actools-bridge/`: integração nativa com o motor AcTools;
- `vendor/actools/`: submódulo do projeto AcTools;
- `tests/`: validações automatizadas;
- `scripts/`: geração de pacotes web, preparação do Cloud Code e pós-processamento do Electron;
- `telemetry/`: coleta local e envio de evidências de corrida;
- `docs/`: documentação técnica e operacional organizada por assunto.
- `deploy/cloud-code/current/`: pacote atual do Cloud Code pronto para upload no Back4App.
- `dist/desktop/` e `dist/web/`: artefatos gerados da versão atual; o site publicado fica em `web-dist/`.
- `archive/`: builds antigos, experimentos e pacotes de deploy legados, preservados fora do caminho ativo.

Comece pelo [Guia do código](docs/architecture/CODEBASE_GUIDE.md) para entender os módulos e as funcionalidades. Para configurar o ambiente e trabalhar em uma tarefa, siga o [Passo a passo da equipe](docs/operations/TEAM_QUICKSTART.md).

Consulte também [Arquitetura](docs/architecture/ARCHITECTURE.md), [Gerenciador de conteúdo](docs/development/CONTENT_MANAGER.md), [Sistema de ratings](docs/operations/RATING_SYSTEM.md) e [Publicação Back4App](docs/operations/BACK4APP_SETUP.md).

## Processo de desenvolvimento da equipe

Leia [CONTRIBUTING.md](CONTRIBUTING.md) antes de enviar alterações, [Processo de desenvolvimento, QC e produção](docs/operations/TEAM_WORKFLOW_QC.md) para as responsabilidades e aprovações, [Passo a passo da equipe](docs/operations/TEAM_QUICKSTART.md) para os comandos práticos de GitHub e [Estado/configuração administrativa do GitHub](docs/operations/GITHUB_ADMIN_SETUP.md) para permissões e proteções.
