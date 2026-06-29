import { useEffect, useState } from 'react';
import { Plus, Pencil, UserCheck, UserX, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Person, Role, PersonStatus } from '../../lib/types';
import { ROLE_LABELS, PERSON_STATUS_COLORS } from '../../lib/types';
import Modal from '../../components/Modal';

const ROLES: Role[] = ['scriptwriter', 'lander_builder', 'ai_creator', 'editor', 'qc', 'media_buyer', 'manager', 'admin'];

interface PersonForm {
  name: string;
  email: string;
  role: Role;
  pay_model: string;
  base_rate: string;
  status: PersonStatus;
  active: boolean;
}

const EMPTY_FORM: PersonForm = {
  name: '', email: '', role: 'editor', pay_model: 'level', base_rate: '0', status: 'ok', active: true,
};

const STATUS_LABELS: Record<PersonStatus, string> = {
  ok: 'OK',
  warning: 'Warning',
  flagged: 'Flagged',
};

export default function AdminPeople() {
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [editTarget, setEditTarget] = useState<Person | null>(null);
  const [form, setForm] = useState<PersonForm>(EMPTY_FORM);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('people').select('*').order('name');
    setPeople((data ?? []) as Person[]);
    setLoading(false);
  }

  function openCreate() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setError(null);
    setShowModal(true);
  }

  function openEdit(p: Person) {
    setEditTarget(p);
    setForm({
      name: p.name,
      email: p.email,
      role: p.role,
      pay_model: p.pay_model ?? 'level',
      base_rate: String(p.base_rate),
      status: p.status,
      active: p.active,
    });
    setError(null);
    setShowModal(true);
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
      role: form.role,
      pay_model: form.pay_model || null,
      base_rate: parseFloat(form.base_rate) || 0,
      status: form.status,
      active: form.active,
    };

    if (editTarget) {
      const { error: e } = await supabase.from('people').update(payload).eq('id', editTarget.id);
      if (e) { setError(e.message); setSaving(false); return; }
    } else {
      const { error: e } = await supabase.from('people').insert(payload);
      if (e) { setError(e.message); setSaving(false); return; }
    }

    setSaving(false);
    setShowModal(false);
    await load();
  }

  async function toggleActive(p: Person) {
    await supabase.from('people').update({ active: !p.active }).eq('id', p.id);
    await load();
  }

  async function addWarning(p: Person) {
    const newWarnings = p.warnings + 1;
    const newStatus: PersonStatus = newWarnings >= 2 ? 'flagged' : 'warning';
    await supabase.from('people').update({ warnings: newWarnings, status: newStatus }).eq('id', p.id);
    await load();
  }

  const roleColor: Record<string, string> = {
    admin: 'bg-red-900/40 text-red-300',
    manager: 'bg-orange-900/40 text-orange-300',
    editor: 'bg-blue-900/40 text-blue-300',
    ai_creator: 'bg-teal-900/40 text-teal-300',
    scriptwriter: 'bg-violet-900/40 text-violet-300',
    lander_builder: 'bg-cyan-900/40 text-cyan-300',
    qc: 'bg-yellow-900/40 text-yellow-300',
    media_buyer: 'bg-green-900/40 text-green-300',
  };

  return (
    <div className="p-4 lg:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">People</h1>
          <p className="text-sm text-slate-500 mt-0.5">{people.length} team member{people.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors">
            <RefreshCw size={16} />
          </button>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
          >
            <Plus size={16} />
            Add Person
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40 text-slate-500">
          <div className="w-6 h-6 border-2 border-slate-700 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Name</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide hidden md:table-cell">Email</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Role</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide hidden sm:table-cell">Level</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide hidden sm:table-cell">Warn</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
                <th className="text-right px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {people.map(p => (
                <tr key={p.id} className={`hover:bg-slate-800/40 transition-colors ${!p.active ? 'opacity-40' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-slate-300 text-xs font-semibold flex-shrink-0">
                        {p.name[0]?.toUpperCase() ?? '?'}
                      </div>
                      <span className="text-slate-100 font-medium truncate max-w-32">{p.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs hidden md:table-cell">{p.email}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${roleColor[p.role] ?? 'bg-slate-700 text-slate-300'}`}>
                      {ROLE_LABELS[p.role]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 hidden sm:table-cell">L{p.current_level}</td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    {p.warnings > 0 ? (
                      <span className={`font-semibold ${p.warnings >= 2 ? 'text-red-400' : 'text-orange-400'}`}>{p.warnings}</span>
                    ) : (
                      <span className="text-slate-700">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium ${PERSON_STATUS_COLORS[p.status]}`}>
                      {STATUS_LABELS[p.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(p)}
                        title="Edit"
                        className="p-1.5 text-slate-500 hover:text-slate-200 hover:bg-slate-700 rounded transition-colors"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => toggleActive(p)}
                        title={p.active ? 'Deactivate' : 'Activate'}
                        className="p-1.5 text-slate-500 hover:text-slate-200 hover:bg-slate-700 rounded transition-colors"
                      >
                        {p.active ? <UserX size={13} /> : <UserCheck size={13} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <Modal title={editTarget ? 'Edit Person' : 'Add Person'} onClose={() => setShowModal(false)}>
          <div className="space-y-4">
            {error && (
              <div className="px-3 py-2 rounded-lg bg-red-900/30 border border-red-800/50 text-sm text-red-300">{error}</div>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Full Name</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Jane Doe"
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="jane@company.com"
                disabled={!!editTarget}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              />
              {editTarget && <p className="text-xs text-slate-600 mt-1">Email cannot be changed.</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Role</label>
              <select
                value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value as Role }))}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {ROLES.map(r => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Pay Model</label>
                <select
                  value={form.pay_model}
                  onChange={e => setForm(f => ({ ...f, pay_model: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="level">Level-based</option>
                  <option value="per_batch">Per Batch</option>
                  <option value="fixed">Fixed</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Base Rate (USD)</label>
                <input
                  type="number"
                  value={form.base_rate}
                  onChange={e => setForm(f => ({ ...f, base_rate: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            {editTarget && (
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Status</label>
                <select
                  value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value as PersonStatus }))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="ok">OK</option>
                  <option value="warning">Warning</option>
                  <option value="flagged">Flagged for layoff</option>
                </select>
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="active"
                checked={form.active}
                onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                className="rounded border-slate-600 bg-slate-800"
              />
              <label htmlFor="active" className="text-sm text-slate-300">Active</label>
            </div>
            {!editTarget && (
              <div className="pt-2 border-t border-slate-800">
                <p className="text-xs text-slate-500">
                  After creating this record, the person signs in on the login page with this email to set their password.
                </p>
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name || !form.email}
                className="flex-1 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors"
              >
                {saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Create Person'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
