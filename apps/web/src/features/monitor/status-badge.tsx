import { CircleDashed, CircleParking, CirclePause, Navigation, Square, WifiOff, type LucideIcon } from 'lucide-react';
import type { VehicleStatus } from '@gps/shared';
import { cn } from '@/lib/utils';
import { STATUS_META } from './monitor-model';

/** One icon per status: colour is never the only signal (gps-fleet-ui §2). The map markers use the same shapes. */
export const STATUS_ICON: Record<VehicleStatus, LucideIcon> = {
  MOVING: Navigation,
  IDLING: CirclePause,
  PARKED: CircleParking,
  STATIONARY: Square,
  OFFLINE: WifiOff,
  NO_DATA: CircleDashed,
};

export function StatusBadge({ status }: { status: VehicleStatus }) {
  const meta = STATUS_META[status];
  const Icon = STATUS_ICON[status];
  return (
    <span title={meta.hint} className={cn('inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-medium', meta.className)}>
      <Icon className="size-3.5" aria-hidden />
      {meta.label}
    </span>
  );
}
