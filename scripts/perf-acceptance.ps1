# Q-01 性能验收：release 构建 → 体积 → 命令往返 → 冷/热启动。
#
#   pwsh -File scripts/perf-acceptance.ps1              # 全跑（含 pnpm tauri build）
#   pwsh -File scripts/perf-acceptance.ps1 -SkipBuild   # 复用已有产物
#
# 量的是真东西：
#   * 启动数字由应用自己产出（进程起点 → 首屏可交互），来源见 src-tauri/src/perf.rs，
#     经 stdout 的 [perf] 行读回；
#   * 命令往返在一条预置了 2000+ 行的验收库上逐条跑（src-tauri 的 perf 测试）；
#   * 全程用 ORDO_DB 指向验收库，不读写也不影响你自己的数据。
#
# 目标值（PRODUCT §8）：冷启动 < 1.5s、热启动 < 0.5s、命令往返 < 50ms（统计 < 1s）、
# 安装包 < 30 MB。
param(
    [switch]$SkipBuild,
    [int]$Runs = 3
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$srcTauri = Join-Path $root "src-tauri"
$exe = Join-Path $srcTauri "target\release\ordo.exe"
$dbPath = Join-Path $srcTauri "target\perf\ordo.db"
$logDir = Join-Path $srcTauri "target\perf\logs"

$COLD_BUDGET_MS = 1500
$HOT_BUDGET_MS = 500
$SIZE_BUDGET_MB = 30

function Write-Step($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }

if (Get-Process ordo -ErrorAction SilentlyContinue) {
    throw "先退出正在运行的 Ordo（托盘菜单 → 退出 Ordo）：验收要独占启动计时。"
}

# 锁屏时 Windows 会限制窗口创建与 WebView 渲染，量出来的启动时间是解锁时的 2–4 倍
# （本机实测：同一份二进制，解锁 730 ms、锁屏 2.2 s）。判定用「当前输入桌面名」：
# 锁屏时它是 Winlogon 而不是 Default；按进程名判不行——解锁后 LockApp 仍在。
Add-Type -Namespace Ordo -Name Session -MemberDefinition @'
[DllImport("user32.dll", SetLastError = true)] public static extern IntPtr OpenInputDesktop(int flags, bool inherit, int access);
[DllImport("user32.dll", SetLastError = true)] public static extern bool CloseDesktop(IntPtr handle);
[DllImport("user32.dll", SetLastError = true)] public static extern bool GetUserObjectInformation(IntPtr handle, int index, System.Text.StringBuilder info, int length, out int needed);
'@

function Test-SessionLocked {
    $desktop = [Ordo.Session]::OpenInputDesktop(0, $false, 0x0001)   # DESKTOP_READOBJECTS
    if ($desktop -eq [IntPtr]::Zero) { return $true }
    try {
        $name = New-Object System.Text.StringBuilder 256
        $needed = 0
        [void][Ordo.Session]::GetUserObjectInformation($desktop, 2, $name, 512, [ref]$needed)   # UOI_NAME
        return ($name.ToString() -ne "Default")
    } finally { [void][Ordo.Session]::CloseDesktop($desktop) }
}

if (Test-SessionLocked) {
    throw "当前会话已锁屏：解锁屏幕后再跑，否则启动时间不可用（锁屏会把它放大 2–4 倍）。"
}

if (-not $SkipBuild) {
    Write-Step "release 构建 + 打包"
    Push-Location $root
    pnpm tauri build
    if ($LASTEXITCODE -ne 0) { throw "pnpm tauri build 失败" }
    Pop-Location
}

if (-not (Test-Path $exe)) { throw "找不到 $exe；先跑一次不带 -SkipBuild 的验收。" }

$failures = @()   # 每项是一条「超预算」结论；全部量完再一起报

Write-Step "体积（安装包 < $SIZE_BUDGET_MB MB）"
$artifacts = Get-ChildItem (Join-Path $srcTauri "target\release\bundle") -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in ".msi", ".exe", ".deb", ".rpm", ".AppImage", ".dmg" }
$artifacts | Sort-Object Length | ForEach-Object {
    "{0,8:N1} MB  {1}" -f ($_.Length / 1MB), $_.FullName.Replace("$root\", "")
}
$binary = Get-Item $exe
"{0,8:N1} MB  {1}（裸二进制，未压缩）" -f ($binary.Length / 1MB), $exe.Replace("$root\", "")
$largest = ($artifacts | Measure-Object Length -Maximum).Maximum / 1MB
if ($largest -gt $SIZE_BUDGET_MB) {
    $failures += "安装包 $([Math]::Round($largest, 1)) MB 超出 $SIZE_BUDGET_MB MB 预算"
}

Write-Step "命令往返（验收库 + 逐条命令预算；失败即超预算）"
Push-Location $srcTauri
cargo test --release perf -- --ignored --nocapture --test-threads=1
if ($LASTEXITCODE -ne 0) { $failures += "有命令超出往返预算（见上面的 [perf] 表）" }
Pop-Location

Write-Step "启动（进程启动 → 首屏可交互；冷启动 < $COLD_BUDGET_MS ms，热启动 < $HOT_BUDGET_MS ms）"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$env:ORDO_PERF = "1"
$env:ORDO_DB = $dbPath
$starts = @()
for ($run = 1; $run -le $Runs; $run++) {
    $log = Join-Path $logDir "run$run.log"
    Remove-Item $log -ErrorAction SilentlyContinue
    $process = Start-Process -FilePath $exe -RedirectStandardOutput $log -PassThru
    $ms = $null
    for ($tick = 0; $tick -lt 300 -and $null -eq $ms; $tick++) {
        Start-Sleep -Milliseconds 100
        if (Test-Path $log) {
            $hit = Select-String -Path $log -Pattern "startup-to-interactive\s*:\s*([\d.]+)" |
                Select-Object -First 1
            if ($hit) { $ms = [double]$hit.Matches[0].Groups[1].Value }
        }
    }
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
    if ($null -eq $ms) { throw "第 $run 次启动没等到 [perf] 行，看 $log" }
    $starts += $ms
    $kind = if ($run -eq 1) { "冷启动" } else { "热启动" }
    "{0,8:N0} ms  {1}（第 {2} 次）" -f $ms, $kind, $run
}
# 第一次启动跑在刚构建完的产物上，磁盘缓存是热的，所以它是冷启动的下界而非
# 真正的重启后冷启动；热启动取其后各次的最大值。
if ($starts[0] -gt $COLD_BUDGET_MS) {
    $failures += "冷启动 $($starts[0]) ms 超出 $COLD_BUDGET_MS ms 预算"
}
$hot = ($starts | Select-Object -Skip 1 | Measure-Object -Maximum).Maximum
if ($null -ne $hot -and $hot -gt $HOT_BUDGET_MS) {
    $failures += "热启动 $hot ms 超出 $HOT_BUDGET_MS ms 预算"
}

Write-Step "第 1 次的明细"
Get-Content (Join-Path $logDir "run1.log") | Select-String -Pattern "\[perf\]" | ForEach-Object { $_.Line }

if ($failures.Count -gt 0) {
    Write-Host "`n超预算：" -ForegroundColor Red
    $failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    throw "验收未通过（$($failures.Count) 项）"
}
Write-Host "`n全部在预算内。" -ForegroundColor Green
