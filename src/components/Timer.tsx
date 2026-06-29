import { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';

const ACTIVE_WORK: string[] = ['creating', 'editing'];

export function formatElapsed(ms: number): string {
  const totalMins = Math.floor(ms / 60_000);
  const days = Math.floor(totalMins / 1440);
  const hours = Math.floor((totalMins % 1440) / 60);
  const mins = totalMins % 60;
  if (days > 0) return `${days}d ${String(hours).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m`;
  if (hours > 0) return `${hours}h ${String(mins).padStart(2, '0')}m`;
  return `${mins}m`;
}

/** Opens a time_entry for batchId+personId if none is open. Returns the entry id. */
export async function openTimeEntry(batchId: string, personId: string, stage: string): Promise<string | null> {
  const { data: existing } = await supabase
    .from('time_entries')
    .select('id')
    .eq('batch_id', batchId)
    .eq('person_id', personId)
    .is('stopped_at', null)
    .maybeSingle();
  if (existing) return existing.id;

  const { data } = await supabase
    .from('time_entries')
    .insert({ batch_id: batchId, person_id: personId, stage })
    .select('id')
    .single();
  return data?.id ?? null;
}

/** Closes all open time_entries for batchId+personId. */
export async function closeTimeEntries(batchId: string, personId: string): Promise<void> {
  await supabase
    .from('time_entries')
    .update({ stopped_at: new Date().toISOString() })
    .eq('batch_id', batchId)
    .eq('person_id', personId)
    .is('stopped_at', null);
}

interface Props {
  batchId: string;
  personId: string;
  /** Current batch status — used to decide whether to tick or freeze. */
  batchStatus: string;
}

/**
 * Shows live elapsed time while the batch is actively being worked (creating/editing).
 * Freezes (shows frozen total) for any other status.
 */
export default function ElapsedTimer({ batchId, personId, batchStatus }: Props) {
  const [ms, setMs] = useState(0);
  const [initialized, setInitialized] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isActive = ACTIVE_WORK.includes(batchStatus);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Sum all closed entries
      const { data: closed } = await supabase
        .from('time_entries')
        .select('started_at, stopped_at')
        .eq('batch_id', batchId)
        .eq('person_id', personId)
        .not('stopped_at', 'is', null);

      const closedMs = (closed ?? []).reduce((acc, e) => {
        return acc + (new Date(e.stopped_at!).getTime() - new Date(e.started_at).getTime());
      }, 0);

      // Find open entry (only meaningful when isActive, but compute regardless for accuracy)
      const { data: open } = await supabase
        .from('time_entries')
        .select('started_at')
        .eq('batch_id', batchId)
        .eq('person_id', personId)
        .is('stopped_at', null)
        .maybeSingle();

      if (cancelled) return;

      const openStart = open ? new Date(open.started_at).getTime() : null;

      if (intervalRef.current) clearInterval(intervalRef.current);

      if (isActive && openStart) {
        // Tick every second while actively working
        intervalRef.current = setInterval(() => {
          setMs(closedMs + (Date.now() - openStart));
        }, 1000);
        setMs(closedMs + (Date.now() - openStart));
      } else {
        // Frozen: show total closed time only
        setMs(closedMs);
      }
      setInitialized(true);
    }

    init();
    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [batchId, personId, batchStatus]);

  if (!initialized || ms === 0) return null;

  return (
    <div className={`flex items-center gap-1.5 text-xs font-mono ${isActive ? 'text-emerald-400' : 'text-slate-500'}`}>
      <Clock size={11} className={isActive ? 'animate-pulse' : ''} />
      <span>{formatElapsed(ms)}</span>
      {!isActive && <span className="text-slate-600 font-sans">total</span>}
    </div>
  );
}
