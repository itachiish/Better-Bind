# ============================================================================
#  Publie une mise à jour de Better-Bind sur GitHub (= tous les amis l'auront).
#  Étapes : build -> copie dist -> version.json (depuis BUILD_VERSION) ->
#           commit + push -> régénère l'exe.
#  Avant de lancer : incrémente BUILD_VERSION dans index.tsx.
# ============================================================================
$ErrorActionPreference = "Stop"

$proj = "C:\Users\itachi\Desktop\Dev\Bot DC\Better-Bind"
$venc = "C:\Users\itachi\Desktop\Dev\Vencord"
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User") + ";$env:APPDATA\npm"

# 0. Synchroniser la source vers le userplugin Vencord (au cas où)
Copy-Item "$proj\index.tsx","$proj\style.css","$proj\native.ts" "$venc\src\userplugins\Better-Bind\" -Force

# 1. Lire BUILD_VERSION dans index.tsx
$idx = Get-Content "$proj\index.tsx" -Raw
$m = [regex]::Match($idx, 'BUILD_VERSION\s*=\s*(\d+)')
if (-not $m.Success) { throw "BUILD_VERSION introuvable dans index.tsx" }
$ver = [int]$m.Groups[1].Value
Write-Host "Publication de la version $ver..." -ForegroundColor Cyan

# 2. Build
Set-Location $venc
pnpm build | Out-Null

# 3. Copier les fichiers runtime du build -> proj\dist
$dist = Join-Path $proj "dist"
New-Item -ItemType Directory -Force -Path $dist | Out-Null
Get-ChildItem "$venc\dist" -File | Where-Object {
    $_.Extension -ne ".map" -and $_.Name -notlike "*.LEGAL.txt" -and $_.Name -ne "etag.txt"
} | ForEach-Object { Copy-Item $_.FullName $dist -Force }

# 4. version.json (= BUILD_VERSION)
Set-Content (Join-Path $proj "version.json") ('{"version": ' + $ver + '}') -Encoding UTF8 -NoNewline

# 5. Commit + push
Set-Location $proj
git add -A
git commit -m "Build v$ver"
git push

# 6. Régénérer l'exe autonome (pour les nouvelles installations)
powershell -NoProfile -ExecutionPolicy Bypass -File "$proj\build-installer.ps1" | Select-Object -Last 1

Write-Host "`nPublie ! version $ver poussee sur GitHub. Les amis l'auront au prochain demarrage de Discord." -ForegroundColor Green
