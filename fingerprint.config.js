// Native source edits must affect the runtime even though node_modules is not
// tracked. Keep future native builds distinct from binaries without this patch.
module.exports = {
  extraSources: [
    'patches/screen-stack-retirement.json',
    'patches/react-native-screens-4.16.0-ios-retirement.patch',
    'scripts/native/screen-stack-retirement.cjs',
    'plugins/withScreenStackRetirement.js',
  ].map(filePath => ({ type: 'file', filePath, reasons: ['washedup-native-retirement'] })),
};
