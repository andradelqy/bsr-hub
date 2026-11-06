# BSR Race Telemetry — arquitetura sem configuração de rede nos pilotos

## Comportamento para o piloto

1. Instala e abre o BSR Hub.
2. Na primeira execução, o proprietário autoriza a telemetria e o tratamento dos replays.
3. Se a pasta do Assetto Corsa exigir privilégios administrativos, o Windows apresenta o UAC para instalar a app Python. Se o proprietário cancelar, o BSR encerra e não permite utilizar o launcher.
4. O BSR instala/atualiza a app Python no Assetto Corsa, ativa somente a secção BSR em python.ini e ativa o Python no gameplay.ini.
5. Ativa autosave em replay.ini com buffer de até 2.000 MB e retenção de quatro replays de corrida. Preserva qualidade, QUALIFY, OTHERS e MIN_TIME_SECONDS.
6. Inicia a recolha local apenas para sessões iniciadas pelo BSR Hub.
7. Depois de a sessão terminar e o replay ficar estável, o launcher envia telemetria e replay em blocos HTTPS de 8 MB para Back4App.

Não se abre porta de entrada, não se altera firewall/router e não se pede ao piloto para configurar UDP, Python, Lua ou CSP. A comunicação do cliente usa HTTPS de saída.

## Consentimento e autorização Windows

O consentimento é apresentado antes de criar a janela principal. É guardado por utilizador Windows e por versão da política em bsr-telemetry-consent.json. Recusar o consentimento encerra o BSR.

A instalação da app Python no diretório do jogo pode exigir UAC (por exemplo, quando o jogo está em Program Files). O script elevado copia somente o ficheiro Python da app BSR. Se a autorização for cancelada ou a instalação falhar, o BSR encerra. Não há alteração do firewall.

Antes de modificar replay.ini, python.ini ou gameplay.ini, o launcher cria .bsr-backup quando o conteúdo será alterado. As secções e chaves de outras apps são preservadas.

## Telemetria local

A app usa a shared memory do Assetto Corsa (`acpmf_physics` e `acpmf_graphics`) para ler velocidade, aceleração G, comandos, rotações, danos, orientação e número de pneus fora da pista. Regista amostras a cada 100 ms em Documents/Assetto Corsa/logs/BSR/*.jsonl.

Deteta candidatos locais de impacto (alteração de dano ou desaceleração/G), saída de pista e rotação. São sinais do carro local, não eventos autoritativos do servidor; não identificam por si só o outro piloto nem a culpa.

Todos os eventos são candidatos. Não alteram Safety/MPR e não atribuem culpa automaticamente. Um candidato prejudicial requer correlação e revisão.

## Sincronização e evidência

O BSR Hub usa a sessão Steam autenticada para sincronizar os registos JSONL e os ficheiros `.acreplay`/`.rpl` estáveis por HTTPS de saída. Os ficheiros são enviados em blocos de 8 MB; cada bloco é acompanhado por SHA-256 e por metadados de conta, corrida, sessão e piloto.

O launcher mantém uma lista local de uploads concluídos para evitar reenvios. O replay é associado à sessão pela hora de fim da telemetria. A evidência incompleta não é apresentada como replay pronto.

Os uploads usam a chave JavaScript do Back4App, não a REST API Key, além do session token do piloto. Os URLs do Parse File Storage são diretos/não listados: qualquer pessoa que obtenha um URL consegue descarregar o ficheiro. Por isso os URLs não são apresentados publicamente; os registos de evidência ficam associados ao utilizador autenticado.

Depois de sincronizado, o replay aparece no seletor de evidência do formulário de protesto. O Cloud Code verifica o proprietário, a sessão, a corrida e a integridade do manifesto antes de anexar os blocos ao objeto Reports. Na central administrativa, a organização pode reconstruir o `.acreplay`; o launcher verifica tamanho e SHA-256 de cada bloco antes de guardar em Downloads/BSR Evidence.

## O que ainda depende da AssettoHosting

O UDP Plugin envia datagramas ACSP para o endereço definido em Send Address. Back4App Cloud Code e Netlify recebem HTTP/HTTPS, não sockets UDP.

Para ter o evento de colisão autoritativo do servidor, a AssettoHosting precisa executar um receptor/plugin ACSP no próprio ambiente ou disponibilizar um encaminhador UDP-para-HTTPS. O BSR não deve apontar Send Address para o PC de um piloto ou administrador, nem pedir portas/firewall aos clientes.

Até essa integração ser disponibilizada, a app local recolhe telemetria do piloto e o autosave preserva o replay completo, mas a confirmação de colisão entre dois carros continua limitada à evidência que o cliente observa.

## Cloud Code

Publicar cloud/main.js no Back4App antes de habilitar o fluxo de produção. As funções novas são:

- `registerRaceTelemetryEvidence`: valida a sessão e registra cada bloco com dono, corrida, tamanho e SHA-256.
- `getMyTelemetryEvidenceSessions`: lista apenas as evidências do piloto autenticado.
- `submitRaceReport`: valida o replay escolhido e anexa o manifesto ao protesto.

Depois da publicação, testar login Steam, upload de telemetria, upload do replay, seletor no formulário de protesto e reconstrução na central administrativa.

## Testes locais

- `npm run test:content`: instalação automática da app, alteração mínima dos INIs e backups.
- `npm run test:telemetry`: parser ACSP, socket UDP local, análise de candidatos e associação telemetria/replay.
- `npm run test:ratings`: garante que candidatos de colisão não alteram ratings/Safety automaticamente.

Os testes locais não substituem um teste dentro do Assetto Corsa nem a publicação das funções Cloud Code.