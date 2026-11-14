# Incidente de exposição da REST API Key — 03/11/2026

## Resumo
Foi identificada uma REST API Key do Back4App em configuração distribuída ao cliente e utilizada em chamadas REST do launcher/site. A chave deve ser tratada como comprometida. Não há evidência neste achado de exposição da Master Key.

## Correção no código
- O cliente REST do BSR usa agora X-Parse-Client-Key e exige window.CLIENT_KEY.
- O uploader de telemetria também usa X-Parse-Client-Key.
- A JavaScript Key permanece separada para inicialização do Parse JavaScript SDK; ela não substitui o cabeçalho REST.
- site/config.js local não contém mais REST_API_KEY.
- site/config.example.js não solicita REST API Key nem Master Key.
- Os testes de segurança verificam que o cliente e o uploader não voltam a enviar REST API Key.

## Ação necessária no Back4App
1. Em App Settings > Security & Keys, gere/ative uma Client Key.
2. Preencha localmente window.CLIENT_KEY em site/config.js. Não envie o valor pelo chat nem o coloque no Git.
3. Execute o smoke test contra o Back4App e confirme login Steam, login administrativo, chamadas Cloud Functions, consultas públicas permitidas, reservas e uploader.
4. Publique o site atualizado e distribua o novo instalador.
5. Depois de confirmar a migração dos clientes que precisam continuar conectando, revogue/regenere a REST API Key exposta em Security & Keys. Isso pode invalidar clientes antigos que ainda dependam dela; mantenha a janela de transição coordenada.
6. Não distribua instaladores ou ZIPs gerados antes desta correção.

## Limites da validação
Os testes locais validam o cabeçalho e os fluxos simulados. A conexão real com Back4App usando a Client Key nova só pode ser validada depois que a chave for configurada. A rotação da chave exposta precisa ser feita no painel Back4App.

## Estado após a correção — 03/11/2026
- A Client Key foi configurada localmente em site/config.js e validada sem imprimir seu valor.
- O smoke test real do Back4App passou; o modo retornado foi invite e as chamadas protegidas responderam conforme esperado.
- Os testes de segurança/autenticação, ratings, conteúdo, AcTools, telemetria, UI e launcher passaram.
- O instalador 1.6.21 e o ZIP web 1.6.21 foram gerados. A verificação do app.asar e do ZIP confirmou Client Key presente, cabeçalhos X-Parse-Client-Key e ausência dos campos/cabeçalhos REST API Key/Master Key.
- O latest.yml aponta para o nome e tamanho exatos do novo instalador.

## Correções adicionais no código — 06/11/2026
- `launcher/content-manager.js` deixou de embutir/usar a REST API Key nas chamadas do catálogo. O processo principal carrega `window.CLIENT_KEY` de `site/config.js` e a entrega ao gerenciador de conteúdo; a chamada usa `X-Parse-Client-Key`.
- O teste de segurança confirma que o módulo de conteúdo não volta a incluir `REST_API_KEY` nem o cabeçalho `X-Parse-REST-API-Key`.
- O fallback ZIP foi migrado de `extract-zip` para `yauzl` 3.4.0, com extração por streaming. O código valida nomes e atributos de cada entrada, rejeita links simbólicos, caminhos absolutos/relativos inseguros, duplicidades e conflitos arquivo/diretório, aplica limite de expansão e grava arquivos sem sobrescrever destinos existentes.

## Estado atualizado — 06/11/2026
- A versão do projeto foi elevada para 1.6.23 para identificar a atualização da stack de desktop e segurança do extrator.
- `extract-zip` deixou de ser dependência direta e o código usa `yauzl@3.4.0` com extração controlada por streaming.
- Electron foi atualizado para 45.2.3 e Electron Builder para 26.18.0. A dependência `minimatch` vulnerável foi substituída por 11.0.5 nas árvores afetadas.
- `npm audit` completo e `npm audit --omit=dev` retornaram zero vulnerabilidades após essas atualizações.
- Os testes locais de segurança, ratings, conteúdo, stewarding, telemetria, AcTools, smoke Back4App, UI de ratings, launcher e sintaxe passaram nesta revisão.

## Riscos e pendências mantidos por decisão
- A antiga REST API Key do Back4App **não foi rotacionada**, por decisão expressa do proprietário em 06/11/2026. Ela deve continuar sendo tratada como comprometida. A limpeza do histórico Git remove a cópia armazenada nos commits deste repositório, mas não revoga a chave nem apaga cópias que terceiros possam ter obtido enquanto o código esteve público. A exposição só é totalmente encerrada com revogação/regeneração no Back4App.
- Publicar o repositório não publica `web-dist`, Cloud Code nem distribui o instalador. Netlify, Back4App Cloud Code e o instalador 1.6.23 não foram publicados por esta tarefa.
