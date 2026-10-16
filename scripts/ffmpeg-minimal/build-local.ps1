$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$VcpkgRoot = Join-Path $Root 'node_modules\.cache\vcpkg-2026.06.01'
$InstallRoot = Join-Path $Root 'node_modules\.cache\ffmpeg-minimal-installed'
$ToolsRoot = Join-Path $VcpkgRoot 'downloads\tools'
$VsDevCmd = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat'
$NinjaDir = Join-Path $ToolsRoot 'ninja-1.13.2-windows'
$CmakeBin = Join-Path $ToolsRoot 'cmake-4.3.2-windows\cmake-4.3.2-windows-x86_64\bin'
$SevenZipDir = Join-Path $ToolsRoot '7zip-26.01-windows'
$MsysRoot = Join-Path $ToolsRoot 'msys2\3e71d1f8e22ab23f'
$GetVars = Join-Path $InstallRoot 'x64-windows\share\vcpkg-cmake-get-vars\vcpkg_cmake_get_vars.cmake'
$NinjaHelper = Join-Path $VcpkgRoot 'scripts\cmake\vcpkg_find_acquire_program(NINJA).cmake'
$PortOverlay = Join-Path $Root 'scripts\ffmpeg-minimal\ports'
$Work = Join-Path $env:TEMP ('n7m-vcpkg-build-' + [guid]::NewGuid().ToString('N'))

foreach ($required in @($VcpkgRoot, $InstallRoot, $VsDevCmd, $GetVars, $NinjaHelper, $NinjaDir, $CmakeBin, $SevenZipDir, $MsysRoot, $PortOverlay)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Required local build path is missing: $required" }
}

New-Item -ItemType Directory -Path $Work | Out-Null
$GetVarsBackup = Join-Path $Work 'vcpkg_cmake_get_vars.cmake'
$NinjaBackup = Join-Path $Work 'vcpkg_find_acquire_program_NINJA.cmake'
Copy-Item -LiteralPath $GetVars -Destination $GetVarsBackup
Copy-Item -LiteralPath $NinjaHelper -Destination $NinjaBackup

try {
    $getVarsText = [IO.File]::ReadAllText($GetVars)
    $needle = 'SOURCE_PATH "${Z_VCPKG_CMAKE_GET_VARS_CURRENT_LIST_DIR}/cmake_get_vars"'
    if (-not $getVarsText.Contains($needle)) { throw 'Unexpected vcpkg CMake helper; refusing to patch it.' }
    $getVarsText = $getVarsText.Replace($needle, $needle + [Environment]::NewLine + '            GENERATOR "Ninja"')
    [IO.File]::WriteAllText($GetVars, $getVarsText, [Text.UTF8Encoding]::new($false))

    $ninjaPath = (Join-Path $NinjaDir 'ninja.exe').Replace('\', '/')
    $ninjaText = @(
        'set(program_name "ninja")'
        'set(search_names ninja.exe ninja)'
        ('set(NINJA "' + $ninjaPath + '" CACHE FILEPATH "" FORCE)')
    ) -join [Environment]::NewLine
    [IO.File]::WriteAllText($NinjaHelper, $ninjaText, [Text.UTF8Encoding]::new($false))

    $environmentLines = & cmd.exe /d /s /c ('call "' + $VsDevCmd + '" -arch=x64 -host_arch=x64 >nul && set')
    if ($LASTEXITCODE -ne 0) { throw 'Visual Studio developer environment initialization failed.' }
    foreach ($line in $environmentLines) {
        if ($line -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
    }
    if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) { throw 'MSVC cl.exe was not found after initializing the Visual Studio environment.' }

    $env:PATH = ($SevenZipDir, $CmakeBin, $NinjaDir, (Join-Path $MsysRoot 'usr\bin'), (Join-Path $MsysRoot 'mingw64\bin'), $env:PATH) -join ';'
    Remove-Item Env:VCPKG_FORCE_SYSTEM_BINARIES -ErrorAction SilentlyContinue
    $env:VCPKG_DOWNLOADS = Join-Path $VcpkgRoot 'downloads'
    $env:VCPKG_BINARY_SOURCES = 'clear'

    Push-Location $VcpkgRoot
    try {
        & .\vcpkg.exe install 'ffmpeg[wav-mp3]' --triplet=x64-windows --overlay-ports=$PortOverlay --x-install-root=$InstallRoot
        if ($LASTEXITCODE -ne 0) { throw "vcpkg install failed with exit code $LASTEXITCODE" }
    }
    finally { Pop-Location }
}
finally {
    Copy-Item -LiteralPath $GetVarsBackup -Destination $GetVars -Force
    Copy-Item -LiteralPath $NinjaBackup -Destination $NinjaHelper -Force
}
