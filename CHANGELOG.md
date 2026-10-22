# 更新日志 (Changelog)

本项目遵循 [Semantic Versioning 2.0.0](https://semver.org/lang/zh-CN/) 规范。

---

## [1.1.0] - 2026-10-22

### 新增 (Added)
- **Steinberg VST3 ProcessContext 全规范时序支持**：
  - 补充 `kPlaying`, `kProjectTimeMusicValid`, `kTempoValid`, `kTimeSigValid`, `kBarPositionValid`, `kSystemTimeValid`, `kContTimeValid` 等状态掩码。
  - 补充微秒/纳秒级 `SystemTime` 与严格单调递增的 `ProjectTimeSamples` 时钟。
  - 增加小节音乐节拍计算与 BPM 节奏支持。
- **参数输出变更队列拉取与同步**：
  - 接入 `IParameterChanges` 输出队列处理逻辑，将插件 DSP 层的自动化参数变更实时写回 `IEditController`。
- **插槽实时音频流诊断端点**：
  - 新增 `/api/slot/diag` 接口，实时返回插槽采样率、通道数、处理结果、输入输出峰值电平及 COM 连接点状态。
- **走带跳变与脉冲控制端点**：
  - 新增 `/api/rack/transport/trigger` 与 `/api/rack/transport/set`，支持走带跳变触发，辅助需监听播放跳变沿的智能分析插件。
- **iZotope Neoverb Pro 逆向工程台账**：
  - 增加 `TECHNICAL_PATH_LEDGER.md`，记录状态机流转与环形累加缓冲区机制。

### 修复 (Fixed)
- **高 DPI (150% / 144 DPI) 非客户区边框截断问题**：
  - 修正 `Vst3EditorWindow.cs` 中的窗口尺寸计算逻辑，通过 `GetWindowRect` 与 `GetClientRect` 差值动态补偿边框厚度，解决底部 "Next" / "Cancel" 按钮被边框遮挡无法点击的问题。
- **Direct2D / DirectX 交换链失败导致白屏问题**：
  - 移除 STA 线程中显式重置 Desktop 导致的交换链破坏代码。
  - 统一约束 `IPlugViewContentScaleSupport` 缩放因子为 `1.0f`，彻底解决 iZotope 硬件加速窗口 (`iZSparkleMotionWindow`) 白屏崩溃。
- **AudioBusBuffers SilenceFlags 规范化**：
  - 明确各通道静音标志位，确保非静音音频块不被误判为静音而旁路分析。
- **内存流操作越界防护**：
  - 完善 `Vst3MemoryStreamImpl.cs` 的边界检查与只读/写入权限校验。

### 变更 (Changed)
- 升级 `echo.mod.json` 与 `package.json` 版本号至 `1.1.0`。

---

## [1.0.0] - 2026-10-09

### 新增 (Added)
- 初版发布：支持 ECHO 音乐播放器的 10 槽位 VST3 效果机架。
- 原生独立宿主进程 `echo-vst3-host.exe`，负责 VST3 插件的扫描、实例化与生命周期管理。
- 基于 WASAPI 回环的高保真音频采集与低延迟回放引擎。
- 插件 GUI 窗口挂载与显示系统。
- 前端 Web 效果机架界面与槽位控制逻辑。
