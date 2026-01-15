// Jest setup file for React Native testing
import '@testing-library/jest-native/extend-expect';

// Fix for React 19 compatibility - ensure global objects exist
if (typeof global !== 'undefined') {
  global.requestAnimationFrame = global.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
  global.cancelAnimationFrame = global.cancelAnimationFrame || ((id) => clearTimeout(id));
}

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Mock expo-router
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  }),
  usePathname: () => '/test',
  useLocalSearchParams: () => ({}),
  useSegments: () => [],
  Redirect: ({ href }) => `Redirect to ${href}`,
}));

// Mock expo-constants
jest.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: {},
    },
  },
}));

// Mock react-native-safe-area-context
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaView: ({ children, ...props }) => React.createElement('View', props, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

// Mock @react-navigation/native
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback) => callback(),
  useNavigation: () => ({
    navigate: jest.fn(),
    goBack: jest.fn(),
  }),
}));

// Mock expo-image-picker
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  MediaTypeOptions: {
    Images: 'images',
  },
}));

// Mock expo-file-system
jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///test/',
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
}));

// expo-font is mocked via __mocks__/expo-font.js

// Suppress console warnings in tests (optional)
global.console = {
  ...console,
  warn: jest.fn(),
  error: jest.fn(),
};

