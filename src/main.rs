// Clavis — Tauri backend
// Compiles Typst documents to SVG/PDF, drives system LaTeX engines, and persists settings.

#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod assets;
mod bib;
mod cwl;
mod document_io;
mod local_history;
mod markdown_images;
mod templates;
mod latex;
mod project_config;
mod references;
mod settings;
mod system_fonts;
mod system_open;
mod typst_service;
mod typst_preview;
mod typst_packages;
mod typst_sig;
mod typst_world;
mod workspace_search;
mod user_stylesheet;

use serde::Serialize;
use std::sync::Arc;
use tauri::{Emitter, Manager};

type AppState = typst_service::TypstCompiler;

#[tauri::command]
async fn compile_typst(
    state: tauri::State<'_, Arc<AppState>>, source: String, doc_path: Option<String>,
    snapshot: Option<typst_preview::TypstSnapshot>,
) -> Result<typst_preview::TypstPreview, String> {
    state.inner().clone().preview(source, doc_path, snapshot.unwrap_or_default()).await
}

#[tauri::command]
async fn render_formula(state: tauri::State<'_, Arc<AppState>>, source: String) -> Result<Option<String>, String> {
    if source.len() > 4000 { return Err("Formula is too large for inline preview".into()); }
    state.inner().clone().formula(source).await
}

/// The document as a PDF, as raw bytes (an `ArrayBuffer` in the frontend).
#[tauri::command]
async fn compile_typst_pdf(
    state: tauri::State<'_, Arc<AppState>>,
    source: String,
    doc_path: Option<String>,
    snapshot: Option<typst_preview::TypstSnapshot>,
) -> Result<tauri::ipc::Response, String> {
    let bytes = state.inner().clone().export(source, doc_path, snapshot.unwrap_or_default()).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// One node in the folder-tree returned by `scan_folder_shallow`.
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

/// Header naming the file `save_binary_file` writes, percent-encoded because
/// header values are ASCII and paths are not.
const PATH_HEADER: &str = "clavis-path";

/// Write the request's raw body to a path the user picked in a save dialog
/// (Typst PDF export, Markdown HTML export). The bytes travel unencoded.
#[tauri::command]
fn save_binary_file(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the file's bytes as the request body".into());
    };
    let path = request.headers().get(PATH_HEADER).and_then(|value| value.to_str().ok()).ok_or("missing target path")?;
    let path = percent_encoding::percent_decode_str(path).decode_utf8().map_err(|_| "target path is not UTF-8")?;
    std::fs::write(path.as_ref(), bytes).map_err(|e| format!("{path}: {e}"))
}

/// The PDF the main window shows, kept for the PDF window: windows exchange
/// events as JSON, so the bytes go through here rather than in an event.
#[derive(Default)]
struct SharedPdf(parking_lot::Mutex<Option<Arc<Vec<u8>>>>);

/// The main window hands over its PDF (an empty body clears it).
#[tauri::command]
fn share_pdf(request: tauri::ipc::Request<'_>, shared: tauri::State<'_, SharedPdf>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the PDF's bytes as the request body".into());
    };
    *shared.0.lock() = (!bytes.is_empty()).then(|| Arc::new(bytes.clone()));
    Ok(())
}

/// The PDF window reads the main window's PDF (empty when there is none).
#[tauri::command]
fn shared_pdf(shared: tauri::State<'_, SharedPdf>) -> tauri::ipc::Response {
    let bytes = shared.0.lock().clone();
    tauri::ipc::Response::new(bytes.map(|bytes| bytes.as_ref().clone()).unwrap_or_default())
}

/// Read a UTF-8 text file the user opened via the file dialog / recent list.
///
/// These commands replace the Tauri JS `fs` API so the frontend has no
/// direct filesystem capability: the `fs` allowlist is removed entirely and all
/// reads/writes funnel through Rust, where they can be audited and (later)
/// gated by a path policy. Paths still come from user-driven dialogs.
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))
}

/// Label of the window that shows only the PDF (it can sit on another display).
const PDF_WINDOW: &str = "pdf";

/// Menu items the backend acts on. Close Tab is also a command of the main
/// window, which runs it unless the PDF window is the one in front.
const CLOSE_TAB: &str = "tab.close";
const CLOSE_WINDOW: &str = "window.close";

/// Closes a window as its close button does. On macOS the main window stays
/// and Clavis is hidden instead, so it keeps running as Mac apps do. The app
/// is hidden rather than the window alone, because macOS itself brings a
/// hidden app's windows back on a click on the Dock icon.
fn close_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>, label: &str) {
    #[cfg(target_os = "macos")]
    if label != PDF_WINDOW {
        let _ = app.hide();
        return;
    }
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.close();
    }
}

/// ⌘W with no tab left. Not the JS `appWindow.close()`: a close asked for
/// from code skips `CloseRequested`, destroys the last window and so quits.
#[tauri::command]
fn close_this_window(window: tauri::Window) {
    close_window(window.app_handle(), window.label());
}

/// One entry of the macOS menu bar. The menu is described as data so a test
/// can check it without a running app.
#[cfg(target_os = "macos")]
#[derive(Debug, Clone, Copy, PartialEq)]
enum MenuEntry {
    /// A Clavis command: its id is a command-palette command the main window
    /// runs on `menu-command`, except Close Tab and Close Window.
    Command { id: &'static str, title: &'static str, accelerator: Option<&'static str> },
    About, Services, Hide, HideOthers, ShowAll, Quit,
    Undo, Redo, Cut, Copy, Paste, SelectAll,
    Fullscreen, Minimize, Zoom,
    Separator,
}

/// The standard macOS menu, with Check for Updates and Settings in the app
/// menu where Mac apps keep them. There is no standard Close Window item: it
/// binds ⌘W to the whole window, but documents are tabs, so ⌘W closes the tab
/// and ⇧⌘W the window, as in Safari.
#[cfg(target_os = "macos")]
fn menu_layout() -> Vec<(&'static str, Vec<MenuEntry>)> {
    use MenuEntry::*;
    vec![
        ("Clavis", vec![
            About,
            Command { id: "app.checkUpdates", title: "Check for Updates…", accelerator: None },
            Separator,
            Command { id: "app.settings", title: "Settings…", accelerator: Some("CmdOrCtrl+,") },
            Separator, Services, Separator, Hide, HideOthers, ShowAll, Separator, Quit,
        ]),
        ("File", vec![
            Command { id: CLOSE_TAB, title: "Close Tab", accelerator: Some("CmdOrCtrl+W") },
            Command { id: CLOSE_WINDOW, title: "Close Window", accelerator: Some("CmdOrCtrl+Shift+W") },
        ]),
        ("Edit", vec![Undo, Redo, Separator, Cut, Copy, Paste, SelectAll]),
        ("View", vec![Fullscreen]),
        ("Window", vec![Minimize, Zoom]),
    ]
}

#[cfg(target_os = "macos")]
fn app_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{AboutMetadata, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu, WINDOW_SUBMENU_ID};
    let menu = Menu::new(app)?;
    for (title, entries) in menu_layout() {
        let items = entries
            .into_iter()
            .map(|entry| -> tauri::Result<Box<dyn IsMenuItem<R>>> {
                Ok(match entry {
                    MenuEntry::Command { id, title, accelerator } => {
                        Box::new(MenuItem::with_id(app, id, title, true, accelerator)?)
                    }
                    MenuEntry::About => {
                        let info = app.package_info();
                        let about = AboutMetadata {
                            name: Some(info.name.clone()),
                            version: Some(info.version.to_string()),
                            ..Default::default()
                        };
                        Box::new(PredefinedMenuItem::about(app, None, Some(about))?)
                    }
                    MenuEntry::Services => Box::new(PredefinedMenuItem::services(app, None)?),
                    MenuEntry::Hide => Box::new(PredefinedMenuItem::hide(app, None)?),
                    MenuEntry::HideOthers => Box::new(PredefinedMenuItem::hide_others(app, None)?),
                    MenuEntry::ShowAll => Box::new(PredefinedMenuItem::show_all(app, None)?),
                    MenuEntry::Quit => Box::new(PredefinedMenuItem::quit(app, None)?),
                    MenuEntry::Undo => Box::new(PredefinedMenuItem::undo(app, None)?),
                    MenuEntry::Redo => Box::new(PredefinedMenuItem::redo(app, None)?),
                    MenuEntry::Cut => Box::new(PredefinedMenuItem::cut(app, None)?),
                    MenuEntry::Copy => Box::new(PredefinedMenuItem::copy(app, None)?),
                    MenuEntry::Paste => Box::new(PredefinedMenuItem::paste(app, None)?),
                    MenuEntry::SelectAll => Box::new(PredefinedMenuItem::select_all(app, None)?),
                    MenuEntry::Fullscreen => Box::new(PredefinedMenuItem::fullscreen(app, None)?),
                    MenuEntry::Minimize => Box::new(PredefinedMenuItem::minimize(app, None)?),
                    MenuEntry::Zoom => Box::new(PredefinedMenuItem::maximize(app, None)?),
                    MenuEntry::Separator => Box::new(PredefinedMenuItem::separator(app)?),
                })
            })
            .collect::<tauri::Result<Vec<_>>>()?;
        let items: Vec<&dyn IsMenuItem<R>> = items.iter().map(|item| item.as_ref()).collect();
        // The Window menu gets this id so macOS lists the open windows in it.
        let submenu = if title == "Window" {
            Submenu::with_id_and_items(app, WINDOW_SUBMENU_ID, title, true, &items)?
        } else {
            Submenu::with_items(app, title, true, &items)?
        };
        menu.append(&submenu)?;
    }
    Ok(menu)
}

/// Shows the compiled PDF in a window of its own, which can be moved to an
/// external display, as Texifier's viewer can. The main window keeps it updated.
#[tauri::command]
async fn open_pdf_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(PDF_WINDOW) {
        return window.set_focus().map_err(|e| format!("cannot show the PDF window: {e}"));
    }
    tauri::WebviewWindowBuilder::new(&app, PDF_WINDOW, tauri::WebviewUrl::App("index.html?window=pdf".into()))
        .title("Clavis — PDF")
        .inner_size(900.0, 1100.0)
        .min_inner_size(420.0, 360.0)
        .build()
        .map(|_| ())
        .map_err(|e| format!("cannot open the PDF window: {e}"))
}

/// Modification stamps of folders, for the file tree's change polling: a folder's
/// stamp changes when an entry in it is added, removed or renamed. A missing
/// folder is `None`. Stamps are nanoseconds as text, beyond JavaScript numbers.
#[tauri::command]
fn folder_stamps(paths: Vec<String>) -> Vec<Option<String>> {
    paths
        .iter()
        .take(2_000)
        .map(|path| {
            let metadata = std::fs::metadata(path).ok().filter(|m| m.is_dir())?;
            let modified = metadata.modified().ok()?;
            let since = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
            Some(since.as_nanos().to_string())
        })
        .collect()
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

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());
    // macOS gets the standard system menu (provides ⌘Q, ⌘M, ⌘H, Edit menu
    // with Cut/Copy/Paste/Undo bindings, etc.) plus Settings, Check for
    // Updates and Close Tab. Other platforms use no menu — we expose actions
    // via the in-app toolbar / command palette.
    #[cfg(target_os = "macos")]
    let builder = builder.menu(app_menu);

    builder
        .manage(state)
        .manage(latex_state)
        .manage(SharedPdf::default())
        .setup(|app| {
            // The frameless Windows window keeps its drop shadow: Tauri 2 draws
            // one for undecorated windows (`shadow` defaults to true).
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                // Set the live HWND icon explicitly. Windows can otherwise keep
                // showing a cached class/taskbar icon even after the executable's
                // embedded ICO changes during development or an update.
                if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.ico")) {
                    let _ = window.set_icon(icon);
                }
            }
            #[cfg(not(windows))]
            let _ = app;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            compile_typst,
            render_formula,
            compile_typst_pdf,
            typst_packages::download_typst_package,
            system_fonts::list_system_fonts,
            typst_sig::list_typst_signatures,
            scan_folder_shallow,
            folder_stamps,
            open_pdf_window,
            close_this_window,
            user_stylesheet::user_stylesheet_path,
            user_stylesheet::read_user_stylesheet,
            user_stylesheet::write_user_stylesheet,
            save_binary_file,
            share_pdf,
            shared_pdf,
            read_text_file,
            document_io::read_document,
            document_io::probe_documents,
            document_io::save_document,
            local_history::checkpoint_document,
            local_history::list_document_versions,
            local_history::read_document_version,
            templates::create_template,
            latex::compile::compile_latex,
            latex::workdir::cancel_latex_compile,
            latex::synctex::synctex_forward,
            latex::synctex::synctex_backward,
            latex::workdir::cleanup_workdir,
            latex::workdir::export_latex_pdf,
            latex::workdir::read_build_pdf,
            latex::project::collect_project_files,
            latex::distro::detect_distro,
            latex::distro::install_package,
            latex::parse_bib,
            cwl::read_cwl,
            cwl::list_cwl_packages,
            project_config::inspect_workspace,
            project_config::set_workspace_trust,
            references::index_references,
            references::preview_reference_rename,
            references::apply_reference_rename,
            system_open::open_workspace_file,
            system_open::open_external_url,
            assets::index_assets,
            assets::asset_preview,
            markdown_images::save_markdown_image,
            markdown_images::place_markdown_image,
            workspace_search::list_workspace_documents,
            workspace_search::search_workspace,
            workspace_search::replace_workspace,
            settings::get_settings,
            settings::set_settings,
            settings::load_session,
            settings::save_session,
            settings::detect_latex_engines,
            settings::detect_bib_engines,
        ])
        .on_menu_event(|app, event| {
            // Close Window acts on the window it was chosen in, and the PDF
            // window has no tabs for Close Tab to close.
            let id = event.id().as_ref();
            let focused = app
                .webview_windows()
                .into_values()
                .find(|w| w.is_focused().unwrap_or(false))
                .map(|w| w.label().to_string());
            if id == CLOSE_WINDOW || (id == CLOSE_TAB && focused.as_deref() == Some(PDF_WINDOW)) {
                if let Some(label) = focused {
                    close_window(app, &label);
                }
                return;
            }
            // The PDF window shares the app menu; commands belong to the main window.
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.set_focus();
                let _ = main.emit_to("main", "menu-command", id);
            }
        })
        .on_window_event(|window, event| {
            // The red button on the main window: see `close_window`.
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() != PDF_WINDOW {
                    api.prevent_close();
                    close_window(window.app_handle(), window.label());
                }
            }
            // Only the main window owns the compile workdirs; the PDF window
            // closing must not discard what SyncTeX still needs.
            if let tauri::WindowEvent::Destroyed = event {
                if window.label() != PDF_WINDOW {
                    if let Some(s) = window.try_state::<latex::LatexState>() {
                        s.clear();
                    }
                    if let Some(pdf) = window.get_webview_window(PDF_WINDOW) {
                        let _ = pdf.close();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::folder_stamps;

    #[test]
    fn folder_stamp_changes_when_an_entry_is_added() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_string_lossy().into_owned();
        let missing = dir.path().join("gone").to_string_lossy().into_owned();
        let before = folder_stamps(vec![path.clone(), missing]);
        assert!(before[0].is_some());
        assert_eq!(before[1], None);
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(dir.path().join("new.tex"), "x").unwrap();
        assert_ne!(folder_stamps(vec![path])[0], before[0]);
    }

    /// The standard Close Window item owns ⌘W and closes the whole window, so
    /// the menu must not contain it once ⌘W is Close Tab.
    #[cfg(target_os = "macos")]
    #[test]
    fn cmd_w_closes_the_tab_and_shift_cmd_w_the_window() {
        use super::MenuEntry;
        let mut shortcuts = Vec::new();
        for (_, entries) in super::menu_layout() {
            for entry in entries {
                if let MenuEntry::Command { id, accelerator: Some(keys), .. } = entry {
                    shortcuts.push((id, keys));
                }
            }
        }
        assert!(shortcuts.contains(&("tab.close", "CmdOrCtrl+W")), "{shortcuts:?}");
        assert!(shortcuts.contains(&("window.close", "CmdOrCtrl+Shift+W")), "{shortcuts:?}");
        let mut keys: Vec<_> = shortcuts.iter().map(|(_, keys)| *keys).collect();
        keys.sort();
        let before = keys.len();
        keys.dedup();
        assert_eq!(before, keys.len(), "two menu items share a shortcut: {shortcuts:?}");
    }

    /// No submenu starts or ends with a separator, or has two in a row.
    #[cfg(target_os = "macos")]
    #[test]
    fn menu_separators_only_sit_between_items() {
        use super::MenuEntry::Separator;
        for (title, entries) in super::menu_layout() {
            assert_ne!(entries.first(), Some(&Separator), "{title}");
            assert_ne!(entries.last(), Some(&Separator), "{title}");
            assert!(!entries.windows(2).any(|pair| pair == [Separator, Separator]), "{title}");
        }
    }
}
