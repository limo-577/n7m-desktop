#!/usr/bin/env python3
"""Assemble the exact source inputs, patches, and notices for the shipped LGPL build."""

from __future__ import annotations

import hashlib
import json
import re
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "node_modules" / ".cache"
VCPKG = CACHE / "vcpkg-2026.06.01"
DOWNLOADS = VCPKG / "downloads"
FFMPEG_SOURCE = DOWNLOADS / "ffmpeg-ffmpeg-n8.1.3.tar.gz"
LAME_SOURCE = DOWNLOADS / "lame-3.100.tar.gz"
PORTS = ROOT / "scripts" / "ffmpeg-minimal" / "ports"
METADATA = ROOT / "resources" / "ffmpeg"
OUTPUT = ROOT / "dist" / "ffmpeg-8.1.3-wav-pcm-mp3-source-x64-windows-lgpl.zip"


def digest(path: Path, algorithm: str = "sha512") -> str:
    hasher = hashlib.new(algorithm)
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def assert_recipe_hash(source: Path, recipe: Path) -> str:
    text = recipe.read_text(encoding="utf-8")
    match = re.search(r"SHA512\s+([0-9a-f]{128})", text, re.IGNORECASE)
    if not match:
        raise RuntimeError(f"Could not find a pinned SHA-512 in {recipe}")
    actual = digest(source)
    expected = match.group(1).lower()
    if actual != expected:
        raise RuntimeError(f"Source checksum mismatch for {source.name}: {actual}")
    return actual


def main() -> None:
    build_info = json.loads((METADATA / "BUILD_INFO").read_text(encoding="utf-8"))
    if build_info.get("version") != "8.1.3" or build_info.get("license") != "LGPL-3.0-or-later":
        raise RuntimeError("Runtime metadata is not the approved FFmpeg 8.1.3 LGPL build")

    ffmpeg_port = PORTS / "ffmpeg"
    lame_port = PORTS / "mp3lame"
    ffmpeg_sha512 = assert_recipe_hash(FFMPEG_SOURCE, ffmpeg_port / "portfile.cmake")
    lame_sha512 = assert_recipe_hash(LAME_SOURCE, lame_port / "portfile.cmake")

    entries: list[tuple[Path, str]] = []

    def add_file(source: Path, archive_name: str) -> None:
        if not source.is_file():
            raise FileNotFoundError(source)
        entries.append((source, archive_name.replace("\\", "/")))

    def add_tree(source: Path, archive_prefix: str) -> None:
        if not source.is_dir():
            raise FileNotFoundError(source)
        for item in sorted(source.rglob("*")):
            if item.is_file():
                add_file(item, f"{archive_prefix}/{item.relative_to(source).as_posix()}")

    add_file(FFMPEG_SOURCE, "sources/ffmpeg-ffmpeg-n8.1.3.tar.gz")
    add_file(LAME_SOURCE, "sources/lame-3.100.tar.gz")

    # Official FFmpeg release archive and detached signature are included as an
    # independent upstream reference; the vcpkg GitHub-tag archive above is the
    # exact source input used by this build.
    official = CACHE / "ffmpeg-8.1.3"
    for name in ("ffmpeg-8.1.3.tar.xz", "ffmpeg-8.1.3.tar.xz.asc", "ffmpeg-devel.asc"):
        candidate = official / name
        if candidate.is_file():
            add_file(candidate, f"upstream-reference/{name}")

    add_tree(ffmpeg_port, "recipes/overlay/ports/ffmpeg")
    add_tree(PORTS / "ffmpeg-bin2c", "recipes/overlay/ports/ffmpeg-bin2c")
    add_tree(lame_port, "recipes/overlay/ports/mp3lame")
    add_file(ROOT / "scripts" / "ffmpeg-minimal" / "build-local.ps1", "recipes/build-local.ps1")
    add_file(ROOT / "scripts" / "ffmpeg-minimal" / "stage-runtime.js", "recipes/stage-runtime.js")
    add_file(ROOT / "scripts" / "ensure-ffmpeg.js", "recipes/ensure-ffmpeg.js")

    for name in (
        "BUILD_INFO", "CONTROL", "DEPENDENCIES-MINIMAL.txt", "LICENSE.txt",
        "LAME-LICENSE.txt", "NOTICE.txt", "PROVENANCE.md", "vcpkg.spdx.json",
    ):
        add_file(METADATA / name, f"binary-metadata/{name}")

    vcpkg_head = (
        VCPKG / ".git" / "HEAD"
    ).read_text(encoding="utf-8").strip()
    vcpkg_commit = __import__("subprocess").check_output(
        ["git", "-C", str(VCPKG), "rev-parse", "HEAD"], text=True
    ).strip()
    vcpkg_version = __import__("subprocess").check_output(
        [str(VCPKG / "vcpkg.exe"), "version"], text=True
    ).splitlines()[0].strip()

    source_hashes = (
        f"{ffmpeg_sha512}  sources/ffmpeg-ffmpeg-n8.1.3.tar.gz\n"
        f"{lame_sha512}  sources/lame-3.100.tar.gz\n"
    )
    checksums_path = CACHE / "ffmpeg-minimal-source-sha512.txt"
    checksums_path.write_text(source_hashes, encoding="utf-8", newline="\n")
    add_file(checksums_path, "SOURCE-SHA512.txt")

    revision = (
        "FFmpeg source tag: n8.1.3\n"
        f"FFmpeg source archive SHA-512: {ffmpeg_sha512}\n"
        "LAME source version: 3.100\n"
        f"LAME source archive SHA-512: {lame_sha512}\n"
        f"vcpkg port repository commit: {vcpkg_commit}\n"
        f"vcpkg executable version: {vcpkg_version}\n"
        f"vcpkg repository HEAD ref: {vcpkg_head}\n"
        "FFmpeg overlay package version: 8.1.3#3\n"
        "Triplet: x64-windows\n"
        "Runtime linkage: FFmpeg and LAME DLLs; MSVC runtime dynamic (/MD)\n"
    )
    revision_path = CACHE / "ffmpeg-minimal-build-revision.txt"
    revision_path.write_text(revision, encoding="utf-8", newline="\n")
    add_file(revision_path, "BUILD-REVISION.txt")

    readme = f"""# FFmpeg 8.1.3 minimal LGPL corresponding source

This source archive accompanies the Windows x64 FFmpeg binary used by the application. The FFmpeg CLI is dynamically linked to FFmpeg libraries and LAME. Its supported conversion is locally generated PCM S16LE WAV to MP3. It enables only the WAV demuxer, PCM S16LE decoder, MP3 muxer, LAME encoder, and `file` protocol. Parsers, bitstream filters, devices, hardware acceleration, network protocols, `ffprobe`, and `ffplay` are disabled. FFmpeg's CLI automatically includes a small built-in set of audio filters and basic video filters; their exact names are recorded in `binary-metadata/BUILD_INFO`. The application invokes a fixed audio-only argument list and never passes user-controlled filter expressions.

## Exact source inputs

- `sources/ffmpeg-ffmpeg-n8.1.3.tar.gz` is the source archive verified against the pinned FFmpeg overlay recipe (SHA-512 in `SOURCE-SHA512.txt`).
- `sources/lame-3.100.tar.gz` is the source archive verified against the pinned vcpkg `mp3lame` recipe (SHA-512 in `SOURCE-SHA512.txt`).
- `recipes/overlay/` contains the exact FFmpeg, `ffmpeg-bin2c`, and LAME overlays, including every applied patch and the application-specific minimal component configuration. `recipes/build-local.ps1`, `recipes/stage-runtime.js`, and `recipes/ensure-ffmpeg.js` provide the local build workaround, runtime staging, and allowlist validation scripts.
- `binary-metadata/` contains license texts, dependency inventory, build details, provenance, and the FFmpeg SPDX manifest.
- `upstream-reference/` contains the official FFmpeg release archive and detached signature when present. The GitHub-tag tarball under `sources/` is the exact FFmpeg input used by the build.

## Build environment and exact revisions

- vcpkg port source repository commit: `{vcpkg_commit}`.
- vcpkg executable used for this build: `{vcpkg_version}`. The executable predates the repository checkout; both revisions are recorded because the port recipes came from the repository checkout while the build was run by that executable.
- FFmpeg overlay package: `8.1.3#3`, triplet `x64-windows`.
- LAME: `3.100#17`.
- Compiler: Microsoft Visual C++ 2022, MSVC 19.44.35222, Windows SDK 10.0.26100.0.
- Build tools: CMake 4.3.2, Ninja 1.13.2, MSYS2 make 4.4.1, pkgconf 2.5.1.

Install Visual Studio 2022 Build Tools with the C++ workload and Windows SDK. The source build uses the pinned vcpkg port repository revision below and the included overlay. The GitHub tag source archive is the exact FFmpeg input; no third-party FFmpeg executable is used. The binary was compiled locally with MSVC 19.44.35222. `build-local.ps1` is an optional workaround for the original development workspace and its cached build tools; use the direct command below on a clean build machine.

```powershell
$SourceRoot = (Get-Location).Path
$ToolRoot = Join-Path $PWD 'vcpkg-tool'
git clone https://github.com/microsoft/vcpkg.git $ToolRoot
git -C $ToolRoot checkout d5b6777d666efc1a7f491babfcdab37794c1ae3e
& (Join-Path $ToolRoot 'bootstrap-vcpkg.bat') -disableMetrics
$VcpkgRoot = Join-Path $PWD 'vcpkg'
git clone https://github.com/microsoft/vcpkg.git $VcpkgRoot
git -C $VcpkgRoot checkout {vcpkg_commit}
$BuiltVcpkg = Join-Path $ToolRoot 'vcpkg.exe'
Copy-Item $BuiltVcpkg (Join-Path $VcpkgRoot 'vcpkg.exe') -Force
$Downloads = Join-Path $VcpkgRoot 'downloads'
$InstallRoot = Join-Path $PWD 'vcpkg-installed'
$OverlayPorts = Join-Path $SourceRoot 'recipes/overlay/ports'
New-Item -ItemType Directory -Path $Downloads -Force | Out-Null
Copy-Item "$SourceRoot/sources/*.tar.gz" $Downloads -Force
$env:VCPKG_DOWNLOADS = $Downloads
$env:VCPKG_BINARY_SOURCES = 'clear'
Push-Location $VcpkgRoot
try {{
  .\vcpkg.exe install 'ffmpeg[wav-mp3]' --triplet=x64-windows `
    --overlay-ports=$OverlayPorts --x-install-root=$InstallRoot
}} finally {{ Pop-Location }}
$env:N7M_APP_ROOT = '<path-to-n7m-desktop-checkout>'
$env:N7M_VCPKG_ROOT = $VcpkgRoot
$env:N7M_VCPKG_INSTALLED_TRIPLET = Join-Path $InstallRoot 'x64-windows'
$env:N7M_FFMPEG_PORTS_ROOT = $OverlayPorts
node (Join-Path $SourceRoot 'recipes/stage-runtime.js')
Push-Location $env:N7M_APP_ROOT
try {{ npm install; npm run dist }} finally {{ Pop-Location }}
```

The source build used vcpkg classic mode (`vcpkg install` without a root manifest). A `vcpkg-configuration.json` baseline is therefore not the package version selector for this build. The exact vcpkg executable and port repository commits are recorded separately above to make the tool/recipe revision difference explicit.

The FFmpeg runtime is LGPL-3.0-or-later; the dynamically linked LAME library is LGPL-2.0-only. Review both license texts in `binary-metadata/` before redistributing. The runtime DLLs are shipped beside `ffmpeg.exe` so recipients can replace the LGPL libraries with compatible versions. The application's bootstrap currently verifies the exact shipped hashes; rebuild the installer with matching updated `BUILD_INFO` after any library replacement.
"""
    readme_path = CACHE / "ffmpeg-minimal-source-README.md"
    readme_path.write_text(readme, encoding="utf-8", newline="\n")
    add_file(readme_path, "README.md")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    names = [archive_name for _, archive_name in entries]
    if len(names) != len(set(names)):
        raise RuntimeError("Duplicate archive paths detected")
    temporary = OUTPUT.with_suffix(".zip.part")
    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for source, name in sorted(entries, key=lambda item: item[1]):
            archive.write(source, name)
        # The inner hash file intentionally covers every archive payload except itself.
        checksum_lines = []
        for source, name in sorted(entries, key=lambda item: item[1]):
            checksum_lines.append(f"{digest(source, 'sha256')}  {name}")
        archive.writestr("CHECKSUMS.sha256", "\n".join(checksum_lines) + "\n")
    temporary.replace(OUTPUT)
    print(f"Created {OUTPUT} ({OUTPUT.stat().st_size:,} bytes; {len(entries)} files)")
    print(f"FFmpeg source SHA-512: {ffmpeg_sha512}")
    print(f"LAME source SHA-512: {lame_sha512}")
    outer_sha512 = digest(OUTPUT)
    OUTPUT.with_suffix(OUTPUT.suffix + ".sha512").write_text(
        f"{outer_sha512}  {OUTPUT.name}\n", encoding="utf-8", newline="\n"
    )
    print(f"Source bundle SHA-512: {outer_sha512}")


if __name__ == "__main__":
    main()
