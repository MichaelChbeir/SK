import { useEffect, useState } from 'react';
import { Trophy, Medal, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Person, Level } from '../lib/types';
import { ROLE_LABELS } from '../lib/types';

interface Ranked extends Person {
  rank: number;
}

const PRODUCTION_ROLES = ['editor', 'ai_creator', 'scriptwriter', 'lander_builder'];

export default function Leaderboard() {
  const [people, setPeople] = useState<Ranked[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [{ data: ps }, { data: ls }] = await Promise.all([
      supabase.from('people').select('*').eq('active', true).in('role', PRODUCTION_ROLES).order('current_score', { ascending: false }),
      supabase.from('levels').select('*').order('level'),
    ]);
    setLevels((ls ?? []) as Level[]);
    setPeople(((ps ?? []) as Person[]).map((p, i) => ({ ...p, rank: i + 1 })));
    setLoading(false);
  }

  function levelName(levelNum: number) {
    return levels.find(l => l.level === levelNum)?.name ?? `L${levelNum}`;
  }

  function rankIcon(rank: number) {
    if (rank === 1) return <Trophy size={16} className="text-yellow-400" />;
    if (rank === 2) return <Medal size={16} className="text-slate-300" />;
    if (rank === 3) return <Medal size={16} className="text-amber-600" />;
    return <span className="text-sm text-slate-600 font-mono w-4 text-center">{rank}</span>;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        <div className="w-6 h-6 border-2 border-slate-700 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Trophy size={20} className="text-yellow-400" />
            Leaderboard
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Ranked by performance score</p>
        </div>
        <button onClick={load} className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors">
          <RefreshCw size={16} />
        </button>
      </div>

      {people.length === 0 ? (
        <p className="text-center text-slate-600 py-20">No production staff ranked yet.</p>
      ) : (
        <div className="space-y-2">
          {people.map(p => {
            const lv = levels.find(l => l.level === p.current_level);
            const nextLv = levels.find(l => l.level === p.current_level + 1);
            const pct = lv && nextLv
              ? Math.min(((p.current_score - lv.min_score) / (nextLv.min_score - lv.min_score)) * 100, 100)
              : 100;

            const isTop3 = p.rank <= 3;
            return (
              <div
                key={p.id}
                className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${
                  isTop3
                    ? 'bg-slate-900 border-slate-700'
                    : 'bg-slate-900/50 border-slate-800'
                }`}
              >
                <div className="w-6 flex items-center justify-center flex-shrink-0">
                  {rankIcon(p.rank)}
                </div>
                <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center text-sm font-bold text-slate-200 flex-shrink-0">
                  {p.name[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <p className="text-sm font-semibold text-slate-100">{p.name}</p>
                    <span className="text-xs text-slate-500 capitalize">{ROLE_LABELS[p.role]}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-blue-300 font-medium">
                      L{p.current_level} — {levelName(p.current_level)}
                    </span>
                    {lv && (
                      <div className="flex-1 max-w-24">
                        <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-base font-bold text-white">{Math.round(p.current_score)}</p>
                  <p className="text-xs text-slate-600">pts</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
