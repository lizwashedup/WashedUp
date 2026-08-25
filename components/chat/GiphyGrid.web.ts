// Web placeholder for components/chat/GiphyGrid.ts. MediaPanel's own
// `gifReady` check (false on web) keeps these from ever actually rendering —
// they exist only so Metro's web bundle never has to resolve the real
// @giphy/react-native-sdk import graph.
export const GiphyGridView = () => null;
export const GiphyContent = {
  search: () => null,
  trending: () => null,
};
