/**
 * Jest setup: mock native modules that pure-logic tests pull in transitively
 * (lib/supabase imports AsyncStorage at module load). Official mock per the
 * @react-native-async-storage docs.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
