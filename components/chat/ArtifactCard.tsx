import { Download, Eye, FileCode2 } from "lucide-react";
import type { ConversationArtifact } from "@/lib/conversations/types";

type ArtifactCardProps = {
  artifacts: ConversationArtifact[];
};

export function ArtifactCard({ artifacts }: ArtifactCardProps) {
  const title = artifacts.length === 1 ? artifacts[0].title : `${artifacts.length} 个产出文件`;
  const description =
    artifacts.length === 1
      ? artifacts[0].description || "Agent 生成的产物文件"
      : "Agent 生成的产物文件列表";

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
          {artifacts.map((artifact) => (
            <code key={artifact.id} title={artifact.path ?? undefined}>
              {artifact.path ?? artifact.title}
            </code>
          ))}
        </div>
      </div>
    </div>
  );
}
