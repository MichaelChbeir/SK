import { useEffect, useState } from 'react';
import { RefreshCw, Filter, Plus, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Batch, Client, Person, BatchStatus, BatchFormat } from '../lib/types';
import { STATUS_LABELS, STATUS_ORDER, FORMAT_LABELS, ALL_FORMATS } from '../lib/types';
import StatusBadge from '../components/StatusBadge';
import Modal from '../components/Modal';

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

interface BatchWithJoins extends Batch {
  client?: Client;
  editor?: Person;
  creator?: Person;
  scriptwriter?: Person;
}

interface BatchFormState {
  client_id: string;
  product_id: string;
  name: string;
  format: BatchFormat | '';
  status: BatchStatus;
  brief_url: string;
  creative_url: string;
  lander_urls: string;
  scriptwriter_id: string;
  creator_id: string;
  editor_id: string;
  qc_id: string;
  media_buyer_id: string;
  hooks: string;
  minutes: string;
}

export default function Batches() {
  const { person } = useAuth();
  const [batches, setBatches] = useState<BatchWithJoins[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Batch | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<BatchFormState>({
    client_id: '', product_id: '', name: '', format: '', status: 'new',
    brief_url: '', creative_url: '', lander_urls: '',
    scriptwriter_id: '', creator_id: '', editor_id: '',
    qc_id: '', media_buyer_id: '', hooks: '', minutes: '',
  });

  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => { load(); }, [statusFilter, clientFilter]);

  async function load() {
    setLoading(true);
    let query = supabase
      .from('batches')
      .select('*, client:clients(id, name), editor:people!batches_editor_id_fkey(id,name), creator:people!batches_creator_id_fkey(id,name), scriptwriter:people!batches_scriptwriter_id_fkey(id,name)')
      .order('created_at', { ascending: false })
      .limit(200);

    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    if (clientFilter !== 'all') query = query.eq('client_id', clientFilter);

    const [{ data }, { data: cls }, { data: ps }, { data: prods }] = await Promise.all([
      query,
      supabase.from('clients').select('id, name').order('name'),
      supabase.from('people').select('id, name, role, roles').eq('active', true).order('name'),
      supabase.from('products').select('id, name, client_id').order('name'),
    ]);

    setBatches((data ?? []) as BatchWithJoins[]);
    setClients((cls ?? []) as Client[]);
    setPeople((ps ?? []) as Person[]);
    setProducts(prods ?? []);
    setLoading(false);
  }

  function openCreate() {
    setEditTarget(null);
    setSaveError(null);
    setForm({ client_id: '', product_id: '', name: '', format: '', status: 'new', brief_url: '', creative_url: '', lander_urls: '', scriptwriter_id: '', creator_id: '', editor_id: '', qc_id: '', media_buyer_id: '', hooks: '', minutes: '' });
    setShowModal(true);
  }

  function openEdit(b: BatchWithJoins) {
    setEditTarget(b);
    setSaveError(null);
    setForm({
      client_id: b.client_id ?? '', product_id: b.product_id ?? '', name: b.name, format: b.format ?? '',
      status: b.status, brief_url: b.brief_url ?? '', creative_url: b.creative_url ?? '',
      lander_urls: (b.lander_urls ?? []).join('\n'),
      scriptwriter_id: b.scriptwriter_id ?? '',
      creator_id: b.creator_id ?? '', editor_id: b.editor_id ?? '', qc_id: b.qc_id ?? '',
      media_buyer_id: b.media_buyer_id ?? '', hooks: String(b.hooks ?? ''), minutes: String(b.minutes ?? ''),
    });
    setShowModal(true);
  }

  async function handleSave() {
    setSaveError(null);
    // Gate: ready_to_edit requires a script link
    if (form.status === 'ready_to_edit' && !form.brief_url.trim()) {
      setSaveError('Add the script link before sending to the editor.');
      return;
    }
    setSaving(true);
    const payload: Record<string, any> = {
      client_id: form.client_id || null,
      product_id: form.product_id || null,
      name: form.name.trim(),
      format: form.format || null,
      status: form.status,
      brief_url: form.brief_url ? normalizeUrl(form.brief_url) : null,
      creative_url: form.creative_url ? normalizeUrl(form.creative_url) : null,
      lander_urls: form.lander_urls.trim()
        ? form.lander_urls.split('\n').map(u => normalizeUrl(u)).filter(Boolean)
        : null,
      scriptwriter_id: form.scriptwriter_id || null,
      creator_id: form.creator_id || null,
      editor_id: form.editor_id || null,
      qc_id: form.qc_id || null,
      media_buyer_id: form.media_buyer_id || null,
      hooks: form.hooks ? parseInt(form.hooks) : null,
      minutes: form.minutes ? parseFloat(form.minutes) : null,
    };

    if (editTarget) {
      await supabase.from('batches').update(payload).eq('id', editTarget.id);
    } else {
      await supabase.from('batches').insert(payload);
    }
    setSaving(false);
    setShowModal(false);
    await load();
  }

  const peopleByRole = (role: string) => people.filter(p => (p.roles ?? [p.role]).includes(role as any));
  const filteredProducts = form.client_id ? products.filter(p => p.client_id === form.client_id) : products;

  const ASSIGN_FIELDS = [
    { label: 'Scriptwriter', key: 'scriptwriter_id', role: 'scriptwriter' },
    { label: 'Creator', key: 'creator_id', role: 'ai_creator' },
    { label: 'Editor', key: 'editor_id', role: 'ai_creator' },
    { label: 'QC', key: 'qc_id', role: 'qc' },
    { label: 'Media Buyer', key: 'media_buyer_id', role: 'media_buyer' },
  ] as const;

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">All Batches</h1>
          <p className="text-sm text-slate-500 mt-0.5">{batches.length} batches</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors">
            <RefreshCw size={16} />
          </button>
          <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">
            <Plus size={16} />New Batch
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <Filter size={12} />
          <span>Filter:</span>
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Statuses</option>
          {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <select
          value={clientFilter}
          onChange={e => setClientFilter(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40"><div className="w-6 h-6 border-2 border-slate-700 border-t-blue-500 rounded-full animate-spin" /></div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                {['Batch', 'Client', 'Status', 'Assigned To', 'Format', 'Created', ''].map(h => (
                  <th key={h} className={`px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide ${h === '' ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {batches.map(b => {
                const assignee = (b as any).editor?.name ?? (b as any).creator?.name ?? (b as any).scriptwriter?.name ?? '—';
                return (
                  <tr key={b.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-100 max-w-48 truncate">{b.name}</td>
                    <td className="px-4 py-3 text-slate-400">{(b as any).client?.name ?? '—'}</td>
                    <td className="px-4 py-3"><StatusBadge status={b.status} /></td>
                    <td className="px-4 py-3 text-slate-400">{assignee}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{b.format ? FORMAT_LABELS[b.format] : '—'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{new Date(b.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => openEdit(b)} className="p-1.5 text-slate-500 hover:text-slate-200 hover:bg-slate-700 rounded transition-colors">
                        <ChevronRight size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {batches.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-600">No batches found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <Modal title={editTarget ? 'Edit Batch' : 'New Batch'} onClose={() => setShowModal(false)} width="max-w-2xl">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Batch Name</label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Client — Week 26 #1"
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Client</label>
                <select value={form.client_id} onChange={e => setForm(f => ({ ...f, client_id: e.target.value, product_id: '' }))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— none —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Product</label>
                <select value={form.product_id} onChange={e => setForm(f => ({ ...f, product_id: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— none —</option>
                  {filteredProducts.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Status</label>
                <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as BatchStatus }))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Format</label>
                <select value={form.format} onChange={e => setForm(f => ({ ...f, format: e.target.value as BatchFormat | '' }))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— none —</option>
                  {ALL_FORMATS.map(f => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Script link</label>
                <input type="text" value={form.brief_url} onChange={e => setForm(f => ({ ...f, brief_url: e.target.value }))} placeholder="docs.google.com/… or https://…"
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Video link (Frame.io)</label>
                <input type="text" value={form.creative_url} onChange={e => setForm(f => ({ ...f, creative_url: e.target.value }))} placeholder="frame.io/… or https://…"
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Landers (one per line)</label>
                <textarea value={form.lander_urls} onChange={e => setForm(f => ({ ...f, lander_urls: e.target.value }))} placeholder={"https://example.com/lander-1\nhttps://example.com/lander-2"} rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800">
              <p className="text-xs font-medium text-slate-400 mb-3">Assignments</p>
              <div className="grid grid-cols-2 gap-3">
                {ASSIGN_FIELDS.map(({ label, key, role }) => (
                  <div key={key}>
                    <label className="block text-xs text-slate-500 mb-1">{label}</label>
                    <select
                      value={(form as any)[key]}
                      onChange={e => {
                        const val = e.target.value;
                        setForm(f => {
                          const next = { ...f, [key]: val };
                          if (key === 'creator_id') next.editor_id = val;
                          return next;
                        });
                      }}
                      className="w-full px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">— unassigned —</option>
                      {peopleByRole(role).map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Hooks</label>
                <input type="number" value={form.hooks} onChange={e => setForm(f => ({ ...f, hooks: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Minutes</label>
                <input type="number" step="0.5" value={form.minutes} onChange={e => setForm(f => ({ ...f, minutes: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>

            {saveError && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-900/30 border border-red-700/40 text-red-300 text-sm">
                <span className="text-red-400">!</span> {saveError}
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving || !form.name} className="flex-1 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors">
                {saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Create Batch'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
