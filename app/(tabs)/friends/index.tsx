/**
 * Yours tab route.
 *
 * Thin flag switch only. When YOURS_PAGE_ENABLED is false (current prod
 * default) this renders the legacy "Your People" screen byte-identically.
 * When true it renders the rebuilt Yours experience. All real logic lives
 * in the two screen modules; keep this file a pure wrapper so the legacy
 * path stays a no-op move.
 */
import React from 'react';
import { YOURS_PAGE_ENABLED } from '../../../constants/FeatureFlags';
import LegacyYourPeopleScreen from '../../../components/yours/legacy/LegacyYourPeopleScreen';
import YoursScreen from '../../../components/yours/YoursScreen';

export default function YoursRoute() {
  return YOURS_PAGE_ENABLED ? <YoursScreen /> : <LegacyYourPeopleScreen />;
}
