// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Diff generation and parsing for unified diff display.
//!
//! This module provides utilities for generating and parsing unified diffs
//! similar to `git diff` output.

use std::fmt::Write;

/// A line in a diff hunk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DiffLine {
    /// Context line (unchanged).
    Context(String),
    /// Added line (starts with +).
    Added(String),
    /// Removed line (starts with -).
    Removed(String),
}

impl DiffLine {
    /// Get the content of the line (without the +/- prefix).
    pub fn content(&self) -> &str {
        match self {
            DiffLine::Context(s) | DiffLine::Added(s) | DiffLine::Removed(s) => s.as_str(),
        }
    }

    /// Get the line prefix character.
    pub fn prefix(&self) -> char {
        match self {
            DiffLine::Context(_) => ' ',
            DiffLine::Added(_) => '+',
            DiffLine::Removed(_) => '-',
        }
    }
}

/// A hunk in a diff (a section of changes).
#[derive(Debug, Clone)]
pub struct DiffHunk {
    /// Old file starting line number.
    pub old_start: usize,
    /// Number of lines in old file for this hunk.
    pub old_lines: usize,
    /// New file starting line number.
    pub new_start: usize,
    /// Number of lines in new file for this hunk.
    pub new_lines: usize,
    /// The lines in this hunk.
    pub lines: Vec<DiffLine>,
}

/// A parsed unified diff.
#[derive(Debug, Clone)]
pub struct UnifiedDiff {
    /// File path (if available).
    pub file_path: Option<String>,
    /// Old file content description.
    pub old_file: String,
    /// New file content description.
    pub new_file: String,
    /// The hunks of changes.
    pub hunks: Vec<DiffHunk>,
    /// Total lines added.
    pub lines_added: usize,
    /// Total lines removed.
    pub lines_removed: usize,
    /// Whether this is a new file.
    pub is_new_file: bool,
}

/// Generate a unified diff between two strings.
///
/// # Arguments
/// * `old_content` - The original content (None for new files)
/// * `new_content` - The new content
/// * `file_path` - Optional file path for display
/// * `context_lines` - Number of context lines to include (default: 3)
///
/// # Example
/// ```
/// use codi::tui::diff::generate_unified_diff;
///
/// let old = "line1\nline2\nline3";
/// let new = "line1\nmodified\nline3";
/// let diff = generate_unified_diff(Some(old), new, Some("file.txt"), 3);
///
/// assert!(diff.hunks.len() > 0);
/// assert_eq!(diff.file_path, Some("file.txt".to_string()));
/// ```
pub fn generate_unified_diff(
    old_content: Option<&str>,
    new_content: &str,
    file_path: Option<&str>,
    context_lines: usize,
) -> UnifiedDiff {
    let old_content = old_content.unwrap_or("");
    let is_new_file = old_content.is_empty() && !new_content.is_empty();

    let old_lines: Vec<&str> = old_content.lines().collect();
    let new_lines: Vec<&str> = new_content.lines().collect();

    // Compute LCS-based diff
    let changes = compute_diff(&old_lines, &new_lines);

    // Group changes into hunks with context
    let hunks = create_hunks(&changes, &old_lines, &new_lines, context_lines);

    // Count statistics
    let mut lines_added = 0usize;
    let mut lines_removed = 0usize;
    for change in &changes {
        match change {
            Change::Add(_) => lines_added += 1,
            Change::Delete(_) => lines_removed += 1,
            _ => {}
        }
    }

    UnifiedDiff {
        file_path: file_path.map(|s| s.to_string()),
        old_file: if is_new_file {
            "/dev/null".to_string()
        } else {
            format!("a/{}", file_path.unwrap_or("file"))
        },
        new_file: format!("b/{}", file_path.unwrap_or("file")),
        hunks,
        lines_added,
        lines_removed,
        is_new_file,
    }
}

/// A change operation from the diff algorithm.
#[derive(Debug, Clone)]
enum Change {
    /// Line kept from old (with index).
    Keep(usize),
    /// Line deleted from old (with index).
    Delete(usize),
    /// Line added from new (with index).
    Add(usize),
}

/// Compute the diff between two sequences using a simple LCS algorithm.
fn compute_diff(old: &[&str], new: &[&str]) -> Vec<Change> {
    let m = old.len();
    let n = new.len();

    // Use dynamic programming for LCS
    // dp[i][j] = length of LCS of old[0..i] and new[0..j]
    let mut dp = vec![vec![0usize; n + 1]; m + 1];

    for i in (0..m).rev() {
        for j in (0..n).rev() {
            if old[i] == new[j] {
                dp[i][j] = dp[i + 1][j + 1] + 1;
            } else {
                dp[i][j] = dp[i][j + 1].max(dp[i + 1][j]);
            }
        }
    }

    // Backtrack to find changes
    let mut changes = Vec::new();
    let mut i = 0usize;
    let mut j = 0usize;

    while i < m || j < n {
        if i < m && j < n && old[i] == new[j] {
            changes.push(Change::Keep(i));
            i += 1;
            j += 1;
        } else if j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j]) {
            changes.push(Change::Add(j));
            j += 1;
        } else if i < m {
            changes.push(Change::Delete(i));
            i += 1;
        } else {
            changes.push(Change::Add(j));
            j += 1;
        }
    }

    changes
}

/// Create hunks from changes with context lines.
fn create_hunks(
    changes: &[Change],
    old_lines: &[&str],
    new_lines: &[&str],
    context_lines: usize,
) -> Vec<DiffHunk> {
    let mut hunks = Vec::new();
    let mut current_hunk: Option<(usize, usize, Vec<DiffLine>)> = None;

    let mut old_line_num = 1usize;
    let mut new_line_num = 1usize;
    let mut last_change_end = 0usize;

    for (idx, change) in changes.iter().enumerate() {
        let is_change = matches!(change, Change::Add(_) | Change::Delete(_));

        if is_change {
            // Check if we need to start a new hunk
            let gap = idx.saturating_sub(last_change_end);
            let needs_new_hunk = current_hunk.is_none() || gap > context_lines * 2;

            if needs_new_hunk {
                // Finish current hunk if exists
                if let Some((old_start, new_start, lines)) = current_hunk.take() {
                    hunks.push(DiffHunk {
                        old_start,
                        old_lines: old_line_num.saturating_sub(old_start),
                        new_start,
                        new_lines: new_line_num.saturating_sub(new_start),
                        lines,
                    });
                }

                // Start new hunk with context lines
                let context_start = idx.saturating_sub(context_lines);
                let old_start = old_line_num.saturating_sub(idx - context_start);
                let new_start = new_line_num.saturating_sub(idx - context_start);
                let mut lines = Vec::new();

                // Add leading context
                for ctx_idx in context_start..idx {
                    if let Change::Keep(i) = &changes[ctx_idx] {
                        lines.push(DiffLine::Context(old_lines[*i].to_string()));
                    }
                }

                current_hunk = Some((old_start, new_start, lines));
            } else {
                // Add gap context lines
                for ctx_idx in last_change_end..idx {
                    if let Change::Keep(i) = &changes[ctx_idx] {
                        if let Some((_, _, ref mut lines)) = current_hunk {
                            lines.push(DiffLine::Context(old_lines[*i].to_string()));
                        }
                    }
                }
            }

            // Add the change
            if let Some((_, _, ref mut lines)) = current_hunk {
                match change {
                    Change::Delete(i) => {
                        lines.push(DiffLine::Removed(old_lines[*i].to_string()));
                    }
                    Change::Add(i) => {
                        lines.push(DiffLine::Added(new_lines[*i].to_string()));
                    }
                    _ => {}
                }
            }

            last_change_end = idx + 1;
        }

        // Update line counters
        match change {
            Change::Keep(_) | Change::Delete(_) => old_line_num += 1,
            _ => {}
        }
        match change {
            Change::Keep(_) | Change::Add(_) => new_line_num += 1,
            _ => {}
        }
    }

    // Add trailing context to last hunk
    if let Some((old_start, new_start, ref mut lines)) = current_hunk {
        let end = (last_change_end + context_lines).min(changes.len());
        for ctx_idx in last_change_end..end {
            if let Change::Keep(i) = &changes[ctx_idx] {
                lines.push(DiffLine::Context(old_lines[*i].to_string()));
            }
        }

        hunks.push(DiffHunk {
            old_start,
            old_lines: old_line_num.saturating_sub(old_start),
            new_start,
            new_lines: new_line_num.saturating_sub(new_start),
            lines,
        });
    }

    hunks
}

/// Render a unified diff as a string (git diff format).
pub fn render_diff_to_string(diff: &UnifiedDiff) -> String {
    let mut output = String::new();

    // Header
    writeln!(output, "--- {}", diff.old_file).unwrap();
    writeln!(output, "+++ {}", diff.new_file).unwrap();

    // Hunks
    for hunk in &diff.hunks {
        writeln!(
            output,
            "@@ -{},{} +{},{} @@",
            hunk.old_start, hunk.old_lines, hunk.new_start, hunk.new_lines
        )
        .unwrap();

        for line in &hunk.lines {
            match line {
                DiffLine::Context(s) => writeln!(output, " {}", s).unwrap(),
                DiffLine::Added(s) => writeln!(output, "+{}", s).unwrap(),
                DiffLine::Removed(s) => writeln!(output, "-{}", s).unwrap(),
            }
        }
    }

    output
}

/// Parse a unified diff from a string.
///
/// This is a simple parser that handles the format generated by
/// `generate_unified_diff` and standard git diff output.
pub fn parse_unified_diff(input: &str, file_path: Option<&str>) -> UnifiedDiff {
    let mut hunks = Vec::new();
    let mut old_file = String::new();
    let mut new_file = String::new();
    let mut lines_added = 0usize;
    let mut lines_removed = 0usize;
    let mut is_new_file = false;

    let mut current_hunk: Option<DiffHunk> = None;

    for line in input.lines() {
        if line.starts_with("--- ") {
            old_file = line[4..].to_string();
            is_new_file = old_file == "/dev/null";
        } else if line.starts_with("+++ ") {
            new_file = line[4..].to_string();
        } else if line.starts_with("@@") {
            // Save previous hunk if exists
            if let Some(hunk) = current_hunk.take() {
                hunks.push(hunk);
            }

            // Parse hunk header: @@ -old_start,old_lines +new_start,new_lines @@
            if let Some(end) = line.find(" @@") {
                let header = &line[3..end];
                let parts: Vec<&str> = header.split_whitespace().collect();
                if parts.len() == 2 {
                    let old_part = parts[0].trim_start_matches('-');
                    let new_part = parts[1].trim_start_matches('+');

                    let (old_start, old_lines) = parse_range(old_part);
                    let (new_start, new_lines) = parse_range(new_part);

                    current_hunk = Some(DiffHunk {
                        old_start,
                        old_lines,
                        new_start,
                        new_lines,
                        lines: Vec::new(),
                    });
                }
            }
        } else if let Some(ref mut hunk) = current_hunk {
            if let Some(content) = line.strip_prefix('+') {
                hunk.lines.push(DiffLine::Added(content.to_string()));
                lines_added += 1;
            } else if let Some(content) = line.strip_prefix('-') {
                hunk.lines.push(DiffLine::Removed(content.to_string()));
                lines_removed += 1;
            } else if let Some(content) = line.strip_prefix(' ') {
                hunk.lines.push(DiffLine::Context(content.to_string()));
            } else if !line.is_empty() {
                // Treat unknown lines as context (handles missing leading space)
                hunk.lines.push(DiffLine::Context(line.to_string()));
            }
        }
    }

    // Don't forget the last hunk
    if let Some(hunk) = current_hunk {
        hunks.push(hunk);
    }

    UnifiedDiff {
        file_path: file_path.map(|s| s.to_string()),
        old_file,
        new_file,
        hunks,
        lines_added,
        lines_removed,
        is_new_file,
    }
}

/// Parse a range string like "1,5" or "1" into (start, count).
fn parse_range(s: &str) -> (usize, usize) {
    if let Some(comma) = s.find(',') {
        let start = s[..comma].parse().unwrap_or(1);
        let count = s[comma + 1..].parse().unwrap_or(1);
        (start, count)
    } else {
        (s.parse().unwrap_or(1), 1)
    }
}

/// Get summary statistics for a diff.
pub fn diff_stats(diff: &UnifiedDiff) -> String {
    if diff.is_new_file {
        format!("{} insertions(+)", diff.lines_added)
    } else if diff.lines_added == 0 && diff.lines_removed == 0 {
        "no changes".to_string()
    } else {
        format!(
            "{} insertions(+), {} deletions(-)",
            diff.lines_added, diff.lines_removed
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_simple_diff() {
        let old = "line1\nline2\nline3";
        let new = "line1\nmodified\nline3";

        let diff = generate_unified_diff(Some(old), new, Some("test.txt"), 3);

        assert_eq!(diff.file_path, Some("test.txt".to_string()));
        assert!(!diff.is_new_file);
        assert!(diff.lines_added > 0);
        assert!(diff.lines_removed > 0);
        assert!(!diff.hunks.is_empty());
    }

    #[test]
    fn test_generate_new_file() {
        let new = "line1\nline2\nline3";

        let diff = generate_unified_diff(None, new, Some("test.txt"), 3);

        assert!(diff.is_new_file);
        assert_eq!(diff.lines_added, 3);
        assert_eq!(diff.lines_removed, 0);
    }

    #[test]
    fn test_diff_line_types() {
        let context = DiffLine::Context("hello".to_string());
        let added = DiffLine::Added("world".to_string());
        let removed = DiffLine::Removed("foo".to_string());

        assert_eq!(context.prefix(), ' ');
        assert_eq!(added.prefix(), '+');
        assert_eq!(removed.prefix(), '-');

        assert_eq!(context.content(), "hello");
        assert_eq!(added.content(), "world");
        assert_eq!(removed.content(), "foo");
    }

    #[test]
    fn test_render_and_parse() {
        let old = "foo\nbar\nbaz";
        let new = "foo\nqux\nbaz";

        let diff = generate_unified_diff(Some(old), new, Some("file.txt"), 3);
        let rendered = render_diff_to_string(&diff);

        // Should be parseable
        let parsed = parse_unified_diff(&rendered, Some("file.txt"));

        assert_eq!(parsed.file_path, diff.file_path);
        assert_eq!(parsed.lines_added, diff.lines_added);
        assert_eq!(parsed.lines_removed, diff.lines_removed);
        assert_eq!(parsed.hunks.len(), diff.hunks.len());
    }

    #[test]
    fn test_diff_stats() {
        let diff = UnifiedDiff {
            file_path: Some("test.txt".to_string()),
            old_file: "a/test.txt".to_string(),
            new_file: "b/test.txt".to_string(),
            hunks: vec![],
            lines_added: 5,
            lines_removed: 3,
            is_new_file: false,
        };

        assert_eq!(diff_stats(&diff), "5 insertions(+), 3 deletions(-)");

        let new_file_diff = UnifiedDiff {
            file_path: Some("test.txt".to_string()),
            old_file: "/dev/null".to_string(),
            new_file: "b/test.txt".to_string(),
            hunks: vec![],
            lines_added: 10,
            lines_removed: 0,
            is_new_file: true,
        };

        assert_eq!(diff_stats(&new_file_diff), "10 insertions(+)");
    }

    #[test]
    fn test_empty_diff() {
        let old = "line1\nline2";
        let new = "line1\nline2";

        let diff = generate_unified_diff(Some(old), new, Some("test.txt"), 3);

        assert_eq!(diff.lines_added, 0);
        assert_eq!(diff.lines_removed, 0);
    }

    #[test]
    fn test_multiline_diff() {
        let old = "a\nb\nc\nd\ne";
        let new = "a\nX\nc\nY\ne";

        let diff = generate_unified_diff(Some(old), new, Some("test.txt"), 2);

        assert_eq!(diff.lines_added, 2);
        assert_eq!(diff.lines_removed, 2);
    }

    #[test]
    fn test_parse_range() {
        assert_eq!(parse_range("1,5"), (1, 5));
        assert_eq!(parse_range("10,20"), (10, 20));
        assert_eq!(parse_range("5"), (5, 1));
        assert_eq!(parse_range("invalid"), (1, 1));
    }

    #[test]
    fn test_compute_diff_identical() {
        let old: Vec<&str> = vec!["a", "b", "c"];
        let new: Vec<&str> = vec!["a", "b", "c"];

        let changes = compute_diff(&old, &new);

        // All should be Keep
        assert!(changes.iter().all(|c| matches!(c, Change::Keep(_))));
        assert_eq!(changes.len(), 3);
    }

    #[test]
    fn test_compute_diff_additions() {
        let old: Vec<&str> = vec!["a", "c"];
        let new: Vec<&str> = vec!["a", "b", "c"];

        let changes = compute_diff(&old, &new);

        assert_eq!(changes.len(), 3);
        assert!(matches!(changes[0], Change::Keep(0)));
        assert!(matches!(changes[1], Change::Add(1))); // 'b' added
        assert!(matches!(changes[2], Change::Keep(1)));
    }

    #[test]
    fn test_compute_diff_deletions() {
        let old: Vec<&str> = vec!["a", "b", "c"];
        let new: Vec<&str> = vec!["a", "c"];

        let changes = compute_diff(&old, &new);

        assert_eq!(changes.len(), 3);
        assert!(matches!(changes[0], Change::Keep(0)));
        assert!(matches!(changes[1], Change::Delete(1))); // 'b' deleted
        assert!(matches!(changes[2], Change::Keep(2)));
    }
}
