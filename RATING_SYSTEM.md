# BSR Rating v3

Atualização 3.1 / Hub 1.6.16: veja [RATINGS_3_1_RELEASE.md](RATINGS_3_1_RELEASE.md).
As regras de publicação, MPR, desconexões e recuperação descritas nessa nota
substituem os detalhes operacionais anteriores deste documento.

O motor v3 separa métricas que medem comportamentos diferentes e mantém todas versionadas no `RatingLedger`:

- **BSR Rating:** habilidade relativa aos adversários da mesma disciplina.
- **Safety Rating:** frequência e severidade de incidentes nas últimas 2.000 curvas válidas.
- **Carteira:** progressão esportiva por disciplina, baseada em Safety e MPR.
- **Contact Badge:** histórico sustentado de condução (`Rookie`, `Good`, `Trusted`, `Warning`, `Probation`).
- **Confiabilidade:** conclusão, DNF e desconexões nas últimas 20 largadas.
- **Pontos:** desempenho dentro de um campeonato, ponderado por grid e força do campo.

## Princípios usados

O modelo combina princípios públicos de iRacing e RaceControl/Le Mans Ultimate sem tentar reproduzir fórmulas proprietárias:

- habilidade e Safety são independentes;
- o desempenho é relativo à expectativa e à força dos adversários;
- apenas corridas oficiais elegíveis alteram habilidade;
- Safety é no-fault e usa incidentes por curva;
- ratings e carteiras são separados por `road`, `formula`, `oval` e `drift`;
- acesso a categorias pode usar carteira e badge, sem misturar punição esportiva com habilidade;
- resultado publicado não é recalculado silenciosamente.

## BSR Rating

O `bsr-rating-v3.0.0` realiza confrontos pareados entre todos os pilotos da mesma classe. Cada par transfere pontos do resultado abaixo da expectativa para o resultado acima dela. A soma é exatamente zero por classe após o arredondamento.

Características:

- probabilidade esperada calculada pela diferença de rating;
- grid maior recebe uma ponderação moderada;
- perfis provisórios são mais voláteis;
- perfis consolidados mudam menos;
- surpresa contra adversário forte vale mais do que vitória esperada;
- variação limitada a `±85` por sessão;
- incerteza aumenta lentamente após inatividade;
- confiança cresce somente quando o grid traz informação útil;
- oito corridas e pelo menos 40% de confiança encerram a fase provisória.

Uma classe altera rating somente quando:

- a sessão é oficial;
- a distância regulamentar foi atingida;
- o grid geral atinge o mínimo configurado;
- a própria classe atinge o mínimo configurado, padrão de três pilotos.

DNF e DSQ entram pela posição oficial, nunca por uma dedução artificial fixa de habilidade. Penalidades são aplicadas à classificação antes do cálculo.

## Safety Rating

O SR permanece entre `0.00` e `4.99`. O cálculo utiliza uma janela móvel de 2.000 curvas e converte o índice `CPI` (corners per incident) em Safety. A migração cria 1.000 curvas equivalentes ao valor anterior para evitar saltos.

Incidentes recomendados:

| Ocorrência | Pontos |
|---|---:|
| Saída de pista | 1x |
| Rodada/perda de controle | 2x |
| Contato leve | 2x |
| Contato forte | 4x |

Uma cadeia `2x → 4x` dentro de três segundos vale somente `4x`. O contato é no-fault: os envolvidos recebem o registro, pois os dados comuns do Assetto Corsa não determinam culpa de forma confiável. A direção pode revisar o total antes da publicação.

Multiplicadores estão preparados para diferentes sessões: corrida `1.00`, classificação/aquecimento `0.50` e time trial/treino `0.35`. O fluxo atual publica `RACE`, `SPRINT` e `FEATURE`, todas com peso integral.

## Carteiras e MPR

Cada disciplina possui carteira, SR e MPR próprios. Uma corrida conta para MPR somente quando é válida para rating, o piloto não é DSQ e completa ao menos 50% das voltas do líder da classe.

| Promoção | SR mínimo | MPR |
|---|---:|---:|
| R → D | 3,00 | 4 |
| D → C | 3,50 | 4 |
| C → B | 3,50 | 6 |
| B → A | 3,75 | 8 |
| A → S | 4,00 | 10 |

Somente SR abaixo de `1.00` causa rebaixamento imediato. Entre `1.00` e `1.99`, o piloto fica em risco, mas uma única corrida ruim não derruba a carteira automaticamente.

## Contact Badge e confiabilidade

O badge evita usar apenas uma corrida para rotular o piloto:

- menos de cinco largadas: `Rookie`;
- histórico limpo consistente: `Good`;
- ao menos 20 largadas, CPI alto e confiabilidade ≥95%: `Trusted`;
- contato frequente sustentado: `Warning`;
- comportamento extremo por histórico suficiente: `Probation`.

Desconexão não é automaticamente marcada como rage quit. A confiabilidade distingue finalização, DNF e abandono confirmado.

## Fluxo oficial

1. O administrador importa `results.json` ou logs.
2. O launcher identifica SteamID, carros, classificação e incidentes.
3. O administrador revisa classe, posição, status, incidentes e penalidades.
4. O Cloud Code valida SteamID64, duplicidades e elegibilidade geral/por classe.
5. A prévia mostra posição esperada, SOF, iR, SR, CPI, badge, carteira e MPR.
6. A publicação grava `RaceResult`, atualiza o piloto e cria um ledger imutável.
7. A chave `raceId:sessionType` impede duplicação do mesmo resultado.

## Migração v3

Após publicar o Cloud Code, execute **Central administrativa → Inicializar motor v3** ou o job protegido `migrateRatingsV3Job`.

A migração é idempotente e:

- preserva os valores visíveis de iR e SR;
- converte perfis v2 sem zerar corridas;
- cria Safety e carteira por disciplina;
- mantém o histórico legado como compatibilidade;
- registra `migrate_ratings_v3` no `AuditLog`.

As funções e job v2 continuam como aliases temporários para launchers antigos, mas executam o motor v3.

## Limitações dos dados do Assetto Corsa

Nem todo servidor fornece curvas completadas, gravidade do impacto ou motivo real da desconexão. Sem `CornersCompleted`, informe corretamente as curvas por volta. Sem eventos confiáveis, revise manualmente os pontos de incidente. O sistema nunca deve inferir rage quit apenas pela porcentagem de voltas.
