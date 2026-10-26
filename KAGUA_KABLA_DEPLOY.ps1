$ErrorActionPreference = 'Stop'
$log = Join-Path $PSScriptRoot ("verification-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
Start-Transcript -Path $log -Force | Out-Null
try {
  Write-Host "SmartHubPOS pre-deployment checks. This script does NOT deploy or change Convex production." -ForegroundColor Cyan
  $nodeText = (& node -p "process.versions.node") 2>$null
  if (-not $nodeText) { throw "Node.js haipatikani. Sakinisha Node.js 22.22.2+ au toleo la LTS linaloungwa mkono, kisha fungua PowerShell mpya." }
  $v = [version]$nodeText
  if ($v -lt [version]'22.22.2') { throw "Node.js $nodeText ni ya zamani kwa baadhi ya dependencies. Tumia Node.js 22.22.2+ (au LTS inayoungwa mkono), kisha endesha script tena." }
  Write-Host "Node.js: $nodeText"
  Write-Host "1/5 npm ci" -ForegroundColor Yellow
  npm ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci imeshindwa. Angalia registry/network na log." }
  Write-Host "2/5 TypeScript" -ForegroundColor Yellow
  npx tsc -b
  if ($LASTEXITCODE -ne 0) { throw "TypeScript type-check imeshindwa." }
  Write-Host "3/5 ESLint" -ForegroundColor Yellow
  npm run lint
  if ($LASTEXITCODE -ne 0) { throw "Lint imeshindwa." }
  Write-Host "4/5 Tests" -ForegroundColor Yellow
  npm test
  if ($LASTEXITCODE -ne 0) { throw "Tests zimeshindwa." }
  Write-Host "5/5 Production build" -ForegroundColor Yellow
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Production build imeshindwa." }
  Write-Host "CHECKS ZOTE ZIMEPITA. Hakuna deployment iliyofanyika." -ForegroundColor Green
} catch {
  Write-Host "CHECK IMESIMAMA: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Tuma log hii kwa ukaguzi: $log" -ForegroundColor Yellow
  exit 1
} finally {
  Stop-Transcript | Out-Null
}
