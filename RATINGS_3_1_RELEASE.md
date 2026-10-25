# BSR Hub 1.6.16 — motor de ratings 3.1

## Escopo

Esta versão preserva a fórmula de habilidade do motor 3.0 e melhora a integridade
da publicação, as regras de participação e a explicação dos resultados. Não é
uma reprodução proprietária do iRating nem uma promessa de calibração perfeita.
Não recalcula automaticamente corridas antigas.

## Fluxo administrativo

1. Antes do início da corrida, configure suas regras de rating: grid mínimo,
   licença mínima, distância mínima e limite de incidentes para MPR.
2. Importe o resultado original. O sistema calcula SHA-256 do arquivo; confira
   a data real da sessão, a bateria, classes, posições e incidentes.
3. Diferencie DNS, desconexão técnica, abandono confirmado e falha coletiva de
   servidor. Revise os avisos de evidência de incidentes e classes desconhecidas.
4. Calcule a prévia. A explicação de cada piloto mostra distância considerada,
   critérios de MPR e tratamento da confiabilidade. Qualquer edição invalida a
   prévia: é necessário calculá-la novamente antes de publicar.
5. Publique. Uma importação interrompida deve ser retomada no histórico; não
   importe a mesma corrida como uma nova sessão para contornar um erro.
6. Para corrigir uma publicação concluída, use Anular, com justificativa.
   Apenas a publicação concluída mais recente pode ser anulada. Corridas
   posteriores devem ser desfeitas em ordem inversa antes de corrigir uma antiga.
   A republicação gera uma nova revisão sem apagar o registro anterior.
7. Reconstruir pelo histórico restaura os perfis que divergirem dos snapshots
   gravados pelo motor novo. Não recalcula a fórmula nem recupera snapshots que
   não existam em publicações legadas.

MPR é o requisito mínimo de participação para evolução de licença. Com a regra
padrão de licença mínima R, pilotos de licença superior não recebem MPR por essa
corrida; configure os eventos futuros de acordo com a licença pretendida.

## Proteções e comportamento

- Sessões identificadas por corrida, data, tipo, pista e bateria.
- Reenvio da mesma publicação não aplica rating duas vezes.
- Plano de cálculo e snapshots persistidos antes da aplicação aos pilotos.
- Publicações serializadas por incremento atômico no Parse; falhas persistidas
  bloqueiam outra sessão até que a publicação pendente seja retomada.
- Leitura pública de ratings suspensa enquanto há uma aplicação pendente, para
  não apresentar perfis parcialmente atualizados.
- Anulação compensatória preserva o histórico.
- DNS não ganha pontos de campeonato nem entra no grid válido de habilidade.
- Desconexão técnica não é automaticamente tratada como abandono intencional.
- Incidentes na primeira volta, mesmo sem curva completada, entram no SR.
- Falha coletiva indicada pelo administrador impede aplicação de habilidade/SR.
- Resultados com mais de uma bateria podem ser consultados separadamente.

## Implantação no Back4App

O diretório `cloud-upload-v14` contém os arquivos preparados. Publique em conjunto:

- `bsr-secure-v14.js`
- `rating-engine.js`
- `rating-policy.js`
- `rating-publication.js`
- `rating-calibration.js`
- `main.js` (carrega apenas `bsr-secure-v14`)

Antes de substituir, guarde uma cópia da versão remota atual. Não misture os
módulos de ratings 3.0 e 3.1. Ao abrir o processador de resultados no Hub 1.6.16,
uma conta administrativa inicializa a publicação segura automaticamente. Como
alternativa operacional, execute uma vez o Cloud Job
`initializeRatingPublication`. Não execute o bootstrap simultaneamente. Ele cria
uma trava privada e registra seu ID em Parse.Config; não redefine ratings.

Verifique o status via função administrativa `getRatingPublicationStatus`.
O bootstrap e a execução real em produção ainda precisam ser confirmados no
ambiente remoto; testes locais não substituem essa confirmação.

## Limites operacionais importantes

Isto é um diário recuperável de publicação, não uma transação ACID envolvendo
todas as gravações do Parse. Se o processo remoto for encerrado abruptamente,
o contador da trava pode permanecer ocupado. Não zere a trava por tempo de
espera: um processo lento pode ainda estar gravando. A recuperação operacional
exige primeiro confirmar que não há execução ativa, preservar `activeImport`
e retomar a importação correspondente. Não existe desbloqueio automático por
expiração nesta versão.

Se a reserva da sessão for gravada, mas o plano falhar antes de aparecer no
histórico, reenvie o mesmo arquivo, corrida, data e bateria para repetir essa
publicação. Não altere a identidade da sessão para contornar a reserva.

O diagnóstico de calibração usa até os últimos 1.000 resultados, por classe e
disciplina, e não altera parâmetros automaticamente. Os avisos de grids
repetidos são sinais para revisão, não prova de manipulação.

A qualidade do SR depende da telemetria/arquivo e da revisão administrativa.
O sistema não infere culpa em colisões nem distingue sozinho falha de conexão
de abandono deliberado. Valores históricos antigos sem snapshots não são
reconstruídos por este mecanismo. Migrações e reparos externos devem ser
executados sem publicações concorrentes.

## Validação local

As suítes de ratings incluem simulações, leitura de arquivos, identidade de
sessões, concorrência da trava e execução dos handlers reais de Cloud Code
contra um adaptador Parse em memória. A integração injeta falha após atualização
de um piloto, retoma sem duplicações, anula, republica e reconstrói um perfil
divergente. A suíte Electron verifica importação, prévia e invalidação após
edição. Isso não equivale a um teste de carga ou falha real no Back4App.
