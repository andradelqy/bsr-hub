# BSR Racing Hub

Código-fonte privado do launcher da Brasil Sim Racing. O projeto reúne o launcher Electron, páginas web, Cloud Code do Back4App, motor de ratings e a ponte nativa baseada em AcTools.

## Preparação local

```powershell
git clone --recurse-submodules <URL_DO_REPOSITORIO>
cd bsr-hub
Copy-Item config.example.js config.js
npm ci
npm run build:actools
npm start
```

Preencha `config.js` com as credenciais do Back4App. Esse arquivo não deve ser versionado.

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
