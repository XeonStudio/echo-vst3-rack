using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace EchoVst3Host.Audio;

public class LiveAudioEngine : IDisposable
{
    private readonly RackProcessor _rack;
    private WasapiLoopbackCapture? _loopbackCapture;
    private bool _loopbackRunning;
    private readonly object _gate = new object();

    // Direct playback components
    private IWavePlayer? _player;
    private WaveStream? _currentAudioStream;
    private RackSampleProvider? _rackSampleProvider;
    private bool _isDirectPlaying;

    public bool IsLoopbackActive => _loopbackRunning;
    public bool IsDirectPlaying => _isDirectPlaying;

    private string? _currentPlayingFile;
    public string? CurrentPlayingFile => _currentPlayingFile;

    public double CurrentPositionSeconds
    {
        get
        {
            lock (_gate)
            {
                return _currentAudioStream?.CurrentTime.TotalSeconds ?? 0.0;
            }
        }
    }

    public LiveAudioEngine(RackProcessor rack)
    {
        _rack = rack;
    }

    private System.Threading.Timer? _reconnectTimer;
    private string? _activeDeviceId;

    public void StartLoopback(string? targetDeviceId = null)
    {
        lock (_gate)
        {
            if (_loopbackRunning) return;
            try
            {
                NAudio.CoreAudioApi.MMDevice? targetDevice = null;
                var enumerator = new NAudio.CoreAudioApi.MMDeviceEnumerator();
                if (!string.IsNullOrEmpty(targetDeviceId))
                {
                    try { targetDevice = enumerator.GetDevice(targetDeviceId); } catch {}
                }

                if (targetDevice == null)
                {
                    targetDevice = enumerator.GetDefaultAudioEndpoint(NAudio.CoreAudioApi.DataFlow.Render, NAudio.CoreAudioApi.Role.Multimedia);
                }

                _activeDeviceId = targetDevice.ID;
                _loopbackCapture = new WasapiLoopbackCapture(targetDevice);
                var fmt = _loopbackCapture.WaveFormat;
                
                // Keep rack sample rate in sync with capture format.
                if (!_isDirectPlaying)
                {
                    _rack.UpdateFormat(fmt.SampleRate, 2);
                }

                _loopbackCapture.DataAvailable += OnLoopbackDataAvailable;
                _loopbackCapture.RecordingStopped += (s, e) =>
                {
                    lock (_gate)
                    {
                        _loopbackRunning = false;
                        if (_loopbackCapture != null)
                        {
                            try { _loopbackCapture.Dispose(); } catch {}
                            _loopbackCapture = null;
                        }
                    }
                    Console.WriteLine("[LiveAudioEngine] Loopback stopped, scheduling auto-reconnect...");
                    ScheduleLoopbackReconnect();
                };

                _loopbackCapture.StartRecording();
                _loopbackRunning = true;
                Console.WriteLine($"[LiveAudioEngine] Loopback capture started on '{targetDevice.FriendlyName}': {fmt.SampleRate}Hz, {fmt.Channels}ch, {fmt.BitsPerSample}bit, {fmt.Encoding}");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[LiveAudioEngine] Failed to start loopback capture: {ex.Message}");
                _loopbackRunning = false;
                ScheduleLoopbackReconnect();
            }
        }
    }

    private void ScheduleLoopbackReconnect()
    {
        lock (_gate)
        {
            _reconnectTimer?.Dispose();
            _reconnectTimer = new System.Threading.Timer(_ =>
            {
                try
                {
                    if (!_loopbackRunning)
                    {
                        Console.WriteLine("[LiveAudioEngine] Auto-reconnecting loopback capture...");
                        StartLoopback(_activeDeviceId);
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[LiveAudioEngine] Reconnect attempt error: {ex.Message}");
                }
            }, null, 1500, Timeout.Infinite);
        }
    }

    public void StopLoopback()
    {
        lock (_gate)
        {
            _reconnectTimer?.Dispose();
            _reconnectTimer = null;

            if (!_loopbackRunning || _loopbackCapture == null) return;
            try
            {
                _loopbackCapture.StopRecording();
            }
            catch {}
            try
            {
                _loopbackCapture.Dispose();
            }
            catch {}
            _loopbackCapture = null;
            _loopbackRunning = false;
            Console.WriteLine("[LiveAudioEngine] Loopback capture stopped.");
        }
    }

    private static readonly Guid s_subTypeIeeeFloat = new Guid("00000003-0000-0010-8000-00aa00389b71");
    private static readonly Guid s_subTypePcm = new Guid("00000001-0000-0010-8000-00aa00389b71");

    private void OnLoopbackDataAvailable(object? sender, WaveInEventArgs e)
    {
        if (e.BytesRecorded <= 0 || _loopbackCapture == null || _isDirectPlaying) return;

        try
        {
            var fmt = _loopbackCapture.WaveFormat;
            int channels = fmt.Channels;
            if (channels <= 0) return;

            if (Math.Abs(_rack.SampleRate - fmt.SampleRate) > 1.0)
            {
                _rack.UpdateFormat(fmt.SampleRate, 2);
            }

            float[] rawSamples;

            // Universal decoding for all Windows WASAPI mix formats:
            // 1. 32-bit float (IeeeFloat, Extensible with float GUID, or any 32-bit shared stream)
            bool isFloat = fmt.Encoding == WaveFormatEncoding.IeeeFloat;
            if (!isFloat && fmt is WaveFormatExtensible ext)
            {
                isFloat = ext.SubFormat == s_subTypeIeeeFloat;
            }
            // In Windows 10/11 Shared Mode WASAPI, 32-bit streams are IEEE float
            if (!isFloat && fmt.BitsPerSample == 32 && fmt.Encoding == WaveFormatEncoding.Extensible)
            {
                isFloat = true;
            }

            if (isFloat && fmt.BitsPerSample == 32)
            {
                int sampleCount = e.BytesRecorded / 4;
                if (sampleCount <= 0) return;
                rawSamples = new float[sampleCount];
                Buffer.BlockCopy(e.Buffer, 0, rawSamples, 0, sampleCount * 4);
            }
            // 2. 16-bit integer PCM
            else if (fmt.BitsPerSample == 16)
            {
                int sampleCount = e.BytesRecorded / 2;
                if (sampleCount <= 0) return;
                rawSamples = new float[sampleCount];
                for (int i = 0; i < sampleCount; i++)
                {
                    short val = BitConverter.ToInt16(e.Buffer, i * 2);
                    rawSamples[i] = val / 32768.0f;
                }
            }
            // 3. 24-bit integer PCM
            else if (fmt.BitsPerSample == 24)
            {
                int sampleCount = e.BytesRecorded / 3;
                if (sampleCount <= 0) return;
                rawSamples = new float[sampleCount];
                for (int i = 0; i < sampleCount; i++)
                {
                    int offset = i * 3;
                    int val = (e.Buffer[offset + 2] << 24) | (e.Buffer[offset + 1] << 16) | (e.Buffer[offset] << 8);
                    rawSamples[i] = (val >> 8) / 8388608.0f;
                }
            }
            // 4. 32-bit integer PCM (when not float)
            else if (fmt.BitsPerSample == 32)
            {
                int sampleCount = e.BytesRecorded / 4;
                if (sampleCount <= 0) return;
                rawSamples = new float[sampleCount];
                for (int i = 0; i < sampleCount; i++)
                {
                    int val = BitConverter.ToInt32(e.Buffer, i * 4);
                    rawSamples[i] = val / 2147483648.0f;
                }
            }
            else
            {
                return;
            }

            // Downmix / Conform to Stereo (2 channels) for VST3 Rack
            float[] stereoSamples;
            if (channels == 2)
            {
                stereoSamples = rawSamples;
            }
            else if (channels == 1)
            {
                // Mono -> Stereo
                int frames = rawSamples.Length;
                stereoSamples = new float[frames * 2];
                for (int i = 0; i < frames; i++)
                {
                    float s = rawSamples[i];
                    stereoSamples[i * 2] = s;
                    stereoSamples[i * 2 + 1] = s;
                }
            }
            else
            {
                // Multi-channel (e.g. 4ch, 5.1ch, 7.1ch DACs) -> take Front-Left (ch0) and Front-Right (ch1)
                int frames = rawSamples.Length / channels;
                if (frames <= 0) return;
                stereoSamples = new float[frames * 2];
                for (int f = 0; f < frames; f++)
                {
                    stereoSamples[f * 2] = rawSamples[f * channels];
                    stereoSamples[f * 2 + 1] = rawSamples[f * channels + 1];
                }
            }

            // Continuous real-time processing through VST3 rack
            _rack.Process(stereoSamples, 2);
        }
        catch (Exception ex)
        {
            Trace.WriteLine($"[LiveAudioEngine] Loopback processing error: {ex.Message}");
        }
    }

    private static string? FindFfmpeg()
    {
        string[] candidates = new[]
        {
            @"E:\Steam\steamapps\common\ECHO\resources\tools\ffmpeg.exe",
            Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "ffmpeg.exe"),
            Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "ffmpeg.exe"),
            Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "resources", "tools", "ffmpeg.exe"),
            @"C:\Program Files (x86)\Steam\steamapps\common\ECHO\resources\tools\ffmpeg.exe",
            @"C:\Program Files\Steam\steamapps\common\ECHO\resources\tools\ffmpeg.exe",
            @"D:\Steam\steamapps\common\ECHO\resources\tools\ffmpeg.exe",
            "ffmpeg.exe"
        };
        foreach (var c in candidates)
        {
            try
            {
                if (File.Exists(c)) return c;
            }
            catch {}
        }
        return null;
    }

    private static WaveStream OpenAudioStream(string filePath, out string? tempWavToClean)
    {
        tempWavToClean = null;
        try
        {
            return new AudioFileReader(filePath);
        }
        catch
        {
            try
            {
                return new MediaFoundationReader(filePath, new MediaFoundationReader.MediaFoundationReaderSettings { RequestFloatOutput = true });
            }
            catch
            {
                string? ffmpeg = FindFfmpeg();
                if (ffmpeg != null)
                {
                    string tempWav = Path.Combine(Path.GetTempPath(), $"echo_vst3_tmp_{Guid.NewGuid():N}.wav");
                    var psi = new ProcessStartInfo
                    {
                        FileName = ffmpeg,
                        Arguments = $"-y -i \"{filePath}\" -vn -c:a pcm_s16le \"{tempWav}\"",
                        CreateNoWindow = true,
                        UseShellExecute = false
                    };
                    using var proc = Process.Start(psi);
                    proc?.WaitForExit(15000);
                    if (File.Exists(tempWav) && new FileInfo(tempWav).Length > 0)
                    {
                        tempWavToClean = tempWav;
                        return new AudioFileReader(tempWav);
                    }
                }
                throw;
            }
        }
    }

    public bool StartDirectPlay(string filePath, double startSeconds, out string error)
    {
        lock (_gate)
        {
            if (_isDirectPlaying && string.Equals(_currentPlayingFile, filePath, StringComparison.OrdinalIgnoreCase))
            {
                error = "";
                if (startSeconds > 0 && Math.Abs((_currentAudioStream?.CurrentTime.TotalSeconds ?? 0.0) - startSeconds) > 2.0)
                {
                    SeekDirectPlay(startSeconds);
                }
                ResumeDirectPlay();
                return true;
            }

            StopDirectPlay();
            error = "";

            try
            {
                bool isUrl = Uri.TryCreate(filePath, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
                if (!isUrl && !File.Exists(filePath))
                {
                    error = $"文件不存在: {filePath}";
                    return false;
                }

                _currentAudioStream = OpenAudioStream(filePath, out _);
                Console.WriteLine($"[LiveAudioEngine] Stream type: {_currentAudioStream.GetType().Name}, Format: {_currentAudioStream.WaveFormat}, TotalTime: {_currentAudioStream.TotalTime}");
                if (startSeconds > 0 && startSeconds < _currentAudioStream.TotalTime.TotalSeconds)
                {
                    _currentAudioStream.CurrentTime = TimeSpan.FromSeconds(startSeconds);
                }

                var sampleProvider = _currentAudioStream.ToSampleProvider();
                Console.WriteLine($"[LiveAudioEngine] SampleProvider format: {sampleProvider.WaveFormat}");
                _rack.UpdateFormat(sampleProvider.WaveFormat.SampleRate, sampleProvider.WaveFormat.Channels);
                _rackSampleProvider = new RackSampleProvider(sampleProvider, _rack);

                try
                {
                    var wasapi = new WasapiOut(NAudio.CoreAudioApi.AudioClientShareMode.Shared, 50);
                    wasapi.Init(_rackSampleProvider);
                    _player = wasapi;
                }
                catch (Exception wasapiEx)
                {
                    Console.WriteLine($"[LiveAudioEngine] WasapiOut init note ({wasapiEx.Message}), falling back to WaveOutEvent...");
                    var waveOut = new WaveOutEvent { DesiredLatency = 100 };
                    var waveProvider16 = new SampleToWaveProvider16(_rackSampleProvider);
                    waveOut.Init(waveProvider16);
                    _player = waveOut;
                }
                _player.PlaybackStopped += (s, e) =>
                {
                    Console.WriteLine($"[LiveAudioEngine] PlaybackStopped event: Exception={e.Exception?.ToString() ?? "None"}");
                };
                _player.Play();

                _currentPlayingFile = filePath;
                _isDirectPlaying = true;
                Console.WriteLine($"[LiveAudioEngine] Direct playback started for: {filePath}, PlayerState: {_player.PlaybackState}");
                return true;
            }
            catch (Exception ex)
            {
                error = ex.Message;
                StopDirectPlay();
                return false;
            }
        }
    }

    public void StopDirectPlay()
    {
        lock (_gate)
        {
            if (_player != null)
            {
                try { _player.Stop(); } catch {}
                try { _player.Dispose(); } catch {}
                _player = null;
            }

            if (_currentAudioStream != null)
            {
                try { _currentAudioStream.Dispose(); } catch {}
                _currentAudioStream = null;
            }

            _rackSampleProvider = null;
            _isDirectPlaying = false;
            _currentPlayingFile = null;
        }
    }

    public void PauseDirectPlay()
    {
        lock (_gate)
        {
            if (_player != null && _isDirectPlaying)
            {
                try { _player.Pause(); } catch {}
            }
        }
    }

    public void ResumeDirectPlay()
    {
        lock (_gate)
        {
            if (_player != null && _isDirectPlaying)
            {
                try { _player.Play(); } catch {}
            }
        }
    }

    public void SeekDirectPlay(double seconds)
    {
        lock (_gate)
        {
            if (_currentAudioStream != null && seconds >= 0 && seconds <= _currentAudioStream.TotalTime.TotalSeconds)
            {
                _currentAudioStream.CurrentTime = TimeSpan.FromSeconds(seconds);
            }
        }
    }

    public bool RenderToFile(string inputPath, string outputPath, out string error)
    {
        error = "";
        string? tempClean = null;
        try
        {
            if (!File.Exists(inputPath))
            {
                error = $"输入文件不存在: {inputPath}";
                return false;
            }

            string outDir = Path.GetDirectoryName(outputPath) ?? "";
            if (!string.IsNullOrEmpty(outDir) && !Directory.Exists(outDir))
            {
                Directory.CreateDirectory(outDir);
            }

            using (var reader = OpenAudioStream(inputPath, out tempClean))
            {
                var sampleProvider = reader.ToSampleProvider();
                int sampleRate = sampleProvider.WaveFormat.SampleRate;
                int channels = sampleProvider.WaveFormat.Channels;
                _rack.UpdateFormat(sampleRate, channels);

                var rackProvider = new RackSampleProvider(sampleProvider, _rack);

                WaveFileWriter.CreateWaveFile16(outputPath, rackProvider);
            }
            return true;
        }
        catch (Exception ex)
        {
            error = ex.Message;
            return false;
        }
        finally
        {
            if (!string.IsNullOrEmpty(tempClean) && File.Exists(tempClean))
            {
                try { File.Delete(tempClean); } catch {}
            }
        }
    }

    public void Dispose()
    {
        StopLoopback();
        StopDirectPlay();
    }
}

public class RackSampleProvider : ISampleProvider, IWaveProvider
{
    private readonly ISampleProvider _source;
    private readonly RackProcessor _rack;
    private readonly object _lock = new object();

    public WaveFormat WaveFormat => _source.WaveFormat;

    public RackSampleProvider(ISampleProvider source, RackProcessor rack)
    {
        _source = source;
        _rack = rack;
    }

    // ISampleProvider implementation (e.g. for offline rendering)
    public int Read(float[] buffer, int offset, int count)
    {
        lock (_lock)
        {
            float[] temp = new float[count];
            int read = _source.Read(temp, 0, count);
            if (read <= 0) return read;

            float[] processBuf = (read == count) ? temp : new float[read];
            if (read != count) Array.Copy(temp, 0, processBuf, 0, read);

            _rack.Process(processBuf, WaveFormat.Channels);

            Array.Copy(processBuf, 0, buffer, offset, read);
            return read;
        }
    }

    // IWaveProvider implementation (for WasapiOut, WaveOutEvent, etc.)
    public int Read(byte[] buffer, int offset, int count)
    {
        lock (_lock)
        {
            int sampleCount = count / 4;
            if (sampleCount <= 0) return 0;

            float[] temp = new float[sampleCount];
            int readSamples = _source.Read(temp, 0, sampleCount);
            if (readSamples <= 0) return 0;

            float[] processBuf = (readSamples == sampleCount) ? temp : new float[readSamples];
            if (readSamples != sampleCount) Array.Copy(temp, 0, processBuf, 0, readSamples);

            _rack.Process(processBuf, WaveFormat.Channels);

            Buffer.BlockCopy(processBuf, 0, buffer, offset, readSamples * 4);
            return readSamples * 4;
        }
    }
}
