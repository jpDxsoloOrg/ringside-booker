using System;

namespace RingsideBooker.Release.Access
{
    /// <summary>What the stored licence means for this start.</summary>
    public enum AccessVerdict
    {
        /// <summary>A good token for this build and this computer, inside its offline grace.</summary>
        Active,
        /// <summary>No token stored.</summary>
        Missing,
        /// <summary>Broken, not signed by the service, or made for another computer.</summary>
        Invalid,
        /// <summary>The code's channel doesn't open this build (a beta code on an alpha build).</summary>
        WrongChannel,
        /// <summary>A real token whose time ran out: offline for too long, or the code expired. One check online renews it.</summary>
        Expired,
    }

    /// <summary>
    /// The licence rules (POL9-12), pure so the tests pin them with no network or disk:
    /// <list type="bullet">
    /// <item>A token works until its <c>exp</c>: 30 days after the last successful check online
    /// (the offline grace), or the code's own expiry when that is sooner.</item>
    /// <item>The game checks back once a week when online (<see cref="RefreshDue"/>), and after a
    /// failed check tries again at most once a day.</item>
    /// <item>An alpha code opens alpha and beta builds; a beta code opens beta builds only.</item>
    /// </list>
    /// </summary>
    public static class AccessPolicy
    {
        public static readonly TimeSpan RefreshEvery = TimeSpan.FromDays(7);
        public static readonly TimeSpan RetryEvery = TimeSpan.FromDays(1);

        /// <summary>A token issued a little "in the future" is fine: the player's clock may be off.</summary>
        public static readonly TimeSpan ClockSlack = TimeSpan.FromDays(1);

        /// <summary>The gate applies only to these channels (packaged tester builds).</summary>
        public static bool IsGatedChannel(string buildChannel) =>
            buildChannel == ReleaseInfo.ChannelAlpha || buildChannel == ReleaseInfo.ChannelBeta;

        public static bool ChannelOpens(string codeChannel, string buildChannel)
        {
            if (codeChannel == ReleaseInfo.ChannelAlpha) return IsGatedChannel(buildChannel);
            if (codeChannel == ReleaseInfo.ChannelBeta) return buildChannel == ReleaseInfo.ChannelBeta;
            return false;
        }

        /// <summary>Reads the stored token and decides.</summary>
        public static AccessVerdict Evaluate(string token, byte[] publicKey, string buildChannel, string installId, DateTime nowUtc, out LicencePayload payload)
        {
            payload = null;
            if (string.IsNullOrWhiteSpace(token)) return AccessVerdict.Missing;
            if (LicenceToken.Read(token, publicKey, out LicencePayload read) != TokenRead.Ok) return AccessVerdict.Invalid;
            payload = read;
            return Evaluate(read, buildChannel, installId, nowUtc);
        }

        /// <summary>The rules for a token whose signature is already checked.</summary>
        public static AccessVerdict Evaluate(LicencePayload payload, string buildChannel, string installId, DateTime nowUtc)
        {
            if (payload == null) return AccessVerdict.Missing;
            if (!string.Equals(payload.InstallId, installId, StringComparison.Ordinal)) return AccessVerdict.Invalid;
            if (!ChannelOpens(payload.Channel, buildChannel)) return AccessVerdict.WrongChannel;
            if (payload.IssuedUtc > nowUtc + ClockSlack) return AccessVerdict.Invalid;
            if (nowUtc >= payload.ExpiresUtc) return AccessVerdict.Expired;
            return AccessVerdict.Active;
        }

        /// <summary>
        /// Whether to check back with the service now: a week after the token was issued, but not
        /// again within a day of a failed try. An expired token always wants a check.
        /// </summary>
        public static bool RefreshDue(LicencePayload payload, DateTime? lastAttemptUtc, DateTime nowUtc)
        {
            if (payload == null) return false;
            if (lastAttemptUtc.HasValue && nowUtc - lastAttemptUtc.Value < RetryEvery && nowUtc >= lastAttemptUtc.Value) return false;
            return nowUtc - payload.IssuedUtc >= RefreshEvery || nowUtc >= payload.ExpiresUtc;
        }

        /// <summary>Days of offline play left (0 when expired), for the About line.</summary>
        public static int DaysLeft(LicencePayload payload, DateTime nowUtc)
        {
            if (payload == null) return 0;
            double days = (payload.ExpiresUtc - nowUtc).TotalDays;
            return days <= 0 ? 0 : (int)Math.Ceiling(days);
        }
    }
}
