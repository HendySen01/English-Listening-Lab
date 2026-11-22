$ErrorActionPreference = "Stop"
$root = "D:\Projects\English-Listening-Lab"
Set-Location $root
$env:npm_config_cache = "$root\.cache\npm"
$env:DATABASE_URL = "file:D:/Projects/English-Listening-Lab/data/lab.db"
if (-not (Test-Path "$root\node_modules")) {
  npm install
}
npm run db:push -w @lab/server
npm run dev
