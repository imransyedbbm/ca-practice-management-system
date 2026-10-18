$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is missing. Install Node.js 20 LTS or newer, then reopen Windows Terminal.' }
if (-not (Test-Path '.env')) { Copy-Item '.env.example' '.env'; Write-Host 'Created .env from .env.example. Demo mode works without Supabase credentials.' -ForegroundColor Yellow }
if (-not (Test-Path 'node_modules')) { npm install }
npm run dev
