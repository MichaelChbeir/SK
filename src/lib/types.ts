export type Role =
  | 'scriptwriter'
  | 'lander_builder'
  | 'ai_creator'
  | 'editor'
  | 'qc'
  | 'media_buyer'
  | 'manager'
  | 'admin';

// DB enum: batch_status_type
export type BatchStatus =
  | 'new'
  | 'scripting'
  | 'building_landers'
  | 'ready_to_create'
  | 'creating'
  | 'ready_to_edit'
  | 'editing'
  | 'in_review'
  | 'needs_edits'
  | 'approved'
  | 'testing'
  | 'loser'
  | 'winner'
  | 'super_winner'
  | 'iterating'
  | 'died'
  | 'discarded';

// DB enum: format_type
export type BatchFormat =
  | 'animation'
  | 'vsl'
  | 'ugc_talking_head'
  | 'long_form_ugc'
  | 'product_demo_broll'
  | 'podcast_clip'
  | 'static_image';

// DB enum: person_status_type
export type PersonStatus = 'ok' | 'warning' | 'flagged';

// DB enum: pay_status_type
export type PayStatusType = 'pending' | 'payable' | 'discarded' | 'paid';

// DB enum: outcome_type
export type OutcomeType = 'loser' | 'winner' | 'super_winner';

// DB enum: pay_model_type
export type PayModel = 'level' | 'per_batch' | 'fixed';

export interface Client {
  id: string;
  name: string;
  platform: string | null;
  we_script: boolean;
  monthly_purchase: number;
  weekly_target: number;
  active: boolean;
  created_at: string;
}

export interface Product {
  id: string;
  client_id: string;
  name: string;
  copy_doc_url: string | null;
  has_pdp: boolean;
  has_advertorial: boolean;
  broll_ready: boolean;
}

export interface Person {
  id: string;
  name: string;
  email: string;
  role: Role;          // primary role
  roles: Role[];       // all roles (DB array column)
  pay_model: PayModel | null;
  base_rate: number;
  current_level: number;
  current_score: number;
  warnings: number;
  status: PersonStatus;
  active: boolean;
  created_at: string;
}

export interface Batch {
  id: string;
  client_id: string | null;
  product_id: string | null;
  name: string;
  format: BatchFormat | null;
  status: BatchStatus;
  current_status_since: string;
  scriptwriter_id: string | null;
  creator_id: string | null;
  editor_id: string | null;
  qc_id: string | null;
  media_buyer_id: string | null;
  brief_url: string | null;
  creative_url: string | null;
  lander_urls: string[] | null;
  headlines: string | null;
  primary_texts: string | null; // jsonb stored as array
  ad_name_in_platform: string | null;
  hooks: number | null;
  minutes: number | null;
  quality: number | null;
  internal_revisions: number;
  client_revisions: number;
  outcome: OutcomeType | null;
  spend: number | null;
  roas: number | null;
  hook_rate: number | null;
  purchases: number | null;
  pay_status: PayStatusType;
  created_at: string;
  approved_at: string | null;
  updated_at: string;
  // joined via PostgREST
  client?: Client;
  product?: Product;
  scriptwriter?: Person;
  creator?: Person;
  editor?: Person;
  qc?: Person;
  media_buyer?: Person;
}

export interface StatusEvent {
  id: string;
  batch_id: string;
  from_status: string | null;
  to_status: string;
  changed_by: string | null;
  changed_at: string;
}

export interface TimeEntry {
  id: string;
  batch_id: string;
  person_id: string;
  stage: string | null;
  started_at: string;
  stopped_at: string | null;
}

export interface PayRecord {
  id: string;
  person_id: string;
  period: string;
  level: number | null;
  score: number;
  base_usd: number;
  top3_bonus_usd: number;
  winner_bonus_usd: number;
  super_winner_bonus_usd: number;
  total_usd: number;
  total_pkr: number;
  status: string;
  created_at: string;
}

export interface Level {
  level: number;
  name: string;
  min_score: number;
  max_score: number | null;
  monthly_pay_usd: number;
}

export interface FormatWeight {
  format: string;
  weight: number;
}

export interface QualityFactor {
  score: number;
  factor: number;
}

export interface Setting {
  key: string;
  value: string;
  note: string | null;
}

export const FORMAT_LABELS: Record<BatchFormat, string> = {
  animation: 'Animation',
  vsl: 'VSL',
  ugc_talking_head: 'UGC Talking Head',
  long_form_ugc: 'Long Form UGC',
  product_demo_broll: 'Product Demo / B-roll',
  podcast_clip: 'Podcast Clip',
  static_image: 'Static Image',
};

export const ALL_FORMATS: BatchFormat[] = [
  'ugc_talking_head',
  'long_form_ugc',
  'product_demo_broll',
  'animation',
  'vsl',
  'podcast_clip',
  'static_image',
];

export const STATUS_ORDER: BatchStatus[] = [
  'new', 'scripting', 'building_landers', 'ready_to_create', 'creating',
  'ready_to_edit', 'editing', 'in_review', 'needs_edits', 'approved',
  'testing', 'loser', 'winner', 'super_winner', 'iterating', 'died', 'discarded',
];

export const STATUS_LABELS: Record<BatchStatus, string> = {
  new: 'New',
  scripting: 'Scripting',
  building_landers: 'Building Landers',
  ready_to_create: 'Ready to Create',
  creating: 'Creating',
  ready_to_edit: 'Ready to Edit',
  editing: 'Editing',
  in_review: 'In Review',
  needs_edits: 'Needs Edits',
  approved: 'Approved',
  testing: 'Testing',
  loser: 'Loser',
  winner: 'Winner',
  super_winner: 'Super Winner',
  iterating: 'Iterating',
  died: 'Died',
  discarded: 'Discarded',
};

export const STATUS_COLORS: Record<BatchStatus, string> = {
  new: 'bg-slate-700 text-slate-300',
  scripting: 'bg-violet-900 text-violet-300',
  building_landers: 'bg-blue-900 text-blue-300',
  ready_to_create: 'bg-cyan-900 text-cyan-300',
  creating: 'bg-teal-900 text-teal-300',
  ready_to_edit: 'bg-sky-900 text-sky-300',
  editing: 'bg-indigo-900 text-indigo-300',
  in_review: 'bg-yellow-900 text-yellow-300',
  needs_edits: 'bg-orange-900 text-orange-300',
  approved: 'bg-green-900 text-green-300',
  testing: 'bg-emerald-900 text-emerald-300',
  loser: 'bg-red-900 text-red-300',
  winner: 'bg-lime-900 text-lime-300',
  super_winner: 'bg-green-800 text-green-200',
  iterating: 'bg-purple-900 text-purple-300',
  died: 'bg-slate-700 text-slate-400',
  discarded: 'bg-slate-800 text-slate-500',
};

export const ROLE_LABELS: Record<Role, string> = {
  scriptwriter: 'Scriptwriter',
  lander_builder: 'Lander Builder',
  ai_creator: 'AI Creator',
  editor: 'Editor',
  qc: 'QC',
  media_buyer: 'Media Buyer',
  manager: 'Manager',
  admin: 'Admin',
};

export const PERSON_STATUS_COLORS: Record<PersonStatus, string> = {
  ok: 'text-green-400',
  warning: 'text-orange-400',
  flagged: 'text-red-400',
};
