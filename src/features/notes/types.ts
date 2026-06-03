export interface NoteMetadata {
  id: string;
  title: string;
  fileName: string;
  fileStem: string;
  category: string;
  fileFormat?: string; // "md", "docx", "doc", "pdf", "xlsx" — default "md"
  createdAt: string;
  updatedAt: string;
  wordCount: number;
  preview: string;
}

export interface Note extends Omit<NoteMetadata, "preview"> {
  content: string;
}

export interface SaveNoteRequest {
  title: string;
  content: string;
  category: string;
}

export interface ExternalFile {
  id: string;
  title: string;
  filePath: string;
  /** Whether the file is read-only (e.g. docx, pdf, xlsx). */
  readOnly?: boolean;
  /** The content format: "html", "text", or "markdown". */
  contentFormat?: string;
  /** MIME type of the file. */
  mimeType?: string;
}
