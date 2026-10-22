using System;
using System.Runtime.InteropServices;
using System.Threading;

namespace SonicWave.Audio.Vst3;

public sealed class Vst3EditorWindow : IDisposable
{
    private delegate nint WndProc(nint hWnd, uint msg, nint wParam, nint lParam);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WndClassEx
    {
        public uint cbSize;
        public uint style;
        public nint lpfnWndProc;
        public int cbClsExtra;
        public int cbWndExtra;
        public nint hInstance;
        public nint hIcon;
        public nint hCursor;
        public nint hbrBackground;
        public string lpszMenuName;
        public string lpszClassName;
        public nint hIconSm;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
        public nint hwnd;
        public uint message;
        public nint wParam;
        public nint lParam;
        public uint time;
        public int ptX;
        public int ptY;
        public uint lPrivate;
    }

    private const uint WM_CLOSE = 0x0010;
    private const uint WM_DESTROY = 0x0002;
    private const uint WS_OVERLAPPEDWINDOW = 0x00CF0000;
    private const uint WS_CLIPCHILDREN = 0x02000000;
    private const uint WS_CLIPSIBLINGS = 0x04000000;
    private const int SW_SHOW = 5;
    private const int SW_RESTORE = 9;
    private const uint SWP_NOZORDER = 0x0004;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern ushort RegisterClassExW(ref WndClassEx wc);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern nint CreateWindowExW(uint exStyle, string cls, string name, uint style, int x, int y, int w, int h, nint parent, nint menu, nint inst, nint param);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(nint hWnd, int cmd);

    [DllImport("user32.dll")]
    private static extern bool UpdateWindow(nint hWnd);

    [DllImport("user32.dll")]
    private static extern bool DestroyWindow(nint hWnd);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(nint hWnd, out RECT rect);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(nint hWnd, nint after, int x, int y, int w, int h, uint flags);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(nint hWnd);

    [DllImport("user32.dll")]
    private static extern nint DefWindowProcW(nint hWnd, uint msg, nint wParam, nint lParam);

    [DllImport("user32.dll")]
    private static extern int GetMessageW(out MSG msg, nint hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref MSG msg);

    [DllImport("user32.dll")]
    private static extern nint DispatchMessageW(ref MSG msg);

    [DllImport("user32.dll")]
    private static extern void PostQuitMessage(int nExitCode);

    [DllImport("user32.dll")]
    private static extern bool PostMessageW(nint hWnd, uint msg, nint wParam, nint lParam);

    [DllImport("user32.dll")]
    private static extern bool AdjustWindowRectEx(ref RECT lpRect, uint dwStyle, bool bMenu, uint dwExStyle);

    [DllImport("user32.dll")]
    private static extern bool GetClientRect(nint hWnd, out RECT rect);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern nint GetModuleHandleW(string? name);

    private static readonly WndProc s_wndProc = WndProcImpl;
    private static bool s_classRegistered;
    private static readonly object s_lock = new object();

    private readonly Vst3NativeInstance _instance;
    private readonly string _pluginPath;
    private nint _hwnd;
    private bool _closed;
    private Thread? _uiThread;
    private readonly ManualResetEventSlim _readyEvent = new ManualResetEventSlim(false);
    private readonly ManualResetEventSlim _closedEvent = new ManualResetEventSlim(false);

    public string PluginPath => _pluginPath;
    public nint Handle => _hwnd;
    public bool IsOpen => !_closed && _hwnd != IntPtr.Zero;

    public event Action? Closed;

    public Vst3EditorWindow(Vst3NativeInstance instance, string pluginPath)
    {
        _instance = instance;
        _pluginPath = pluginPath;
    }

    public bool ShowEditor(out string error)
    {
        error = "";

        if (IsOpen)
        {
            BringToFront();
            return true;
        }

        string initError = "";
        _readyEvent.Reset();

        _uiThread = new Thread(() =>
        {
            try
            {
                EnsureClassRegistered();
                string title = $"VST3: {_instance.DisplayName} - VST3 效果组与机架";
                _hwnd = CreateWindowExW(0, "EchoVst3EditorWnd", title, WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN | WS_CLIPSIBLINGS, 100, 100, 640, 480, IntPtr.Zero, IntPtr.Zero, GetModuleHandleW(null), IntPtr.Zero);

                if (_hwnd == IntPtr.Zero)
                {
                    initError = "CreateWindowEx 失败";
                    _readyEvent.Set();
                    return;
                }

                ShowWindow(_hwnd, SW_SHOW);
                UpdateWindow(_hwnd);

                string? err = _instance.OpenEditor(_hwnd, out int width, out int height);
                if (!string.IsNullOrEmpty(err))
                {
                    initError = err;
                    DestroyWindow(_hwnd);
                    _hwnd = IntPtr.Zero;
                    _readyEvent.Set();
                    return;
                }

                int targetW = Math.Max(640, width);
                int targetH = Math.Max(480, height);
                RECT wr, cr;
                GetWindowRect(_hwnd, out wr);
                GetClientRect(_hwnd, out cr);
                int nonClientW = (wr.Right - wr.Left) - (cr.Right - cr.Left);
                int nonClientH = (wr.Bottom - wr.Top) - (cr.Bottom - cr.Top);
                if (nonClientW <= 0 || nonClientW > 100) nonClientW = 16;
                if (nonClientH <= 0 || nonClientH > 100) nonClientH = 39;
                int winW = targetW + nonClientW;
                int winH = targetH + nonClientH;

                SetWindowPos(_hwnd, IntPtr.Zero, 100, 100, winW, winH, SWP_NOZORDER);
                ShowWindow(_hwnd, SW_SHOW);
                UpdateWindow(_hwnd);
                SetForegroundWindow(_hwnd);

                _instance.EditorResizeRequested += OnEditorResizeRequested;
                _readyEvent.Set();

                while (true)
                {
                    int gm = GetMessageW(out MSG msg, IntPtr.Zero, 0, 0);
                    if (gm <= 0) break;
                    TranslateMessage(ref msg);
                    DispatchMessageW(ref msg);
                }
            }
            catch (Exception ex)
            {
                initError = ex.Message;
                _readyEvent.Set();
            }
            finally
            {
                CloseInternal();
            }
        });

        _uiThread.SetApartmentState(ApartmentState.STA);
        _uiThread.IsBackground = true;
        _uiThread.Start();

        _readyEvent.Wait(15000);
        error = initError;
        return string.IsNullOrEmpty(error) && _hwnd != IntPtr.Zero;
    }

    public void BringToFront()
    {
        if (_hwnd != IntPtr.Zero)
        {
            ShowWindow(_hwnd, SW_RESTORE);
            SetForegroundWindow(_hwnd);
        }
    }

    public void Close()
    {
        if (_closed) return;
        nint h = _hwnd;
        if (h != IntPtr.Zero)
        {
            PostMessageW(h, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
            _closedEvent.Wait(1000);
        }
        else
        {
            CloseInternal();
        }
    }

    public void Dispose()
    {
        Close();
    }

    private void OnEditorResizeRequested(int width, int height)
    {
        if (_hwnd != IntPtr.Zero && !_closed)
        {
            RECT wr, cr;
            GetWindowRect(_hwnd, out wr);
            GetClientRect(_hwnd, out cr);
            int nonClientW = (wr.Right - wr.Left) - (cr.Right - cr.Left);
            int nonClientH = (wr.Bottom - wr.Top) - (cr.Bottom - cr.Top);
            if (nonClientW <= 0 || nonClientW > 100) nonClientW = 16;
            if (nonClientH <= 0 || nonClientH > 100) nonClientH = 39;
            int winW = width + nonClientW;
            int winH = height + nonClientH;
            SetWindowPos(_hwnd, IntPtr.Zero, 0, 0, winW, winH, 0x0002 /* SWP_NOMOVE */ | SWP_NOZORDER);
            _instance.EditorResized(width, height);
        }
    }

    private void CloseInternal()
    {
        if (_closed) return;
        _closed = true;
        _instance.EditorResizeRequested -= OnEditorResizeRequested;

        if (_hwnd != IntPtr.Zero)
        {
            nint h = _hwnd;
            _hwnd = IntPtr.Zero;
            try { ShowWindow(h, 0); } catch {}
            try { _instance.CloseEditor(); } catch {}
            try { DestroyWindow(h); } catch {}
        }
        else
        {
            try { _instance.CloseEditor(); } catch {}
        }

        try
        {
            _closedEvent.Set();
            Closed?.Invoke();
        }
        catch {}
    }

    private static nint WndProcImpl(nint hWnd, uint msg, nint wParam, nint lParam)
    {
        if (msg == WM_CLOSE)
        {
            PostQuitMessage(0);
            return IntPtr.Zero;
        }
        if (msg == WM_DESTROY)
        {
            PostQuitMessage(0);
            return IntPtr.Zero;
        }
        return DefWindowProcW(hWnd, msg, wParam, lParam);
    }

    private static void EnsureClassRegistered()
    {
        if (!s_classRegistered)
        {
            var wc = new WndClassEx
            {
                cbSize = (uint)Marshal.SizeOf<WndClassEx>(),
                style = 0,
                lpfnWndProc = Marshal.GetFunctionPointerForDelegate(s_wndProc),
                hInstance = GetModuleHandleW(null),
                hbrBackground = IntPtr.Zero,
                lpszClassName = "EchoVst3EditorWnd"
            };
            RegisterClassExW(ref wc);
            s_classRegistered = true;
        }
    }
}
