(function() {
  const urlParams = new URLSearchParams(window.location.search);
  const HOST_BASE = urlParams.get("hostPort") ? `http://127.0.0.1:${urlParams.get("hostPort")}` : "http://127.0.0.1:17892";

  // Sync theme
  const savedTheme = localStorage.getItem("echo:vst3:theme") || "dark";
  document.documentElement.setAttribute("data-theme", savedTheme);
  document.body.setAttribute("data-theme", savedTheme);

  const DEFAULT_FOLDERS = [
    "C:\\Program Files\\Common Files\\VST3",
    "C:\\Program Files\\Common Files\\VST3\\iZotope",
    "C:\\Program Files\\VSTPlugins"
  ];

  let folders = [...DEFAULT_FOLDERS];
  let plugins = [];
  let isScanning = false;

  const el = (id) => document.getElementById(id);
  const foldersList = el("folders-list");
  const tableBody = el("plugin-table-body");
  const searchInput = el("plugin-search-input");
  const statsText = el("stats-text");
  const scanBtn = el("btn-scan-plugins");
  const scanBtnText = el("scan-btn-text");
  const scanSpinner = el("scan-spinner");
  const chkSelectAll = el("chk-select-all");
  const chkRescanExisting = el("chk-rescan-existing");

  // API Helper with timeout
  async function api(path, method = "GET", body = null, timeoutMs = 15000) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`${HOST_BASE}${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json; charset=utf-8" } : {},
        body: body ? JSON.stringify(body) : null,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn(`[PluginManager] API error to ${path}:`, err);
      return null;
    }
  }

  // Render Folders
  function renderFolders() {
    foldersList.innerHTML = "";
    folders.forEach((f, idx) => {
      const row = document.createElement("div");
      row.className = `folder-row ${idx === 0 ? "selected" : ""}`;
      row.textContent = f;
      row.onclick = () => {
        document.querySelectorAll(".folder-row").forEach(r => r.classList.remove("selected"));
        row.classList.add("selected");
      };
      foldersList.appendChild(row);
    });
  }

  // Render Plugins Table
  function renderPluginsTable(filter = "") {
    tableBody.innerHTML = "";
    const filterQuery = filter.trim().toLowerCase();

    let enabledCount = 0;
    const filtered = plugins.filter(p => {
      if (!filterQuery) return true;
      return (p.name && p.name.toLowerCase().includes(filterQuery)) ||
             (p.vendor && p.vendor.toLowerCase().includes(filterQuery)) ||
             (p.category && p.category.toLowerCase().includes(filterQuery)) ||
             (p.path && p.path.toLowerCase().includes(filterQuery));
    });

    filtered.forEach(p => {
      if (p.enabled !== false) enabledCount++;
      const tr = document.createElement("tr");

      // Checkbox
      const tdChk = document.createElement("td");
      tdChk.className = "col-chk";
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.checked = p.enabled !== false;
      chk.onchange = () => {
        p.enabled = chk.checked;
        updateStats();
      };
      tdChk.appendChild(chk);
      tr.appendChild(tdChk);

      // Status
      const tdStatus = document.createElement("td");
      tdStatus.className = "col-status";
      const isWorking = p.status !== "error" && p.status !== "invalid";
      if (isWorking) {
        tdStatus.innerHTML = `<span class="status-ok">✔ 工作正常</span>`;
      } else {
        tdStatus.innerHTML = `<span class="status-error">✖ 工作不正常 <a class="reload-link">重新加载</a></span>`;
        const reloadLink = tdStatus.querySelector(".reload-link");
        if (reloadLink) {
          reloadLink.onclick = async (e) => {
            e.stopPropagation();
            reloadLink.textContent = "加载中...";
            await api("/api/scan", "POST", { dirs: [p.path], directories: [p.path] });
            await loadPlugins();
          };
        }
      }
      tr.appendChild(tdStatus);

      // Name
      const tdName = document.createElement("td");
      tdName.className = "col-name";
      tdName.textContent = p.name || "未知增效工具";
      tr.appendChild(tdName);

      // Type
      const tdType = document.createElement("td");
      tdType.className = "col-type";
      tdType.textContent = p.type || "VST3";
      tr.appendChild(tdType);

      // Category
      const tdCat = document.createElement("td");
      tdCat.className = "col-cat";
      tdCat.textContent = p.category || "Fx";
      tr.appendChild(tdCat);

      // Vendor
      const tdVendor = document.createElement("td");
      tdVendor.className = "col-vendor";
      tdVendor.textContent = p.vendor || "iZotope";
      tr.appendChild(tdVendor);

      // Path
      const tdPath = document.createElement("td");
      tdPath.className = "col-path";
      tdPath.textContent = p.path || "";
      tdPath.title = p.path || "";
      tr.appendChild(tdPath);

      tableBody.appendChild(tr);
    });

    updateStats();
  }

  function updateStats() {
    const total = plugins.length;
    const enabled = plugins.filter(p => p.enabled !== false).length;
    statsText.textContent = `找到 ${total} 个增效工具 (已启用 ${enabled} 个)`;
  }

  // Load plugins from Host
  async function loadPlugins() {
    const res = await api("/api/plugins");
    if (res && Array.isArray(res.plugins)) {
      plugins = res.plugins;
    } else {
      plugins = [];
    }
    renderPluginsTable(searchInput.value);
  }

  // Trigger Scan
  async function triggerScan() {
    if (isScanning) return;
    isScanning = true;
    scanBtn.disabled = true;
    scanBtnText.textContent = "正在扫描增效工具...";
    scanSpinner.textContent = "⏳";
    statsText.textContent = "正在搜索 VST3 目录中的增效工具...";

    try {
      const res = await api("/api/scan", "POST", {
        dirs: folders,
        directories: folders,
        rescanExisting: chkRescanExisting ? chkRescanExisting.checked : false
      }, 25000);

      if (res && Array.isArray(res.plugins)) {
        plugins = res.plugins;
      } else {
        await loadPlugins();
      }
    } catch (err) {
      console.warn("[PluginManager] Scan caught exception:", err);
      await loadPlugins();
    } finally {
      isScanning = false;
      scanBtn.disabled = false;
      scanBtnText.textContent = "扫描增效工具";
      scanSpinner.textContent = "🔍";
      renderPluginsTable(searchInput.value);
    }
  }

  // Event Listeners
  scanBtn.addEventListener("click", triggerScan);

  searchInput.addEventListener("input", (e) => {
    renderPluginsTable(e.target.value);
  });

  el("btn-enable-all").addEventListener("click", () => {
    plugins.forEach(p => p.enabled = true);
    renderPluginsTable(searchInput.value);
  });

  el("btn-disable-all").addEventListener("click", () => {
    plugins.forEach(p => p.enabled = false);
    renderPluginsTable(searchInput.value);
  });

  chkSelectAll.addEventListener("change", () => {
    const checked = chkSelectAll.checked;
    plugins.forEach(p => p.enabled = checked);
    renderPluginsTable(searchInput.value);
  });

  // Single VST3 File Import
  const btnAddFile = el("btn-add-file");
  if (btnAddFile) {
    btnAddFile.addEventListener("click", async () => {
      statsText.textContent = "正在等待选择 VST3 插件文件...";
      const dlg = await api("/api/dialog/pick-file");
      if (!dlg || dlg.canceled || !dlg.path) {
        updateStats();
        return;
      }
      statsText.textContent = `正在探测并导入插件: ${dlg.path}...`;
      const res = await api("/api/plugin/import", "POST", { path: dlg.path });
      if (res && res.ok) {
        if (Array.isArray(res.plugins)) plugins = res.plugins;
        else if (res.plugin) {
          const idx = plugins.findIndex(p => p.path === res.plugin.path);
          if (idx >= 0) plugins[idx] = res.plugin;
          else plugins.push(res.plugin);
        }
        renderPluginsTable(searchInput.value);
        statsText.textContent = `已成功导入单个插件: ${res.plugin?.name || dlg.path}！`;
      } else {
        alert(`导入单个插件失败: ${res?.error || "未知错误"}`);
        updateStats();
      }
    });
  }

  // Folder Dialog Import
  el("btn-add-folder").addEventListener("click", async () => {
    statsText.textContent = "正在等待选择文件夹...";
    const dlg = await api("/api/dialog/pick-folder");
    if (!dlg || dlg.canceled || !dlg.path) {
      updateStats();
      return;
    }
    const chosen = dlg.path.trim();
    if (!folders.includes(chosen)) {
      folders.push(chosen);
      renderFolders();
    }
    await triggerScan();
  });

  el("btn-remove-folder").addEventListener("click", () => {
    const selected = document.querySelector(".folder-row.selected");
    if (selected) {
      const text = selected.textContent;
      folders = folders.filter(f => f !== text);
      renderFolders();
    }
  });

  el("btn-default-folders").addEventListener("click", () => {
    folders = [...DEFAULT_FOLDERS];
    renderFolders();
  });

  // Drag and drop support for single files or folders
  window.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  window.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const filePath = f.path; // Electron / Chromium provides full file path
      if (!filePath) continue;

      if (filePath.toLowerCase().endsWith(".vst3")) {
        statsText.textContent = `正在导入拖入的插件: ${filePath}...`;
        const res = await api("/api/plugin/import", "POST", { path: filePath });
        if (res && res.ok) {
          if (Array.isArray(res.plugins)) plugins = res.plugins;
          renderPluginsTable(searchInput.value);
          statsText.textContent = `已成功导入: ${res.plugin?.name || filePath}`;
        }
      } else {
        if (!folders.includes(filePath)) {
          folders.push(filePath);
          renderFolders();
        }
        await triggerScan();
      }
    }
  });

  const closeDialog = () => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "echo:vst3:togglePluginManager", visible: false }, "*");
    }
  };

  el("btn-close-dialog").addEventListener("click", closeDialog);
  el("btn-cancel").addEventListener("click", closeDialog);

  el("btn-ok").addEventListener("click", async () => {
    // Save / synchronize plugins state
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "echo:vst3:pluginsUpdated", plugins }, "*");
    }
    closeDialog();
  });

  // Init
  async function init() {
    renderFolders();
    await loadPlugins();
    if (plugins.length === 0) {
      void triggerScan();
    }
  }

  init();
})();
