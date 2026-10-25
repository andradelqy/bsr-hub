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
npm run build:win
```

`npm run build:actools` compila a ponte nativa `bsr-actools-bridge` a partir do submódulo AcTools. Os binários de distribuição, instaladores, arquivos baixados e pacotes de publicação são gerados localmente e não entram no Git.

## Estrutura

- `app/`: interface e fluxos do launcher;
- `cloud/`: Cloud Code do Back4App;
- `native/bsr-actools-bridge/`: integração nativa com o motor AcTools;
- `vendor/actools/`: submódulo do projeto AcTools;
- `tests/`: validações automatizadas;
- `scripts/`: geração de pacotes web e pós-processamento do Electron.

Consulte [ARCHITECTURE.md](ARCHITECTURE.md), [CONTENT_MANAGER.md](CONTENT_MANAGER.md), [RATING_SYSTEM.md](RATING_SYSTEM.md) e [BACK4APP_SETUP.md](BACK4APP_SETUP.md) para a documentação operacional.
