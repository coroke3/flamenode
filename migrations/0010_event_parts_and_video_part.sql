-- events.parts_json: イベントで作品が選択できる「部」(セクション/カテゴリ) の候補
-- リストを JSON 文字列 (text) で保持する。null/空配列なら作品フォームに「部」UI を
-- 出さない。旧データの type 列に相当する分類項目を、イベント単位で定義する。
ALTER TABLE `events` ADD `parts_json` text;
--> statement-breakpoint

-- videos.part: 作品が所属する「部」名 (events.parts_json の候補から選ばれた文字列)。
-- イベントが parts_json を持つ場合のみフォームに表示される。null なら未設定。
ALTER TABLE `videos` ADD `part` text;
