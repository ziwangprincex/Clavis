//! Versioned Typst packages. Compilation is offline; only an explicit command downloads.
use std::path::{Component, Path, PathBuf};
use std::str::FromStr;
use typst::syntax::package::PackageSpec;

fn cache_root() -> Result<PathBuf, String> {
    crate::settings::clavis_config_dir()
        .map(|p| p.join("typst-packages"))
        .ok_or_else(|| "No application config directory".into())
}

fn package_relative(spec: &PackageSpec) -> PathBuf {
    PathBuf::from(spec.namespace.as_str())
        .join(spec.name.as_str())
        .join(spec.version.to_string())
}

pub fn find_package(spec: &PackageSpec) -> Option<PathBuf> {
    let mut roots = vec![];
    if let Ok(root) = cache_root() {
        roots.push(root);
    }
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        #[cfg(target_os = "macos")]
        roots.extend([
            home.join("Library/Application Support/typst/packages"),
            home.join("Library/Caches/typst/packages"),
        ]);
        #[cfg(not(target_os = "macos"))]
        roots.extend([
            std::env::var_os("XDG_DATA_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".local/share"))
                .join("typst/packages"),
            std::env::var_os("XDG_CACHE_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".cache"))
                .join("typst/packages"),
        ]);
    }
    #[cfg(windows)]
    for name in ["APPDATA", "LOCALAPPDATA"] {
        if let Some(root) = std::env::var_os(name) {
            roots.push(PathBuf::from(root).join("typst/packages"));
        }
    }
    roots.into_iter().find_map(|root| {
        let path = root.join(package_relative(spec));
        if !path.join("typst.toml").is_file() {
            return None;
        }
        std::fs::canonicalize(path).ok()
    })
}

fn unpack(bytes: &[u8], destination: &Path) -> Result<(), String> {
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(bytes));
    let mut count = 0;
    let mut total = 0u64;
    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        count += 1;
        total = total
            .checked_add(entry.size())
            .ok_or("Package size overflow")?;
        if count > 5000 || total > 128 * 1024 * 1024 {
            return Err("Package exceeds extraction limits".into());
        }
        let path = entry.path().map_err(|e| e.to_string())?;
        if path.is_absolute()
            || path
                .components()
                .any(|c| matches!(c, Component::ParentDir | Component::Prefix(_)))
        {
            return Err("Package contains unsafe paths".into());
        }
        let kind = entry.header().entry_type();
        if !kind.is_file() && !kind.is_dir() {
            return Err("Package links and special files are not permitted".into());
        }
        if !entry.unpack_in(destination).map_err(|e| e.to_string())? {
            return Err("Package path escapes cache".into());
        }
    }
    if !destination.join("typst.toml").is_file() {
        return Err("Package has no typst.toml".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn download_typst_package(spec: String, confirmed: bool) -> Result<(), String> {
    if !confirmed {
        return Err("Package download requires user confirmation".into());
    }
    let spec = PackageSpec::from_str(&spec).map_err(|e| e.to_string())?;
    if spec.namespace.as_str() != "preview" {
        return Err(
            "Only @preview packages can be downloaded; install other namespaces locally".into(),
        );
    }
    if find_package(&spec).is_some() {
        return Ok(());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!(
        "https://packages.typst.org/preview/{}-{}.tar.gz",
        spec.name, spec.version
    );
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > 32 * 1024 * 1024 {
            return Err("Package download exceeds 32 MiB".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    tauri::async_runtime::spawn_blocking(move || {
        let root = cache_root()?;
        std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        let staging = tempfile::tempdir_in(&root).map_err(|e| e.to_string())?;
        unpack(&bytes, staging.path())?;
        let manifest: toml::Value = toml::from_str(
            &std::fs::read_to_string(staging.path().join("typst.toml"))
                .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        let package = manifest.get("package").ok_or("Missing package metadata")?;
        if package.get("name").and_then(|v| v.as_str()) != Some(spec.name.as_str())
            || package.get("version").and_then(|v| v.as_str())
                != Some(spec.version.to_string().as_str())
        {
            return Err("Package identity does not match requested version".into());
        }
        let target = root.join(package_relative(&spec));
        std::fs::create_dir_all(target.parent().ok_or("Invalid package path")?)
            .map_err(|e| e.to_string())?;
        if target.exists() {
            return Ok(());
        }
        std::fs::rename(staging.path(), target).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn package_versions_are_required_and_paths_cannot_escape() {
        for input in [
            "@preview/../secret:1.0.0",
            "@preview/foo",
            "@preview/foo:../../",
        ] {
            assert!(PackageSpec::from_str(input).is_err());
        }
        let spec = PackageSpec::from_str("@preview/example:1.2.3").unwrap();
        assert_eq!(
            package_relative(&spec),
            PathBuf::from("preview/example/1.2.3")
        );
    }
    #[test]
    fn rejects_symlinks_in_package_archive() {
        let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
            Vec::new(),
            flate2::Compression::default(),
        ));
        let mut header = tar::Header::new_gnu();
        header.set_entry_type(tar::EntryType::Symlink);
        header.set_size(0);
        header.set_mode(0o644);
        header.set_link_name("/etc/passwd").unwrap();
        header.set_cksum();
        builder.append_data(&mut header, "escape", &[][..]).unwrap();
        let bytes = builder.into_inner().unwrap().finish().unwrap();
        let dir = tempfile::tempdir().unwrap();
        assert!(unpack(&bytes, dir.path()).unwrap_err().contains("links"));
    }
}
