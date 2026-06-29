import { useEffect, useState } from 'react';
import { Plus, Pencil, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Client, Product } from '../../lib/types';
import Modal from '../../components/Modal';

interface ProductWithClient extends Product {
  client?: Client;
}

interface ProductForm {
  client_id: string;
  name: string;
  copy_doc_url: string;
  has_pdp: boolean;
  has_advertorial: boolean;
  broll_ready: boolean;
}

const EMPTY: ProductForm = { client_id: '', name: '', copy_doc_url: '', has_pdp: false, has_advertorial: false, broll_ready: false };

export default function AdminProducts() {
  const [products, setProducts] = useState<ProductWithClient[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductForm>(EMPTY);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [{ data: prods }, { data: cls }] = await Promise.all([
      supabase.from('products').select('*, client:clients(id, name)').order('name'),
      supabase.from('clients').select('id, name').eq('active', true).order('name'),
    ]);
    setProducts((prods ?? []) as ProductWithClient[]);
    setClients((cls ?? []) as Client[]);
    setLoading(false);
  }

  function openCreate() {
    setEditTarget(null);
    setForm({ ...EMPTY, client_id: clients[0]?.id ?? '' });
    setError(null);
    setShowModal(true);
  }

  function openEdit(p: ProductWithClient) {
    setEditTarget(p);
    setForm({ client_id: p.client_id ?? '', name: p.name, copy_doc_url: p.copy_doc_url ?? '', has_pdp: p.has_pdp, has_advertorial: p.has_advertorial, broll_ready: p.broll_ready });
    setError(null);
    setShowModal(true);
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    const payload = { client_id: form.client_id || null, name: form.name.trim(), copy_doc_url: form.copy_doc_url || null, has_pdp: form.has_pdp, has_advertorial: form.has_advertorial, broll_ready: form.broll_ready };
    if (editTarget) {
      const { error: e } = await supabase.from('products').update(payload).eq('id', editTarget.id);
      if (e) { setError(e.message); setSaving(false); return; }
    } else {
      const { error: e } = await supabase.from('products').insert(payload);
      if (e) { setError(e.message); setSaving(false); return; }
    }
    setSaving(false);
    setShowModal(false);
    await load();
  }

  const checkboxes = [
    { key: 'has_pdp', label: 'Has PDP' },
    { key: 'has_advertorial', label: 'Has Advertorial' },
    { key: 'broll_ready', label: 'B-roll Ready' },
  ] as const;

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Products</h1>
          <p className="text-sm text-slate-500 mt-0.5">{products.length} product{products.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"><RefreshCw size={16} /></button>
          <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">
            <Plus size={16} />Add Product
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40"><div className="w-6 h-6 border-2 border-slate-700 border-t-blue-500 rounded-full animate-spin" /></div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                {['Product', 'Client', 'PDP', 'Advertorial', 'B-roll', ''].map(h => (
                  <th key={h} className={`px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide ${h === '' ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {products.map(p => (
                <tr key={p.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-100">
                    {p.name}
                    {p.copy_doc_url && (
                      <a href={p.copy_doc_url} target="_blank" rel="noopener noreferrer" className="ml-2 text-xs text-blue-400 hover:underline">Doc</a>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400">{(p as any).client?.name ?? '—'}</td>
                  {['has_pdp', 'has_advertorial', 'broll_ready'].map(f => (
                    <td key={f} className="px-4 py-3">
                      <span className={`text-xs font-medium ${(p as any)[f] ? 'text-green-400' : 'text-slate-600'}`}>
                        {(p as any)[f] ? 'Yes' : 'No'}
                      </span>
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openEdit(p)} className="p-1.5 text-slate-500 hover:text-slate-200 hover:bg-slate-700 rounded transition-colors"><Pencil size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <Modal title={editTarget ? 'Edit Product' : 'Add Product'} onClose={() => setShowModal(false)}>
          <div className="space-y-4">
            {error && <div className="px-3 py-2 rounded-lg bg-red-900/30 border border-red-800/50 text-sm text-red-300">{error}</div>}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Client</label>
              <select value={form.client_id} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">— none —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Product Name</label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Product Name"
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Copy Doc URL</label>
              <input type="url" value={form.copy_doc_url} onChange={e => setForm(f => ({ ...f, copy_doc_url: e.target.value }))} placeholder="https://docs.google.com/…"
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex gap-4">
              {checkboxes.map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))} className="rounded border-slate-600 bg-slate-800" />
                  {label}
                </label>
              ))}
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving || !form.name} className="flex-1 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors">
                {saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Create Product'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
