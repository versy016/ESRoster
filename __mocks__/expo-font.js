// Mock for expo-font
export default {
  loadAsync: jest.fn(() => Promise.resolve()),
  isLoaded: jest.fn(() => true),
};

export const loadAsync = jest.fn(() => Promise.resolve());
export const isLoaded = jest.fn(() => true);

