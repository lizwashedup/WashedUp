import {
  buildCommunityApplication,
  buildEventApplication,
  missingCommunityApplicationFields,
  missingEventApplicationFields,
  type CommunityApplicationDraft,
  type EventApplicationDraft,
} from '../operatorApplicationForms';

const eventDraft = (overrides: Partial<EventApplicationDraft> = {}): EventApplicationDraft => ({
  applicantType: 'producer_promoter',
  applicantTypeOther: '',
  yourName: '  Anna  ',
  publicName: '  Night School  ',
  categories: ['music', 'nightlife'],
  frequency: 'monthly',
  proofLinks: [' https://example.com ', '', ' https://instagram.com/night '],
  venueAddress: '',
  ticketing: 'other_site',
  ticketingProvider: ' Dice ',
  about: '  Small dance nights.  ',
  terms: true,
  ...overrides,
});

const communityDraft = (overrides: Partial<CommunityApplicationDraft> = {}): CommunityApplicationDraft => ({
  yourName: '  Liz  ',
  communityName: '  Sunset LA Club  ',
  concept: '  People meet every week.  ',
  audience: '  Angelenos who want real friends.  ',
  cadence: 'other',
  cadenceOther: '  twice a month  ',
  whyYou: '  I already bring them together.  ',
  proofLinks: ['', ' https://example.com/community '],
  affiliation: 'yes',
  affiliationDetail: '  independent  ',
  responsibilityAck: true,
  terms: true,
  ...overrides,
});

describe('creator application form contracts', () => {
  it('requires the complete event application before submission', () => {
    expect(missingEventApplicationFields(eventDraft())).toEqual([]);
    expect(missingEventApplicationFields(eventDraft({ proofLinks: ['', ' '] }))).toContain(
      'show us proof (at least one link)',
    );
    expect(missingEventApplicationFields(eventDraft({ applicantType: 'venue' }))).toContain(
      "where's your spot?",
    );
  });

  it('builds the event application without blank or inapplicable fields', () => {
    expect(buildEventApplication(eventDraft())).toEqual({
      applicant_type: 'producer_promoter',
      your_name: 'Anna',
      public_name: 'Night School',
      event_categories: ['music', 'nightlife'],
      frequency: 'monthly',
      proof_links: ['https://example.com', 'https://instagram.com/night'],
      ticketing_today: 'other_site',
      ticketing_provider: 'Dice',
      about: 'Small dance nights.',
    });
    expect(buildEventApplication(eventDraft({ applicantType: 'just_me', publicName: 'ignore me' })))
      .not.toHaveProperty('public_name');
  });

  it('requires the complete Community application and both acknowledgements', () => {
    expect(missingCommunityApplicationFields(communityDraft())).toEqual([]);
    expect(missingCommunityApplicationFields(communityDraft({ responsibilityAck: false, terms: false })))
      .toEqual(expect.arrayContaining(['agree a community is a responsibility', 'agree to the terms']));
  });

  it('builds a trimmed Community payload with conditional answers', () => {
    expect(buildCommunityApplication(communityDraft())).toEqual({
      your_name: 'Liz',
      community_name: 'Sunset LA Club',
      concept: 'People meet every week.',
      audience: 'Angelenos who want real friends.',
      cadence: 'other',
      cadence_other: 'twice a month',
      why_you: 'I already bring them together.',
      proof_links: ['https://example.com/community'],
      affiliation: 'yes',
      affiliation_detail: 'independent',
      responsibility_ack: true,
    });
  });
});
