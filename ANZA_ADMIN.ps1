$ErrorActionPreference = "Stop"
Write-Host "SmartHubPOS - usanidi wa mara ya kwanza" -ForegroundColor Cyan
Write-Host "Username ya akaunti mpya ya Super Admin: smarthubadmin"
Write-Host "Password ya kuanzia: SmartHub@2026!"
Write-Host "Hii itaweka username ya bootstrap kwenye deployment ya Convex uliyochagua." -ForegroundColor Yellow
$confirm = Read-Host "Andika NDIYO kuendelea"
if ($confirm -ne "NDIYO") { Write-Host "Imeghairiwa."; exit 1 }
npx convex env set SUPER_ADMIN_USERNAME smarthubadmin
if ($LASTEXITCODE -ne 0) { throw "Imeshindikana kuweka SUPER_ADMIN_USERNAME. Hakikisha umeingia Convex na deployment sahihi imechaguliwa." }
Write-Host "Sasa tunasawazisha Convex functions..." -ForegroundColor Cyan
npx convex dev --once
if ($LASTEXITCODE -ne 0) { throw "Convex sync imeshindwa. Angalia ujumbe hapo juu." }
Write-Host "Imekamilika. Fungua terminal mpya na endesha npm run dev." -ForegroundColor Green
Write-Host "Kwenye login bonyeza 'Sanidi akaunti ya kwanza ya msimamizi' mara moja, kisha submit credentials zilizojazwa." -ForegroundColor Green
