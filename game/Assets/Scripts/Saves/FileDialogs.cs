using System;
using System.Runtime.InteropServices;
using UnityEngine;

namespace RingsideBooker.Saves
{
    /// <summary>
    /// The Windows Open / Save As dialogs (comdlg32) for importing and exporting save files, and the
    /// Windows folder picker (<see cref="PickFolder"/>, the shell's file dialog in pick-folders mode)
    /// for choosing a workshop world mod's folder. Modal: the call returns when the player picks or
    /// cancels. Elsewhere <see cref="IsAvailable"/> is false and the callers fall back to a folder
    /// under the save directory.
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

        /// <summary>
        /// Asks for a folder (the Windows folder picker); null when cancelled or unavailable.
        /// Called on the main thread.
        /// </summary>
        public static string PickFolder(string title, string initialDirectory = null)
        {
#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
            try
            {
                return FolderPicker.Show(title, initialDirectory);
            }
            catch (Exception error) when (error is DllNotFoundException || error is EntryPointNotFoundException || error is COMException
                                          || error is MarshalDirectiveException)
            {
                Debug.LogWarning("FileDialogs: the Windows folder picker is not available: " + error.GetType().Name);
                return null;
            }
#else
            return null;
#endif
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
#if UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
    /// <summary>
    /// The shell's IFileOpenDialog with FOS_PICKFOLDERS, called through its vtable (plain function
    /// pointers, so it does not depend on the runtime's COM interop support).
    /// </summary>
    internal static class FolderPicker
    {
        private static readonly Guid FileOpenDialogClass = new Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7");
        private static readonly Guid FileOpenDialogInterface = new Guid("d57c7288-d4ad-4768-be02-9d969532d960");
        private static readonly Guid ShellItemInterface = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");

        private const int ClsctxInprocServer = 0x1;
        private const int CoinitApartmentThreaded = 0x2;
        private const uint FosPickFolders = 0x20;
        private const uint FosForceFileSystem = 0x40;
        private const uint FosPathMustExist = 0x800;
        private const uint FosNoChangeDir = 0x8;
        private const uint SigdnFileSysPath = 0x80058000;
        private const int Cancelled = unchecked((int)0x800704C7);

        // vtable slots: IUnknown 0-2, IModalWindow.Show 3, IFileDialog 4-26; IShellItem.GetDisplayName 5.
        private const int SlotRelease = 2;
        private const int SlotShow = 3;
        private const int SlotSetOptions = 9;
        private const int SlotGetOptions = 10;
        private const int SlotSetFolder = 12;
        private const int SlotSetTitle = 17;
        private const int SlotGetResult = 20;
        private const int SlotGetDisplayName = 5;

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate uint ReleaseFn(IntPtr self);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int ShowFn(IntPtr self, IntPtr owner);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int SetOptionsFn(IntPtr self, uint options);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int GetOptionsFn(IntPtr self, out uint options);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int PointerFn(IntPtr self, IntPtr item);

        [UnmanagedFunctionPointer(CallingConvention.StdCall, CharSet = CharSet.Unicode)]
        private delegate int SetTitleFn(IntPtr self, [MarshalAs(UnmanagedType.LPWStr)] string title);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int GetResultFn(IntPtr self, out IntPtr item);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int GetDisplayNameFn(IntPtr self, uint form, out IntPtr name);

        public static string Show(string title, string initialDirectory)
        {
            int init = CoInitializeEx(IntPtr.Zero, CoinitApartmentThreaded);
            bool uninit = init == 0 || init == 1; // S_OK or S_FALSE; RPC_E_CHANGED_MODE leaves it as it is
            IntPtr dialog = IntPtr.Zero;
            IntPtr result = IntPtr.Zero;
            try
            {
                Guid classId = FileOpenDialogClass;
                Guid interfaceId = FileOpenDialogInterface;
                Check(CoCreateInstance(ref classId, IntPtr.Zero, ClsctxInprocServer, ref interfaceId, out dialog));
                Check(Method<GetOptionsFn>(dialog, SlotGetOptions)(dialog, out uint options));
                Check(Method<SetOptionsFn>(dialog, SlotSetOptions)(dialog,
                    options | FosPickFolders | FosForceFileSystem | FosPathMustExist | FosNoChangeDir));
                if (!string.IsNullOrEmpty(title)) Method<SetTitleFn>(dialog, SlotSetTitle)(dialog, title);
                if (!string.IsNullOrEmpty(initialDirectory) && System.IO.Directory.Exists(initialDirectory))
                {
                    Guid itemId = ShellItemInterface;
                    if (SHCreateItemFromParsingName(initialDirectory, IntPtr.Zero, ref itemId, out IntPtr folder) == 0)
                    {
                        Method<PointerFn>(dialog, SlotSetFolder)(dialog, folder);
                        Release(folder);
                    }
                }

                int shown = Method<ShowFn>(dialog, SlotShow)(dialog, GetActiveWindow());
                if (shown == Cancelled) return null;
                Check(shown);
                Check(Method<GetResultFn>(dialog, SlotGetResult)(dialog, out result));
                Check(Method<GetDisplayNameFn>(result, SlotGetDisplayName)(result, SigdnFileSysPath, out IntPtr name));
                try
                {
                    return Marshal.PtrToStringUni(name);
                }
                finally
                {
                    Marshal.FreeCoTaskMem(name);
                }
            }
            finally
            {
                Release(result);
                Release(dialog);
                if (uninit) CoUninitialize();
            }
        }

        private static T Method<T>(IntPtr instance, int slot) where T : Delegate
        {
            IntPtr table = Marshal.ReadIntPtr(instance);
            IntPtr function = Marshal.ReadIntPtr(table, slot * IntPtr.Size);
            return Marshal.GetDelegateForFunctionPointer<T>(function);
        }

        private static void Release(IntPtr instance)
        {
            if (instance != IntPtr.Zero) Method<ReleaseFn>(instance, SlotRelease)(instance);
        }

        private static void Check(int hresult)
        {
            if (hresult < 0) throw new COMException("Folder picker failed", hresult);
        }

        [DllImport("ole32.dll")]
        private static extern int CoInitializeEx(IntPtr reserved, int coInit);

        [DllImport("ole32.dll")]
        private static extern void CoUninitialize();

        [DllImport("ole32.dll")]
        private static extern int CoCreateInstance(ref Guid classId, IntPtr outer, int context, ref Guid interfaceId, out IntPtr instance);

        [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
        private static extern int SHCreateItemFromParsingName(string path, IntPtr bindContext, ref Guid interfaceId, out IntPtr item);

        [DllImport("user32.dll")]
        private static extern IntPtr GetActiveWindow();
    }
#endif
}
