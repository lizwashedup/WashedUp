import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('call-critical creator UX contracts', () => {
  it('offers a personal-profile exit anywhere the workspace switcher appears', () => {
    const source = read('components/creator/WorkspaceSwitcher.tsx');
    expect(source).toContain("router.replace('/(tabs)/profile')");
    expect(source).toContain('back to you');
    expect(source).not.toContain('if (!hasMultipleWorkspaces(access)) return null');
  });

  it('keeps focused creator fields visible above the iOS keyboard', () => {
    const source = read('app/creator/event-form.tsx');
    expect(source).toContain('automaticallyAdjustKeyboardInsets');
    expect(source).toContain('onScrollBeginDrag={Keyboard.dismiss}');
  });

  it('names the audience in both community conversation types', () => {
    expect(read('app/community-thread/[id].tsx')).toContain('everyone in this community');
    expect(read('app/community-topic/[id].tsx')).toContain('people going to this event');
  });

  it('does not leave the private payment fixture in Scene', () => {
    expect(read('components/scene/SceneDiscovery.tsx')).not.toContain('DEV_PAYMENT_QA_EVENT_ID');
    expect(read('components/scene/SceneDiscovery.tsx')).not.toContain('$1 payment test');
  });

  it('keeps all plan filters centered and reachable on narrow screens', () => {
    const source = read('app/(tabs)/plans/index.tsx');
    expect(source).toContain('horizontal');
    expect(source).toContain('contentContainerStyle={styles.filterRow}');
    expect(source).toContain("justifyContent: 'center'");
  });

  it('shows reply and reaction affordances in the main community conversation', () => {
    const source = read('app/community-thread/[id].tsx');
    expect(source).toContain('CommunityMessageActions');
    const actions = read('components/communities/CommunityMessageActions.tsx');
    expect(actions).toContain('Reply to this message');
    expect(actions).toContain("const REACTIONS = ['❤️', '🔥', '👏']");
  });
});
