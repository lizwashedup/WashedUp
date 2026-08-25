/**
 * Yours tab route.
 *
 * Legacy "Your People" screen removed 2026-08-24 — dead since the
 * YOURS_PAGE_ENABLED flip (see constants/FeatureFlags.ts). Pure wrapper
 * around the real screen module.
 */
import React from 'react';
import YoursScreen from '../../../components/yours/YoursScreen';

export default function YoursRoute() {
  return <YoursScreen />;
}
