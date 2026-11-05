export function newCreatorEventRoute(workspace: 'community' | 'organization', communityId?: string) {
  return workspace === 'community' ? '/creator/event-form?workspace=community&communityId=' + encodeURIComponent(communityId ?? '')
    : '/creator/event-form?workspace=organization';
}
