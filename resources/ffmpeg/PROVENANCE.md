# Minimal FFmpeg build provenance

- Built locally from upstream FFmpeg tag `n8.1.3` using the pinned vcpkg source overlay; this is not a third-party prebuilt binary.
- FFmpeg source archive SHA-512: 8c667090bcdc70796caaa8cdc2cf82e57d7c7f6feedcb0ec7251cefd6a0c63b7cad203a86c800d3e2f69ca91255167aa4e631701060b96d576d1a9666ca7aafe.
- LAME source archive SHA-512: 0844b9eadb4aacf8000444621451277de365041cc1d97b7f7a589da0b7a23899310afd4e4d81114b9912aa97832621d20588034715573d417b2923948c08634b.
- vcpkg port repository commit: f3e10653cc27d62a37a3763cd84b38bca07c6075; executable: vcpkg package management program version 2026-05-27-d5b6777d666efc1a7f491babfcdab37794c1ae3e; classic mode.
- FFmpeg overlay revision: `8.1.3#3`; LAME: `3.100#17`; triplet: `x64-windows`.
- Compiler: MSVC 19.44.35222; Windows SDK 10.0.26100.0; dynamic MSVC runtime `/MD`.
- Build configuration and enabled components are recorded in `BUILD_INFO` and `DEPENDENCIES-MINIMAL.txt`.
- Runtime file SHA-256 hashes are recorded in `BUILD_INFO`; `scripts/ensure-ffmpeg.js` verifies them before packaging.
- The corresponding source bundle includes the exact FFmpeg/LAME source archives, recipes, patches, licenses, and build instructions.
