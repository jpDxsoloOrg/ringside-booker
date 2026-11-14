import type { PersonId } from '@ringside/engine';
import { Badge } from '@/components/Badge';
import { IconButton } from '@/components/Button';
import { DropdownMenu } from '@/components/DropdownMenu';
import type { DropdownMenuEntry } from '@/components/DropdownMenu';
import type { PersonChip } from '@/components/BeatEditor';
import styles from './AngleLab.module.css';

/** A manager as the menu names them. */
export interface ManagerName {
  readonly id: PersonId;
  readonly name: string;
}

export interface ManagerMenuProps {
  readonly person: PersonChip;
  /** The manager on their contract, or null. */
  readonly contractManager: ManagerName | null;
  /**
   * The lab's what-if: a manager, null for "No manager", or undefined to keep the contract's.
   */
  readonly override: ManagerName | null | undefined;
  /** Back to the contract's manager (or none, without one). */
  readonly onUseContract: () => void;
  readonly onNoManager: () => void;
  /** Opens the picker of managers. */
  readonly onChoose: () => void;
}

/** The manager who talks for the person in the lab: the what-if, else the contract's. */
export function effectiveManager(
  contractManager: ManagerName | null,
  override: ManagerName | null | undefined,
): ManagerName | null {
  return override === undefined ? contractManager : override;
}

/**
 * The manager stand-in on a person's chip (MTCH5-05): a menu with the contract's manager, No
 * manager and Choose a manager…, and a small "Mgr: name" badge while someone talks for them. A
 * lab what-if only: no contract changes.
 */
export function ManagerMenu({
  person,
  contractManager,
  override,
  onUseContract,
  onNoManager,
  onChoose,
}: ManagerMenuProps) {
  const manager = effectiveManager(contractManager, override);
  const items: DropdownMenuEntry[] = [
    {
      kind: 'item',
      id: 'contract',
      label:
        contractManager === null
          ? 'Contract manager: none'
          : `Manager: ${contractManager.name} (contract)`,
      onSelect: onUseContract,
      disabled: contractManager === null && override === undefined,
    },
    {
      kind: 'item',
      id: 'none',
      label: 'No manager',
      onSelect: onNoManager,
      disabled: manager === null,
    },
    { kind: 'separator', id: 'separator' },
    { kind: 'item', id: 'choose', label: 'Choose a manager…', onSelect: onChoose },
  ];
  return (
    <span className={styles['manager']}>
      {manager !== null && (
        <Badge tone="data" className={styles['managerBadge']}>
          Mgr: {manager.name}
        </Badge>
      )}
      <DropdownMenu
        trigger={
          <IconButton icon="users" size="sm" variant="ghost" label={`Manager for ${person.name}`} />
        }
        items={items}
      />
    </span>
  );
}
