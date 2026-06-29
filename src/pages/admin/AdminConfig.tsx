import { useEffect, useState } from 'react';
import { Save, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Level, Setting, FormatWeight, QualityFactor } from '../../lib/types';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-800 bg-slate-800/30">
        <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export default function AdminConfig() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [formatWeights, setFormatWeights] = useState<FormatWeight[]>([]);
  const [qualityFactors, setQualityFactors] = useState<QualityFactor[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    const [{ data: s }, { data: l }, { data: f }, { data: q }] = await Promise.all([
      supabase.from('settings').select('*').order('key'),
      supabase.from('levels').select('*').order('level'),
      supabase.from('format_weights').select('*').order('format'),
      supabase.from('quality_factors').select('*').order('score'),
    ]);
    setSettings((s ?? []) as Setting[]);
    setLevels((l ?? []) as Level[]);
    setFormatWeights((f ?? []) as FormatWeight[]);
    setQualityFactors((q ?? []) as QualityFactor[]);
  }

  function flash(key: string) {
    setSaved(key);
    setTimeout(() => setSaved(null), 2000);
  }

  async function saveSettings() {
    setSaving('settings');
    for (const s of settings) {
      await supabase.from('settings').update({ value: s.value }).eq('key', s.key);
    }
    setSaving(null);
    flash('settings');
  }

  async function saveLevels() {
    setSaving('levels');
    for (const l of levels) {
      await supabase.from('levels').upsert({ level: l.level, name: l.name, min_score: l.min_score, max_score: l.max_score, monthly_pay_usd: l.monthly_pay_usd });
    }
    setSaving(null);
    flash('levels');
  }

  async function saveFormats() {
    setSaving('formats');
    for (const f of formatWeights) {
      await supabase.from('format_weights').upsert({ format: f.format, weight: f.weight });
    }
    setSaving(null);
    flash('formats');
  }

  async function saveQuality() {
    setSaving('quality');
    for (const q of qualityFactors) {
      await supabase.from('quality_factors').upsert({ score: q.score, factor: q.factor });
    }
    setSaving(null);
    flash('quality');
  }

  async function deleteFormat(format: string) {
    await supabase.from('format_weights').delete().eq('format', format);
    setFormatWeights(fw => fw.filter(f => f.format !== format));
  }

  function addFormat() {
    setFormatWeights(fw => [...fw, { format: 'new_format', weight: 1.0 }]);
  }

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Configuration</h1>
        <p className="text-sm text-slate-500 mt-0.5">System settings and pay computation parameters</p>
      </div>

      {/* Settings */}
      <Section title="App Settings">
        <div className="space-y-3">
          {settings.map((s, i) => (
            <div key={s.key} className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-xs font-medium text-slate-400 mb-1">{s.key}</p>
                {s.note && <p className="text-xs text-slate-600">{s.note}</p>}
              </div>
              <input
                type="text"
                value={s.value}
                onChange={e => setSettings(arr => arr.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                className="w-32 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-right"
              />
            </div>
          ))}
        </div>
        <button onClick={saveSettings} disabled={saving === 'settings'} className="mt-4 flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition-colors">
          <Save size={14} />{saved === 'settings' ? 'Saved!' : saving === 'settings' ? 'Saving…' : 'Save Settings'}
        </button>
      </Section>

      {/* Levels */}
      <Section title="Pay Levels">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                {['Level', 'Name', 'Min Score', 'Max Score', 'Monthly Pay (USD)'].map(h => (
                  <th key={h} className="text-left pb-2 pr-3 text-xs font-medium text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40">
              {levels.map((l, i) => (
                <tr key={l.level}>
                  <td className="py-2 pr-3 text-slate-400 font-mono">{l.level}</td>
                  {(['name', 'min_score', 'max_score', 'monthly_pay_usd'] as const).map(field => (
                    <td key={field} className="py-2 pr-3">
                      <input
                        type={field === 'name' ? 'text' : 'number'}
                        value={(l as any)[field]}
                        onChange={e => setLevels(arr => arr.map((x, j) => j === i ? { ...x, [field]: field === 'name' ? e.target.value : parseFloat(e.target.value) } : x))}
                        className="w-full px-2 py-1 rounded bg-slate-800 border border-slate-700/50 text-slate-100 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button onClick={saveLevels} disabled={saving === 'levels'} className="mt-4 flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition-colors">
          <Save size={14} />{saved === 'levels' ? 'Saved!' : saving === 'levels' ? 'Saving…' : 'Save Levels'}
        </button>
      </Section>

      {/* Format Weights */}
      <Section title="Format Weights">
        <div className="space-y-2">
          {formatWeights.map((f, i) => (
            <div key={i} className="flex items-center gap-3">
              <input
                type="text"
                value={f.format}
                onChange={e => setFormatWeights(arr => arr.map((x, j) => j === i ? { ...x, format: e.target.value } : x))}
                className="flex-1 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="number"
                step="0.1"
                value={f.weight}
                onChange={e => setFormatWeights(arr => arr.map((x, j) => j === i ? { ...x, weight: parseFloat(e.target.value) } : x))}
                className="w-24 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button onClick={() => deleteFormat(f.format)} className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={addFormat} className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors">
            <Plus size={14} />Add Format
          </button>
          <button onClick={saveFormats} disabled={saving === 'formats'} className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition-colors">
            <Save size={14} />{saved === 'formats' ? 'Saved!' : saving === 'formats' ? 'Saving…' : 'Save Formats'}
          </button>
        </div>
      </Section>

      {/* Quality Factors */}
      <Section title="Quality Multipliers">
        <div className="space-y-2">
          {qualityFactors.map((q, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="text-sm text-slate-400 w-16">Score {q.score}</span>
              <input
                type="number"
                step="0.05"
                value={q.factor}
                onChange={e => setQualityFactors(arr => arr.map((x, j) => j === i ? { ...x, factor: parseFloat(e.target.value) } : x))}
                className="w-24 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-xs text-slate-600">×</span>
            </div>
          ))}
        </div>
        <button onClick={saveQuality} disabled={saving === 'quality'} className="mt-4 flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition-colors">
          <Save size={14} />{saved === 'quality' ? 'Saved!' : saving === 'quality' ? 'Saving…' : 'Save Quality Factors'}
        </button>
      </Section>
    </div>
  );
}
