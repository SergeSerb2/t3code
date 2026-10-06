import type { ScopedThreadRef, ThreadPullRequestLink } from "@t3tools/contracts";
import { threadEnvironment } from "../../../state/threads";
import { useAtomCommand } from "../../../state/use-atom-command";
import { SheetListRow } from "./gitSheetComponents";

/** A watched PR can wake this thread; let mobile readers stop that polling directly. */
export function StopWatchingPullRequest(props: {
  readonly threadRef: ScopedThreadRef;
  readonly link: ThreadPullRequestLink;
}) {
  const watch = useAtomCommand(threadEnvironment.watchPullRequest, { reportFailure: true });
  if (props.link.watch === undefined) return null;
  return (
    <SheetListRow
      icon="stop.fill"
      title={`Stop watching #${props.link.number}`}
      subtitle="Stop polling and automatic wakes"
      onPress={() =>
        void watch({
          environmentId: props.threadRef.environmentId,
          input: {
            threadId: props.threadRef.threadId,
            host: props.link.host,
            repository: props.link.repository,
            number: props.link.number,
            watching: false,
          },
        })
      }
    />
  );
}
