/**
 * Tests for TopNav component
 * Note: TopNav renders differently on mobile vs web
 * These tests verify basic functionality
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import TopNav from '../TopNav';

// Mock the useAuth hook
const mockSignOut = jest.fn();
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'test-user', email: 'test@example.com' },
    role: 'supervisor',
    signOut: mockSignOut,
  }),
}));

// Mock the useUnsavedChanges hook
jest.mock('../../contexts/UnsavedChangesContext', () => ({
  useUnsavedChanges: () => ({
    hasUnsavedChanges: false,
    setHasUnsavedChanges: jest.fn(),
  }),
}));

describe('TopNav', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render without crashing', () => {
    const { root } = render(<TopNav />);
    expect(root).toBeTruthy();
  });

  it('should render logo', () => {
    const { root } = render(<TopNav />);
    // TopNav renders an Image component for the logo
    const images = root.findAllByType('Image');
    expect(images.length).toBeGreaterThan(0);
  });

  // Note: Full navigation item tests require Platform.OS mocking
  // which is complex with React Native Testing Library
  // These basic tests verify the component renders
});

