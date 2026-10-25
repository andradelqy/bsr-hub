# Prova de conceito: motor original AcTools dentro do BSR Hub

## Conclusão

**VIÁVEL para o escopo testado (carros, pistas e arquivos ZIP/7z/RAR).** O scanner e o instalador originais funcionam em processo headless, sem abrir o Content Manager e sem exigir que ele esteja instalado. A integração usa `AcManager.Tools.ContentInstallation.ContentInstallationManager`, `ContentScanner` indiretamente e os instaladores originais baseados em SharpCompress.

O motor validado na prova de conceito já está conectado ao fluxo de produção do gerenciador BSR. Isso não é uma autorização jurídica automática para distribuição: os avisos empacotados devem ser mantidos, qualquer DLL nova precisa de revisão de licença e o corpus de homologação deve crescer com mods reais.

## Base reproduzível

- Repositório: `https://github.com/gro-ove/actools`
- Clone local: `vendor/actools`
- Commit testado: `e5e5c94b8dee7511def0b670bfd5dbb233831c11`
- Alvo original: .NET Framework 4.5.2, x64, C# 7.1
- Compilador da PoC: Roslyn 3.11 portátil
- Reference assemblies: `Microsoft.NETFramework.ReferenceAssemblies.net452` 1.0.3
- Nenhum arquivo-fonte dentro de `vendor/actools` foi modificado.

## Resultado dos testes reais

| Teste | Resultado |
|---|---|
| Compilar `AcManager.Tools.dll` sem o projeto WPF principal `AcManager.exe` | passou |
| Carregar dependências WPF sem janela | passou; `Application.Current.Windows.Count == 0` |
| Detectar carro em ZIP | passou; `CarContentEntry`, ID `bsr_test_car`, nome e versão lidos |
| Detectar pista em ZIP | passou; `TrackContentEntry`, ID `bsr_test_track`, nome e versão lidos |
| Instalar carro ZIP em raiz AC simulada | passou |
| Instalar pista ZIP em raiz AC simulada | passou |
| Inspecionar e instalar RAR pelo backend original SharpCompress | passou |
| Inspecionar e instalar 7z pelo backend original SharpCompress | passou |
| IPC persistente JSON-lines Node/Electron → bridge → AcTools | passou |
| Eventos de progresso enviados ao Node/Electron | passou |

Os testes usam fixtures mínimas em `native/bsr-actools-bridge/fixtures-src`. A raiz simulada contém `apps`, `content/cars`, `content/tracks`, `acs.exe` e `AssettoCorsa.exe`, atendendo à validação original de `AcRootDirectory`.

## Cadeia do motor original

```text
Electron ipcMain (content:install, catálogo canônico validado)
  -> BSRContentManager (hash, manifesto, conflito, backup e rollback)
    -> actools-bridge.js (processo filho privado e JSON-lines)
      -> bsr-actools-bridge.exe
        -> ContentInstallationManager.InstallAsync(..., ForceNewTask, ...)
          -> ContentInstallationEntry.RunAsync()
            -> FromFile()
              -> diretório: DirectoryContentInstallator
              -> .zip: SharpCompressContentInstallator
              -> .7z/.rar com plugin habilitado: SevenZipContentInstallator + 7z.exe
              -> .7z/.rar sem plugin: SharpCompressContentInstallator
            -> ContentInstallatorBase.GetEntriesAsync()
              -> ContentScanner.GetEntriesAsync()
                -> CarContentEntry / TrackContentEntry / demais tipos
            -> CheckExistingAsync()
            -> confirmação programática via ConfirmCommand
            -> GetInstallationDetails()
            -> installator.InstallAsync(ICopyCallback, progress, token)
```

### Dependências de compilação de `AcManager.Tools`

Projetos originais: `AcTools`, `AcTools.GenericMods`, `AcTools.LapTimes`, `AcTools.Render`, `AcTools.WheelAngles`, `FirstFloor.ModernUI` e `StringBasedFilter`. Referências binárias declaradas incluem SharpCompress, Json.NET, `AcManager.Internal`, SlimDX, Steamworks.NET, MoonSharp, NAudio, HtmlAgilityPack, EmbedIO, MegaApiClient, JetBrains.Annotations e xxHashSharp.

Isso é o grafo de **compilação do assembly inteiro**, não o fechamento necessário para o fluxo testado. Medição de assemblies carregados durante detecção e instalação de carro/pista em ZIP, RAR e 7z reduziu o fechamento redistribuído a:

- `AcManager.Tools.dll`
- `AcTools.dll`
- `AcTools.GenericMods.dll`
- `FirstFloor.ModernUI.dll`
- `SharpCompress.dll`
- `Newtonsoft.Json.dll`
- assemblies WPF do próprio Windows/.NET Framework

O build gera esse conjunto mínimo. Tipos adicionais do scanner (showrooms, apps Python/Lua, temas, ReShade e outros) precisam de testes próprios antes de reduzir ou ampliar o fechamento.

## Bloqueios encontrados e menor correção

### 1. Toolchain antigo

**Compilação, não execução.** O MSBuild legado encontrou `ToolsVersion=12.0`, mas a máquina não tinha as reference assemblies 4.5.2 e o `csc.exe` do sistema só aceitava até C# 5. Os erros observados foram ausência de `.NETFramework,Version=v4.5.2` e `CS1617` para `/langversion:7.1`.

**Correção mínima:** usar Roslyn portátil e o pacote oficial de reference assemblies, mantendo o target original. Após isso, `AcManager.Tools.dll` e todos os ProjectReferences foram compilados sem o aplicativo principal.

### 2. `Application.Current` obrigatório

**Execução.** `FirstFloor.ModernUI.BetterListCollectionView` compara seu dispatcher com `Application.Current.Dispatcher` sem `null-check`. Sem `Application`, `PluginsManager.Initialize()` lança `NullReferenceException`.

**Correção mínima:** o bridge cria `System.Windows.Application` em thread STA, define `ShutdownMode.OnExplicitShutdown` e executa o `Dispatcher`, mas nunca cria `Window`. O teste confirmou zero janelas visíveis.

### 3. Listener obrigatório de novos arquivos

**Execução.** `NewFilesReporter.RegisterNewFile()` chama `NewFileCreated.Invoke(...)` sem verificar se há assinantes. A aplicação original registra o listener em `App.xaml.cs`; o processo isolado não.

**Correção mínima:** o bootstrap do bridge registra um listener que coleta os caminhos realmente gravados e os devolve ao Electron. Nenhuma alteração no copiador ou no scanner original.

### 4. Scanner e instalador SharpCompress são `internal`

**API/compilação do consumidor.** `ContentScanner` e `SharpCompressContentInstallator` não podem ser instanciados diretamente por outro assembly.

**Correção mínima adotada:** usar a fachada pública original `ContentInstallationManager` e observar `ContentInstallationEntry.Entries`. Assim o scanner interno continua intacto. Se no futuro for necessário um modo somente-inspeção sem criar/cancelar uma tarefa, a menor alteração no fork é expor uma fábrica pública que retorne `IAdditionalContentInstallator`; não é necessária para esta PoC.

### 5. 7-Zip externo é opcional

`SevenZipContentInstallator` exige um plugin registrado e um `7z.exe`, mas `ContentInstallationEntry.FromFile()` usa SharpCompress diretamente para ZIP e faz fallback para SharpCompress quando o plugin 7-Zip não está habilitado. Nesta PoC, ZIP, 7z e RAR foram detectados e instalados por SharpCompress 0.24; nenhum Content Manager ou `7z.exe` foi necessário.

## IPC criado

O executável aceita JSON por linha em `stdin` e responde em `stdout`. Essa interface é privada ao processo principal e não é exposta pelo `preload` ao renderer:

```json
{"id":"1","command":"inspect","archive":"C:\\mods\\car.7z","acRoot":"C:\\Steam\\steamapps\\common\\assettocorsa"}
{"id":"2","command":"install","archive":"C:\\mods\\car.7z","acRoot":"C:\\Steam\\steamapps\\common\\assettocorsa"}
```

Respostas intermediárias têm `type: "progress"`; o encerramento tem `type: "result"`. O Electron registra `actools:inspect`, `actools:install` e retransmite `actools:progress`. O preload expõe somente essas operações específicas, não um shell genérico.

Build e testes:

```powershell
npm run build:actools
native\bsr-actools-bridge\dist\bsr-actools-bridge.exe self-test --workspace native\bsr-actools-bridge
npm run test:actools
```

## Licença e redistribuição

- AcTools e os componentes próprios do repositório estão sob Microsoft Public License (Ms-PL). Devem ser preservados copyright, patentes, marcas e avisos; distribuição em source exige a Ms-PL e distribuição em objeto precisa usar licença compatível.
- A Ms-PL não concede direito sobre nome, logotipo ou marca dos contribuidores. A UI e identidade continuam sendo BSR.
- FirstFloor.ModernUI também traz Ms-PL.
- SharpCompress e Json.NET trazem MIT e exigem preservação dos respectivos avisos.
- O pacote mínimo inclui cópias das quatro licenças em `native/bsr-actools-bridge/dist/licenses` e o arquivo `THIRD-PARTY-NOTICES.md`.
- `AcManager.Internal.dll` existe no grafo completo e não tem fonte própria no repositório, mas não foi carregado nem incluído no fechamento mínimo validado. Se algum recurso futuro o tornar necessário (por exemplo, caminhos de assinatura/autenticação), a redistribuição deve ser revisada antes de adicioná-lo.
- O executável `7z.exe` não é redistribuído. Se futuramente o backend `SevenZipContentInstallator` for habilitado, será necessário incluir e cumprir a licença LGPL/unRAR do 7-Zip Extra ou exigir uma instalação separada. O backend SharpCompress testado torna isso desnecessário para os formatos atuais.

Esta avaliação é técnica, não aconselhamento jurídico.

## Integração de produção concluída

O `BSRContentManager` mantém a autorização e os metadados canônicos, valida hash/tamanho/caminhos, extrai o ZIP somente em staging para formar um manifesto seguro e detectar conflitos, cria backups e então chama o bridge. O AcTools é o único componente que grava o conteúdo no diretório do jogo nesse fluxo. Os caminhos emitidos por `NewFilesReporter` são comparados ao manifesto; o Hub calcula hashes finais, registra o inventário e preserva desinstalação, auditoria e reparo. Um snapshot transitório dos diretórios afetados protege também contra uma eventual divergência de destino do motor.

O teste automatizado `npm run test:actools` cobre IPC, detecção, instalação pelo motor original, inventário BSR, verificação e restauração do arquivo anterior na desinstalação.

## Próximos limites de homologação e release

1. Testar um corpus real de mods BSR, incluindo layouts múltiplos, skins, atualizações sobre conteúdo existente, arquivos sólidos, senha e arquivos corrompidos.
2. Assinar digitalmente o bridge e os DLLs distribuídos, manter o commit fixado e registrar hashes no pipeline de release.
3. Acrescentar testes específicos para reparse points/junctions e pacotes hostis; a validação atual bloqueia caminhos absolutos, `..`, links simbólicos extraídos e divergência entre manifesto e arquivos gravados.
