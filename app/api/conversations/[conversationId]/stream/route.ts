import { subscribeToConversation } from "@/lib/conversations/stream-bus";
import { listMessages } from "@/lib/conversations/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

export async function GET(_: Request, context: RouteContext) {
  const { conversationId } = await context.params;
  const encoder = new TextEncoder();
  let cleanup: (() => void) | undefined;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("event: connected\ndata: {\"ok\":true}\n\n"));

      for (const message of listMessages(conversationId)) {
        if (message.tone === "agent" && message.status) {
          controller.enqueue(
            encoder.encode(
              `event: message_replace\ndata: ${JSON.stringify({
                type: "message_replace",
                messageId: message.id,
                content: message.body,
                status: message.status
              })}\n\n`
            )
          );
        }
      }

      const unsubscribe = subscribeToConversation(conversationId, (event) => {
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      });

      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode("event: ping\ndata: {}\n\n"));
      }, 15000);

      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
    },
    cancel() {
      cleanup?.();
    }
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream"
    }
  });
}
