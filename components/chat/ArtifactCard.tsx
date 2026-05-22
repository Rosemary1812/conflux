import { Download, Eye, FileCode2 } from "lucide-react";

type ArtifactCardProps = {
  description: string;
  files: string[];
  title: string;
};

export function ArtifactCard({ description, files, title }: ArtifactCardProps) {
  return (
    <div className="artifact-card">
      <div className="artifact-head">
        <FileCode2 size={16} />
        <span>{title}</span>
        <div className="artifact-actions">
          <button aria-label="预览产物" type="button">
            <Eye size={14} />
          </button>
          <button aria-label="下载产物" type="button">
            <Download size={14} />
          </button>
        </div>
      </div>
      <div className="artifact-body">
        <p>{description}</p>
        <div className="artifact-files">
          {files.map((file) => (
            <code key={file}>{file}</code>
          ))}
        </div>
      </div>
    </div>
  );
}
