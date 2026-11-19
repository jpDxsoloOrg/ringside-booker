using System;
using System.Globalization;
using System.Text;

namespace RingsideBooker.Import.Pictures
{
    /// <summary>
    /// Decodes the picture references the engine's world mod converter writes
    /// (<c>packages/engine-host/src/worldMod/imageRef.ts</c>): <c>wm/</c> plus the picture's path
    /// inside the mod's picture folder, with <c>_</c> → <c>__</c>, space → <c>_s</c> and any other
    /// character outside letters, digits, <c>.</c> and <c>-</c> → <c>_x&lt;hex&gt;_</c>.
    /// </summary>
    public static class PictureRef
    {
        public const string Prefix = "wm/";

        /// <summary>True for a reference to a world mod picture.</summary>
        public static bool IsWorldModRef(string imageRef) => imageRef != null && imageRef.StartsWith(Prefix, StringComparison.Ordinal);

        /// <summary>
        /// The relative path (with <c>/</c>) a reference encodes, or null when it is not a world mod
        /// reference, is malformed, or would leave the picture folder.
        /// </summary>
        public static string Decode(string imageRef)
        {
            if (!IsWorldModRef(imageRef))
            {
                return null;
            }

            var body = imageRef.Substring(Prefix.Length);
            var builder = new StringBuilder(body.Length);
            for (var index = 0; index < body.Length; index++)
            {
                var character = body[index];
                if (character != '_')
                {
                    builder.Append(character);
                    continue;
                }

                if (index + 1 >= body.Length)
                {
                    return null;
                }

                var next = body[index + 1];
                if (next == '_')
                {
                    builder.Append('_');
                    index++;
                }
                else if (next == 's')
                {
                    builder.Append(' ');
                    index++;
                }
                else if (next == 'x')
                {
                    var end = body.IndexOf('_', index + 2);
                    if (end < 0 || !int.TryParse(body.Substring(index + 2, end - index - 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var code))
                    {
                        return null;
                    }

                    try
                    {
                        builder.Append(char.ConvertFromUtf32(code));
                    }
                    catch (ArgumentOutOfRangeException)
                    {
                        return null;
                    }

                    index = end;
                }
                else
                {
                    return null;
                }
            }

            var path = builder.ToString();
            foreach (var segment in path.Split('/'))
            {
                if (segment.Length == 0 || segment == "." || segment == ".." || segment.IndexOf('\\') >= 0 || segment.IndexOf(':') >= 0)
                {
                    return null;
                }
            }

            return path;
        }
    }
}
