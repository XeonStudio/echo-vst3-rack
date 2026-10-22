# ECHO VST3 Effects Rack (echo-vst3-rack)

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/XeonStudio/echo-vst3-rack)
[![Platform](https://img.shields.io/badge/platform-Windows%20x64-lightgrey.svg)](https://github.com/XeonStudio/echo-vst3-rack)
[![Framework](https://img.shields.io/badge/.NET-8.0-purple.svg)](https://dotnet.microsoft.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

专业 10 槽位 VST3 效果机架与音频增效插件管理器，专为 ECHO 音乐播放器深度定制。

## 🌟 核心特性 (v1.0.0)

- **10 槽位串联机架**：支持同时串联加载多达 10 款 VST3 效果器插件（均衡器、混响、激励、动态压缩、声场扩展等）。
- **WASAPI 低延迟音频管线**：独占/共享回环音频流采集与回放，端到端延迟低至毫秒级。
- **原生 VST3 宿主引擎**：基于 .NET 8 与 C++ COM 互操作构建的独立原生宿主进程 (`echo-vst3-host`)。
- **插件 GUI 编辑器支持**：原生 Win32 容器承载 VST3 插件图形用户界面（PlugView），支持实时参数调节。
- **预设管理系统**：支持机架级与单插件预设保存、导入与快速切换。
- **实时监控与绕过**：每个插槽均具备独立 Bypass、Solo、输入/输出电平检测与实时监听总控开关。

## 📁 目录结构

```
echo-vst3-rack/
├── assets/                  # 模组图标与视觉资源
├── bin/                     # 预构建宿主运行时与依赖组件
├── host/                    # 原生 VST3 宿主工程源码 (.NET 8 C#)
│   ├── Audio/               # WASAPI 音频采集、流处理与机架路由
│   ├── Vst3/                # Steinberg VST3 COM 接口封装与实例化
│   └── echo-vst3-host.csproj# 宿主项目工程文件
├── ui/                      # 嵌入式 Web 前端界面 (HTML/CSS/JS)
├── config.json              # 模组运行时配置文件
├── echo.mod.json            # ECHO 模组注册清单
├── main.cjs                 # 模组主进程入口与宿主生命周期管理
├── mod.js                   # 播放器前端界面注入与桥接逻辑
└── package.json             # NPM 模组元数据
```

## 🛠️ 构建与安装

1. **环境要求**：
   - Windows 10 / 11 (x64)
   - .NET 8.0 SDK
   - Node.js >= 18.0.0
2. **构建宿主**：
   ```bash
   dotnet publish host/echo-vst3-host.csproj -c Release -r win-x64 --no-self-contained -o bin
   ```
3. **部署至 ECHO**：
   将本工程完整复制至 ECHO 安装目录下的 `Mods/installed/echo.vst3-rack` 即可自动加载。
