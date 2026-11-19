using System;
using System.Runtime.InteropServices;

namespace RingsideBooker.Import.Sqlite
{
    /// <summary>
    /// The few functions of the SQLite C API the importer needs, from the official
    /// <c>sqlite3.dll</c> (win-x64) in <c>Assets/Plugins/Sqlite/x86_64/</c>. Text crosses as UTF-8.
    /// Use <see cref="SqliteDatabase"/>, not these directly.
    /// </summary>
    internal static class SqliteNative
    {
        private const string Library = "sqlite3";

        public const int Ok = 0;
        public const int Row = 100;
        public const int Done = 101;

        public const int OpenReadOnly = 0x00000001;
        public const int OpenReadWrite = 0x00000002;
        public const int OpenCreate = 0x00000004;
        public const int OpenUri = 0x00000040;
        public const int OpenNoMutex = 0x00008000;

        public const int TypeInteger = 1;
        public const int TypeFloat = 2;
        public const int TypeText = 3;
        public const int TypeBlob = 4;
        public const int TypeNull = 5;

        [DllImport(Library, EntryPoint = "sqlite3_libversion", CallingConvention = CallingConvention.Cdecl)]
        public static extern IntPtr LibVersion();

        [DllImport(Library, EntryPoint = "sqlite3_open_v2", CallingConvention = CallingConvention.Cdecl)]
        public static extern int OpenV2(byte[] fileNameUtf8, out IntPtr db, int flags, IntPtr vfs);

        [DllImport(Library, EntryPoint = "sqlite3_close_v2", CallingConvention = CallingConvention.Cdecl)]
        public static extern int CloseV2(IntPtr db);

        [DllImport(Library, EntryPoint = "sqlite3_errmsg", CallingConvention = CallingConvention.Cdecl)]
        public static extern IntPtr ErrMsg(IntPtr db);

        [DllImport(Library, EntryPoint = "sqlite3_prepare_v2", CallingConvention = CallingConvention.Cdecl)]
        public static extern int PrepareV2(IntPtr db, byte[] sqlUtf8, int byteCount, out IntPtr statement, IntPtr tail);

        [DllImport(Library, EntryPoint = "sqlite3_step", CallingConvention = CallingConvention.Cdecl)]
        public static extern int Step(IntPtr statement);

        [DllImport(Library, EntryPoint = "sqlite3_finalize", CallingConvention = CallingConvention.Cdecl)]
        public static extern int Finalize(IntPtr statement);

        [DllImport(Library, EntryPoint = "sqlite3_column_count", CallingConvention = CallingConvention.Cdecl)]
        public static extern int ColumnCount(IntPtr statement);

        [DllImport(Library, EntryPoint = "sqlite3_column_name", CallingConvention = CallingConvention.Cdecl)]
        public static extern IntPtr ColumnName(IntPtr statement, int column);

        [DllImport(Library, EntryPoint = "sqlite3_column_type", CallingConvention = CallingConvention.Cdecl)]
        public static extern int ColumnType(IntPtr statement, int column);

        [DllImport(Library, EntryPoint = "sqlite3_column_int64", CallingConvention = CallingConvention.Cdecl)]
        public static extern long ColumnInt64(IntPtr statement, int column);

        [DllImport(Library, EntryPoint = "sqlite3_column_double", CallingConvention = CallingConvention.Cdecl)]
        public static extern double ColumnDouble(IntPtr statement, int column);

        [DllImport(Library, EntryPoint = "sqlite3_column_text", CallingConvention = CallingConvention.Cdecl)]
        public static extern IntPtr ColumnText(IntPtr statement, int column);

        [DllImport(Library, EntryPoint = "sqlite3_column_bytes", CallingConvention = CallingConvention.Cdecl)]
        public static extern int ColumnBytes(IntPtr statement, int column);

        [DllImport(Library, EntryPoint = "sqlite3_bind_text", CallingConvention = CallingConvention.Cdecl)]
        public static extern int BindText(IntPtr statement, int index, byte[] valueUtf8, int byteCount, IntPtr destructor);

        /// <summary>SQLITE_TRANSIENT: SQLite copies bound text before the call returns.</summary>
        public static readonly IntPtr Transient = new IntPtr(-1);

        /// <summary>A NUL-terminated UTF-8 string from native memory, or null.</summary>
        public static string Utf8(IntPtr pointer, int byteCount = -1)
        {
            if (pointer == IntPtr.Zero)
            {
                return null;
            }

            if (byteCount < 0)
            {
                byteCount = 0;
                while (Marshal.ReadByte(pointer, byteCount) != 0)
                {
                    byteCount++;
                }
            }

            var bytes = new byte[byteCount];
            Marshal.Copy(pointer, bytes, 0, byteCount);
            return System.Text.Encoding.UTF8.GetString(bytes);
        }

        /// <summary>A UTF-8, NUL-terminated copy of <paramref name="value"/>.</summary>
        public static byte[] ToUtf8(string value)
        {
            var length = System.Text.Encoding.UTF8.GetByteCount(value);
            var bytes = new byte[length + 1];
            System.Text.Encoding.UTF8.GetBytes(value, 0, value.Length, bytes, 0);
            return bytes;
        }
    }
}
