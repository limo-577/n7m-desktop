set(FFMPEG_VERSION "8.1.3")
set(FFMPEG_SHA512 8c667090bcdc70796caaa8cdc2cf82e57d7c7f6feedcb0ec7251cefd6a0c63b7cad203a86c800d3e2f69ca91255167aa4e631701060b96d576d1a9666ca7aafe)
set(FFMPEG_PORT_REVISION 3)
set(VCPKG_BUILD_TYPE release)
set(VCPKG_POLICY_MISMATCHED_NUMBER_OF_BINARIES enabled)
set(FFMPEG_BASE_OPTIONS "--disable-network --disable-protocols --disable-demuxers --disable-decoders --disable-encoders --disable-muxers --disable-filters --disable-bsfs --disable-parsers --disable-devices --disable-indevs --disable-outdevs --disable-hwaccels --disable-avdevice --disable-swscale --disable-ffplay --disable-ffprobe --enable-protocol=file")
set(FFMPEG_OPTIONS_DEBUG "--disable-optimizations")
set(FFMPEG_NEED_BIN2C True)
set(FFMPEG_PATCHES
    "${CMAKE_CURRENT_LIST_DIR}/patches/0002-fix-msvc-link-8.1.patch"
    "${CMAKE_CURRENT_LIST_DIR}/patches/0003-fix-windowsinclude.patch"
    "${CMAKE_CURRENT_LIST_DIR}/patches/0004-dependencies-8.1.patch"
    "${CMAKE_CURRENT_LIST_DIR}/patches/0005-fix-nasm-8.1.patch"
    "${CMAKE_CURRENT_LIST_DIR}/patches/0007-fix-lib-naming-8.1.patch"
    "${CMAKE_CURRENT_LIST_DIR}/patches/0013-define-WINVER-8.1.patch"
    "${CMAKE_CURRENT_LIST_DIR}/patches/0024-fix-osx-host-c11-8.1.patch"
    "${CMAKE_CURRENT_LIST_DIR}/patches/0040-ffmpeg-add-av_stream_get_first_dts-for-chromium.patch"
    "${CMAKE_CURRENT_LIST_DIR}/patches/0045-use-prebuilt-bin2c-8.1.patch"
    "${CMAKE_CURRENT_LIST_DIR}/patches/0046-fix-msvc-detection-8.1.patch"
    "${CMAKE_CURRENT_LIST_DIR}/patches/0047-fix-msvc-utf8.patch"
    "${CMAKE_CURRENT_LIST_DIR}/patches/0048-backport-23039.patch"
    "${CMAKE_CURRENT_LIST_DIR}/patches/0050-lensfun-0.3.4-compat-8.x.patch"
    "${CMAKE_CURRENT_LIST_DIR}/patches/0051-lensfun-configure-fix-8.x.patch"
)
set(CURRENT_PORT_DIR "${CMAKE_CURRENT_LIST_DIR}")
include("${CMAKE_CURRENT_LIST_DIR}/builder/ffmpeg-portfile.cmake")
