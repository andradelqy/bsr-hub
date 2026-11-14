# BSR AcTools Bridge — avisos de terceiros

O executável `bsr-actools-bridge.exe` é um adaptador BSR. Ele redistribui componentes compilados do repositório AcTools/Content Manager e dependências necessárias ao recorte validado de inspeção e instalação de carros e pistas.

## Componentes distribuídos

| Componente | Arquivos | Licença incluída |
|---|---|---|
| AcTools / AcManager.Tools / AcTools.GenericMods / AcManager.Internal | `AcTools.dll`, `AcManager.Tools.dll`, `AcTools.GenericMods.dll`, `AcManager.Internal.dll` | Microsoft Public License do repositório (`licenses/AcTools-Ms-PL.txt`) |
| FirstFloor.ModernUI | `FirstFloor.ModernUI.dll` | Microsoft Public License (`licenses/FirstFloor.ModernUI-Ms-PL.md`) |
| SharpCompress 0.24 | `SharpCompress.dll` | MIT (`licenses/SharpCompress-MIT.md`) |
| Json.NET 7 | `Newtonsoft.Json.dll` | MIT (`licenses/Json.NET-MIT.md`) |

O nome, a marca e os logotipos do Content Manager/AcTools não são licenciados pela Ms-PL. O BSR Hub não deve sugerir endosso ou usar essas marcas como identidade do produto.

O código-fonte original utilizado no build está em `vendor/actools`, no commit registrado em `ACTOOLS_POC.md`. Alterações futuras na seleção de DLLs exigem nova auditoria e a inclusão das licenças correspondentes.
