import { useEffect, useState } from 'react';
import { Switch } from '@/components/Switch';
import { REDUCED_MOTION_ATTRIBUTE } from '@/styles/useReducedMotion';

/**
 * A gallery switch that previews reduced motion by setting the in-game override on `<html>`, the
 * same attribute the motion setting sets. Turning it off, or closing the entry, puts the player's
 * own setting back, so the rest of the gallery is not left still.
 */
export function ReducedMotionSwitch() {
  const [reduced, setReduced] = useState(false);
  // The player's own motion setting, put back when the preview is off and when the entry closes.
  const [settingOnOpen] = useState(() =>
    document.documentElement.getAttribute(REDUCED_MOTION_ATTRIBUTE),
  );

  useEffect(() => {
    const root = document.documentElement;
    const restoreSetting = () => {
      if (settingOnOpen === null) {
        root.removeAttribute(REDUCED_MOTION_ATTRIBUTE);
      } else {
        root.setAttribute(REDUCED_MOTION_ATTRIBUTE, settingOnOpen);
      }
    };
    if (reduced) {
      root.setAttribute(REDUCED_MOTION_ATTRIBUTE, 'on');
    } else {
      restoreSetting();
    }
    return restoreSetting;
  }, [reduced, settingOnOpen]);

  return (
    <Switch
      label="Reduced motion"
      description="Previews the in-game reduced motion setting for this entry."
      checked={reduced}
      onCheckedChange={setReduced}
    />
  );
}
