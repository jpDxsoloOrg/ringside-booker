import { useEffect, useState } from 'react';
import { Switch } from '@/components/Switch';
import { REDUCED_MOTION_ATTRIBUTE } from '@/styles/useReducedMotion';

/**
 * A gallery switch that previews reduced motion by setting the in-game override on `<html>`, the
 * same attribute a motion setting will set. It clears the override when the entry closes, so the
 * rest of the gallery is not left still.
 */
export function ReducedMotionSwitch() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    if (reduced) {
      root.setAttribute(REDUCED_MOTION_ATTRIBUTE, 'on');
    } else {
      root.removeAttribute(REDUCED_MOTION_ATTRIBUTE);
    }
    return () => {
      root.removeAttribute(REDUCED_MOTION_ATTRIBUTE);
    };
  }, [reduced]);

  return (
    <Switch
      label="Reduced motion"
      description="Previews the in-game reduced motion setting for this entry."
      checked={reduced}
      onCheckedChange={setReduced}
    />
  );
}
