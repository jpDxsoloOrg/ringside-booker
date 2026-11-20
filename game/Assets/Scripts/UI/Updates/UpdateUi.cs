using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using RingsideBooker.Release;
using RingsideBooker.Release.Updates;
using RingsideBooker.Saves;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Updates
{
    /// <summary>
    /// The quiet update UI (POL9-11): the "Update available" chip (title screen and Settings › About)
    /// and the About rows (Check for updates automatically, Check now, status). Never a popup during
    /// play: the sheet opens only when the player clicks the chip.
    /// </summary>
    public static class UpdateUi
    {
        public const string ChipName = "update-chip";
        private const string Resource = "Updates/Updates";

        public static void Apply(VisualElement root)
        {
            if (root == null) return;
            StyleSheet sheet = Resources.Load<StyleSheet>(Resource);
            if (sheet != null && !root.styleSheets.Contains(sheet)) root.styleSheets.Add(sheet);
        }

        /// <summary>"Update available: v0.1.0-alpha.2".</summary>
        public static string ChipText(ReleaseEntry release) => $"Update available: v{release.Version}";

        /// <summary>
        /// A chip that follows <see cref="UpdateService"/>: shown while a newer, unskipped release is
        /// waiting; clicking it opens <see cref="UpdateSheet"/>.
        /// </summary>
        public static Button Chip(string extraClass = null)
        {
            Button chip = null;
            chip = new Button(() => UpdateSheet.Open(chip, UpdateService.Offer)) { text = string.Empty, name = ChipName };
            chip.AddToClassList("upd-chip");
            if (extraClass != null) chip.AddToClassList(extraClass);
            chip.Add(new Icon("download", "ds-icon--xs", "upd-chip__icon"));
            Label label = Ui.Text(string.Empty, "upd-chip__label");
            chip.Add(label);

            void Refresh()
            {
                bool shown = UpdateService.ShowChip;
                chip.SetShown(shown);
                if (!shown) return;
                label.text = ChipText(UpdateService.Offer);
                chip.tooltip = "A newer version is out. Click for what's in it and to install it.";
            }

            Follow(chip, Refresh);
            return chip;
        }

        /// <summary>Title screen: the chip above the version line (bottom left).</summary>
        public static void AddToTitle(VisualElement root)
        {
            Apply(root);
            VisualElement side = root.Q<VisualElement>("title-side");
            side?.Add(Chip("upd-chip--title"));
        }

        /// <summary>Settings › About: the chip, "Check for updates automatically" and Check now with its status.</summary>
        public static VisualElement AboutBlock()
        {
            VisualElement block = Ui.El("upd-about").Named("settings-update");
            block.RegisterCallback<AttachToPanelEvent>(evt => Apply(evt.destinationPanel?.visualTree));
            RingsideBooker.Help.HelpScreen.Style(block);

            block.Add(Chip("upd-chip--about"));

            Button automatic = RingsideBooker.Help.FirstRun.CheckRow("Check for updates automatically", UpdatePrefs.Automatic, value => UpdatePrefs.Automatic = value);
            automatic.name = "update-automatic";
            block.Add(automatic);

            VisualElement row = Ds.Row("upd-about__row");
            Button checkNow = Ds.Button("Check now", () => UpdateService.CheckNow(manual: true), DsButtonKind.Ghost, "reset");
            checkNow.name = "update-check-now";
            row.Add(checkNow);
            Label status = Ui.Text(string.Empty, "field-hint", "upd-about__status").Named("update-status");
            row.Add(status);
            block.Add(row);

            void Refresh()
            {
                status.text = StatusText(UpdateService.Status, UpdateService.Offer, UpdateService.LastCheckUtc);
                checkNow.SetEnabled(UpdateService.Status != UpdateStatus.Checking);
            }

            Follow(block, Refresh);
            return block;
        }

        /// <summary>The About status line in plain words.</summary>
        public static string StatusText(UpdateStatus status, ReleaseEntry offer, DateTime? lastCheckUtc)
        {
            switch (status)
            {
                case UpdateStatus.Checking:
                    return "Checking…";
                case UpdateStatus.Available:
                    return offer != null ? $"Version {offer.Version} is out." : string.Empty;
                case UpdateStatus.UpToDate:
                    return "You have the newest version.";
                case UpdateStatus.Failed:
                    return "Couldn't check for updates. Try again later.";
                default:
                    return lastCheckUtc.HasValue
                        ? $"Last checked {lastCheckUtc.Value.ToLocalTime().ToString("d MMM yyyy", System.Globalization.CultureInfo.InvariantCulture)}."
                        : string.Empty;
            }
        }

        // Refresh now and on every change while the element is on a panel.
        private static void Follow(VisualElement element, Action refresh)
        {
            Action handler = () => refresh();
            element.RegisterCallback<AttachToPanelEvent>(_ =>
            {
                UpdateService.Changed -= handler;
                UpdateService.Changed += handler;
                refresh();
            });
            element.RegisterCallback<DetachFromPanelEvent>(_ => UpdateService.Changed -= handler);
            refresh();
        }
    }

    /// <summary>
    /// The update sheet: the release's notes, then Download and install / Later / Skip this version.
    /// Downloading shows progress; when the file is checked, it asks to save the game (when one is
    /// open), saves through the game's normal save, starts the installer and quits. Anything that fails
    /// offers "Open the download page".
    /// </summary>
    public static class UpdateSheet
    {
        public const string BodyName = "update-sheet";

        /// <summary>The sheet's stages (public for tours and tests).</summary>
        public enum Stage
        {
            Offer,
            Downloading,
            Ready,
            Installing,
            Failed,
        }

        public static Controller Current { get; private set; }

        public static OverlayHandle Open(VisualElement anyElement, ReleaseEntry release)
        {
            if (release == null) return null;
            UpdateUi.Apply(anyElement?.panel?.visualTree);
            WhatsNew.WhatsNewStyles.Apply(anyElement?.panel?.visualTree);
            var controller = new Controller(release);
            OverlayHandle handle = DsOverlay.SideSheet(anyElement, "Update available", controller.Body,
                eyebrow: TextFormat.Upper(ChannelWord(release.Channel)), footer: controller.Footer, width: 480f);
            if (handle == null) return null;
            controller.Handle = handle;
            Current = controller;
            handle.Closed += () =>
            {
                controller.Download?.Cancel();
                if (Current == controller) Current = null;
            };
            return handle;
        }

        private static string ChannelWord(string channel) => channel switch
        {
            ReleaseInfo.ChannelAlpha => "Alpha update",
            ReleaseInfo.ChannelBeta => "Beta update",
            _ => "Update",
        };

        /// <summary>The release notes as heading and bullet pairs (pure; the GitHub release's Markdown body).</summary>
        public static List<(string heading, List<string> items)> NotesFrom(string body, int maxItems = 40)
        {
            var sections = new List<(string heading, List<string> items)>();
            (string heading, List<string> items) current = (null, new List<string>());
            int count = 0;
            foreach (string raw in (body ?? string.Empty).Replace("\r\n", "\n").Split('\n'))
            {
                string line = raw.Trim();
                if (line.Length == 0) continue;
                if (line.StartsWith("#", StringComparison.Ordinal))
                {
                    if (current.heading != null || current.items.Count > 0) sections.Add(current);
                    current = (Plain(line.TrimStart('#').Trim()), new List<string>());
                    continue;
                }
                if (count >= maxItems) continue;
                string item = line.StartsWith("- ", StringComparison.Ordinal) || line.StartsWith("* ", StringComparison.Ordinal) ? line.Substring(2) : line;
                current.items.Add(Plain(item));
                count++;
            }
            if (current.heading != null || current.items.Count > 0) sections.Add(current);
            return sections;
        }

        private static string Plain(string text) => text.Replace("**", string.Empty).Replace("`", string.Empty);

        /// <summary>One open sheet's state and its footer (the actions change with the stage).</summary>
        public sealed class Controller
        {
            public readonly ReleaseEntry Release;
            public readonly VisualElement Body;
            public readonly VisualElement Footer;
            public OverlayHandle Handle;
            public UpdateDownload Download { get; private set; }
            public Stage Stage { get; private set; }
            public string Problem { get; private set; }

            private IVisualElementScheduledItem ticker;

            public Controller(ReleaseEntry release)
            {
                Release = release;
                Body = BuildBody(release);
                Footer = Ui.El("upd-footer").Named("update-actions");
                ShowOffer();
            }

            private static VisualElement BuildBody(ReleaseEntry release)
            {
                VisualElement body = Ui.El("upd-body").Named(BodyName);
                body.Add(Ui.Text($"Version {release.Version} is out", "upd-headline").Named("update-version"));
                string published = string.IsNullOrEmpty(release.PublishedDay) ? string.Empty : $" It came out on {release.PublishedDay}.";
                body.Add(Ui.Text($"You have {ReleaseInfo.SemVer}.{published} Updating keeps your saves and settings.", "upd-sub", "t-wrap"));

                List<(string heading, List<string> items)> notes = NotesFrom(release.Body);
                if (notes.Count == 0)
                {
                    body.Add(Ui.Text("This release has no notes.", "field-hint").Named("update-no-notes"));
                    return body;
                }
                VisualElement list = Ui.El("upd-notes").Named("update-notes");
                foreach ((string heading, List<string> items) in notes)
                {
                    VisualElement group = Ui.El("wn-group");
                    if (heading != null) group.Add(Ds.SectionHeader(heading));
                    foreach (string item in items)
                    {
                        VisualElement row = Ui.El("wn-item");
                        row.Add(Ui.El("wn-item__dot"));
                        row.Add(Ui.Text(item, "wn-item__text"));
                        group.Add(row);
                    }
                    list.Add(group);
                }
                body.Add(list);
                return body;
            }

            private void ShowOffer()
            {
                Stage = Stage.Offer;
                Footer.Clear();
                ReleaseAsset installer = Release.Installer;
                if (installer != null)
                {
                    Footer.Add(Ui.Text($"Windows installer, {UpdateFeed.Megabytes(installer.Size)}.", "field-hint", "upd-footer__note"));
                }
                else
                {
                    Footer.Add(Ui.Text("This release has no Windows installer yet. Get it from the download page.", "field-hint", "upd-footer__note", "t-wrap"));
                }
                VisualElement buttons = Ds.Row("upd-footer__buttons");
                buttons.Add(installer != null
                    ? Named(Ds.Button("Download and install", StartDownload, DsButtonKind.Primary, "download"), "update-download")
                    : Named(Ds.Button("Open the download page", () => UpdateService.OpenDownloadPage(Release), DsButtonKind.Primary), "update-open-page"));
                buttons.Add(Named(Ds.Button("Later", () => Handle?.Close(), DsButtonKind.Ghost), "update-later"));
                buttons.Add(Named(Ds.Button("Skip this version", () =>
                {
                    UpdateService.Skip(Release);
                    Handle?.Close();
                }, DsButtonKind.Ghost), "update-skip"));
                Footer.Add(buttons);
            }

            public void StartDownload()
            {
                Stage = Stage.Downloading;
                Download = UpdateDownload.Start(Release.Installer);
                Footer.Clear();
                Label words = Ui.Text("Downloading…", "field-hint", "upd-footer__note").Named("update-progress-text");
                VisualElement meter = Ds.Meter(0f, DsState.Info).Named("update-progress");
                VisualElement fill = meter.Q<VisualElement>(className: "ds-meter__fill");
                Footer.Add(words);
                Footer.Add(meter);
                VisualElement buttons = Ds.Row("upd-footer__buttons");
                buttons.Add(Named(Ds.Button("Cancel", () => Download?.Cancel(), DsButtonKind.Ghost), "update-cancel"));
                Footer.Add(buttons);

                ticker?.Pause();
                ticker = Footer.schedule.Execute(() =>
                {
                    UpdateDownload download = Download;
                    if (download == null) return;
                    fill.style.width = Length.Percent(download.Progress * 100f);
                    words.text = $"Downloading… {UpdateFeed.Megabytes(download.BytesSoFar)} of {UpdateFeed.Megabytes(download.Asset?.Size ?? 0)}";
                    if (!download.IsDone) return;
                    ticker?.Pause();
                    if (download.Ok) ShowReady();
                    else ShowFailed(download.Problem, canRetry: true);
                }).Every(100);
            }

            /// <summary>The file is checked: ask to save (a game is open) or just install.</summary>
            public void ShowReady()
            {
                Stage = Stage.Ready;
                Footer.Clear();
                bool gameOpen = GameSession.Current != null;
                Footer.Add(Ui.Text(gameOpen
                        ? "Downloaded and checked. Ringside Booker saves your game, closes, and the installer updates it. Your saves are kept."
                        : "Downloaded and checked. Ringside Booker closes and the installer updates it. Your saves are kept.",
                    "field-hint", "upd-footer__note", "t-wrap").Named("update-ready-text"));
                VisualElement buttons = Ds.Row("upd-footer__buttons");
                buttons.Add(Named(Ds.Button(gameOpen ? "Save and install" : "Install now", () => _ = Install(), DsButtonKind.Primary), "update-install"));
                buttons.Add(Named(Ds.Button("Not now", () => Handle?.Close(), DsButtonKind.Ghost), "update-not-now"));
                Footer.Add(buttons);
            }

            /// <summary>Saves through the game's own save (a manual save), starts the installer, quits.</summary>
            public async Task Install()
            {
                if (Stage == Stage.Installing || Download == null || !Download.Ok) return;
                Stage = Stage.Installing;
                Footer.Clear();
                Label words = Ui.Text(string.Empty, "field-hint", "upd-footer__note").Named("update-installing-text");
                Footer.Add(words);

                GameSession session = GameSession.Current;
                if (session != null)
                {
                    words.text = "Saving your game…";
                    SaveOutcome outcome = await session.SaveNowAsync();
                    if (!outcome.Ok)
                    {
                        ShowFailed($"Your game couldn't be saved ({outcome.Problem}), so nothing was installed.", canRetry: false);
                        return;
                    }
                    Debug.Log($"[Update] saved {session.SlotId} before installing");
                }

                words.text = "Starting the installer…";
                string problem = InstallerLauncher.Launch(Download.FilePath);
                if (problem != null)
                {
                    ShowFailed(problem, canRetry: false);
                    return;
                }
                Debug.Log("[Update] quitting so the installer can update the game");
                SceneFlow.Quit();
            }

            public void ShowFailed(string problem, bool canRetry)
            {
                Stage = Stage.Failed;
                Problem = problem;
                Footer.Clear();
                Footer.Add(Ui.Text(problem, "upd-footer__problem", "t-wrap").Named("update-problem"));
                Footer.Add(Ui.Text("You can download the installer from the release page instead.", "field-hint", "upd-footer__note", "t-wrap"));
                VisualElement buttons = Ds.Row("upd-footer__buttons");
                buttons.Add(Named(Ds.Button("Open the download page", () => UpdateService.OpenDownloadPage(Release), DsButtonKind.Primary), "update-open-page"));
                if (canRetry && Release.Installer != null) buttons.Add(Named(Ds.Button("Try again", StartDownload, DsButtonKind.Ghost), "update-retry"));
                buttons.Add(Named(Ds.Button("Later", () => Handle?.Close(), DsButtonKind.Ghost), "update-later"));
                Footer.Add(buttons);
            }

            private static Button Named(Button button, string name)
            {
                button.name = name;
                return button;
            }
        }
    }
}
