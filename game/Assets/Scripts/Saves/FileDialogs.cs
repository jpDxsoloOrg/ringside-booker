using System;
using System.Runtime.InteropServices;
using UnityEngine;

namespace RingsideBooker.Saves
{
    /// <summary>
    /// The Windows Open / Save As dialogs (comdlg32) for importing and exporting save files. Modal:
    /// the call returns when the player picks a file or cancels. Elsewhere <see cref="IsAvailable"/>
    /// is false and the callers fall back to a folder under the save directory.
    /// </summary>
    public static class FileDialogs
    {
        public const string SaveFilter = "Ringside Booker save (*.rbsave)\0*.rbsave\0All files (*.*)\0*.*\0\0";

        private const int MaxPath = 4096;
        private const int OfnOverwritePrompt = 0x00000002;
        private const int OfnNoChangeDir = 0x00000008;
        private const int OfnPathMustExist = 0x00000800;
        private const int OfnFileMustExist = 0x00001000;
        private const int OfnExplorer = 0x00080000;

#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
        public static bool IsAvailable => true;
#else
        public static bool IsAvailable => false;
#endif

        /// <summary>Asks where to save a file; null when cancelled or unavailable.</summary>
        public static string SaveFile(string title, string defaultFileName, string initialDirectory = null)
        {
            return Show(title, defaultFileName, initialDirectory, save: true);
        }

        /// <summary>Asks for a file to open; null when cancelled or unavailable.</summary>
        public static string OpenFile(string title, string initialDirectory = null)
        {
            return Show(title, null, initialDirectory, save: false);
        }

        private static string Show(string title, string defaultFileName, string initialDirectory, bool save)
        {
#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
            IntPtr buffer = Marshal.AllocHGlobal(MaxPath * 2);
            try
            {
                var initial = new char[MaxPath];
                if (!string.IsNullOrEmpty(defaultFileName))
                {
                    defaultFileName.CopyTo(0, initial, 0, Math.Min(defaultFileName.Length, MaxPath - 1));
                }

                Marshal.Copy(initial, 0, buffer, MaxPath);
                var dialog = new OpenFileName
                {
                    lStructSize = Marshal.SizeOf(typeof(OpenFileName)),
                    hwndOwner = GetActiveWindow(),
                    lpstrFilter = SaveFilter,
                    nFilterIndex = 1,
                    lpstrFile = buffer,
                    nMaxFile = MaxPath,
                    lpstrInitialDir = initialDirectory,
                    lpstrTitle = title,
                    lpstrDefExt = "rbsave",
                    Flags = OfnExplorer | OfnNoChangeDir | OfnPathMustExist | (save ? OfnOverwritePrompt : OfnFileMustExist),
                };

                bool picked = save ? GetSaveFileNameW(ref dialog) : GetOpenFileNameW(ref dialog);
                return picked ? Marshal.PtrToStringUni(buffer) : null;
            }
            catch (Exception error) when (error is DllNotFoundException || error is EntryPointNotFoundException)
            {
                Debug.LogWarning("FileDialogs: the Windows file dialog is not available: " + error.Message);
                return null;
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
#else
            return null;
#endif
        }

#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct OpenFileName
        {
            public int lStructSize;
            public IntPtr hwndOwner;
            public IntPtr hInstance;
            public string lpstrFilter;
            public IntPtr lpstrCustomFilter;
            public int nMaxCustFilter;
            public int nFilterIndex;
            public IntPtr lpstrFile;
            public int nMaxFile;
            public IntPtr lpstrFileTitle;
            public int nMaxFileTitle;
            public string lpstrInitialDir;
            public string lpstrTitle;
            public int Flags;
            public short nFileOffset;
            public short nFileExtension;
            public string lpstrDefExt;
            public IntPtr lCustData;
            public IntPtr lpfnHook;
            public IntPtr lpTemplateName;
            public IntPtr pvReserved;
            public int dwReserved;
            public int FlagsEx;
        }

        [DllImport("comdlg32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool GetOpenFileNameW(ref OpenFileName dialog);

        [DllImport("comdlg32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool GetSaveFileNameW(ref OpenFileName dialog);

        [DllImport("user32.dll")]
        private static extern IntPtr GetActiveWindow();
#endif
    }
}
