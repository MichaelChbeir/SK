import { useEffect, useState } from 'react';
import { Plus, Pencil, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Client } from '../../lib/types';
import Modal from '../../components/Modal';

interface ClientForm {
  name: string;
  platform: string;
  we_script: boolean;
  monthly_purchase: string;
  weekly_target: string;
  active: boolean;
}

const EMPTY: ClientForm = { name: '', platform: '', we_script: false, monthly_purchase: '0', weekly_target: '3', active: true };

export default function AdminClients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState<Client | null>(null);
  const [form, setForm] = useState<ClientForm>(EMPTY);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('clients').select('*').order('name');
    setClients((data ?? []) as Client[]);
    setLoading(false);
  }

  function openCreate() {
    setEditTarget(null);
    setForm(EMPTY);
    setError(null);
    setShowModal(true);
  }

  function openEdit(c: Client) {
    setEditTarget(c);
    setForm({ name: c.name, platform: c.platform ?? '', we_script: c.we_script, monthly_purchase: String(c.monthly_purchase), weekly_target: String(c.weekly_target), active: c.active });
    setError(null);
    setShowModal(true);
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      platform: form.platform || null,
      we_script: form.we_script,
      monthly_purchase: parseFloat(form.monthly_purchase) || 0,
      weekly_target: parseInt(form.weekly_target) || 0,
      active: form.active,
    };
    if (editTarget) {
      const { error: e } = await supabase.from('clients').update(payload).eq('id', editTarget.id);
      if (e) { setError(e.message); setSaving(false); return; }
    } else {
      const { error: e } = await supabase.from('clients').insert(payload);
      if (e) { setError(e.message); setSaving(false); return; }
    }
    setSaving(false);
    setShowModal(false);
    await load();
  }

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Clients</h1>
          <p className="text-sm text-slate-500 mt-0.5">{clients.length} client{clients.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors">
            <RefreshCw size={16} />
          </button>
          <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">
            <Plus size={16} />Add Client
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-slate-700 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                {['Client', 'Platform', 'Weekly Target', 'Monthly Spend', 'We Script', 'Status', ''].map(h => (
                  <th key={h} className={`px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide ${h === '' ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {clients.map(c => (
                <tr key={c.id} className={`hover:bg-slate-800/40 transition-colors ${!c.active ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3 font-medium text-slate-100">{c.name}</td>
                  <td className="px-4 py-3 text-slate-400">{c.platform ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-300">{c.weekly_target}</td>
                  <td className="px-4 py-3 text-slate-300">${c.monthly_purchase?.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium ${c.we_script ? 'text-green-400' : 'text-slate-600'}`}>
                      {c.we_script ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium ${c.active ? 'text-green-400' : 'text-slate-600'}`}>
                      {c.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openEdit(c)} className="p-1.5 text-slate-500 hover:text-slate-200 hover:bg-slate-700 rounded transition-colors">
                      <Pencil size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <Modal title={editTarget ? 'Edit Client' : 'Add Client'} onClose={() => setShowModal(false)}>
          <div className="space-y-4">
            {error && <div className="px-3 py-2 rounded-lg bg-red-900/30 border border-red-800/50 text-sm text-red-300">{error}</div>}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Client Name</label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Acme Corp"
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Platform</label>
              <input type="text" value={form.platform} onChange={e => setForm(f => ({ ...f, platform: e.target.value }))} placeholder="Meta, TikTok…"
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Weekly Target</label>
                <input type="number" value={form.weekly_target} onChange={e => setForm(f => ({ ...f, weekly_target: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Monthly Spend ($)</label>
                <input type="number" value={form.monthly_purchase} onChange={e => setForm(f => ({ ...f, monthly_purchase: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input type="checkbox" checked={form.we_script} onChange={e => setForm(f => ({ ...f, we_script: e.target.checked }))} className="rounded border-slate-600 bg-slate-800" />
                We write scripts
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} className="rounded border-slate-600 bg-slate-800" />
                Active
              </label>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving || !form.name} className="flex-1 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors">
                {saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Create Client'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
