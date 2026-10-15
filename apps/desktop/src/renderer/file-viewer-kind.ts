import type { OfficeFilePreview, WorkspaceAttachment } from "@yuksalish/contracts";

export type OfficePreviewResult = OfficeFilePreview | Blob;

export type FileViewerKind = "word" | "excel" | "pdf" | "image" | "video" | "audio" | "unsupported";
export function fileViewerKind(file: Pick<WorkspaceAttachment, "fileName" | "contentType">): FileViewerKind {
  const extension = file.fileName.split(".").pop()?.toLowerCase();
  const mime = file.contentType.toLowerCase();
  if (extension === "docx" || extension === "doc") return "word";
  if (extension === "xlsx") return "excel";
  if (extension === "pdf" || mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/") || /^(png|jpe?g|gif|webp|avif|bmp|svg)$/.test(extension ?? "")) return "image";
  if (mime.startsWith("video/") || /^(mp4|mov|m4v)$/.test(extension ?? "")) return "video";
  if (mime.startsWith("audio/") || /^(mp3|m4a|aac|wav|flac|ogg|oga|opus|webm)$/.test(extension ?? "")) return "audio";
  return "unsupported";
}
