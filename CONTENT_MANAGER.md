# Gerenciador de conteúdo BSR

O BSR Racing Hub 1.6.4 gerencia conteúdo local do **Assetto Corsa no Windows**. O site exibe o catálogo; análise de ZIP, download, instalação, reparo, desinstalação e entrada direta são deliberadamente limitados ao launcher Electron, porque o navegador não deve acessar a pasta do jogo.

## Fluxo do piloto

1. Abra **Conteúdo** no launcher. Na primeira execução, a instalação Steam é detectada automaticamente; se necessário, use **Localizar jogo**.
2. Em uma corrida, abra os detalhes. O bloco **Conteúdo necessário** resolve também as dependências.
3. Use **Baixar requisitos**. O tamanho do ZIP é usado para progresso e limites de segurança; a identidade do arquivo é validada pelo SHA-256 informado no catálogo.
4. Use **Instalar requisitos**. O launcher valida o manifesto e então entrega o pacote ao motor original AcTools, executado em segundo plano sem abrir nenhuma janela do Content Manager.
5. Antes de habilitar **Entrar no servidor**, o launcher audita novamente todos os requisitos. Conteúdo ausente, alterado ou desatualizado oferece a ação **Reparar requisitos**.
6. Depois de autenticado pela Steam, use **Entrar no servidor**. O launcher prepara `Documents/Assetto Corsa/cfg/race.ini` e inicia o jogo com `/spawn`.
7. Em **Conteúdo**, qualquer pacote pode ser verificado, reparado ou desinstalado. Downloads em cache podem ser removidos e arquivos que já existiam são restaurados do backup local.

## Publicação pelo administrador

O painel aparece dentro de **Conteúdo** apenas para usuários da role `admin`. O acesso é feito na rota **Admin** do próprio launcher; a sessão Steam anterior é preservada durante o modo administrativo.

O painel foi dividido em **Biblioteca**, **Corridas** e **Servidor**. O fluxo normal é:

1. Em **Servidor**, configure uma única vez o domínio/IP, as portas e a senha do servidor principal BSR. Todas as corridas usam esse perfil privado.
2. Em **Biblioteca**, clique em **Adicionar conteúdo** e selecione o ZIP no launcher. O assistente calcula SHA-256 e tamanho, reconhece a estrutura e sugere nome, tipo, destino e caminho interno.
3. Confirme as informações visíveis, informe a URL HTTPS direta do mesmo ZIP e escolha **Rascunho**, **Publicado** ou **Pausado**. Campos técnicos continuam disponíveis em **Configurações avançadas**.
4. Em **Corridas**, escolha o evento, informe apenas o ID local do carro e marque os pacotes publicados exigidos. Dependências são resolvidas automaticamente pelo launcher.

O arquivo binário não é armazenado no Back4App: ele deve estar em uma URL HTTPS estável. O Back4App guarda o catálogo, os hashes, as relações de dependência, o servidor e a auditoria administrativa.

Exemplos de estruturas aceitas:

```text
content/cars/meu_carro/...
content/tracks/minha_pista/...
meu_carro/...                 # tipo Carro + ID de destino meu_carro
minha_skin/...                # tipo Skin + ID de destino ks_carro
```

O campo **Caminho interno** pode apontar para a pasta útil quando o ZIP possui diretórios extras. Não use instaladores `.exe`; publique arquivos de conteúdo em ZIP.

No cadastro da corrida, marque **Exigir inscrição prévia** somente nas sessões que realmente precisam de reserva. O servidor global e a senha ficam em `ServerProfile`; `RaceConnection` mantém apenas o carro solicitado por evento. As duas classes são privadas. Em corridas com inscrição, a conexão só é entregue a um piloto inscrito ou administrador; sessões de acesso livre dispensam reserva.

## Segurança e recuperação

- o processo da interface nunca recebe acesso genérico ao sistema de arquivos ou ao terminal;
- o processo nativo busca novamente os metadados canônicos no Back4App antes de cada download/instalação;
- a sessão Parse/Steam é encaminhada somente durante a operação solicitada e não é gravada no estado local do gerenciador;
- apenas HTTPS, SHA-256 exato e tipos/destinos permitidos são aceitos; o tamanho declarado é diagnóstico, enquanto um limite absoluto protege o armazenamento;
- caminhos absolutos, `..`, links simbólicos, excesso de arquivos e conteúdo expandido acima do limite são bloqueados;
- antes da gravação, o Hub cria backups por arquivo e um snapshot transitório do conteúdo afetado; instalação interrompida ou divergente executa rollback;
- pacotes que tentam substituir arquivos pertencentes a outro pacote BSR são bloqueados com diagnóstico de conflito;
- uma auditoria compara os arquivos instalados ao manifesto e o reparo reinstala a cópia verificada do cache ou baixa novamente o ZIP;
- a desinstalação remove apenas arquivos registrados no manifesto local e restaura arquivos sobrescritos;
- downloads, instalações, reparos e desinstalações mantêm um histórico local limitado para diagnóstico;
- o `race.ini` original recebe um backup único com sufixo `.bsr-backup`.

## Motor de instalação

O fluxo usa diretamente `ContentInstallationManager`, `ContentScanner` e os instaladores SharpCompress originais do projeto Content Manager/AcTools através do processo headless `bsr-actools-bridge.exe`. O Electron conserva a camada própria do BSR para autenticação, catálogo Back4App, HTTPS, SHA-256, limites de expansão, detecção de conflitos, backup, inventário, auditoria, reparo e desinstalação. O bridge não abre a interface do Content Manager e não exige que o jogador o tenha instalado.

Antes de confirmar uma instalação, o tipo e o ID detectados pelo AcTools são comparados com os metadados canônicos. Depois, a lista reportada por `NewFilesReporter` precisa coincidir exatamente com o manifesto pré-validado. Qualquer diferença restaura o snapshot anterior e cancela o registro da instalação.

## Publicação do site

O frontend pronto para o upload manual no Netlify está em `web-dist`. O instalador desktop mais recente é gerado pelo `npm run build` com a versão definida em `package.json`.

O catálogo nasce vazio de propósito: nenhum mod de terceiros foi distribuído sem o arquivo, a licença de redistribuição, a URL HTTPS e o hash fornecidos pela organização.
