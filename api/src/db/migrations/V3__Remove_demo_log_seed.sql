-- V2 seeded a placeholder anomaly row ('Pakistan' -> 'Israil', "Some one in
-- middle of comunication"). It is fabricated data with real country names and a
-- typo, sitting in the same table as genuine findings — which is a problem the
-- moment the app is shown to anyone.
--
-- Removed here rather than by editing V2, so databases that already ran V2 are
-- corrected too and no applied migration changes checksum.
DELETE FROM logs
WHERE sourceip = 'Pakistan'
  AND destinationip = 'Israil'
  AND protocol = 'HTTP';
