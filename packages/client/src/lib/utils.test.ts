import { describe, it, expect } from 'vitest';
import { formatBytes, formatCurrency, formatDate, relativeTime } from './utils';

describe('formatBytes', () => {
  it('should format 0', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('should format KB', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
  });

  it('should format MB', () => {
    expect(formatBytes(1048576)).toBe('1.0 MB');
  });

  it('should format fractional MB', () => {
    expect(formatBytes(1572864)).toBe('1.5 MB');
  });
});

describe('formatCurrency', () => {
  it('should format EUR', () => {
    const result = formatCurrency(1250, 'EUR');
    expect(result).toContain('12.50');
  });

  it('should format USD', () => {
    const result = formatCurrency(999, 'USD');
    expect(result).toContain('9.99');
  });
});

describe('formatDate', () => {
  it('should format ISO date string', () => {
    const result = formatDate('2025-01-15');
    expect(result).toContain('2025');
    expect(result).toContain('15');
  });
});

describe('relativeTime', () => {
  it('should return "just now" for recent dates', () => {
    const now = new Date().toISOString();
    expect(relativeTime(now)).toBe('just now');
  });

  it('should return minutes for recent past', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(relativeTime(fiveMinAgo)).toBe('5m ago');
  });

  it('should return hours for older events', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(twoHoursAgo)).toBe('2h ago');
  });

  it('should return days for old events', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(threeDaysAgo)).toBe('3d ago');
  });
});
