using System;

namespace RingsideBooker.Release.Access
{
    /// <summary>
    /// Where the tester access service lives and the public key its tokens are signed with
    /// (POL9-12). Neither is secret: the private key stays in AWS (SSM Parameter Store). The values
    /// come from the deployed stack `ringside-booker-access` (see game/docs/access-codes.md).
    /// <para>A build from source can blank <see cref="PublicKey"/> to turn the gate off; the gate
    /// also only applies to packaged alpha and beta builds (<see cref="AccessService.AppliesToBuild"/>).</para>
    /// </summary>
    public static class AccessConfig
    {
        /// <summary>The HTTP API's base URL (no trailing slash).</summary>
        public const string ApiUrl = "";

        /// <summary>The Ed25519 public key, raw 32 bytes in base64.</summary>
        public const string PublicKey = "";

        private static byte[] publicKeyBytes;

        public static byte[] PublicKeyBytes
        {
            get
            {
                if (publicKeyBytes != null) return publicKeyBytes;
                try
                {
                    byte[] bytes = string.IsNullOrEmpty(PublicKey) ? null : Convert.FromBase64String(PublicKey);
                    publicKeyBytes = bytes != null && bytes.Length == Ed25519.PublicKeySize ? bytes : Array.Empty<byte>();
                }
                catch (FormatException)
                {
                    publicKeyBytes = Array.Empty<byte>();
                }
                return publicKeyBytes;
            }
        }

        /// <summary>True when both the key and the URL are set.</summary>
        public static bool IsConfigured => PublicKeyBytes.Length == Ed25519.PublicKeySize && !string.IsNullOrEmpty(ApiUrl);
    }
}
