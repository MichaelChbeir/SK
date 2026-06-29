import { useEffect, useRef, useState } from 'react';
import { TrendingUp, DollarSign, RefreshCw, ExternalLink, Clock, RotateCcw, Trophy, Skull, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import type { Batch, BatchStatus } from '../../lib/types';
import { STATUS_LABELS } from '../../lib/types';
import StatusBadge from '../../components/StatusBadge';
import { formatElapsed } from '../../components/Timer';

// ─── Performance stage timer hook ────────────────────────────────────────────

interface PerfTimers {
  timeToLaunchMs: number | null;
  timeInTestingMs: number | null;
  timeAliveMs: number | null;
  priorVerdict: 'winner' | 'super_winner' | null;
}

function usePerfTimers(batch: Batch): PerfTimers {
  const [timers, setTimers] = useState<PerfTimers>({ timeToLaunchMs: null, timeInTestingMs: null, timeAliveMs: null, priorVerdict: null });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const { data: events } = await supabase
        .from('status_events')
        .select('to_status, from_status, changed_at')
        .eq('batch_id', batch.id)
        .order('changed_at', { ascending: true });

      if (cancelled) return;
      const evts = events ?? [];

      let approvedAt: number | null = null;
      let testingAt: number | null = null;
      let verdictAt: number | null = null;
      let diedAt: number | null = null;
      let priorToDied: string | null = null;
      let winnerAt: number | null = null;

      for (let i = 0; i < evts.length; i++) {
        const e = evts[i];
        if (e.to_status === 'approved' && approvedAt === null) approvedAt = new Date(e.changed_at).getTime();
        if (e.to_status === 'testing') {
          if (testingAt === null) testingAt = new Date(e.changed_at).getTime();
          if (approvedAt === null && e.from_status === 'approved') approvedAt = new Date(e.changed_at).getTime();
        }
        if ((e.to_status === 'winner' || e.to_status === 'super_winner' || e.to_status === 'loser') && verdictAt === null) {
          verdictAt = new Date(e.changed_at).getTime();
        }
        if (e.to_status === 'winner' || e.to_status === 'super_winner') {
          winnerAt = new Date(e.changed_at).getTime();
        }
        if (e.to_status === 'died') {
          diedAt = new Date(e.changed_at).getTime();
          priorToDied = e.from_status;
        }
      }

      const st = batch.status;
      const timeToLaunchMs = testingAt && approvedAt ? testingAt - approvedAt : null;

      let timeInTestingMs: number | null = null;
      if (testingAt !== null) {
        if (st === 'testing') timeInTestingMs = Date.now() - testingAt;
        else if (verdictAt !== null) timeInTestingMs = verdictAt - testingAt;
      }

      let timeAliveMs: number | null = null;
      if (winnerAt !== null) {
        if (st === 'died' && diedAt !== null) timeAliveMs = diedAt - winnerAt;
        else if (st === 'winner' || st === 'super_winner') timeAliveMs = Date.now() - winnerAt;
      }

      const prior: 'winner' | 'super_winner' | null = priorToDied === 'winner' || priorToDied === 'super_winner' ? priorToDied : null;

      function compute(): PerfTimers {
        const n = Date.now();
        return {
          timeToLaunchMs,
          timeInTestingMs: st === 'testing' && testingAt ? n - testingAt : timeInTestingMs,
          timeAliveMs: (st === 'winner' || st === 'super_winner') && winnerAt ? n - winnerAt : timeAliveMs,
          priorVerdict: prior,
        };
      }

      setTimers(compute());

      if (st === 'testing' || st === 'winner' || st === 'super_winner') {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = setInterval(() => { if (!cancelled) setTimers(compute()); }, 60_000);
      }
    }

    init();
    return () => {
      cancelled = true;
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    };
  }, [batch.id, batch.status]);

  return timers;
}

// ─── BatchDetailPanel ─────────────────────────────────────────────────────────

interface DetailPanelProps {
  batch: Batch;
  isMediaBuyer: boolean;
  onTransition: (b: Batch, newStatus: BatchStatus) => Promise<void>;
  onRefresh: () => void;
}

function BatchDetailPanel({ batch, isMediaBuyer, onTransition, onRefresh }: DetailPanelProps) {
  const [open, setOpen] = useState(false);
  const [spend, setSpend] = useState(String(batch.spend ?? ''));
  const [savingSpend, setSavingSpend] = useState(false);
  const perf = usePerfTimers(batch);
  const st = batch.status;
  const isDied = st === 'died';
  const isAlive = st === 'winner' || st === 'super_winner';
  const isTesting = st === 'testing';
  const canEditSpend = isDied && isMediaBuyer;
  const creativePackageHasData = batch.headlines || batch.primary_texts || (batch.lander_urls ?? []).length > 0;

  async function saveSpend() {
    setSavingSpend(true);
    await supabase.from('batches').update({ spend: parseFloat(spend) || null }).eq('id', batch.id);
    setSavingSpend(false);
    onRefresh();
  }

  return (
    <div className={`bg-slate-800/60 border rounded-xl transition-all ${
      isDied ? 'border-slate-700/30 opacity-75' :
      isAlive ? 'border-lime-700/40' :
      isTesting ? 'border-emerald-700/40' :
      st === 'loser' ? 'border-red-800/30' :
      'border-slate-700/50'
    }`}>
      {/* Header — always visible, click to expand */}
      <div
        className="flex items-start gap-3 p-4 cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-100 truncate">{batch.name}</p>
          <p className="text-xs text-slate-500 mt-0.5">{(batch as any).client?.name ?? '—'}</p>
          {isDied && perf.priorVerdict && (
            <span className="text-xs mt-0.5 block">
              Was:{' '}
              <span className={`font-medium ${perf.priorVerdict === 'super_winner' ? 'text-green-400' : 'text-lime-400'}`}>
                {STATUS_LABELS[perf.priorVerdict]}
              </span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <StatusBadge status={batch.status} />
          {open ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
        </div>
      </div>

      {/* Expanded body */}
      {open && (
        <div className="px-4 pb-4 pt-3 space-y-4 border-t border-slate-700/50">
          {/* Performance timers */}
          <div className="flex flex-wrap gap-4 text-xs font-mono">
            {perf.timeToLaunchMs !== null && (
              <div className="flex items-center gap-1 text-slate-500">
                <Clock size={10} />
                <span className="font-sans text-slate-600 mr-0.5">Time to launch:</span>
                {formatElapsed(perf.timeToLaunchMs)}
              </div>
            )}
            {perf.timeInTestingMs !== null && (
              <div className={`flex items-center gap-1 ${isTesting ? 'text-emerald-400' : 'text-slate-500'}`}>
                <Clock size={10} className={isTesting ? 'animate-pulse' : ''} />
                <span className="font-sans text-slate-600 mr-0.5">In testing:</span>
                {formatElapsed(perf.timeInTestingMs)}
              </div>
            )}
            {perf.timeAliveMs !== null && (
              <div className={`flex items-center gap-1 ${isAlive ? 'text-lime-400' : 'text-slate-500'}`}>
                <Clock size={10} className={isAlive ? 'animate-pulse' : ''} />
                <span className="font-sans text-slate-600 mr-0.5">Time alive:</span>
                {formatElapsed(perf.timeAliveMs)}
              </div>
            )}
          </div>

          {/* Spend */}
          {(isDied || batch.spend != null) && (
            <div>
              <p className="text-xs text-slate-500 mb-1">$ Spend</p>
              {canEditSpend ? (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={spend}
                    onChange={e => setSpend(e.target.value)}
                    placeholder="0.00"
                    className="w-32 px-2 py-1.5 rounded-lg bg-slate-700 border border-slate-600 text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    onClick={saveSpend}
                    disabled={savingSpend}
                    className="px-2 py-1.5 text-xs bg-slate-600 hover:bg-slate-500 text-slate-200 rounded-lg transition-colors disabled:opacity-50"
                  >{savingSpend ? 'Saving…' : 'Save'}</button>
                </div>
              ) : (
                <p className="text-sm font-semibold text-slate-200">{batch.spend != null ? `$${batch.spend}` : '—'}</p>
              )}
            </div>
          )}

          {/* Creative package — read-only */}
          {creativePackageHasData && (
            <div className="space-y-2 border-t border-slate-700/50 pt-3">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Creative Package</p>
              {batch.headlines && (
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">Headlines</p>
                  <p className="text-xs text-slate-300 whitespace-pre-wrap">{batch.headlines}</p>
                </div>
              )}
              {batch.primary_texts && (
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">Primary Texts</p>
                  <p className="text-xs text-slate-300 whitespace-pre-wrap">{batch.primary_texts}</p>
                </div>
              )}
              {(batch.lander_urls ?? []).length > 0 && (
                <div>
                  <p className="text-xs text-slate-500 mb-0.5">Landing Pages</p>
                  <div className="space-y-1">
                    {(batch.lander_urls ?? []).map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 truncate">
                        <ExternalLink size={10} />{url}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          {isMediaBuyer && (
            <div className="flex flex-wrap gap-2 border-t border-slate-700/50 pt-3">
              {st === 'approved' && (
                <button
                  onClick={() => onTransition(batch, 'testing')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-700/30 hover:bg-emerald-700/50 text-emerald-300 border border-emerald-700/30 rounded-lg transition-colors"
                >
                  <TrendingUp size={12} /> Put Live (Testing)
                </button>
              )}
              {st === 'testing' && (<>
                <button
                  onClick={() => onTransition(batch, 'winner')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-lime-900/40 hover:bg-lime-900/60 text-lime-300 border border-lime-800/30 rounded-lg transition-colors"
                >
                  <Trophy size={12} /> Mark Winner
                </button>
                <button
                  onClick={() => onTransition(batch, 'super_winner')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-800/40 hover:bg-green-800/60 text-green-300 border border-green-700/30 rounded-lg transition-colors"
                >
                  <Trophy size={12} /> Mark Super Winner
                </button>
                <button
                  onClick={() => onTransition(batch, 'loser')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-800/30 rounded-lg transition-colors"
                >
                  Mark Loser
                </button>
                <button
                  onClick={() => onTransition(batch, 'approved')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-400 border border-slate-600 rounded-lg transition-colors"
                >
                  <RotateCcw size={11} /> Undo — back to Approved
                </button>
              </>)}
              {(st === 'winner' || st === 'super_winner') && (<>
                <button
                  onClick={() => onTransition(batch, 'died')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-700/60 hover:bg-slate-700 text-slate-300 border border-slate-600 rounded-lg transition-colors"
                >
                  <Skull size={12} /> Mark Died
                </button>
                <button
                  onClick={() => onTransition(batch, 'testing')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-400 border border-slate-600 rounded-lg transition-colors"
                >
                  <RotateCcw size={11} /> Undo verdict — back to Testing
                </button>
              </>)}
              {st === 'loser' && (
                <button
                  onClick={() => onTransition(batch, 'testing')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-400 border border-slate-600 rounded-lg transition-colors"
                >
                  <RotateCcw size={11} /> Undo verdict — back to Testing
                </button>
              )}
              {st === 'died' && perf.priorVerdict && (
                <button
                  onClick={() => onTransition(batch, perf.priorVerdict!)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-400 border border-slate-600 rounded-lg transition-colors"
                >
                  <RotateCcw size={11} /> Undo Died — restore to {STATUS_LABELS[perf.priorVerdict]}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ icon, label, count, color }: { icon: React.ReactNode; label: string; count: number; color: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className={color}>{icon}</span>
      <h2 className={`text-sm font-semibold uppercase tracking-wide ${color}`}>{label}</h2>
      <span className="ml-1 px-2 py-0.5 rounded text-xs bg-slate-800 text-slate-500">{count}</span>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const PERF_STATUSES: BatchStatus[] = ['approved', 'testing', 'winner', 'super_winner', 'loser', 'died'];

export default function MediaBuyerQueue() {
  const { person } = useAuth();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);

  const personRoles: string[] = person?.roles?.length ? person.roles : person?.role ? [person.role] : [];
  const isMediaBuyer = personRoles.includes('media_buyer');
  const isAdminOrManager = personRoles.includes('admin') || personRoles.includes('manager');
  const canSee = isMediaBuyer || isAdminOrManager;

  useEffect(() => { if (canSee) load(); }, []);

  async function load() {
    if (!person) return;
    setLoading(true);

    let query = supabase
      .from('batches')
      .select('*, client:clients(name,we_script), product:products(name)')
      .in('status', PERF_STATUSES)
      .order('current_status_since', { ascending: true });

    // Media buyer (non-admin) sees only their own batches
    if (isMediaBuyer && !isAdminOrManager) {
      query = supabase
        .from('batches')
        .select('*, client:clients(name,we_script), product:products(name)')
        .in('status', PERF_STATUSES)
        .eq('media_buyer_id', person.id)
        .order('current_status_since', { ascending: true });
    }

    const { data } = await query;
    setBatches((data ?? []) as Batch[]);
    setLoading(false);
  }

  async function handleTransition(batch: Batch, newStatus: BatchStatus) {
    if (!person) return;
    const updates: Record<string, any> = { status: newStatus };
    if (newStatus === 'testing' && !batch.media_buyer_id) {
      updates.media_buyer_id = person.id;
    }
    await supabase.from('batches').update(updates).eq('id', batch.id);
    await load();
  }

  if (!canSee) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500 text-sm gap-2">
        <AlertTriangle size={16} />
        Media buyer access required.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        <div className="w-6 h-6 border-2 border-slate-700 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  const approved = batches.filter(b => b.status === 'approved');
  const testing = batches.filter(b => b.status === 'testing');
  const superWinners = batches.filter(b => b.status === 'super_winner');
  const winners = batches.filter(b => b.status === 'winner');
  const losers = batches.filter(b => b.status === 'loser');
  const died = batches.filter(b => b.status === 'died');

  function renderSection(items: Batch[], icon: React.ReactNode, label: string, color: string, emptyMsg?: string) {
    return (
      <section>
        <SectionHeader icon={icon} label={label} count={items.length} color={color} />
        {items.length === 0 && emptyMsg ? (
          <p className="text-sm text-slate-600 italic">{emptyMsg}</p>
        ) : (
          <div className="space-y-2">
            {items.map(b => (
              <BatchDetailPanel
                key={b.id}
                batch={b}
                isMediaBuyer={isMediaBuyer}
                onTransition={handleTransition}
                onRefresh={load}
              />
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Performance Board</h1>
          <p className="text-sm text-slate-500 mt-0.5">Ad testing and campaign outcomes</p>
        </div>
        <button onClick={load} className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors">
          <RefreshCw size={16} />
        </button>
      </div>

      {approved.length > 0 && renderSection(
        approved,
        <TrendingUp size={15} />,
        'Ready to Launch',
        'text-green-400',
      )}

      {renderSection(testing, <Clock size={15} />, 'Testing / Learning', 'text-emerald-400', 'No batches currently in testing.')}
      {renderSection(superWinners, <Trophy size={15} />, 'Super Winners', 'text-green-300', 'No super winners yet.')}
      {renderSection(winners, <Trophy size={15} />, 'Winners', 'text-lime-400', 'No winners yet.')}
      {renderSection(losers, <DollarSign size={15} />, 'Losers', 'text-red-400', 'No losers recorded.')}
      {(died.length > 0 || isAdminOrManager) && renderSection(died, <Skull size={15} />, 'Died', 'text-slate-400', 'No died batches.')}
    </div>
  );
}
