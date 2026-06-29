import { useEffect, useState } from 'react';
import { AlertTriangle, TrendingUp, Users, RefreshCw, Play, Calendar, Activity, Clock } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Batch, Client, Person } from '../../lib/types';
import { formatElapsed } from '../../components/Timer';

const NEEDS_EDITS_LIMIT_MS = 48 * 3_600_000;

function startOfWeek() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString();
}

interface ClientWeekStats {
  client: Client;
  approvedThisWeek: number;
  target: number;
}

interface ActiveWorkItem {
  batch: Batch;
  person: Person;
  elapsedMs: number;
}

export default function CommandCenter() {
  const [needsEdits, setNeedsEdits] = useState<Batch[]>([]);
  const [clientStats, setClientStats] = useState<ClientWeekStats[]>([]);
  const [peopleStats, setPeopleStats] = useState<{ person: Person; inProgress: number; revisions: number }[]>([]);
  const [activeWork, setActiveWork] = useState<ActiveWorkItem[]>([]);
  const [needsEditsRevisionsMs, setNeedsEditsRevisionsMs] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState<string | null>(null);
  const [activeWorkMs, setActiveWorkMs] = useState<Record<string, number>>({});

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    await Promise.all([loadRevisions(), loadClientStats(), loadPeopleStats(), loadActiveWork()]);
    setLoading(false);
  }

  async function loadActiveWork() {
    // Fetch all actively-editing batches
    const { data: batches } = await supabase
      .from('batches')
      .select('*, client:clients(name), current_status_since, creator:people!batches_creator_id_fkey(id,name,role,roles,email,pay_model,base_rate,current_level,current_score,warnings,status,active,created_at), editor:people!batches_editor_id_fkey(id,name,role,roles,email,pay_model,base_rate,current_level,current_score,warnings,status,active,created_at)')
      .in('status', ['creating', 'editing']);

    if (!batches || batches.length === 0) { setActiveWork([]); setActiveWorkMs({}); return; }

    const batchIds = (batches as any[]).map((b: any) => b.id);

    // Compute editing time from status_events: sum all intervals where to_status is an editing status
    const EDITING_STATUSES = new Set(['creating', 'editing', 'in_progress']);

    const { data: allEvents } = await supabase
      .from('status_events')
      .select('batch_id, to_status, changed_at')
      .in('batch_id', batchIds)
      .order('changed_at', { ascending: true });

    const now = Date.now();

    // Group events by batch_id
    const eventsByBatch: Record<string, any[]> = {};
    for (const e of allEvents ?? []) {
      (eventsByBatch[e.batch_id] ??= []).push(e);
    }

    const items: ActiveWorkItem[] = (batches as any[]).map(b => {
      const worker: Person = (b.editor ?? b.creator) as Person;
      if (!worker) return null;

      const evts: any[] = eventsByBatch[b.id] ?? [];
      let editingMs = 0;

      for (let i = 0; i < evts.length; i++) {
        const entered = evts[i].to_status as string;
        if (!EDITING_STATUSES.has(entered)) continue;
        const enteredAt = new Date(evts[i].changed_at).getTime();
        const leftAt = i + 1 < evts.length
          ? new Date(evts[i + 1].changed_at).getTime()
          : null;
        if (leftAt !== null) {
          editingMs += leftAt - enteredAt;
        }
        // open interval — handled below
      }

      // Add the current open interval (batch is currently in creating/editing)
      const openMs = now - new Date(b.current_status_since).getTime();
      editingMs += openMs;

      return { batch: b as Batch, person: worker, elapsedMs: editingMs };
    }).filter(Boolean) as ActiveWorkItem[];

    items.sort((a, b) => b.elapsedMs - a.elapsedMs);
    setActiveWork(items);

    const msMap: Record<string, number> = {};
    for (const item of items) msMap[item.batch.id] = item.elapsedMs;
    setActiveWorkMs(msMap);
  }

  async function loadRevisions() {
    const { data } = await supabase
      .from('batches')
      .select('*, client:clients(name), editor:people!batches_editor_id_fkey(name), creator:people!batches_creator_id_fkey(name)')
      .eq('status', 'needs_edits')
      .order('current_status_since', { ascending: true });
    const batches = (data ?? []) as Batch[];
    setNeedsEdits(batches);

    if (batches.length === 0) { setNeedsEditsRevisionsMs({}); return; }

    // Compute cumulative needs_edits time per batch from status_events
    const batchIds = batches.map(b => b.id);
    const { data: events } = await supabase
      .from('status_events')
      .select('batch_id, to_status, changed_at')
      .in('batch_id', batchIds)
      .order('changed_at', { ascending: true });

    const eventsByBatch: Record<string, any[]> = {};
    for (const e of events ?? []) {
      (eventsByBatch[e.batch_id] ??= []).push(e);
    }

    const now = Date.now();
    const msMap: Record<string, number> = {};

    for (const b of batches) {
      const evts = eventsByBatch[b.id] ?? [];
      let revisionsMs = 0;
      for (let i = 0; i < evts.length; i++) {
        if (evts[i].to_status !== 'needs_edits') continue;
        const enteredAt = new Date(evts[i].changed_at).getTime();
        const leftAt = i + 1 < evts.length ? new Date(evts[i + 1].changed_at).getTime() : null;
        if (leftAt !== null) {
          revisionsMs += leftAt - enteredAt;
        }
        // open interval — add current stint below
      }
      // Add current open needs_edits stint
      revisionsMs += now - new Date(b.current_status_since).getTime();
      msMap[b.id] = revisionsMs;
    }

    setNeedsEditsRevisionsMs(msMap);
  }

  async function loadClientStats() {
    const week = startOfWeek();
    const [{ data: clients }, { data: approvedBatches }] = await Promise.all([
      supabase.from('clients').select('*').eq('active', true).order('name'),
      supabase.from('batches').select('client_id, approved_at').eq('status', 'approved').gte('approved_at', week),
    ]);

    const approvedMap: Record<string, number> = {};
    for (const b of approvedBatches ?? []) {
      if (b.client_id) approvedMap[b.client_id] = (approvedMap[b.client_id] ?? 0) + 1;
    }

    setClientStats((clients ?? []).map(c => ({
      client: c as Client,
      approvedThisWeek: approvedMap[c.id] ?? 0,
      target: c.weekly_target,
    })));
  }

  async function loadPeopleStats() {
    const { data: people } = await supabase.from('people').select('*').eq('active', true);
    if (!people) return;

    const { data: batches } = await supabase
      .from('batches')
      .select('status, editor_id, creator_id, scriptwriter_id, current_status_since')
      .in('status', ['editing', 'creating', 'scripting', 'building_landers', 'needs_edits']);

    const stats = (people as Person[])
      .filter(p => ['editor', 'ai_creator', 'scriptwriter', 'lander_builder'].includes(p.role))
      .map(person => {
        const assignedBatches = (batches ?? []).filter(
          b => b.editor_id === person.id || b.creator_id === person.id || b.scriptwriter_id === person.id
        );
        return {
          person,
          inProgress: assignedBatches.filter(b => b.status !== 'needs_edits').length,
          revisions: assignedBatches.filter(b => b.status === 'needs_edits').length,
        };
      })
      .filter(s => s.inProgress > 0 || s.revisions > 0);

    setPeopleStats(stats);
  }

  async function generateWeeklyOrders() {
    setGenerating(true);
    setGenMsg(null);
    const week = startOfWeek();

    const [{ data: clients }, { data: existingBatches }] = await Promise.all([
      supabase.from('clients').select('*, products(id, name)').eq('active', true).gt('weekly_target', 0),
      supabase.from('batches').select('client_id').eq('status', 'new').gte('created_at', week),
    ]);

    const existingCounts: Record<string, number> = {};
    for (const b of existingBatches ?? []) {
      if (b.client_id) existingCounts[b.client_id] = (existingCounts[b.client_id] ?? 0) + 1;
    }

    let created = 0;
    for (const client of clients ?? []) {
      const existing = existingCounts[client.id] ?? 0;
      const needed = client.weekly_target - existing;
      if (needed <= 0) continue;

      const products = (client as any).products ?? [];
      for (let i = 0; i < needed; i++) {
        const product = products[i % Math.max(products.length, 1)] ?? null;
        const weekStr = new Date().toISOString().slice(0, 10);
        await supabase.from('batches').insert({
          client_id: client.id,
          product_id: product?.id ?? null,
          name: `${client.name} — ${weekStr} #${existing + i + 1}`,
          status: 'new',
        });
        created++;
      }
    }

    setGenMsg(`Generated ${created} new batch${created !== 1 ? 'es' : ''}.`);
    setGenerating(false);
  }

  // Live tick for Active Work elapsed times
  useEffect(() => {
    if (activeWork.length === 0) return;
    const interval = setInterval(() => {
      setActiveWorkMs(prev => {
        const next = { ...prev };
        for (const item of activeWork) next[item.batch.id] = (next[item.batch.id] ?? 0) + 60_000;
        return next;
      });
    }, 60_000);
    return () => clearInterval(interval);
  }, [activeWork]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        <div className="w-6 h-6 border-2 border-slate-700 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-6xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Command Center</h1>
          <p className="text-sm text-slate-500 mt-0.5">Weekly overview & SLA monitor</p>
        </div>
        <div className="flex items-center gap-3">
          {genMsg && <span className="text-xs text-green-400">{genMsg}</span>}
          <button
            onClick={generateWeeklyOrders}
            disabled={generating}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-lg transition-colors disabled:opacity-50"
          >
            <Calendar size={15} />
            {generating ? 'Generating…' : 'Generate Weekly Orders'}
          </button>
          <button
            onClick={load}
            className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Active Work — who is working on what right now */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Activity size={16} className="text-emerald-400" />
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Active Work</h2>
          <span className="ml-2 px-2 py-0.5 rounded text-xs bg-emerald-900/40 text-emerald-300">
            {activeWork.length} in progress
          </span>
        </div>
        {activeWork.length === 0 ? (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-800/40 border border-slate-800 text-slate-500 text-sm">
            <Clock size={16} />
            No batches actively being worked on right now.
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Batch</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Client</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Working</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Elapsed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {activeWork.map(({ batch: b, person: w, elapsedMs: baseMs }) => {
                  const ms = activeWorkMs[b.id] ?? baseMs;
                  const isLong = ms > 8 * 3_600_000;
                  return (
                    <tr key={b.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="px-4 py-3 text-slate-100 font-medium">{b.name}</td>
                      <td className="px-4 py-3 text-slate-400">{(b as any).client?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-400">{w.name}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-mono font-semibold ${isLong ? 'text-red-400' : 'text-emerald-400'}`}>
                          {formatElapsed(ms)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Needs Edits — SLA monitor */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle size={16} className="text-orange-400" />
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">
            Needs-Edits Watch — 48h Limit
          </h2>
          <span className="ml-2 px-2 py-0.5 rounded text-xs bg-orange-900/40 text-orange-300">
            {needsEdits.length} batches
          </span>
          {needsEdits.some(b => (needsEditsRevisionsMs[b.id] ?? 0) >= NEEDS_EDITS_LIMIT_MS) && (
            <span className="ml-1 px-2 py-0.5 rounded text-xs bg-red-900/50 text-red-300 font-semibold">
              {needsEdits.filter(b => (needsEditsRevisionsMs[b.id] ?? 0) >= NEEDS_EDITS_LIMIT_MS).length} OVERDUE
            </span>
          )}
        </div>

        {needsEdits.length === 0 ? (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-green-900/10 border border-green-800/20 text-green-400 text-sm">
            <Play size={16} />
            No batches in needs_edits — all clear!
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Batch</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Client</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Assigned To</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Time Waiting</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">48h Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {needsEdits.map(b => {
                  const revisionsMs = needsEditsRevisionsMs[b.id] ?? (Date.now() - new Date(b.current_status_since).getTime());
                  const msRemaining = NEEDS_EDITS_LIMIT_MS - revisionsMs;
                  const isOverdue = msRemaining <= 0;
                  const assignee = (b as any).editor?.name ?? (b as any).creator?.name ?? '—';

                  return (
                    <tr key={b.id} className={`hover:bg-slate-800/40 transition-colors ${isOverdue ? 'bg-red-950/20' : ''}`}>
                      <td className="px-4 py-3 text-slate-100 font-medium">{b.name}</td>
                      <td className="px-4 py-3 text-slate-400">{(b as any).client?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-400">{assignee}</td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-slate-300">{formatElapsed(revisionsMs)}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isOverdue ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-900/50 border border-red-700/50 text-red-300 text-xs font-bold">
                            <AlertTriangle size={10} />
                            OVERDUE {formatElapsed(Math.abs(msRemaining))} ago
                          </span>
                        ) : (
                          (() => {
                            const totalMins = Math.floor(msRemaining / 60_000);
                            const h = Math.floor(totalMins / 60);
                            const m = totalMins % 60;
                            const str = h > 0 ? `${h}h ${m}m` : `${m}m`;
                            const isUrgent = msRemaining < 4 * 3_600_000;
                            return (
                              <span className={`text-xs font-medium ${isUrgent ? 'text-amber-400' : 'text-slate-500'}`}>
                                {str} left
                              </span>
                            );
                          })()
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Client delivery tracker */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={16} className="text-blue-400" />
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">
            Client Delivery This Week
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {clientStats.length === 0 && (
            <p className="text-sm text-slate-600 col-span-3">No active clients configured.</p>
          )}
          {clientStats.map(({ client, approvedThisWeek, target }) => {
            const pct = target > 0 ? Math.min((approvedThisWeek / target) * 100, 100) : 0;
            const under = pct < 70;
            return (
              <div key={client.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-slate-100 truncate">{client.name}</p>
                  <span className={`text-xs font-medium ${under ? 'text-red-400' : 'text-green-400'}`}>
                    {approvedThisWeek}/{target}
                  </span>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${under ? 'bg-red-500' : 'bg-green-500'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-xs text-slate-600 mt-1.5">
                  {Math.round(pct)}% of weekly target {under && '— behind pace'}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* People in flight */}
      {peopleStats.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Users size={16} className="text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">
              Team In Flight
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {peopleStats.map(({ person, inProgress, revisions }) => (
              <div key={person.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-slate-300 text-sm font-semibold">
                    {person.name[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-100">{person.name}</p>
                    <p className="text-xs text-slate-500 capitalize">{person.role.replace('_', ' ')}</p>
                  </div>
                </div>
                <div className="flex gap-4 mt-1">
                  <div>
                    <p className="text-lg font-bold text-blue-400">{inProgress}</p>
                    <p className="text-xs text-slate-600">in progress</p>
                  </div>
                  {revisions > 0 && (
                    <div>
                      <p className="text-lg font-bold text-orange-400">{revisions}</p>
                      <p className="text-xs text-slate-600">revisions</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
