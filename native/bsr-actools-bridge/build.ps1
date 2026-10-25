param(
    [switch]$SkipAcToolsBuild
)

$ErrorActionPreference = 'Stop'
$BridgeDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Workspace = (Resolve-Path (Join-Path $BridgeDir '..\..')).Path
$AcTools = Join-Path $Workspace 'vendor\actools'
$Tools = Join-Path $Workspace '.tooling\nuget'
$Compiler = Join-Path $Tools 'Microsoft.Net.Compilers.3.11.0\tools\csc.exe'
$ReferenceRoot = Join-Path $Tools 'Microsoft.NETFramework.ReferenceAssemblies.net452.1.0.3\build'
$FrameworkRefs = Join-Path $ReferenceRoot '.NETFramework\v4.5.2'
$MSBuild = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\MSBuild.exe'
$AcManagerOutput = Join-Path $AcTools 'AcManager.Tools\bin\x86\Release'
$Output = Join-Path $BridgeDir 'dist'

foreach ($required in @($Compiler, $FrameworkRefs, $MSBuild, $AcTools)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Dependencia ausente: $required" }
}

if (-not $SkipAcToolsBuild) {
    & $MSBuild (Join-Path $AcTools 'AcManager.Tools\AcManager.Tools.csproj') /t:Build /p:Configuration=Release /p:Platform=x86 /p:BuildInParallel=false /p:TargetFrameworkRootPath="$ReferenceRoot\" /p:CscToolPath="$(Split-Path $Compiler)\" /p:CscToolExe=csc.exe /m:1 /nr:false /v:minimal
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar AcManager.Tools' }
}

New-Item -ItemType Directory -Path $Output -Force | Out-Null
Get-ChildItem -LiteralPath $Output -File -ErrorAction SilentlyContinue | Remove-Item -Force

$references = @(
    (Join-Path $FrameworkRefs 'PresentationCore.dll'),
    (Join-Path $FrameworkRefs 'PresentationFramework.dll'),
    (Join-Path $FrameworkRefs 'WindowsBase.dll'),
    (Join-Path $AcManagerOutput 'AcManager.Tools.dll'),
    (Join-Path $AcTools 'AcTools\bin\x86\Release\AcTools.dll'),
    (Join-Path $AcTools 'FirstFloor.ModernUI\bin\x86\Release\FirstFloor.ModernUI.dll'),
    (Join-Path $AcTools 'Libraries\Newtonsoft.Json\Newtonsoft.Json.dll'),
    (Join-Path $AcTools 'Libraries\SharpCompress\SharpCompress.dll')
)

foreach ($reference in $references) {
    if (-not (Test-Path -LiteralPath $reference)) { throw "Referencia ausente: $reference" }
}

$referenceArguments = $references | ForEach-Object { '/reference:' + $_ }
$outputArgument = '/out:' + (Join-Path $Output 'bsr-actools-bridge.exe')
& $Compiler /nologo /target:exe /platform:x86 /optimize+ /langversion:7.3 $outputArgument $referenceArguments (Join-Path $BridgeDir 'Program.cs')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar bsr-actools-bridge.exe' }

Copy-Item -LiteralPath (Join-Path $BridgeDir 'bsr-actools-bridge.exe.config') -Destination $Output -Force

# Fechamento mínimo medido em execução para carro/pista e ZIP/7z/RAR.
$runtimeFiles = @(
    (Join-Path $AcManagerOutput 'AcManager.Tools.dll'),
    (Join-Path $AcManagerOutput 'AcManager.Internal.dll'),
    (Join-Path $AcTools 'AcTools\bin\x86\Release\AcTools.dll'),
    (Join-Path $AcTools 'AcTools.GenericMods\bin\x86\Release\AcTools.GenericMods.dll'),
    (Join-Path $AcTools 'FirstFloor.ModernUI\bin\x86\Release\FirstFloor.ModernUI.dll'),
    (Join-Path $AcTools 'Libraries\Newtonsoft.Json\Newtonsoft.Json.dll'),
    (Join-Path $AcTools 'Libraries\SharpCompress\SharpCompress.dll')
)
foreach ($runtimeFile in $runtimeFiles) {
    Copy-Item -LiteralPath $runtimeFile -Destination $Output -Force
}

$licenses = Join-Path $Output 'licenses'
New-Item -ItemType Directory -Path $licenses -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $AcTools 'LICENSE.txt') -Destination (Join-Path $licenses 'AcTools-Ms-PL.txt') -Force
Copy-Item -LiteralPath (Join-Path $AcTools 'AcManager\About\Licenses\FirstFloor.ModernUI\LICENSE.md') -Destination (Join-Path $licenses 'FirstFloor.ModernUI-Ms-PL.md') -Force
Copy-Item -LiteralPath (Join-Path $AcTools 'AcManager\About\Licenses\SharpCompress\LICENSE.md') -Destination (Join-Path $licenses 'SharpCompress-MIT.md') -Force
Copy-Item -LiteralPath (Join-Path $AcTools 'AcManager\About\Licenses\Json.NET\LICENSE.md') -Destination (Join-Path $licenses 'Json.NET-MIT.md') -Force
Copy-Item -LiteralPath (Join-Path $BridgeDir 'THIRD-PARTY-NOTICES.md') -Destination $Output -Force

$fixtures = Join-Path $BridgeDir 'fixtures'
New-Item -ItemType Directory -Path $fixtures -Force | Out-Null
$carZip = Join-Path $fixtures 'bsr_test_car.zip'
$trackZip = Join-Path $fixtures 'bsr_test_track.zip'
$legacyAppZip = Join-Path $fixtures 'bsr_test_legacy_app.zip'
Compress-Archive -Path (Join-Path $BridgeDir 'fixtures-src\car\*') -DestinationPath $carZip -Force
Compress-Archive -Path (Join-Path $BridgeDir 'fixtures-src\track\*') -DestinationPath $trackZip -Force
Compress-Archive -Path (Join-Path $BridgeDir 'fixtures-src\legacy-app\*') -DestinationPath $legacyAppZip -Force

Write-Host "Bridge: $Output\bsr-actools-bridge.exe"
Write-Host "Fixtures: $fixtures"
