import { ArrowUpDown } from 'lucide-react';

export type SortDirection = 'asc' | 'desc';

interface SortableHeaderProps<TField extends string> {
  label: string;
  field: TField;
  currentSort?: TField | string;
  order?: SortDirection;
  onSort: (field: TField) => void;
  align?: 'left' | 'right';
  className?: string;
}

export function SortableHeader<TField extends string>({
  label,
  field,
  currentSort,
  order,
  onSort,
  align = 'left',
  className = '',
}: SortableHeaderProps<TField>) {
  return (
    <th className={`px-4 py-3 font-medium text-muted-foreground ${align === 'right' ? 'text-right' : 'text-left'} ${className}`.trim()}>
      <button
        type="button"
        className={`inline-flex items-center gap-1 hover:text-foreground select-none ${align === 'right' ? 'justify-end' : ''}`}
        onClick={() => onSort(field)}
      >
        <span>{label}</span>
        <ArrowUpDown className={`h-3 w-3 ${currentSort === field ? 'text-primary' : 'opacity-40'}`} />
        {currentSort === field && (
          <span className="text-xs text-primary">{order === 'asc' ? '↑' : '↓'}</span>
        )}
      </button>
    </th>
  );
}