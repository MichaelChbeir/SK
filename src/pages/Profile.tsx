import { useEffect, useState } from 'react';
import { Award, TrendingUp, Calendar, Star } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Batch, Level, PayRecord } from '../lib/types';
import { PERSON_STATUS_COLORS } from '../lib/types';

function startOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

function startOfLastMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() - 1, 1).toISOString();
}

function endOfLastMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 0, 23, 59, 59).toISOString();
}

function startOfWeek() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString();
}

function startOfLastWeek() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay() - 7);
  return d.toISOString();
}

function endOfLastWeek() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay() - 1);
  d.setHours(23, 59, 59);
  return d.toISOString();
}

const PRODUCTION_ROLES = ['editor', 'ai_creator', 'scriptwriter', 'lander_builder'];

export default function Profile() {
  const { person } = useAuth();
  const [levels, setLevels] = useState<Level[]>([]);
  const [payRecord, setPayRecord] = useState<PayRecord | null>(null);
  const [thisWeek, setThisWeek] = useState(0);
  const [lastWeek, setLastWeek] = useState(0);
  const [thisMonth, setThisMonth] = useState(0);
  const [avgQuality, setAvgQuality] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const isProduction = person ? PRODUCTION_ROLES.includes(person.role) : false;
  const isAdmin = person?.role === 'admin' || person?.role === 'manager';

  useEffect(() => { if (person) load(); }, [person]);

  async function load() {
    if (!person) return;
    setLoading(true);

    const period = new Date().toISOString().slice(0, 7);

    const [{ data: lvls }, { data: pr }, { data: weekBatches }, { data: lastWeekBatches }, { data: monthBatches }] = await Promise.all([
      supabase.from('levels').select('*').order('level'),
      supabase.from('pay_records').select('*').eq('person_id', person.id).eq('period', period).maybeSingle(),
      supabase.from('batches').select('id, quality').eq('status', 'approved').or(`editor_id.eq.${person.id},creator_id.eq.${person.id},scriptwriter_id.eq.${person.id}`).gte('approved_at', startOfWeek()),
      supabase.from('batches').select('id').eq('status', 'approved').or(`editor_id.eq.${person.id},creator_id.eq.${person.id},scriptwriter_id.eq.${person.id}`).gte('approved_at', startOfLastWeek()).lte('approved_at', endOfLastWeek()),
      supabase.from('batches').select('id, quality').eq('status', 'approved').or(`editor_id.eq.${person.id},creator_id.eq.${person.id},scriptwriter_id.eq.${person.id}`).gte('approved_at', startOfMonth()),
    ]);

    setLevels((lvls ?? []) as Level[]);
    setPayRecord((pr as PayRecord) ?? null);
    setThisWeek(weekBatches?.length ?? 0);
    setLastWeek(lastWeekBatches?.length ?? 0);
    setThisMonth(monthBatches?.length ?? 0);

    const withQuality = [...(weekBatches ?? []), ...(monthBatches ?? [])].filter(b => b.quality != null);
    if (withQuality.length > 0) {
      setAvgQuality(withQuality.reduce((sum, b) => sum + (b.quality ?? 0), 0) / withQuality.length);
    }

    setLoading(false);
  }

  if (loading || !person) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        <div className="w-6 h-6 border-2 border-slate-700 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  const currentLevel = levels.find(l => l.level === person.current_level);
  const nextLevel = levels.find(l => l.level === (person.current_level + 1));
  const progressPct = currentLevel && nextLevel
    ? Math.min(((person.current_score - currentLevel.min_score) / (nextLevel.min_score - currentLevel.min_score)) * 100, 100)
    : 100;

  const statusColor = PERSON_STATUS_COLORS[person.status] ?? 'text-slate-400';

  const kickers = payRecord
    ? (payRecord.top3_bonus_usd ?? 0) + (payRecord.winner_bonus_usd ?? 0) + (payRecord.super_winner_bonus_usd ?? 0)
    : 0;

  return (
    <div className="p-4 lg:p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">My Profile</h1>
      </div>

      {/* Identity card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 mb-5">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-blue-600/20 border border-blue-500/20 flex items-center justify-center text-2xl font-bold text-blue-300">
            {person.name[0].toUpperCase()}
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">{person.name}</h2>
            <p className="text-slate-400 capitalize">{person.role.replace('_', ' ')}</p>
            <div className="flex items-center gap-3 mt-1">
              <span className={`text-xs font-medium ${statusColor}`}>● {person.status}</span>
              {person.warnings > 0 && (
                <span className={`text-xs font-medium ${person.warnings >= 2 ? 'text-red-400' : 'text-orange-400'}`}>
                  ⚠ {person.warnings} warning{person.warnings > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Level & pay (production roles only) */}
      {isProduction && currentLevel && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 mb-5">
          <div className="flex items-center gap-2 mb-4">
            <Award size={18} className="text-yellow-400" />
            <h3 className="text-sm font-semibold text-slate-200">Level & Pay</h3>
          </div>

          <div className="flex items-baseline gap-3 mb-4">
            <div>
              <p className="text-3xl font-bold text-white">L{currentLevel.level}</p>
              <p className="text-sm text-slate-400">{currentLevel.name}</p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-2xl font-bold text-green-400">${currentLevel.monthly_pay_usd.toLocaleString()}</p>
              <p className="text-xs text-slate-500">/month</p>
            </div>
          </div>

          {nextLevel && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-slate-500">Progress to L{nextLevel.level} — {nextLevel.name}</span>
                <span className="text-xs text-slate-400">{Math.round(progressPct)}%</span>
              </div>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Kickers */}
      {isProduction && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 mb-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={18} className="text-green-400" />
            <h3 className="text-sm font-semibold text-slate-200">Bonuses This Month</h3>
          </div>
          {kickers > 0 ? (
            <div className="space-y-2">
              {(payRecord?.top3_bonus_usd ?? 0) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Top 3 bonus</span>
                  <span className="text-yellow-400 font-medium">+${payRecord!.top3_bonus_usd}</span>
                </div>
              )}
              {(payRecord?.winner_bonus_usd ?? 0) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Winner kickers</span>
                  <span className="text-lime-400 font-medium">+${payRecord!.winner_bonus_usd}</span>
                </div>
              )}
              {(payRecord?.super_winner_bonus_usd ?? 0) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Super winner kickers</span>
                  <span className="text-green-400 font-medium">+${payRecord!.super_winner_bonus_usd}</span>
                </div>
              )}
              <div className="border-t border-slate-800 pt-2 flex justify-between text-sm font-semibold">
                <span className="text-slate-300">Total bonuses</span>
                <span className="text-green-400">+${kickers}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-600">No bonuses yet this month.</p>
          )}
        </div>
      )}

      {/* Activity */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <Calendar size={18} className="text-blue-400" />
          <h3 className="text-sm font-semibold text-slate-200">Activity</h3>
        </div>
        <div className="grid grid-cols-3 gap-4 mb-4">
          {[
            { label: 'This Week', value: thisWeek },
            { label: 'Last Week', value: lastWeek },
            { label: 'This Month', value: thisMonth },
          ].map(({ label, value }) => (
            <div key={label} className="text-center">
              <p className="text-2xl font-bold text-white">{value}</p>
              <p className="text-xs text-slate-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
        {avgQuality != null && (
          <div className="flex items-center gap-2 pt-3 border-t border-slate-800">
            <Star size={14} className="text-yellow-400" />
            <span className="text-sm text-slate-400">Avg quality:</span>
            <span className="text-sm font-semibold text-yellow-300">{avgQuality.toFixed(1)} / 5</span>
          </div>
        )}
      </div>
    </div>
  );
}
