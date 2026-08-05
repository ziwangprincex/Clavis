// Clavis — Tauri backend
// Compiles Typst documents to SVG/PDF, drives system LaTeX engines, and persists settings.

#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod bib;
mod cwl;
mod document_tools;
mod latex;
mod project_config;
mod references;
mod settings;
mod tasks;
mod typst_sig;
mod typst_world;
mod workspace_search;

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
fn compile_typst(
    state: tauri::State<'_, Arc<AppState>>,
    source: String,
    doc_path: Option<String>,
) -> TypstResult {
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
    world.set_root_from_doc(doc_path.as_deref());
    world.set_source(source);

    match typst_world::compile_to_svg(world) {
        Ok(svg) => TypstResult { ok: true, svg: Some(svg), error: None },
        Err(msg) => TypstResult { ok: false, svg: None, error: Some(msg) },
    }
}

#[tauri::command]
fn compile_typst_pdf(
    state: tauri::State<'_, Arc<AppState>>,
    source: String,
    doc_path: Option<String>,
) -> TypstPdfResult {
    let mut guard = state.world.lock();
    if guard.is_none() {
        match typst_world::SimpleWorld::new() {
            Ok(w) => *guard = Some(w),
            Err(e) => return TypstPdfResult { ok: false, pdf_base64: None, error: Some(format!("init: {e}")) },
        }
    }
    let world = guard.as_mut().unwrap();
    world.set_root_from_doc(doc_path.as_deref());
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
        matches!(
            name,
            "node_modules" | ".git" | ".svn" | ".hg" | ".DS_Store" | "__pycache__"
        )
    }
    Ok(walk(root_path, 0, &mut counter, MAX_NODES, MAX_DEPTH))
}

/// Write base64-encoded bytes to an arbitrary path the user picked in a save
/// dialog. Used by the Typst "Export PDF" flow, which gets its bytes from
/// `compile_typst_pdf` rather than a workdir on disk.
#[tauri::command]
fn save_binary_file(path: String, base64: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.as_bytes())
        .map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

/// Read a UTF-8 text file the user opened via the file dialog / recent list.
///
/// These three commands replace the Tauri JS `fs` API so the frontend has no
/// direct filesystem capability: the `fs` allowlist is removed entirely and all
/// reads/writes funnel through Rust, where they can be audited and (later)
/// gated by a path policy. Paths still come from user-driven dialogs.
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))
}

/// Write UTF-8 text to a path the user chose (save / save-as dialog).
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("{path}: {e}"))
}

/// Test whether a path exists (used to decide save-vs-save-as, recent-file pruning).
#[tauri::command]
fn path_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
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

/// Restore the native drop shadow on a frameless Windows window.
///
/// When `decorations: false` removes the WM_CAPTION-driven shadow, DWM will still
/// composite a shadow if the extended frame reaches into the client area. A 1px
/// margin is enough and doesn't reserve any pixel of the client rect for us to
/// avoid. This is the same trick `tauri-plugin-window-shadows` uses.
#[cfg(windows)]
fn restore_undecorated_shadow(window: &tauri::Window) -> Result<(), Box<dyn std::error::Error>> {
    use windows_sys::Win32::Graphics::Dwm::DwmExtendFrameIntoClientArea;
    use windows_sys::Win32::UI::Controls::MARGINS;

    // Tauri exposes HWND via the `windows` crate (tuple struct on isize); the
    // Dwm API here comes from `windows-sys` where HWND is `*mut c_void`. Cast.
    let hwnd_tauri = window.hwnd()?;
    let hwnd: windows_sys::Win32::Foundation::HWND = hwnd_tauri.0 as _;
    let margins = MARGINS {
        cxLeftWidth: 0,
        cxRightWidth: 0,
        cyTopHeight: 1,
        cyBottomHeight: 0,
    };
    // Safety: HWND is a valid, live window handle from Tauri.
    unsafe {
        DwmExtendFrameIntoClientArea(hwnd, &margins);
    }
    Ok(())
}

fn main() {
    // Eagerly initialize Typst fonts in a background thread so it doesn't block the UI
    // or the first render call from freezing the app on startup.
    std::thread::spawn(|| {
        let _ = typst_world::list_fonts();
    });

    let state = Arc::new(AppState::default());
    let latex_state = latex::LatexState::default();
    let task_state = Arc::new(tasks::TaskState::default());

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
        .manage(task_state)
        .setup(|app| {
            #[cfg(windows)]
            if let Some(window) = app.get_window("main") {
                // Frameless on Windows drops the native drop shadow. Restore it by
                // extending the DWM frame 1px into the client area — the standard
                // technique (same visual result as tao's private undecorated_shadow
                // path, which Tauri v1 does not expose). Failures are cosmetic and
                // must never block startup.
                let _ = restore_undecorated_shadow(&window);
            }
            #[cfg(not(windows))]
            let _ = app;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            compile_typst,
            compile_typst_pdf,
            list_typst_fonts,
            typst_sig::list_typst_signatures,
            scan_folder,
            scan_folder_shallow,
            save_binary_file,
            read_text_file,
            write_text_file,
            path_exists,
            latex::compile::compile_latex,
            latex::synctex::synctex_forward,
            latex::synctex::synctex_backward,
            latex::workdir::cleanup_workdir,
            latex::workdir::export_latex_pdf,
            latex::workdir::read_latex_log,
            latex::project::collect_project_files,
            latex::distro::detect_distro,
            latex::distro::install_package,
            latex::parse_bib,
            cwl::read_cwl,
            cwl::list_cwl_packages,
            project_config::inspect_workspace,
            project_config::set_workspace_trust,
            project_config::doctor_workspace,
            references::index_references,
            references::preview_reference_rename,
            references::apply_reference_rename,
            document_tools::inspect_document_tools,
            document_tools::start_document_render,
            document_tools::list_document_artifacts,
            document_tools::open_document_artifact,
            tasks::start_project_task,
            tasks::cancel_project_task,
            workspace_search::search_workspace,
            workspace_search::replace_workspace,
            settings::get_settings,
            settings::set_settings,
            settings::load_session,
            settings::save_session,
            settings::detect_latex_engines,
            settings::detect_bib_engines,
        ])
        .on_window_event(|event| {
            if let tauri::WindowEvent::Destroyed = event.event() {
                if let Some(s) = event.window().try_state::<latex::LatexState>() {
                    s.clear();
                }
                if let Some(s) = event.window().try_state::<Arc<tasks::TaskState>>() {
                    s.cancel_all();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
