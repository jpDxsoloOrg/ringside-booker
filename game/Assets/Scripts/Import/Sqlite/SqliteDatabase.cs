using System;
using System.Collections.Generic;

namespace RingsideBooker.Import.Sqlite
{
    /// <summary>An SQLite error, with SQLite's own message.</summary>
    public sealed class SqliteException : Exception
    {
        public SqliteException(string message) : base(message)
        {
        }
    }

    /// <summary>
    /// A connection to one SQLite database file, over the thin P/Invoke layer in
    /// <see cref="SqliteNative"/>. Not thread-safe: use one connection per thread.
    /// </summary>
    public sealed class SqliteDatabase : IDisposable
    {
        private IntPtr handle;

        private SqliteDatabase(IntPtr handle)
        {
            this.handle = handle;
        }

        /// <summary>The SQLite library version, such as "3.54.1".</summary>
        public static string LibraryVersion => SqliteNative.Utf8(SqliteNative.LibVersion());

        /// <summary>Opens an existing database read-only.</summary>
        public static SqliteDatabase OpenReadOnly(string path)
        {
            return Open(path, SqliteNative.OpenReadOnly);
        }

        /// <summary>Opens a database for writing, creating the file when it is missing.</summary>
        public static SqliteDatabase OpenOrCreate(string path)
        {
            return Open(path, SqliteNative.OpenReadWrite | SqliteNative.OpenCreate);
        }

        private static SqliteDatabase Open(string path, int flags)
        {
            if (path == null)
            {
                throw new ArgumentNullException(nameof(path));
            }

            var result = SqliteNative.OpenV2(SqliteNative.ToUtf8(path), out var db, flags | SqliteNative.OpenNoMutex, IntPtr.Zero);
            if (result != SqliteNative.Ok)
            {
                var message = db == IntPtr.Zero ? $"code {result}" : SqliteNative.Utf8(SqliteNative.ErrMsg(db));
                if (db != IntPtr.Zero)
                {
                    SqliteNative.CloseV2(db);
                }

                throw new SqliteException($"Could not open the database: {message}");
            }

            return new SqliteDatabase(db);
        }

        /// <summary>Runs statements that return no rows (several, separated by semicolons, are fine).</summary>
        public void Execute(string sql, params string[] parameters)
        {
            foreach (var statementSql in SplitStatements(sql))
            {
                using (var statement = Prepare(statementSql))
                {
                    statement.BindTexts(parameters);
                    while (statement.Step())
                    {
                    }
                }
            }
        }

        /// <summary>Prepares one statement.</summary>
        public SqliteStatement Prepare(string sql)
        {
            EnsureOpen();
            var bytes = SqliteNative.ToUtf8(sql);
            var result = SqliteNative.PrepareV2(handle, bytes, bytes.Length, out var statement, IntPtr.Zero);
            if (result != SqliteNative.Ok)
            {
                throw new SqliteException($"{LastError()} (in: {sql})");
            }

            return new SqliteStatement(this, statement);
        }

        /// <summary>The names of every table in the database (views left out).</summary>
        public List<string> TableNames()
        {
            var names = new List<string>();
            using (var statement = Prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"))
            {
                while (statement.Step())
                {
                    names.Add(statement.GetText(0));
                }
            }

            return names;
        }

        internal string LastError()
        {
            return handle == IntPtr.Zero ? "the database is closed" : SqliteNative.Utf8(SqliteNative.ErrMsg(handle));
        }

        private void EnsureOpen()
        {
            if (handle == IntPtr.Zero)
            {
                throw new ObjectDisposedException(nameof(SqliteDatabase));
            }
        }

        private static IEnumerable<string> SplitStatements(string sql)
        {
            // Good enough for the fixed SQL the game and its tests write: no semicolons inside strings.
            foreach (var part in sql.Split(';'))
            {
                if (part.Trim().Length > 0)
                {
                    yield return part;
                }
            }
        }

        public void Dispose()
        {
            if (handle != IntPtr.Zero)
            {
                SqliteNative.CloseV2(handle);
                handle = IntPtr.Zero;
            }
        }
    }

    /// <summary>A prepared statement; read a row's columns after each <see cref="Step"/> that returns true.</summary>
    public sealed class SqliteStatement : IDisposable
    {
        private readonly SqliteDatabase database;
        private IntPtr handle;

        internal SqliteStatement(SqliteDatabase database, IntPtr handle)
        {
            this.database = database;
            this.handle = handle;
        }

        public int ColumnCount => SqliteNative.ColumnCount(handle);

        public string ColumnName(int column) => SqliteNative.Utf8(SqliteNative.ColumnName(handle, column));

        /// <summary>The stored type of a column in the current row (<c>SqliteNative.Type*</c>).</summary>
        public int ColumnType(int column) => SqliteNative.ColumnType(handle, column);

        public long GetInt64(int column) => SqliteNative.ColumnInt64(handle, column);

        public double GetDouble(int column) => SqliteNative.ColumnDouble(handle, column);

        public string GetText(int column)
        {
            var pointer = SqliteNative.ColumnText(handle, column);
            return SqliteNative.Utf8(pointer, SqliteNative.ColumnBytes(handle, column));
        }

        /// <summary>Binds text parameters <c>?1</c>, <c>?2</c>, …; a null binds SQL NULL.</summary>
        public void BindTexts(string[] values)
        {
            if (values == null)
            {
                return;
            }

            for (var index = 0; index < values.Length; index++)
            {
                if (values[index] == null)
                {
                    continue;
                }

                var bytes = SqliteNative.ToUtf8(values[index]);
                var result = SqliteNative.BindText(handle, index + 1, bytes, bytes.Length - 1, SqliteNative.Transient);
                if (result != SqliteNative.Ok)
                {
                    throw new SqliteException(database.LastError());
                }
            }
        }

        /// <summary>Moves to the next row: true when there is one, false when the statement is done.</summary>
        public bool Step()
        {
            var result = SqliteNative.Step(handle);
            if (result == SqliteNative.Row)
            {
                return true;
            }

            if (result == SqliteNative.Done)
            {
                return false;
            }

            throw new SqliteException(database.LastError());
        }

        public void Dispose()
        {
            if (handle != IntPtr.Zero)
            {
                SqliteNative.Finalize(handle);
                handle = IntPtr.Zero;
            }
        }
    }
}
