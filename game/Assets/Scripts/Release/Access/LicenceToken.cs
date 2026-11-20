using System;
using System.Text;
using Newtonsoft.Json.Linq;

namespace RingsideBooker.Release.Access
{
    /// <summary>What a licence token says (services/access/src/token.ts writes it). Times are Unix seconds.</summary>
    public sealed class LicencePayload
    {
        public string CodeId = "";
        public string Channel = "";
        public string InstallId = "";
        /// <summary>The visible half of the code, e.g. <c>RB-7K3M</c>.</summary>
        public string Hint = "";
        public long Issued;
        public long Expires;

        public DateTime IssuedUtc => DateTimeOffset.FromUnixTimeSeconds(Issued).UtcDateTime;
        public DateTime ExpiresUtc => DateTimeOffset.FromUnixTimeSeconds(Expires).UtcDateTime;

        /// <summary>"RB-7K3M-••••": the code with its second half hidden.</summary>
        public string MaskedCode => string.IsNullOrEmpty(Hint) ? "••••" : $"{Hint}-••••";
    }

    public enum TokenRead
    {
        Ok,
        /// <summary>Not a token at all (or a part is missing or broken).</summary>
        Malformed,
        /// <summary>Well formed, but not signed by the access service's key.</summary>
        BadSignature,
    }

    /// <summary>
    /// The licence token: <c>base64url(payload JSON) "." base64url(Ed25519 signature)</c>; the
    /// signature covers the ASCII bytes of the first part. Read offline with the public key in
    /// <see cref="AccessConfig"/>. Pure, so the tests can check it with fixed keys.
    /// </summary>
    public static class LicenceToken
    {
        public static TokenRead Read(string token, byte[] publicKey, out LicencePayload payload)
        {
            payload = null;
            if (string.IsNullOrWhiteSpace(token) || token.Length > 2048) return TokenRead.Malformed;
            string[] parts = token.Trim().Split('.');
            if (parts.Length != 2) return TokenRead.Malformed;
            byte[] signature = FromBase64Url(parts[1]);
            byte[] body = FromBase64Url(parts[0]);
            if (signature == null || body == null) return TokenRead.Malformed;
            if (!Ed25519.Verify(publicKey, Encoding.ASCII.GetBytes(parts[0]), signature)) return TokenRead.BadSignature;
            payload = Parse(Encoding.UTF8.GetString(body));
            return payload == null ? TokenRead.Malformed : TokenRead.Ok;
        }

        /// <summary>Makes a token (tests sign with a fixed seed; the game never signs).</summary>
        public static string Write(LicencePayload payload, byte[] seed)
        {
            var json = new JObject
            {
                ["v"] = 1,
                ["cid"] = payload.CodeId,
                ["ch"] = payload.Channel,
                ["iid"] = payload.InstallId,
                ["hint"] = payload.Hint,
                ["iat"] = payload.Issued,
                ["exp"] = payload.Expires,
            };
            string body = ToBase64Url(Encoding.UTF8.GetBytes(json.ToString(Newtonsoft.Json.Formatting.None)));
            return body + "." + ToBase64Url(Ed25519.Sign(seed, Encoding.ASCII.GetBytes(body)));
        }

        private static LicencePayload Parse(string json)
        {
            try
            {
                if (!(JToken.Parse(json) is JObject obj)) return null;
                if (obj.Value<int?>("v") != 1) return null;
                var payload = new LicencePayload
                {
                    CodeId = obj.Value<string>("cid"),
                    Channel = obj.Value<string>("ch"),
                    InstallId = obj.Value<string>("iid"),
                    Hint = obj.Value<string>("hint") ?? "",
                    Issued = obj.Value<long?>("iat") ?? -1,
                    Expires = obj.Value<long?>("exp") ?? -1,
                };
                if (string.IsNullOrEmpty(payload.CodeId) || string.IsNullOrEmpty(payload.Channel) || string.IsNullOrEmpty(payload.InstallId)) return null;
                if (payload.Issued < 0 || payload.Expires < 0) return null;
                return payload;
            }
            catch (Exception)
            {
                return null;
            }
        }

        public static byte[] FromBase64Url(string text)
        {
            if (string.IsNullOrEmpty(text)) return null;
            string padded = text.Replace('-', '+').Replace('_', '/');
            switch (padded.Length % 4)
            {
                case 2: padded += "=="; break;
                case 3: padded += "="; break;
                case 1: return null;
            }
            try
            {
                return Convert.FromBase64String(padded);
            }
            catch (FormatException)
            {
                return null;
            }
        }

        public static string ToBase64Url(byte[] bytes) =>
            Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }
}
