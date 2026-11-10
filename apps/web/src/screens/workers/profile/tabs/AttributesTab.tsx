import { ATTRIBUTE_GROUP_LABELS, RATING_ROLE_LABELS } from '@ringside/engine';
import type {
  AttributeGroup,
  WorkerProfileAttribute,
  WorkerProfileRoleRating,
} from '@ringside/engine';
import { Badge } from '@/components/Badge';
import { formatNumber } from '@/components/format';
import { VisuallyHidden } from '@/components/layout';
import { Panel } from '@/components/Panel';
import { StatBar } from '@/components/StatBar';
import { Tooltip } from '@/components/Tooltip';
import { ExplainedText } from '../ExplainedText';
import type { ProfileTabContext } from '../profileTabs';
import styles from '../WorkerProfile.module.css';

const GROUP_ORDER: readonly AttributeGroup[] = ['inRing', 'character', 'crew'];

function AttributeRow({ attribute }: { readonly attribute: WorkerProfileAttribute }) {
  return (
    <li className={styles['attributeRow']}>
      <StatBar label={attribute.label} value={Math.round(attribute.value)} />
      <Tooltip content={attribute.gradeReason}>
        {/* A button so the reason can be reached by keyboard and by touch; it does nothing else. */}
        <button type="button" className={styles['gradeChip']}>
          <VisuallyHidden>{attribute.label} grade </VisuallyHidden>
          <Badge tone="data">{attribute.grade}</Badge>
          <VisuallyHidden>: {attribute.gradeReason}</VisuallyHidden>
        </button>
      </Tooltip>
    </li>
  );
}

/** The ratings with the main role first; the rest keep the engine's role order. */
export function mainRoleFirst(
  ratings: readonly WorkerProfileRoleRating[],
  mainRole: WorkerProfileRoleRating['role'],
): readonly WorkerProfileRoleRating[] {
  return [
    ...ratings.filter((rating) => rating.role === mainRole),
    ...ratings.filter((rating) => rating.role !== mainRole),
  ];
}

/** Every attribute as a bar with its grade, then the overall rating in each role. */
export function AttributesTab({ profile }: ProfileTabContext) {
  const { attributes, overall } = profile;

  return (
    <div className={styles['attributes']}>
      <div className={styles['attributeGroups']}>
        {GROUP_ORDER.map((group) => (
          <Panel key={group} title={ATTRIBUTE_GROUP_LABELS[group]} headingLevel={2}>
            <ul className={styles['attributeList']}>
              {attributes[group].map((attribute) => (
                <AttributeRow key={attribute.key} attribute={attribute} />
              ))}
            </ul>
          </Panel>
        ))}
      </div>

      <Panel title="Overall by role" headingLevel={2} padding="none">
        <table className={styles['roleTable']}>
          <thead>
            <tr>
              <th scope="col">Role</th>
              <th scope="col" className={styles['numeric']}>
                Rating
              </th>
              <th scope="col">Grade</th>
            </tr>
          </thead>
          <tbody>
            {mainRoleFirst(overall.byRole, overall.mainRole).map((rating) => {
              const roleLabel = RATING_ROLE_LABELS[rating.role];
              const isMain = rating.role === overall.mainRole;
              return (
                <tr key={rating.role} data-main-role={isMain ? '' : undefined}>
                  <th scope="row">
                    <span className={styles['roleName']}>
                      {roleLabel}
                      {isMain && <Badge tone="prestige">Main role</Badge>}
                    </span>
                  </th>
                  <td className={styles['numeric']}>
                    <ExplainedText
                      label={`${roleLabel} overall`}
                      text={formatNumber(Math.round(rating.value))}
                      trace={rating.trace}
                    />
                  </td>
                  <td>
                    <Badge tone="data">{rating.grade}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
