import { STATUS_COLORS, STATUS_LABELS, type BatchStatus } from '../lib/types';

interface Props {
  status: BatchStatus;
  className?: string;
}

export default function StatusBadge({ status, className = '' }: Props) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[status]} ${className}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}
