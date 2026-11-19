using System;
using System.Collections.Generic;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Shell
{
    /// <summary>How an overlay entry behaves.</summary>
    public sealed class OverlayOptions
    {
        /// <summary>Draw a dimming scrim behind the content that blocks the shell. Default true.</summary>
        public bool Modal { get; set; } = true;
        /// <summary>A click on the scrim or Escape closes it. Default true.</summary>
        public bool Dismissable { get; set; } = true;
        /// <summary>Centre the content (dialogs) instead of leaving placement to its own USS (side sheets).</summary>
        public bool Centered { get; set; }
    }

    /// <summary>One open entry in the overlay layer. Close it to remove it.</summary>
    public sealed class OverlayHandle
    {
        private readonly OverlayLayer owner;

        internal OverlayHandle(OverlayLayer owner, VisualElement entry, VisualElement content, OverlayOptions options)
        {
            this.owner = owner;
            Entry = entry;
            Content = content;
            Options = options;
        }

        /// <summary>The full-size entry element (scrim and content) inside the layer.</summary>
        public VisualElement Entry { get; }
        public VisualElement Content { get; }
        public OverlayOptions Options { get; }
        public bool IsOpen { get; internal set; } = true;

        /// <summary>Raised once, after the entry is removed.</summary>
        public event Action Closed;

        public void Close() => owner.Close(this);

        internal void RaiseClosed() => Closed?.Invoke();
    }

    /// <summary>
    /// The root overlay layer: the last child of a screen's root, named <see cref="ElementName"/>, that
    /// every sheet, dialog and panel (the Skip days sheet, the advance progress, UNITY-08's Why?
    /// panels) opens into, stacked in opening order above the shell. Escape closes the top entry
    /// (the shell and title call <see cref="CloseTop"/>). Find it from any element with <see cref="Of"/>.
    /// </summary>
    public sealed class OverlayLayer
    {
        /// <summary>The overlay element's name in Shell.uxml and Title.uxml.</summary>
        public const string ElementName = "overlay-layer";

        private readonly List<OverlayHandle> open = new List<OverlayHandle>();

        public OverlayLayer(VisualElement layer)
        {
            Layer = layer ?? throw new ArgumentNullException(nameof(layer));
            Layer.pickingMode = PickingMode.Ignore;
            Layer.userData = this;
        }

        /// <summary>The layer element itself.</summary>
        public VisualElement Layer { get; }

        public int Count => open.Count;

        /// <summary>Raised after an entry opens or closes.</summary>
        public event Action Changed;

        /// <summary>
        /// The overlay layer of the panel <paramref name="anyElement"/> is in, or null when that panel
        /// has none (or the element is not attached yet).
        /// </summary>
        public static OverlayLayer Of(VisualElement anyElement)
        {
            VisualElement root = anyElement?.panel?.visualTree;
            VisualElement layer = root?.Q<VisualElement>(ElementName);
            return layer?.userData as OverlayLayer;
        }

        /// <summary>Opens <paramref name="content"/> on top of everything open so far.</summary>
        public OverlayHandle Open(VisualElement content, OverlayOptions options = null)
        {
            options ??= new OverlayOptions();
            var entry = new VisualElement { pickingMode = options.Modal ? PickingMode.Position : PickingMode.Ignore };
            entry.AddToClassList("overlay-entry");
            if (options.Centered) entry.AddToClassList("overlay-entry--center");

            var handle = new OverlayHandle(this, entry, content, options);
            if (options.Modal)
            {
                var scrim = new VisualElement();
                scrim.AddToClassList("scrim");
                scrim.RegisterCallback<PointerDownEvent>(evt =>
                {
                    if (handle.Options.Dismissable) handle.Close();
                    evt.StopPropagation();
                });
                entry.Add(scrim);
            }
            entry.Add(content);
            Layer.Add(entry);
            open.Add(handle);

            // Move focus into the new entry so the keyboard works there first.
            content.schedule.Execute(() => FocusFirst(content));
            Changed?.Invoke();
            return handle;
        }

        /// <summary>Closes the topmost dismissable entry. Returns false when there was none.</summary>
        public bool CloseTop()
        {
            for (int index = open.Count - 1; index >= 0; index--)
            {
                if (open[index].Options.Dismissable)
                {
                    Close(open[index]);
                    return true;
                }
            }
            return false;
        }

        public void CloseAll()
        {
            for (int index = open.Count - 1; index >= 0; index--) Close(open[index]);
        }

        internal void Close(OverlayHandle handle)
        {
            if (!handle.IsOpen) return;
            handle.IsOpen = false;
            open.Remove(handle);
            handle.Entry.RemoveFromHierarchy();
            handle.RaiseClosed();
            Changed?.Invoke();
        }

        private static void FocusFirst(VisualElement content)
        {
            Focusable target = null;
            content.Query<VisualElement>().ForEach(element =>
            {
                if (target == null && element.focusable && element.canGrabFocus && element.enabledInHierarchy &&
                    element.resolvedStyle.display != DisplayStyle.None)
                {
                    target = element;
                }
            });
            target?.Focus();
        }
    }
}
