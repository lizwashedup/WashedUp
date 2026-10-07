import { TextSendSession } from '../textSendSession';

it('reuses the same UUID for an unchanged retry, then starts fresh after confirmation or editing', () => {
  let number = 0;
  const session = new TextSendSession(() => `id-${++number}`);
  expect(session.idFor('hello', null)).toBe('id-1');
  expect(session.idFor('hello', null)).toBe('id-1');
  expect(session.idFor('hello', 'reply')).toBe('id-2');
  session.clear();
  expect(session.idFor('hello', 'reply')).toBe('id-3');
});
