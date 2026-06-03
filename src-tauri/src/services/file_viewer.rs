use std::path::Path;

/// Represents the detected file format based on extension.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileFormat {
    Markdown,
    Text,
    Docx,
    Doc,
    Pdf,
    Xlsx,
    Unknown,
}

impl FileFormat {
    /// Detect file format from the file path extension.
    pub fn from_path(path: &Path) -> Self {
        let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
            return FileFormat::Unknown;
        };
        match ext.to_ascii_lowercase().as_str() {
            "md" | "markdown" => FileFormat::Markdown,
            "txt" => FileFormat::Text,
            "docx" => FileFormat::Docx,
            "doc" => FileFormat::Doc,
            "pdf" => FileFormat::Pdf,
            "xlsx" => FileFormat::Xlsx,
            _ => FileFormat::Unknown,
        }
    }

    /// Returns true if this format should be treated as read-only (not editable in the app).
    pub fn is_read_only(self) -> bool {
        !matches!(self, FileFormat::Markdown | FileFormat::Text)
    }

    /// Returns a human-readable label for the file type.
    pub fn label(self) -> &'static str {
        match self {
            FileFormat::Markdown => "MD",
            FileFormat::Text => "TXT",
            FileFormat::Docx => "DOCX",
            FileFormat::Doc => "DOC",
            FileFormat::Pdf => "PDF",
            FileFormat::Xlsx => "XLSX",
            FileFormat::Unknown => "FILE",
        }
    }

    /// Returns the MIME type string.
    pub fn mime_type(self) -> &'static str {
        match self {
            FileFormat::Markdown => "text/markdown",
            FileFormat::Text => "text/plain",
            FileFormat::Docx => {
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            }
            FileFormat::Doc => "application/msword",
            FileFormat::Pdf => "application/pdf",
            FileFormat::Xlsx => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            FileFormat::Unknown => "application/octet-stream",
        }
    }
}

// No in-app conversion functions — non-md files are opened via
// the system default application (WPS/Word/Excel/PDF reader).
