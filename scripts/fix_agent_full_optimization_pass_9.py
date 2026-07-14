from pathlib import Path

path = Path("scripts/agent_full_optimization_pass_9.py")
text = path.read_text(encoding="utf-8")
needle = """replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''      accessToken,
      quota,
    );
''',
    '''      accessToken,
      quota,
      requestBudget,
    );
''',
)
"""
if text.count(needle) != 2:
    raise RuntimeError(f"expected two ambiguous replacements, found {text.count(needle)}")
scan_replacement = """replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''    const result = await listPlaylistPage(
      config.playlist_id,
      pageToken,
      accessToken,
      quota,
    );
''',
    '''    const result = await listPlaylistPage(
      config.playlist_id,
      pageToken,
      accessToken,
      quota,
      requestBudget,
    );
''',
)
"""
insert_replacement = """replace_once(
    "workers/youtube-playlist-sync/index.ts",
    '''    const inserted = await insertPlaylistItem(
      config.playlist_id,
      videoId,
      Math.max(0, position),
      accessToken,
      quota,
    );
''',
    '''    const inserted = await insertPlaylistItem(
      config.playlist_id,
      videoId,
      Math.max(0, position),
      accessToken,
      quota,
      requestBudget,
    );
''',
)
"""
text = text.replace(needle, scan_replacement, 1)
text = text.replace(needle, insert_replacement, 1)
old_sql = r'''  const sql = statements.join("\n");'''
new_sql = r'''  const sql = statements.join("\\n");'''
if text.count(old_sql) != 1:
    raise RuntimeError(f"notification SQL join not found: {text.count(old_sql)}")
text = text.replace(old_sql, new_sql)
old_batch_assertion = r'''  assert.match(source, /DELETE FROM event_youtube_playlist_items[\s\S]*env\.DB\.batch/);'''
new_batch_assertion = r'''  assert.match(source, /env\.DB\.batch\([\s\S]*DELETE FROM event_youtube_playlist_items/);'''
if text.count(old_batch_assertion) != 1:
    raise RuntimeError(f"playlist batch assertion not found: {text.count(old_batch_assertion)}")
text = text.replace(old_batch_assertion, new_batch_assertion)
cleanup = '''Path("scripts/agent_full_optimization_pass_9.py").unlink()
Path(".github/workflows/agent-full-optimization-pass-9.yml").unlink()
print("full optimization pass 9 applied")
'''
replacement = '''Path(".tmp-agent-patch-error.txt").unlink(missing_ok=True)
Path(".tmp-agent-verify-error.txt").unlink(missing_ok=True)
Path("scripts/fix_agent_full_optimization_pass_9.py").unlink(missing_ok=True)
Path("scripts/agent_full_optimization_pass_9.py").unlink()
Path(".github/workflows/agent-full-optimization-pass-9.yml").unlink()
print("full optimization pass 9 applied")
'''
if cleanup not in text:
    raise RuntimeError("cleanup block not found")
path.write_text(text.replace(cleanup, replacement), encoding="utf-8")
print("patch script fixed")
