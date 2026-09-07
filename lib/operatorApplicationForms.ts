export interface EventApplicationDraft {
  applicantType: string | null;
  applicantTypeOther: string;
  yourName: string;
  publicName: string;
  categories: string[];
  frequency: string | null;
  proofLinks: string[];
  venueAddress: string;
  ticketing: string | null;
  ticketingProvider: string;
  about: string;
  terms: boolean;
}

export interface CommunityApplicationDraft {
  yourName: string;
  communityName: string;
  concept: string;
  audience: string;
  cadence: string | null;
  cadenceOther: string;
  whyYou: string;
  proofLinks: string[];
  affiliation: string | null;
  affiliationDetail: string;
  responsibilityAck: boolean;
  terms: boolean;
}

export function cleanProofLinks(links: string[]): string[] {
  return links.map((link) => link.trim()).filter(Boolean);
}

export function missingEventApplicationFields(draft: EventApplicationDraft): string[] {
  const missing: string[] = [];
  if (!draft.applicantType) missing.push('what are you?');
  else if (draft.applicantType === 'other' && draft.applicantTypeOther.trim().length === 0) missing.push('tell us');
  if (draft.yourName.trim().length === 0) missing.push('your name');
  if (draft.applicantType && draft.applicantType !== 'just_me' && draft.publicName.trim().length === 0) {
    missing.push('the name people know you by');
  }
  if (draft.categories.length === 0) missing.push('what kind of events?');
  if (!draft.frequency) missing.push('how often?');
  if (cleanProofLinks(draft.proofLinks).length === 0) missing.push('show us proof (at least one link)');
  if (draft.applicantType === 'venue' && draft.venueAddress.trim().length === 0) missing.push("where's your spot?");
  if (!draft.ticketing) missing.push('how do people get tickets today?');
  if (draft.about.trim().length === 0) missing.push('tell us about what you run');
  if (!draft.terms) missing.push('agree to the terms');
  return missing;
}

export function buildEventApplication(draft: EventApplicationDraft): Record<string, unknown> {
  const application: Record<string, unknown> = {
    applicant_type: draft.applicantType,
    your_name: draft.yourName.trim(),
    event_categories: draft.categories,
    frequency: draft.frequency,
    proof_links: cleanProofLinks(draft.proofLinks),
    ticketing_today: draft.ticketing,
    about: draft.about.trim(),
  };
  if (draft.applicantType === 'other') application.applicant_type_other = draft.applicantTypeOther.trim();
  if (draft.applicantType !== 'just_me') application.public_name = draft.publicName.trim();
  if (draft.applicantType === 'venue') application.venue_address = draft.venueAddress.trim();
  if ((draft.ticketing === 'other_site' || draft.ticketing === 'both') && draft.ticketingProvider.trim()) {
    application.ticketing_provider = draft.ticketingProvider.trim();
  }
  return application;
}

export function missingCommunityApplicationFields(draft: CommunityApplicationDraft): string[] {
  const missing: string[] = [];
  if (draft.yourName.trim().length === 0) missing.push('your name');
  if (draft.communityName.trim().length === 0) missing.push('name your community');
  if (draft.concept.trim().length === 0) missing.push('what is it?');
  if (draft.audience.trim().length === 0) missing.push('who is it for?');
  if (!draft.cadence) missing.push('how often will things happen?');
  else if (draft.cadence === 'other' && draft.cadenceOther.trim().length === 0) missing.push('tell us (how often)');
  if (draft.whyYou.trim().length === 0) missing.push('why you?');
  if (cleanProofLinks(draft.proofLinks).length === 0) missing.push('show us proof (at least one link)');
  if (!draft.affiliation) missing.push('are you connected to a business, venue, or brand?');
  else if (draft.affiliation === 'yes' && draft.affiliationDetail.trim().length === 0) missing.push('tell us (affiliation)');
  if (!draft.responsibilityAck) missing.push('agree a community is a responsibility');
  if (!draft.terms) missing.push('agree to the terms');
  return missing;
}

export function buildCommunityApplication(draft: CommunityApplicationDraft): Record<string, unknown> {
  const application: Record<string, unknown> = {
    your_name: draft.yourName.trim(),
    community_name: draft.communityName.trim(),
    concept: draft.concept.trim(),
    audience: draft.audience.trim(),
    cadence: draft.cadence,
    why_you: draft.whyYou.trim(),
    proof_links: cleanProofLinks(draft.proofLinks),
    affiliation: draft.affiliation,
    responsibility_ack: true,
  };
  if (draft.cadence === 'other') application.cadence_other = draft.cadenceOther.trim();
  if (draft.affiliation === 'yes') application.affiliation_detail = draft.affiliationDetail.trim();
  return application;
}
