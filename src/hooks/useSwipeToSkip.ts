import { useCallback, useRef } from "react";
import type { TouchEventHandler } from "react";

type TouchPoint = {
  identifier: number;
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
  cancelSwipeGesture: () => void;
};

export function useSwipeToSkip({
  enabled = true,
  onSwipeLeft,
  minDistance = 80,
  maxVerticalDistance = 80,
}: SwipeToSkipOptions): SwipeToSkipHandlers {
  const startRef = useRef<TouchPoint | null>(null);

  const clearStart = useCallback(() => {
    startRef.current = null;
  }, []);

  return {
    cancelSwipeGesture: clearStart,
    onTouchStart: (event) => {
      if (!enabled || event.touches.length !== 1) {
        clearStart();
        return;
      }

      const touch = event.touches[0];
      startRef.current = {
        identifier: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
      };
    },
    onTouchEnd: (event) => {
      const start = startRef.current;
      clearStart();

      if (!enabled || !start) return;

      let touch: { identifier: number; clientX: number; clientY: number } | null = null;
      for (let index = 0; index < event.changedTouches.length; index += 1) {
        const candidate = event.changedTouches[index];
        if (candidate.identifier === start.identifier) {
          touch = candidate;
          break;
        }
      }
      if (!touch) return;
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
