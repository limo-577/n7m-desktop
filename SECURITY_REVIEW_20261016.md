# 唱歌笔记桌面版安全审核报告

审核日期：2026-10-16。对象：当前目录交付的 1.0.0 源码及 Windows x64 桌面程序。修复工作目录：`D:\别人的项目\security-review-20261016`。

本次修复了构建链 undici 的 High 漏洞、备份导入的结构校验和对象键处理问题，并收紧 Electron 权限与 IPC 来源。按开发者明确选择，保留并验证 sprintf-js 本地补丁，纠正其版本身份；对宿主 Node 内置旧 undici，通过项目专用构建进程改用补丁实现。10 组安全回归、真实 Electron 隔离环境冒烟测试和 Windows 安装包构建均通过。未确认存在当前应用可直接远程利用的 Critical 问题；这不表示不存在未知漏洞。

原安装包、原源码 ZIP、原完整交付包及旧审核报告均保留。此次未安装、发布或替换用户正在使用的软件，也未接触真实歌曲、录音、登录状态。本文是本次新审核结果；原 `SECURITY_AUDIT_REPORT.md/html` 是交付包中的历史材料，不能代替本文。

## 1 项目概况与范围

| 项目 | 结果 |
| --- | --- |
| 语言与框架 | JavaScript、HTML/CSS；Electron 44.5.1，原生 DOM 界面；无服务端框架 |
| 包管理与构建 | npm、package.json、package-lock.json v3；electron-builder 26.15.3 / NSIS |
| 原生组件 | FFmpeg 8.1.3 最小 LGPL 构建，动态链接 LAME 3.100；CMake/vcpkg、PowerShell 构建辅助，Python 源码打包辅助 |
| 直接 npm 依赖 | 原 5 项；修复后共 6 项：2 个 dependencies、4 个 devDependencies，新增构建专用 undici，完整列于下一节 |
| 锁文件规模 | 310 个 packages 条目，含项目根、307 个 registry 包实例、本地目录与链接；npm audit 报告依赖总数 309，包含不同路径重复实例，不等于唯一包名数 |
| 自动漏洞覆盖 | OSV 对 293 个不同包名与版本组合查询，包含额外按 sprintf-js 上游 1.1.3 查询；npm audit 同时交叉核对 |
| 手工范围 | 原源码 ZIP 的 78 个文件：应用源码、预加载脚本、页面、脚本、配方/补丁、配置、说明和许可证；静态图片/图标做类型与清单检查，原生二进制做版本、哈希和启用组件核验；第三方源码只检查安全相关调用与公告，未逐行审阅全部第三方代码 |
| 产物范围 | 新构建 ASAR、解包运行目录、安装包签名状态及哈希；源码与 ASAR 共 4,371 个文件作凭据模式扫描 |
| 不适用项 | 未发现后端 SQL/NoSQL、HTTP API、账号鉴权系统、浏览器扩展、移动端工程或 CI workflow |
| 版本控制限制 | 交付目录与源码 ZIP 无 `.git`。无法确认历史提交、远端仓库或敏感文件历史追踪状态，相关结论为「待确认」 |

逐文件清单与原始/当前哈希见 `audit-evidence/source-comparison.json`；完整锁定依赖清单见 `audit-evidence/dependency-inventory-after.json`。原生源包内上游 C/C++ 工程没有执行完整模糊测试或重新编译；当前产品未修改这些组件。

## 2 问题汇总

严重级别描述该问题的影响；依赖公告等级与本项目的实际触达条件分别说明。防御加固项不等同于已找到可利用的攻击链。

| 编号 | 类别 | 严重级别 | 位置（修复后文件行） | 状态 |
| --- | --- | --- | --- | --- |
| D01 | 依赖 | High | package-lock.json:2778、3644；package.json:27 | 已修复：undici 6.29.1 / 7.30.1 |
| D02 | 依赖 | Medium | renderer/vendor/package.json:3；renderer/vendor/sprintf.js:84、src/sprintf.js:84 | 已修复本地身份与回归缺口；上游无修复版，保留本地缓解已获开发者同意 |
| D04 | 依赖 | High | 构建宿主 Node 24.18.1；scripts/build-fetch.cjs:1 | 已按开发者选择缓解：项目安装/打包进程使用 npm undici；宿主系统未修改 |
| C01 | 代码 | Medium | renderer/index.html:1239、2858 | 已修复：全量结构校验通过后才写入 |
| C02 | 代码 | Medium | renderer/index.html:1153、1219、1223、1353 | 已修复：无原型字典与自有属性检查 |
| C03 | 代码 | Medium | main.js:21、28、158 | 已修复：权限默认拒绝，仅主页面音频例外 |
| C04 | 代码 | Low | main.js:15 | 已修复：IPC 精确限制主 frame；防御加固 |
| C05 | 代码 | Medium | renderer/index.html:2862、2866 | 待开发者决定：同 ID 歌曲静默覆盖 |
| C06 | 代码 | Low | renderer/index.html:1189、2866、2871、2876 | 建议关注：容量/超大文件与存储失败恢复仍有限 |
| D03 | 依赖 | Low | package-lock.json:941、2055、2342、3249 | 建议关注：弃用的 boolean、glob、inflight、rimraf 开发链依赖，未强行跨大版本替换 |
| C07 | 代码 | Medium | package.json:61、72；dist 安装程序 | 建议关注：发行安装包未签名，签名身份需发行方配置 |

密钥类：未发现可确认的硬编码有效凭据，不把字符串常量、源码哈希或公开证书当作密钥泄露。Git 历史不在本次可验证范围。

## 3 依赖清单与漏洞核对

### 全部直接依赖

| 包 | 声明及实际版本 | 用途与结论 | 官方/公告来源 |
| --- | --- | --- | --- |
| html2canvas-pro | 2.5.2 | 图片导出；核对项目来源与 OSV，未命中本次查询的已知漏洞。是已存在的 html2canvas 分支项目，未发现其为仿冒包的证据 | [项目](https://github.com/yorickshan/html2canvas-pro) |
| jspdf | 4.2.1 | PDF 导出；已在所核对新公告的修复版本，应用使用 addImage/save，不使用 newwindow 或 createAnnotation 链路 | [GHSA-wfv2-pwc8-crg5](https://github.com/advisories/GHSA-wfv2-pwc8-crg5)、[GHSA-7x6v-j9x4-qf24](https://github.com/advisories/GHSA-7x6v-j9x4-qf24) |
| electron | 44.5.1，Chromium 152.0.7977.130 | 运行时；核对官方公告，所核对 pointer-lock 修复版本为 44.5.0，当前已覆盖；窗口禁止 popup，未启用 nodeIntegration | [官方安全公告](https://github.com/electron/electron/security/advisories)、[pointer-lock](https://github.com/electron/electron/security/advisories/GHSA-x562-297c-g43g) |
| electron-builder | 26.15.3 | 开发/打包工具；builder-util-runtime 9.7.0 已覆盖所核对重定向泄露修复；其 undici 间接依赖另行修复 | [发布记录](https://github.com/electron-userland/electron-builder/releases)、[重定向公告](https://github.com/advisories/GHSA-p2f4-r6v6-j797) |
| sprintf-js | file:renderer/vendor；1.1.4 本地标签 → 1.1.3-local.1 | 上游 1.1.3 + 已有本地精度边界补丁；没有官方修复版。开发者已选择保留并验证。不是从 npm 升级到一个不存在的修复版本 | [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) |
| undici | 7.30.1（新增 devDependency） | 为构建下载进程提供可固定版本的 fetch 实现；6.x 间接依赖仍独立固定 6.29.1；不进入应用 ASAR | [官方公告](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c) |

### 关键间接依赖的实际锁定版本

| 包 | 当前版本 | 使用面与核对结果 |
| --- | --- | --- |
| undici | 6.29.0 → **6.29.1**；7.30.0 → **7.30.1** | 仅开发链；详见 D01。新 ASAR 中无该包 |
| @electron/get | 5.1.0；app-builder-lib 下 3.1.0 | 下载构建组件；[官方发布记录](https://github.com/electron/get/releases)，OSV 未命中；5.1.0 的代理分支使用 undici |
| @electron-internal/extract-zip | 1.0.5 | 开发链 ZIP 解压；[官方发布记录](https://github.com/electron/extract-zip/releases)记录终点 symlink 验证修复；OSV 未命中 |
| @electron/asar | 3.4.1 | 开发打包；[官方项目](https://github.com/electron/asar)，OSV 未命中；未强制替换成大版本 |
| app-builder-lib / builder-util-runtime | 26.15.3 / 9.7.0 | [重定向敏感头泄露公告](https://github.com/advisories/GHSA-p2f4-r6v6-j797)修复版本 9.7.0，当前已覆盖；应用无自动更新器 |
| dompurify | 3.4.16 | jsPDF 可选链；[3.4.16 官方发布说明](https://github.com/cure53/DOMPurify/releases/tag/3.4.16)，OSV 未命中；应用未调用 jsPDF.html |
| canvg | 3.0.11 | jsPDF 可选 SVG 链；[原型污染公告](https://github.com/advisories/GHSA-v2mw-5mch-w8c5)对应 3.x 修复版本 3.0.11，已覆盖；未发现 SVG 输入调用 |
| fflate | 0.8.3 | jsPDF 压缩依赖；[解压循环公告](https://github.com/advisories/GHSA-px8p-9vwx-vf98)修复版本 0.8.3；应用不提供 ZIP 导入 |
| fast-png | 6.4.0 | jsPDF PNG 处理；[官方变更记录](https://github.com/image-js/fast-png/blob/main/CHANGELOG.md)，OSV 未命中；输入来自本页生成的 PNG |
| pako | 2.2.0 | 压缩链；[官方安全页面](https://github.com/nodeca/pako/security)，OSV 未命中 |
| core-js | 3.50.0 | 可选 polyfill；[官方安全页面](https://github.com/zloirock/core-js/security)，OSV 未命中 |
| tar | 7.5.22 | 开发链归档；高危递归 DoS 公告受影响范围到 7.5.20，当前不在范围内；[公告](https://github.com/advisories/GHSA-r292-9mhp-454m) |
| yargs-parser | 21.1.1 | 开发链参数解析；[历史原型污染公告](https://github.com/advisories/GHSA-p9pc-299p-vxgp)对应受影响旧版本，当前不在范围内 |
| html2canvas | 1.4.1 | jsPDF 可选包，锁文件保留；[上游 changelog](https://github.com/niklasvh/html2canvas/blob/master/CHANGELOG.md)最后版本记录为 2022 年。既有打包规则排除该目录，本次验证新 ASAR 中不存在；实际使用 html2canvas-pro |

“未命中”仅表示截至本次检索没有匹配的数据库记录。对全部 registry 包做了 OSV 精确版本查询；WebSearch 和官方页面逐项核对直接依赖及上述关键间接依赖，没有声称逐一手工审计所有第三方包的全部实现。

### D01 undici 新公告与实际触达

锁文件旧版本 6.29.0、7.30.0 落入 2026-10-15 多项官方公告范围。`node_modules/node-gyp/lib/download.js:2,19` 直接使用 undici fetch、Agent、RetryAgent 下载构建输入；`node_modules/@electron/get/dist/proxy.js:21` 在启用代理时配置 undici dispatcher。

| 公告 | 公告级别 | 利用条件与本项目判断 | 修复 |
| --- | --- | --- | --- |
| [GHSA-xjj6-f33q-929c](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c) | High | 恶意服务器返回过多 content-encoding 后提前断开，fetch 可使构建进程退出。node-gyp 下载路径使用该功能；需要构建实际发生相应网络请求且服务端/镜像被攻击者控制。没有复现真实下载站被控制 | 6.29.1 / 7.30.1 |
| [GHSA-qrxm-fqhp-jwvm](https://github.com/nodejs/undici/security/advisories/GHSA-qrxm-fqhp-jwvm) | High | TLS 1.2 对端重协商时更换为不匹配主机的证书导致进程退出；构建下载链有使用条件，不是桌面程序的入站服务漏洞 | 6.29.1 / 7.30.1 |
| [GHSA-2m5v-pch6-74hx](https://github.com/nodejs/undici/security/advisories/GHSA-2m5v-pch6-74hx) | High | Agent 丢失 tls 中函数形式的自定义验证器；本项目所查调用未配置此类函数，node-gyp 使用 connect/requestTls/proxyTls，未确认可达 | 6.29.1 / 7.30.1 |
| [GHSA-4w7w-5xrc-9h26](https://github.com/nodejs/undici/security/advisories/GHSA-4w7w-5xrc-9h26) | High | 需要 redirect 与共享 cache interceptor 的特定组合；所查构建调用未使用此组合 | 7.30.1，6.x 不在该公告范围 |
| [GHSA-qq8j-7v2v-3rwp](https://github.com/nodejs/undici/security/advisories/GHSA-qq8j-7v2v-3rwp) | High | 只影响 8.11.0、8.11.1 的 HTTP/2 WebSocket，当前两分支不受此公告影响 | 本项目无需为此跨到 8.x |

修改 `package.json` 为按 6.x、7.x 分别固定补丁的 overrides，并同步锁文件 integrity。没有跨大版本。npm 另重新计算了一些 peer 标志，没有升级其他 registry 依赖。原有文件差异在 `audit-evidence/security-fixes.patch`，新增文件见变更表与源码。

**数据库交叉核对的差异：**修复前 npm audit 也返回 0，OSV 未返回上述新 undici 公告；官方维护者公告明确列出旧版本受影响，因此仍进行了修复。修复后 npm audit 为 0；OSV 293 项中只有特意查询的 sprintf-js 上游基线命中。不能用“0”掩盖本地补丁或数据库更新延迟。

### D04 宿主 Node 内置 fetch 的项目级缓解

实测构建宿主 Node 24.18.1 内置 undici **7.29.0**，也在上述 DoS 公告范围。`@electron/get/dist/FetchDownloader.js:46` 使用全局 fetch；npm overrides 不会替换 Node 内嵌实现。核对 [Node 24.22.0 官方发布说明](https://nodejs.org/en/blog/release/v24.22.0)和官方发布列表后，尚未确认包含本次 7.30.1 修复的 Node 24 发行版，不能把普通 Node 升级直接宣称为已修复。

开发者已选择“仅在项目构建进程中改用已修复的 npm undici，并补验证”。新增固定的 devDependency，以及 `scripts/build-fetch.cjs`：检查 7.x 最低修复版本后调用 undici.install；只由 `install:electron` 和 `dist` 的显式 `node --require` 加载。未改系统 Node、全局环境或产品运行时。

安全安装顺序为 `npm ci --ignore-scripts`，然后 `npm run install:electron`，阻止 Electron 默认安装脚本提前走宿主 fetch。README 已更新。回归在独立 Node 子进程验证真实 Electron 下载器读取本机 HTTP 测试文件，并验证恶意 excessive content-encoding / 提前断开响应被拒绝且进程存活；父进程 fetch 保持原样。重新安装依赖与打包使用此新流程。

**残余边界：**直接执行未加 `--ignore-scripts` 的 npm install/ci，或绕过项目脚本直接调用依赖 CLI，不受该流程保护。系统其他项目仍使用原 Node；后续应独立升级到经过确认的安全运行时。已打包应用没有发现调用 Node 内置 fetch 的路径。此措施是项目内经批准的缓解，不是系统 Node 的整体修复。

### D02 本地 sprintf-js 的处理

官方公告级别 Medium，影响上游 <=1.1.3，没有上游修复版。原项目把本地修补代码标成 1.1.4，容易造成错误的版本安全判断。

已将本地版本明确为 `1.1.3-local.1`，保留原浮点精度补丁：e/f 上限 100，g 范围 1–100；两份实现保持一致。新增回归覆盖正常格式化、巨大精度以及 %.0g。说明写入 `renderer/vendor/SECURITY-PATCH.md`。

实际调用是开发工具 roarr 日志链，没有发现歌词/备份内容流入格式字符串。`renderer/vendor` 文件也被既有规则复制进 ASAR，但两份应用 HTML 不加载 sprintf。补丁不是通用输入防护：宽度、总输出长度和缓存没有全局限制，未来不得把不可信格式字符串直接交给它。此项是开发者批准的本地缓解，不声称上游漏洞已经关闭。

### D03 维护状态与原生组件

锁文件明确标记弃用的包：boolean 3.2.0、glob 7.2.3、inflight 1.0.6、rimraf 2.6.3，均位于开发链。inflight 的弃用说明包含内存泄漏；glob/rimraf 的旧分支不再支持。没有仅凭弃用提示编造可利用 CVE。建议随 electron-builder 上游依赖更新消除；直接 override 到新版可能破坏 API，未擅自执行。

LAME 3.100 是长期使用的旧版本，需关注维护动态，不能仅以版本年龄断言停更或所有场景不安全。官方 [issue 522](https://sourceforge.net/p/lame/bugs/522/)指出报告中的单声道 interleaved API 用法错误，维护者不将其认定为 LAME 安全漏洞。核对随附 FFmpeg `libavcodec/libmp3lame.c` 使用分离声道的 lame_encode_buffer / int / float API，没有该 interleaved 调用；这是对该具体报告的可达性判断，不是 LAME 全面安全证明。

FFmpeg 使用 [官方 8.1.3 分支](https://ffmpeg.org/download.html)的最小构建，版本、7 个文件 SHA-256、许可与组件列表通过 `scripts/ensure-ffmpeg.js` 校验。参考 [官方安全公告](https://ffmpeg.org/security.html)并核对本地功能面：仅 WAV demuxer、PCM S16LE decoder、MP3 muxer、libmp3lame encoder、file 协议；无网络、DVB 字幕解析器、RSCC、Screenpresso、TIFF 等通用解码组件。并非给全功能 FFmpeg 宣称“无漏洞”。原生二进制未修改，随附对应源码 ZIP 保持适用。

## 4 代码问题与具体修复

### C01 畸形备份可能先部分写入再失败

**条件与风险：**用户导入攻击者提供或损坏的 JSON；原实现逐项处理，后面的 song/lines/chars/annotations 类型不正确时可抛错，而前面的歌曲已经保存，造成部分替换或页面不可用。风险限于本地导入，不需要服务端接口。

**改动：**新增 `prepareImportedSongs`，在任何缓存/持久化写入前校验整个批次：歌曲字段类型、有限数值、行/字符结构、重复 ID、标注字段；对旧备份缺少 lines/annotations 的情况保留原有兼容处理。未知标注仍按原设计丢弃，未删减支持的业务功能。无效批次零写入测试通过。

**边界：**这里保证结构验证失败时零写入，不是 localStorage 的跨歌曲事务。存储空间不足和中途系统故障的原子恢复见 C06。

### C02 用户 ID 与普通对象原型属性冲突

**条件与风险：**导入 `__proto__`、`constructor` 等歌曲/字符 ID，或同名标注类型；原普通对象查询会把继承属性当作数据，赋值可改变该缓存对象的原型，导致对象误识别、渲染或保存异常。未把它夸大为已证实的全局 Object.prototype 污染或远程代码执行。

**改动：**songsCache 与字符/去重字典使用 `Object.create(null)`；类型表使用 `Object.hasOwn`；批次校验拒绝重复歌曲/字符 ID。保留合法的特殊字符串 ID，避免无必要地丢弃用户数据。回归证明特殊键按普通数据处理、继承标注类型不被接受。

### C03 Electron 没有应用级权限收敛

**条件与风险：**原程序未设置 session 权限检查/请求处理；若渲染页被注入代码或后续加载不可信内容，可能获得与产品功能无关的浏览器权限。当前未发现可把这一步连成完整链路的 XSS，属于实际默认配置缺口。参考 [Electron 官方安全建议](https://github.com/electron/electron/blob/main/docs/tutorial/security.md)。

**改动：**注册两个权限处理器，默认拒绝，仅允许准确主窗口、主 frame、预期本地页面的 audio media。浮窗、外来页面、视频、混合音视频及其他权限拒绝。麦克风原有录音功能保留；操作系统自身隐私授权仍适用。真实 Electron 使用模拟音频设备验证成功，视频请求被拒绝。

### C04 IPC 来源缺少主 frame 身份检查

**条件与风险：**旧实现仅校验 webContents 与 frame URL；若未来同窗口存在同 URL 子 frame，会通过该检查。当前 CSP 禁止 frame，未发现现成利用入口，定为 Low 加固项。

**改动：**同时要求 `event.senderFrame === window.webContents.mainFrame`。主窗口与歌词浮窗各自既有允许通道保持不变；错误 webContents、错误 URL、同 URL 子 frame 的回归均被拒绝。

### 其他已核查边界

| 检查项 | 结果与定位 |
| --- | --- |
| 命令/代码注入 | main.js 仅 execFile 固定 FFmpeg 路径和参数数组，不经 shell，不接受用户滤镜或命令；应用源码未发现 eval/new Function/远程代码加载 |
| 路径穿越与任意文件读取 | main.js 的 resolveSelectedFile 验证所选目录 realpath、扩展名、文件类型和大小；回归包含目录外路径和 Windows junction；未发现可跨目录的现成调用 |
| XSS | 检查歌曲标题、歌词、LRC、标注、播放列表和录音名进入 innerHTML 的路径；现有 escapeHtml/textContent 与固定模板保留；恶意标签在导入/导出测试中按文字处理 |
| 桌面窗口 | main/lyric 窗口 nodeIntegration=false、contextIsolation=true、sandbox=true；拦截导航、重定向、弹窗及 webview。预加载只暴露有限通道，不转发原始 IPC event |
| SSRF/CSRF/CORS/鉴权/开放重定向 | 无项目 HTTP 服务、远程 API、账号/角色体系；页面无用户控制的服务端 fetch。未将不适用项写成已修复漏洞 |
| 反序列化/上传/解压 | 应用只解析 JSON，没有对象代码反序列化；没有 ZIP 上传/解压功能。构建链 ZIP/tar 与源码包处理另按依赖核查 |
| 加密/TLS | 未发现凭据加密实现、硬编码 IV/盐、关闭证书校验。构建哈希是完整性校验，不是身份签名 |
| 日志/错误 | 主进程文件/转码错误对页面返回固定信息；没有发现令牌输出。开发工具日志会包含本机路径，证据目录不应当作公开用户数据上传 |
| CI/CD | 交付项目没有 .github/workflows 等 CI 配置；无 pull_request_target 或 Action 固定版本问题可核查。外部仓库 CI 状态待确认 |

### 每项文件变更

| 文件 | 改动与原因 |
| --- | --- |
| main.js | 增加 session 权限处理、IPC 主 frame 身份校验，缩小本地页面能力边界 |
| renderer/index.html | 无原型字典、自有类型检查、整批导入校验；更新修改脚本的 CSP 哈希，未加入 unsafe-eval 或脚本 unsafe-inline |
| package.json | 增加 undici 分支补丁 overrides、构建专用直接依赖、install:electron 和受保护的 dist，以及 npm test 与 update:csp 命令 |
| package-lock.json | 同步两版 undici 版本/来源/完整性及 sprintf 本地身份；npm 重算部分 peer 元数据 |
| renderer/vendor/package.json | 1.1.4 改为 1.1.3-local.1，明确上游基础和本地补丁身份 |
| renderer/vendor/SECURITY-PATCH.md | 新增补丁来源、批准方案、覆盖范围与未覆盖风险说明；sprintf 两份实现未改动 |
| scripts/update-csp.js | 新增哈希同步脚本，按浏览器换行规范计算内联脚本摘要，防止以后编辑导致应用空白 |
| scripts/build-fetch.cjs、tests/build-fetch-fixture.cjs | 新增仅构建进程使用的补丁 fetch 入口，以及真实下载器/恶意 HTTP 响应验证 |
| tests/security.test.js | 新增 10 组有意义的攻击边界与兼容回归 |
| tests/electron-smoke.cjs | 新增隔离配置与模拟麦克风的真实 Electron 测试，检查权限、导入、导出、实际转码 |
| README.md | 明确两步安全依赖安装、构建保护范围与回归/CSP 命令 |
| audit-evidence/*、本文 | 新增可复核的依赖、扫描、构建、原文件哈希及差异证据，不属于应用功能 |

## 5 密钥与凭据检查

扫描范围包含配置、源码、测试、说明、注释、供应商文件、原生运行文件和新 ASAR 文本。规则覆盖私钥、GitHub/AWS/Google/Slack/Stripe 常见令牌、含用户名密码的 URL/数据库连接串、Webhook、常见凭据赋值；同时核查应用的网络和存储代码。没有从本机其他项目或用户凭据目录读取秘密。

3 处自动命中都位于 html2canvas-pro source map。检查映射内 `input-element-container.ts` 后确认是 PASSWORD 输入类型常量，其值为 password，与 CHECKBOX/RADIO 同类，不是登录密码。无确认需要移出源码的密钥，因此未增加空的 `.env.example` 或虚构环境变量。

`.gitignore` 已包含 `.env`、`.env.*`，并例外允许 `.env.example`。交付源码未包含 `.env` 文件。但由于没有 Git 元数据，是否曾提交/泄露密钥为「待确认」，不能依据 ignore 规则推断历史安全。**如开发者在历史仓库、日志或公开产物中发现真实密钥，必须到对应平台作废并重新生成；只删代码或补 `.gitignore` 不够。**本次没有进行任何密钥轮换。

模式扫描不能证明任意自定义或编码后的秘密都不存在；完整匹配位置及误报记录在 `audit-evidence/secret-scan.json`、`secret-review.json`，未输出真实秘密值。

## 6 待开发者决定与剩余风险

### C05 同 ID 导入覆盖

旧逻辑把相同 ID 的导入歌曲直接写入原歌曲，没有确认或冲突副本。攻击者需要让用户导入包含现有 ID 的备份，或用户误用旧备份；结果可能覆盖较新的歌词和标注。本次保留此行为，已发出选择问题，尚未收到这项的决定。

可选方案：

1. **建议：覆盖前确认并显示冲突数量。**保留“恢复原备份”的用途，用户可以取消，改动最小。
2. 冲突歌曲生成新 ID、保留副本。更保护现有成果，但改变恢复/合并语义，可能产生重复歌曲。
3. 保持直接覆盖，仅补充警示与手工备份流程。兼容性最高，误覆盖风险仍在。

### C06 大文件与存储失败

JSON 导入没有文件大小、歌曲数量上限，主线程一次性读取解析；localStorage 写入失败时，`saveSong` 的失败结果未被导入循环用于整体回滚，仍可能出现内存与磁盘不一致或部分保存。结构校验修复没有解决这些不同的失败条件。

建议在明确真实项目容量后选择：小改为失败时立即停止并明确报告已保存数量；或迁移到支持事务的 IndexedDB 并增加恢复副本。后者涉及数据迁移和业务行为，不在本次擅自改动。容量阈值应以真实歌库验证，不凭空限制正常用户项目。当前操作建议：导入前导出备份，避免来源不明或异常大的文件。

### C07 发行身份及其他后续工作

新安装包的 Authenticode 状态实测为 **NotSigned**。SHA-256 可用于核对文件，但无法替代发行者身份验证。公开发行建议由发行方使用其自己的证书或受控签名服务签名并验证；也可暂保留本地未签名验证包。未采购证书、索取私钥或自动发布。

维护建议：定期核对官方公告与锁文件；保留 sprintf 本地回归；等待上游构建链淘汰弃用包，再评估大版本迁移。保留并与安装程序一同提供 FFmpeg/LAME 对应源码与许可。用户真实歌库、真实麦克风、安装升级保留旧数据、不同 Windows 权限/设备环境仍需要产品验收。

## 7 验证与交付

| 验证 | 本次结果 | 证据 |
| --- | --- | --- |
| npm audit | 修复后 0；修复前也是 0，存在数据库覆盖/时效限制 | npm-audit-before.json / npm-audit-after.json |
| OSV | 293 组合；仅显式查询的 sprintf 上游基线命中 | osv-results-before.json / osv-results.json |
| npm test | 10/10 通过，包括补丁下载器、恶意 HTTP 响应、畸形 JSON 零写入、特殊键、HTML 转义、IPC、权限、junction、WAV、sprintf 精度 | security-tests.log |
| Electron 实测 | 44.5.1 / Chromium 152.0.7977.130；Node 未暴露；导入成功；PNG 640×238 与 PDF 头有效；模拟音频通过、视频拒绝；实际生成 25,748 字节 ID3 MP3；畸形 WAV 拒绝 | electron-smoke.json / 日志 |
| 项目既有构建 | npm run dist -- --publish never 成功，predist 原生组件验证通过，postdist 生成校验文件 | build.log |
| 包内核验 | main、preload、两页面、sprintf 实现与元数据同审核源码；7 个原生二进制一致；无 undici、无旧 html2canvas 目录 | package-verification.json |
| 凭据模式扫描 | 4,371 文件、3 处已核实误报、0 个确认泄露 | secret-scan.json / secret-review.json |
| 原文件保护 | 原安装包和源码 ZIP SHA-256 与审核起点一致 | artifact-hashes.json |

项目原来没有 test 命令，本次增加上述安全回归。此次没有运行完整原生 MSVC/vcpkg 重编译、真实用户数据迁移或人工媒体质量验收，不能把冒烟测试视为这些验收完成。测试使用独立临时 profile 和模拟麦克风，不记录用户音频。

新安装程序：`dist/唱歌笔记桌面版 Setup 1.0.0.exe`。

SHA-256：`558b6136b17ed346ac86d83de4d15d9db1fb7b3bb9a91880f18bf3dcce7670ba`。

原安装程序 SHA-256：`b4724f08fbe944c2a1eba7ec1e2c3f8e1723c45736ab0f68630ab66f5c5b7020`。

原源码 ZIP SHA-256：`a14bbe6a734d37ac891c97abcd5891ec88db17d9723f1efef43fb5d658e3bc71`。

报告中的路径以本工作目录为根；全部证据保存在 `audit-evidence`。源码完整清单、修复差异与重现命令可直接用于后续开发复核。安装包仍沿用项目版本号 1.0.0，位于独立审核目录；应按其位置和 SHA-256 区分原交付版。
