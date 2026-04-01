import { describe, it, expect } from 'vitest';
import { TESLA_REGIONS } from '../src/tesla/regions.js';

describe('TESLA_REGIONS', () => {
  it('should have all three regions', () => {
    expect(Object.keys(TESLA_REGIONS)).toEqual(['NA', 'EU', 'CN']);
  });

  it('should have valid API base URLs', () => {
    for (const region of Object.values(TESLA_REGIONS)) {
      expect(region.fleetApiBase).toMatch(/^https:\/\/fleet-api\.prd\./);
      expect(region.authBase).toMatch(/^https:\/\/auth\.tesla\./);
      expect(region.label.length).toBeGreaterThan(0);
    }
  });

  it('CN should use .cn TLD', () => {
    expect(TESLA_REGIONS.CN.fleetApiBase).toContain('.cn');
    expect(TESLA_REGIONS.CN.authBase).toContain('.cn');
  });

  it('NA and EU should use .com TLD', () => {
    expect(TESLA_REGIONS.NA.fleetApiBase).toContain('.com');
    expect(TESLA_REGIONS.EU.fleetApiBase).toContain('.com');
  });
});
