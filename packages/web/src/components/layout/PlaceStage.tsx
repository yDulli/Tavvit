import React, { useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { usePlaceEntrance } from '../../hooks/usePlaceEntrance';

/** What fills the middle of the window. Moving to another place, it comes up gently. */
export function PlaceStage({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { pathname } = useLocation();
  const stageRef = useRef<HTMLDivElement>(null);
  usePlaceEntrance(stageRef, pathname);
  return <div ref={stageRef} className="flex min-h-0 min-w-0 flex-1">{children}</div>;
}
