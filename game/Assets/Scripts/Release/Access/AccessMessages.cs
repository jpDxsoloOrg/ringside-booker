namespace RingsideBooker.Release.Access
{
    /// <summary>
    /// Plain words for the gate and Settings › About. The keys are the service's error names
    /// (services/access/src/handlers.ts <c>ErrorCode</c>) plus the game's own <see cref="Network"/>.
    /// </summary>
    public static class AccessMessages
    {
        /// <summary>The game's own name for "no answer from the server".</summary>
        public const string Network = "network";

        public static string ForError(string error)
        {
            switch (error)
            {
                case "invalid_code":
                    return "That code isn't valid. Check it against the message you were sent (it looks like RB-XXXX-XXXX).";
                case "too_many_computers":
                    return "This code has been used on too many computers. Ask for it to be reset, or for a new code.";
                case "revoked":
                    return "This code has been turned off. Ask for a new one if you're still testing.";
                case "expired":
                    return "This code has expired. Ask for a new one if you're still testing.";
                case "wrong_channel":
                    return "This code is for a different test build. Ask for a code for this one.";
                case "not_activated":
                    return "This computer was taken off your code. Enter the code again to add it back.";
                case "invalid_token":
                    return "Your saved tester access couldn't be read. Enter your code again.";
                case "rate_limited":
                    return "Too many tries with this code in the last hour. Wait a while, then try again.";
                case "bad_request":
                    return "The game sent something the server didn't understand. Try again, and send a bug report if it keeps happening.";
                case Network:
                    return "Couldn't reach the server. Check your connection and try again.";
                default:
                    return "Something went wrong on the server. Try again in a few minutes.";
            }
        }

        /// <summary>
        /// True when the server's answer means this computer's access is over (clear the token and ask
        /// for a code). Anything else (offline, busy, a server fault) keeps the stored token.
        /// </summary>
        public static bool EndsAccess(string error) =>
            error == "revoked" || error == "expired" || error == "not_activated" || error == "invalid_token" || error == "wrong_channel";

        public const string GateTitle = "Enter your tester code";
        public const string GateIntro = "This is a test build of Ringside Booker. Type the code you were sent. You only need to do this once on this computer, and the game works offline afterwards.";
        public const string GatePrivacy = "Only the code and a random number for this computer are sent. No personal details.";
        public const string GateCheckIn = "Your tester access needs a quick check online. Connect to the internet and press Try again, or enter your code.";
    }
}
