-- Point the force-update button at the real App Store listing.
--
-- app_config.ios_store_url had shipped as the placeholder from schema_v11
-- ('https://apps.apple.com/app/idYOUR_APP_ID'). ForceUpdateModal hands it
-- straight to Linking.openURL, and that modal has NO dismiss — so the first
-- time the min_ios_version or min_ios_build gate fired, it would have pinned
-- the user behind a button that opens a dead App Store page. A lockout with
-- no exit, which is the same failure class as the 2026-07-29 incident.
--
-- Value confirmed against Apple's public lookup API for bundle id
-- com.sanghani.drift → trackId 6778215875 ("Drift Productivity").
--
-- Only checks 2 and 3 read this. Check 1 (the App Store version lookup) carries
-- its own trackViewUrl and never needed it.

update public.app_config
   set value = 'https://apps.apple.com/us/app/drift-productivity/id6778215875',
       updated_at = now()
 where key = 'ios_store_url';

-- Insert it if schema_v11 was never run against this project.
insert into public.app_config (key, value)
select 'ios_store_url', 'https://apps.apple.com/us/app/drift-productivity/id6778215875'
where not exists (select 1 from public.app_config where key = 'ios_store_url');
