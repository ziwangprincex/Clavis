//! SyncTeX forward (source → PDF) and backward (PDF → source) via the
//! `synctex` CLI, plus the accumulator that parses its block output.

use super::engine::{find_in_fallback_dirs, run_synctex};
use super::types::{SyncTexEdit, SyncTexHit};
use super::{MAIN_PDF, MAIN_TEX};

#[tauri::command]
pub async fn synctex_forward(
    workdir_token: String,
    line: u32,
    column: u32,
    state: tauri::State<'_, super::workdir::LatexState>,
) -> Result<SyncTexHit, String> {
    let dir = state.get(&workdir_token).ok_or_else(|| "unknown workdir".to_string())?;
    let workdir = dir.path().to_path_buf();
    let synctex = which::which("synctex").ok()
        .or_else(|| find_in_fallback_dirs("synctex"))
        .ok_or_else(|| "synctex not in PATH".to_string())?;
    let i_arg = format!("{}:{}:{}", line, column, MAIN_TEX);
    let pdf = MAIN_PDF.to_string();
    let out = run_synctex(&synctex, &["view", "-i", &i_arg, "-o", &pdf], &workdir).await?;

    // Pick the FIRST block (the engine emits one per match).
    let mut hit: Option<SyncTexHit> = None;
    let mut cur = SyncTexAcc::default();
    for raw in out.lines() {
        let l = raw.trim();
        if l == "SyncTeX result begin" || l == "SyncTeX result end" {
            if !cur.is_empty() {
                if let Some(h) = cur.take_view() { hit = Some(h); break; }
            }
            continue;
        }
        cur.feed(l);
    }
    if hit.is_none() {
        if let Some(h) = cur.take_view() { hit = Some(h); }
    }
    hit.ok_or_else(|| "no SyncTeX hit".to_string())
}

#[tauri::command]
pub async fn synctex_backward(
    workdir_token: String,
    page: u32,
    x: f64,
    y: f64,
    state: tauri::State<'_, super::workdir::LatexState>,
) -> Result<SyncTexEdit, String> {
    let dir = state.get(&workdir_token).ok_or_else(|| "unknown workdir".to_string())?;
    let workdir = dir.path().to_path_buf();
    let synctex = which::which("synctex").ok()
        .or_else(|| find_in_fallback_dirs("synctex"))
        .ok_or_else(|| "synctex not in PATH".to_string())?;
    let o_arg = format!("{}:{}:{}:{}", page, x, y, MAIN_PDF);
    let out = run_synctex(&synctex, &["edit", "-o", &o_arg], &workdir).await?;

    let mut edit: Option<SyncTexEdit> = None;
    let mut cur = SyncTexAcc::default();
    for raw in out.lines() {
        let l = raw.trim();
        if l == "SyncTeX result begin" || l == "SyncTeX result end" {
            if !cur.is_empty() {
                if let Some(e) = cur.take_edit() { edit = Some(e); break; }
            }
            continue;
        }
        cur.feed(l);
    }
    if edit.is_none() {
        if let Some(e) = cur.take_edit() { edit = Some(e); }
    }
    edit.ok_or_else(|| "no SyncTeX backward hit".to_string())
}

#[derive(Default)]
struct SyncTexAcc {
    page: Option<u32>,
    x: Option<f64>,
    y: Option<f64>,
    h: Option<f64>,
    v: Option<f64>,
    w: Option<f64>,
    height: Option<f64>,
    line: Option<u32>,
    column: Option<u32>,
    input: Option<String>,
}

impl SyncTexAcc {
    fn is_empty(&self) -> bool {
        self.page.is_none() && self.line.is_none()
    }
    fn feed(&mut self, l: &str) {
        if let Some(v) = l.strip_prefix("Page:") { self.page = v.trim().parse().ok(); }
        else if let Some(v) = l.strip_prefix("x:") { self.x = v.trim().parse().ok(); }
        else if let Some(v) = l.strip_prefix("y:") { self.y = v.trim().parse().ok(); }
        else if let Some(v) = l.strip_prefix("h:") { self.h = v.trim().parse().ok(); }
        else if let Some(v) = l.strip_prefix("v:") { self.v = v.trim().parse().ok(); }
        else if let Some(v) = l.strip_prefix("W:") { self.w = v.trim().parse().ok(); }
        else if let Some(v) = l.strip_prefix("H:") { self.height = v.trim().parse().ok(); }
        else if let Some(v) = l.strip_prefix("Line:") { self.line = v.trim().parse().ok(); }
        else if let Some(v) = l.strip_prefix("Column:") { self.column = v.trim().parse().ok(); }
        else if let Some(v) = l.strip_prefix("Input:") { self.input = Some(v.trim().to_string()); }
    }
    fn take_view(&mut self) -> Option<SyncTexHit> {
        let page = self.page.take()?;
        Some(SyncTexHit {
            page,
            x: self.x.take().unwrap_or(0.0),
            y: self.y.take().unwrap_or(0.0),
            h: self.h.take().unwrap_or(0.0),
            v: self.v.take().unwrap_or(0.0),
            w: self.w.take().unwrap_or(0.0),
            height: self.height.take().unwrap_or(0.0),
        })
    }
    fn take_edit(&mut self) -> Option<SyncTexEdit> {
        let line = self.line.take()?;
        Some(SyncTexEdit {
            line,
            column: self.column.take().unwrap_or(0),
            input_file: self.input.take().unwrap_or_default(),
        })
    }
}
