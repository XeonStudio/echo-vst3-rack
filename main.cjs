"use strict";

const { join } = require("node:path");
const { spawn } = require("node:child_process");
const http = require("node:http");

let hostProcess = null;
let isDisposed = false;

function activate(host) {
  const log = (level, msg) => {
    try {
      if (typeof host.log === "function") {
        host.log(level, `[VST3-Rack] ${msg}`);
      } else {
        console.log(`[VST3-Rack][${level}] ${msg}`);
      }
    } catch {}
  };

  const config = (host && typeof host.config === "object") ? host.config : {};
  const hostPort = Number(config.hostPort || 17892);
  const showConsole = Boolean(config.showConsole);
  const autoStartHost = config.autoStartHost !== false;

  log("INFO", `Activating ECHO VST3 Rack Mod (port=${hostPort}, showConsole=${showConsole})...`);

  const hostExePath = join(__dirname, "bin", "echo-vst3-host.exe");
  const hostBinPath = join(__dirname, "bin", "echo-vst3-host.bin");
  const fs_ = require("node:fs");
  if (!fs_.existsSync(hostExePath) && fs_.existsSync(hostBinPath)) {
    try { fs_.copyFileSync(hostBinPath, hostExePath); } catch {}
  }

  // Check if host HTTP service is alive
  function checkHostAlive(port) {
    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/api/state`, { timeout: 1200 }, (res) => {
        let d = "";
        res.on("data", c => d += c);
        res.on("end", () => {
          try {
            const json = JSON.parse(d);
            resolve(json && json.ok === true);
          } catch {
            resolve(false);
          }
        });
      });
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        try { req.destroy(); } catch {}
        resolve(false);
      });
    });
  }

  async function startHostProcess() {
    if (isDisposed || !autoStartHost) return;

    // Check if an existing host instance is already running on this port
    const alreadyAlive = await checkHostAlive(hostPort);
    if (alreadyAlive) {
      log("INFO", `VST3 Host is already active on port ${hostPort}. Reusing existing instance.`);
      return;
    }

    try {
      log("INFO", `Spawning VST3 native host: ${hostExePath} on port ${hostPort} (hide=${!showConsole})`);
      hostProcess = spawn(hostExePath, ["--port", String(hostPort)], {
        windowsHide: false,
        stdio: ["ignore", "pipe", "pipe"]
      });

      hostProcess.stdout?.on("data", (chunk) => {
        const text = chunk.toString().trim();
        if (text) log("DEBUG", `Host: ${text}`);
      });

      hostProcess.stderr?.on("data", (chunk) => {
        const text = chunk.toString().trim();
        if (text) log("WARN", `Host: ${text}`);
      });

      hostProcess.on("exit", (code, signal) => {
        log("WARN", `VST3 Host exited (code=${code}, signal=${signal})`);
        hostProcess = null;
        if (!isDisposed) {
          log("INFO", "Will attempt to restart VST3 Host in 3 seconds...");
          setTimeout(startHostProcess, 3000);
        }
      });
    } catch (err) {
      log("ERROR", `Failed to spawn VST3 host: ${err.message}`);
    }
  }

  void startHostProcess();

  // Connect to ECHO AudioPluginManager via official Named Pipe contract
  const net = require("node:net");
  const PIPE_NAME = "\\\\.\\pipe\\echo-audio-plugin-adapter";
  let adapterSocket = null;
  let adapterReconnectTimer = null;

  async function postHostJson(endpoint, data) {
    return new Promise((resolve) => {
      try {
        const payload = JSON.stringify(data || {});
        const req = http.request({
          hostname: "127.0.0.1",
          port: hostPort,
          path: endpoint,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload)
          },
          timeout: 1500
        }, (res) => {
          let d = "";
          res.on("data", c => d += c);
          res.on("end", () => {
            try { resolve(JSON.parse(d)); } catch { resolve(null); }
          });
        });
        req.on("error", () => resolve(null));
        req.on("timeout", () => {
          try { req.destroy(); } catch {}
          resolve(null);
        });
        req.write(payload);
        req.end();
      } catch {
        resolve(null);
      }
    });
  }

  function handleManagerMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    const { method, payload } = msg;
    if (method === "plugin:load") {
      log("INFO", `Received plugin:load from AudioPluginManager: ${payload?.name || payload?.classId}`);
      const pluginIdentifier = payload?.name || payload?.classId || "";
      if (pluginIdentifier) {
        postHostJson("/api/slot/load", { slot: 0, path: pluginIdentifier });
      }
    } else if (method === "plugin:setParameter") {
      if (payload?.paramId === 0) {
        const dryWet = typeof payload.normalizedValue === "number" ? payload.normalizedValue : 1.0;
        postHostJson("/api/rack/drywet", { dryWet });
      }
    } else if (method === "plugin:setBypass") {
      postHostJson("/api/slot/bypass", { slot: 0, bypassed: Boolean(payload?.bypassed) });
    } else if (method === "plugin:unload") {
      postHostJson("/api/slot/clear", { slot: 0 });
    }
  }

  function connectToAudioPluginManager() {
    if (isDisposed || adapterSocket) return;

    try {
      const socket = net.createConnection(PIPE_NAME, () => {
        log("INFO", `Connected to ECHO AudioPluginManager on ${PIPE_NAME}`);
        adapterSocket = socket;

        // Perform official handshake
        const handshake = {
          id: 1,
          method: "adapter:handshake",
          payload: {
            adapterName: "echo.vst3-rack",
            version: "1.0.0",
            pid: process.pid,
            capabilities: ["vst3", "insert-fx", "tap"]
          }
        };
        try {
          socket.write(JSON.stringify(handshake) + "\n");
        } catch {}
      });

      let buf = "";
      socket.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        const lines = buf.split("\n");
        buf = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            handleManagerMessage(msg);
          } catch (e) {
            log("WARN", `Error parsing manager message: ${e.message}`);
          }
        }
      });

      socket.on("close", () => {
        if (adapterSocket === socket) {
          adapterSocket = null;
        }
        if (!isDisposed) {
          clearTimeout(adapterReconnectTimer);
          adapterReconnectTimer = setTimeout(connectToAudioPluginManager, 2500);
        }
      });

      socket.on("error", () => {
        if (adapterSocket === socket) {
          adapterSocket = null;
        }
        if (!isDisposed) {
          clearTimeout(adapterReconnectTimer);
          adapterReconnectTimer = setTimeout(connectToAudioPluginManager, 3000);
        }
      });
    } catch {
      if (!isDisposed) {
        clearTimeout(adapterReconnectTimer);
        adapterReconnectTimer = setTimeout(connectToAudioPluginManager, 3000);
      }
    }
  }

  connectToAudioPluginManager();

  // Register Electron IPC handlers if available
  try {
    if (host.ipc && typeof host.ipc.handle === "function") {
      host.ipc.handle("echo.vst3:getStatus", async () => {
        const alive = await checkHostAlive(hostPort);
        return {
          running: alive,
          port: hostPort,
          pid: hostProcess?.pid || 0,
          adapterConnected: Boolean(adapterSocket)
        };
      });

      host.ipc.handle("echo.vst3:updateTrack", async (_event, payload) => {
        try {
          const req = http.request({
            hostname: "127.0.0.1",
            port: hostPort,
            path: "/api/rack/track",
            method: "POST",
            headers: { "Content-Type": "application/json" }
          });
          req.write(JSON.stringify(payload || {}));
          req.end();
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      });
    }
  } catch (err) {
    log("WARN", `IPC handler registration warning: ${err.message}`);
  }

  // Safe CDP query across common debug ports (9222, 9229, 9230)
  async function queryCdpTargets() {
    const candidatePorts = [9222, 9229, 9230];
    for (const p of candidatePorts) {
      const targets = await new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${p}/json`, { timeout: 800 }, (res) => {
          let d = "";
          res.on("data", c => d += c);
          res.on("end", () => {
            try { resolve(JSON.parse(d)); } catch { resolve(null); }
          });
        });
        req.on("error", () => resolve(null));
        req.on("timeout", () => {
          try { req.destroy(); } catch {}
          resolve(null);
        });
      });
      if (Array.isArray(targets) && targets.length > 0) {
        return targets;
      }
    }
    return [];
  }

  // CDP Audition DAW integration bridge
  let cdpWs = null;
  const bridgeInterval = setInterval(async () => {
    if (isDisposed) return;
    try {
      const targets = await queryCdpTargets();
      if (!targets || !targets.length) return;

      const auditionIframe = targets.find(t => {
        if (!t.url) return false;
        const u = t.url.toLowerCase();
        const title = (t.title || "").toLowerCase();
        return u.includes("3807763294") || u.includes("audition") || title.includes("audition") || u.includes("theme.json");
      });

      if (!auditionIframe || !auditionIframe.webSocketDebuggerUrl) return;

      const wsUrl = auditionIframe.webSocketDebuggerUrl;
      const WebSocketImpl = globalThis.WebSocket || (typeof require !== "undefined" ? (() => { try { return require("ws"); } catch { return null; } })() : null);
      if (!WebSocketImpl) return;

      const ws = new WebSocketImpl(wsUrl);
      cdpWs = ws;

      ws.onopen = () => {
        const code = `(() => {
          if (window.__vst3AuditionInjected) return;
          const menubar = document.getElementById("audition-menubar");
          if (!menubar) return;

          // 1. Remove standalone "效果组(R)" and dropdown if present
          const oldRackMenu = document.getElementById("audition-menu-rack") || document.getElementById("menu-effects-rack");
          if (oldRackMenu) oldRackMenu.remove();
          const oldDd = document.getElementById("audition-rack-dropdown");
          if (oldDd) oldDd.remove();

          // Ensure window.MENUS.effects has VST3 options if present
          try {
            if (window.MENUS && window.MENUS.effects && !window.MENUS.effects.some(it => it.shortcut === "Ctrl+Alt+R")) {
              window.MENUS.effects.unshift(
                { label: "批处理 (效果机架 / VST3 机架)", shortcut: "Ctrl+Alt+R", action: () => parent.postMessage({ type: "echo:vst3:toggleRack", visible: true }, "*") },
                { label: "音频增效工具管理器...", shortcut: "Ctrl+Alt+P", action: () => parent.postMessage({ type: "echo:vst3:openPluginManager" }, "*") },
                { divider: true }
              );
            }
          } catch(e) {}

          // 2. Add Topbar VST3 Button matching DAW font and styling
          if (!document.getElementById("btn-topbar-vst3")) {
            const topBtn = document.createElement("button");
            topBtn.className = "theme-toggle-btn vst3-topbar-btn";
            topBtn.id = "btn-topbar-vst3";
            topBtn.type = "button";
            topBtn.tabIndex = 0;
            topBtn.title = "打开 VST3 效果机架";
            topBtn.style.cssText = "margin-left: 8px; display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; cursor: pointer; border-radius: 3px; font-size: 10.5px; font-family: inherit;";
            topBtn.innerHTML = "<span>🎛️</span><span>VST3</span>";
            topBtn.onclick = (e) => {
              e.stopPropagation();
              parent.postMessage({ type: "echo:vst3:toggleRack" }, "*");
            };

            const themeBtn = document.getElementById("btn-theme-toggle");
            if (themeBtn && themeBtn.parentElement) {
              themeBtn.parentElement.insertBefore(topBtn, themeBtn);
            } else {
              menubar.appendChild(topBtn);
            }
          }

          window.__vst3AuditionInjected = true;
        })()`;

        ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: code } }));
      };

      ws.onmessage = () => {
        try { ws.close(); } catch {}
      };

      ws.onerror = () => {
        try { ws.close(); } catch {}
      };
    } catch {}
  }, 3000);

  // Clean termination hooks to prevent zombie processes
  const cleanupHost = () => {
    isDisposed = true;
    clearInterval(bridgeInterval);
    if (cdpWs) {
      try { cdpWs.close(); } catch {}
      cdpWs = null;
    }
    if (adapterReconnectTimer) {
      clearTimeout(adapterReconnectTimer);
      adapterReconnectTimer = null;
    }
    if (adapterSocket) {
      try { adapterSocket.destroy(); } catch {}
      adapterSocket = null;
    }
    if (hostProcess) {
      log("INFO", "Terminating VST3 native host process...");
      try {
        hostProcess.kill("SIGTERM");
      } catch {}
      hostProcess = null;
    }
  };

  try {
    if (host.app?.on) {
      host.app.on("before-quit", cleanupHost);
      host.app.on("will-quit", cleanupHost);
    }
    process.on("exit", cleanupHost);
  } catch {}

  return cleanupHost;
}

module.exports = activate;
exports.activate = activate;
