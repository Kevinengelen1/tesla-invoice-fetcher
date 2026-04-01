import type { SortDirection } from '../components/SortableHeader';

type SortValue = string | number | boolean | Date | null | undefined;

function normalize(value: SortValue): string | number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value;
  return String(value ?? '').toLocaleLowerCase();
}

function compare(left: SortValue, right: SortValue): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;

  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);

  if (typeof normalizedLeft === 'number' && typeof normalizedRight === 'number') {
    return normalizedLeft - normalizedRight;
  }

  return String(normalizedLeft).localeCompare(String(normalizedRight), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

export function sortBy<T>(items: T[], direction: SortDirection, accessor: (item: T) => SortValue): T[] {
  const factor = direction === 'asc' ? 1 : -1;
  return [...items].sort((left, right) => compare(accessor(left), accessor(right)) * factor);
}