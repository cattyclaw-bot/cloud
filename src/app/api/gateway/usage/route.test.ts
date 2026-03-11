import { describe, test, expect, afterEach, jest } from '@jest/globals';
import { NextResponse } from 'next/server';

// Mock dependencies
jest.mock('@/lib/user.server', () => ({
  getUserFromAuth: jest.fn(),
}));

jest.mock('@sentry/nextjs', () => ({
  captureException: jest.fn(),
}));

const mockGetBalanceAndOrgSettings = jest.fn();
jest.mock('@/lib/organizations/organization-usage', () => ({
  getBalanceAndOrgSettings: (...args: unknown[]) => mockGetBalanceAndOrgSettings(...args),
}));

const mockDbSelectResult = jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]);
const mockDbChain = {
  from: jest.fn().mockReturnThis(),
  leftJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  limit: jest.fn(() => mockDbSelectResult()),
};
jest.mock('@/lib/drizzle', () => ({
  db: {
    select: jest.fn(() => mockDbChain),
  },
}));

jest.mock('@kilocode/db/schema', () => ({
  organization_user_limits: { microdollar_limit: 'microdollar_limit', organization_id: 'organization_id', kilo_user_id: 'kilo_user_id', limit_type: 'limit_type' },
  organization_user_usage: { microdollar_usage: 'microdollar_usage', organization_id: 'organization_id', kilo_user_id: 'kilo_user_id', limit_type: 'limit_type', usage_date: 'usage_date' },
  organizations: { id: 'id', total_microdollars_acquired: 'total_microdollars_acquired', microdollars_used: 'microdollars_used', plan: 'plan' },
}));

jest.mock('drizzle-orm', () => ({
  and: jest.fn((...args: unknown[]) => args),
  eq: jest.fn((a: unknown, b: unknown) => [a, b]),
  sql: { raw: jest.fn() },
}));

// Import after mocks
const { getUserFromAuth } = await import('@/lib/user.server');
const { captureException } = await import('@sentry/nextjs');
const { GET } = await import('./route');

describe('GET /api/gateway/usage', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockDbSelectResult.mockResolvedValue([]);
  });

  test('returns 401 if not authenticated', async () => {
    const authResponse = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    (getUserFromAuth as jest.Mock).mockResolvedValue({
      user: null,
      authFailedResponse: authResponse,
    });

    const response = await GET(new Request('http://localhost:3000/api/gateway/usage'));

    expect(response.status).toBe(401);
  });

  test('returns empty limits and balance for non-org user', async () => {
    (getUserFromAuth as jest.Mock).mockResolvedValue({
      user: { id: 'user-1' },
      authFailedResponse: null,
      organizationId: undefined,
    });

    mockGetBalanceAndOrgSettings.mockResolvedValue({
      balance: 3.50,
      plan: null,
    });

    const response = await GET(new Request('http://localhost:3000/api/gateway/usage'));

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.limits).toEqual([]);
    expect(data.plan).toBeNull();
    expect(data.balance_usd).toBe(3.50);
  });

  test('returns daily limit for org user with limit configured', async () => {
    (getUserFromAuth as jest.Mock).mockResolvedValue({
      user: { id: 'user-1' },
      authFailedResponse: null,
      organizationId: 'org-1',
    });

    mockGetBalanceAndOrgSettings.mockResolvedValue({
      balance: 10.00,
      plan: 'teams',
    });

    mockDbSelectResult.mockResolvedValue([{
      microdollarLimit: 2000000, // $2.00
      microdollarUsage: 1500000, // $1.50
    }]);

    const response = await GET(new Request('http://localhost:3000/api/gateway/usage'));

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.limits).toHaveLength(1);
    expect(data.limits[0].period).toBe('daily');
    expect(data.limits[0]).toHaveProperty('used');
    expect(data.limits[0]).toHaveProperty('limit');
    expect(data.limits[0]).toHaveProperty('reset_at');
    expect(data.plan).toBe('teams');
    expect(data.balance_usd).toBe(10.00);
  });

  test('returns empty limits for user with no limit configured (unlimited)', async () => {
    (getUserFromAuth as jest.Mock).mockResolvedValue({
      user: { id: 'user-1' },
      authFailedResponse: null,
      organizationId: 'org-1',
    });

    mockGetBalanceAndOrgSettings.mockResolvedValue({
      balance: 5.00,
      plan: 'teams',
    });

    mockDbSelectResult.mockResolvedValue([{
      microdollarLimit: null,
      microdollarUsage: 0,
    }]);

    const response = await GET(new Request('http://localhost:3000/api/gateway/usage'));

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.limits).toEqual([]);
    expect(data.balance_usd).toBe(5.00);
  });

  test('returns 500 and reports to Sentry on error', async () => {
    (getUserFromAuth as jest.Mock).mockRejectedValue(new Error('DB connection failed'));

    const response = await GET(new Request('http://localhost:3000/api/gateway/usage'));

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe('Internal Server Error');
    expect(captureException).toHaveBeenCalled();
  });
});
