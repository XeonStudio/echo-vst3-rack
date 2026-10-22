# VST3 效果机架开发与兼容性技术台账 (Technical Path Ledger)

> **目标**：在 ECHO 音乐播放中构建专业稳定的 VST3 效果机架，解决高 DPI 截断、硬件加速白屏、Steinberg VST3 规范时钟与走带同步，并从二进制逆向工程角度彻底攻克复杂智能插件（如 iZotope Neoverb Pro Reverb Assistant）的音频分析触发条件。

---

## 1. 版本与技术演进总览

| 版本 | 重点攻关领域 | 核心变更与交付物 | 状态 |
| :--- | :--- | :--- | :--- |
| **v1.0.0** | 初始基准机架系统 | 10 槽位机架串联、WASAPI 回环音频采集、基础 COM 实例化与参数控制 | ✅ 基准发布 |
| **v1.1.0** | 高 DPI 适配、Direct2D 交换链恢复、VST3 走带规范与逆向工程 | 精准非客户区边框消除剪切、DirectX 离屏渲染保活、Steinberg ProcessContext 纳秒时钟与小节计算、Neoverb 状态机逆向解析 | ✅ 修复合并 |

---

## 2. 关键技术路径验证与结论 (Ledger of Tested Paths)

### 路径 1: 宿主窗口边框计算与高 DPI 截断问题 (已解决)
- **问题现象**：在 Windows 150% DPI (144 DPI) 下，使用常规 `AdjustWindowRectEx` 计算非客户区导致垂直高度缺损 ~35-50px，Neoverb、Ozone 等复杂插件底部的 "Next"、"Apply" 按钮被外层窗口边框截断。
- **方案实现**：在 `Vst3EditorWindow.cs` 中，创建窗口后通过 `GetWindowRect` 减去 `GetClientRect` 获得真实的系统非客户区边框差值 (`nonClientW`, `nonClientH`)，动态重设窗口尺寸为 `targetW + nonClientW`, `targetH + nonClientH`。
- **结论**：✅ **已验证可行**。插件客户区精确为原生设计尺寸（如 788x606），全分辨率下底部按钮 100% 完整显示。

---

### 路径 2: 白屏 Bug (Direct2D / DirectX 交换链失败) 根因与解决 (已解决)
- **技术排查 2.1**: 在 `Program.cs` 尝试强制 `SetProcessDpiAwarenessContext(-4)` (PerMonitorV2)。
  - **结论**：❌ **不可行**。导致 DirectX 离屏与宿主混合缩放混乱。
- **技术排查 2.2**: 在 `Vst3NativeInstance.cs` 将 `IPlugViewContentScaleSupport` 设为 `1.5f`。
  - **结论**：❌ **不可行**。iZotope Neoverb / Ozone 内部 Direct2D 不支持 >1.0 的分数因子，直接报交换链异常退化为白屏。必须严格保持 `1.0f`。
- **技术排查 2.3**: STA 线程中调用 `OpenWindowStationW` / `SetThreadDesktop`。
  - **结论**：❌ **不可行**。已启动的交互式进程在 STA 线程中显式重置 Desktop 会破坏 DirectX/D3D11 设备的交换链绑定，导致 `iZSparkleMotionWindow` 创建失败白屏。移除桌面重置代码后，Direct2D 硬件加速渲染完全恢复。
- **结论**：✅ **已解决**。保持原生 1.0f 缩放因子并避免破坏桌面上下文，插件渲染 100% 正常。

---

### 路径 3: 截图取证方式 (GDI PrintWindow vs Direct2D 抓屏) (已验证)
- **技术排查 3.1**: 使用 GDI `PrintWindow(hWnd, hdc, 2)` (PW_RENDERFULLCONTENT)。
  - **结论**：❌ **不可行**。iZotope 采用硬件加速 Direct2D/OpenGL 渲染，GDI `PrintWindow` 返回全白或黑块。
- **技术排查 3.2**: 使用 `SetForegroundWindow` + `Graphics.CopyFromScreen`。
  - **结论**：✅ **已验证可行**。能真实、像素级还原 Neoverb Pro 与 Reverb Assistant 的硬件加速画面。

---

### 路径 4: Steinberg VST3 `ProcessContext` 完整时序规范支持 (已解决)
- **排查背景**：许多专业算法与状态机监听 VST3 `ProcessContext`，缺乏走带标志将导致插件认为工程处于停止状态而不处理动态分析。
- **落地实现**：
  - `State` 标志掩码补齐：
    - `kPlaying (1 << 1)`
    - `kProjectTimeMusicValid (1 << 9)`
    - `kTempoValid (1 << 10)`
    - `kBarPositionValid (1 << 11)`
    - `kTimeSigValid (1 << 13)`
    - `kSystemTimeValid (1 << 8)`
    - `kContTimeValid (1 << 17)`
  - 严格时钟字段支持：
    - `ProjectTimeSamples`：单调递增采样计数器。
    - `ContinousTimeSamples`：连续运行采样数。
    - `SystemTime`：高精度纳秒时间戳 (`Stopwatch.GetTimestamp()`)。
    - `Tempo`：120.0 BPM。
    - `TimeSigNumerator` / `TimeSigDenominator`：4/4 拍。
    - `BarPositionMusic`：基于采样率与 BPM 计算的小节节拍位置。
  - 增加走带脉冲与控制 API：`/api/rack/transport/trigger`、`/api/rack/transport/set`。

---

### 路径 5: iZNeoverbPro.dll 逆向工程与 Reverb Assistant 触发机制 (深度剖析)
通过对 `iZNeoverbPro.dll` (45.5 MB) 结合 `Iced` 反汇编引擎进行深度符号与反汇编跟踪，定位到了 Assistant 的核心状态机与音频检测链路：

1. **状态机显示决策函数 (RVA `0x922DF0`)**：
   - 寄存器角色：`r14d` = 步骤页码 (1 = Intro, 2 = Next分析页)；`eax` = AutoCutLearner 状态；`r9d` = DeMaskerLearner 状态。
   - **Waiting 状态**：当 `r14d == 2 && eax == 1` 时，`r13b = 1`，调用 `0x9E19B0` 激活文本 `"Waiting for you to play audio..."`。
   - **Working 分析状态**：当 `r14d == 2 && eax != 1` 时，`r15b = 1, r13b = 0`，激活文本 `"Assistant is working..."`。
   - **Success 建议完成状态**：当 `eax >= 3 && r9d >= 3` 时，`r12b = 1`，显示建议页面 `"Here's a suggestion to help you get started"`。

2. **音频能量与块累加器 (RVA `0xECED70` / `0xECE9C0`)**：
   - `0xECED70` 维护内部环形累加缓冲区，每周期累加输入 PCM 样本数 (`edi`)。
   - 当累加达到块门限尺寸 `[rbx+10h]` 后，调用 `0xECE8A0` 进行能量检测与 FFT 特征提取。
   - 检测到有效能量后，状态从 1 推进为 2，随后进入多频段均衡与去混叠学习算法，最终输出优化参数。
