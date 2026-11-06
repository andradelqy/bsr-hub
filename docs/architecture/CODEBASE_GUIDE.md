# BSR Hub — guia prático do código

**Projeto:** BSR Racing Hub
**Versão da aplicação nesta revisão local:** 1.6.22
**Objetivo:** explicar a estrutura, as responsabilidades dos módulos e os caminhos principais da aplicação para que desenvolvedores e QC saibam onde procurar antes de alterar código.

Este guia descreve o código presente no repositório. Ele não substitui os critérios de produto, as regras de segurança nem o processo de aprovação descritos em [TEAM_WORKFLOW_QC.md](../operations/TEAM_WORKFLOW_QC.md).

## 1. Visão geral

O BSR Hub é composto por quatro partes que trabalham juntas:

1. **Launcher Windows (Electron):** executa a aplicação desktop, integra-se com o Windows, Steam, Assetto Corsa, downloads e instalações locais.
2. **Interface web (SPA):** apresenta dashboard, corridas, campeonatos, classificação, carreira, direção de prova, conteúdo e configurações. A mesma interface é usada dentro do launcher.
3. **Backend Back4App / Parse Cloud Code:** autentica e autoriza operações, consulta e grava dados, publica resultados e executa cálculos oficiais.
4. **Integrações locais:** ponte nativa com AcTools e coleta de telemetria/replays do Assetto Corsa.

Fluxo simplificado de leitura:

    Interface (app/)
       -> cliente Parse (api.js)
          -> Cloud Code (cloud/main.js)
             -> banco Back4App

Fluxo desktop para operações locais:

    Interface
       -> API limitada do preload.js
          -> Electron (main.js)
             -> content-manager.js / actools-bridge.js
                -> Assetto Corsa / processo nativo

A interface não deve decidir sozinha quem é administrador nem publicar resultados oficiais. O servidor é a autoridade para permissões, resultados e ratings.

## 2. Mapa de pastas e arquivos

| Caminho | Para que serve | Quando normalmente alterar |
|---|---|---|
| index.html | Estrutura HTML inicial e pontos de montagem da SPA. | Mudança estrutural do shell da interface. |
| login.html | Inicia o fluxo de autenticação Steam no navegador. | Ajustes no início do login. |
| steam_callback.html | Recebe o retorno do Steam OpenID e encaminha a conclusão da autenticação. | Ajustes no retorno do login. |
| admin.html | Compatibilidade com endereço administrativo antigo; o painel real fica integrado à aplicação. | Só para compatibilidade/redirect. |
| main.js | Processo principal do Electron: janela, tray, IPC, Steam no desktop, consentimento de telemetria e downloads de evidência. | Recursos exclusivos do launcher ou integração com Windows. |
| preload.js | Expõe uma lista pequena de funções seguras à interface via contextBridge. | Quando uma nova capacidade desktop precisa ser disponibilizada à interface. |
| api.js | Cliente Back4App/Parse: sessão, cabeçalhos, requisições, tratamento de sessão inválida e chamadas ao servidor. | Login, sessão, transporte ou comportamento comum de API. |
| config.example.js | Exemplo de configuração cliente. | Quando mudam os campos públicos de configuração. |
| config.js | Configuração local usada no desenvolvimento/empacotamento. É ignorada pelo Git. | Cada máquina/ambiente configura localmente; nunca versionar. |
| app/core.js | Estado compartilhado, cache, normalização e carregamento de dados. | Quando várias telas dependem dos mesmos dados ou do mesmo estado. |
| app/components.js | Componentes e comportamentos reutilizados: navegação, cards, drawers, modais, notificações e busca. | Quando o componente é compartilhado entre telas. |
| app/views.js | Implementa as telas e rotas visuais. | Quando se altera o conteúdo ou comportamento de uma tela. |
| app/app.js | Inicialização, roteamento, sincronização, eventos globais e ligação entre core, componentes e views. | Quando muda o ciclo geral da aplicação. |
| app/content.js | Interface do gerenciador de conteúdo e comunicação com a API desktop opcional. | Catálogo, downloads, requisitos e ações de conteúdo. |
| app/race-processor.js | Interpreta arquivos de resultado/log, identifica pilotos, carros, classes, incidentes e avisos para a prévia. | Importação e revisão de resultados. |
| app/app.css | Design system, layout, responsividade, estados e componentes visuais. | Estilo e responsividade. |
| cloud/main.js | Cloud Functions, Cloud Jobs, autorização, regras de negócio e operações persistentes no Back4App. | Toda regra que precisa ser confiável e validada no servidor. |
| cloud/rating-engine.js | Fórmulas do BSR Rating, Safety, confiabilidade, carteira, badge e pontos. | Alterações nas métricas esportivas. |
| cloud/rating-policy.js | Regras de elegibilidade, identidade de sessão, integridade e critérios para importação. | Critérios de publicação e elegibilidade. |
| cloud/rating-publication.js | Coordena publicação serializada e retomável de resultados; controla concorrência. | Controle de publicação e recuperação. |
| cloud/rating-calibration.js | Parâmetros auxiliares de calibração do sistema de ratings. | Ajustes de calibração aprovados. |
| content-manager.js | Motor desktop de catálogo, download, validação, instalação, backup, auditoria, reparo, rollback e desinstalação. | Gerenciador de conteúdo local. |
| actools-bridge.js | Gerencia o processo nativo, mensagens IPC, progresso, timeout e cancelamento. | Comunicação entre Electron e o instalador AcTools. |
| native/bsr-actools-bridge/ | Projeto do executável nativo que usa bibliotecas do AcTools/Content Manager. | Integração de baixo nível com o instalador. |
| vendor/actools/ | Submódulo Git do projeto AcTools usado pela ponte nativa. | Somente quando houver uma atualização planejada da dependência. |
| telemetry/ | Protocolo ACSP, coletor, motor de incidentes e envio de dados/replays. | Telemetria e evidências de corrida. |
| telemetry/ac_app/ | App Python instalada na pasta do Assetto Corsa para recolher amostras locais. | Coleta local dentro do jogo. |
| scripts/ | Validação de configuração, geração do site, preparação do Cloud Code e etapas do pacote Electron. | Build, validação e empacotamento. |
| tests/ | Testes automatizados por domínio funcional. | Sempre que uma regra ou comportamento for alterado. |
| assets/ | Imagens, ícones e mídia usada pela interface. | Recursos visuais. |
| deploy/cloud-code/current/ | Saída gerada para envio manual do Cloud Code ao Back4App. | Gerado por script; não editar como fonte. |
| dist/, web-dist/ | Artefatos gerados do site e dos instaladores. | Gerados pelos scripts; não são fonte do projeto. |
| archive/ | Histórico, experimentos e material antigo preservado. | Consulta histórica; não é o caminho ativo da aplicação. |

## 3. Como a interface funciona

### 3.1 Inicialização e navegação

1. **index.html** cria o shell e os elementos de montagem.
2. Os scripts inicializam **app/core.js**, **app/components.js** e **app/views.js**.
3. **app/app.js** executa a inicialização, verifica sessão e acesso, configura eventos e escolhe a rota pelo fragmento da URL.
4. **app/views.js** desenha a tela selecionada.
5. A tela consulta dados pelo estado/cache de **app/core.js**; o core usa **api.js** para falar com o Back4App.

As rotas registradas em app/views.js são: dashboard, races, championships, content, standings, career, stewarding, admin, settings e race-control. Os endereços visíveis usam o padrão #/nome-da-rota. A navegação administrativa e o controle de resultados fazem parte da mesma aplicação, não de um segundo frontend independente.

### 3.2 Responsabilidade de cada camada visual

- **core.js:** é a camada de dados e estado. Normaliza objetos recebidos, carrega corridas/campeonatos/pilotos/classificação/notificações e mantém cache para evitar consultas repetidas.
- **components.js:** evita duplicação de interface. Cuida de componentes comuns, drawers, modais, tabela de resultados, cartões, alertas e busca.
- **views.js:** decide o que aparece em cada página e associa ações de tela aos componentes e ao core.
- **app.js:** coordena a aplicação. Não deve concentrar fórmulas de rating ou regras de autorização.
- **app.css:** contém o estilo visual compartilhado; evite estilos específicos duplicados quando já existe um componente ou padrão.

Uma regra prática: se a mudança é de apresentação de uma tela, comece em views.js; se o elemento aparece em várias telas, procure em components.js; se o problema é dado/caching, procure em core.js ou api.js.

## 4. Como o Electron e a interface se comunicam

O processo principal do Electron tem acesso às capacidades do sistema operacional. A interface renderizada não deve receber acesso irrestrito ao Node.js ou ao sistema de arquivos.

- **main.js** cria a janela/tray, trata eventos IPC, inicia o login Steam desktop e integra os módulos locais.
- **preload.js** usa contextBridge para expor apenas funções explicitamente permitidas em window.electronAPI.
- **app/** chama essas funções quando está dentro do launcher. Na versão web, recursos que dependem do Electron devem permanecer indisponíveis ou apresentar alternativa clara.
- **content-manager.js** executa as operações de conteúdo no ambiente desktop.
- **actools-bridge.js** conversa com o executável nativo.

Ao adicionar um novo recurso desktop, não exponha ipcRenderer inteiro nem APIs genéricas. Crie uma função específica no preload, valide a origem do evento no processo principal e teste a chamada. O processo principal não deve confiar cegamente em parâmetros vindos da interface.

## 5. Como o Back4App e o Cloud Code funcionam

**api.js** centraliza comunicação com Parse. Ele constrói cabeçalhos, envia requisições, mantém/restaura sessão e trata falhas de autenticação. As telas não devem montar cabeçalhos Parse nem acessar diretamente classes sensíveis.

**cloud/main.js** contém a autoridade do servidor. É onde são validados usuário, sessão Steam, role admin, elegibilidade, propriedade de dados e operações que alteram o banco. Funções importantes estão agrupadas assim:

| Domínio | Exemplos de Cloud Functions | Finalidade |
|---|---|---|
| Login e identidade | beginSteamAuth, authenticateSteam, refreshSteamProfile, getCurrentDriver | Criar/verificar desafio Steam e relacionar identidade ao piloto. |
| Acesso ao Hub | getHubAccessStatus, getHubAccessAdminContext, setHubAccessMode, setHubAccessGrant | Consultar e administrar o modo aberto/restrito e as liberações por SteamID. |
| Pilotos e resultados | getPublicDrivers, getPublicDriverProfile, getMyDriverResults, getRaceResults, getPublicStandings | Entregar dados públicos ou dados do próprio usuário com DTOs controlados. |
| Corridas | getRaceReservations, reserveRaceCar, cancelRaceReservation, submitRaceReport, applyRacePenalty | Reservas, protestos e penalidades. |
| Conteúdo | getContentCatalog, getRaceRequirements, getContentAdminContext, upsertContentPackage, setRaceContentConfig, getRaceLaunchConfig | Catálogo, dependências, requisitos, servidor e configuração de entrada na corrida. |
| Telemetria | registerRaceTelemetryEvidence, getMyTelemetryEvidenceSessions | Registrar evidência pertencente ao piloto autenticado e consultar suas sessões. |
| Processador de resultados | getRaceProcessorContext, previewRaceImport, commitRaceImport, resumeRaceImport, voidLatestRaceImport, rebuildRatingsFromLedger | Preparar, validar, publicar, retomar, anular ou reconstruir resultados. |
| Ratings | setRaceRatingPolicy, getRatingPublicationStatus, initializeRatingPublication, getRatingCalibration | Política, estado e inicialização da publicação. |

Os nomes são pontos de entrada; a implementação e as validações ficam em cloud/main.js e nos módulos auxiliares cloud/*.js.

### 5.1 Objetos de dados mais importantes

Os nomes abaixo representam classes/objetos usados pelo código e pela documentação operacional:

- **_User / _Role / _Session:** identidade Parse, funções e sessões.
- **Driver:** perfil do piloto associado à identidade Steam.
- **Races / Championships / Categories:** calendário, campeonatos e categorias.
- **CarReservations:** inscrições/reservas de carro.
- **RaceResult:** resultado publicado de uma sessão.
- **RatingLedger:** histórico imutável das alterações de rating.
- **RaceImports / RatingPublicationGate:** controle e recuperação do processo de importação/publicação.
- **Reports / AuditLog:** protestos e trilha administrativa.
- **ContentPackage / ServerProfile / RaceConnection:** catálogo de conteúdo e configuração privada do servidor.
- **HubAccessPolicy / HubAccessGrant:** política de acesso e liberações.
- **TelemetryEvidence:** manifesto de evidências de telemetria/replay.

A leitura/escrita direta de classes sensíveis deve continuar bloqueada. Use Cloud Functions para operações protegidas.

## 6. Funcionalidades principais e fluxo de cada uma

### 6.1 Login Steam e perfil

1. O usuário inicia o login na interface.
2. O fluxo Steam OpenID retorna para login.html/steam_callback.html ou para o callback local do launcher.
3. Cloud Code valida a resposta e associa o SteamID ao usuário/perfil.
4. A aplicação recupera os dados permitidos para o perfil.
5. A sessão é encaminhada ao subsistema de telemetria quando necessário.

Não aceite SteamID enviado pelo navegador como prova de identidade. A autenticação deve ser validada no servidor.

### 6.2 Controle de acesso ao Hub

O launcher consulta getHubAccessStatus antes de carregar os dados do Hub. A política fica em HubAccessPolicy e as liberações individuais em HubAccessGrant. No modo restrito, o Cloud Code confere o SteamID autenticado. A interface apenas exibe o resultado; não é a autoridade final. Alterações administrativas devem ser registradas em AuditLog.

### 6.3 Corridas, campeonatos e reservas

- Dashboard agrega informações relevantes para o piloto.
- Corridas lista eventos e abre detalhes/reservas.
- Campeonatos apresenta os eventos vinculados e a classificação.
- Standings mostra a classificação pública.
- Career mostra informações e resultados do piloto autenticado.
- Reservas são criadas/canceladas por Cloud Functions, não por gravação direta do navegador.

A regra de inscrição e a disponibilidade de conexão devem ser verificadas no servidor.

### 6.4 Gerenciador de conteúdo

O catálogo é remoto, mas a instalação é local e só existe no launcher Electron.

1. O Hub busca o catálogo no Back4App.
2. O piloto identifica o Assetto Corsa instalado.
3. O motor obtém os metadados canônicos do pacote.
4. O arquivo é baixado por HTTPS e validado por SHA-256 e limites de tamanho.
5. A estrutura compactada é inspecionada; caminhos inseguros, links e expansão excessiva são rejeitados.
6. Antes de escrever, são criados backups/snapshots dos arquivos afetados.
7. A ponte AcTools instala o conteúdo ou usa a cópia de segurança restrita aplicável.
8. A auditoria compara o inventário instalado com o manifesto.
9. Se a instalação falhar ou divergir, ocorre rollback. Reparo e desinstalação usam o inventário para preservar/restaurar arquivos anteriores.

O administrador cadastra o pacote, URL HTTPS, hash, tamanho, tipo, destino, versão e dependências. O binário não é guardado como campo do Back4App: fica em hospedagem HTTPS estável.

Documentação detalhada: [Gerenciador de conteúdo](../development/CONTENT_MANAGER.md).

### 6.5 Importação de resultados e BSR Rating

1. A Central de Direção de Prova recebe um results.json ou log.
2. **app/race-processor.js** interpreta os dados, associa pilotos e carros, identifica classes, DNF, incidentes e avisos.
3. O administrador corrige/valida os dados e solicita uma prévia.
4. **cloud/main.js** verifica identidade, elegibilidade, duplicidades e consistência.
5. A prévia retorna métricas esperadas.
6. A publicação final é executada no servidor; RaceResult é atualizado e RatingLedger registra a alteração.
7. A chave de sessão/importação evita publicar o mesmo resultado duas vezes.

**cloud/rating-engine.js** implementa métricas separadas:
- BSR Rating: habilidade relativa aos adversários.
- Safety Rating: incidentes por curva em janela móvel.
- Carteira/MPR: progressão e requisitos por disciplina.
- Contact Badge: classificação histórica de condução.
- Confiabilidade: conclusão, DNF e desconexões.
- Pontos: desempenho no campeonato.

**cloud/rating-policy.js** decide se a sessão e cada piloto podem participar do cálculo. **cloud/rating-publication.js** impede publicações simultâneas e registra o estado necessário para retomada segura. Nunca altere fórmulas de rating sem atualizar testes, documentação e versão/política correspondentes.

Documentação detalhada: [Sistema de ratings](../operations/RATING_SYSTEM.md) e [Notas da versão 3.1](../operations/RATINGS_3_1_RELEASE.md).

### 6.6 Direção de prova e protestos

A tela stewarding permite registrar/revisar ocorrências e evidências. Cloud Code aplica as regras para submissão de relatório e penalidades. O acesso ao replay é controlado por sessão e manifesto: a evidência pertence ao piloto que a enviou e precisa ser validada antes de ser anexada ao protesto. A existência de um evento local de telemetria, por si só, não prova culpa.

### 6.7 BSR Race Telemetry

- **telemetry/ac_app/**: app Python instalada no Assetto Corsa; lê shared memory e cria amostras locais.
- **telemetry/acsp-protocol.js**: interpreta pacotes binários ACSP e valida os tamanhos dos campos antes da leitura.
- **telemetry/collector.js**: recebe datagramas UDP ACSP quando configurado para operar como coletor.
- **telemetry/incident-engine.js**: transforma amostras/eventos em candidatos de incidente.
- **telemetry/uploader.js**: agrupa evidências e envia telemetria/replays para Back4App, correlacionando sessão e manifesto.
- **main.js / preload.js**: consentimento, configuração do launcher e transferência de arquivo quando aplicável.

Os eventos locais são **candidatos**, não vereditos. Não alteram automaticamente Safety/MPR nem atribuem culpa. Até existir uma fonte autoritativa do servidor, a confirmação de contato entre dois carros depende de evidências e revisão.

Documentação detalhada: [BSR Race Telemetry](../operations/BSR_RACE_TELEMETRY.md).

## 7. Onde começar uma correção

| Sintoma | Primeiro lugar para investigar |
|---|---|
| Tela não abre ou rota errada | app/app.js e app/views.js |
| Card ou modal aparece errado em várias telas | app/components.js e app/app.css |
| Dados não carregam ou ficam desatualizados | app/core.js e api.js |
| Login/sessão falha | login.html, steam_callback.html, api.js e cloud/main.js |
| Usuário sem permissão entra ou usuário autorizado é bloqueado | cloud/main.js e docs/operations/ACCESS_CONTROL.md |
| Corrida/reserva não aparece ou não salva | app/core.js, app/components.js e funções de corrida em cloud/main.js |
| Conteúdo não baixa/instala/repara | app/content.js, content-manager.js, actools-bridge.js e testes de conteúdo |
| Arquivo de resultado é interpretado errado | app/race-processor.js e tests/race-processor.cjs |
| Rating/Safety/MPR está incorreto | cloud/rating-engine.js, cloud/rating-policy.js e testes de ratings |
| Publicação de resultado trava ou duplica | cloud/rating-publication.js e funções de importação em cloud/main.js |
| Replay/telemetria não sincroniza | telemetry/*, main.js, preload.js e funções de evidência em cloud/main.js |
| Site ou instalador não gera | scripts/, package.json, netlify.toml e config local |

## 8. Testes e comandos do projeto

Executar na raiz do projeto:

    npm ci

Testes por domínio:

    npm run test:security
    npm run test:ratings
    npm run test:content
    npm run test:stewarding
    npm run test:telemetry
    npm run test:actools
    npm run test:production

Interface e builds:

    npm run start
    npm run test:launcher
    npm run test:ratings-ui
    npm run build:web
    npm run build:actools
    npm run stage:cloud
    npm run build:win

O comando adequado depende da área alterada. Veja package.json para a lista oficial de scripts. Testes com integração real devem usar ambiente/dados de homologação, não credenciais ou banco de produção.

## 9. Configuração, segredos e publicação

- config.js é local e ignorado pelo Git. Use config.example.js como modelo.
- Nunca versionar .env, chaves Master/REST, tokens Steam, senhas, arquivos de sessão ou dumps de produção.
- APP_ID, CLIENT_KEY e JAVASCRIPT_KEY são configuração de cliente; não coloque Master Key nem REST API Key no frontend ou no launcher.
- O workflow GitHub Actions tem permissão de leitura e não precisa receber segredos de produção.
- Site: npm run build:web gera web-dist; netlify.toml define build e pasta publicada e usa Node 24. Atenção: config.js é ignorado pelo Git, mas o script de build espera esse arquivo na raiz. O netlify.toml não cria a configuração. Antes de ativar builds automáticos no Netlify, configure uma etapa segura que injete o config.js a partir das variáveis públicas de cliente (APP_ID, CLIENT_KEY, JAVASCRIPT_KEY e BASE_URL). Nunca injete Master Key ou REST API Key no frontend.
- Cloud Code: npm run stage:cloud gera deploy/cloud-code/current. Revisar o conteúdo gerado e publicar os arquivos correspondentes no painel Back4App conforme BACK4APP_SETUP.md.
- Windows: npm run build:win gera o instalador em dist/desktop.
- Um build local não significa publicação. A publicação web, Cloud Code e instalador precisa ser coordenada e autorizada pelo proprietário.

**Nunca use npm run stage:cloud ou ações de deploy contra produção como parte de um teste rotineiro.** Esses comandos preparam artefatos; o envio efetivo deve seguir a aprovação do release.

## 10. Regras para alterar código com segurança

1. Abra/consulte uma Issue antes de começar.
2. Mude somente os módulos relacionados à tarefa.
3. Se alterar uma Cloud Function, verifique a autorização e a CLP da classe envolvida.
4. Se alterar ratings/resultados, atualize os testes do motor/política/publicação.
5. Se alterar conteúdo, preserve limites de arquivo, hash, validação de caminho e rollback.
6. Se alterar IPC, mantenha API explícita no preload e valide a origem no processo principal.
7. Se alterar telemetria, mantenha eventos como candidatos e preserve consentimento/privacidade.
8. Atualize este guia e a documentação operacional quando uma mudança alterar arquitetura ou rotina.
9. Abra Pull Request para develop e descreva testes, risco e rollback.
10. Somente o proprietário decide a integração em main e a produção.

## 11. Documentação complementar

- [Índice da documentação](../README.md)
- [Processo de desenvolvimento, QC e produção](../operations/TEAM_WORKFLOW_QC.md)
- [Passo a passo para desenvolvedores e QC](../operations/TEAM_QUICKSTART.md)
- [Relatório de validação QC](../templates/QC_REPORT.md)
- [Arquitetura resumida](ARCHITECTURE.md)
- [Configuração Back4App](../operations/BACK4APP_SETUP.md)
- [Controle de acesso](../operations/ACCESS_CONTROL.md)
- [Gerenciador de conteúdo](../development/CONTENT_MANAGER.md)
- [Telemetria](../operations/BSR_RACE_TELEMETRY.md)
- [Sistema de ratings](../operations/RATING_SYSTEM.md)
