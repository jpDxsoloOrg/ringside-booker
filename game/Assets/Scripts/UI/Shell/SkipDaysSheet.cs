using System;
using System.Collections.Generic;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Day;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Shell
{
    /// <summary>
    /// Skip several days at once (the web's SkipDaysSheet): a quick choice from
    /// <see cref="SkipTargets"/> or a typed length, and optionally a date to stop on. Shows, decisions
    /// and the news alerts the player turned on always stop a skip; the sheet lists those stops so a
    /// skip that ends early is never a surprise. The last choice is remembered.
    /// </summary>
    public sealed class SkipDaysSheet
    {
        /// <summary>PlayerPrefs key for the last choice: a target id (<c>days.30</c>) or a typed length (<c>45</c>).</summary>
        public const string RememberedChoiceKey = "rb.skipDays.length";
        public const string NewsAlertsStopLabel = "News alerts you've turned on";

        private readonly GameDate today;
        private readonly Action<AdvanceRequest> onStart;
        private readonly IReadOnlyList<(SkipTarget target, SkipTargetChoice choice)> resolved;
        private readonly Sheet sheet;
        private readonly Dictionary<string, Button> chips = new Dictionary<string, Button>();
        private readonly TextField lengthField;
        private readonly Label lengthError;
        private readonly Label preview;
        private readonly Button noExtraStop;
        private readonly Button dateStop;
        private readonly VisualElement stopDateBlock;
        private readonly TextField stopDateField;
        private readonly Label stopDateError;
        private readonly Button startButton;

        private string chosenTargetId;
        private string typedText;
        private bool stopOnDate;
        private bool lengthTouched;

        private SkipDaysSheet(OverlayLayer overlay, GameDate today, Action<AdvanceRequest> onStart, Action onAlertSettings)
        {
            this.today = today;
            this.onStart = onStart;
            resolved = SkipTargets.Resolve(today);
            ReadRememberedChoice();

            sheet = Sheet.Open(overlay, "Skip days", SheetPlacement.Right);
            sheet.Root.name = "skip-days-sheet";
            sheet.Root.RegisterCallback<KeyDownEvent>(OnKeyDown, TrickleDown.TrickleDown);

            // How long.
            VisualElement howLong = Ui.El("fieldset");
            howLong.Add(Ui.Text("How long", "field-label"));
            VisualElement chipRow = Ui.El("chip-row");
            foreach ((SkipTarget target, SkipTargetChoice choice) in resolved)
            {
                string id = target.Id;
                Button chip = Ui.Button(string.Empty, () =>
                {
                    chosenTargetId = id;
                    Refresh();
                }, "choice-chip");
                chip.name = $"skip-target-{id}";
                chip.With(Ui.Text(TextFormat.Upper(target.Label), "choice-chip__label"), Ui.Text(choice.Detail, "choice-chip__detail"));
                chips[id] = chip;
                chipRow.Add(chip);
            }
            howLong.Add(chipRow);

            howLong.Add(Ui.Text("Days to skip", "field-label"));
            lengthField = new TextField { name = "skip-length", maxLength = 5 };
            lengthField.AddToClassList("text-input");
            lengthField.RegisterValueChangedCallback(evt =>
            {
                if (evt.newValue == LengthText()) return;
                typedText = evt.newValue;
                chosenTargetId = null;
                Refresh();
            });
            lengthField.RegisterCallback<FocusOutEvent>(_ =>
            {
                lengthTouched = true;
                Refresh();
            });
            howLong.Add(lengthField);
            lengthError = Ui.Text(SkipTargets.SkipLengthMessage, "field-error");
            howLong.Add(lengthError);
            preview = Ui.Text(string.Empty, "skip-preview");
            howLong.Add(preview);
            sheet.Body.Add(howLong);

            // Always stops.
            VisualElement always = Ui.El("fieldset");
            always.Add(Ui.Text("Always stops", "field-label"));
            always.Add(Ui.Text("A skip always stops for your own shows and for decisions only you can make, so these can't be turned off. It also stops for the news alerts you've turned on.", "field-hint"));
            always.Add(Ui.FixedCheckRow("Stop at my shows"));
            always.Add(Ui.FixedCheckRow("Stop when a decision arrives"));
            VisualElement newsRow = Ui.El("stop-row").With(Ui.FixedCheckRow(NewsAlertsStopLabel));
            if (onAlertSettings != null)
            {
                newsRow.Add(Ui.Btn("Alert settings", () =>
                {
                    sheet.Close();
                    onAlertSettings();
                }, "btn--link"));
            }
            always.Add(newsRow);
            sheet.Body.Add(always);

            // Also stop.
            VisualElement also = Ui.El("fieldset");
            also.Add(Ui.Text("Also stop", "field-label"));
            noExtraStop = ChoiceChip("No extra stop", () => stopOnDate = false);
            dateStop = ChoiceChip("Stop on a date", () => stopOnDate = true);
            also.Add(Ui.El("chip-row").With(noExtraStop, dateStop));
            stopDateBlock = new VisualElement();
            stopDateBlock.Add(Ui.Text("Stop on (YYYY-MM-DD)", "field-label"));
            stopDateField = new TextField { name = "skip-stop-date", maxLength = 10, value = today.AddDays(14).Iso };
            stopDateField.AddToClassList("text-input");
            stopDateField.RegisterValueChangedCallback(_ => Refresh());
            stopDateBlock.Add(stopDateField);
            stopDateError = Ui.Text(string.Empty, "field-error");
            stopDateBlock.Add(stopDateError);
            also.Add(stopDateBlock);
            sheet.Body.Add(also);

            sheet.AddFooterButton("Cancel", sheet.Close, "btn--ghost");
            startButton = sheet.AddFooterButton("» Start", Start, "btn--primary");
            startButton.name = "skip-start";

            Refresh();
        }

        /// <summary>Opens the sheet for <paramref name="today"/>; <paramref name="onStart"/> runs the chosen skip.</summary>
        public static SkipDaysSheet Open(OverlayLayer overlay, GameDate today, Action<AdvanceRequest> onStart, Action onAlertSettings = null) =>
            new SkipDaysSheet(overlay, today, onStart, onAlertSettings);

        private Button ChoiceChip(string text, Action select)
        {
            Button chip = Ui.Button(string.Empty, () =>
            {
                select();
                Refresh();
            }, "choice-chip");
            chip.Add(Ui.Text(TextFormat.Upper(text), "choice-chip__label"));
            return chip;
        }

        private (SkipTarget target, SkipTargetChoice choice)? ChosenTarget()
        {
            if (chosenTargetId == null) return null;
            foreach ((SkipTarget target, SkipTargetChoice choice) entry in resolved)
            {
                if (entry.target.Id == chosenTargetId) return entry;
            }
            return null;
        }

        private string LengthText()
        {
            var chosen = ChosenTarget();
            return chosen.HasValue ? chosen.Value.choice.Request.MaxDays.ToString() : typedText;
        }

        private AdvanceRequest BaseRequest()
        {
            var chosen = ChosenTarget();
            if (chosen.HasValue) return chosen.Value.choice.Request;
            int? days = SkipTargets.ParseSkipLength(typedText);
            return days.HasValue ? new AdvanceRequest(days.Value) : null;
        }

        private bool TryBuildRequest(out AdvanceRequest request, out bool stopReady, out string stopMessage)
        {
            AdvanceRequest baseRequest = BaseRequest();
            stopReady = true;
            stopMessage = null;
            GameDate? extraStop = null;
            if (stopOnDate)
            {
                stopReady = SkipTargets.CheckStopDate(stopDateField.value, today, out GameDate stopAt, out stopMessage);
                if (stopReady) extraStop = stopAt;
            }
            request = SkipTargets.SkipRequest(baseRequest, extraStop);
            return request != null && stopReady;
        }

        private void Refresh()
        {
            foreach (KeyValuePair<string, Button> pair in chips)
            {
                pair.Value.EnableInClassList("choice-chip--selected", pair.Key == chosenTargetId);
            }
            lengthField.SetValueWithoutNotify(LengthText());

            bool canStart = TryBuildRequest(out AdvanceRequest request, out bool _, out string stopMessage);
            bool lengthInvalid = BaseRequest() == null;
            bool showLengthError = lengthInvalid && (lengthTouched || !string.IsNullOrWhiteSpace(typedText));
            lengthError.SetShown(showLengthError);
            lengthField.EnableInClassList("text-input--invalid", showLengthError);
            preview.text = request == null ? "Until —" : $"Until {SkipTargets.SkipUntil(today, request).Long}";

            noExtraStop.EnableInClassList("choice-chip--selected", !stopOnDate);
            dateStop.EnableInClassList("choice-chip--selected", stopOnDate);
            stopDateBlock.SetShown(stopOnDate);
            bool showStopError = stopOnDate && !string.IsNullOrEmpty(stopDateField.value) && stopMessage != null;
            stopDateError.text = stopMessage ?? string.Empty;
            stopDateError.SetShown(showStopError);
            stopDateField.EnableInClassList("text-input--invalid", showStopError);

            startButton.SetEnabled(canStart);
        }

        private void Start()
        {
            lengthTouched = true;
            if (!TryBuildRequest(out AdvanceRequest request, out bool _, out string _))
            {
                Refresh();
                return;
            }
            RememberChoice(ChosenTarget().HasValue ? chosenTargetId : request.MaxDays.ToString());
            sheet.Close();
            onStart(request);
        }

        private void OnKeyDown(KeyDownEvent evt)
        {
            // Enter in a text field submits the form (buttons handle their own Enter).
            var target = evt.target as VisualElement;
            bool inTextField = target is TextField || target?.GetFirstAncestorOfType<TextField>() != null;
            if (inTextField && (evt.keyCode == KeyCode.Return || evt.keyCode == KeyCode.KeypadEnter))
            {
                Start();
                evt.StopPropagation();
            }
        }

        private void ReadRememberedChoice()
        {
            string stored = PlayerPrefs.GetString(RememberedChoiceKey, string.Empty).Trim();
            typedText = SkipTargets.DefaultSkipDays.ToString();
            chosenTargetId = SkipTargets.DefaultTargetId;
            if (stored.Length == 0) return;
            if (SkipTargets.ParseSkipLength(stored).HasValue)
            {
                typedText = stored;
                chosenTargetId = null;
                return;
            }
            // A remembered chip hidden today falls back to the typed length.
            foreach ((SkipTarget target, SkipTargetChoice _) in resolved)
            {
                if (target.Id == stored)
                {
                    chosenTargetId = stored;
                    return;
                }
            }
            chosenTargetId = null;
        }

        private static void RememberChoice(string value)
        {
            PlayerPrefs.SetString(RememberedChoiceKey, value);
            PlayerPrefs.Save();
        }
    }
}
