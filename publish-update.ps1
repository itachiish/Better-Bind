# ============================================================================
#  Publie une MAJ de Better-Bind (updater natif Vencord via Releases GitHub).
#  -> build standalone pointe sur le depot + Release GitHub + regen exe.
#  Les amis l'auront automatiquement (page Vencord Updater / au lancement).
#
#  POUR INTEGRER LA DERNIERE VERSION DE VENCORD (a faire de temps en temps) :
#    1. cd Vencord ; git stash ; git pull ; git stash pop
#       (git stash sauve nos retouches updater ; pop les replace.
#        si conflit -> applique vencord-patches\hide-repo.patch a la main)
#    2. VERIFIE que le plugin compile encore (pnpm exec tsc --noEmit) et teste.
#    3. Puis lance ce script normalement.
# ============================================================================
$ErrorActionPreference = "Stop"

$proj = "C:\Users\itachi\Desktop\Dev\Bot DC\Better-Bind"
$venc = "C:\Users\itachi\Desktop\Dev\Vencord"
$repo = "itachiish/Better-Bind"
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User") + ";$env:APPDATA\npm"

# 0. Synchroniser la source -> userplugin Vencord
Copy-Item "$proj\index.tsx","$proj\style.css" "$venc\src\userplugins\Better-Bind\" -Force

# 1. Type-check (on ne publie pas du code casse)
Set-Location $venc
$tc = pnpm exec tsc --noEmit 2>&1
if ($tc | Select-String -Pattern "error TS") {
    Write-Host "Erreurs TypeScript -> publication annulee :" -ForegroundColor Red
    $tc | Select-String -Pattern "error TS"
    exit 1
}

# 2. Commit (toujours un nouveau commit -> nouvelle version detectable) + push -> SHA
Set-Location $proj
git add -A
git commit --allow-empty -m "Build $(Get-Date -Format yyyy-MM-dd_HH-mm)" | Out-Null
git push | Out-Null
$sha = (git rev-parse --short HEAD).Trim()
Write-Host "Publication du build $sha..." -ForegroundColor Cyan

# 3. Build standalone, pointe sur le depot (remote masque sur la page)
Set-Location $venc
$env:VENCORD_REMOTE = $repo
$env:VENCORD_HASH = $sha
pnpm build --standalone | Out-Null

# 4. Release GitHub (le titre DOIT finir par le sha) + les 4 fichiers Discord desktop
$d = "$venc\dist"
Set-Location $proj
gh release create "build-$sha" `
    "$d\patcher.js" "$d\preload.js" "$d\renderer.js" "$d\renderer.css" `
    --title "Better-Bind $sha" --notes "Build $sha" | Out-Null

# 5. Regenerer l'exe (pour les nouvelles installations)
powershell -NoProfile -ExecutionPolicy Bypass -File "$proj\build-installer.ps1" | Select-Object -Last 1

Write-Host "`nPublie ! build $sha pousse. Les amis verront la MAJ via la page Vencord Updater (ou au lancement)." -ForegroundColor Green
