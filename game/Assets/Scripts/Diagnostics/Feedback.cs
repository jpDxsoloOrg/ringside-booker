using System;
using System.Text;
using System.Threading.Tasks;
using RingsideBooker.Release;
using UnityEngine;

namespace RingsideBooker.Diagnostics
{
    /// <summary>Where Alpha feedback goes. The owner sets the address; never commit a personal one.</summary>
    public static class FeedbackConfig
    {
        /// <summary>The feedback mailbox. A placeholder until the owner fills it in.</summary>
        public const string Address = "feedback@example.invalid";

        /// <summary>True while <see cref="Address"/> is still the placeholder.</summary>
        public static bool IsPlaceholder => Address.EndsWith(".invalid", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>A message ready to send: the words and the bug report zip to attach.</summary>
    public sealed class FeedbackDraft
    {
        public string Address { get; set; }
        public string Subject { get; set; }
        public string Body { get; set; }
        public string ZipPath { get; set; }
        public string Version { get; set; }
    }

    /// <summary>What sending did.</summary>
    public sealed class FeedbackResult
    {
        public bool Ok { get; set; }

        /// <summary>The bug report zip (also when sending failed, so the player can still attach it).</summary>
        public string ZipPath { get; set; }

        /// <summary>The address the draft goes to.</summary>
        public string Address { get; set; }

        /// <summary>Why it failed, in words; null when it worked.</summary>
        public string Problem { get; set; }
    }

    /// <summary>
    /// How feedback leaves the game. Alpha: a mail draft (<see cref="MailtoFeedback"/>). A ticketing
    /// system can replace it later by setting <see cref="Feedback.Channel"/>.
    /// </summary>
    public interface IFeedbackChannel
    {
        FeedbackResult Send(FeedbackDraft draft);
    }

    /// <summary>
    /// Opens the player's mail app with a new message (<c>mailto:</c>): the address, subject and body
    /// filled in. Mail links can't attach files, so the body names the zip to attach.
    /// </summary>
    public sealed class MailtoFeedback : IFeedbackChannel
    {
        /// <summary>Opens a URL. Tours swap it so no mail app opens on a test machine.</summary>
        public static Action<string> Opener { get; set; } = Application.OpenURL;

        /// <summary>The last URL opened (tours and tests).</summary>
        public static string LastUrl { get; private set; }

        /// <summary><c>mailto:</c> with the subject and body percent-encoded (spaces as %20, lines as %0D%0A).</summary>
        public static string Url(string address, string subject, string body)
        {
            string Encode(string text) => Uri.EscapeDataString((text ?? string.Empty).Replace("\r\n", "\n").Replace("\n", "\r\n"));
            return $"mailto:{address}?subject={Encode(subject)}&body={Encode(body)}";
        }

        public FeedbackResult Send(FeedbackDraft draft)
        {
            string url = Url(draft.Address, draft.Subject, draft.Body);
            try
            {
                LastUrl = url;
                Opener(url);
                return new FeedbackResult { Ok = true, ZipPath = draft.ZipPath, Address = draft.Address };
            }
            catch (Exception error)
            {
                Debug.LogWarning("[Feedback] could not open the mail app: " + error.Message);
                return new FeedbackResult
                {
                    ZipPath = draft.ZipPath,
                    Address = draft.Address,
                    Problem = "Your mail app didn't open. Email " + draft.Address + " and attach the bug report file.",
                };
            }
        }
    }

    /// <summary>
    /// Send feedback (POL9-10, POL1-02): builds the bug report zip and opens a mail draft to
    /// <see cref="FeedbackConfig.Address"/> with the version in the subject, a short template in the
    /// body and the zip's path to attach. Used by Settings, the title screen and the crash screen.
    /// </summary>
    public static class Feedback
    {
        public static IFeedbackChannel Channel { get; set; } = new MailtoFeedback();

        /// <summary>"Ringside Booker Alpha 0.1.0-alpha.3 feedback" (no channel word for a release).</summary>
        public static string Subject(string version, string channel)
        {
            string name = BugReport.ChannelName(channel);
            return name.Length == 0 ? $"Ringside Booker {version} feedback" : $"Ringside Booker {name} {version} feedback";
        }

        /// <summary>The body template: what happened, what you expected, steps, and the file to attach.</summary>
        public static string Body(string version, string zipPath)
        {
            var body = new StringBuilder();
            body.AppendLine($"Version: {version}");
            body.AppendLine();
            body.AppendLine("What happened:");
            body.AppendLine();
            body.AppendLine();
            body.AppendLine("What I expected:");
            body.AppendLine();
            body.AppendLine();
            body.AppendLine("Steps to make it happen again:");
            body.AppendLine("1. ");
            body.AppendLine("2. ");
            body.AppendLine();
            if (!string.IsNullOrEmpty(zipPath))
            {
                body.AppendLine("Please attach the bug report (your mail app can't add it by itself):");
                body.AppendLine(zipPath);
            }

            return body.ToString();
        }

        /// <summary>The draft for a zip already made.</summary>
        public static FeedbackDraft Draft(string zipPath)
        {
            string version = ReleaseInfo.Version;
            return new FeedbackDraft
            {
                Address = FeedbackConfig.Address,
                Subject = Subject(version, ReleaseInfo.Channel),
                Body = Body(version, zipPath),
                ZipPath = zipPath,
                Version = version,
            };
        }

        /// <summary>Builds the bug report zip and opens the mail draft (main thread).</summary>
        public static FeedbackResult Send()
        {
            string zip;
            try
            {
                zip = BugReport.CreateZip();
            }
            catch (Exception error)
            {
                Debug.LogException(error);
                zip = null;
            }

            return SendDraft(zip);
        }

        /// <summary><see cref="Send"/> with the zip written off the main thread. Call on the main thread.</summary>
        public static async Task<FeedbackResult> SendAsync()
        {
            string zip;
            try
            {
                zip = await BugReport.CreateZipAsync();
            }
            catch (Exception error)
            {
                Debug.LogException(error);
                zip = null;
            }

            return SendDraft(zip);
        }

        private static FeedbackResult SendDraft(string zip)
        {
            FeedbackResult result = Channel.Send(Draft(zip));
            if (zip == null && result.Ok)
            {
                result.Problem = "The bug report file could not be made, so the message has no file to attach. Please describe what happened.";
            }

            return result;
        }
    }
}
