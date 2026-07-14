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
cleanup = '''Path("scripts/agent_full_optimization_pass_9.py").unlink()
Path(".github/workflows/agent-full-optimization-pass-9.yml").unlink()
print("full optimization pass 9 applied")
'''
replacement = '''Path(".tmp-agent-patch-error.txt").unlink(missing_ok=True)
Path("scripts/fix_agent_full_optimization_pass_9.py").unlink(missing_ok=True)
Path("scripts/agent_full_optimization_pass_9.py").unlink()
Path(".github/workflows/agent-full-optimization-pass-9.yml").unlink()
print("full optimization pass 9 applied")
'''
if cleanup not in text:
    raise RuntimeError("cleanup block not found")
path.write_text(text.replace(cleanup, replacement), encoding="utf-8")
print("patch script fixed")
