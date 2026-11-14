import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PromotionId, Reason, TitleCardRow } from '@ringside/engine';
import { useAnnounce } from '@/app/a11y/LiveAnnouncer';
import { useEngineCommand } from '@/app/engine/useEngineCommand';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import type { AwardPick } from './AwardTitleSheet';
import {
  createArgsFromForm,
  editArgsFromForm,
  formErrorsFromReasons,
  NO_FORM_ERRORS,
} from './titleForm';
import type { TitleFormErrors, TitleFormValues } from './titleForm';

/** What the player reads when a command never reached the engine. */
export const ENGINE_UNREACHABLE_TEXT = "Couldn't reach the game engine. Try again.";

/** Announced after an edit is saved. */
export const SAVED_TEXT = 'Saved';

/** The sheet or dialog an action opens. */
export type TitleActionKind = 'create' | 'edit' | 'award' | 'vacate' | 'retire' | 'reactivate';

/** The actions a row offers, in menu order: only for a title the player runs. */
export type TitleRowAction = Exclude<TitleActionKind, 'create'>;

/** One row action's open state, one union member per kind so `kind` narrows it. */
type OpenRowAction<K extends TitleRowAction> = K extends TitleRowAction
  ? { readonly kind: K; readonly row: TitleCardRow }
  : never;

/** An open sheet or dialog and the title it is about (none for create). */
export type OpenTitleAction =
  { readonly kind: 'create'; readonly promotionId: PromotionId } | OpenRowAction<TitleRowAction>;

/**
 * Which actions a title offers: none when the viewer can't change it; Reactivate alone when it
 * is retired; else Edit, Award, Vacate (when someone holds it) and Retire.
 */
export function titleRowActions(
  row: Pick<TitleCardRow, 'editable' | 'status' | 'champion'>,
): readonly TitleRowAction[] {
  if (!row.editable) return [];
  if (row.status === 'retired') return ['reactivate'];
  return row.champion === null
    ? ['edit', 'award', 'retire']
    : ['edit', 'award', 'vacate', 'retire'];
}

/** The words on each action's button or menu item. */
export const TITLE_ACTION_LABELS: Readonly<Record<TitleRowAction, string>> = {
  edit: 'Edit',
  award: 'Award',
  vacate: 'Vacate',
  retire: 'Retire',
  reactivate: 'Reactivate',
};

function messagesOf(reasons: readonly Reason[]): string {
  return reasons.map((reason) => reason.message).join(' ');
}

export interface TitleActionsState {
  /** The sheet or dialog showing, or null. */
  readonly current: OpenTitleAction | null;
  /**
   * The last one opened, kept after it closes so a closing sheet keeps its words. Null before
   * anything opened.
   */
  readonly last: OpenTitleAction | null;
  readonly openCreate: () => void;
  readonly openAction: (kind: TitleRowAction, row: TitleCardRow) => void;
  readonly close: () => void;

  /** The form sheet's problems, from the engine or the form's own check. */
  readonly formErrors: TitleFormErrors;
  readonly formPending: boolean;
  readonly submitForm: (values: TitleFormValues) => Promise<void>;

  /** The award sheet's refusal, word for word. */
  readonly awardMessages: readonly string[];
  readonly awardPending: boolean;
  /** The pick waiting for "strip the champion?" to be confirmed, or null. */
  readonly awardToConfirm: AwardPick | null;
  /** Award: straight away for a vacant title, after a confirm when someone holds it. */
  readonly award: (pick: AwardPick) => Promise<void>;
  readonly confirmAward: () => Promise<void>;
  readonly cancelAwardConfirm: () => void;

  /**
   * Vacate, retire or reactivate the open title. Rejects with the engine's words when refused, so
   * the confirm dialog shows them and stays open.
   */
  readonly confirmEndOrReturn: () => Promise<void>;
}

/**
 * Everything the Titles screen and a title's page do to a title: which sheet or confirm is open,
 * the six commands, their refusals and what is announced when they work. One hook, so the card
 * menu and the page's action bar behave the same. `TitleActionOverlays` draws what it opens.
 *
 * Nothing changes on screen before the engine says yes: an applied command moves the world
 * revision on and every mounted query refetches.
 */
export function useTitleActions(): TitleActionsState {
  const navigate = useNavigate();
  const announce = useAnnounce();
  const seatPromotionId = useSessionStore((state) => state.seat?.promotionId ?? null);
  const createCommand = useEngineCommand('titles.create');
  const editCommand = useEngineCommand('titles.edit');
  const awardCommand = useEngineCommand('titles.award');
  const vacateCommand = useEngineCommand('titles.vacate');
  const retireCommand = useEngineCommand('titles.retire');
  const reactivateCommand = useEngineCommand('titles.reactivate');

  const [current, setCurrent] = useState<OpenTitleAction | null>(null);
  const [last, setLast] = useState<OpenTitleAction | null>(null);
  const [formErrors, setFormErrors] = useState<TitleFormErrors>(NO_FORM_ERRORS);
  const [awardMessages, setAwardMessages] = useState<readonly string[]>([]);
  const [awardToConfirm, setAwardToConfirm] = useState<AwardPick | null>(null);

  const show = useCallback((action: OpenTitleAction): void => {
    setFormErrors(NO_FORM_ERRORS);
    setAwardMessages([]);
    setAwardToConfirm(null);
    setCurrent(action);
    setLast(action);
  }, []);

  const openCreate = useCallback((): void => {
    if (seatPromotionId !== null) show({ kind: 'create', promotionId: seatPromotionId });
  }, [seatPromotionId, show]);

  const openAction = useCallback(
    (kind: TitleRowAction, row: TitleCardRow): void => {
      show({ kind, row });
    },
    [show],
  );

  const close = useCallback((): void => {
    setCurrent(null);
    setAwardToConfirm(null);
  }, []);

  const runCreate = createCommand.run;
  const runEdit = editCommand.run;
  const submitForm = useCallback(
    async (values: TitleFormValues): Promise<void> => {
      if (current === null) return;
      if (current.kind === 'create') {
        const built = createArgsFromForm(current.promotionId, values);
        if (!built.ok) {
          setFormErrors(built.errors);
          return;
        }
        try {
          const result = await runCreate(built.args);
          if (!result.ok) {
            setFormErrors(formErrorsFromReasons(result.reasons));
            return;
          }
          setCurrent(null);
          navigate(routes.game.title(result.data.titleId));
        } catch {
          setFormErrors({ fields: {}, general: [ENGINE_UNREACHABLE_TEXT] });
        }
        return;
      }
      if (current.kind !== 'edit') return;
      const built = editArgsFromForm(current.row, values);
      if (!built.ok) {
        setFormErrors(built.errors);
        return;
      }
      try {
        const result = await runEdit(built.args);
        if (!result.ok) {
          setFormErrors(formErrorsFromReasons(result.reasons));
          return;
        }
        setCurrent(null);
        announce(SAVED_TEXT);
      } catch {
        setFormErrors({ fields: {}, general: [ENGINE_UNREACHABLE_TEXT] });
      }
    },
    [current, runCreate, runEdit, navigate, announce],
  );

  const runAward = awardCommand.run;
  const sendAward = useCallback(
    async (pick: AwardPick): Promise<void> => {
      if (current?.kind !== 'award') return;
      const { row } = current;
      setAwardMessages([]);
      try {
        const result = await runAward({
          titleId: row.titleId,
          holderIds: [...pick.holderIds],
          teamId: pick.teamId,
        });
        setAwardToConfirm(null);
        if (!result.ok) {
          setAwardMessages(result.reasons.map((reason) => reason.message));
          return;
        }
        setCurrent(null);
        announce(`Awarded the ${row.name} to ${pick.names}`);
      } catch {
        setAwardToConfirm(null);
        setAwardMessages([ENGINE_UNREACHABLE_TEXT]);
      }
    },
    [current, runAward, announce],
  );

  const award = useCallback(
    async (pick: AwardPick): Promise<void> => {
      if (current?.kind !== 'award') return;
      if (current.row.champion !== null) {
        setAwardToConfirm(pick);
        return;
      }
      await sendAward(pick);
    },
    [current, sendAward],
  );

  const confirmAward = useCallback(async (): Promise<void> => {
    if (awardToConfirm !== null) await sendAward(awardToConfirm);
  }, [awardToConfirm, sendAward]);

  const cancelAwardConfirm = useCallback((): void => {
    setAwardToConfirm(null);
  }, []);

  const runVacate = vacateCommand.run;
  const runRetire = retireCommand.run;
  const runReactivate = reactivateCommand.run;
  const confirmEndOrReturn = useCallback(async (): Promise<void> => {
    if (current === null || current.kind === 'create') return;
    const { row } = current;
    const args = { titleId: row.titleId };
    let refused: readonly Reason[] | null = null;
    let done: string;
    try {
      switch (current.kind) {
        case 'vacate': {
          const result = await runVacate(args);
          if (!result.ok) refused = result.reasons;
          done = `The ${row.name} is vacant`;
          break;
        }
        case 'retire': {
          const result = await runRetire(args);
          if (!result.ok) refused = result.reasons;
          done = `Retired the ${row.name}`;
          break;
        }
        case 'reactivate': {
          const result = await runReactivate(args);
          if (!result.ok) refused = result.reasons;
          done = `The ${row.name} is back, vacant`;
          break;
        }
        case 'edit':
        case 'award':
          return;
      }
    } catch {
      throw new Error(ENGINE_UNREACHABLE_TEXT);
    }
    if (refused !== null) throw new Error(messagesOf(refused));
    setCurrent(null);
    announce(done);
  }, [current, runVacate, runRetire, runReactivate, announce]);

  return {
    current,
    last,
    openCreate,
    openAction,
    close,
    formErrors,
    formPending: createCommand.pending || editCommand.pending,
    submitForm,
    awardMessages,
    awardPending: awardCommand.pending,
    awardToConfirm,
    award,
    confirmAward,
    cancelAwardConfirm,
    confirmEndOrReturn,
  };
}
