using System;
using SonicWave.Audio.Vst3;

namespace EchoVst3Host.Audio;

public class RackSlot : IDisposable
{
    public int Index { get; }
    public string? PluginPath { get; private set; }
    public string? PluginName { get; private set; }
    public bool Bypassed { get; set; } = false;
    public Vst3NativeInstance? Instance { get; private set; }
    public Vst3EditorWindow? Editor { get; private set; }

    public bool HasPlugin => Instance != null;

    public RackSlot(int index)
    {
        Index = index;
    }

    public bool LoadPlugin(string path, double sampleRate, int channels, out string error)
    {
        error = "";
        Unload();

        try
        {
            var inst = new Vst3NativeInstance(path);
            string? initErr = inst.Initialize(sampleRate, channels);
            if (!string.IsNullOrEmpty(initErr))
            {
                inst.Dispose();
                error = initErr;
                return false;
            }

            Instance = inst;
            PluginPath = path;
            PluginName = inst.DisplayName;
            Bypassed = false;
            return true;
        }
        catch (Exception ex)
        {
            error = ex.Message;
            return false;
        }
    }

    public void Unload()
    {
        CloseEditor();
        if (Instance != null)
        {
            try { Instance.Dispose(); } catch {}
            Instance = null;
        }
        PluginPath = null;
        PluginName = null;
        Bypassed = false;
    }

    public bool OpenEditor(out string error)
    {
        error = "";
        if (Instance == null || string.IsNullOrEmpty(PluginPath))
        {
            error = "插槽未加载插件";
            return false;
        }

        if (Editor != null && Editor.IsOpen)
        {
            Editor.BringToFront();
            return true;
        }

        Editor = new Vst3EditorWindow(Instance, PluginPath);
        Editor.Closed += () => { Editor = null; };
        return Editor.ShowEditor(out error);
    }

    public void CloseEditor()
    {
        if (Editor != null)
        {
            try { Editor.Close(); } catch {}
            Editor = null;
        }
    }

    public bool SyncComponentStateToController()
    {
        return Instance?.SyncComponentStateToController() ?? false;
    }


    public void Dispose()
    {
        Unload();
    }
}
