# ECHO VST3 Effects Rack (echo-vst3-rack)

[![Version](https://img.shields.io/badge/version-1.1.0-brightgreen.svg)](https://github.com/XeonStudio/echo-vst3-rack)
[![Platform](https://img.shields.io/badge/platform-Windows%20x64-lightgrey.svg)](https://github.com/XeonStudio/echo-vst3-rack)
[![Framework](https://img.shields.io/badge/.NET-8.0-purple.svg)](https://dotnet.microsoft.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Steinberg VST3](https://img.shields.io/badge/VST3-Compatible-orange.svg)](https://www.steinberg.net/)

专业 10 槽位 VST3 效果机架与音频增效插件管理器，专为 ECHO 音乐播放器深度定制。支持低延迟实时音频流回环处理、原生 VST3 插件 GUI 承载、参数自动化控制与预设无缝管理。

---

## 📑 目录 (Table of Contents)

- [🌟 核心特性](#-核心特性)
- [🏗️ 系统架构](#️-系统架构)
- [📦 版本分类与更新日志](#-版本分类与更新日志)
  - [v1.1.0 (最新增强版)](#v110-最新增强版)
  - [v1.0.0 (基准版)](#v100-基准版)
- [🔍 深度技术攻关与逆向工程成果](#-深度技术攻关与逆向工程成果)
- [🔌 REST API 接口定义](#-rest-api-接口定义)
- [🛠️ 构建与开发指南](#️-构建与开发指南)
- [📄 开源协议](#-开源协议)

---

## 🌟 核心特性

- **10 槽位串联效果机架**：支持同时串联加载多达 10 款 VST3 效果器插件（例如 iZotope Ozone Pro、Neoverb Pro、FabFilter Pro 系列等）。
- **WASAPI 低延迟音频管线**：支持独占/共享回环音频流采集与高保真回放，端到端延迟低至毫秒级。
- **独立原生宿主引擎 (`echo-vst3-host`)**：基于 .NET 8 与 C++ COM 互操作构建，保证主播放器稳定，即使插件内部崩溃亦不影响播放器本体。
- **高 DPI 自适应插件编辑器**：精准计算 Win32 非客户区边框差值，完美支持 125%、150%、200% 等缩放，避免底部按钮被遮挡。
- **Direct2D / OpenGL 硬件加速保活**：支持插件复杂离屏 Direct2D、Direct3D11 和 OpenGL 动效渲染，告别白屏问题。
- **Steinberg VST3 完整时序与走带规范**：完整提供 `ProcessContext` 中的纳秒系统时间戳、严格单调递增时钟、Tempo (BPM)、小节节拍与播放状态位。
- **参数自动化同步**：双向处理输出参数变化队列 (`IParameterChanges`)，实现 GUI 与 DSP 核心的双向参数同步。
- **预设系统与诊断 API**：支持全机架预设快速载入与独立插槽音频流诊断 (`/api/slot/diag`)。

---

## 🏗️ 系统架构

```
+-------------------------------------------------------------------------+
|                           ECHO Music Player                             |
|  +-----------------------------+      +------------------------------+  |
|  |  UI (HTML5 / CSS3 / ES6)    |<---->|   main.cjs (Mod Lifecycle)   |  |
|  |  effects-rack.html / js     |      |   IPC & Child Process Spawn  |  |
|  +-----------------------------+      +--------------+---------------+  |
+------------------------------------------------------|------------------+
                                                       | HTTP REST API
                                                       | (Port 17892)
+------------------------------------------------------v------------------+
|                    echo-vst3-host (.NET 8 Native Host)                  |
|                                                                         |
|  +------------------------+             +----------------------------+  |
|  |    LiveAudioEngine     |             |      Vst3NativeHost        |  |
|  | (WASAPI Loopback In/Out|             | (Plugin Scan & Factory)    |  |
|  +-----------+------------+             +-------------+--------------+  |
|              |                                        |                 |
|              v                                        v                 |
|  +-------------------------------------------------------------------+  |
|  |                     RackProcessor (10 Slots Chain)                |  |
|  |   Slot 0: Ozone Pro Imager -> Slot 1: Neoverb Pro -> Slot 2...   |  |
|  |   * AudioBusBuffers (SilenceFlags Handling)                       |  |
|  |   * ProcessContext (Monotonic Samples, Tempo, Bar Position)       |  |
|  |   * ParameterChanges Sync (OutputParamChanges -> EditController)   |  |
|  +-------------------------------------------------------------------+  |
|                                                                         |
|  +-------------------------------------------------------------------+  |
|  |                     Vst3EditorWindow (Win32 HWND)                 |  |
|  |   * Accurate Non-Client Border Calculation (GetWindowRect Diff)   |  |
|  |   * DirectX / D2D Swap Chain Integrity (ContentScale 1.0f)        |  |
|  +-------------------------------------------------------------------+  |
+-------------------------------------------------------------------------+
```

---

## 📦 版本分类与更新日志

### v1.1.0 (最新增强版)
- 🚀 **高 DPI 边框精准补偿**：修复 Windows 150% DPI 下底栏按钮被窗口边框截断的问题。
- 🎨 **Direct2D 白屏根因解决**：恢复内容缩放因子至 1.0f，移除干扰桌面绑定的代码，恢复 `iZSparkleMotionWindow` 渲染。
- ⏱️ **Steinberg VST3 时序规范补全**：补全 `ProcessContext` 全部标志位与时序字段（系统纳秒时钟、小节位置、走带控制）。
- 🔄 **参数输出队列同步**：实现 `IParameterChanges` 输出队列拉取并回写至 `IEditController`。
- 🔬 **智能插件逆向支持**：逆向解析 `iZNeoverbPro.dll` 状态机与音频检测逻辑，提供状态跟踪支撑。
- 🛠️ **新增诊断端点**：`/api/slot/diag` 实时监控插槽通道、峰值电平与 COM 接口状态。

### v1.0.0 (基准版)
- 🎉 **基础机架架构初版**：支持 10 槽位 VST3 加载、WASAPI 回环音频、插件管理器界面与预设配置。

详见完整版本记录：[CHANGELOG.md](CHANGELOG.md)。

---

## 🔍 深度技术攻关与逆向工程成果

针对部分专业复杂插件（例如 **iZotope Neoverb Pro** 的 **Reverb Assistant** 智能混响助手）在非宿主环境下容易卡在 `"Waiting for you to play audio..."` 的问题，本工程进行了深度二进制逆向分析：

1. **状态机解析**：定位核心 UI 决策函数 RVA `0x922DF0`，确认 `eax == 1` 触发 Waiting 页面，采样分析累加器满足门限后推进为 `eax != 1` (Working 分析中)，分析完成后达到 `eax >= 3` (Suggestion 建议完成页)。
2. **环形累加缓冲区**：定位音频累加器 RVA `0xECED70`，明确了 DSP 块大小门限与能量阈值校验机制。
3. **技术路线验证台账**：详细记录于 [TECHNICAL_PATH_LEDGER.md](TECHNICAL_PATH_LEDGER.md)。

---

## 🔌 REST API 接口定义

宿主启动后在本地绑定 HTTP 端口（默认 `17892`）：

| 接口 | 方法 | 描述 |
| :--- | :--- | :--- |
| `/api/state` | `GET` | 获取宿主运行状态、已加载插槽及主音量 |
| `/api/plugins` | `GET` | 获取系统已扫描到的可用 VST3 插件列表 |
| `/api/plugins/scan` | `POST` | 触发扫描标准 VST3 插件目录 |
| `/api/slot/load` | `POST` | 加载指定插件至目标插槽 (`{ slotIndex, path }`) |
| `/api/slot/unload` | `POST` | 卸载目标插槽插件 (`{ slotIndex }`) |
| `/api/slot/bypass` | `POST` | 切换指定插槽的 Bypass 状态 |
| `/api/slot/editor` | `POST` | 打开/关闭指定插槽插件的 GUI 编辑器窗口 |
| `/api/slot/diag` | `GET` | 诊断指定插槽的音频流通过性、峰值电平与接口连接状态 |
| `/api/rack/transport/trigger` | `POST` | 触发一次走带从停止到播放的上升沿跳变 |

---

## 🛠️ 构建与开发指南

### 1. 环境依赖
- Windows 10 / 11 64-bit
- [.NET 8.0 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
- [Node.js](https://nodejs.org/) >= 18.0.0

### 2. 编译发布宿主
```powershell
# 在仓库根目录下执行
dotnet publish host/echo-vst3-host.csproj -c Release -r win-x64 --no-self-contained -o bin
```

### 3. 安装到 ECHO
将整个工程目录软链接或复制到 ECHO 播放器的插件目录：
```powershell
Copy-Item -Recurse -Force . "E:\Steam\steamapps\common\ECHO\Mods\installed\echo.vst3-rack"
```

---

## 📄 开源协议

本项目采用 [MIT License](LICENSE) 授权许可。
