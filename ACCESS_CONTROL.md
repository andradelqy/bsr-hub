# Controle temporário de acesso ao BSR Hub

O hub possui dois modos controlados pelo Back4App:

- `open`: funcionamento público normal;
- `invite`: somente SteamIDs liberados e contas da role `admin` entram.

O modo inicial é `open`. Isso evita interromper versões antigas durante a publicação. Depois de publicar o Cloud Code e a interface, abra **Central administrativa → Acesso ao Hub**, libere ao menos um piloto e clique em **Ativar acesso restrito**.

## Fluxo do piloto

1. O piloto abre o hub.
2. O launcher consulta `getHubAccessStatus` no Cloud Code antes de carregar corridas ou classificações.
3. No modo restrito, o piloto entra pela Steam.
4. O servidor compara o SteamID64 autenticado com `HubAccessGrant`.
5. Se estiver liberado, o ecossistema é carregado normalmente. Caso contrário, o launcher mostra o nome e o SteamID necessários para pedir acesso.

A decisão nunca depende apenas de `localStorage`. As consultas de corridas, campeonatos, pilotos, resultados, conteúdo e inscrições também são verificadas pelo servidor.

## Administração

No painel integrado é possível:

- procurar um piloto já conhecido ou informar um SteamID64;
- adicionar uma identificação e observação;
- liberar, revogar ou reativar o acesso;
- alternar entre acesso restrito e aberto.

O sistema impede ativar o modo restrito sem pelo menos um piloto liberado. Administradores sempre têm acesso para evitar bloqueio operacional. Todas as alterações são gravadas em `AuditLog`.

## Classes e funções

- `HubAccessPolicy`: política única com a chave `primary`;
- `HubAccessGrant`: lista de SteamIDs e seus estados;
- `getHubAccessStatus`: verificação segura do usuário atual;
- `getHubAccessAdminContext`: contexto privado do painel;
- `setHubAccessMode`: abre ou restringe o hub;
- `setHubAccessGrant`: libera, revoga ou reativa um piloto.

As classes de acesso possuem leitura e escrita diretas bloqueadas. A manutenção ocorre exclusivamente pelas funções administrativas protegidas pela role `admin`.

## Abertura pública futura

Quando o hub for distribuído a todos, basta clicar em **Abrir para todos**. Nenhum cadastro precisa ser apagado; a lista permanece disponível caso a organização queira retomar uma fase fechada depois.
