use crate::model::{BuildSnapshot, BuildStatus, SpeakerNote};
use serde_json::Value;
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
    let output = Command::new("typst")
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
    let compile = Command::new("typst")
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
    format!("Typst CLI is unavailable ({error}). Install Typst and ensure `typst` is on PATH.")
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
    let eval_output = Command::new("typst")
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
        Command::new("typst")
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
}
