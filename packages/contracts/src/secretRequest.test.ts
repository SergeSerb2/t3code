import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { SecretRequestAnswerInput } from "./secretRequest.ts";

const codec = Schema.toCodecJson(SecretRequestAnswerInput);
const decode = Schema.decodeUnknownSync(codec);
const encode = Schema.encodeSync(codec);
const input = (secret: string) => ({
  threadId: "thread-1",
  turnItemId: "turn-item:secret-request:1",
  answer: { type: "save" as const, secret },
});

describe("secret request wire values", () => {
  it.each([
    " password ",
    "\n-----BEGIN KEY-----\nvalue\n-----END KEY-----\n",
    "\t signing-secret ",
  ])("preserves intentional whitespace through RPC decode and encode", (secret) => {
    const decoded = decode(input(secret));
    expect(decoded.answer).toEqual({ type: "save", secret });
    expect(encode(decoded)).toEqual(input(secret));
  });
  it.each(["", " ", "\n\t\r", "\u00a0"])("rejects blank values without trimming", (secret) => {
    expect(() => decode(input(secret))).toThrow();
  });
});
