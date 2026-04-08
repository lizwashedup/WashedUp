-- Update mark descriptions to warmer copy and fix icon_names for new SVG components
UPDATE marks SET description = 'You''ve hosted 3 plans. People count on you.' WHERE slug = 'anchor';
UPDATE marks SET description = '8 plans and counting. You''re the backbone.' WHERE slug = 'mainstay';
UPDATE marks SET description = '3 plans after sundown. The night is yours.' WHERE slug = 'night-owl';
UPDATE marks SET description = '3 plans before noon. You don''t waste a morning.' WHERE slug = 'early-bird';
UPDATE marks SET description = '3 outdoor plans. Fresh air looks good on you.' WHERE slug = 'trailblazer';
UPDATE marks SET description = '3 arts plans. You have good taste.', icon_name = 'paintbrush' WHERE slug = 'culture-club';
UPDATE marks SET description = 'You''ve been to 3 plans with the same person. That''s a real one.', icon_name = 'twopaths' WHERE slug = 'the-regular';
UPDATE marks SET description = '3 different categories. You try everything.' WHERE slug = 'explorer';
UPDATE marks SET description = 'Among the first 1,000. You were here before it was cool.', icon_name = 'trophy' WHERE slug = 'day-one';
