import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, expect } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import { createAttachmentId } from "../attachmentStore.ts";
import { makeHtmlRenderAttachmentCleanup } from "./HtmlRenderAttachmentCleanup.ts";

const encodePayload = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

it.live(
  "reclaims old crash orphans and preserves committed pages, uploads, fresh files and escaping symlinks",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE orchestration_v2_projection_turn_items (payload_json TEXT NOT NULL)`;
      yield* sql`CREATE TABLE orchestration_v2_projection_messages (payload_json TEXT NOT NULL)`;
      const root = yield* fs
        .makeTempDirectoryScoped({ prefix: "html-cleanup-" })
        .pipe(Effect.flatMap(fs.realPath));
      const outside = yield* fs.makeTempDirectoryScoped({ prefix: "html-cleanup-outside-" });
      const now = yield* Clock.currentTimeMillis;
      const old = DateTime.toDate(DateTime.makeUnsafe(now - 2 * 86400000));
      const makePage = (thread: string, fresh = false, marked = true) =>
        Effect.gen(function* () {
          const id = createAttachmentId(thread, "html")!;
          const target = path.join(root, `${id}.html`);
          yield* fs.writeFileString(target, "<p>page</p>");
          const marker = `${target}.pending-html-render`;
          if (marked) {
            yield* fs.writeFileString(marker, "");
            if (!fresh) yield* fs.utimes(marker, old, old);
          }
          if (!fresh) yield* fs.utimes(target, old, old);
          return { id, target, marker };
        });
      const orphan = yield* makePage("orphan");
      const committed = yield* makePage("committed");
      const upload = yield* makePage("upload", false, false);
      const draft = yield* makePage("uncommitted-draft", false, false);
      const fresh = yield* makePage("fresh", true);
      yield* sql`INSERT INTO orchestration_v2_projection_turn_items VALUES (${yield* encodePayload({ type: "dynamic_tool", output: { htmlRender: { attachmentId: committed.id } } })})`;
      yield* sql`INSERT INTO orchestration_v2_projection_messages VALUES (${yield* encodePayload({ attachments: [{ id: upload.id }] })})`;
      const outsidePage = path.join(outside, "private.html");
      yield* fs.writeFileString(outsidePage, "private");
      yield* fs.utimes(outsidePage, old, old);
      const alias = path.join(root, `${createAttachmentId("alias", "html")!}.html`);
      yield* fs.symlink(outsidePage, alias);
      yield* fs.writeFileString(`${alias}.pending-html-render`, "");
      yield* fs.utimes(`${alias}.pending-html-render`, old, old);
      const neverWritten = path.join(
        root,
        `${createAttachmentId("never-written", "html")!}.html.pending-html-render`,
      );
      yield* fs.writeFileString(neverWritten, "");
      yield* fs.utimes(neverWritten, old, old);
      const sweep = yield* makeHtmlRenderAttachmentCleanup;
      yield* sweep(root, now);
      expect(yield* fs.exists(orphan.target)).toBe(false);
      for (const target of [
        committed.target,
        upload.target,
        draft.target,
        fresh.target,
        alias,
        outsidePage,
      ])
        expect(yield* fs.exists(target)).toBe(true);
      expect(yield* fs.exists(neverWritten)).toBe(false);
      expect(yield* fs.exists(orphan.marker)).toBe(false);
      expect(yield* fs.exists(committed.marker)).toBe(false);
      expect(yield* fs.exists(fresh.marker)).toBe(true);
      expect(yield* fs.readFileString(outsidePage)).toBe("private");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(NodeServices.layer, NodeSqliteClient.layer({ filename: ":memory:" })),
      ),
    ),
);
