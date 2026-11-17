# Windows 一键安装：复制文件到安装目录、注册两个开机任务
# 用法：powershell -ExecutionPolicy Bypass -File install.ps1 -Dest C:\emotion-hub
param(
  [string]$Dest = "$env:USERPROFILE\emotion-hub",
  [string]$NodePath = "node.exe"
)

$ErrorActionPreference = 'Stop'
$Src = Split-Path -Parent $MyInvocation.MyCommand.Path
New-Item -ItemType Directory -Force -Path $Dest | Out-Null

Copy-Item "$Src\src" $Dest -Recurse -Force
Copy-Item "$Src\package.json" $Dest -Force
Copy-Item "$Src\README.md" $Dest -Force
if (-not (Test-Path "$Dest\config.json")) { Copy-Item "$Src\config.example.json" "$Dest\config.json" }

$nodeFull = (Get-Command $NodePath).Source

function Register-Task($Name, $Args) {
  $act = New-ScheduledTaskAction -Execute $nodeFull -Argument $Args -WorkingDirectory $Dest
  $trg = New-ScheduledTaskTrigger -AtStartup
  $prn = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  Register-ScheduledTask -TaskName $Name -Action $act -Trigger $trg -Principal $prn -Force | Out-Null
  Start-ScheduledTask -TaskName $Name
}

Register-Task 'EmotionHubHeartbeat' "$Dest\src\heartbeat.mjs"
Register-Task 'EmotionHubConsumer' "$Dest\src\consumer.mjs"
Register-Task 'EmotionHubDashboard' "$Dest\src\dashboard.mjs"

Write-Host "装好了。"
Write-Host "1) 编辑 $Dest\config.json 填 token 和目标 QQ"
Write-Host "2) 心跳任务：EmotionHubHeartbeat（每分钟一拍，投中会写 wake.flag）"
Write-Host "3) 看板任务：EmotionHubDashboard（默认 http://127.0.0.1:8095）"
Write-Host "4) 想让外网也能看，用 cloudflared tunnel --url http://127.0.0.1:8095"
