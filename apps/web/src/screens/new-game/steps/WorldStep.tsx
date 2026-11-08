import { EmptyState } from '@/components/EmptyState';
import { formatGameDate, formatNumber } from '@/components/format';
import { isGameDate } from '@ringside/engine';
import type { PackManifest } from '@ringside/engine';
import { FieldError } from '../fields/Fields';
import type { PreviewState, WorldListState } from '../useNewGameEngine';
import styles from './Steps.module.css';

export interface WorldStepProps {
  readonly worlds: WorldListState;
  readonly preview: PreviewState;
  readonly rootPackId: string | null;
  readonly onChoose: (rootPackId: string) => void;
  /** The step's problem, such as no world chosen. */
  readonly error: string | undefined;
}

interface WorldCardProps {
  readonly manifest: PackManifest;
  readonly chosen: boolean;
  readonly preview: PreviewState;
  readonly onChoose: (rootPackId: string) => void;
}

/** The promotion and people counts, once the chosen world's preview has loaded. */
function WorldCounts({ manifest, preview }: Pick<WorldCardProps, 'manifest' | 'preview'>) {
  if (preview.status === 'idle' || preview.rootPackId !== manifest.id) {
    return <p className={styles['status']}>Choose this world to see who is in it.</p>;
  }
  switch (preview.status) {
    case 'loading':
      return <p className={styles['status']}>Reading the world…</p>;
    case 'failed':
      return (
        <ul className={styles['issueList']}>
          {preview.issues.map((issue, index) => (
            <li key={`${issue.code}-${String(index)}`}>{issue.message}</li>
          ))}
        </ul>
      );
    case 'error':
      return <p className={styles['status']}>{preview.message}</p>;
    case 'ready':
      return (
        <dl className={styles['facts']}>
          <div className={styles['fact']}>
            <dt className={styles['factLabel']}>Promotions</dt>
            <dd className={styles['factValue']}>
              {formatNumber(preview.preview.promotions.length)}
            </dd>
          </div>
          <div className={styles['fact']}>
            <dt className={styles['factLabel']}>People</dt>
            <dd className={styles['factValue']}>{formatNumber(preview.preview.peopleCount)}</dd>
          </div>
        </dl>
      );
  }
}

function WorldCard({ manifest, chosen, preview, onChoose }: WorldCardProps) {
  const startDate =
    manifest.startDate !== undefined && isGameDate(manifest.startDate)
      ? formatGameDate(manifest.startDate, 'long')
      : null;
  return (
    <li>
      <label className={styles['choiceCard']}>
        <input
          type="radio"
          name="world"
          value={manifest.id}
          checked={chosen}
          onChange={() => {
            onChoose(manifest.id);
          }}
          className={styles['choiceInput']}
        />
        <span className={styles['choiceTitle']}>{manifest.name}</span>
        {manifest.description !== '' && (
          <span className={styles['choiceBody']}>{manifest.description}</span>
        )}
        {startDate !== null && <span className={styles['choiceBody']}>Starts {startDate}</span>}
        <WorldCounts manifest={manifest} preview={preview} />
      </label>
    </li>
  );
}

/**
 * Step 1: the world to start in. One card per bundled world pack; when there is only one it is
 * already chosen. With none bundled, an empty state says how to add one.
 */
export function WorldStep({ worlds, preview, rootPackId, onChoose, error }: WorldStepProps) {
  if (worlds.status === 'loading') {
    return <p className={styles['status']}>Reading the worlds that came with the game…</p>;
  }
  if (worlds.status === 'error') {
    return (
      <EmptyState
        icon="warning"
        title="The worlds could not be read"
        body={`The game engine did not answer: ${worlds.message}`}
      />
    );
  }
  if (worlds.packs.length === 0) {
    return (
      <EmptyState
        icon="layers"
        title="No world to start in"
        body="This build has no world pack. A world pack is a folder under content/worlds with a pack.json of kind “world”; add one and rebuild the game."
      />
    );
  }
  return (
    <div className={styles['step']}>
      <fieldset className={styles['choiceGroup']}>
        <legend className={styles['lead']}>
          The world sets the map, the promotions and everyone in them.
        </legend>
        <ul className={styles['choiceList']}>
          {worlds.packs.map((manifest) => (
            <WorldCard
              key={manifest.id}
              manifest={manifest}
              chosen={manifest.id === rootPackId}
              preview={preview}
              onChoose={onChoose}
            />
          ))}
        </ul>
      </fieldset>
      <FieldError id="world-step-error" message={error} />
      {worlds.issues.length > 0 && (
        <div>
          <p className={styles['status']}>Some bundled packs could not be read and are left out:</p>
          <ul className={styles['issueList']}>
            {worlds.issues.map((issue, index) => (
              <li key={`${issue.packId}-${String(index)}`}>
                {issue.packId}: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
