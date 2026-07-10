//! Parsing LaTeX / BibTeX engine output into structured diagnostics.

use super::types::LatexDiag;

pub(crate) fn detect_bib_kind(source: &str) -> Option<&'static str> {
    if source.contains("\\addbibresource") {
        Some("biber")
    } else if source.contains("\\bibliography{") {
        Some("bibtex")
    } else {
        None
    }
}

pub(crate) fn rerun_signal(text: &str) -> bool {
    text.contains("Rerun to get cross-references right")
        || text.contains("Label(s) may have changed")
        || text.contains("Rerun LaTeX")
        || text.contains("Please rerun LaTeX")
        || text.contains("Citation")
            && (text.contains("undefined") || text.contains("on page"))
}

/// Classify a log message text (without the leading `file.tex:NN:` if any).
/// Returns (kind, package_if_missing_file).
fn classify_message(msg: &str) -> (&'static str, Option<String>) {
    if let Some(pkg) = extract_missing_pkg(msg) {
        return ("missing-file", Some(pkg));
    }
    let lo = msg.to_ascii_lowercase();
    if lo.starts_with("latex warning") || lo.starts_with("package ") && lo.contains("warning") {
        return ("warning", None);
    }
    if lo.starts_with("overfull \\") || lo.starts_with("underfull \\") {
        return ("badbox", None);
    }
    ("error", None)
}

pub(crate) fn parse_diags(log: &str) -> Vec<LatexDiag> {
    use regex::Regex;
    // Capture the source filename too (group 1) — in a multi-file project the
    // engine emits the real file, e.g. "./chapters/intro.tex:12:", not always
    // main.tex. Group 2 = line, group 3 = message.
    let re_file_line = Regex::new(r"^(?:\./)?([^:\n]*\.tex):(\d+):\s*(.*)$").unwrap();
    let re_latex_err = Regex::new(r"^! LaTeX Error:\s*(.*)$").unwrap();
    let re_package_err = Regex::new(r"^! Package\s+([A-Za-z0-9._-]+)\s+Error:\s*(.*)$").unwrap();
    let re_font_err = Regex::new(r"^! Font\s+([A-Za-z0-9._-]+)\s+Error:\s*(.*)$").unwrap();
    let re_generic_err = Regex::new(r"^!\s*(.*\S)\s*$").unwrap();
    let re_warn = Regex::new(r"^LaTeX Warning:\s*(.*?)(?:\s+on input line\s+(\d+))?\.?\s*$").unwrap();
    let re_badbox = Regex::new(r"^(Overfull|Underfull) \\(?:hbox|vbox)\b.*$").unwrap();
    let re_bibtex_db = Regex::new(r"I couldn't open database file\s+(.+)$").unwrap();
    // Missing files: handle a few common phrasings across MiKTeX / TeX Live.
    let re_file_not_found = Regex::new(r"(?i)!?\s*(?:LaTeX Error:\s*)?File\s+[`'](.+?)['`]\s+not found").unwrap();
    let re_miktex = Regex::new(r"(?i)the\s+package\s+(\S+?)\s+(?:is\s+)?(?:not\s+installed|could\s+not\s+be\s+found)").unwrap();

    let mut out = Vec::new();
    for line in log.lines() {
        if let Some(c) = re_file_line.captures(line) {
            // -file-line-error wraps almost every diagnostic as "file.tex:N: ...";
            // classify by the inner message, not by the wrapper. Keep the file so
            // the UI can jump to the right source in a multi-file project.
            let file = c.get(1).map(|m| m.as_str().to_string());
            let line_no = c.get(2).and_then(|m| m.as_str().parse().ok());
            let msg = c.get(3).map_or("", |m| m.as_str()).trim().to_string();
            let (kind, package) = classify_message(&msg);
            out.push(LatexDiag { line: line_no, file, message: msg, kind, package });
        } else if let Some(c) = re_file_not_found.captures(line) {
            let raw = c.get(1).map(|m| m.as_str()).unwrap_or("");
            let pkg = strip_known_ext(raw);
            out.push(LatexDiag {
                line: None,
                file: None,
                message: format!("File `{raw}' not found"),
                kind: "missing-file",
                package: Some(pkg),
            });
        } else if let Some(c) = re_miktex.captures(line) {
            let raw = c.get(1).map(|m| m.as_str()).unwrap_or("?").to_string();
            out.push(LatexDiag {
                line: None,
                file: None,
                message: format!("MiKTeX: package {raw} not installed"),
                kind: "missing-file",
                package: Some(raw),
            });
        } else if let Some(c) = re_latex_err.captures(line) {
            let msg = c.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
            let (kind, package) = classify_message(&msg);
            out.push(LatexDiag { line: None, file: None, message: msg, kind, package });
        } else if let Some(c) = re_package_err.captures(line) {
            let package = c.get(1).map(|m| m.as_str().to_string());
            let msg = c.get(2).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
            let (kind, _) = classify_message(&msg);
            out.push(LatexDiag { line: None, file: None, message: format!("Package {} Error: {}", package.as_deref().unwrap_or("?"), msg), kind, package });
        } else if let Some(c) = re_font_err.captures(line) {
            let package = c.get(1).map(|m| m.as_str().to_string());
            let msg = c.get(2).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
            out.push(LatexDiag { line: None, file: None, message: format!("Font {} Error: {}", package.as_deref().unwrap_or("?"), msg), kind: "missing-file", package });
        } else if let Some(c) = re_generic_err.captures(line) {
            let msg = c.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
            let (kind, package) = classify_message(&msg);
            out.push(LatexDiag { line: None, file: None, message: msg, kind, package });
        } else if let Some(c) = re_warn.captures(line) {
            out.push(LatexDiag {
                line: c.get(2).and_then(|m| m.as_str().parse().ok()),
                file: None,
                message: c.get(1).map(|m| m.as_str().to_string()).unwrap_or_default(),
                kind: "warning",
                package: None,
            });
        } else if re_badbox.is_match(line) {
            out.push(LatexDiag {
                line: None,
                file: None,
                message: line.trim().to_string(),
                kind: "badbox",
                package: None,
            });
        } else if let Some(c) = re_bibtex_db.captures(line) {
            out.push(LatexDiag {
                line: None,
                file: None,
                message: format!("Missing bibliography database: {}", c.get(1).map(|m| m.as_str()).unwrap_or("?")),
                kind: "missing-ref",
                package: None,
            });
        }
    }
    // Dedup adjacent identical diagnostics. Include file+line so that the same
    // message at different locations (e.g. "Undefined control sequence" in two
    // chapters) is NOT collapsed — each keeps its own jump target.
    out.dedup_by(|a, b| {
        a.kind == b.kind && a.package == b.package && a.message == b.message
            && a.file == b.file && a.line == b.line
    });
    out
}

/// Append `extras` (e.g. diagnostics harvested from bibtex/biber) into `base`,
/// dropping duplicates that already exist in `base`. Order is preserved:
/// LaTeX-side diagnostics first, then any unique bib-side ones.
pub(crate) fn merge_diags(mut base: Vec<LatexDiag>, extras: &[LatexDiag]) -> Vec<LatexDiag> {
    for e in extras {
        let dup = base.iter().any(|b| {
            b.kind == e.kind && b.package == e.package && b.message == e.message
        });
        if !dup {
            base.push(LatexDiag {
                line: e.line,
                file: e.file.clone(),
                message: e.message.clone(),
                kind: e.kind,
                package: e.package.clone(),
            });
        }
    }
    base
}

fn strip_known_ext(name: &str) -> String {
    let n = name.trim();
    for ext in [".sty", ".cls", ".bst", ".def", ".cfg", ".fd", ".tfm", ".tex", ".ltx"] {
        if let Some(stem) = n.strip_suffix(ext) {
            return stem.to_string();
        }
    }
    n.to_string()
}

fn extract_missing_pkg(msg: &str) -> Option<String> {
    // "File `xxx.sty' not found." inside a message
    let re = regex::Regex::new(r"File\s+[`'](.+?)['`]\s+not found").unwrap();
    let cap = re.captures(msg)?;
    Some(strip_known_ext(cap.get(1)?.as_str()))
}

pub(crate) fn log_tail(log: &str) -> String {
    const MAX: usize = 8 * 1024;
    if log.len() <= MAX {
        log.to_string()
    } else {
        let start = log.len() - MAX;
        // align to a char boundary
        let mut s = start;
        while s < log.len() && !log.is_char_boundary(s) {
            s += 1;
        }
        format!("...[{} bytes truncated]...\n{}", start, &log[s..])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_missing_pkg_strips_extension() {
        assert_eq!(
            extract_missing_pkg("File `tikz.sty' not found."),
            Some("tikz".to_string())
        );
        assert_eq!(
            extract_missing_pkg("File `foo/bar.cls' not found"),
            Some("foo/bar".to_string())
        );
        assert_eq!(extract_missing_pkg("no missing file here"), None);
    }

    #[test]
    fn classify_message_detects_kinds() {
        assert_eq!(classify_message("File `x.sty' not found").0, "missing-file");
        assert_eq!(classify_message("LaTeX Warning: something").0, "warning");
        assert_eq!(classify_message("Overfull \\hbox (10pt too wide)").0, "badbox");
        assert_eq!(classify_message("Undefined control sequence").0, "error");
    }

    #[test]
    fn rerun_signal_matches_known_phrases() {
        assert!(rerun_signal("LaTeX Warning: Rerun to get cross-references right."));
        assert!(rerun_signal("Label(s) may have changed. Rerun to get them right."));
        assert!(rerun_signal("Citation `foo' undefined"));
        assert!(!rerun_signal("Everything is fine."));
    }

    #[test]
    fn parse_diags_file_line_error_wrapper() {
        let log = "./main.tex:42: Undefined control sequence.";
        let d = parse_diags(log);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].line, Some(42));
        assert_eq!(d[0].kind, "error");
        assert_eq!(d[0].file.as_deref(), Some("main.tex"));
    }

    #[test]
    fn parse_diags_captures_subfile_path() {
        // Multi-file: the engine reports the real file, not always main.tex.
        let log = "./chapters/intro.tex:12: Undefined control sequence.";
        let d = parse_diags(log);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].line, Some(12));
        assert_eq!(d[0].file.as_deref(), Some("chapters/intro.tex"));
    }

    #[test]
    fn parse_diags_missing_file_and_warning() {
        let log = "! LaTeX Error: File `tikz.sty' not found.\n\
                   LaTeX Warning: Reference `fig1' on input line 7.";
        let d = parse_diags(log);
        assert!(d.iter().any(|x| x.kind == "missing-file" && x.package.as_deref() == Some("tikz")));
        assert!(d.iter().any(|x| x.kind == "warning" && x.line == Some(7)));
    }

    #[test]
    fn parse_diags_dedups_identical() {
        let log = "! Undefined control sequence.\n! Undefined control sequence.";
        let d = parse_diags(log);
        assert_eq!(d.len(), 1);
    }
}
