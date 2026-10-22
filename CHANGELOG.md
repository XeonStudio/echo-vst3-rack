# 更新日志 (Changelog)

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/) 规范。

## [1.0.0] - 2026-10-09

### 新增 (Added)
- 初版发布：支持 ECHO 音乐播放器的 10 槽位 VST3 效果机架。
- 原生独立宿主进程 `echo-vst3-host.exe`，负责 VST3 插件的扫描、实例化与生命周期管理。
- 基于 WASAPI 回环的高保真音频采集与低延迟回放引擎。
- 插件 GUI 窗口挂载与显示系统。
- 前端 Web 效果机架界面与槽位控制逻辑。
