using System.Text;

namespace RingsideBooker.Release.Access
{
    /// <summary>
    /// Tester codes as typed: <c>RB-XXXX-XXXX</c> from an alphabet with no look-alikes (no 0/O,
    /// 1/I/L). The same rules as services/access/src/codes.ts, so a typo is caught before any network.
    /// </summary>
    public static class AccessCode
    {
        public const string Alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
        public const string Prefix = "RB";
        public const string Example = "RB-XXXX-XXXX";

        /// <summary>Capitals, no spaces, dashes put back; null when it can't be a code.</summary>
        public static string Normalise(string input)
        {
            if (input == null) return null;
            var compact = new StringBuilder();
            foreach (char character in input.ToUpperInvariant())
            {
                if (character == '-' || char.IsWhiteSpace(character)) continue;
                compact.Append(character);
            }
            string body = compact.ToString();
            if (body.StartsWith(Prefix, System.StringComparison.Ordinal)) body = body.Substring(Prefix.Length);
            if (body.Length != 8) return null;
            foreach (char character in body)
            {
                if (Alphabet.IndexOf(character) < 0) return null;
            }
            return $"{Prefix}-{body.Substring(0, 4)}-{body.Substring(4)}";
        }
    }
}
