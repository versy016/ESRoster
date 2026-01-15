/**
 * Tests for roster validation rules
 */

import {
  isWeekend,
  isSaturday,
  isSunday,
  isWeekday,
  validateRoster,
  SHIFT,
} from '../rules';

describe('Date utility functions', () => {
  describe('isWeekend', () => {
    it('should return true for Saturday', () => {
      const saturday = new Date('2025-01-04'); // Saturday
      expect(isWeekend(saturday)).toBe(true);
    });

    it('should return true for Sunday', () => {
      const sunday = new Date('2025-01-05'); // Sunday
      expect(isWeekend(sunday)).toBe(true);
    });

    it('should return false for weekdays', () => {
      const monday = new Date('2025-01-06'); // Monday
      const friday = new Date('2025-01-10'); // Friday
      expect(isWeekend(monday)).toBe(false);
      expect(isWeekend(friday)).toBe(false);
    });
  });

  describe('isSaturday', () => {
    it('should return true for Saturday', () => {
      const saturday = new Date('2025-01-04');
      expect(isSaturday(saturday)).toBe(true);
    });

    it('should return false for other days', () => {
      const sunday = new Date('2025-01-05');
      const monday = new Date('2025-01-06');
      expect(isSaturday(sunday)).toBe(false);
      expect(isSaturday(monday)).toBe(false);
    });
  });

  describe('isSunday', () => {
    it('should return true for Sunday', () => {
      const sunday = new Date('2025-01-05');
      expect(isSunday(sunday)).toBe(true);
    });

    it('should return false for other days', () => {
      const saturday = new Date('2025-01-04');
      const monday = new Date('2025-01-06');
      expect(isSunday(saturday)).toBe(false);
      expect(isSunday(monday)).toBe(false);
    });
  });

  describe('isWeekday', () => {
    it('should return true for Monday-Friday', () => {
      const monday = new Date('2025-01-06');
      const wednesday = new Date('2025-01-08');
      const friday = new Date('2025-01-10');
      expect(isWeekday(monday)).toBe(true);
      expect(isWeekday(wednesday)).toBe(true);
      expect(isWeekday(friday)).toBe(true);
    });

    it('should return false for weekends', () => {
      const saturday = new Date('2025-01-04');
      const sunday = new Date('2025-01-05');
      expect(isWeekday(saturday)).toBe(false);
      expect(isWeekday(sunday)).toBe(false);
    });
  });
});

describe('validateRoster', () => {
  const mockSurveyors = [
    { id: 's1', name: 'Surveyor 1', active: true, areaPreference: 'SOUTH', nonAvailability: [] },
    { id: 's2', name: 'Surveyor 2', active: true, areaPreference: 'SOUTH', nonAvailability: [] },
  ];

  const mockAnchorDate = new Date('2025-01-06'); // Monday

  it('should return empty issues for valid roster', () => {
    // Create a valid roster with 9 shifts for each surveyor (required by validation)
    const byDate = {};
    const startDate = new Date(mockAnchorDate);
    
    // Add 9 shifts for s1 (day worker) - Mon-Fri, skipping Sundays
    let shiftCount = 0;
    for (let i = 0; i < 14 && shiftCount < 9; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const dateKey = date.toISOString().split('T')[0];
      const dayOfWeek = date.getDay();
      
      // Skip Sundays (no coverage)
      if (dayOfWeek === 0) continue;
      
      if (!byDate[dateKey]) byDate[dateKey] = [];
      byDate[dateKey].push({ surveyorId: 's1', shift: SHIFT.DAY, confirmed: true });
      shiftCount++;
    }
    
    // Add 10 shifts for s2 (night worker) - Mon-Fri only
    shiftCount = 0;
    for (let i = 0; i < 14 && shiftCount < 10; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const dateKey = date.toISOString().split('T')[0];
      const dayOfWeek = date.getDay();
      
      // Night workers only work Mon-Fri
      if (dayOfWeek === 0 || dayOfWeek === 6) continue;
      
      if (!byDate[dateKey]) byDate[dateKey] = [];
      byDate[dateKey].push({ surveyorId: 's2', shift: SHIFT.NIGHT, confirmed: true });
      shiftCount++;
    }

    const issues = validateRoster({
      surveyors: mockSurveyors,
      byDate,
      anchorDate: mockAnchorDate,
      area: 'SOUTH',
    });

    expect(issues).toEqual([]);
  });

  it('should detect duplicate shifts for same surveyor on same day', () => {
    const byDate = {
      '2025-01-06': [
        { surveyorId: 's1', shift: SHIFT.DAY, confirmed: true },
        { surveyorId: 's1', shift: SHIFT.DAY, confirmed: true }, // Duplicate
      ],
    };

    const issues = validateRoster({
      surveyors: mockSurveyors,
      byDate,
      anchorDate: mockAnchorDate,
      area: 'SOUTH',
    });

    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some(issue => issue.includes('multiple working shifts'))).toBe(true);
  });

  it('should detect assignments on non-availability dates', () => {
    const surveyorsWithNonAvail = [
      {
        ...mockSurveyors[0],
        nonAvailability: ['2025-01-06'],
      },
      mockSurveyors[1],
    ];

    const byDate = {
      '2025-01-06': [
        { surveyorId: 's1', shift: SHIFT.DAY, confirmed: true }, // On non-availability date
      ],
    };

    const issues = validateRoster({
      surveyors: surveyorsWithNonAvail,
      byDate,
      anchorDate: mockAnchorDate,
      area: 'SOUTH',
    });

    expect(issues.length).toBeGreaterThan(0);
    // Non-availability shows up in shift count validation message
    expect(issues.some(issue => 
      issue.includes('Not available from') || 
      issue.includes('non-availability') || 
      issue.includes('unavailable')
    )).toBe(true);
  });

  it('should validate demand requirements', () => {
    const byDate = {
      '2025-01-06': [
        { surveyorId: 's1', shift: SHIFT.DAY, confirmed: true },
        // Missing night shift
      ],
    };

    const demand = {
      '2025-01-06': { day: 1, night: 1 },
    };

    const issues = validateRoster({
      surveyors: mockSurveyors,
      byDate,
      anchorDate: mockAnchorDate,
      area: 'SOUTH',
      demand,
    });

    // Should detect missing night shift
    expect(issues.length).toBeGreaterThan(0);
  });

  it('should validate weekend history constraints', () => {
    // Weekend history: worked weekend on 2025-01-04 (Saturday) and 2025-01-05 (Sunday)
    // Anchor date: 2025-01-06 (Monday) - this is within 21 days
    // Assign weekend work on 2025-01-11 (Saturday) - should violate rule
    const weekendHistory = {
      s1: ['2025-01-04', '2025-01-05'], // Worked last weekend
    };

    const byDate = {
      '2025-01-11': [ // Next Saturday (within 21 days of last weekend)
        { surveyorId: 's1', shift: SHIFT.DAY, confirmed: true },
      ],
    };

    const issues = validateRoster({
      surveyors: mockSurveyors,
      byDate,
      anchorDate: mockAnchorDate, // 2025-01-06 (Monday)
      area: 'SOUTH',
      weekendHistory,
    });

    // Should detect weekend work violation (worked last weekend, working this weekend)
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some(issue => issue.includes('weekend rule violated'))).toBe(true);
  });
});

