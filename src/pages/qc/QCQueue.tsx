import { useEffect, useState } from 'react';
import { Star, ThumbsDown, ThumbsUp, RefreshCw, ExternalLink, Clock } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import type { Batch } from '../../lib/types';
import { FORMAT_LABELS } from '../../lib/types';
import StatusBadge from '../../components/StatusBadge';
import Modal from '../../components/Modal';

interface ReviewModal {
  batch: Batch;
  quality: number;
}

function RefLink({ href, label }: { href: string | null | undefined; label: string }) {
  if (!href) {
    return (
      <div className="flex items-center justify-between py-1.5 border-b border-slate-800/60">
        <span className="text-xs text-slate-500">{label}</span>
        <span className="text-xs text-slate-700 italic">— not added</span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-800/60">
      <span className="text-xs text-slate-500">{label}</span>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors"
      >
        Open <ExternalLink size={10} />
      </a>
    </div>
  );
}

export default function QCQueue() {
  const { person } = useAuth();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewModal, setReviewModal] = useState<ReviewModal | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('batches')
      .select('*, client:clients(name), product:products(name,copy_doc_url), editor:people!batches_editor_id_fkey(name), creator:people!batches_creator_id_fkey(name)')
      .eq('status', 'in_review')
      .order('current_status_since', { ascending: true });
    setBatches((data ?? []) as Batch[]);
    setLoading(false);
  }

  async function submitReview(decision: 'approve' | 'revise') {
    if (!reviewModal || !person) return;
    setSaving(true);

    const updates: Record<string, any> = {
      quality: reviewModal.quality,
      qc_id: person.id,
    };

    if (decision === 'approve') {
      updates.status = 'approved';
    } else {
      updates.status = 'needs_edits';
      updates.internal_revisions = (reviewModal.batch.internal_revisions ?? 0) + 1;
    }

    await supabase.from('batches').update(updates).eq('id', reviewModal.batch.id);
    setSaving(false);
    setReviewModal(null);
    await load();
  }

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
          <h1 className="text-xl font-bold text-white">QC Queue</h1>
          <p className="text-sm text-slate-500 mt-0.5">{batches.length} batch{batches.length !== 1 ? 'es' : ''} awaiting review</p>
        </div>
        <button onClick={load} className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors">
          <RefreshCw size={16} />
        </button>
      </div>

      {batches.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-600">
          <ThumbsUp size={40} className="mb-3 text-slate-700" />
          <p className="text-sm">Nothing to review — queue is empty.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {batches.map(b => {
            const creator = (b as any).editor?.name ?? (b as any).creator?.name ?? '—';
            const hours = Math.floor((Date.now() - new Date(b.current_status_since).getTime()) / 3_600_000);
            return (
              <div
                key={b.id}
                className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 hover:border-slate-600 transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-semibold text-slate-100 truncate">{b.name}</p>
                      <StatusBadge status={b.status} />
                    </div>
                    <p className="text-xs text-slate-500 flex items-center gap-1.5">
                      {(b as any).client?.name ?? '—'}
                      {b.format && <span>· {FORMAT_LABELS[b.format]}</span>}
                      <span>· by {creator}</span>
                      <Clock size={11} className="ml-1" />
                      <span>{hours}h</span>
                    </p>
                  </div>
                  <button
                    onClick={() => setReviewModal({ batch: b, quality: b.quality ?? 3 })}
                    className="flex-shrink-0 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
                  >
                    Review
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {reviewModal && (
        <Modal title="Review Batch" onClose={() => setReviewModal(null)} width="max-w-lg">
          <div className="space-y-5">

            {/* ── Reference block ─────────────────────────────────── */}
            <div className="bg-slate-800/50 rounded-xl px-4 py-3">
              {/* Batch name + status */}
              <div className="flex items-start justify-between gap-2 mb-3">
                <p className="text-sm font-semibold text-slate-100 leading-snug">{reviewModal.batch.name}</p>
                <StatusBadge status={reviewModal.batch.status} className="flex-shrink-0 mt-0.5" />
              </div>

              {/* Meta row */}
              <div className="flex items-center gap-3 text-xs text-slate-400 mb-3 flex-wrap">
                {(reviewModal.batch as any).client?.name && (
                  <span className="flex items-center gap-1">
                    <span className="text-slate-600">Client:</span>
                    {(reviewModal.batch as any).client.name}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <span className="text-slate-600">Format:</span>
                  {reviewModal.batch.format ? FORMAT_LABELS[reviewModal.batch.format] : '—'}
                </span>
              </div>

              {/* Links */}
              <div className="divide-y divide-slate-800/40">
                <RefLink href={reviewModal.batch.brief_url} label="Script" />
                <RefLink href={reviewModal.batch.creative_url} label="Video (Frame.io)" />
                {(reviewModal.batch as any).product?.copy_doc_url && (
                  <RefLink href={(reviewModal.batch as any).product.copy_doc_url} label="Copy doc" />
                )}
                {reviewModal.batch.lander_urls && reviewModal.batch.lander_urls.length > 0 && (
                  <div className="py-1.5">
                    <span className="text-xs text-slate-500 block mb-1">Landers</span>
                    <div className="flex flex-col gap-1">
                      {reviewModal.batch.lander_urls.map((url, i) => (
                        <a
                          key={i}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors"
                        >
                          Lander {i + 1} <ExternalLink size={10} />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Quality rating ──────────────────────────────────── */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-3">Quality Score</label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map(score => (
                  <button
                    key={score}
                    onClick={() => setReviewModal(m => m ? { ...m, quality: score } : m)}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                      reviewModal.quality === score
                        ? 'bg-yellow-500 text-slate-900'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    <Star size={14} className="mx-auto mb-0.5" />
                    {score}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-600 mt-2">
                {reviewModal.quality <= 2 ? 'Needs improvement' : reviewModal.quality === 3 ? 'Acceptable' : reviewModal.quality === 4 ? 'Good' : 'Excellent'}
              </p>
            </div>

            {/* ── Approve / Send Back ─────────────────────────────── */}
            <div className="flex gap-3">
              <button
                onClick={() => submitReview('revise')}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium bg-orange-900/40 hover:bg-orange-900/70 text-orange-300 border border-orange-800/40 transition-colors disabled:opacity-50"
              >
                <ThumbsDown size={14} />
                Needs Edits
              </button>
              <button
                onClick={() => submitReview('approve')}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium bg-green-900/40 hover:bg-green-900/70 text-green-300 border border-green-800/40 transition-colors disabled:opacity-50"
              >
                <ThumbsUp size={14} />
                Approve
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
