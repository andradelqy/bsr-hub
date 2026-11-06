# Incidente de exposição da REST API Key — 03/11/2026

## Resumo
Foi identificada uma REST API Key do Back4App em configuração distribuída ao cliente e utilizada em chamadas REST do launcher/site. A chave deve ser tratada como comprometida. Não há evidência neste achado de exposição da Master Key.

## Correção no código
- O cliente REST do BSR usa agora X-Parse-Client-Key e exige window.CLIENT_KEY.
- O uploader de telemetria também usa X-Parse-Client-Key.
- A JavaScript Key permanece separada para inicialização do Parse JavaScript SDK; ela não substitui o cabeçalho REST.
- config.js local não contém mais REST_API_KEY.
- config.example.js não solicita REST API Key nem Master Key.
- Os testes de segurança verificam que o cliente e o uploader não voltam a enviar REST API Key.

## Ação necessária no Back4App
1. Em App Settings > Security & Keys, gere/ative uma Client Key.
2. Preencha localmente window.CLIENT_KEY em config.js. Não envie o valor pelo chat nem o coloque no Git.
3. Execute o smoke test contra o Back4App e confirme login Steam, login administrativo, chamadas Cloud Functions, consultas públicas permitidas, reservas e uploader.
4. Publique o site atualizado e distribua o novo instalador.
5. Depois de confirmar a migração dos clientes que precisam continuar conectando, revogue/regenere a REST API Key exposta em Security & Keys. Isso pode invalidar clientes antigos que ainda dependam dela; mantenha a janela de transição coordenada.
6. Não distribua instaladores ou ZIPs gerados antes desta correção.

## Limites da validação
Os testes locais validam o cabeçalho e os fluxos simulados. A conexão real com Back4App usando a Client Key nova só pode ser validada depois que a chave for configurada. A rotação da chave exposta precisa ser feita no painel Back4App.

## Estado após a correção — 03/11/2026
- A Client Key foi configurada localmente em config.js e validada sem imprimir seu valor.
- O smoke test real do Back4App passou; o modo retornado foi invite e as chamadas protegidas responderam conforme esperado.
- Os testes de segurança/autenticação, ratings, conteúdo, AcTools, telemetria, UI e launcher passaram.
- O instalador 1.6.21 e o ZIP web 1.6.21 foram gerados. A verificação do app.asar e do ZIP confirmou Client Key presente, cabeçalhos X-Parse-Client-Key e ausência dos campos/cabeçalhos REST API Key/Master Key.
- O latest.yml aponta para o nome e tamanho exatos do novo instalador.

## Correções adicionais no código — 06/11/2026
- `content-manager.js` deixou de embutir/usar a REST API Key nas chamadas do catálogo. O processo principal carrega `window.CLIENT_KEY` de `config.js` e a entrega ao gerenciador de conteúdo; a chamada usa `X-Parse-Client-Key`.
- O teste de segurança confirma que o módulo de conteúdo não volta a incluir `REST_API_KEY` nem o cabeçalho `X-Parse-REST-API-Key`.
- O fallback ZIP passou a rejeitar entradas simbólicas antes de extrair. Isso reduz a exposição ao comportamento inseguro associado ao `extract-zip` 2.0.1, mas a dependência continua sinalizada pelo `npm audit`; trate como mitigação e mantenha a atualização/substituição da biblioteca em aberto.

## Ainda pendente
- Publicar o conteúdo de `web-dist` no Netlify e distribuir um novo instalador 1.6.22 com a migração do gerenciador para Client Key. A publicação do site e a distribuição do instalador não foram feitas nesta tarefa.
- A antiga REST API Key permanece no histórico Git de uma revisão anterior, quando o repositório estava público. A alteração da visibilidade não apaga o histórico nem revoga a chave. Manter a chave como comprometida e revogá-la/regenerá-la no Back4App depois de coordenar a atualização dos clientes antigos.
- A dependência `extract-zip@2.0.1` continua sinalizada pelo `npm audit`; o código agora rejeita entradas ZIP simbólicas como mitigação, mas a atualização/substituição da dependência continua recomendada.
