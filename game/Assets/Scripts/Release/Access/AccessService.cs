using System;
using UnityEngine;

namespace RingsideBooker.Release.Access
{
    /// <summary>
    /// Tester access (POL9-12). Released alpha and beta builds ask for a tester code once per
    /// computer; the service answers with a signed licence token, which is stored in LocalLow and
    /// checked offline at every start with the public key in <see cref="AccessConfig"/>. When online,
    /// the game checks back once a week; offline it keeps working for 30 days after the last check.
    /// <para>Who is gated: see <see cref="AppliesToBuild"/> and <see cref="GateRequired"/>. The editor,
    /// development builds, local builds (no version.json), the release channel, builds without a
    /// configured key, batch mode and dev runs (any <c>-rb…</c> switch) never see the gate.
    /// <c>-rbAccessTour</c> turns it back on for the access tour.</para>
    /// Events are raised on the main thread.
    /// </summary>
    public static class AccessService
    {
        /// <summary>The access tour (Screens/Dev/AccessTour.cs) wants the real gate even though it's a dev run.</summary>
        public const string TourArgument = "-rbAccessTour";

        private static AccessStore store;
        private static IAccessClient client;
        private static bool busy;

        /// <summary>Raised when the stored licence changes (activated, refreshed, ended or removed).</summary>
        public static event Action Changed;

        /// <summary>
        /// Packaged alpha/beta builds with a configured key. Settings › About shows the tester access
        /// rows only then.
        /// </summary>
        public static bool AppliesToBuild =>
            AccessPolicy.IsGatedChannel(ReleaseInfo.Channel)
            && AccessConfig.IsConfigured
            && !Application.isEditor
            && !Debug.isDebugBuild;

        /// <summary>The gate shows at start-up: <see cref="AppliesToBuild"/> and a normal (or access tour) run.</summary>
        public static bool GateRequired =>
            AppliesToBuild && !Application.isBatchMode && (!WhatsNewState.IsDevRun || IsTour);

        public static bool IsTour => Array.Exists(Environment.GetCommandLineArgs(), arg => string.Equals(arg, TourArgument, StringComparison.OrdinalIgnoreCase));

        public static AccessStore Store => store ??= new AccessStore();

        public static IAccessClient Client
        {
            get => client ??= new HttpAccessClient(AccessConfig.ApiUrl);
            set => client = value;
        }

        public static bool Busy => busy;

        /// <summary>The verdict on the stored token right now, with its payload (null unless it read).</summary>
        public static AccessVerdict Check(out LicencePayload payload) =>
            AccessPolicy.Evaluate(Store.Token, AccessConfig.PublicKeyBytes, ReleaseInfo.Channel, Store.InstallId, DateTime.UtcNow, out payload);

        public static bool IsActive => Check(out _) == AccessVerdict.Active;

        /// <summary>"Tester access: active (RB-7K3M-••••)", or null when there's no licence.</summary>
        public static string StatusLine()
        {
            AccessVerdict verdict = Check(out LicencePayload payload);
            if (payload == null) return null;
            return verdict == AccessVerdict.Active
                ? $"Tester access: active ({payload.MaskedCode})"
                : $"Tester access: needs a check online ({payload.MaskedCode})";
        }

        /// <summary>
        /// Sends a typed code. <paramref name="done"/> gets null on success, else an error name for
        /// <see cref="AccessMessages.ForError"/>. A code that can't be one is refused without the network.
        /// </summary>
        public static void Activate(string typed, Action<string> done)
        {
            string code = AccessCode.Normalise(typed);
            if (code == null)
            {
                done?.Invoke("invalid_code");
                return;
            }
            if (busy) return;
            busy = true;
            Client.Activate(code, Store.InstallId, ReleaseInfo.Channel, reply =>
            {
                busy = false;
                done?.Invoke(Accept(reply, "activated"));
            });
        }

        /// <summary>Checks back with the service now. <paramref name="done"/> gets null on success, else the error name.</summary>
        public static void Refresh(Action<string> done)
        {
            string token = Store.Token;
            if (string.IsNullOrEmpty(token) || busy)
            {
                done?.Invoke(busy ? "busy" : "invalid_token");
                return;
            }
            busy = true;
            Store.MarkAttempt(DateTime.UtcNow);
            Client.Refresh(token, reply =>
            {
                busy = false;
                string error = Accept(reply, "refreshed");
                if (error != null && AccessMessages.EndsAccess(error))
                {
                    Debug.Log($"[Access] access ended by the service: {error}");
                    Store.ClearToken();
                    Changed?.Invoke();
                }
                done?.Invoke(error);
            });
        }

        /// <summary>Start-up: an active licence checks back in the background when it's due.</summary>
        public static void RefreshIfDue()
        {
            AccessVerdict verdict = Check(out LicencePayload payload);
            if (verdict != AccessVerdict.Active) return;
            if (!AccessPolicy.RefreshDue(payload, Store.LastAttemptUtc, DateTime.UtcNow)) return;
            Refresh(error =>
            {
                if (error != null) Debug.Log($"[Access] weekly check: {error} (kept the licence unless the code was turned off)");
            });
        }

        /// <summary>Settings › About › Remove this code: forgets the token (keeps the install id).</summary>
        public static void Remove()
        {
            Store.ClearToken();
            Debug.Log("[Access] tester code removed from this computer");
            Changed?.Invoke();
        }

        // Stores a good token. A token that doesn't check out here (wrong key, wrong computer) is refused.
        private static string Accept(AccessReply reply, string what)
        {
            if (!reply.Ok) return reply.Error ?? "server_error";
            AccessVerdict verdict = AccessPolicy.Evaluate(reply.Token, AccessConfig.PublicKeyBytes, ReleaseInfo.Channel, Store.InstallId, DateTime.UtcNow, out LicencePayload payload);
            if (verdict != AccessVerdict.Active)
            {
                Debug.LogWarning($"[Access] the service's token did not check out here: {verdict}");
                return verdict == AccessVerdict.WrongChannel ? "wrong_channel" : verdict == AccessVerdict.Expired ? "expired" : "invalid_token";
            }
            Store.SetToken(reply.Token);
            Store.MarkAttempt(DateTime.UtcNow);
            Debug.Log($"[Access] {what}: {payload.MaskedCode}, {payload.Channel}, works offline until {payload.ExpiresUtc:yyyy-MM-dd}");
            Changed?.Invoke();
            return null;
        }
    }
}
