import { z } from 'zod';
import type { SearchInput } from './types.js';

export const timeRangeSchema = z.enum(['day', 'week', 'month', 'year']);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD').refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date');

export function hasTimeFilter(input: SearchInput): boolean {
  return input.timeRange !== undefined || input.startDate !== undefined || input.endDate !== undefined;
}

/** Resolve once per request so every failover receives identical UTC date bounds. */
export function normalizeSearchTime(input: SearchInput, now: number): SearchInput {
  if (input.timeRange !== undefined) timeRangeSchema.parse(input.timeRange);
  if (input.startDate !== undefined) dateSchema.parse(input.startDate);
  if (input.endDate !== undefined) dateSchema.parse(input.endDate);
  if (input.timeRange !== undefined && (input.startDate !== undefined || input.endDate !== undefined)) {
    throw new Error('timeRange cannot be combined with startDate or endDate');
  }
  if (input.startDate && input.endDate && input.startDate > input.endDate) {
    throw new Error('startDate must be on or before endDate');
  }
  if (!input.timeRange) return input;
  const days = { day: 1, week: 7, month: 30, year: 365 }[input.timeRange];
  return { ...input, startDate: new Date(now - days * 86_400_000).toISOString().slice(0, 10), endDate: new Date(now).toISOString().slice(0, 10) };
}

export function describeSearchTime(input: SearchInput): string {
  return [input.timeRange, input.startDate && `from ${input.startDate}`, input.endDate && `through ${input.endDate}`].filter(Boolean).join(' ');
}
