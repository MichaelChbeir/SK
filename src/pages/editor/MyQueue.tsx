import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Clock, CheckCircle, Ban, Layers, ExternalLink, FileText, Star, ThumbsDown, ThumbsUp, X, RotateCcw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import type { Batch, BatchFormat, BatchStatus } from '../../lib/types';
import { FORMAT_LABELS, ALL_FORMATS, STATUS_LABELS } from '../../lib/types';
import StatusBadge from '../../components/StatusBadge';
import { openTimeEntry, formatElapsed } from '../../components/Timer';
import Modal from '../../components/Modal';

function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function ageColor(days: number) {
  if (days >= 3) return 'text-red-400';
  if (days === 2) return 'text-orange-400';
  if (days === 1) return 'text-amber-400';
  return 'text-slate-400';
}

const IN_PROGRESS_STATUSES: BatchStatus[] = ['ready_to_create', 'ready_to_edit', 'creating', 'editing'];
const DONE_STATUSES: BatchStatus[] = ['approved', 'testing', 'loser', 'winner', 'super_winner', 'died', 'iterating'];
const ACTIVE_WORK: BatchStatus[] = ['creating', 'editing'];

// Editing stage covers active-work statuses
const EDITING_STATUSES = new Set(['creating', 'editing', 'in_progress']);
const REVIEW_STATUSES = new Set(['in_review']);
const REVISION_STATUSES = new Set(['needs_edits']);

/** Prepend https:// if the user omitted the scheme. */
function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

// ─── 48-hour needs-edits countdown (cumulative budget) ───────────────────────

const NEEDS_EDITS_LIMIT_MS = 48 * 3_600_000; // 48 hours

/**
 * Renders the remaining budget from the 48h cumulative needs-edits limit.
 * revisionsMs = total time ever spent in needs_edits (from useStageTimers).
 * isActive    = batch is currently in needs_edits (so the clock is ticking).
 */
function NeedsEditsCountdown({ revisionsMs, isActive }: { revisionsMs: number; isActive: boolean }) {
  const msRemaining = NEEDS_EDITS_LIMIT_MS - revisionsMs;
  const isOverdue = msRemaining <= 0;

  if (isOverdue) {
    const overdueMs = Math.abs(msRemaining);
    const overdueHours = Math.floor(overdueMs / 3_600_000);
    const overdueMins = Math.floor((overdueMs % 3_600_000) / 60_000);
    const overdueStr = overdueHours > 0 ? `${overdueHours}h ${overdueMins}m` : `${overdueMins}m`;
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-900/40 border border-red-700/40 text-red-300 text-xs font-semibold">
        <AlertTriangle size={10} />
        OVERDUE — {overdueStr} past 48h limit
      </span>
    );
  }

  const totalMins = Math.floor(msRemaining / 60_000);
  const hoursLeft = Math.floor(totalMins / 60);
  const minsLeft = totalMins % 60;
  const countdownStr = hoursLeft > 0 ? `${hoursLeft}h ${minsLeft}m` : `${minsLeft}m`;
  const isUrgent = msRemaining < 4 * 3_600_000;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs ${
      isUrgent
        ? 'bg-amber-900/30 border-amber-700/40 text-amber-300'
        : 'bg-slate-800 border-slate-700 text-slate-400'
    }`}>
      <Clock size={10} className={isActive ? 'animate-pulse' : ''} />
      {countdownStr} left before 48h limit{!isActive ? ' (paused)' : ''}
    </span>
  );
}

// ─── Per-stage timer hook ─────────────────────────────────────────────────────

interface StageTotals {
  editingMs: number;    // time in creating/editing
  reviewMs: number;     // time in in_review
  revisionsMs: number;  // time in needs_edits
}

/**
 * Computes per-stage time from the status_events log.
 * Only ticks the interval for the CURRENT status.
 */
function useStageTimers(batchId: string, currentStatus: string, currentStatusSince: string): StageTotals {
  const [totals, setTotals] = useState<StageTotals>({ editingMs: 0, reviewMs: 0, revisionsMs: 0 });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Store the base (historical) totals so we only add the live open interval on top
  const baseRef = useRef<StageTotals>({ editingMs: 0, reviewMs: 0, revisionsMs: 0 });
  const currentSinceRef = useRef(currentStatusSince);

  useEffect(() => {
    currentSinceRef.current = currentStatusSince;
  }, [currentStatusSince]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Fetch all status_events for this batch ordered by time
      const { data: events } = await supabase
        .from('status_events')
        .select('to_status, from_status, changed_at')
        .eq('batch_id', batchId)
        .order('changed_at', { ascending: true });

      if (cancelled) return;

      // Build intervals: for each event that ENTERED a status, the time spent there
      // = (next event's changed_at) - (this event's changed_at).
      // The current open interval is handled separately via live tick.
      const base: StageTotals = { editingMs: 0, reviewMs: 0, revisionsMs: 0 };
      const evts = events ?? [];

      for (let i = 0; i < evts.length; i++) {
        const entered = evts[i].to_status as string;
        const enteredAt = new Date(evts[i].changed_at).getTime();
        // The interval in this status ends when the NEXT event fires
        const leftAt = i + 1 < evts.length
          ? new Date(evts[i + 1].changed_at).getTime()
          : null; // still current — handled below

        if (leftAt === null) break; // open interval, will be covered by live tick

        const ms = leftAt - enteredAt;
        if (EDITING_STATUSES.has(entered)) base.editingMs += ms;
        else if (REVIEW_STATUSES.has(entered)) base.reviewMs += ms;
        else if (REVISION_STATUSES.has(entered)) base.revisionsMs += ms;
      }

      baseRef.current = base;

      function computeTotals(): StageTotals {
        const now = Date.now();
        const openMs = now - new Date(currentSinceRef.current).getTime();
        const cur = currentStatus;
        return {
          editingMs: base.editingMs + (EDITING_STATUSES.has(cur) ? openMs : 0),
          reviewMs: base.reviewMs + (REVIEW_STATUSES.has(cur) ? openMs : 0),
          revisionsMs: base.revisionsMs + (REVISION_STATUSES.has(cur) ? openMs : 0),
        };
      }

      setTotals(computeTotals());

      // Tick only if current status is one we track
      const shouldTick = EDITING_STATUSES.has(currentStatus) || REVIEW_STATUSES.has(currentStatus) || REVISION_STATUSES.has(currentStatus);
      if (shouldTick) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = setInterval(() => {
          if (!cancelled) setTotals(computeTotals());
        }, 10_000); // update every 10s — sufficient for day+hour+min display
      }
    }

    init();
    return () => {
      cancelled = true;
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    };
  }, [batchId, currentStatus]);

  return totals;
}

interface InlineEdit {
  format: BatchFormat | '';
  mins: string;
  secs: string;
  hooks: string;
  brief_url: string;
  creative_url: string;
  headlines: string;
  primary_texts: string;
  lander_urls: string[];
}

// ─── Work View ────────────────────────────────────────────────────────────────

interface WorkViewProps {
  batch: Batch;
  personId: string;
  personRoles: string[];
  onClose: () => void;
  onSaved: (updated: Batch) => void;
  onStatusChange: () => void;
}

function WorkView({ batch: initialBatch, personId, personRoles, onClose, onSaved, onStatusChange }: WorkViewProps) {
  const [batch, setBatch] = useState(initialBatch);
  const [edit, setEdit] = useState<InlineEdit>(() => {
    const raw = initialBatch.minutes ?? 0;
    const wholeMins = Math.floor(raw);
    const wholeSecs = Math.round((raw - wholeMins) * 60);
    return {
      format: initialBatch.format ?? '',
      mins: wholeMins > 0 ? String(wholeMins) : '',
      secs: wholeSecs > 0 ? String(wholeSecs) : '',
      hooks: String(initialBatch.hooks ?? ''),
      brief_url: initialBatch.brief_url ?? '',
      creative_url: initialBatch.creative_url ?? '',
      headlines: initialBatch.headlines ?? '',
      primary_texts: initialBatch.primary_texts ?? '',
      lander_urls: initialBatch.lander_urls ?? [],
    };
  });
  const [saving, setSaving] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);

  const stageTotals = useStageTimers(batch.id, batch.status, batch.current_status_since);

  const isCreatorOrEditor = batch.creator_id === personId || batch.editor_id === personId;
  // NOTE: QC actions are intentionally NOT in My Queue — they live only in QC Queue.
  const isMediaBuyer = batch.media_buyer_id === personId || personRoles.includes('media_buyer');
  const isScriptwriter = personRoles.includes('scriptwriter') && batch.scriptwriter_id === personId;
  const isAdminOrManager = personRoles.includes('admin') || personRoles.includes('manager');
  const isActiveWork = ACTIVE_WORK.includes(batch.status as BatchStatus);

  // ── Auto time tracking ───────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function initWork() {
      if (!isCreatorOrEditor) return;

      // Auto-advance ready → in_progress when Work View opens
      let currentBatch = batch;
      if (batch.status === 'ready_to_create' || batch.status === 'ready_to_edit') {
        const newStatus: BatchStatus = batch.status === 'ready_to_create' ? 'creating' : 'editing';
        const { data } = await supabase
          .from('batches')
          .update({ status: newStatus })
          .eq('id', batch.id)
          .select('*, client:clients(name,we_script), product:products(name)')
          .single();
        if (data && !cancelled) {
          currentBatch = data as Batch;
          setBatch(currentBatch);
          onSaved(currentBatch);
        }
      }

      if (!ACTIVE_WORK.includes(currentBatch.status as BatchStatus)) return;
      // Open a time_entry (idempotent) — still needed for admin ActiveWork panel
      await openTimeEntry(batch.id, personId, currentBatch.status);
    }
    initWork();
    return () => { cancelled = true; };
  }, []);

  async function saveDetails() {
    setSaving(true);
    const minsVal = parseFloat(edit.mins) || 0;
    const secsVal = parseFloat(edit.secs) || 0;
    const decimalMinutes = minsVal + secsVal / 60;
    const payload: Record<string, any> = {
      format: edit.format || null,
      minutes: decimalMinutes > 0 ? decimalMinutes : null,
      hooks: edit.hooks ? parseInt(edit.hooks) : null,
      brief_url: edit.brief_url ? normalizeUrl(edit.brief_url) : null,
      creative_url: edit.creative_url ? normalizeUrl(edit.creative_url) : null,
      headlines: edit.headlines || null,
      primary_texts: edit.primary_texts || null,
      lander_urls: edit.lander_urls.filter(u => u.trim()).map(normalizeUrl),
    };
    const { data } = await supabase
      .from('batches')
      .update(payload)
      .eq('id', batch.id)
      .select('*, client:clients(name,we_script), product:products(name)')
      .single();
    if (data) {
      const updated = data as Batch;
      setBatch(updated);
      setEdit(e => ({
        ...e,
        brief_url: updated.brief_url ?? '',
        creative_url: updated.creative_url ?? '',
        headlines: updated.headlines ?? '',
        primary_texts: updated.primary_texts ?? '',
        lander_urls: updated.lander_urls ?? [],
      }));
      onSaved(updated);
    }
    setSaving(false);
  }

  async function transition(newStatus: BatchStatus) {
    setGateError(null);

    // Hard gate: submit for review requires creative_url + video length + hooks + format
    if (newStatus === 'in_review' && isCreatorOrEditor) {
      const url = normalizeUrl(edit.creative_url) || batch.creative_url;
      const totalLength = (parseFloat(edit.mins) || 0) + (parseFloat(edit.secs) || 0) / 60
        || (batch.minutes ?? 0);
      const hks = edit.hooks || String(batch.hooks ?? '');
      const fmt = edit.format || batch.format;
      const missing: string[] = [];
      if (!url) missing.push('creative link');
      if (!fmt) missing.push('format');
      if (totalLength <= 0) missing.push('video length');
      if (!hks) missing.push('hooks');
      if (missing.length > 0) {
        setGateError(`Add the ${missing.join(', ')} before submitting.`);
        return;
      }
      await saveDetails();
    }

    // Hard gate: ready_to_edit requires brief_url
    if (newStatus === 'ready_to_edit') {
      const url = normalizeUrl(edit.brief_url) || batch.brief_url;
      if (!url) {
        setGateError('Add the script link before sending to the editor.');
        return;
      }
      // For we_script clients, creative package must be filled
      if ((batch as any).client?.we_script) {
        const hasLander = edit.lander_urls.some(u => u.trim()) || (batch.lander_urls ?? []).length > 0;
        const missingPkg: string[] = [];
        if (!edit.headlines && !batch.headlines) missingPkg.push('headlines');
        if (!edit.primary_texts && !batch.primary_texts) missingPkg.push('primary text');
        if (!hasLander) missingPkg.push('at least one landing page');
        if (missingPkg.length > 0) {
          setGateError('Add headlines, primary text, and at least one landing page before sending to the editor.');
          return;
        }
      }
    }

    setTransitioning(true);

    const { data } = await supabase
      .from('batches')
      .update({ status: newStatus })
      .eq('id', batch.id)
      .select('*, client:clients(name,we_script), product:products(name)')
      .single();
    if (data) {
      setBatch(data as Batch);
      onSaved(data as Batch);
    }
    onStatusChange();
    setTransitioning(false);
  }

  const days = daysSince(batch.current_status_since);
  const st = batch.status as BatchStatus;

  // ── Role-scoped transition buttons (NO QC moves — those are in QC Queue only) ─
  const resumeStatus: BatchStatus = batch.editor_id === personId ? 'editing' : 'creating';

  const buttons: { label: string; status: BatchStatus; variant: 'primary' | 'danger' | 'muted' | 'green' | 'orange' }[] = [];

  if (isCreatorOrEditor) {
    if (st === 'creating' || st === 'editing') {
      buttons.push({ label: 'Submit for Review', status: 'in_review', variant: 'primary' });
      buttons.push({ label: 'Move back', status: st === 'creating' ? 'ready_to_create' : 'ready_to_edit', variant: 'muted' });
    }
    if (st === 'needs_edits') {
      // Rework happens in-place while status stays needs_edits; submit directly to in_review
      buttons.push({ label: 'Submit for Review', status: 'in_review', variant: 'primary' });
    }
    if (st === 'in_review') {
      buttons.push({ label: 'Pull back — not ready', status: resumeStatus, variant: 'danger' });
    }
  }

  // QC block intentionally omitted — QC decisions are only in QC Queue

  if (isMediaBuyer) {
    if (st === 'approved') {
      buttons.push({ label: 'Send to Testing', status: 'testing', variant: 'primary' });
    }
    if (st === 'testing') {
      buttons.push({ label: 'Pull back to Approved', status: 'approved', variant: 'muted' });
      buttons.push({ label: 'Mark Winner', status: 'winner', variant: 'green' });
      buttons.push({ label: 'Super Winner', status: 'super_winner', variant: 'green' });
      buttons.push({ label: 'Mark Loser', status: 'loser', variant: 'danger' });
    }
    if (st === 'loser' || st === 'winner' || st === 'super_winner') {
      buttons.push({ label: 'Undo outcome', status: 'testing', variant: 'muted' });
    }
  }

  if (isScriptwriter && !isCreatorOrEditor) {
    const scriptStages: BatchStatus[] = ['new', 'scripting', 'building_landers', 'ready_to_create', 'ready_to_edit'];
    if (scriptStages.includes(st)) {
      const idx = scriptStages.indexOf(st);
      if (idx < scriptStages.length - 1) {
        const next = scriptStages[idx + 1];
        buttons.push({ label: `→ ${STATUS_LABELS[next]}`, status: next, variant: 'primary' });
      }
      if (idx > 0) {
        const prev = scriptStages[idx - 1];
        buttons.push({ label: `← ${STATUS_LABELS[prev]}`, status: prev, variant: 'muted' });
      }
    }
  }

  if (isAdminOrManager) {
    const all: BatchStatus[] = ['new','scripting','building_landers','ready_to_create','creating','ready_to_edit','editing','in_review','needs_edits','approved','testing','loser','winner','super_winner','died','iterating','discarded'];
    const idx = all.indexOf(st);
    if (buttons.length === 0) {
      if (idx < all.length - 1) buttons.push({ label: `→ ${STATUS_LABELS[all[idx + 1]]}`, status: all[idx + 1], variant: 'primary' });
      if (idx > 0) buttons.push({ label: `← ${STATUS_LABELS[all[idx - 1]]}`, status: all[idx - 1], variant: 'muted' });
    }
  }

  const seen = new Set<string>();
  const dedupedButtons = buttons.filter(b => { if (seen.has(b.status)) return false; seen.add(b.status); return true; });

  const variantClass: Record<string, string> = {
    primary: 'bg-blue-600/20 text-blue-300 hover:bg-blue-600/40 border border-blue-600/30',
    green: 'bg-green-900/40 text-green-300 hover:bg-green-900/60 border border-green-800/30',
    orange: 'bg-orange-900/40 text-orange-300 hover:bg-orange-900/60 border border-orange-800/30',
    danger: 'bg-red-900/30 text-red-300 hover:bg-red-900/50 border border-red-700/30',
    muted: 'bg-slate-800 text-slate-400 hover:bg-slate-700 border border-slate-700',
  };

  // Which stage totals are non-zero to show
  const hasEditing = stageTotals.editingMs > 0;
  const hasReview = stageTotals.reviewMs > 0;
  const hasRevisions = stageTotals.revisionsMs > 0;
  const showTimers = isCreatorOrEditor && (hasEditing || hasReview || hasRevisions);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-12 px-4 pb-4 bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xl shadow-2xl overflow-y-auto max-h-[88vh]">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-800">
          <div className="min-w-0">
            <p className="text-base font-bold text-white leading-snug">{batch.name}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <StatusBadge status={batch.status} />
              {(batch as any).client?.name && <span className="text-xs text-slate-500">{(batch as any).client.name}</span>}
              {batch.format && <span className="text-xs text-slate-600">· {FORMAT_LABELS[batch.format]}</span>}
              {batch.status === 'needs_edits' && (
                <span className={`text-xs font-medium flex items-center gap-1 ${ageColor(days)}`}>
                  <AlertTriangle size={10} /> {days}d waiting
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors flex-shrink-0">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Per-stage time breakdown */}
          {showTimers && (
            <div className="flex items-center gap-4 flex-wrap text-xs font-mono">
              {hasEditing && (
                <div className={`flex items-center gap-1.5 ${isActiveWork ? 'text-emerald-400' : 'text-slate-500'}`}>
                  <Clock size={11} className={isActiveWork ? 'animate-pulse' : ''} />
                  <span className="font-sans text-slate-600 mr-0.5">Editing</span>
                  {formatElapsed(stageTotals.editingMs)}
                </div>
              )}
              {hasReview && (
                <div className="flex items-center gap-1.5 text-yellow-600">
                  <Clock size={11} />
                  <span className="font-sans text-slate-600 mr-0.5">In review</span>
                  {formatElapsed(stageTotals.reviewMs)}
                </div>
              )}
              {hasRevisions && (
                <div className="flex items-center gap-1.5 text-orange-600">
                  <Clock size={11} />
                  <span className="font-sans text-slate-600 mr-0.5">Needs edits</span>
                  {formatElapsed(stageTotals.revisionsMs)}
                </div>
              )}
            </div>
          )}

          {/* 48h cumulative countdown — shown whenever batch has any needs_edits history */}
          {(stageTotals.revisionsMs > 0 || batch.status === 'needs_edits') && (
            <div className="mt-1">
              <NeedsEditsCountdown revisionsMs={stageTotals.revisionsMs} isActive={batch.status === 'needs_edits'} />
            </div>
          )}

          {/* Gate error */}
          {gateError && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-900/30 border border-red-700/40 text-red-300 text-sm">
              <AlertTriangle size={14} />
              {gateError}
            </div>
          )}

          {/* Script (read-only) */}
          <div>
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Script</p>
            {(edit.brief_url || batch.brief_url) ? (
              <a
                href={normalizeUrl(edit.brief_url) || batch.brief_url!}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/40 border border-blue-600/30 text-blue-300 text-sm font-medium transition-colors"
              >
                <FileText size={15} />
                Open script
                <ExternalLink size={12} className="opacity-60" />
              </a>
            ) : (
              <p className="text-sm text-slate-600 italic">No script link added yet.</p>
            )}
          </div>

          {/* Creative link (editable for creator/editor) */}
          {isCreatorOrEditor && (
            <div>
              <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">
                Creative link <span className="text-slate-600 normal-case">(Frame.io / Drive)</span>
              </label>
              <input
                type="text"
                value={edit.creative_url}
                onChange={e => { setEdit(v => ({ ...v, creative_url: e.target.value })); setGateError(null); }}
                onBlur={e => {
                  const norm = normalizeUrl(e.target.value);
                  if (norm !== e.target.value) setEdit(v => ({ ...v, creative_url: norm }));
                }}
                placeholder="trykaia.com/video or https://frame.io/…"
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}
          {!isCreatorOrEditor && batch.creative_url && (
            <div>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Creative</p>
              <a href={batch.creative_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300">
                View deliverable <ExternalLink size={12} />
              </a>
            </div>
          )}

          {/* Creative Package — editable for scriptwriter/admin, read-only for media buyer, visible to all */}
          {(() => {
            const canEdit = isScriptwriter || isAdminOrManager;
            const hasAny = edit.headlines || batch.headlines || edit.primary_texts || batch.primary_texts || edit.lander_urls.length > 0 || (batch.lander_urls ?? []).length > 0;
            if (!canEdit && !hasAny && !isMediaBuyer) return null;
            const landers = canEdit ? edit.lander_urls : (batch.lander_urls ?? []);
            return (
              <div className="space-y-3 border-t border-slate-800 pt-4">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Creative Package</p>

                {/* Headlines */}
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Headlines</label>
                  {canEdit ? (
                    <textarea
                      value={edit.headlines}
                      onChange={e => setEdit(v => ({ ...v, headlines: e.target.value }))}
                      rows={3}
                      placeholder="Enter headlines, one per line…"
                      className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                    />
                  ) : (
                    <p className="text-xs text-slate-300 whitespace-pre-wrap">{batch.headlines ?? <span className="italic text-slate-600">—</span>}</p>
                  )}
                </div>

                {/* Primary Texts */}
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Primary Texts</label>
                  {canEdit ? (
                    <textarea
                      value={edit.primary_texts}
                      onChange={e => setEdit(v => ({ ...v, primary_texts: e.target.value }))}
                      rows={3}
                      placeholder="Enter primary texts, one per line…"
                      className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                    />
                  ) : (
                    <p className="text-xs text-slate-300 whitespace-pre-wrap">{batch.primary_texts ?? <span className="italic text-slate-600">—</span>}</p>
                  )}
                </div>

                {/* Landing Pages */}
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Landing Pages</label>
                  {canEdit ? (
                    <div className="space-y-2">
                      {edit.lander_urls.map((url, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={url}
                            onChange={e => {
                              const next = [...edit.lander_urls];
                              next[i] = e.target.value;
                              setEdit(v => ({ ...v, lander_urls: next }));
                            }}
                            onBlur={e => {
                              const norm = normalizeUrl(e.target.value);
                              const next = [...edit.lander_urls];
                              next[i] = norm;
                              setEdit(v => ({ ...v, lander_urls: next }));
                            }}
                            placeholder="https://…"
                            className="flex-1 px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          {url && <a href={normalizeUrl(url)} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 flex-shrink-0"><ExternalLink size={12} /></a>}
                          <button
                            onClick={() => setEdit(v => ({ ...v, lander_urls: v.lander_urls.filter((_, j) => j !== i) }))}
                            className="text-slate-500 hover:text-red-400 flex-shrink-0"
                          ><X size={12} /></button>
                        </div>
                      ))}
                      <button
                        onClick={() => setEdit(v => ({ ...v, lander_urls: [...v.lander_urls, ''] }))}
                        className="text-xs text-blue-400 hover:text-blue-300"
                      >+ Add landing page</button>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {landers.length === 0 && <span className="text-xs italic text-slate-600">—</span>}
                      {landers.map((url, i) => (
                        <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 truncate">
                          <ExternalLink size={10} />{url}
                        </a>
                      ))}
                    </div>
                  )}
                </div>

                {canEdit && (
                  <button onClick={saveDetails} disabled={saving}
                    className="px-3 py-1.5 text-xs font-medium bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-300 rounded-lg transition-colors">
                    {saving ? 'Saving…' : 'Save creative package'}
                  </button>
                )}
              </div>
            );
          })()}

          {/* Editable details (creator/editor) */}
          {isCreatorOrEditor && (
            <div className="space-y-3 border-t border-slate-800 pt-4">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Details</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs text-slate-500 mb-1">Format <span className="text-red-400">*</span></label>
                  <select value={edit.format} onChange={e => { setEdit(v => ({ ...v, format: e.target.value as BatchFormat | '' })); setGateError(null); }}
                    className="w-full px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500">
                    <option value="">— none —</option>
                    {ALL_FORMATS.map(f => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Minutes <span className="text-red-400">*</span></label>
                  <input type="number" min="0" value={edit.mins}
                    onChange={e => { setEdit(v => ({ ...v, mins: e.target.value })); setGateError(null); }}
                    placeholder="0"
                    className="w-full px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Seconds <span className="text-red-400">*</span></label>
                  <input type="number" min="0" max="59" value={edit.secs}
                    onChange={e => { setEdit(v => ({ ...v, secs: e.target.value })); setGateError(null); }}
                    placeholder="0"
                    className="w-full px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-slate-500 mb-1">Hooks <span className="text-red-400">*</span></label>
                  <input type="number" min="0" value={edit.hooks}
                    onChange={e => { setEdit(v => ({ ...v, hooks: e.target.value })); setGateError(null); }}
                    className="w-full px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </div>
              </div>
              <button onClick={saveDetails} disabled={saving}
                className="px-3 py-1.5 text-xs font-medium bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-300 rounded-lg transition-colors">
                {saving ? 'Saving…' : 'Save details'}
              </button>
            </div>
          )}

          {/* Role-scoped action buttons */}
          {dedupedButtons.length > 0 && (
            <div className="flex gap-2 flex-wrap border-t border-slate-800 pt-4">
              {dedupedButtons.map(btn => (
                <button
                  key={btn.status}
                  disabled={transitioning}
                  onClick={() => transition(btn.status)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg transition-colors disabled:opacity-50 ${variantClass[btn.variant]}`}
                >
                  {btn.variant === 'muted' && <RotateCcw size={12} />}
                  {btn.variant === 'green' && <ThumbsUp size={12} />}
                  {btn.variant === 'orange' && <ThumbsDown size={12} />}
                  {btn.variant === 'primary' && <CheckCircle size={12} />}
                  {btn.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── BatchCard ────────────────────────────────────────────────────────────────

interface BatchCardProps {
  batch: Batch;
  personId: string;
  personRoles: string[];
  onStatusChange: () => void;
  onOpenWorkView: (b: Batch) => void;
}

function BatchCard({ batch: initialBatch, personId, personRoles, onStatusChange, onOpenWorkView }: Omit<BatchCardProps, 'discardDays'>) {
  const [batch, setBatch] = useState(initialBatch);
  const [advancing, setAdvancing] = useState(false);

  useEffect(() => { setBatch(initialBatch); }, [initialBatch]);

  const isCreatorOrEditor = batch.creator_id === personId || batch.editor_id === personId;
  const isQC = personRoles.includes('qc');
  const isMediaBuyer = batch.media_buyer_id === personId || personRoles.includes('media_buyer');
  const isScriptwriter = personRoles.includes('scriptwriter') && batch.scriptwriter_id === personId;
  const canOpenWorkView = isCreatorOrEditor || isQC;

  const bucket = batch.status === 'needs_edits'
    ? 'revision'
    : IN_PROGRESS_STATUSES.includes(batch.status as BatchStatus) ? 'progress'
    : batch.status === 'in_review' ? 'review'
    : 'done';

  async function transition(newStatus: BatchStatus) {
    if (newStatus === 'ready_to_edit' && !batch.brief_url) {
      alert('Add the script link before sending to the editor.');
      return;
    }
    setAdvancing(true);
    await supabase.from('batches').update({ status: newStatus }).eq('id', batch.id);
    onStatusChange();
    setAdvancing(false);
  }

  // Stage totals for the card (editing time only, shown as a compact chip)
  const stageTotals = useStageTimers(batch.id, batch.status, batch.current_status_since);
  const showEditingTime = isCreatorOrEditor && stageTotals.editingMs > 0 &&
    (batch.status === 'creating' || batch.status === 'editing' || batch.status === 'in_review' || batch.status === 'approved');

  return (
    <div
      className={`bg-slate-800/60 border rounded-xl p-4 transition-all ${
        bucket === 'revision' ? 'border-orange-700/50 hover:border-orange-600/60' : 'border-slate-700/50 hover:border-slate-600'
      } ${canOpenWorkView ? 'cursor-pointer' : ''}`}
      onClick={() => { if (canOpenWorkView) onOpenWorkView(batch); }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-100 truncate">{batch.name}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-xs text-slate-500">{(batch as any).client?.name ?? '—'}</span>
            {batch.format && <span className="text-xs text-slate-600">· {FORMAT_LABELS[batch.format]}</span>}
            {batch.minutes && <span className="text-xs text-slate-600">· {batch.minutes}min</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <StatusBadge status={batch.status} />
          {batch.brief_url && (
            <a
              href={batch.brief_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-900/30 text-blue-400 hover:bg-blue-900/60 text-xs transition-colors"
              title="Open script"
            >
              <FileText size={11} />
            </a>
          )}
        </div>
      </div>

      {(bucket === 'revision' || stageTotals.revisionsMs > 0) && (
        <div className="mt-1 mb-2" onClick={e => e.stopPropagation()}>
          <NeedsEditsCountdown revisionsMs={stageTotals.revisionsMs} isActive={batch.status === 'needs_edits'} />
        </div>
      )}

      {showEditingTime && (
        <div className={`mt-1 mb-2 flex items-center gap-1.5 text-xs font-mono ${ACTIVE_WORK.includes(batch.status as BatchStatus) ? 'text-emerald-400' : 'text-slate-500'}`}
          onClick={e => e.stopPropagation()}>
          <Clock size={11} className={ACTIVE_WORK.includes(batch.status as BatchStatus) ? 'animate-pulse' : ''} />
          <span>{formatElapsed(stageTotals.editingMs)}</span>
          <span className="font-sans text-slate-600">editing</span>
        </div>
      )}

      {!isCreatorOrEditor && batch.creative_url && (
        <a href={batch.creative_url} target="_blank" rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="mt-1 flex items-center gap-1 text-xs text-blue-400 hover:underline"
        >
          <ExternalLink size={10} /> View Deliverable
        </a>
      )}

      <div className="flex items-center gap-2 mt-3 flex-wrap" onClick={e => e.stopPropagation()}>
        {isScriptwriter && !isCreatorOrEditor && !isQC && (
          <select
            disabled={advancing}
            value={batch.status}
            onChange={e => transition(e.target.value as BatchStatus)}
            className="ml-auto text-xs px-2 py-1 rounded-lg bg-slate-700 border border-slate-600 text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
          >
            {(['new', 'scripting', 'building_landers', 'ready_to_create', 'ready_to_edit'] as BatchStatus[]).map(s => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        )}

        {isMediaBuyer && batch.status === 'approved' && (
          <button disabled={advancing} onClick={() => transition('testing')}
            className="flex items-center gap-1.5 px-3 py-1 text-xs rounded-lg bg-emerald-900/40 text-emerald-300 hover:bg-emerald-900/60 transition-colors disabled:opacity-50">
            Send to Testing
          </button>
        )}

        {canOpenWorkView && batch.status !== 'discarded' && (
          <button onClick={() => onOpenWorkView(batch)}
            className="ml-auto flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors">
            Open <ExternalLink size={10} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface QCModalState {
  batch: Batch;
  quality: number;
}

export default function MyQueue() {
  const { person } = useAuth();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [qcPool, setQcPool] = useState<Batch[]>([]);
  const [wipCap, setWipCap] = useState(4);
  const [loading, setLoading] = useState(true);
  const [wipBlocked, setWipBlocked] = useState(false);
  const [blockReason, setBlockReason] = useState<string | null>(null);
  const [availableBatches, setAvailableBatches] = useState<Batch[]>([]);
  const [showAssign, setShowAssign] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [qcModal, setQcModal] = useState<QCModalState | null>(null);
  const [qcSaving, setQcSaving] = useState(false);
  const [workViewBatch, setWorkViewBatch] = useState<Batch | null>(null);

  const personRoles: string[] = person?.roles?.length ? person.roles : person?.role ? [person.role] : [];
  const isCreatorOrEditor = personRoles.includes('ai_creator') || personRoles.includes('editor');
  const isQC = personRoles.includes('qc');
  const isMediaBuyer = personRoles.includes('media_buyer');
  const isScriptwriter = personRoles.includes('scriptwriter');

  useEffect(() => {
    if (person) load();
  }, [person]);

  async function load() {
    if (!person) return;
    setLoading(true);

    const [{ data: settingsData }] = await Promise.all([
      supabase.from('settings').select('key, value').in('key', ['discard_days', 'wip_cap']),
    ]);

    const settingsMap: Record<string, number> = {};
    for (const s of settingsData ?? []) settingsMap[s.key] = parseFloat(s.value);
    const dd = settingsMap.discard_days ?? 2;
    const wc = settingsMap.wip_cap ?? 4;
    setWipCap(wc);

    const id = person.id;
    const { data } = await supabase
      .from('batches')
      .select('*, client:clients(name,we_script), product:products(name)')
      .or(`creator_id.eq.${id},editor_id.eq.${id},qc_id.eq.${id},scriptwriter_id.eq.${id},media_buyer_id.eq.${id}`)
      .order('current_status_since', { ascending: true });

    const myBatches = (data ?? []) as Batch[];

    const toDiscard = myBatches.filter(
      b => b.status === 'needs_edits' && daysSince(b.current_status_since) >= dd
    );
    for (const b of toDiscard) {
      await supabase.from('batches').update({ status: 'discarded', pay_status: 'discarded' }).eq('id', b.id);
    }

    const refreshed: Batch[] = toDiscard.length > 0
      ? (((await supabase
          .from('batches')
          .select('*, client:clients(name,we_script), product:products(name)')
          .or(`creator_id.eq.${id},editor_id.eq.${id},qc_id.eq.${id},scriptwriter_id.eq.${id},media_buyer_id.eq.${id}`)
          .order('current_status_since', { ascending: true })).data) ?? []) as Batch[]
      : myBatches;

    const inProgressBatches = refreshed.filter(b => IN_PROGRESS_STATUSES.includes(b.status as BatchStatus));
    const revisionBatches = refreshed.filter(b => b.status === 'needs_edits');
    const capHit = inProgressBatches.length >= wc;
    const overdueRevision = revisionBatches.some(b => daysSince(b.current_status_since) >= dd);

    if (overdueRevision) {
      setWipBlocked(true);
      setBlockReason('You have overdue revisions. Clear them before picking up new work.');
    } else if (capHit) {
      setWipBlocked(true);
      setBlockReason(`WIP cap reached (${wc} active). Finish current work before taking more.`);
    } else {
      setWipBlocked(false);
      setBlockReason(null);
    }

    setBatches(refreshed.filter(b => b.status !== 'discarded'));

    if (isQC) {
      const { data: qcData } = await supabase
        .from('batches')
        .select('*, client:clients(name), product:products(name), creator:people!batches_creator_id_fkey(name), editor:people!batches_editor_id_fkey(name)')
        .eq('status', 'in_review')
        .order('current_status_since', { ascending: true });
      setQcPool((qcData ?? []) as Batch[]);
    }

    setLoading(false);
  }

  async function loadAvailable() {
    if (!person) return;
    const queries: Promise<{ data: Batch[] | null }>[] = [];

    if (isCreatorOrEditor) {
      queries.push(
        supabase.from('batches').select('*, client:clients(name), product:products(name)')
          .eq('status', 'ready_to_create').is('creator_id', null).order('created_at', { ascending: true })
          .then(r => ({ data: (r.data ?? []) as Batch[] })),
        supabase.from('batches').select('*, client:clients(name), product:products(name)')
          .eq('status', 'ready_to_edit').is('editor_id', null).order('created_at', { ascending: true })
          .then(r => ({ data: (r.data ?? []) as Batch[] })),
      );
    }
    if (isScriptwriter) {
      queries.push(
        supabase.from('batches').select('*, client:clients(name), product:products(name)')
          .eq('status', 'new').is('scriptwriter_id', null).order('created_at', { ascending: true })
          .then(r => ({ data: (r.data ?? []) as Batch[] })),
      );
    }
    if (isMediaBuyer) {
      queries.push(
        supabase.from('batches').select('*, client:clients(name), product:products(name)')
          .eq('status', 'approved').is('media_buyer_id', null).order('created_at', { ascending: true })
          .then(r => ({ data: (r.data ?? []) as Batch[] })),
      );
    }

    const results = await Promise.all(queries);
    const all: Batch[] = results.flatMap(r => r.data ?? []);
    const seen = new Set<string>();
    setAvailableBatches(all.filter(b => { if (seen.has(b.id)) return false; seen.add(b.id); return true; }));
  }

  async function assignBatch(batchId: string, status: BatchStatus) {
    if (!person) return;
    setAssigning(batchId);

    const updates: Record<string, any> = { status };
    if (status === 'creating') updates.creator_id = person.id;
    else if (status === 'editing') updates.editor_id = person.id;
    else if (status === 'new') { updates.scriptwriter_id = person.id; updates.status = 'scripting'; }
    else if (status === 'approved') { updates.media_buyer_id = person.id; }
    if (status === 'ready_to_create') { updates.creator_id = person.id; delete updates.status; }
    if (status === 'ready_to_edit') { updates.editor_id = person.id; delete updates.status; }

    await supabase.from('batches').update(updates).eq('id', batchId);
    setAssigning(null);
    setShowAssign(false);
    await load();
  }

  async function submitQCReview(decision: 'approve' | 'revise') {
    if (!qcModal || !person) return;
    setQcSaving(true);
    const updates: Record<string, any> = { quality: qcModal.quality, qc_id: person.id };
    if (decision === 'approve') {
      updates.status = 'approved';
    } else {
      updates.status = 'needs_edits';
      updates.internal_revisions = (qcModal.batch.internal_revisions ?? 0) + 1;
    }
    await supabase.from('batches').update(updates).eq('id', qcModal.batch.id);
    setQcSaving(false);
    setQcModal(null);
    await load();
  }

  function handleWorkViewSaved(updated: Batch) {
    setBatches(prev => prev.map(b => b.id === updated.id ? updated : b));
    if (workViewBatch?.id === updated.id) setWorkViewBatch(updated);
  }

  const inRevision = batches.filter(b => b.status === 'needs_edits');
  const inProgress = batches.filter(b => IN_PROGRESS_STATUSES.includes(b.status as BatchStatus));
  const inReview = batches.filter(b => b.status === 'in_review');
  const done = batches.filter(b => DONE_STATUSES.includes(b.status as BatchStatus));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        <div className="w-6 h-6 border-2 border-slate-700 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">My Queue</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Welcome back, {person?.name}
            {(isCreatorOrEditor || isScriptwriter || isMediaBuyer) && (
              <span className="ml-3 text-xs text-slate-600">
                {inProgress.length}/{wipCap} slots used
              </span>
            )}
          </p>
        </div>
        {!wipBlocked && (isCreatorOrEditor || isScriptwriter || isMediaBuyer) && (
          <button
            onClick={() => { loadAvailable(); setShowAssign(true); }}
            className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
          >
            Pick Up Work
          </button>
        )}
      </div>

      {wipBlocked && (
        <div className="mb-6 flex items-start gap-3 p-4 rounded-xl bg-red-900/20 border border-red-800/40">
          <Ban size={18} className="text-red-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-300">New assignments blocked</p>
            <p className="text-xs text-red-400/80 mt-0.5">{blockReason}</p>
          </div>
        </div>
      )}

      {/* Needs Edits */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={16} className="text-orange-400" />
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Needs Edits</h2>
          <span className="ml-auto text-xs text-slate-600">{inRevision.length}</span>
        </div>
        {inRevision.length === 0 ? (
          <p className="text-sm text-slate-600 px-1">No revisions — you're clear!</p>
        ) : (
          <div className="space-y-3">
            {inRevision.map(b => (
              <BatchCard key={b.id} batch={b} personId={person!.id} personRoles={personRoles} onStatusChange={load} onOpenWorkView={setWorkViewBatch} />
            ))}
          </div>
        )}
      </section>

      {/* In Progress */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <Clock size={16} className="text-blue-400" />
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">In Progress</h2>
          <span className="ml-auto text-xs text-slate-600">{inProgress.length}</span>
        </div>
        {inProgress.length === 0 ? (
          <p className="text-sm text-slate-600 px-1">Nothing in progress.</p>
        ) : (
          <div className="space-y-3">
            {inProgress.map(b => (
              <BatchCard key={b.id} batch={b} personId={person!.id} personRoles={personRoles} onStatusChange={load} onOpenWorkView={setWorkViewBatch} />
            ))}
          </div>
        )}
      </section>

      {/* In Review */}
      {inReview.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle size={16} className="text-yellow-400" />
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">In Review</h2>
            <span className="ml-auto text-xs text-slate-600">{inReview.length}</span>
          </div>
          <div className="space-y-3">
            {inReview.map(b => (
              <BatchCard key={b.id} batch={b} personId={person!.id} personRoles={personRoles} onStatusChange={load} onOpenWorkView={setWorkViewBatch} />
            ))}
          </div>
        </section>
      )}

      {/* Done / Live */}
      {done.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle size={16} className="text-green-400" />
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Done / Live</h2>
            <span className="ml-auto text-xs text-slate-600">{done.length}</span>
          </div>
          <div className="space-y-3">
            {done.map(b => (
              <BatchCard key={b.id} batch={b} personId={person!.id} personRoles={personRoles} onStatusChange={load} onOpenWorkView={setWorkViewBatch} />
            ))}
          </div>
        </section>
      )}

      {/* QC Pool — card list linking to QC Queue (no review actions here) */}
      {isQC && (
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-4 h-4 rounded-full bg-yellow-500/20 border border-yellow-600/50 flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-yellow-400" />
            </div>
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">QC Pool</h2>
            <span className="text-xs text-slate-600 ml-1">— review in QC Queue</span>
            <span className="ml-auto text-xs text-slate-600">{qcPool.length}</span>
          </div>
          {qcPool.length === 0 ? (
            <p className="text-sm text-slate-600 px-1">No batches awaiting QC review.</p>
          ) : (
            <div className="space-y-3">
              {qcPool.map(b => {
                const creator = (b as any).editor?.name ?? (b as any).creator?.name ?? '—';
                const hours = Math.floor((Date.now() - new Date(b.current_status_since).getTime()) / 3_600_000);
                return (
                  <div key={b.id}
                    className="bg-slate-800/60 border border-yellow-800/30 rounded-xl p-4 cursor-pointer hover:border-yellow-700/50 transition-all"
                    onClick={() => setWorkViewBatch(b)}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-sm font-semibold text-slate-100 truncate">{b.name}</p>
                          <StatusBadge status={b.status} />
                        </div>
                        <p className="text-xs text-slate-500">
                          {(b as any).client?.name ?? '—'} · by {creator} · waiting {hours}h
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Pick Up Work modal */}
      {showAssign && (
        <Modal title="Pick Up Work" onClose={() => setShowAssign(false)} width="max-w-xl">
          {availableBatches.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6 text-slate-500">
              <Layers size={32} className="text-slate-700" />
              <p className="text-sm">No batches available to pick up right now.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {availableBatches.map(b => (
                <div key={b.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-slate-800 border border-slate-700">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-100 truncate">{b.name}</p>
                    <p className="text-xs text-slate-500">
                      {(b as any).client?.name ?? '—'}
                      {b.format && ` · ${FORMAT_LABELS[b.format]}`}
                      {' · '}<span className="text-slate-600">{STATUS_LABELS[b.status]}</span>
                    </p>
                  </div>
                  <button
                    disabled={assigning === b.id}
                    onClick={() => assignBatch(b.id, b.status)}
                    className="flex-shrink-0 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition-colors"
                  >
                    {assigning === b.id ? '…' : 'Assign to me'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {/* QC quick-review modal (still available from pool, but without approve/reject — redirect note) */}
      {qcModal && (
        <Modal title={`Review: ${qcModal.batch.name}`} onClose={() => setQcModal(null)}>
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-3">Quality Score</label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map(score => (
                  <button key={score}
                    onClick={() => setQcModal(m => m ? { ...m, quality: score } : m)}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                      qcModal.quality === score ? 'bg-yellow-500 text-slate-900' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    <Star size={14} className="mx-auto mb-0.5" />
                    {score}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => submitQCReview('revise')} disabled={qcSaving}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-orange-900/40 hover:bg-orange-900/70 text-orange-300 border border-orange-800/40 transition-colors disabled:opacity-50">
                Send Back
              </button>
              <button onClick={() => submitQCReview('approve')} disabled={qcSaving}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-green-900/40 hover:bg-green-900/70 text-green-300 border border-green-800/40 transition-colors disabled:opacity-50">
                Approve
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Work View */}
      {workViewBatch && (
        <WorkView
          batch={workViewBatch}
          personId={person!.id}
          personRoles={personRoles}
          onClose={() => { setWorkViewBatch(null); load(); }}
          onSaved={handleWorkViewSaved}
          onStatusChange={() => { load(); }}
        />
      )}
    </div>
  );
}
