using System;
using System.Collections.Generic;
using System.Linq;
using SonicWave.Audio.Vst3;

namespace EchoVst3Host.Audio;

public class RackProcessor : IDisposable
{
    public const int MaxSlots = 10;
    private readonly RackSlot[] _slots = new RackSlot[MaxSlots];
    private readonly object _gate = new object();

    public double SampleRate { get; set; } = 48000.0;
    public int Channels { get; set; } = 2;

    public string CurrentFile { get; set; } = "";
    public string CurrentPreset { get; set; } = "(默认)";

    public double InputGainDb { get; set; } = 0.0;
    public double OutputGainDb { get; set; } = 0.0;
    public double DryWet { get; set; } = 1.0; // 0.0 = Dry, 1.0 = Wet

    public double InputPeakDb { get; private set; } = -66.0;
    public double InputRmsDb { get; private set; } = -66.0;
    public double OutputPeakDb { get; private set; } = -66.0;
    public double OutputRmsDb { get; private set; } = -66.0;

    private float[] _dryScratch = Array.Empty<float>();

    public RackProcessor()
    {
        for (int i = 0; i < MaxSlots; i++)
        {
            _slots[i] = new RackSlot(i);
        }
    }

    public RackSlot GetSlot(int index)
    {
        if (index < 0 || index >= MaxSlots) throw new ArgumentOutOfRangeException(nameof(index));
        return _slots[index];
    }

    public bool LoadSlot(int index, string path, out string error)
    {
        lock (_gate)
        {
            var slot = GetSlot(index);
            return slot.LoadPlugin(path, SampleRate, Channels, out error);
        }
    }

    public void UnloadSlot(int index)
    {
        lock (_gate)
        {
            GetSlot(index).Unload();
        }
    }

    public void ToggleSlotBypass(int index)
    {
        lock (_gate)
        {
            var slot = GetSlot(index);
            slot.Bypassed = !slot.Bypassed;
        }
    }

    public void SetSlotBypass(int index, bool bypassed)
    {
        lock (_gate)
        {
            GetSlot(index).Bypassed = bypassed;
        }
    }

    public bool OpenSlotEditor(int index, out string error)
    {
        var slot = GetSlot(index);
        return slot.OpenEditor(out error);
    }

    public void CloseSlotEditor(int index)
    {
        GetSlot(index).CloseEditor();
    }

    public void TriggerTransportRestart(int pauseBlocks = 100)
    {
        lock (_gate)
        {
            foreach (var slot in _slots)
            {
                if (slot.HasPlugin && slot.Instance != null)
                {
                    slot.Instance.TriggerTransportRestart(pauseBlocks);
                }
            }
        }
    }

    public void SetTransportPlaying(bool playing)
    {
        lock (_gate)
        {
            foreach (var slot in _slots)
            {
                if (slot.HasPlugin && slot.Instance != null)
                {
                    slot.Instance.SetTransportPlaying(playing);
                }
            }
        }
    }


    public void UpdateFormat(double sampleRate, int channels)
    {
        lock (_gate)
        {
            SampleRate = sampleRate > 0 ? sampleRate : 48000.0;
            Channels = channels > 0 ? channels : 2;
            foreach (var slot in _slots)
            {
                if (slot.Instance != null && slot.PluginPath != null)
                {
                    slot.Instance.UpdateSampleRate(SampleRate);
                }
            }
        }
    }

    public void Process(float[] interleaved, int channels)
    {
        int totalSamples = interleaved.Length;
        if (totalSamples == 0) return;

        lock (_gate)
        {
            // 1. Calculate Input Meters
            float inMax = 0f;
            double inSumSq = 0.0;
            for (int i = 0; i < totalSamples; i++)
            {
                float a = Math.Abs(interleaved[i]);
                if (a > inMax) inMax = a;
                inSumSq += a * a;
            }
            InputPeakDb = inMax > 0.00001f ? Math.Max(-66.0, 20.0 * Math.Log10(inMax)) : -66.0;
            InputRmsDb = inSumSq > 0.00001 ? Math.Max(-66.0, 20.0 * Math.Log10(Math.Sqrt(inSumSq / totalSamples))) : -66.0;

            // 2. Apply Input Gain
            float inGain = (float)Math.Pow(10.0, InputGainDb / 20.0);
            if (Math.Abs(inGain - 1.0f) > 0.001f)
            {
                for (int i = 0; i < totalSamples; i++) interleaved[i] *= inGain;
            }

            // 3. Dry copy for Dry/Wet mix
            if (_dryScratch.Length != totalSamples)
            {
                _dryScratch = new float[totalSamples];
            }
            Array.Copy(interleaved, _dryScratch, totalSamples);

            // 4. Run through active VST3 slots
            bool processedAny = false;
            for (int i = 0; i < MaxSlots; i++)
            {
                var slot = _slots[i];
                if (slot.HasPlugin && !slot.Bypassed && slot.Instance != null)
                {
                    slot.Instance.TryProcess(interleaved, channels);
                    processedAny = true;
                }
            }

            // 5. Dry/Wet blend
            if (processedAny && DryWet < 0.999)
            {
                float wetRatio = (float)Math.Clamp(DryWet, 0.0, 1.0);
                float dryRatio = 1.0f - wetRatio;
                for (int i = 0; i < totalSamples; i++)
                {
                    interleaved[i] = interleaved[i] * wetRatio + _dryScratch[i] * dryRatio;
                }
            }

            // 6. Apply Output Gain
            float outGain = (float)Math.Pow(10.0, OutputGainDb / 20.0);
            if (Math.Abs(outGain - 1.0f) > 0.001f)
            {
                for (int i = 0; i < totalSamples; i++) interleaved[i] *= outGain;
            }

            // 7. Calculate Output Meters
            float outMax = 0f;
            double outSumSq = 0.0;
            for (int i = 0; i < totalSamples; i++)
            {
                float a = Math.Abs(interleaved[i]);
                if (a > outMax) outMax = a;
                outSumSq += a * a;
            }
            OutputPeakDb = outMax > 0.00001f ? Math.Max(-66.0, 20.0 * Math.Log10(outMax)) : -66.0;
            OutputRmsDb = outSumSq > 0.00001 ? Math.Max(-66.0, 20.0 * Math.Log10(Math.Sqrt(outSumSq / totalSamples))) : -66.0;
        }
    }

    public object GetState()
    {
        lock (_gate)
        {
            var slotsInfo = _slots.Select(s => new
            {
                index = s.Index,
                hasPlugin = s.HasPlugin,
                name = s.PluginName ?? "",
                path = s.PluginPath ?? "",
                bypassed = s.Bypassed,
                editorOpen = s.Editor?.IsOpen ?? false,
                editorHwnd = (long)(s.Editor?.Handle ?? IntPtr.Zero)
            }).ToList();

            return new
            {
                currentFile = CurrentFile,
                currentPreset = CurrentPreset,
                inputGainDb = InputGainDb,
                outputGainDb = OutputGainDb,
                dryWet = DryWet,
                inputPeakDb = InputPeakDb,
                inputRmsDb = InputRmsDb,
                outputPeakDb = OutputPeakDb,
                outputRmsDb = OutputRmsDb,
                sampleRate = SampleRate,
                channels = Channels,
                slots = slotsInfo
            };
        }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            for (int i = 0; i < MaxSlots; i++)
            {
                _slots[i].Dispose();
            }
        }
    }
}
