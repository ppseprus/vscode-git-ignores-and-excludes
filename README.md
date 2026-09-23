# Git Ignores & Excludes

Keep your own notes and working files in the repo without committing them. Manage `.git/info/exclude` from the explorer, and see which rule ignores or excludes any file.

## Motivation

Working inside a repository often produces files that belong with the repo but must never be committed. Think of them as notes scribbled in the margins of your own copy of the book. Adding them to `.gitignore` turns your clutter into noise for everyone else.

Git already has a place for exactly this: read [.gitignore Isn't the Only Way To Ignore Files in Git](https://nelson.cloud/.gitignore-isnt-the-only-way-to-ignore-files-in-git/) by Nelson Figueroa.

Every clone has a local excludes file: `.git/info/exclude`. It lives with the repository uncommitted. Reaching it, though, means knowing the path by heart, opening a file buried inside `.git`, and hand-writing gitignore patterns. I could not find a tool that made this easy, so I wrote one. This extension removes the friction and makes `.git/info/exclude` more accessible. Excluding a file is a right click, and the file is marked in the explorer so you can see what you have set aside.

It also tells the three sources apart. A file can be ignored by a committed `.gitignore` the whole team shares, excluded by your global excludes file that applies to every repository, or excluded by the local excludes file of this one repository. VS Code dims all three the same gray, so your own working file looks like a build artifact. Hovering any ignored or excluded file now names the source file, the line, and the pattern that matched, and you can set a badge and color for each source.

The default badge and the extension's icon are the same mark: ※, the Japanese reference mark, or komejirushi. It does the job of the asterisk in English and calls attention to a note. In Japanese writing, though, the note follows the mark inline, right there in the text, rather than at the foot of the page. A locally excluded file is exactly that: your own note, kept next to the code and nowhere else. The English asterisk would say the same, but drawn large as an icon it collides with the Claude logo.

## Features

- **Exclude Locally.** Adds the selected files or folders to `.git/info/exclude`. *Explorer context menu, Command palette.*
- **Remove from Local Excludes.** Removes their entries from `.git/info/exclude` again. *Explorer context menu, Command palette.*
- **Reveal Exclusion Pattern.** Opens the `.gitignore` or excludes file responsible for the selected file, at the matching line. *Explorer context menu, Command palette.*
- **Open Local Excludes.** Opens `.git/info/exclude` for editing, creating it if needed. *Command palette, `ctrl+k ctrl+e` (`cmd+k cmd+e` on macOS).*
- **Show Scan Log.** Shows a summary of scan timings, and what failed. *Command palette.*
- **Badges and colors.** Marks files by the source that ignores or excludes them: the local excludes file, your global excludes file, or a committed `.gitignore`. *Explorer.*
- **Tooltips.** Hovering an ignored or excluded file shows the source file, the line, and the pattern that matched. *Explorer.*

## Settings

Badges are configurable under **Git Ignores & Excludes** in Settings. Each accepts one or two characters, and an empty value shows no badge for that source while leaving the color and tooltip intact.

| Setting | Default | Applies to |
| --- | --- | --- |
| `gitIgnoresAndExcludes.badges.enabled` | `true` | turns all badges off, keeping colors and tooltips. Colors are muted through `workbench.colorCustomizations` instead. (See Color Customizations below) |
| `gitIgnoresAndExcludes.badges.localExcludes` | `※` | `.git/info/exclude`, never committed |
| `gitIgnoresAndExcludes.badges.globalExcludes` | empty | `core.excludesFile`, every repository |
| `gitIgnoresAndExcludes.badges.repositoryIgnores` | empty | a committed `.gitignore`, at any depth |

_Note: Only local excludes are badged out of the box. A committed `.gitignore` is shared and expected, and a global rule is your own standing choice, so both are left to VS Code's ordinary dimming until you set a badge for them. Give them one if you want all three marked._

## Color Customizations

Colors are configurable per source under `workbench.colorCustomizations` in Settings, globally or per theme, so a locally excluded file no longer looks like a build artifact.

Each source has a themeable color:

| Color | Draws |
| --- | --- |
| `gitIgnoresAndExcludes.localExcludesForeground` | files excluded by `.git/info/exclude` |
| `gitIgnoresAndExcludes.globalExcludesForeground` | files excluded by `core.excludesFile` |
| `gitIgnoresAndExcludes.repositoryIgnoresForeground` | files ignored by a committed `.gitignore` |

_Note: The extension ships without changing any colors. All three sources keep the default VS Code color. The badge is the only visible addition._

## Notes

**It reads all three sources but writes only one.** Adding and removing touch `.git/info/exclude` and nothing else. Changing a committed `.gitignore` affects everyone on the team, and changing the global excludes file affects every repository you have.

**Classification comes from `git check-ignore --verbose`, not from parsing the ignore files.** Deciding which rule wins for a given file means handling precedence, negation with `!`, directory-only patterns, and nested `.gitignore` files at every depth. Git already does this correctly, and a hand-rolled parser is where this kind of tool would go wrong.

**Git is asked about a whole batch at once.** VS Code requests a decoration for every visible row on each expand and scroll, so the extension collects the requests and runs git once per batch.

**Removal refuses to guess.** If a file is excluded by a broader pattern nobody wrote for it, such as `notes/` covering `notes/todo.md`, the extension says so instead of deleting that pattern and silently un-excluding everything else it covered.

**A nested repository counts once the parent tracks it.** A repository inside another one is treated as its own as soon as the parent has it in the index, as a submodule or a plain gitlink. One that was only cloned or initialised inside the parent and never added is seen as part of the parent: its files are classified by the parent's rules, and *Exclude Locally* writes to the parent's excludes file. Add it to the workspace as its own folder to work on it directly.

**Badges compete with the built-in Git extension.** VS Code renders one badge per row, and the built-in Git decorations also claim ignored files. If a badge does not appear, setting `git.decorations.enabled` to false hands the row over, at the cost of the built-in modified and untracked markers. Colors and tooltips are unaffected either way.
