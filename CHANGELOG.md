# Changelog

All notable changes to this extension are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.1.0

2026-09-23

### Added

- *Exclude Locally* and *Remove from Local Excludes* commands, adding the selected files or folders to `.git/info/exclude` and removing them again.
- *Reveal Exclusion Pattern* command, opening the `.gitignore` or excludes file responsible for a file at the matching line.
- *Open Local Excludes* command, opening `.git/info/exclude` for editing and creating it if needed.
- *Show Scan Log* command, with a summary of scan timings and what failed.
- Badges and colors in the explorer by the source that ignores or excludes a file: the local excludes file, the global excludes file, or a committed `.gitignore`.
- Tooltips on ignored or excluded files naming the source file, the line, and the pattern that matched.
