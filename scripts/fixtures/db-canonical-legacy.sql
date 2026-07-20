INSERT INTO "user"(id,name,role,can_create_events,is_notification_enabled,created_at) VALUES
  ('u1','User 1','user',0,1,100),('u2','User 2','user',0,1,100),('u3','User 3','user',0,1,100);
INSERT INTO x_users(id,x_name,icon_url,youtube_channel_url,creative_start_date,linked_user_id,approval_status) VALUES
  ('x1','X One',NULL,NULL,2020,'u1','approved'),('x2','X Two',NULL,NULL,2021,NULL,'approved');
INSERT INTO x_user_icons(id,x_user_id,icon_url,source_type,created_at) VALUES
  ('icon1','x1','https://icon.old','manual',100),('icon2','x1','https://icon.new','manual',200);
INSERT INTO x_user_youtube_channels(id,x_user_id,youtube_channel_url,source_type,created_at) VALUES
  ('yc1','x1','https://youtube.example/new','manual',200);
INSERT INTO x_account_link_requests(id,user_id,requested_x_id,link_type,target_x_user_id,status,requested_at) VALUES
  ('lr1','u2','x3','new',NULL,'pending',1000),('lr2','u2','x2','alias','x2','approved',1100);
INSERT INTO x_id_merge_requests(id,from_x_user_id,to_x_user_id,requested_by_user_id,status,created_at,updated_at) VALUES
  ('mr1','x1','x2','u1','approved',1200,1300);
INSERT INTO x_id_merge_reverts(id,merge_request_id,requested_by_user_id,status,restore_snapshot_json,revert_deadline_at,created_at,updated_at) VALUES
  ('rr1','mr1','u1','pending','{}',9999,1400,1500);
INSERT INTO events(id,title,representative_x_user_id,visibility_status,allow_user_video_event_links,allow_unslotted_posts,allow_user_video_edits,created_at,updated_at,max_slots_per_video,public_api_enabled) VALUES
  ('e1','Event One','x1','public',0,0,0,100,200,3,1),
  ('e2','Event Two',NULL,'private',0,0,0,100,200,2,0),
  ('e3','Event Three',NULL,'public',0,0,0,100,200,4,1);
INSERT INTO event_staff(id,event_id,x_user_id,user_id,display_name,role,permission_preset,is_public,approved_by_user_id,created_at,updated_at) VALUES
  ('s1','e1','x1','u1','Staff One','editor','manager',1,'u2',100,200),
  ('s3','e3',NULL,'u2','Staff Three','editor','manager',1,'u1',100,200);
INSERT INTO videos(id,primary_event_id,creator_x_user_id,submitted_by_user_id,collaboration_type,source_type,creator_display_name,title,visibility_status,app_like_count,score,created_at,updated_at) VALUES
  ('v1','e1','x1','u1','individual','youtube','Creator One','Video One','public',0,0,100,200),
  ('v2','e2',NULL,'u2','collab','youtube','Creator Two','Video Two','private',0,0,100,200);
INSERT INTO video_youtube_metadata(video_id,youtube_video_id,view_count,sync_status,updated_at) VALUES
  ('v1','yt1',10,'synced',300),('v2','yt2',20,'synced',300);
INSERT INTO video_members(id,video_id,x_user_id,name,order_index,user_id,can_edit,is_public_member,edit_granted_by_user_id,edit_granted_at,edit_updated_at,chapters_json) VALUES
  ('vm1','v1','x1','Member One',0,'u1',1,1,'u2',400,500,'[{"time_seconds":1.5,"label":"Intro"},{"time":12,"chapter_label":"Part","note":"N"}]'),
  ('vm2','v2',NULL,'Member Two',0,'u2',0,1,NULL,NULL,NULL,'[]');
INSERT INTO video_chapters(id,video_id,x_user_id,chapter_time,chapter_label,visibility,created_at,updated_at) VALUES
  ('vc1','v1','x1',1.5,'Intro','public',100,200);
INSERT INTO audit_log_settings(id,normal_retention_days,restorable_retention_days,long_audit_retention_days,max_payload_bytes,compact_after_days,updated_by_user_id,updated_at) VALUES
  ('default',31,181,366,121000,32,'u1',600);
UPDATE system_settings SET history_retention_days=44, operation_mode='normal' WHERE id='default';
INSERT INTO software_catalog(id,name,normalized_name,usage_count,is_active,is_verified,created_at,updated_at)
  VALUES ('sw1','Software','software',0,1,1,100,100);
INSERT INTO software_aliases(id,software_id,alias,normalized_alias)
  VALUES ('sa1','sw1','Soft','soft');
INSERT INTO video_interactions(id,x_user_id,video_id,interaction_type,source,created_at) VALUES
  ('i1','x1','v1','like','app',100),('i2','x1','v1','bookmark','youtube',101);
