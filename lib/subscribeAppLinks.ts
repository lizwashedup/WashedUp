type LinkSource = {
  getInitialURL(): Promise<string | null>;
  addEventListener(event: 'url', listener: (event: { url: string }) => void): { remove(): void };
};

/** A foreground link supersedes the startup snapshot; cleanup retires both. */
export function subscribeAppLinks(
  source: LinkSource,
  onUrl: (url: string) => void,
  onInitialError: (error: unknown) => void,
): () => void {
  let active = true;
  let receivedForegroundLink = false;
  const subscription = source.addEventListener('url', ({ url }) => {
    if (!active || !url) return;
    receivedForegroundLink = true;
    onUrl(url);
  });
  void source.getInitialURL().then(url => {
    if (active && !receivedForegroundLink && url) onUrl(url);
  }).catch(error => {
    if (active && !receivedForegroundLink) onInitialError(error);
  });
  return () => {
    active = false;
    subscription.remove();
  };
}
