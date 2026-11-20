using System;
using System.Runtime.InteropServices;
using System.Text;
using UnityEngine;

namespace RingsideBooker.Release
{
    /// <summary>
    /// Sets the Windows window title to <see cref="ReleaseInfo.WindowTitle"/> ("Ringside Booker — Alpha 0.1.0 (1)")
    /// at start. Unity names the window after the product name only, so this finds the player's own
    /// window (class UnityWndClass, this process) and renames it. Windows players only.
    /// </summary>
    public static class WindowTitle
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void Apply()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            if (Application.isBatchMode) return;
            try
            {
                title = ReleaseInfo.WindowTitle;
                processId = (uint)System.Diagnostics.Process.GetCurrentProcess().Id;
                renamed = 0;
                EnumWindows(Visit, IntPtr.Zero);
                Debug.Log($"[WindowTitle] {title} ({renamed} window(s))");
            }
            catch (Exception error)
            {
                Debug.LogWarning($"[WindowTitle] {error.Message}");
            }
#endif
        }

#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
        private static string title;
        private static uint processId;
        private static int renamed;

        // Static with MonoPInvokeCallback so it also works under IL2CPP.
        [AOT.MonoPInvokeCallback(typeof(EnumWindowsProc))]
        private static bool Visit(IntPtr window, IntPtr parameter)
        {
            GetWindowThreadProcessId(window, out uint owner);
            if (owner != processId) return true;
            var className = new StringBuilder(64);
            GetClassName(window, className, className.Capacity);
            if (className.ToString() != "UnityWndClass") return true;
            SetWindowText(window, title);
            renamed++;
            return true;
        }

        private delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetClassName(IntPtr window, StringBuilder name, int capacity);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern bool SetWindowText(IntPtr window, string text);
#endif
    }
}
