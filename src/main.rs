// Clavis — Tauri backend
// Compiles Typst documents to SVG/PDF, drives system LaTeX engines, and persists settings.

#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod bib;
mod latex;
mod settings;
mod typst_world;

use base64::Engine as _;
use parking_lot::Mutex;
use serde::Serialize;
use std::sync::Arc;
use tauri::Manager;

#[derive(Default)]
struct AppState {
    world: Mutex<Option<typst_world::SimpleWorld>>,
}

#[derive(Serialize)]
struct TypstResult {
    ok: bool,
    svg: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TypstPdfResult {
    ok: bool,
    pdf_base64: Option<String>,
    error: Option<String>,
}

#[tauri::command]
fn compile_typst(state: tauri::State<'_, Arc<AppState>>, source: String) -> TypstResult {
    let mut guard = state.world.lock();
    if guard.is_none() {
        match typst_world::SimpleWorld::new() {
            Ok(w) => *guard = Some(w),
            Err(e) => {
                return TypstResult { ok: false, svg: None, error: Some(format!("init: {e}")) };
            }
        }
    }
    let world = guard.as_mut().unwrap();
    world.set_source(source);

    match typst_world::compile_to_svg(world) {
        Ok(svg) => TypstResult { ok: true, svg: Some(svg), error: None },
        Err(msg) => TypstResult { ok: false, svg: None, error: Some(msg) },
    }
}

#[tauri::command]
fn compile_typst_pdf(state: tauri::State<'_, Arc<AppState>>, source: String) -> TypstPdfResult {
    let mut guard = state.world.lock();
    if guard.is_none() {
        match typst_world::SimpleWorld::new() {
            Ok(w) => *guard = Some(w),
            Err(e) => return TypstPdfResult { ok: false, pdf_base64: None, error: Some(format!("init: {e}")) },
        }
    }
    let world = guard.as_mut().unwrap();
    world.set_source(source);

    match typst_world::compile_to_pdf(world) {
        Ok(bytes) => {
            let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
            TypstPdfResult { ok: true, pdf_base64: Some(b64), error: None }
        }
        Err(msg) => TypstPdfResult { ok: false, pdf_base64: None, error: Some(msg) },
    }
}

#[tauri::command]
fn list_typst_fonts() -> Vec<String> {
    typst_world::list_fonts()
}

/// One node in the folder-tree returned by `scan_folder`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TreeNode {
    name: String,
    /// Absolute path on disk
    path: String,
    is_dir: bool,
    /// Only populated for directories
    children: Vec<TreeNode>,
}

/// Scan a folder recursively.
///
///  * Keep the tree permissive so the app can show all files it has access to.
///  * Hard cap on depth and total node count so a wrong drag of `~` doesn't hang.
#[tauri::command]
fn scan_folder(root: String) -> Result<TreeNode, String> {
    use std::path::Path;
    let root_path = Path::new(&root);
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }
    const MAX_NODES: usize = 5000;
    const MAX_DEPTH: usize = 12;
    let mut counter: usize = 0;
    fn walk(p: &std::path::Path, depth: usize, counter: &mut usize, max_nodes: usize, max_depth: usize) -> TreeNode {
        let name = p.file_name().map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| p.to_string_lossy().into_owned());
        let mut node = TreeNode {
            name,
            path: p.to_string_lossy().into_owned(),
            is_dir: p.is_dir(),
            children: Vec::new(),
        };
        if !node.is_dir || depth >= max_depth { return node; }
        let entries = match std::fs::read_dir(p) {
            Ok(e) => e,
            Err(_) => return node,
        };
        let mut kids: Vec<TreeNode> = Vec::new();
        for entry in entries.flatten() {
            if *counter >= max_nodes { break; }
            let name = entry.file_name().to_string_lossy().into_owned();
            if skip_name(&name) { continue; }
            *counter += 1;
            kids.push(walk(&entry.path(), depth + 1, counter, max_nodes, max_depth));
        }
        // Directories first, then files; both alphabetical, case-insensitive.
        kids.sort_by(|a, b| {
            match (a.is_dir, b.is_dir) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            }
        });
        node.children = kids;
        node
    }
    fn skip_name(name: &str) -> bool {
        let _ = name;
        false
    }
    Ok(walk(root_path, 0, &mut counter, MAX_NODES, MAX_DEPTH))
}

/// Scan only the current folder level so the UI can lazy-load children on demand.
#[tauri::command]
fn scan_folder_shallow(root: String) -> Result<TreeNode, String> {
    use std::path::Path;
    let root_path = Path::new(&root);
    if !root_path.is_dir() {
        return Err(format!("not a directory: {root}"));
    }

    let name = root_path.file_name().map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| root_path.to_string_lossy().into_owned());
    let mut node = TreeNode {
        name,
        path: root_path.to_string_lossy().into_owned(),
        is_dir: true,
        children: Vec::new(),
    };

    let entries = match std::fs::read_dir(root_path) {
        Ok(e) => e,
        Err(_) => return Ok(node),
    };

    let mut kids: Vec<TreeNode> = Vec::new();
    for entry in entries.flatten() {
        let child_path = entry.path();
        let child_name = entry.file_name().to_string_lossy().into_owned();
        let is_dir = child_path.is_dir();
        kids.push(TreeNode {
            name: child_name,
            path: child_path.to_string_lossy().into_owned(),
            is_dir,
            children: Vec::new(),
        });
    }

    kids.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });
    node.children = kids;
    Ok(node)
}

fn main() {
    // Eagerly initialize Typst fonts in a background thread so it doesn't block the UI
    // or the first render call from freezing the app on startup.
    std::thread::spawn(|| {
        let _ = typst_world::list_fonts();
    });

    let state = Arc::new(AppState::default());
    let latex_state = latex::LatexState::default();

    // macOS gets the standard system menu (provides ⌘Q, ⌘W, ⌘M, ⌘H, Edit menu
    // with Cut/Copy/Paste/Undo bindings, etc.). Other platforms use no menu —
    // we expose actions via the in-app toolbar / command palette.
    #[cfg(target_os = "macos")]
    let menu = tauri::Menu::os_default("Clavis");
    #[cfg(not(target_os = "macos"))]
    let menu = tauri::Menu::new();

    tauri::Builder::default()
        .menu(menu)
        .manage(state)
        .manage(latex_state)
        .invoke_handler(tauri::generate_handler![
            compile_typst,
            compile_typst_pdf,
            list_typst_fonts,
            scan_folder,
            scan_folder_shallow,
            latex::compile_latex,
            latex::synctex_forward,
            latex::synctex_backward,
            latex::cleanup_workdir,
            latex::export_latex_pdf,
            latex::read_latex_log,
            latex::collect_project_files,
            latex::detect_distro,
            latex::install_package,
            latex::parse_bib,
            settings::get_settings,
            settings::set_settings,
            settings::detect_latex_engines,
            settings::detect_bib_engines,
        ])
        .on_window_event(|event| {
            if let tauri::WindowEvent::Destroyed = event.event() {
                if let Some(s) = event.window().try_state::<latex::LatexState>() {
                    s.clear();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
