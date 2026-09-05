import { canSaveQuestionDraft } from '../question-editor';

describe('canSaveQuestionDraft', () => {
  it('is false with a blank or whitespace-only prompt', () => {
    expect(canSaveQuestionDraft('', 'short_text', [])).toBe(false);
    expect(canSaveQuestionDraft('   ', 'short_text', [])).toBe(false);
  });

  it('is true for a non-choice type with a real prompt, regardless of options', () => {
    expect(canSaveQuestionDraft('what should we call you?', 'short_text', [])).toBe(true);
    expect(canSaveQuestionDraft('anything to add?', 'paragraph', [])).toBe(true);
    expect(canSaveQuestionDraft('do you agree?', 'terms', [])).toBe(true);
  });

  it('is false for a choice type with fewer than two real options', () => {
    expect(canSaveQuestionDraft('pick one', 'single_select', [])).toBe(false);
    expect(canSaveQuestionDraft('pick one', 'single_select', ['only one'])).toBe(false);
    expect(canSaveQuestionDraft('pick one', 'dropdown', ['one', '   '])).toBe(false);
  });

  it('ignores whitespace-only options when counting real choices', () => {
    expect(canSaveQuestionDraft('pick many', 'multi_select', ['  ', 'a', '', 'b'])).toBe(true);
  });

  it('is true for a choice type with two or more real options', () => {
    expect(canSaveQuestionDraft('pick one', 'single_select', ['a', 'b'])).toBe(true);
    expect(canSaveQuestionDraft('pick any', 'multi_select', ['a', 'b', 'c'])).toBe(true);
  });
});
