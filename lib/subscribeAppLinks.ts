type LinkSource = {
  getInitialURL(): Promise<string | null>;
  addEventListener(event: 'url', listener: (event: { url: string }) => void): { remove(): void };
};

type SharedLinkOwner = { recognizes: (url: string) => boolean };
let foregroundOwner: SharedLinkOwner | undefined;

/** Expo Router and the root auth handoff receive the same native URL event. */
export function rootHandlesForegroundLink(url: string) {
  return foregroundOwner?.recognizes(url) === true;
}

/** A foreground link supersedes the startup snapshot; cleanup retires both. */
export function subscribeAppLinks(
  source: LinkSource,
  onUrl: (url: string) => void,
  onInitialError: (error: unknown) => void,
  recognizesSharedLink?: (url: string) => boolean,
): () => void {
  let active = true;
  let receivedForegroundLink = false;
  const subscription = source.addEventListener('url', ({ url }) => {
    if (!active || !url) return;
    receivedForegroundLink = true;
    onUrl(url);
  });
  const owner = recognizesSharedLink ? { recognizes: recognizesSharedLink } : undefined;
  if (owner) foregroundOwner = owner;
  void source.getInitialURL().then(url => {
    if (active && !receivedForegroundLink && url) onUrl(url);
  }).catch(error => {
    if (active && !receivedForegroundLink) onInitialError(error);
  });
  return () => {
    active = false;
    if (foregroundOwner === owner) foregroundOwner = undefined;
    subscription.remove();
  };
}
