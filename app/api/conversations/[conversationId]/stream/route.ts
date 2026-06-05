import { subscribeToConversation } from "@/lib/conversations/stream-bus";
import { listConversationInteractions } from "@/lib/interactions/service";

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
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const unsubscribe = subscribeToConversation(conversationId, (event) => {
        send(event.type, event);
      });

      send("connected", { ok: true });

      for (const interaction of listConversationInteractions(conversationId, "pending")) {
        send("interaction_requested", { type: "interaction_requested", interaction });
      }

      const heartbeat = setInterval(() => {
        send("ping", {});
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
