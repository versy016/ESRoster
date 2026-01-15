/**
 * Tests for date utility functions
 */

import { format, parseISO, addDays, startOfWeek } from 'date-fns';

describe('Date utility functions', () => {
  describe('Date formatting', () => {
    it('should format dates correctly', () => {
      const date = new Date('2025-01-15');
      const formatted = format(date, 'yyyy-MM-dd');
      expect(formatted).toBe('2025-01-15');
    });

    it('should parse ISO date strings', () => {
      const dateString = '2025-01-15';
      const parsed = parseISO(dateString);
      expect(parsed.getFullYear()).toBe(2025);
      expect(parsed.getMonth()).toBe(0); // January is 0
      expect(parsed.getDate()).toBe(15);
    });
  });

  describe('Date arithmetic', () => {
    it('should add days correctly', () => {
      const startDate = new Date('2025-01-15');
      const nextDate = addDays(startDate, 1);
      expect(format(nextDate, 'yyyy-MM-dd')).toBe('2025-01-16');
    });

    it('should get start of week (Monday)', () => {
      const date = new Date('2025-01-15'); // Wednesday
      const weekStart = startOfWeek(date, { weekStartsOn: 1 }); // Monday
      expect(weekStart.getDay()).toBe(1); // Monday
    });
  });

  describe('Date range generation', () => {
    it('should generate date ranges for fortnight', () => {
      const anchorDate = new Date('2025-01-06'); // Monday
      const weekStart = startOfWeek(anchorDate, { weekStartsOn: 1 });
      
      const dates = [];
      for (let i = 0; i < 14; i++) {
        dates.push(format(addDays(weekStart, i), 'yyyy-MM-dd'));
      }

      expect(dates).toHaveLength(14);
      expect(dates[0]).toBe('2025-01-06');
      expect(dates[13]).toBe('2025-01-19');
    });
  });
});

