using System;
using System.IO;

namespace RingsideBooker.Saves
{
    /// <summary>
    /// Writes a file so that a crash, a full disk or a failed write never leaves it half written:
    /// the bytes go to <c>&lt;path&gt;.tmp</c> first, are flushed to disk, and only then replace the
    /// file in one step. The file that was there can be kept as a backup.
    /// </summary>
    public static class AtomicFile
    {
        public const string TempSuffix = ".tmp";

        /// <summary>Writes <paramref name="bytes"/> to <paramref name="path"/>.</summary>
        /// <param name="backupPath">Where the file being replaced goes (overwriting the older backup); null keeps none.</param>
        /// <param name="verify">
        /// Read the written temp file back and compare every byte before it replaces anything
        /// (verify-after-write, POL1-04); a mismatch throws <see cref="SaveVerifyException"/>.
        /// </param>
        public static void WriteAllBytes(string path, byte[] bytes, string backupPath = null, bool verify = false)
        {
            if (bytes == null) throw new ArgumentNullException(nameof(bytes));
            Write(path, stream => stream.Write(bytes, 0, bytes.Length), backupPath, verify ? bytes : null);
        }

        /// <summary>
        /// Writes whatever <paramref name="write"/> puts in the stream to <paramref name="path"/>. If
        /// <paramref name="write"/> throws, the old file (and its backup) stay as they were, the temp
        /// file is removed and the exception goes on to the caller.
        /// </summary>
        /// <param name="expected">
        /// When given, the temp file is read back after the flush and must equal these bytes before it
        /// replaces the file; otherwise <see cref="SaveVerifyException"/> and nothing is replaced.
        /// </param>
        public static void Write(string path, Action<Stream> write, string backupPath = null, byte[] expected = null)
        {
            if (string.IsNullOrEmpty(path)) throw new ArgumentException("A path is needed", nameof(path));
            if (write == null) throw new ArgumentNullException(nameof(write));

            string directory = Path.GetDirectoryName(Path.GetFullPath(path));
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);

            string temp = path + TempSuffix;
            try
            {
                using (var stream = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None, 81920, FileOptions.WriteThrough))
                {
                    write(stream);
                    stream.Flush(true);
                }

                if (expected != null) VerifyStored(temp, expected);
                Replace(temp, path, backupPath);
            }
            catch
            {
                TryDelete(temp);
                throw;
            }
        }

        private static void VerifyStored(string temp, byte[] expected)
        {
            byte[] stored = File.ReadAllBytes(temp);
            if (stored.Length != expected.Length)
            {
                throw new SaveVerifyException($"The disk kept {stored.Length} bytes of {expected.Length}.");
            }

            for (int index = 0; index < stored.Length; index++)
            {
                if (stored[index] != expected[index]) throw new SaveVerifyException($"The disk kept a different byte at {index}.");
            }
        }

        private static void Replace(string temp, string path, string backupPath)
        {
            if (!File.Exists(path))
            {
                File.Move(temp, path);
                return;
            }

            try
            {
                // One step on NTFS: the old file becomes the backup and the temp file takes its name.
                if (backupPath != null && File.Exists(backupPath)) File.Delete(backupPath);
                File.Replace(temp, path, backupPath, true);
            }
            catch (PlatformNotSupportedException)
            {
                ReplaceByHand(temp, path, backupPath);
            }
        }

        private static void ReplaceByHand(string temp, string path, string backupPath)
        {
            if (backupPath != null) File.Copy(path, backupPath, true);
            File.Delete(path);
            File.Move(temp, path);
        }

        private static void TryDelete(string path)
        {
            try
            {
                if (File.Exists(path)) File.Delete(path);
            }
            catch (IOException)
            {
                // Best effort: a stale temp file is overwritten by the next write.
            }
            catch (UnauthorizedAccessException)
            {
            }
        }
    }

    /// <summary>A file read back after writing was not what was written (verify-after-write).</summary>
    public sealed class SaveVerifyException : IOException
    {
        public SaveVerifyException(string message)
            : base(message)
        {
        }
    }
}
