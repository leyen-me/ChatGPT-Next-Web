import { ReadableStream } from "node:stream/web";
import { OpenAIStream } from "./openai-stream";
import { OpenAIStream as OpenAIStatic } from "./openai-static";

// OpenAI 兼容的请求体类型
interface OpenAIRequest {
  model: string;
  messages: {
    role: string;
    content: string;
  }[];
  stream?: boolean;
}

// GeekChat 请求体类型
interface GeekChatRequest {
  user_id: string;
  user_role: number;
  ide: string;
  ide_version: string;
  plugin_version: string;
  talkId: string;
  locale: string;
  model: string;
  agent: null;
  prompt: string;
  history: {
    query: string;
    answer: string;
  }[];
}

class StreamingResponse extends Response {
  constructor(res: ReadableStream<any>, init?: ResponseInit) {
    super(res as any, {
      ...init,
      status: 200,
      headers: {
        ...init?.headers,
      },
    });
  }
}

export async function POST(req: Request) {
  try {
    // 1. 解析请求体
    const body = (await req.json()) as OpenAIRequest;
    const headers = req.headers;
    let streamFlag = true;

    // 判断header中某没有支持stream流式输出
    if (headers.get("Accept") !== "text/event-stream") {
      streamFlag = false;
    }

    // 2. 转换为 GeekChat 格式
    const geekChatRequest: GeekChatRequest = {
      user_id: process.env.USER_ID as string,
      user_role: 0,
      ide: "VSCode",
      ide_version: "1.95.0",
      plugin_version: "2.17.6",
      talkId: process.env.TALK_ID as string,
      locale: "zh",
      model: process.env.MODEL as string,
      agent: null,
      prompt: "",
      history: [],
    };

    // 处理消息
    let messages = [...body.messages]; // 创建副本以便处理

    // 首先检查是否有 system 消息
    if (messages.length > 0 && messages[0].role === "system") {
      geekChatRequest.history.push({
        query: messages[0].content,
        answer: "",
      });
      messages = messages.slice(1); // 移除 system 消息
    }

    // 确保最后一条消息作为 prompt
    geekChatRequest.prompt = messages[messages.length - 1].content;

    // 处理历史消息（除了最后一条）
    for (let i = 0; i < messages.length - 1; i += 2) {
      if (i + 1 < messages.length - 1) {
        // 确保不包含最后一条消息
        const userMessage = messages[i];
        const assistantMessage = messages[i + 1];

        // 确保消息角色正确
        if (
          userMessage.role === "user" &&
          assistantMessage.role === "assistant"
        ) {
          geekChatRequest.history.push({
            query: userMessage.content,
            answer: assistantMessage.content,
          });
        }
      }
    }

    // 3. 调用 GeekChat API
    const response = await fetch(process.env.GEEK_URL as string, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "Code-Token": process.env.CODE_TOKEN as string,
      },
      body: JSON.stringify(geekChatRequest),
    });

    // 4. 创建 Transform Stream 转换响应格式

    if (streamFlag) {
      const stream = (await OpenAIStream(response)) as any;
      return new StreamingResponse(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } else {
      const stream = (await OpenAIStatic(response)) as any;

      let res = "";
      const decoder = new TextDecoderStream();
      const reader = stream.pipeThrough(decoder).getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          res += value;
        }
      } finally {
        reader.releaseLock();
      }
      return new Response(res, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 5. 返回流式响应
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: {
          message: (error as Error).message,
        },
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
