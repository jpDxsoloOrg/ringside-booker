using System;
using System.IO;
using System.Threading.Tasks;
using RingsideBooker.Diagnostics;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Crash
{
    /// <summary>
    /// Send feedback and the bug report file, as the player sees them (POL9-10, POL1-02): a button
    /// that builds the zip and opens a mail draft, and below it, once used, where the file is with
    /// "Show the file" and "Copy the path". The same block sits in Settings, on the title screen and
    /// on the crash screen.
    /// </summary>
    public static class FeedbackUi
    {
        /// <summary>
        /// The Send feedback button (and, unless <paramref name="compact"/>, a "Save a bug report"
        /// button that only makes the file), with the status block under them.
        /// </summary>
        public static VisualElement Block(bool compact = false, string namePrefix = "feedback")
        {
            VisualElement block = Ui.El("cx-feedback").Named(namePrefix);
            CrashStyles.Apply(block);
            VisualElement status = Ui.El("cx-feedback__status").Named(namePrefix + "-status");
            status.SetShown(false);
            VisualElement buttons = Ui.El("cx-feedback__buttons");
            bool busy = false;

            async Task Run(bool mail)
            {
                if (busy) return;
                busy = true;
                ShowStatus(status, Ds.Loading(mail ? "Making the bug report and opening your mail app…" : "Making the bug report…"));
                try
                {
                    if (mail)
                    {
                        FeedbackResult result = await Feedback.SendAsync();
                        ShowSent(status, result, namePrefix);
                    }
                    else
                    {
                        string zip = await BugReport.CreateZipAsync();
                        ShowSaved(status, zip, namePrefix);
                    }
                }
                catch (Exception error)
                {
                    Debug.LogException(error);
                    ShowStatus(status, Ui.Text("Could not make the bug report: " + error.GetBaseException().Message, "cx-feedback__problem", "t-wrap"));
                }
                finally
                {
                    busy = false;
                }
            }

            Button send = Ds.Button("Send feedback", async () => await Run(true), DsButtonKind.Secondary, "megaphone");
            send.name = namePrefix + "-send";
            buttons.Add(send);
            if (!compact)
            {
                Button save = Ds.Button("Save a bug report", async () => await Run(false), DsButtonKind.Ghost, "download");
                save.name = namePrefix + "-save-report";
                buttons.Add(save);
            }

            return block.With(buttons, status);
        }

        /// <summary>Settings' "Feedback &amp; bug reports" group.</summary>
        public static VisualElement SettingsGroup()
        {
            VisualElement group = Ui.El("card", "settings-group", "cx-settings-group").Named("settings-feedback");
            CrashStyles.Apply(group);
            group.With(
                Ui.Text(TextFormat.Upper("Feedback & bug reports"), "settings-group__title"),
                Ui.Text("Send feedback opens your mail app with a new message and makes a bug report file to attach. " + WhatsInIt,
                    "field-hint", "settings-group__hint", "t-wrap"),
                Block(namePrefix: "settings-feedback"));
            return group;
        }

        /// <summary>The title screen's Send feedback, a quiet button under the main menu.</summary>
        public static void AddToTitle(VisualElement titleRoot)
        {
            VisualElement menu = titleRoot?.Q<VisualElement>("title-menu");
            if (menu?.parent == null) return;
            VisualElement block = Block(compact: true, namePrefix: "title-feedback");
            block.AddToClassList("cx-feedback--title");
            menu.parent.Insert(menu.parent.IndexOf(menu) + 1, block);
        }

        /// <summary>What the bug report holds, in one sentence.</summary>
        public const string WhatsInIt =
            "The file holds the game's log, your current save, the version and your settings. Nothing else from your PC.";

        private static void ShowSent(VisualElement status, FeedbackResult result, string namePrefix)
        {
            VisualElement body = Ui.El("cx-feedback__result");
            string lead = result.Ok
                ? $"Your mail app should open a new message to {result.Address}. Attach the bug report to it:"
                : result.Problem ?? "Your mail app didn't open.";
            body.Add(Ui.Text(lead, "cx-feedback__lead", "t-wrap"));
            if (result.Ok && result.Problem != null) body.Add(Ui.Text(result.Problem, "cx-feedback__problem", "t-wrap"));
            if (FeedbackConfig.IsPlaceholder)
            {
                body.Add(Ui.Text("This test build has no feedback address yet: send the file to whoever gave you the game.", "cx-feedback__hint", "t-wrap"));
            }

            AddFile(body, result.ZipPath, namePrefix);
            ShowStatus(status, body);
        }

        private static void ShowSaved(VisualElement status, string zip, string namePrefix)
        {
            VisualElement body = Ui.El("cx-feedback__result");
            body.Add(Ui.Text("Bug report saved. " + WhatsInIt, "cx-feedback__lead", "t-wrap"));
            AddFile(body, zip, namePrefix);
            ShowStatus(status, body);
        }

        private static void AddFile(VisualElement body, string zip, string namePrefix)
        {
            if (string.IsNullOrEmpty(zip)) return;
            Label path = Ui.Text(zip, "cx-feedback__path", "mono", "t-wrap").Named(namePrefix + "-path");
            Label copied = Ui.Text(string.Empty, "cx-feedback__hint");
            Button show = Ds.Button("Show the file", () => ShowInFolder(zip), DsButtonKind.Ghost, "file-text");
            show.name = namePrefix + "-show-file";
            Button copy = Ds.Button("Copy the path", () =>
            {
                GUIUtility.systemCopyBuffer = zip;
                copied.text = "Copied.";
            }, DsButtonKind.Ghost, "clipboard");
            copy.name = namePrefix + "-copy-path";
            body.Add(path);
            body.Add(Ui.El("cx-feedback__buttons").With(show, copy, copied));
        }

        private static void ShowStatus(VisualElement status, VisualElement content)
        {
            status.Clear();
            status.Add(content);
            status.SetShown(true);
        }

        /// <summary>Opens Explorer with the file selected (Windows), else its folder.</summary>
        public static void ShowInFolder(string path)
        {
            try
            {
                if (Application.platform == RuntimePlatform.WindowsPlayer || Application.platform == RuntimePlatform.WindowsEditor)
                {
                    System.Diagnostics.Process.Start("explorer.exe", "/select,\"" + path.Replace('/', '\\') + "\"");
                    return;
                }
            }
            catch (Exception error)
            {
                Debug.LogWarning("[Feedback] explorer: " + error.Message);
            }

            Application.OpenURL("file:///" + (Path.GetDirectoryName(path) ?? string.Empty).Replace('\\', '/'));
        }
    }
}
