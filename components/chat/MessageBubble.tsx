import { AgentIcon } from "@/components/agents/AgentIcon";
import { ArtifactCard } from "@/components/chat/ArtifactCard";
import type { MockMessage } from "@/lib/conversations/types";

type MessageBubbleProps = {
  message: MockMessage;
};

export function MessageBubble({ message }: MessageBubbleProps) {
  const tone = message.tone ?? "agent";

  return (
    <div className={`message-row ${tone}`}>
      {tone !== "user" ? (
        <span className={`message-avatar ${tone}`}>
          {message.avatar ? <AgentIcon agent={message.avatar} size={25} /> : null}
        </span>
      ) : null}
      <div className="message-body">
        <div className="message-sender">
          {tone !== "user" ? <span className="sender-name">{message.author}</span> : null}
          {message.role ? (
            <span className={`sender-role ${message.status ?? ""}`}>{message.role}</span>
          ) : null}
          {message.time ? <span>{message.time}</span> : null}
        </div>
        <div className="message-bubble">
          <RichText text={message.body} />
          {message.code ? (
            <pre>
              <code>{message.code}</code>
            </pre>
          ) : null}
          {message.artifact ? (
            <ArtifactCard
              description={message.artifact.description}
              files={message.artifact.files}
              title={message.artifact.title}
            />
          ) : null}
          {message.tasks ? (
            <div className="task-board">
              {message.tasks.map((task) => (
                <div className="task-card" key={task.id}>
                  <strong>{task.id}</strong>
                  <span>{task.owner}</span>
                  <p>{task.title}</p>
                  <em>{task.status}</em>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function RichText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);

  return (
    <p>
      {parts.map((part, index) => {
        if (part.startsWith("`") && part.endsWith("`")) {
          return <code key={`${part}-${index}`}>{part.slice(1, -1)}</code>;
        }

        return <span key={`${part}-${index}`}>{part}</span>;
      })}
    </p>
  );
}
