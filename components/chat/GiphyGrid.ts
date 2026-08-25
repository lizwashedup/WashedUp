// Thin re-export so MediaPanel.tsx never imports @giphy/react-native-sdk
// directly — the .web.ts stub sibling keeps Metro's web bundle from having
// to resolve it (native-only, imports react-native's codegenNativeComponent
// internals — cannot bundle for web).
export { GiphyGridView, GiphyContent } from '@giphy/react-native-sdk';
