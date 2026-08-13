-- Office scaffold Phase 3: seed finance_transactions with the real ledger
-- already transcribed verbatim in washedup-world's own finance/page.tsx
-- SEED const (Oct 2025 - Mar 2026, founder Google Sheets + Citi CC ##0716 +
-- Mercury ##8898). 67 real rows (the in-code comment says 61, stale -- the
-- array itself has grown since; every row actually in the array is seeded
-- here, none invented, none dropped). Local numeric ids (24.1, 45.1, etc.)
-- were React keys only, not carried over -- the table generates its own
-- uuid per row. tax_deductible/recurring were never tracked per-row in the
-- source data, left at their DEFAULT false rather than guessed.

BEGIN;

INSERT INTO finance_transactions (txn_date, description, amount, category, source, card_last4, notes) VALUES
('2025-10-26', 'Wordpress — First Website', 76.00, 'Website', 'Personal Card', NULL, 'Creating washedup landing page'),
('2025-10-26', 'Notion', 32.51, 'Productivity', 'Personal Card', NULL, 'AI for org'),
('2025-10-26', 'Oct 2025 Misc Tools', 26.99, 'Misc', 'Personal Card', NULL, 'Remaining Oct expenses (see original ledger)'),
('2025-11-15', 'ExpressVPN', 12.95, 'Infrastructure', 'Personal Card', NULL, 'VPN for work from Lisbon'),
('2025-11-15', 'Website (Framer / Squarespace / Zeroqode)', 53.27, 'Website', 'Personal Card', NULL, 'Framer early access site'),
('2025-11-15', 'Legal — Delaware INC Formation', 279.00, 'Legal', 'Personal Card', NULL, ''),
('2025-11-15', 'Eleven Labs — Voiceovers for Content', 11.00, 'AI Tools', 'Personal Card', NULL, ''),
('2025-11-15', 'Kit — Emails & Forms', 39.00, 'Marketing', 'Personal Card', NULL, ''),
('2025-11-15', 'LLMs (AI Subscriptions)', 64.21, 'AI Tools', 'Personal Card', NULL, ''),
('2025-11-15', 'Google GSuite', 37.62, 'Productivity', 'Personal Card', NULL, ''),
('2025-12-15', 'ExpressVPN', 12.95, 'Infrastructure', 'Personal Card', NULL, 'Express VPN'),
('2025-12-15', 'Website (Framer / Squarespace / Zeroqode)', 27.91, 'Website', 'Personal Card', NULL, ''),
('2025-12-15', 'Eleven Labs — Voiceovers for Content', 22.00, 'AI Tools', 'Personal Card', NULL, ''),
('2025-12-15', 'LLMs (AI Subscriptions)', 65.00, 'AI Tools', 'Personal Card', NULL, ''),
('2025-12-15', 'Google GSuite', 108.00, 'Productivity', 'Personal Card', NULL, ''),
('2025-12-15', 'Cloudflare Hosting', 42.60, 'Infrastructure', 'Personal Card', NULL, ''),
('2025-12-15', 'Fiverr — Logo / Branding', 45.00, 'Design', 'Personal Card', NULL, ''),
('2026-01-15', 'Website (Framer / Squarespace / Zeroqode)', 28.24, 'Website', 'Personal Card', NULL, ''),
('2026-01-15', 'Eleven Labs — Voiceovers for Content', 22.00, 'AI Tools', 'Personal Card', NULL, ''),
('2026-01-15', 'LLMs (AI Subscriptions)', 100.61, 'AI Tools', 'Personal Card', NULL, ''),
('2026-01-15', 'Google GSuite', 56.00, 'Productivity', 'Personal Card', NULL, ''),
('2026-01-15', 'Xano — Original Backend', 29.00, 'Dev Tools', 'Personal Card', NULL, ''),
('2026-01-15', 'Lovable — Company Jan Switch', 480.00, 'Dev Tools', 'Personal Card', NULL, 'Switch to Lovable for app'),
('2026-01-15', 'Resend — Email Automation', 20.00, 'Infrastructure', 'Personal Card', NULL, ''),
('2026-01-31', 'Personal / Out-of-Pocket Expenses', 215.00, 'Marketing', 'Personal Card', NULL, 'Founder out-of-pocket — January'),
('2026-02-15', 'ExpressVPN', 12.95, 'Infrastructure', 'Personal Card', NULL, ''),
('2026-02-15', 'Xano — Backend', 29.00, 'Dev Tools', 'Personal Card', NULL, ''),
('2026-02-15', 'Lovable — Dev Platform', 480.00, 'Dev Tools', 'Personal Card', NULL, 'Feb recurring'),
('2026-02-15', 'Google GSuite', 123.40, 'Productivity', 'Personal Card', NULL, ''),
('2026-02-15', 'Flyers — Marketing Print', 175.00, 'Marketing', 'Personal Card', NULL, 'Out-of-pocket founder expense'),
('2026-02-15', 'Twilio', 50.00, 'Infrastructure', 'Personal Card', NULL, ''),
('2026-02-15', 'Legal — Delaware PBC Conversion + 2025 Franchise Tax', 1357.00, 'Legal', 'Personal Card', NULL, 'Delaware Switch to PBC 2025'),
('2026-02-28', 'Personal / Out-of-Pocket Expenses', 275.00, 'Marketing', 'Personal Card', NULL, 'Founder out-of-pocket — February'),
('2026-02-17', 'Harvard Business Services', 69.00, 'Legal', 'Credit Card', '0716', '2025 DE Franchise Tax — refunded 02/23, net $0'),
('2026-02-23', 'Harvard Business Services REFUND', -69.00, 'Legal', 'Credit Card', '0716', 'Refund of 02/17 charge — net $0'),
('2026-02-24', 'Apple AI Tools', 5.99, 'AI Tools', 'Credit Card', '0716', ''),
('2026-02-24', 'Apple AI Tools', 9.99, 'AI Tools', 'Credit Card', '0716', ''),
('2026-02-24', 'Apple AI Tools', 19.99, 'AI Tools', 'Credit Card', '0716', ''),
('2026-02-24', 'Apple AI Tools', 60.00, 'AI Tools', 'Credit Card', '0716', ''),
('2026-02-24', 'Cursor IDE', 60.00, 'Dev Tools', 'Credit Card', '0716', 'Sub-card ••3539'),
('2026-02-24', 'LA Tech Mixer Event', 19.64, 'Networking', 'Credit Card', '0716', ''),
('2026-02-26', 'Apple AI Tools', 99.00, 'AI Tools', 'Credit Card', '0716', ''),
('2026-02-26', 'Shopify', 1.00, 'Platform', 'Credit Card', '0716', 'Sub-card ••8123'),
('2026-02-27', 'Cursor IDE', 200.00, 'Dev Tools', 'Credit Card', '0716', 'Sub-card ••3539'),
('2026-02-27', 'Cursor IDE REFUND', -54.10, 'Dev Tools', 'Credit Card', '0716', 'Partial refund, sub-card ••3539'),
('2026-02-28', 'Resend', 20.00, 'Infrastructure', 'Credit Card', '0716', 'Sub-card ••5339'),
('2026-02-26', 'Dusty Vinyl LA — WashedUp Event', 48.69, 'Events', 'Personal Card', '7429', '3 tabs — WashedUp crew/activation night. Checking ••8485'),
('2026-03-01', 'Twilio REFUND', -30.77, 'Infrastructure', 'Credit Card', '0716', 'Credit from previous charge'),
('2026-03-02', 'Apple AI Tools', 80.00, 'AI Tools', 'Credit Card', '0716', ''),
('2026-03-02', 'Apple AI Tools REFUND', -47.21, 'AI Tools', 'Credit Card', '0716', 'Partial refund'),
('2026-03-04', 'Google One', 2.99, 'AI Tools', 'Credit Card', '0716', ''),
('2026-03-05', 'Apple AI Tools', 9.99, 'AI Tools', 'Credit Card', '0716', ''),
('2026-03-05', 'Apple AI Tools', 100.00, 'AI Tools', 'Credit Card', '0716', ''),
('2026-03-05', 'Apple AI Tools REFUND', -72.36, 'AI Tools', 'Credit Card', '0716', 'Partial refund'),
('2026-03-07', 'Vercel', 20.00, 'Infrastructure', 'Credit Card', '0716', 'Sub-card ••4990'),
('2026-03-07', 'Cursor Usage', 21.03, 'Dev Tools', 'Credit Card', '0716', 'Sub-card ••3539'),
('2026-03-07', 'Claude AI Subscription', 174.52, 'AI Tools', 'Credit Card', '0716', 'Sub-card ••1954'),
('2026-03-09', 'Perplexity AI', 20.00, 'AI Tools', 'Business Checking', NULL, 'Mercury ••8898 ACH Pull'),
('2026-03-10', 'Runway Pro Plan', 35.00, 'AI Tools', 'Credit Card', '0716', ''),
('2026-03-15', 'LA Tech Industry Event', 41.04, 'Networking', 'Credit Card', '0716', ''),
('2026-03-06', 'Florentin DTLA — WashedUp Event', 121.98, 'Events', 'Personal Card', '7429', '3 tabs — WashedUp crew/activation night. Checking ••8485'),
('2026-03-14', 'The High-Low LA — WashedUp Event', 59.07, 'Events', 'Personal Card', '7429', '3 tabs — WashedUp crew/activation night. Checking ••8485'),
('2026-03-18', 'Dropbox DocSend', 15.00, 'SaaS', 'Business Checking', NULL, 'Mercury ••8898 ACH Pull'),
('2026-03-16', 'CC Interest — Standard Purchases', 87.47, 'Finance', 'Credit Card', '0716', 'Interest on business card — cost of financing'),
('2026-03-16', 'CC Interest — Prior Period (Dec 2025)', 70.43, 'Finance', 'Credit Card', '0716', 'Interest carried from Dec 2025 purchases'),
('2026-03-19', 'Personal / Out-of-Pocket Expenses', 175.00, 'Marketing', 'Personal Card', NULL, 'Founder out-of-pocket — March'),
('2026-02-23', 'Owner Contribution', 300.00, 'Equity', 'Checking', NULL, 'Personal ••8485 → Business ••8898. NOT an expense.');

COMMIT;
