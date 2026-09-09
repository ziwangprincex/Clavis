use std::path::Path;

pub fn files(template: &str) -> Result<Vec<(&'static str, &'static str)>, String> {
    let mut files = match template {
        "typst-paper" => vec![("main.typ", "#set page(paper: \"a4\", margin: 25mm)\n#set text(size: 11pt)\n#set heading(numbering: \"1.\")\n#align(center)[\n  #text(size: 22pt, weight: \"bold\")[Paper title]\n\n  Author name\n]\n\n= Abstract\nA concise statement of the question, method, and result.\n\n#include \"sections/introduction.typ\"\n\n= Method\nThe energy relation is $ E = m c^2 $.\n\n= Results <results>\nPresent the evidence here. See @results.\n\n= Conclusion\nSummarize the contribution and limitations.\n"), ("sections/introduction.typ", "= Introduction\nState the problem and explain why it matters.\n"), ("clavis.toml", "[project]\nmain = \"main.typ\"\n")],
        "latex-paper" => vec![("main.tex", "\\documentclass[11pt,a4paper]{article}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amsmath}\n\\title{Paper title}\n\\author{Author name}\n\\date{}\n\\begin{document}\n\\maketitle\n\\begin{abstract}\nA concise statement of the question, method, and result.\n\\end{abstract}\n\\input{sections/introduction}\n\\section{Method}\nThe energy relation is $E=mc^2$.\n\\section{Results}\\label{sec:results}\nPresent the evidence here. See Section~\\ref{sec:results}.\n\\section{Conclusion}\nSummarize the contribution and limitations.\n\\end{document}\n"), ("sections/introduction.tex", "% !TeX root = ../main.tex\n\\section{Introduction}\nState the problem and explain why it matters.\n"), ("clavis.toml", "[project]\nmain = \"main.tex\"\n[latex]\nengine = \"pdflatex\"\nbibliography = \"none\"\n")],
        "research-note" => vec![("main.md", "# Research note\n\n## Question\nWhat are you trying to understand?\n\n## Evidence\nRecord observations and their sources.\n\n## Working model\nAn equation can stay close to the prose: $E=mc^2$.\n\n## Next step\nDescribe one concrete experiment or revision.\n")],
        _ => return Err("Unknown template".into()),
    };
    files.push(("README.md", "# Writing project\n\nOpen the main document in Clavis. Typst and Markdown work offline with the bundled renderer. LaTeX needs a local TeX installation with article and amsmath. Use Typesetting → Check environment before compiling.\n\nNo template scripts are executed. All content is editable. Keep external backups for important work; Clavis local history is bounded.\n"));
    Ok(files)
}
fn create(parent: &Path, name: &str, template: &str) -> Result<String, String> {
    if name.trim().is_empty() || name == "." || name == ".." || name.contains(['/', '\\']) {
        return Err("Choose a single project folder name".into());
    }
    let files = files(template)?;
    let target = parent.join(name);
    std::fs::create_dir(&target).map_err(|e| format!("Create new project folder: {e}"))?;
    for (relative, content) in &files {
        let path = target.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
        std::fs::write(path, content).map_err(|e| e.to_string())?;
    }
    Ok(target.join(files[0].0).to_string_lossy().into())
}
#[tauri::command]
pub async fn create_template(
    parent: String,
    name: String,
    template: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || create(Path::new(&parent), &name, &template))
        .await
        .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn templates_do_not_replace_existing_projects_or_escape_parent() {
        let root = tempfile::tempdir().unwrap();
        let main = create(root.path(), "paper", "typst-paper").unwrap();
        assert!(Path::new(&main).is_file());
        assert!(create(root.path(), "paper", "latex-paper").is_err());
        assert!(create(root.path(), "../escape", "typst-paper").is_err());
        assert!(create(root.path(), "unknown", "unknown").is_err());
        assert!(!root.path().join("unknown").exists());
    }
    #[test]
    fn typst_template_compiles_offline() {
        let root = tempfile::tempdir().unwrap();
        let main = create(root.path(), "paper", "typst-paper").unwrap();
        let mut world = crate::typst_world::SimpleWorld::new().unwrap();
        world
            .configure(
                std::fs::read_to_string(&main).unwrap(),
                Some(&main),
                &Default::default(),
            )
            .unwrap();
        let result = crate::typst_preview::preview(&world).unwrap();
        assert!(result.ok);
        assert!(!result.pages[0].text.is_empty());
        assert!(result.pages.iter().any(|p| !p.links.is_empty()));
    }
}

#[cfg(test)]
mod real_latex_test {
    use super::*;
    #[test]
    #[ignore = "Needs a local pdflatex installation"]
    fn latex_template_compiles() {
        let root = tempfile::tempdir().unwrap();
        let main = create(root.path(), "paper", "latex-paper").unwrap();
        let engine = crate::latex::find_in_fallback_dirs("pdflatex")
            .or_else(|| which::which("pdflatex").ok())
            .expect("pdflatex installed");
        let output = std::process::Command::new(engine)
            .current_dir(Path::new(&main).parent().unwrap())
            .args(["-interaction=nonstopmode", "-halt-on-error", "main.tex"])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stdout)
        );
        assert!(Path::new(&main).with_extension("pdf").exists());
    }
}
