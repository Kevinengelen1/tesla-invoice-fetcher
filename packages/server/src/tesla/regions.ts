import { Region } from '../types/models.js';

export const TESLA_REGIONS: Record<Region, { label: string; fleetApiBase: string; authBase: string; ownershipBase: string }> = {
  NA: {
    label: 'North America / Asia-Pacific',
    fleetApiBase: 'https://fleet-api.prd.na.vn.cloud.tesla.com',
    authBase: 'https://auth.tesla.com',
    ownershipBase: 'https://ownership.tesla.com',
  },
  EU: {
    label: 'Europe / Middle East / Africa',
    fleetApiBase: 'https://fleet-api.prd.eu.vn.cloud.tesla.com',
    authBase: 'https://auth.tesla.com',
    ownershipBase: 'https://ownership.tesla.com',
  },
  CN: {
    label: 'China',
    fleetApiBase: 'https://fleet-api.prd.cn.vn.cloud.tesla.cn',
    authBase: 'https://auth.tesla.cn',
    ownershipBase: 'https://ownership.tesla.cn',
  },
};
