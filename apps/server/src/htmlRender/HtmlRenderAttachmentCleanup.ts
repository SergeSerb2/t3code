import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import { parseAttachmentUuid, parseAttachmentFileExtension } from "../attachmentStore.ts";

const GRACE_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 200;
const MARKER_SUFFIX = ".pending-html-render";

/** Reclaims a page whose process died before its tool result committed. */
export const makeHtmlRenderAttachmentCleanup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sql = yield* SqlClient.SqlClient;
  let cursor = "";
  return Effect.fn("HtmlRenderAttachmentCleanup.sweep")(function* (root: string, now: number) {
    if (!(yield* fs.exists(root))) return;
    const canonicalRoot = yield* fs.realPath(root);
    if (canonicalRoot !== path.resolve(root)) return;
    const names = (yield* fs.readDirectory(root))
      .filter((name) => {
        if (!name.endsWith(`.html${MARKER_SUFFIX}`)) return false;
        const id = name.slice(0, -MARKER_SUFFIX.length - 5);
        return parseAttachmentUuid(id) !== null && parseAttachmentFileExtension(id) === "html";
      })
      .toSorted();
    // Rotate the bounded batch so referenced early entries cannot starve later orphans.
    const after = names.findIndex((name) => name > cursor);
    const start = after === -1 ? 0 : after;
    const batch = [...names.slice(start), ...names.slice(0, start)].slice(0, BATCH_SIZE);
    for (const name of batch) {
      cursor = name;
      yield* Effect.gen(function* () {
        const marker = path.join(canonicalRoot, name);
        if ((yield* fs.realPath(marker)) !== marker) return;
        const markerInfo = yield* fs.stat(marker);
        const markedAt = Option.getOrNull(markerInfo.mtime);
        if (markerInfo.type !== "File" || markedAt === null || markedAt.getTime() >= now - GRACE_MS)
          return;
        const target = marker.slice(0, -MARKER_SUFFIX.length);
        if (!(yield* fs.exists(target))) {
          yield* fs.remove(marker);
          return;
        }
        if ((yield* fs.realPath(target)) !== target) return;
        const info = yield* fs.stat(target);
        const modified = Option.getOrNull(info.mtime);
        if (info.type !== "File" || modified === null || modified.getTime() >= now - GRACE_MS)
          return;
        const id = name.slice(0, -MARKER_SUFFIX.length - 5);
        // Conservatively retain any persisted reference, including user uploads.
        const referenced = yield* sql<{ found: number }>`
          SELECT 1 AS found FROM orchestration_v2_projection_turn_items WHERE instr(payload_json, ${id}) > 0
          UNION ALL
          SELECT 1 AS found FROM orchestration_v2_projection_messages WHERE instr(payload_json, ${id}) > 0
          LIMIT 1
        `;
        if (referenced.length !== 0) {
          // Once a result committed, the marker is no longer needed and never rescanned.
          yield* fs.remove(marker);
          return;
        }
        // No provider operation lasts a day; the grace period covers publication and commit.
        const current = yield* fs.stat(target);
        if (
          current.size !== info.size ||
          Option.getOrNull(current.mtime)?.getTime() !== modified.getTime()
        )
          return;
        if ((yield* fs.realPath(target)) === target) {
          yield* fs.remove(target);
          yield* fs.remove(marker);
        }
      }).pipe(
        Effect.catch((error) =>
          Effect.logDebug("HTML attachment cleanup skipped a file", { error }),
        ),
      );
    }
  });
});
