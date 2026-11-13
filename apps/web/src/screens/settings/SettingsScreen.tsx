import { useId, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cents, CURRENT_FORMAT_VERSION } from '@ringside/engine';
import { RouteHeading } from '@/app/a11y/RouteHeading';
import { useDocumentTitle } from '@/app/a11y/useDocumentTitle';
import { returnsToGame, settingsReturnPath } from '@/app/settings/settingsNavigation';
import { effectiveThemePreference } from '@/app/settings/SettingsEffects';
import { UI_SCALE_STEP, snapUiScale } from '@/app/settings/settingsSchema';
import type { ReducedMotionPreference } from '@/app/settings/settingsSchema';
import { useSettingsStore } from '@/app/settings/settingsStore';
import { Button, IconButton } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatMoney } from '@/components/format';
import type { MoneyStyle } from '@/components/format';
import { Icon } from '@/components/Icon';
import { Panel } from '@/components/Panel';
import { RadioGroup } from '@/components/RadioGroup';
import type { RadioOption } from '@/components/RadioGroup';
import { Switch } from '@/components/Switch';
import {
  clampUiScale,
  resolveTheme,
  SELECTABLE_THEME_PREFERENCES,
  UI_SCALE_DEFAULT,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
} from '@/styles/theme';
import type { ThemePreference } from '@/styles/theme';
import styles from './SettingsScreen.module.css';
import { useEngineVersion } from './useEngineVersion';
import type { EngineVersionState } from './useEngineVersion';

/** The amount the money style examples show: 1,234,567 dollars. */
const MONEY_EXAMPLE = cents(123_456_700);

/** Shown in About when this browser will not keep the settings. */
export const SETTINGS_NOT_REMEMBERED_NOTE = "Settings won't be remembered in this browser.";

const THEME_LABELS: Readonly<Record<ThemePreference, string>> = {
  system: 'Match device',
  light: 'Light',
  dark: 'Dark',
};

function ThemeSwatch({ preference }: { readonly preference: ThemePreference }) {
  // Each swatch carries the theme it previews as `data-theme`, so the tokens inside it resolve to
  // that theme's colours. "Match device" shows both.
  const previewThemes =
    preference === 'system'
      ? [resolveTheme('system', false), resolveTheme('system', true)]
      : [resolveTheme(preference, true)];
  return (
    <span className={styles['swatchGroup']}>
      {previewThemes.map((theme, index) => (
        <span key={`${theme}-${String(index)}`} className={styles['swatch']} data-theme={theme}>
          <span className={styles['swatchSurface']} />
          <span className={styles['swatchAccent']} />
        </span>
      ))}
    </span>
  );
}

const themeOptions: readonly RadioOption<ThemePreference>[] = SELECTABLE_THEME_PREFERENCES.map(
  (preference) => ({
    value: preference,
    label: THEME_LABELS[preference],
    preview: <ThemeSwatch preference={preference} />,
  }),
);

const motionOptions: readonly RadioOption<ReducedMotionPreference>[] = [
  {
    value: 'system',
    label: 'Match device',
    description: 'Follow the reduced motion setting of this device.',
  },
  {
    value: 'on',
    label: 'Reduce motion',
    description: 'No pulses, crawls or animated meters, whatever the device says.',
  },
  {
    value: 'off',
    label: 'Full motion',
    description: 'Keep the animations even when the device asks for less.',
  },
];

const moneyOptions: readonly RadioOption<MoneyStyle>[] = [
  {
    value: 'compact',
    label: 'Compact',
    description: formatMoney(MONEY_EXAMPLE, { style: 'compact' }),
  },
  {
    value: 'full',
    label: 'Full',
    description: formatMoney(MONEY_EXAMPLE, { style: 'full' }),
  },
];

function formatScalePercent(scale: number): string {
  return `${String(Math.round(scale * 100))}%`;
}

function engineVersionText(state: EngineVersionState): string {
  switch (state.kind) {
    case 'checking':
      return 'Checking…';
    case 'known':
      return state.engineVersion;
    case 'unavailable':
      return 'Not available';
  }
}

function UiScaleControl() {
  const uiScale = useSettingsStore((state) => state.settings.uiScale);
  const update = useSettingsStore((state) => state.update);
  const sliderId = useId();
  const hintId = useId();
  const percent = formatScalePercent(uiScale);

  const setScale = (scale: number) => {
    update({ uiScale: snapUiScale(clampUiScale(scale)) });
  };

  return (
    <div className={styles['scale']}>
      <div className={styles['scaleHeader']}>
        <label htmlFor={sliderId} className={styles['fieldLabel']}>
          UI scale
        </label>
        <output htmlFor={sliderId} className={styles['scaleValue']} aria-live="polite">
          {percent}
        </output>
      </div>
      <p id={hintId} className={styles['fieldHint']}>
        Makes text and controls larger or smaller. The layout stays the same.
      </p>
      <div className={styles['scaleRow']}>
        <IconButton
          icon="decrease"
          label="Decrease UI scale"
          variant="secondary"
          disabled={uiScale <= UI_SCALE_MIN}
          onClick={() => {
            setScale(uiScale - UI_SCALE_STEP);
          }}
        />
        <input
          id={sliderId}
          type="range"
          className={styles['slider']}
          min={UI_SCALE_MIN}
          max={UI_SCALE_MAX}
          step={UI_SCALE_STEP}
          value={uiScale}
          aria-valuetext={percent}
          aria-describedby={hintId}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            setScale(Number(event.target.value));
          }}
        />
        <IconButton
          icon="add"
          label="Increase UI scale"
          variant="secondary"
          disabled={uiScale >= UI_SCALE_MAX}
          onClick={() => {
            setScale(uiScale + UI_SCALE_STEP);
          }}
        />
      </div>
      <div>
        <Button
          size="sm"
          variant="ghost"
          iconStart="reset"
          disabled={uiScale === UI_SCALE_DEFAULT}
          onClick={() => {
            setScale(UI_SCALE_DEFAULT);
          }}
        >
          Reset scale
        </Button>
      </div>
    </div>
  );
}

/**
 * The viewer's preferences: UI scale, motion and how money is shown, plus versions. Everything
 * applies the moment it changes; there is no Save button. Preferences belong to this browser and
 * are never written into a save. The theme choice appears once a second theme ships (D-11).
 */
export function SettingsScreen() {
  useDocumentTitle('Settings');
  const location = useLocation();
  const returnPath = settingsReturnPath(location.state);
  const settings = useSettingsStore((state) => state.settings);
  const persistence = useSettingsStore((state) => state.persistence);
  const update = useSettingsStore((state) => state.update);
  const reset = useSettingsStore((state) => state.reset);
  const engineVersion = useEngineVersion();
  const [confirmingReset, setConfirmingReset] = useState(false);
  const showThemeChoice = themeOptions.length > 1;

  return (
    <div className={styles['screen']}>
      <Link to={returnPath} className={styles['backLink']}>
        <Icon name="back" size="sm" decorative />
        {returnsToGame(returnPath) ? 'Back to game' : 'Back'}
      </Link>
      <RouteHeading className={styles['heading']}>Settings</RouteHeading>
      <p className={styles['intro']}>
        These belong to this browser and apply straight away. They are not part of your saves.
      </p>

      <Panel title="Appearance">
        <div className={styles['panelBody']}>
          {showThemeChoice && (
            <RadioGroup
              legend="Theme"
              options={themeOptions}
              value={effectiveThemePreference(settings.theme)}
              layout="row"
              onValueChange={(theme) => {
                update({ theme });
              }}
            />
          )}
          <UiScaleControl />
        </div>
      </Panel>

      <Panel title="Motion">
        <RadioGroup
          legend="Animations"
          options={motionOptions}
          value={settings.reducedMotion}
          onValueChange={(reducedMotion) => {
            update({ reducedMotion });
          }}
        />
      </Panel>

      <Panel title="Numbers">
        <RadioGroup
          legend="Money"
          description="How amounts of money are written across the game."
          options={moneyOptions}
          value={settings.moneyStyle}
          layout="row"
          onValueChange={(moneyStyle) => {
            update({ moneyStyle });
          }}
        />
      </Panel>

      <Panel title="Show nights">
        <div className={styles['panelBody']}>
          <Switch
            label="After a show, open its results"
            description="When a Next Day or a skip runs one of your shows, go straight to its results page and play the reveal. Off, the day summary only links to them. Running a show yourself always opens its results."
            checked={settings.openResultsAfterShow}
            onCheckedChange={(openResultsAfterShow) => {
              update({ openResultsAfterShow });
            }}
          />
          <Switch
            label="Reveal results one segment at a time"
            description="A show's results come out one segment per tap of Next segment, then the score. Show all brings everything out at once. Off, the results open with everything showing."
            checked={settings.revealOneAtATime}
            onCheckedChange={(revealOneAtATime) => {
              update({ revealOneAtATime });
            }}
          />
        </div>
      </Panel>

      <Panel title="About">
        <div className={styles['panelBody']}>
          <dl className={styles['facts']}>
            <div className={styles['fact']}>
              <dt>App version</dt>
              <dd>{__APP_VERSION__}</dd>
            </div>
            <div className={styles['fact']}>
              <dt>Engine version</dt>
              <dd>{engineVersionText(engineVersion)}</dd>
            </div>
            <div className={styles['fact']}>
              <dt>Save format</dt>
              <dd>Version {String(CURRENT_FORMAT_VERSION)}</dd>
            </div>
          </dl>
          {persistence === 'unavailable' && (
            <p className={styles['notice']}>
              <Icon name="warning" size="sm" decorative />
              <span>{SETTINGS_NOT_REMEMBERED_NOTE}</span>
            </p>
          )}
        </div>
      </Panel>

      <div className={styles['resetRow']}>
        <Button
          variant="danger"
          iconStart="reset"
          onClick={() => {
            setConfirmingReset(true);
          }}
        >
          Reset all settings
        </Button>
      </div>

      <ConfirmDialog
        open={confirmingReset}
        onClose={() => {
          setConfirmingReset(false);
        }}
        onConfirm={reset}
        title="Reset all settings?"
        body="UI scale, motion and money go back to their defaults. Your saves are not touched."
        confirmLabel="Reset settings"
        tone="danger"
      />
    </div>
  );
}
