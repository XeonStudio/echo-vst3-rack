(function() {
  const urlParams = new URLSearchParams(window.location.search);
  const customPort = window.__HOST_PORT__ || urlParams.get("hostPort") || 17892;
  const HOST_BASE = `http://127.0.0.1:${customPort}`;
  const TOTAL_SLOTS = 10;

  const state = {
    masterPower: true,
    inputGainDb: 0.0,
    outputGainDb: 0.0,
    mixRatio: 1.0,
    slots: Array.from({ length: TOTAL_SLOTS }, (_, i) => ({
      index: i,
      loaded: false,
      bypassed: false,
      isEditorOpen: false,
      plugin: null
    })),
    availablePlugins: [],
    currentTrack: "ECHO 播放就绪",
    activeSlotForSelection: null
  };

  // DOM Elements
  const el = (id) => document.getElementById(id);
  const slotsContainer = el("rack-slots");
  const masterPowerBtn = el("btn-master-power");
  const inputSlider = el("input-gain-slider");
  const outputSlider = el("output-gain-slider");
  const mixSlider = el("mix-slider");
  const inputText = el("input-gain-text");
  const outputText = el("output-gain-text");
  const mixText = el("mix-text");
  const currentTrackName = el("current-track-name");
  const presetSelect = el("rack-preset");


  // Preset Import/Export DOM elements
  const btnImportPreset = el("btn-import-preset");
  const btnExportPreset = el("btn-export-preset");
  const presetFileInput = el("preset-file-input");

  // Batch Render DOM elements
  const btnBatchRender = el("btn-batch-render");
  const batchRenderText = el("batch-render-text");
  const batchAudioInput = el("batch-audio-input");

  // Plugin Selector Modal DOM
  const selectorModal = el("plugin-selector-modal");
  const selectorList = el("selector-list");
  const selectorSearch = el("selector-search-input");
  const btnCloseSelector = el("btn-close-selector");
  const btnCloseRack = el("btn-close-rack");
  const btnOpenPluginManager = el("btn-open-plugin-manager");
  const btnThemeToggle = el("btn-theme-toggle");
  const themeToggleIcon = el("theme-toggle-icon");

  // Environment Diagnostics DOM
  const envStatusBadge = el("env-status-badge");
  const envDiagnosticsModal = el("env-diagnostics-modal");
  const btnCloseDiagnostics = el("btn-close-diagnostics");
  const btnRecheckEnv = el("btn-recheck-env");
  const diagHostStatus = el("diag-host-status");
  const diagPipeStatus = el("diag-pipe-status");
  const diagTransportStatus = el("diag-transport-status");

  // Day/Night Theme Mode
  function applyTheme(theme) {
    const isLight = theme === "light";
    document.documentElement.setAttribute("data-theme", isLight ? "light" : "dark");
    document.body.setAttribute("data-theme", isLight ? "light" : "dark");
    if (themeToggleIcon) {
      themeToggleIcon.textContent = isLight ? "☀️" : "🌙";
    }
    if (btnThemeToggle) {
      btnThemeToggle.title = isLight ? "当前: 日间模式 (点击切换至夜间模式)" : "当前: 夜间模式 (点击切换至日间模式)";
    }
    try {
      localStorage.setItem("echo:vst3:theme", isLight ? "light" : "dark");
    } catch {}
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "echo:vst3:themeChanged", theme: isLight ? "light" : "dark" }, "*");
    }
  }

  const initialTheme = (function() {
    try {
      return localStorage.getItem("echo:vst3:theme") || "dark";
    } catch {
      return "dark";
    }
  })();
  applyTheme(initialTheme);

  if (btnThemeToggle) {
    btnThemeToggle.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "dark";
      applyTheme(current === "dark" ? "light" : "dark");
    });
  }

  // Helper for API calls with adaptive timeout
  async function api(path, method = "GET", body = null, timeoutMs = null) {
    try {
      let timeout = timeoutMs;
      if (timeout == null) {
        if (path.includes("/slot/editor/open")) {
          timeout = 25000; // 25s for opening heavy VST3 GUI windows
        } else if (path.includes("/audio/render")) {
          timeout = 300000; // 5 minutes for full-track offline rendering
        } else if (path.includes("/scan")) {
          timeout = 30000; // 30s for scanning plugins
        } else {
          timeout = 8000; // 8s for regular API calls
        }
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      const res = await fetch(`${HOST_BASE}${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json; charset=utf-8" } : {},
        body: body ? JSON.stringify(body) : null,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        try {
          const errData = await res.json();
          return errData || { ok: false, error: `HTTP ${res.status}` };
        } catch {
          return { ok: false, error: `HTTP ${res.status}` };
        }
      }
      return await res.json();
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  function notifyParentRackState() {
    try {
      if (window.parent && window.parent !== window) {
        const hasActivePlugins = state.masterPower && state.slots.some(s => s.loaded && !s.bypassed);
        window.parent.postMessage({
          type: "echo:vst3:rackStatusChanged",
          masterPower: state.masterPower,
          isMonitoring: isMonitoring,
          hasActivePlugins: hasActivePlugins
        }, "*");
      }
    } catch {}
  }

  // Render Slots UI
  function renderSlots() {
    slotsContainer.innerHTML = "";
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const slot = state.slots[i];
      const slotRow = document.createElement("div");
      slotRow.className = `slot-row ${slot.loaded ? "loaded" : ""} ${slot.bypassed ? "bypassed" : ""}`;
      slotRow.dataset.index = i;

      // Slot number
      const numSpan = document.createElement("span");
      numSpan.className = "slot-number";
      numSpan.textContent = String(i + 1).padStart(2, "0");
      slotRow.appendChild(numSpan);

      // Power toggle
      const powerBtn = document.createElement("button");
      powerBtn.className = `btn-slot-power ${slot.loaded && !slot.bypassed ? "active" : ""}`;
      powerBtn.title = slot.bypassed ? "激活效果" : "旁通效果";
      powerBtn.textContent = slot.loaded ? (slot.bypassed ? "旁通" : "开") : "关";
      powerBtn.onclick = (e) => {
        e.stopPropagation();
        toggleSlotPower(i);
      };
      slotRow.appendChild(powerBtn);

      // Plugin Selector / Display
      const fieldDiv = document.createElement("div");
      fieldDiv.className = "slot-field";
      fieldDiv.title = slot.loaded ? `${slot.plugin?.name || "已加载插件"} (${slot.plugin?.path || ""})` : "点击选择 VST3 效果器";
      
      const nameSpan = document.createElement("span");
      nameSpan.className = "slot-plugin-name";
      nameSpan.textContent = slot.loaded ? (slot.plugin?.name || "已加载插件") : "(无效果)";
      fieldDiv.appendChild(nameSpan);

      const arrowSpan = document.createElement("span");
      arrowSpan.className = "slot-field-arrow";
      arrowSpan.textContent = "▼";
      fieldDiv.appendChild(arrowSpan);

      fieldDiv.onclick = () => openPluginSelector(i);
      slotRow.appendChild(fieldDiv);

      // Editor button (界面)
      const editorBtn = document.createElement("button");
      editorBtn.className = `btn-slot-editor ${slot.isEditorOpen ? "editing" : ""}`;
      editorBtn.title = slot.isEditorOpen ? "关闭原生 VST3 窗口" : "打开原生 VST3 窗口";
      editorBtn.textContent = "界面";
      editorBtn.disabled = !slot.loaded;
      editorBtn.onclick = (e) => {
        e.stopPropagation();
        toggleSlotEditor(i);
      };
      slotRow.appendChild(editorBtn);

      // Clear button (移除)
      const clearBtn = document.createElement("button");
      clearBtn.className = "btn-slot-clear";
      clearBtn.title = "移除该槽位效果";
      clearBtn.textContent = "移除";
      clearBtn.style.visibility = slot.loaded ? "visible" : "hidden";
      clearBtn.onclick = (e) => {
        e.stopPropagation();
        clearSlot(i);
      };
      slotRow.appendChild(clearBtn);

      slotsContainer.appendChild(slotRow);
    }
  }

  // Toggle slot bypass
  async function toggleSlotPower(index) {
    const slot = state.slots[index];
    if (!slot.loaded) return;
    const nextBypassed = !slot.bypassed;
    slot.bypassed = nextBypassed;
    renderSlots();
    notifyParentRackState();
    await api("/api/slot/bypass", "POST", { slot: index, bypassed: nextBypassed });
  }

  // Toggle slot native GUI editor window
  async function toggleSlotEditor(index) {
    const slot = state.slots[index];
    if (!slot.loaded) return;
    const nextOpen = !slot.isEditorOpen;
    slot.isEditorOpen = nextOpen;
    renderSlots();
    if (nextOpen) {
      if (!isMonitoring) {
        await setMonitoring(true);
      }
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "echo:vst3:syncTrackImmediate" }, "*");
      }
    }
    const endpoint = nextOpen ? "/api/slot/editor/open" : "/api/slot/editor/close";
    const res = await api(endpoint, "POST", { slot: index });
    if (nextOpen && (!res || !res.ok)) {
      slot.isEditorOpen = false;
      renderSlots();
      alert(`无法打开原生插件窗口: ${res?.error || "插件未提供独立界面或加载异常"}`);
    }
  }

  // Clear slot
  async function clearSlot(index) {
    const slot = state.slots[index];
    slot.loaded = false;
    slot.bypassed = false;
    slot.isEditorOpen = false;
    slot.plugin = null;
    renderSlots();
    notifyParentRackState();
    await api("/api/slot/unload", "POST", { slot: index });
  }

  // Master power control
  async function setMasterPower(active) {
    state.masterPower = Boolean(active);
    masterPowerBtn.classList.toggle("active", state.masterPower);
    const powerText = masterPowerBtn.querySelector(".power-text");
    if (powerText) {
      powerText.textContent = state.masterPower ? "效果已激活" : "全局已旁通";
    }
    // Set all loaded slots bypass state
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      if (state.slots[i].loaded) {
        state.slots[i].bypassed = !state.masterPower;
        await api("/api/slot/bypass", "POST", { slot: i, bypassed: !state.masterPower });
      }
    }
    renderSlots();
    notifyParentRackState();
  }

  async function toggleMasterPower() {
    await setMasterPower(!state.masterPower);
  }

  // Plugin selector modal
  function openPluginSelector(slotIndex) {
    state.activeSlotForSelection = slotIndex;
    selectorSearch.value = "";
    renderSelectorList();
    selectorModal.hidden = false;
    selectorSearch.focus();
  }

  function closePluginSelector() {
    selectorModal.hidden = true;
    state.activeSlotForSelection = null;
  }

  function renderSelectorList(filterText = "") {
    selectorList.innerHTML = "";
    const filter = filterText.trim().toLowerCase();

    // Option to clear/remove
    const clearItem = document.createElement("div");
    clearItem.className = "selector-item clear-item";
    clearItem.innerHTML = "<span>(无效果 / 移除此槽位)</span>";
    clearItem.onclick = () => {
      if (state.activeSlotForSelection !== null) {
        clearSlot(state.activeSlotForSelection);
      }
      closePluginSelector();
    };
    selectorList.appendChild(clearItem);

    // Group plugins by category or vendor
    const groups = {};
    for (const plugin of state.availablePlugins) {
      if (filter && !plugin.name.toLowerCase().includes(filter) && !plugin.vendor.toLowerCase().includes(filter)) {
        continue;
      }
      const category = plugin.category || plugin.vendor || "Other";
      if (!groups[category]) groups[category] = [];
      groups[category].push(plugin);
    }

    const categories = Object.keys(groups).sort();
    for (const cat of categories) {
      const catHeader = document.createElement("div");
      catHeader.className = "selector-category-header";
      catHeader.textContent = cat;
      selectorList.appendChild(catHeader);

      for (const p of groups[cat]) {
        const item = document.createElement("div");
        item.className = "selector-item";
        item.innerHTML = `
          <span>${p.name}</span>
          <span class="selector-item-vendor">${p.vendor || ""}</span>
        `;
        item.onclick = async () => {
          const slotIdx = state.activeSlotForSelection;
          closePluginSelector();
          if (slotIdx !== null) {
            await loadPluginIntoSlot(slotIdx, p);
          }
        };
        selectorList.appendChild(item);
      }
    }
  }

  async function loadPluginIntoSlot(index, plugin) {
    const slot = state.slots[index];
    slot.loaded = true;
    slot.bypassed = false;
    slot.isEditorOpen = false;
    slot.plugin = plugin;
    renderSlots();
    notifyParentRackState();

    const res = await api("/api/slot/load", "POST", { slot: index, path: plugin.path });
    if (!res || !res.ok) {
      console.warn(`Failed to load ${plugin.name} into slot ${index}`, res?.error);
    }
    notifyParentRackState();
  }

  function updateDiagnosticsDisplay(isHostOnline, hostData) {
    if (!envStatusBadge) return;
    if (isHostOnline) {
      envStatusBadge.className = "env-badge ready";
      const count = state.availablePlugins.length;
      envStatusBadge.textContent = `● 宿主就绪 (${count})`;
      envStatusBadge.title = `宿主服务在线 (端口:${customPort})，已识别 ${count} 款 VST3 效果器 (点击查看链路诊断)`;
      if (diagHostStatus) {
        diagHostStatus.textContent = `✔ 已连接 (127.0.0.1:${customPort})`;
        diagHostStatus.className = "diag-val ok";
      }
      if (diagPipeStatus) {
        diagPipeStatus.textContent = "✔ 适配器通道监听中";
        diagPipeStatus.className = "diag-val ok";
      }
      if (diagTransportStatus) {
        diagTransportStatus.textContent = "本地独立 DSP 引擎模式 (就绪)";
        diagTransportStatus.className = "diag-val ok";
      }
    } else {
      envStatusBadge.className = "env-badge offline";
      envStatusBadge.textContent = "○ 宿主未就绪";
      envStatusBadge.title = `未连接到本地 VST3 宿主 (127.0.0.1:${customPort})，点击查看诊断`;
      if (diagHostStatus) {
        diagHostStatus.textContent = `未启动 (127.0.0.1:${customPort})`;
        diagHostStatus.className = "diag-val warn";
      }
      if (diagPipeStatus) {
        diagPipeStatus.textContent = "休眠 (清洁安装门禁未开)";
        diagPipeStatus.className = "diag-val warn";
      }
      if (diagTransportStatus) {
        diagTransportStatus.textContent = "等待宿主进程接入";
        diagTransportStatus.className = "diag-val warn";
      }
    }
  }

  // Synchronize state with Host
  async function syncHostState() {
    const res = await api("/api/state");
    if (!res || !res.state) {
      updateDiagnosticsDisplay(false);
      return;
    }
    updateDiagnosticsDisplay(true, res.state);
    if (Array.isArray(rackState.slots)) {
      rackState.slots.forEach((s) => {
        const idx = s.index;
        if (idx >= 0 && idx < TOTAL_SLOTS) {
          state.slots[idx].loaded = Boolean(s.hasPlugin);
          state.slots[idx].bypassed = Boolean(s.bypassed);
          state.slots[idx].isEditorOpen = Boolean(s.editorOpen);
          if (s.hasPlugin) {
            state.slots[idx].plugin = {
              name: s.name,
              path: s.path
            };
          } else {
            state.slots[idx].plugin = null;
          }
        }
      });
      const loadedSlots = state.slots.filter(s => s.loaded);
      const activeSlots = state.slots.filter(s => s.loaded && !s.bypassed);
      state.masterPower = loadedSlots.length === 0 ? true : (activeSlots.length > 0);
      masterPowerBtn.classList.toggle("active", state.masterPower);
      const powerText = masterPowerBtn.querySelector(".power-text");
      if (powerText) {
        powerText.textContent = state.masterPower ? "效果已激活" : "全局已旁通";
      }
      renderSlots();
    }

    if (rackState.inputGainDb != null) {
      inputSlider.value = rackState.inputGainDb;
      inputText.textContent = `${rackState.inputGainDb >= 0 ? "+" : ""}${rackState.inputGainDb.toFixed(1)} dB`;
    }
    if (rackState.outputGainDb != null) {
      outputSlider.value = rackState.outputGainDb;
      outputText.textContent = `${rackState.outputGainDb >= 0 ? "+" : ""}${rackState.outputGainDb.toFixed(1)} dB`;
    }
    if (rackState.dryWet != null) {
      mixSlider.value = Math.round(rackState.dryWet * 100);
      mixText.textContent = `${Math.round(rackState.dryWet * 100)} %`;
    }
  }

  async function loadPluginsList() {
    const res = await api("/api/plugins");
    if (res && Array.isArray(res.plugins) && res.plugins.length > 0) {
      state.availablePlugins = res.plugins;
    } else {
      const scanRes = await api("/api/scan", "POST", { dirs: ["C:\\Program Files\\Common Files\\VST3"] });
      if (scanRes && Array.isArray(scanRes.plugins)) {
        state.availablePlugins = scanRes.plugins;
      }
    }
  }

  // Event Listeners
  inputSlider.addEventListener("input", (e) => {
    const val = Number(e.target.value);
    inputText.textContent = `${val >= 0 ? "+" : ""}${val.toFixed(1)} dB`;
    api("/api/rack/gain", "POST", { inputGainDb: val, outputGainDb: Number(outputSlider.value) });
  });

  outputSlider.addEventListener("input", (e) => {
    const val = Number(e.target.value);
    outputText.textContent = `${val >= 0 ? "+" : ""}${val.toFixed(1)} dB`;
    api("/api/rack/gain", "POST", { inputGainDb: Number(inputSlider.value), outputGainDb: val });
  });

  mixSlider.addEventListener("input", (e) => {
    const val = Number(e.target.value);
    mixText.textContent = `${val} %`;
    api("/api/rack/drywet", "POST", { dryWet: val / 100.0 });
  });

  // Pre-configured iZotope & Melodyne professional preset chains
  const BUILTIN_PRESETS = {
    "default": [],
    "master-air": [
      { nameMatch: "Ozone Pro Equalizer", fallback: "Equalizer" },
      { nameMatch: "Ozone Pro Imager", fallback: "Imager" },
      { nameMatch: "Ozone Pro Maximizer", fallback: "Maximizer" }
    ],
    "warm-tape": [
      { nameMatch: "Ozone Pro Vintage Tape", fallback: "Vintage Tape" },
      { nameMatch: "Ozone Pro Equalizer", fallback: "Equalizer" },
      { nameMatch: "Neutron Pro Compressor", fallback: "Compressor" }
    ],
    "bass-punch": [
      { nameMatch: "Neutron Pro Transient Shaper", fallback: "Transient" },
      { nameMatch: "Ozone Pro Low End Focus", fallback: "Equalizer" },
      { nameMatch: "Ozone Pro Maximizer", fallback: "Maximizer" }
    ],
    "space-reverb": [
      { nameMatch: "Ozone Pro Imager", fallback: "Imager" },
      { nameMatch: "Neoverb Pro", fallback: "Reverb" },
      { nameMatch: "Ozone Pro Maximizer", fallback: "Maximizer" }
    ],
    "vocal-clarity": [
      { nameMatch: "RX Pro Voice De-noise", fallback: "De-noise" },
      { nameMatch: "Nectar Pro", fallback: "Neutron Pro Equalizer" },
      { nameMatch: "Neutron Pro Compressor", fallback: "Compressor" },
      { nameMatch: "RX Pro De-ess", fallback: "De-ess" }
    ],
    "radio-podcast": [
      { nameMatch: "RX Pro Voice De-noise", fallback: "De-noise" },
      { nameMatch: "RX Pro De-click", fallback: "De-click" },
      { nameMatch: "Neutron Pro Compressor", fallback: "Compressor" },
      { nameMatch: "Ozone Pro Equalizer", fallback: "Equalizer" }
    ],
    "melodyne-pitch": [
      { nameMatch: "Melodyne", fallback: "Melodyne" },
      { nameMatch: "Neutron Pro Equalizer", fallback: "Equalizer" },
      { nameMatch: "Ozone Pro Maximizer", fallback: "Maximizer" }
    ]
  };

  function findPluginForPreset(rule) {
    if (!rule || !state.availablePlugins.length) return null;
    const match = rule.nameMatch.toLowerCase();
    let p = state.availablePlugins.find(item => item.name.toLowerCase() === match);
    if (!p) {
      p = state.availablePlugins.find(item => item.name.toLowerCase().includes(match));
    }
    if (!p && rule.fallback) {
      const fb = rule.fallback.toLowerCase();
      p = state.availablePlugins.find(item => item.name.toLowerCase().includes(fb));
    }
    return p || null;
  }

  async function applyPreset(presetId) {
    if (presetId === "default") {
      for (let i = 0; i < TOTAL_SLOTS; i++) {
        if (state.slots[i].loaded) {
          await clearSlot(i);
        }
      }
      return;
    }

    if (presetId.startsWith("custom:")) {
      const cName = presetId.replace("custom:", "");
      try {
        const stored = JSON.parse(localStorage.getItem("echo:vst3:customPresets") || "{}");
        const list = stored[cName] || [];
        for (let i = 0; i < TOTAL_SLOTS; i++) {
          if (state.slots[i].loaded) await clearSlot(i);
        }
        for (let i = 0; i < list.length && i < TOTAL_SLOTS; i++) {
          const rule = list[i];
          const plug = state.availablePlugins.find(p => p.path === rule.path || p.name === rule.nameMatch);
          if (plug) await loadPluginIntoSlot(i, plug);
        }
      } catch {}
      return;
    }

    const chain = BUILTIN_PRESETS[presetId];
    if (!chain) return;

    for (let i = 0; i < TOTAL_SLOTS; i++) {
      if (state.slots[i].loaded) {
        await clearSlot(i);
      }
    }

    for (let i = 0; i < chain.length && i < TOTAL_SLOTS; i++) {
      const targetRule = chain[i];
      const targetPlugin = findPluginForPreset(targetRule);
      if (targetPlugin) {
        await loadPluginIntoSlot(i, targetPlugin);
      }
    }
  }

  if (presetSelect) {
    presetSelect.addEventListener("change", async (e) => {
      const val = e.target.value;
      await applyPreset(val);
    });
  }

  const btnSavePreset = el("btn-save-preset");
  const btnDeletePreset = el("btn-delete-preset");
  if (btnSavePreset) {
    btnSavePreset.addEventListener("click", () => {
      const name = prompt("请输入要保存的效果组预设名称：");
      if (!name || !name.trim()) return;
      const customChain = state.slots
        .filter(s => s.loaded && s.plugin)
        .map(s => ({ nameMatch: s.plugin.name, path: s.plugin.path }));
      if (customChain.length === 0) {
        alert("当前机架没有任何已加载的效果插件，无法保存为空预设。");
        return;
      }
      try {
        const stored = JSON.parse(localStorage.getItem("echo:vst3:customPresets") || "{}");
        stored[name.trim()] = customChain;
        localStorage.setItem("echo:vst3:customPresets", JSON.stringify(stored));
        refreshCustomPresetsDropdown();
        alert(`已保存自定义预设【${name.trim()}】！`);
      } catch (err) {
        alert("保存失败：" + err.message);
      }
    });
  }

  if (btnDeletePreset) {
    btnDeletePreset.addEventListener("click", () => {
      const cur = presetSelect.value;
      if (!cur.startsWith("custom:")) {
        alert("内置 iZotope 预设不可删除，仅可删除您自己保存的自定义预设。");
        return;
      }
      const customName = cur.replace("custom:", "");
      if (confirm(`确定要删除自定义预设【${customName}】吗？`)) {
        try {
          const stored = JSON.parse(localStorage.getItem("echo:vst3:customPresets") || "{}");
          delete stored[customName];
          localStorage.setItem("echo:vst3:customPresets", JSON.stringify(stored));
          refreshCustomPresetsDropdown();
          presetSelect.value = "default";
        } catch {}
      }
    });
  }

  function refreshCustomPresetsDropdown() {
    const group = el("preset-custom-group");
    if (!group) return;
    group.innerHTML = "";
    try {
      const stored = JSON.parse(localStorage.getItem("echo:vst3:customPresets") || "{}");
      for (const [k, chain] of Object.entries(stored)) {
        const opt = document.createElement("option");
        opt.value = `custom:${k}`;
        opt.textContent = `[自定义] ${k} (${chain.length}个插件)`;
        group.appendChild(opt);
      }
    } catch {}
  }

  // Preset Export
  if (btnExportPreset) {
    btnExportPreset.addEventListener("click", () => {
      const loadedSlots = state.slots.filter(s => s.loaded && s.plugin);
      if (loadedSlots.length === 0) {
        alert("当前机架没有任何已加载的 VST3 插件，无法导出空预设。");
        return;
      }

      let currentName = "My_VST3_Chain";
      const curSelectVal = presetSelect.value;
      if (curSelectVal.startsWith("custom:")) {
        currentName = curSelectVal.replace("custom:", "");
      } else if (presetSelect.selectedIndex >= 0) {
        const txt = presetSelect.options[presetSelect.selectedIndex].text;
        currentName = txt.replace(/【|】|[^\w\u4e00-\u9fa5\-_]/g, "_").replace(/^_+|_+$/g, "");
      }

      const presetData = {
        name: currentName,
        format: "ECHO_VST3_PRESET_V1",
        exportedAt: new Date().toISOString(),
        settings: {
          inputGainDb: Number(inputSlider.value),
          outputGainDb: Number(outputSlider.value),
          dryWet: Number(mixSlider.value) / 100.0,
          masterPower: state.masterPower
        },
        slots: loadedSlots.map(s => ({
          index: s.index,
          name: s.plugin.name,
          vendor: s.plugin.vendor || "",
          path: s.plugin.path,
          bypassed: s.bypassed
        }))
      };

      const jsonStr = JSON.stringify(presetData, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${currentName}_vst3_preset.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  // Preset Import
  if (btnImportPreset && presetFileInput) {
    btnImportPreset.addEventListener("click", () => {
      presetFileInput.value = "";
      presetFileInput.click();
    });

    presetFileInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const raw = JSON.parse(evt.target.result);
          let presetName = raw.name || file.name.replace(/\.json$/i, "");
          let chainSlots = [];

          if (Array.isArray(raw.slots)) {
            chainSlots = raw.slots.map(s => ({
              nameMatch: s.name || s.nameMatch,
              path: s.path
            }));
          } else if (Array.isArray(raw.chain)) {
            chainSlots = raw.chain;
          } else if (Array.isArray(raw)) {
            chainSlots = raw;
          } else if (typeof raw === "object") {
            const stored = JSON.parse(localStorage.getItem("echo:vst3:customPresets") || "{}");
            let count = 0;
            for (const [k, v] of Object.entries(raw)) {
              if (Array.isArray(v)) {
                stored[k] = v;
                count++;
              }
            }
            if (count > 0) {
              localStorage.setItem("echo:vst3:customPresets", JSON.stringify(stored));
              refreshCustomPresetsDropdown();
              alert(`成功导入 ${count} 个自定义预设！`);
              return;
            }
          }

          if (chainSlots.length === 0) {
            alert("导入的文件中未发现有效的 VST3 效果器链配置。");
            return;
          }

          const confirmedName = prompt("请输入导入预设要保存的名称：", presetName);
          if (!confirmedName || !confirmedName.trim()) return;
          const finalName = confirmedName.trim();

          const stored = JSON.parse(localStorage.getItem("echo:vst3:customPresets") || "{}");
          stored[finalName] = chainSlots;
          localStorage.setItem("echo:vst3:customPresets", JSON.stringify(stored));
          refreshCustomPresetsDropdown();

          presetSelect.value = `custom:${finalName}`;
          await applyPreset(`custom:${finalName}`);
          alert(`成功导入并应用预设【${finalName}】(包含 ${chainSlots.length} 个插件)！`);
        } catch (err) {
          alert("预设文件解析失败: " + err.message);
        }
      };
      reader.readAsText(file);
    });
  }

  masterPowerBtn.addEventListener("click", toggleMasterPower);

  selectorSearch.addEventListener("input", (e) => {
    renderSelectorList(e.target.value);
  });

  btnCloseSelector.addEventListener("click", closePluginSelector);

  btnCloseRack.addEventListener("click", () => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "echo:vst3:toggleRack", visible: false }, "*");
    }
  });

  const btnMonitorAudio = el("btn-monitor-audio");
  const monitorText = el("monitor-text");
  const btnRenderTrack = el("btn-render-track");
  const renderText = el("render-text");

  let isMonitoring = true;
  let currentTrackFile = "";
  let currentTrackPos = 0;

  // Local Audio File Verification (excludes streams, blob, http, empty)
  function isLocalAudioFile(filePath) {
    if (!filePath || typeof filePath !== "string") return false;
    const p = filePath.trim();
    if (!p) return false;
    const lower = p.toLowerCase();
    if (lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("echo-stream:") || lower.startsWith("blob:") || lower.startsWith("stream:")) {
      return false;
    }
    return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\") || p.startsWith("/");
  }

  function updateRenderTrackButtonState() {
    if (!btnRenderTrack) return;
    const isLocal = isLocalAudioFile(currentTrackFile);
    if (isLocal) {
      btnRenderTrack.classList.remove("disabled-stream");
      btnRenderTrack.title = "渲染当前本地曲目经 VST3 效果处理并导出保存";
    } else {
      btnRenderTrack.classList.add("disabled-stream");
      btnRenderTrack.title = "【渲染到曲目】仅在播放本地音源时开放。当前为网络流媒体，不支持离线渲染。";
    }
  }

  // Monitoring toggle and programmatic control
  async function setMonitoring(active) {
    isMonitoring = Boolean(active);
    if (isMonitoring) {
      if (monitorText) monitorText.textContent = "实时监听: 开";
      if (btnMonitorAudio) btnMonitorAudio.classList.add("active");
      notifyParentRackState();
      const hasLoadedPlugins = state.masterPower && state.slots.some(s => s.loaded && !s.bypassed);
      const isLocal = isLocalAudioFile(currentTrackFile);
      const res = await api("/api/audio/monitor", "POST", {
        active: true,
        directMode: hasLoadedPlugins && isLocal,
        filePath: currentTrackFile,
        position: currentTrackPos
      });
      if (!res || !res.ok) {
        console.warn("开启实时监听提示: " + (res?.error || "未找到音频流或音频文件不可读"));
      }
    } else {
      if (monitorText) monitorText.textContent = "实时监听: 关";
      if (btnMonitorAudio) btnMonitorAudio.classList.remove("active");
      notifyParentRackState();
      await api("/api/audio/monitor", "POST", { active: false });
    }
  }

  async function toggleMonitoring() {
    await setMonitoring(!isMonitoring);
  }

  if (btnMonitorAudio) {
    btnMonitorAudio.addEventListener("click", async () => {
      await toggleMonitoring();
    });
  }

  // 渲染到曲目：仅本地音源开放，流媒体禁用并提示；点击时默认额外自动开启效果已激活与实时监听
  if (btnRenderTrack) {
    btnRenderTrack.addEventListener("click", async () => {
      if (!isLocalAudioFile(currentTrackFile)) {
        alert("【渲染到曲目】功能仅在使用本地音源时开放。\n\n当前正在播放网络流媒体音乐，不支持离线渲染到本地，请播放本地歌曲后再试！");
        return;
      }

      // 自动确保额外开启【效果已激活】与【实时监听】
      await setMasterPower(true);
      await setMonitoring(true);

      const hasLoadedPlugins = state.slots.some(s => s.loaded && !s.bypassed);
      if (!hasLoadedPlugins) {
        alert("机架中尚未加载任何生效的 VST3 效果器插件，请先添加效果器后再执行渲染。");
        return;
      }

      renderText.textContent = "正在渲染...";
      btnRenderTrack.disabled = true;
      try {
        const res = await api("/api/audio/render", "POST", { filePath: currentTrackFile });
        if (res && res.ok) {
          const wantPlay = confirm(`渲染完成！\n\n已保存至:\n${res.outputPath}\n\n是否立即在播放器中播放已渲染曲目？`);
          if (wantPlay && window.parent && window.parent !== window) {
            window.parent.postMessage({ type: "echo:vst3:playFile", filePath: res.outputPath }, "*");
          }
        } else {
          alert(`渲染失败: ${res?.error || "后端解码或文件访问错误"}`);
        }
      } catch (err) {
        alert(`渲染异常: ${err.message}`);
      } finally {
        renderText.textContent = "渲染到曲目";
        btnRenderTrack.disabled = false;
      }
    });
  }

  // Batch Audio Render (Streamlined Single-Action Flow)
  async function handleBatchRenderFile(filePath) {
    if (!filePath || !filePath.trim()) return;
    filePath = filePath.trim();

    if (!isLocalAudioFile(filePath)) {
      alert("选中的文件不是有效的本地音频文件，无法进行离线批处理渲染。");
      return;
    }

    // 确保同时开启了效果已激活和打开实时监听
    if (!state.masterPower) {
      await setMasterPower(true);
    }
    if (!isMonitoring) {
      await setMonitoring(true);
    }

    const fileName = filePath.split(/[/\\]/).pop() || "音频文件";
    btnBatchRender.disabled = true;
    if (batchRenderText) batchRenderText.textContent = `渲染中: ${fileName.length > 12 ? fileName.substring(0, 10) + "…" : fileName}`;

    try {
      const res = await api("/api/audio/render", "POST", { filePath });
      if (res && res.ok) {
        if (batchRenderText) batchRenderText.textContent = "批处理完成!";
        const wantPlay = confirm(`批处理渲染成功！\n\n已保存至:\n${res.outputPath}\n\n是否立即在播放器中播放已渲染音频？`);
        if (wantPlay && window.parent && window.parent !== window) {
          window.parent.postMessage({ type: "echo:vst3:playFile", filePath: res.outputPath }, "*");
        }
      } else {
        alert(`批处理渲染失败: ${res?.error || "音频解码或写盘错误"}`);
      }
    } catch (err) {
      alert(`批处理渲染异常: ${err.message}`);
    } finally {
      setTimeout(() => {
        btnBatchRender.disabled = false;
        if (batchRenderText) batchRenderText.textContent = "批处理渲染文件...";
      }, 2000);
    }
  }

  if (batchAudioInput) {
    batchAudioInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) {
        const filePath = file.path || file.name;
        if (filePath) {
          handleBatchRenderFile(filePath);
        }
      }
      batchAudioInput.value = "";
    });
  }

  if (btnBatchRender) {
    btnBatchRender.addEventListener("click", async () => {
      if (btnBatchRender.disabled) return;

      // 点击批处理时，同样默认额外打开【效果已激活】与【实时监听】
      await setMasterPower(true);
      await setMonitoring(true);

      const hasLoadedPlugins = state.slots.some(s => s.loaded && !s.bypassed);
      if (!hasLoadedPlugins) {
        alert("机架中尚未加载任何生效的 VST3 效果器插件，请先添加效果器后再执行批处理渲染。");
        return;
      }

      if (batchAudioInput) {
        batchAudioInput.click();
      } else if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "echo:vst3:pickAudioFile" }, "*");
      } else {
        const res = await api("/api/dialog/pick-file");
        if (res && res.path) {
          handleBatchRenderFile(res.path);
        }
      }
    });
  }

  // Keyboard shortcut & Escape key support within iframe
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (envDiagnosticsModal && !envDiagnosticsModal.classList.contains("hidden")) {
        envDiagnosticsModal.classList.add("hidden");
      } else if (selectorModal && !selectorModal.classList.contains("hidden")) {
        closePluginSelector();
      } else if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "echo:vst3:toggleRack", visible: false }, "*");
      }
    } else if (e.ctrlKey && e.altKey && (e.key === "r" || e.key === "R")) {
      e.preventDefault();
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "echo:vst3:toggleRack", visible: false }, "*");
      }
    }
  });

  // Diagnostics badge & modal event listeners
  if (envStatusBadge && envDiagnosticsModal) {
    envStatusBadge.addEventListener("click", () => {
      envDiagnosticsModal.classList.toggle("hidden");
    });
  }
  if (btnCloseDiagnostics && envDiagnosticsModal) {
    btnCloseDiagnostics.addEventListener("click", () => {
      envDiagnosticsModal.classList.add("hidden");
    });
  }
  if (btnRecheckEnv) {
    btnRecheckEnv.addEventListener("click", async () => {
      btnRecheckEnv.disabled = true;
      btnRecheckEnv.textContent = "检测中...";
      await loadPluginsList();
      await syncHostState();
      setTimeout(() => {
        btnRecheckEnv.disabled = false;
        btnRecheckEnv.textContent = "刷新检测";
      }, 500);
    });
  }

  btnOpenPluginManager.addEventListener("click", () => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "echo:vst3:openPluginManager" }, "*");
    }
  });

  // Track info listener
  window.addEventListener("message", (e) => {
    const data = e.data;
    if (data && data.type === "echo:vst3:trackUpdate") {
      const displayTitle = data.title || (data.filePath ? data.filePath.split(/[/\\]/).pop().replace(/\.[a-zA-Z0-9]+$/, "") : "");
      if (displayTitle) {
        state.currentTrack = `${displayTitle}${data.artist ? " - " + data.artist : ""}`;
        if (currentTrackName) {
          currentTrackName.textContent = state.currentTrack;
          currentTrackName.title = `正在播放: ${state.currentTrack}`;
        }
        api("/api/rack/track", "POST", { file: state.currentTrack });
      } else if (data.state === "playing") {
        if (currentTrackName && currentTrackName.textContent === "未在播放") {
          currentTrackName.textContent = "正在播放音频流";
        }
      } else if (data.state === "stopped") {
        if (currentTrackName && !state.currentTrack) {
          currentTrackName.textContent = "未在播放";
        }
      }
      if (data.filePath != null) {
        currentTrackFile = data.filePath;
        updateRenderTrackButtonState();
      }
      if (data.positionSeconds != null) {
        currentTrackPos = data.positionSeconds;
      }
    } else if (data && data.type === "echo:vst3:pluginsUpdated") {
      loadPluginsList();
    } else if (data && data.type === "echo:vst3:audioFilePicked") {
      if (data.path) {
        handleBatchRenderFile(data.path);
      }
    }
  });

  // Initialization
  async function init() {
    updateRenderTrackButtonState();
    renderSlots();
    refreshCustomPresetsDropdown();
    await loadPluginsList();
    await syncHostState();
    await setMonitoring(true);
  }

  init();
})();
