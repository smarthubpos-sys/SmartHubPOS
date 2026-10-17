$ErrorActionPreference = "Stop"
Write-Host "SmartHubPOS - usanidi wa mara ya kwanza" -ForegroundColor Cyan
$adminUser = (Read-Host "Chagua username ya Super Admin (herufi ndogo/namba, 3-32, bila nafasi)").Trim().ToLower()
if ($adminUser -notmatch '^[a-z0-9][a-z0-9._-]{2,31}$') { Write-Host "Username si sahihi." -ForegroundColor Red; exit 1 }
Write-Host "Hii itaweka SUPER_ADMIN_USERNAME=$adminUser kwenye deployment ya Convex uliyochagua." -ForegroundColor Yellow
Write-Host "Password utaichagua mwenyewe kwenye skrini ya kwanza ya login (angalau herufi 10). Hakuna password ya default." -ForegroundColor Yellow
$confirm = Read-Host "Andika NDIYO kuendelea"
if ($confirm -ne "NDIYO") { Write-Host "Imeghairiwa."; exit 1 }
npx convex env set SUPER_ADMIN_USERNAME $adminUser
if ($LASTEXITCODE -ne 0) { throw "Imeshindikana kuweka SUPER_ADMIN_USERNAME. Hakikisha umeingia Convex na deployment sahihi imechaguliwa." }
Write-Host "Sasa tunasawazisha Convex functions..." -ForegroundColor Cyan
npx convex dev --once
if ($LASTEXITCODE -ne 0) { throw "Convex sync imeshindwa. Angalia ujumbe hapo juu." }
Write-Host "Imekamilika. Fungua terminal mpya na endesha npm run dev." -ForegroundColor Green
Write-Host "Kwenye login chagua usajili wa kwanza wa msimamizi, tumia username uliyochagua na password yako mwenyewe." -ForegroundColor Green
