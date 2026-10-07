import { rememberSavedCreatorEvent, takeSavedCreatorEvent } from '../creatorEventReturn';
it('keeps the last confirmed save scoped to its account and page, consumed once', () => {
  const scope = {userId:'one',isCurrent:()=>true};
  rememberSavedCreatorEvent('page','draft',scope);rememberSavedCreatorEvent('page','duplicate',scope);
  expect(takeSavedCreatorEvent('other',scope)).toBeUndefined();expect(takeSavedCreatorEvent('page',{...scope,userId:'two'})).toBeUndefined();
  expect(takeSavedCreatorEvent('page',scope)).toBe('duplicate');expect(takeSavedCreatorEvent('page',scope)).toBeUndefined();
});
it('ignores retired saves and never consumes another active visit’s target', () => {
  const scope={userId:'one',isCurrent:()=>true},retired={...scope,isCurrent:()=>false};
  rememberSavedCreatorEvent('page','current',scope);rememberSavedCreatorEvent('page','stale',retired);
  expect(takeSavedCreatorEvent('page',retired)).toBeUndefined();expect(takeSavedCreatorEvent('page',scope)).toBe('current');
});
