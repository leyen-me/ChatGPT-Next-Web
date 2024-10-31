import { createParser, type EventSourceMessage } from "eventsource-parser";

export async function OpenAIStream(
  response: Response,
): Promise<ReadableStream> {
  if (!response.body) {
    throw new Error("Response has no body");
  }
  const reader = response.body.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new ReadableStream({
    async start(controller) {
      const parser = createParser({
        onEvent: (event: EventSourceMessage) => {
          const data = JSON.parse(event.data);
          // 根据事件类型处理
          if (event.event === "add") {
            // 转换为 OpenAI 格式
            const chunk = {
              id: data.id,
              object: "chat.completion.chunk",
              created: Date.now(),
              model: "gpt-3.5-turbo",
              choices: [
                {
                  delta: {
                    content: data.text,
                  },
                  index: 0,
                  finish_reason: null,
                },
              ],
            };

            const json = JSON.stringify(chunk);
            console.log(json);

            controller.enqueue(encoder.encode(json + "\n"));
          } else if (event.event === "finish") {
            // 发送结束消息
            const chunk = {
              id: data.id,
              object: "chat.completion.chunk",
              created: Date.now(),
              model: "gpt-3.5-turbo",
              choices: [
                {
                  delta: {},
                  index: 0,
                  finish_reason: data.finish_reason,
                },
              ],
            };

            const json = JSON.stringify(chunk);
            controller.enqueue(encoder.encode(json + "\n"));
            controller.close();
          }
        },
      });

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          parser.feed(chunk);
        }
      } finally {
        reader.releaseLock();
      }
    },
    cancel() {
      reader.cancel();
    },
  });
}
