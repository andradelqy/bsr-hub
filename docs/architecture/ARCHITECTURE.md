# Arquitetura do BSR Racing Hub

O projeto tem três partes principais: o site, o launcher Windows e o backend. O launcher abre a mesma interface usada pelo site; os recursos que dependem do Windows ficam isolados no código do launcher.

## Organização do código

- `site/`: páginas HTML, cliente Back4App, interface SPA, estilos, imagens e configuração local. É a origem do site publicado.
- `launcher/`: processo principal do Electron, preload, gerenciador de conteúdo, integração com AcTools, telemetria e ponte nativa.
- `cloud/`: Cloud Code executado no Back4App. Aqui ficam autenticação, permissões, regras de negócio, resultados e ratings.
- `tests/`: testes automatizados da interface, do launcher e do backend.
- `scripts/`: validação da configuração, build do site, empacotamento e preparação do Cloud Code.
- `docs/`: documentação técnica, operacional e de desenvolvimento.
- `vendor/actools/`: submódulo do projeto AcTools usado pela ponte nativa.

## Como as partes se conectam

```text
Navegador ───────────────┐
                        ├── site/ (HTML + SPA + cliente Parse)
Launcher Electron ──────┘                 │
      │                                   ▼
      ├── launcher/preload.js        cloud/ (Back4App)
      ├── launcher/main.js                │
      ├── launcher/content-manager.js     ▼
      ├── launcher/actools-bridge.js   Banco Parse
      └── launcher/telemetry/
```

A interface fica em `site/` e é carregada pelo Electron a partir dessa pasta. Isso mantém um único frontend, sem duplicar páginas ou estilos entre o site e o launcher. O preload expõe somente as operações desktop necessárias; a interface não recebe acesso genérico ao sistema de arquivos ou a processos.

## Site e launcher

O build web copia os arquivos de `site/` para `web-dist/`. O Netlify publica essa pasta.

O build Windows empacota `site/` e `launcher/` no aplicativo Electron. O processo principal está em `launcher/main.js`; o caminho de entrada é definido em `package.json`. Os recursos nativos são compilados em `launcher/native/bsr-actools-bridge/`.

A configuração local do Back4App fica em `site/config.js`, criada a partir de `site/config.example.js`. O arquivo real é ignorado pelo Git. Somente identificadores e chaves públicas de cliente podem chegar ao frontend; credenciais administrativas nunca devem ser distribuídas.

## Backend e publicação

As regras de autenticação, autorização e integridade ficam em `cloud/`. A interface chama o cliente Parse em `site/api.js`, que encaminha as operações protegidas para Cloud Functions.

Para preparar o envio manual do Cloud Code, execute `npm run stage:cloud`. O resultado fica em `deploy/cloud-code/current/` e deve ser publicado no painel Back4App conforme o procedimento em [BACK4APP_SETUP.md](../operations/BACK4APP_SETUP.md).

## Comandos úteis

- `npm run build:web`: valida a configuração e prepara o site.
- `npm run build:actools`: compila a ponte nativa.
- `npm run test:security`, `npm run test:ratings`, `npm run test:content` e `npm run test:telemetry`: executam os testes por área.
- `npm run test:launcher` e `npm run test:ratings-ui`: verificam a interface em Electron.
- `npm run build:win`: gera o instalador Windows.

Os arquivos em `dist/` e `web-dist/` são saídas de build. Não edite esses arquivos como fonte nem os envie ao Git.
