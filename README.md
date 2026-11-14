# BSR Racing Hub

**Versão atual do aplicativo:** 1.6.23

Repositório de desenvolvimento do BSR Racing Hub, plataforma da Brasil Sim Racing. Aqui ficam separados o código do site, o launcher Windows, os serviços de backend, os testes e as ferramentas de build.

Para conhecer o funcionamento do projeto, consulte o [Manual Técnico e Operacional](docs/BSR_HUB_MANUAL_TECNICO_E_OPERACIONAL.pdf) e o [Guia do código](docs/architecture/CODEBASE_GUIDE.md).

## Preparação local

```powershell
git clone --recurse-submodules https://github.com/andradelqy/bsr-hub.git
cd bsr-hub
Copy-Item site/config.example.js site/config.js
npm ci
npm run build:actools
npm start
```

Preencha `site/config.js` com os identificadores e as chaves públicas de cliente do ambiente Back4App. Esse arquivo fica fora do Git. Não coloque nele Master Key, REST API Key, senhas administrativas, Steam Web API Key ou credenciais de servidor.

## Comandos principais

```powershell
npm run test:security
npm run test:ratings
npm run test:content
npm run test:actools
npm run test:ratings-ui
npm run test:telemetry
npm run build:web
npm run stage:cloud
npm run build:win
```

O site é preparado em `web-dist/` e o pacote ZIP fica em `dist/web/`. O instalador Windows é gerado em `dist/desktop/`. Esses arquivos são artefatos de build e não devem ser commitados.

## Estrutura do projeto

| Pasta | O que fica aqui |
|---|---|
| `site/` | HTML, estilos, scripts, imagens e configuração local usados pelo site. |
| `launcher/` | Processo Electron, preload, gerenciador de conteúdo, integração AcTools, telemetria e código nativo. |
| `cloud/` | Cloud Code e regras de negócio executadas no Back4App. |
| `deploy/` | Arquivos preparados para publicação manual do Cloud Code. |
| `scripts/` | Scripts de build, validação e preparação de deploy. |
| `tests/` | Testes automatizados do site, launcher e backend. |
| `docs/` | Documentação técnica, operacional e de desenvolvimento. |
| `vendor/actools/` | Submódulo do projeto AcTools usado na ponte nativa. |
| `archive/` | Builds antigos, experimentos e material legado preservado fora do fluxo ativo. |

O launcher abre a interface que fica em `site/`. Assim, o site e o aplicativo desktop usam a mesma interface, enquanto os recursos exclusivos do Windows permanecem em `launcher/`.

## Desenvolvimento e revisão

Leia [CONTRIBUTING.md](CONTRIBUTING.md) antes de enviar alterações. O [Processo de desenvolvimento e QC](docs/operations/TEAM_WORKFLOW_QC.md) explica as responsabilidades e aprovações; o [Passo a passo da equipe](docs/operations/TEAM_QUICKSTART.md) reúne os comandos práticos.

Consulte também [Arquitetura](docs/architecture/ARCHITECTURE.md), [Gerenciador de conteúdo](docs/development/CONTENT_MANAGER.md), [Sistema de ratings](docs/operations/RATING_SYSTEM.md) e [Publicação Back4App](docs/operations/BACK4APP_SETUP.md).
