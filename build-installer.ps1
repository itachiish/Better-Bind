# ============================================================================
#  Fabrique l'installeur .exe de Better-Bind (a executer cote DEV, pas l'ami)
#  - empaquette le build Vencord (plugin inclus, sans les .map) dans l'exe
#  - l'exe final telecharge le patcheur officiel et injecte tout dans Discord
# ============================================================================
$ErrorActionPreference = "Stop"

$distSrc   = "C:\Users\itachi\Desktop\Dev\Vencord\dist"
$outDir    = "C:\Users\itachi\Desktop\Dev\Bot DC\Better-Bind\build"
$exeOut    = "C:\Users\itachi\Desktop\VencordInstaller.exe"
$ps1Out    = Join-Path $outDir "installer.ps1"

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# --- 1. Staging des fichiers runtime (on exclut .map et .LEGAL.txt) ----------
Write-Host "1) Staging des fichiers du build..." -ForegroundColor Cyan
$stage = Join-Path $env:TEMP "bb-payload"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
$stageDist = Join-Path $stage "dist"
New-Item -ItemType Directory -Force -Path $stageDist | Out-Null
Get-ChildItem $distSrc -File | Where-Object {
    $_.Extension -ne ".map" -and $_.Name -notlike "*.LEGAL.txt" -and $_.Name -ne "etag.txt"
} | ForEach-Object { Copy-Item $_.FullName $stageDist -Force }
$files = (Get-ChildItem $stageDist -File | Measure-Object).Count
Write-Host "   $files fichiers stages." -ForegroundColor Green

# --- 2. Zip + base64 ---------------------------------------------------------
Write-Host "2) Compression + encodage..." -ForegroundColor Cyan
$zip = Join-Path $env:TEMP "bb-dist.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip)
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($zip))
Write-Host ("   zip = {0:N0} Ko, base64 = {1:N0} Ko" -f ((Get-Item $zip).Length/1KB), ($b64.Length/1KB)) -ForegroundColor Green

# --- 3. Generation du installer.ps1 (template + payload) ---------------------
Write-Host "3) Generation du installer.ps1..." -ForegroundColor Cyan
$template = @'
$ErrorActionPreference = "Stop"
$AppName = "Better-Bind"
$InstallDir = Join-Path $env:LOCALAPPDATA "BetterBind"

function Info($m){ Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Ok($m){ Write-Host "  [OK] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "  [!] $m" -ForegroundColor Yellow }

Write-Host ""
Write-Host "==================================================" -ForegroundColor Magenta
Write-Host "   Installeur Better-Bind pour Discord" -ForegroundColor Magenta
Write-Host "   1 clic = 1 commande. Aucun envoi automatique." -ForegroundColor Magenta
Write-Host "==================================================" -ForegroundColor Magenta

try {
    # 1) Extraire le build embarque
    Info "Installation des fichiers"
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    $zip = Join-Path $env:TEMP "bb-dist.zip"
    [IO.File]::WriteAllBytes($zip, [Convert]::FromBase64String($PAYLOAD))
    if (Test-Path (Join-Path $InstallDir "dist")) { Remove-Item (Join-Path $InstallDir "dist") -Recurse -Force }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $InstallDir)
    Remove-Item $zip -Force
    Ok "Build installe dans $InstallDir"

    # 2) Telecharger le patcheur officiel Vencord
    Info "Telechargement du patcheur officiel"
    $cli = Join-Path $InstallDir "VencordInstallerCli.exe"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest "https://github.com/Vencord/Installer/releases/latest/download/VencordInstallerCli.exe" -OutFile $cli -UseBasicParsing
    Ok "Patcheur pret"

    # 3) Fermer Discord
    Info "Fermeture de Discord"
    Get-Process -Name Discord -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2

    # 4) Injecter (pointe vers notre build local)
    Info "Injection dans Discord"
    $env:VENCORD_USER_DATA_DIR = $InstallDir
    $env:VENCORD_DEV_INSTALL = "1"
    # Le patcheur ecrit ses loges (INFO...) sur stderr : on ne doit PAS prendre
    # ca pour une erreur. On bascule en mode souple et on teste le code de sortie.
    $ErrorActionPreference = "Continue"
    & $cli -install -branch stable 2>&1 | ForEach-Object { Write-Host "  $_" }
    $code = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    if ($code -ne 0) { throw "Le patcheur Vencord a echoue (code $code). Discord Stable est-il installe ?" }
    Ok "Discord patche"

    # 5) Activer le plugin -- SANS jamais ecraser une config Vencord existante.
    #    On insere uniquement l'entree du plugin (edition chirurgicale du texte),
    #    le reste de la config de l'utilisateur reste intact octet pour octet.
    Info "Activation du plugin"
    $sd = Join-Path $env:APPDATA "Vencord\settings"
    $sf = Join-Path $sd "settings.json"
    New-Item -ItemType Directory -Force -Path $sd | Out-Null

    # $entry = l'objet "Better-Bind":{...} avec la config de l'auteur (bake a la generation).
    $entry = '<<BB_ENTRY>>'
    if (-not (Test-Path $sf) -or [string]::IsNullOrWhiteSpace((Get-Content $sf -Raw))) {
        # Aucune config : config complete. "uiElements" OBLIGATOIRE (sinon la barre plante).
        $fresh = '{"autoUpdate":true,"autoUpdateNotification":true,"plugins":{' + $entry + '},"uiElements":{"chatBarButtons":{"better-bind":{"enabled":true}},"messagePopoverButtons":{}}}'
        Set-Content $sf $fresh -Encoding UTF8 -NoNewline
        Ok "Config creee (config de l'auteur appliquee)"
    } else {
        $raw = Get-Content $sf -Raw
        if ($raw -match '"Better-Bind"') {
            Ok "Plugin deja present (config inchangee)"
        } else {
            # Insertion LITTERALE (pas de regex : les commandes contiennent des '$').
            $i = $raw.IndexOf('"plugins"')
            $b = if ($i -ge 0) { $raw.IndexOf('{', $i) } else { -1 }
            if ($b -lt 0) {
                Warn "Format de config inattendu : active 'Better-Bind' manuellement dans Parametres > Vencord > Plugins."
            } else {
                $rest = $raw.Substring($b + 1)
                $sep = if ($rest.TrimStart().StartsWith('}')) { '' } else { ',' }
                $new = $raw.Substring(0, $b + 1) + $entry + $sep + $rest
                Set-Content $sf $new -Encoding UTF8 -NoNewline
                Ok "Plugin active (config de l'auteur appliquee, reste preserve)"
            }
        }
    }

    # 6) Relancer Discord
    Info "Redemarrage de Discord"
    $u = Join-Path $env:LOCALAPPDATA "Discord\Update.exe"
    if (Test-Path $u) { Start-Process $u -ArgumentList "--processStart","Discord.exe" }
    Ok "Discord relance"

    Write-Host ""
    Write-Host "==================================================" -ForegroundColor Green
    Write-Host "   TERMINE !  Les boutons apparaissent au-dessus" -ForegroundColor Green
    Write-Host "   du champ de message dans Discord." -ForegroundColor Green
    Write-Host "   Reglages : Parametres > Vencord > Plugins" -ForegroundColor Green
    Write-Host "   > Better-Bind > icone engrenage." -ForegroundColor Green
    Write-Host "==================================================" -ForegroundColor Green
}
catch {
    Write-Host ""
    Warn ("Une erreur est survenue : " + $_.Exception.Message)
    Warn "Verifie que Discord (version Stable) est bien installe, puis relance."
}
Write-Host ""
Read-Host "Appuyez sur Entree pour fermer"
'@

# L'installeur active juste le plugin. La config par DEFAUT vient du build
# (profil 1 = config actuelle de l'auteur, profil 2 = ancienne config), figee dans le code.
$bbEntry = '"Better-Bind":{"enabled":true}'

# Injecte le payload base64 + remplit le placeholder
$final = "`$PAYLOAD = '$b64'`r`n" + $template
$final = $final.Replace('<<BB_ENTRY>>', $bbEntry)
Set-Content -Path $ps1Out -Value $final -Encoding UTF8
Write-Host "   installer.ps1 ecrit ($([math]::Round((Get-Item $ps1Out).Length/1KB)) Ko)." -ForegroundColor Green

# --- 4. ps2exe ---------------------------------------------------------------
Write-Host "4) Installation de ps2exe (si besoin) + compilation..." -ForegroundColor Cyan
if (-not (Get-Module -ListAvailable -Name ps2exe)) {
    try { Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser | Out-Null } catch {}
    Set-PSRepository -Name PSGallery -InstallationPolicy Trusted -ErrorAction SilentlyContinue
    Install-Module -Name ps2exe -Scope CurrentUser -Force
}
Import-Module ps2exe
if (Test-Path $exeOut) { Remove-Item $exeOut -Force }
Invoke-ps2exe -inputFile $ps1Out -outputFile $exeOut -title "Vencord Installer" -description "Vencord (avec le plugin Better-Bind)" -company "Vencord" | Out-Null

if (Test-Path $exeOut) {
    Write-Host ("`nEXE CREE : {0} ({1:N0} Ko)" -f $exeOut, ((Get-Item $exeOut).Length/1KB)) -ForegroundColor Green
} else {
    Write-Host "`nEchec de la creation de l'exe." -ForegroundColor Red
}
