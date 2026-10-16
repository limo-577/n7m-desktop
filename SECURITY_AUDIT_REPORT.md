# 唱歌笔记桌面版安全审核报告

**审核日期：** 2026-10-16  
**范围：** Windows x64 Electron 应用、npm 依赖、FFmpeg/LAME 原生运行时、构建与发行材料、凭据与打包产物

## 审核结论

当前构建没有发现可由应用功能触发的已知 Critical/High 漏洞。npm 锁定依赖经在线 npm Advisory Database 检查为 **309 项、0 个已知漏洞**。FFmpeg 8.1.3 上游公告涉及的 DVB 字幕解析器、RSCC、Screenpresso、TIFF 等组件没有编入当前最小运行时；运行时只列出 WAV demuxer、PCM S16LE decoder、MP3 muxer、LAME encoder 和 file 协议。

本轮完成 **10 项修复或构建隔离**，有 **1 项低风险依赖维护建议**。应用和安装包已构建，LGPL 对应源码 ZIP 与安装包校验文件也已生成。**安装包尚未签名**：本机没有代码签名证书，因此正式公开下载前仍需发行方签名并把安装包与源码 ZIP 放到同一下载页。

> 这表示当前已知问题按应用的实际功能和发行二进制进行了处理，不代表以后不会出现新漏洞。WAV demuxer 仍会解析用户录音文件，需持续跟踪 FFmpeg 公告并重建更新版本。

## 项目概况

- **语言与框架：** JavaScript、Electron 44.5.1；Windows x64 桌面应用。
- **直接 npm 依赖：** 5 个；lockfile v3 共 310 个 package 条目（包括根项目）。npm audit 检查 309 个依赖，结果为 0 个漏洞。
- **原生多媒体依赖：** 本地 MSVC 构建的 FFmpeg 8.1.3（LGPL-3.0-or-later）与动态链接的 LAME 3.100（LGPL-2.0-only）。
- **审核范围：** main/preload、标注与播放器页面、动态 HTML 输出、npm 清单与 lockfile、FFmpeg 构建配方和实际组件列表、许可证及 SPDX、安装目录和 ASAR、密钥模式、CI 配置。
- 项目没有后端数据库、浏览器扩展或 GitHub Actions workflow；相关服务器端、扩展消息和 CI workflow 项不适用。

## 问题汇总

| 编号 | 类别 | 严重级别 | 位置 | 状态 |
|---|---|---|---|---|
| DEP-01 | 依赖 | Medium | 原 ffmpeg-static 5.3.0 / FFmpeg 6.1.1；现由 resources/ffmpeg/BUILD_INFO:1-55 固定 | 已修复：替换成源码构建的最小 LGPL 运行时 |
| DEP-02 | 依赖 | High（上游 CVE-2026-70628） | scripts/ffmpeg-minimal/ports/ffmpeg/portfile.cmake:6；resources/ffmpeg/BUILD_INFO:42-55 | 已隔离：DVB subtitle parser 未编入 |
| DEP-03 | 依赖 | Medium（上游 CVE-2026-70629） | resources/ffmpeg/BUILD_INFO:42-44 | 已隔离：RSCC decoder 未编入 |
| DEP-04 | 依赖 | Medium（上游 CVE-2026-70630） | resources/ffmpeg/BUILD_INFO:42-44 | 已隔离：Screenpresso decoder 未编入 |
| DEP-05 | 依赖 | Medium（上游 CVE-2026-70631） | resources/ffmpeg/BUILD_INFO:42-44 | 已隔离：TIFF decoder 未编入 |
| CODE-01 | 代码 | Low | main.js:337-375 | 已修复：校验 PCM WAV 结构、大小和单任务状态；固定参数、file-only、超时执行并隐藏原始错误 |
| CODE-02 | 代码 | Low | renderer/index.html:6-10 | 已修复：移除远程字体来源，页面连接策略限制为本地资源 |
| CODE-03 | 代码 | Low | renderer/index.html:1327-1329、2859-2961 | 已加固：用户文本进入 HTML 字符串前统一转义；其他位置使用 textContent |
| DEP-06 | 依赖 | Low | package.json:34,72；renderer/index.html:8 | 已修复：截图导出改用 html2canvas-pro 2.5.2，旧 html2canvas 不进入 ASAR |
| REL-01 | 发行材料 | Low | resources/ffmpeg/NOTICE.txt；dist/ffmpeg-8.1.3-wav-pcm-mp3-source-x64-windows-lgpl.zip | 已完成：生成对应源码包、许可证、构建配方与哈希清单 |
| DEP-07 | 依赖 | Low | package-lock.json:2263；package.json:34 | 建议关注：jsPDF 的可选依赖仍让 html2canvas 1.4.1 留在 npm lock/install 树中，但已从发行 ASAR 排除，npm audit 当前无告警 |
| REL-02 | 发行配置 | Low | dist/唱歌笔记桌面版 Setup 1.0.0.exe | 待发行方操作：安装器未签名；需要发行方的受信任 Authenticode 证书 |

CVE-2026-70628 的上游评分为 High；CVE-2026-70629、70630、70631 为 Moderate。这里的“已隔离”指受影响解析器或解码器没有编译进发行二进制，不是声称 FFmpeg 8.1.3 的通用上游版本已经修复这些漏洞。利用需要 FFmpeg 处理对应的 WTV/DVB subtitle、RSCC、Screenpresso 或 TIFF 数据；当前应用仅接受它自己生成的 PCM WAV，并且对应 parser/decoder 不存在于发行构建中。[CVE-2026-70628 Ubuntu](https://ubuntu.com/security/CVE-2026-70628) · [CVE-2026-70629 Red Hat](https://access.redhat.com/security/cve/cve-2026-70629) · [CVE-2026-70630 Red Hat](https://access.redhat.com/security/cve/cve-2026-70630) · [CVE-2026-70631 GHSA](https://github.com/advisories/GHSA-5f73-3r3j-p8mr)

### 风险与利用条件

- **DEP-01：**旧通用 FFmpeg 只有在攻击者控制的媒体进入对应 demuxer/decoder 时才可能触发原生漏洞。旧包已被固定格式构建替换。
- **DEP-02 至 DEP-05：**分别需要 crafted WTV/DVB subtitle、RSCC、Screenpresso 或 TIFF 数据进入受影响 parser/decoder；这些组件未编译进当前二进制。
- **CODE-01：**损坏录音导致转码失败时，旧错误可能把 FFmpeg stderr 或临时文件路径带回渲染层；现仅返回通用失败提示。
- **CODE-02：**旧远程字体请求会让第三方字体服务收到访问方网络元数据；请求已移除，页面资源限于本地。
- **CODE-03：**若导入的歌词、曲名或标注未转义便插入 innerHTML，内容可能成为脚本；动态文本统一转义后再构造 HTML。
- **DEP-06/DEP-07：**旧 html2canvas 仅残留在 jsPDF 的可选安装树中，不进入发行 ASAR，因此不构成当前用户可触发的发行代码路径；后续可评估从安装树彻底去除。
- **REL-01/REL-02：**发布 LGPL 二进制时缺少对应源码会带来许可合规风险；源码包已生成。未签名的安装器缺少发行者身份校验，需发行方证书签名后再公开。

## 依赖版本

### 直接依赖

| 包 | 类型 | 实际锁定版本 |
|---|---|---:|
| electron | 开发 | 44.5.1 |
| electron-builder | 开发 | 26.15.3 |
| sprintf-js | 本地 vendored 开发依赖 | 1.1.4 |
| html2canvas-pro | 运行时 | 2.5.2 |
| jspdf | 运行时 | 4.2.1 |

### 关键间接依赖

| 包 | 锁定版本 | 包 | 锁定版本 |
|---|---:|---|---:|
| app-builder-lib | 26.15.3 | builder-util-runtime | 9.7.0 |
| @electron/asar | 3.4.1 | @electron/get | 5.1.0 |
| undici | 7.30.0 | dompurify | 3.4.16 |
| core-js | 3.50.0 | canvg | 3.0.11 |
| fflate | 0.8.3 | pako | 2.2.0 |
| html2canvas（jsPDF 可选依赖） | 1.4.1 |  |  |

npm audit 没有报告这些 npm 依赖存在已知漏洞。Electron 44.5.1 高于本轮检查的 2026-10-15 Electron 安全公告修复版本；jsPDF 4.2.1、sprintf-js 1.1.4、electron-builder 26.15.3 / builder-util-runtime 9.7.0 也不在所核对公告的受影响范围。FFmpeg 原生二进制不由 npm audit 覆盖，已按 FFmpeg 官方公告和 CVE 数据库单独核对。[FFmpeg 官方安全公告](https://ffmpeg.org/security.html) · [Electron 安全公告](https://github.com/electron/electron/security/advisories) · [jsPDF GHSA-wfv2-pwc8-crg5](https://github.com/parallax/jsPDF/security/advisories/GHSA-wfv2-pwc8-crg5) · [sprintf-js GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)

未发现疑似仿冒 npm 包。唯一建议持续关注的是 lockfile 中未被发行包使用的 html2canvas 1.4.1：它来自 jsPDF 可选依赖，npm 审计无告警，最终 ASAR 已排除。

## 已修复内容

### FFmpeg 缩小到应用必需的能力

移除了旧的 ffmpeg-static 依赖和通用预编译运行时，改为从固定 SHA-512 的 FFmpeg n8.1.3 与 LAME 3.100 源码，在 MSVC 下本地构建。运行时清单只启用：

- 输入：WAV demuxer、PCM S16LE decoder
- 输出：MP3 muxer、LAME encoder
- 协议：file
- 禁用：所有 parser、其余 demuxer/decoder/encoder/muxer、网络、设备、硬件加速、ffplay 和 ffprobe

FFmpeg CLI 仍自动包含 16 个内置滤镜，清单列于 resources/ffmpeg/BUILD_INFO:57-73。应用传入固定音频参数，不接受用户提供的滤镜表达式。运行前 scripts/ensure-ffmpeg.js 校验文件名、SHA-256、版本、许可证和组件 allowlist。

### 转码输入和进程边界

main.js 校验输入为标准 16-bit PCM WAV，限制最大 256 MiB，并限制一个转码任务同时运行。FFmpeg 通过 execFile 调用，不启用 shell；命令限定 file 协议、WAV 和 MP3，带 120 秒超时。失败时向渲染页面只返回通用错误，不暴露 stderr 或临时路径。

### Electron 与渲染层

主窗口和悬浮歌词窗口均关闭 nodeIntegration，启用 contextIsolation 与 sandbox；限制导航、重定向、窗口打开和 webview；IPC 校验发送窗口和 frame 来源。音频/LRC 文件读取会解析真实路径并限制在用户选择的目录下，同时检查扩展名、文件大小。用户文本通过转义后才放进动态 HTML；其他文本使用 textContent。移除了 Google Fonts 请求，CSP 禁止外部连接。

### 依赖、LGPL 与来源材料

截图依赖切换到 html2canvas-pro 2.5.2，PNG/PDF 回归已通过；发行 ASAR 中没有旧 html2canvas 或 ffmpeg-static。

源码包包含精确 FFmpeg/LAME 源码归档、port overlay、补丁、构建环境说明、LGPL 文本、SPDX 和内部 SHA-256 清单。vcpkg tool commit 与 port repository commit 分别记录；构建使用 classic mode，README 解释了为何 manifest baseline 不参与依赖选择。暂存脚本接受显式环境路径，便于在独立源码包和项目 checkout 之间复用。

构建后自动生成安装器 SHA-256 旁文件，方便发布页提供完整性核对值。

## 密钥与凭据

检查了源码、配置、文档、lockfile、FFmpeg 发行元数据和最终 ASAR 文本，没有发现 API Key、Token、密码、私钥、Webhook 或云服务凭据。没有已跟踪的 .env 文件；.gitignore 忽略 .env 和 .env.*，保留 .env.example 例外。项目没有需要配置的应用密钥，因此没有创建空的 .env.example。

如果任何凭据曾经提交到仓库或泄露到外部平台，仍必须在对应平台作废并重新生成；只删除文件不够。

## 验证结果

- npm audit：309 项依赖，Critical/High/Medium/Low 均为 0。
- npm ls --depth=0：直接依赖符合 package.json。
- node --check：main、preload、FFmpeg 校验、暂存和 checksum 脚本通过；标注页 4 个 inline script、歌词页 1 个 inline script 语法检查通过。
- npm run dist：最终 Windows x64 NSIS 安装包构建成功。
- 最终解包目录中的 7 个 FFmpeg/LAME 二进制均与 BUILD_INFO 的 SHA-256 一致。
- 从最终解包目录运行 FFmpeg，以应用参数将 1 秒 PCM WAV 转成 MP3，输出 25,748 字节并具有有效 ID3 标记。
- 最终 ASAR 扫描 4,123 个文本文件，没有发现凭据模式；包含 html2canvas-pro，不含 ffmpeg-static 或 html2canvas 1.4.1。
- 对应源码 ZIP：52 个 ZIP 条目；51 个 payload 哈希、ZIP CRC 与旁文件 SHA-512 均通过。ZIP 内 BUILD_INFO 与最终运行时一致。
- git diff --check：通过。项目没有 test 脚本；PNG/PDF 回归此前已完成。

## 公开发布前事项与剩余风险

1. **安装器签名：**最终安装器当前为 NotSigned。本机没有可用的代码签名证书。建议由发行方在受控签名环境中用 Authenticode 证书签名；不要把私钥直接发到聊天或仓库。没有证书时，Windows 可能显示发布者未知或 SmartScreen 警告。
2. **源码托管：**将安装器、对应源码 ZIP、SHA-256/SHA-512 校验文件和 LGPL 说明放在同一公开下载页。本轮只在本地生成，没有对外上传。
3. **重建验证：**当前 FFmpeg 是本地源码构建，已验证对应源码归档哈希和构建配方；本轮没有在全新空白机器上独立复现完整 MSVC 构建。源码包内提供了固定 revision 的构建命令。
4. **持续更新：**FFmpeg 8.1.3 仍是 8.1 分支版本。已知涉及的解析器/解码器通过构建排除；未来升级时重新核对 FFmpeg 安全公告、重建对应源码包和安装器。
5. **未签名的 npm lock 维护项：**后续评估 jsPDF 是否可以不安装其可选 html2canvas 依赖；当前不影响发行 ASAR，也没有 npm audit 告警。

### 本地发行文件

- 安装器：dist/唱歌笔记桌面版 Setup 1.0.0.exe，117,387,143 字节  
  SHA-256：b4724f08fbe944c2a1eba7ec1e2c3f8e1723c45736ab0f68630ab66f5c5b7020  
  校验文件：dist/唱歌笔记桌面版 Setup 1.0.0.exe.sha256
- LGPL 对应源码：dist/ffmpeg-8.1.3-wav-pcm-mp3-source-x64-windows-lgpl.zip，30,138,902 字节  
  SHA-512：ed0b566e55015a60f66badb67b27db132b0ec6d4d03efd092ef3233d37a48d9266d17cad23a4bc1f7c96274a321d7b9b53a9c39569155f6ec05d89953ce9168c  
  校验文件：dist/ffmpeg-8.1.3-wav-pcm-mp3-source-x64-windows-lgpl.zip.sha512

## 主要安全参考

- [FFmpeg 官方安全公告](https://ffmpeg.org/security.html)
- [CVE-2026-70628 · Ubuntu](https://ubuntu.com/security/CVE-2026-70628)
- [CVE-2026-70629 · Red Hat](https://access.redhat.com/security/cve/cve-2026-70629)
- [CVE-2026-70630 · Red Hat](https://access.redhat.com/security/cve/cve-2026-70630)
- [CVE-2026-70631 · GitHub Advisory](https://github.com/advisories/GHSA-5f73-3r3j-p8mr)
- [Electron 安全公告](https://github.com/electron/electron/security/advisories)
- [jsPDF 安全公告](https://github.com/parallax/jsPDF/security/advisories)
- [sprintf-js 安全公告](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)

