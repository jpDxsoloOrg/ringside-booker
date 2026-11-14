import { useState } from 'react';
import type { NewsAlertRuleView } from '@ringside/engine';
import { useEngineCommand } from '@/app/engine/useEngineCommand';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { useHasPromotion } from '@/app/session/sessionStore';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { Switch } from '@/components/Switch';
import styles from './NewsAlertSheet.module.css';

/** The sheet's title, which also names the dialog. */
export const NEWS_ALERT_SHEET_TITLE = 'News alerts';

/** The last switch: whether a waiting alert stops a long skip. */
export const STOP_SKIP_LABEL = 'Stop long skips for these stories';

/** The note under the title. */
export const NEWS_ALERT_NOTE = "Your alerts stop long skips. They don't change the game.";

/** Shown instead of working switches when the seat runs no promotion (or watches the world). */
export const ALERTS_FOR_PLAYERS = 'Alerts are for players';

/** One player's alert settings as `news.alertRules` gives them. */
export interface NewsAlertSettings {
  readonly rules: readonly NewsAlertRuleView[];
  readonly stopSkip: boolean;
}

/** What Save sends to `news.setAlertRules`: only the switches the player changed. */
export interface NewsAlertChange {
  readonly rules: Record<string, boolean>;
  readonly stopSkip?: boolean;
}

/** The switches the player moved, against the saved settings. */
interface AlertDraft {
  readonly rules: Readonly<Record<string, boolean>>;
  readonly stopSkip: boolean | null;
}

const NO_DRAFT: AlertDraft = { rules: {}, stopSkip: null };

/**
 * The change from `saved` to the switches as they stand, keeping only the ones that differ, or
 * null when nothing differs.
 */
export function alertSettingsChange(
  saved: NewsAlertSettings,
  draft: AlertDraft,
): NewsAlertChange | null {
  const rules: Record<string, boolean> = {};
  for (const rule of saved.rules) {
    const wanted = draft.rules[rule.id];
    if (wanted !== undefined && wanted !== rule.enabled) rules[rule.id] = wanted;
  }
  const stopSkip =
    draft.stopSkip !== null && draft.stopSkip !== saved.stopSkip ? draft.stopSkip : null;
  if (Object.keys(rules).length === 0 && stopSkip === null) return null;
  return stopSkip === null ? { rules } : { rules, stopSkip };
}

export interface NewsAlertSheetViewProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The saved settings, or null while they load. */
  readonly settings: NewsAlertSettings | null;
  /** Why the settings could not be read, if they could not. */
  readonly loadError?: string | null;
  /** False for a seat with no promotion: the switches show but cannot move. */
  readonly canEdit: boolean;
  /**
   * Saves the change. Resolves with the refusal's messages, or null once it is saved (the sheet
   * then closes).
   */
  readonly onSave: (change: NewsAlertChange) => Promise<readonly string[] | null>;
}

/**
 * The alert settings without the engine, for the gallery and tests: one switch per rule (its label
 * and what it catches), then "Stop long skips for these stories". Save sends only what changed;
 * Cancel and Close drop the changes. A side sheet on desktop and a bottom sheet on a phone.
 */
export function NewsAlertSheetView({
  open,
  onClose,
  settings,
  loadError = null,
  canEdit,
  onSave,
}: NewsAlertSheetViewProps) {
  const [draft, setDraft] = useState<AlertDraft>(NO_DRAFT);
  const [errors, setErrors] = useState<readonly string[]>([]);
  const [saving, setSaving] = useState(false);
  // Every opening starts from the saved settings.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDraft(NO_DRAFT);
      setErrors([]);
    }
  }

  const change = settings === null ? null : alertSettingsChange(settings, draft);
  const disabled = !canEdit || settings === null || saving;

  const save = async (): Promise<void> => {
    if (change === null) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const refusals = await onSave(change);
      if (refusals === null) {
        onClose();
      } else {
        setErrors(refusals);
      }
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'The alerts could not be saved.']);
    } finally {
      setSaving(false);
    }
  };

  const ruleOn = (rule: NewsAlertRuleView): boolean => draft.rules[rule.id] ?? rule.enabled;
  const stopSkipOn = draft.stopSkip ?? settings?.stopSkip ?? true;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={NEWS_ALERT_SHEET_TITLE}
      side="right"
      size="sm"
      footer={
        <div className={styles['footer']}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={!canEdit || settings === null}
            onClick={() => {
              void save();
            }}
          >
            Save
          </Button>
        </div>
      }
    >
      {/*
        Without a seat every switch is off, so nothing in the body takes focus. The body is then
        a focusable group, so a keyboard can still scroll it on a short phone screen.
      */}
      <div
        className={styles['body']}
        {...(canEdit ? {} : { role: 'group', 'aria-label': 'Your alerts', tabIndex: 0 })}
      >
        <p className={styles['note']}>{NEWS_ALERT_NOTE}</p>
        {!canEdit && (
          <p className={styles['notice']} role="note">
            {ALERTS_FOR_PLAYERS}
          </p>
        )}
        {loadError !== null && (
          <p className={styles['error']} role="alert">
            {loadError}
          </p>
        )}
        {settings === null && loadError === null && (
          <p className={styles['note']} role="status">
            Loading your alerts…
          </p>
        )}
        {settings !== null && (
          <>
            <fieldset className={styles['group']}>
              <legend className={styles['legend']}>Tell me about</legend>
              {settings.rules.map((rule) => (
                <Switch
                  key={rule.id}
                  label={rule.label}
                  description={rule.description}
                  checked={ruleOn(rule)}
                  disabled={disabled}
                  onCheckedChange={(checked) => {
                    setDraft((current) => ({
                      ...current,
                      rules: { ...current.rules, [rule.id]: checked },
                    }));
                  }}
                />
              ))}
            </fieldset>
            <div className={styles['stopSkip']}>
              <Switch
                label={STOP_SKIP_LABEL}
                description="The day button turns into Open news until you read the story."
                checked={stopSkipOn}
                disabled={disabled}
                onCheckedChange={(checked) => {
                  setDraft((current) => ({ ...current, stopSkip: checked }));
                }}
              />
            </div>
          </>
        )}
        {errors.length > 0 && (
          <ul className={styles['errors']} role="alert">
            {errors.map((message) => (
              <li key={message} className={styles['error']}>
                {message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

const NO_ARGS = {} as const;

export interface NewsAlertSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

/**
 * The News alerts sheet for the local seat: reads `news.alertRules` while open and saves with
 * `news.setAlertRules`. Opened from the News screen's Alerts button and the Skip days sheet.
 */
export function NewsAlertSheet({ open, onClose }: NewsAlertSheetProps) {
  const canEdit = useHasPromotion();
  const query = useEngineQuery('news.alertRules', NO_ARGS, { enabled: open });
  const setRules = useEngineCommand('news.setAlertRules');
  const settings: NewsAlertSettings | null =
    query.data === undefined ? null : { rules: query.data.rules, stopSkip: query.data.stopSkip };
  let loadError: string | null = null;
  if (query.status === 'error' && query.error !== null) {
    loadError =
      query.error.kind === 'transport'
        ? query.error.message
        : query.error.reasons.map((reason) => reason.message).join(' ');
  }

  const save = async (change: NewsAlertChange): Promise<readonly string[] | null> => {
    const result = await setRules.run(
      change.stopSkip === undefined
        ? { rules: change.rules }
        : { rules: change.rules, stopSkip: change.stopSkip },
    );
    return result.ok ? null : result.reasons.map((reason) => reason.message);
  };

  return (
    <NewsAlertSheetView
      open={open}
      onClose={onClose}
      settings={settings}
      loadError={loadError}
      canEdit={canEdit}
      onSave={save}
    />
  );
}
