import { useState } from 'react';
import { Button } from '@/components/Button';
import { Cluster, Stack } from '@/components/layout';
import { NewsAlertSheetView } from '@/screens/news/NewsAlertSheet';
import type { NewsAlertChange, NewsAlertSettings } from '@/screens/news/NewsAlertSheet';
import type { GalleryEntry } from '../galleryEntry';
import { GALLERY_ALERT_SETTINGS } from '../fixtures/news';

type Variant = 'player' | 'refused' | 'noSeat';

const VARIANTS: readonly { readonly id: Variant; readonly label: string }[] = [
  { id: 'player', label: 'A player' },
  { id: 'refused', label: 'A refused save' },
  { id: 'noSeat', label: 'No promotion' },
];

function describeChange(change: NewsAlertChange): string {
  const rules = Object.entries(change.rules).map(([id, on]) => `${id} ${on ? 'on' : 'off'}`);
  if (change.stopSkip !== undefined) rules.push(`stop skips ${change.stopSkip ? 'on' : 'off'}`);
  return `Saved: ${rules.join(', ')}.`;
}

function NewsAlertSheetDemo() {
  const [open, setOpen] = useState<Variant | null>(null);
  const [settings, setSettings] = useState<NewsAlertSettings>(GALLERY_ALERT_SETTINGS);
  const [saved, setSaved] = useState('Nothing saved yet.');
  const save = (change: NewsAlertChange): Promise<readonly string[] | null> => {
    if (open === 'refused') {
      return Promise.resolve(['Only a player can set news alerts']);
    }
    setSettings((current) => ({
      rules: current.rules.map((rule) => ({
        ...rule,
        enabled: change.rules[rule.id] ?? rule.enabled,
      })),
      stopSkip: change.stopSkip ?? current.stopSkip,
    }));
    setSaved(describeChange(change));
    return Promise.resolve(null);
  };
  return (
    <Stack gap={3}>
      <Cluster gap={2}>
        {VARIANTS.map((variant) => (
          <Button
            key={variant.id}
            variant="secondary"
            onClick={() => {
              setOpen(variant.id);
            }}
          >
            {variant.label}
          </Button>
        ))}
      </Cluster>
      <p>{saved}</p>
      <NewsAlertSheetView
        open={open !== null}
        onClose={() => {
          setOpen(null);
        }}
        settings={settings}
        canEdit={open !== 'noSeat'}
        onSave={save}
      />
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'news-alert-sheet',
  title: 'News alerts sheet',
  group: 'Overlays',
  notes:
    'One switch per alert rule from news.alertRules, then "Stop long skips for these stories". ' +
    'Save sends only what changed; a refusal shows its message; without a promotion every switch ' +
    'is off with "Alerts are for players". A side sheet on desktop, a bottom sheet on a phone.',
  render: () => <NewsAlertSheetDemo />,
};
