# Launch parallel legacy swap quote shards (Windows PowerShell).
# Usage:
#   .\scripts\launchVolumeQuoteShards.ps1
#   .\scripts\launchVolumeQuoteShards.ps1 -ShardTotal 20
#   .\scripts\launchVolumeQuoteShards.ps1 -ShardTotal 30 -Concurrency 15
#
# Prerequisite: npm run stats:backfill-dump-swaps

param(
  [int]$ShardTotal = 20,
  [int]$Concurrency = 12
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$ManifestPath = Join-Path $Root "data\stats\volume-backfill-manifest.json"
if (-not (Test-Path $ManifestPath)) {
  Write-Error "Missing manifest at $ManifestPath - run: npm run stats:backfill-dump-swaps"
}

$manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
$manifest | Add-Member -NotePropertyName shardTotal -NotePropertyValue $ShardTotal -Force
$manifest | ConvertTo-Json -Depth 6 | Set-Content $ManifestPath -Encoding utf8NoBOM

$ShardDir = Join-Path $Root "data\stats\volume-shards"
New-Item -ItemType Directory -Force -Path $ShardDir | Out-Null

Write-Host "Launching $ShardTotal quote workers (concurrency $Concurrency each)..."
Write-Host "Logs: data\stats\volume-shards\shard-XX.log"
Write-Host ""

$procs = @()
for ($i = 0; $i -lt $ShardTotal; $i++) {
  $pad = "{0:D2}" -f $i
  $log = Join-Path $ShardDir "shard-$pad.log"
  $env:VOLUME_QUOTE_CONCURRENCY = "$Concurrency"
  $nodeScript = Join-Path $Root "scripts\backfillSwapVolumeFromChain.mjs"
  $cmdLine = "set VOLUME_QUOTE_CONCURRENCY=$Concurrency&& node `"$nodeScript`" --quote-only --shard $i/$ShardTotal > `"$log`" 2>&1"
  $p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $cmdLine -WorkingDirectory $Root `
    -PassThru -WindowStyle Hidden
  $procs += [PSCustomObject]@{ Index = $i; Id = $p.Id; Log = $log }
  if (($i + 1) % 5 -eq 0) { Start-Sleep -Milliseconds 500 }
}

Write-Host "Started $($procs.Count) workers."
$procs | Format-Table Index, Id, Log -AutoSize
Write-Host ""
Write-Host "Monitor: Get-Content data\stats\volume-shards\shard-00.log -Wait -Tail 5"
Write-Host "When all done: npm run stats:backfill-merge-shards"
Write-Host "Then: npm run stats:backfill-apply-volume"
