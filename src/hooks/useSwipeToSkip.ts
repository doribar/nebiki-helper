import { useRef } from "react";
import type { TouchEventHandler } from "react";

type TouchPoint = {
  x: number;
  y: number;
};

type SwipeToSkipOptions = {
  enabled?: boolean;
  onSwipeLeft: () => void;
  minDistance?: number;
  maxVerticalDistance?: number;
};

export type SwipeToSkipHandlers = {
  onTouchStart: TouchEventHandler<HTMLElement>;
  onTouchEnd: TouchEventHandler<HTMLElement>;
  onTouchCancel: TouchEventHandler<HTMLElement>;
};

export function useSwipeToSkip({
  enabled = true,
  onSwipeLeft,
  minDistance = 80,
  maxVerticalDistance = 80,
}: SwipeToSkipOptions): SwipeToSkipHandlers {
  const startRef = useRef<TouchPoint | null>(null);

  const clearStart = () => {
    startRef.current = null;
  };

  return {
    onTouchStart: (event) => {
      if (!enabled || event.touches.length !== 1) {
        clearStart();
        return;
      }

      const touch = event.touches[0];
      startRef.current = {
        x: touch.clientX,
        y: touch.clientY,
      };
    },
    onTouchEnd: (event) => {
      const start = startRef.current;
      clearStart();

      if (!enabled || !start || event.changedTouches.length !== 1) return;

      const touch = event.changedTouches[0];
      const deltaX = touch.clientX - start.x;
      const deltaY = touch.clientY - start.y;
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);

      const isLeftSwipe =
        deltaX <= -minDistance &&
        absDeltaY <= maxVerticalDistance &&
        absDeltaX >= absDeltaY * 1.4;

      if (isLeftSwipe) {
        onSwipeLeft();
      }
    },
    onTouchCancel: clearStart,
  };
}
