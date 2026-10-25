# Publicação segura do BSR Hub

O frontend continua usando o aplicativo Back4App configurado em `config.js`. As chaves de cliente identificam o app, mas **não são segredo nem substituem permissões**. A proteção efetiva está no Cloud Code, nas sessões Parse, nas roles e nas CLPs.

## 1. Publique o Cloud Code primeiro

Execute `node scripts/stage-cloud-upload.cjs`. No painel Back4App, envie os seis arquivos JavaScript de `cloud-upload-v14` juntos: `main.js`, `bsr-secure-v14.js`, `rating-engine.js`, `rating-policy.js`, `rating-publication.js` e `rating-calibration.js`. Após o deploy, execute uma vez o Cloud Job `initializeRatingPublication`, sem execuções simultâneas. Use o Hub 1.6.16 nas publicações administrativas. Consulte [RATINGS_3_1_RELEASE.md](RATINGS_3_1_RELEASE.md) para regras, recuperação, compatibilidade e limitações.

Esse código é compatível com Parse Server 7/Node 18: usa `fetch` para validar a resposta OpenID diretamente na Steam e não depende mais de `Parse.Cloud.httpRequest`.

Em **Server Settings > Config Vars** ou Parse Config, defina:

- `STEAM_API_KEY`: Web API Key da Steam, usada somente pelo servidor para obter nome e avatar;
- `STEAM_ALLOWED_CALLBACKS` (opcional): lista separada por vírgulas de callbacks HTTPS autorizados. O padrão é `https://bsrracing2.netlify.app/steam_callback.html`.

O callback desktop usa temporariamente `http://127.0.0.1:<porta>/steam/callback`. Somente loopback é aceito.

## 2. Configure o administrador

1. Em **Database > User**, crie ou use um `_User` real.
2. Em **Database > Role**, crie uma role com o nome exato `admin`.
3. Adicione o usuário na relação `users` dessa role.
4. Aposente a classe antiga `AdminUsers`; senha administrativa não deve existir em classes comuns.
5. No launcher, abra **Admin**, entre com esse `_User` e aguarde a confirmação da role por `verifyAdminSession`. Se já houver uma sessão Steam, o launcher a preserva e restaura ao sair do modo administrativo. O endereço legado `admin.html` apenas redireciona para essa central integrada.
6. Para uma experiência de conta única, localize o `_User` criado pelo login Steam (nome de usuário `steam:<SteamID64>`) e adicione esse mesmo usuário à relação `users` da role `admin`. Nesse caso a central administrativa abre automaticamente após o login Steam, sem pedir uma segunda credencial.
7. Nas configurações do Parse Server, mantenha sessões revogáveis habilitadas e configure duração compatível com 30 dias (`sessionLength: 2592000`).

## 3. Aplique as CLPs após publicar o Cloud Code

Teste primeiro as funções abaixo no console do Back4App. Em seguida remova leitura/escrita pública direta das classes sensíveis.

| Classe | Leitura direta | Escrita direta |
|---|---|---|
| `Races`, `Championships`, `Categories`, `Dependencies` | pública quando necessário | somente role `admin`/Cloud Code |
| `Driver` | somente role `admin`/Cloud Code | somente role `admin`/Cloud Code |
| `CarReservations` | somente role `admin`/Cloud Code | somente role `admin`/Cloud Code |
| `RaceResult`, `ChampionshipStandings` | somente role `admin`/Cloud Code | somente role `admin`/Cloud Code |
| `RatingLedger` | somente role `admin`/Cloud Code | somente Cloud Code; registros imutáveis |
| `Notifications` | somente role `admin`/Cloud Code | somente role `admin`/Cloud Code |
| `Reports`, `AuditLog`, `AuthChallenge`, `RaceImports`, `ContentPackage`, `RaceConnection`, `ServerProfile`, `HubAccessPolicy`, `HubAccessGrant` | somente role `admin`/Cloud Code | somente role `admin`/Cloud Code |
| `_User`, `_Role`, `_Session` | sem consulta pública | sem criação/alteração pública |

O próprio `cloud/main.js` também possui gatilhos que bloqueiam consultas e mutações diretas. O launcher lê apenas DTOs sanitizados por Cloud Functions; SteamID, ponteiros de usuário, denúncias e logs não ficam mais publicamente enumeráveis.

As credenciais da conexão única ficam exclusivamente no registro `assetto-corsa-primary` de `ServerProfile`, protegido por role e pelos gatilhos. `RaceConnection` guarda somente o carro solicitado por corrida. A classe pública `Races` guarda apenas os slugs dos requisitos, nunca a senha do servidor.

Na primeira alteração de requisitos após o deploy, se `ServerProfile` ainda não existir, o Cloud Code migra automaticamente a configuração de servidor mais recente encontrada em `RaceConnection` e registra a operação em `AuditLog`.

Funções públicas/sanitizadas usadas pelo launcher:

- `getHubAccessStatus`
- `getPublicDrivers`
- `getPublicStandings`
- `getRaceResults`
- `getRaceReservations`
- `getNotifications`

Funções autenticadas:

- `getCurrentDriver`
- `getMyDriverResults`
- `reserveRaceCar`
- `cancelRaceReservation`
- `submitRaceReport`

Funções exclusivas da role `admin` para o processador integrado de resultados:

- `getRaceProcessorContext`
- `previewRaceImport`
- `commitRaceImport`
- `migrateRatingsV3` (`migrateRatingsV2` permanece como alias temporário)

O job `migrateRatingsV3Job` oferece a mesma inicialização pelo painel **Cloud Code → Jobs** sem exigir credenciais de uma conta administrativa do launcher. O job v2 permanece como alias temporário. Cloud Jobs são restritos ao dashboard/Master Key e a execução fica registrada em `AuditLog`.

Funções exclusivas da role `admin` para conteúdo e servidor:

- `getHubAccessAdminContext`
- `setHubAccessMode`
- `setHubAccessGrant`
- `getContentAdminContext`
- `upsertContentPackage`
- `setContentServerProfile`
- `setRaceContentConfig`

O cliente apenas interpreta os arquivos e permite a revisão. BSR Rating, Safety Rating, confiabilidade, licenças, pontos, resultados, reservas e auditoria são recalculados e gravados pelo Cloud Code com Master Key. A chave determinística `raceId:sessionType` impede a publicação duplicada da mesma sessão. Cada alteração também recebe a versão do algoritmo e um registro imutável em `RatingLedger`.

## 4. Publique o frontend coordenadamente

Execute `npm run build:web` e publique apenas o conteúdo de `web-dist`. O arquivo `netlify.toml` já configura esse diretório e o `_headers` adiciona CSP e outros cabeçalhos de proteção.

O deploy precisa incluir `login.html` e `steam_callback.html`; ambos estavam ausentes na versão online anterior. Publique Cloud Code e frontend na mesma janela de manutenção para não deixar o login em estado intermediário.

## 5. Validação pós-deploy

1. Abra `https://bsrracing2.netlify.app/login.html` e confirme o login Steam.
2. Feche e reabra o navegador/app: a sessão deve continuar válida até o logout, a expiração ou a revogação no Back4App.
3. Confirme que uma chamada REST pública direta a `Driver`, `CarReservations`, `Reports` e `AuditLog` retorna acesso negado.
4. Confirme que corridas, classificação e resultados continuam visíveis pelo launcher.
5. Entre no admin com um usuário comum: o acesso deve ser negado. Entre com membro da role `admin`: o painel deve abrir.
6. Revogue a sessão em `_Session` e confirme que a próxima chamada leva o usuário novamente ao login.

Nunca coloque a Master Key, a Steam Web API Key ou credenciais administrativas em `config.js`, HTML, Electron renderer ou qualquer arquivo distribuído.
