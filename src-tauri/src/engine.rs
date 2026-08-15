use crate::model::{BuildSnapshot, BuildStatus, SpeakerNote};
use serde_json::Value;
use std::env;
use std::ffi::{OsStr, OsString};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

static NEXT_REVISION: AtomicU64 = AtomicU64::new(1);

pub struct BuildOutcome {
    pub snapshot: BuildSnapshot,
    pub output_path: Option<PathBuf>,
}

pub fn typst_version() -> Result<String, String> {
    let output = typst_command()
        .arg("--version")
        .output()
        .map_err(|error| typst_missing_message(&error))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

pub fn build_deck(source_path: &Path, root: &Path) -> BuildOutcome {
    let started = Instant::now();
    let revision = NEXT_REVISION.fetch_add(1, Ordering::Relaxed);
    let source_display = source_path.to_string_lossy().into_owned();
    let version = typst_version().unwrap_or_else(|error| error);

    let output_dir = std::env::temp_dir()
        .join("typst-presenter")
        .join(std::process::id().to_string());
    if let Err(error) = fs::create_dir_all(&output_dir) {
        return failure(
            revision,
            source_display,
            version,
            started,
            format!("Unable to create the build directory: {error}"),
        );
    }

    let output_path = output_dir.join(format!("deck-{revision}.pdf"));
    let compile = typst_command()
        .arg("compile")
        .arg("--diagnostic-format")
        .arg("short")
        .arg("--root")
        .arg(root)
        .arg(source_path)
        .arg(&output_path)
        .output();

    let compile = match compile {
        Ok(output) => output,
        Err(error) => {
            return failure(
                revision,
                source_display,
                version,
                started,
                typst_missing_message(&error),
            )
        }
    };

    if !compile.status.success() {
        let diagnostics = clean_diagnostics(&compile.stderr);
        return BuildOutcome {
            snapshot: BuildSnapshot {
                revision,
                source_path: source_display,
                output_path: None,
                status: BuildStatus::Error,
                diagnostics,
                notes: Vec::new(),
                elapsed_ms: started.elapsed().as_millis(),
                typst_version: version,
            },
            output_path: None,
        };
    }

    prune_old_builds(&output_dir, 8);
    let notes = query_speaker_notes(source_path, root).unwrap_or_default();
    let output_display = output_path.to_string_lossy().into_owned();
    BuildOutcome {
        snapshot: BuildSnapshot {
            revision,
            source_path: source_display,
            output_path: Some(output_display),
            status: BuildStatus::Ready,
            diagnostics: Vec::new(),
            notes,
            elapsed_ms: started.elapsed().as_millis(),
            typst_version: version,
        },
        output_path: Some(output_path),
    }
}

fn failure(
    revision: u64,
    source_path: String,
    version: String,
    started: Instant,
    diagnostic: String,
) -> BuildOutcome {
    BuildOutcome {
        snapshot: BuildSnapshot {
            revision,
            source_path,
            output_path: None,
            status: BuildStatus::Error,
            diagnostics: vec![diagnostic],
            notes: Vec::new(),
            elapsed_ms: started.elapsed().as_millis(),
            typst_version: version,
        },
        output_path: None,
    }
}

fn typst_missing_message(error: &std::io::Error) -> String {
    format!("Typst CLI is unavailable ({error}). Install Typst, ensure `typst` is on PATH, or set TYPST_PATH to the executable.")
}

fn typst_command() -> Command {
    Command::new(resolve_typst_executable())
}

fn resolve_typst_executable() -> OsString {
    let configured = env::var_os("TYPST_PATH");
    let search_path = env::var_os("PATH");
    let home = env::var_os("HOME").map(PathBuf::from);
    resolve_typst_executable_from(
        configured.as_deref(),
        search_path.as_deref(),
        home.as_deref(),
    )
}

fn resolve_typst_executable_from(
    configured: Option<&OsStr>,
    search_path: Option<&OsStr>,
    home: Option<&Path>,
) -> OsString {
    if let Some(path) = configured
        .map(Path::new)
        .filter(|path| is_executable_file(path))
    {
        return path.as_os_str().to_owned();
    }

    if let Some(path) = search_path.and_then(|value| {
        env::split_paths(value)
            .map(|directory| directory.join(platform_typst_name()))
            .find(|path| is_executable_file(path))
    }) {
        return path.into_os_string();
    }

    #[cfg(target_os = "macos")]
    {
        let mut candidates = vec![
            PathBuf::from("/opt/homebrew/bin/typst"),
            PathBuf::from("/usr/local/bin/typst"),
        ];
        if let Some(home) = home {
            candidates.push(home.join(".cargo/bin/typst"));
            candidates.push(home.join(".local/bin/typst"));
        }
        if let Some(path) = candidates.into_iter().find(|path| is_executable_file(path)) {
            return path.into_os_string();
        }
    }

    #[cfg(not(target_os = "macos"))]
    let _ = home;

    OsString::from("typst")
}

fn is_executable_file(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }

    #[cfg(not(unix))]
    {
        true
    }
}

fn platform_typst_name() -> &'static str {
    if cfg!(windows) {
        "typst.exe"
    } else {
        "typst"
    }
}

fn clean_diagnostics(stderr: &[u8]) -> Vec<String> {
    let text = String::from_utf8_lossy(stderr);
    let lines: Vec<String> = text
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.trim().is_empty())
        .map(ToOwned::to_owned)
        .collect();
    if lines.is_empty() {
        vec!["Typst compilation failed without diagnostics.".to_owned()]
    } else {
        lines
    }
}

fn prune_old_builds(output_dir: &Path, keep: usize) {
    let Ok(entries) = fs::read_dir(output_dir) else {
        return;
    };
    let mut pdfs: Vec<_> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().and_then(|value| value.to_str()) == Some("pdf"))
        .collect();
    pdfs.sort_by_key(|entry| entry.metadata().and_then(|value| value.modified()).ok());
    let remove_count = pdfs.len().saturating_sub(keep);
    for entry in pdfs.into_iter().take(remove_count) {
        // A PDF viewer may still hold the file open on Windows. Cleanup is best-effort.
        let _ = fs::remove_file(entry.path());
    }
}

fn query_speaker_notes(source_path: &Path, root: &Path) -> Result<Vec<SpeakerNote>, String> {
    let eval_output = typst_command()
        .arg("eval")
        .arg("--root")
        .arg(root)
        .arg("--in")
        .arg(source_path)
        .arg("query(<pdfpc-file>).first().value")
        .output()
        .map_err(|error| error.to_string())?;

    let output = if eval_output.status.success() {
        eval_output
    } else {
        // Typst before 0.15 does not have document-aware `eval`; retain its
        // equivalent query command as a compatibility fallback.
        typst_command()
            .arg("query")
            .arg("--root")
            .arg(root)
            .arg(source_path)
            .arg("--field")
            .arg("value")
            .arg("--one")
            .arg("<pdfpc-file>")
            .output()
            .map_err(|error| error.to_string())?
    };

    if !output.status.success() {
        // Metadata is optional: plain Typst decks are valid decks too.
        return Ok(Vec::new());
    }

    let value: Value = serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;
    Ok(parse_pdfpc_notes(&value))
}

pub fn parse_pdfpc_notes(value: &Value) -> Vec<SpeakerNote> {
    value
        .get("pages")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
        .map(|(array_index, page)| {
            let index = page
                .get("idx")
                .and_then(Value::as_u64)
                .map(|value| value as usize)
                .unwrap_or(array_index);
            SpeakerNote {
                page: index,
                text: page
                    .get("note")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                label: page
                    .get("label")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                overlay: page
                    .get("overlay")
                    .and_then(Value::as_u64)
                    .unwrap_or_default() as usize,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::ffi::OsString;

    fn create_test_executable(path: &Path) {
        fs::write(path, []).expect("create test executable");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o755))
                .expect("make test file executable");
        }
    }

    #[test]
    fn parses_touying_pdfpc_notes_by_physical_page() {
        let metadata = json!({
            "pdfpcFormat": 2,
            "pages": [
                { "idx": 0, "label": "1", "overlay": 0, "note": "Opening" },
                { "idx": 1, "label": "2", "overlay": 1 },
                { "idx": 2, "label": "2", "overlay": 2, "note": "Reveal result" }
            ]
        });

        let notes = parse_pdfpc_notes(&metadata);

        assert_eq!(notes.len(), 3);
        assert_eq!(notes[0].text, "Opening");
        assert_eq!(notes[1].text, "");
        assert_eq!(notes[2].overlay, 2);
        assert_eq!(notes[2].label, "2");
    }

    #[test]
    fn missing_pdfpc_pages_is_an_empty_notes_collection() {
        assert!(parse_pdfpc_notes(&json!({})).is_empty());
    }

    #[test]
    fn configured_typst_path_takes_precedence_over_path() {
        let test_root =
            std::env::temp_dir().join(format!("typst-presenter-resolver-{}", std::process::id()));
        let configured = test_root.join("configured-typst");
        let path_directory = test_root.join("bin");
        let path_typst = path_directory.join(platform_typst_name());
        fs::create_dir_all(&path_directory).expect("create resolver test directory");
        create_test_executable(&configured);
        create_test_executable(&path_typst);

        let resolved = resolve_typst_executable_from(
            Some(configured.as_os_str()),
            Some(path_directory.as_os_str()),
            None,
        );

        assert_eq!(resolved, configured.into_os_string());
        fs::remove_dir_all(test_root).expect("remove resolver test directory");
    }

    #[test]
    fn typst_is_resolved_from_path() {
        let test_root = std::env::temp_dir().join(format!(
            "typst-presenter-path-resolver-{}",
            std::process::id()
        ));
        let path_directory = test_root.join("bin");
        let path_typst = path_directory.join(platform_typst_name());
        fs::create_dir_all(&path_directory).expect("create resolver test directory");
        create_test_executable(&path_typst);

        let resolved = resolve_typst_executable_from(None, Some(path_directory.as_os_str()), None);

        assert_eq!(resolved, OsString::from(path_typst));
        fs::remove_dir_all(test_root).expect("remove resolver test directory");
    }
}
