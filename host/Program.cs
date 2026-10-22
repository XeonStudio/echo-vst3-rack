using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using EchoVst3Host.Audio;
using SonicWave.Audio.Vst3;

namespace EchoVst3Host;

public class Program
{
    private static readonly RackProcessor s_rack = new RackProcessor();
    private static LiveAudioEngine? s_liveAudio;
    private static List<Vst3PluginInfo> s_scannedPlugins = new List<Vst3PluginInfo>();
    private static int s_httpPort = 17892;
    private static HttpListener? s_httpListener;
    private static bool s_running = true;

    [STAThread]
    public static void Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        Trace.Listeners.Add(new ConsoleTraceListener());

        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--port" && i + 1 < args.Length && int.TryParse(args[i + 1], out int p))
            {
                s_httpPort = p;
            }
        }

        Console.WriteLine($"[echo-vst3-host] Starting ECHO VST3 Host Engine on port {s_httpPort}...");

        // Load cached plugins
        LoadPluginCache();

        // Start Live Audio Engine with WASAPI Loopback Capture
        try
        {
            s_liveAudio = new LiveAudioEngine(s_rack);
            s_liveAudio.StartLoopback();
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[echo-vst3-host] LiveAudio init warning: {ex.Message}");
        }

        // Pre-scan default directory asynchronously and merge
        _ = Task.Run(() =>
        {
            try
            {
                var scanned = Vst3Scanner.Scan();
                lock (s_scannedPlugins)
                {
                    var map = new Dictionary<string, Vst3PluginInfo>(StringComparer.OrdinalIgnoreCase);
                    foreach (var p in s_scannedPlugins) map[p.Path] = p;
                    foreach (var p in scanned) map[p.Path] = p;
                    s_scannedPlugins = map.Values.ToList();
                    SavePluginCache();
                }
                Console.WriteLine($"[echo-vst3-host] Scan complete. Found {s_scannedPlugins.Count} plugins.");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[echo-vst3-host] Scan warning: {ex.Message}");
            }
        });

        // Start HTTP API Server
        StartHttpServer();

        // Start Stdin JSON-RPC listener
        _ = Task.Run(ReadStdinLoop);

        // Keep main thread alive
        var tcs = new TaskCompletionSource<bool>();
        AppDomain.CurrentDomain.ProcessExit += (s, e) =>
        {
            s_running = false;
            s_liveAudio?.Dispose();
            s_rack.Dispose();
            tcs.TrySetResult(true);
        };

        tcs.Task.Wait();
    }

    private static string GetCacheFilePath()
    {
        string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "echo-vst3-rack");
        if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
        return Path.Combine(dir, "plugins_cache.json");
    }

    private static void SavePluginCache()
    {
        try
        {
            string file = GetCacheFilePath();
            string json = JsonSerializer.Serialize(s_scannedPlugins, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(file, json, Encoding.UTF8);
        }
        catch {}
    }

    private static void LoadPluginCache()
    {
        try
        {
            string file = GetCacheFilePath();
            if (File.Exists(file))
            {
                string json = File.ReadAllText(file, Encoding.UTF8);
                var list = JsonSerializer.Deserialize<List<Vst3PluginInfo>>(json);
                if (list != null && list.Count > 0)
                {
                    s_scannedPlugins = list;
                    Console.WriteLine($"[echo-vst3-host] Loaded {s_scannedPlugins.Count} plugins from cache.");
                }
            }
        }
        catch {}
    }

    private static string? ShowOpenFileDialog(string filter, string title)
    {
        string? result = null;
        var thread = new Thread(() =>
        {
            try
            {
                using var ofd = new System.Windows.Forms.OpenFileDialog
                {
                    Filter = filter,
                    Title = title,
                    CheckFileExists = true,
                    Multiselect = false
                };
                if (ofd.ShowDialog() == System.Windows.Forms.DialogResult.OK)
                {
                    result = ofd.FileName;
                }
            }
            catch (Exception ex)
            {
                Trace.WriteLine($"[ShowOpenFileDialog] Error: {ex.Message}");
            }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
        return result;
    }

    private static string? ShowFolderBrowserDialog(string desc)
    {
        string? result = null;
        var thread = new Thread(() =>
        {
            try
            {
                using var fbd = new System.Windows.Forms.FolderBrowserDialog
                {
                    Description = desc,
                    UseDescriptionForTitle = true,
                    ShowNewFolderButton = false
                };
                if (fbd.ShowDialog() == System.Windows.Forms.DialogResult.OK)
                {
                    result = fbd.SelectedPath;
                }
            }
            catch (Exception ex)
            {
                Trace.WriteLine($"[ShowFolderBrowserDialog] Error: {ex.Message}");
            }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
        return result;
    }


    private static void StartHttpServer()
    {
        try
        {
            s_httpListener = new HttpListener();
            s_httpListener.Prefixes.Add($"http://127.0.0.1:{s_httpPort}/");
            s_httpListener.Prefixes.Add($"http://localhost:{s_httpPort}/");
            s_httpListener.Start();
            Console.WriteLine($"[echo-vst3-host] HTTP API listening on http://127.0.0.1:{s_httpPort}/");

            _ = Task.Run(async () =>
            {
                while (s_running && s_httpListener.IsListening)
                {
                    try
                    {
                        var context = await s_httpListener.GetContextAsync();
                        _ = Task.Run(() => HandleHttpRequest(context));
                    }
                    catch
                    {
                        if (!s_running) break;
                    }
                }
            });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[echo-vst3-host] HTTP Listener warning: {ex.Message}");
        }
    }

    private static async Task HandleHttpRequest(HttpListenerContext ctx)
    {
        var req = ctx.Request;
        var res = ctx.Response;

        // CORS headers
        res.AddHeader("Access-Control-Allow-Origin", "*");
        res.AddHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.AddHeader("Access-Control-Allow-Headers", "Content-Type, X-Requested-With");

        if (req.HttpMethod == "OPTIONS")
        {
            res.StatusCode = 204;
            res.Close();
            return;
        }

        string rawUrl = req.RawUrl ?? "/";
        string path = rawUrl.Split('?')[0].TrimEnd('/');
        string responseJson = "";
        int statusCode = 200;

        try
        {
            string body = "";
            if (req.HasEntityBody)
            {
                using var reader = new StreamReader(req.InputStream, Encoding.UTF8);
                body = await reader.ReadToEndAsync();
            }

            JsonDocument? doc = null;
            if (!string.IsNullOrWhiteSpace(body))
            {
                try { doc = JsonDocument.Parse(body); } catch {}
            }

            switch (path.ToLowerInvariant())
            {
                case "/api/status":
                case "":
                    responseJson = JsonSerializer.Serialize(new { ok = true, version = "1.0.0", port = s_httpPort });
                    break;

                case "/api/scan":
                    List<string>? customDirs = null;
                    if (doc != null && doc.RootElement.TryGetProperty("dirs", out var dirsEl) && dirsEl.ValueKind == JsonValueKind.Array)
                    {
                        customDirs = new List<string>();
                        foreach (var item in dirsEl.EnumerateArray())
                        {
                            var s = item.GetString();
                            if (!string.IsNullOrEmpty(s)) customDirs.Add(s);
                        }
                    }

                    bool rescanExisting = false;
                    if (doc != null && doc.RootElement.TryGetProperty("rescanExisting", out var rescanEl))
                    {
                        rescanExisting = rescanEl.GetBoolean();
                    }

                    // Fast path: if not forced rescan and we already have cached plugins in memory, return immediately!
                    if (!rescanExisting && s_scannedPlugins.Count > 0 && (customDirs == null || customDirs.Count == 0))
                    {
                        responseJson = JsonSerializer.Serialize(new { ok = true, count = s_scannedPlugins.Count, plugins = s_scannedPlugins });
                        break;
                    }

                    var scanned = Vst3Scanner.Scan(customDirs);
                    lock (s_scannedPlugins)
                    {
                        var map = new Dictionary<string, Vst3PluginInfo>(StringComparer.OrdinalIgnoreCase);
                        foreach (var p in s_scannedPlugins) map[p.Path] = p;
                        foreach (var p in scanned) map[p.Path] = p;
                        s_scannedPlugins = map.Values.ToList();
                        SavePluginCache();
                    }
                    responseJson = JsonSerializer.Serialize(new { ok = true, count = s_scannedPlugins.Count, plugins = s_scannedPlugins });
                    break;

                case "/api/plugins":
                    responseJson = JsonSerializer.Serialize(new { ok = true, plugins = s_scannedPlugins });
                    break;

                case "/api/state":
                    responseJson = JsonSerializer.Serialize(new { ok = true, state = s_rack.GetState() });
                    break;

                case "/api/slot/load":
                    if (doc != null && doc.RootElement.TryGetProperty("slot", out var slotEl) && doc.RootElement.TryGetProperty("path", out var pathEl))
                    {
                        int slot = slotEl.GetInt32();
                        string p = pathEl.GetString() ?? "";
                        bool ok = s_rack.LoadSlot(slot, p, out string err);
                        if (ok && s_liveAudio != null && !s_liveAudio.IsLoopbackActive)
                        {
                            s_liveAudio.StartLoopback();
                        }
                        responseJson = JsonSerializer.Serialize(new { ok, error = err, state = s_rack.GetState() });
                    }
                    else
                    {
                        responseJson = JsonSerializer.Serialize(new { ok = false, error = "缺少 slot 或 path 参数" });
                    }
                    break;

                case "/api/slot/unload":
                    if (doc != null && doc.RootElement.TryGetProperty("slot", out var uSlotEl))
                    {
                        int slot = uSlotEl.GetInt32();
                        s_rack.UnloadSlot(slot);
                        responseJson = JsonSerializer.Serialize(new { ok = true, state = s_rack.GetState() });
                    }
                    else
                    {
                        responseJson = JsonSerializer.Serialize(new { ok = false, error = "缺少 slot 参数" });
                    }
                    break;

                case "/api/slot/bypass":
                    if (doc != null && doc.RootElement.TryGetProperty("slot", out var bSlotEl))
                    {
                        int slot = bSlotEl.GetInt32();
                        if (doc.RootElement.TryGetProperty("bypassed", out var bypEl))
                        {
                            s_rack.SetSlotBypass(slot, bypEl.GetBoolean());
                        }
                        else
                        {
                            s_rack.ToggleSlotBypass(slot);
                        }
                        responseJson = JsonSerializer.Serialize(new { ok = true, state = s_rack.GetState() });
                    }
                    else
                    {
                        responseJson = JsonSerializer.Serialize(new { ok = false, error = "缺少 slot 参数" });
                    }
                    break;

                case "/api/slot/editor/open":
                    if (doc != null && doc.RootElement.TryGetProperty("slot", out var oeSlotEl))
                    {
                        int slot = oeSlotEl.GetInt32();
                        if (s_liveAudio != null && !s_liveAudio.IsLoopbackActive && !s_liveAudio.IsDirectPlaying)
                        {
                            s_liveAudio.StartLoopback();
                        }
                        bool ok = s_rack.OpenSlotEditor(slot, out string err);
                        responseJson = JsonSerializer.Serialize(new { ok, error = err, state = s_rack.GetState() });
                    }
                    else
                    {
                        responseJson = JsonSerializer.Serialize(new { ok = false, error = "缺少 slot 参数" });
                    }
                    break;

                case "/api/slot/editor/close":
                    if (doc != null && doc.RootElement.TryGetProperty("slot", out var ceSlotEl))
                    {
                        int slot = ceSlotEl.GetInt32();
                        s_rack.CloseSlotEditor(slot);
                        responseJson = JsonSerializer.Serialize(new { ok = true, state = s_rack.GetState() });
                    }
                    else
                    {
                        responseJson = JsonSerializer.Serialize(new { ok = false, error = "缺少 slot 参数" });
                    }
                    break;



                case "/api/rack/gain":
                    if (doc != null)
                    {
                        if (doc.RootElement.TryGetProperty("inputGainDb", out var ig)) s_rack.InputGainDb = ig.GetDouble();
                        if (doc.RootElement.TryGetProperty("outputGainDb", out var og)) s_rack.OutputGainDb = og.GetDouble();
                        responseJson = JsonSerializer.Serialize(new { ok = true, state = s_rack.GetState() });
                    }
                    break;

                case "/api/rack/drywet":
                    if (doc != null && doc.RootElement.TryGetProperty("dryWet", out var dw))
                    {
                        s_rack.DryWet = dw.GetDouble();
                        responseJson = JsonSerializer.Serialize(new { ok = true, state = s_rack.GetState() });
                    }
                    break;

                case "/api/rack/track":
                    if (doc != null && doc.RootElement.TryGetProperty("file", out var fEl))
                    {
                        s_rack.CurrentFile = fEl.GetString() ?? "";
                        responseJson = JsonSerializer.Serialize(new { ok = true, state = s_rack.GetState() });
                    }
                    break;

                case "/api/rack/preset":
                    if (doc != null && doc.RootElement.TryGetProperty("preset", out var prEl))
                    {
                        s_rack.CurrentPreset = prEl.GetString() ?? "(默认)";
                        responseJson = JsonSerializer.Serialize(new { ok = true, state = s_rack.GetState() });
                    }
                    break;

                case "/api/meters":
                    responseJson = JsonSerializer.Serialize(new
                    {
                        ok = true,
                        inputPeakDb = s_rack.InputPeakDb,
                        inputRmsDb = s_rack.InputRmsDb,
                        outputPeakDb = s_rack.OutputPeakDb,
                        outputRmsDb = s_rack.OutputRmsDb
                    });
                    break;

                case "/api/dialog/pick-file":
                    string? pickedFile = ShowOpenFileDialog("VST3 插件 (*.vst3)|*.vst3|所有文件 (*.*)|*.*", "选择 VST3 插件文件");
                    responseJson = JsonSerializer.Serialize(new
                    {
                        ok = true,
                        canceled = string.IsNullOrEmpty(pickedFile),
                        path = pickedFile ?? ""
                    });
                    break;

                case "/api/dialog/pick-folder":
                    string? pickedFolder = ShowFolderBrowserDialog("选择包含 VST3 插件的文件夹");
                    responseJson = JsonSerializer.Serialize(new
                    {
                        ok = true,
                        canceled = string.IsNullOrEmpty(pickedFolder),
                        path = pickedFolder ?? ""
                    });
                    break;

                case "/api/plugin/import":
                    if (doc != null && doc.RootElement.TryGetProperty("path", out var impPathEl))
                    {
                        string impPath = impPathEl.GetString() ?? "";
                        var info = Vst3Scanner.ScanSingle(impPath);
                        if (info != null)
                        {
                            lock (s_scannedPlugins)
                            {
                                int existingIdx = s_scannedPlugins.FindIndex(p => string.Equals(p.Path, info.Path, StringComparison.OrdinalIgnoreCase));
                                if (existingIdx >= 0)
                                {
                                    s_scannedPlugins[existingIdx] = info;
                                }
                                else
                                {
                                    s_scannedPlugins.Add(info);
                                }
                                SavePluginCache();
                            }
                            responseJson = JsonSerializer.Serialize(new
                            {
                                ok = true,
                                plugin = info,
                                count = s_scannedPlugins.Count,
                                plugins = s_scannedPlugins
                            });
                        }
                        else
                        {
                            responseJson = JsonSerializer.Serialize(new { ok = false, error = $"无法探测或解析指定的 VST3 插件: {impPath}" });
                        }
                    }
                    else
                    {
                        responseJson = JsonSerializer.Serialize(new { ok = false, error = "缺少 path 参数" });
                    }
                    break;

                case "/api/audio/status":
                    responseJson = JsonSerializer.Serialize(new
                    {
                        ok = true,
                        loopbackActive = s_liveAudio?.IsLoopbackActive ?? false,
                        directPlaying = s_liveAudio?.IsDirectPlaying ?? false,
                        sampleRate = s_rack.SampleRate,
                        channels = s_rack.Channels
                    });
                    break;

                case "/api/audio/devices":
                    var devList = new List<object>();
                    try
                    {
                        var enumerator = new NAudio.CoreAudioApi.MMDeviceEnumerator();
                        var endpoints = enumerator.EnumerateAudioEndPoints(NAudio.CoreAudioApi.DataFlow.Render, NAudio.CoreAudioApi.DeviceState.Active);
                        foreach (var d in endpoints)
                        {
                            devList.Add(new { id = d.ID, name = d.FriendlyName });
                        }
                    }
                    catch {}
                    responseJson = JsonSerializer.Serialize(new { ok = true, devices = devList });
                    break;

                case "/api/audio/loopback":
                    if (doc != null && doc.RootElement.TryGetProperty("active", out var lbEl))
                    {
                        bool enable = lbEl.GetBoolean();
                        string? targetDev = doc.RootElement.TryGetProperty("deviceId", out var dEl) ? dEl.GetString() : null;
                        if (enable) s_liveAudio?.StartLoopback(targetDev);
                        else s_liveAudio?.StopLoopback();
                    }
                    responseJson = JsonSerializer.Serialize(new
                    {
                        ok = true,
                        loopbackActive = s_liveAudio?.IsLoopbackActive ?? false
                    });
                    break;

                case "/api/audio/monitor":
                    if (doc != null && doc.RootElement.TryGetProperty("active", out var monEl))
                    {
                        bool active = monEl.GetBoolean();
                        string err = "";
                        bool ok = true;
                        if (active)
                        {
                            string? targetDev = doc.RootElement.TryGetProperty("deviceId", out var devEl) ? devEl.GetString() : null;
                            bool directMode = doc.RootElement.TryGetProperty("directMode", out var dmEl) && dmEl.GetBoolean();
                            string f = doc.RootElement.TryGetProperty("filePath", out var fp) ? fp.GetString() ?? "" : s_rack.CurrentFile;
                            double pos = doc.RootElement.TryGetProperty("position", out var posEl) ? posEl.GetDouble() : 0.0;

                            if (directMode && !string.IsNullOrEmpty(f) && s_liveAudio != null)
                            {
                                ok = s_liveAudio.StartDirectPlay(f, pos, out err);
                            }
                            else if (s_liveAudio != null && !s_liveAudio.IsLoopbackActive)
                            {
                                s_liveAudio.StartLoopback(targetDev);
                            }

                            responseJson = JsonSerializer.Serialize(new
                            {
                                ok,
                                error = err,
                                loopbackActive = s_liveAudio?.IsLoopbackActive ?? false,
                                directPlaying = s_liveAudio?.IsDirectPlaying ?? false
                            });
                        }
                        else
                        {
                            s_liveAudio?.StopDirectPlay();
                            responseJson = JsonSerializer.Serialize(new { ok = true, directPlaying = false, loopbackActive = s_liveAudio?.IsLoopbackActive ?? false });
                        }
                    }
                    else
                    {
                        responseJson = JsonSerializer.Serialize(new { ok = false, error = "缺少 active 参数" });
                    }
                    break;

                case "/api/audio/sync":
                    if (doc != null)
                    {
                        string stateStr = doc.RootElement.TryGetProperty("state", out var stEl) ? stEl.GetString() ?? "" : "";
                        double posSec = doc.RootElement.TryGetProperty("position", out var pEl) ? pEl.GetDouble() : 0.0;
                        string syncFile = doc.RootElement.TryGetProperty("filePath", out var sfEl) ? sfEl.GetString() ?? "" : "";

                        if (stateStr == "paused")
                        {
                            s_liveAudio?.PauseDirectPlay();
                        }
                        else if (stateStr == "playing")
                        {
                            if (s_liveAudio != null && s_liveAudio.IsDirectPlaying)
                            {
                                s_liveAudio.ResumeDirectPlay();
                                if (posSec > 0 && Math.Abs(s_liveAudio.CurrentPositionSeconds - posSec) > 2.0)
                                {
                                    s_liveAudio.SeekDirectPlay(posSec);
                                }
                            }
                            else if (s_liveAudio != null && !string.IsNullOrEmpty(syncFile))
                            {
                                s_liveAudio.StartDirectPlay(syncFile, posSec, out _);
                            }
                        }
                        else if (stateStr == "stopped")
                        {
                            s_liveAudio?.StopDirectPlay();
                        }
                        responseJson = JsonSerializer.Serialize(new { ok = true, directPlaying = s_liveAudio?.IsDirectPlaying ?? false });
                    }
                    else
                    {
                        responseJson = JsonSerializer.Serialize(new { ok = true });
                    }
                    break;

                case "/api/audio/pause":
                    s_liveAudio?.PauseDirectPlay();
                    responseJson = JsonSerializer.Serialize(new { ok = true, directPlaying = s_liveAudio?.IsDirectPlaying ?? false });
                    break;

                case "/api/audio/resume":
                    s_liveAudio?.ResumeDirectPlay();
                    responseJson = JsonSerializer.Serialize(new { ok = true, directPlaying = s_liveAudio?.IsDirectPlaying ?? false });
                    break;

                case "/api/audio/seek":
                    if (doc != null && doc.RootElement.TryGetProperty("position", out var seekPosEl))
                    {
                        s_liveAudio?.SeekDirectPlay(seekPosEl.GetDouble());
                    }
                    responseJson = JsonSerializer.Serialize(new { ok = true });
                    break;

                case "/api/audio/render":
                    if (doc != null && doc.RootElement.TryGetProperty("filePath", out var rFp))
                    {
                        string inPath = rFp.GetString() ?? "";
                        string outPath = doc.RootElement.TryGetProperty("outPath", out var rOp)
                            ? rOp.GetString() ?? ""
                            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyMusic), "ECHO_VST3_Rendered", Path.GetFileNameWithoutExtension(inPath) + "_vst3.wav");

                        string err = "";
                        bool ok = false;
                        if (s_liveAudio != null)
                        {
                            ok = s_liveAudio.RenderToFile(inPath, outPath, out err);
                        }
                        else
                        {
                            err = "LiveAudio 引擎未就绪";
                        }
                        responseJson = JsonSerializer.Serialize(new { ok, error = err, outputPath = outPath });
                    }
                    else
                    {
                        responseJson = JsonSerializer.Serialize(new { ok = false, error = "缺少 filePath 参数" });
                    }
                    break;



                default:
                    statusCode = 404;
                    responseJson = JsonSerializer.Serialize(new { ok = false, error = "Route not found" });
                    break;
            }
        }
        catch (Exception ex)
        {
            statusCode = 500;
            responseJson = JsonSerializer.Serialize(new { ok = false, error = ex.Message });
        }

        res.StatusCode = statusCode;
        res.ContentType = "application/json; charset=utf-8";
        byte[] buffer = Encoding.UTF8.GetBytes(responseJson);
        res.ContentLength64 = buffer.Length;
        await res.OutputStream.WriteAsync(buffer, 0, buffer.Length);
        res.Close();
    }

    private static void ReadStdinLoop()
    {
        while (s_running)
        {
            string? line = Console.ReadLine();
            if (line == null) break;
            if (string.IsNullOrWhiteSpace(line)) continue;

            try
            {
                using var doc = JsonDocument.Parse(line);
                var root = doc.RootElement;
                string method = root.TryGetProperty("method", out var m) ? m.GetString() ?? "" : "";
                string id = root.TryGetProperty("id", out var i) ? i.GetString() ?? "" : "";

                object result = method switch
                {
                    "status" => new { ok = true, version = "1.0.0", port = s_httpPort },
                    "vst3_scan" => new { ok = true, plugins = s_scannedPlugins },
                    "get_state" => new { ok = true, state = s_rack.GetState() },
                    _ => new { ok = false, error = $"Unknown method: {method}" }
                };

                string outLine = JsonSerializer.Serialize(new { id, result });
                Console.WriteLine(outLine);
            }
            catch (Exception ex)
            {
                Console.WriteLine(JsonSerializer.Serialize(new { error = ex.Message }));
            }
        }
    }
}
