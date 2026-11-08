import { NavItemContent } from '@/app/AppShell/NavItemContent';
import shellStyles from '@/app/AppShell/AppShell.module.css';
import { NextDaySlot } from '@/app/AppShell/NextDaySlot';
import { shellPreview } from '@/app/AppShell/shellPreview';
import { StatusStrip } from '@/app/AppShell/StatusStrip';
import type { NavBadgeCounts } from '@/app/AppShell/useNavBadges';
import { mobilePrimaryItems, navigationSections, visibleNavigation } from '@/app/navigation';
import type { NavSection } from '@/app/navigation';
import { classNames } from '@/components/classNames';
import { Stack } from '@/components/layout';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

const SAMPLE_BADGES: NavBadgeCounts = { unreadMail: 3, pendingDecisions: 1 };

function SectionList({ section }: { readonly section: NavSection }) {
  return (
    <div className={shellStyles['navSection']}>
      <h4 className={shellStyles['navSectionHeading']}>{section.label}</h4>
      <ul className={shellStyles['navList']}>
        {section.items.map((item) => (
          <li key={item.id} className={shellStyles['navLink']}>
            <NavItemContent item={item} badges={SAMPLE_BADGES} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function PrimaryStrip({ hasPromotion }: { readonly hasPromotion: boolean }) {
  const primaries = mobilePrimaryItems(visibleNavigation(navigationSections, { hasPromotion }));
  return (
    <ul className={shellStyles['bottomNavList']}>
      {primaries.map((item) => (
        <li key={item.id} className={shellStyles['tab']}>
          <NavItemContent item={item} badges={SAMPLE_BADGES} short />
        </li>
      ))}
      <li className={shellStyles['tab']}>More</li>
    </ul>
  );
}

const PREVIEW_STATUS = shellPreview({ hasPromotion: true }).status;

function TopBarDemo() {
  return (
    <Stack gap={3}>
      <h3 className={styles['subheading']}>Top bar end</h3>
      <p className={styles['caption']}>
        The status strip and the Next Day bug, as the desktop bar draws them, then the phone bar.
      </p>
      <div className={classNames(shellStyles['topBarEnd'], styles['topBarStage'])}>
        <StatusStrip status={PREVIEW_STATUS} compact={false} />
        <NextDaySlot compact={false} />
      </div>
      <div className={classNames(shellStyles['topBarEnd'], styles['topBarStage'])}>
        <StatusStrip status={PREVIEW_STATUS} compact />
        <NextDaySlot compact />
      </div>
    </Stack>
  );
}

function NavigationDemo() {
  return (
    <Stack gap={6}>
      <TopBarDemo />
      <Stack gap={3}>
        <h3 className={styles['subheading']}>Sidebar sections</h3>
        <p className={styles['caption']}>
          Every section from navigation.ts, with sample badge counts. Sections marked as needing a
          promotion hide while the player is unemployed.
        </p>
        {navigationSections.map((section) => (
          <SectionList key={section.id} section={section} />
        ))}
      </Stack>
      <Stack gap={3}>
        <h3 className={styles['subheading']}>Phone tab bar</h3>
        <p className={styles['caption']}>Running a promotion</p>
        <PrimaryStrip hasPromotion />
        <p className={styles['caption']}>Unemployed: the promotion tabs fall back</p>
        <PrimaryStrip hasPromotion={false} />
      </Stack>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'app-navigation',
  title: 'App navigation',
  group: 'Primitives',
  notes:
    'The shell itself is at /game after /dev/enter-shell in dev builds. These are its top bar end and nav items as static pieces. The status strip drops popularity, the sample chip, the cash change, then cash, as the bar narrows.',
  render: () => <NavigationDemo />,
};
