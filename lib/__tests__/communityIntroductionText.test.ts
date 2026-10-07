jest.mock('../supabase', () => ({ supabase: {} }));
import { composeIntroCard, composeIntroLine, type IntroPayload } from '../communityChat';

const standard: IntroPayload = { format: 'member_intro_v1', user_id: 'member', first_name: 'Cedar', area: null, question: 'Introduce yourself', answer: 'I make things with friends' };
describe('versioned community introduction text', () => {
  it('shows the saved first name and member-written answer separately', () => {
    expect(composeIntroCard(standard)).toEqual({ lead: 'Cedar', qa: 'I make things with friends' });
  });
  it('uses the same standard content in a compact text projection', () => {
    expect(composeIntroLine(standard)).toBe('Cedar: I make things with friends');
  });
  it('does not derive or append private prompt or location fields for the standard format', () => {
    const data = { ...standard, area: 'DO NOT ADD', question: 'PRIVATE CUSTOM PROMPT' };
    expect(composeIntroCard(data)).toEqual(composeIntroCard(standard));
    expect(composeIntroLine(data)).toBe(composeIntroLine(standard));
  });
  it('preserves the members punctuation, line breaks and emoji', () => {
    const data = { ...standard, answer: 'Hi!\nLet’s draw 🎨' };
    expect(composeIntroCard(data).qa).toBe(data.answer);
  });
  it('does not mutate saved payloads while rendering', () => {
    const data = Object.freeze({ ...standard });
    composeIntroCard(data); composeIntroLine(data);
    expect(data).toEqual(standard);
  });
  it('preserves historical short-question cards without reformatting them', () => {
    const old = { ...standard, format: undefined, area: 'Silver Lake', question: 'What sounds fun?' };
    expect(composeIntroCard(old)).toEqual({ lead: 'this is Cedar, from Silver Lake. what sounds fun: I make things with friends.', qa: null });
  });
  it('preserves historical long-question line breaks', () => {
    const old = { ...standard, format: undefined, question: 'What would you like people in this community to know about you?' };
    expect(composeIntroCard(old)).toEqual({ lead: 'this is Cedar.', qa: 'what would you like people in this community to know about you: I make things with friends.' });
  });
  it('preserves old compact text and its existing punctuation', () => {
    const old = { ...standard, format: undefined, answer: 'I draw!' };
    expect(composeIntroLine(old)).toBe('this is Cedar. introduce yourself: I draw!');
  });
});
