const React = require('react');
const ReactNative = require('react-native');

const keyboardHeight = new ReactNative.Animated.Value(0);

module.exports = {
  KeyboardProvider: ({ children }) => React.createElement(React.Fragment, null, children),
  KeyboardAvoidingView: ReactNative.View,
  useKeyboardAnimation: () => ({ height: keyboardHeight }),
  useAnimatedKeyboard: () => ({ height: { value: 0 }, state: { value: 4 } }),
};
