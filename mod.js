(function() {
  if (window.__echoVst3RackLoaded) return;
  window.__echoVst3RackLoaded = true;

  const VST3_ICON_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M19.439 7.85c0-1.57-1.12-2.85-2.5-2.85h-1.07A3.21 3.21 0 0 0 12.5 2a3.21 3.21 0 0 0-3.369 3H8.06c-1.38 0-2.5 1.28-2.5 2.85v1.22A3.21 3.21 0 0 0 2.5 12.5a3.21 3.21 0 0 0 3.06 3.43v1.22c0 1.57 1.12 2.85 2.5 2.85h1.07a3.21 3.21 0 0 0 3.37 3 3.21 3.21 0 0 0 3.369-3h1.07c1.38 0 2.5-1.28 2.5-2.85v-1.22a3.21 3.21 0 0 0 3.061-3.43 3.21 3.21 0 0 0-3.06-3.43v-1.22z"/>
  </svg>`;

  const baseUrl = (typeof echoExternalMod !== "undefined" && echoExternalMod.baseUrl)
    ? echoExternalMod.baseUrl
    : "http://127.0.0.1:17862";

  const hostPort = (typeof echoExternalMod !== "undefined" && echoExternalMod.config?.hostPort)
    ? Number(echoExternalMod.config.hostPort)
    : 17892;

  const getAssetUrl = (subpath) => `${baseUrl}/api/mod/echo.vst3-rack/file/${encodeURIComponent(subpath)}`;
  const getAssetBase = (folder) => `${baseUrl}/api/mod/echo.vst3-rack/file/${encodeURIComponent(folder)}/`;

  let isRackVisible = false;
  let isManagerVisible = false;
  let rackContainer = null;
  let managerContainer = null;
  let rackIframe = null;
  let managerIframe = null;

  // Insert Mod Styles with Native Acrylic Frosting matching ECHO
  const styleEl = document.createElement("style");
  styleEl.id = "echo-vst3-rack-styles";
  styleEl.textContent = `
    .echo-vst3-transport-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      background: transparent;
      border: none;
      border-radius: 4px;
      color: var(--echo-text-muted, #9e9e9e);
      cursor: pointer;
      margin: 0 4px;
      transition: all 0.2s ease;
      vertical-align: middle;
    }
    .echo-vst3-transport-btn:hover {
      color: #fff;
      background: rgba(255, 255, 255, 0.1);
      transform: scale(1.05);
    }
    .echo-vst3-transport-btn.active {
      color: #00e5ff;
      background: rgba(0, 229, 255, 0.18);
    }

    /* Floating Draggable Rack Window with Native Acrylic Frosted Glass Effect */
    .echo-vst3-floating-window {
      position: fixed;
      top: 60px;
      right: 30px;
      width: 550px;
      height: 700px;
      background: rgba(18, 22, 28, 0.65) !important;
      backdrop-filter: blur(40px) saturate(1.8) !important;
      -webkit-backdrop-filter: blur(40px) saturate(1.8) !important;
      border: 1px solid rgba(255, 255, 255, 0.12) !important;
      border-radius: 10px !important;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.15) !important;
      z-index: 999999;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      resize: both;
      min-width: 440px;
      min-height: 480px;
      transition: box-shadow 0.2s ease;
    }
    .echo-vst3-floating-window:focus-within {
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.75), inset 0 1px 0 rgba(255, 255, 255, 0.25) !important;
      border-color: rgba(255, 255, 255, 0.25) !important;
    }
    .echo-vst3-floating-window[data-theme="light"] {
      background: rgba(248, 250, 252, 0.98) !important;
      border: 1px solid rgba(0, 0, 0, 0.12) !important;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.8) !important;
    }
    .echo-vst3-floating-window[data-theme="light"] .echo-vst3-window-titlebar {
      background: #ffffff !important;
      border-bottom: 1px solid #e2e8f0 !important;
      color: #0f172a !important;
    }
    .echo-vst3-floating-window[data-theme="light"] .echo-vst3-window-titlebar .title {
      color: #0f172a !important;
    }
    .echo-vst3-floating-window[data-theme="light"] .echo-vst3-window-titlebar .close-btn {
      background: #f1f5f9 !important;
      border-color: #cbd5e1 !important;
      color: #475569 !important;
    }
    .echo-vst3-floating-window[data-theme="light"] .echo-vst3-window-titlebar .close-btn:hover {
      background: #ef4444 !important;
      border-color: #ef4444 !important;
      color: #ffffff !important;
    }
    .echo-vst3-floating-window.hidden {
      display: none !important;
    }
    .echo-vst3-window-titlebar {
      height: 34px;
      background: rgba(22, 27, 34, 0.5) !important;
      backdrop-filter: blur(20px) !important;
      -webkit-backdrop-filter: blur(20px) !important;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 14px;
      cursor: move;
      user-select: none;
      font-size: 12px;
      color: #e5e7eb;
    }
    .echo-vst3-window-titlebar .title {
      font-weight: 500;
      color: #e5e7eb;
      display: flex;
      align-items: center;
      gap: 7px;
      letter-spacing: 0.3px;
    }
    .echo-vst3-window-titlebar .close-btn {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      color: #aaa;
      font-size: 11px;
      cursor: pointer;
      padding: 2px 8px;
      transition: all 0.15s ease;
    }
    .echo-vst3-window-titlebar .close-btn:hover {
      color: #fff;
      background: rgba(239, 68, 68, 0.8);
      border-color: #ef4444;
    }
    .echo-vst3-iframe-frame {
      flex: 1;
      width: 100%;
      height: 100%;
      border: none;
      background: transparent !important;
    }

    /* Modal Overlay for Plugin Manager */
    .echo-vst3-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(15px);
      -webkit-backdrop-filter: blur(15px);
      z-index: 1000000;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .echo-vst3-modal-overlay.hidden {
      display: none !important;
    }
    .echo-vst3-modal-container {
      width: 840px;
      height: 580px;
      border-radius: 10px;
      overflow: hidden;
      background: rgba(18, 22, 28, 0.82);
      backdrop-filter: blur(40px) saturate(1.5);
      -webkit-backdrop-filter: blur(40px) saturate(1.5);
      box-shadow: 0 24px 70px rgba(0, 0, 0, 0.85), inset 0 1px 0 rgba(255, 255, 255, 0.18);
      border: 1px solid rgba(255, 255, 255, 0.14);
    }

    /* Audition DAW Header Menu Item */
    .audition-vst3-topbar-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 2px 7px;
      border-radius: 3px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: var(--text-muted, #9ca3af);
      font-size: 10.5px;
      font-family: inherit;
      cursor: pointer;
      margin-left: 8px;
      transition: all 0.2s ease;
    }
    .audition-vst3-topbar-btn:hover {
      background: rgba(255, 255, 255, 0.12);
      color: var(--text-main, #ffffff);
      border-color: rgba(255, 255, 255, 0.25);
    }
  `;
  document.head.appendChild(styleEl);

  // Multi-tier asset resolution for both Loader and Clean Vanilla environments
  async function loadIframeContent(iframe, subpath) {
    const candidates = [];
    if (typeof echoExternalMod !== "undefined" && echoExternalMod.baseUrl) {
      candidates.push({
        url: `${echoExternalMod.baseUrl}/api/mod/echo.vst3-rack/file/${encodeURIComponent(subpath)}?hostPort=${hostPort}`,
        base: `${echoExternalMod.baseUrl}/api/mod/echo.vst3-rack/file/ui/`
      });
    }
    candidates.push({
      url: `file:///E:/Steam/steamapps/common/ECHO/Mods/installed/echo.vst3-rack/${subpath}`,
      base: `file:///E:/Steam/steamapps/common/ECHO/Mods/installed/echo.vst3-rack/ui/`
    });
    candidates.push({
      url: `file:///C:/Users/Xeon/Desktop/echo.vst3-rack-workshop/content/${subpath}`,
      base: `file:///C:/Users/Xeon/Desktop/echo.vst3-rack-workshop/content/ui/`
    });
    candidates.push({
      url: `file:///E:/Steam/steamapps/workshop/content/5105090/3812043824/${subpath}`,
      base: `file:///E:/Steam/steamapps/workshop/content/5105090/3812043824/ui/`
    });

    for (const c of candidates) {
      try {
        const res = await fetch(c.url);
        if (res.ok) {
          let html = await res.text();
          const hostPortInjection = `<script>window.__HOST_PORT__ = ${hostPort};</script>`;
          if (!html.includes("__HOST_PORT__")) {
            html = html.replace("<head>", `<head>${hostPortInjection}<base href="${c.base}">`);
          } else if (!html.includes("<base")) {
            html = html.replace("<head>", `<head><base href="${c.base}">`);
          }
          iframe.srcdoc = html;
          return;
        }
      } catch {}
    }

    // Fallback
    iframe.src = candidates[0]?.url || `http://127.0.0.1:17862/api/mod/echo.vst3-rack/file/${encodeURIComponent(subpath)}`;
  }

  // Create Floating Effects Rack DOM
  function createRackWindow() {
    if (rackContainer) return;
    rackContainer = document.createElement("div");
    rackContainer.className = "echo-vst3-floating-window hidden";
    rackContainer.id = "echo-vst3-rack-window";
    const curTheme = localStorage.getItem("echo:vst3:theme") || "dark";
    rackContainer.setAttribute("data-theme", curTheme);

    const titlebar = document.createElement("div");
    titlebar.className = "echo-vst3-window-titlebar";
    titlebar.innerHTML = `
      <div class="title">
        <span>VST3 效果组与机架</span>
      </div>
      <button class="close-btn" title="关闭面板">关闭</button>
    `;
    titlebar.querySelector(".close-btn").onclick = () => toggleRack(false);

    // Draggable logic
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    titlebar.addEventListener("mousedown", (e) => {
      if (e.target.closest(".close-btn")) return;
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      const rect = rackContainer.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
      rackContainer.style.right = "auto";
      rackContainer.style.left = `${initialLeft}px`;
      rackContainer.style.top = `${initialTop}px`;
      e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      rackContainer.style.left = `${Math.max(10, initialLeft + dx)}px`;
      rackContainer.style.top = `${Math.max(10, initialTop + dy)}px`;
    });

    window.addEventListener("mouseup", () => {
      isDragging = false;
    });

    rackIframe = document.createElement("iframe");
    rackIframe.className = "echo-vst3-iframe-frame";
    loadIframeContent(rackIframe, "ui/effects-rack.html");

    rackContainer.appendChild(titlebar);
    rackContainer.appendChild(rackIframe);
    document.body.appendChild(rackContainer);
  }

  // Create Modal Plugin Manager DOM
  function createManagerModal() {
    if (managerContainer) return;
    managerContainer = document.createElement("div");
    managerContainer.className = "echo-vst3-modal-overlay hidden";
    managerContainer.id = "echo-vst3-manager-modal";

    const box = document.createElement("div");
    box.className = "echo-vst3-modal-container";

    managerIframe = document.createElement("iframe");
    managerIframe.className = "echo-vst3-iframe-frame";
    loadIframeContent(managerIframe, "ui/plugin-manager.html");

    box.appendChild(managerIframe);
    managerContainer.appendChild(box);

    managerContainer.addEventListener("click", (e) => {
      if (e.target === managerContainer) toggleManager(false);
    });

    document.body.appendChild(managerContainer);
  }

  function toggleRack(visible) {
    createRackWindow();
    if (rackIframe && !rackIframe.srcdoc && !rackIframe.src) {
      loadIframeContent(rackIframe, "ui/effects-rack.html");
    }
    isRackVisible = typeof visible === "boolean" ? visible : !isRackVisible;
    rackContainer.classList.toggle("hidden", !isRackVisible);

    if (isRackVisible && rackIframe?.contentWindow) {
      rackIframe.contentWindow.postMessage({ type: "echo:vst3:refreshRack" }, "*");
    }

    document.querySelectorAll(".echo-vst3-transport-btn").forEach((btn) => {
      btn.classList.toggle("active", isRackVisible);
    });
  }

  function toggleManager(visible) {
    createManagerModal();
    if (managerIframe && !managerIframe.srcdoc && !managerIframe.src) {
      loadIframeContent(managerIframe, "ui/plugin-manager.html");
    }
    isManagerVisible = typeof visible === "boolean" ? visible : !isManagerVisible;
    managerContainer.classList.toggle("hidden", !isManagerVisible);

    if (isManagerVisible && managerIframe?.contentWindow) {
      managerIframe.contentWindow.postMessage({ type: "echo:vst3:reloadPlugins" }, "*");
    }
  }

  // Inject VST3 button into bottom player bar
  function injectBottomBar() {
    const existing = document.getElementById("echo-vst3-bar-btn");
    if (existing) return;

    const lyricsBtn = document.querySelector("button.transport-lyrics-button, button[aria-label*='歌词' i], button[title*='歌词' i]");
    if (lyricsBtn && lyricsBtn.parentElement) {
      const btn = document.createElement("button");
      btn.id = "echo-vst3-bar-btn";
      btn.className = "echo-vst3-transport-btn";
      btn.title = "VST3 效果组与机架";
      btn.innerHTML = VST3_ICON_SVG;
      btn.onclick = () => toggleRack();
      lyricsBtn.parentElement.insertBefore(btn, lyricsBtn);
      return;
    }

    const playerControls = document.querySelector(".player-bar, .controls-right, .transport-controls");
    if (playerControls) {
      const btn = document.createElement("button");
      btn.id = "echo-vst3-bar-btn";
      btn.className = "echo-vst3-transport-btn";
      btn.title = "VST3 效果组与机架";
      btn.innerHTML = VST3_ICON_SVG;
      btn.onclick = () => toggleRack();
      playerControls.appendChild(btn);
    }
  }

  // Inject into Adobe Audition DAW theme (in main doc or inside lyrics iframe)
  function injectAuditionDAW(targetDoc) {
    const doc = targetDoc || document;
    const menubar = doc.getElementById("audition-menubar");
    if (!menubar) return;

    // 1. Remove standalone "效果组(R)" and dropdown if present
    const oldRackMenu = doc.getElementById("menu-effects-rack") || doc.getElementById("audition-menu-rack");
    if (oldRackMenu) oldRackMenu.remove();
    const oldDd = doc.getElementById("audition-rack-dropdown");
    if (oldDd) oldDd.remove();

    // 2. Ensure Audition DAW's "效果(S)" menu has VST3 options if accessible
    try {
      const win = doc.defaultView;
      if (win && win.MENUS && win.MENUS.effects) {
        const hasVst = win.MENUS.effects.some((it) => it.shortcut === "Ctrl+Alt+R");
        if (!hasVst) {
          win.MENUS.effects.unshift(
            {
              get label() { return "批处理 (效果机架 / VST3 机架)"; },
              shortcut: "Ctrl+Alt+R",
              action: () => toggleRack(true)
            },
            {
              get label() { return "音频增效工具管理器..."; },
              shortcut: "Ctrl+Alt+P",
              action: () => toggleManager(true)
            },
            { divider: true }
          );
        }
      }
    } catch {}

    // Top control bar VST3 button (matching Audition DAW font & button styling)
    if (!doc.getElementById("audition-topbar-vst3-btn") && !doc.getElementById("btn-topbar-vst3")) {
      const btn = doc.createElement("button");
      btn.id = "audition-topbar-vst3-btn";
      btn.className = "audition-vst3-topbar-btn";
      btn.title = "打开 VST3 效果机架";
      btn.innerHTML = `${VST3_ICON_SVG} <span style="margin-left:4px; font-size:10.5px;">VST3</span>`;
      btn.onclick = () => toggleRack();

      const themeToggle = doc.getElementById("btn-theme-toggle") || doc.querySelector(".theme-toggle-btn");
      if (themeToggle && themeToggle.parentElement) {
        themeToggle.parentElement.insertBefore(btn, themeToggle);
      } else {
        menubar.appendChild(btn);
      }
    }
  }

  // Check iframes for Audition DAW (safely catch cross-origin exceptions)
  function scanIframes() {
    document.querySelectorAll("iframe").forEach((frame) => {
      try {
        const frameDoc = frame.contentDocument || frame.contentWindow?.document;
        if (frameDoc && frameDoc.getElementById("audition-menubar")) {
          injectAuditionDAW(frameDoc);
        }
      } catch {}
    });
  }

  // --- Audition / iZotope DSP Routing Engine ---
  let isMonitoringRequested = true;
  let hostHasActivePlugins = false;
  let isDspTakeoverEngaged = false;
  let savedEchoVolume = 1.0;
  let lastDirectPlayingFile = "";

  async function checkHostRackState() {
    try {
      const res = await fetch(`http://127.0.0.1:${hostPort}/api/state`).then(r => r.json());
      if (res && res.ok && res.state) {
        const slots = res.state.slots || [];
        hostHasActivePlugins = slots.some(s => s.hasPlugin && !s.bypassed);
        return {
          hasActivePlugins: hostHasActivePlugins,
          slotsCount: slots.filter(s => s.hasPlugin).length
        };
      }
    } catch {}
    return { hasActivePlugins: false, slotsCount: 0 };
  }

  // Multi-tier track metadata resolution (guaranteed non-empty title/artist)
  async function resolveCurrentTrackInfo() {
    let title = "";
    let artist = "";
    let filePath = "";
    let positionSeconds = 0;
    let state = "stopped";

    // 1. window.echo.playback.getStatus()
    try {
      if (typeof window.echo?.playback?.getStatus === "function") {
        const st = await window.echo.playback.getStatus();
        if (st) {
          if (st.state) state = String(st.state).toLowerCase();
          filePath = st.filePath || st.path || st.currentTrack?.filePath || st.currentTrack?.path || st.track?.filePath || st.track?.path || filePath;
          if (st.positionMs != null) positionSeconds = st.positionMs / 1000;
          else if (st.positionSeconds != null) positionSeconds = st.positionSeconds;
          if (st.title) title = st.title;
          else if (st.currentTrack?.title) title = st.currentTrack.title;
          else if (st.track?.title) title = st.track.title;
          if (st.artist) artist = st.artist;
          else if (st.currentTrack?.artist) artist = st.currentTrack.artist;
          else if (st.track?.artist) artist = st.track.artist;

          if ((!title || !filePath) && st.currentTrackId && typeof window.echo?.library?.getTrack === "function") {
            try {
              const trk = await window.echo.library.getTrack(st.currentTrackId);
              if (trk) {
                if (!title && trk.title) title = trk.title;
                if (!artist && trk.artist) artist = trk.artist;
                if (!filePath && (trk.filePath || trk.path || trk.file)) filePath = trk.filePath || trk.path || trk.file;
              }
            } catch {}
          }
        }
      }
    } catch {}

    // 2. window.__echoExternalPlayer
    try {
      const extPlayer = window.__echoExternalPlayer;
      const cur = extPlayer?.currentTrack || (typeof extPlayer?.getCurrentTrack === "function" ? extPlayer.getCurrentTrack() : null);
      if (cur) {
        if (!title && cur.title) title = cur.title;
        if (!artist && cur.artist) artist = cur.artist;
        if (!filePath && cur.filePath) filePath = cur.filePath;
      }
    } catch {}

    // 3. window.echo.playback.getQueueSession()
    try {
      if ((!title || !artist) && typeof window.echo?.playback?.getQueueSession === "function") {
        const sess = await window.echo.playback.getQueueSession();
        const cur = sess?.currentTrack || (Array.isArray(sess?.tracks) && sess.currentIndex != null ? sess.tracks[sess.currentIndex] : null);
        if (cur) {
          if (!title && cur.title) title = cur.title;
          if (!artist && cur.artist) artist = cur.artist;
          if (!filePath && (cur.filePath || cur.path || cur.file)) filePath = cur.filePath || cur.path || cur.file;
        }
      }
    } catch {}

    // 4. window.echo.audio.getStatus()
    try {
      if (typeof window.echo?.audio?.getStatus === "function") {
        const audioSt = await window.echo.audio.getStatus();
        if (audioSt) {
          if (!title && audioSt.currentTrackTitle) title = audioSt.currentTrackTitle;
          if (!artist && audioSt.currentTrackArtist) artist = audioSt.currentTrackArtist;
          if (!filePath && audioSt.currentFilePath) filePath = audioSt.currentFilePath;
          if (state === "stopped" && audioSt.state) state = String(audioSt.state).toLowerCase();
          if (!positionSeconds && audioSt.positionSeconds) positionSeconds = audioSt.positionSeconds;
        }
      }
    } catch {}

    // 5. HTML5 Audio Elements
    try {
      const audios = Array.from(document.querySelectorAll("audio"));
      for (const a of audios) {
        if (!a.paused && a.currentTime > 0) {
          state = "playing";
          if (!positionSeconds) positionSeconds = a.currentTime;
          if (!filePath && a.src && !a.src.startsWith("blob:")) filePath = a.src;
          break;
        }
      }
    } catch {}

    // 6. DOM Extraction
    try {
      if (!title) {
        const titleEl = document.querySelector(".player-bar .track-title, .player-bar .title, .track-info-title, [class*='trackTitle'], [class*='track-title']");
        if (titleEl && titleEl.textContent) title = titleEl.textContent.trim();
      }
      if (!artist) {
        const artistEl = document.querySelector(".player-bar .track-artist, .player-bar .artist, .track-info-artist, [class*='trackArtist'], [class*='track-artist']");
        if (artistEl && artistEl.textContent) artist = artistEl.textContent.trim();
      }
      const playBtn = document.querySelector(".player-bar [class*='play'], .player-bar [class*='pause'], [aria-label*='暂停'], [title*='暂停']");
      if (playBtn) {
        const label = (playBtn.getAttribute("aria-label") || playBtn.getAttribute("title") || "").toLowerCase();
        if (label.includes("暂停") || label.includes("pause") || playBtn.classList.contains("playing") || playBtn.classList.contains("is-playing")) {
          state = "playing";
        }
      }
    } catch {}

    // 7. Filename Fallback
    if (!title && filePath) {
      const fn = filePath.split(/[/\\]/).pop() || "";
      title = fn.replace(/\.[a-zA-Z0-9]+$/, "").trim();
    }

    if (typeof state === "string") state = state.toLowerCase();
    return { title, artist, filePath, positionSeconds, state };
  }

  // Track playback status updates & background DSP routing
  let lastTrackFile = "";
  let pollBusy = false;
  let pollPending = false;
  async function pollTrackStatus() {
    if (pollBusy) { pollPending = true; return; }
    pollBusy = true;
    try {
      await pollTrackStatusInner();
    } finally {
      pollBusy = false;
      if (pollPending) { pollPending = false; setTimeout(pollTrackStatus, 50); }
    }
  }
  async function pollTrackStatusInner() {
    try {
      const { title, artist, filePath, positionSeconds, state } = await resolveCurrentTrackInfo();

      // Check VST3 rack state in host
      await checkHostRackState();

      const hasAudioPluginBridge = Boolean(window.echo?.audioPlugin);
      const isLocalTrack = Boolean(filePath && !filePath.startsWith("http:") && !filePath.startsWith("https:") && !filePath.startsWith("echo-stream:") && !filePath.startsWith("blob:") && !filePath.startsWith("stream:"));
      const pluginBridgeReady = Boolean(window.echo?.audioPlugin?.isReady?.());

      if (rackIframe?.contentWindow) {
        rackIframe.contentWindow.postMessage({
          type: "echo:vst3:trackUpdate",
          title,
          artist,
          filePath,
          positionSeconds,
          state,
          dspTakeoverActive: true,
          pluginBridgeReady,
          isStreaming: !isLocalTrack
        }, "*");
      }

      if (filePath && filePath !== lastTrackFile) {
        lastTrackFile = filePath;
        fetch(`http://127.0.0.1:${hostPort}/api/rack/track`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file: filePath, title, artist, isStreaming: !isLocalTrack })
        }).catch(() => {});
      }

      // Real-time DSP Routing & Wet Playback Takeover:
      // When monitoring is requested, host has active plugins, playback state is playing,
      // and track is a local audio file:
      // 1. Mute ECHO's dry output so user doesn't hear the raw dry soundtrack.
      // 2. Start direct playback in echo-vst3-host which reads the file and routes
      //    it through the full VST3 chain (Imager, Neoverb, Maximizer, etc.) directly to the speakers.
      const shouldTakeoverDsp = Boolean(
        isMonitoringRequested &&
        hostHasActivePlugins &&
        state === "playing" &&
        isLocalTrack &&
        filePath
      );

      if (shouldTakeoverDsp) {
        // 1) Make sure host direct-play (wet) is running BEFORE muting ECHO's dry output.
        let hostOk = true;
        if (filePath !== lastDirectPlayingFile || !isDspTakeoverEngaged) {
          try {
            const r = await fetch(`http://127.0.0.1:${hostPort}/api/audio/monitor`, {
              method: "POST",
              headers: { "Content-Type": "application/json; charset=utf-8" },
              body: JSON.stringify({ active: true, directMode: true, filePath, position: positionSeconds })
            }).then(x => x.json());
            hostOk = Boolean(r && r.ok && r.directPlaying);
            if (hostOk) lastDirectPlayingFile = filePath;
          } catch { hostOk = false; }
        } else {
          try {
            const r = await fetch(`http://127.0.0.1:${hostPort}/api/audio/sync`, {
              method: "POST",
              headers: { "Content-Type": "application/json; charset=utf-8" },
              body: JSON.stringify({ state: "playing", filePath, position: positionSeconds })
            }).then(x => x.json());
            hostOk = Boolean(r && r.ok && r.directPlaying);
          } catch { hostOk = false; }
        }

        // 2) Only mute ECHO when the host is really playing the wet signal.
        if (hostOk && !isDspTakeoverEngaged) {
          try {
            const audioSt = await window.echo?.audio?.getStatus?.();
            const currentVol = audioSt?.volume ?? 1.0;
            if (currentVol > 0) savedEchoVolume = currentVol;
            await window.echo?.audio?.setOutput?.({ volume: 0 });
            isDspTakeoverEngaged = true;
          } catch (err) {
            console.warn("[VST3-Rack] Failed to mute ECHO dry output:", err);
          }
        } else if (!hostOk && isDspTakeoverEngaged) {
          // Host failed: never leave the user in silence.
          isDspTakeoverEngaged = false;
          lastDirectPlayingFile = "";
          try { await window.echo?.audio?.setOutput?.({ volume: savedEchoVolume }); } catch {}
        }
      } else {
        // Disengage DSP takeover when monitoring off, rack bypassed, paused, stopped, or streaming
        if (isDspTakeoverEngaged) {
          isDspTakeoverEngaged = false;
          lastDirectPlayingFile = "";
          fetch(`http://127.0.0.1:${hostPort}/api/audio/monitor`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active: false })
          }).catch(() => {});
          try {
            await window.echo?.audio?.setOutput?.({ volume: savedEchoVolume });
          } catch (err) {
            console.warn("[VST3-Rack] Failed to restore ECHO dry volume:", err);
          }
        } else if (state === "paused" && lastDirectPlayingFile) {
          fetch(`http://127.0.0.1:${hostPort}/api/audio/sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: "paused", position: positionSeconds })
          }).catch(() => {});
        }

        // Loopback fallback for streaming tracks or when no direct playback
        if (isMonitoringRequested && state === "playing") {
          fetch(`http://127.0.0.1:${hostPort}/api/audio/loopback`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active: true })
          }).catch(() => {});
        }
      }
    } catch {}
  }

  // Cross-window messaging
  window.addEventListener("message", (e) => {
    const data = e.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "echo:vst3:toggleRack") {
      toggleRack(data.visible);
    } else if (data.type === "echo:vst3:openPluginManager") {
      toggleManager(true);
    } else if (data.type === "echo:vst3:togglePluginManager") {
      toggleManager(data.visible);
    } else if (data.type === "echo:vst3:themeChanged") {
      if (rackContainer) rackContainer.setAttribute("data-theme", data.theme);
      if (managerContainer) managerContainer.setAttribute("data-theme", data.theme);
    } else if (data.type === "echo:vst3:pluginsUpdated") {
      if (rackIframe?.contentWindow) {
        rackIframe.contentWindow.postMessage({ type: "echo:vst3:pluginsUpdated" }, "*");
      }
    } else if (data.type === "echo:vst3:rackStatusChanged") {
      if (typeof data.isMonitoring === "boolean") isMonitoringRequested = data.isMonitoring;
      if (typeof data.hasActivePlugins === "boolean") hostHasActivePlugins = data.hasActivePlugins;
      pollTrackStatus();
    } else if (data.type === "echo:vst3:syncTrackImmediate") {
      pollTrackStatus();
    } else if (data.type === "echo:vst3:setMonitoring") {
      isMonitoringRequested = Boolean(data.active);
      fetch(`http://127.0.0.1:${hostPort}/api/audio/loopback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: isMonitoringRequested })
      }).catch(() => {});
      pollTrackStatus();
    } else if (data.type === "echo:vst3:pickAudioFile") {
      // Native audio file picker via ECHO bridge, fallback to host dialog
      if (typeof window.echo?.playback?.openLocalAudioFile === "function") {
        window.echo.playback.openLocalAudioFile().then((selectedPath) => {
          if (selectedPath && rackIframe?.contentWindow) {
            rackIframe.contentWindow.postMessage({ type: "echo:vst3:audioFilePicked", path: selectedPath }, "*");
          }
        }).catch(async () => {
          const res = await fetch(`http://127.0.0.1:${hostPort}/api/dialog/pick-file`).then(r => r.json()).catch(() => null);
          if (res?.path && rackIframe?.contentWindow) {
            rackIframe.contentWindow.postMessage({ type: "echo:vst3:audioFilePicked", path: res.path }, "*");
          }
        });
      } else {
        fetch(`http://127.0.0.1:${hostPort}/api/dialog/pick-file`)
          .then(r => r.json())
          .then(res => {
            if (res?.path && rackIframe?.contentWindow) {
              rackIframe.contentWindow.postMessage({ type: "echo:vst3:audioFilePicked", path: res.path }, "*");
            }
          }).catch(() => {});
      }
    } else if (data.type === "echo:vst3:playFile") {
      if (typeof window.echo?.playback?.playLocalFile === "function") {
        window.echo.playback.playLocalFile(data.filePath);
      }
    } else if (data.type === "echo:vst3:pausePlayback") {
      if (typeof window.echo?.playback?.pause === "function") {
        window.echo.playback.pause();
      }
    } else if (data.type === "echo:vst3:resumePlayback") {
      if (typeof window.echo?.playback?.play === "function") {
        window.echo.playback.play();
      }
    }
  });

  // Global Shortcut Handler: Ctrl+Alt+R (Rack), Ctrl+Alt+P (Plugin Manager)
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.altKey && (e.key === "r" || e.key === "R")) {
      e.preventDefault();
      toggleRack();
    } else if (e.ctrlKey && e.altKey && (e.key === "p" || e.key === "P")) {
      e.preventDefault();
      toggleManager();
    }
  });

  // DOM Observation Loop
  function startObserver() {
    injectBottomBar();
    injectAuditionDAW(document);
    scanIframes();

    const observer = new MutationObserver(() => {
      injectBottomBar();
      injectAuditionDAW(document);
      scanIframes();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Event-driven listener registration for instant <1ms playback state response
    try {
      if (typeof window.echo?.audio?.onStatus === "function") {
        window.echo.audio.onStatus(() => { pollTrackStatus(); });
      }
      if (typeof window.echo?.playback?.onStatus === "function") {
        window.echo.playback.onStatus(() => { pollTrackStatus(); });
      }
      if (typeof window.echo?.playback?.onQueueSessionChanged === "function") {
        window.echo.playback.onQueueSessionChanged(() => { pollTrackStatus(); });
      }
      if (typeof window.echo?.events?.on === "function") {
        window.echo.events.on("playback:status", () => { pollTrackStatus(); });
        window.echo.events.on("playback:track", () => { pollTrackStatus(); });
        window.echo.events.on("playback:time", () => { pollTrackStatus(); });
      }
    } catch {}

    // User interaction detection: whenever user clicks anywhere on transport/player bar
    document.addEventListener("click", (evt) => {
      if (evt.target?.closest?.(".player-bar, [class*='player'], [class*='transport'], button")) {
        setTimeout(pollTrackStatus, 50);
        setTimeout(pollTrackStatus, 300);
      }
    }, true);

    setInterval(pollTrackStatus, 500);

    window.addEventListener("beforeunload", () => {
      if (isDspTakeoverEngaged) {
        try {
          window.echo?.audio?.setOutput?.({ volume: savedEchoVolume });
        } catch {}
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserver);
  } else {
    startObserver();
  }
})();
